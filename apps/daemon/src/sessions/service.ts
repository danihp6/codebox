import type {
  Repo,
  Session,
  SessionMessage,
  SessionProposal,
  SessionTarget,
} from '@codebox/contracts';
import { parseSseEvent } from '@codebox/contracts';
import { decidePermission } from '@codebox/core';
import type { AgentRuntime, RawAgentEvent } from '@codebox/opencode';
import { AgentError, createAgentRuntime } from '@codebox/opencode';
import { createGitHubProvider } from '@codebox/git-provider';
import type { GitProvider, RepoInfo } from '@codebox/git-provider';
import { withTransaction } from '@codebox/store';
import type { PageQuery, PageResult, Store } from '@codebox/store';
import {
  GIT_ENV,
  WorkspaceError,
  branchName,
  createGitRunner,
  worktreePath,
} from '@codebox/workspaces';
import type { GitRunner, WorkspaceManager } from '@codebox/workspaces';
import { eventNotifier } from '../events/notifier.js';
import type { DaemonContext } from '../modules.js';
import { permissionPath } from '../run/engine.js';
import { createDaemonWorkspaces, providerAuth } from '../runs/engine.js';
import { RunApiError } from '../runs/errors.js';
import {
  conflict,
  invalid,
  notFound,
  providerUnavailable,
  repoNotFound,
  unavailable,
  workspaceUnavailable,
} from './errors.js';
import { newSessionId, newSessionMessageId } from './ids.js';

export const MAX_TEXT_CHARS = 32_000;
const AGENT_REQUEST_TIMEOUT_MS = 30_000;
const AGENT_RECONNECT_DELAY_MS = 1_000;
const UNNAMED_TOOL = 'unknown';
const GIT_HOST = 'github.com';

/** The only paths a target may write. `repo` writes nothing; `work` writes the backlog only. */
export const TARGET_WRITE_SETS: Readonly<Record<SessionTarget, readonly string[]>> = Object.freeze({
  backlog: ['TODO.md'],
  work: ['TODO.md'],
  design: ['design/'],
  schedule: ['.codebox/schedule.yml'],
  repo: [],
});

/**
 * `null` when every path is inside the target, else the first path that is not. A directory entry
 * matches by prefix; a single file matches exactly, so `TODO.md` never admits `docs/TODO.md`.
 */
export function outsideTarget(target: SessionTarget, paths: readonly string[]): string | null {
  const allowed = TARGET_WRITE_SETS[target];
  for (const path of paths) {
    const inside = allowed.some((entry) =>
      entry.endsWith('/') ? path.startsWith(entry) : path === entry,
    );
    if (!inside) return path;
  }
  return null;
}

export type SessionsAgent = Pick<
  AgentRuntime,
  'createSession' | 'prompt' | 'subscribe' | 'interrupt' | 'replyPermission' | 'closeSession'
>;
export type SessionWorkspaces = Pick<WorkspaceManager, 'ensureClone' | 'createWorktree'>;

export interface SessionMergePort {
  /** Pushes the session branch and merges its docs-only PR through the provider. */
  merge(input: {
    readonly session: Session;
    readonly repo: Repo;
    readonly worktree: string;
    readonly proposal: SessionProposal;
  }): Promise<void>;
}

export interface CreateSessionsServiceOptions {
  readonly context: DaemonContext;
  readonly agent?: SessionsAgent;
  readonly workspaces?: SessionWorkspaces;
  readonly git?: GitRunner;
  readonly merge?: SessionMergePort;
}

export interface CreateSessionInput {
  readonly repoId: string;
  readonly target: SessionTarget;
  readonly workId?: string | null;
  readonly title?: string;
}

export interface SessionsService {
  list(query: {
    readonly repoId?: string;
    readonly target?: SessionTarget;
    readonly limit: number;
    readonly cursor: string | null;
  }): PageResult<Session>;
  /** Creates the row, its worktree and — for a targeted session — its `cb/` branch. */
  create(input: CreateSessionInput): Promise<Session>;
  get(id: string): Session;
  messages(id: string, query: PageQuery): PageResult<SessionMessage>;
  /** One awaited agent turn; resolves with the stored user message. */
  send(input: { readonly id: string; readonly text: string }): Promise<SessionMessage>;
  compact(id: string): Promise<Session>;
  merge(id: string): Promise<Session>;
  interrupt(id: string): Promise<Session>;
  archive(id: string): Promise<Session>;
}

export interface SessionsInternals {
  readonly store: Store;
  readonly clock: () => Date;
}

const INTERNALS = new WeakMap<SessionsService, SessionsInternals>();
const SERVICES = new WeakMap<DaemonContext, SessionsService>();

export function sessionsInternals(service: SessionsService): SessionsInternals {
  const internals = INTERNALS.get(service);
  if (internals === undefined) {
    throw new Error('the sessions service was not created by createSessionsService');
  }
  return internals;
}

const DEFAULT_TITLES: Readonly<Record<SessionTarget, string>> = Object.freeze({
  backlog: 'Edit TODO.md',
  work: 'Decision',
  design: 'Edit the design',
  schedule: 'Edit the schedule',
  repo: 'Repository context',
});

type TurnEvent =
  'session.created' | 'session.delta' | 'session.tool' | 'session.proposal' | 'session.closed';

interface TurnResult {
  readonly text: string;
  readonly aborted: boolean;
  readonly failed: boolean;
  readonly usage: { usd: number; tokensIn: number; tokensOut: number };
  readonly contextTokens: number;
}

type TurnStep =
  | { readonly kind: 'event'; readonly value: RawAgentEvent }
  | { readonly kind: 'end' }
  | { readonly kind: 'prompt_error' }
  | { readonly kind: 'aborted' };

function repoRef(repo: Repo): { slug: string; defaultBranch: string; cloneUrl: string } {
  return {
    slug: repo.slug,
    defaultBranch: repo.defaultBranch,
    cloneUrl: `https://github.com/${repo.slug}.git`,
  };
}

function toolName(tool: string): string {
  const name = tool.trim();
  return name.length > 0 ? name : UNNAMED_TOOL;
}

function toRecord(value: object): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

function never(): Promise<never> {
  return new Promise<never>(() => undefined);
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, Math.trunc(ms)));
    timer.unref();
  });
}

export function createSessionsService(options: CreateSessionsServiceOptions): SessionsService {
  const context = options.context;
  const store = context.store;
  const config = context.config;
  const logger = context.logger;
  const clock = context.clock;
  const notifier = eventNotifier(context);

  let agentRuntime: SessionsAgent | null = options.agent ?? null;
  let workspaceManager: SessionWorkspaces | null = options.workspaces ?? null;
  let mergePort: SessionMergePort | null = options.merge ?? null;
  const git: GitRunner = options.git ?? createGitRunner();
  const turns = new Map<string, AbortController>();
  // The contract `Session` carries neither `worktree` nor `opencode_session_id`; both columns are
  // written and this map is the live link, rebuilt by `prepare` after a restart.
  const agentSessions = new Map<string, string>();
  const worktreeDirectories = new Map<string, string>();

  function agent(): SessionsAgent {
    if (agentRuntime === null) {
      agentRuntime = createAgentRuntime({
        baseUrl: config.CB_OPENCODE_URL,
        token: config.CB_OPENCODE_TOKEN,
        healthPath: config.CB_OPENCODE_HEALTH_PATH,
        fetch: (input, init) => globalThis.fetch(input, init),
        requestTimeoutMs: AGENT_REQUEST_TIMEOUT_MS,
        reconnectDelayMs: AGENT_RECONNECT_DELAY_MS,
        sleep: (ms) => delay(ms),
      });
    }
    return agentRuntime;
  }

  function workspaces(): SessionWorkspaces {
    if (workspaceManager === null) workspaceManager = createDaemonWorkspaces(context);
    return workspaceManager;
  }

  function merger(): SessionMergePort {
    if (mergePort === null) mergePort = createProviderMergePort(context, git);
    return mergePort;
  }

  function requireSession(id: string): Session {
    const session = store.sessions.getSession(id);
    if (session === null) throw notFound();
    return session;
  }

  function requireRepo(id: string): Repo {
    const repo = store.repos.get(id);
    if (repo === null) throw repoNotFound();
    return repo;
  }

  function requireOpen(session: Session): void {
    if (session.status === 'archived') throw conflict('session_archived');
  }

  function appendEvent(
    sessionId: string,
    event: TurnEvent,
    data: Readonly<Record<string, unknown>>,
  ): void {
    const seq = store.events.nextSeq({ sessionId });
    const ts = clock().toISOString();
    const parsed = parseSseEvent({ event, data: { sessionId, seq, ts, ...data } });
    store.events.append({
      runId: null,
      chatId: null,
      sessionId,
      seq,
      type: parsed.event,
      data: toRecord(parsed.data),
      ts,
    });
  }

  function appendMessage(
    session: Session,
    role: SessionMessage['role'],
    text: string,
  ): SessionMessage {
    return store.sessions.appendMessage({
      id: newSessionMessageId(),
      sessionId: session.id,
      role,
      text,
      createdAt: clock().toISOString(),
    });
  }

  async function ensureWorktree(session: Session, repo: Repo): Promise<string> {
    const live = worktreeDirectories.get(session.id);
    if (live !== undefined) return live;
    const ref = repoRef(repo);
    const expected = worktreePath(config.CB_WORKSPACE_ROOT, session.id);
    let path: string;
    try {
      await workspaces().ensureClone(ref);
      const worktree = await workspaces().createWorktree({
        repo: ref,
        runId: session.id,
        baseRef: repo.defaultBranch,
        title: session.title,
      });
      path = worktree.path;
    } catch (error) {
      if (error instanceof WorkspaceError && error.code === 'worktree_exists') {
        path = expected;
      } else {
        logger.warn({
          msg: 'session_workspace_unavailable',
          sessionId: session.id,
          reason: error instanceof Error ? error.name : 'unknown',
        });
        throw workspaceUnavailable();
      }
    }
    worktreeDirectories.set(session.id, path);
    store.sessions.updateSession(session.id, {
      worktree: path,
      updatedAt: clock().toISOString(),
    });
    return path;
  }

  async function ensureAgentSession(session: Session, directory: string): Promise<string> {
    const live = agentSessions.get(session.id);
    if (live !== undefined) return live;
    try {
      const reference = await agent().createSession({
        directory,
        title: `cb-session-${session.id}`,
        agent: config.CB_DEFAULT_AGENT,
        model: config.CB_DEFAULT_MODEL,
      });
      agentSessions.set(session.id, reference.sessionId);
      store.sessions.updateSession(session.id, {
        opencodeSessionId: reference.sessionId,
        updatedAt: clock().toISOString(),
      });
      return reference.sessionId;
    } catch (error) {
      if (error instanceof AgentError) {
        logger.warn({
          msg: 'session_agent_unavailable',
          sessionId: session.id,
          reason: error.code,
        });
        throw unavailable();
      }
      throw error;
    }
  }

  async function decidePermissionOf(
    session: Session,
    directory: string,
    opencodeSessionId: string,
    raw: Extract<RawAgentEvent, { readonly type: 'permission.updated' }>,
  ): Promise<void> {
    const decision = decidePermission({
      tool: raw.tool,
      mode: 'run',
      path: permissionPath(raw.input),
      worktree: directory,
    });
    try {
      await agent().replyPermission(
        opencodeSessionId,
        raw.permissionId,
        decision === 'allow' ? 'once' : 'reject',
      );
    } catch (error) {
      logger.warn({
        msg: 'session_permission_reply_failed',
        sessionId: session.id,
        tool: toolName(raw.tool),
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  /** The whole turn is awaited by the caller: no floating promise outlives the request. */
  async function runTurn(
    session: Session,
    directory: string,
    opencodeSessionId: string,
    text: string,
    signal: AbortSignal,
  ): Promise<TurnResult> {
    const usage = { usd: 0, tokensIn: 0, tokensOut: 0 };
    let contextTokens = 0;
    let assembled = '';
    const iterator = agent().subscribe({ sessionId: opencodeSessionId })[Symbol.asyncIterator]();
    const prompted = agent()
      .prompt(opencodeSessionId, text)
      .then(
        (): 'ok' => 'ok',
        (error: unknown): 'error' => {
          logger.warn({
            msg: 'session_prompt_failed',
            sessionId: session.id,
            reason: error instanceof Error ? error.name : 'unknown',
          });
          return 'error';
        },
      );
    const promptStep = prompted.then((settled): Promise<TurnStep> =>
      settled === 'error' ? Promise.resolve({ kind: 'prompt_error' }) : never(),
    );
    const abortStep: Promise<TurnStep> = new Promise<TurnStep>((resolve) => {
      if (signal.aborted) {
        resolve({ kind: 'aborted' });
        return;
      }
      signal.addEventListener('abort', () => resolve({ kind: 'aborted' }), { once: true });
    });
    const stepOf = (): Promise<TurnStep> =>
      iterator
        .next()
        .then((step): TurnStep =>
          step.done === true ? { kind: 'end' } : { kind: 'event', value: step.value },
        );
    let pending = stepOf();
    try {
      for (;;) {
        const step = await Promise.race([pending, promptStep, abortStep]);
        if (step.kind === 'aborted') {
          return { text: assembled, aborted: true, failed: false, usage, contextTokens };
        }
        if (step.kind === 'prompt_error') {
          return { text: assembled, aborted: false, failed: true, usage, contextTokens };
        }
        if (step.kind === 'end') {
          logger.warn({ msg: 'session_stream_ended', sessionId: session.id });
          return { text: assembled, aborted: false, failed: true, usage, contextTokens };
        }
        pending = stepOf();
        const raw = step.value;
        switch (raw.type) {
          case 'session.updated': {
            if (raw.status !== 'idle') break;
            const settled = await prompted;
            return {
              text: assembled,
              aborted: false,
              failed: settled === 'error',
              usage,
              contextTokens,
            };
          }
          case 'message.part.text': {
            if (raw.delta.length === 0) break;
            assembled += raw.delta;
            withTransaction(store.db, () => {
              appendEvent(session.id, 'session.delta', { delta: raw.delta });
            });
            notifier.notify();
            break;
          }
          case 'message.part.tool': {
            withTransaction(store.db, () => {
              appendEvent(session.id, 'session.tool', {
                tool: toolName(raw.tool),
                status: raw.status,
              });
            });
            notifier.notify();
            break;
          }
          case 'permission.updated': {
            await decidePermissionOf(session, directory, opencodeSessionId, raw);
            break;
          }
          case 'session.usage': {
            usage.usd += raw.costUsd;
            usage.tokensIn += raw.tokensIn;
            usage.tokensOut += raw.tokensOut;
            // D48: the context the model saw is the input side of the last turn's usage.
            contextTokens = Math.max(contextTokens, raw.tokensIn);
            break;
          }
          case 'session.error': {
            logger.warn({ msg: 'session_turn_error', sessionId: session.id });
            return { text: assembled, aborted: false, failed: true, usage, contextTokens };
          }
        }
      }
    } finally {
      void Promise.resolve(iterator.return?.(undefined)).catch(() => undefined);
    }
  }

  /** Idle, the assistant row and the usage are written together; an archive is never undone. */
  function finishTurn(session: Session, result: TurnResult | null): Session {
    const ts = clock().toISOString();
    return withTransaction(store.db, () => {
      if (result !== null && result.text.length > 0)
        appendMessage(session, 'assistant', result.text);
      const current = store.sessions.getSession(session.id);
      const status = current !== null && current.status === 'archived' ? 'archived' : 'idle';
      return store.sessions.updateSession(session.id, {
        status,
        updatedAt: ts,
        ...(result === null
          ? {}
          : {
              usage: {
                usd: session.usage.usd + result.usage.usd,
                tokensIn: session.usage.tokensIn + result.usage.tokensIn,
                tokensOut: session.usage.tokensOut + result.usage.tokensOut,
              },
              contextTokens: result.contextTokens,
            }),
      });
    });
  }

  async function diffOf(session: Session, repo: Repo): Promise<{ paths: string[]; sha: string }> {
    const worktree = worktreeDirectories.get(session.id);
    if (worktree === undefined) throw conflict('proposal_none');
    const timeoutMs = config.CB_GIT_HTTP_TIMEOUT_SECONDS * 1000;
    const base = await git.run({
      args: ['rev-parse', `refs/heads/${repo.defaultBranch}`],
      cwd: worktree,
      timeoutMs,
      env: GIT_ENV,
    });
    const head = await git.run({
      args: ['rev-parse', 'HEAD'],
      cwd: worktree,
      timeoutMs,
      env: GIT_ENV,
    });
    if (base.code !== 0 || head.code !== 0) throw conflict('proposal_none');
    const changed = await git.run({
      args: ['diff', '--name-only', base.stdout.trim()],
      cwd: worktree,
      timeoutMs,
      env: GIT_ENV,
    });
    if (changed.code !== 0) throw conflict('proposal_none');
    const paths = changed.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return { paths, sha: head.stdout.trim() };
  }

  const service: SessionsService = {
    list(query): PageResult<Session> {
      return store.sessions.listSessions({
        limit: query.limit,
        cursor: query.cursor,
        ...(query.repoId === undefined ? {} : { repoId: query.repoId }),
        ...(query.target === undefined ? {} : { target: query.target }),
      });
    },

    async create(input): Promise<Session> {
      const repo = requireRepo(input.repoId);
      const workId = input.workId ?? null;
      if ((input.target === 'work') !== (workId !== null)) {
        throw invalid('session.workId', { reason: 'work_target' });
      }
      if (workId !== null) {
        const work = store.works.get(workId);
        if (work === null || work.repoId !== repo.id) throw repoNotFound();
      }
      const at = clock().toISOString();
      const title = input.title ?? DEFAULT_TITLES[input.target];
      const id = newSessionId();
      const session = withTransaction(store.db, () => {
        const created = store.sessions.createSession({
          id,
          repoId: repo.id,
          target: input.target,
          workId,
          title,
          status: 'idle',
          branch: input.target === 'repo' ? null : branchName(id, title),
          pendingProposal: null,
          usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
          contextTokens: 0,
          contextEpoch: 1,
          createdAt: at,
          updatedAt: at,
          lastMessage: null,
        });
        appendEvent(created.id, 'session.created', {
          repoId: created.repoId,
          target: created.target,
          workId: created.workId,
        });
        return created;
      });
      notifier.notify();
      await ensureWorktree(session, repo);
      return requireSession(session.id);
    },

    get(id): Session {
      return requireSession(id);
    },

    messages(id, query): PageResult<SessionMessage> {
      requireSession(id);
      return store.sessions.listMessages(id, query);
    },

    async send(input): Promise<SessionMessage> {
      const session = requireSession(input.id);
      requireOpen(session);
      if (input.text.length > MAX_TEXT_CHARS || input.text.trim().length === 0) {
        throw invalid('session.message.text');
      }
      const repo = requireRepo(session.repoId);
      const directory = await ensureWorktree(session, repo);
      const opencodeSessionId = await ensureAgentSession(session, directory);
      const stored = withTransaction(store.db, () => {
        const message = appendMessage(session, 'user', input.text);
        store.sessions.updateSession(session.id, {
          status: 'working',
          updatedAt: clock().toISOString(),
        });
        return message;
      });
      notifier.notify();
      const controller = new AbortController();
      turns.set(session.id, controller);
      let result: TurnResult;
      try {
        result = await runTurn(
          session,
          directory,
          opencodeSessionId,
          input.text,
          controller.signal,
        );
      } catch (error) {
        finishTurn(session, null);
        notifier.notify();
        if (error instanceof AgentError) {
          logger.warn({
            msg: 'session_agent_unavailable',
            sessionId: session.id,
            reason: error.code,
          });
          throw unavailable();
        }
        throw error;
      } finally {
        turns.delete(session.id);
      }
      finishTurn(session, result);
      notifier.notify();
      if (result.failed) throw unavailable();
      return stored;
    },

    async compact(id): Promise<Session> {
      const session = requireSession(id);
      requireOpen(session);
      const repo = requireRepo(session.repoId);
      const directory = await ensureWorktree(session, repo);
      const live = agentSessions.get(session.id);
      agentSessions.delete(session.id);
      if (live !== undefined) {
        try {
          await agent().closeSession(live);
        } catch (error) {
          logger.warn({
            msg: 'session_close_failed',
            sessionId: session.id,
            reason: error instanceof Error ? error.name : 'unknown',
          });
        }
      }
      await ensureAgentSession(session, directory);
      const epoch = session.contextEpoch + 1;
      const updated = withTransaction(store.db, () => {
        appendMessage(session, 'system', 'Context compacted.');
        return store.sessions.updateSession(session.id, {
          contextEpoch: epoch,
          status: 'idle',
          updatedAt: clock().toISOString(),
        });
      });
      notifier.notify();
      logger.info({ msg: 'session_compacted', sessionId: session.id, contextEpoch: epoch });
      return updated;
    },

    async merge(id): Promise<Session> {
      const session = requireSession(id);
      if (session.target === 'repo') throw conflict('read_only_session');
      requireOpen(session);
      if (session.pendingProposal !== null) throw conflict('proposal_pending');
      const repo = requireRepo(session.repoId);
      const { paths, sha } = await diffOf(session, repo);
      const offending = outsideTarget(session.target, paths);
      if (offending !== null) {
        logger.warn({ msg: 'session_target_violation', sessionId: session.id, path: offending });
        throw conflict('target_violation', { path: offending });
      }
      if (paths.length === 0) throw conflict('proposal_none');
      const branch = session.branch;
      if (branch === null) throw conflict('proposal_none');
      const at = clock().toISOString();
      const proposal: SessionProposal = { branch, sha, paths, createdAt: at };
      const proposed = withTransaction(store.db, () => {
        const updated = store.sessions.updateSession(session.id, {
          pendingProposal: proposal,
          updatedAt: at,
        });
        appendEvent(session.id, 'session.proposal', { proposal });
        return updated;
      });
      notifier.notify();
      const worktree = worktreeDirectories.get(session.id) ?? '';
      try {
        await merger().merge({ session: proposed, repo, worktree, proposal });
      } catch (error) {
        // A refused merge leaves the diff on disk and no proposal open: the operator can retry.
        store.sessions.updateSession(session.id, {
          pendingProposal: null,
          updatedAt: clock().toISOString(),
        });
        if (error instanceof RunApiError) throw error;
        logger.warn({
          msg: 'session_merge_failed',
          sessionId: session.id,
          reason: error instanceof Error ? error.name : 'unknown',
        });
        throw providerUnavailable();
      }
      const merged = withTransaction(store.db, () =>
        store.sessions.updateSession(session.id, {
          pendingProposal: null,
          status: 'idle',
          updatedAt: clock().toISOString(),
        }),
      );
      notifier.notify();
      return merged;
    },

    async interrupt(id): Promise<Session> {
      const session = requireSession(id);
      requireOpen(session);
      const live = agentSessions.get(session.id);
      if (live !== undefined) {
        try {
          await agent().interrupt(live);
        } catch (error) {
          logger.warn({
            msg: 'session_interrupt_failed',
            sessionId: session.id,
            reason: error instanceof Error ? error.name : 'unknown',
          });
        }
      }
      turns.get(session.id)?.abort();
      return finishTurn(session, null);
    },

    async archive(id): Promise<Session> {
      const session = requireSession(id);
      turns.get(session.id)?.abort();
      agentSessions.delete(session.id);
      worktreeDirectories.delete(session.id);
      const closed = withTransaction(store.db, () => {
        const updated = store.sessions.updateSession(session.id, {
          status: 'archived',
          updatedAt: clock().toISOString(),
        });
        appendEvent(session.id, 'session.closed', { status: 'archived' });
        return updated;
      });
      notifier.notify();
      return closed;
    },
  };

  INTERNALS.set(service, { store, clock });
  return service;
}

export function sessionService(context: DaemonContext): SessionsService {
  const existing = SERVICES.get(context);
  if (existing !== undefined) return existing;
  const created = createSessionsService({ context });
  SERVICES.set(context, created);
  return created;
}

/** docs/api.md §5.6.1: `POST /merge` pushes a docs-only PR and merges it through the provider. */
function createProviderMergePort(context: DaemonContext, git: GitRunner): SessionMergePort {
  let provider: GitProvider | null = null;
  function github(): GitProvider {
    if (provider === null) {
      provider = createGitHubProvider({
        auth: providerAuth(context),
        apiBase: context.config.CB_GITHUB_API_URL,
        gitHost: GIT_HOST,
        fetch: (url, init) => fetch(url, init),
        git,
        now: () => context.clock().getTime(),
        requestTimeoutMs: context.config.CB_GIT_HTTP_TIMEOUT_SECONDS * 1000,
        log: (event): void => {
          context.logger.debug({ msg: 'git_provider', level: event.level, status: event.status });
        },
        userAgent: `codebox/${context.build.version}`,
      });
    }
    return provider;
  }
  return {
    async merge(input): Promise<void> {
      const info: RepoInfo = await github().getRepo(input.repo.slug);
      await github().pushBranch({
        repo: info,
        worktree: input.worktree,
        branch: input.proposal.branch,
      });
      const pr = await github().openPullRequest({
        repo: info,
        head: input.proposal.branch,
        base: input.repo.defaultBranch,
        title: input.session.title,
        body: `Session: ${input.session.id}\nTarget: ${input.session.target}\n\n${input.proposal.paths.join('\n')}`,
        draft: false,
        labels: [],
      });
      const merged = await github().mergePullRequest({
        repo: info,
        number: pr.number,
        method: 'squash',
        commitTitle: `${input.session.title} (#${pr.number})`,
        commitMessage: `Codebox-Session: ${input.session.id}`,
        sha: pr.headSha,
      });
      if (!merged.merged) throw providerUnavailable();
    },
  };
}

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatMessage, ChatSession } from '@codebox/contracts';
import { parseSseEvent } from '@codebox/contracts';
import { decidePermission, matchesGlob } from '@codebox/core';
import {
  AgentError,
  CHAT_HANDOFF_TURNS,
  buildChatHandoff,
  createAgentRuntime,
} from '@codebox/opencode';
import type {
  AgentRuntime,
  ChatHandoffReason,
  ChatHandoffTurn,
  CreateSessionInput,
  RawAgentEvent,
  SessionRef,
} from '@codebox/opencode';
import { withTransaction } from '@codebox/store';
import type { ChatMessageOrigin, EventRecord, Store } from '@codebox/store';
import {
  WorkspaceError,
  createGitRunner,
  createWorkspaceManager,
  worktreePath,
} from '@codebox/workspaces';
import type { RepoRef, WorkspaceManager } from '@codebox/workspaces';
import { eventNotifier } from '../events/notifier.js';
import type { DaemonContext } from '../modules.js';
import { permissionPath } from '../run/engine.js';
import { ChatError } from './errors.js';
import { newChatId, newMessageId } from './ids.js';
import { createRoutineToolServer } from './tools/index.js';
import type { RoutineToolServer } from './tools/index.js';

export const MAX_TEXT_CHARS = 32_000;

/** Free chats live under this dot-directory, which the workspace cleanup never lists. */
export const FREE_CHAT_DIRECTORY = '.chat';

export const BIND_DIVIDER = 'The recent turns were re-injected into a new session.';

export const COMPACT_DIVIDER = `Context compacted. ${BIND_DIVIDER}`;

export function bindDividerText(repoSlug: string): string {
  return `Connected repository ${repoSlug}. ${BIND_DIVIDER}`;
}

const AGENT_REQUEST_TIMEOUT_MS = 30_000;
const AGENT_RECONNECT_DELAY_MS = 1_000;
const UNNAMED_TOOL = 'unknown';

export type ChatAgent = Pick<
  AgentRuntime,
  'createSession' | 'prompt' | 'subscribe' | 'interrupt' | 'replyPermission' | 'closeSession'
>;
export type ChatWorkspaces = Pick<
  WorkspaceManager,
  'ensureClone' | 'createWorktree' | 'removeWorktree'
>;

export interface CreateChatServiceOptions {
  readonly context: DaemonContext;
  readonly agent?: ChatAgent;
  readonly workspaces?: ChatWorkspaces;
  readonly routineTools?: () => RoutineToolServer;
}

export interface SendMessageInput {
  readonly chatId: string;
  readonly text: string;
}

export interface SendRoutineInput {
  readonly chatId: string;
  readonly text: string;
}

export interface ChatService {
  /** Appends the user message and queues the prompt; returns the stored message. */
  send(input: SendMessageInput): Promise<ChatMessage>;
  /** `send`, but the stored message carries `origin: 'routine'` (docs/jobs.md §15). */
  sendRoutine(input: SendRoutineInput): Promise<ChatMessage>;
  /** Joins the pump for one chat; resolves when the agent reports idle. Never throws. */
  pump(chatId: string): Promise<void>;
  /** Interrupts the agent, marks the session idle, appends `chat.idle`. */
  interrupt(chatId: string): Promise<ChatSession>;
  /** Creates the worktree and the OpenCode session for a stored chat row. */
  prepare(chatId: string): Promise<ChatSession>;
  /** Binds a free chat to a repository: forget the free session, then `prepare`. */
  bind(chatId: string, repoId: string): Promise<ChatSession>;
  /** Starts a new OpenCode session in the same directory and bumps the context epoch. */
  compact(chatId: string): Promise<ChatSession>;
  /** Aborts every turn and closes the tool server; idempotent. */
  stop(): void;
}

/**
 * The chat routes need the same store, clock and id sources as the service, while the frozen
 * `ChatService` surface has no accessor for them. The link travels beside the object, like the
 * authenticated device in `auth/middleware.ts`.
 */
export interface ChatRuntime {
  readonly store: Store;
  readonly clock: () => Date;
  readonly newChatId: () => string;
}

const RUNTIMES = new WeakMap<ChatService, ChatRuntime>();

export function chatRuntimeOf(service: ChatService): ChatRuntime {
  const runtime = RUNTIMES.get(service);
  if (runtime === undefined) {
    throw new Error('the chat service was not created by createChatService');
  }
  return runtime;
}

type ChatEventName = 'chat.message' | 'chat.delta' | 'chat.tool' | 'chat.idle' | 'chat.compacted';

type PermissionEvent = Extract<RawAgentEvent, { readonly type: 'permission.updated' }>;

type RoundOutcome = 'idle' | 'failed' | 'aborted';

type Step =
  | { readonly kind: 'event'; readonly value: RawAgentEvent }
  | { readonly kind: 'end' }
  | { readonly kind: 'prompt_error' }
  | { readonly kind: 'aborted' };

interface Turn {
  readonly controller: AbortController;
  readonly promise: Promise<void>;
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

function toRecord(value: object): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

function toolName(tool: string): string {
  const name = tool.trim();
  return name.length > 0 ? name : UNNAMED_TOOL;
}

function abortStepOf(signal: AbortSignal): { readonly step: Promise<Step>; dispose(): void } {
  let listener: (() => void) | null = null;
  const step = new Promise<Step>((resolve) => {
    if (signal.aborted) {
      resolve({ kind: 'aborted' });
      return;
    }
    listener = (): void => resolve({ kind: 'aborted' });
    signal.addEventListener('abort', listener, { once: true });
  });
  return {
    step,
    dispose(): void {
      if (listener !== null) signal.removeEventListener('abort', listener);
      listener = null;
    },
  };
}

export function createChatService(options: CreateChatServiceOptions): ChatService {
  const context = options.context;
  const store = context.store;
  const config = context.config;
  const logger = context.logger;
  const clock = context.clock;
  const notifier = eventNotifier(context);

  let agentRuntime: ChatAgent | null = options.agent ?? null;
  let workspaceManager: ChatWorkspaces | null = options.workspaces ?? null;
  let routineToolServer: RoutineToolServer | null = null;

  const turns = new Map<string, Turn>();
  const queues = new Map<string, string[]>();
  // The merged `ChatRepository` exposes the contract `ChatSession` only, which carries neither
  // `opencode_session_id` nor `worktree`; both columns are still written on every prepare, and
  // this map is the live link to the OpenCode session of each chat. After a restart a chat is
  // prepared again in the same worktree, which is the durable half of the binding.
  const agentSessions = new Map<string, string>();
  const worktreeDirectories = new Map<string, string>();
  let stopped = false;

  // Both clients are built on first use: registering the module opens no socket, and a test
  // injects its own pair without touching the network.
  function agent(): ChatAgent {
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

  function workspaces(): ChatWorkspaces {
    if (workspaceManager === null) {
      workspaceManager = createWorkspaceManager({
        repoRoot: config.CB_REPO_ROOT,
        workspaceRoot: config.CB_WORKSPACE_ROOT,
        git: createGitRunner(),
        matchesGlob,
        cloneDepth: config.CB_CLONE_DEPTH,
        httpTimeoutSeconds: config.CB_GIT_HTTP_TIMEOUT_SECONDS,
        now: clock,
      });
    }
    return workspaceManager;
  }

  function tools(): RoutineToolServer {
    if (routineToolServer === null) {
      routineToolServer =
        options.routineTools?.() ?? createRoutineToolServer({ store, now: clock, logger });
    }
    return routineToolServer;
  }

  function requireSession(chatId: string): ChatSession {
    const session = store.chats.getSession(chatId);
    if (session === null) throw new ChatError('not_found', 404, { path: 'chat.id' });
    return session;
  }

  function archived(): ChatError {
    return new ChatError('chat_archived', 409, { reason: 'chat_archived' });
  }

  function notWorking(): ChatError {
    return new ChatError('chat_not_working', 409, { reason: 'chat_not_working' });
  }

  function throwAgentFailure(error: unknown): never {
    if (error instanceof AgentError) {
      logger.warn({ msg: 'chat_agent_unavailable', reason: error.code });
      throw new ChatError('agent_unavailable', 502, { reason: 'agent_unavailable' });
    }
    throw error;
  }

  function throwWorkspaceFailure(error: unknown): never {
    if (error instanceof WorkspaceError) {
      logger.warn({ msg: 'chat_workspace_unavailable', reason: error.code });
      throw new ChatError('workspace_unavailable', 503, { reason: 'workspace_unavailable' });
    }
    throw error;
  }

  function logFailure(chatId: string, error: unknown): void {
    const reason = error instanceof Error ? error.name : 'unknown';
    logger.error({ msg: 'chat_pump_failed', chatId, reason });
  }

  function persistChatEvent(
    chatId: string,
    event: ChatEventName,
    seq: number,
    ts: string,
    extra: Record<string, unknown> = {},
  ): EventRecord {
    const parsed = parseSseEvent({ event, data: { chatId, seq, ts, ...extra } });
    return store.events.append({
      runId: null,
      chatId,
      seq,
      type: parsed.event,
      data: toRecord(parsed.data),
      ts,
    });
  }

  function appendMessage(chatId: string, text: string, origin: ChatMessageOrigin): ChatMessage {
    const ts = clock().toISOString();
    const message: ChatMessage = {
      id: newMessageId(),
      chatId,
      role: 'user',
      text,
      createdAt: ts,
    };
    const stored = withTransaction(store.db, () => {
      const row = store.chats.appendMessage(message, { origin });
      const seq = store.events.nextSeq({ chatId });
      persistChatEvent(chatId, 'chat.message', seq, ts, { message: row });
      store.chats.updateSession(chatId, { status: 'working', updatedAt: ts });
      return row;
    });
    notifier.notify();
    return stored;
  }

  /**
   * The handoff divider is a `system` row written straight through the repository: it is part
   * of the transcript, so it must survive a restart, but it never moves the session to `working`.
   */
  function appendDivider(chatId: string, text: string): ChatMessage {
    const ts = clock().toISOString();
    const message: ChatMessage = {
      id: newMessageId(),
      chatId,
      role: 'system',
      text,
      createdAt: ts,
    };
    const stored = withTransaction(store.db, () => {
      const row = store.chats.appendMessage(message, { origin: 'assistant' });
      const seq = store.events.nextSeq({ chatId });
      persistChatEvent(chatId, 'chat.message', seq, ts, { message: row });
      return row;
    });
    notifier.notify();
    return stored;
  }

  /**
   * The preamble the next prompt of a rebound or compacted chat carries. It is built from the
   * persisted transcript, so a daemon restart between the divider and the next turn loses nothing.
   */
  function pendingHandoff(chatId: string): string | null {
    const rows = store.chats.recentMessages(chatId, CHAT_HANDOFF_TURNS + 1);
    const newest = rows.at(-1);
    if (newest === undefined || newest.role !== 'system') return null;
    const session = store.chats.getSession(chatId);
    const repo =
      session === null || session.repoId === null ? null : store.repos.get(session.repoId);
    if (repo === null) return null;
    const turns: ChatHandoffTurn[] = rows
      .slice(0, -1)
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .map((row) => ({ role: row.role === 'user' ? 'user' : 'assistant', text: row.text }));
    const reason: ChatHandoffReason = newest.text === COMPACT_DIVIDER ? 'compact' : 'bind';
    return buildChatHandoff({
      repo: repo.slug,
      baseBranch: repo.defaultBranch,
      reason,
      turns,
    });
  }

  function appendTool(chatId: string, tool: string, status: 'start' | 'ok' | 'error'): void {
    const ts = clock().toISOString();
    withTransaction(store.db, () => {
      const seq = store.events.nextSeq({ chatId });
      persistChatEvent(chatId, 'chat.tool', seq, ts, { tool: toolName(tool), status });
    });
    notifier.notify();
  }

  function appendDelta(chatId: string, delta: string): void {
    const ts = clock().toISOString();
    withTransaction(store.db, () => {
      const seq = store.events.nextSeq({ chatId });
      persistChatEvent(chatId, 'chat.delta', seq, ts, { delta });
    });
    notifier.notify();
  }

  /**
   * A permission is answered inside the round that received it (D45): the policy decides, `allow`
   * replies `once`, `ask` and `deny` reply `reject`, and nothing is written. The reply delays the
   * round and never fails it, so a request the agent never hears about cannot stall the turn.
   */
  async function decideChatPermission(
    chatId: string,
    sessionId: string,
    raw: PermissionEvent,
  ): Promise<void> {
    const tool = toolName(raw.tool);
    const directory = worktreeDirectories.get(chatId);
    const decision =
      directory === undefined
        ? 'deny'
        : decidePermission({
            tool: raw.tool,
            mode: 'chat',
            path: permissionPath(raw.input),
            worktree: directory,
          });
    try {
      await agent().replyPermission(
        sessionId,
        raw.permissionId,
        decision === 'allow' ? 'once' : 'reject',
      );
    } catch (error) {
      logger.warn({
        msg: 'chat_permission_reply_failed',
        chatId,
        tool,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return;
    }
    if (decision === 'ask') {
      logger.warn({ msg: 'chat_permission_ask_rejected', chatId, tool });
      return;
    }
    if (decision === 'deny') logger.info({ msg: 'chat_permission_denied', chatId, tool });
  }

  /** The last event of a round is always `chat.idle`; `docs/api.md` §5.6 has no failure event. */
  function finishRound(chatId: string, assistantText: string): void {
    const ts = clock().toISOString();
    withTransaction(store.db, () => {
      if (assistantText.length > 0) {
        const message: ChatMessage = {
          id: newMessageId(),
          chatId,
          role: 'assistant',
          text: assistantText,
          createdAt: ts,
        };
        const row = store.chats.appendMessage(message, { origin: 'assistant' });
        const seq = store.events.nextSeq({ chatId });
        persistChatEvent(chatId, 'chat.message', seq, ts, { message: row });
      }
      const idleSeq = store.events.nextSeq({ chatId });
      persistChatEvent(chatId, 'chat.idle', idleSeq, ts);
      // An archive that landed during the round wins: the operator's state is never flipped back.
      const current = store.chats.getSession(chatId);
      if (current !== null && current.status !== 'archived') {
        store.chats.updateSession(chatId, { status: 'idle', updatedAt: ts });
      }
    });
    notifier.notify();
  }

  function queueText(chatId: string, text: string): void {
    const queue = queues.get(chatId);
    if (queue === undefined) {
      queues.set(chatId, [text]);
      return;
    }
    queue.push(text);
  }

  function takeQueued(chatId: string): string | undefined {
    const queue = queues.get(chatId);
    if (queue === undefined) return undefined;
    const text = queue.shift();
    if (queue.length === 0) queues.delete(chatId);
    return text;
  }

  function nextStep(iterator: AsyncIterator<RawAgentEvent>): Promise<Step> {
    return iterator.next().then((step): Step => {
      if (step.done === true) return { kind: 'end' };
      return { kind: 'event', value: step.value };
    });
  }

  async function runRound(
    chatId: string,
    sessionId: string,
    text: string,
    signal: AbortSignal,
  ): Promise<RoundOutcome> {
    const stream: AsyncIterable<RawAgentEvent> = agent().subscribe({ sessionId });
    const iterator = stream[Symbol.asyncIterator]();
    const abort = abortStepOf(signal);
    let assembled = '';
    let promptError: unknown = null;
    const promptSettled = agent()
      .prompt(sessionId, text)
      .then(
        (): 'ok' => 'ok',
        (error: unknown): 'error' => {
          promptError = error;
          return 'error';
        },
      );
    const promptStep = promptSettled.then((settled): Promise<Step> =>
      settled === 'error' ? Promise.resolve({ kind: 'prompt_error' }) : never(),
    );
    try {
      for (;;) {
        const step = await Promise.race([nextStep(iterator), promptStep, abort.step]);
        if (step.kind === 'aborted' || signal.aborted) return 'aborted';
        if (step.kind === 'prompt_error') {
          // The message itself can carry an upstream body, so only the error name is logged.
          logFailure(chatId, promptError);
          finishRound(chatId, '');
          return 'failed';
        }
        if (step.kind === 'end') {
          logger.warn({ msg: 'chat_stream_ended', chatId });
          finishRound(chatId, '');
          return 'failed';
        }
        const raw = step.value;
        switch (raw.type) {
          case 'session.updated': {
            if (raw.status !== 'idle') break;
            finishRound(chatId, assembled);
            return 'idle';
          }
          case 'message.part.text': {
            if (raw.delta.length === 0) break;
            assembled += raw.delta;
            appendDelta(chatId, raw.delta);
            break;
          }
          case 'message.part.tool': {
            appendTool(chatId, raw.tool, raw.status);
            break;
          }
          case 'permission.updated': {
            await decideChatPermission(chatId, sessionId, raw);
            break;
          }
          case 'session.error': {
            logger.warn({ msg: 'chat_session_error', chatId });
            finishRound(chatId, assembled);
            return 'failed';
          }
          case 'session.usage': {
            break;
          }
        }
      }
    } finally {
      abort.dispose();
      // Closing the stream is best effort and must never block the turn.
      void Promise.resolve(iterator.return?.(undefined)).catch(() => undefined);
    }
  }

  async function runTurns(chatId: string, controller: AbortController): Promise<void> {
    for (;;) {
      const text = takeQueued(chatId);
      if (text === undefined) return;
      if (controller.signal.aborted) return;
      const sessionId = agentSessions.get(chatId);
      if (sessionId === undefined) return;
      const session = store.chats.getSession(chatId);
      if (session === null) return;
      if (session.status === 'archived') return;
      // A message that arrived during the previous round was stored as `working`, but that round
      // ended on `chat.idle` and left the row idle: the next prompt puts it back to work.
      if (session.status !== 'working') {
        store.chats.updateSession(chatId, { status: 'working', updatedAt: clock().toISOString() });
      }
      let outcome: RoundOutcome;
      try {
        outcome = await runRound(chatId, sessionId, text, controller.signal);
      } catch (error) {
        logFailure(chatId, error);
        finishRound(chatId, '');
        return;
      }
      if (outcome !== 'idle') return;
    }
  }

  function startTurn(chatId: string): Promise<void> {
    const existing = turns.get(chatId);
    if (existing !== undefined) return existing.promise;
    if (stopped) return Promise.resolve();
    const controller = new AbortController();
    const promise = runTurns(chatId, controller)
      .catch((error: unknown) => {
        logFailure(chatId, error);
      })
      .finally(() => {
        if (turns.get(chatId)?.controller === controller) turns.delete(chatId);
      });
    turns.set(chatId, { controller, promise });
    return promise;
  }

  async function ensureWorktree(
    session: ChatSession,
    ref: RepoRef,
    baseRef: string,
  ): Promise<string> {
    // The chat id occupies the workspace manager's `runId` slot: the branch is
    // `cb/<chatId>-<slug>` and the directory is that branch's worktree.
    const expected = worktreePath(config.CB_WORKSPACE_ROOT, session.id);
    try {
      await workspaces().ensureClone(ref);
      const worktree = await workspaces().createWorktree({
        repo: ref,
        runId: session.id,
        baseRef,
        title: session.title,
      });
      return worktree.path;
    } catch (error) {
      if (error instanceof WorkspaceError && error.code === 'worktree_exists') return expected;
      throwWorkspaceFailure(error);
    }
  }

  /** The routine tool descriptor of a chat, or `null` when the loopback server cannot start. */
  async function routineMcp(
    chatId: string,
    repoId: string | null,
  ): Promise<NonNullable<CreateSessionInput['mcp']> | null> {
    // A free chat has no repository, and the routine tools refuse to start without one.
    if (repoId === null) return null;
    try {
      const mount = await tools().start({ chatId, repoId });
      return {
        codebox: {
          type: 'remote',
          url: mount.url,
          headers: { authorization: `Bearer ${mount.token}` },
        },
      };
    } catch {
      // A chat still works without the tool server; the reason stays out of the message.
      logger.warn({ msg: 'routine_tools_unavailable' });
      return null;
    }
  }

  async function createAgentSession(
    directory: string,
    chatId: string,
    repoId: string | null,
  ): Promise<SessionRef> {
    const mcp = await routineMcp(chatId, repoId);
    try {
      return await agent().createSession({
        directory,
        title: `cb-chat-${chatId}`,
        agent: config.CB_DEFAULT_AGENT,
        model: config.CB_DEFAULT_MODEL,
        ...(mcp === null ? {} : { mcp }),
      });
    } catch (error) {
      throwAgentFailure(error);
    }
  }

  /** The private directory of a free chat: not a worktree, and never stored in `worktree`. */
  async function freeDirectory(chatId: string): Promise<string> {
    const directory = join(config.CB_WORKSPACE_ROOT, FREE_CHAT_DIRECTORY, chatId);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  async function prepare(chatId: string): Promise<ChatSession> {
    const session = requireSession(chatId);
    const liveSession = agentSessions.get(chatId);
    const liveDirectory = worktreeDirectories.get(chatId);
    if (liveSession !== undefined && liveDirectory !== undefined) return session;
    const repo = session.repoId === null ? null : store.repos.get(session.repoId);
    if (session.repoId !== null && repo === null) {
      throw new ChatError('not_found', 404, { path: 'chat.repoId' });
    }
    let current = session;
    let directory = liveDirectory;
    if (directory === undefined) {
      if (repo === null) {
        directory = await freeDirectory(session.id);
      } else {
        const ref: RepoRef = {
          slug: repo.slug,
          defaultBranch: repo.defaultBranch,
          cloneUrl: `https://github.com/${repo.slug}.git`,
        };
        directory = await ensureWorktree(session, ref, repo.defaultBranch);
        current = store.chats.updateSession(session.id, {
          worktree: directory,
          updatedAt: clock().toISOString(),
        });
      }
      worktreeDirectories.set(session.id, directory);
    }
    if (liveSession !== undefined) return current;
    const reference = await createAgentSession(directory, session.id, session.repoId);
    agentSessions.set(session.id, reference.sessionId);
    return store.chats.updateSession(session.id, {
      opencodeSessionId: reference.sessionId,
      status: 'idle',
      updatedAt: clock().toISOString(),
    });
  }

  /** Closes the live OpenCode session and forgets both maps; a refused close is only warned. */
  async function forgetLiveSession(chatId: string): Promise<void> {
    const sessionId = agentSessions.get(chatId);
    agentSessions.delete(chatId);
    worktreeDirectories.delete(chatId);
    if (sessionId === undefined) return;
    try {
      await agent().closeSession(sessionId);
    } catch (error) {
      logger.warn({
        msg: 'chat_session_close_failed',
        chatId,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  async function bind(chatId: string, repoId: string): Promise<ChatSession> {
    const session = requireSession(chatId);
    if (session.status === 'archived') throw archived();
    if ((session.kind ?? 'repo') !== 'free' || session.repoId !== null) {
      throw new ChatError('chat_already_bound', 409, { reason: 'chat_already_bound' });
    }
    const repo = store.repos.get(repoId);
    if (repo === null) throw new ChatError('not_found', 404, { path: 'chat.repoId' });
    await forgetLiveSession(chatId);
    store.chats.updateSession(chatId, {
      repoId,
      kind: 'repo',
      updatedAt: clock().toISOString(),
    });
    try {
      await prepare(chatId);
    } catch (error) {
      agentSessions.delete(chatId);
      worktreeDirectories.delete(chatId);
      store.chats.updateSession(chatId, {
        repoId: null,
        kind: 'free',
        updatedAt: clock().toISOString(),
      });
      logger.warn({
        msg: 'chat_bind_failed',
        chatId,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    }
    appendDivider(chatId, bindDividerText(repo.slug));
    logger.info({ msg: 'chat_bound', chatId, repoId });
    return requireSession(chatId);
  }

  async function compact(chatId: string): Promise<ChatSession> {
    const session = requireSession(chatId);
    if (session.status === 'archived') throw archived();
    await prepare(chatId);
    const directory = worktreeDirectories.get(chatId);
    if (directory === undefined) {
      throw new ChatError('workspace_unavailable', 503, { reason: 'workspace_unavailable' });
    }
    await forgetLiveSession(chatId);
    const reference = await createAgentSession(directory, chatId, session.repoId);
    agentSessions.set(chatId, reference.sessionId);
    const epoch = (store.chats.getSession(chatId)?.contextEpoch ?? 1) + 1;
    const ts = clock().toISOString();
    store.chats.updateSession(chatId, {
      opencodeSessionId: reference.sessionId,
      contextEpoch: epoch,
      updatedAt: ts,
    });
    appendDivider(chatId, COMPACT_DIVIDER);
    withTransaction(store.db, () => {
      const seq = store.events.nextSeq({ chatId });
      persistChatEvent(chatId, 'chat.compacted', seq, ts, { contextEpoch: epoch });
    });
    notifier.notify();
    logger.info({ msg: 'chat_compacted', chatId, contextEpoch: epoch });
    return requireSession(chatId);
  }

  async function writeAndQueue(
    chatId: string,
    text: string,
    origin: 'user' | 'routine',
  ): Promise<ChatMessage> {
    if (text.length > MAX_TEXT_CHARS || text.trim().length === 0) {
      throw new ChatError('invalid_payload', 422, { path: 'chat.message.text' });
    }
    const session = requireSession(chatId);
    if (session.status === 'archived') throw archived();
    if (!agentSessions.has(session.id)) await prepare(session.id);
    const handoff = pendingHandoff(session.id);
    const message = appendMessage(session.id, text, origin);
    queueText(session.id, handoff === null ? text : `${handoff}\n${text}`);
    void startTurn(session.id);
    return message;
  }

  function send(input: SendMessageInput): Promise<ChatMessage> {
    return writeAndQueue(input.chatId, input.text, 'user');
  }

  function sendRoutine(input: SendRoutineInput): Promise<ChatMessage> {
    return writeAndQueue(input.chatId, input.text, 'routine');
  }

  async function interrupt(chatId: string): Promise<ChatSession> {
    const session = requireSession(chatId);
    if (session.status === 'archived') throw archived();
    if (session.status !== 'working') throw notWorking();
    const sessionId = agentSessions.get(chatId);
    if (sessionId !== undefined) {
      try {
        await agent().interrupt(sessionId);
      } catch (error) {
        throwAgentFailure(error);
      }
    }
    turns.get(chatId)?.controller.abort();
    const ts = clock().toISOString();
    const updated = withTransaction(store.db, () => {
      const seq = store.events.nextSeq({ chatId });
      persistChatEvent(chatId, 'chat.idle', seq, ts);
      return store.chats.updateSession(chatId, { status: 'idle', updatedAt: ts });
    });
    notifier.notify();
    return updated;
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    for (const turn of [...turns.values()]) turn.controller.abort();
    turns.clear();
    queues.clear();
    agentSessions.clear();
    worktreeDirectories.clear();
    try {
      const server = tools();
      routineToolServer = null;
      void server.close().catch(() => undefined);
    } catch {
      // A tool server that cannot be built has nothing to close, and shutdown never throws.
      routineToolServer = null;
    }
  }

  const service: ChatService = {
    send,
    sendRoutine,
    pump: (chatId: string): Promise<void> => startTurn(chatId),
    interrupt,
    prepare,
    bind,
    compact,
    stop,
  };
  RUNTIMES.set(service, {
    store,
    clock,
    newChatId: () => newChatId(),
  });
  return service;
}

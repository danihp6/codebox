import type { ChatMessage, ChatSession } from '@codebox/contracts';
import { parseSseEvent } from '@codebox/contracts';
import type { SseEventName } from '@codebox/contracts';
import { matchesGlob } from '@codebox/core';
import { AgentError, createAgentRuntime } from '@codebox/opencode';
import type {
  AgentRuntime,
  CreateSessionInput,
  RawAgentEvent,
  SessionRef,
} from '@codebox/opencode';
import { redact } from '@codebox/security';
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
import { mintApprovalId } from '../run/events.js';
import { ChatError } from './errors.js';
import { newChatId, newMessageId } from './ids.js';
import { createRoutineToolServer } from './tools/index.js';
import type { RoutineToolServer } from './tools/index.js';

export const CHAT_POLL_MS = 500;
export const MAX_TEXT_CHARS = 32_000;

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
  /** One pump step: reads pending approvals and delivers a reply. Public for tests. */
  tick(): Promise<void>;
  /** Interrupts the agent, marks the session idle, appends `chat.idle`. */
  interrupt(chatId: string): Promise<ChatSession>;
  /** Creates the worktree and the OpenCode session for a stored chat row. */
  prepare(chatId: string): Promise<ChatSession>;
  /** Clears timers and stops every pump; idempotent. */
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

type ChatEventName = 'chat.message' | 'chat.delta' | 'chat.tool' | 'chat.permission' | 'chat.idle';

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

interface PermissionLink {
  readonly chatId: string;
  readonly permissionId: string;
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

/** The approval row keeps the tool input, so it is redacted before it is ever stored. */
function redactedInput(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const value = redact(toRecord(input));
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return toRecord(value);
  return {};
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
  const permissionLinks = new Map<string, PermissionLink>();
  // The merged `ChatRepository` exposes the contract `ChatSession` only, which carries neither
  // `opencode_session_id` nor `worktree`; both columns are still written on every prepare, and
  // this map is the live link to the OpenCode session of each chat. After a restart a chat is
  // prepared again in the same worktree, which is the durable half of the binding.
  const agentSessions = new Map<string, string>();
  const worktreeDirectories = new Map<string, string>();
  let ticker: ReturnType<typeof setInterval> | null = null;
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

  function persistGlobalEvent(
    event: SseEventName,
    data: Record<string, unknown>,
    ts: string,
  ): EventRecord {
    const parsed = parseSseEvent({ event, data });
    return store.events.append({
      runId: null,
      chatId: null,
      seq: null,
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

  function recordPermission(chatId: string, raw: PermissionEvent): void {
    const at = clock();
    const ts = at.toISOString();
    const approvalId = mintApprovalId();
    const tool = toolName(raw.tool);
    const title = raw.title.trim().length > 0 ? raw.title : tool;
    const expiresAt = new Date(at.getTime() + config.CB_APPROVAL_TTL_SECONDS * 1_000).toISOString();
    const input = redactedInput(raw.input);
    withTransaction(store.db, () => {
      store.approvals.create({
        id: approvalId,
        state: 'pending',
        tool,
        title,
        runId: null,
        chatId,
        input,
        createdAt: ts,
        expiresAt,
        resolvedAt: null,
      });
      const seq = store.events.nextSeq({ chatId });
      persistChatEvent(chatId, 'chat.permission', seq, ts, { approvalId, tool, title });
      persistGlobalEvent(
        'approval.created',
        { approvalId, runId: null, chatId, tool, title, expiresAt, ts },
        ts,
      );
    });
    permissionLinks.set(approvalId, { chatId, permissionId: raw.permissionId });
    ensureTicker();
    notifier.notify();
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
            recordPermission(chatId, raw);
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

  async function tick(): Promise<void> {
    for (const [approvalId, link] of [...permissionLinks]) {
      const approval = store.approvals.get(approvalId);
      if (approval !== null && approval.state === 'pending') continue;
      permissionLinks.delete(approvalId);
      if (approval === null) continue;
      const sessionId = agentSessions.get(link.chatId);
      if (sessionId === undefined) continue;
      const reply = approval.state === 'allowed' ? 'once' : 'reject';
      try {
        await agent().replyPermission(sessionId, link.permissionId, reply);
        logger.info({ msg: 'chat_permission_replied', chatId: link.chatId, approvalId });
      } catch (error) {
        logger.warn({
          msg: 'chat_permission_reply_failed',
          chatId: link.chatId,
          approvalId,
          reason: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
  }

  function ensureTicker(): void {
    if (ticker !== null || stopped) return;
    const timer = setInterval(() => {
      void tick().catch((error: unknown) => {
        logger.error({
          msg: 'chat_tick_failed',
          reason: error instanceof Error ? error.name : 'unknown',
        });
      });
    }, CHAT_POLL_MS);
    timer.unref();
    ticker = timer;
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
    repoId: string,
  ): Promise<NonNullable<CreateSessionInput['mcp']> | null> {
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

  async function createAgentSession(directory: string, chatId: string): Promise<SessionRef> {
    const session = store.chats.getSession(chatId);
    if (session === null) throw new ChatError('not_found', 404, { path: 'chat.id' });
    const mcp = await routineMcp(chatId, session.repoId);
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

  async function prepare(chatId: string): Promise<ChatSession> {
    const session = requireSession(chatId);
    const liveSession = agentSessions.get(chatId);
    const liveDirectory = worktreeDirectories.get(chatId);
    if (liveSession !== undefined && liveDirectory !== undefined) return session;
    const repo = store.repos.get(session.repoId);
    if (repo === null) throw new ChatError('not_found', 404, { path: 'chat.repoId' });
    let current = session;
    let directory = liveDirectory;
    if (directory === undefined) {
      const ref: RepoRef = {
        slug: repo.slug,
        defaultBranch: repo.defaultBranch,
        cloneUrl: `https://github.com/${repo.slug}.git`,
      };
      directory = await ensureWorktree(session, ref, repo.defaultBranch);
      worktreeDirectories.set(session.id, directory);
      current = store.chats.updateSession(session.id, {
        worktree: directory,
        updatedAt: clock().toISOString(),
      });
    }
    if (liveSession !== undefined) return current;
    const reference = await createAgentSession(directory, session.id);
    agentSessions.set(session.id, reference.sessionId);
    return store.chats.updateSession(session.id, {
      opencodeSessionId: reference.sessionId,
      status: 'idle',
      updatedAt: clock().toISOString(),
    });
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
    const message = appendMessage(session.id, text, origin);
    queueText(session.id, text);
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
    if (ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
    for (const turn of [...turns.values()]) turn.controller.abort();
    turns.clear();
    queues.clear();
    permissionLinks.clear();
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
    tick,
    interrupt,
    prepare,
    stop,
  };
  RUNTIMES.set(service, {
    store,
    clock,
    newChatId: () => newChatId(),
  });
  return service;
}

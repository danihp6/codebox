import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession } from '@codebox/contracts';
import { AgentError } from '@codebox/opencode';
import type {
  CreateSessionInput,
  EventFilter,
  PermissionReply,
  RawAgentEvent,
  SessionRef,
} from '@codebox/opencode';
import { openInMemoryStore } from '@codebox/store';
import type { EventRecord, Store } from '@codebox/store';
import { WorkspaceError } from '@codebox/workspaces';
import type { CreateWorktreeInput, RepoRef, Worktree } from '@codebox/workspaces';
import { loadConfig, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import { createChatService } from './service.js';
import type { ChatAgent, ChatService, ChatWorkspaces } from './service.js';
import { MAX_TEXT_CHARS } from './service.js';
import type { RoutineToolServer } from './tools/index.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const REPO_ID = 'repo_chat0001';
const CHAT_ID = 'chat_seed0001';
const FIRST_SESSION = 'ses_chat1';
const BASE_SHA = 'a'.repeat(40);
const TS = '2026-10-25T10:00:00.000Z';

const stores: Store[] = [];
const directories: string[] = [];
const services: ChatService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

class FakeAgent implements ChatAgent {
  readonly created: CreateSessionInput[] = [];
  readonly prompts: { readonly sessionId: string; readonly text: string }[] = [];
  readonly interrupts: string[] = [];
  readonly replies: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly reply: PermissionReply;
  }[] = [];
  readonly closes: string[] = [];
  failCreate: unknown = null;
  failPrompt: unknown = null;
  failInterrupt: unknown = null;
  private readonly scripts = new Map<string, RawAgentEvent[][]>();
  private readonly queues = new Map<string, RawAgentEvent[]>();
  private readonly waiters = new Map<string, ((value: RawAgentEvent) => void)[]>();
  private counter = 0;

  /** One list per prompt: the first `prompt` consumes the first list, and so on. */
  script(sessionId: string, events: readonly RawAgentEvent[]): void {
    const rounds = this.scripts.get(sessionId) ?? [];
    rounds.push([...events]);
    this.scripts.set(sessionId, rounds);
  }

  createSession(input: CreateSessionInput): Promise<SessionRef> {
    if (this.failCreate !== null) return Promise.reject(this.failCreate);
    this.created.push(input);
    this.counter += 1;
    const sessionId = `ses_chat${this.counter}`;
    return Promise.resolve({ sessionId, directory: input.directory, title: input.title });
  }

  prompt(sessionId: string, text: string): Promise<void> {
    if (this.failPrompt !== null) return Promise.reject(this.failPrompt);
    this.prompts.push({ sessionId, text });
    const rounds = this.scripts.get(sessionId) ?? [];
    for (const event of rounds.shift() ?? []) this.deliver(sessionId, event);
    return Promise.resolve();
  }

  subscribe(filter: EventFilter): AsyncIterable<RawAgentEvent> {
    const sessionId = 'sessionId' in filter ? filter.sessionId : '';
    return {
      [Symbol.asyncIterator]: (): AsyncGenerator<RawAgentEvent> => this.iterator(sessionId),
    };
  }

  interrupt(sessionId: string): Promise<void> {
    if (this.failInterrupt !== null) return Promise.reject(this.failInterrupt);
    this.interrupts.push(sessionId);
    return Promise.resolve();
  }

  replyPermission(sessionId: string, requestId: string, reply: PermissionReply): Promise<void> {
    this.replies.push({ sessionId, requestId, reply });
    return Promise.resolve();
  }

  closeSession(sessionId: string): Promise<void> {
    this.closes.push(sessionId);
    return Promise.resolve();
  }

  private deliver(sessionId: string, event: RawAgentEvent): void {
    const waiting = this.waiters.get(sessionId) ?? [];
    const resolve = waiting.shift();
    if (resolve !== undefined) {
      resolve(event);
      return;
    }
    const queue = this.queues.get(sessionId) ?? [];
    queue.push(event);
    this.queues.set(sessionId, queue);
  }

  private async *iterator(sessionId: string): AsyncGenerator<RawAgentEvent> {
    for (;;) {
      const queued = this.queues.get(sessionId) ?? [];
      const next = queued.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      yield await new Promise<RawAgentEvent>((resolve) => {
        const waiting = this.waiters.get(sessionId) ?? [];
        waiting.push(resolve);
        this.waiters.set(sessionId, waiting);
      });
    }
  }
}

class FakeWorkspaces implements ChatWorkspaces {
  readonly clones: RepoRef[] = [];
  readonly trees: CreateWorktreeInput[] = [];
  failWorktree: unknown = null;
  private readonly existing = new Set<string>();

  async ensureClone(repo: RepoRef): Promise<{ path: string; created: boolean; headSha: string }> {
    this.clones.push(repo);
    return { path: `/tmp/cb-clone/${repo.slug}.git`, created: true, headSha: BASE_SHA };
  }

  async createWorktree(input: CreateWorktreeInput): Promise<Worktree> {
    if (this.failWorktree !== null) throw this.failWorktree;
    if (this.existing.has(input.runId)) {
      throw new WorkspaceError('worktree_exists', 'worktree already exists', null, null);
    }
    this.trees.push(input);
    this.existing.add(input.runId);
    return {
      runId: input.runId,
      repoSlug: input.repo.slug,
      path: `/tmp/cb-worktrees/${input.runId}`,
      branch: `cb/${input.runId}-chat`,
      baseRef: input.baseRef,
      baseSha: BASE_SHA,
    };
  }

  async removeWorktree(): Promise<void> {
    return Promise.resolve();
  }
}

interface Harness {
  readonly service: ChatService;
  readonly store: Store;
  readonly agent: FakeAgent;
  readonly workspaces: FakeWorkspaces;
}

function harness(options: { readonly routineTools?: () => RoutineToolServer } = {}): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-13-chat-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_LOG_LEVEL: 'error',
  });
  const store = openInMemoryStore();
  stores.push(store);
  const logger = createLogger({ level: 'error', sink: () => undefined });
  let tick = 0;
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => new Date(Date.parse(TS) + tick++ * 1000),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: { version: '0.0.0', commit: null, builtAt: null },
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  const agent = new FakeAgent();
  const workspaces = new FakeWorkspaces();
  const service = createChatService({
    context,
    agent,
    workspaces,
    ...(options.routineTools === undefined ? {} : { routineTools: options.routineTools }),
  });
  services.push(service);
  store.repos.create({
    id: REPO_ID,
    slug: 'acme/widgets',
    defaultBranch: 'main',
    gate: 'npm test',
    policy: 'auto',
    protectedPaths: [],
    enabled: true,
    createdAt: TS,
  });
  return { service, store, agent, workspaces };
}

function seedChat(store: Store, id: string = CHAT_ID): ChatSession {
  return store.chats.createSession(
    {
      id,
      repoId: REPO_ID,
      title: 'Repo chat',
      status: 'idle',
      createdAt: TS,
      updatedAt: TS,
      lastMessage: null,
    },
    { opencodeSessionId: null, worktree: null },
  );
}

function chatEvents(store: Store, chatId: string): EventRecord[] {
  return store.events.readAfterId(0, 200).filter((record) => record.chatId === chatId);
}

function eventTypes(store: Store, chatId: string): string[] {
  return chatEvents(store, chatId).map((record) => record.type);
}

describe('chat service', () => {
  it('replays a fixture conversation in order with monotonic seq', async () => {
    const { service, store, agent } = harness();
    const chat = seedChat(store);
    agent.script(FIRST_SESSION, [
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'busy' },
      {
        type: 'message.part.text',
        sessionId: FIRST_SESSION,
        messageId: 'msg_fixture1',
        delta: 'Hel',
      },
      {
        type: 'message.part.text',
        sessionId: FIRST_SESSION,
        messageId: 'msg_fixture1',
        delta: 'lo',
      },
      {
        type: 'message.part.tool',
        sessionId: FIRST_SESSION,
        messageId: 'msg_fixture1',
        tool: 'edit',
        status: 'ok',
      },
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'idle' },
    ]);

    const sent = await service.send({ chatId: chat.id, text: 'read the README' });
    expect(sent.role).toBe('user');
    expect(sent.text).toBe('read the README');
    await service.pump(chat.id);

    const records = chatEvents(store, chat.id);
    expect(records.map((record) => record.type)).toEqual([
      'chat.message',
      'chat.delta',
      'chat.delta',
      'chat.tool',
      'chat.message',
      'chat.idle',
    ]);
    const seqs = records.map((record) => record.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
    for (let index = 1; index < seqs.length; index += 1) {
      expect(seqs[index]).toBeGreaterThan(seqs[index - 1] ?? 0);
    }

    const user = records[0]?.data['message'] as ChatMessage;
    expect(user.role).toBe('user');
    expect(user.text).toBe('read the README');
    const deltas = records
      .filter((record) => record.type === 'chat.delta')
      .map((record) => record.data['delta']);
    expect(deltas).toEqual(['Hel', 'lo']);
    const tool = records[3]?.data;
    expect(tool?.['tool']).toBe('edit');
    expect(tool?.['status']).toBe('ok');
    const assistant = records[4]?.data['message'] as ChatMessage;
    expect(assistant.role).toBe('assistant');
    expect(assistant.text).toBe('Hello');

    const session = store.chats.getSession(chat.id);
    expect(session?.status).toBe('idle');
    const transcript = store.chats.listMessages(chat.id, { limit: 10, cursor: null });
    expect(transcript.data.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(transcript.data.map((message) => message.text)).toEqual(['read the README', 'Hello']);
  });

  it('accepts a second message and prompts it after the first round', async () => {
    const { service, store, agent } = harness();
    const chat = seedChat(store);
    agent.script(FIRST_SESSION, [
      {
        type: 'message.part.text',
        sessionId: FIRST_SESSION,
        messageId: 'msg_round1',
        delta: 'one',
      },
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'idle' },
    ]);
    agent.script(FIRST_SESSION, [
      {
        type: 'message.part.text',
        sessionId: FIRST_SESSION,
        messageId: 'msg_round2',
        delta: 'two',
      },
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'idle' },
    ]);

    await service.send({ chatId: chat.id, text: 'first' });
    await service.send({ chatId: chat.id, text: 'second' });
    await service.pump(chat.id);

    expect(agent.prompts.map((prompt) => prompt.text)).toEqual(['first', 'second']);
    expect(store.chats.getSession(chat.id)?.status).toBe('idle');
    const records = chatEvents(store, chat.id);
    // The second message is appended the moment it arrives, even while the first round streams:
    // per-message order holds, the two rounds do not run back to back.
    expect(records.map((record) => record.type)).toEqual([
      'chat.message',
      'chat.message',
      'chat.delta',
      'chat.message',
      'chat.idle',
      'chat.delta',
      'chat.message',
      'chat.idle',
    ]);
    const seqs = records.map((record) => record.seq ?? 0);
    for (let index = 1; index < seqs.length; index += 1) {
      expect(seqs[index]).toBeGreaterThan(seqs[index - 1] ?? 0);
    }
    const transcript = store.chats.listMessages(chat.id, { limit: 10, cursor: null });
    expect(transcript.data.map((message) => message.text)).toEqual([
      'first',
      'second',
      'one',
      'two',
    ]);
  });

  it('prepares the worktree and the agent session once per chat', async () => {
    const { service, store, agent, workspaces } = harness();
    const chat = seedChat(store);

    const prepared = await service.prepare(chat.id);
    expect(prepared.status).toBe('idle');
    expect(workspaces.clones[0]).toMatchObject({
      slug: 'acme/widgets',
      defaultBranch: 'main',
      cloneUrl: 'https://github.com/acme/widgets.git',
    });
    expect(workspaces.trees[0]).toMatchObject({
      runId: chat.id,
      baseRef: 'main',
      title: 'Repo chat',
    });
    expect(agent.created).toHaveLength(1);
    expect(agent.created[0]?.title).toBe(`cb-chat-${chat.id}`);

    await service.prepare(chat.id);
    expect(workspaces.trees).toHaveLength(1);
    expect(agent.created).toHaveLength(1);
  });

  it('keeps the row idle and reports agent_unavailable when the agent is unreachable', async () => {
    const { service, store, agent } = harness();
    const chat = seedChat(store);
    agent.failCreate = new AgentError('agent_unavailable', 'down', null, true);

    await expect(service.send({ chatId: chat.id, text: 'hello' })).rejects.toMatchObject({
      name: 'ChatError',
      reason: 'agent_unavailable',
      status: 502,
    });
    const session = store.chats.getSession(chat.id);
    expect(session?.status).toBe('idle');
    expect(chatEvents(store, chat.id)).toHaveLength(0);

    const row = store.db
      .prepare('SELECT worktree, opencode_session_id FROM chat_sessions WHERE id = ?')
      .get(chat.id);
    expect(row?.['worktree']).toBe(`/tmp/cb-worktrees/${chat.id}`);
    expect(row?.['opencode_session_id']).toBeNull();
  });

  it('reports workspace_unavailable when the worktree cannot be created', async () => {
    const { service, store, workspaces } = harness();
    const chat = seedChat(store);
    workspaces.failWorktree = new WorkspaceError('worktree_failed', 'worktree failed', null, 1);

    await expect(service.prepare(chat.id)).rejects.toMatchObject({
      reason: 'workspace_unavailable',
      status: 503,
    });
  });

  it('interrupt stops the turn and marks the session idle', async () => {
    const { service, store, agent } = harness();
    const chat = seedChat(store);
    agent.script(FIRST_SESSION, [
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'busy' },
    ]);

    await service.send({ chatId: chat.id, text: 'start something long' });
    expect(store.chats.getSession(chat.id)?.status).toBe('working');

    const session = await service.interrupt(chat.id);
    expect(session.status).toBe('idle');
    expect(agent.interrupts).toEqual([FIRST_SESSION]);
    await service.pump(chat.id);
    expect(store.chats.getSession(chat.id)?.status).toBe('idle');
    expect(eventTypes(store, chat.id).at(-1)).toBe('chat.idle');
  });

  it('refuses an interrupt when the session is not working', async () => {
    const { service, store } = harness();
    const chat = seedChat(store);
    await expect(service.interrupt(chat.id)).rejects.toMatchObject({
      reason: 'chat_not_working',
      status: 409,
    });
    await expect(service.interrupt('chat_missing01')).rejects.toMatchObject({
      reason: 'not_found',
      status: 404,
    });
  });

  it('exposes no approval tick on the service surface', () => {
    const { service } = harness();

    expect((service as unknown as Record<string, unknown>)['tick']).toBeUndefined();
  });

  it('answers a chat permission inline and writes no approval row', async () => {
    const { service, store, agent } = harness();
    const chat = seedChat(store);
    agent.script(FIRST_SESSION, [
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'busy' },
      {
        type: 'permission.updated',
        sessionId: FIRST_SESSION,
        permissionId: 'per_2',
        tool: 'bash',
        title: 'Run the tests',
        input: { command: 'npm test' },
      },
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'idle' },
    ]);

    await service.send({ chatId: chat.id, text: 'run the tests' });
    await service.pump(chat.id);

    expect(store.approvals.listPending(10)).toEqual([]);
    const stored = store.events.readAfterId(0, 200);
    expect(stored.filter((record) => record.type === 'approval.created')).toEqual([]);
    expect(stored.filter((record) => record.type === 'chat.permission')).toEqual([]);
    expect(eventTypes(store, chat.id)).toEqual(['chat.message', 'chat.idle']);
    expect(agent.replies).toEqual([
      { sessionId: FIRST_SESSION, requestId: 'per_2', reply: 'reject' },
    ]);
  });

  it('allows a chat read inside the worktree and writes no approval row', async () => {
    const { service, store, agent } = harness();
    const chat = seedChat(store);
    agent.script(FIRST_SESSION, [
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'busy' },
      {
        type: 'permission.updated',
        sessionId: FIRST_SESSION,
        permissionId: 'per_3',
        tool: 'read',
        title: 'Read the README',
        input: { filePath: '/tmp/cb-worktrees/chat_seed0001/README.md' },
      },
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'idle' },
    ]);

    await service.send({ chatId: chat.id, text: 'read the README' });
    await service.pump(chat.id);

    expect(agent.replies).toEqual([
      { sessionId: FIRST_SESSION, requestId: 'per_3', reply: 'once' },
    ]);
    expect(store.approvals.listPending(10)).toEqual([]);
  });

  it('refuses a chat read outside the worktree and writes no approval row', async () => {
    const { service, store, agent } = harness();
    const chat = seedChat(store);
    agent.script(FIRST_SESSION, [
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'busy' },
      {
        type: 'permission.updated',
        sessionId: FIRST_SESSION,
        permissionId: 'per_4',
        tool: 'read',
        title: 'Read the passwd file',
        input: { filePath: '/etc/passwd' },
      },
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'idle' },
    ]);

    await service.send({ chatId: chat.id, text: 'read the passwd file' });
    await service.pump(chat.id);

    expect(agent.replies).toEqual([
      { sessionId: FIRST_SESSION, requestId: 'per_4', reply: 'reject' },
    ]);
    expect(store.approvals.listPending(10)).toEqual([]);
  });

  it('refuses a chat webfetch and writes no approval row', async () => {
    const { service, store, agent } = harness();
    const chat = seedChat(store);
    agent.script(FIRST_SESSION, [
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'busy' },
      {
        type: 'permission.updated',
        sessionId: FIRST_SESSION,
        permissionId: 'per_5',
        tool: 'webfetch',
        title: 'Fetch a page',
        input: { url: 'https://example.com' },
      },
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'idle' },
    ]);

    await service.send({ chatId: chat.id, text: 'fetch the page' });
    await service.pump(chat.id);

    expect(agent.replies).toEqual([
      { sessionId: FIRST_SESSION, requestId: 'per_5', reply: 'reject' },
    ]);
    expect(store.approvals.listPending(10)).toEqual([]);
  });
});

describe('chat routine tools', () => {
  it('mounts the tool server in the chat session and creates a routine through it', async () => {
    const { service, store, agent } = harness();
    const chat = seedChat(store);
    await service.prepare(chat.id);

    const created = agent.created[0];
    if (created === undefined) throw new Error('the agent session was not created');
    const descriptor = created.mcp?.['codebox'];
    if (descriptor === undefined) throw new Error('the session carried no routine tool server');
    expect(descriptor.type).toBe('remote');
    expect(descriptor.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const authorization = descriptor.headers['authorization'];
    if (authorization === undefined) throw new Error('the mount carried no bearer token');
    expect(authorization.startsWith('Bearer ')).toBe(true);

    const response = await fetch(descriptor.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'routine.create',
          arguments: {
            kind: 'prompt',
            title: 'Morning summary',
            cron: '0 7 * * *',
            timezone: 'UTC',
            prompt: 'Summarise the repository.',
          },
        },
      }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      result?: { isError?: boolean; structuredContent?: { routine?: { id?: string } } };
    };
    expect(payload.result?.isError).toBe(false);
    const routineId = payload.result?.structuredContent?.routine?.id;
    if (routineId === undefined) throw new Error('the tool returned no routine');
    const stored = store.routines.get(routineId);
    if (stored === null || stored.kind !== 'prompt') throw new Error('the routine is missing');
    expect(stored.repoId).toBe(REPO_ID);
    expect(stored.chatSessionId).toBe(chat.id);
  });

  it('closes the routine tool server once on stop', () => {
    let closes = 0;
    const fake: RoutineToolServer = {
      start: () => Promise.resolve({ url: 'http://127.0.0.1:1/mcp', token: 'fixture-token' }),
      release: () => undefined,
      close: () => {
        closes += 1;
        return Promise.resolve();
      },
    };
    const { service } = harness({ routineTools: () => fake });
    service.stop();
    service.stop();
    expect(closes).toBe(1);
  });

  it('creates the chat session without mcp when the tool server cannot start', async () => {
    const failing: RoutineToolServer = {
      start: () => Promise.reject(new Error('the listener did not bind')),
      release: () => undefined,
      close: () => Promise.resolve(),
    };
    const { service, store, agent } = harness({ routineTools: () => failing });
    const chat = seedChat(store);
    await service.prepare(chat.id);
    expect(agent.created[0]?.mcp).toBeUndefined();
  });
});

describe('chat message origin', () => {
  function originOf(store: Store, messageId: string): unknown {
    return store.db.prepare('SELECT origin FROM chat_messages WHERE id = ?').get(messageId)?.[
      'origin'
    ];
  }

  it('stores send as a user message and sendRoutine as a routine message', async () => {
    const { service, store, agent } = harness();
    const chat = seedChat(store);
    agent.script(FIRST_SESSION, [
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'idle' },
    ]);
    agent.script(FIRST_SESSION, [
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'idle' },
    ]);

    const user = await service.send({ chatId: chat.id, text: 'hello' });
    const routine = await service.sendRoutine({ chatId: chat.id, text: 'summarise the repo' });
    await service.pump(chat.id);

    expect(user.role).toBe('user');
    expect(routine.role).toBe('user');
    expect(originOf(store, user.id)).toBe('user');
    expect(originOf(store, routine.id)).toBe('routine');
  });

  it('refuses an empty or over-long routine text with the same error as send', async () => {
    const { service, store } = harness();
    const chat = seedChat(store);

    await expect(service.sendRoutine({ chatId: chat.id, text: '   ' })).rejects.toMatchObject({
      name: 'ChatError',
      reason: 'invalid_payload',
      status: 422,
    });
    await expect(
      service.sendRoutine({ chatId: chat.id, text: 'x'.repeat(MAX_TEXT_CHARS + 1) }),
    ).rejects.toMatchObject({
      name: 'ChatError',
      reason: 'invalid_payload',
      status: 422,
    });
    await expect(service.send({ chatId: 'chat_missing01', text: 'hello' })).rejects.toMatchObject({
      reason: 'not_found',
      status: 404,
    });
    await expect(
      service.sendRoutine({ chatId: 'chat_missing01', text: 'hello' }),
    ).rejects.toMatchObject({ reason: 'not_found', status: 404 });
  });
});

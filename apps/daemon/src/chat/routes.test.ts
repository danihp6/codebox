import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseChatMessage,
  parseChatSession,
  parseErrorEnvelope,
  parseRun,
  pageOfChatMessage,
  pageOfChatSession,
} from '@codebox/contracts';
import type { ChatSession, Scope } from '@codebox/contracts';
import { AgentError } from '@codebox/opencode';
import type { CreateSessionInput, EventFilter, RawAgentEvent, SessionRef } from '@codebox/opencode';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import type { CreateWorktreeInput, RepoRef, Worktree } from '@codebox/workspaces';
import { createApp } from '../app.js';
import { createModule as createAuthModule } from '../auth/index.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import type { RunEngine, RunOutcome } from '../run/ports.js';
import { registerRunsRoutes } from '../runs/routes.js';
import { createRunsService } from '../runs/service.js';
import type { RunsService } from '../runs/service.js';
import { registerChatRoutes } from './routes.js';
import { createChatService } from './service.js';
import type { ChatAgent, ChatWorkspaces } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const REPO_ID = 'repo_chat0001';
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const FIRST_SESSION = 'ses_chat1';
const TS = '2026-10-25T10:00:00.000Z';
const PROMPT_TEXT = 'summarise the open pull requests';

const stores: Store[] = [];
const directories: string[] = [];
const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

class FakeAgent implements ChatAgent {
  readonly created: CreateSessionInput[] = [];
  readonly prompts: { readonly sessionId: string; readonly text: string }[] = [];
  readonly interrupts: string[] = [];
  readonly closes: string[] = [];
  failCreate: unknown = null;
  private readonly scripts = new Map<string, RawAgentEvent[]>();
  private readonly queues = new Map<string, RawAgentEvent[]>();
  private readonly waiters = new Map<string, ((value: RawAgentEvent) => void)[]>();
  private counter = 0;

  script(sessionId: string, events: readonly RawAgentEvent[]): void {
    this.scripts.set(sessionId, [...events]);
  }

  createSession(input: CreateSessionInput): Promise<SessionRef> {
    if (this.failCreate !== null) return Promise.reject(this.failCreate);
    this.created.push(input);
    this.counter += 1;
    const sessionId = `ses_chat${this.counter}`;
    return Promise.resolve({ sessionId, directory: input.directory, title: input.title });
  }

  prompt(sessionId: string, text: string): Promise<void> {
    this.prompts.push({ sessionId, text });
    for (const event of this.scripts.get(sessionId) ?? []) this.deliver(sessionId, event);
    this.scripts.delete(sessionId);
    return Promise.resolve();
  }

  subscribe(filter: EventFilter): AsyncIterable<RawAgentEvent> {
    const sessionId = 'sessionId' in filter ? filter.sessionId : '';
    return {
      [Symbol.asyncIterator]: (): AsyncGenerator<RawAgentEvent> => this.iterator(sessionId),
    };
  }

  interrupt(sessionId: string): Promise<void> {
    this.interrupts.push(sessionId);
    return Promise.resolve();
  }

  replyPermission(): Promise<void> {
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
  readonly trees: CreateWorktreeInput[] = [];
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async ensureClone(repo: RepoRef): Promise<{ path: string; created: boolean; headSha: string }> {
    return { path: `/tmp/cb-clone/${repo.slug}.git`, created: true, headSha: 'a'.repeat(40) };
  }

  async createWorktree(input: CreateWorktreeInput): Promise<Worktree> {
    this.trees.push(input);
    return {
      runId: input.runId,
      repoSlug: input.repo.slug,
      path: join(this.root, input.runId),
      branch: `cb/${input.runId}-chat`,
      baseRef: input.baseRef,
      baseSha: 'a'.repeat(40),
    };
  }

  async removeWorktree(): Promise<void> {
    return Promise.resolve();
  }
}

interface Harness {
  readonly app: DaemonApp;
  readonly store: Store;
  readonly agent: FakeAgent;
  readonly workspaces: FakeWorkspaces;
  readonly lines: string[];
  readonly workspaceRoot: string;
}

function fakeRunEngine(): RunEngine {
  return {
    start(): Promise<RunOutcome> {
      // A live run: the route answers while the flow is still in flight.
      return new Promise<RunOutcome>(() => undefined);
    },
    cancel(): Promise<boolean> {
      return Promise.resolve(true);
    },
    active(): readonly string[] {
      return [];
    },
  };
}

function harness(options: { readonly promote?: boolean } = {}): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-13-chat-routes-'));
  directories.push(directory);
  const appDir = join(directory, 'app');
  mkdirSync(appDir, { recursive: true });
  const workspaceRoot = join(directory, 'worktrees');
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: workspaceRoot,
    CB_LOG_LEVEL: 'info',
  });
  const store = openInMemoryStore();
  stores.push(store);
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
  const lines: string[] = [];
  const logger = createLogger({ level: 'info', sink: (line) => lines.push(line) });
  let tick = 0;
  const clock = (): Date => new Date(Date.parse(TS) + tick++ * 1000);
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock,
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir,
    shutdown: createShutdownRegistry(logger),
  };
  const agent = new FakeAgent();
  const workspaces = new FakeWorkspaces(config.CB_WORKSPACE_ROOT);
  const service = createChatService({ context, agent, workspaces });
  stops.push(() => service.stop());
  const app = createApp({ context });
  createAuthModule(context).register(app, context);
  registerChatRoutes(app, service);
  if (options.promote === true) {
    const runs: RunsService = createRunsService({
      context,
      engine: fakeRunEngine(),
      now: clock,
    });
    stops.push(() => runs.stop());
    registerRunsRoutes(app, runs);
  }
  return { app, store, agent, workspaces, lines, workspaceRoot: config.CB_WORKSPACE_ROOT };
}

function jsonInit(body: unknown, token?: string, method = 'POST'): RequestInit {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;
  return { method, headers, body: JSON.stringify(body) };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
  return parsed as Record<string, unknown>;
}

async function paired(app: DaemonApp, scopes?: readonly Scope[]): Promise<string> {
  const issued = await app.request(
    '/v1/pair/code',
    jsonInit(scopes === undefined ? { name: 'Dani iPhone' } : { name: 'Dani iPhone', scopes }),
    LOOPBACK,
  );
  expect(issued.status).toBe(201);
  const code = (await bodyOf(issued))['code'];
  const exchanged = await app.request(
    '/v1/pair',
    jsonInit({
      code,
      deviceName: 'Dani iPhone',
      platform: 'ios',
      devicePublicKey: 'ed25519:test-public-key',
    }),
    LOOPBACK,
  );
  expect(exchanged.status).toBe(200);
  return String((await bodyOf(exchanged))['accessToken']);
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function createSession(app: DaemonApp, token: string): Promise<ChatSession> {
  const response = await app.request('/v1/chat/sessions', jsonInit({ repoId: REPO_ID }, token));
  expect(response.status).toBe(201);
  const body = await bodyOf(response);
  return parseChatSession(body);
}

describe('chat routes', () => {
  it('creates a session, lists it and serves it by id', async () => {
    const { app, agent } = harness();
    const token = await paired(app);

    const created = await createSession(app, token);
    expect(created.repoId).toBe(REPO_ID);
    expect(created.title).toBe('New chat');
    expect(created.status).toBe('idle');
    expect(created.lastMessage).toBeNull();
    expect(agent.created).toHaveLength(1);

    const listed = await app.request(`/v1/chat/sessions?repoId=${REPO_ID}`, {
      headers: auth(token),
    });
    expect(listed.status).toBe(200);
    const page = pageOfChatSession.parse(await bodyOf(listed));
    expect(page.data.map((session) => session.id)).toEqual([created.id]);
    expect(page.nextCursor).toBeNull();

    const one = await app.request(`/v1/chat/sessions/${created.id}`, { headers: auth(token) });
    expect(one.status).toBe(200);
    expect(parseChatSession(await bodyOf(one)).id).toBe(created.id);
  });

  it('posts a message, lists the transcript and archives the session', async () => {
    const { app, store, agent } = harness();
    const token = await paired(app);
    const created = await createSession(app, token);
    agent.script(FIRST_SESSION, [
      { type: 'message.part.text', sessionId: FIRST_SESSION, messageId: 'msg_route1', delta: 'hi' },
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'idle' },
    ]);

    const posted = await app.request(
      `/v1/chat/sessions/${created.id}/messages`,
      jsonInit({ text: PROMPT_TEXT }, token),
    );
    expect(posted.status).toBe(202);
    const message = parseChatMessage(await bodyOf(posted));
    expect(message.role).toBe('user');
    expect(message.text).toBe(PROMPT_TEXT);
    expect(message.chatId).toBe(created.id);

    await waitFor(
      () => store.chats.listMessages(created.id, { limit: 10, cursor: null }).data.length === 2,
      'the assistant message',
    );
    expect(agent.prompts).toEqual([{ sessionId: FIRST_SESSION, text: PROMPT_TEXT }]);

    const listed = await app.request(`/v1/chat/sessions/${created.id}/messages?limit=1`, {
      headers: auth(token),
    });
    expect(listed.status).toBe(200);
    const page = pageOfChatMessage.parse(await bodyOf(listed));
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.role).toBe('user');
    expect(typeof page.nextCursor).toBe('string');

    const next = await app.request(
      `/v1/chat/sessions/${created.id}/messages?cursor=${String(page.nextCursor)}`,
      { headers: auth(token) },
    );
    expect(next.status).toBe(200);
    const second = pageOfChatMessage.parse(await bodyOf(next));
    expect(second.data).toHaveLength(1);
    expect(second.data[0]).toMatchObject({ role: 'assistant', text: 'hi' });
    expect(second.nextCursor).toBeNull();

    const archived = await app.request(`/v1/chat/sessions/${created.id}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(archived.status).toBe(200);
    expect(parseChatSession(await bodyOf(archived)).status).toBe('archived');

    const afterArchive = await app.request(
      `/v1/chat/sessions/${created.id}/messages`,
      jsonInit({ text: 'still there?' }, token),
    );
    expect(afterArchive.status).toBe(409);
    const conflict = parseErrorEnvelope(await bodyOf(afterArchive));
    expect(conflict.error.code).toBe('conflict');
    expect(conflict.error.details?.['reason']).toBe('chat_archived');

    const interrupted = await app.request(`/v1/chat/sessions/${created.id}/interrupt`, {
      method: 'POST',
      headers: auth(token),
    });
    expect(interrupted.status).toBe(409);
    expect(parseErrorEnvelope(await bodyOf(interrupted)).error.details?.['reason']).toBe(
      'chat_archived',
    );
  });

  it('answers 404 with the chat.id path on every session route', async () => {
    const { app } = harness();
    const token = await paired(app);
    const missing = 'chat_missing01';

    const responses = [
      await app.request(`/v1/chat/sessions/${missing}`, { headers: auth(token) }),
      await app.request(`/v1/chat/sessions/${missing}/messages`, { headers: auth(token) }),
      await app.request(
        `/v1/chat/sessions/${missing}/messages`,
        jsonInit({ text: 'hello' }, token),
      ),
      await app.request(`/v1/chat/sessions/${missing}/interrupt`, {
        method: 'POST',
        headers: auth(token),
      }),
      await app.request(`/v1/chat/sessions/${missing}`, {
        method: 'DELETE',
        headers: auth(token),
      }),
    ];
    for (const response of responses) {
      expect(response.status).toBe(404);
      const envelope = parseErrorEnvelope(await bodyOf(response));
      expect(envelope.error.code).toBe('not_found');
      expect(envelope.error.details?.['path']).toBe('chat.id');
    }
  });

  it('answers 404 with the chat.repoId path for an unknown repository', async () => {
    const { app } = harness();
    const token = await paired(app);
    const response = await app.request(
      '/v1/chat/sessions',
      jsonInit({ repoId: 'repo_missing01' }, token),
    );
    expect(response.status).toBe(404);
    const envelope = parseErrorEnvelope(await bodyOf(response));
    expect(envelope.error.code).toBe('not_found');
    expect(envelope.error.details?.['path']).toBe('chat.repoId');
  });

  it('refuses an interrupt when the session is not working', async () => {
    const { app } = harness();
    const token = await paired(app);
    const created = await createSession(app, token);
    const response = await app.request(`/v1/chat/sessions/${created.id}/interrupt`, {
      method: 'POST',
      headers: auth(token),
    });
    expect(response.status).toBe(409);
    expect(parseErrorEnvelope(await bodyOf(response)).error.details?.['reason']).toBe(
      'chat_not_working',
    );
  });

  it('requires the chat scope on the four mutating routes', async () => {
    const { app } = harness();
    const reader = await paired(app, ['read']);
    const archivist = await paired(app);
    const created = await createSession(app, archivist);

    const mutations = [
      await app.request('/v1/chat/sessions', jsonInit({ repoId: REPO_ID }, reader)),
      await app.request(`/v1/chat/sessions/${created.id}`, {
        method: 'DELETE',
        headers: auth(reader),
      }),
      await app.request(
        `/v1/chat/sessions/${created.id}/messages`,
        jsonInit({ text: 'hello' }, reader),
      ),
      await app.request(`/v1/chat/sessions/${created.id}/interrupt`, {
        method: 'POST',
        headers: auth(reader),
      }),
    ];
    for (const response of mutations) {
      expect(response.status).toBe(403);
      const envelope = parseErrorEnvelope(await bodyOf(response));
      expect(envelope.error.code).toBe('forbidden');
      expect(envelope.error.details?.['reason']).toBe('insufficient_scope');
    }

    const read = await app.request(`/v1/chat/sessions/${created.id}`, { headers: auth(reader) });
    expect(read.status).toBe(200);
  });

  it('rejects an unknown field, an empty message and a bad cursor', async () => {
    const { app } = harness();
    const token = await paired(app);
    const created = await createSession(app, token);

    const unknownField = await app.request(
      '/v1/chat/sessions',
      jsonInit({ repoId: REPO_ID, extra: 1 }, token),
    );
    expect(unknownField.status).toBe(422);
    expect(parseErrorEnvelope(await bodyOf(unknownField)).error.details?.['path']).toBe(
      'chat.session.extra',
    );

    const empty = await app.request(
      `/v1/chat/sessions/${created.id}/messages`,
      jsonInit({ text: '   ' }, token),
    );
    expect(empty.status).toBe(422);
    expect(parseErrorEnvelope(await bodyOf(empty)).error.details?.['path']).toBe(
      'chat.message.text',
    );

    const badCursor = await app.request(
      `/v1/chat/sessions/${created.id}/messages?cursor=%40%40%40`,
      { headers: auth(token) },
    );
    expect(badCursor.status).toBe(422);
    expect(parseErrorEnvelope(await bodyOf(badCursor)).error.details?.['path']).toBe('chat.cursor');

    const badLimit = await app.request('/v1/chat/sessions?limit=0', { headers: auth(token) });
    expect(badLimit.status).toBe(422);
    expect(parseErrorEnvelope(await bodyOf(badLimit)).error.details?.['path']).toBe(
      'chat.sessions.limit',
    );
  });

  it('keeps the created row when the agent is unreachable', async () => {
    const { app, agent } = harness();
    const token = await paired(app);
    agent.failCreate = new AgentError('agent_unavailable', 'down', null, true);

    const response = await app.request('/v1/chat/sessions', jsonInit({ repoId: REPO_ID }, token));
    expect(response.status).toBe(502);
    expect(parseErrorEnvelope(await bodyOf(response)).error.code).toBe('agent_unavailable');

    const listed = await app.request('/v1/chat/sessions', { headers: auth(token) });
    const page = pageOfChatSession.parse(await bodyOf(listed));
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.status).toBe('idle');
  });

  it('never logs the prompt or the bearer token', async () => {
    const { app, lines, agent } = harness();
    const token = await paired(app);
    const created = await createSession(app, token);
    agent.script(FIRST_SESSION, [
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'idle' },
    ]);
    lines.length = 0;

    const response = await app.request(
      `/v1/chat/sessions/${created.id}/messages`,
      jsonInit({ text: PROMPT_TEXT }, token),
    );
    expect(response.status).toBe(202);
    await waitFor(() => agent.prompts.length === 1, 'the prompt');
    expect(lines.length).toBeGreaterThan(0);
    const log = lines.join('\n');
    expect(log).not.toContain(PROMPT_TEXT);
    expect(log).not.toContain(token);
    expect(log).not.toContain('authorization');
    expect(log).toContain('POST');
  });
});

describe('chat lifecycle', () => {
  async function createFree(
    app: DaemonApp,
    token: string,
    body: unknown = {},
  ): Promise<ChatSession> {
    const response = await app.request('/v1/chat/sessions', jsonInit(body, token));
    expect(response.status).toBe(201);
    const session = parseChatSession(await bodyOf(response));
    expect(session.kind).toBe('free');
    expect(session.repoId).toBeNull();
    return session;
  }

  function rowOf(store: Store, chatId: string): Record<string, unknown> {
    return (
      store.db
        .prepare(
          'SELECT repo_id, kind, worktree, context_epoch, reviewed_at FROM chat_sessions WHERE id = ?',
        )
        .get(chatId) ?? {}
    );
  }

  function compactEvents(store: Store, chatId: string) {
    return store.events
      .readAfterId(0, 200)
      .filter((record) => record.chatId === chatId && record.type === 'chat.compacted');
  }

  async function post(
    app: DaemonApp,
    path: string,
    token: string,
    body?: unknown,
  ): Promise<Response> {
    return app.request(
      path,
      body === undefined ? { method: 'POST', headers: auth(token) } : jsonInit(body, token),
    );
  }

  it('creates a free chat with no worktree and no agent session', async () => {
    const { app, agent } = harness();
    const token = await paired(app);

    const free = await createFree(app, token);
    expect(free.title).toBe('New chat');
    expect(free.status).toBe('idle');
    expect(free.contextEpoch).toBe(1);
    expect(free.reviewedAt ?? null).toBeNull();
    expect(agent.created).toHaveLength(0);

    const titled = await createFree(app, token, { title: 'Scratch' });
    expect(titled.title).toBe('Scratch');
    expect(agent.created).toHaveLength(0);

    const listed = await app.request('/v1/chat/sessions', { headers: auth(token) });
    const page = pageOfChatSession.parse(await bodyOf(listed));
    expect(page.data.map((session) => session.repoId)).toEqual([null, null]);
  });

  it('runs the first message of a free chat in its own directory', async () => {
    const { app, store, agent, workspaceRoot } = harness();
    const token = await paired(app);
    const free = await createFree(app, token);
    agent.script(FIRST_SESSION, [
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'idle' },
    ]);

    const posted = await post(app, `/v1/chat/sessions/${free.id}/messages`, token, {
      text: 'hello',
    });
    expect(posted.status).toBe(202);
    await waitFor(() => agent.created.length === 1, 'the free agent session');

    const directory = join(workspaceRoot, '.chat', free.id);
    expect(agent.created[0]?.directory).toBe(directory);
    expect(agent.created[0]?.mcp).toBeUndefined();
    expect(existsSync(directory)).toBe(true);
    await waitFor(() => store.chats.getSession(free.id)?.status === 'idle', 'the idle round');
    expect(rowOf(store, free.id)).toMatchObject({ repo_id: null, kind: 'free', worktree: null });
  });

  it('binds a free chat to a repository and cuts the worktree', async () => {
    const { app, store, agent, workspaces, workspaceRoot } = harness();
    const token = await paired(app);
    const free = await createFree(app, token);

    const bound = await post(app, `/v1/chat/sessions/${free.id}/repo`, token, { repoId: REPO_ID });
    expect(bound.status).toBe(200);
    const session = parseChatSession(await bodyOf(bound));
    expect(session.repoId).toBe(REPO_ID);
    expect(session.kind).toBe('repo');
    expect(session.lastMessage?.role).toBe('system');
    expect(session.lastMessage?.text).toBe(
      'Connected repository acme/widgets. The recent turns were re-injected into a new session.',
    );

    expect(agent.created).toHaveLength(1);
    expect(agent.created[0]?.directory).toBe(join(workspaceRoot, free.id));
    expect(agent.prompts).toHaveLength(0);
    expect(workspaces.trees).toHaveLength(1);
    expect(rowOf(store, free.id)).toMatchObject({
      repo_id: REPO_ID,
      kind: 'repo',
      worktree: join(workspaceRoot, free.id),
    });

    const again = await post(app, `/v1/chat/sessions/${free.id}/repo`, token, { repoId: REPO_ID });
    expect(again.status).toBe(409);
    expect(parseErrorEnvelope(await bodyOf(again)).error.details?.['reason']).toBe(
      'chat_already_bound',
    );
    expect(agent.created).toHaveLength(1);
    expect(workspaces.trees).toHaveLength(1);
  });

  it('closes the free session and hands the last turns to the bound one', async () => {
    const { app, store, agent } = harness();
    const token = await paired(app);
    const free = await createFree(app, token);
    agent.script(FIRST_SESSION, [
      { type: 'session.updated', sessionId: FIRST_SESSION, status: 'idle' },
    ]);
    await post(app, `/v1/chat/sessions/${free.id}/messages`, token, { text: 'the answer is 42' });
    await waitFor(() => agent.created.length === 1, 'the free agent session');
    await waitFor(() => store.chats.getSession(free.id)?.status === 'idle', 'the free round');

    const bound = await post(app, `/v1/chat/sessions/${free.id}/repo`, token, { repoId: REPO_ID });
    expect(bound.status).toBe(200);
    expect(agent.closes).toEqual([FIRST_SESSION]);
    expect(agent.prompts.at(-1)?.text).toBe('the answer is 42');
    expect(agent.created).toHaveLength(2);

    const second = 'ses_chat2';
    agent.script(second, [{ type: 'session.updated', sessionId: second, status: 'idle' }]);
    const posted = await post(app, `/v1/chat/sessions/${free.id}/messages`, token, {
      text: 'what did we decide?',
    });
    expect(posted.status).toBe(202);
    await waitFor(() => agent.prompts.length === 2, 'the handoff prompt');

    const prompt = agent.prompts[1];
    expect(prompt?.sessionId).toBe(second);
    expect(prompt?.text.startsWith('You are continuing a chat in a git worktree.\n')).toBe(true);
    expect(prompt?.text).toContain('Repository: acme/widgets');
    expect(prompt?.text).toContain('Base branch: main');
    expect(prompt?.text).toContain('Continuation: connected repository');
    expect(prompt?.text).toContain('User: the answer is 42');
    expect(prompt?.text.endsWith('\nwhat did we decide?')).toBe(true);
    expect(agent.prompts[0]?.text).toBe('the answer is 42');

    const stored = store.chats.listMessages(free.id, { limit: 20, cursor: null }).data;
    expect(stored.at(-1)?.text).toBe('what did we decide?');
    expect(stored.filter((message) => message.role === 'system')).toHaveLength(1);
  });

  it('keeps a failed bind free and retryable', async () => {
    const { app, store, agent, workspaces } = harness();
    const token = await paired(app);
    const free = await createFree(app, token);
    agent.failCreate = new AgentError('agent_unavailable', 'down', null, true);

    const failed = await post(app, `/v1/chat/sessions/${free.id}/repo`, token, { repoId: REPO_ID });
    expect(failed.status).toBe(502);
    expect(parseErrorEnvelope(await bodyOf(failed)).error.code).toBe('agent_unavailable');
    const afterFailure = parseChatSession(
      await bodyOf(await app.request(`/v1/chat/sessions/${free.id}`, { headers: auth(token) })),
    );
    expect(afterFailure.kind).toBe('free');
    expect(afterFailure.repoId).toBeNull();
    expect(agent.created).toHaveLength(0);

    agent.failCreate = null;
    const retried = await post(app, `/v1/chat/sessions/${free.id}/repo`, token, {
      repoId: REPO_ID,
    });
    expect(retried.status).toBe(200);
    expect(parseChatSession(await bodyOf(retried)).repoId).toBe(REPO_ID);
    expect(agent.created).toHaveLength(1);
    expect(workspaces.trees.length).toBeGreaterThanOrEqual(1);
    expect(rowOf(store, free.id)).toMatchObject({ repo_id: REPO_ID, kind: 'repo' });
  });

  it('answers a bind body or repository failure with its documented reason', async () => {
    const { app, store } = harness();
    const token = await paired(app);
    const free = await createFree(app, token);

    const badBody = await post(app, `/v1/chat/sessions/${free.id}/repo`, token, {
      repoId: 'not-a-repo-id',
    });
    expect(badBody.status).toBe(422);
    expect(parseErrorEnvelope(await bodyOf(badBody)).error.details?.['path']).toBe('chat.repoId');

    const unknownRepo = await post(app, `/v1/chat/sessions/${free.id}/repo`, token, {
      repoId: 'repo_missing01',
    });
    expect(unknownRepo.status).toBe(404);
    expect(parseErrorEnvelope(await bodyOf(unknownRepo)).error.details?.['path']).toBe(
      'chat.repoId',
    );

    const unknownChat = await post(app, '/v1/chat/sessions/chat_missing01/repo', token, {
      repoId: REPO_ID,
    });
    expect(unknownChat.status).toBe(404);
    expect(parseErrorEnvelope(await bodyOf(unknownChat)).error.details?.['path']).toBe('chat.id');

    store.chats.updateSession(free.id, { status: 'archived', updatedAt: TS });
    const archived = await post(app, `/v1/chat/sessions/${free.id}/repo`, token, {
      repoId: REPO_ID,
    });
    expect(archived.status).toBe(409);
    expect(parseErrorEnvelope(await bodyOf(archived)).error.details?.['reason']).toBe(
      'chat_archived',
    );
  });

  it('compacts into a new session in the same directory', async () => {
    const { app, store, agent, workspaceRoot } = harness();
    const token = await paired(app);
    const created = await createSession(app, token);
    expect(agent.created).toHaveLength(1);
    const worktree = rowOf(store, created.id)['worktree'];
    expect(worktree).toBe(join(workspaceRoot, created.id));

    const response = await post(app, `/v1/chat/sessions/${created.id}/compact`, token);
    expect(response.status).toBe(200);
    const compacted = parseChatSession(await bodyOf(response));
    expect(compacted.contextEpoch).toBe(2);
    expect(compacted.lastMessage?.role).toBe('system');
    expect(compacted.lastMessage?.text).toBe(
      'Context compacted. The recent turns were re-injected into a new session.',
    );

    expect(agent.created).toHaveLength(2);
    expect(agent.closes).toEqual([FIRST_SESSION]);
    expect(agent.created[1]?.directory).toBe(agent.created[0]?.directory);
    expect(agent.prompts).toHaveLength(0);
    expect(rowOf(store, created.id)).toMatchObject({ worktree, context_epoch: 2 });

    const events = compactEvents(store, created.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ chatId: created.id, contextEpoch: 2 });

    await app.request(`/v1/chat/sessions/${created.id}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    const refused = await post(app, `/v1/chat/sessions/${created.id}/compact`, token);
    expect(refused.status).toBe(409);
    expect(parseErrorEnvelope(await bodyOf(refused)).error.details?.['reason']).toBe(
      'chat_archived',
    );
  });

  it('marks a chat reviewed once', async () => {
    const { app, store } = harness();
    const token = await paired(app);
    const created = await createSession(app, token);

    const first = await post(app, `/v1/chat/sessions/${created.id}/reviewed`, token);
    expect(first.status).toBe(200);
    const firstAt = parseChatSession(await bodyOf(first)).reviewedAt;
    expect(typeof firstAt).toBe('string');

    const second = await post(app, `/v1/chat/sessions/${created.id}/reviewed`, token);
    expect(second.status).toBe(200);
    expect(parseChatSession(await bodyOf(second)).reviewedAt).toBe(firstAt);
    expect(rowOf(store, created.id)['reviewed_at']).toBe(firstAt);

    await app.request(`/v1/chat/sessions/${created.id}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    const archived = await post(app, `/v1/chat/sessions/${created.id}/reviewed`, token);
    expect(archived.status).toBe(200);

    const unknown = await post(app, '/v1/chat/sessions/chat_missing01/reviewed', token);
    expect(unknown.status).toBe(404);
    expect(parseErrorEnvelope(await bodyOf(unknown)).error.details?.['path']).toBe('chat.id');
  });

  it('refuses to promote a chat that is not bound to a repository', async () => {
    const { app, store, agent } = harness({ promote: true });
    const token = await paired(app);
    const free = await createFree(app, token);
    store.chats.appendMessage(
      {
        id: 'msg_promote01',
        chatId: free.id,
        role: 'assistant',
        text: 'I fixed the lockfile.',
        createdAt: TS,
      },
      { origin: 'assistant' },
    );

    const refused = await app.request(`/v1/chat/sessions/${free.id}/promote`, {
      method: 'POST',
      headers: { ...auth(token), 'idempotency-key': 'promote-free-1' },
      body: JSON.stringify({}),
    });
    expect(refused.status).toBe(409);
    const envelope = parseErrorEnvelope(await bodyOf(refused));
    expect(envelope.error.code).toBe('conflict');
    expect(envelope.error.details?.['reason']).toBe('chat_not_repo');
    expect(agent.created).toHaveLength(0);

    const bound = await createSession(app, token);
    store.chats.appendMessage(
      {
        id: 'msg_promote02',
        chatId: bound.id,
        role: 'assistant',
        text: 'I fixed the lockfile.',
        createdAt: TS,
      },
      { origin: 'assistant' },
    );
    const promoted = await app.request(`/v1/chat/sessions/${bound.id}/promote`, {
      method: 'POST',
      headers: { ...auth(token), 'idempotency-key': 'promote-repo-1' },
      body: JSON.stringify({}),
    });
    expect(promoted.status).toBe(202);
    const run = parseRun(await bodyOf(promoted));
    expect(run.trigger).toBe('promote');
    expect(run.repoId).toBe(REPO_ID);
  });

  it('requires the chat scope on the lifecycle routes', async () => {
    const { app, store } = harness();
    const reader = await paired(app, ['read']);
    const owner = await paired(app);
    const free = await createFree(app, owner);
    const bound = await createSession(app, owner);

    const paths = [
      `/v1/chat/sessions/${free.id}/repo`,
      `/v1/chat/sessions/${bound.id}/compact`,
      `/v1/chat/sessions/${bound.id}/reviewed`,
    ];
    for (const path of paths) {
      const response = await app.request(path, { method: 'POST', headers: auth(reader) });
      expect(response.status, path).toBe(403);
      expect(parseErrorEnvelope(await bodyOf(response)).error.details?.['reason']).toBe(
        'insufficient_scope',
      );
    }
    expect(store.chats.getSession(free.id)?.kind).toBe('free');
  });
});

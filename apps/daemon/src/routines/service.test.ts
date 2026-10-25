import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PromptRoutine, ReminderRoutine, Routine } from '@codebox/contracts';
import { AgentError } from '@codebox/opencode';
import type { CreateSessionInput, EventFilter, RawAgentEvent, SessionRef } from '@codebox/opencode';
import { openInMemoryStore } from '@codebox/store';
import type { EventRecord, Store } from '@codebox/store';
import { WorkspaceError } from '@codebox/workspaces';
import type { CreateWorktreeInput, RepoRef, Worktree } from '@codebox/workspaces';
import { createChatService } from '../chat/service.js';
import type { ChatAgent, ChatService, ChatWorkspaces } from '../chat/service.js';
import { loadConfig, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import { createRoutineService, failureMessage } from './service.js';
import type { RoutineService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const REPO_ID = 'repo_routines1';
const NOW = '2026-10-25T10:00:00.000Z';
const BASE_SHA = 'a'.repeat(40);
const PROMPT_TEXT = 'Summarise the repository in five bullets.';

const stores: Store[] = [];
const directories: string[] = [];
const chatServices: ChatService[] = [];
const routineServices: RoutineService[] = [];

afterEach(() => {
  for (const service of routineServices.splice(0)) service.stop();
  for (const service of chatServices.splice(0)) service.stop();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

class FakeAgent implements ChatAgent {
  readonly created: CreateSessionInput[] = [];
  readonly prompts: { readonly sessionId: string; readonly text: string }[] = [];
  failCreate: unknown = null;
  failPrompt: unknown = null;
  private readonly scripts = new Map<string, RawAgentEvent[][]>();
  private readonly queues = new Map<string, RawAgentEvent[]>();
  private readonly waiters = new Map<string, ((value: RawAgentEvent) => void)[]>();
  private counter = 0;

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

  interrupt(): Promise<void> {
    return Promise.resolve();
  }

  replyPermission(): Promise<void> {
    return Promise.resolve();
  }

  closeSession(): Promise<void> {
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
  private readonly existing = new Set<string>();

  async ensureClone(repo: RepoRef): Promise<{ path: string; created: boolean; headSha: string }> {
    return { path: `/tmp/cb-clone/${repo.slug}.git`, created: true, headSha: BASE_SHA };
  }

  async createWorktree(input: CreateWorktreeInput): Promise<Worktree> {
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
  readonly context: DaemonContext;
  readonly store: Store;
  readonly agent: FakeAgent;
  readonly chat: ChatService;
  readonly service: RoutineService;
  readonly lines: Record<string, unknown>[];
  now(): Date;
  advance(iso: string): void;
}

function harness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-35-routines-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_LOG_LEVEL: 'debug',
  });
  const store = openInMemoryStore();
  stores.push(store);
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  let current = new Date(NOW);
  let ticks = 0;
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => new Date(current.getTime() + ticks++ * 1000),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: { version: '0.0.0', commit: null, builtAt: null },
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  store.repos.create({
    id: REPO_ID,
    slug: 'acme/widgets',
    defaultBranch: 'main',
    gate: 'npm test',
    policy: 'auto',
    protectedPaths: [],
    enabled: true,
    createdAt: NOW,
  });
  const agent = new FakeAgent();
  const chat = createChatService({ context, agent, workspaces: new FakeWorkspaces() });
  chatServices.push(chat);
  const service = createRoutineService({
    context,
    now: () => current,
    chat: () => chat,
  });
  routineServices.push(service);
  return {
    context,
    store,
    agent,
    chat,
    service,
    lines,
    now: () => current,
    advance(iso: string): void {
      current = new Date(iso);
    },
  };
}

function reminder(store: Store, input: { id: string; nextFireAt: string | null }): ReminderRoutine {
  return store.routines.create({
    id: input.id,
    kind: 'reminder',
    title: 'Take the pill',
    cron: '0 * * * *',
    timezone: 'UTC',
    enabled: true,
    notify: true,
    createdAt: NOW,
    nextFireAt: input.nextFireAt,
    lastFiredAt: null,
  }) as ReminderRoutine;
}

function prompt(
  store: Store,
  input: { id: string; nextFireAt: string | null; chatSessionId?: string | null },
): PromptRoutine {
  return store.routines.create({
    id: input.id,
    kind: 'prompt',
    title: 'Morning summary',
    cron: '0 * * * *',
    timezone: 'UTC',
    enabled: true,
    notify: true,
    repoId: REPO_ID,
    prompt: PROMPT_TEXT,
    chatSessionId: input.chatSessionId ?? null,
    createdAt: NOW,
    nextFireAt: input.nextFireAt,
    lastFiredAt: null,
  }) as PromptRoutine;
}

function events(store: Store, type: string): EventRecord[] {
  return store.events.readAfterId(0, 500).filter((record) => record.type === type);
}

function allEvents(store: Store): EventRecord[] {
  return store.events.readAfterId(0, 500);
}

function replyScript(from: string): RawAgentEvent[] {
  return [
    { type: 'session.updated', sessionId: from, status: 'busy' },
    { type: 'message.part.text', sessionId: from, messageId: 'msg_piece1', delta: 'Nine ' },
    { type: 'message.part.text', sessionId: from, messageId: 'msg_piece1', delta: 'bullets' },
    { type: 'session.updated', sessionId: from, status: 'idle' },
  ];
}

function row(store: Store, id: string): Routine {
  const value = store.routines.get(id);
  if (value === null) throw new Error(`routine ${id} is missing`);
  return value;
}

async function settle(service: RoutineService): Promise<void> {
  await Promise.all(service.pending());
}

describe('routine service tick', () => {
  it('turns a due reminder into one event and one sent fire, with no chat', async () => {
    const { store, service, agent } = harness();
    reminder(store, { id: 'rtn_000001', nextFireAt: '2026-10-25T09:59:30Z' });

    const report = await service.tick(new Date(NOW));

    expect(report).toEqual({ due: 1, fired: 1, skipped: 0, lost: 0, deferred: 0 });
    const fired = events(store, 'routine.fired');
    expect(fired).toHaveLength(1);
    expect(fired[0]?.data).toEqual({
      routineId: 'rtn_000001',
      kind: 'reminder',
      scheduledFor: '2026-10-25T09:59:30Z',
      ts: NOW,
    });
    const fires = store.routineFires.listByRoutine('rtn_000001', 10);
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({
      scheduledFor: '2026-10-25T09:59:30Z',
      outcome: 'sent',
      detail: null,
    });
    expect(store.chats.listSessions({ limit: 10, cursor: null }).data).toEqual([]);
    expect(agent.prompts).toEqual([]);
    expect(row(store, 'rtn_000001').nextFireAt).toBe('2026-10-25T11:00:00Z');
  });

  it('processes a row once when two ticks are awaited together', async () => {
    const { store, service } = harness();
    reminder(store, { id: 'rtn_000002', nextFireAt: '2026-10-25T09:59:30Z' });

    const [first, second] = await Promise.all([
      service.tick(new Date(NOW)),
      service.tick(new Date(NOW)),
    ]);

    expect(first).toEqual({ due: 1, fired: 1, skipped: 0, lost: 0, deferred: 0 });
    expect(second).toEqual({ due: 0, fired: 0, skipped: 0, lost: 0, deferred: 0 });
    expect(events(store, 'routine.fired')).toHaveLength(1);
    expect(store.routineFires.listByRoutine('rtn_000002', 10)).toHaveLength(1);
  });

  it('counts a row another process already claimed as lost', async () => {
    const { store, service } = harness();
    reminder(store, { id: 'rtn_000003', nextFireAt: '2026-10-25T09:59:30Z' });
    const taken = store.routineFires.claim({
      routineId: 'rtn_000003',
      scheduledFor: '2026-10-25T09:59:30Z',
      firedAt: '2026-10-25T09:59:30Z',
      nextFireAt: '2026-10-25T09:59:30Z',
    });
    expect(taken).not.toBeNull();

    const report = await service.tick(new Date(NOW));

    expect(report).toEqual({ due: 1, fired: 0, skipped: 0, lost: 1, deferred: 0 });
    expect(events(store, 'routine.fired')).toEqual([]);
  });

  it('writes a skipped row and moves the schedule for a row outside the grace', async () => {
    const { store, service } = harness();
    store.routines.create({
      id: 'rtn_000004',
      kind: 'reminder',
      title: 'Take the pill',
      cron: '0 * * * *',
      timezone: 'UTC',
      enabled: true,
      notify: true,
      createdAt: NOW,
      nextFireAt: '2026-10-25T09:44:59Z',
      lastFiredAt: '2026-10-24T09:44:59Z',
    });

    const report = await service.tick(new Date(NOW));

    expect(report).toEqual({ due: 1, fired: 0, skipped: 1, lost: 0, deferred: 0 });
    const fires = store.routineFires.listByRoutine('rtn_000004', 10);
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ outcome: 'skipped', detail: 'outside_grace' });
    const stored = row(store, 'rtn_000004');
    expect(stored.nextFireAt).toBe('2026-10-25T11:00:00Z');
    expect(stored.lastFiredAt).toBe('2026-10-24T09:44:59Z');
    expect(events(store, 'routine.fired')).toEqual([]);
  });

  it('defers a second prompt fire while one is still running', async () => {
    const { store, service, agent } = harness();
    prompt(store, { id: 'rtn_000005', nextFireAt: '2026-10-25T09:59:30Z' });
    prompt(store, { id: 'rtn_000006', nextFireAt: '2026-10-25T09:59:31Z' });
    agent.script('ses_chat1', replyScript('ses_chat1'));

    const report = await service.tick(new Date(NOW));
    expect(report).toEqual({ due: 2, fired: 1, skipped: 0, lost: 0, deferred: 1 });
    await settle(service);

    const untouched = row(store, 'rtn_000006');
    expect(untouched.nextFireAt).toBe('2026-10-25T09:59:31Z');
    expect(store.routineFires.listByRoutine('rtn_000006', 10)).toEqual([]);
  });
});

describe('routine service prompt fire', () => {
  it('creates the routine chat, stores an origin routine message and replies', async () => {
    const { store, service, agent } = harness();
    prompt(store, { id: 'rtn_000010', nextFireAt: '2026-10-25T09:59:30Z' });
    agent.script('ses_chat1', replyScript('ses_chat1'));

    await service.tick(new Date(NOW));
    await settle(service);

    const fired = events(store, 'routine.fired');
    expect(fired).toHaveLength(1);
    expect(fired[0]?.data).toMatchObject({ routineId: 'rtn_000010', kind: 'prompt' });

    const stored = row(store, 'rtn_000010');
    if (stored.kind !== 'prompt') throw new Error('expected a prompt routine');
    const chatId = stored.chatSessionId;
    expect(chatId).not.toBeNull();
    const session = store.chats.getSession(chatId ?? '');
    expect(session?.title).toBe('Morning summary');

    const messages = store.chats.listMessages(chatId ?? '', { limit: 10, cursor: null }).data;
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    const originRow = store.db
      .prepare('SELECT origin FROM chat_messages WHERE id = ?')
      .get(messages[0]?.id ?? '');
    expect(originRow?.['origin']).toBe('routine');

    const replied = events(store, 'routine.replied');
    expect(replied).toHaveLength(1);
    expect(replied[0]?.data).toMatchObject({
      routineId: 'rtn_000010',
      chatId,
      messageId: messages[1]?.id,
    });

    const fires = store.routineFires.listByRoutine('rtn_000010', 10);
    expect(fires[0]).toMatchObject({ outcome: 'replied', detail: messages[1]?.id });

    const types = allEvents(store).map((record) => record.type);
    expect(types[0]).toBe('routine.fired');
    expect(types.at(-1)).toBe('routine.replied');
    expect(store.runs.list({ limit: 10, cursor: null }).data).toEqual([]);
  });

  it('re-points a routine whose chat session was archived', async () => {
    const { store, service, agent } = harness();
    const archived = store.chats.createSession(
      {
        id: 'chat_archived01',
        repoId: REPO_ID,
        title: 'Old chat',
        status: 'idle',
        createdAt: NOW,
        updatedAt: NOW,
        lastMessage: null,
      },
      { opencodeSessionId: null, worktree: null },
    );
    store.chats.updateSession(archived.id, { status: 'archived', updatedAt: NOW });
    prompt(store, {
      id: 'rtn_000011',
      nextFireAt: '2026-10-25T09:59:30Z',
      chatSessionId: archived.id,
    });
    agent.script('ses_chat1', replyScript('ses_chat1'));

    await service.tick(new Date(NOW));
    await settle(service);

    const stored = row(store, 'rtn_000011');
    if (stored.kind !== 'prompt') throw new Error('expected a prompt routine');
    expect(stored.chatSessionId).not.toBe(archived.id);
    expect(store.chats.getSession(stored.chatSessionId ?? '')?.status).not.toBe('archived');
    expect(events(store, 'routine.replied')).toHaveLength(1);
  });

  it('keeps the fire event and records a fixed failure when the agent is unavailable', async () => {
    const { store, service, agent, lines } = harness();
    prompt(store, { id: 'rtn_000012', nextFireAt: '2026-10-25T09:59:30Z' });
    agent.failCreate = new AgentError('agent_unavailable', 'upstream said no', null, true);

    await service.tick(new Date(NOW));
    await settle(service);

    expect(events(store, 'routine.fired')).toHaveLength(1);
    const failed = events(store, 'routine.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.data).toMatchObject({
      routineId: 'rtn_000012',
      code: 'agent_unavailable',
      message: failureMessage('agent_unavailable'),
    });
    expect(String(failed[0]?.data['message'])).not.toContain('upstream said no');

    const fires = store.routineFires.listByRoutine('rtn_000012', 10);
    expect(fires[0]).toMatchObject({ outcome: 'failed', detail: 'agent_unavailable' });
    expect(events(store, 'routine.replied')).toEqual([]);

    const logged = JSON.stringify(lines);
    expect(logged).not.toContain(PROMPT_TEXT);
    expect(logged).not.toContain('Nine bullets');
    expect(logged).not.toContain('upstream said no');
  });

  it('fires by hand without a fire row and without consuming the schedule', async () => {
    const { store, service, agent } = harness();
    prompt(store, { id: 'rtn_000013', nextFireAt: '2026-10-25T12:00:00Z' });
    const before = row(store, 'rtn_000013');
    agent.script('ses_chat1', replyScript('ses_chat1'));

    const returned = service.runNow(before, new Date(NOW));
    expect(returned).toEqual(before);
    await settle(service);

    expect(store.routineFires.listByRoutine('rtn_000013', 10)).toEqual([]);
    const after = row(store, 'rtn_000013');
    expect(after.nextFireAt).toBe(before.nextFireAt);
    expect(after.lastFiredAt).toBe(before.lastFiredAt);
    expect(after.enabled).toBe(before.enabled);
    expect(events(store, 'routine.fired')).toHaveLength(1);
    expect(events(store, 'routine.replied')).toHaveLength(1);
  });

  it('fires a reminder by hand with the event only', () => {
    const { store, service } = harness();
    reminder(store, { id: 'rtn_000014', nextFireAt: '2026-10-25T12:00:00Z' });
    const before = row(store, 'rtn_000014');

    service.runNow(before, new Date(NOW));

    expect(events(store, 'routine.fired')).toHaveLength(1);
    expect(store.routineFires.listByRoutine('rtn_000014', 10)).toEqual([]);
    expect(row(store, 'rtn_000014')).toEqual(before);
  });
});

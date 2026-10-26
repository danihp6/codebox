import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PromptRoutine } from '@codebox/contracts';
import type { EventFilter, RawAgentEvent, SessionRef } from '@codebox/opencode';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import type { CreateWorktreeInput, RepoRef, Worktree } from '@codebox/workspaces';
import { createChatService } from '../chat/service.js';
import type { ChatAgent, ChatService, ChatWorkspaces } from '../chat/service.js';
import { loadConfig, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import { firePrompt } from './fire.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const REPO_ID = 'repo_fire0001';
const NOW = '2026-10-25T10:00:00.000Z';
const BASE_SHA = 'a'.repeat(40);
const PROMPT_TEXT = 'Summarise the repository in five bullets.';

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
  readonly created: string[] = [];
  readonly prompts: string[] = [];
  private readonly scripts = new Map<string, RawAgentEvent[][]>();
  private readonly queues = new Map<string, RawAgentEvent[]>();
  private readonly waiters = new Map<string, ((value: RawAgentEvent) => void)[]>();
  private counter = 0;

  script(sessionId: string, events: readonly RawAgentEvent[]): void {
    const rounds = this.scripts.get(sessionId) ?? [];
    rounds.push([...events]);
    this.scripts.set(sessionId, rounds);
  }

  createSession(input: {
    readonly directory: string;
    readonly title: string;
  }): Promise<SessionRef> {
    this.created.push(input.title);
    this.counter += 1;
    const sessionId = `ses_chat${this.counter}`;
    return Promise.resolve({ sessionId, directory: input.directory, title: input.title });
  }

  prompt(sessionId: string, text: string): Promise<void> {
    this.prompts.push(text);
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
  failure: unknown = null;

  async ensureClone(repo: RepoRef): Promise<{ path: string; created: boolean; headSha: string }> {
    return { path: `/tmp/cb-clone/${repo.slug}.git`, created: true, headSha: BASE_SHA };
  }

  async createWorktree(input: CreateWorktreeInput): Promise<Worktree> {
    if (this.failure !== null) throw this.failure;
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
  readonly workspaces: FakeWorkspaces;
  readonly chat: ChatService;
}

function harness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-35-fire-'));
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
  let ticks = 0;
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => new Date(Date.parse(NOW) + ticks++ * 1000),
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
  const workspaces = new FakeWorkspaces();
  const chat = createChatService({ context, agent, workspaces });
  services.push(chat);
  return { context, store, agent, workspaces, chat };
}

function routine(store: Store, input: { id: string; repoId?: string }): PromptRoutine {
  const value = store.routines.create({
    id: input.id,
    kind: 'prompt',
    title: 'Morning summary',
    cron: '0 * * * *',
    timezone: 'UTC',
    enabled: true,
    notify: true,
    repoId: input.repoId ?? REPO_ID,
    prompt: PROMPT_TEXT,
    chatSessionId: null,
    createdAt: NOW,
    nextFireAt: '2026-10-25T11:00:00Z',
    lastFiredAt: null,
  });
  if (value.kind !== 'prompt') throw new Error('expected a prompt routine');
  return value;
}

describe('firePrompt', () => {
  it('reports chat_unavailable without a chat service', async () => {
    const { context, store } = harness();

    const result = await firePrompt(routine(store, { id: 'rtn_000101' }), {
      context,
      chat: () => null,
      now: () => new Date(NOW),
    });

    expect(result).toEqual({
      outcome: 'failed',
      chatId: null,
      messageId: null,
      code: 'chat_unavailable',
    });
  });

  it('reports repo_missing when the routine repository is gone', async () => {
    const { context, store, chat } = harness();
    const orphan: PromptRoutine = {
      ...routine(store, { id: 'rtn_000102' }),
      repoId: 'repo_missing01',
    };

    const result = await firePrompt(orphan, {
      context,
      chat: () => chat,
      now: () => new Date(NOW),
    });

    expect(result).toEqual({
      outcome: 'failed',
      chatId: null,
      messageId: null,
      code: 'repo_missing',
    });
  });

  it('creates the chat, sends the routine prompt and returns the assistant message', async () => {
    const { context, store, agent, chat } = harness();
    const target = routine(store, { id: 'rtn_000103' });
    agent.script('ses_chat1', [
      { type: 'session.updated', sessionId: 'ses_chat1', status: 'busy' },
      { type: 'message.part.text', sessionId: 'ses_chat1', messageId: 'msg_f1', delta: 'Done' },
      { type: 'session.updated', sessionId: 'ses_chat1', status: 'idle' },
    ]);

    const result = await firePrompt(target, {
      context,
      chat: () => chat,
      now: () => new Date(NOW),
    });

    expect(result.outcome).toBe('replied');
    expect(result.code).toBeNull();
    expect(result.chatId).not.toBeNull();
    const messages = store.chats.listMessages(result.chatId ?? '', {
      limit: 10,
      cursor: null,
    }).data;
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[1]?.id).toBe(result.messageId);
    expect(agent.prompts).toEqual([PROMPT_TEXT]);
    const stored = store.routines.get(target.id);
    if (stored === null || stored.kind !== 'prompt') throw new Error('expected a prompt routine');
    expect(stored.chatSessionId).toBe(result.chatId);
  });

  it('reports no_reply when the turn stores no assistant message', async () => {
    const { context, store, agent, chat } = harness();
    const target = routine(store, { id: 'rtn_000104' });
    agent.script('ses_chat1', [
      { type: 'session.updated', sessionId: 'ses_chat1', status: 'idle' },
    ]);

    const result = await firePrompt(target, {
      context,
      chat: () => chat,
      now: () => new Date(NOW),
    });

    expect(result.outcome).toBe('failed');
    expect(result.code).toBe('no_reply');
    expect(result.chatId).not.toBeNull();
  });

  it('reports internal for a failure that is not a ChatError and keeps its message', async () => {
    const { context, store, workspaces, chat } = harness();
    workspaces.failure = new Error('disk on fire');
    const target = routine(store, { id: 'rtn_000105' });

    const result = await firePrompt(target, {
      context,
      chat: () => chat,
      now: () => new Date(NOW),
    });

    expect(result.outcome).toBe('failed');
    expect(result.code).toBe('internal');
    expect(JSON.stringify(result)).not.toContain('disk on fire');
  });
});

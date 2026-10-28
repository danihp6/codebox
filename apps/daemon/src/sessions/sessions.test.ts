import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  errorEnvelopeSchema,
  pageOfSessionMessage as pageOfSessionMessageSchema,
  parseSession,
  parseSessionMessage,
} from '@codebox/contracts';
import type { Repo, Scope, Session, SessionMessage } from '@codebox/contracts';
import type { RawAgentEvent, SessionRef } from '@codebox/opencode';
import { mintAccessToken, sha256Hex } from '@codebox/security';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import type { GitRunner } from '@codebox/workspaces';
import { createApp } from '../app.js';
import { createModule as createAuthModule } from '../auth/index.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import { registerSessionRoutes } from './routes.js';
import { TARGET_WRITE_SETS, createSessionsService, outsideTarget } from './service.js';
import type { SessionMergePort, SessionWorkspaces, SessionsAgent } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const ACCESS_TTL_SECONDS = 900;
const NOW = '2026-10-25T00:00:00.000Z';
const REPO_ID = 'repo_sess01';
const BASE_SHA = 'abcdef12';
const HEAD_SHA = 'deadbeef';

const REPO: Repo = {
  id: REPO_ID,
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'manual',
  protectedPaths: [],
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function agentOf(reply: string): SessionsAgent {
  return {
    createSession: async (input): Promise<SessionRef> => ({
      sessionId: 'oc_session0001',
      directory: input.directory,
      title: input.title,
    }),
    prompt: async () => undefined,
    subscribe: () => {
      const events: RawAgentEvent[] = [
        { type: 'message.part.text', sessionId: 'oc_session0001', messageId: 'm1', delta: reply },
        {
          type: 'session.usage',
          sessionId: 'oc_session0001',
          model: 'm',
          tokensIn: 10,
          tokensOut: 4,
          costUsd: 0.01,
        },
        { type: 'session.updated', sessionId: 'oc_session0001', status: 'idle' },
      ];
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<RawAgentEvent> {
          for (const event of events) yield event;
        },
      };
    },
    interrupt: async () => undefined,
    replyPermission: async () => undefined,
    closeSession: async () => undefined,
  };
}

interface Harness {
  readonly app: DaemonApp;
  readonly store: Store;
  readonly merges: { worktrees: string[]; proposals: string[] };
  paths: string[];
  device(scopes?: readonly Scope[]): string;
  call(
    method: string,
    path: string,
    options?: { token?: string; body?: unknown },
  ): Promise<Response>;
}

function harness(input: { paths?: string[]; reply?: string } = {}): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-72-sessions-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
  });
  const store = openInMemoryStore();
  stores.push(store);
  store.repos.create(REPO);
  const logger = createLogger({ level: 'error', sink: () => undefined });
  // Every read advances a second: a frozen clock ties the user and assistant rows of one turn.
  let clockMs = Date.parse(NOW);
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => {
      clockMs += 1000;
      return new Date(clockMs);
    },
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  const app = createApp({ context });
  createAuthModule(context).register(app, context);
  let devices = 0;
  const state: Harness = {
    app,
    store,
    merges: { worktrees: [], proposals: [] },
    paths: input.paths ?? [],
    device(scopes: readonly Scope[] = ['read', 'write']): string {
      devices += 1;
      const id = `dev_sessions${String(devices).padStart(3, '0')}`;
      store.devices.create({
        id,
        name: `Device ${devices}`,
        platform: 'cli',
        publicKey: null,
        fingerprint: null,
        scopes: [...scopes],
        refreshTokenHash: sha256Hex(id),
        refreshPreviousHash: null,
        refreshExpiresAt: new Date(Date.parse(NOW) + 86_400_000).toISOString(),
        createdAt: NOW,
        lastSeenAt: null,
        revokedAt: null,
      });
      return mintAccessToken({
        deviceId: id,
        scopes,
        secret: SESSION_SECRET,
        now: new Date(NOW),
        ttlSeconds: ACCESS_TTL_SECONDS,
      }).token;
    },
    async call(method, path, options = {}): Promise<Response> {
      const headers: Record<string, string> = {};
      if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;
      const init: RequestInit = { method, headers };
      if (options.body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(options.body);
      }
      return app.request(path, init);
    },
  };

  const workspaces: SessionWorkspaces = {
    ensureClone: async () => ({
      path: join(directory, 'repos'),
      created: false,
      headSha: BASE_SHA,
    }),
    createWorktree: async (worktreeInput) => ({
      runId: worktreeInput.runId,
      repoSlug: worktreeInput.repo.slug,
      path: join(directory, 'worktrees', worktreeInput.runId),
      branch: `cb/${worktreeInput.runId}`,
      baseRef: worktreeInput.baseRef,
      baseSha: BASE_SHA,
    }),
  };
  const git: GitRunner = {
    run: async (command) => {
      const key = command.args.join(' ');
      if (key === 'rev-parse refs/heads/main')
        return { code: 0, stdout: `${BASE_SHA}\n`, stderr: '' };
      if (key === 'rev-parse HEAD') return { code: 0, stdout: `${HEAD_SHA}\n`, stderr: '' };
      if (key.startsWith('diff --name-only')) {
        return {
          code: 0,
          stdout: state.paths.map((path) => `${path}\n`).join(''),
          stderr: '',
        };
      }
      return { code: 1, stdout: '', stderr: 'unexpected call' };
    },
  };
  const merge: SessionMergePort = {
    merge: async (mergeInput) => {
      state.merges.worktrees.push(mergeInput.worktree);
      state.merges.proposals.push(mergeInput.proposal.branch);
    },
  };
  const sessions = createSessionsService({
    context,
    agent: agentOf(input.reply ?? 'Done.'),
    workspaces,
    git,
    merge,
  });
  registerSessionRoutes(app, sessions);
  return state;
}

async function detailsOf(response: Response): Promise<unknown> {
  const body = errorEnvelopeSchema.parse(await response.json());
  return body.error.details;
}

async function createSession(
  test: Harness,
  token: string,
  body: Record<string, unknown>,
): Promise<Session> {
  const response = await test.call('POST', '/v1/sessions', { token, body });
  expect(response.status).toBe(201);
  return parseSession(await response.json());
}

describe('outsideTarget', () => {
  it('admits the design directory and refuses a source file', () => {
    expect(outsideTarget('design', ['design/tokens.json'])).toBeNull();
    expect(outsideTarget('design', ['apps/app/src/theme/tokens.ts'])).toBe(
      'apps/app/src/theme/tokens.ts',
    );
  });

  it('admits TODO.md for the backlog and refuses everything else', () => {
    expect(outsideTarget('backlog', ['TODO.md'])).toBeNull();
    expect(outsideTarget('backlog', ['docs/api.md'])).toBe('docs/api.md');
  });

  it('admits nothing for a repo session', () => {
    expect(outsideTarget('repo', ['TODO.md'])).toBe('TODO.md');
  });

  it('pins the write sets', () => {
    expect(TARGET_WRITE_SETS).toEqual({
      backlog: ['TODO.md'],
      work: ['TODO.md'],
      design: ['design/'],
      schedule: ['.codebox/schedule.yml'],
      repo: [],
    });
    expect(Object.isFrozen(TARGET_WRITE_SETS)).toBe(true);
  });
});

describe('POST /v1/sessions', () => {
  it('creates a design session with a worktree and a cb/ branch', async () => {
    const test = harness();
    const session = await createSession(test, test.device(), {
      repoId: REPO_ID,
      target: 'design',
    });
    expect(session.target).toBe('design');
    expect(session.workId).toBeNull();
    expect(session.branch).toMatch(/^cb\/sess_/);
    expect(session.status).toBe('idle');
    expect(test.store.sessions.getSession(session.id)?.branch).toBe(session.branch);
  });

  it('creates a repo session with no branch', async () => {
    const test = harness();
    const session = await createSession(test, test.device(), { repoId: REPO_ID, target: 'repo' });
    expect(session.branch).toBeNull();
    expect(session.pendingProposal).toBeNull();
  });

  it('opens a work session on a work of the same repository', async () => {
    const test = harness();
    test.store.works.create({
      id: 'wrk_sessions01',
      repoId: REPO_ID,
      backlogRef: 'Task-72',
      title: 'Daemon works',
      prompt: 'Build it.',
      specSha: BASE_SHA,
      state: 'needs_decision',
      origin: 'backlog',
      attempts: 1,
      maxAttempts: 2,
      usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
      contextTokens: 0,
      contextEpoch: 1,
      reviewedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const session = await createSession(test, test.device(), {
      repoId: REPO_ID,
      target: 'work',
      workId: 'wrk_sessions01',
    });
    expect(session.target).toBe('work');
    expect(session.workId).toBe('wrk_sessions01');
    expect(session.branch).toMatch(/^cb\/sess_/);
  });

  it('refuses target work without a work id', async () => {
    const test = harness();
    const response = await test.call('POST', '/v1/sessions', {
      token: test.device(),
      body: { repoId: REPO_ID, target: 'work' },
    });
    expect(response.status).toBe(422);
    expect(await detailsOf(response)).toMatchObject({ path: 'session.workId' });
  });

  it('refuses a work id on a target that is not work', async () => {
    const test = harness();
    const response = await test.call('POST', '/v1/sessions', {
      token: test.device(),
      body: { repoId: REPO_ID, target: 'design', workId: 'wrk_sessions1' },
    });
    expect(response.status).toBe(422);
    expect(await detailsOf(response)).toMatchObject({ path: 'session.workId' });
  });
});

describe('POST /v1/sessions/{id}/merge', () => {
  it('refuses a merge on a read-only repo session', async () => {
    const test = harness();
    const token = test.device();
    const session = await createSession(test, token, { repoId: REPO_ID, target: 'repo' });
    const response = await test.call('POST', `/v1/sessions/${session.id}/merge`, { token });
    expect(response.status).toBe(409);
    expect(await detailsOf(response)).toEqual({ reason: 'read_only_session' });
  });

  it('refuses a proposal that leaves its target and pushes nothing', async () => {
    const test = harness({ paths: ['docs/api.md'] });
    const token = test.device();
    const session = await createSession(test, token, { repoId: REPO_ID, target: 'design' });
    const response = await test.call('POST', `/v1/sessions/${session.id}/merge`, { token });
    expect(response.status).toBe(409);
    expect(await detailsOf(response)).toEqual({ reason: 'target_violation', path: 'docs/api.md' });
    expect(test.merges.proposals).toEqual([]);
    expect(test.store.sessions.getSession(session.id)?.pendingProposal).toBeNull();
  });

  it('refuses a second proposal while one is pending', async () => {
    const test = harness({ paths: ['design/tokens/core.json'] });
    const token = test.device();
    const session = await createSession(test, token, { repoId: REPO_ID, target: 'design' });
    test.store.sessions.updateSession(session.id, {
      pendingProposal: {
        branch: session.branch ?? 'cb/pending',
        sha: HEAD_SHA,
        paths: ['design/tokens/core.json'],
        createdAt: NOW,
      },
      updatedAt: NOW,
    });
    const response = await test.call('POST', `/v1/sessions/${session.id}/merge`, { token });
    expect(response.status).toBe(409);
    expect(await detailsOf(response)).toEqual({ reason: 'proposal_pending' });
    expect(test.merges.proposals).toEqual([]);
  });

  it('refuses a merge with no change to propose', async () => {
    const test = harness({ paths: [] });
    const token = test.device();
    const session = await createSession(test, token, { repoId: REPO_ID, target: 'design' });
    const response = await test.call('POST', `/v1/sessions/${session.id}/merge`, { token });
    expect(response.status).toBe(409);
    expect(await detailsOf(response)).toEqual({ reason: 'proposal_none' });
    expect(test.merges.proposals).toEqual([]);
  });

  it('proposes the in-target diff, merges it once and clears it', async () => {
    const test = harness({ paths: ['design/tokens/core.json'] });
    const token = test.device();
    const session = await createSession(test, token, { repoId: REPO_ID, target: 'design' });
    const response = await test.call('POST', `/v1/sessions/${session.id}/merge`, { token });
    expect(response.status).toBe(200);
    const merged = parseSession(await response.json());
    expect(merged.pendingProposal).toBeNull();
    expect(test.merges.proposals).toEqual([session.branch]);
    const events = test.store.events.readAfterId(0, 20);
    expect(events.some((event) => event.type === 'session.proposal')).toBe(true);
  });
});

describe('POST /v1/sessions/{id}/messages', () => {
  it('stores one user and one assistant row and streams monotonic deltas', async () => {
    const test = harness({ reply: 'Hello from the agent.' });
    const token = test.device();
    const session = await createSession(test, token, { repoId: REPO_ID, target: 'backlog' });

    const response = await test.call('POST', `/v1/sessions/${session.id}/messages`, {
      token,
      body: { text: 'Add the item to the backlog.' },
    });
    expect(response.status).toBe(202);
    const stored = parseSessionMessage(await response.json());
    expect(stored.role).toBe('user');

    const messages = test.store.sessions.listMessages(session.id, { limit: 20, cursor: null });
    expect(messages.data.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages.data[1]?.text).toBe('Hello from the agent.');

    const seqs = test.store.events
      .readAfterId(0, 50)
      .filter((event) => event.type === 'session.delta')
      .map((event) => event.seq ?? 0);
    expect(seqs).toHaveLength(1);
    expect(seqs).toEqual([...seqs].sort((left, right) => left - right));
    expect(seqs[0]).toBeGreaterThan(0);

    const idle = test.store.sessions.getSession(session.id);
    expect(idle?.status).toBe('idle');
    expect(idle?.usage.usd).toBeCloseTo(0.01);
    expect(idle?.contextTokens).toBe(10);
  });

  it('pages the messages oldest first', async () => {
    const test = harness();
    const token = test.device();
    const session = await createSession(test, token, { repoId: REPO_ID, target: 'backlog' });
    await test.call('POST', `/v1/sessions/${session.id}/messages`, {
      token,
      body: { text: 'First.' },
    });
    await test.call('POST', `/v1/sessions/${session.id}/messages`, {
      token,
      body: { text: 'Second.' },
    });

    const page = await test.call('GET', `/v1/sessions/${session.id}/messages`, { token });
    expect(page.status).toBe(200);
    const parsed = pageOfSessionMessageSchema.parse(await page.json());
    const roles: SessionMessage['role'][] = parsed.data.map((message) => message.role);
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('refuses an empty message', async () => {
    const test = harness();
    const token = test.device();
    const session = await createSession(test, token, { repoId: REPO_ID, target: 'backlog' });
    const response = await test.call('POST', `/v1/sessions/${session.id}/messages`, {
      token,
      body: { text: '   ' },
    });
    expect(response.status).toBe(422);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  errorEnvelopeSchema,
  pageOfWork as pageOfWorkSchema,
  parseSession,
  parseWork,
  parseWorkDetail,
  parseRun,
} from '@codebox/contracts';
import type { Repo, Scope, Session, Work } from '@codebox/contracts';
import { mintAccessToken, sha256Hex } from '@codebox/security';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import type { WorkspaceManager, WorkspaceStatus } from '@codebox/workspaces';
import { createApp } from '../app.js';
import { createModule as createAuthModule } from '../auth/index.js';
import { createBacklogService } from '../backlog/service.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import type { RunEngine, RunStartInput } from '../run/ports.js';
import { createRunsService } from '../runs/service.js';
import type { RunsService } from '../runs/service.js';
import { registerWorksRoutes } from './routes.js';
import { createWorksService } from './service.js';
import type { SessionCreator } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const ACCESS_TTL_SECONDS = 900;
const NOW = '2026-10-25T00:00:00.000Z';
const REVISION = '9f1c2ab';
const REPO_ID = 'repo_works01';

const BACKLOG = `# Backlog

## Batch 1 — Alpha

- [x] **[Task-01]** Done item.
- [ ] **[Task-02]** Open item.
  Body line one.
- [ ] **[Task-03]** Second open item.
`;

const EMPTY_BACKLOG = `## Batch 1 — Alpha

- [x] **[Task-01]** Done item.
`;

const EMPTY_BODY = `## Batch 1 — Alpha

`;

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
const services: RunsService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function engine(): RunEngine {
  return {
    start: async (input: RunStartInput) => ({
      runId: input.runId,
      state: 'succeeded' as const,
      pr: null,
      gate: null,
      blockers: [],
      failure: null,
    }),
    cancel: async () => true,
    active: () => [],
  };
}

function workspaces(): Pick<WorkspaceManager, 'status'> {
  const status: WorkspaceStatus = {
    branch: 'cb/run',
    baseSha: 'deadbee',
    headSha: 'deadbee',
    commitsAhead: 0,
    dirty: false,
    diff: { files: 0, added: 0, removed: 0, changedFiles: [] },
    changedPaths: [],
    protectedHits: [],
  };
  return { status: async () => status };
}

interface Harness {
  readonly app: DaemonApp;
  readonly store: Store;
  readonly service: RunsService;
  device(scopes?: readonly Scope[]): string;
  call(
    method: string,
    path: string,
    options?: { token?: string; body?: unknown },
  ): Promise<Response>;
}

let sessionSeq = 0;

function fakeSessions(): SessionCreator {
  return {
    async create(input): Promise<Session> {
      sessionSeq += 1;
      return {
        id: `sess_works${String(sessionSeq).padStart(4, '0')}`,
        repoId: input.repoId,
        target: input.target,
        workId: input.workId ?? null,
        title: input.title ?? 'Decision',
        status: 'idle',
        branch: `cb/sess-works${sessionSeq}`,
        pendingProposal: null,
        usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
        contextTokens: 0,
        contextEpoch: 1,
        createdAt: NOW,
        updatedAt: NOW,
        lastMessage: null,
      };
    },
  };
}

function harness(markdown: string): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-72-works-routes-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
  });
  const store = openInMemoryStore();
  stores.push(store);
  store.repos.create(REPO);
  const logger = createLogger({ level: 'error', sink: () => undefined });
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => new Date(NOW),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  const app = createApp({ context });
  createAuthModule(context).register(app, context);
  const runs = createRunsService({ context, engine: engine(), workspaces: workspaces() });
  services.push(runs);
  const backlog = createBacklogService({
    context,
    runtime: {
      readSnapshot: async () => ({ markdown, revision: REVISION }),
    },
  });
  const works = createWorksService({
    context,
    backlog,
    runs: () => runs,
    sessions: fakeSessions(),
  });
  registerWorksRoutes(app, works);
  let devices = 0;
  return {
    app,
    store,
    service: runs,
    device(scopes: readonly Scope[] = ['read', 'runs', 'write']): string {
      devices += 1;
      const id = `dev_works${String(devices).padStart(3, '0')}`;
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
}

async function errorOf(response: Response): Promise<{ code: string; details?: unknown }> {
  const body = errorEnvelopeSchema.parse(await response.json());
  return { code: body.error.code, details: body.error.details };
}

async function createWork(test: Harness, token: string, ref = 'Task-02'): Promise<Work> {
  const response = await test.call('POST', '/v1/works', {
    token,
    body: { repoId: REPO_ID, backlogRef: ref },
  });
  expect(response.status).toBe(201);
  return parseWork(await response.json());
}

describe('POST /v1/works', () => {
  it('seeds the work from the file: ref, body and revision', async () => {
    const test = harness(BACKLOG);
    const work = await createWork(test, test.device());

    expect(work.repoId).toBe(REPO_ID);
    expect(work.backlogRef).toBe('Task-02');
    expect(work.title).toBe('Open item.');
    expect(work.prompt).toContain('Body line one.');
    expect(work.specSha).toBe(REVISION);
    expect(work.state).toBe('queued');
    expect(work.origin).toBe('backlog');
    expect(work.attempts).toBe(0);
    expect(work.maxAttempts).toBe(2);
    expect(work.contextEpoch).toBe(1);
    expect(work.reviewedAt).toBeNull();
  });

  it('refuses an unknown ref and a ticked one with their reasons', async () => {
    const test = harness(BACKLOG);
    const token = test.device();
    const missing = await test.call('POST', '/v1/works', {
      token,
      body: { repoId: REPO_ID, backlogRef: 'Task-99' },
    });
    expect(missing.status).toBe(422);
    expect(await errorOf(missing)).toEqual({
      code: 'validation_failed',
      details: { path: 'work.backlogRef', reason: 'backlog_ref_missing' },
    });

    const checked = await test.call('POST', '/v1/works', {
      token,
      body: { repoId: REPO_ID, backlogRef: 'Task-01' },
    });
    expect(checked.status).toBe(409);
    expect(await errorOf(checked)).toEqual({
      code: 'conflict',
      details: { reason: 'backlog_ref_checked' },
    });
  });

  it('refuses a second live work for the same item', async () => {
    const test = harness(BACKLOG);
    const token = test.device();
    await createWork(test, token);
    const second = await test.call('POST', '/v1/works', {
      token,
      body: { repoId: REPO_ID, backlogRef: 'Task-02' },
    });
    expect(second.status).toBe(409);
    expect((await errorOf(second)).details).toMatchObject({ reason: 'live_work' });
  });

  it('needs the write scope', async () => {
    const test = harness(BACKLOG);
    const response = await test.call('POST', '/v1/works', {
      token: test.device(['read']),
      body: { repoId: REPO_ID, backlogRef: 'Task-02' },
    });
    expect(response.status).toBe(403);
  });
});

describe('PATCH /v1/works/{id}', () => {
  it('refuses title and prompt because the file owns them', async () => {
    const test = harness(BACKLOG);
    const token = test.device();
    const work = await createWork(test, token);
    for (const body of [{ title: 'Other' }, { prompt: 'Other' }]) {
      const response = await test.call('PATCH', `/v1/works/${work.id}`, { token, body });
      expect(response.status).toBe(409);
      expect((await errorOf(response)).details).toEqual({ reason: 'spec_in_git' });
    }
  });

  it('refuses an empty patch with a validation failure', async () => {
    const test = harness(BACKLOG);
    const token = test.device();
    const work = await createWork(test, token);
    const response = await test.call('PATCH', `/v1/works/${work.id}`, { token, body: {} });
    expect(response.status).toBe(422);
    expect((await errorOf(response)).code).toBe('validation_failed');
  });
});

describe('POST /v1/works/{id}/runs', () => {
  it('writes runs.work_id, bumps the attempt and moves the work to running', async () => {
    const test = harness(BACKLOG);
    const token = test.device();
    const work = await createWork(test, token);

    const response = await test.call('POST', `/v1/works/${work.id}/runs`, {
      token,
      body: { prompt: 'Try the narrower fix.' },
    });
    expect(response.status).toBe(202);
    const run = parseRun(await response.json());
    expect(run.repoId).toBe(REPO_ID);
    expect(test.store.runs.getRecord(run.id)?.workId).toBe(work.id);
    expect(test.store.runs.getRecord(run.id)?.prompt).toBe('Try the narrower fix.');

    const updated = test.store.works.get(work.id);
    expect(updated?.state).toBe('running');
    expect(updated?.attempts).toBe(1);

    const listed = test.store.runs.list({ workId: work.id, limit: 10, cursor: null }).data;
    expect(listed.map((entry) => entry.id)).toEqual([run.id]);
  });

  it('needs the runs scope', async () => {
    const test = harness(BACKLOG);
    const work = await createWork(test, test.device());
    const response = await test.call('POST', `/v1/works/${work.id}/runs`, {
      token: test.device(['read', 'write']),
      body: {},
    });
    expect(response.status).toBe(403);
  });
});

describe('GET /v1/works/{id} and the list', () => {
  it('answers the work with its repository and newest-first runs', async () => {
    const test = harness(BACKLOG);
    const token = test.device();
    const work = await createWork(test, token);
    await test.call('POST', `/v1/works/${work.id}/runs`, { token, body: {} });

    const detail = await test.call('GET', `/v1/works/${work.id}`, { token });
    expect(detail.status).toBe(200);
    const parsed = parseWorkDetail(await detail.json());
    expect(parsed.work.id).toBe(work.id);
    expect(parsed.repo.id).toBe(REPO_ID);
    expect(parsed.runs).toHaveLength(1);

    const list = await test.call('GET', `/v1/works?repoId=${REPO_ID}&state=running`, { token });
    expect(list.status).toBe(200);
    expect(pageOfWorkSchema.parse(await list.json()).data.map((entry) => entry.id)).toEqual([
      work.id,
    ]);

    const unknown = await test.call('GET', '/v1/works/wrk_000404', { token });
    expect(unknown.status).toBe(404);
  });
});

describe('POST /v1/works/{id}/reviewed and /interrupt', () => {
  it('stamps reviewedAt once and refuses the second call', async () => {
    const test = harness(BACKLOG);
    const token = test.device();
    const work = await createWork(test, token);

    const first = await test.call('POST', `/v1/works/${work.id}/reviewed`, { token });
    expect(first.status).toBe(200);
    expect(parseWork(await first.json()).reviewedAt).not.toBeNull();

    const second = await test.call('POST', `/v1/works/${work.id}/reviewed`, { token });
    expect(second.status).toBe(409);
    expect((await errorOf(second)).details).toEqual({ reason: 'already_reviewed' });
  });

  it('refuses an interrupt with no live run', async () => {
    const test = harness(BACKLOG);
    const token = test.device();
    const work = await createWork(test, token);
    const response = await test.call('POST', `/v1/works/${work.id}/interrupt`, { token });
    expect(response.status).toBe(409);
    expect((await errorOf(response)).details).toEqual({ reason: 'no_live_run' });
  });
});

describe('POST /v1/works/{id}/decision and DELETE', () => {
  it('opens a work session and marks the work needs_decision', async () => {
    const test = harness(BACKLOG);
    const token = test.device();
    const work = await createWork(test, token);
    const response = await test.call('POST', `/v1/works/${work.id}/decision`, { token });
    expect(response.status).toBe(201);
    const session = parseSession(await response.json());
    expect(session.target).toBe('work');
    expect(session.workId).toBe(work.id);
    expect(test.store.works.get(work.id)?.state).toBe('needs_decision');
  });

  it('archives a work with 204', async () => {
    const test = harness(BACKLOG);
    const token = test.device();
    const work = await createWork(test, token);
    const response = await test.call('DELETE', `/v1/works/${work.id}`, { token });
    expect(response.status).toBe(204);
    expect(test.store.works.get(work.id)?.state).toBe('abandoned');
  });
});

describe('POST /v1/repos/{id}/run-next', () => {
  it('opens the next item as a manual work plus run', async () => {
    const test = harness(BACKLOG);
    const token = test.device();
    const response = await test.call('POST', `/v1/repos/${REPO_ID}/run-next`, { token });
    expect(response.status).toBe(202);
    const run = parseRun(await response.json());
    const work = test.store.works.findByBacklogRef(REPO_ID, 'Task-02');
    expect(work?.origin).toBe('manual');
    expect(test.store.runs.getRecord(run.id)?.workId).toBe(work?.id);
  });

  it('refuses with nothing_pending when the file has no pending item', async () => {
    for (const markdown of [EMPTY_BACKLOG, EMPTY_BODY]) {
      const test = harness(markdown);
      const response = await test.call('POST', `/v1/repos/${REPO_ID}/run-next`, {
        token: test.device(),
      });
      expect(response.status).toBe(409);
      expect((await errorOf(response)).details).toEqual({ reason: 'nothing_pending' });
    }
  });
});

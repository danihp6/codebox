import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  errorEnvelopeSchema,
  jobNextSchema,
  pageOfJob,
  parseJob,
  parseRun,
} from '@codebox/contracts';
import type { Repo, Scope } from '@codebox/contracts';
import { mintAccessToken, sha256Hex } from '@codebox/security';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import type { WorkspaceManager, WorkspaceStatus } from '@codebox/workspaces';
import { createModule as createAuthModule } from '../auth/index.js';
import { createApp } from '../app.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import type { RunEngine, RunOutcome, RunStartInput } from '../run/ports.js';
import { createRunsService } from '../runs/service.js';
import type { RunsService } from '../runs/service.js';
import { registerJobsRoutes } from './routes.js';
import { createJobsService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = '2026-10-25T00:00:00.000Z';

const stores: Store[] = [];
const directories: string[] = [];
const services: RunsService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

interface FakeEngine extends RunEngine {
  readonly starts: RunStartInput[];
}

function fakeEngine(): FakeEngine {
  const starts: RunStartInput[] = [];
  return {
    starts,
    start(input: RunStartInput): Promise<RunOutcome> {
      starts.push(input);
      return new Promise<RunOutcome>(() => undefined);
    },
    cancel(): Promise<boolean> {
      return Promise.resolve(false);
    },
    active(): readonly string[] {
      return starts.map((start) => start.runId);
    },
  };
}

function fakeWorkspaces(): Pick<WorkspaceManager, 'status'> {
  return {
    status(): Promise<WorkspaceStatus> {
      return Promise.resolve({
        branch: 'cb/run_x-fixture',
        baseSha: 'deadbee',
        headSha: 'deadbee',
        commitsAhead: 0,
        dirty: false,
        diff: { files: 0, added: 0, removed: 0, changedFiles: [] },
        changedPaths: [],
        protectedHits: [],
      });
    },
  };
}

interface RequestOptions {
  readonly token?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

interface Harness {
  readonly app: DaemonApp;
  readonly store: Store;
  readonly engine: FakeEngine;
  now(): Date;
  advance(seconds: number): void;
  device(scopes?: readonly Scope[]): string;
  call(method: string, path: string, options?: RequestOptions): Promise<Response>;
}

function harness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-15-jobs-routes-'));
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
  let now = new Date(NOW);
  const logger = createLogger({ level: 'error', sink: () => undefined });
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => now,
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  const app = createApp({ context });
  createAuthModule(context).register(app, context);
  const engine = fakeEngine();
  const runs = createRunsService({ context, engine, workspaces: fakeWorkspaces(), now: () => now });
  services.push(runs);
  registerJobsRoutes(app, createJobsService({ context, runs, now: () => now }));
  seedRepo(store);
  let devices = 0;

  return {
    app,
    store,
    engine,
    now: () => now,
    advance(seconds: number): void {
      now = new Date(now.getTime() + seconds * 1000);
    },
    device(scopes: readonly Scope[] = ['read', 'runs', 'write']): string {
      devices += 1;
      const id = `dev_jobsroutes${devices}`;
      store.devices.create({
        id,
        name: `Device ${devices}`,
        platform: 'cli',
        publicKey: null,
        fingerprint: null,
        scopes: [...scopes],
        refreshTokenHash: sha256Hex(id),
        refreshPreviousHash: null,
        refreshExpiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
        createdAt: NOW,
        lastSeenAt: null,
        revokedAt: null,
      });
      return mintAccessToken({
        deviceId: id,
        scopes,
        secret: SESSION_SECRET,
        now,
        ttlSeconds: 900,
      }).token;
    },
    async call(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
      const headers: Record<string, string> = { ...options.headers };
      if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      const init: RequestInit = { method, headers };
      if (options.body !== undefined) init.body = JSON.stringify(options.body);
      return app.request(path, init);
    },
  };
}

function seedRepo(store: Store): Repo {
  return store.repos.create({
    id: 'repo_test01',
    slug: 'dani/example',
    defaultBranch: 'main',
    gate: 'npm test',
    policy: 'auto',
    protectedPaths: ['.github/**'],
    enabled: true,
    createdAt: NOW,
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
  return parsed as Record<string, unknown>;
}

function errorOf(value: Record<string, unknown>): Record<string, unknown> {
  expect(() => errorEnvelopeSchema.parse(value)).not.toThrow();
  const error = value['error'];
  if (typeof error !== 'object' || error === null) throw new Error('no error body');
  return error as Record<string, unknown>;
}

function jobBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repoId: 'repo_test01',
    title: 'Nightly lockfile',
    prompt: 'Update the lockfile.',
    cron: '0 3 * * *',
    timezone: 'Europe/Madrid',
    ...overrides,
  };
}

describe('the jobs routes', () => {
  it('every jobs response parses with its contract schema', async () => {
    const test = harness();
    const token = test.device();

    const created = await test.call('POST', '/v1/jobs', { token, body: jobBody() });
    expect(created.status).toBe(201);
    const job = parseJob(await created.json());
    expect(job.nextFireAt).toBe('2026-10-25T02:00:00Z');

    const list = await test.call('GET', '/v1/jobs?limit=10', { token });
    expect(list.status).toBe(200);
    expect(pageOfJob.parse(await list.json()).data.map((entry) => entry.id)).toEqual([job.id]);

    const detail = await test.call('GET', `/v1/jobs/${job.id}`, { token });
    expect(detail.status).toBe(200);
    const detailBody = await body(detail);
    expect(Object.keys(detailBody).sort()).toEqual(['job', 'lastRuns', 'nextFires']);
    expect(parseJob(detailBody['job']).id).toBe(job.id);
    expect(detailBody['nextFires']).toHaveLength(5);

    const patched = await test.call('PATCH', `/v1/jobs/${job.id}`, {
      token,
      body: { title: 'Nightly lockfile v2' },
    });
    expect(patched.status).toBe(200);
    expect(parseJob(await patched.json()).title).toBe('Nightly lockfile v2');

    const paused = await test.call('POST', `/v1/jobs/${job.id}/pause`, { token });
    expect(paused.status).toBe(200);
    const pausedJob = parseJob(await paused.json());
    expect(pausedJob.enabled).toBe(false);
    expect(pausedJob.nextFireAt).toBeNull();

    const resumed = await test.call('POST', `/v1/jobs/${job.id}/resume`, { token });
    expect(resumed.status).toBe(200);
    expect(parseJob(await resumed.json()).nextFireAt).toBe('2026-10-25T02:00:00Z');

    const next = await test.call('GET', `/v1/jobs/${job.id}/next?count=3`, { token });
    expect(next.status).toBe(200);
    const nextBody = jobNextSchema.parse(await next.json());
    expect(nextBody.fires).toHaveLength(3);
    for (const fire of nextBody.fires) {
      expect(fire).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }

    const run = await test.call('POST', `/v1/jobs/${job.id}/run`, {
      token,
      headers: { 'idempotency-key': 'jobs-contract-run' },
    });
    expect(run.status).toBe(202);
    const runBody = parseRun(await run.json());
    expect(runBody.state).toBe('queued');
    expect(runBody.jobId).toBe(job.id);
    expect(test.engine.starts).toHaveLength(1);

    const removed = await test.call('DELETE', `/v1/jobs/${job.id}`, { token });
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe('');
    const gone = await test.call('GET', `/v1/jobs/${job.id}`, { token });
    expect(gone.status).toBe(404);
  });

  it('answers an invalid schedule, an unknown repo and an unknown job', async () => {
    const test = harness();
    const token = test.device();

    const invalid = await test.call('POST', '/v1/jobs', {
      token,
      body: jobBody({ cron: '61 3 * * *' }),
    });
    expect(invalid.status).toBe(422);
    expect(errorOf(await body(invalid))).toMatchObject({
      code: 'validation_failed',
      details: { path: 'job.cron', reason: 'range' },
    });

    const badShape = await test.call('POST', '/v1/jobs', {
      token,
      body: jobBody({ cron: '0 3 * *' }),
    });
    expect(badShape.status).toBe(422);
    expect(errorOf(await body(badShape))).toMatchObject({ details: { path: 'job.cron' } });

    const unknownKey = await test.call('POST', '/v1/jobs', {
      token,
      body: jobBody({ nope: true }),
    });
    expect(unknownKey.status).toBe(422);
    expect(errorOf(await body(unknownKey))).toMatchObject({ details: { path: 'job.nope' } });

    const unknownRepo = await test.call('POST', '/v1/jobs', {
      token,
      body: jobBody({ repoId: 'repo_missing' }),
    });
    expect(unknownRepo.status).toBe(422);
    expect(errorOf(await body(unknownRepo))).toMatchObject({ details: { path: 'job.repoId' } });

    const unknownJob = await test.call('GET', '/v1/jobs/job_zzzzzzzzzzzzzz', { token });
    expect(unknownJob.status).toBe(404);
    expect(errorOf(await body(unknownJob))).toMatchObject({
      code: 'not_found',
      details: { path: 'job.id' },
    });
  });

  it('pages jobs newest first and names a bad cursor', async () => {
    const test = harness();
    const token = test.device();
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      test.advance(1);
      const created = await test.call('POST', '/v1/jobs', {
        token,
        body: jobBody({ title: `Job ${index}` }),
      });
      ids.push(parseJob(await created.json()).id);
    }

    const first = await test.call('GET', '/v1/jobs?limit=2', { token });
    const firstPage = pageOfJob.parse(await first.json());
    expect(firstPage.data.map((entry) => entry.id)).toEqual([ids[2], ids[1]]);
    const second = await test.call(
      'GET',
      `/v1/jobs?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
      { token },
    );
    const secondPage = pageOfJob.parse(await second.json());
    expect(secondPage.data.map((entry) => entry.id)).toEqual([ids[0]]);
    expect(secondPage.nextCursor).toBeNull();

    const badCursor = await test.call('GET', '/v1/jobs?cursor=not-a-cursor', { token });
    expect(badCursor.status).toBe(422);
    expect(errorOf(await body(badCursor))).toMatchObject({
      code: 'validation_failed',
      details: { path: 'jobs.cursor' },
    });

    const badEnabled = await test.call('GET', '/v1/jobs?enabled=maybe', { token });
    expect(badEnabled.status).toBe(422);
  });

  it('requires the Idempotency-Key on run now', async () => {
    const test = harness();
    const token = test.device();
    const created = await test.call('POST', '/v1/jobs', { token, body: jobBody() });
    const job = parseJob(await created.json());
    const missing = await test.call('POST', `/v1/jobs/${job.id}/run`, { token });
    expect(missing.status).toBe(400);
    expect(errorOf(await body(missing))).toMatchObject({
      code: 'bad_request',
      details: { reason: 'idempotency_key_required' },
    });
    expect(test.engine.starts).toHaveLength(0);
  });

  it('refuses every jobs mutation to a read-only device', async () => {
    const test = harness();
    const writer = test.device();
    const created = await test.call('POST', '/v1/jobs', { token: writer, body: jobBody() });
    const job = parseJob(await created.json());
    const reader = test.device(['read']);

    const attempts: [string, string, unknown][] = [
      ['POST', '/v1/jobs', jobBody()],
      ['PATCH', `/v1/jobs/${job.id}`, { title: 'Nope' }],
      ['DELETE', `/v1/jobs/${job.id}`, undefined],
      ['POST', `/v1/jobs/${job.id}/pause`, undefined],
      ['POST', `/v1/jobs/${job.id}/resume`, undefined],
      ['POST', `/v1/jobs/${job.id}/run`, undefined],
    ];
    for (const [method, path, payload] of attempts) {
      const refused = await test.call(method, path, {
        token: reader,
        ...(payload === undefined ? {} : { body: payload }),
        headers: { 'idempotency-key': 'jobs-scope' },
      });
      expect(refused.status, path).toBe(403);
      expect(errorOf(await body(refused))).toMatchObject({
        code: 'forbidden',
        details: { reason: 'insufficient_scope' },
      });
    }
    expect(test.store.jobs.get(job.id)?.title).toBe('Nightly lockfile');
  });
});

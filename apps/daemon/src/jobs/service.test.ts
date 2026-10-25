import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Job, Repo } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import type { WorkspaceManager, WorkspaceStatus } from '@codebox/workspaces';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import type { RunEngine, RunOutcome, RunStartInput } from '../run/ports.js';
import { RunApiError } from '../runs/errors.js';
import { createRunsService } from '../runs/service.js';
import type { RunsService } from '../runs/service.js';
import { createJobsService, nextFireAt } from './service.js';
import type { JobsService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const DEVICE = 'dev_jobs00001';

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

interface Harness {
  readonly context: DaemonContext;
  readonly store: Store;
  readonly engine: FakeEngine;
  readonly jobs: JobsService;
  now(): Date;
  advance(seconds: number): void;
}

function harness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-15-jobs-service-'));
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
  let now = new Date('2026-10-25T00:00:00.000Z');
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
  const engine = fakeEngine();
  const runs = createRunsService({
    context,
    engine,
    workspaces: fakeWorkspaces(),
    now: () => now,
  });
  services.push(runs);
  seedRepo(store, () => now);
  const jobs = createJobsService({ context, runs, now: () => now });
  return {
    context,
    store,
    engine,
    jobs,
    now: () => now,
    advance(seconds: number): void {
      now = new Date(now.getTime() + seconds * 1000);
    },
  };
}

function seedRepo(store: Store, clock: () => Date): Repo {
  return store.repos.create({
    id: 'repo_test01',
    slug: 'dani/example',
    defaultBranch: 'main',
    gate: 'npm test',
    policy: 'auto',
    protectedPaths: ['.github/**'],
    enabled: true,
    createdAt: clock().toISOString(),
  });
}

function createJob(
  harness: Harness,
  overrides: Partial<Parameters<JobsService['create']>[0]> = {},
): Job {
  return harness.jobs.create({
    repoId: 'repo_test01',
    title: 'Nightly lockfile',
    prompt: 'Update the lockfile.',
    cron: '0 3 * * *',
    timezone: 'Europe/Madrid',
    ...overrides,
  });
}

function refusal(run: () => unknown): RunApiError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RunApiError);
    return error as RunApiError;
  }
  throw new Error('expected a refusal');
}

function changes(store: Store): string[] {
  return store.events
    .readAfterId(0, 100)
    .filter((event) => event.type === 'job.changed')
    .map((event) => String(event.data['change']));
}

describe('nextFireAt', () => {
  it('resolves the Madrid fall-back the way the scheduler does', () => {
    // 2026-10-25 is the EU fall-back: 03:00 local happens once, at 02:00Z (CET), never at 01:00Z.
    expect(
      nextFireAt(
        { cron: '0 3 * * *', timezone: 'Europe/Madrid' },
        new Date('2026-10-25T00:00:00Z'),
      ),
    ).toEqual({ ok: true, nextFireAt: '2026-10-25T02:00:00Z' });
    expect(
      nextFireAt({ cron: '0 3 * * *', timezone: 'UTC' }, new Date('2026-10-25T00:00:00Z')),
    ).toEqual({ ok: true, nextFireAt: '2026-10-25T03:00:00Z' });
    expect(
      nextFireAt(
        { cron: '0 5 * * *', timezone: 'Europe/Madrid' },
        new Date('2026-10-25T00:00:00Z'),
      ),
    ).toEqual({ ok: true, nextFireAt: '2026-10-25T04:00:00Z' });
  });

  it('names the failing field and the cron failure code', () => {
    expect(
      nextFireAt({ cron: '0 3 * *', timezone: 'UTC' }, new Date('2026-10-25T00:00:00Z')),
    ).toMatchObject({ ok: false, field: 'cron', code: 'field_count' });
    expect(
      nextFireAt({ cron: '61 3 * * *', timezone: 'UTC' }, new Date('2026-10-25T00:00:00Z')),
    ).toMatchObject({ ok: false, field: 'cron', code: 'range' });
    expect(
      nextFireAt({ cron: '0 3 * * *', timezone: 'Mars/Olympus' }, new Date('2026-10-25T00:00:00Z')),
    ).toMatchObject({ ok: false, field: 'timezone', code: 'timezone' });
    expect(
      nextFireAt({ cron: '0 0 30 2 *', timezone: 'UTC' }, new Date('2026-10-25T00:00:00Z')),
    ).toMatchObject({ ok: false, field: 'cron', code: 'no_fire' });
  });
});

describe('the jobs service', () => {
  it('creates a job with the repo policy and the configured agent defaults', () => {
    const test = harness();
    const job = createJob(test);
    expect(job).toMatchObject({
      repoId: 'repo_test01',
      title: 'Nightly lockfile',
      mode: 'work',
      agent: 'build',
      model: null,
      cron: '0 3 * * *',
      timezone: 'Europe/Madrid',
      enabled: true,
      policy: 'auto',
      createdAt: '2026-10-25T00:00:00.000Z',
      nextFireAt: '2026-10-25T02:00:00Z',
    });
    expect(job.id).toMatch(/^job_[0-9A-Z]{20}$/);
    expect(test.store.jobs.get(job.id)).toEqual(job);
    expect(changes(test.store)).toEqual(['created']);
    const event = test.store.events
      .readAfterId(0, 10)
      .find((entry) => entry.type === 'job.changed');
    expect(event?.data).toEqual({
      jobId: job.id,
      change: 'created',
      ts: '2026-10-25T00:00:00.000Z',
    });
    expect(event?.runId).toBeNull();
    expect(event?.chatId).toBeNull();
    expect(event?.seq).toBeNull();
  });

  it('lets the body override the policy and rejects an invalid schedule', () => {
    const test = harness();
    expect(createJob(test, { policy: 'manual' }).policy).toBe('manual');
    const invalid = refusal(() => createJob(test, { cron: '61 3 * * *' }));
    expect(invalid.status).toBe(422);
    expect(invalid.details).toEqual({ path: 'job.cron', reason: 'range' });
    const badZone = refusal(() => createJob(test, { timezone: 'Mars/Olympus' }));
    expect(badZone.details).toEqual({ path: 'job.timezone', reason: 'timezone' });
    const badRepo = refusal(() => createJob(test, { repoId: 'repo_missing' }));
    expect(badRepo.status).toBe(422);
    expect(badRepo.details).toEqual({ path: 'job.repoId' });
    expect(test.store.jobs.list({ limit: 10, cursor: null }).data).toHaveLength(1);
  });

  it('answers the detail with the last five runs and five next fires', () => {
    const test = harness();
    const job = createJob(test);
    for (let index = 0; index < 6; index += 1) {
      test.advance(1);
      test.jobs.runNow(job.id, { deviceId: DEVICE, idempotencyKey: `run-${index}` });
    }
    const detail = test.jobs.get(job.id);
    expect(detail.job.id).toBe(job.id);
    expect(detail.lastRuns).toHaveLength(5);
    expect(detail.nextFires).toHaveLength(5);
    for (const fire of detail.nextFires)
      expect(fire).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('recomputes the next fire on a cron patch and clears it when disabled', () => {
    const test = harness();
    const job = createJob(test);
    test.advance(3_600);
    const patched = test.jobs.patch(job.id, { cron: '0 5 * * *' });
    expect(patched.cron).toBe('0 5 * * *');
    expect(patched.nextFireAt).toBe('2026-10-25T04:00:00Z');
    expect(changes(test.store)).toEqual(['created', 'updated']);

    const paused = test.jobs.patch(job.id, { enabled: false });
    expect(paused.enabled).toBe(false);
    expect(paused.nextFireAt).toBeNull();

    const resumed = test.jobs.patch(job.id, { enabled: true });
    expect(resumed.enabled).toBe(true);
    expect(resumed.nextFireAt).toBe('2026-10-25T04:00:00Z');

    const invalid = refusal(() => test.jobs.patch(job.id, { cron: '99 5 * * *' }));
    expect(invalid.details).toEqual({ path: 'job.cron', reason: 'range' });
  });

  it('pauses and resumes through the two routes that own the switch', () => {
    const test = harness();
    const job = createJob(test);
    const paused = test.jobs.pause(job.id);
    expect(paused.enabled).toBe(false);
    expect(paused.nextFireAt).toBeNull();
    test.advance(60);
    const resumed = test.jobs.resume(job.id);
    expect(resumed.enabled).toBe(true);
    expect(resumed.nextFireAt).toBe('2026-10-25T02:00:00Z');
    expect(changes(test.store)).toEqual(['created', 'paused', 'resumed']);
  });

  it('returns three formatted fires for the preview', () => {
    const test = harness();
    const job = createJob(test);
    const fires = test.jobs.next(job.id, 3);
    expect(fires).toHaveLength(3);
    expect(fires.every((fire) => fire.endsWith('Z'))).toBe(true);
    expect(fires[0]).toBe('2026-10-25T02:00:00Z');
    expect(fires).toEqual([...fires].sort());
  });

  it('runs a paused job now and keeps the job id on the run', () => {
    const test = harness();
    const job = createJob(test);
    test.jobs.pause(job.id);
    const run = test.jobs.runNow(job.id, { deviceId: DEVICE, idempotencyKey: 'run-now' });
    expect(run.state).toBe('queued');
    expect(run.jobId).toBe(job.id);
    expect(run.trigger).toBe('manual');
    expect(run.repoId).toBe('repo_test01');
    expect(test.engine.starts.at(-1)).toMatchObject({
      jobId: job.id,
      prompt: 'Update the lockfile.',
    });

    const replay = test.jobs.runNow(job.id, { deviceId: DEVICE, idempotencyKey: 'run-now' });
    expect(replay.id).toBe(run.id);
    expect(test.engine.starts).toHaveLength(1);
    const events = test.store.events
      .readAfterId(0, 100)
      .filter((event) => event.type === 'run.queued');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ jobId: job.id, trigger: 'manual' });
  });

  it('deletes a job, logs the change and keeps its runs', () => {
    const test = harness();
    const job = createJob(test);
    const run = test.jobs.runNow(job.id, { deviceId: DEVICE, idempotencyKey: 'run-delete' });
    test.jobs.remove(job.id);
    expect(test.store.jobs.get(job.id)).toBeNull();
    expect(test.store.runs.get(run.id)?.jobId).toBeNull();
    expect(changes(test.store)).toEqual(['created', 'deleted']);
  });

  it('lists newest first, filters by repo and enabled, and pages by cursor', () => {
    const test = harness();
    const first = createJob(test, { title: 'First' });
    test.advance(1);
    const second = createJob(test, { title: 'Second' });
    test.advance(1);
    const third = createJob(test, { title: 'Third' });
    test.jobs.pause(third.id);

    const all = test.jobs.list({ limit: 10, cursor: null });
    expect(all.data.map((job) => job.id)).toEqual([third.id, second.id, first.id]);

    const page = test.jobs.list({ limit: 2, cursor: null });
    expect(page.data.map((job) => job.id)).toEqual([third.id, second.id]);
    expect(page.nextCursor).not.toBeNull();
    const rest = test.jobs.list({ limit: 2, cursor: page.nextCursor });
    expect(rest.data.map((job) => job.id)).toEqual([first.id]);
    expect(rest.nextCursor).toBeNull();

    expect(test.jobs.list({ limit: 10, cursor: null, enabled: false }).data).toHaveLength(1);
    expect(test.jobs.list({ limit: 10, cursor: null, repoId: 'repo_missing' }).data).toHaveLength(
      0,
    );
  });

  it('answers an unknown job with 404 job.id on every path', () => {
    const test = harness();
    for (const run of [
      () => test.jobs.get('job_zzzzzzzzzzzzzz'),
      () => test.jobs.remove('job_zzzzzzzzzzzzzz'),
      () => test.jobs.patch('job_zzzzzzzzzzzzzz', { title: 'x' }),
      () => test.jobs.pause('job_zzzzzzzzzzzzzz'),
      () => test.jobs.resume('job_zzzzzzzzzzzzzz'),
      () => test.jobs.next('job_zzzzzzzzzzzzzz', 3),
    ]) {
      const error = refusal(run);
      expect(error.status).toBe(404);
      expect(error.details).toEqual({ path: 'job.id' });
    }
  });
});

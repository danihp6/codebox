import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Approval, Repo, Run } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import type { WorkspaceManager, WorkspaceStatus, Worktree } from '@codebox/workspaces';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import type { RunEngine, RunOutcome, RunStartInput } from '../run/ports.js';
import { RunApiError } from './errors.js';
import { createRunsService, runsService } from './service.js';
import type { RunsService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const DEVICE = 'dev_routes0';

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
  readonly cancels: { readonly runId: string; readonly reason: string | undefined }[];
}

function fakeEngine(): FakeEngine {
  const starts: RunStartInput[] = [];
  const cancels: { runId: string; reason: string | undefined }[] = [];
  return {
    starts,
    cancels,
    start(input: RunStartInput): Promise<RunOutcome> {
      starts.push(input);
      // A live run: the route answers while the flow is still in flight.
      return new Promise<RunOutcome>(() => undefined);
    },
    cancel(runId: string, reason?: 'operator' | 'timeout' | 'cost_cap_reached'): Promise<boolean> {
      cancels.push({ runId, reason });
      return Promise.resolve(true);
    },
    active(): readonly string[] {
      return starts.map((start) => start.runId);
    },
  };
}

function fakeWorkspaces(): Pick<WorkspaceManager, 'status'> {
  return {
    status(worktree: Worktree): Promise<WorkspaceStatus> {
      return Promise.resolve({
        branch: worktree.branch,
        baseSha: worktree.baseSha,
        headSha: worktree.baseSha,
        commitsAhead: 1,
        dirty: false,
        diff: {
          files: 2,
          added: 12,
          removed: 3,
          changedFiles: [
            { path: 'src/a.ts', status: 'modified', added: 12, removed: 3 },
            { path: 'src/b.ts', status: 'added', added: 4, removed: 0 },
          ],
        },
        changedPaths: ['src/a.ts', 'src/b.ts'],
        protectedHits: [],
      });
    },
  };
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

interface Harness {
  readonly context: DaemonContext;
  readonly store: Store;
  readonly engine: FakeEngine;
  readonly service: RunsService;
  now(): Date;
  advance(seconds: number): void;
}

function harness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-15-runs-service-'));
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
  const service = createRunsService({
    context,
    engine,
    workspaces: fakeWorkspaces(),
    now: () => now,
  });
  services.push(service);
  seedRepo(store, () => now);
  return {
    context,
    store,
    engine,
    service,
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

function createRun(harness: Harness, prompt = 'Fix the lockfile'): Run {
  return harness.service.createRun({
    repoId: 'repo_test01',
    prompt,
    mode: 'work',
    deviceId: DEVICE,
    idempotencyKey: `key-${prompt}`,
  });
}

function seedApproval(store: Store, clock: () => Date, runId: string | null): Approval {
  const at = clock();
  return store.approvals.create({
    id: 'apv_test0001',
    state: 'pending',
    tool: 'bash',
    title: 'Run the tests',
    runId,
    chatId: runId === null ? 'chat_test01' : null,
    input: { command: 'npm test' },
    createdAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + 600_000).toISOString(),
    resolvedAt: null,
  });
}

describe('createRun', () => {
  it('creates the queued row, its event and the engine start in that order', () => {
    const test = harness();
    const run = createRun(test);
    expect(run.state).toBe('queued');
    expect(run.jobId).toBeNull();
    expect(run.trigger).toBe('manual');
    expect(run.baseRef).toBe('main');
    expect(run.branch).toMatch(/^cb\/run_[0-9A-Z]{20}-fix-the-lockfile$/);
    expect(run.cost).toEqual({ usd: 0, tokensIn: 0, tokensOut: 0 });
    expect(run.finishedAt).toBeNull();

    const events = test.store.events.readRunAfterSeq(run.id, 0, 10);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'run.queued', seq: 1 });
    expect(events[0]?.data).toMatchObject({
      runId: run.id,
      repoId: 'repo_test01',
      jobId: null,
      trigger: 'manual',
    });

    expect(test.engine.starts).toHaveLength(1);
    expect(test.engine.starts[0]).toMatchObject({
      runId: run.id,
      jobId: null,
      trigger: 'manual',
      title: 'Fix the lockfile',
      prompt: 'Fix the lockfile',
      agent: 'build',
      model: null,
      baseRef: 'main',
      repo: {
        id: 'repo_test01',
        slug: 'dani/example',
        defaultBranch: 'main',
        gate: 'npm test',
        policy: 'auto',
        protectedPaths: ['.github/**'],
        cloneUrl: 'https://github.com/dani/example.git',
      },
    });
  });

  it('answers an unknown repository with 422 run.repoId', () => {
    const test = harness();
    const error = refusal(() =>
      test.service.createRun({
        repoId: 'repo_missing',
        prompt: 'x',
        mode: 'work',
        deviceId: DEVICE,
        idempotencyKey: 'k',
      }),
    );
    expect(error.status).toBe(422);
    expect(error.details).toEqual({ path: 'run.repoId' });
    expect(test.engine.starts).toHaveLength(0);
  });
});

describe('cancel', () => {
  it('records the operator reason for a queued run', async () => {
    const test = harness();
    const run = createRun(test);
    const cancelled = await test.service.cancel(run.id);
    expect(cancelled.id).toBe(run.id);
    expect(test.engine.cancels).toEqual([{ runId: run.id, reason: 'operator' }]);
  });

  it('refuses a merging or finished run without touching the engine', async () => {
    const test = harness();
    const merging = createRun(test, 'merging run');
    test.store.runs.update(merging.id, { state: 'merging' });
    await expect(test.service.cancel(merging.id)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'run_not_cancellable' },
    });
    const succeeded = createRun(test, 'succeeded run');
    test.store.runs.update(succeeded.id, { state: 'succeeded' });
    await expect(test.service.cancel(succeeded.id)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'run_not_cancellable' },
    });
    expect(test.engine.cancels).toEqual([]);
  });
});

describe('event replay', () => {
  it('pages by event id and closes the page at the limit', () => {
    const test = harness();
    const run = createRun(test);
    test.store.events.append({
      runId: run.id,
      chatId: null,
      seq: 2,
      type: 'run.started',
      data: { runId: run.id, seq: 2, ts: test.now().toISOString(), branch: run.branch },
      ts: test.now().toISOString(),
    });
    test.store.events.append({
      runId: run.id,
      chatId: null,
      seq: 3,
      type: 'run.finished',
      data: { runId: run.id, seq: 3, ts: test.now().toISOString(), state: 'succeeded' },
      ts: test.now().toISOString(),
    });

    const page = test.service.events(run.id, 1, 2);
    expect(page.data.map((item) => item.id)).toEqual([2, 3]);
    expect(page.nextCursor).toBe('3');
    expect(Object.keys(page.data[0] ?? {})).toEqual(['id', 'seq', 'type', 'data', 'ts']);
    expect(test.service.events(run.id, 3, 2)).toEqual({ data: [], nextCursor: null });
  });

  it('answers an unknown run with 404 before reading any event', () => {
    const test = harness();
    const error = refusal(() => test.service.events('run_zzzzzzzzzzzzzz', 0, 10));
    expect(error.status).toBe(404);
    expect(error.details).toEqual({ path: 'run.id' });
  });
});

describe('revert', () => {
  it('opens a revert run with the merge commit of the run.merged event', () => {
    const test = harness();
    const run = createRun(test);
    test.store.runs.update(run.id, {
      state: 'succeeded',
      pr: { number: 42, url: 'https://github.com/dani/example/pull/42', mergeable: true },
    });
    test.store.events.append({
      runId: run.id,
      chatId: null,
      seq: 2,
      type: 'run.merged',
      data: {
        runId: run.id,
        seq: 2,
        ts: test.now().toISOString(),
        pr: { number: 42, url: 'https://github.com/dani/example/pull/42', mergeable: true },
        mergeCommit: 'abc1234',
        method: 'squash',
      },
      ts: test.now().toISOString(),
    });

    const revert = test.service.revert({
      runId: run.id,
      deviceId: DEVICE,
      idempotencyKey: 'revert-1',
    });
    expect(revert.trigger).toBe('revert');
    expect(revert.state).toBe('queued');
    expect(revert.jobId).toBeNull();
    expect(revert.baseRef).toBe('main');
    expect(test.engine.starts.at(-1)?.prompt).toBe(
      `Revert run ${run.id}. Open a pull request that reverts merge commit abc1234 and leave the gate and guardrails unchanged.`,
    );
  });

  it('falls back to the PR number when the merged event is gone', () => {
    const test = harness();
    const run = createRun(test);
    test.store.runs.update(run.id, {
      state: 'succeeded',
      pr: { number: 7, url: 'https://github.com/dani/example/pull/7', mergeable: true },
    });
    test.service.revert({ runId: run.id, deviceId: DEVICE, idempotencyKey: 'revert-2' });
    expect(test.engine.starts.at(-1)?.prompt).toContain('reverts merge commit 7 and');
  });

  it('refuses a run that did not succeed or has no pull request', () => {
    const test = harness();
    const run = createRun(test);
    const notSucceeded = refusal(() =>
      test.service.revert({ runId: run.id, deviceId: DEVICE, idempotencyKey: 'revert-3' }),
    );
    expect(notSucceeded.status).toBe(409);
    expect(notSucceeded.details).toEqual({ reason: 'run_not_revertible' });
    test.store.runs.update(run.id, { state: 'succeeded' });
    const noPullRequest = refusal(() =>
      test.service.revert({ runId: run.id, deviceId: DEVICE, idempotencyKey: 'revert-4' }),
    );
    expect(noPullRequest.status).toBe(409);
    expect(noPullRequest.details).toEqual({ reason: 'run_not_revertible' });
  });
});

describe('diff', () => {
  it('refuses a run without a worktree', async () => {
    const test = harness();
    const run = createRun(test);
    await expect(test.service.diff(run.id)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'diff_unavailable' },
    });
  });

  it('reads the worktree status as a RunDiff', async () => {
    const test = harness();
    const run = createRun(test);
    test.store.runs.update(run.id, { worktree: '/tmp/cb-worktree', baseSha: 'deadbee' });
    const diff = await test.service.diff(run.id);
    expect(diff.files).toBe(2);
    expect(diff.changedFiles.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('approvals', () => {
  it('resolves allow once and appends one approval.resolved', () => {
    const test = harness();
    const run = createRun(test);
    seedApproval(test.store, test.now, run.id);

    const resolved = test.service.replyApproval({
      id: 'apv_test0001',
      decision: 'allow',
      scope: 'once',
    });
    expect(resolved.state).toBe('allowed');
    expect(resolved.resolvedAt).not.toBeNull();

    const events = test.store.events
      .readAfterId(0, 50)
      .filter((event) => event.type === 'approval.resolved');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ approvalId: 'apv_test0001', decision: 'allow' });

    const second = refusal(() =>
      test.service.replyApproval({ id: 'apv_test0001', decision: 'deny', scope: 'session' }),
    );
    expect(second.status).toBe(409);
    expect(second.details).toEqual({ reason: 'approval_already_answered' });
    expect(test.engine.cancels).toEqual([]);
    expect(test.engine.starts).toHaveLength(1);
  });

  it('denies a pending approval with its own decision', () => {
    const test = harness();
    const run = createRun(test);
    seedApproval(test.store, test.now, run.id);
    const resolved = test.service.replyApproval({
      id: 'apv_test0001',
      decision: 'deny',
      scope: 'session',
    });
    expect(resolved.state).toBe('denied');
    const events = test.store.events
      .readAfterId(0, 50)
      .filter((event) => event.type === 'approval.resolved');
    expect(events[0]?.data).toMatchObject({ decision: 'deny' });
  });

  it('expires a pending approval whose expiry has passed', () => {
    const test = harness();
    const run = createRun(test);
    seedApproval(test.store, test.now, run.id);
    test.advance(601);

    expect(test.service.sweepApprovals()).toBe(1);
    const approval = test.store.approvals.get('apv_test0001');
    expect(approval?.state).toBe('expired');
    expect(approval?.resolvedAt).toBe(test.now().toISOString());
    const events = test.store.events
      .readAfterId(0, 50)
      .filter((event) => event.type === 'approval.resolved');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ decision: 'expired' });
    expect(test.service.sweepApprovals()).toBe(0);
  });

  it('answers an unknown approval with 404', () => {
    const test = harness();
    const error = refusal(() =>
      test.service.replyApproval({ id: 'apv_zzzzzz', decision: 'allow', scope: 'once' }),
    );
    expect(error.status).toBe(404);
    expect(error.details).toEqual({ path: 'approval.id' });
  });
});

describe('the shared instance', () => {
  it('returns the same service, and therefore the same engine, for one context', () => {
    const test = harness();
    const first = runsService(test.context);
    const second = runsService(test.context);
    services.push(first);
    expect(second).toBe(first);
    expect(second.engine()).toBe(first.engine());
  });

  it('stops the sweep interval without throwing twice', () => {
    const test = harness();
    test.service.sweepApprovals();
    test.service.stop();
    expect(() => test.service.stop()).not.toThrow();
  });
});

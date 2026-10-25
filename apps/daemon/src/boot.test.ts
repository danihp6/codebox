import { mkdirSync, mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runFailedDataSchema } from '@codebox/contracts';
import type { Repo } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { RunRecord, Store } from '@codebox/store';
import { loadConfig, resolvePaths } from './config.js';
import type { StatePaths } from './config.js';
import { ORPHAN_FAILURE_CODE, ORPHAN_FAILURE_MESSAGE, reconcile } from './boot.js';
import { createLogger } from './logger.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-10-25T12:00:00.000Z');
const NOW_ISO = '2026-10-25T12:00:00.000Z';
const CREATED_AT = '2026-10-25T11:00:00.000Z';

const REPO: Repo = {
  id: 'repo_000001',
  slug: 'octo/hello',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: ['.github/**'],
  enabled: true,
  createdAt: CREATED_AT,
};

const stores: Store[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runRecord(id: string, state: RunRecord['state']): RunRecord {
  return {
    id,
    repoId: REPO.id,
    jobId: null,
    state,
    trigger: 'manual',
    branch: `cb/${id}-work`,
    baseRef: 'main',
    pr: null,
    gate: null,
    guardrails: [],
    blockers: [],
    diff: null,
    cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
    createdAt: CREATED_AT,
    finishedAt: null,
    baseSha: null,
    worktree: null,
    sessionId: null,
    prompt: 'do the work',
    promptHash: null,
    agent: 'build',
    model: null,
    gateCommand: null,
    scheduledFor: null,
    attempt: 1,
    failureCode: null,
    failureMessage: null,
    startedAt: null,
  };
}

interface Harness {
  readonly store: Store;
  readonly paths: StatePaths;
  readonly lines: Record<string, unknown>[];
  readonly deps: Parameters<typeof reconcile>[0];
}

function harness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-11-boot-'));
  temporaryDirectories.push(directory);
  const paths = resolvePaths(
    loadConfig({
      CB_ENV: 'test',
      CB_SESSION_SECRET: SESSION_SECRET,
      CB_STATE_DIR: join(directory, 'state'),
    }),
  );
  mkdirSync(paths.locksDir, { recursive: true });
  const store = openInMemoryStore();
  stores.push(store);
  store.repos.create(REPO);
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'trace',
    now: () => NOW,
    sink: (line) => lines.push(JSON.parse(line)),
  });
  return {
    store,
    paths,
    lines,
    deps: { store, logger, paths, clock: () => NOW },
  };
}

function lock(directory: string, name: string, value: unknown): void {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  writeFileSync(join(directory, name), body);
}

describe('reconcile — orphaned runs', () => {
  it('marks a live run failed and appends one run.failed event', () => {
    const { store, deps, lines } = harness();
    store.runs.create(runRecord('run_000001', 'running'));

    const result = reconcile(deps);

    expect(result.failedRuns).toEqual(['run_000001']);
    const record = store.runs.getRecord('run_000001');
    expect(record?.state).toBe('failed');
    expect(record?.failureCode).toBe(ORPHAN_FAILURE_CODE);
    expect(record?.failureMessage).toBe(ORPHAN_FAILURE_MESSAGE);
    expect(record?.finishedAt).toBe(NOW_ISO);

    const events = store.events.readRunAfterSeq('run_000001', 0, 10);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('run.failed');
    expect(events[0]?.seq).toBe(1);
    expect(events[0]?.ts).toBe(NOW_ISO);
    expect(() => runFailedDataSchema.parse(events[0]?.data)).not.toThrow();
    expect(events[0]?.data).toMatchObject({
      runId: 'run_000001',
      seq: 1,
      ts: NOW_ISO,
      state: 'failed',
      code: ORPHAN_FAILURE_CODE,
      message: ORPHAN_FAILURE_MESSAGE,
    });

    const logged = lines.filter((line) => line['msg'] === 'run_orphaned');
    expect(logged).toEqual([
      { ts: NOW_ISO, level: 'warn', msg: 'run_orphaned', runId: 'run_000001', state: 'running' },
    ]);
  });

  it('is idempotent: a second pass finds nothing and appends nothing', () => {
    const { store, deps } = harness();
    store.runs.create(runRecord('run_000001', 'running'));

    expect(reconcile(deps).failedRuns).toEqual(['run_000001']);
    expect(reconcile(deps).failedRuns).toEqual([]);
    expect(store.events.readRunAfterSeq('run_000001', 0, 10)).toHaveLength(1);
  });

  it('sweeps every non-terminal state and leaves terminal runs alone', () => {
    const { store, deps } = harness();
    const liveStates = ['queued', 'preparing', 'gating', 'pr_open', 'merging'] as const;
    liveStates.forEach((state, index) => {
      store.runs.create(runRecord(`run_00000${index}`, state));
    });
    store.runs.create(runRecord('run_000099', 'succeeded'));
    store.runs.create(runRecord('run_000098', 'cancelled'));

    const result = reconcile(deps);

    expect([...result.failedRuns].sort()).toHaveLength(5);
    expect(store.runs.getRecord('run_000099')?.state).toBe('succeeded');
    expect(store.runs.getRecord('run_000098')?.state).toBe('cancelled');
    expect(store.events.readRunAfterSeq('run_000099', 0, 10)).toHaveLength(0);
  });

  it('measures its own duration with the injected clock', () => {
    const { deps } = harness();
    expect(reconcile(deps).durationMs).toBe(0);
  });
});

describe('reconcile — stale locks', () => {
  it('removes a lock whose process is gone', () => {
    const { paths, deps } = harness();
    lock(paths.locksDir, 'dead.lock', { pid: 999_999, at: NOW_ISO });
    const result = reconcile(deps);
    expect(result.removedLocks).toEqual(['dead.lock']);
    expect(readdirSync(paths.locksDir)).toEqual([]);
  });

  it('removes a lock older than the stale window', () => {
    const { paths, deps } = harness();
    lock(paths.locksDir, 'old.lock', { pid: process.pid, at: '2026-10-25T11:58:00.000Z' });
    const result = reconcile(deps);
    expect(result.removedLocks).toEqual(['old.lock']);
  });

  it('removes a malformed lock and logs it', () => {
    const { paths, deps, lines } = harness();
    lock(paths.locksDir, 'broken.lock', 'not json');
    lock(paths.locksDir, 'nopid.lock', { at: NOW_ISO });
    const result = reconcile(deps);
    expect(result.removedLocks).toEqual(['broken.lock', 'nopid.lock']);
    expect(lines.filter((line) => line['msg'] === 'lock_malformed')).toHaveLength(2);
  });

  it('keeps a live, fresh lock', () => {
    const { paths, deps } = harness();
    lock(paths.locksDir, 'live.lock', { pid: process.pid, at: NOW_ISO });
    const result = reconcile(deps);
    expect(result.removedLocks).toEqual([]);
    expect(readdirSync(paths.locksDir)).toEqual(['live.lock']);
  });

  it('honours an injected stale window and liveness check', () => {
    const { paths, deps } = harness();
    lock(paths.locksDir, 'fresh.lock', { pid: 4242, at: '2026-10-25T11:59:30.000Z' });
    const kept = reconcile({ ...deps, staleLockMs: 60_000, isProcessAlive: () => true });
    expect(kept.removedLocks).toEqual([]);
    const removed = reconcile({ ...deps, staleLockMs: 1000, isProcessAlive: () => true });
    expect(removed.removedLocks).toEqual(['fresh.lock']);
  });

  it('accepts a missing locks directory', () => {
    const { paths, deps } = harness();
    rmSync(paths.locksDir, { recursive: true, force: true });
    expect(reconcile(deps).removedLocks).toEqual([]);
  });
});

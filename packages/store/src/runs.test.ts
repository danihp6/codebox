import type { Job, Repo, Run } from '@codebox/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreError } from './errors.js';
import { openInMemoryStore, openStore, type Store } from './store.js';
import { toRun, type ClaimScheduledRunInput, type RunRecord } from './runs.js';

const REPO: Repo = {
  id: 'repo_000001',
  slug: 'octo/hello',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: ['.github/**'],
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const SCHEDULED_JOB: Job = {
  id: 'job_0000001',
  repoId: REPO.id,
  title: 'Nightly lockfile',
  prompt: 'update the lockfile and run the gate',
  mode: 'work',
  agent: 'build',
  model: null,
  cron: '0 1 * * *',
  timezone: 'UTC',
  enabled: true,
  policy: 'auto',
  createdAt: '2026-01-01T00:00:00.000Z',
  nextFireAt: '2026-01-02T01:00:00.000Z',
};

function storeErrorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof StoreError ? error.code : 'unexpected-error';
  }
  return 'no-error';
}

function runRecord(
  id: string,
  repoId: string,
  createdAt: string,
  overrides: Partial<RunRecord> = {},
): RunRecord {
  return {
    id,
    repoId,
    jobId: null,
    state: 'queued',
    trigger: 'manual',
    branch: `cb/${id}-work`,
    baseRef: 'main',
    pr: null,
    gate: null,
    guardrails: [],
    blockers: [],
    diff: null,
    cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
    createdAt,
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
    ...overrides,
  };
}

let directory: string;
const stores: Store[] = [];

function track(store: Store): Store {
  stores.push(store);
  return store;
}

function claimInput(runId: string): ClaimScheduledRunInput {
  return {
    jobId: SCHEDULED_JOB.id,
    scheduledFor: '2026-01-02T01:00:00.000Z',
    runId,
    now: '2026-01-02T01:00:01.000Z',
    branch: `cb/${runId}-nightly-lockfile`,
    baseRef: 'main',
    agent: 'build',
    model: null,
    prompt: 'update the lockfile and run the gate',
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'codebox-store-runs-'));
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('runs', () => {
  it('the claim transaction returns one winner under 20 attempts', () => {
    const path = join(directory, 'state.db');
    const store = track(openStore({ path }));
    store.repos.create(REPO);
    store.jobs.create(SCHEDULED_JOB);

    const results: (RunRecord | null)[] = [];
    for (let index = 0; index < 20; index += 1) {
      results.push(
        store.runs.claimScheduledRun(claimInput(`run_${String(index).padStart(7, '0')}`)),
      );
    }
    const second = track(openStore({ path }));
    results.push(second.runs.claimScheduledRun(claimInput('run_0000099')));

    const winners = results.filter((record): record is RunRecord => record !== null);
    expect(winners).toHaveLength(1);
    const winner = winners[0];
    expect(winner?.scheduledFor).toBe('2026-01-02T01:00:00.000Z');
    expect(winner?.state).toBe('queued');
    expect(winner?.trigger).toBe('schedule');
    expect(winner?.attempt).toBe(1);
    expect(winner?.jobId).toBe(SCHEDULED_JOB.id);
    expect(winner?.repoId).toBe(REPO.id);
    expect(winner?.guardrails).toEqual([]);
    expect(winner?.blockers).toEqual([]);
    expect(winner?.cost).toEqual({ usd: 0, tokensIn: 0, tokensOut: 0 });
    expect(winner?.finishedAt).toBeNull();
    expect(winner?.createdAt).toBe('2026-01-02T01:00:01.000Z');
    expect(store.runs.countLive(REPO.id)).toBe(1);
    expect(store.runs.listByJob(SCHEDULED_JOB.id, 10)).toHaveLength(1);
  });

  it('claiming for a missing or paused job returns null', () => {
    const store = track(openInMemoryStore());
    store.repos.create(REPO);
    store.jobs.create(SCHEDULED_JOB);
    store.jobs.update(SCHEDULED_JOB.id, { enabled: false });
    expect(store.runs.claimScheduledRun(claimInput('run_0000001'))).toBeNull();
    expect(
      store.runs.claimScheduledRun({ ...claimInput('run_0000002'), jobId: 'job_0000404' }),
    ).toBeNull();
    expect(store.runs.countLive()).toBe(0);
  });

  it('round-trips a run through the contract shape', () => {
    const store = track(openInMemoryStore());
    store.repos.create(REPO);
    const record = runRecord('run_0000001', REPO.id, '2026-01-01T00:00:00.000Z', {
      jobId: null,
      state: 'pr_open',
      trigger: 'schedule',
      baseSha: 'abc1234',
      worktree: '/srv/codebox/worktrees/run_0000001',
      sessionId: 'ses_1',
      prompt: 'update the lockfile',
      promptHash: 'sha256-hash',
      model: 'opencode-go/deepseek-v4.1-flash',
      gateCommand: 'npm test',
      scheduledFor: '2026-01-01T00:00:00.000Z',
      attempt: 2,
      pr: { number: 42, url: 'https://github.com/octo/hello/pull/42', mergeable: true },
      gate: { status: 'passed', exitCode: 0, durationMs: 184000 },
      guardrails: [
        { id: 'gate', state: 'pass' },
        { id: 'base', state: 'fail', reason: 'base_moved' },
      ],
      blockers: [{ code: 'base_moved', message: 'main moved during the run.' }],
      diff: { files: 6, added: 184, removed: 22 },
      cost: { usd: 0.42, tokensIn: 18200, tokensOut: 3100 },
      startedAt: '2026-01-01T00:01:00.000Z',
    });

    const created = store.runs.create(record);
    expect(created).toEqual(record);
    const fetched = store.runs.getRecord('run_0000001');
    expect(fetched).toEqual(record);
    const run: Run | null = store.runs.get('run_0000001');
    expect(run).not.toBeNull();
    if (run === null) return;
    expect(Object.keys(run).sort()).toEqual([
      'baseRef',
      'blockers',
      'branch',
      'cost',
      'createdAt',
      'diff',
      'finishedAt',
      'gate',
      'guardrails',
      'id',
      'jobId',
      'pr',
      'repoId',
      'state',
      'trigger',
    ]);
    expect(toRun(record)).toEqual(run);
    expect(store.runs.get('run_0000404')).toBeNull();
  });

  it('updates partial patches and refuses an unknown run', () => {
    const store = track(openInMemoryStore());
    store.repos.create(REPO);
    store.runs.create(runRecord('run_0000001', REPO.id, '2026-01-01T00:00:00.000Z'));

    const updated = store.runs.update('run_0000001', {
      state: 'running',
      startedAt: '2026-01-01T00:01:00.000Z',
      guardrails: [{ id: 'gate', state: 'skip' }],
      blockers: [],
      cost: { usd: 1.5, tokensIn: 100, tokensOut: 50 },
    });
    expect(updated.state).toBe('running');
    expect(updated.startedAt).toBe('2026-01-01T00:01:00.000Z');
    expect(updated.guardrails).toEqual([{ id: 'gate', state: 'skip' }]);
    expect(updated.cost).toEqual({ usd: 1.5, tokensIn: 100, tokensOut: 50 });

    const cleared = store.runs.update('run_0000001', {
      pr: null,
      gate: null,
      diff: null,
      finishedAt: '2026-01-01T02:00:00.000Z',
    });
    expect(cleared.pr).toBeNull();
    expect(cleared.gate).toBeNull();
    expect(cleared.diff).toBeNull();
    expect(cleared.finishedAt).toBe('2026-01-01T02:00:00.000Z');

    expect(storeErrorCode(() => store.runs.update('run_0000404', { state: 'failed' }))).toBe(
      'not_found',
    );
  });

  it('lists newest first and pages with an opaque cursor', () => {
    const store = track(openInMemoryStore());
    store.repos.create(REPO);
    store.runs.create(runRecord('run_0000001', REPO.id, '2026-01-01T00:00:00.000Z'));
    store.runs.create(runRecord('run_0000002', REPO.id, '2026-01-02T00:00:00.000Z'));
    store.runs.create(runRecord('run_0000003', REPO.id, '2026-01-03T00:00:00.000Z'));

    const first = store.runs.list({ limit: 2, cursor: null });
    expect(first.data.map((run) => run.id)).toEqual(['run_0000003', 'run_0000002']);
    expect(first.nextCursor).not.toBeNull();
    const second = store.runs.list({ limit: 2, cursor: first.nextCursor });
    expect(second.data.map((run) => run.id)).toEqual(['run_0000001']);
    expect(second.nextCursor).toBeNull();

    expect(
      store.runs.list({ repoId: REPO.id, state: 'queued', limit: 10, cursor: null }).data,
    ).toHaveLength(3);
    expect(
      store.runs.list({ repoId: REPO.id, state: 'failed', limit: 10, cursor: null }).data,
    ).toHaveLength(0);
    expect(store.runs.list({ jobId: SCHEDULED_JOB.id, limit: 10, cursor: null }).data).toHaveLength(
      0,
    );
  });

  it('orders listByJob and counts only live states', () => {
    const store = track(openInMemoryStore());
    store.repos.create(REPO);
    store.jobs.create(SCHEDULED_JOB);
    store.runs.create(
      runRecord('run_0000001', REPO.id, '2026-01-01T00:00:00.000Z', {
        jobId: SCHEDULED_JOB.id,
        state: 'succeeded',
        finishedAt: '2026-01-01T01:00:00.000Z',
      }),
    );
    store.runs.create(
      runRecord('run_0000002', REPO.id, '2026-01-02T00:00:00.000Z', {
        jobId: SCHEDULED_JOB.id,
        state: 'gating',
      }),
    );

    expect(store.runs.listByJob(SCHEDULED_JOB.id, 10).map((run) => run.id)).toEqual([
      'run_0000002',
      'run_0000001',
    ]);
    expect(store.runs.listByJob(SCHEDULED_JOB.id, 1)).toHaveLength(1);
    expect(store.runs.countLive()).toBe(1);
    expect(store.runs.countLive(REPO.id)).toBe(1);

    store.runs.update('run_0000002', { state: 'cancelled' });
    expect(store.runs.countLive()).toBe(0);
  });
});

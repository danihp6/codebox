import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Health, Run, Telemetry } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { DashboardStore } from './dashboard.store';

const TS = '2026-10-24T18:04:02Z';

const HEALTH: Health = {
  status: 'ok',
  db: 'ok',
  opencode: 'degraded',
  disk: { freeBytes: 12_000, totalBytes: 48_000, usedPercent: 75 },
  queue: { pending: 2, running: 1, maxConcurrency: 4 },
  version: '0.1.0',
};

const TELEMETRY: Telemetry = {
  range: '24h',
  since: TS,
  spendUsd: 1.25,
  runs: { total: 3, succeeded: 2, failed: 1, cancelled: 0 },
  disk: HEALTH.disk,
  queueDepth: 2,
};

function runAt(index: number): Run {
  return {
    id: `run_01JABCDEFGHJKMNPQR${String(index).padStart(2, '0')}`,
    repoId: 'repo_01JABCDEFGHJKMNPQRSV',
    jobId: null,
    state: 'succeeded',
    trigger: 'manual',
    branch: `cb/run-${index}`,
    baseRef: 'main',
    pr: null,
    gate: null,
    guardrails: [],
    blockers: [],
    diff: null,
    cost: { usd: 0.1, tokensIn: 10, tokensOut: 5 },
    createdAt: TS,
    finishedAt: TS,
  };
}

const RUNS = [runAt(1), runAt(2), runAt(3), runAt(4), runAt(5)];

const HEALTH_URL = '/v1/health';
const TELEMETRY_URL = '/v1/telemetry?range=24h';
const RUNS_URL = '/v1/runs?limit=5';

function envelope(code: string): Record<string, unknown> {
  return { error: { code, message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } };
}

describe('DashboardStore', () => {
  let http: HttpTestingController;
  let store: DashboardStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), DashboardStore],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(DashboardStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  function flushAll(runs: readonly Run[] = RUNS): void {
    http.expectOne(HEALTH_URL).flush(HEALTH);
    http.expectOne(TELEMETRY_URL).flush(TELEMETRY);
    http.expectOne(RUNS_URL).flush({ data: [...runs], nextCursor: null });
  }

  it('loads health, telemetry and the five most recent runs as three reads', () => {
    store.load();

    expect(store.loading()).toBe(true);
    flushAll();

    expect(store.loading()).toBe(false);
    expect(store.health()).toEqual(HEALTH);
    expect(store.telemetry()).toEqual(TELEMETRY);
    expect(store.recentRuns()).toHaveLength(5);
    expect(store.error()).toBeNull();
    expect(store.stale()).toBe(false);
  });

  it('keeps health when the telemetry read fails', () => {
    store.load();
    http.expectOne(HEALTH_URL).flush(HEALTH);
    http.expectOne(TELEMETRY_URL).flush(envelope('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });
    http.expectOne(RUNS_URL).flush({ data: [...RUNS], nextCursor: null });

    expect(store.health()).toEqual(HEALTH);
    expect(store.recentRuns()).toHaveLength(5);
    expect(store.telemetry()).toBeNull();
    expect(store.error()).toBeInstanceOf(ApiError);
    expect(store.error()).toMatchObject({ status: 500, code: 'internal' });
    expect(store.loading()).toBe(false);
  });

  it('marks the payload stale when a reload fails', () => {
    store.load();
    flushAll();

    store.reload();
    http.expectOne(HEALTH_URL).flush(envelope('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });
    http.expectOne(TELEMETRY_URL).flush(TELEMETRY);
    http.expectOne(RUNS_URL).flush({ data: [...RUNS], nextCursor: null });

    expect(store.stale()).toBe(true);
    expect(store.health()).toEqual(HEALTH);
    expect(store.error()).toMatchObject({ code: 'internal' });
    expect(store.loading()).toBe(false);
  });

  it('does not mark stale when the first load fails', () => {
    store.load();
    http.expectOne(HEALTH_URL).flush(envelope('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });
    http.expectOne(TELEMETRY_URL).flush(TELEMETRY);
    http.expectOne(RUNS_URL).flush({ data: [], nextCursor: null });

    expect(store.stale()).toBe(false);
    expect(store.error()).toMatchObject({ code: 'internal' });
  });

  it('clears the error on a fresh load', () => {
    store.load();
    http.expectOne(HEALTH_URL).flush(envelope('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });
    http.expectOne(TELEMETRY_URL).flush(TELEMETRY);
    http.expectOne(RUNS_URL).flush({ data: [], nextCursor: null });
    expect(store.error()).not.toBeNull();

    store.load();
    expect(store.error()).toBeNull();
    flushAll();
    expect(store.error()).toBeNull();
  });

  it('ignores every stream event', () => {
    expect(store.applyStreamEvent({ event: 'gap', data: { afterId: 1, latestId: 2, ts: TS } })).toBe(
      'ignored',
    );
    expect(
      store.applyStreamEvent({
        event: 'run.finished',
        data: { runId: 'run_01JABCDEFGHJKMNPQRSV', seq: 3, ts: TS, state: 'succeeded' },
      }),
    ).toBe('ignored');
    http.expectNone(HEALTH_URL);
  });
});

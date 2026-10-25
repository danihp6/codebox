import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Page, Run } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunsStore } from './runs.store';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const RUN_ID = 'run_01JABCDEFGHJKMNPQRSV';
const NEXT_ID = 'run_01JABCDEFGHJKMNPQRSW';
const TS = '2026-10-24T18:04:02Z';

const RUN: Run = {
  id: RUN_ID,
  repoId: REPO_ID,
  jobId: null,
  state: 'running',
  trigger: 'manual',
  branch: 'cb/run-x',
  baseRef: 'main',
  pr: null,
  gate: null,
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0.42, tokensIn: 100, tokensOut: 50 },
  createdAt: '2026-10-24T18:03:11Z',
  finishedAt: null,
};

const OTHER: Run = { ...RUN, id: NEXT_ID, branch: 'cb/run-y' };

const FIRST_PAGE: Page<Run> = { data: [RUN], nextCursor: 'c_next' };
const SECOND_PAGE: Page<Run> = { data: [OTHER], nextCursor: null };

describe('RunsStore', () => {
  let http: HttpTestingController;
  let store: RunsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), RunsStore],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RunsStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('loads the first fifty runs', () => {
    store.load();

    expect(store.loading()).toBe(true);
    http.expectOne('/v1/runs?limit=50').flush(FIRST_PAGE);

    expect(store.runs()).toHaveLength(1);
    expect(store.nextCursor()).toBe('c_next');
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('keeps the failure on the error signal', () => {
    store.load();
    http.expectOne('/v1/runs?limit=50').flush(
      { error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
      { status: 500, statusText: 'Internal Server Error' },
    );

    expect(store.error()).toMatchObject({ status: 500, code: 'internal' });
    expect(store.loading()).toBe(false);
    expect(store.runs()).toEqual([]);
  });

  it('filters by state and resets the list', () => {
    store.load();
    http.expectOne('/v1/runs?limit=50').flush(FIRST_PAGE);

    store.setState('failed');
    expect(store.state()).toBe('failed');
    expect(store.runs()).toEqual([]);
    expect(store.nextCursor()).toBeNull();

    http.expectOne('/v1/runs?state=failed&limit=50').flush({ data: [OTHER], nextCursor: null });

    expect(store.runs()).toHaveLength(1);
    expect(store.runs()[0]?.id).toBe(NEXT_ID);
  });

  it('clears the filter with a null state', () => {
    store.setState('failed');
    http.expectOne('/v1/runs?state=failed&limit=50').flush({ data: [], nextCursor: null });

    store.setState(null);
    http.expectOne('/v1/runs?limit=50').flush(FIRST_PAGE);

    expect(store.state()).toBeNull();
    expect(store.runs()).toHaveLength(1);
  });

  it('appends the next page and moves the cursor', () => {
    store.load();
    http.expectOne('/v1/runs?limit=50').flush(FIRST_PAGE);

    store.more();
    expect(store.loadingMore()).toBe(true);

    http
      .expectOne(
        (request) => request.url === '/v1/runs' && request.params.get('cursor') === 'c_next',
      )
      .flush(SECOND_PAGE);

    expect(store.loadingMore()).toBe(false);
    expect(store.runs().map((run) => run.id)).toEqual([RUN_ID, NEXT_ID]);
    expect(store.nextCursor()).toBeNull();
  });

  it('does nothing when there is no cursor', () => {
    store.load();
    http.expectOne('/v1/runs?limit=50').flush({ data: [RUN], nextCursor: null });

    store.more();

    http.expectNone((request) => request.url === '/v1/runs' && request.params.has('cursor'));
  });

  it('patches the state of a loaded row on a terminal frame', () => {
    store.load();
    http.expectOne('/v1/runs?limit=50').flush(FIRST_PAGE);

    expect(
      store.applyStreamEvent({
        event: 'run.finished',
        data: { runId: RUN_ID, seq: 2, ts: TS, state: 'succeeded' },
      }),
    ).toBe('applied');
    expect(store.runs()[0]?.state).toBe('succeeded');

    expect(
      store.applyStreamEvent({
        event: 'run.failed',
        data: { runId: RUN_ID, seq: 3, ts: TS, state: 'failed', code: 'gate', message: 'red' },
      }),
    ).toBe('applied');
    expect(store.runs()[0]?.state).toBe('failed');

    expect(
      store.applyStreamEvent({
        event: 'run.queued',
        data: { runId: RUN_ID, seq: 4, ts: TS, repoId: REPO_ID, jobId: null, trigger: 'manual' },
      }),
    ).toBe('applied');
    expect(store.runs()[0]?.state).toBe('queued');

    expect(
      store.applyStreamEvent({
        event: 'run.cancelled',
        data: { runId: RUN_ID, seq: 5, ts: TS, state: 'cancelled' },
      }),
    ).toBe('applied');
    expect(store.runs()[0]?.state).toBe('cancelled');
  });

  it('ignores a frame for an unknown run and every other event', () => {
    store.load();
    http.expectOne('/v1/runs?limit=50').flush(FIRST_PAGE);

    expect(
      store.applyStreamEvent({
        event: 'run.finished',
        data: { runId: 'run_unknown', seq: 2, ts: TS, state: 'succeeded' },
      }),
    ).toBe('ignored');

    expect(
      store.applyStreamEvent({ event: 'job.changed', data: { jobId: 'job_01JABCDEFGHJKMNPQRSV', change: 'updated', ts: TS } }),
    ).toBe('ignored');

    expect(store.runs()[0]?.state).toBe('running');
  });
});

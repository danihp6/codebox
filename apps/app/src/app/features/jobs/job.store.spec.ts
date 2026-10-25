import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Job, Run } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobStore } from './job.store';

const JOB_ID = 'job_01JABCDEFGHJKMNPQRSV';
const ROUTE_ID = 'job_1';
const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const RUN_ID = 'run_01JABCDEFGHJKMNPQRSV';

const JOB: Job = {
  id: JOB_ID,
  repoId: REPO_ID,
  title: 'Nightly lockfile',
  prompt: 'Update the lockfile.',
  mode: 'work',
  agent: 'build',
  model: null,
  cron: '0 3 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  policy: 'auto',
  createdAt: '2026-10-24T18:03:11Z',
  nextFireAt: '2026-10-25T02:00:00Z',
};

const RUN: Run = {
  id: RUN_ID,
  repoId: REPO_ID,
  jobId: JOB_ID,
  state: 'succeeded',
  trigger: 'schedule',
  branch: 'cb/run-x',
  baseRef: 'main',
  pr: null,
  gate: null,
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0.1, tokensIn: 10, tokensOut: 5 },
  createdAt: '2026-10-24T18:03:11Z',
  finishedAt: '2026-10-24T18:09:00Z',
};

const DETAIL = {
  job: JOB,
  lastRuns: [RUN],
  nextFires: ['2026-10-25T02:00:00Z'],
};

const DETAIL_URL = `/v1/jobs/${ROUTE_ID}`;
const PATCH_URL = `/v1/jobs/${ROUTE_ID}`;
const NEXT_URL = `/v1/jobs/${ROUTE_ID}/next?count=5`;
const RUN_URL = `/v1/jobs/${ROUTE_ID}/run`;

describe('JobStore', () => {
  let http: HttpTestingController;
  let store: JobStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), JobStore],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(JobStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  function load(): void {
    store.load(ROUTE_ID);
    http.expectOne(DETAIL_URL).flush(DETAIL);
  }

  it('loads the job detail, its recent runs and its next fires', () => {
    store.load(ROUTE_ID);

    expect(store.loading()).toBe(true);
    http.expectOne(DETAIL_URL).flush(DETAIL);

    expect(store.jobId()).toBe(ROUTE_ID);
    expect(store.detail()?.job.id).toBe(JOB_ID);
    expect(store.detail()?.lastRuns).toHaveLength(1);
    expect(store.detail()?.nextFires).toEqual(['2026-10-25T02:00:00Z']);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('keeps a read failure on the error signal', () => {
    store.load(ROUTE_ID);
    http.expectOne(DETAIL_URL).flush(
      { error: { code: 'not_found', message: 'Missing', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
      { status: 404, statusText: 'Not Found' },
    );

    expect(store.error()).toMatchObject({ status: 404, code: 'not_found' });
    expect(store.loading()).toBe(false);
    expect(store.detail()).toBeNull();
  });

  it('sends nothing when the cron expression is invalid', () => {
    load();

    store.saveCron('0 3 * *', 'Europe/Madrid');

    expect(store.validation().problems).toEqual(['field_count']);
    expect(store.validation().ok).toBe(false);
    expect(store.saving()).toBe(false);
    http.expectNone(PATCH_URL);
    http.expectNone(NEXT_URL);
  });

  it('sends nothing when the timezone is unknown', () => {
    load();

    store.saveCron('0 3 * * *', 'Mars/Olympus');

    expect(store.timezoneError()).toBe(true);
    expect(store.validation().ok).toBe(true);
    http.expectNone(PATCH_URL);
    http.expectNone(NEXT_URL);
  });

  it('patches the cron and the timezone and takes the preview from the server', () => {
    load();

    store.saveCron('15 4 * * 1-5', 'Europe/Madrid');
    expect(store.saving()).toBe(true);

    const patch = http.expectOne({ method: 'PATCH', url: PATCH_URL });
    expect(patch.request.body).toEqual({ cron: '15 4 * * 1-5', timezone: 'Europe/Madrid' });
    patch.flush({ ...JOB, cron: '15 4 * * 1-5', nextFireAt: '2026-10-26T03:15:00Z' });

    expect(store.saving()).toBe(false);
    expect(store.detail()?.job.cron).toBe('15 4 * * 1-5');

    http
      .expectOne(NEXT_URL)
      .flush({ fires: ['2026-10-26T03:15:00Z', '2026-10-27T03:15:00Z'] });

    expect(store.detail()?.nextFires).toEqual([
      '2026-10-26T03:15:00Z',
      '2026-10-27T03:15:00Z',
    ]);
  });

  it('keeps the patch failure on the error signal and does not preview', () => {
    load();

    store.saveCron('0 4 * * *', 'Europe/Madrid');
    http.expectOne({ method: 'PATCH', url: PATCH_URL }).flush(
      {
        error: {
          code: 'validation_failed',
          message: 'Bad cron',
          requestId: 'req_01JABCDEFGHJKMNPQRSV',
          details: { path: 'job.cron', reason: 'no_fire' },
        },
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    expect(store.error()).toMatchObject({
      status: 422,
      code: 'validation_failed',
      details: { path: 'job.cron' },
    });
    expect(store.saving()).toBe(false);
    http.expectNone(NEXT_URL);
  });

  it('toggles the pause switch with a patch', () => {
    load();

    store.setEnabled(false);
    const patch = http.expectOne({ method: 'PATCH', url: PATCH_URL });
    expect(patch.request.body).toEqual({ enabled: false });
    patch.flush({ ...JOB, enabled: false, nextFireAt: null });

    expect(store.detail()?.job).toMatchObject({ enabled: false, nextFireAt: null });
    expect(store.saving()).toBe(false);
  });

  it('runs the job now with an idempotency key', () => {
    load();

    store.runNow();
    const request = http.expectOne({ method: 'POST', url: RUN_URL });
    expect(request.request.headers.get('Idempotency-Key')).toBe(`runnow-${ROUTE_ID}-1`);
    request.flush({ ...RUN, state: 'queued' }, { status: 202, statusText: 'Accepted' });

    store.runNow();
    const second = http.expectOne({ method: 'POST', url: RUN_URL });
    expect(second.request.headers.get('Idempotency-Key')).toBe(`runnow-${ROUTE_ID}-2`);
    second.flush({ ...RUN, state: 'queued' }, { status: 202, statusText: 'Accepted' });
  });

  it('refreshes the preview on demand', () => {
    load();

    store.refreshNext();
    http.expectOne(NEXT_URL).flush({ fires: ['2026-10-30T02:00:00Z'] });

    expect(store.detail()?.nextFires).toEqual(['2026-10-30T02:00:00Z']);
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Job, Page, Run } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobsStore } from './jobs.store';

const JOB_ID = 'job_01JABCDEFGHJKMNPQRSV';
const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const RUN_ID = 'run_01JABCDEFGHJKMNPQRSV';
const TS = '2026-10-24T18:04:02Z';

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

const PAUSED: Job = { ...JOB, enabled: false, nextFireAt: null };

const RUN: Run = {
  id: RUN_ID,
  repoId: REPO_ID,
  jobId: JOB_ID,
  state: 'queued',
  trigger: 'manual',
  branch: 'cb/run-x',
  baseRef: 'main',
  pr: null,
  gate: null,
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
  createdAt: '2026-10-24T18:03:11Z',
  finishedAt: null,
};

const LIST_URL = '/v1/jobs?limit=100';
const PAUSE_URL = `/v1/jobs/${JOB_ID}/pause`;
const RESUME_URL = `/v1/jobs/${JOB_ID}/resume`;
const RUN_URL = `/v1/jobs/${JOB_ID}/run`;

function page(data: readonly Job[], nextCursor: string | null = null): Page<Job> {
  return { data: [...data], nextCursor };
}

function refusal(code: string): Record<string, unknown> {
  return {
    error: {
      code,
      message: 'Refused',
      requestId: 'req_01JABCDEFGHJKMNPQRSV',
    },
  };
}

describe('JobsStore', () => {
  let http: HttpTestingController;
  let store: JobsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), JobsStore],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(JobsStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  function load(data: readonly Job[] = [JOB]): void {
    store.load();
    http.expectOne(LIST_URL).flush(page(data));
  }

  it('loads the first hundred jobs', () => {
    store.load();

    expect(store.loading()).toBe(true);
    http.expectOne(LIST_URL).flush(page([JOB, PAUSED]));

    expect(store.jobs()).toHaveLength(2);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('keeps the failure on the error signal', () => {
    store.load();
    http.expectOne(LIST_URL).flush(refusal('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });

    expect(store.error()).toMatchObject({ status: 500, code: 'internal' });
    expect(store.loading()).toBe(false);
    expect(store.jobs()).toEqual([]);
  });

  it('pauses optimistically and rolls back when the request fails', () => {
    load();

    store.pause(JOB);
    expect(store.jobs()[0]).toMatchObject({ enabled: false, nextFireAt: null });
    expect(store.busy()).toBe(JOB_ID);

    http.expectOne({ method: 'POST', url: PAUSE_URL }).flush(refusal('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });

    expect(store.jobs()[0]).toMatchObject({ enabled: true, nextFireAt: JOB.nextFireAt });
    expect(store.error()).toMatchObject({ status: 500, code: 'internal' });
    expect(store.busy()).toBeNull();
  });

  it('resumes optimistically and lets the server nextFireAt win', () => {
    load([PAUSED]);

    store.resume(PAUSED);
    expect(store.jobs()[0]).toMatchObject({ enabled: true, nextFireAt: null });

    http.expectOne({ method: 'POST', url: RESUME_URL }).flush(JOB);

    expect(store.jobs()[0]).toMatchObject({ enabled: true, nextFireAt: JOB.nextFireAt });
    expect(store.error()).toBeNull();
    expect(store.busy()).toBeNull();
  });

  it('restores the paused row when the resume fails', () => {
    load([PAUSED]);

    store.resume(PAUSED);
    expect(store.jobs()[0]).toMatchObject({ enabled: true });

    http.expectOne({ method: 'POST', url: RESUME_URL }).flush(refusal('conflict'), {
      status: 409,
      statusText: 'Conflict',
    });

    expect(store.jobs()[0]).toMatchObject({ enabled: false, nextFireAt: null });
    expect(store.error()).toMatchObject({ code: 'conflict' });
  });

  it('runs a job now with a per-store idempotency counter and no optimistic row', () => {
    load([]);

    store.runNow(JOB);
    expect(store.running()).toBe(JOB_ID);
    expect(store.jobs()).toHaveLength(0);

    const first = http.expectOne({ method: 'POST', url: RUN_URL });
    expect(first.request.headers.get('Idempotency-Key')).toBe(`runnow-${JOB_ID}-1`);
    first.flush(RUN, { status: 202, statusText: 'Accepted' });
    expect(store.running()).toBeNull();

    store.runNow(JOB);
    const second = http.expectOne({ method: 'POST', url: RUN_URL });
    expect(second.request.headers.get('Idempotency-Key')).toBe(`runnow-${JOB_ID}-2`);
    second.flush(RUN, { status: 202, statusText: 'Accepted' });

    expect(store.jobs()).toHaveLength(0);
  });

  it('keeps the run-now failure on the error signal', () => {
    load([]);

    store.runNow(JOB);
    http.expectOne({ method: 'POST', url: RUN_URL }).flush(refusal('conflict'), {
      status: 409,
      statusText: 'Conflict',
    });

    expect(store.error()).toMatchObject({ code: 'conflict' });
    expect(store.running()).toBeNull();
  });

  it('reloads exactly once on a job.changed frame and ignores every other event', () => {
    load();

    expect(
      store.applyStreamEvent({ event: 'job.changed', data: { jobId: JOB_ID, change: 'updated', ts: TS } }),
    ).toBe('applied');
    http.expectOne(LIST_URL).flush(page([PAUSED]));
    expect(store.jobs()[0]?.enabled).toBe(false);

    expect(
      store.applyStreamEvent({
        event: 'run.finished',
        data: { runId: RUN_ID, seq: 1, ts: TS, state: 'succeeded' },
      }),
    ).toBe('ignored');
    http.expectNone(LIST_URL);
  });

  it('passes create through so the page can act on the answer', () => {
    let created: Job | undefined;
    store
      .create({
        repoId: REPO_ID,
        title: JOB.title,
        prompt: JOB.prompt,
        cron: JOB.cron,
        timezone: JOB.timezone,
      })
      .subscribe((job) => {
        created = job;
      });

    const request = http.expectOne({ method: 'POST', url: '/v1/jobs' });
    request.flush(JOB, { status: 201, statusText: 'Created' });

    expect(created?.id).toBe(JOB_ID);
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Run, Schedule } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiError } from '../../core/api/api-client';
import { RepoScheduleStore } from './repo-schedule.store';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const LIST_URL = `/v1/schedules?repoId=${REPO_ID}`;

const SCHEDULE: Schedule = {
  id: 'sch_01JABCDEFGHJK',
  repoId: REPO_ID,
  chatSessionId: null,
  title: 'Backlog shift',
  prompt: 'Work the backlog in file order.',
  mode: 'window',
  cron: null,
  timezone: 'Europe/Madrid',
  windowStart: '09:00',
  windowEnd: '17:00',
  cooldownMinutes: 15,
  maxFires: null,
  maxCostPerFireUsd: null,
  firePolicy: 'new_chat',
  consecutiveFailures: 0,
  firesCount: 3,
  spendUsd: 1.5,
  enabled: true,
  policy: 'auto',
  nextFireAt: '2026-10-30T08:00:00Z',
  lastFiredAt: null,
  createdAt: '2026-10-28T09:00:00Z',
  updatedAt: '2026-10-29T08:00:00Z',
};

const RUN: Run = {
  id: 'run_01JABCDEFGHJK',
  repoId: REPO_ID,
  jobId: null,
  state: 'queued',
  trigger: 'manual',
  branch: 'cb/run-next',
  baseRef: 'main',
  pr: null,
  gate: null,
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
  createdAt: '2026-10-29T08:00:00Z',
  finishedAt: null,
};

function envelope(code: string, details?: Record<string, unknown>): Record<string, unknown> {
  return {
    error: {
      code,
      message: 'Boom',
      requestId: 'req_01JABCDEFGHJK',
      ...(details === undefined ? {} : { details }),
    },
  };
}

describe('RepoScheduleStore', () => {
  let http: HttpTestingController;
  let store: RepoScheduleStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), RepoScheduleStore],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RepoScheduleStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  function load(schedule: Schedule | null = SCHEDULE): void {
    store.load(REPO_ID);
    http.expectOne(LIST_URL).flush({ data: schedule === null ? [] : [schedule], nextCursor: null });
  }

  it('loads the single row of the repository, or none', () => {
    load();
    expect(store.schedule()).toEqual(SCHEDULE);

    store.load('repo_01JABCDEFGHJKMNPQRSW');
    http
      .expectOne('/v1/schedules?repoId=repo_01JABCDEFGHJKMNPQRSW')
      .flush({ data: [], nextCursor: null });
    expect(store.schedule()).toBeNull();
    expect(store.loading()).toBe(false);
  });

  it('pauses optimistically and rolls back when the daemon refuses', () => {
    load();

    store.pause();
    expect(store.schedule()?.enabled).toBe(false);
    http
      .expectOne({ method: 'POST', url: `/v1/schedules/${SCHEDULE.id}/pause` })
      .flush(envelope('conflict'), { status: 409, statusText: 'Conflict' });

    expect(store.schedule()?.enabled).toBe(true);
    expect(store.error()).toMatchObject({ code: 'conflict' });
  });

  it('resumes from the disabled row', () => {
    load({ ...SCHEDULE, enabled: false });

    store.resume();
    expect(store.schedule()?.enabled).toBe(true);
    http.expectOne({ method: 'POST', url: `/v1/schedules/${SCHEDULE.id}/resume` }).flush(SCHEDULE);

    expect(store.schedule()?.enabled).toBe(true);
    expect(store.error()).toBeNull();
  });

  it('reports an empty selection instead of an error', () => {
    load();

    store.runNext();
    http
      .expectOne({ method: 'POST', url: `/v1/repos/${REPO_ID}/run-next` })
      .flush(envelope('conflict', { reason: 'nothing_pending' }), {
        status: 409,
        statusText: 'Conflict',
      });

    expect(store.notice()).toBe('nothing_pending');
    expect(store.error()).toBeNull();
  });

  it('keeps the accepted run of a manual fire', () => {
    load();

    store.runNext();
    http
      .expectOne({ method: 'POST', url: `/v1/repos/${REPO_ID}/run-next` })
      .flush(RUN, { status: 202, statusText: 'Accepted' });

    expect(store.nextRun()).toEqual(RUN);
  });

  it('refetches instead of failing when the repository already has a schedule', () => {
    store.load(REPO_ID);
    http.expectOne(LIST_URL).flush({ data: [], nextCursor: null });

    store.create({ repoId: REPO_ID, mode: 'every', timezone: 'UTC', cron: '0 9 * * *' });
    http
      .expectOne({ method: 'POST', url: '/v1/schedules' })
      .flush(envelope('conflict', { reason: 'schedule_exists' }), {
        status: 409,
        statusText: 'Conflict',
      });

    http.expectOne(LIST_URL).flush({ data: [SCHEDULE], nextCursor: null });
    expect(store.schedule()).toEqual(SCHEDULE);
    expect(store.error()).toBeNull();
  });

  it('surfaces any other create failure as the screen error', () => {
    store.load(REPO_ID);
    http.expectOne(LIST_URL).flush({ data: [], nextCursor: null });

    store.create({ repoId: REPO_ID, mode: 'every', timezone: 'UTC', cron: '0 9 * * *' });
    http
      .expectOne({ method: 'POST', url: '/v1/schedules' })
      .flush(envelope('validation_failed'), { status: 422, statusText: 'Unprocessable' });

    const failure: ApiError | null = store.error();
    expect(failure).toMatchObject({ code: 'validation_failed' });
  });
});

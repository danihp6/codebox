import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { RepoSchedule, Run } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import type { ScheduleWrite } from './repo-schedule.api';
import { RepoScheduleApi } from './repo-schedule.api';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';

const SCHEDULE: RepoSchedule = {
  id: 'sch_01JABCDEFGHJK',
  repoId: REPO_ID,
  mode: 'every',
  cron: '0 9 * * 1-5',
  timezone: 'Europe/Madrid',
  windowStart: null,
  windowEnd: null,
  cooldownMinutes: 15,
  selection: 'nextPending',
  refs: [],
  maxAttempts: 2,
  maxFires: null,
  maxCostPerFireUsd: 5,
  consecutiveFailures: 0,
  firesCount: 3,
  spendUsd: 1.5,
  enabled: true,
  nextFireAt: '2026-10-30T08:00:00Z',
  lastFiredAt: '2026-10-29T08:00:00Z',
  createdAt: '2026-10-28T09:00:00Z',
  updatedAt: '2026-10-29T08:00:00Z',
};

const WRITE: ScheduleWrite = {
  mode: 'every',
  timezone: 'Europe/Madrid',
  cron: '0 9 * * 1-5',
  windowStart: null,
  windowEnd: null,
  selection: 'nextPending',
  refs: [],
  maxAttempts: 2,
  maxFires: null,
  maxCostPerFireUsd: null,
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

describe('RepoScheduleApi', () => {
  let http: HttpTestingController;
  let api: RepoScheduleApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), RepoScheduleApi],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(RepoScheduleApi);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('reads the schedule of one repository', () => {
    let rows: readonly RepoSchedule[] = [];
    api.list(REPO_ID).subscribe((page) => {
      rows = page.data;
    });

    const request = http.expectOne(`/v1/schedules?repoId=${REPO_ID}`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [SCHEDULE], nextCursor: null });

    expect(rows).toEqual([SCHEDULE]);
  });

  it('creates a cron schedule with exactly the twelve-key body', () => {
    let created: RepoSchedule | null = null;
    api.create({ ...WRITE, repoId: REPO_ID }).subscribe((schedule) => {
      created = schedule;
    });

    const request = http.expectOne({ method: 'POST', url: '/v1/schedules' });
    expect(request.request.body).toEqual({
      repoId: REPO_ID,
      mode: 'every',
      timezone: 'Europe/Madrid',
      cron: '0 9 * * 1-5',
      windowStart: null,
      windowEnd: null,
      selection: 'nextPending',
      refs: [],
      maxAttempts: 2,
      maxFires: null,
      maxCostPerFireUsd: null,
    });
    expect(request.request.body).not.toHaveProperty('title');
    expect(request.request.body).not.toHaveProperty('prompt');
    request.flush(SCHEDULE, { status: 201, statusText: 'Created' });

    expect(created).toEqual(SCHEDULE);
  });

  it('patches the editable fields of one schedule', () => {
    const body: ScheduleWrite = {
      mode: 'window',
      timezone: 'Europe/Madrid',
      cron: null,
      windowStart: '09:00',
      windowEnd: '17:00',
      selection: 'refs',
      refs: ['Task-35'],
      maxAttempts: 3,
      maxFires: 4,
      maxCostPerFireUsd: 2,
    };
    let updated: RepoSchedule | null = null;
    api.update(SCHEDULE.id, body).subscribe((schedule) => {
      updated = schedule;
    });

    const request = http.expectOne({ method: 'PATCH', url: `/v1/schedules/${SCHEDULE.id}` });
    expect(request.request.body).toEqual(body);
    request.flush(SCHEDULE);

    expect(updated).toEqual(SCHEDULE);
  });

  it('pauses and resumes through the two POST routes', () => {
    const paused: RepoSchedule[] = [];
    api.pause(SCHEDULE.id).subscribe((schedule) => paused.push(schedule));
    const pause = http.expectOne(`/v1/schedules/${SCHEDULE.id}/pause`);
    expect(pause.request.method).toBe('POST');
    pause.flush({ ...SCHEDULE, enabled: false });

    api.resume(SCHEDULE.id).subscribe((schedule) => paused.push(schedule));
    http.expectOne(`/v1/schedules/${SCHEDULE.id}/resume`).flush(SCHEDULE);

    expect(paused.map((schedule) => schedule.enabled)).toEqual([false, true]);
  });

  it('runs the next item and parses the accepted run', () => {
    let run: Run | null = null;
    api.runNext(REPO_ID).subscribe((result) => {
      run = result;
    });

    const request = http.expectOne({ method: 'POST', url: `/v1/repos/${REPO_ID}/run-next` });
    request.flush(RUN, { status: 202, statusText: 'Accepted' });

    expect(run).toEqual(RUN);
  });

  it('maps the error envelope and a boundary parse failure to ApiError', () => {
    const failures: ApiError[] = [];
    api.list(REPO_ID).subscribe({ error: (error: ApiError) => failures.push(error) });
    http.expectOne(`/v1/schedules?repoId=${REPO_ID}`).flush(
      { error: { code: 'conflict', message: 'Boom', requestId: 'req_01JABCDEFGHJ' } },
      { status: 409, statusText: 'Conflict' },
    );

    api.list(REPO_ID).subscribe({ error: (error: ApiError) => failures.push(error) });
    http.expectOne(`/v1/schedules?repoId=${REPO_ID}`).flush({
      data: [{ id: 'nope' }],
      nextCursor: null,
    });

    expect(failures[0]).toMatchObject({ status: 409, code: 'conflict' });
    expect(failures[1]).toMatchObject({ status: 200, code: 'contract' });
  });

  it('refuses a legacy Schedule answer, which carries a title', () => {
    const failures: ApiError[] = [];
    api.list(REPO_ID).subscribe({ error: (error: ApiError) => failures.push(error) });
    http
      .expectOne(`/v1/schedules?repoId=${REPO_ID}`)
      .flush({ data: [{ ...SCHEDULE, title: 'Nightly drain' }], nextCursor: null });

    expect(failures[0]).toMatchObject({ status: 200, code: 'contract' });
  });

  it('maps the 422 envelope of a refused patch, reason and path included', () => {
    const failures: ApiError[] = [];
    api
      .update(SCHEDULE.id, {
        mode: 'window',
        timezone: 'Europe/Madrid',
        cron: null,
        windowStart: '09:00',
        windowEnd: '09:00',
        selection: 'nextPending',
        refs: [],
        maxAttempts: 2,
        maxFires: null,
        maxCostPerFireUsd: null,
      })
      .subscribe({ error: (error: ApiError) => failures.push(error) });

    http.expectOne({ method: 'PATCH', url: `/v1/schedules/${SCHEDULE.id}` }).flush(
      {
        error: {
          code: 'validation_failed',
          message: 'Window',
          requestId: 'req_01JABCDEFGHJ',
          details: { path: 'schedule.windowStart', reason: 'window' },
        },
      },
      { status: 422, statusText: 'Unprocessable Content' },
    );

    expect(failures[0]).toMatchObject({
      status: 422,
      code: 'validation_failed',
      details: { path: 'schedule.windowStart', reason: 'window' },
    });
  });
});

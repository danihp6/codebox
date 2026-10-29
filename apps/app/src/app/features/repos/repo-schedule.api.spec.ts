import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Run, Schedule } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { RepoScheduleApi } from './repo-schedule.api';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';

const SCHEDULE: Schedule = {
  id: 'sch_01JABCDEFGHJK',
  repoId: REPO_ID,
  chatSessionId: null,
  title: 'Backlog shift',
  prompt: 'Work the backlog in file order.',
  mode: 'every',
  cron: '0 9 * * 1-5',
  timezone: 'Europe/Madrid',
  windowStart: null,
  windowEnd: null,
  cooldownMinutes: 15,
  maxFires: null,
  maxCostPerFireUsd: 5,
  firePolicy: 'new_chat',
  consecutiveFailures: 0,
  firesCount: 3,
  spendUsd: 1.5,
  enabled: true,
  policy: 'auto',
  nextFireAt: '2026-10-30T08:00:00Z',
  lastFiredAt: '2026-10-29T08:00:00Z',
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
    let rows: readonly Schedule[] = [];
    api.list(REPO_ID).subscribe((page) => {
      rows = page.data;
    });

    const request = http.expectOne(`/v1/schedules?repoId=${REPO_ID}`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [SCHEDULE], nextCursor: null });

    expect(rows).toEqual([SCHEDULE]);
  });

  it('creates a cron schedule with exactly the documented body', () => {
    let created: Schedule | null = null;
    api
      .create({ repoId: REPO_ID, mode: 'every', timezone: 'Europe/Madrid', cron: '0 9 * * 1-5' })
      .subscribe((schedule) => {
        created = schedule;
      });

    const request = http.expectOne({ method: 'POST', url: '/v1/schedules' });
    expect(request.request.body).toEqual({
      repoId: REPO_ID,
      mode: 'every',
      timezone: 'Europe/Madrid',
      cron: '0 9 * * 1-5',
    });
    request.flush(SCHEDULE, { status: 201, statusText: 'Created' });

    expect(created).toEqual(SCHEDULE);
  });

  it('pauses and resumes through the two POST routes', () => {
    const paused: Schedule[] = [];
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
    http.expectOne(`/v1/schedules?repoId=${REPO_ID}`).flush({ data: [{ id: 'nope' }], nextCursor: null });

    expect(failures[0]).toMatchObject({ status: 409, code: 'conflict' });
    expect(failures[1]).toMatchObject({ status: 200, code: 'contract' });
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { Backlog, Run, Work } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { BacklogStore } from './backlog.store';

const REPO_ID = 'repo_01JABCDEFG';
const WORK_ID = 'wrk_01JABCDEFG';

const BACKLOG: Backlog = {
  repoId: REPO_ID,
  revision: '9f1c2ab',
  path: 'TODO.md',
  sections: [
    {
      title: 'Batch 20',
      items: [
        { ref: 'Task-77', title: 'Workers view', checked: false, line: 1, needs: [], work: null },
      ],
    },
  ],
};

const WORK: Work = {
  id: WORK_ID,
  repoId: REPO_ID,
  backlogRef: 'Task-77',
  title: 'Workers view',
  prompt: 'Build the workers view.',
  specSha: '9f1c2ab',
  state: 'queued',
  origin: 'backlog',
  attempts: 0,
  maxAttempts: 2,
  usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
  contextTokens: 0,
  contextEpoch: 1,
  reviewedAt: null,
  createdAt: '2026-10-28T09:12:00Z',
  updatedAt: '2026-10-28T09:12:00Z',
};

const RUN: Run = {
  id: 'run_01JABCDEFG',
  repoId: REPO_ID,
  jobId: null,
  state: 'queued',
  trigger: 'manual',
  branch: 'cb/workers',
  baseRef: 'main',
  pr: null,
  gate: null,
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
  createdAt: '2026-10-28T09:12:00Z',
  finishedAt: null,
};

describe('BacklogStore', () => {
  let http: HttpTestingController;
  let store: BacklogStore;
  let navigate: MockInstance<typeof Router.prototype.navigate>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), BacklogStore],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(BacklogStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('loads the backlog of the repository', () => {
    store.load(REPO_ID);
    http.expectOne(`/v1/repos/${REPO_ID}/backlog`).flush(BACKLOG);

    expect(store.backlog()).toEqual(BACKLOG);
    expect(store.loading()).toBe(false);
  });

  it('runs one work and one attempt, in that order, then opens the work', () => {
    store.load(REPO_ID);
    http.expectOne(`/v1/repos/${REPO_ID}/backlog`).flush(BACKLOG);

    store.run(REPO_ID, 'Task-77');

    const create = http.expectOne({ method: 'POST', url: '/v1/works' });
    expect(create.request.body).toEqual({ repoId: REPO_ID, backlogRef: 'Task-77' });
    expect(navigate).not.toHaveBeenCalled();
    create.flush(WORK, { status: 201, statusText: 'Created' });

    const start = http.expectOne({ method: 'POST', url: `/v1/works/${WORK_ID}/runs` });
    expect(start.request.body).toEqual({});
    start.flush(RUN, { status: 202, statusText: 'Accepted' });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/works', WORK_ID]);
    http.expectNone({ method: 'POST', url: '/v1/works' });
  });

  it('stops on a live work: one call, a conflict and no navigation', () => {
    store.load(REPO_ID);
    http.expectOne(`/v1/repos/${REPO_ID}/backlog`).flush(BACKLOG);

    store.run(REPO_ID, 'Task-77');
    http
      .expectOne({ method: 'POST', url: '/v1/works' })
      .flush(
        {
          error: {
            code: 'conflict',
            message: 'Live work',
            details: { reason: 'live_work', workId: 'wrk_01JABCDEFH' },
          },
        },
        { status: 409, statusText: 'Conflict' },
      );

    expect(store.liveWork()).toEqual({ ref: 'Task-77', workId: 'wrk_01JABCDEFH' });
    expect(navigate).not.toHaveBeenCalled();
    http.expectNone({ method: 'POST', url: `/v1/works/${WORK_ID}/runs` });
    expect(store.error()).toBeNull();
  });

  it('surfaces any other failure as the screen error', () => {
    store.load(REPO_ID);
    http.expectOne(`/v1/repos/${REPO_ID}/backlog`).flush(BACKLOG);

    store.run(REPO_ID, 'Task-77');
    http
      .expectOne({ method: 'POST', url: '/v1/works' })
      .flush(
        { error: { code: 'validation_failed', message: 'Unknown ref' } },
        { status: 422, statusText: 'Unprocessable' },
      );

    expect(store.error()).toMatchObject({ code: 'validation_failed' });
    expect(store.liveWork()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});

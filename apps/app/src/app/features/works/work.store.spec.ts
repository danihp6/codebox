import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { Repo, Run, Session, Work, WorkDetail } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { WorkStore } from './work.store';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const WORK_ID = 'wrk_01JABCDEFGHJK';
const DETAIL_URL = `/v1/works/${WORK_ID}`;

const REPO: Repo = {
  id: REPO_ID,
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: [],
  enabled: true,
  createdAt: '2026-10-24T18:03:11Z',
};

const WORK: Work = {
  id: WORK_ID,
  repoId: REPO_ID,
  backlogRef: 'Task-77',
  title: 'Workers view',
  prompt: 'Build the workers view.',
  specSha: '9f1c2ab',
  state: 'needs_decision',
  origin: 'backlog',
  attempts: 1,
  maxAttempts: 2,
  usage: { usd: 0.25, tokensIn: 1200, tokensOut: 300 },
  contextTokens: 1500,
  contextEpoch: 1,
  reviewedAt: null,
  createdAt: '2026-10-28T09:12:00Z',
  updatedAt: '2026-10-28T10:12:00Z',
};

const RUN: Run = {
  id: 'run_01JABCDEFGHJK',
  repoId: REPO_ID,
  jobId: null,
  state: 'failed',
  trigger: 'manual',
  branch: 'cb/workers',
  baseRef: 'main',
  pr: null,
  gate: { status: 'failed', exitCode: 1, durationMs: 900 },
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0.25, tokensIn: 1, tokensOut: 1 },
  createdAt: '2026-10-28T09:12:00Z',
  finishedAt: '2026-10-28T09:42:00Z',
};

const DETAIL: WorkDetail = { work: WORK, repo: REPO, runs: [RUN] };

const SESSION: Session = {
  id: 'sess_01JABCDEFGHJK',
  repoId: REPO_ID,
  target: 'work',
  workId: WORK_ID,
  title: 'Resolve the doubt',
  status: 'idle',
  branch: null,
  pendingProposal: null,
  usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
  contextTokens: 0,
  contextEpoch: 1,
  createdAt: '2026-10-28T09:12:00Z',
  updatedAt: '2026-10-28T09:12:00Z',
  lastMessage: null,
};

describe('WorkStore', () => {
  let http: HttpTestingController;
  let store: WorkStore;
  let navigate: MockInstance<typeof Router.prototype.navigate>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), WorkStore],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(WorkStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('loads the work detail and exposes the work state', () => {
    store.load(WORK_ID);
    http.expectOne(DETAIL_URL).flush(DETAIL);

    expect(store.detail()).toEqual(DETAIL);
    expect(store.state()).toBe('needs_decision');
    expect(store.loading()).toBe(false);
  });

  it('opens the decision session and navigates to it', () => {
    store.load(WORK_ID);
    http.expectOne(DETAIL_URL).flush(DETAIL);

    store.resolveDoubt();
    http
      .expectOne({ method: 'POST', url: `/v1/works/${WORK_ID}/decision` })
      .flush(SESSION, { status: 201, statusText: 'Created' });

    expect(navigate).toHaveBeenCalledWith(['/sessions', SESSION.id]);
  });

  it('reworks the same work and refetches the log instead of navigating', () => {
    store.load(WORK_ID);
    http.expectOne(DETAIL_URL).flush({ ...DETAIL, work: { ...WORK, state: 'merged' } });

    store.rework();
    http
      .expectOne({ method: 'POST', url: `/v1/works/${WORK_ID}/runs` })
      .flush({ ...RUN, state: 'queued' }, { status: 202, statusText: 'Accepted' });

    http.expectOne(DETAIL_URL).flush({ ...DETAIL, runs: [RUN, { ...RUN, state: 'queued' }] });

    expect(store.detail()?.runs).toHaveLength(2);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('surfaces a refused action as the screen error', () => {
    store.load(WORK_ID);
    http.expectOne(DETAIL_URL).flush(DETAIL);

    store.resolveDoubt();
    http
      .expectOne({ method: 'POST', url: `/v1/works/${WORK_ID}/decision` })
      .flush(
        { error: { code: 'conflict', message: 'Not blocked' } },
        { status: 409, statusText: 'Conflict' },
      );

    expect(store.error()).toMatchObject({ code: 'conflict' });
    expect(navigate).not.toHaveBeenCalled();
  });
});

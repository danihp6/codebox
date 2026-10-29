import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Repo, Run, Session, Work, WorkDetail } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { WorksApi } from './works.api';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const WORK_ID = 'wrk_01JABCDEFGHJK';

const REPO: Repo = {
  id: REPO_ID,
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: ['.github/**'],
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
  state: 'review',
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
  state: 'succeeded',
  trigger: 'manual',
  branch: 'cb/workers',
  baseRef: 'main',
  pr: { number: 12, url: 'https://github.com/acme/widgets/pull/12', mergeable: true },
  gate: { status: 'passed', exitCode: 0, durationMs: 1200 },
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0.25, tokensIn: 1, tokensOut: 1 },
  createdAt: '2026-10-28T09:12:00Z',
  finishedAt: '2026-10-28T10:12:00Z',
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

describe('WorksApi', () => {
  let http: HttpTestingController;
  let api: WorksApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), WorksApi],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(WorksApi);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('lists the works of one repository', () => {
    let works: readonly Work[] = [];
    api.list(REPO_ID).subscribe((page) => {
      works = page.data;
    });

    http.expectOne(`/v1/works?repoId=${REPO_ID}`).flush({ data: [WORK], nextCursor: null });

    expect(works).toEqual([WORK]);
  });

  it('reads one work detail with its repository and runs', () => {
    let detail: WorkDetail | null = null;
    api.get(WORK_ID).subscribe((result) => {
      detail = result;
    });

    http.expectOne(`/v1/works/${WORK_ID}`).flush(DETAIL);

    expect(detail).toEqual(DETAIL);
  });

  it('opens the decision session with an empty body', () => {
    let session: Session | null = null;
    api.decision(WORK_ID).subscribe((result) => {
      session = result;
    });

    const request = http.expectOne({ method: 'POST', url: `/v1/works/${WORK_ID}/decision` });
    expect(request.request.body).toEqual({});
    request.flush(SESSION, { status: 201, statusText: 'Created' });

    expect(session).toEqual(SESSION);
  });

  it('starts a rework attempt on the same work', () => {
    const runs: Run[] = [];
    api.startRun(WORK_ID).subscribe((result) => runs.push(result));

    const request = http.expectOne({ method: 'POST', url: `/v1/works/${WORK_ID}/runs` });
    expect(request.request.body).toEqual({});
    request.flush({ ...RUN, state: 'queued' }, { status: 202, statusText: 'Accepted' });

    expect(runs[0]?.id).toBe(RUN.id);
  });

  it('maps the envelope and a boundary failure to ApiError', () => {
    const failures: ApiError[] = [];
    api.get(WORK_ID).subscribe({ error: (error: ApiError) => failures.push(error) });
    http
      .expectOne(`/v1/works/${WORK_ID}`)
      .flush(
        { error: { code: 'not_found', message: 'Gone' } },
        { status: 404, statusText: 'Not Found' },
      );

    api.list(REPO_ID).subscribe({ error: (error: ApiError) => failures.push(error) });
    http.expectOne(`/v1/works?repoId=${REPO_ID}`).flush({ data: [{ id: 'nope' }], nextCursor: null });

    expect(failures[0]).toMatchObject({ status: 404, code: 'not_found' });
    expect(failures[1]).toMatchObject({ status: 200, code: 'contract' });
  });
});

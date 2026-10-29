import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Backlog, Run, Session, Work } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { BacklogApi } from './backlog.api';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const WORK_ID = 'wrk_01JABCDEFGHJK';

const BACKLOG: Backlog = {
  repoId: REPO_ID,
  revision: '9f1c2ab',
  path: 'TODO.md',
  sections: [
    {
      title: 'Batch 15',
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
  id: 'run_01JABCDEFGHJK',
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

const SESSION: Session = {
  id: 'sess_01JABCDEFGHJK',
  repoId: REPO_ID,
  target: 'backlog',
  workId: null,
  title: 'Edit the backlog',
  status: 'idle',
  branch: 'cb/backlog-edit',
  pendingProposal: null,
  usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
  contextTokens: 0,
  contextEpoch: 1,
  createdAt: '2026-10-28T09:12:00Z',
  updatedAt: '2026-10-28T09:12:00Z',
  lastMessage: null,
};

describe('BacklogApi', () => {
  let http: HttpTestingController;
  let api: BacklogApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), BacklogApi],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(BacklogApi);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('reads the parsed backlog of one repository', () => {
    let backlog: Backlog | null = null;
    api.get(REPO_ID).subscribe((result) => {
      backlog = result;
    });

    http.expectOne(`/v1/repos/${REPO_ID}/backlog`).flush(BACKLOG);

    expect(backlog).toEqual(BACKLOG);
  });

  it('creates a work with the repo id and the ref', () => {
    let work: Work | null = null;
    api.createWork({ repoId: REPO_ID, backlogRef: 'Task-77' }).subscribe((result) => {
      work = result;
    });

    const request = http.expectOne({ method: 'POST', url: '/v1/works' });
    expect(request.request.body).toEqual({ repoId: REPO_ID, backlogRef: 'Task-77' });
    request.flush(WORK, { status: 201, statusText: 'Created' });

    expect(work).toEqual(WORK);
  });

  it('starts one attempt with an empty body', () => {
    let run: Run | null = null;
    api.startRun(WORK_ID).subscribe((result) => {
      run = result;
    });

    const request = http.expectOne({ method: 'POST', url: `/v1/works/${WORK_ID}/runs` });
    expect(request.request.body).toEqual({});
    request.flush(RUN, { status: 202, statusText: 'Accepted' });

    expect(run).toEqual(RUN);
  });

  it('creates a session bound to one target and never names a work', () => {
    let session: Session | null = null;
    api.createSession({ repoId: REPO_ID, target: 'backlog' }).subscribe((result) => {
      session = result;
    });

    const request = http.expectOne({ method: 'POST', url: '/v1/sessions' });
    expect(request.request.body).toEqual({ repoId: REPO_ID, target: 'backlog' });
    request.flush(SESSION, { status: 201, statusText: 'Created' });

    expect(session).toEqual(SESSION);
  });

  it('maps the envelope and a boundary failure to ApiError', () => {
    const failures: ApiError[] = [];
    api.createWork({ repoId: REPO_ID, backlogRef: 'Task-77' }).subscribe({
      error: (error: ApiError) => failures.push(error),
    });
    http
      .expectOne({ method: 'POST', url: '/v1/works' })
      .flush(
        { error: { code: 'conflict', message: 'Live work', details: { reason: 'live_work' } } },
        { status: 409, statusText: 'Conflict' },
      );

    api.get(REPO_ID).subscribe({ error: (error: ApiError) => failures.push(error) });
    http.expectOne(`/v1/repos/${REPO_ID}/backlog`).flush({ repoId: 'nope' });

    expect(failures[0]).toMatchObject({ status: 409, code: 'conflict' });
    expect(failures[1]).toMatchObject({ status: 200, code: 'contract' });
  });
});

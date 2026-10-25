import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ContractParseError } from '@codebox/contracts';
import type { Job, Run } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { JobsApi, parseJobDetail, parseNextFires } from './jobs.api';
import type { JobDetail } from './jobs.api';

const JOB_ID = 'job_01JABCDEFGHJKMNPQRSV';
const ROUTE_ID = 'job_1';
const RUN_ID = 'run_01JABCDEFGHJKMNPQRSV';
const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';

const JOB: Job = {
  id: JOB_ID,
  repoId: REPO_ID,
  title: 'Nightly lockfile',
  prompt: 'Update the lockfile, run the gate, fix what breaks.',
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

const DETAIL: JobDetail = {
  job: JOB,
  lastRuns: [RUN],
  nextFires: ['2026-10-25T02:00:00Z'],
};

const ENVELOPE = {
  error: {
    code: 'validation_failed',
    message: 'The cron expression is not valid.',
    requestId: 'req_01JABCDEFGHJKMNPQRSV',
    details: { path: 'job.cron', reason: 'range' },
  },
};

describe('JobsApi', () => {
  let api: JobsApi;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    api = TestBed.inject(JobsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('reads the job detail from GET /v1/jobs/{id}', () => {
    let detail: JobDetail | undefined;
    api.get(ROUTE_ID).subscribe((value) => {
      detail = value;
    });

    const request = http.expectOne('/v1/jobs/job_1');
    expect(request.request.method).toBe('GET');
    request.flush(DETAIL);

    expect(detail?.job).toMatchObject({ id: JOB_ID, cron: '0 3 * * *' });
    expect(detail?.lastRuns).toHaveLength(1);
    expect(detail?.nextFires).toEqual(['2026-10-25T02:00:00Z']);
  });

  it('rejects a detail without nextFires as a jobDetail parse error', () => {
    let failure: unknown;
    api.get(ROUTE_ID).subscribe({ error: (error: unknown) => (failure = error) });

    http.expectOne('/v1/jobs/job_1').flush({ job: JOB, lastRuns: [] });

    expect(failure).toBeInstanceOf(ContractParseError);
    expect((failure as ContractParseError).boundary).toBe('jobDetail');
    expect((failure as ContractParseError).first.path).toBe('nextFires');
  });

  it('parses the detail by hand, including an unknown key', () => {
    expect(() => parseJobDetail({ ...DETAIL, extra: true })).toThrow(ContractParseError);
    expect(parseJobDetail(DETAIL)).toEqual(DETAIL);
  });

  it('sends only the keys it is given on patch', () => {
    api.patch(ROUTE_ID, { title: 'Renamed' }).subscribe();

    const request = http.expectOne({ method: 'PATCH', url: '/v1/jobs/job_1' });
    expect(request.request.body).toEqual({ title: 'Renamed' });
    request.flush({ ...JOB, title: 'Renamed' });
  });

  it('creates a job with POST /v1/jobs and parses the answer', () => {
    let created: Job | undefined;
    api
      .create({
        repoId: REPO_ID,
        title: JOB.title,
        prompt: JOB.prompt,
        cron: JOB.cron,
        timezone: JOB.timezone,
      })
      .subscribe((value) => {
        created = value;
      });

    const request = http.expectOne({ method: 'POST', url: '/v1/jobs' });
    expect(request.request.body).toMatchObject({ repoId: REPO_ID, cron: '0 3 * * *' });
    request.flush(JOB);

    expect(created?.id).toBe(JOB_ID);
  });

  it('pauses and resumes a job', () => {
    api.pause(ROUTE_ID).subscribe();
    http
      .expectOne({ method: 'POST', url: '/v1/jobs/job_1/pause' })
      .flush({ ...JOB, enabled: false, nextFireAt: null });

    api.resume(ROUTE_ID).subscribe();
    http.expectOne({ method: 'POST', url: '/v1/jobs/job_1/resume' }).flush(JOB);
  });

  it('runs a job now with the given idempotency key and parses the run', () => {
    let run: Run | undefined;
    api.runNow(ROUTE_ID, 'runnow-job_1-1').subscribe((value) => {
      run = value;
    });

    const request = http.expectOne({ method: 'POST', url: '/v1/jobs/job_1/run' });
    expect(request.request.headers.get('Idempotency-Key')).toBe('runnow-job_1-1');
    request.flush(RUN, { status: 202, statusText: 'Accepted' });

    expect(run?.id).toBe(RUN_ID);
    expect(run?.state).toBe('queued');
  });

  it('previews the next fires', () => {
    let fires: readonly string[] = [];
    api.next(ROUTE_ID, 5).subscribe((value) => {
      fires = value;
    });

    http
      .expectOne('/v1/jobs/job_1/next?count=5')
      .flush({ fires: ['2026-10-25T02:00:00Z', '2026-10-26T02:00:00Z'] });

    expect(fires).toEqual(['2026-10-25T02:00:00Z', '2026-10-26T02:00:00Z']);
    expect(() => parseNextFires({ fires: ['nope'] })).toThrow(ContractParseError);
  });

  it('maps a 422 envelope to an ApiError that keeps the field path', () => {
    let failure: unknown;
    api
      .create({
        repoId: REPO_ID,
        title: JOB.title,
        prompt: JOB.prompt,
        cron: '61 3 * * *',
        timezone: JOB.timezone,
      })
      .subscribe({ error: (error: unknown) => (failure = error) });

    http.expectOne({ method: 'POST', url: '/v1/jobs' }).flush(ENVELOPE, {
      status: 422,
      statusText: 'Unprocessable Entity',
    });

    expect(failure).toBeInstanceOf(ApiError);
    const error = failure as ApiError;
    expect(error.status).toBe(422);
    expect(error.code).toBe('validation_failed');
    expect(error.requestId).toBe('req_01JABCDEFGHJKMNPQRSV');
    expect(error.details?.['path']).toBe('job.cron');
  });

  it('removes a job without a body', () => {
    api.remove(ROUTE_ID).subscribe();

    const request = http.expectOne({ method: 'DELETE', url: '/v1/jobs/job_1' });
    request.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('lists repositories for the create form', () => {
    let count = 0;
    api.listRepos().subscribe((page) => {
      count = page.data.length;
    });

    const request = http.expectOne('/v1/repos?limit=200');
    expect(request.request.method).toBe('GET');
    request.flush({ data: [], nextCursor: null });

    expect(count).toBe(0);
  });
});

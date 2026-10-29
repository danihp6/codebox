import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Repo, Run } from '@codebox/contracts';
import { catchError, firstValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { DashboardApi } from './dashboard.api';

const TS = '2026-10-24T18:04:02Z';
const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';

const RUN: Run = {
  id: 'run_01JABCDEFGHJKMNPQRSV',
  repoId: REPO_ID,
  jobId: null,
  state: 'pr_open',
  trigger: 'manual',
  branch: 'cb/run-x',
  baseRef: 'main',
  pr: { number: 42, url: 'https://github.com/dani/example/pull/42', mergeable: true },
  gate: null,
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0.42, tokensIn: 10, tokensOut: 5 },
  createdAt: TS,
  finishedAt: null,
};

const REPO: Repo = {
  id: REPO_ID,
  slug: 'dani/example',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: ['.github/**'],
  enabled: true,
  createdAt: TS,
};

const RUNS_URL = '/v1/runs';
const REPOS_URL = '/v1/repos';

function asApiError(value: unknown): ApiError {
  if (!(value instanceof ApiError)) throw new Error('expected an ApiError');
  return value;
}

describe('DashboardApi', () => {
  let http: HttpTestingController;
  let api: DashboardApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(DashboardApi);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('reads the runs with the page limit', async () => {
    const pending = firstValueFrom(api.runs());

    const request = http.expectOne((candidate) => candidate.url === RUNS_URL);
    expect(request.request.method).toBe('GET');
    expect(request.request.urlWithParams).toBe('/v1/runs?limit=50');
    request.flush({ data: [RUN], nextCursor: null });

    await expect(pending).resolves.toEqual({ data: [RUN], nextCursor: null });
  });

  it('probes a single repository for the first-run card', async () => {
    const pending = firstValueFrom(api.repos());

    const request = http.expectOne((candidate) => candidate.url === REPOS_URL);
    expect(request.request.method).toBe('GET');
    expect(request.request.urlWithParams).toBe('/v1/repos?limit=1');
    request.flush({ data: [], nextCursor: null });

    await expect(pending).resolves.toEqual({ data: [], nextCursor: null });
  });

  it('passes an explicit limit through', async () => {
    const pending = firstValueFrom(api.runs(10));

    http.expectOne('/v1/runs?limit=10').flush({ data: [], nextCursor: null });

    await expect(pending).resolves.toEqual({ data: [], nextCursor: null });
  });

  it('maps a malformed page to a contract ApiError', async () => {
    const pending = firstValueFrom(api.runs().pipe(catchError((error: ApiError) => of(error))));

    http.expectOne('/v1/runs?limit=50').flush({ data: 'nope', nextCursor: null });

    const failure = asApiError(await pending);
    expect(failure.code).toBe('contract');
    expect(failure.status).toBe(200);
  });

  it('rejects a page row with an unknown field', async () => {
    const pending = firstValueFrom(api.repos().pipe(catchError((error: ApiError) => of(error))));

    http.expectOne('/v1/repos?limit=1').flush({
      data: [{ ...REPO, surprise: true }],
      nextCursor: null,
    });

    expect(asApiError(await pending).code).toBe('contract');
  });

  it('maps a transport failure to its envelope code', async () => {
    const pending = firstValueFrom(api.runs().pipe(catchError((error: ApiError) => of(error))));

    http.expectOne('/v1/runs?limit=50').flush(
      {
        error: {
          code: 'unauthorized',
          message: 'Expired',
          requestId: 'req_01JABCDEFGHJKMNPQRSV',
        },
      },
      { status: 401, statusText: 'Unauthorized' },
    );

    const failure = asApiError(await pending);
    expect(failure.code).toBe('unauthorized');
    expect(failure.status).toBe(401);
  });
});

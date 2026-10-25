import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Repo, RepoDetail, RepoVerify } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { toCreateBody } from './repo-form';
import type { RepoFormValues } from './repo-form';
import { ReposApi } from './repos.api';

const REPO: Repo = {
  id: 'repo_01JABCDEFGHJKMNPQRSV',
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm ci && npm test',
  policy: 'auto',
  protectedPaths: ['.github/**'],
  enabled: true,
  createdAt: '2026-10-24T18:03:11Z',
};

const DETAIL: RepoDetail = { ...REPO, lastRun: null };

const VERIFY: RepoVerify = {
  ok: true,
  defaultBranch: 'main',
  canPush: true,
  checks: [
    { name: 'token', state: 'ok' },
    { name: 'push', state: 'ok' },
  ],
};

const FORM: RepoFormValues = {
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm ci && npm test',
  protectedPaths: '.github/**\nops/**',
};

describe('ReposApi', () => {
  let http: HttpTestingController;
  let api: ReposApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ReposApi],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(ReposApi);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('parses the repository page', () => {
    let page: readonly Repo[] = [];
    api.list({ limit: 50 }).subscribe((result) => {
      page = result.data;
    });

    const request = http.expectOne('/v1/repos?limit=50');
    expect(request.request.method).toBe('GET');
    request.flush({ data: [REPO], nextCursor: null });

    expect(page).toEqual([REPO]);
  });

  it('parses a repository detail with its last run', () => {
    let detail: RepoDetail | null = null;
    api.get('repo_x').subscribe((result) => {
      detail = result;
    });

    http.expectOne('/v1/repos/repo_x').flush(DETAIL);

    expect(detail).toMatchObject({ id: REPO.id, lastRun: null });
  });

  it('creates with exactly the body built from the wizard values', () => {
    let created: Repo | null = null;
    api.create(toCreateBody(FORM)).subscribe((result) => {
      created = result;
    });

    const request = http.expectOne({ method: 'POST', url: '/v1/repos' });
    expect(request.request.body).toEqual({
      slug: 'acme/widgets',
      defaultBranch: 'main',
      gate: 'npm ci && npm test',
      protectedPaths: ['.github/**', 'ops/**'],
    });
    request.flush(REPO, { status: 201, statusText: 'Created' });

    expect(created).toEqual(REPO);
  });

  it('patches the policy and parses the returned repository', () => {
    let patched: Repo | null = null;
    api.patch(REPO.id, { policy: 'manual' }).subscribe((result) => {
      patched = result;
    });

    const request = http.expectOne({ method: 'PATCH', url: `/v1/repos/${REPO.id}` });
    expect(request.request.body).toEqual({ policy: 'manual' });
    request.flush({ ...REPO, policy: 'manual' });

    expect(patched).toMatchObject({ policy: 'manual' });
  });

  it('deletes without a body', () => {
    let done = false;
    api.remove(REPO.id).subscribe(() => {
      done = true;
    });

    const request = http.expectOne({ method: 'DELETE', url: `/v1/repos/${REPO.id}` });
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(done).toBe(true);
  });

  it('verifies a repository', () => {
    let result: RepoVerify | null = null;
    api.verify('repo_1').subscribe((value) => {
      result = value;
    });

    const request = http.expectOne({ method: 'POST', url: '/v1/repos/repo_1/verify' });
    request.flush(VERIFY);

    expect(result).toEqual(VERIFY);
  });

  it('turns a 422 envelope into an ApiError with its code and details', () => {
    let failure: ApiError | null = null;
    api.verify('repo_1').subscribe({
      error: (error: ApiError) => {
        failure = error;
      },
    });

    http.expectOne({ method: 'POST', url: '/v1/repos/repo_1/verify' }).flush(
      {
        error: {
          code: 'validation_failed',
          message: 'x',
          requestId: 'req_1',
          details: { path: 'repo.slug' },
        },
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 422,
      code: 'validation_failed',
      message: 'x',
      details: { path: 'repo.slug' },
    });
  });

  it('keeps the request id header when the body is not an envelope', () => {
    let failure: ApiError | null = null;
    api.list().subscribe({
      error: (error: ApiError) => {
        failure = error;
      },
    });

    http
      .expectOne('/v1/repos')
      .flush('nope', { status: 401, statusText: 'Unauthorized', headers: { 'x-request-id': 'req_9' } });

    expect(failure).toMatchObject({
      status: 401,
      code: 'unauthorized',
      requestId: 'req_9',
      details: null,
    });
  });

  it('turns a malformed body into a contract ApiError', () => {
    let failure: ApiError | null = null;
    api.get('repo_x').subscribe({
      error: (error: ApiError) => {
        failure = error;
      },
    });

    http.expectOne('/v1/repos/repo_x').flush({ id: 'not-a-repo-id' });

    expect(failure).toMatchObject({ code: 'contract', status: 200 });
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Repo, RepoVerify } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toCreateBody } from './repo-form';
import type { RepoFormValues } from './repo-form';
import { ReposStore } from './repos.store';

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

const LIST_URL = '/v1/repos';
const CREATE_URL = '/v1/repos';
const VERIFY_URL = `/v1/repos/${REPO.id}/verify`;

describe('ReposStore', () => {
  let http: HttpTestingController;
  let store: ReposStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ReposStore],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(ReposStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('loads the repository page into the signal', () => {
    store.load();

    expect(store.loading()).toBe(true);
    http.expectOne(LIST_URL).flush({ data: [REPO], nextCursor: null });

    expect(store.loading()).toBe(false);
    expect(store.repos()).toEqual([REPO]);
    expect(store.error()).toBeNull();
  });

  it('creates, appends the returned row and verifies it without a reload', () => {
    store.load();
    http.expectOne(LIST_URL).flush({ data: [], nextCursor: null });

    store.create(toCreateBody(FORM));

    expect(store.creating()).toBe(true);
    const create = http.expectOne({ method: 'POST', url: CREATE_URL });
    expect(create.request.body).toEqual({
      slug: 'acme/widgets',
      defaultBranch: 'main',
      gate: 'npm ci && npm test',
      protectedPaths: ['.github/**', 'ops/**'],
    });
    expect(store.repos()).toEqual([]);

    create.flush(REPO, { status: 201, statusText: 'Created' });

    expect(store.creating()).toBe(false);
    expect(store.repos()).toEqual([REPO]);

    const verify = http.expectOne({ method: 'POST', url: VERIFY_URL });
    expect(store.verifyFor()).toBe(REPO.id);
    verify.flush(VERIFY);

    expect(store.verifyFor()).toBeNull();
    expect(store.verification()).toEqual(VERIFY);
    expect(store.verifyError()).toBeNull();
    http.expectNone(LIST_URL);
  });

  it('keeps the row and reports a failed verification', () => {
    store.load();
    http.expectOne(LIST_URL).flush({ data: [], nextCursor: null });

    store.create(toCreateBody(FORM));
    http.expectOne({ method: 'POST', url: CREATE_URL }).flush(REPO, {
      status: 201,
      statusText: 'Created',
    });
    http.expectOne({ method: 'POST', url: VERIFY_URL }).flush(
      { error: { code: 'provider_unavailable', message: 'no token', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
      { status: 503, statusText: 'Service Unavailable' },
    );

    expect(store.repos()).toEqual([REPO]);
    expect(store.verification()).toBeNull();
    expect(store.verifyError()).toMatchObject({ status: 503, code: 'provider_unavailable' });
    expect(store.verifyFor()).toBeNull();
  });

  it('reports a failed create without inserting a row', () => {
    store.load();
    http.expectOne(LIST_URL).flush({ data: [], nextCursor: null });

    store.create(toCreateBody(FORM));
    http.expectOne({ method: 'POST', url: CREATE_URL }).flush(
      {
        error: {
          code: 'repo_not_allowed',
          message: 'outside the allowlist',
          requestId: 'req_01JABCDEFGHJKMNPQRSV',
        },
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    expect(store.repos()).toEqual([]);
    expect(store.creating()).toBe(false);
    expect(store.error()).toMatchObject({ status: 422, code: 'repo_not_allowed' });
    http.expectNone(VERIFY_URL);
  });

  it('verifies an existing row on demand', () => {
    store.load();
    http.expectOne(LIST_URL).flush({ data: [REPO], nextCursor: null });

    store.verify(REPO.id);
    expect(store.verifyFor()).toBe(REPO.id);
    http.expectOne({ method: 'POST', url: VERIFY_URL }).flush(VERIFY);

    expect(store.verification()).toEqual(VERIFY);
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Repo, RepoDetail, RepoVerify, Run } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoStore } from './repo.store';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const OTHER_ID = 'repo_01JABCDEFGHJKMNPQRSW';

const REPO: Repo = {
  id: REPO_ID,
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm ci && npm test',
  policy: 'auto',
  protectedPaths: ['.github/**'],
  enabled: true,
  createdAt: '2026-10-24T18:03:11Z',
};

const RUN: Run = {
  id: 'run_01JABCDEFGHJKMNPQRSV',
  repoId: REPO_ID,
  jobId: null,
  state: 'succeeded',
  trigger: 'manual',
  branch: 'cb/run-x',
  baseRef: 'main',
  pr: null,
  gate: null,
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0.1, tokensIn: 1, tokensOut: 1 },
  createdAt: '2026-10-24T18:03:11Z',
  finishedAt: '2026-10-24T18:04:11Z',
};

const DETAIL: RepoDetail = { ...REPO, lastRun: null };

const VERIFY: RepoVerify = {
  ok: true,
  defaultBranch: 'main',
  canPush: true,
  checks: [{ name: 'token', state: 'ok' }],
};

const GET_URL = `/v1/repos/${REPO_ID}`;
const PATCH_URL = `/v1/repos/${REPO_ID}`;
const VERIFY_URL = `/v1/repos/${REPO_ID}/verify`;

function envelope(code: string): Record<string, unknown> {
  return { error: { code, message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } };
}

describe('RepoStore', () => {
  let http: HttpTestingController;
  let store: RepoStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), RepoStore],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RepoStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  function load(detail: RepoDetail = DETAIL): void {
    store.load(REPO_ID);
    http.expectOne(GET_URL).flush(detail);
  }

  it('loads the repository detail and exposes its protected paths', () => {
    load();

    expect(store.repoId()).toBe(REPO_ID);
    expect(store.repo()).toEqual(DETAIL);
    expect(store.effectiveProtectedPaths()).toEqual(['.github/**']);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('resets the previous repository when the id changes', () => {
    load();
    store.load(OTHER_ID);

    expect(store.repo()).toBeNull();
    expect(store.loading()).toBe(true);
    http.expectOne(`/v1/repos/${OTHER_ID}`).flush({ ...DETAIL, id: OTHER_ID });
  });

  it('flips the policy before the request resolves', () => {
    load();

    store.setPolicy('manual');

    expect(store.repo()?.policy).toBe('manual');
    expect(store.saving()).toBe(true);
    const patch = http.expectOne({ method: 'PATCH', url: PATCH_URL });
    expect(patch.request.body).toEqual({ policy: 'manual' });

    patch.flush({ ...REPO, policy: 'manual' });

    expect(store.saving()).toBe(false);
    expect(store.repo()).toMatchObject({ policy: 'manual', lastRun: null });
    expect(store.error()).toBeNull();
  });

  it('rolls the policy back and reports the failure', () => {
    load();

    store.setPolicy('manual');
    http
      .expectOne({ method: 'PATCH', url: PATCH_URL })
      .flush(envelope('conflict'), { status: 409, statusText: 'Conflict' });

    expect(store.repo()?.policy).toBe('auto');
    expect(store.error()).toMatchObject({ status: 409, code: 'conflict' });
    expect(store.saving()).toBe(false);
  });

  it('sends nothing while a save is in flight', () => {
    load();

    store.setPolicy('manual');
    store.setPolicy('auto');
    store.saveGate('other');

    expect(store.repo()?.policy).toBe('manual');
    http.expectOne({ method: 'PATCH', url: PATCH_URL }).flush({ ...REPO, policy: 'manual' });
    http.expectNone({ method: 'PATCH', url: PATCH_URL });
  });

  it('keeps the last run when the patch returns a plain repository', () => {
    load({ ...DETAIL, lastRun: RUN });

    store.saveGate('npm test');

    const patch = http.expectOne({ method: 'PATCH', url: PATCH_URL });
    expect(patch.request.body).toEqual({ gate: 'npm test' });
    patch.flush({ ...REPO, gate: 'npm test' });

    expect(store.repo()).toMatchObject({ gate: 'npm test', lastRun: RUN });
  });

  it('saves the protected paths', () => {
    load();

    store.saveProtectedPaths(['.github/**', 'ops/**']);

    const patch = http.expectOne({ method: 'PATCH', url: PATCH_URL });
    expect(patch.request.body).toEqual({ protectedPaths: ['.github/**', 'ops/**'] });
    patch.flush({ ...REPO, protectedPaths: ['.github/**', 'ops/**'] });

    expect(store.effectiveProtectedPaths()).toEqual(['.github/**', 'ops/**']);
  });

  it('reports a failed gate save without changing the repository', () => {
    load();

    store.saveGate('npm test');
    http
      .expectOne({ method: 'PATCH', url: PATCH_URL })
      .flush(envelope('validation_failed'), { status: 422, statusText: 'Unprocessable Entity' });

    expect(store.repo()?.gate).toBe(REPO.gate);
    expect(store.error()).toMatchObject({ code: 'validation_failed' });
    expect(store.saving()).toBe(false);
  });

  it('verifies the repository into its own signals', () => {
    load();

    store.verify();
    http.expectOne({ method: 'POST', url: VERIFY_URL }).flush(VERIFY);

    expect(store.verification()).toEqual(VERIFY);
    expect(store.verifyError()).toBeNull();
  });

  it('keeps a failed verification out of the page error', () => {
    load();

    store.verify();
    http
      .expectOne({ method: 'POST', url: VERIFY_URL })
      .flush(envelope('provider_unavailable'), {
        status: 503,
        statusText: 'Service Unavailable',
      });

    expect(store.verification()).toBeNull();
    expect(store.verifyError()).toMatchObject({ code: 'provider_unavailable' });
    expect(store.error()).toBeNull();
    expect(store.repo()).toEqual(DETAIL);
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import type { Credential, Integration } from './credentials.api';
import { CredentialsStore } from './credentials.store';

const TS = '2026-10-27T10:00:00Z';
const REQUEST_ID = 'req_01JABCDEFGHJKMNPQRSV';
const CREDENTIALS_URL = '/v1/credentials';
const INTEGRATIONS_URL = '/v1/integrations';

const MODEL_KEY = {
  id: 'cred_01JABCDEFG',
  name: 'OpenAI',
  kind: 'model_key',
  expose: 'env',
  configured: true,
  lastFour: 'abcd',
  createdAt: TS,
  updatedAt: TS,
  lastUsedAt: null,
} satisfies Credential;

const GITHUB_CREDENTIAL = {
  id: 'cred_01JABCDEFH',
  name: 'GitHub App 42',
  kind: 'github_app',
  expose: 'daemon',
  configured: true,
  lastFour: 'wxyz',
  createdAt: TS,
  updatedAt: TS,
  lastUsedAt: TS,
} satisfies Credential;

const INTEGRATION = {
  id: 'int_01JABCDEFG',
  name: 'Linear',
  baseUrl: 'https://api.linear.app',
  auth: 'bearer',
  headerName: null,
  credentialId: MODEL_KEY.id,
  allowedHosts: ['api.linear.app'],
  createdAt: TS,
  updatedAt: TS,
} satisfies Integration;

const FAILURE = {
  error: {
    code: 'internal',
    message: 'Boom',
    requestId: REQUEST_ID,
  },
};

let store: CredentialsStore;
let http: HttpTestingController;

function flushCatalog(
  credentials: readonly Credential[],
  integrations: readonly Integration[],
): void {
  http.expectOne(CREDENTIALS_URL).flush({ data: [...credentials], nextCursor: null });
  http.expectOne(INTEGRATIONS_URL).flush({ data: [...integrations], nextCursor: null });
}

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [CredentialsStore, provideHttpClient(), provideHttpClientTesting()],
  });
  store = TestBed.inject(CredentialsStore);
  http = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  http.verify();
  TestBed.resetTestingModule();
});

describe('CredentialsStore', () => {
  it('loads both lists independently and clears the spinner when both settle', () => {
    store.load();
    expect(store.loading()).toBe(true);

    http.expectOne(CREDENTIALS_URL).flush({ data: [MODEL_KEY], nextCursor: null });
    expect(store.credentials()).toEqual([MODEL_KEY]);
    expect(store.loading()).toBe(true);

    http.expectOne(INTEGRATIONS_URL).flush({ data: [INTEGRATION], nextCursor: null });
    expect(store.integrations()).toEqual([INTEGRATION]);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('keeps the integrations list when the credential read fails', () => {
    store.load();

    http
      .expectOne(CREDENTIALS_URL)
      .flush(FAILURE, { status: 500, statusText: 'Internal Server Error' });
    http.expectOne(INTEGRATIONS_URL).flush({ data: [INTEGRATION], nextCursor: null });

    expect(store.error()).toBeInstanceOf(ApiError);
    expect(store.error()?.code).toBe('internal');
    expect(store.integrations()).toEqual([INTEGRATION]);
    expect(store.credentials()).toEqual([]);
    expect(store.loading()).toBe(false);
  });

  it('exposes integrations as services and hides GitHub App credentials from the open list', () => {
    store.load();
    flushCatalog([MODEL_KEY, GITHUB_CREDENTIAL], [INTEGRATION]);

    expect(store.services()).toEqual(store.integrations());
    expect(store.openCredentials()).toEqual([MODEL_KEY]);
  });

  it('creates a credential, then reloads the catalog', () => {
    const body = {
      name: 'OpenAI',
      kind: 'model_key',
      expose: 'env',
      value: 'sentinel-value',
    } as const;
    store.createCredential(body);
    expect(store.saving()).toBe(true);

    const create = http.expectOne({ method: 'POST', url: CREDENTIALS_URL });
    expect(create.request.body).toEqual(body);
    create.flush(MODEL_KEY, { status: 201, statusText: 'Created' });
    expect(store.saving()).toBe(false);

    flushCatalog([MODEL_KEY], []);
    expect(store.credentials()).toEqual([MODEL_KEY]);
  });

  it('removes a credential, then reloads the catalog', () => {
    store.removeCredential(MODEL_KEY.id);

    const remove = http.expectOne({ method: 'DELETE', url: `${CREDENTIALS_URL}/${MODEL_KEY.id}` });
    remove.flush(null, { status: 204, statusText: 'No Content' });

    flushCatalog([], [INTEGRATION]);
    expect(store.credentials()).toEqual([]);
    expect(store.integrations()).toEqual([INTEGRATION]);
    expect(store.saving()).toBe(false);
  });

  it('creates an integration, then reloads the catalog', () => {
    const body = {
      name: 'Linear',
      baseUrl: 'https://api.linear.app',
      auth: 'bearer',
      credentialId: MODEL_KEY.id,
      allowedHosts: ['api.linear.app'],
    } as const;
    store.createIntegration(body);

    const create = http.expectOne({ method: 'POST', url: INTEGRATIONS_URL });
    expect(create.request.body).toEqual(body);
    create.flush(INTEGRATION, { status: 201, statusText: 'Created' });

    flushCatalog([MODEL_KEY], [INTEGRATION]);
    expect(store.integrations()).toEqual([INTEGRATION]);
  });

  it('delegates the manifest start to the api', () => {
    const values: unknown[] = [];
    store.startGithubManifest().subscribe((value) => values.push(value));

    const start = http.expectOne({ method: 'POST', url: `${INTEGRATIONS_URL}/github/manifest` });
    start.flush({
      action: 'https://github.com/settings/apps/new?state=st_1',
      manifest: { name: 'codebox' },
      state: 'st_1',
    });

    expect(values).toEqual([
      {
        action: 'https://github.com/settings/apps/new?state=st_1',
        manifest: { name: 'codebox' },
        state: 'st_1',
      },
    ]);
  });

  it('completes the manifest flow, then reloads the catalog', () => {
    store.completeGithubManifest('code_01', 'st_1');
    expect(store.saving()).toBe(true);

    const complete = http.expectOne({
      method: 'POST',
      url: `${INTEGRATIONS_URL}/github/complete`,
    });
    expect(complete.request.body).toEqual({ code: 'code_01', state: 'st_1' });
    complete.flush({ configured: true, appId: 42, credentialId: GITHUB_CREDENTIAL.id });

    flushCatalog([GITHUB_CREDENTIAL], []);
    expect(store.credentials()).toEqual([GITHUB_CREDENTIAL]);
    expect(store.saving()).toBe(false);
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ContractParseError } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Observable } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import {
  CredentialsApi,
  parseCredential,
  parseCredentialPage,
  parseGithubManifestComplete,
  parseGithubManifestStart,
  parseIntegration,
  parseIntegrationPage,
} from './credentials.api';
import type { Credential, Integration } from './credentials.api';

const TS = '2026-10-27T10:00:00Z';
const REQUEST_ID = 'req_01JABCDEFGHJKMNPQRSV';

const CREDENTIAL = {
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
  credentialId: CREDENTIAL.id,
  allowedHosts: ['api.linear.app'],
  createdAt: TS,
  updatedAt: TS,
} satisfies Integration;

const MANIFEST_START = {
  action: 'https://github.com/settings/apps/new?state=st_01JABCDEFG',
  manifest: { name: 'codebox', url: 'https://cb.example.com', hook_attributes: { active: false } },
  state: 'st_01JABCDEFG',
} as const;

const MANIFEST_COMPLETE = {
  configured: true,
  appId: 42,
  credentialId: GITHUB_CREDENTIAL.id,
} as const;

const CREDENTIALS_URL = '/v1/credentials';
const INTEGRATIONS_URL = '/v1/integrations';

interface Collected<T> {
  readonly values: T[];
  readonly errors: unknown[];
}

function collect<T>(source: Observable<T>): Collected<T> {
  const values: T[] = [];
  const errors: unknown[] = [];
  source.subscribe({
    next: (value) => values.push(value),
    error: (error: unknown) => errors.push(error),
  });
  return { values, errors };
}

function boundaryOf(parse: () => unknown): string {
  try {
    parse();
  } catch (error) {
    if (error instanceof ContractParseError) return error.boundary;
    throw error;
  }
  throw new Error('expected a ContractParseError');
}

function without(input: object, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...input };
  delete copy[key];
  return copy;
}

let api: CredentialsApi;
let http: HttpTestingController;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  api = TestBed.inject(CredentialsApi);
  http = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  http.verify();
  TestBed.resetTestingModule();
});

describe('CredentialsApi', () => {
  it('lists credentials with GET /v1/credentials', () => {
    const result = collect(api.listCredentials());
    const request = http.expectOne(CREDENTIALS_URL);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [CREDENTIAL, GITHUB_CREDENTIAL], nextCursor: 'cur_1' });

    expect(result.errors).toEqual([]);
    expect(result.values).toEqual([{ data: [CREDENTIAL, GITHUB_CREDENTIAL], nextCursor: 'cur_1' }]);
  });

  it('creates a credential with POST /v1/credentials', () => {
    const body = {
      name: 'OpenAI',
      kind: 'model_key',
      expose: 'env',
      value: 'sentinel-value',
    } as const;
    const result = collect(api.createCredential(body));
    const request = http.expectOne({ method: 'POST', url: CREDENTIALS_URL });
    expect(request.request.body).toEqual(body);
    request.flush(CREDENTIAL, { status: 201, statusText: 'Created' });

    expect(result.values).toEqual([CREDENTIAL]);
  });

  it('removes a credential with DELETE /v1/credentials/{id} and maps 204 to void', () => {
    const result = collect(api.removeCredential(CREDENTIAL.id));
    const request = http.expectOne({
      method: 'DELETE',
      url: `${CREDENTIALS_URL}/${CREDENTIAL.id}`,
    });
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(result.values).toEqual([undefined]);
    expect(result.errors).toEqual([]);
  });

  it('lists integrations with GET /v1/integrations', () => {
    const result = collect(api.listIntegrations());
    const request = http.expectOne(INTEGRATIONS_URL);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [INTEGRATION], nextCursor: null });

    expect(result.values).toEqual([{ data: [INTEGRATION], nextCursor: null }]);
  });

  it('creates an integration with POST /v1/integrations', () => {
    const body = {
      name: 'Linear',
      baseUrl: 'https://api.linear.app',
      auth: 'bearer',
      credentialId: CREDENTIAL.id,
      allowedHosts: ['api.linear.app'],
    } as const;
    const result = collect(api.createIntegration(body));
    const request = http.expectOne({ method: 'POST', url: INTEGRATIONS_URL });
    expect(request.request.body).toEqual(body);
    request.flush(INTEGRATION, { status: 201, statusText: 'Created' });

    expect(result.values).toEqual([INTEGRATION]);
  });

  it('removes an integration with DELETE /v1/integrations/{id}', () => {
    const result = collect(api.removeIntegration(INTEGRATION.id));
    const request = http.expectOne({
      method: 'DELETE',
      url: `${INTEGRATIONS_URL}/${INTEGRATION.id}`,
    });
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(result.values).toEqual([undefined]);
  });

  it('starts the GitHub manifest flow with POST /v1/integrations/github/manifest', () => {
    const result = collect(api.startGithubManifest());
    const request = http.expectOne({
      method: 'POST',
      url: `${INTEGRATIONS_URL}/github/manifest`,
    });
    expect(request.request.body).toBeNull();
    request.flush(MANIFEST_START);

    expect(result.values).toEqual([MANIFEST_START]);
  });

  it('completes the GitHub manifest flow with POST /v1/integrations/github/complete', () => {
    const result = collect(api.completeGithubManifest('code_01', 'st_01JABCDEFG'));
    const request = http.expectOne({
      method: 'POST',
      url: `${INTEGRATIONS_URL}/github/complete`,
    });
    expect(request.request.body).toEqual({ code: 'code_01', state: 'st_01JABCDEFG' });
    request.flush(MANIFEST_COMPLETE);

    expect(result.values).toEqual([MANIFEST_COMPLETE]);
  });

  it('maps the error envelope to an ApiError with its code and details', () => {
    const result = collect(api.listIntegrations());
    http.expectOne(INTEGRATIONS_URL).flush(
      {
        error: {
          code: 'provider_unavailable',
          message: 'Secrets are not configured',
          details: { reason: 'secrets_not_configured' },
          requestId: REQUEST_ID,
        },
      },
      { status: 503, statusText: 'Service Unavailable' },
    );

    const failure = result.errors[0];
    expect(failure).toBeInstanceOf(ApiError);
    const apiError = failure as ApiError;
    expect(apiError.code).toBe('provider_unavailable');
    expect(apiError.status).toBe(503);
    expect(apiError.requestId).toBe(REQUEST_ID);
    expect(apiError.details).toEqual({ reason: 'secrets_not_configured' });
  });

  it('surfaces a payload parse failure as an ApiError with code contract', () => {
    const result = collect(api.listCredentials());
    http.expectOne(CREDENTIALS_URL).flush({ data: [{ id: 'cred_1' }], nextCursor: null });

    const failure = result.errors[0];
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe('contract');
  });
});

describe('credential parsers', () => {
  it('accepts the documented credential and page payloads', () => {
    expect(parseCredential(CREDENTIAL)).toEqual(CREDENTIAL);
    expect(parseCredentialPage({ data: [CREDENTIAL], nextCursor: null })).toEqual({
      data: [CREDENTIAL],
      nextCursor: null,
    });
    expect(parseCredentialPage({ data: [], nextCursor: 'cur_2' })).toEqual({
      data: [],
      nextCursor: 'cur_2',
    });
  });

  it('rejects a credential with a missing key at the credential boundary', () => {
    for (const key of Object.keys(CREDENTIAL)) {
      expect(
        boundaryOf(() => parseCredential(without(CREDENTIAL, key))),
        key,
      ).toBe('credential');
    }
    expect(boundaryOf(() => parseCredentialPage({ data: [] }))).toBe('credential');
    expect(boundaryOf(() => parseCredentialPage({ data: 'nope', nextCursor: null }))).toBe(
      'credential',
    );
  });

  it('rejects an unknown credential key and a wrong enum', () => {
    expect(boundaryOf(() => parseCredential({ ...CREDENTIAL, value: 'leak' }))).toBe('credential');
    expect(boundaryOf(() => parseCredential({ ...CREDENTIAL, kind: 'pat' }))).toBe('credential');
    expect(boundaryOf(() => parseCredential({ ...CREDENTIAL, expose: 'world' }))).toBe(
      'credential',
    );
  });
});

describe('integration parsers', () => {
  it('accepts the documented integration and page payloads', () => {
    expect(parseIntegration(INTEGRATION)).toEqual(INTEGRATION);
    expect(parseIntegrationPage({ data: [INTEGRATION], nextCursor: null })).toEqual({
      data: [INTEGRATION],
      nextCursor: null,
    });
  });

  it('rejects an integration with a missing key at the integration boundary', () => {
    for (const key of Object.keys(INTEGRATION)) {
      expect(
        boundaryOf(() => parseIntegration(without(INTEGRATION, key))),
        key,
      ).toBe('integration');
    }
    expect(boundaryOf(() => parseIntegrationPage({ data: [] }))).toBe('integration');
  });

  it('rejects a non-string allowed host', () => {
    expect(
      boundaryOf(() => parseIntegration({ ...INTEGRATION, allowedHosts: ['api.acme.dev', 7] })),
    ).toBe('integration');
  });
});

describe('GitHub manifest parsers', () => {
  it('accepts the documented manifest payloads', () => {
    expect(parseGithubManifestStart(MANIFEST_START)).toEqual(MANIFEST_START);
    expect(parseGithubManifestComplete(MANIFEST_COMPLETE)).toEqual(MANIFEST_COMPLETE);
  });

  it('rejects missing keys at the githubManifest boundary', () => {
    for (const key of Object.keys(MANIFEST_START)) {
      expect(
        boundaryOf(() => parseGithubManifestStart(without(MANIFEST_START, key))),
        key,
      ).toBe('githubManifest');
    }
    for (const key of Object.keys(MANIFEST_COMPLETE)) {
      expect(
        boundaryOf(() => parseGithubManifestComplete(without(MANIFEST_COMPLETE, key))),
        key,
      ).toBe('githubManifest');
    }
  });

  it('requires configured to be literally true', () => {
    expect(
      boundaryOf(() => parseGithubManifestComplete({ ...MANIFEST_COMPLETE, configured: false })),
    ).toBe('githubManifest');
  });
});

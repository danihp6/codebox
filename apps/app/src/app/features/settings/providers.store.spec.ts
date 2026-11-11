import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ProvidersResponse } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProvidersStore } from './providers.store';
import type { ProviderRow } from './providers.store';

const TS = '2026-10-28T09:12:00Z';

function account(id: string, label: string, priority: number): ProviderRow['accounts'][number] {
  return {
    id,
    providerId: 'opencode-go',
    label,
    credentialId: `cred_${id}`,
    priority,
    state: 'active',
    resetAt: null,
    budgetUsd: null,
    usedToday: { day: '2026-10-28', usd: 0 },
    createdAt: TS,
    updatedAt: TS,
    lastFour: 'a91f',
  };
}

const PROVIDERS: ProvidersResponse = {
  providers: [
    {
      id: 'opencode-go',
      label: 'OpenCode Go',
      authKind: 'oauth',
      baseUrl: 'https://opencode.ai',
      createdAt: TS,
      updatedAt: TS,
      accounts: [account('acct_01JABCDEFG', 'go · one', 1), account('acct_01JABCDEFH', 'go · two', 2)],
    },
    {
      id: 'anthropic',
      label: 'Anthropic',
      authKind: 'token',
      baseUrl: null,
      createdAt: TS,
      updatedAt: TS,
      accounts: [],
    },
    {
      id: 'openai',
      label: 'OpenAI',
      authKind: 'token',
      baseUrl: null,
      createdAt: TS,
      updatedAt: TS,
      accounts: [],
    },
  ],
};

const PROVIDERS_URL = '/v1/providers';

describe('ProvidersStore', () => {
  let http: HttpTestingController;
  let store: ProvidersStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ProvidersStore],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(ProvidersStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('keeps the D54 rows from the response, in order', () => {
    store.load();
    expect(store.loading()).toBe(true);

    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(PROVIDERS);

    expect(store.loading()).toBe(false);
    expect(store.providers()).toEqual(PROVIDERS.providers);
    expect(store.providers().map((row) => row.id)).toEqual(['opencode-go', 'anthropic', 'openai']);
    expect(store.providers()[0]?.accounts.map((row) => row.priority)).toEqual([1, 2]);
    expect(store.unavailable()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('reports an absent route as unavailable, not as an empty list', () => {
    store.load();
    http
      .expectOne({ method: 'GET', url: PROVIDERS_URL })
      .flush('missing', { status: 404, statusText: 'Not Found' });

    expect(store.unavailable()).toBe(true);
    expect(store.providers()).toEqual([]);
    expect(store.error()).toBeNull();
    expect(store.loading()).toBe(false);
  });

  it('reports a 503 as unavailable', () => {
    store.load();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(
      {
        error: {
          code: 'internal',
          message: 'Providers read is not wired',
          requestId: 'req_01JABCDEFGHJKMNPQRSV',
        },
      },
      { status: 503, statusText: 'Service Unavailable' },
    );

    expect(store.unavailable()).toBe(true);
    expect(store.providers()).toEqual([]);
    expect(store.error()).toBeNull();
  });

  it('reports any other failure as an error and keeps the panel usable', () => {
    store.load();
    http
      .expectOne({ method: 'GET', url: PROVIDERS_URL })
      .flush(
        { error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
        { status: 500, statusText: 'Internal Server Error' },
      );

    expect(store.error()).toMatchObject({ status: 500, code: 'internal' });
    expect(store.unavailable()).toBe(false);
    expect(store.providers()).toEqual([]);
    expect(store.loading()).toBe(false);
  });

  it('still reports a retired body as a contract error', () => {
    store.load();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush({
      providers: [
        { provider: 'github', configured: true, mode: 'app', lastOkAt: null, fingerprint: 'abcd' },
      ],
    });

    expect(store.error()).toMatchObject({ status: 200, code: 'contract' });
    expect(store.unavailable()).toBe(false);
    expect(store.providers()).toEqual([]);
  });

  it('clears the unavailable mark when a retry succeeds', () => {
    store.load();
    http
      .expectOne({ method: 'GET', url: PROVIDERS_URL })
      .flush('missing', { status: 404, statusText: 'Not Found' });
    expect(store.unavailable()).toBe(true);

    store.load();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(PROVIDERS);

    expect(store.unavailable()).toBe(false);
    expect(store.providers()).toEqual(PROVIDERS.providers);
  });
});

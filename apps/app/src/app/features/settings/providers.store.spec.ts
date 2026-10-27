import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Providers } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProvidersStore } from './providers.store';

const TS = '2026-10-24T18:03:11Z';

const PROVIDERS: Providers = {
  providers: [
    { provider: 'github', configured: true, mode: 'app', lastOkAt: TS, fingerprint: 'abcd1234' },
    { provider: 'opencode', configured: false, mode: 'none', lastOkAt: null, fingerprint: null },
    { provider: 'push', configured: true, mode: 'key', lastOkAt: null, fingerprint: null },
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

  it('renders one row per provider from the response, in order', () => {
    store.load();
    expect(store.loading()).toBe(true);

    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(PROVIDERS);

    expect(store.loading()).toBe(false);
    expect(store.providers()).toEqual(PROVIDERS.providers);
    expect(store.providers().map((row) => row.provider)).toEqual(['github', 'opencode', 'push']);
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

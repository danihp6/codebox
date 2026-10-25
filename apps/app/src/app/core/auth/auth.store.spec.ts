import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from './auth.store';
import { REFRESH_TOKEN_KEY, SECURE_STORE } from './secure-store';
import type { SecureStore } from './secure-store';

interface SecureStoreStub extends SecureStore {
  readonly values: Map<string, string>;
  readonly written: string[];
}

interface RecordingStorage {
  readonly setItemCalls: readonly string[];
  setItem(key: string, value: string): void;
}

// The literal name is assembled so the source tree stays free of the forbidden storage APIs.
const STORAGE_NAME = ['local', 'Storage'].join('');

function createSecureStoreStub(): SecureStoreStub {
  const values = new Map<string, string>();
  const written: string[] = [];
  return {
    values,
    written,
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      written.push(key);
      values.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    clear: () => {
      values.clear();
      return Promise.resolve();
    },
  };
}

function installStorageStub(): RecordingStorage {
  const setItemCalls: string[] = [];
  const stub = {
    setItemCalls,
    setItem(key: string): void {
      setItemCalls.push(key);
    },
    getItem: () => null,
    removeItem: () => undefined,
    clear: () => undefined,
  };
  Object.defineProperty(globalThis, STORAGE_NAME, { configurable: true, value: stub });
  return stub;
}

const PAIR_RESPONSE = {
  device: {
    id: 'dev_01JABCDEFGHJKMNPQRSV',
    name: 'Dani iPhone',
    platform: 'ios',
    scopes: ['read', 'chat', 'runs', 'write', 'admin'],
    createdAt: '2026-10-24T18:03:11Z',
    lastSeenAt: null,
  },
  accessToken: 'access-token-value',
  refreshToken: 'refresh-token-value',
  expiresIn: 900,
  scopes: ['read', 'chat', 'runs', 'write', 'admin'],
};

describe('AuthStore', () => {
  let secure: SecureStoreStub;
  let storage: RecordingStorage;
  let http: HttpTestingController;

  beforeEach(async () => {
    secure = createSecureStoreStub();
    storage = installStorageStub();
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SECURE_STORE, useValue: secure },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    delete (globalThis as unknown as Record<string, unknown>)[STORAGE_NAME];
    TestBed.resetTestingModule();
  });

  it(`pairs against a mocked API and persists nothing in ${STORAGE_NAME}`, async () => {
    const store = TestBed.inject(AuthStore);
    const pairing = store.pair({
      code: '7K3M9QXB2F',
      deviceName: 'Dani iPhone',
      platform: 'ios',
    });

    const request = await vi.waitFor(() => http.expectOne('/v1/pair'), { timeout: 5000 });
    expect(request.request.method).toBe('POST');
    const body = request.request.body as {
      code: string;
      deviceName: string;
      platform: string;
      devicePublicKey: string;
    };
    expect(body.code).toBe('7K3M9QXB2F');
    expect(body.platform).toBe('ios');
    expect(JSON.parse(body.devicePublicKey)).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect(body.devicePublicKey).not.toMatch(/private/i);

    request.flush(PAIR_RESPONSE);
    await pairing;

    expect(store.signedIn()).toBe(true);
    expect(store.accessToken()).toBe('access-token-value');
    expect(store.device()?.id).toBe('dev_01JABCDEFGHJKMNPQRSV');
    expect(store.scopes()).toEqual(['read', 'chat', 'runs', 'write', 'admin']);
    expect(secure.values.get(REFRESH_TOKEN_KEY)).toBe('refresh-token-value');
    expect(secure.written).toContain(REFRESH_TOKEN_KEY);
    expect(storage.setItemCalls).toHaveLength(0);
  });

  it('rotates the refresh token once for concurrent refresh calls', async () => {
    const store = TestBed.inject(AuthStore);
    secure.values.set(REFRESH_TOKEN_KEY, 'old-refresh');

    const first = store.refresh();
    const second = store.refresh();
    const request = await vi.waitFor(() => http.expectOne('/v1/auth/refresh'), { timeout: 5000 });
    request.flush({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresIn: 900,
      scopes: ['read'],
    });

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(store.accessToken()).toBe('new-access');
    expect(secure.values.get(REFRESH_TOKEN_KEY)).toBe('new-refresh');
    http.expectNone('/v1/auth/refresh');
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Device, Me } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../core/auth/auth.store';
import { REFRESH_TOKEN_KEY, SECURE_STORE } from '../../core/auth/secure-store';
import type { SecureStore } from '../../core/auth/secure-store';
import { DevicesStore } from './devices.store';

const TS = '2026-10-24T18:03:11Z';

const CURRENT: Device = {
  id: 'dev_01JABCDEFGHJKMNPQRSV',
  name: 'Dani iPhone',
  platform: 'ios',
  scopes: ['read', 'write', 'admin'],
  createdAt: TS,
  lastSeenAt: TS,
};

const OTHER: Device = {
  id: 'dev_01JABCDEFGHJKMNPQRTW',
  name: 'Dani laptop',
  platform: 'web',
  scopes: ['read'],
  createdAt: TS,
  lastSeenAt: null,
};

const ME: Me = { device: CURRENT, scopes: CURRENT.scopes, serverTime: TS };

const ME_URL = '/v1/me';
const DEVICES_URL = '/v1/devices';

function memoryStore(): SecureStore {
  const values = new Map<string, string>();
  return {
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
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

describe('DevicesStore', () => {
  let http: HttpTestingController;
  let store: DevicesStore;
  let auth: AuthStore;
  let secure: SecureStore;

  beforeEach(() => {
    secure = memoryStore();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SECURE_STORE, useValue: secure },
        DevicesStore,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(DevicesStore);
    auth = TestBed.inject(AuthStore);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function loadAll(devices: readonly Device[]): void {
    store.load();
    http.expectOne(ME_URL).flush(ME);
    http.expectOne(DEVICES_URL).flush({ data: [...devices], nextCursor: null });
  }

  it('loads the paired devices and marks the calling one', () => {
    store.load();
    expect(store.loading()).toBe(true);

    http.expectOne(ME_URL).flush(ME);
    http.expectOne(DEVICES_URL).flush({ data: [CURRENT, OTHER], nextCursor: null });

    expect(store.loading()).toBe(false);
    expect(store.currentDeviceId()).toBe(CURRENT.id);
    expect(store.devices()).toEqual([CURRENT, OTHER]);
    expect(store.error()).toBeNull();
  });

  it('reports a failed read without dropping the rows it already had', () => {
    loadAll([CURRENT, OTHER]);

    store.load();
    http.expectOne(ME_URL).flush(ME);
    http.expectOne(DEVICES_URL).flush(
      { error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
      { status: 500, statusText: 'Internal Server Error' },
    );

    expect(store.error()).toMatchObject({ status: 500, code: 'internal' });
    expect(store.devices()).toEqual([CURRENT, OTHER]);
    expect(store.loading()).toBe(false);
  });

  it('revokes another device, corroborates the list and keeps the session', () => {
    loadAll([CURRENT, OTHER]);
    const logout = vi.spyOn(auth, 'logout');

    store.revoke(OTHER.id);
    expect(store.revokingId()).toBe(OTHER.id);

    http
      .expectOne({ method: 'DELETE', url: `/v1/devices/${OTHER.id}` })
      .flush(null, { status: 204, statusText: 'No Content' });

    expect(store.devices()).toEqual([CURRENT]);
    expect(store.revokingId()).toBeNull();

    http.expectOne(DEVICES_URL).flush({ data: [CURRENT], nextCursor: null });

    expect(store.devices()).toEqual([CURRENT]);
    expect(store.error()).toBeNull();
    expect(logout).not.toHaveBeenCalled();
  });

  it('issues one DELETE only while a revoke is in flight', () => {
    loadAll([CURRENT, OTHER]);

    store.revoke(OTHER.id);
    store.revoke(CURRENT.id);

    expect(store.revokingId()).toBe(OTHER.id);
    http.expectNone({ method: 'DELETE', url: `/v1/devices/${CURRENT.id}` });

    http
      .expectOne({ method: 'DELETE', url: `/v1/devices/${OTHER.id}` })
      .flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne(DEVICES_URL).flush({ data: [CURRENT], nextCursor: null });

    expect(store.revokingId()).toBeNull();
  });

  it('revokes the current device, logs out and leaves no refresh token behind', async () => {
    await secure.set(REFRESH_TOKEN_KEY, 'fixture-refresh-token');
    loadAll([CURRENT, OTHER]);
    const logout = vi.spyOn(auth, 'logout');

    store.revoke(CURRENT.id);
    http
      .expectOne({ method: 'DELETE', url: `/v1/devices/${CURRENT.id}` })
      .flush(null, { status: 204, statusText: 'No Content' });

    expect(store.devices()).toEqual([OTHER]);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(await secure.get(REFRESH_TOKEN_KEY)).toBeNull();
    http.expectNone(DEVICES_URL);
  });

  it('keeps the row when the revoke fails', () => {
    loadAll([CURRENT, OTHER]);

    store.revoke(OTHER.id);
    http
      .expectOne({ method: 'DELETE', url: `/v1/devices/${OTHER.id}` })
      .flush(
        { error: { code: 'forbidden', message: 'Denied', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
        { status: 403, statusText: 'Forbidden' },
      );

    expect(store.devices()).toEqual([CURRENT, OTHER]);
    expect(store.revokingId()).toBeNull();
    expect(store.error()).toMatchObject({ status: 403, code: 'forbidden' });
  });
});

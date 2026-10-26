import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  Device,
  Me,
  NotificationPreferences,
  Providers,
  Settings,
  Version,
} from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsStore } from './settings.store';

const TS = '2026-10-24T18:03:11Z';

const DEVICE: Device = {
  id: 'dev_01JABCDEFGHJKMNPQRSV',
  name: 'Dani iPhone',
  platform: 'ios',
  scopes: ['read', 'write', 'admin'],
  createdAt: TS,
  lastSeenAt: null,
};

const ME: Me = { device: DEVICE, scopes: ['read', 'write', 'admin'], serverTime: TS };

const VERSION: Version = { version: '0.1.0', commit: 'abc1234', builtAt: TS, node: 'v24.0.0' };

const SETTINGS: Settings = {
  automerge: true,
  mergeMethod: 'squash',
  maxConcurrency: 2,
  dailyCostUsd: 5,
  protectedPaths: ['.github/**'],
  diffMaxFiles: 20,
  diffMaxLines: 800,
  timezone: 'Europe/Madrid',
  quietHours: null,
};

const PROVIDERS: Providers = {
  providers: [
    { provider: 'github', configured: true, mode: 'app', lastOkAt: null, fingerprint: 'abcd1234' },
  ],
};

const PREFERENCES: NotificationPreferences = {
  events: ['run.finished', 'approval.created'],
  quietHours: null,
};

const ME_URL = '/v1/me';
const VERSION_URL = '/v1/version';
const SETTINGS_URL = '/v1/settings';
const PROVIDERS_URL = '/v1/providers';
const PREFERENCES_URL = '/v1/notifications/preferences';

function failure(code: string): Record<string, unknown> {
  return { error: { code, message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } };
}

describe('SettingsStore', () => {
  let http: HttpTestingController;
  let store: SettingsStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), SettingsStore],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(SettingsStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('loads the five reads and clears loading only when the last one settles', () => {
    store.load();
    expect(store.loading()).toBe(true);

    http.expectOne(ME_URL).flush(ME);
    http.expectOne(VERSION_URL).flush(VERSION);
    http.expectOne(SETTINGS_URL).flush(SETTINGS);
    http.expectOne(PROVIDERS_URL).flush(PROVIDERS);
    expect(store.loading()).toBe(true);

    http.expectOne(PREFERENCES_URL).flush(PREFERENCES);

    expect(store.loading()).toBe(false);
    expect(store.me()).toEqual(ME);
    expect(store.version()).toEqual(VERSION);
    expect(store.settings()).toEqual(SETTINGS);
    expect(store.providers()).toEqual(PROVIDERS);
    expect(store.preferences()).toEqual(PREFERENCES);
    expect(store.error()).toBeNull();
    expect(store.settingsUnavailable()).toBe(false);
    expect(store.providersUnavailable()).toBe(false);
  });

  it('marks the settings unavailable on a 404 without setting the error', () => {
    store.load();
    http.expectOne(ME_URL).flush(ME);
    http.expectOne(VERSION_URL).flush(VERSION);
    http
      .expectOne(SETTINGS_URL)
      .flush('missing', { status: 404, statusText: 'Not Found' });
    http.expectOne(PROVIDERS_URL).flush(PROVIDERS);
    http.expectOne(PREFERENCES_URL).flush(PREFERENCES);

    expect(store.settingsUnavailable()).toBe(true);
    expect(store.settings()).toBeNull();
    expect(store.error()).toBeNull();
    expect(store.preferences()).toEqual(PREFERENCES);
  });

  it('marks the providers unavailable on a 404 without blanking another surface', () => {
    store.load();
    http.expectOne(ME_URL).flush(ME);
    http.expectOne(VERSION_URL).flush(VERSION);
    http.expectOne(SETTINGS_URL).flush(SETTINGS);
    http
      .expectOne(PROVIDERS_URL)
      .flush('missing', { status: 404, statusText: 'Not Found' });
    http.expectOne(PREFERENCES_URL).flush(PREFERENCES);

    expect(store.providersUnavailable()).toBe(true);
    expect(store.providers()).toBeNull();
    expect(store.error()).toBeNull();
    expect(store.settings()).toEqual(SETTINGS);
  });

  it('keeps the other reads when one of them fails', () => {
    store.load();
    http.expectOne(ME_URL).flush(failure('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });
    http.expectOne(VERSION_URL).flush(VERSION);
    http.expectOne(SETTINGS_URL).flush(SETTINGS);
    http.expectOne(PROVIDERS_URL).flush(PROVIDERS);
    http.expectOne(PREFERENCES_URL).flush(PREFERENCES);

    expect(store.error()).toMatchObject({ status: 500, code: 'internal' });
    expect(store.me()).toBeNull();
    expect(store.version()).toEqual(VERSION);
    expect(store.settings()).toEqual(SETTINGS);
    expect(store.loading()).toBe(false);
  });

  it('refuses a time zone that fails the contract and sends nothing', () => {
    store.settings.set(SETTINGS);

    store.saveTimezone('Europe/Madrid ');

    expect(store.error()).toMatchObject({ code: 'contract', status: 0 });
    http.expectNone({ method: 'PATCH', url: SETTINGS_URL });
  });

  it('patches a valid time zone and replaces the settings', () => {
    store.settings.set(SETTINGS);

    store.saveTimezone('UTC');
    expect(store.saving()).toBe('timezone');

    const request = http.expectOne({ method: 'PATCH', url: SETTINGS_URL });
    expect(request.request.body).toEqual({ timezone: 'UTC' });
    request.flush({ ...SETTINGS, timezone: 'UTC' });

    expect(store.saving()).toBeNull();
    expect(store.settings()?.timezone).toBe('UTC');
    expect(store.error()).toBeNull();
  });

  it('turns the brake on optimistically before the response arrives', () => {
    store.settings.set(SETTINGS);

    store.setBrake(true);
    expect(store.settings()?.automerge).toBe(false);
    expect(store.saving()).toBe('brake');

    const request = http.expectOne({ method: 'POST', url: '/v1/admin/brake' });
    expect(request.request.body).toEqual({ enabled: true });
    request.flush({ enabled: true });

    expect(store.settings()?.automerge).toBe(false);
    expect(store.brakeAvailable()).toBe(true);
    expect(store.saving()).toBeNull();
  });

  it('restores the brake state when the daemon fails', () => {
    store.settings.set(SETTINGS);

    store.setBrake(true);
    expect(store.settings()?.automerge).toBe(false);

    http.expectOne({ method: 'POST', url: '/v1/admin/brake' }).flush(failure('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });

    expect(store.settings()?.automerge).toBe(true);
    expect(store.brakeAvailable()).toBe(true);
    expect(store.error()).toMatchObject({ status: 500 });
  });

  it('restores the brake state and marks it unavailable when the route is missing', () => {
    store.settings.set(SETTINGS);

    store.setBrake(true);
    http
      .expectOne({ method: 'POST', url: '/v1/admin/brake' })
      .flush('missing', { status: 404, statusText: 'Not Found' });

    expect(store.settings()?.automerge).toBe(true);
    expect(store.brakeAvailable()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('marks the cache wipe unavailable when the route is missing', () => {
    store.wipeCache();
    http
      .expectOne({ method: 'POST', url: '/v1/admin/cache/wipe' })
      .flush('missing', { status: 404, statusText: 'Not Found' });

    expect(store.cacheWipeAvailable()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.saving()).toBeNull();
  });

  it('leaves the cache wipe available when the daemon answers', () => {
    store.wipeCache();
    http
      .expectOne({ method: 'POST', url: '/v1/admin/cache/wipe' })
      .flush(null, { status: 204, statusText: 'No Content' });

    expect(store.cacheWipeAvailable()).toBe(true);
    expect(store.saving()).toBeNull();
  });

  it('sets a preference optimistically and rolls it back when the patch fails', () => {
    store.preferences.set(PREFERENCES);

    store.togglePreference('run.failed', true);
    expect(store.preferences()?.events).toEqual(['run.finished', 'approval.created', 'run.failed']);

    const request = http.expectOne({ method: 'PATCH', url: PREFERENCES_URL });
    expect(request.request.body).toEqual({
      events: ['run.finished', 'approval.created', 'run.failed'],
      quietHours: null,
    });
    request.flush(failure('internal'), { status: 500, statusText: 'Internal Server Error' });

    expect(store.preferences()).toEqual(PREFERENCES);
    expect(store.error()).toMatchObject({ status: 500 });
  });

  it('removes a preference optimistically', () => {
    store.preferences.set(PREFERENCES);

    store.togglePreference('run.finished', false);
    expect(store.preferences()?.events).toEqual(['approval.created']);

    const request = http.expectOne({ method: 'PATCH', url: PREFERENCES_URL });
    expect(request.request.body).toEqual({ events: ['approval.created'], quietHours: null });
    request.flush({ events: ['approval.created'], quietHours: null });

    expect(store.preferences()?.events).toEqual(['approval.created']);
    expect(store.error()).toBeNull();
  });

  it('never sends a preference body that fails the contract', () => {
    store.preferences.set({ events: ['nope'], quietHours: null } as unknown as NotificationPreferences);

    store.togglePreference('run.finished', true);

    expect(store.error()).toMatchObject({ code: 'contract', status: 0 });
    http.expectNone({ method: 'PATCH', url: PREFERENCES_URL });
  });

  it('patches the quiet hours and refuses a malformed window', () => {
    store.preferences.set(PREFERENCES);

    store.setQuietHours('22:00-07:00');
    const request = http.expectOne({ method: 'PATCH', url: PREFERENCES_URL });
    expect(request.request.body).toEqual({
      events: PREFERENCES.events,
      quietHours: '22:00-07:00',
    });
    request.flush({ events: PREFERENCES.events, quietHours: '22:00-07:00' });

    expect(store.preferences()?.quietHours).toBe('22:00-07:00');

    store.setQuietHours('25:00-07:00');

    expect(store.error()).toMatchObject({ code: 'contract', status: 0 });
    http.expectNone({ method: 'PATCH', url: PREFERENCES_URL });
  });

  it('clears the quiet hours with null', () => {
    store.preferences.set({ events: PREFERENCES.events, quietHours: '22:00-07:00' });

    store.setQuietHours(null);

    const request = http.expectOne({ method: 'PATCH', url: PREFERENCES_URL });
    expect(request.request.body).toEqual({ events: PREFERENCES.events, quietHours: null });
    request.flush({ events: PREFERENCES.events, quietHours: null });

    expect(store.preferences()?.quietHours).toBeNull();
  });
});

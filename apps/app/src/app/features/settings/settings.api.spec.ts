import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Device, Me, NotificationPreferences, Providers, Settings, Version } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { SettingsApi } from './settings.api';

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
    { provider: 'opencode', configured: false, mode: 'none', lastOkAt: null, fingerprint: null },
  ],
};

const PREFERENCES: NotificationPreferences = {
  events: ['run.finished', 'run.failed', 'approval.created'],
  quietHours: null,
};

function envelope(code: string, details: Record<string, unknown>): Record<string, unknown> {
  return {
    error: {
      code,
      message: 'Denied',
      requestId: 'req_01JABCDEFGHJKMNPQRSV',
      details,
    },
  };
}

describe('SettingsApi', () => {
  let http: HttpTestingController;
  let api: SettingsApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), SettingsApi],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(SettingsApi);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('reads the caller identity', () => {
    let me: Me | null = null;
    api.me().subscribe((value) => {
      me = value;
    });

    const request = http.expectOne('/v1/me');
    expect(request.request.method).toBe('GET');
    request.flush(ME);

    expect(me).toEqual(ME);
  });

  it('reads the daemon version', () => {
    let version: Version | null = null;
    api.version().subscribe((value) => {
      version = value;
    });

    const request = http.expectOne('/v1/version');
    expect(request.request.method).toBe('GET');
    request.flush(VERSION);

    expect(version).toEqual(VERSION);
  });

  it('reads the settings and patches the time zone', () => {
    let current: Settings | null = null;
    api.settings().subscribe((value) => {
      current = value;
    });
    http.expectOne('/v1/settings').flush(SETTINGS);
    expect(current).toEqual(SETTINGS);

    let patched: Settings | null = null;
    api.patchSettings({ timezone: 'UTC' }).subscribe((value) => {
      patched = value;
    });

    const request = http.expectOne({ method: 'PATCH', url: '/v1/settings' });
    expect(request.request.body).toEqual({ timezone: 'UTC' });
    request.flush({ ...SETTINGS, timezone: 'UTC' });

    expect(patched).toMatchObject({ timezone: 'UTC' });
  });

  it('emits null instead of throwing when /v1/settings is missing', () => {
    let current: Settings | null = SETTINGS;
    let failure: ApiError | null = null;
    api.settings().subscribe({
      next: (value) => {
        current = value;
      },
      error: (error: ApiError) => {
        failure = error;
      },
    });

    http.expectOne('/v1/settings').flush('missing', { status: 404, statusText: 'Not Found' });

    expect(current).toBeNull();
    expect(failure).toBeNull();
  });

  it('emits null instead of throwing when /v1/providers is missing', () => {
    let providers: Providers | null = PROVIDERS;
    let failure: ApiError | null = null;
    api.providers().subscribe({
      next: (value) => {
        providers = value;
      },
      error: (error: ApiError) => {
        failure = error;
      },
    });

    http.expectOne('/v1/providers').flush('missing', { status: 404, statusText: 'Not Found' });

    expect(providers).toBeNull();
    expect(failure).toBeNull();
  });

  it('reads the provider status', () => {
    let providers: Providers | null = null;
    api.providers().subscribe((value) => {
      providers = value;
    });
    http.expectOne('/v1/providers').flush(PROVIDERS);

    expect(providers).toEqual(PROVIDERS);
  });

  it('sets the brake with a JSON body and reads the applied state', () => {
    let applied: boolean | null = null;
    api.brake(true).subscribe((value) => {
      applied = value;
    });

    const request = http.expectOne({ method: 'POST', url: '/v1/admin/brake' });
    expect(request.request.body).toEqual({ enabled: true });
    expect(request.request.headers.get('Content-Type')).toBe('application/json');
    request.flush({ enabled: true });

    expect(applied).toBe(true);
  });

  it('emits false when the brake route is missing', () => {
    let applied: boolean | null = null;
    let failure: ApiError | null = null;
    api.brake(true).subscribe({
      next: (value) => {
        applied = value;
      },
      error: (error: ApiError) => {
        failure = error;
      },
    });

    http.expectOne('/v1/admin/brake').flush('missing', { status: 404, statusText: 'Not Found' });

    expect(applied).toBe(false);
    expect(failure).toBeNull();
  });

  it('keeps a 403 on the brake as an ApiError with its scope reason', () => {
    const failures: ApiError[] = [];
    api.brake(true).subscribe({
      error: (error: ApiError) => {
        failures.push(error);
      },
    });

    http.expectOne('/v1/admin/brake').flush(envelope('forbidden', { reason: 'insufficient_scope' }), {
      status: 403,
      statusText: 'Forbidden',
    });

    const failure = failures[0];
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 403, code: 'forbidden' });
    expect(failure?.details?.['reason']).toBe('insufficient_scope');
  });

  it('wipes the cache with an empty JSON body and emits true', () => {
    let wiped: boolean | null = null;
    api.wipeCache().subscribe((value) => {
      wiped = value;
    });

    const request = http.expectOne({ method: 'POST', url: '/v1/admin/cache/wipe' });
    expect(request.request.body).toBeNull();
    expect(request.request.headers.get('Content-Type')).toBe('application/json');
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(wiped).toBe(true);
  });

  it('emits false when the cache wipe route is missing', () => {
    let wiped: boolean | null = null;
    api.wipeCache().subscribe((value) => {
      wiped = value;
    });

    http.expectOne('/v1/admin/cache/wipe').flush('missing', {
      status: 404,
      statusText: 'Not Found',
    });

    expect(wiped).toBe(false);
  });

  it('lists the devices with the pagination query', () => {
    let ids: readonly string[] = [];
    api.devices({ limit: 50 }).subscribe((page) => {
      ids = page.data.map((device) => device.id);
    });

    const request = http.expectOne('/v1/devices?limit=50');
    expect(request.request.method).toBe('GET');
    request.flush({ data: [DEVICE], nextCursor: null });

    expect(ids).toEqual([DEVICE.id]);
  });

  it('revokes one device', () => {
    let done = false;
    api.revokeDevice(DEVICE.id).subscribe(() => {
      done = true;
    });

    const request = http.expectOne({ method: 'DELETE', url: `/v1/devices/${DEVICE.id}` });
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(done).toBe(true);
  });

  it('reads and patches the notification preferences', () => {
    let current: NotificationPreferences | null = null;
    api.preferences().subscribe((value) => {
      current = value;
    });
    const read = http.expectOne('/v1/notifications/preferences');
    expect(read.request.method).toBe('GET');
    read.flush(PREFERENCES);

    expect(current).toEqual(PREFERENCES);

    const next: NotificationPreferences = { events: [...PREFERENCES.events, 'routine.fired'], quietHours: '22:00-07:00' };
    let saved: NotificationPreferences | null = null;
    api.patchPreferences(next).subscribe((value) => {
      saved = value;
    });

    const patch = http.expectOne({ method: 'PATCH', url: '/v1/notifications/preferences' });
    expect(patch.request.body).toEqual(next);
    patch.flush(next);

    expect(saved).toEqual(next);
  });

  it('turns a malformed body into a contract ApiError', () => {
    let failure: ApiError | null = null;
    api.me().subscribe({
      error: (error: ApiError) => {
        failure = error;
      },
    });

    http.expectOne('/v1/me').flush({ device: { id: 'not-a-device-id' } });

    expect(failure).toMatchObject({ code: 'contract', status: 200 });
  });
});

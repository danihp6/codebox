import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { NotificationPreferences, Settings } from '@codebox/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { NotificationsApi } from './notifications.api';

const PREFERENCES_URL = '/v1/notifications/preferences';
const SETTINGS_URL = '/v1/settings';

const PREFERENCES: NotificationPreferences = {
  events: ['run.finished', 'approval.created'],
  quietHours: null,
};

const SETTINGS: Settings = {
  automerge: true,
  mergeMethod: 'squash',
  maxConcurrency: 2,
  dailyCostUsd: 5,
  protectedPaths: ['.github/**'],
  diffMaxFiles: 20,
  diffMaxLines: 800,
  timezone: 'Europe/Madrid',
  quietHours: '22:00-07:00',
};

const FAILURE = {
  error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' },
};

interface Mounted {
  readonly api: NotificationsApi;
  readonly http: HttpTestingController;
}

function mount(): Mounted {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    api: TestBed.inject(NotificationsApi),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('NotificationsApi', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('reads the preferences with GET and parses the body', () => {
    const { api, http } = mount();
    let value: NotificationPreferences | null = null;

    api.preferences().subscribe((body) => {
      value = body;
    });

    const request = http.expectOne({ method: 'GET', url: PREFERENCES_URL });
    expect(request.request.body).toBeNull();
    request.flush(PREFERENCES);

    expect(value).toEqual(PREFERENCES);
    http.verify();
  });

  it('writes the full preferences object with PATCH', () => {
    const { api, http } = mount();
    const next: NotificationPreferences = {
      events: ['run.finished', 'run.merged'],
      quietHours: '22:00-07:00',
    };
    let value: NotificationPreferences | null = null;

    api.patchPreferences(next).subscribe((body) => {
      value = body;
    });

    const request = http.expectOne({ method: 'PATCH', url: PREFERENCES_URL });
    expect(request.request.body).toEqual(next);
    request.flush(next);

    expect(value).toEqual(next);
    http.verify();
  });

  it('mirrors only quiet hours to PATCH /v1/settings', () => {
    const { api, http } = mount();
    let value: Settings | null = null;

    api.patchQuietHours('22:00-07:00').subscribe((body) => {
      value = body;
    });

    const request = http.expectOne({ method: 'PATCH', url: SETTINGS_URL });
    expect(request.request.body).toEqual({ quietHours: '22:00-07:00' });
    request.flush(SETTINGS);

    expect(value).toEqual(SETTINGS);
    http.verify();
  });

  it('maps a malformed body to a contract failure', () => {
    const { api, http } = mount();
    let failure: unknown = null;

    api.preferences().subscribe({ error: (error: unknown) => (failure = error) });
    http.expectOne({ method: 'GET', url: PREFERENCES_URL }).flush({ events: ['nope'] });

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe('contract');
    expect((failure as ApiError).status).toBe(200);
    http.verify();
  });

  it('maps an error envelope to its domain code', () => {
    const { api, http } = mount();
    let failure: unknown = null;

    api.patchPreferences(PREFERENCES).subscribe({ error: (error: unknown) => (failure = error) });
    http
      .expectOne({ method: 'PATCH', url: PREFERENCES_URL })
      .flush(FAILURE, { status: 500, statusText: 'Internal Server Error' });

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe('internal');
    expect((failure as ApiError).status).toBe(500);
    http.verify();
  });

  it('does not swallow a missing settings route', () => {
    const { api, http } = mount();
    let failure: unknown = null;

    api.patchQuietHours(null).subscribe({ error: (error: unknown) => (failure = error) });
    http
      .expectOne({ method: 'PATCH', url: SETTINGS_URL })
      .flush('missing', { status: 404, statusText: 'Not Found' });

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
    http.verify();
  });
});

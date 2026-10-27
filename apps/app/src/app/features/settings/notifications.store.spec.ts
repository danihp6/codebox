import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { NotificationPreferences, Settings } from '@codebox/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { translate } from './notifications.i18n';
import {
  NOTIFICATION_EVENTS,
  NotificationsStore,
  buildNotificationPayload,
} from './notifications.store';

const RUN_ID = 'run_01JABCDEFGHJKMNPQRSV';
const APPROVAL_ID = 'apr_01JABCDEFGHJKMNPQRSV';
const ROUTINE_ID = 'rtn_01JABCDEFGHJKMNPQRSV';
const PREFERENCES_URL = '/v1/notifications/preferences';
const SETTINGS_URL = '/v1/settings';

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

function preferences(events: NotificationPreferences['events'], quietHours: string | null) {
  return { events, quietHours };
}

interface Mounted {
  readonly store: NotificationsStore;
  readonly http: HttpTestingController;
}

function mount(): Mounted {
  TestBed.configureTestingModule({
    providers: [NotificationsStore, provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    store: TestBed.inject(NotificationsStore),
    http: TestBed.inject(HttpTestingController),
  };
}

function loaded(body: NotificationPreferences): Mounted {
  const mounted = mount();
  mounted.store.load();
  mounted.http.expectOne({ method: 'GET', url: PREFERENCES_URL }).flush(body);
  return mounted;
}

function payload(
  frame: { readonly type: string; readonly data: Readonly<Record<string, unknown>> },
  locale: 'en' | 'es' = 'en',
) {
  const built = buildNotificationPayload(frame, locale);
  expect(built).not.toBeNull();
  if (built === null) throw new Error('expected a payload');
  return built;
}

describe('buildNotificationPayload', () => {
  it('projects a run frame to exactly type, id and title and leaks nothing else', () => {
    const result = payload({
      type: 'run.failed',
      data: {
        runId: RUN_ID,
        prompt: 'secret',
        diff: '--- a',
        path: '/etc/passwd',
      },
    });

    expect(result).toEqual({ type: 'run.failed', id: RUN_ID, title: 'A run failed' });
    expect(Object.keys(result)).toEqual(['type', 'id', 'title']);
    const json = JSON.stringify(result);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('--- a');
    expect(json).not.toContain('/etc/passwd');
    expect(json).not.toContain('prompt');
    expect(json).not.toContain('path');
  });

  it('reads the approval and routine ids from their own field', () => {
    expect(
      payload({
        type: 'approval.created',
        data: { approvalId: APPROVAL_ID, prompt: 'secret', payload: '{}' },
      }),
    ).toEqual({ type: 'approval.created', id: APPROVAL_ID, title: 'An approval is waiting' });
    expect(
      payload({ type: 'routine.fired', data: { routineId: ROUTINE_ID, title: 'secret' } }),
    ).toEqual({ type: 'routine.fired', id: ROUTINE_ID, title: 'A routine fired' });
  });

  it('titles every panel event in both locales', () => {
    for (const locale of ['en', 'es'] as const) {
      for (const type of NOTIFICATION_EVENTS) {
        expect(translate(locale, `notifications.title.${type}`)).not.toBe(
          `notifications.title.${type}`,
        );
      }
    }
    expect(translate('es', 'notifications.title.run.failed')).toBe('Una ejecución ha fallado');
  });

  it('refuses an unknown type, a missing id and an empty id', () => {
    expect(
      buildNotificationPayload({ type: 'run.queued', data: { runId: RUN_ID } }, 'en'),
    ).toBeNull();
    expect(buildNotificationPayload({ type: 'run.failed', data: {} }, 'en')).toBeNull();
    expect(buildNotificationPayload({ type: 'run.failed', data: { runId: '' } }, 'en')).toBeNull();
    expect(
      buildNotificationPayload({ type: 'approval.created', data: { runId: RUN_ID } }, 'en'),
    ).toBeNull();
  });
});

describe('NotificationsStore', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('loads the preferences once and clears the loading flag', () => {
    const { store } = loaded(preferences(['run.finished'], '22:00-07:00'));

    expect(store.preferences()).toEqual(preferences(['run.finished'], '22:00-07:00'));
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('toggles optimistically, posts the full object and rolls back a failure', () => {
    const { store, http } = loaded(preferences(['run.finished'], '22:00-07:00'));

    store.toggle('run.merged', true);

    expect(store.preferences()?.events).toEqual(['run.finished', 'run.merged']);
    expect(store.saving()).toBe('run.merged');

    const request = http.expectOne({ method: 'PATCH', url: PREFERENCES_URL });
    expect(request.request.body).toEqual({
      events: ['run.finished', 'run.merged'],
      quietHours: '22:00-07:00',
    });
    request.flush(
      {
        error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' },
      },
      { status: 500, statusText: 'Internal Server Error' },
    );

    expect(store.preferences()).toEqual(preferences(['run.finished'], '22:00-07:00'));
    expect(store.error()?.code).toBe('internal');
    expect(store.saving()).toBeNull();
    http.verify();
  });

  it('keeps the panel order, drops duplicates and never writes the locked row', () => {
    const { store, http } = loaded(
      preferences(['run.finished', 'run.merged', 'run.finished'], null),
    );

    store.toggle('approval.created', true);
    const request = http.expectOne({ method: 'PATCH', url: PREFERENCES_URL });
    expect(request.request.body).toEqual({
      events: ['run.finished', 'run.merged', 'approval.created'],
      quietHours: null,
    });
    request.flush(preferences(['run.finished', 'run.merged', 'approval.created'], null));

    expect(store.preferences()?.events).not.toContain('credential.changed');
    http.verify();
  });

  it('blocks a second write while one is in flight', () => {
    const { store, http } = loaded(preferences([], null));

    store.toggle('run.finished', true);
    store.toggle('run.failed', true);
    store.saveQuietHours('22:00-07:00');

    http
      .expectOne({ method: 'PATCH', url: PREFERENCES_URL })
      .flush(preferences(['run.finished'], null));
    http.verify();
    expect(store.saving()).toBeNull();
  });

  it('writes both routes in order and reports synced', () => {
    const { store, http } = loaded(preferences(['run.finished'], null));

    store.saveQuietHours('22:00-07:00');

    expect(store.saving()).toBe('quiet');
    const preferencesWrite = http.expectOne({ method: 'PATCH', url: PREFERENCES_URL });
    expect(preferencesWrite.request.body).toEqual({
      events: ['run.finished'],
      quietHours: '22:00-07:00',
    });
    http.expectNone(SETTINGS_URL);

    preferencesWrite.flush(preferences(['run.finished'], '22:00-07:00'));
    const settingsWrite = http.expectOne({ method: 'PATCH', url: SETTINGS_URL });
    expect(settingsWrite.request.body).toEqual({ quietHours: '22:00-07:00' });
    settingsWrite.flush(SETTINGS);

    expect(store.mirror()).toBe('synced');
    expect(store.saving()).toBeNull();
    expect(store.preferences()?.quietHours).toBe('22:00-07:00');
    expect(store.error()).toBeNull();
    http.verify();
  });

  it('treats a missing settings route as absent, not as a failure', () => {
    const { store, http } = loaded(preferences(['run.finished'], null));

    store.saveQuietHours('22:00-07:00');
    http
      .expectOne({ method: 'PATCH', url: PREFERENCES_URL })
      .flush(preferences(['run.finished'], '22:00-07:00'));
    http
      .expectOne({ method: 'PATCH', url: SETTINGS_URL })
      .flush('missing', { status: 404, statusText: 'Not Found' });

    expect(store.mirror()).toBe('absent');
    expect(store.error()).toBeNull();
    expect(store.preferences()?.quietHours).toBe('22:00-07:00');
    expect(store.saving()).toBeNull();
    http.verify();
  });

  it('reports a failed mirror while keeping the saved preferences', () => {
    const { store, http } = loaded(preferences(['run.finished'], null));

    store.saveQuietHours('22:00-07:00');
    http
      .expectOne({ method: 'PATCH', url: PREFERENCES_URL })
      .flush(preferences(['run.finished'], '22:00-07:00'));
    http
      .expectOne({ method: 'PATCH', url: SETTINGS_URL })
      .flush(
        { error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
        { status: 500, statusText: 'Internal Server Error' },
      );

    expect(store.mirror()).toBe('failed');
    expect(store.error()?.code).toBe('internal');
    expect(store.preferences()?.quietHours).toBe('22:00-07:00');
    http.verify();
  });

  it('refuses an out-of-range window without issuing a request', () => {
    const { store, http } = loaded(preferences(['run.finished'], null));

    store.saveQuietHours('25:00-08:00');

    http.expectNone(PREFERENCES_URL);
    expect(store.error()?.code).toBe('contract');
    expect(store.saving()).toBeNull();
    expect(store.mirror()).toBeNull();
    http.verify();
  });

  it('sends null when the window is cleared', () => {
    const { store, http } = loaded(preferences(['run.finished'], '22:00-07:00'));

    store.saveQuietHours('');

    const request = http.expectOne({ method: 'PATCH', url: PREFERENCES_URL });
    expect(request.request.body).toEqual({ events: ['run.finished'], quietHours: null });
    request.flush(preferences(['run.finished'], null));

    const settingsWrite = http.expectOne({ method: 'PATCH', url: SETTINGS_URL });
    expect(settingsWrite.request.body).toEqual({ quietHours: null });
    settingsWrite.flush({ ...SETTINGS, quietHours: null });

    expect(store.mirror()).toBe('synced');
    http.verify();
  });
});

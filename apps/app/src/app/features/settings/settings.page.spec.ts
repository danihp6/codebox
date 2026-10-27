import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  Device,
  Me,
  NotificationPreferences,
  Providers,
  Settings,
  Version,
} from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { SecureStore } from '../../core/auth/secure-store';
import { STRINGS, translate } from './i18n';
import { SettingsPage } from './settings.page';

const TS = '2026-10-24T18:03:11Z';

const DEVICE: Device = {
  id: 'dev_01JABCDEFGHJKMNPQRSV',
  name: 'Dani iPhone',
  platform: 'ios',
  scopes: ['read', 'write', 'admin'],
  createdAt: TS,
  lastSeenAt: null,
};

const ME: Me = { device: DEVICE, scopes: DEVICE.scopes, serverTime: TS };

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

const PREFERENCES_BODY: NotificationPreferences = {
  events: ['run.finished', 'approval.created'],
  quietHours: null,
};

const ME_URL = '/v1/me';
const VERSION_URL = '/v1/version';
const SETTINGS_URL = '/v1/settings';
const PROVIDERS_URL = '/v1/providers';
const PREFERENCES_URL = '/v1/notifications/preferences';

const USED_KEYS: readonly string[] = [
  'common.loading',
  'common.error',
  'common.retry',
  'settings.title',
  'settings.section.profile',
  'settings.section.devices',
  'settings.section.notifications',
  'settings.section.providers',
  'settings.section.danger',
  'settings.section.about',
  'settings.device.name',
  'settings.device.platform',
  'settings.device.scopes',
  'settings.device.none',
  'settings.devices.manage',
  'settings.timezone',
  'settings.timezone.save',
  'settings.notifications.open',
  'settings.provider.configured',
  'settings.provider.missing',
  'settings.provider.mode',
  'settings.brake.on',
  'settings.brake.off',
  'settings.brake.confirm',
  'settings.cache.wipe',
  'settings.cache.confirm',
  'settings.unavailable',
  'settings.about.version',
  'settings.about.commit',
  'settings.about.node',
];

/** The panel owns these rows now; the dictionary keeps the keys, so they must still resolve. */
const RETAINED_KEYS: readonly string[] = [
  'settings.preference.run.finished',
  'settings.preference.run.failed',
  'settings.preference.run.merged',
  'settings.preference.run.cancelled',
  'settings.preference.approval.created',
  'settings.preference.routine.fired',
  'settings.quiet.hours',
  'settings.quiet.none',
  'settings.quiet.save',
];

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

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

interface Mounted {
  readonly fixture: ComponentFixture<SettingsPage>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
}

async function mount(): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SECURE_STORE, useValue: memoryStore() },
    ],
  });
  const fixture = TestBed.createComponent(SettingsPage);
  await fixture.whenStable();
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
  };
}

function flushHappy(http: HttpTestingController): void {
  http.expectOne(ME_URL).flush(ME);
  http.expectOne(VERSION_URL).flush(VERSION);
  http.expectOne(SETTINGS_URL).flush(SETTINGS);
  http.expectOne(PROVIDERS_URL).flush(PROVIDERS);
  http.expectOne(PREFERENCES_URL).flush(PREFERENCES_BODY);
}

/** Both the page's store and the panel read the same URL, so flush every match, never one. */
function flushPanelReads(http: HttpTestingController): void {
  for (const request of http.match(PREFERENCES_URL)) request.flush(PREFERENCES_BODY);
}

describe('SettingsPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the unavailable blocks for the routes this build does not ship', async () => {
    const { fixture, element, http } = await mount();

    expect(hook(element, 'settings-loading')).not.toBeNull();

    http.expectOne(ME_URL).flush(ME);
    http.expectOne(VERSION_URL).flush(VERSION);
    http.expectOne(SETTINGS_URL).flush('missing', { status: 404, statusText: 'Not Found' });
    http.expectOne(PROVIDERS_URL).flush('missing', { status: 404, statusText: 'Not Found' });
    http.expectOne(PREFERENCES_URL).flush(PREFERENCES_BODY);
    await fixture.whenStable();

    expect(hook(element, 'settings-unavailable-settings')).not.toBeNull();
    expect(hook(element, 'settings-unavailable-providers')).not.toBeNull();
    expect(hook(element, 'settings-unavailable-brake')).not.toBeNull();
    expect(hook(element, 'settings-error')).toBeNull();
    expect(hook(element, 'settings-loading')).toBeNull();
    expect(hook(element, 'settings-provider-github')).toBeNull();
    expect(hook(element, 'settings-brake')).toBeNull();
    expect((hook(element, 'settings-save-timezone') as HTMLButtonElement).disabled).toBe(true);
    expect(hook(element, 'settings-wipe-cache')).not.toBeNull();
  });

  it('renders the profile, providers, notifications row, brake and about sections', async () => {
    const { fixture, element, http } = await mount();
    flushHappy(http);
    await fixture.whenStable();

    expect(hook(element, 'settings-profile')?.getAttribute('data-device-id')).toBe(DEVICE.id);
    expect(hook(element, 'settings-profile')?.getAttribute('data-scopes')).toContain('admin');
    expect((hook(element, 'settings-timezone') as HTMLInputElement).value).toBe('Europe/Madrid');
    expect((hook(element, 'settings-save-timezone') as HTMLButtonElement).disabled).toBe(false);

    const github = hook(element, 'settings-provider-github');
    expect(github?.getAttribute('data-configured')).toBe('true');
    expect(github?.getAttribute('data-mode')).toBe('app');
    const opencode = hook(element, 'settings-provider-opencode');
    expect(opencode?.getAttribute('data-configured')).toBe('false');
    expect(opencode?.getAttribute('data-mode')).toBe('none');
    expect(hook(element, 'settings-unavailable-providers')).toBeNull();

    expect(hook(element, 'settings-notifications-open')).not.toBeNull();
    expect(hook(element, 'notifications-panel')).toBeNull();

    expect(hook(element, 'settings-brake')?.getAttribute('data-enabled')).toBe('false');
    expect(hook(element, 'settings-unavailable-brake')).toBeNull();
    expect(hook(element, 'settings-wipe-cache')).not.toBeNull();

    expect(hook(element, 'settings-version')?.getAttribute('data-version')).toBe(VERSION.version);
    expect(hook(element, 'settings-commit')?.getAttribute('data-commit')).toBe(VERSION.commit);
    expect(hook(element, 'settings-node')?.getAttribute('data-node')).toBe(VERSION.node);
    expect(hook(element, 'settings-error')).toBeNull();
  });

  it('opens the notification panel from one row and hides it again', async () => {
    const { fixture, element, http } = await mount();
    flushHappy(http);
    await fixture.whenStable();

    expect(hook(element, 'notifications-panel')).toBeNull();

    hook(element, 'settings-notifications-open')?.click();
    await fixture.whenStable();
    flushPanelReads(http);
    await fixture.whenStable();

    expect(hook(element, 'notifications-panel')?.getAttribute('data-events')).toBe('5');
    expect(hook(element, 'notifications-panel')?.getAttribute('data-locked')).toBe(
      'credential.changed',
    );
    expect(hook(element, 'notifications-toggle-run.finished')?.getAttribute('data-enabled')).toBe(
      'true',
    );
    expect(hook(element, 'notifications-locked-credential')?.getAttribute('data-locked')).toBe('true');
    expect(hook(element, 'settings-error')).toBeNull();

    hook(element, 'notifications-close')?.click();
    await fixture.whenStable();

    expect(hook(element, 'notifications-panel')).toBeNull();
    expect(hook(element, 'settings-notifications-open')).not.toBeNull();
  });

  it('turns a preference on from the panel before the response arrives and patches it', async () => {
    const { fixture, element, http } = await mount();
    flushHappy(http);
    await fixture.whenStable();

    hook(element, 'settings-notifications-open')?.click();
    await fixture.whenStable();
    flushPanelReads(http);
    await fixture.whenStable();

    hook(element, 'notifications-toggle-run.merged')?.click();
    await fixture.whenStable();

    const request = http.expectOne({ method: 'PATCH', url: PREFERENCES_URL });
    expect(request.request.body).toEqual({
      events: ['run.finished', 'run.merged', 'approval.created'],
      quietHours: null,
    });
    expect(hook(element, 'notifications-toggle-run.merged')?.getAttribute('data-enabled')).toBe(
      'true',
    );

    request.flush({
      ...PREFERENCES_BODY,
      events: ['run.finished', 'run.merged', 'approval.created'],
    });
    await fixture.whenStable();

    expect(hook(element, 'notifications-toggle-run.merged')?.getAttribute('data-enabled')).toBe(
      'true',
    );
  });

  it('reports a required read failure and retries every read', async () => {
    const { fixture, element, http } = await mount();

    http.expectOne(ME_URL).flush(
      { error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
      { status: 500, statusText: 'Internal Server Error' },
    );
    http.expectOne(VERSION_URL).flush(VERSION);
    http.expectOne(SETTINGS_URL).flush(SETTINGS);
    http.expectOne(PROVIDERS_URL).flush(PROVIDERS);
    http.expectOne(PREFERENCES_URL).flush(PREFERENCES_BODY);
    await fixture.whenStable();

    expect(hook(element, 'settings-error')?.getAttribute('data-code')).toBe('internal');

    hook(element, 'settings-retry')?.click();
    await fixture.whenStable();

    http.expectOne(ME_URL).flush(ME);
    http.expectOne(VERSION_URL).flush(VERSION);
    http.expectOne(SETTINGS_URL).flush(SETTINGS);
    http.expectOne(PROVIDERS_URL).flush(PROVIDERS);
    http.expectOne(PREFERENCES_URL).flush(PREFERENCES_BODY);
    await fixture.whenStable();

    expect(hook(element, 'settings-error')).toBeNull();
    expect(hook(element, 'settings-profile')?.getAttribute('data-device-id')).toBe(DEVICE.id);
  });

  it('ships the same keys in both dictionaries and resolves every template key', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.es).sort());
    for (const locale of ['en', 'es'] as const) {
      for (const [key, value] of Object.entries(STRINGS[locale])) {
        expect(value, `${locale} ${key}`).not.toBe('');
        expect(translate(locale, key), `${locale} ${key}`).toBe(value);
      }
      for (const key of [...USED_KEYS, ...RETAINED_KEYS]) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});

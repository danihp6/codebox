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
import { SettingsStore as AppSettingsStore } from '../../core/settings/settings.store';
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

const SETTINGS_KEY = 'cb.settings';

const USED_KEYS: readonly string[] = [
  'common.loading',
  'common.error',
  'common.retry',
  'settings.title',
  'settings.group.preferences',
  'settings.group.automation',
  'settings.group.account',
  'settings.group.danger',
  'settings.section.profile',
  'settings.section.credentials',
  'settings.section.devices',
  'settings.section.notifications',
  'settings.section.providers',
  'settings.section.danger',
  'settings.section.about',
  'settings.appearance',
  'settings.theme.dark',
  'settings.theme.light',
  'settings.routines',
  'settings.routines.value',
  'settings.value.none',
  'settings.danger.unpair',
  'settings.device.name',
  'settings.device.platform',
  'settings.device.scopes',
  'settings.device.none',
  'settings.credentials.manage',
  'settings.devices.manage',
  'settings.timezone',
  'settings.timezone.save',
  'settings.notifications.open',
  'settings.providers.open',
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

function memoryStore(): { readonly store: SecureStore; readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  const store: SecureStore = {
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
  return { store, values };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function all(element: HTMLElement, id: string): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
}

function attribute(element: HTMLElement, id: string, name: string): (string | null)[] {
  return all(element, id).map((node) => node.getAttribute(name));
}

interface Mounted {
  readonly fixture: ComponentFixture<SettingsPage>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
  readonly values: Map<string, string>;
}

async function mount(): Promise<Mounted> {
  const { store, values } = memoryStore();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SECURE_STORE, useValue: store },
    ],
  });
  const fixture = TestBed.createComponent(SettingsPage);
  await fixture.whenStable();
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
    values,
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

/** The providers panel owns its own read, like the notifications panel. */
function flushProviderReads(http: HttpTestingController): void {
  for (const request of http.match(PROVIDERS_URL)) request.flush(PROVIDERS);
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
    expect(hook(element, 'settings-unavailable-brake')).not.toBeNull();
    expect(hook(element, 'settings-error')).toBeNull();
    expect(hook(element, 'settings-loading')).toBeNull();
    expect(hook(element, 'settings-provider-github')).toBeNull();
    expect(hook(element, 'providers-panel')).toBeNull();
    expect(hook(element, 'settings-brake')).toBeNull();
    expect((hook(element, 'settings-save-timezone') as HTMLButtonElement).disabled).toBe(true);
    expect(hook(element, 'settings-wipe-cache')).not.toBeNull();
  });

  it('draws the profile card, the four groups, the eight rows and the about facts', async () => {
    const { fixture, element, http } = await mount();
    flushHappy(http);
    await fixture.whenStable();

    expect(hook(element, 'settings-profile')?.getAttribute('data-device-id')).toBe(DEVICE.id);
    expect(hook(element, 'settings-profile')?.getAttribute('data-scopes')).toContain('admin');
    expect(hook(element, 'settings-device-name')?.textContent).toContain(DEVICE.name);
    expect(hook(element, 'settings-device-meta')?.textContent).toContain('ios');
    expect(hook(element, 'settings-device-meta')?.textContent).toContain('read write admin');

    expect(hook(element, 'settings-timezone-row')).not.toBeNull();
    expect((hook(element, 'settings-timezone') as HTMLInputElement).value).toBe('Europe/Madrid');
    expect((hook(element, 'settings-save-timezone') as HTMLButtonElement).disabled).toBe(false);

    expect(hook(element, 'settings-devices-link')?.getAttribute('href')).toBe('/settings/devices');
    expect(hook(element, 'settings-credentials-link')?.getAttribute('href')).toBe(
      '/settings/credentials',
    );
    expect(hook(element, 'settings-about-link')?.getAttribute('href')).toBe('/about');
    expect(hook(element, 'settings-notifications-open')?.tagName).toBe('BUTTON');
    expect(hook(element, 'settings-providers-open')?.tagName).toBe('BUTTON');

    expect(attribute(element, 'settings-group', 'data-group')).toEqual([
      'preferences',
      'automation',
      'account',
      'danger',
    ]);
    expect(attribute(element, 'settings-row', 'data-row')).toEqual([
      'notifications',
      'appearance',
      'providers',
      'routines',
      'brake',
      'devices',
      'credentials',
      'about',
    ]);

    expect(
      hook(element, 'settings-row-notifications-value')?.getAttribute('data-enabled'),
    ).toBe('2');
    expect(hook(element, 'settings-row-notifications-value')?.textContent).toContain(
      translate('es', 'settings.quiet.none'),
    );
    expect(hook(element, 'settings-row-providers-value')?.getAttribute('data-configured')).toBe('1');
    expect(hook(element, 'settings-row-providers-value')?.textContent).toContain('1/2');
    expect(hook(element, 'settings-row-devices-value')?.textContent).toContain(
      translate('es', 'settings.value.none'),
    );
    expect(hook(element, 'settings-row-about-value')?.textContent).toContain(VERSION.version);

    const routines = element.querySelector<HTMLElement>(
      '[data-testid="settings-row"][data-row="routines"]',
    );
    expect(routines?.getAttribute('data-available')).toBe('false');
    expect(routines?.querySelector('button, a')).toBeNull();
    expect(hook(element, 'settings-row-routines')?.getAttribute('data-available')).toBe('false');
    expect(hook(element, 'settings-unpair')?.getAttribute('data-available')).toBe('false');
    expect(hook(element, 'settings-unpair')?.querySelector('button, a')).toBeNull();

    expect(hook(element, 'settings-brake')?.getAttribute('data-enabled')).toBe('false');
    expect(hook(element, 'settings-unavailable-brake')).toBeNull();
    expect(hook(element, 'settings-wipe-cache')?.tagName).toBe('BUTTON');

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

    hook(element, 'settings-notifications-open')?.click();
    await fixture.whenStable();
    flushPanelReads(http);
    await fixture.whenStable();
    expect(hook(element, 'notifications-panel')).not.toBeNull();

    hook(element, 'settings-notifications-open')?.click();
    await fixture.whenStable();
    expect(hook(element, 'notifications-panel')).toBeNull();
  });

  it('opens the providers panel from one row and closes it with a second click', async () => {
    const { fixture, element, http } = await mount();
    flushHappy(http);
    await fixture.whenStable();

    expect(hook(element, 'providers-panel')).toBeNull();

    hook(element, 'settings-providers-open')?.click();
    await fixture.whenStable();
    flushProviderReads(http);
    await fixture.whenStable();

    expect(hook(element, 'providers-panel')).not.toBeNull();
    expect(hook(element, 'providers-panel')?.getAttribute('data-count')).toBe('2');
    expect(element.querySelectorAll('[data-testid="provider-row"]')).toHaveLength(2);

    hook(element, 'settings-providers-open')?.click();
    await fixture.whenStable();
    expect(hook(element, 'providers-panel')).toBeNull();

    hook(element, 'settings-providers-open')?.click();
    await fixture.whenStable();
    flushProviderReads(http);
    await fixture.whenStable();
    expect(hook(element, 'providers-panel')).not.toBeNull();

    hook(element, 'providers-close')?.click();
    await fixture.whenStable();
    expect(hook(element, 'providers-panel')).toBeNull();
  });

  it('leaves the providers panel as the only place that reports provider state', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne(ME_URL).flush(ME);
    http.expectOne(VERSION_URL).flush(VERSION);
    http.expectOne(SETTINGS_URL).flush(SETTINGS);
    http.expectOne(PROVIDERS_URL).flush('missing', { status: 404, statusText: 'Not Found' });
    http.expectOne(PREFERENCES_URL).flush(PREFERENCES_BODY);
    await fixture.whenStable();

    expect(hook(element, 'settings-unavailable-providers')).toBeNull();

    hook(element, 'settings-providers-open')?.click();
    await fixture.whenStable();
    flushProviderReads(http);
    await fixture.whenStable();

    expect(hook(element, 'providers-panel')).not.toBeNull();
    expect(element.querySelectorAll('[data-testid="provider-row"]')).toHaveLength(2);
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

  it('writes the chosen theme into the core settings store and marks it pressed', async () => {
    const { fixture, element, http, values } = await mount();
    flushHappy(http);
    await fixture.whenStable();

    expect(hook(element, 'page-settings')?.getAttribute('data-theme')).toBe('dark');
    expect(hook(element, 'settings-theme')?.getAttribute('data-theme')).toBe('dark');
    expect(hook(element, 'settings-theme')?.getAttribute('role')).toBe('group');
    expect(hook(element, 'settings-theme-dark')?.getAttribute('aria-pressed')).toBe('true');
    expect(hook(element, 'settings-theme-light')?.getAttribute('aria-pressed')).toBe('false');
    expect(hook(element, 'settings-row-appearance-value')?.textContent).toContain(
      translate('es', 'settings.theme.dark'),
    );

    hook(element, 'settings-theme-light')?.click();
    await fixture.whenStable();

    expect(TestBed.inject(AppSettingsStore).theme()).toBe('light');
    expect(hook(element, 'page-settings')?.getAttribute('data-theme')).toBe('light');
    expect(hook(element, 'settings-theme')?.getAttribute('data-theme')).toBe('light');
    expect(hook(element, 'settings-theme-light')?.getAttribute('aria-pressed')).toBe('true');
    expect(hook(element, 'settings-theme-dark')?.getAttribute('aria-pressed')).toBe('false');
    expect(hook(element, 'settings-row-appearance-value')?.textContent).toContain(
      translate('es', 'settings.theme.light'),
    );
    expect(JSON.parse(values.get(SETTINGS_KEY) ?? '{}')).toMatchObject({ theme: 'light' });

    hook(element, 'settings-theme-dark')?.click();
    await fixture.whenStable();

    expect(hook(element, 'page-settings')?.getAttribute('data-theme')).toBe('dark');
    expect(JSON.parse(values.get(SETTINGS_KEY) ?? '{}')).toMatchObject({ theme: 'dark' });
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

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Device, Me } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { SecureStore } from '../../core/auth/secure-store';
import { DevicesPage } from './devices.page';
import { STRINGS, translate } from './i18n';

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

const USED_KEYS: readonly string[] = [
  'common.loading',
  'common.error',
  'common.retry',
  'devices.title',
  'devices.empty',
  'devices.current',
  'devices.revoke',
  'devices.revoke.confirm',
  'devices.lastSeen',
  'devices.never',
  'devices.cancel',
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
  readonly fixture: ComponentFixture<DevicesPage>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
}

async function mount(devices: readonly Device[]): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SECURE_STORE, useValue: memoryStore() },
    ],
  });
  const fixture = TestBed.createComponent(DevicesPage);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(ME_URL).flush(ME);
  http.expectOne(DEVICES_URL).flush({ data: [...devices], nextCursor: null });
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, http };
}

describe('DevicesPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the empty state when nothing is paired', async () => {
    const { element } = await mount([]);

    expect(hook(element, 'devices-empty')).not.toBeNull();
    expect(hook(element, 'device-row')).toBeNull();
    expect(hook(element, 'devices-loading')).toBeNull();
  });

  it('marks the row of the calling device', async () => {
    const { element } = await mount([CURRENT, OTHER]);

    const rows = element.querySelectorAll<HTMLElement>('[data-testid="device-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('data-device-id')).toBe(CURRENT.id);
    expect(rows[0]?.getAttribute('data-current')).toBe('true');
    expect(rows[1]?.getAttribute('data-device-id')).toBe(OTHER.id);
    expect(rows[1]?.getAttribute('data-current')).toBe('false');
    expect(hook(element, 'devices-empty')).toBeNull();
  });

  it('asks once and then revokes the device', async () => {
    const { fixture, element, http } = await mount([CURRENT, OTHER]);

    expect(hook(element, 'device-revoke-confirm')).toBeNull();

    hook(element, 'device-revoke')?.click();
    await fixture.whenStable();

    expect(hook(element, 'device-revoke-confirm')).not.toBeNull();
    http.expectNone({ method: 'DELETE', url: `/v1/devices/${CURRENT.id}` });

    hook(element, 'device-revoke-confirm')?.click();
    await fixture.whenStable();

    const request = http.expectOne({ method: 'DELETE', url: `/v1/devices/${CURRENT.id}` });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();

    const rows = element.querySelectorAll<HTMLElement>('[data-testid="device-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-device-id')).toBe(OTHER.id);
  });

  it('cancels a pending revoke without calling the daemon', async () => {
    const { fixture, element, http } = await mount([CURRENT, OTHER]);

    hook(element, 'device-revoke')?.click();
    await fixture.whenStable();
    hook(element, 'device-revoke-cancel')?.click();
    await fixture.whenStable();

    expect(hook(element, 'device-revoke-confirm')).toBeNull();
    http.expectNone({ method: 'DELETE', url: `/v1/devices/${CURRENT.id}` });
  });

  it('renders the error block when the list fails', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SECURE_STORE, useValue: memoryStore() },
      ],
    });
    const fixture = TestBed.createComponent(DevicesPage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    const element = fixture.nativeElement as HTMLElement;

    http.expectOne(ME_URL).flush(
      { error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
      { status: 500, statusText: 'Internal Server Error' },
    );
    http.expectOne(DEVICES_URL).flush({ data: [], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'devices-error')?.getAttribute('data-code')).toBe('internal');
    expect(hook(element, 'devices-empty')).not.toBeNull();
  });

  it('ships the same keys in both dictionaries and resolves every template key', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.es).sort());
    for (const locale of ['en', 'es'] as const) {
      for (const [key, value] of Object.entries(STRINGS[locale])) {
        expect(value, `${locale} ${key}`).not.toBe('');
        expect(translate(locale, key), `${locale} ${key}`).toBe(value);
      }
      for (const key of USED_KEYS) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});

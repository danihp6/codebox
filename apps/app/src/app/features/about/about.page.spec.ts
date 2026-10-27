import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { Health, Version } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { SecureStore } from '../../core/auth/secure-store';
import { AboutPage } from './about.page';
import { STRINGS, translate } from './about.i18n';
import { THIRD_PARTY_NOTICES } from './notice';
import type { ThirdPartyNotice } from './notice';

const VERSION: Version = {
  version: '9.9.9-test',
  commit: 'deadbee',
  builtAt: '2026-01-02T03:04:05Z',
  node: 'v24.9.1',
};

const HEALTH: Health = {
  status: 'ok',
  db: 'ok',
  opencode: 'degraded',
  disk: { freeBytes: 12_000, totalBytes: 48_000, usedPercent: 75 },
  queue: { pending: 2, running: 1, maxConcurrency: 4 },
  version: '0.1.0',
};

const VERSION_URL = '/v1/version';
const HEALTH_URL = '/v1/health';

const USED_KEYS: readonly string[] = [
  'about.title',
  'about.section.build',
  'about.section.health',
  'about.version',
  'about.commit',
  'about.built-at',
  'about.node',
  'about.health.db',
  'about.health.opencode',
  'about.health.disk',
  'about.health.queue',
  'about.section.notices',
  'about.notices.count',
  'about.error',
  'about.retry',
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

function envelope(code: string): Record<string, unknown> {
  return { error: { code, message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } };
}

function failure(): { status: number; statusText: string } {
  return { status: 500, statusText: 'Internal Server Error' };
}

function noticeOf(name: string): ThirdPartyNotice {
  const found = THIRD_PARTY_NOTICES.find((notice) => notice.name === name);
  if (found === undefined) throw new Error(`the NOTICE carries no ${name}`);
  return found;
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function hookFor(
  element: HTMLElement,
  id: string,
  attribute: string,
  value: string,
): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"][${attribute}="${value}"]`);
}

interface Mounted {
  readonly fixture: ComponentFixture<AboutPage>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
}

async function mount(): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SECURE_STORE, useValue: memoryStore() },
    ],
  });
  const fixture = TestBed.createComponent(AboutPage);
  await fixture.whenStable();
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
  };
}

async function flushBoth(
  mounted: Mounted,
  version: Version,
  health: Health = HEALTH,
): Promise<void> {
  mounted.http.expectOne(VERSION_URL).flush(version);
  mounted.http.expectOne(HEALTH_URL).flush(health);
  await mounted.fixture.whenStable();
}

describe('AboutPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the version and the commit the server sent', async () => {
    const mounted = await mount();
    const { element } = mounted;

    expect(hook(element, 'page-about')).not.toBeNull();
    expect(hook(element, 'about-loading')).not.toBeNull();

    await flushBoth(mounted, VERSION);

    expect(hook(element, 'about-loading')).toBeNull();

    const version = hookFor(element, 'about-version', 'data-version', '9.9.9-test');
    const commit = hookFor(element, 'about-commit', 'data-commit', 'deadbee');
    const builtAt = hookFor(element, 'about-built-at', 'data-built-at', '2026-01-02T03:04:05Z');
    const node = hookFor(element, 'about-node', 'data-node', 'v24.9.1');

    expect(version?.textContent).toContain('9.9.9-test');
    expect(commit?.textContent).toContain('deadbee');
    expect(builtAt?.textContent).toContain('2026-01-02T03:04:05Z');
    expect(node?.textContent).toContain('v24.9.1');
    expect(hook(element, 'about-error')).toBeNull();
  });

  it('renders an em dash for a null commit and a null build time', async () => {
    const mounted = await mount();
    const { element } = mounted;

    await flushBoth(mounted, {
      version: '1.0.0',
      commit: null,
      builtAt: null,
      node: 'v24.0.0',
    });

    const commit = hookFor(element, 'about-commit', 'data-commit', 'none');
    const builtAt = hookFor(element, 'about-built-at', 'data-built-at', 'none');

    expect(commit?.textContent).toContain('—');
    expect(builtAt?.textContent).toContain('—');
    expect(commit?.textContent).not.toContain('deadbee');
  });

  it('renders the health rows the server reported', async () => {
    const mounted = await mount();
    const { element } = mounted;

    await flushBoth(mounted, VERSION);

    expect(hook(element, 'page-about')?.getAttribute('data-status')).toBe('ok');
    expect(hook(element, 'about-health')?.getAttribute('data-status')).toBe('ok');
    expect(hookFor(element, 'about-health-db', 'data-state', 'ok')).not.toBeNull();
    expect(hookFor(element, 'about-health-opencode', 'data-state', 'degraded')).not.toBeNull();
    expect(hookFor(element, 'about-health-disk', 'data-percent', '75')?.textContent).toContain(
      '75',
    );

    const queue = hookFor(element, 'about-health-queue', 'data-pending', '2');
    expect(queue?.getAttribute('data-running')).toBe('1');
    expect(queue?.getAttribute('data-max')).toBe('4');
  });

  it('lists every package the shipped NOTICE holds', async () => {
    const mounted = await mount();
    const { element } = mounted;

    await flushBoth(mounted, VERSION);

    const items = element.querySelectorAll<HTMLElement>('[data-testid="about-notice-item"]');
    expect(items).toHaveLength(THIRD_PARTY_NOTICES.length);
    expect(hook(element, 'about-notice')?.getAttribute('data-packages')).toBe(
      String(THIRD_PARTY_NOTICES.length),
    );

    const hono = noticeOf('hono');
    const honoItem = hookFor(element, 'about-notice-item', 'data-package', hono.label);
    expect(honoItem?.getAttribute('data-licence')).toBe('MIT');
    expect(honoItem?.textContent).toContain(hono.label);
    expect(honoItem?.textContent).toContain('MIT');

    const apache = hookFor(element, 'about-notice-item', 'data-package', noticeOf('rxjs').label);
    expect(apache?.getAttribute('data-licence')).toBe('Apache-2.0');

    const bsd = hookFor(element, 'about-notice-item', 'data-package', noticeOf('tslib').label);
    expect(bsd?.getAttribute('data-licence')).toBe('0BSD');
  });

  it('keeps the build block when the health read fails and retries both reads', async () => {
    const mounted = await mount();
    const { element, fixture, http } = mounted;

    http.expectOne(VERSION_URL).flush(VERSION);
    http.expectOne(HEALTH_URL).flush(envelope('internal'), failure());
    await fixture.whenStable();

    expect(hook(element, 'about-error')?.getAttribute('data-code')).toBe('internal');
    expect(hook(element, 'about-health')).toBeNull();
    expect(hookFor(element, 'about-version', 'data-version', '9.9.9-test')).not.toBeNull();

    hook(element, 'about-retry')?.click();
    await fixture.whenStable();

    http.expectOne(VERSION_URL).flush(VERSION);
    http.expectOne(HEALTH_URL).flush(HEALTH);
    await fixture.whenStable();

    expect(hook(element, 'about-error')).toBeNull();
    expect(hook(element, 'about-health')?.getAttribute('data-status')).toBe('ok');
  });

  it('keeps the health rows when the version read fails', async () => {
    const mounted = await mount();
    const { element, fixture, http } = mounted;

    http.expectOne(VERSION_URL).flush(envelope('internal'), failure());
    http.expectOne(HEALTH_URL).flush(HEALTH);
    await fixture.whenStable();

    expect(hook(element, 'about-error')?.getAttribute('data-code')).toBe('internal');
    expect(hook(element, 'about-version')).toBeNull();
    expect(hook(element, 'about-health')?.getAttribute('data-status')).toBe('ok');
  });

  it('formats a missing build time as an em dash', async () => {
    const mounted = await mount();
    const { fixture } = mounted;

    expect(fixture.componentInstance.formatBuiltAt(null)).toBe('—');
    expect(fixture.componentInstance.formatBuiltAt('2026-01-02T03:04:05Z')).toBe(
      '2026-01-02T03:04:05Z',
    );

    await flushBoth(mounted, VERSION);
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

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Health, Version } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { SecureStore } from '../../core/auth/secure-store';
import { I18nService } from '../../core/i18n/i18n.service';
import { STRINGS, translate } from './about.i18n';
import { AboutPage } from './about.page';
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

const ROW_ORDER: readonly string[] = ['version', 'commit', 'build', 'instance'];

const USED_KEYS: readonly string[] = [
  'about.title',
  'about.wordmark',
  'about.tagline',
  'about.version',
  'about.commit',
  'about.build',
  'about.instance',
  'about.health.db',
  'about.health.opencode',
  'about.health.disk',
  'about.health.ok',
  'about.health.degraded',
  'about.health.down',
  'about.licences',
  'about.footnote.licences',
  'about.footnote.durability',
];

const RETIRED_KEYS: readonly string[] = [
  'about.section.build',
  'about.section.health',
  'about.section.notices',
  'about.built-at',
  'about.node',
  'about.notices.count',
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

function hooks(element: HTMLElement, id: string): readonly HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
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
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: { locale: signal<'en' | 'es'>('en') } },
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

  it('renders the version, the commit and the formatted build time the server sent', async () => {
    const mounted = await mount();
    const { element } = mounted;

    expect(hook(element, 'page-about')).not.toBeNull();
    expect(hook(element, 'about-loading')).not.toBeNull();

    mounted.http.expectOne(VERSION_URL).flush(VERSION);
    await mounted.fixture.whenStable();

    expect(hook(element, 'about-loading')).not.toBeNull();

    mounted.http.expectOne(HEALTH_URL).flush(HEALTH);
    await mounted.fixture.whenStable();

    expect(hook(element, 'about-loading')).toBeNull();

    const card = hook(element, 'about-card');
    expect(card?.getAttribute('data-version')).toBe('9.9.9-test');
    expect(card?.getAttribute('data-node')).toBe('v24.9.1');

    const version = hookFor(element, 'about-version', 'data-version', '9.9.9-test');
    const commit = hookFor(element, 'about-commit', 'data-commit', 'deadbee');
    const builtAt = hookFor(element, 'about-built-at', 'data-built-at', '2026-01-02T03:04:05Z');

    expect(version?.textContent).toContain('9.9.9-test');
    expect(commit?.textContent).toContain('deadbee');
    expect(builtAt?.textContent).toContain('2026-01-02 · 03:04 UTC');
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

  it('renders the health line, its dot and the localised status the server reported', async () => {
    const mounted = await mount();
    const { element } = mounted;

    await flushBoth(mounted, VERSION);

    expect(hook(element, 'page-about')?.getAttribute('data-status')).toBe('ok');

    const line = hook(element, 'about-health');
    expect(line?.getAttribute('data-status')).toBe('ok');
    expect(line?.getAttribute('data-db')).toBe('ok');
    expect(line?.getAttribute('data-opencode')).toBe('degraded');
    expect(line?.getAttribute('data-disk-percent')).toBe('75');
    expect(line?.textContent?.trim()).toBe('db ok · opencode degraded · disk 75%');
    expect(line?.textContent).toContain('db ok');
    expect(line?.textContent).toContain('opencode degraded');
    expect(line?.textContent).toContain('disk 75%');

    expect(hookFor(element, 'about-health-db', 'data-state', 'ok')).not.toBeNull();
    expect(hookFor(element, 'about-health-opencode', 'data-state', 'degraded')).not.toBeNull();
    expect(hookFor(element, 'about-health-disk', 'data-percent', '75')).not.toBeNull();

    const queue = hookFor(element, 'about-health-queue', 'data-pending', '2');
    expect(queue?.getAttribute('data-running')).toBe('1');
    expect(queue?.getAttribute('data-max')).toBe('4');
    expect(queue?.textContent?.trim()).toBe('');

    expect(hook(element, 'about-health-dot')?.getAttribute('data-status')).toBe('ok');
    const status = hook(element, 'about-health-status');
    expect(status?.getAttribute('data-status')).toBe('ok');
    expect(status?.textContent?.trim()).toBe('healthy');
  });

  it('labels a degraded server with the warn status', async () => {
    const mounted = await mount();
    const { element } = mounted;

    await flushBoth(mounted, VERSION, { ...HEALTH, status: 'degraded' });

    expect(hook(element, 'about-health')?.getAttribute('data-status')).toBe('degraded');
    expect(hook(element, 'about-health-dot')?.getAttribute('data-status')).toBe('degraded');
    expect(hook(element, 'about-health-status')?.textContent?.trim()).toBe('degraded');
  });

  it('lists every package the shipped NOTICE holds', async () => {
    const mounted = await mount();
    const { element } = mounted;

    await flushBoth(mounted, VERSION);

    const items = hooks(element, 'about-notice-item');
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

  it('keeps the notice list inside the closed licences disclosure', async () => {
    const mounted = await mount();
    const { element, fixture } = mounted;

    await flushBoth(mounted, VERSION);

    const disclosure = hook(element, 'about-licences');
    expect(disclosure?.tagName.toLowerCase()).toBe('details');
    expect(hook(element, 'about-licences-label')?.textContent?.trim()).toBe(
      translate('en', 'about.licences'),
    );
    expect(hook(element, 'about-licences-chevron')?.textContent?.trim()).toBe('›');

    const details = disclosure as HTMLDetailsElement;
    expect(details.open).toBe(false);

    details.open = true;
    await fixture.whenStable();

    expect(details.open).toBe(true);
    expect(hooks(element, 'about-notice-item')).toHaveLength(THIRD_PARTY_NOTICES.length);
    expect(
      hookFor(element, 'about-notice-item', 'data-package', noticeOf('hono').label),
    ).not.toBeNull();
  });

  it('draws the frame hooks in their drawn order', async () => {
    const mounted = await mount();
    const { element } = mounted;

    await flushBoth(mounted, VERSION);

    const back = hook(element, 'about-back');
    expect(back?.getAttribute('href')).toBe('/settings');
    expect(back?.textContent?.trim()).toBe('‹');

    expect(hook(element, 'about-wordmark')?.textContent?.trim()).toBe('codebox');
    expect(hook(element, 'about-tagline')?.textContent?.trim()).toBe(
      translate('en', 'about.tagline'),
    );

    const rows = hooks(element, 'about-row');
    expect(rows.map((row) => row.getAttribute('data-row'))).toEqual([...ROW_ORDER]);
    for (const row of rows) {
      expect(row.querySelector('[data-testid="about-row-label"]')?.textContent?.trim()).not.toBe(
        '',
      );
      expect(row.querySelector('[data-testid="about-row-value"]')?.textContent?.trim()).not.toBe(
        '',
      );
    }

    const instance = hook(element, 'about-instance');
    expect(instance?.textContent?.trim()).toBe('—');
    expect(instance?.getAttribute('data-identity')).toBe('unavailable');

    const notes = hooks(element, 'about-footnote');
    expect(notes.map((note) => note.getAttribute('data-note'))).toEqual(['1', '2']);
    expect(notes[0]?.textContent).toContain(translate('en', 'about.footnote.licences'));
    expect(notes[1]?.textContent).toContain(translate('en', 'about.footnote.durability'));
  });

  it('keeps the card rows when the health read fails and retries both reads', async () => {
    const mounted = await mount();
    const { element, fixture, http } = mounted;

    http.expectOne(VERSION_URL).flush(VERSION);
    http.expectOne(HEALTH_URL).flush(envelope('internal'), failure());
    await fixture.whenStable();

    expect(hook(element, 'about-error')?.getAttribute('data-code')).toBe('internal');
    expect(hook(element, 'about-health')).toBeNull();
    expect(hookFor(element, 'about-version', 'data-version', '9.9.9-test')).not.toBeNull();
    expect(hooks(element, 'about-row')).toHaveLength(ROW_ORDER.length);

    hook(element, 'about-retry')?.click();
    await fixture.whenStable();

    http.expectOne(VERSION_URL).flush(VERSION);
    http.expectOne(HEALTH_URL).flush(HEALTH);
    await fixture.whenStable();

    expect(hook(element, 'about-error')).toBeNull();
    expect(hook(element, 'about-health')?.getAttribute('data-status')).toBe('ok');
  });

  it('keeps the health block when the version read fails', async () => {
    const mounted = await mount();
    const { element, fixture, http } = mounted;

    http.expectOne(VERSION_URL).flush(envelope('internal'), failure());
    http.expectOne(HEALTH_URL).flush(HEALTH);
    await fixture.whenStable();

    expect(hook(element, 'about-error')?.getAttribute('data-code')).toBe('internal');
    expect(hook(element, 'about-version')).toBeNull();
    expect(hook(element, 'about-card')?.getAttribute('data-version')).toBeNull();
    expect(hook(element, 'about-health')?.getAttribute('data-status')).toBe('ok');
  });

  it('formats the build time in UTC and never echoes it', async () => {
    const mounted = await mount();
    const { fixture } = mounted;
    const page = fixture.componentInstance;

    expect(page.formatBuiltAt('2026-01-02T03:04:05Z')).toBe('2026-01-02 · 03:04 UTC');
    expect(page.formatBuiltAt('2026-01-02T03:04:05+02:00')).toBe('2026-01-02 · 01:04 UTC');
    expect(page.formatBuiltAt(null)).toBe('—');
    expect(page.formatBuiltAt('not-a-timestamp')).toBe('—');

    await flushBoth(mounted, VERSION);
  });

  it('builds the health line and the labels from the data only', async () => {
    const mounted = await mount();
    const { fixture } = mounted;
    const page = fixture.componentInstance;

    expect(page.healthLine(HEALTH)).toBe('db ok · opencode degraded · disk 75%');
    expect(page.healthLabel('ok')).toBe('healthy');
    expect(page.healthLabel('degraded')).toBe('degraded');
    expect(page.healthLabel('down')).toBe('down');

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
      for (const key of RETIRED_KEYS) {
        expect(STRINGS[locale][key], `${locale} ${key}`).toBeUndefined();
      }
    }
  });
});

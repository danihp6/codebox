import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { Providers } from '@codebox/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locale } from '../../core/i18n/i18n.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProvidersPanel } from './providers.page';

const TS = '2026-10-24T18:03:11Z';

const PROVIDERS: Providers = {
  providers: [
    { provider: 'github', configured: true, mode: 'app', lastOkAt: TS, fingerprint: 'abcd1234ef' },
    { provider: 'opencode', configured: false, mode: 'none', lastOkAt: null, fingerprint: null },
  ],
};

const PROVIDERS_URL = '/v1/providers';

interface Mounted {
  readonly fixture: ComponentFixture<ProvidersPanel>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
  readonly locale: WritableSignal<Locale>;
}

async function mount(locale: Locale = 'en'): Promise<Mounted> {
  const localeSignal = signal<Locale>(locale);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: { locale: localeSignal } },
    ],
  });
  const fixture = TestBed.createComponent(ProvidersPanel);
  await fixture.whenStable();
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
    locale: localeSignal,
  };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function rows(element: HTMLElement): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>('[data-testid="provider-row"]')];
}

describe('ProvidersPanel', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders one row per provider with its configured and mode state', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(PROVIDERS);
    await fixture.whenStable();

    const rendered = rows(element);
    expect(rendered).toHaveLength(2);
    expect(rendered.map((row) => row.getAttribute('data-provider'))).toEqual([
      'github',
      'opencode',
    ]);
    expect(rendered[0]?.getAttribute('data-configured')).toBe('true');
    expect(rendered[0]?.getAttribute('data-mode')).toBe('app');
    expect(rendered[1]?.getAttribute('data-configured')).toBe('false');
    expect(rendered[1]?.getAttribute('data-mode')).toBe('none');
    expect(hook(element, 'providers-panel')?.getAttribute('data-count')).toBe('2');
    expect(hook(element, 'providers-unavailable')).toBeNull();
    expect(hook(element, 'providers-empty')).toBeNull();
    http.verify();
  });

  it('shows at most four characters of a fingerprint and nothing when it is absent', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(PROVIDERS);
    await fixture.whenStable();

    const rendered = rows(element);
    const shown = rendered[0]?.querySelector('[data-testid="provider-fingerprint"]');
    expect(shown?.textContent?.trim()).toBe('abcd');
    expect(element.textContent).not.toContain('abcd1234ef');
    expect(rendered[1]?.querySelector('[data-testid="provider-fingerprint"]')).toBeNull();
    http.verify();
  });

  it('formats lastOkAt instead of printing the raw timestamp', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(PROVIDERS);
    await fixture.whenStable();

    const rendered = rows(element);
    const lastOk = rendered[0]?.querySelector('[data-testid="provider-last-ok"]');
    expect(lastOk?.textContent?.trim()).not.toBe(TS);
    expect(lastOk?.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(element.textContent).not.toContain(TS);
    expect(rendered[1]?.querySelector('[data-testid="provider-last-ok"]')).toBeNull();
    http.verify();
  });

  it('renders the unavailable copy and no rows when the route is absent', async () => {
    const { fixture, element, http } = await mount();
    http
      .expectOne({ method: 'GET', url: PROVIDERS_URL })
      .flush('missing', { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();

    expect(hook(element, 'providers-unavailable')?.textContent).toContain('Unavailable');
    expect(rows(element)).toHaveLength(0);
    expect(hook(element, 'providers-empty')).toBeNull();
    expect(hook(element, 'providers-error')).toBeNull();
    expect(hook(element, 'providers-panel')?.getAttribute('data-unavailable')).toBe('true');
    http.verify();
  });

  it('renders the unavailable copy and no rows on a 503', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(
      {
        error: {
          code: 'internal',
          message: 'Providers read is not wired',
          requestId: 'req_01JABCDEFGHJKMNPQRSV',
        },
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await fixture.whenStable();

    expect(hook(element, 'providers-unavailable')).not.toBeNull();
    expect(rows(element)).toHaveLength(0);
    http.verify();
  });

  it('renders the error block, retries, and speaks Spanish when asked', async () => {
    const { fixture, element, http, locale } = await mount('es');
    http
      .expectOne({ method: 'GET', url: PROVIDERS_URL })
      .flush(
        { error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
        { status: 500, statusText: 'Internal Server Error' },
      );
    await fixture.whenStable();

    expect(hook(element, 'providers-error')?.getAttribute('data-code')).toBe('internal');
    expect(hook(element, 'providers-empty')).toBeNull();
    expect(rows(element)).toHaveLength(0);

    hook(element, 'providers-retry')?.click();
    await fixture.whenStable();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(PROVIDERS);
    await fixture.whenStable();

    expect(rows(element)).toHaveLength(2);
    expect(element.textContent).toContain('Configurado');

    locale.set('en');
    await fixture.whenStable();
    expect(element.textContent).toContain('Configured');
    http.verify();
  });

  it('emits once from the close control', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(PROVIDERS);
    await fixture.whenStable();

    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => {
      closed += 1;
    });

    hook(element, 'providers-close')?.click();
    await fixture.whenStable();

    expect(closed).toBe(1);
    http.verify();
  });
});

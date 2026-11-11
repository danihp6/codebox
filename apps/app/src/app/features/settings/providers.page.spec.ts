import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { ProvidersResponse } from '@codebox/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locale } from '../../core/i18n/i18n.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProvidersPanel } from './providers.page';

const TS = '2026-10-28T09:12:00Z';
const RESET_AT = '2026-10-28T15:00:00Z';
const FULL_LAST_FOUR = 'a91f7b2c';
const CREDENTIAL_ID = 'cred_01JABCDEFG';

const PROVIDERS: ProvidersResponse = {
  providers: [
    {
      id: 'opencode-go',
      label: 'OpenCode Go',
      authKind: 'oauth',
      baseUrl: 'https://opencode.ai',
      createdAt: TS,
      updatedAt: TS,
      accounts: [
        {
          id: 'acct_01JABCDEFG',
          providerId: 'opencode-go',
          label: 'go · dani',
          credentialId: CREDENTIAL_ID,
          priority: 1,
          state: 'active',
          resetAt: null,
          budgetUsd: 20,
          usedToday: { day: '2026-10-28', usd: 2.4 },
          createdAt: TS,
          updatedAt: TS,
          lastFour: FULL_LAST_FOUR,
        },
        {
          id: 'acct_01JABCDEFH',
          providerId: 'opencode-go',
          label: 'go · spare',
          credentialId: 'cred_01JABCDEFH',
          priority: 2,
          state: 'exhausted',
          resetAt: RESET_AT,
          budgetUsd: null,
          usedToday: { day: '2026-10-28', usd: 0 },
          createdAt: TS,
          updatedAt: TS,
          lastFour: 'b2c3',
        },
      ],
    },
    {
      id: 'anthropic',
      label: 'Anthropic',
      authKind: 'token',
      baseUrl: null,
      createdAt: TS,
      updatedAt: TS,
      accounts: [],
    },
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

function hook(root: HTMLElement | null, id: string): HTMLElement | null {
  return root?.querySelector<HTMLElement>(`[data-testid="${id}"]`) ?? null;
}

function all(root: HTMLElement | null, id: string): HTMLElement[] {
  return [...(root?.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`) ?? [])];
}

function rows(element: HTMLElement | null): HTMLElement[] {
  return all(element, 'provider-row');
}

function text(element: HTMLElement | null): string {
  return element?.textContent?.trim() ?? '';
}

describe('ProvidersPanel', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders one row per provider with its label and auth kind', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(PROVIDERS);
    await fixture.whenStable();

    const rendered = rows(element);
    expect(rendered).toHaveLength(2);
    expect(rendered.map((row) => row.getAttribute('data-provider'))).toEqual([
      'opencode-go',
      'anthropic',
    ]);
    expect(rendered[0]?.getAttribute('data-auth-kind')).toBe('oauth');
    expect(rendered[0]?.getAttribute('data-accounts')).toBe('2');
    expect(rendered[1]?.getAttribute('data-auth-kind')).toBe('token');
    expect(rendered[1]?.getAttribute('data-accounts')).toBe('0');
    expect(text(hook(rendered[0] ?? null, 'provider-label'))).toBe('OpenCode Go');
    expect(text(hook(rendered[0] ?? null, 'provider-auth-kind'))).toBe('oauth');
    expect(hook(element, 'providers-panel')?.getAttribute('data-count')).toBe('2');
    expect(hook(element, 'providers-unavailable')).toBeNull();
    expect(hook(element, 'providers-empty')).toBeNull();
    http.verify();
  });

  it('renders one row per account with its state, priority, spend, reset and tail', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(PROVIDERS);
    await fixture.whenStable();

    const panel = rows(element)[0];
    expect(text(hook(panel ?? null, 'provider-accounts-count'))).toBe('2 Accounts');

    const accounts = all(element, 'provider-account-row');
    expect(accounts).toHaveLength(2);
    expect(accounts.map((row) => row.getAttribute('data-account'))).toEqual([
      'acct_01JABCDEFG',
      'acct_01JABCDEFH',
    ]);
    expect(accounts.map((row) => row.getAttribute('data-state'))).toEqual(['active', 'exhausted']);
    expect(accounts.map((row) => row.getAttribute('data-priority'))).toEqual(['1', '2']);

    expect(text(hook(accounts[0] ?? null, 'provider-account-label'))).toBe('go · dani');
    expect(text(hook(accounts[0] ?? null, 'provider-account-state'))).toBe('active');
    expect(text(hook(accounts[0] ?? null, 'provider-account-priority'))).toBe('1');
    expect(text(hook(accounts[0] ?? null, 'provider-account-spend'))).toBe('$2.40 / $20.00');
    expect(text(hook(accounts[0] ?? null, 'provider-account-last-four'))).toBe('a91f');

    expect(text(hook(accounts[1] ?? null, 'provider-account-state'))).toBe('exhausted');
    expect(text(hook(accounts[1] ?? null, 'provider-account-spend'))).toBe('$0.00');
    expect(text(hook(accounts[1] ?? null, 'provider-account-last-four'))).toBe('b2c3');
    http.verify();
  });

  it('shows at most four characters of lastFour and never the full value or the credential', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(PROVIDERS);
    await fixture.whenStable();

    expect(text(hook(element, 'provider-account-last-four'))).toBe('a91f');
    expect(element.textContent).not.toContain(FULL_LAST_FOUR);
    expect(element.textContent).not.toContain(CREDENTIAL_ID);
    http.verify();
  });

  it('formats the reset instant instead of printing the raw timestamp', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(PROVIDERS);
    await fixture.whenStable();

    const reset = all(element, 'provider-account-reset');
    expect(reset).toHaveLength(1);
    expect(text(reset[0] ?? null)).not.toBe(RESET_AT);
    expect(reset[0]?.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(element.textContent).not.toContain(RESET_AT);

    const accounts = all(element, 'provider-account-row');
    expect(hook(accounts[0] ?? null, 'provider-account-reset')).toBeNull();
    expect(accounts[0]?.textContent).toContain('—');
    http.verify();
  });

  it('says a provider has no account yet', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush(PROVIDERS);
    await fixture.whenStable();

    const empty = rows(element)[1];
    expect(text(hook(empty ?? null, 'provider-account-empty'))).toBe('No account yet.');
    expect(hook(empty ?? null, 'provider-accounts-count')).toBeNull();
    expect(all(element, 'provider-account-row')).toHaveLength(2);
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
    expect(hook(element, 'providers-error')).toBeNull();
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
    expect(element.textContent).toContain('Cuentas');

    locale.set('en');
    await fixture.whenStable();
    expect(element.textContent).toContain('Accounts');
    http.verify();
  });

  it('renders the empty copy when the daemon knows no provider', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne({ method: 'GET', url: PROVIDERS_URL }).flush({ providers: [] });
    await fixture.whenStable();

    expect(hook(element, 'providers-empty')).not.toBeNull();
    expect(rows(element)).toHaveLength(0);
    expect(hook(element, 'providers-panel')?.getAttribute('data-count')).toBe('0');
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

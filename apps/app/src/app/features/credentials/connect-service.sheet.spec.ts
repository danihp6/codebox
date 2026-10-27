import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { TestRequest } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nService } from '../../core/i18n/i18n.service';
import { ConnectServiceSheet } from './connect-service.sheet';
import type { CreateIntegrationBody, Credential } from './credentials.api';
import { STRINGS, translate } from './i18n';

const TS = '2026-10-27T10:00:00Z';
const REQUEST_ID = 'req_01JABCDEFGHJKMNPQRSV';

const CREDENTIAL = {
  id: 'cred_01JABCDEFG',
  name: 'Linear token',
  kind: 'bearer',
  expose: 'tool',
  configured: true,
  lastFour: 'abcd',
  createdAt: TS,
  updatedAt: TS,
  lastUsedAt: null,
} satisfies Credential;

const MANIFEST = {
  name: 'codebox',
  url: 'https://cb.example.com',
  hook_attributes: { active: false },
};

const MANIFEST_START = {
  action: 'https://github.com/settings/apps/new?state=st_1',
  manifest: MANIFEST,
  state: 'st_1',
};

const USED_KEYS: readonly string[] = [
  'connect.auth',
  'connect.baseUrl',
  'connect.cancel',
  'connect.credential',
  'connect.github',
  'connect.headerName',
  'connect.hosts',
  'connect.integration',
  'connect.manifestHint',
  'connect.manifestSubmit',
  'connect.name',
  'connect.problem.baseUrl',
  'connect.problem.credential',
  'connect.problem.github',
  'connect.problem.headerName',
  'connect.problem.hosts',
  'connect.problem.name',
  'connect.save',
  'connect.title',
  'credentials.action.back',
  'integration.auth.basic',
  'integration.auth.bearer',
  'integration.auth.header',
  'integration.auth.none',
];

interface Mounted {
  readonly fixture: ComponentFixture<ConnectServiceSheet>;
  readonly element: HTMLElement;
  readonly component: ConnectServiceSheet;
  readonly http: HttpTestingController;
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

async function mount(credentials: readonly Credential[] = [CREDENTIAL]): Promise<Mounted> {
  const locale = signal<'en' | 'es'>('en');
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: { locale } },
    ],
  });
  const fixture = TestBed.createComponent(ConnectServiceSheet);
  fixture.componentRef.setInput('credentials', credentials);
  await fixture.whenStable();
  fixture.detectChanges();
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance,
    http: TestBed.inject(HttpTestingController),
  };
}

async function fill(
  fixture: ComponentFixture<ConnectServiceSheet>,
  element: HTMLElement,
  id: string,
  value: string,
): Promise<void> {
  const field = hook(element, id);
  if (field === null) throw new Error(`${id} is missing`);
  if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) {
    throw new Error(`${id} is not a text field`);
  }
  field.value = value;
  field.dispatchEvent(new Event('input'));
  fixture.detectChanges();
  await fixture.whenStable();
}

async function choose(
  fixture: ComponentFixture<ConnectServiceSheet>,
  element: HTMLElement,
  id: string,
  value: string,
): Promise<void> {
  const select = hook(element, id);
  if (select === null) throw new Error(`${id} is missing`);
  if (!(select instanceof HTMLSelectElement)) throw new Error(`${id} is not a select`);
  select.value = value;
  select.dispatchEvent(new Event('change'));
  fixture.detectChanges();
  await fixture.whenStable();
}

async function click(
  fixture: ComponentFixture<ConnectServiceSheet>,
  element: HTMLElement,
  id: string,
): Promise<void> {
  const button = hook(element, id);
  if (button === null) throw new Error(`${id} is missing`);
  button.click();
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('ConnectServiceSheet', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('starts the GitHub manifest flow and renders the browser form', async () => {
    const { fixture, element } = await mount();

    await click(fixture, element, 'service-github');

    const start = request('POST', '/v1/integrations/github/manifest');
    start.flush(MANIFEST_START);
    fixture.detectChanges();
    await fixture.whenStable();

    const form = hook(element, 'github-manifest-form');
    expect(form).not.toBeNull();
    expect(form?.getAttribute('method')?.toLowerCase()).toBe('post');
    expect(form?.getAttribute('action')).toBe(MANIFEST_START.action);

    const manifest = form?.querySelector<HTMLInputElement>('input[name="manifest"]');
    expect(manifest?.value).toBe(JSON.stringify(MANIFEST));
    const state = form?.querySelector<HTMLInputElement>('input[name="state"]');
    expect(state?.value).toBe(MANIFEST_START.state);
  });

  it('renders the documented error code when the manifest flow cannot start', async () => {
    const { fixture, element } = await mount();

    await click(fixture, element, 'service-github');

    request('POST', '/v1/integrations/github/manifest').flush(
      {
        error: {
          code: 'provider_unavailable',
          message: 'Secrets are not configured',
          details: { reason: 'secrets_not_configured' },
          requestId: REQUEST_ID,
        },
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(hook(element, 'github-manifest-form')).toBeNull();
    expect(hook(element, 'connect-service-error')?.getAttribute('data-code')).toBe(
      'provider_unavailable',
    );
  });

  it('renders the integration form and hides the header field unless auth is header', async () => {
    const { fixture, element } = await mount();

    await click(fixture, element, 'service-integration');

    expect(hook(element, 'integration-form')).not.toBeNull();
    expect(hook(element, 'integration-header')).toBeNull();

    await choose(fixture, element, 'integration-auth', 'header');
    expect(hook(element, 'integration-header')).not.toBeNull();

    await choose(fixture, element, 'integration-auth', 'bearer');
    expect(hook(element, 'integration-header')).toBeNull();
  });

  it('offers the passed credentials in the credential select', async () => {
    const { fixture, element } = await mount();
    await click(fixture, element, 'service-integration');

    const select = hook(element, 'integration-credential');
    const option = select?.querySelector<HTMLOptionElement>(`option[value="${CREDENTIAL.id}"]`);
    expect(option?.textContent?.trim()).toBe(CREDENTIAL.name);
  });

  it('refuses to save without an allowed host', async () => {
    const { fixture, element, component } = await mount();
    const created: CreateIntegrationBody[] = [];
    component.created.subscribe((body) => created.push(body));

    await click(fixture, element, 'service-integration');
    await fill(fixture, element, 'integration-name', 'Linear');
    await fill(fixture, element, 'integration-base-url', 'https://api.linear.app');
    await click(fixture, element, 'integration-save');

    expect(created).toEqual([]);
    expect(hook(element, 'integration-problem')?.textContent).toBe(
      translate('en', 'connect.problem.hosts'),
    );
  });

  it('refuses to save without a credential when auth is not none', async () => {
    const { fixture, element, component } = await mount();
    const created: CreateIntegrationBody[] = [];
    component.created.subscribe((body) => created.push(body));

    await click(fixture, element, 'service-integration');
    await fill(fixture, element, 'integration-name', 'Linear');
    await fill(fixture, element, 'integration-base-url', 'https://api.linear.app');
    await fill(fixture, element, 'integration-hosts', 'api.linear.app');
    await choose(fixture, element, 'integration-auth', 'bearer');
    await click(fixture, element, 'integration-save');

    expect(created).toEqual([]);
    expect(hook(element, 'integration-problem')?.textContent).toBe(
      translate('en', 'connect.problem.credential'),
    );
  });

  it('emits the integration body with the parsed hosts and the chosen credential', async () => {
    const { fixture, element, component } = await mount();
    const created: CreateIntegrationBody[] = [];
    component.created.subscribe((body) => created.push(body));

    await click(fixture, element, 'service-integration');
    await fill(fixture, element, 'integration-name', 'Linear');
    await fill(fixture, element, 'integration-base-url', 'https://api.linear.app');
    await choose(fixture, element, 'integration-auth', 'header');
    await fill(fixture, element, 'integration-header', 'X-Api-Key');
    await choose(fixture, element, 'integration-credential', CREDENTIAL.id);
    await fill(fixture, element, 'integration-hosts', 'api.linear.app,\n api.github.com');
    await click(fixture, element, 'integration-save');

    expect(created).toEqual([
      {
        name: 'Linear',
        baseUrl: 'https://api.linear.app',
        auth: 'header',
        headerName: 'X-Api-Key',
        credentialId: CREDENTIAL.id,
        allowedHosts: ['api.linear.app', 'api.github.com'],
      },
    ]);
    expect(hook(element, 'integration-problem')).toBeNull();
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

function request(method: string, url: string): TestRequest {
  return TestBed.inject(HttpTestingController).expectOne({ method, url });
}

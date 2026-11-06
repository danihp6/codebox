import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nService } from '../../core/i18n/i18n.service';
import { CredentialsPage } from './credentials.page';
import type { Credential, Integration } from './credentials.api';
import { STRINGS, translate } from './i18n';

const TS = '2026-10-27T10:00:00Z';
const REQUEST_ID = 'req_01JABCDEFGHJKMNPQRSV';
const CREDENTIALS_URL = '/v1/credentials';
const INTEGRATIONS_URL = '/v1/integrations';
const COMPLETE_URL = '/v1/integrations/github/complete';
const SECRET = 'sk-sentinel-0123456789';

const MODEL_KEY = {
  id: 'cred_01JABCDEFG',
  name: 'OpenAI',
  kind: 'model_key',
  expose: 'env',
  configured: true,
  lastFour: 'abcd',
  createdAt: TS,
  updatedAt: TS,
  lastUsedAt: null,
} satisfies Credential;

const GITHUB_CREDENTIAL = {
  id: 'cred_01JABCDEFH',
  name: 'GitHub App 42',
  kind: 'github_app',
  expose: 'daemon',
  configured: true,
  lastFour: 'wxyz',
  createdAt: TS,
  updatedAt: TS,
  lastUsedAt: TS,
} satisfies Credential;

const INTEGRATION = {
  id: 'int_01JABCDEFG',
  name: 'Linear',
  baseUrl: 'https://api.linear.app',
  auth: 'bearer',
  headerName: null,
  credentialId: MODEL_KEY.id,
  allowedHosts: ['api.linear.app'],
  createdAt: TS,
  updatedAt: TS,
} satisfies Integration;

const FAILURE = {
  error: {
    code: 'internal',
    message: 'Boom',
    requestId: REQUEST_ID,
  },
};

const INVALID_STATE = {
  error: {
    code: 'validation_failed',
    message: 'The state is no longer valid',
    details: { reason: 'state_invalid' },
    requestId: REQUEST_ID,
  },
};

const USED_KEYS: readonly string[] = [
  'credentials.action.addOpen',
  'credentials.action.back',
  'credentials.action.cancel',
  'credentials.action.confirm',
  'credentials.action.connectService',
  'credentials.action.delete',
  'credentials.deleteConfirm',
  'credentials.empty',
  'credentials.error',
  'credentials.gh.configured',
  'credentials.gh.how',
  'credentials.gh.manage',
  'credentials.gh.missing',
  'credentials.group.open',
  'credentials.group.services',
  'credentials.loading',
  'credentials.retry',
  'credentials.section.open',
  'credentials.section.services',
  'credentials.service.how',
  'credentials.sub',
  'credentials.title',
  'credentials.writeOnly',
  'credentials.writeOnly.rotate',
];

interface MountOptions {
  readonly credentials?: readonly Credential[];
  readonly credentialsFail?: boolean;
  readonly integrations?: readonly Integration[];
  readonly reloadedCredentials?: readonly Credential[];
  readonly reloadedIntegrations?: readonly Integration[];
  readonly pending?: boolean;
  readonly query?: Readonly<Record<string, string>>;
  readonly completeFail?: boolean;
}

interface Mounted {
  readonly fixture: ComponentFixture<CredentialsPage>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
  readonly completeBody: unknown;
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function hookAll(element: HTMLElement, id: string): readonly HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
}

function flushCatalog(
  http: HttpTestingController,
  options: MountOptions,
  phase: 'initial' | 'reload' = 'initial',
): void {
  const credentials =
    (phase === 'reload' ? options.reloadedCredentials : undefined) ?? options.credentials ?? [];
  const integrations =
    (phase === 'reload' ? options.reloadedIntegrations : undefined) ?? options.integrations ?? [];
  if (options.credentialsFail === true && phase === 'initial') {
    http
      .expectOne(CREDENTIALS_URL)
      .flush(FAILURE, { status: 500, statusText: 'Internal Server Error' });
  } else {
    http.expectOne(CREDENTIALS_URL).flush({ data: [...credentials], nextCursor: null });
  }
  http.expectOne(INTEGRATIONS_URL).flush({ data: [...integrations], nextCursor: null });
}

async function mount(options: MountOptions = {}): Promise<Mounted> {
  const locale = signal<'en' | 'es'>('en');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: { locale } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { queryParamMap: convertToParamMap(options.query ?? {}) },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(CredentialsPage);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  const element = fixture.nativeElement as HTMLElement;
  let completeBody: unknown = null;

  if (options.pending !== true) {
    flushCatalog(http, options);
    if (options.query?.['code'] !== undefined && options.query['state'] !== undefined) {
      const complete = http.expectOne({ method: 'POST', url: COMPLETE_URL });
      completeBody = complete.request.body;
      if (options.completeFail === true) {
        complete.flush(INVALID_STATE, { status: 422, statusText: 'Unprocessable Entity' });
      } else {
        complete.flush({ configured: true, appId: 42, credentialId: GITHUB_CREDENTIAL.id });
        flushCatalog(http, options, 'reload');
      }
    }
    await fixture.whenStable();
    fixture.detectChanges();
  }

  return { fixture, element, http, completeBody };
}

describe('CredentialsPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the loading block until both reads settle', async () => {
    const { fixture, element, http } = await mount({ pending: true });

    expect(hook(element, 'credentials-loading')).not.toBeNull();

    flushCatalog(http, { credentials: [MODEL_KEY], integrations: [INTEGRATION] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(hook(element, 'credentials-loading')).toBeNull();
  });

  it('draws the frame header with the back link and the counted subtitle', async () => {
    const { element } = await mount({
      credentials: [MODEL_KEY, GITHUB_CREDENTIAL],
      integrations: [INTEGRATION],
    });

    const back = hook(element, 'credentials-back');
    expect(back?.getAttribute('href')).toBe('/settings');
    expect(back?.getAttribute('aria-label')).toBe(translate('en', 'credentials.action.back'));

    const sub = hook(element, 'credentials-sub');
    expect(sub?.getAttribute('data-count')).toBe('3');
    expect(sub?.textContent?.trim()).toBe(translate('en', 'credentials.sub'));
  });

  it('draws the two groups in frame order', async () => {
    const { element } = await mount({ credentials: [MODEL_KEY], integrations: [INTEGRATION] });

    const groups = hookAll(element, 'credentials-group').map((group) =>
      group.getAttribute('data-group'),
    );
    expect(groups).toEqual(['services', 'open']);
    expect(hook(element, 'credentials-services')?.tagName).toBe('UL');
    for (const group of hookAll(element, 'credentials-group')) {
      expect(group.textContent?.trim()).toBe(
        translate('en', `credentials.group.${group.getAttribute('data-group') ?? ''}`),
      );
    }
  });

  it('draws the GitHub App credential as the first service card, never as an open row', async () => {
    const { fixture, element } = await mount({
      credentials: [GITHUB_CREDENTIAL, MODEL_KEY],
      integrations: [INTEGRATION],
    });

    const gh = hook(element, 'credentials-gh');
    expect(gh).not.toBeNull();
    expect(gh?.getAttribute('data-credential-id')).toBe(GITHUB_CREDENTIAL.id);
    expect(hook(element, 'credentials-gh-name')?.textContent?.trim()).toBe(GITHUB_CREDENTIAL.name);
    expect(hook(element, 'credentials-gh-state')?.getAttribute('data-configured')).toBe('true');
    expect(hook(element, 'credentials-gh-state')?.textContent).toContain(
      translate('en', 'credentials.gh.configured'),
    );
    expect(hook(element, 'credentials-gh-dot')).not.toBeNull();
    expect(hook(element, 'credentials-gh-how')?.textContent?.trim()).toBe(
      translate('en', 'credentials.gh.how'),
    );
    expect(hook(element, 'credentials-gh-manage')?.textContent?.trim()).toBe(
      translate('en', 'credentials.gh.manage'),
    );

    const open = hookAll(element, 'credentials-open-row').map((row) =>
      row.getAttribute('data-credential-id'),
    );
    expect(open).toEqual([MODEL_KEY.id]);

    expect(hook(element, 'connect-service-sheet')).toBeNull();
    hook(element, 'credentials-gh-manage')?.click();
    await wait(fixture);
    expect(hook(element, 'connect-service-sheet')).not.toBeNull();
  });

  it('keeps the services section when there is no GitHub App credential', async () => {
    const { element } = await mount({ credentials: [MODEL_KEY], integrations: [INTEGRATION] });

    expect(hook(element, 'credentials-gh')).toBeNull();
    expect(hook(element, 'credentials-section-services')).not.toBeNull();
    expect(hookAll(element, 'credentials-service-row')).toHaveLength(1);
  });

  it('renders the services and the open credentials with their chips', async () => {
    const { element } = await mount({
      credentials: [MODEL_KEY, GITHUB_CREDENTIAL],
      integrations: [INTEGRATION],
    });

    expect(hook(element, 'credentials-section-services')).not.toBeNull();
    expect(hook(element, 'credentials-section-open')).not.toBeNull();

    const services = hookAll(element, 'credentials-service-row');
    expect(services).toHaveLength(1);
    expect(services[0]?.getAttribute('data-service-id')).toBe(INTEGRATION.id);
    expect(services[0]?.textContent).toContain(INTEGRATION.name);
    expect(services[0]?.textContent).toContain(INTEGRATION.auth);
    expect(hook(element, 'credentials-service-how')?.textContent).toContain(INTEGRATION.baseUrl);

    const open = hookAll(element, 'credentials-open-row');
    expect(open).toHaveLength(1);
    expect(open[0]?.getAttribute('data-credential-id')).toBe(MODEL_KEY.id);
    expect(open[0]?.textContent).toContain(MODEL_KEY.name);
    expect(open[0]?.textContent).toContain(MODEL_KEY.kind);
    expect(open[0]?.textContent).toContain(MODEL_KEY.expose);
    expect(hook(element, 'credentials-open-kind')?.textContent?.trim()).toBe(MODEL_KEY.kind);
    expect(hook(element, 'credentials-open-expose')?.textContent?.trim()).toBe(MODEL_KEY.expose);
    expect(hook(element, 'credentials-open-expose')?.getAttribute('data-expose')).toBe(
      MODEL_KEY.expose,
    );
    expect(hook(element, 'credentials-last-four')?.textContent?.trim()).toBe('••••abcd');
    expect(element.innerHTML).not.toContain(SECRET);
    expect(hook(element, 'credentials-empty')).toBeNull();
  });

  it('draws the open row meta and the two write-only notes', async () => {
    const { element } = await mount({ credentials: [MODEL_KEY], integrations: [] });

    const meta = hook(element, 'credentials-open-meta');
    expect(meta?.textContent).toContain('••••abcd');
    expect(meta?.textContent).toContain(MODEL_KEY.expose);

    const notes = hookAll(element, 'credentials-note');
    expect(notes.map((note) => note.getAttribute('data-note'))).toEqual(['1', '2']);
    expect(notes[0]?.textContent?.trim()).toBe(translate('en', 'credentials.writeOnly'));
    expect(notes[1]?.textContent?.trim()).toBe(translate('en', 'credentials.writeOnly.rotate'));
  });

  it('never renders a value the boundary does not admit', async () => {
    const leaky = { ...MODEL_KEY, value: SECRET } as unknown as Credential;
    const { element } = await mount({ credentials: [leaky], integrations: [INTEGRATION] });

    expect(element.innerHTML).not.toContain(SECRET);
    expect(hook(element, 'credentials-open-row')).toBeNull();
    expect(hook(element, 'credentials-error')?.getAttribute('data-code')).toBe('contract');
    expect(hook(element, 'credentials-service-row')).not.toBeNull();
    expect(element.querySelectorAll('[data-value]')).toHaveLength(0);
  });

  it('renders the empty state when both lists are empty', async () => {
    const { element } = await mount();

    expect(hook(element, 'credentials-empty')).not.toBeNull();
    expect(hook(element, 'credentials-open-row')).toBeNull();
    expect(hook(element, 'credentials-service-row')).toBeNull();
    expect(hook(element, 'credentials-gh')).toBeNull();
  });

  it('renders the error code and keeps the integrations when the credential read fails', async () => {
    const { element } = await mount({ credentialsFail: true, integrations: [INTEGRATION] });

    expect(hook(element, 'credentials-error')?.getAttribute('data-code')).toBe('internal');
    expect(hook(element, 'credentials-retry')).not.toBeNull();
    const services = hookAll(element, 'credentials-service-row');
    expect(services).toHaveLength(1);
    expect(services[0]?.getAttribute('data-service-id')).toBe(INTEGRATION.id);
    expect(hook(element, 'credentials-open-row')).toBeNull();
  });

  it('opens the connect sheet and the add sheet from their triggers', async () => {
    const { fixture, element } = await mount();

    expect(hook(element, 'connect-service-sheet')).toBeNull();
    expect(hook(element, 'add-credential-sheet')).toBeNull();

    hook(element, 'credentials-connect-service')?.click();
    await wait(fixture);
    expect(hook(element, 'connect-service-sheet')).not.toBeNull();
    expect(hook(element, 'add-credential-sheet')).toBeNull();

    hook(element, 'credentials-add-open')?.click();
    await wait(fixture);
    expect(hook(element, 'add-credential-sheet')).not.toBeNull();
  });

  it('creates a credential through the add sheet without touching the value', async () => {
    const { fixture, element, http } = await mount({ credentials: [], integrations: [] });

    hook(element, 'credentials-add-open')?.click();
    await wait(fixture);

    await fillField(fixture, element, 'credential-name', 'Anthropic');
    await fillField(fixture, element, 'credential-value', SECRET);
    expect(element.innerHTML).not.toContain(SECRET);

    hook(element, 'credential-continue')?.click();
    await wait(fixture);

    hook(element, 'credential-save')?.click();
    await wait(fixture);

    const create = http.expectOne({ method: 'POST', url: CREDENTIALS_URL });
    expect(create.request.body).toEqual({
      name: 'Anthropic',
      kind: 'api_key',
      expose: 'daemon',
      value: SECRET,
    });
    create.flush(MODEL_KEY);

    flushCatalog(http, { credentials: [MODEL_KEY], integrations: [] });
    await wait(fixture);

    expect(hook(element, 'add-credential-sheet')).toBeNull();
    expect(hookAll(element, 'credentials-open-row')).toHaveLength(1);
    expect(element.innerHTML).not.toContain(SECRET);
  });

  it('asks twice before deleting a credential', async () => {
    const { fixture, element, http } = await mount({
      credentials: [MODEL_KEY],
      integrations: [INTEGRATION],
    });

    expect(hook(element, 'credential-delete-confirm')).toBeNull();

    hook(element, 'credential-delete')?.click();
    await wait(fixture);

    expect(hook(element, 'credential-delete-confirm')).not.toBeNull();
    http.expectNone({ method: 'DELETE', url: `${CREDENTIALS_URL}/${MODEL_KEY.id}` });

    hook(element, 'credential-delete-confirm')?.click();
    await wait(fixture);

    const remove = http.expectOne({ method: 'DELETE', url: `${CREDENTIALS_URL}/${MODEL_KEY.id}` });
    remove.flush(null, { status: 204, statusText: 'No Content' });

    flushCatalog(http, { credentials: [], integrations: [INTEGRATION] });
    await wait(fixture);

    expect(hook(element, 'credentials-open-row')).toBeNull();
    expect(hook(element, 'credentials-service-row')).not.toBeNull();
  });

  it('completes the GitHub manifest flow from the query and reloads the catalog', async () => {
    const { element, http, completeBody } = await mount({
      query: { code: 'code_01', state: 'st_01JABCDEFG' },
      credentials: [],
      reloadedCredentials: [MODEL_KEY],
    });

    expect(completeBody).toEqual({ code: 'code_01', state: 'st_01JABCDEFG' });
    const open = hookAll(element, 'credentials-open-row');
    expect(open).toHaveLength(1);
    expect(open[0]?.getAttribute('data-credential-id')).toBe(MODEL_KEY.id);
    expect(hook(element, 'credentials-error')).toBeNull();
    http.expectNone({ method: 'POST', url: COMPLETE_URL });
  });

  it('sets the page error when the manifest completion is rejected', async () => {
    const { element } = await mount({
      query: { code: 'code_01', state: 'st_01JABCDEFG' },
      completeFail: true,
      credentials: [],
      integrations: [],
    });

    expect(hook(element, 'credentials-error')?.getAttribute('data-code')).toBe('validation_failed');
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
    for (const key of [
      'credentials.sub',
      'credentials.group.services',
      'credentials.group.open',
      'credentials.gh.how',
      'credentials.gh.manage',
      'credentials.gh.configured',
      'credentials.gh.missing',
      'credentials.service.how',
      'credentials.writeOnly',
      'credentials.writeOnly.rotate',
    ]) {
      expect(translate('en', key), key).not.toBe(key);
      expect(translate('es', key), key).not.toBe(key);
    }
  });
});

async function wait(fixture: ComponentFixture<CredentialsPage>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

async function fillField(
  fixture: ComponentFixture<CredentialsPage>,
  element: HTMLElement,
  id: string,
  value: string,
): Promise<void> {
  const field = hook(element, id);
  if (!(field instanceof HTMLInputElement)) throw new Error(`${id} is not an input`);
  field.value = value;
  field.dispatchEvent(new Event('input'));
  await wait(fixture);
}

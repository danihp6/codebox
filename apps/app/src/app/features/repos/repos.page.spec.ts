import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Repo, RepoVerify } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { SecureStore } from '../../core/auth/secure-store';
import { STRINGS, translate } from './i18n';
import { ReposPage } from './repos.page';

const REPO: Repo = {
  id: 'repo_01JABCDEFGHJKMNPQRSV',
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm ci && npm test && npm run build',
  policy: 'auto',
  protectedPaths: ['.github/**'],
  enabled: true,
  createdAt: '2026-10-24T18:03:11Z',
};

const VERIFY: RepoVerify = {
  ok: true,
  defaultBranch: 'main',
  canPush: true,
  checks: [
    { name: 'token', state: 'ok' },
    { name: 'push', state: 'ok' },
    { name: 'branch', state: 'ok' },
  ],
};

const LIST_URL = '/v1/repos';
const CREATE_URL = '/v1/repos';
const VERIFY_URL = `/v1/repos/${REPO.id}/verify`;

const USED_KEYS: readonly string[] = [
  'common.loading',
  'common.error',
  'repos.title',
  'repos.section.list',
  'repos.section.add',
  'repos.empty',
  'repos.action.retry',
  'repos.action.create',
  'repos.action.verify',
  'repos.field.slug',
  'repos.field.defaultBranch',
  'repos.field.gate',
  'repos.field.protectedPaths',
  'repos.error.slug',
  'repos.error.defaultBranch',
  'repos.error.gate',
  'repos.policy.auto',
  'repos.policy.manual',
  'repos.verify.title',
  'repos.verify.ok',
  'repos.verify.ko',
  'repos.verify.canPush',
  'repos.verify.noPush',
  'repos.verify.defaultBranch',
  'repos.verify.error',
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
  readonly fixture: ComponentFixture<ReposPage>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
}

async function mount(repos: readonly Repo[] = []): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SECURE_STORE, useValue: memoryStore() },
    ],
  });
  const fixture = TestBed.createComponent(ReposPage);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(LIST_URL).flush({ data: [...repos], nextCursor: null });
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, http };
}

function typeInto(fixture: ComponentFixture<ReposPage>, element: HTMLElement, id: string, value: string): Promise<void> {
  const field = hook(element, id);
  if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) {
    throw new Error(`field ${id} is missing`);
  }
  field.value = value;
  field.dispatchEvent(new Event('input'));
  return fixture.whenStable();
}

describe('ReposPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('lists the registered repositories', async () => {
    const { element } = await mount([REPO]);

    const row = hook(element, 'repo-row');
    expect(row?.getAttribute('data-repo-id')).toBe(REPO.id);
    expect(row?.textContent).toContain('acme/widgets');
    expect(hook(element, 'repos-empty')).toBeNull();
    expect(hook(element, `repo-link-${REPO.id}`)?.getAttribute('href')).toBe(`/repos/${REPO.id}`);
  });

  it('renders the empty state when no repository is registered', async () => {
    const { element } = await mount([]);

    expect(hook(element, 'repos-empty')).not.toBeNull();
    expect(hook(element, 'repo-row')).toBeNull();
  });

  it('refuses to submit a slug without owner/name and sends nothing', async () => {
    const { fixture, element, http } = await mount();

    await typeInto(fixture, element, 'repo-slug', 'widgets');
    hook(element, 'repo-submit')?.click();
    await fixture.whenStable();

    expect(hook(element, 'repo-slug-error')).not.toBeNull();
    http.expectNone({ method: 'POST', url: CREATE_URL });
  });

  it('creates the repository and shows the verification without a reload', async () => {
    const { fixture, element, http } = await mount();

    await typeInto(fixture, element, 'repo-slug', 'acme/widgets');
    await typeInto(fixture, element, 'repo-protected-paths', '.github/**\nops/**');
    hook(element, 'repo-submit')?.click();
    await fixture.whenStable();

    expect(hook(element, 'repo-slug-error')).toBeNull();
    const create = http.expectOne({ method: 'POST', url: CREATE_URL });
    expect(create.request.body).toEqual({
      slug: 'acme/widgets',
      defaultBranch: 'main',
      gate: 'npm ci && npm test && npm run build',
      protectedPaths: ['.github/**', 'ops/**'],
    });
    create.flush(REPO, { status: 201, statusText: 'Created' });
    await fixture.whenStable();

    expect(hook(element, 'repo-row')?.getAttribute('data-repo-id')).toBe(REPO.id);

    http.expectOne({ method: 'POST', url: VERIFY_URL }).flush(VERIFY);
    await fixture.whenStable();

    const card = hook(element, 'repo-verify');
    expect(card?.getAttribute('data-ok')).toBe('true');
    expect(card?.getAttribute('data-can-push')).toBe('true');
    const checks = element.querySelectorAll<HTMLElement>('[data-testid="repo-check"]');
    expect(checks).toHaveLength(VERIFY.checks.length);
    expect(checks[0]?.getAttribute('data-name')).toBe('token');
    expect(checks[0]?.getAttribute('data-state')).toBe('ok');
    http.expectNone(LIST_URL);
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

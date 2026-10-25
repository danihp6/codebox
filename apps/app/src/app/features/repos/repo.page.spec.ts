import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Repo, RepoDetail } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { SecureStore } from '../../core/auth/secure-store';
import { STRINGS, translate } from './i18n';
import { RepoPage } from './repo.page';

const ROUTE_ID = 'repo_x';

const REPO: Repo = {
  id: 'repo_01JABCDEFGHJKMNPQRSV',
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm ci && npm test',
  policy: 'auto',
  protectedPaths: ['.github/**', 'ops/**'],
  enabled: true,
  createdAt: '2026-10-24T18:03:11Z',
};

const DETAIL: RepoDetail = { ...REPO, lastRun: null };

const GET_URL = `/v1/repos/${ROUTE_ID}`;
const PATCH_URL = `/v1/repos/${ROUTE_ID}`;
const VERIFY_URL = `/v1/repos/${ROUTE_ID}/verify`;

const USED_KEYS: readonly string[] = [
  'common.loading',
  'common.error',
  'repos.detail.title',
  'repos.detail.policy',
  'repos.detail.gate',
  'repos.detail.protectedPaths',
  'repos.detail.preview',
  'repos.detail.enabled',
  'repos.detail.disabled',
  'repos.detail.lastRun',
  'repos.detail.noRun',
  'repos.action.retry',
  'repos.action.save',
  'repos.action.verify',
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

function envelope(code: string): Record<string, unknown> {
  return { error: { code, message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function field(element: HTMLElement, id: string): HTMLInputElement | HTMLTextAreaElement {
  const target = hook(element, id);
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target;
  throw new Error(`field ${id} is missing`);
}

interface Mounted {
  readonly fixture: ComponentFixture<RepoPage>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
}

async function mount(detail: RepoDetail = DETAIL): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SECURE_STORE, useValue: memoryStore() },
    ],
  });
  const fixture = TestBed.createComponent(RepoPage);
  fixture.componentRef.setInput('id', ROUTE_ID);
  fixture.detectChanges();
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(GET_URL).flush(detail);
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, http };
}

describe('RepoPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the repository, the gate and the protected paths', async () => {
    const { element } = await mount();

    expect(hook(element, 'page-repo')?.getAttribute('data-repo-id')).toBe(ROUTE_ID);
    expect(hook(element, 'repo-slug-value')?.textContent).toContain('acme/widgets');
    expect(hook(element, 'repo-default-branch')?.textContent).toContain('main');
    expect(hook(element, 'repo-enabled')?.getAttribute('data-enabled')).toBe('true');
    expect(hook(element, 'repo-policy-current')?.getAttribute('data-policy')).toBe('auto');
    expect(field(element, 'repo-gate-input').value).toBe('npm ci && npm test');
    expect(field(element, 'repo-protected-paths').value).toBe('.github/**\nops/**');
    expect(hook(element, 'repo-last-run-empty')).not.toBeNull();
    expect(hook(element, 'repo-loading')).toBeNull();
    expect(hook(element, 'repo-error')).toBeNull();
  });

  it('flips the policy before the patch resolves', async () => {
    const { fixture, element, http } = await mount();

    hook(element, 'repo-policy-manual')?.click();
    await fixture.whenStable();

    expect(hook(element, 'repo-policy-current')?.getAttribute('data-policy')).toBe('manual');
    const patch = http.expectOne({ method: 'PATCH', url: PATCH_URL });
    expect(patch.request.body).toEqual({ policy: 'manual' });
    patch.flush({ ...REPO, policy: 'manual' });
    await fixture.whenStable();

    expect(hook(element, 'repo-policy-current')?.getAttribute('data-policy')).toBe('manual');
    expect(hook(element, 'repo-error')).toBeNull();
  });

  it('rolls the policy back when the patch fails', async () => {
    const { fixture, element, http } = await mount();

    hook(element, 'repo-policy-manual')?.click();
    await fixture.whenStable();
    http
      .expectOne({ method: 'PATCH', url: PATCH_URL })
      .flush(envelope('conflict'), { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();

    expect(hook(element, 'repo-policy-current')?.getAttribute('data-policy')).toBe('auto');
    expect(hook(element, 'repo-error')?.getAttribute('data-code')).toBe('conflict');
  });

  it('previews exactly the array the patch will send', async () => {
    const { fixture, element, http } = await mount();

    expect(hook(element, 'protected-paths-preview')?.textContent).toBe(
      '[".github/**","ops/**"]',
    );

    const paths = field(element, 'repo-protected-paths');
    paths.value = '.github/**\n  ops/**  \n\ninfra/**';
    paths.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(hook(element, 'protected-paths-preview')?.textContent).toBe(
      '[".github/**","ops/**","infra/**"]',
    );

    hook(element, 'repo-protected-paths-save')?.click();
    await fixture.whenStable();

    const patch = http.expectOne({ method: 'PATCH', url: PATCH_URL });
    expect(patch.request.body).toEqual({
      protectedPaths: ['.github/**', 'ops/**', 'infra/**'],
    });
    patch.flush({ ...REPO, protectedPaths: ['.github/**', 'ops/**', 'infra/**'] });
    await fixture.whenStable();

    expect(hook(element, 'protected-paths-preview')?.textContent).toBe(
      '[".github/**","ops/**","infra/**"]',
    );
  });

  it('saves the gate', async () => {
    const { fixture, element, http } = await mount();

    const gate = field(element, 'repo-gate-input');
    gate.value = 'npm test';
    gate.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    hook(element, 'repo-gate-save')?.click();
    await fixture.whenStable();

    const patch = http.expectOne({ method: 'PATCH', url: PATCH_URL });
    expect(patch.request.body).toEqual({ gate: 'npm test' });
    patch.flush({ ...REPO, gate: 'npm test' });
    await fixture.whenStable();

    expect(field(element, 'repo-gate-input').value).toBe('npm test');
    expect(hook(element, 'repo-error')).toBeNull();
  });

  it('verifies the repository', async () => {
    const { fixture, element, http } = await mount();

    hook(element, 'repo-verify-action')?.click();
    await fixture.whenStable();
    http.expectOne({ method: 'POST', url: VERIFY_URL }).flush({
      ok: true,
      defaultBranch: 'main',
      canPush: true,
      checks: [{ name: 'token', state: 'ok' }],
    });
    await fixture.whenStable();

    expect(hook(element, 'repo-verify')?.getAttribute('data-ok')).toBe('true');
    expect(element.querySelectorAll('[data-testid="repo-check"]')).toHaveLength(1);
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

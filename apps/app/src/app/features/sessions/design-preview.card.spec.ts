import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import type { DesignPreview } from '@codebox/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nService } from '../../core/i18n/i18n.service';
import { DesignPreviewCard } from './design-preview.card';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const REVISION = '9f1c2ab';
const DESIGN_URL = `/v1/repos/${REPO_ID}/design`;
const PENDING_URL = `${DESIGN_URL}?revision=${REVISION}`;

const PREVIEW: DesignPreview = {
  repoId: REPO_ID,
  revision: REVISION,
  present: true,
  tokens: [{ name: 'color.brand.bright', type: 'color', value: '#22c55e' }],
  routes: [{ path: '/repos/:id', screen: 'Repo · backlog', component: 'RepoBacklogPage' }],
  screens: [
    {
      screen: 'Repo · backlog',
      route: '/repos/:id',
      states: { loading: '22', empty: null, error: '22b' },
      snapshotSha256: null,
    },
  ],
  findings: [],
  checkedAt: '2026-10-29T10:00:00Z',
};

const i18nStub = { locale: () => 'en' as const };

interface Mounted {
  readonly fixture: ComponentFixture<DesignPreviewCard>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
}

async function mount(revision: string | null): Promise<Mounted> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: i18nStub },
    ],
  });
  const fixture = TestBed.createComponent(DesignPreviewCard);
  fixture.componentRef.setInput('repoId', REPO_ID);
  fixture.componentRef.setInput('revision', revision);
  await fixture.whenStable();
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
  };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function hooks(element: HTMLElement, id: string): readonly HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
}

describe('DesignPreviewCard', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the loaded commit, the collections and three states per screen', async () => {
    const { fixture, element, http } = await mount(REVISION);
    http.expectOne(PENDING_URL).flush(PREVIEW);
    await fixture.whenStable();

    expect(hook(element, 'design-preview-loading')).toBeNull();
    expect(hook(element, 'design-preview')?.getAttribute('data-revision')).toBe(REVISION);
    expect(hook(element, 'design-preview')?.getAttribute('data-present')).toBe('true');
    expect(hook(element, 'design-preview-revision')?.getAttribute('data-sha')).toBe(REVISION);

    expect(hooks(element, 'design-preview-token')).toHaveLength(1);
    expect(hook(element, 'design-preview-token')?.getAttribute('data-name')).toBe(
      'color.brand.bright',
    );
    expect(hooks(element, 'design-preview-route')).toHaveLength(1);
    expect(hook(element, 'design-preview-route')?.getAttribute('data-path')).toBe('/repos/:id');
    expect(hook(element, 'design-preview-route')?.getAttribute('data-component')).toBe(
      'RepoBacklogPage',
    );
    expect(
      hooks(element, 'design-preview-count').map((node) => node.getAttribute('data-kind')),
    ).toEqual(['tokens', 'routes', 'screens']);

    expect(hooks(element, 'design-preview-screen')).toHaveLength(1);
    expect(hook(element, 'design-preview-screen')?.getAttribute('data-screen')).toBe(
      'Repo · backlog',
    );
    const states = hooks(element, 'design-preview-state');
    expect(states).toHaveLength(3);
    expect(states.map((node) => node.getAttribute('data-state'))).toEqual([
      'loading',
      'empty',
      'error',
    ]);
    expect(states.map((node) => node.getAttribute('data-declared'))).toEqual([
      'true',
      'false',
      'true',
    ]);
  });

  it('shows the pending line only when the commit is not the branch head', async () => {
    const pending = await mount(REVISION);
    pending.http.expectOne(PENDING_URL).flush(PREVIEW);
    await pending.fixture.whenStable();
    expect(hook(pending.element, 'design-preview-pending')).not.toBeNull();

    const head = await mount(null);
    head.http.expectOne(DESIGN_URL).flush({ ...PREVIEW, revision: '4d2e0aa' });
    await head.fixture.whenStable();
    expect(hook(head.element, 'design-preview-pending')).toBeNull();
    expect(hook(head.element, 'design-preview-revision')?.getAttribute('data-sha')).toBe('4d2e0aa');
  });

  it('says the repository has no design instead of drawing a guess', async () => {
    const { fixture, element, http } = await mount(null);
    http.expectOne(DESIGN_URL).flush({
      ...PREVIEW,
      present: false,
      tokens: [],
      routes: [],
      screens: [],
      findings: [],
    });
    await fixture.whenStable();

    expect(hook(element, 'design-preview')?.getAttribute('data-present')).toBe('false');
    expect(hook(element, 'design-preview-revision')).not.toBeNull();
    expect(hook(element, 'design-preview-unavailable')).not.toBeNull();
    expect(hook(element, 'design-preview-clean')).toBeNull();
    expect(hooks(element, 'design-preview-token')).toEqual([]);
    expect(hooks(element, 'design-preview-route')).toEqual([]);
    expect(hooks(element, 'design-preview-screen')).toEqual([]);
    expect(hooks(element, 'design-preview-finding')).toEqual([]);
  });

  it('names the refusal and retries the same URL', async () => {
    const { fixture, element, http } = await mount(REVISION);
    http
      .expectOne(PENDING_URL)
      .flush(
        { error: { code: 'validation_failed', message: 'Invalid request' } },
        { status: 422, statusText: 'Unprocessable Content' },
      );
    await fixture.whenStable();

    expect(hook(element, 'design-preview-error')?.getAttribute('data-code')).toBe(
      'validation_failed',
    );
    expect(hook(element, 'design-preview')?.getAttribute('data-revision')).toBe('');

    hook(element, 'design-preview-retry')?.click();
    await fixture.whenStable();
    http.expectOne(PENDING_URL).flush(PREVIEW);
    await fixture.whenStable();

    expect(hook(element, 'design-preview-error')).toBeNull();
    expect(hook(element, 'design-preview-revision')?.getAttribute('data-sha')).toBe(REVISION);
  });

  it('renders a clean check and then each finding with its row', async () => {
    const clean = await mount(null);
    clean.http.expectOne(DESIGN_URL).flush(PREVIEW);
    await clean.fixture.whenStable();
    expect(hook(clean.element, 'design-preview-clean')).not.toBeNull();
    expect(hooks(clean.element, 'design-preview-finding')).toEqual([]);

    const found = await mount(null);
    found.http.expectOne(DESIGN_URL).flush({
      ...PREVIEW,
      findings: [
        {
          file: 'design/screens/repo-backlog.json',
          line: 1,
          rule: 'screen_state_missing',
          message: 'screen Repo · backlog has no empty state',
        },
      ],
    });
    await found.fixture.whenStable();

    expect(hook(found.element, 'design-preview-clean')).toBeNull();
    const finding = hook(found.element, 'design-preview-finding');
    expect(finding?.getAttribute('data-rule')).toBe('screen_state_missing');
    expect(finding?.getAttribute('data-file')).toBe('design/screens/repo-backlog.json');
    expect(finding?.getAttribute('data-line')).toBe('1');
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Work } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nService } from '../../core/i18n/i18n.service';
import { RepoWorksPage } from './repo-works.page';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const LIST_URL = `/v1/works?repoId=${REPO_ID}`;

function workAt(index: number, state: Work['state']): Work {
  return {
    id: `wrk_01JABCDEF${String(index).padStart(2, '0')}`,
    repoId: REPO_ID,
    backlogRef: `Task-${70 + index}`,
    title: `Work ${index}`,
    prompt: 'Do the thing.',
    specSha: '9f1c2ab',
    state,
    origin: 'backlog',
    attempts: index,
    maxAttempts: 2,
    usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
    contextTokens: 0,
    contextEpoch: 1,
    reviewedAt: null,
    createdAt: '2026-10-28T09:12:00Z',
    updatedAt: '2026-10-28T09:12:00Z',
  };
}

const i18nStub = { locale: () => 'en' as const };

interface Mounted {
  readonly fixture: ComponentFixture<RepoWorksPage>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
}

async function mount(works: readonly Work[]): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: i18nStub },
    ],
  });
  const fixture = TestBed.createComponent(RepoWorksPage);
  fixture.componentRef.setInput('id', REPO_ID);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(LIST_URL).flush({ data: [...works], nextCursor: null });
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, http };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

describe('RepoWorksPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('lists the works flat, in the order the daemon answered', async () => {
    const newest = workAt(2, 'running');
    const oldest = workAt(1, 'merged');
    const { element } = await mount([newest, oldest]);

    const rows = [...element.querySelectorAll<HTMLElement>('[data-testid="repo-work-row"]')];
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.getAttribute('data-work-id'))).toEqual([newest.id, oldest.id]);
    expect(rows.map((row) => row.getAttribute('data-state'))).toEqual(['running', 'merged']);
    expect(rows[0]?.textContent).toContain('Task-72');
    expect(rows[0]?.textContent).toContain('Work 2');
    expect(hook(element, `repo-work-link-${newest.id}`)?.getAttribute('href')).toBe(
      `/works/${newest.id}`,
    );
  });

  it('renders the empty state', async () => {
    const { element } = await mount([]);

    expect(hook(element, 'repo-works-empty')).not.toBeNull();
    expect(hook(element, 'repo-work-row')).toBeNull();
  });

  it('renders the error with its code and retries', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: I18nService, useValue: i18nStub },
      ],
    });
    const fixture = TestBed.createComponent(RepoWorksPage);
    fixture.componentRef.setInput('id', REPO_ID);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne(LIST_URL)
      .flush(
        { error: { code: 'agent_unavailable', message: 'Down' } },
        { status: 502, statusText: 'Bad Gateway' },
      );
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(hook(element, 'repo-works-error')?.getAttribute('data-code')).toBe('agent_unavailable');

    hook(element, 'repo-works-retry')?.click();
    await fixture.whenStable();
    http.expectOne(LIST_URL).flush({ data: [workAt(1, 'queued')], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'repo-work-row')).not.toBeNull();
    expect(hook(element, 'repo-works-error')).toBeNull();
  });
});

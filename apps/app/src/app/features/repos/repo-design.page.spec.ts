import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { Session } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { I18nService } from '../../core/i18n/i18n.service';
import { REPO_TABS } from './repo-tabs';
import { RepoDesignPage } from './repo-design.page';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';

const SESSION: Session = {
  id: 'sess_01JABCDEFGHJK',
  repoId: REPO_ID,
  target: 'design',
  workId: null,
  title: 'Edit the design tokens',
  status: 'idle',
  branch: 'cb/design-edit',
  pendingProposal: null,
  usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
  contextTokens: 0,
  contextEpoch: 1,
  createdAt: '2026-10-28T09:12:00Z',
  updatedAt: '2026-10-28T09:12:00Z',
  lastMessage: null,
};

const i18nStub = { locale: () => 'en' as const };

interface Mounted {
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
  readonly fixture: ComponentFixture<RepoDesignPage>;
  readonly navigate: MockInstance<typeof Router.prototype.navigate>;
}

async function mount(): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: i18nStub },
    ],
  });
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(RepoDesignPage);
  fixture.componentRef.setInput('id', REPO_ID);
  await fixture.whenStable();
  return {
    element: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
    fixture,
    navigate,
  };
}

describe('RepoDesignPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the four tabs and an honest unavailable block, calling no API', async () => {
    const { element, http } = await mount();

    expect(element.querySelector('[data-testid="page-repo-design"]')).not.toBeNull();
    expect(element.querySelectorAll('[data-testid^="repo-tab-"]')).toHaveLength(REPO_TABS.length);
    expect(
      element.querySelector('[data-testid="repo-design-unavailable"]')?.textContent?.trim(),
    ).not.toBe('');
    http.expectNone(() => true);
  });

  it('opens the new-session sheet with the design target chosen and creates once', async () => {
    const { element, http, fixture, navigate } = await mount();

    (element.querySelector('[data-testid="repo-design-new-session"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(element.querySelector('[data-testid="new-session-sheet"]')).not.toBeNull();
    const design = element.querySelector<HTMLButtonElement>(
      '[data-testid="new-session-target-design"]',
    );
    expect(design?.getAttribute('data-selected')).toBe('true');
    http.expectNone(() => true);

    (element.querySelector('[data-testid="new-session-create"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    const create = http.expectOne({ method: 'POST', url: '/v1/sessions' });
    expect(create.request.body).toEqual({ repoId: REPO_ID, target: 'design' });
    create.flush(SESSION, { status: 201, statusText: 'Created' });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/sessions', SESSION.id]);
    expect(element.querySelector('[data-testid="new-session-sheet"]')).toBeNull();
  });
});

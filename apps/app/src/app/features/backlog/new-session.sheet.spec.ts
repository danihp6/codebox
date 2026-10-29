import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import type { Session } from '@codebox/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nService } from '../../core/i18n/i18n.service';
import { NewSessionSheet } from './new-session.sheet';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';

const SESSION: Session = {
  id: 'sess_01JABCDEFGHJK',
  repoId: REPO_ID,
  target: 'backlog',
  workId: null,
  title: 'Edit the backlog',
  status: 'idle',
  branch: 'cb/backlog-edit',
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
  readonly fixture: ComponentFixture<NewSessionSheet>;
  readonly created: Session[];
  readonly cancelled: boolean[];
}

async function mount(): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: i18nStub },
    ],
  });
  const fixture = TestBed.createComponent(NewSessionSheet);
  fixture.componentRef.setInput('repoId', REPO_ID);
  const created: Session[] = [];
  const cancelled: boolean[] = [];
  fixture.componentInstance.created.subscribe((session) => created.push(session));
  fixture.componentInstance.cancelled.subscribe(() => cancelled.push(true));
  await fixture.whenStable();
  return {
    element: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
    fixture,
    created,
    cancelled,
  };
}

function button(element: HTMLElement, id: string): HTMLButtonElement {
  const found = element.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  if (found === null) throw new Error(`button ${id} is missing`);
  return found;
}

describe('NewSessionSheet', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('offers three targets and one read-only entry, and sends nothing on render', async () => {
    const { element, http, created } = await mount();

    expect(element.querySelector('[data-testid="new-session-sheet"]')).not.toBeNull();
    const targets = [...element.querySelectorAll('[data-testid^="new-session-target-"]')];
    expect(targets).toHaveLength(4);
    expect(targets.map((node) => node.getAttribute('data-testid'))).toEqual([
      'new-session-target-backlog',
      'new-session-target-design',
      'new-session-target-schedule',
      'new-session-target-repo',
    ]);
    expect(button(element, 'new-session-create').disabled).toBe(true);
    http.expectNone(() => true);
    expect(created).toEqual([]);
  });

  it('posts exactly one session body per Create tap and never a workId', async () => {
    const { element, http, fixture, created } = await mount();

    button(element, 'new-session-target-backlog').click();
    await fixture.whenStable();
    http.expectNone(() => true);

    button(element, 'new-session-create').click();
    button(element, 'new-session-create').click();
    await fixture.whenStable();

    const request = http.expectOne({ method: 'POST', url: '/v1/sessions' });
    expect(request.request.body).toEqual({ repoId: REPO_ID, target: 'backlog' });
    expect(Object.keys(request.request.body as Record<string, unknown>)).not.toContain('workId');
    request.flush(SESSION, { status: 201, statusText: 'Created' });
    await fixture.whenStable();

    expect(created).toEqual([SESSION]);
    http.expectNone(() => true);
  });

  it('creates a read-only repo session with no work id either', async () => {
    const { element, http, fixture } = await mount();

    button(element, 'new-session-target-repo').click();
    await fixture.whenStable();
    expect(element.querySelector('[data-testid="new-session-read-only"]')).not.toBeNull();

    button(element, 'new-session-create').click();
    await fixture.whenStable();

    const request = http.expectOne({ method: 'POST', url: '/v1/sessions' });
    expect(request.request.body).toEqual({ repoId: REPO_ID, target: 'repo' });
    request.flush({ ...SESSION, target: 'repo', branch: null }, {
      status: 201,
      statusText: 'Created',
    });
  });

  it('renders the refusal code and stays open', async () => {
    const { element, http, fixture, created } = await mount();

    button(element, 'new-session-target-design').click();
    await fixture.whenStable();
    button(element, 'new-session-create').click();
    await fixture.whenStable();

    http
      .expectOne({ method: 'POST', url: '/v1/sessions' })
      .flush(
        { error: { code: 'conflict', message: 'Proposal pending' } },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();

    expect(element.querySelector('[data-testid="new-session-error"]')?.getAttribute('data-code')).toBe(
      'conflict',
    );
    expect(created).toEqual([]);
  });
});

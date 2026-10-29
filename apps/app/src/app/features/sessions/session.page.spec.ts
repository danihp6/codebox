import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  DesignPreview,
  Session,
  SessionMessage,
  SseStreamEvent,
} from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { STRINGS, translate } from './i18n';
import { SessionPage } from './session.page';

const SESSION_ID = 'sess_01JABCDEFGHJK';
const SESSION_URL = `/v1/sessions/${SESSION_ID}`;
const MESSAGES_URL = `/v1/sessions/${SESSION_ID}/messages?limit=100`;
const TS = '2026-10-28T09:12:00Z';

const PROPOSAL = {
  branch: 'cb/design-edit',
  sha: '9f1c2ab',
  paths: ['design/tokens/core.json', 'design/tokens/dark.json'],
  createdAt: TS,
};

const SESSION: Session = {
  id: SESSION_ID,
  repoId: 'repo_01JABCDEFGHJKMNPQRSV',
  target: 'design',
  workId: null,
  title: 'Edit the design tokens',
  status: 'idle',
  branch: 'cb/design-edit',
  pendingProposal: null,
  usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
  contextTokens: 0,
  contextEpoch: 1,
  createdAt: TS,
  updatedAt: TS,
  lastMessage: null,
};

const DESIGN_URL = `/v1/repos/${SESSION.repoId}/design`;

const PREVIEW: DesignPreview = {
  repoId: SESSION.repoId,
  revision: '9f1c2ab',
  present: true,
  tokens: [{ name: 'color.brand.bright', type: 'color', value: '#22c55e' }],
  routes: [{ path: '/repos/:id', screen: 'Repo · backlog', component: 'RepoBacklogPage' }],
  screens: [
    {
      screen: 'Repo · backlog',
      route: '/repos/:id',
      states: { loading: 'Rows grey', empty: null, error: 'Envelope' },
      snapshotSha256: null,
    },
  ],
  findings: [],
  checkedAt: '2026-10-29T10:00:00Z',
};

const MESSAGE: SessionMessage = {
  id: 'msg_01JABCDEFGHJK',
  sessionId: SESSION_ID,
  role: 'assistant',
  text: 'Here is the change.\n\n```json\n{"a":1}\n```',
  createdAt: TS,
};

function designUrl(session: Session): string {
  const sha = session.pendingProposal?.sha ?? null;
  return sha === null ? DESIGN_URL : `${DESIGN_URL}?revision=${sha}`;
}

function previewAt(session: Session): DesignPreview {
  return { ...PREVIEW, repoId: session.repoId, revision: session.pendingProposal?.sha ?? '4d2e0aa' };
}

const i18nStub = { locale: () => 'en' as const };

interface Mounted {
  readonly fixture: ComponentFixture<SessionPage>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
}

async function mount(session: Session = SESSION, messages: readonly SessionMessage[] = [MESSAGE]): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: i18nStub },
      { provide: SseService, useValue: { event: signal<SseStreamEvent | null>(null) } },
    ],
  });
  const fixture = TestBed.createComponent(SessionPage);
  fixture.componentRef.setInput('id', SESSION_ID);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(SESSION_URL).flush(session);
  http.expectOne(MESSAGES_URL).flush({ data: [...messages], nextCursor: null });
  await fixture.whenStable();
  if (session.target === 'design') {
    http.expectOne(designUrl(session)).flush(previewAt(session));
    await fixture.whenStable();
  }
  return { fixture, element: fixture.nativeElement as HTMLElement, http };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

describe('SessionPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the target, the thread and the tool cards', async () => {
    const { element } = await mount();

    expect(hook(element, 'page-session')).not.toBeNull();
    expect(hook(element, 'session-target')?.textContent?.trim()).toBe(
      translate('en', 'session.target.design'),
    );
    const message = hook(element, 'session-message');
    expect(message?.getAttribute('data-role')).toBe('assistant');
    expect(message?.getAttribute('data-message-id')).toBe(MESSAGE.id);
    expect(message?.querySelector('[data-testid="session-code"]')).not.toBeNull();
    expect(hook(element, 'session-composer')).not.toBeNull();
    expect(hook(element, 'session-send')).not.toBeNull();
    expect(hook(element, 'session-stop')).not.toBeNull();
  });

  it('blocks the composer while a proposal is pending and merges once', async () => {
    const { element, fixture, http } = await mount({ ...SESSION, pendingProposal: PROPOSAL });

    const composer = element.querySelector<HTMLTextAreaElement>('[data-testid="session-composer"]');
    expect(composer?.disabled).toBe(true);
    expect(hook(element, 'session-composer-blocked')).not.toBeNull();

    const panel = hook(element, 'session-proposal');
    expect(panel?.getAttribute('data-sha')).toBe(PROPOSAL.sha);
    expect(hook(element, 'session-proposal-branch')?.textContent?.trim()).toBe(PROPOSAL.branch);
    const paths = element.querySelectorAll('[data-testid="session-proposal-path"]');
    expect(paths).toHaveLength(PROPOSAL.paths.length);
    expect([...paths].map((node) => node.textContent?.trim())).toEqual(PROPOSAL.paths);

    hook(element, 'session-merge')?.click();
    hook(element, 'session-merge')?.click();
    await fixture.whenStable();

    http
      .expectOne({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/merge` })
      .flush({ ...SESSION, pendingProposal: null });
    await fixture.whenStable();
    http.expectOne(DESIGN_URL).flush(PREVIEW);
    await fixture.whenStable();

    expect(hook(element, 'session-proposal')).toBeNull();
    const after = element.querySelector<HTMLTextAreaElement>('[data-testid="session-composer"]');
    expect(after?.disabled).toBe(false);
  });

  it('re-enables the merge and names the refusal', async () => {
    const { element, fixture, http } = await mount({ ...SESSION, pendingProposal: PROPOSAL });

    hook(element, 'session-merge')?.click();
    await fixture.whenStable();
    http
      .expectOne({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/merge` })
      .flush(
        {
          error: {
            code: 'conflict',
            message: 'Outside the target',
            details: { reason: 'target_violation', path: 'src/app.ts' },
          },
        },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();

    expect(hook(element, 'session-merge-error')?.getAttribute('data-code')).toBe('conflict');
    expect(hook(element, 'session-proposal')).toBeNull();
  });

  it('draws no proposal panel on a read-only repository session', async () => {
    const { element, http } = await mount({
      ...SESSION,
      target: 'repo',
      branch: null,
      pendingProposal: null,
    });

    expect(hook(element, 'session-target')?.textContent?.trim()).toBe(
      translate('en', 'session.target.repo'),
    );
    expect(hook(element, 'session-proposal')).toBeNull();
    expect(hook(element, 'session-merge')).toBeNull();
    expect(hook(element, 'design-preview')).toBeNull();
    http.expectNone(DESIGN_URL);
    const composer = element.querySelector<HTMLTextAreaElement>('[data-testid="session-composer"]');
    expect(composer?.disabled).toBe(false);
  });

  it('renders the error with its code and retries', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: I18nService, useValue: i18nStub },
        { provide: SseService, useValue: { event: signal<SseStreamEvent | null>(null) } },
      ],
    });
    const fixture = TestBed.createComponent(SessionPage);
    fixture.componentRef.setInput('id', SESSION_ID);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne(SESSION_URL)
      .flush(
        { error: { code: 'not_found', message: 'Gone' } },
        { status: 404, statusText: 'Not Found' },
      );
    http.expectOne(MESSAGES_URL).flush({ data: [], nextCursor: null });
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(hook(element, 'session-error')?.getAttribute('data-code')).toBe('not_found');

    hook(element, 'session-retry')?.click();
    await fixture.whenStable();
    http.expectOne(SESSION_URL).flush(SESSION);
    http.expectOne(MESSAGES_URL).flush({ data: [MESSAGE], nextCursor: null });
    await fixture.whenStable();
    http.expectOne(DESIGN_URL).flush(PREVIEW);
    await fixture.whenStable();

    expect(hook(element, 'session-error')).toBeNull();
    expect(hook(element, 'session-message')).not.toBeNull();
  });

  it('asks the preview for the proposal commit once a proposal lands', async () => {
    const { element, fixture, http } = await mount();
    expect(hook(element, 'design-preview')?.getAttribute('data-revision')).toBe('4d2e0aa');
    expect(hook(element, 'design-preview-pending')).toBeNull();

    fixture.componentInstance.store.reload();
    await fixture.whenStable();
    const carried = { ...SESSION, pendingProposal: PROPOSAL };
    http.expectOne(SESSION_URL).flush(carried);
    http.expectOne(MESSAGES_URL).flush({ data: [MESSAGE], nextCursor: null });
    await fixture.whenStable();

    http.expectOne(`${DESIGN_URL}?revision=${PROPOSAL.sha}`).flush(previewAt(carried));
    await fixture.whenStable();

    expect(hook(element, 'design-preview-revision')?.getAttribute('data-sha')).toBe(PROPOSAL.sha);
    expect(hook(element, 'design-preview-pending')).not.toBeNull();
  });

  it('ships both locales key-for-key', () => {
    expect(Object.keys(STRINGS.es)).toEqual(Object.keys(STRINGS.en));
    for (const locale of ['en', 'es'] as const) {
      for (const [key, value] of Object.entries(STRINGS[locale])) {
        expect(translate(locale, key), `${locale} ${key}`).toBe(value);
      }
    }
  });
});

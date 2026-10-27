import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { ChatMessage, ChatSession, Repo } from '@codebox/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { SecureStore } from '../../core/auth/secure-store';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { Locale } from '../../core/i18n/i18n.service';
import { STRINGS, translate } from './new-chat.i18n';
import { NewChatPanel } from './new-chat';

const TS = '2026-10-27T11:00:00Z';
const SESSIONS_URL = '/v1/chat/sessions';
const REPOS_URL = '/v1/repos';
const CHAT = 'chat_01JABCDEFGHJKMNPQRSV';
const MESSAGES_URL = `${SESSIONS_URL}/${CHAT}/messages`;
const BIND_URL = `${SESSIONS_URL}/${CHAT}/repo`;

const REPO: Repo = {
  id: 'repo_01JABCDEFGHJKMNPQRSV',
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: [],
  enabled: true,
  createdAt: TS,
};

const DISABLED: Repo = {
  ...REPO,
  id: 'repo_02JABCDEFGHJKMNPQRSV',
  slug: 'acme/legacy',
  enabled: false,
};

const FREE: ChatSession = {
  id: CHAT,
  repoId: null,
  kind: 'free',
  title: 'New chat',
  status: 'idle',
  createdAt: TS,
  updatedAt: TS,
  lastMessage: null,
};

const BOUND: ChatSession = { ...FREE, repoId: REPO.id, kind: 'repo', title: 'acme/widgets' };

const MESSAGE: ChatMessage = {
  id: 'msg_01JABCDEFGHJKMNPQRSV',
  chatId: CHAT,
  role: 'user',
  text: 'hello',
  createdAt: TS,
};

const USED_KEYS: readonly string[] = [
  'newChat.proposal.repository',
  'newChat.proposal.repository.hint',
  'newChat.proposal.schedule',
  'newChat.proposal.schedule.hint',
  'newChat.composer.label',
  'newChat.composer.placeholder',
  'newChat.composer.send',
  'newChat.composer.converting',
  'newChat.picker.title',
  'newChat.picker.loading',
  'newChat.picker.empty',
  'newChat.picker.unavailable',
  'newChat.picker.retry',
  'newChat.error.hint',
  'repoPicker.aria',
  'repoPicker.state.connected',
  'repoPicker.state.cloning',
  'repoPicker.state.unavailable',
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

function envelope(code: string, details?: Record<string, unknown>): Record<string, unknown> {
  return {
    error: {
      code,
      message: 'Boom',
      requestId: 'req_01JABCDEFGHJKMNPQRSV',
      ...(details === undefined ? {} : { details }),
    },
  };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

interface Mounted {
  readonly fixture: ComponentFixture<NewChatPanel>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
  readonly created: ChatSession[];
  readonly handoffs: ChatSession[];
}

async function mount(options: { readonly chatId?: string } = {}): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SECURE_STORE, useValue: memoryStore() },
    ],
  });
  const fixture = TestBed.createComponent(NewChatPanel);
  if (options.chatId !== undefined) fixture.componentRef.setInput('chatId', options.chatId);
  const created: ChatSession[] = [];
  const handoffs: ChatSession[] = [];
  fixture.componentInstance.created.subscribe((session) => created.push(session));
  fixture.componentInstance.handoff.subscribe((session) => handoffs.push(session));
  await fixture.whenStable();
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
    created,
    handoffs,
  };
}

function button(element: HTMLElement, id: string): HTMLButtonElement | null {
  return element.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
}

function proposal(element: HTMLElement, name: string): HTMLButtonElement | null {
  return element.querySelector<HTMLButtonElement>(`[data-proposal="${name}"]`);
}

function row(element: HTMLElement, repoId: string): HTMLButtonElement | null {
  return element.querySelector<HTMLButtonElement>(
    `[data-testid="repo-picker-row"][data-repo-id="${repoId}"]`,
  );
}

function sendButton(element: HTMLElement): HTMLButtonElement {
  const found = button(element, 'new-chat-send');
  if (found === null) throw new Error('the send button is missing');
  return found;
}

function textarea(element: HTMLElement): HTMLTextAreaElement {
  const found = hook(element, 'new-chat-draft');
  if (!(found instanceof HTMLTextAreaElement)) throw new Error('the composer is missing');
  return found;
}

async function type(fixture: ComponentFixture<NewChatPanel>, text: string): Promise<void> {
  const field = textarea(fixture.nativeElement as HTMLElement);
  field.value = text;
  field.dispatchEvent(new Event('input'));
  await fixture.whenStable();
}

async function openPicker(mounted: Mounted, repos: readonly Repo[] = [REPO]): Promise<void> {
  proposal(mounted.element, 'repository')?.click();
  await mounted.fixture.whenStable();
  mounted.http
    .expectOne((request) => request.url === REPOS_URL)
    .flush({ data: [...repos], nextCursor: null });
  await mounted.fixture.whenStable();
}

describe('NewChatPanel', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders exactly the two proposals and issues no request on render', async () => {
    const { element, http } = await mount();

    const empty = hook(element, 'new-chat-empty');
    expect(empty).not.toBeNull();
    const proposals = element.querySelectorAll('[data-testid="new-chat-proposal"]');
    expect(proposals).toHaveLength(2);
    expect([...proposals].map((node) => node.getAttribute('data-proposal'))).toEqual([
      'repository',
      'schedule',
    ]);
    expect(empty?.getAttribute('data-proposals')).toBe('2');
    expect(http.match(() => true)).toHaveLength(0);
  });

  it('keeps the composer enabled while the proposals are shown', async () => {
    const { element } = await mount();

    expect(textarea(element).disabled).toBe(false);
    expect(sendButton(element).disabled).toBe(true);
  });

  it('creates the free session from the empty state and then posts the trimmed draft', async () => {
    const { fixture, element, http, created } = await mount();

    await type(fixture, '  hello  ');
    expect(sendButton(element).disabled).toBe(false);
    sendButton(element).click();

    const create = http.expectOne({ method: 'POST', url: SESSIONS_URL });
    expect(create.request.body).toEqual({});
    create.flush(FREE, { status: 201, statusText: 'Created' });

    const sent = http.expectOne({ method: 'POST', url: MESSAGES_URL });
    expect(sent.request.body).toEqual({ text: 'hello' });
    sent.flush(MESSAGE);
    await fixture.whenStable();

    expect(created).toEqual([FREE]);
    expect(textarea(element).value).toBe('');
  });

  it('renders the picker states and refuses an unavailable repository', async () => {
    const mounted = await mount();
    const { fixture, element, http, handoffs } = mounted;

    await openPicker(mounted, [REPO, DISABLED]);

    expect(element.querySelectorAll('[data-testid="repo-picker-row"]')).toHaveLength(2);
    expect(row(element, REPO.id)?.getAttribute('data-state')).toBe('connected');
    expect(row(element, DISABLED.id)?.getAttribute('data-state')).toBe('unavailable');

    row(element, DISABLED.id)?.click();
    await fixture.whenStable();
    http.expectNone({ method: 'POST', url: SESSIONS_URL });
    expect(handoffs).toEqual([]);

    row(element, REPO.id)?.click();
    const create = http.expectOne({ method: 'POST', url: SESSIONS_URL });
    expect(create.request.body).toEqual({ repoId: REPO.id });
    await fixture.whenStable();

    expect(row(element, REPO.id)?.getAttribute('data-state')).toBe('cloning');
    expect(textarea(element).disabled).toBe(true);
    expect(hook(element, 'repo-picker')).not.toBeNull();

    create.flush(BOUND, { status: 201, statusText: 'Created' });
    await fixture.whenStable();

    expect(handoffs).toEqual([BOUND]);
    expect(row(element, REPO.id)?.getAttribute('data-state')).toBe('connected');
    expect(textarea(element).disabled).toBe(false);
    expect(hook(element, 'new-chat-error')).toBeNull();
  });

  it('comes back from a 409 with the refusal shown and no handoff', async () => {
    const mounted = await mount();
    const { fixture, element, http, handoffs } = mounted;

    await openPicker(mounted);
    row(element, REPO.id)?.click();
    http
      .expectOne({ method: 'POST', url: SESSIONS_URL })
      .flush(envelope('conflict', { reason: 'chat_already_bound' }), {
        status: 409,
        statusText: 'Conflict',
      });
    await fixture.whenStable();

    const error = hook(element, 'new-chat-error');
    expect(error?.getAttribute('data-code')).toBe('conflict');
    expect(error?.getAttribute('data-reason')).toBe('chat_already_bound');
    expect(error?.textContent).toContain('chat_already_bound');
    expect(handoffs).toEqual([]);
    expect(row(element, REPO.id)?.getAttribute('data-state')).toBe('connected');
    expect(textarea(element).disabled).toBe(false);
  });

  it('comes back from a 404 with the error code shown', async () => {
    const mounted = await mount();
    const { fixture, element, http, handoffs } = mounted;

    await openPicker(mounted);
    row(element, REPO.id)?.click();
    http.expectOne({ method: 'POST', url: SESSIONS_URL }).flush(envelope('not_found'), {
      status: 404,
      statusText: 'Not Found',
    });
    await fixture.whenStable();

    expect(hook(element, 'new-chat-error')?.getAttribute('data-code')).toBe('not_found');
    expect(handoffs).toEqual([]);
    expect(row(element, REPO.id)?.getAttribute('data-state')).toBe('connected');
  });

  it('binds an existing free chat with one request to the repo route', async () => {
    const { fixture, element, http, handoffs } = await mount({ chatId: CHAT });

    expect(hook(element, 'new-chat-empty')).toBeNull();
    expect(http.match(() => true)).toHaveLength(0);

    fixture.componentInstance.store.loadRepos();
    http
      .expectOne((request) => request.url === REPOS_URL)
      .flush({ data: [REPO], nextCursor: null });
    await fixture.whenStable();

    row(element, REPO.id)?.click();
    const bind = http.expectOne({ method: 'POST', url: BIND_URL });
    expect(bind.request.body).toEqual({ repoId: REPO.id });
    bind.flush(BOUND);
    await fixture.whenStable();

    expect(handoffs).toEqual([BOUND]);
  });

  it('offers a retry when the repository read fails', async () => {
    const mounted = await mount();
    const { fixture, element, http } = mounted;

    proposal(element, 'repository')?.click();
    await fixture.whenStable();
    http
      .expectOne((request) => request.url === REPOS_URL)
      .flush(envelope('internal'), { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();

    expect(hook(element, 'new-chat-repos-unavailable')).not.toBeNull();
    button(element, 'new-chat-repos-retry')?.click();
    http
      .expectOne((request) => request.url === REPOS_URL)
      .flush({ data: [REPO], nextCursor: null });
    await fixture.whenStable();

    expect(row(element, REPO.id)?.getAttribute('data-state')).toBe('connected');
  });

  it('ships the same keys in both dictionaries and resolves every template key', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.es).sort());
    for (const locale of ['en', 'es'] as const satisfies readonly Locale[]) {
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

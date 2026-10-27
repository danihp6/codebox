import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { ChatMessage, ChatSession, Page, Repo, SseStreamEvent } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import type { SecureStore } from '../../core/auth/secure-store';
import { SECURE_STORE } from '../../core/auth/secure-store';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import type { Locale } from '../../core/i18n/i18n.service';
import { ChatApi } from './chat.api';
import { ChatListPage } from './chat-list.page';
import { ChatReadStore } from './chat-list.store';
import { STRINGS, translate } from './i18n';

const CREATED = '2026-10-20T00:00:00Z';
const DEFAULT_MARKS: Readonly<Record<string, string>> = Object.freeze({
  chat_c: '2026-10-27T08:00:00Z',
});

const REPO: Repo = {
  id: 'repo_1',
  slug: 'owner/alpha',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: [],
  enabled: true,
  createdAt: CREATED,
};

function message(
  chatId: string,
  role: ChatMessage['role'],
  createdAt: string,
  text: string,
): ChatMessage {
  return { id: `msg_${chatId}`, chatId, role, text, createdAt };
}

const CHAT_A: ChatSession = {
  id: 'chat_a',
  repoId: null,
  kind: 'free',
  title: 'Free first',
  status: 'idle',
  usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
  contextTokens: 0,
  reviewedAt: null,
  createdAt: CREATED,
  updatedAt: '2026-10-27T10:30:00Z',
  lastMessage: message('chat_a', 'assistant', '2026-10-27T09:00:00Z', 'Started free'),
};

const CHAT_B: ChatSession = {
  id: 'chat_b',
  repoId: REPO.id,
  kind: 'repo',
  title: 'Alpha refactor',
  status: 'idle',
  usage: { usd: 0.42, tokensIn: 1200, tokensOut: 800 },
  contextTokens: 12400,
  reviewedAt: null,
  createdAt: CREATED,
  updatedAt: '2026-10-27T10:00:00Z',
  lastMessage: message('chat_b', 'assistant', '2026-10-27T10:00:00Z', 'Refactored the module'),
};

const CHAT_C: ChatSession = {
  id: 'chat_c',
  repoId: REPO.id,
  kind: 'repo',
  title: 'Reviewed chat',
  status: 'idle',
  usage: { usd: 1.5, tokensIn: 4000, tokensOut: 3000 },
  contextTokens: 95000,
  reviewedAt: '2026-10-27T08:30:00Z',
  createdAt: CREATED,
  updatedAt: '2026-10-27T08:30:00Z',
  lastMessage: message('chat_c', 'assistant', '2026-10-27T08:00:00Z', 'Reviewed already'),
};

const CHAT_D: ChatSession = {
  id: 'chat_d',
  repoId: REPO.id,
  kind: 'schedule',
  title: 'Nightly schedule',
  status: 'working',
  usage: { usd: 0.1, tokensIn: 500, tokensOut: 500 },
  contextTokens: 3000,
  reviewedAt: null,
  createdAt: CREATED,
  updatedAt: '2026-10-27T08:00:00Z',
  lastMessage: message('chat_d', 'assistant', '2026-10-27T07:00:00Z', 'Nightly pass done'),
};

const CHAT_E: ChatSession = {
  id: 'chat_e',
  repoId: REPO.id,
  kind: 'repo',
  title: 'Old chat',
  status: 'archived',
  usage: { usd: 0.2, tokensIn: 200, tokensOut: 200 },
  contextTokens: 1000,
  reviewedAt: null,
  createdAt: CREATED,
  updatedAt: '2026-10-26T07:00:00Z',
  lastMessage: message('chat_e', 'assistant', '2026-10-26T07:00:00Z', 'Archived work'),
};

const CHAT_F: ChatSession = {
  id: 'chat_f',
  repoId: REPO.id,
  title: 'Legacy chat',
  status: 'idle',
  createdAt: CREATED,
  updatedAt: '2026-10-27T06:00:00Z',
  lastMessage: message('chat_f', 'user', '2026-10-27T06:00:00Z', 'Legacy reply'),
};

const SESSIONS: readonly ChatSession[] = Object.freeze([
  CHAT_A,
  CHAT_B,
  CHAT_C,
  CHAT_D,
  CHAT_E,
  CHAT_F,
]);

const CREATED_SESSION: ChatSession = {
  id: 'chat_01JABCDEFGHJKMNPQRSV',
  repoId: null,
  kind: 'free',
  title: 'New chat',
  status: 'idle',
  createdAt: CREATED,
  updatedAt: CREATED,
  lastMessage: null,
};

function page<T>(data: readonly T[]): Page<T> {
  return { data: [...data], nextCursor: null };
}

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

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class StubChatApi {
  repos: Page<Repo> = page([REPO]);
  sessions: Page<ChatSession> = page(SESSIONS);
  failure: ApiError | null = null;
  readonly created: { repoId?: string; title?: string }[] = [];

  listRepos(): Observable<Page<Repo>> {
    return of(this.repos);
  }

  listSessions(): Observable<Page<ChatSession>> {
    const failure = this.failure;
    return failure === null ? of(this.sessions) : throwError(() => failure);
  }

  createSession(body: { repoId?: string; title?: string }): Observable<ChatSession> {
    this.created.push(body);
    return of(CREATED_SESSION);
  }
}

interface MountOptions {
  readonly repos?: Page<Repo>;
  readonly sessions?: Page<ChatSession>;
  readonly marks?: Readonly<Record<string, string>>;
  readonly secure?: SecureStore;
  readonly api?: StubChatApi;
}

interface Mounted {
  readonly fixture: ComponentFixture<ChatListPage>;
  readonly element: HTMLElement;
  readonly sse: WritableSignal<SseStreamEvent | null>;
  readonly read: ChatReadStore;
  readonly api: StubChatApi;
}

async function mount(options: MountOptions = {}): Promise<Mounted> {
  const sse = signal<SseStreamEvent | null>(null);
  const api = options.api ?? new StubChatApi();
  api.repos = options.repos ?? page([REPO]);
  api.sessions = options.sessions ?? page(SESSIONS);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SECURE_STORE, useValue: options.secure ?? memoryStore() },
      { provide: SseService, useValue: { event: sse } },
      { provide: I18nService, useValue: { locale: signal<Locale>('en') } },
      { provide: ChatApi, useValue: api },
    ],
  });

  const read = TestBed.inject(ChatReadStore);
  await read.load();
  for (const [chatId, at] of Object.entries(options.marks ?? DEFAULT_MARKS)) {
    read.markRead(chatId, at);
  }

  const fixture = TestBed.createComponent(ChatListPage);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  return { fixture, element, sse, read, api };
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await tick();
  await fixture.whenStable();
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function chip(element: HTMLElement, filter: string): HTMLButtonElement {
  const found = element.querySelector<HTMLButtonElement>(
    `[data-testid="chat-filter"][data-filter="${filter}"]`,
  );
  if (found === null) throw new Error(`missing filter chip ${filter}`);
  return found;
}

function row(element: HTMLElement, chatId: string): HTMLElement {
  const found = element.querySelector<HTMLElement>(
    `[data-testid="chat-row"][data-chat-id="${chatId}"]`,
  );
  if (found === null) throw new Error(`missing row ${chatId}`);
  return found;
}

function rowIds(element: HTMLElement): (string | null)[] {
  return [...element.querySelectorAll('[data-testid="chat-row"]')].map((candidate) =>
    candidate.getAttribute('data-chat-id'),
  );
}

async function pick(
  mounted: Mounted,
  filter: 'all' | 'repo' | 'schedule' | 'unread' | 'archived',
): Promise<void> {
  chip(mounted.element, filter).click();
  await settle(mounted.fixture);
}

async function search(mounted: Mounted, text: string): Promise<void> {
  const input = hook(mounted.element, 'chat-search') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  await settle(mounted.fixture);
}

describe('ChatListPage', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('renders the five filters in order with the selected one pressed', async () => {
    const mounted = await mount();
    const chips = [...mounted.element.querySelectorAll('[data-testid="chat-filter"]')];

    expect(chips.map((candidate) => candidate.getAttribute('data-filter'))).toEqual([
      'all',
      'repo',
      'schedule',
      'unread',
      'archived',
    ]);
    expect(chips.map((candidate) => candidate.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    expect(chips.map((candidate) => candidate.textContent?.trim())).toEqual([
      'All',
      'Repo',
      'Schedule',
      'Unread',
      'Archived',
    ]);

    await pick(mounted, 'archived');

    expect(chip(mounted.element, 'archived').getAttribute('aria-pressed')).toBe('true');
    expect(chip(mounted.element, 'all').getAttribute('aria-pressed')).toBe('false');
  });

  it('lists the whole page on All and the archived rows only on Archived', async () => {
    const mounted = await mount();

    expect(rowIds(mounted.element)).toEqual(['chat_a', 'chat_b', 'chat_c', 'chat_d', 'chat_f']);
    expect(hook(mounted.element, 'chat-empty')).toBeNull();
    expect(hook(mounted.element, 'chat-list-no-match')).toBeNull();

    await pick(mounted, 'archived');

    expect(rowIds(mounted.element)).toEqual(['chat_e']);
  });

  it('filters the fetched page by repo and by schedule without a request', async () => {
    const mounted = await mount();

    await pick(mounted, 'repo');
    expect(rowIds(mounted.element)).toEqual(['chat_b', 'chat_c', 'chat_f']);

    await pick(mounted, 'schedule');
    expect(rowIds(mounted.element)).toEqual(['chat_d']);
  });

  it('lists the unread chats, then drops the one the operator opens', async () => {
    const mounted = await mount();

    await pick(mounted, 'unread');
    expect(rowIds(mounted.element)).toEqual(['chat_a', 'chat_b', 'chat_d']);
    expect(
      row(mounted.element, 'chat_a').querySelector('[data-testid="chat-row-unread"]'),
    ).not.toBeNull();

    mounted.fixture.componentInstance.store.markRead('chat_a');
    await settle(mounted.fixture);

    expect(rowIds(mounted.element)).toEqual(['chat_b', 'chat_d']);
    expect(mounted.element.querySelector('[data-chat-id="chat_a"]')).toBeNull();
    expect(mounted.read.readAt('chat_a')).toBe('2026-10-27T09:00:00Z');
  });

  it('joins the unread set with an empty marker map and keeps the marker across a reload', async () => {
    const secure = memoryStore();
    const first = await mount({ marks: {}, secure });

    await pick(first, 'unread');
    expect(rowIds(first.element)).toEqual(['chat_a', 'chat_b', 'chat_c', 'chat_d']);

    first.fixture.componentInstance.store.markRead('chat_a');
    await settle(first.fixture);
    expect(rowIds(first.element)).toEqual(['chat_b', 'chat_c', 'chat_d']);

    TestBed.resetTestingModule();
    const second = await mount({ marks: {}, secure });
    await pick(second, 'unread');

    expect(rowIds(second.element)).toEqual(['chat_b', 'chat_c', 'chat_d']);
    expect(second.element.querySelector('[data-chat-id="chat_a"]')).toBeNull();
  });

  it('renders both signals on the same row and neither on a reviewed one', async () => {
    const mounted = await mount();
    const unreviewed = row(mounted.element, 'chat_b');

    expect(unreviewed.getAttribute('data-unread')).toBe('true');
    expect(unreviewed.getAttribute('data-unreviewed')).toBe('true');
    expect(unreviewed.classList.contains('cb-chat-row-unreviewed')).toBe(true);
    expect(unreviewed.querySelector('[data-testid="chat-row-unread"]')).not.toBeNull();
    expect(unreviewed.querySelector('[data-testid="chat-row-unreviewed"]')).not.toBeNull();

    const reviewed = row(mounted.element, 'chat_c');
    expect(reviewed.getAttribute('data-unread')).toBe('false');
    expect(reviewed.getAttribute('data-unreviewed')).toBe('false');
    expect(reviewed.querySelector('[data-testid="chat-row-unread"]')).toBeNull();
    expect(reviewed.querySelector('[data-testid="chat-row-unreviewed"]')).toBeNull();

    await pick(mounted, 'archived');
    const archived = row(mounted.element, 'chat_e');
    expect(archived.getAttribute('data-unread')).toBe('false');
    expect(archived.getAttribute('data-unreviewed')).toBe('false');
    expect(archived.querySelector('[data-testid="chat-row-unread"]')).toBeNull();
    expect(archived.querySelector('[data-testid="chat-row-unreviewed"]')).toBeNull();
  });

  it('never puts the amber edge on a free chat', async () => {
    const mounted = await mount();
    const free = row(mounted.element, 'chat_a');

    expect(free.getAttribute('data-scope')).toBe('free');
    expect(free.getAttribute('data-unreviewed')).toBe('false');
    expect(free.querySelector('[data-testid="chat-row-unreviewed"]')).toBeNull();
    expect(free.querySelector('[data-testid="chat-row-unread"]')).not.toBeNull();
  });

  it('prints the cost and the context as micro-text, and nothing when there is none', async () => {
    const mounted = await mount();

    const priced = row(mounted.element, 'chat_b');
    expect(priced.querySelector('[data-testid="chat-row-cost"]')?.textContent).toContain('$0.42');
    const context = priced.querySelector('[data-testid="chat-row-context"]')?.textContent ?? '';
    expect(context).toContain('12.4');
    expect(context).toContain('ctx');
    expect(priced.querySelector('[data-testid="chat-row-scope"]')?.textContent).toContain(
      'owner/alpha',
    );

    const empty = row(mounted.element, 'chat_a');
    expect(empty.querySelector('[data-testid="chat-row-cost"]')).toBeNull();
    expect(empty.querySelector('[data-testid="chat-row-context"]')).toBeNull();

    const legacy = row(mounted.element, 'chat_f');
    expect(legacy.querySelector('[data-testid="chat-row-cost"]')).toBeNull();
    expect(legacy.querySelector('[data-testid="chat-row-context"]')).toBeNull();
    expect(legacy.getAttribute('data-scope')).toBe('repo');
    expect(legacy.querySelector('[data-testid="chat-row-scope"]')?.textContent).toContain(
      'owner/alpha',
    );
  });

  it('renders one wrapping flow per row whose children are spans', async () => {
    const mounted = await mount();
    const flows = mounted.element.querySelectorAll('[data-testid="chat-row-flow"]');

    expect(flows).toHaveLength(rowIds(mounted.element).length);
    for (const flow of flows) {
      expect([...flow.children].every((child) => child.tagName === 'SPAN')).toBe(true);
    }
  });

  it('moves the chat that just spoke to the top of the list', async () => {
    const mounted = await mount();

    mounted.sse.set({
      event: 'chat.message',
      data: {
        chatId: 'chat_d',
        seq: 4,
        ts: '2026-10-27T11:00:00Z',
        message: message('chat_d', 'assistant', '2026-10-27T11:00:00Z', 'Fresh schedule reply'),
      },
    });
    await settle(mounted.fixture);

    expect(rowIds(mounted.element)).toEqual(['chat_d', 'chat_a', 'chat_b', 'chat_c', 'chat_f']);
    expect(row(mounted.element, 'chat_d').getAttribute('data-unread')).toBe('true');
    expect(
      row(mounted.element, 'chat_d').querySelector('[data-testid="chat-row-preview"]')?.textContent,
    ).toContain('Fresh schedule reply');
  });

  it('searches the title and the last message case-insensitively', async () => {
    const mounted = await mount();

    await search(mounted, 'ALPHA');
    expect(rowIds(mounted.element)).toEqual(['chat_b']);
    expect(hook(mounted.element, 'chat-list-no-match')).toBeNull();

    await pick(mounted, 'schedule');
    expect(rowIds(mounted.element)).toEqual([]);
    expect(hook(mounted.element, 'chat-list-no-match')).not.toBeNull();
    expect(hook(mounted.element, 'chat-empty')).toBeNull();

    await search(mounted, '');
    expect(rowIds(mounted.element)).toEqual(['chat_d']);
  });

  it('renders the error block with its code and retries the list', async () => {
    const api = new StubChatApi();
    api.failure = new ApiError({
      message: 'Boom',
      status: 500,
      code: 'internal',
      requestId: 'req_01JABCDEFGHJKMNPQRSV',
      details: null,
    });
    const mounted = await mount({ api });

    expect(hook(mounted.element, 'chat-list-error')?.getAttribute('data-code')).toBe('internal');
    expect(rowIds(mounted.element)).toEqual([]);

    api.failure = null;
    (hook(mounted.element, 'chat-list-retry') as HTMLButtonElement).click();
    await settle(mounted.fixture);

    expect(hook(mounted.element, 'chat-list-error')).toBeNull();
    expect(rowIds(mounted.element)).toEqual(['chat_a', 'chat_b', 'chat_c', 'chat_d', 'chat_f']);
  });

  it('tells an empty box from an empty filter', async () => {
    const empty = await mount({ sessions: page<ChatSession>([]) });

    expect(hook(empty.element, 'chat-empty')).not.toBeNull();
    expect(hook(empty.element, 'chat-list-no-match')).toBeNull();
    expect(rowIds(empty.element)).toEqual([]);

    TestBed.resetTestingModule();
    const filtered = await mount();
    await pick(filtered, 'schedule');
    await search(filtered, 'nothing matches this');

    expect(hook(filtered.element, 'chat-list-no-match')).not.toBeNull();
    expect(hook(filtered.element, 'chat-empty')).toBeNull();
  });

  it('starts a free chat with no repository connected', async () => {
    const api = new StubChatApi();
    const mounted = await mount({ api, repos: page<Repo>([]) });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const button = hook(mounted.element, 'chat-new') as HTMLButtonElement;

    expect(button.disabled).toBe(false);
    button.click();
    await settle(mounted.fixture);

    expect(api.created).toEqual([{}]);
    expect(navigate).toHaveBeenCalledWith(['/chat', CREATED_SESSION.id]);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe('chat dictionary', () => {
  const TABLE: ReadonlyMap<string, readonly [string, string]> = new Map([
    ['chat.filter.all', ['All', 'Todos']],
    ['chat.filter.repo', ['Repo', 'Repo']],
    ['chat.filter.schedule', ['Schedule', 'Programados']],
    ['chat.filter.unread', ['Unread', 'Sin leer']],
    ['chat.filter.archived', ['Archived', 'Archivados']],
    ['chat.search.label', ['Search chats', 'Buscar chats']],
    ['chat.search.placeholder', ['Search chats', 'Buscar chats']],
    ['chat.empty.filter', ['Nothing matches this filter.', 'Nada coincide con este filtro.']],
    ['chat.scope.free', ['Free', 'Libre']],
    ['chat.scope.repo', ['Repo', 'Repo']],
    ['chat.scope.schedule', ['Schedule', 'Programado']],
    ['chat.row.unread', ['Unread', 'Sin leer']],
    ['chat.row.unreviewed', ['Not reviewed', 'Sin revisar']],
    ['chat.row.context', ['ctx', 'ctx']],
  ]);

  it('keeps both locales on the same key set with no empty value', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.es).sort());
    for (const [key, value] of Object.entries(STRINGS.en)) {
      expect(value, key).not.toBe('');
    }
    for (const [key, value] of Object.entries(STRINGS.es)) {
      expect(value, key).not.toBe('');
    }
  });

  it('resolves the fourteen list keys in both locales', () => {
    expect(TABLE.size).toBe(14);
    for (const [key, [en, es]] of TABLE) {
      expect(translate('en', key), `en ${key}`).toBe(en);
      expect(translate('es', key), `es ${key}`).toBe(es);
    }
  });

  it('retires the repository select keys', () => {
    expect(STRINGS.en['chat.filter.label']).toBeUndefined();
    expect(STRINGS.en['chat.group.unknown']).toBeUndefined();
    expect(STRINGS.es['chat.filter.label']).toBeUndefined();
    expect(STRINGS.es['chat.group.unknown']).toBeUndefined();
  });
});

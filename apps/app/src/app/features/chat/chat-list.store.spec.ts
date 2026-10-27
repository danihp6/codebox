import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { ChatMessage, ChatSession, Page, Repo, SseStreamEvent } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import type { SecureStore } from '../../core/auth/secure-store';
import { SECURE_STORE } from '../../core/auth/secure-store';
import { I18nService } from '../../core/i18n/i18n.service';
import type { Locale } from '../../core/i18n/i18n.service';
import type { ChatFilter } from './chat-list.store';
import {
  CHAT_FILTERS,
  CHAT_READ_KEY,
  ChatListStore,
  ChatReadStore,
  buildChatRow,
  chatFilterMatches,
  formatContextTokens,
  formatCost,
  isUnread,
  isUnreviewed,
  sessionKind,
} from './chat-list.store';

const REPOS_URL = '/v1/repos';
const SESSIONS_URL = '/v1/chat/sessions';
const CREATED = '2026-10-20T00:00:00Z';
const TS = '2026-10-27T11:00:00Z';

const A = 'chat_a01JABCDEFGHJKMNPQRSV';
const B = 'chat_b01JABCDEFGHJKMNPQRSV';
const C = 'chat_c01JABCDEFGHJKMNPQRSV';
const D = 'chat_d01JABCDEFGHJKMNPQRSV';
const E = 'chat_e01JABCDEFGHJKMNPQRSV';
const F = 'chat_f01JABCDEFGHJKMNPQRSV';
const UNKNOWN = 'chat_z01JABCDEFGHJKMNPQRSV';
const CREATED_CHAT = 'chat_01JABCDEFGHJKMNPQRSV';

let nextMessage = 0;

const REPO: Repo = {
  id: 'repo_01JABCDEFGHJKMNPQRSV',
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
  nextMessage += 1;
  const id = `msg_01JABCDEFGHJKMNPQRS${String(nextMessage).padStart(2, '0')}`;
  return { id, chatId, role, text, createdAt };
}

const CHAT_A: ChatSession = {
  id: A,
  repoId: null,
  kind: 'free',
  title: 'Free first',
  status: 'idle',
  usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
  contextTokens: 0,
  reviewedAt: null,
  createdAt: CREATED,
  updatedAt: '2026-10-27T10:30:00Z',
  lastMessage: message(A, 'assistant', '2026-10-27T09:00:00Z', 'Started free'),
};

const CHAT_B: ChatSession = {
  id: B,
  repoId: REPO.id,
  kind: 'repo',
  title: 'Alpha refactor',
  status: 'idle',
  usage: { usd: 0.42, tokensIn: 1200, tokensOut: 800 },
  contextTokens: 12400,
  reviewedAt: null,
  createdAt: CREATED,
  updatedAt: '2026-10-27T10:00:00Z',
  lastMessage: message(B, 'assistant', '2026-10-27T10:00:00Z', 'Refactored the module'),
};

const CHAT_C: ChatSession = {
  id: C,
  repoId: REPO.id,
  kind: 'repo',
  title: 'Reviewed chat',
  status: 'idle',
  usage: { usd: 1.5, tokensIn: 4000, tokensOut: 3000 },
  contextTokens: 95000,
  reviewedAt: '2026-10-27T08:30:00Z',
  createdAt: CREATED,
  updatedAt: '2026-10-27T08:30:00Z',
  lastMessage: message(C, 'assistant', '2026-10-27T08:00:00Z', 'Reviewed already'),
};

const CHAT_D: ChatSession = {
  id: D,
  repoId: REPO.id,
  kind: 'schedule',
  title: 'Nightly schedule',
  status: 'working',
  usage: { usd: 0.1, tokensIn: 500, tokensOut: 500 },
  contextTokens: 3000,
  reviewedAt: null,
  createdAt: CREATED,
  updatedAt: '2026-10-27T08:00:00Z',
  lastMessage: message(D, 'assistant', '2026-10-27T07:00:00Z', 'Nightly pass done'),
};

const CHAT_E: ChatSession = {
  id: E,
  repoId: REPO.id,
  kind: 'repo',
  title: 'Old chat',
  status: 'archived',
  usage: { usd: 0.2, tokensIn: 200, tokensOut: 200 },
  contextTokens: 1000,
  reviewedAt: null,
  createdAt: CREATED,
  updatedAt: '2026-10-26T07:00:00Z',
  lastMessage: message(E, 'assistant', '2026-10-26T07:00:00Z', 'Archived work'),
};

const CHAT_F: ChatSession = {
  id: F,
  repoId: REPO.id,
  title: 'Legacy chat',
  status: 'idle',
  createdAt: CREATED,
  updatedAt: '2026-10-27T06:00:00Z',
  lastMessage: message(F, 'user', '2026-10-27T06:00:00Z', 'Legacy reply'),
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
  id: CREATED_CHAT,
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

function chatMessage(chatId: string, createdAt: string, text: string): SseStreamEvent {
  return {
    event: 'chat.message',
    data: {
      chatId,
      seq: 4,
      ts: createdAt,
      message: message(chatId, 'assistant', createdAt, text),
    },
  };
}

describe('chat list helpers', () => {
  it('reads an absent kind as repo', () => {
    expect(sessionKind(CHAT_A)).toBe('free');
    expect(sessionKind(CHAT_D)).toBe('schedule');
    expect(sessionKind(CHAT_F)).toBe('repo');
  });

  it('treats an assistant-last chat as unread until this device reads it', () => {
    expect(isUnread(CHAT_A, null)).toBe(true);
    expect(isUnread(CHAT_B, null)).toBe(true);
    expect(isUnread(CHAT_C, '2026-10-27T08:00:00Z')).toBe(false);
    expect(isUnread(CHAT_C, '2026-10-27T07:00:00Z')).toBe(true);
    expect(isUnread(CHAT_E, null)).toBe(false);
    expect(isUnread(CHAT_F, null)).toBe(false);
    expect(isUnread(CHAT_A, 'not-a-timestamp')).toBe(true);
  });

  it('flags a delivered and unreviewed chat', () => {
    expect(isUnreviewed(CHAT_A)).toBe(false);
    expect(isUnreviewed(CHAT_B)).toBe(true);
    expect(isUnreviewed(CHAT_C)).toBe(false);
    expect(isUnreviewed(CHAT_D)).toBe(true);
    expect(isUnreviewed(CHAT_E)).toBe(false);
    expect(isUnreviewed(CHAT_F)).toBe(false);
  });

  it('matches each filter against the whole page', () => {
    const listed = (filter: ChatFilter, unread: boolean): string[] =>
      SESSIONS.filter((session) => chatFilterMatches(filter, session, unread)).map(
        (session) => session.id,
      );

    expect(listed('all', true)).toEqual([A, B, C, D, F]);
    expect(listed('repo', true)).toEqual([B, C, F]);
    expect(listed('schedule', true)).toEqual([D]);
    expect(listed('unread', true)).toEqual([A, B, C, D, F]);
    expect(listed('unread', false)).toEqual([]);
    expect(listed('archived', true)).toEqual([E]);
  });

  it('builds the row copy for a repository chat', () => {
    expect(
      buildChatRow(CHAT_B, {
        repoSlug: 'owner/alpha',
        unread: true,
        unreviewed: true,
        locale: 'en',
      }),
    ).toEqual({
      id: B,
      title: 'Alpha refactor',
      preview: 'Refactored the module',
      scope: 'repo',
      scopeLabel: 'owner/alpha',
      costLabel: '$0.42',
      contextLabel: '12.4K ctx',
      status: 'idle',
      statusLabel: 'Idle',
      unread: true,
      unreviewed: true,
      unreadLabel: 'Unread',
      unreviewedLabel: 'Not reviewed',
    });
  });

  it('falls back to the generic labels when the contract carries nothing', () => {
    const free = buildChatRow(CHAT_A, {
      repoSlug: null,
      unread: false,
      unreviewed: false,
      locale: 'es',
    });
    expect(free.scopeLabel).toBe('Libre');
    expect(free.costLabel).toBeNull();
    expect(free.contextLabel).toBeNull();
    expect(free.status).toBe('idle');

    const legacy = buildChatRow(CHAT_F, {
      repoSlug: null,
      unread: false,
      unreviewed: false,
      locale: 'en',
    });
    expect(legacy.scope).toBe('repo');
    expect(legacy.scopeLabel).toBe('Repo');
    expect(legacy.costLabel).toBeNull();
    expect(legacy.contextLabel).toBeNull();

    const silent = buildChatRow(
      { ...CHAT_B, lastMessage: { ...message(B, 'assistant', TS, ''), text: '' } },
      { repoSlug: 'owner/alpha', unread: false, unreviewed: false, locale: 'en' },
    );
    expect(silent.preview).toBe('No messages yet');
  });

  it('formats money and tokens the way the rest of the app does', () => {
    expect(formatCost(0.42)).toBe('$0.42');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatContextTokens(12400)).toBe('12.4K');
    expect(formatContextTokens(95000)).toBe('95K');
  });

  it('freezes the filter order', () => {
    expect([...CHAT_FILTERS]).toEqual(['all', 'repo', 'schedule', 'unread', 'archived']);
  });
});

describe('ChatReadStore', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  async function readStore(secure: SecureStore = memoryStore()): Promise<ChatReadStore> {
    await TestBed.configureTestingModule({
      providers: [{ provide: SECURE_STORE, useValue: secure }],
    }).compileComponents();
    return TestBed.inject(ChatReadStore);
  }

  it('persists a marker under cb.chatRead and reads it back after a reload', async () => {
    const secure = memoryStore();
    const first = await readStore(secure);
    expect(first.loaded()).toBe(false);
    await first.load();
    expect(first.loaded()).toBe(true);

    first.markRead(A, '2026-10-27T10:00:00Z');

    expect(await secure.get(CHAT_READ_KEY)).toBe(JSON.stringify({ [A]: '2026-10-27T10:00:00Z' }));

    TestBed.resetTestingModule();
    const second = await readStore(secure);
    await second.load();

    expect(second.readAt(A)).toBe('2026-10-27T10:00:00Z');
    expect(second.readAt(B)).toBeNull();
  });

  it('returns a frozen snapshot', async () => {
    const store = await readStore();
    await store.load();
    store.markRead(A, TS);

    const snapshot = store.snapshot();
    expect(snapshot).toEqual({ [A]: TS });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('ignores a blob that is not a marker map', async () => {
    const broken = memoryStore();
    await broken.set(CHAT_READ_KEY, 'not json');
    const store = await readStore(broken);
    await store.load();

    expect(store.snapshot()).toEqual({});
    expect(store.loaded()).toBe(true);
  });

  it('keeps only the string timestamps', async () => {
    const partial = memoryStore();
    await partial.set(
      CHAT_READ_KEY,
      JSON.stringify({ [A]: '2026-10-27T10:00:00Z', [B]: 42, [C]: 'nope' }),
    );
    const store = await readStore(partial);
    await store.load();

    expect(store.snapshot()).toEqual({ [A]: '2026-10-27T10:00:00Z' });
  });

  it('survives a secure store that throws', async () => {
    const store = await readStore({
      get: () => Promise.reject(new Error('closed')),
      set: () => Promise.reject(new Error('closed')),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    });
    await store.load();

    expect(store.snapshot()).toEqual({});
    expect(store.loaded()).toBe(true);
    expect(() => store.markRead(A, TS)).not.toThrow();
  });

  it('keeps at most 200 markers and drops the oldest', async () => {
    const secure = memoryStore();
    const seeded: Record<string, string> = {};
    for (let index = 0; index < 205; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0');
      seeded[`chat_k${String(index).padStart(6, '0')}`] = `2026-09-${day}T00:00:${String(
        index % 60,
      ).padStart(2, '0')}Z`;
    }
    await secure.set(CHAT_READ_KEY, JSON.stringify(seeded));

    const store = await readStore(secure);
    await store.load();
    store.markRead(A, '2026-10-27T12:00:00Z');

    const snapshot = store.snapshot();
    expect(Object.keys(snapshot)).toHaveLength(200);
    expect(snapshot[A]).toBe('2026-10-27T12:00:00Z');
    expect(store.readAt('chat_k000000')).toBeNull();
  });
});

describe('ChatListStore', () => {
  let http: HttpTestingController;
  let router: Router;
  let read: ChatReadStore;
  let store: ChatListStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: SECURE_STORE, useValue: memoryStore() },
        { provide: I18nService, useValue: { locale: signal<Locale>('en') } },
        ChatListStore,
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    store = TestBed.inject(ChatListStore);
    read = TestBed.inject(ChatReadStore);
    await read.load();
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  async function loadPage(
    sessions: readonly ChatSession[] = SESSIONS,
    repos: readonly Repo[] = [REPO],
  ): Promise<void> {
    store.load();
    http.expectOne((request) => request.url === REPOS_URL).flush(page(repos));
    await tick();
    http.expectOne((request) => request.url === SESSIONS_URL).flush(page(sessions));
  }

  function ids(): string[] {
    return store.rows().map((row) => row.id);
  }

  it('fetches one page of sessions and the repositories with the page limit', async () => {
    store.load();

    const repos = http.expectOne((request) => request.url === REPOS_URL);
    expect(repos.request.params.get('limit')).toBe('200');
    repos.flush(page([REPO]));
    await tick();

    const sessions = http.expectOne((request) => request.url === SESSIONS_URL);
    expect(sessions.request.params.get('limit')).toBe('50');
    expect(sessions.request.params.get('repoId')).toBeNull();
    expect(store.loading()).toBe(true);

    sessions.flush(page(SESSIONS));

    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.sessions()).toEqual(SESSIONS);
    expect(store.total()).toBe(6);
  });

  it('keeps the server order and lists the whole page on All', async () => {
    await loadPage();

    expect(ids()).toEqual([A, B, C, D, F]);
  });

  it('filters in memory over the fetched page', async () => {
    await loadPage();

    store.setFilter('repo');
    expect(ids()).toEqual([B, C, F]);

    store.setFilter('schedule');
    expect(ids()).toEqual([D]);

    store.setFilter('archived');
    expect(ids()).toEqual([E]);

    store.setFilter('unread');
    expect(ids()).toEqual([A, B, C, D]);

    read.markRead(C, '2026-10-27T08:00:00Z');
    expect(ids()).toEqual([A, B, D]);
  });

  it('never re-queries the server for a filter or a search change', async () => {
    await loadPage();

    store.setFilter('archived');
    store.setSearch('x');

    http.expectNone((request) => request.url === SESSIONS_URL);
    http.expectNone((request) => request.url === REPOS_URL);
  });

  it('searches the title and the last message, and composes with the filter', async () => {
    await loadPage();

    store.setSearch('ALPHA');
    expect(ids()).toEqual([B]);

    store.setFilter('schedule');
    expect(ids()).toEqual([]);

    store.setSearch('');
    expect(ids()).toEqual([D]);

    store.setFilter('all');
    store.setSearch('nightly pass');
    expect(ids()).toEqual([D]);
  });

  it('carries the two signals into the row view', async () => {
    await loadPage();

    const byId = new Map(store.rows().map((row) => [row.id, row]));
    expect(byId.get(B)?.unread).toBe(true);
    expect(byId.get(B)?.unreviewed).toBe(true);
    expect(byId.get(C)?.unread).toBe(true);
    expect(byId.get(C)?.unreviewed).toBe(false);
    expect(byId.get(A)?.unreviewed).toBe(false);
    expect(byId.get(F)?.scopeLabel).toBe('owner/alpha');

    read.markRead(C, '2026-10-27T08:00:00Z');
    const reviewed = new Map(store.rows().map((row) => [row.id, row]));
    expect(reviewed.get(C)?.unread).toBe(false);
  });

  it('marks a chat read at its last message and ignores an unknown id', async () => {
    await loadPage();

    store.markRead(A);
    expect(read.readAt(A)).toBe('2026-10-27T09:00:00Z');

    store.markRead(UNKNOWN);
    expect(read.snapshot()).toEqual({ [A]: '2026-10-27T09:00:00Z' });
  });

  it('moves a chat that just spoke to the top of the list', async () => {
    await loadPage();

    expect(store.applyStreamEvent(chatMessage(D, TS, 'fresh reply'))).toBe('applied');

    expect(ids()).toEqual([D, A, B, C, F]);
    expect(store.sessions()[0]?.lastMessage?.text).toBe('fresh reply');
    expect(store.rows()[0]?.unread).toBe(true);
    expect(store.rows()[0]?.preview).toBe('fresh reply');
  });

  it('ignores a frame for an unknown chat and a non message frame', async () => {
    await loadPage();
    const before = store.sessions();

    expect(store.applyStreamEvent(chatMessage(UNKNOWN, TS, 'elsewhere'))).toBe('ignored');
    expect(store.sessions()).toBe(before);

    expect(
      store.applyStreamEvent({
        event: 'chat.delta',
        data: { chatId: D, seq: 5, delta: 'x', ts: TS },
      }),
    ).toBe('ignored');
    expect(store.sessions()).toBe(before);
  });

  it('creates a free chat without a repository and navigates once', async () => {
    await loadPage(SESSIONS, []);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    store.startChat();
    const request = http.expectOne({ method: 'POST', url: SESSIONS_URL });

    expect(request.request.body).toEqual({});
    expect(store.creating()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();

    request.flush(CREATED_SESSION, { status: 201, statusText: 'Created' });

    expect(store.creating()).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/chat', CREATED_CHAT]);
  });

  it('records a session list failure as an ApiError', async () => {
    store.load();
    http.expectOne((request) => request.url === REPOS_URL).flush(page([REPO]));
    await tick();
    http
      .expectOne((request) => request.url === SESSIONS_URL)
      .flush(
        { error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
        { status: 500, statusText: 'Server Error' },
      );

    expect(store.error()).toBeInstanceOf(ApiError);
    expect(store.error()?.code).toBe('internal');
    expect(store.sessions()).toEqual([]);
    expect(store.loading()).toBe(false);
  });

  it('keeps the list alive when the repositories cannot be read', async () => {
    store.load();
    http
      .expectOne((request) => request.url === REPOS_URL)
      .flush(
        { error: { code: 'not_found', message: 'Missing', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
        { status: 404, statusText: 'Not Found' },
      );
    await tick();
    http.expectOne((request) => request.url === SESSIONS_URL).flush(page(SESSIONS));

    expect(store.repos()).toEqual([]);
    expect(store.sessions()).toEqual(SESSIONS);
    expect(store.error()).toBeNull();
    expect(store.rows()[0]?.scopeLabel).toBe('Free');
  });

  it('reloads the page on demand', async () => {
    await loadPage();
    await loadPage([CHAT_B], [REPO]);

    expect(store.repos()).toEqual([REPO]);
    expect(store.sessions()).toEqual([CHAT_B]);
  });
});

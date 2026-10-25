import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { ChatSession, Page, Repo, SseStreamEvent } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { ChatListStore } from './chat-list.store';

const TS = '2026-10-24T18:04:02Z';
const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const CHAT = 'chat_01JABCDEFGHJKMNPQRSV';

const REPO: Repo = {
  id: REPO_ID,
  slug: 'owner/repo',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: [],
  enabled: true,
  createdAt: TS,
};

const SESSION: ChatSession = {
  id: CHAT,
  repoId: REPO_ID,
  title: 'First chat',
  status: 'idle',
  createdAt: TS,
  updatedAt: TS,
  lastMessage: null,
};

const REPOS_URL = '/v1/repos';
const SESSIONS_URL = '/v1/chat/sessions';

function page<T>(data: readonly T[]): Page<T> {
  return { data: [...data], nextCursor: null };
}

function chatMessage(text: string, chatId: string = CHAT): SseStreamEvent {
  return {
    event: 'chat.message',
    data: {
      chatId,
      seq: 4,
      ts: TS,
      message: {
        id: 'msg_01JABCDEFGHJKMNPQRSV',
        chatId,
        role: 'assistant',
        text,
        createdAt: TS,
      },
    },
  };
}

describe('ChatListStore', () => {
  let http: HttpTestingController;
  let router: Router;
  let store: ChatListStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ChatListStore,
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    store = TestBed.inject(ChatListStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function load(
    repos: Page<Repo> = page([REPO]),
    sessions: Page<ChatSession> = page([SESSION]),
  ): void {
    store.load();
    http.expectOne((request) => request.url === REPOS_URL).flush(repos);
    http.expectOne((request) => request.url === SESSIONS_URL).flush(sessions);
  }

  it('loads the repositories and the sessions', () => {
    expect(store.loading()).toBe(false);
    load();

    expect(store.repos()).toEqual([REPO]);
    expect(store.sessions()).toEqual([SESSION]);
    expect(store.error()).toBeNull();
  });

  it('requests the repositories with the page limit', () => {
    store.load();

    const request = http.expectOne((candidate) => candidate.url === REPOS_URL);
    expect(request.request.params.get('limit')).toBe('200');
    request.flush(page([REPO]));
    http.expectOne((candidate) => candidate.url === SESSIONS_URL).flush(page([SESSION]));
  });

  it('reloads the sessions of one repository and ignores a repeated filter', () => {
    load();

    store.setRepoFilter(REPO_ID);
    const filtered = http.expectOne(
      (candidate) => candidate.url === SESSIONS_URL && candidate.method === 'GET',
    );
    expect(filtered.request.params.get('repoId')).toBe(REPO_ID);
    filtered.flush(page<ChatSession>([]));

    expect(store.repoFilter()).toBe(REPO_ID);
    expect(store.sessions()).toEqual([]);

    store.setRepoFilter(REPO_ID);
    http.expectNone((candidate) => candidate.url === SESSIONS_URL);
  });

  it('keeps the list alive when the repositories cannot be read', () => {
    store.load();
    http
      .expectOne((request) => request.url === REPOS_URL)
      .flush(
        { error: { code: 'not_found', message: 'Missing', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
        { status: 404, statusText: 'Not Found' },
      );
    http.expectOne((request) => request.url === SESSIONS_URL).flush(page([SESSION]));

    expect(store.repos()).toEqual([]);
    expect(store.sessions()).toEqual([SESSION]);
    expect(store.error()).toBeNull();
  });

  it('records a session list failure as an ApiError', () => {
    store.load();
    http.expectOne((request) => request.url === REPOS_URL).flush(page([REPO]));
    http
      .expectOne((request) => request.url === SESSIONS_URL)
      .flush(
        { error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
        { status: 500, statusText: 'Server Error' },
      );

    expect(store.error()).toBeInstanceOf(ApiError);
    expect(store.sessions()).toEqual([]);
    expect(store.loading()).toBe(false);
  });

  it('does not create a session while there is no repository', () => {
    load(page<Repo>([]), page<ChatSession>([]));
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    store.startChat();

    http.expectNone({ method: 'POST', url: SESSIONS_URL });
    expect(navigate).not.toHaveBeenCalled();
    expect(store.creating()).toBe(false);
  });

  it('creates a session for the first repository and navigates after the 201', () => {
    load();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    store.startChat();

    const request = http.expectOne({ method: 'POST', url: SESSIONS_URL });
    expect(request.request.body).toEqual({ repoId: REPO_ID });
    expect(store.creating()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();

    request.flush(SESSION, { status: 201, statusText: 'Created' });

    expect(store.creating()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/chat', CHAT]);
  });

  it('updates a row preview from a chat.message event and ignores the rest', () => {
    load();

    expect(store.applyStreamEvent(chatMessage('fresh reply'))).toBe('applied');
    expect(store.sessions()[0]?.lastMessage?.text).toBe('fresh reply');

    expect(store.applyStreamEvent(chatMessage('elsewhere', 'chat_01JABCDEFGHJKMNPQRSW'))).toBe(
      'ignored',
    );

    expect(
      store.applyStreamEvent({
        event: 'chat.delta',
        data: { chatId: CHAT, seq: 5, delta: 'x', ts: TS },
      }),
    ).toBe('ignored');
  });
});

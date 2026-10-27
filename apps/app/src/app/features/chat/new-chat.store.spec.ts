import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ChatMessage, ChatSession, Repo } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NewChatStore } from './new-chat.store';

const TS = '2026-10-27T11:00:00Z';
const SESSIONS_URL = '/v1/chat/sessions';
const REPOS_URL = '/v1/repos';

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

const FREE: ChatSession = {
  id: 'chat_01JABCDEFGHJKMNPQRSV',
  repoId: null,
  kind: 'free',
  title: 'New chat',
  status: 'idle',
  createdAt: TS,
  updatedAt: TS,
  lastMessage: null,
};

const BOUND: ChatSession = {
  ...FREE,
  repoId: REPO.id,
  kind: 'repo',
  title: 'acme/widgets',
};

const MESSAGE: ChatMessage = {
  id: 'msg_01JABCDEFGHJKMNPQRSV',
  chatId: FREE.id,
  role: 'user',
  text: 'hello',
  createdAt: TS,
};

const MESSAGES_URL = `${SESSIONS_URL}/${FREE.id}/messages`;
const BIND_URL = `${SESSIONS_URL}/${FREE.id}/repo`;

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

describe('NewChatStore', () => {
  let http: HttpTestingController;
  let store: NewChatStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), NewChatStore],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(NewChatStore);
  });

  afterEach(() => {
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('offers exactly the two proposals and touches the network only when told to', () => {
    expect(store.proposals()).toEqual(['repository', 'schedule']);
    expect(store.repos()).toEqual([]);
    expect(store.reposLoading()).toBe(false);
    expect(store.busy()).toBe(false);
    expect(http.match(() => true)).toHaveLength(0);
  });

  it('loads the repository page on demand', () => {
    store.loadRepos();

    expect(store.reposLoading()).toBe(true);
    http
      .expectOne((request) => request.url === REPOS_URL)
      .flush({ data: [REPO], nextCursor: null });

    expect(store.reposLoading()).toBe(false);
    expect(store.repos()).toEqual([REPO]);
    expect(store.reposUnavailable()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('marks the repository read unavailable without an error banner', () => {
    store.loadRepos();
    http
      .expectOne((request) => request.url === REPOS_URL)
      .flush(envelope('internal'), { status: 500, statusText: 'Server Error' });

    expect(store.repos()).toEqual([]);
    expect(store.reposUnavailable()).toBe(true);
    expect(store.reposLoading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('creates the free session first and then posts the trimmed draft once', () => {
    store.setDraft('  hello  ');
    store.createFree();

    expect(store.busy()).toBe(true);
    const create = http.expectOne({ method: 'POST', url: SESSIONS_URL });
    expect(create.request.body).toEqual({});
    create.flush(FREE, { status: 201, statusText: 'Created' });
    expect(store.created()).toEqual(FREE);

    const sent = http.expectOne({ method: 'POST', url: MESSAGES_URL });
    expect(sent.request.body).toEqual({ text: 'hello' });
    expect(store.busy()).toBe(true);
    sent.flush(MESSAGE);

    expect(store.busy()).toBe(false);
    expect(store.draft()).toBe('');
    expect(store.error()).toBeNull();
  });

  it('creates the session and posts nothing for a blank draft', () => {
    store.setDraft('   ');
    store.createFree();

    http.expectOne({ method: 'POST', url: SESSIONS_URL }).flush(FREE, {
      status: 201,
      statusText: 'Created',
    });

    http.expectNone({ method: 'POST', url: MESSAGES_URL });
    expect(store.busy()).toBe(false);
    expect(store.created()).toEqual(FREE);
  });

  it('keeps the draft when the create fails', () => {
    store.setDraft('keep me');
    store.createFree();
    http
      .expectOne({ method: 'POST', url: SESSIONS_URL })
      .flush(envelope('internal'), { status: 500, statusText: 'Server Error' });

    expect(store.error()?.status).toBe(500);
    expect(store.draft()).toBe('keep me');
    expect(store.busy()).toBe(false);
    expect(store.created()).toBeNull();
    http.expectNone({ method: 'POST', url: MESSAGES_URL });
  });

  it('converts with one create carrying the repoId and hands the session off', () => {
    store.connect(REPO.id);

    expect(store.busy()).toBe(true);
    expect(store.busyRepoId()).toBe(REPO.id);
    expect(store.converting()).toBe(true);
    const create = http.expectOne({ method: 'POST', url: SESSIONS_URL });
    expect(create.request.body).toEqual({ repoId: REPO.id });
    create.flush(BOUND, { status: 201, statusText: 'Created' });

    expect(store.busy()).toBe(false);
    expect(store.busyRepoId()).toBeNull();
    expect(store.converting()).toBe(false);
    expect(store.handoff()).toEqual(BOUND);
    expect(store.error()).toBeNull();
  });

  it('reports a bound chat as a conflict and emits nothing', () => {
    store.connect(REPO.id);
    http
      .expectOne({ method: 'POST', url: SESSIONS_URL })
      .flush(envelope('conflict', { reason: 'chat_already_bound' }), {
        status: 409,
        statusText: 'Conflict',
      });

    expect(store.handoff()).toBeNull();
    expect(store.error()?.code).toBe('conflict');
    expect(store.error()?.details?.['reason']).toBe('chat_already_bound');
    expect(store.busy()).toBe(false);
    expect(store.busyRepoId()).toBeNull();
  });

  it('binds a free chat with one request to the repo route', () => {
    store.bind(FREE.id, REPO.id);

    const bind = http.expectOne({ method: 'POST', url: BIND_URL });
    expect(bind.request.body).toEqual({ repoId: REPO.id });
    bind.flush(BOUND);

    expect(store.handoff()).toEqual(BOUND);
    expect(store.busy()).toBe(false);
    expect(store.busyRepoId()).toBeNull();
  });

  it('refuses a second request while one is in flight', () => {
    store.connect(REPO.id);
    store.connect(REPO.id);
    store.createFree();

    const create = http.expectOne({ method: 'POST', url: SESSIONS_URL });
    create.flush(BOUND, { status: 201, statusText: 'Created' });
    http.expectNone({ method: 'POST', url: SESSIONS_URL });
  });

  it('does not guard a new conversion once the first settled', () => {
    store.connect(REPO.id);
    http
      .expectOne({ method: 'POST', url: SESSIONS_URL })
      .flush(BOUND, { status: 201, statusText: 'Created' });

    store.connect(REPO.id);
    http
      .expectOne({ method: 'POST', url: SESSIONS_URL })
      .flush(BOUND, { status: 201, statusText: 'Created' });

    expect(store.handoff()).toEqual(BOUND);
  });
});

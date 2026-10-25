import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { ChatMessage, ChatSession, Run, SseStreamEvent } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { ChatStore } from './chat.store';

const TS = '2026-10-24T18:04:02Z';
const CHAT = 'chat_01JABCDEFGHJKMNPQRSV';
const REPO = 'repo_01JABCDEFGHJKMNPQRSV';
const APPROVAL = 'apv_01JABCDEFGHJKMNPQRSV';
const RUN_ID = 'run_01JABCDEFGHJKMNPQRSV';

const SESSION: ChatSession = {
  id: CHAT,
  repoId: REPO,
  title: 'Chat',
  status: 'idle',
  createdAt: TS,
  updatedAt: TS,
  lastMessage: null,
};

const ASSISTANT: ChatMessage = {
  id: 'msg_01JABCDEFGHJKMNPQRSV',
  chatId: CHAT,
  role: 'assistant',
  text: 'done',
  createdAt: '2026-10-24T18:00:01Z',
};

const USER: ChatMessage = {
  id: 'msg_01JABCDEFGHJKMNPQRSW',
  chatId: CHAT,
  role: 'user',
  text: 'hello',
  createdAt: '2026-10-24T18:00:02Z',
};

const RUN: Run = {
  id: RUN_ID,
  repoId: REPO,
  jobId: null,
  state: 'queued',
  trigger: 'promote',
  branch: 'cb/run-x',
  baseRef: 'main',
  pr: null,
  gate: null,
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
  createdAt: TS,
  finishedAt: null,
};

const SESSION_URL = `/v1/chat/sessions/${CHAT}`;
const MESSAGES_URL = `${SESSION_URL}/messages`;
const PROMOTE_URL = `${SESSION_URL}/promote`;
const REPLY_URL = `/v1/approvals/${APPROVAL}/reply`;

function page(...messages: readonly ChatMessage[]): { data: ChatMessage[]; nextCursor: null } {
  return { data: [...messages], nextCursor: null };
}

function delta(seq: number, text: string): SseStreamEvent {
  return { event: 'chat.delta', data: { chatId: CHAT, seq, delta: text, ts: TS } };
}

function permission(seq: number): SseStreamEvent {
  return {
    event: 'chat.permission',
    data: { chatId: CHAT, seq, approvalId: APPROVAL, tool: 'bash', title: 'Run ls', ts: TS },
  };
}

describe('ChatStore', () => {
  let http: HttpTestingController;
  let router: Router;
  let store: ChatStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), ChatStore],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    store = TestBed.inject(ChatStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function load(messages: { data: ChatMessage[]; nextCursor: null } = page(ASSISTANT)): void {
    store.load(CHAT);
    http.expectOne(SESSION_URL).flush(SESSION);
    http.expectOne((request) => request.url === MESSAGES_URL).flush(messages);
  }

  it('loads the session and the first page of messages', () => {
    expect(store.loading()).toBe(true);
    load();

    expect(store.loading()).toBe(false);
    expect(store.chatId()).toBe(CHAT);
    expect(store.session()).toEqual(SESSION);
    expect(store.stream().messages).toHaveLength(1);
    expect(store.error()).toBeNull();
  });

  it('keeps the draft until the 202 returns the persisted message', () => {
    load();
    store.setDraft('hello');
    store.send();

    const request = http.expectOne({ method: 'POST', url: MESSAGES_URL });
    expect(request.request.body).toEqual({ text: 'hello' });
    expect(store.draft()).toBe('hello');
    expect(store.busy()).toBe('send');

    request.flush(USER, { status: 202, statusText: 'Accepted' });

    expect(store.draft()).toBe('');
    expect(store.busy()).toBeNull();
    expect(store.stream().messages.map((item) => item.key)).toContain(`msg:${USER.id}`);
  });

  it('does nothing on an empty draft', () => {
    load();
    store.setDraft('   ');
    store.send();

    http.expectNone({ method: 'POST', url: MESSAGES_URL });
    expect(store.busy()).toBeNull();
  });

  it('reports canInterrupt only after a delta sets working', () => {
    load();
    expect(store.canInterrupt()).toBe(false);

    expect(store.applyStreamEvent(delta(1, 'a'))).toBe('applied');

    expect(store.canInterrupt()).toBe(true);
    expect(store.stream().working).toBe(true);
  });

  it('refetches on a gap frame', () => {
    load();
    expect(
      store.applyStreamEvent({ event: 'gap', data: { afterId: 1, latestId: 9, ts: TS } }),
    ).toBe('refetch');
  });

  it('promotes once with an idempotency key and navigates after the response', () => {
    load();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    store.promote();
    store.promote();

    const request = http.expectOne({ method: 'POST', url: PROMOTE_URL });
    expect(request.request.headers.get('Idempotency-Key')).toMatch(
      new RegExp(`^promote-${CHAT}-\\d+$`),
    );
    expect(navigate).not.toHaveBeenCalled();

    request.flush(RUN, { status: 202, statusText: 'Accepted' });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/runs', RUN_ID]);
  });

  it('leaves the permission card live and sets the error when the reply fails', () => {
    load();
    store.applyStreamEvent(permission(2));

    store.resolvePermission(APPROVAL, { decision: 'allow', scope: 'session' });

    http.expectOne({ method: 'POST', url: REPLY_URL }).flush(
      {
        error: {
          code: 'conflict',
          message: 'Already answered',
          requestId: 'req_01JABCDEFGHJKMNPQRSV',
          details: { reason: 'approval_already_answered' },
        },
      },
      { status: 409, statusText: 'Conflict' },
    );

    expect(store.stream().permissions[0]?.answered).toBe(false);
    expect(store.error()).toBeInstanceOf(ApiError);
    expect(store.busy()).toBeNull();
  });

  it('marks the card answered only after a successful reply', () => {
    load();
    store.applyStreamEvent(permission(2));

    store.resolvePermission(APPROVAL, { decision: 'deny', scope: 'once' });

    expect(store.stream().permissions[0]?.answered).toBe(false);

    http.expectOne({ method: 'POST', url: REPLY_URL }).flush({
      id: APPROVAL,
      state: 'denied',
      tool: 'bash',
      title: 'Run ls',
      runId: null,
      chatId: CHAT,
      input: {},
      createdAt: TS,
      expiresAt: TS,
      resolvedAt: TS,
    });

    expect(store.stream().permissions[0]?.answered).toBe(true);
    expect(store.error()).toBeNull();
  });

  it('reloads the session and the messages without dropping the stream', () => {
    load();
    store.applyStreamEvent(delta(3, 'tail'));

    store.reload();
    http.expectOne(SESSION_URL).flush(SESSION);
    http.expectOne((request) => request.url === MESSAGES_URL).flush(page(ASSISTANT, USER));

    expect(store.stream().messages.map((item) => item.key)).toEqual([
      `msg:${ASSISTANT.id}`,
      `msg:${USER.id}`,
      `stream:${CHAT}`,
    ]);
  });
});

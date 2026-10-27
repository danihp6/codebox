import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type {
  ChatMessage,
  ChatSession,
  ReminderRoutine,
  Repo,
  Run,
  SseStreamEvent,
} from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { ChatRunLink } from './chat-store';
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
const ROUTINES_URL = '/v1/routines?limit=10';
const REPOS_URL = '/v1/repos?limit=200';
const RUN_URL = `/v1/runs/${RUN_ID}`;
const OTHER_RUN_ID = 'run_01JABCDEFGHJKMNPQRSW';
const PR_URL = 'https://github.com/o/r/pull/42';

const RUN_WITH_CARDS: Run = {
  ...RUN,
  state: 'pr_open',
  gate: { status: 'passed', exitCode: 0, durationMs: 900 },
  pr: { number: 42, url: PR_URL, mergeable: true },
};

const REPO_ROW: Repo = {
  id: REPO,
  slug: 'acme/widgets',
  defaultBranch: 'trunk',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: [],
  enabled: true,
  createdAt: TS,
};

const REMINDER: ReminderRoutine = {
  id: 'rtn_01JABCDEFGHJKMNPQRSV',
  kind: 'reminder',
  title: 'Stand up',
  cron: '0 7 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  notify: true,
  createdAt: TS,
  nextFireAt: '2026-10-25T06:00:00Z',
  lastFiredAt: null,
};

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

function routineTool(seq: number, status: 'ok' | 'error' | 'start'): SseStreamEvent {
  return {
    event: 'chat.tool',
    data: { chatId: CHAT, seq, tool: 'routine.create', status, ts: TS },
  };
}

function gateFrame(
  seq: number,
  status: 'passed' | 'failed' | 'skipped',
  runId: string = RUN_ID,
): SseStreamEvent {
  return {
    event: 'run.gate',
    data: {
      runId,
      seq,
      ts: TS,
      gate: { status, exitCode: status === 'passed' ? 0 : 2, durationMs: 900 },
    },
  };
}

function prFrame(seq: number): SseStreamEvent {
  return {
    event: 'run.pr',
    data: { runId: RUN_ID, seq, ts: TS, pr: { number: 42, url: PR_URL, mergeable: true } },
  };
}

function mergedFrame(seq: number): SseStreamEvent {
  return {
    event: 'run.merged',
    data: {
      runId: RUN_ID,
      seq,
      ts: TS,
      pr: { number: 42, url: PR_URL, mergeable: true },
      mergeCommit: 'a'.repeat(40),
      method: 'squash',
    },
  };
}

describe('ChatStore', () => {
  let http: HttpTestingController;
  let router: Router;
  let store: ChatStore;
  let link: ChatRunLink;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), ChatStore],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    store = TestBed.inject(ChatStore);
    link = TestBed.inject(ChatRunLink);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function load(
    messages: { data: ChatMessage[]; nextCursor: null } = page(ASSISTANT),
    session: ChatSession = SESSION,
  ): void {
    store.load(CHAT);
    http.expectOne(SESSION_URL).flush(session);
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

  it('confirms the promote once, remembers the run and then navigates', () => {
    load();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    store.confirmPromote();
    store.confirmPromote();

    const request = http.expectOne({ method: 'POST', url: PROMOTE_URL });
    expect(request.request.headers.get('Idempotency-Key')).toMatch(
      new RegExp(`^promote-${CHAT}-\\d+$`),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(link.runIdFor(CHAT)).toBeNull();

    request.flush(RUN, { status: 202, statusText: 'Accepted' });

    expect(link.runIdFor(CHAT)).toBe(RUN_ID);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/runs', RUN_ID]);
  });

  it('keeps the promote confirmation open when the promote fails', () => {
    load();
    store.openPromote();
    http.expectOne(REPOS_URL).flush({ data: [], nextCursor: null });

    store.confirmPromote();
    http.expectOne({ method: 'POST', url: PROMOTE_URL }).flush(
      {
        error: {
          code: 'conflict',
          message: 'Not a repo chat',
          requestId: 'req_01JABCDEFGHJKMNPQRSV',
          details: { reason: 'chat_not_repo' },
        },
      },
      { status: 409, statusText: 'Conflict' },
    );

    expect(store.promoting()).toBe(true);
    expect(store.error()).toBeInstanceOf(ApiError);
    expect(store.busy()).toBeNull();
    expect(link.runIdFor(CHAT)).toBeNull();
  });

  it('opens the promote confirmation with the repo, base branch and last prompt', () => {
    load();
    expect(store.promoteTarget()).toBeNull();

    store.openPromote();
    store.openPromote();

    expect(store.promoting()).toBe(true);
    const request = http.expectOne(REPOS_URL);
    request.flush({ data: [REPO_ROW], nextCursor: null });

    expect(store.promoteTarget()).toEqual({
      repoSlug: 'acme/widgets',
      baseBranch: 'trunk',
      prompt: 'done',
    });

    store.openPromote();
    http.expectNone(REPOS_URL);

    store.cancelPromote();
    expect(store.promoting()).toBe(false);
  });

  it('offers promote only for a repo chat whose last item is an assistant message', () => {
    load();
    expect(store.canPromote()).toBe(true);

    expect(store.applyStreamEvent(delta(2, 'thinking'))).toBe('applied');
    expect(store.canPromote()).toBe(false);
  });

  it('refuses promote for a free chat and for a chat without a repository', () => {
    load(page(ASSISTANT), { ...SESSION, kind: 'free', repoId: null });
    expect(store.canPromote()).toBe(false);

    load(page(ASSISTANT), { ...SESSION, repoId: null });
    expect(store.canPromote()).toBe(false);
  });

  it('reads the promoted run back from the in-memory link', () => {
    link.remember(CHAT, RUN_ID);
    load();

    const request = http.expectOne(RUN_URL);
    expect(request.request.method).toBe('GET');
    request.flush(RUN_WITH_CARDS);

    expect(store.run()?.id).toBe(RUN_ID);
    expect(store.stream().system.map((card) => card.kind)).toEqual(['gate', 'pr']);
  });

  it('renders the gate and PR cards from the run frames it accepts', () => {
    load();
    expect(store.applyRunEvent(gateFrame(1, 'passed'))).toBe('ignored');

    store.run.set(RUN);
    expect(store.applyRunEvent(gateFrame(1, 'failed'))).toBe('applied');
    expect(store.run()?.gate?.status).toBe('failed');
    expect(store.stream().system.map((card) => card.key)).toEqual([`gate:${RUN_ID}`]);

    expect(store.applyRunEvent(prFrame(2))).toBe('applied');
    expect(store.stream().system.map((card) => card.key)).toEqual([
      `gate:${RUN_ID}`,
      `pr:${RUN_ID}`,
    ]);

    expect(store.applyRunEvent(mergedFrame(3))).toBe('applied');
    expect(store.run()?.state).toBe('succeeded');
    expect(store.stream().system[1]?.status).toBe('merged');
  });

  it('ignores a run frame for another run and never treats it as a chat frame', () => {
    load();
    store.run.set(RUN);

    expect(store.applyRunEvent(gateFrame(4, 'passed', OTHER_RUN_ID))).toBe('ignored');
    expect(store.stream().system).toHaveLength(0);
    expect(store.applyRunEvent(delta(4, 'x'))).toBe('ignored');
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

  it('corroborates a created routine from the routines list exactly once', () => {
    load();

    expect(store.applyStreamEvent(routineTool(7, 'ok'))).toBe('applied');

    const request = http.expectOne(ROUTINES_URL);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [REMINDER], nextCursor: null });

    expect(store.stream().routines.map((card) => card.routine.id)).toEqual([REMINDER.id]);
    expect(store.stream().routines[0]?.key).toBe(`routine:${REMINDER.id}`);

    store.applyStreamEvent(routineTool(7, 'ok'));
    http.expectNone(ROUTINES_URL);
    expect(store.stream().routines).toHaveLength(1);
  });

  it('does not look up a routine when the tool failed', () => {
    load();

    store.applyStreamEvent(routineTool(8, 'error'));

    http.expectNone(ROUTINES_URL);
    expect(store.stream().routines).toHaveLength(0);
  });

  it('sets the error and keeps the messages when the routine lookup fails', () => {
    load();

    store.applyStreamEvent(routineTool(9, 'ok'));
    http.expectOne(ROUTINES_URL).flush(
      {
        error: {
          code: 'internal',
          message: 'Boom',
          requestId: 'req_01JABCDEFGHJKMNPQRSV',
        },
      },
      { status: 500, statusText: 'Internal Server Error' },
    );

    expect(store.error()).toBeInstanceOf(ApiError);
    expect(store.stream().messages).toHaveLength(1);
    expect(store.stream().routines).toHaveLength(0);
  });
});

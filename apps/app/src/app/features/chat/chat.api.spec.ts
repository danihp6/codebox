import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Approval, ChatMessage, ChatSession, Run } from '@codebox/contracts';
import { catchError, firstValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { ChatApi } from './chat.api';

const TS = '2026-10-24T18:04:02Z';
const CHAT = 'chat_01JABCDEFGHJKMNPQRSV';
const REPO = 'repo_01JABCDEFGHJKMNPQRSV';
const APPROVAL = 'apv_01JABCDEFGHJKMNPQRSV';

const MESSAGE: ChatMessage = {
  id: 'msg_01JABCDEFGHJKMNPQRSV',
  chatId: CHAT,
  role: 'user',
  text: 'hi',
  createdAt: TS,
};

const SESSION: ChatSession = {
  id: CHAT,
  repoId: REPO,
  title: 'Chat',
  status: 'idle',
  createdAt: TS,
  updatedAt: TS,
  lastMessage: null,
};

const APPROVAL_BODY: Approval = {
  id: APPROVAL,
  state: 'allowed',
  tool: 'bash',
  title: 'Run ls',
  runId: null,
  chatId: CHAT,
  input: {},
  createdAt: TS,
  expiresAt: TS,
  resolvedAt: TS,
};

const RUN: Run = {
  id: 'run_01JABCDEFGHJKMNPQRSV',
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

const SESSIONS_URL = '/v1/chat/sessions';
const MESSAGES_URL = `${SESSIONS_URL}/chat_1/messages`;
const PROMOTE_URL = `${SESSIONS_URL}/chat_1/promote`;
const REPLY_URL = `/v1/approvals/apv_1/reply`;

function asApiError(value: unknown): ApiError {
  if (!(value instanceof ApiError)) throw new Error('expected an ApiError');
  return value;
}

describe('ChatApi', () => {
  let http: HttpTestingController;
  let api: ChatApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(ChatApi);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('posts the text and parses the persisted user message', async () => {
    const pending = firstValueFrom(api.send('chat_1', 'hi'));

    const request = http.expectOne({ method: 'POST', url: MESSAGES_URL });
    expect(request.request.body).toEqual({ text: 'hi' });
    request.flush(MESSAGE, { status: 202, statusText: 'Accepted' });

    await expect(pending).resolves.toEqual(MESSAGE);
  });

  it('promotes with an idempotency key and parses the new run', async () => {
    const pending = firstValueFrom(api.promote('chat_1', 'promote-chat_1-1'));

    const request = http.expectOne({ method: 'POST', url: PROMOTE_URL });
    expect(request.request.headers.get('Idempotency-Key')).toBe('promote-chat_1-1');
    expect(request.request.body).toEqual({});
    request.flush(RUN, { status: 202, statusText: 'Accepted' });

    await expect(pending).resolves.toEqual(RUN);
  });

  it('replies to an approval with the decision and the scope', async () => {
    const pending = firstValueFrom(
      api.replyApproval('apv_1', { decision: 'allow', scope: 'session' }),
    );

    const request = http.expectOne({ method: 'POST', url: REPLY_URL });
    expect(request.request.body).toEqual({ decision: 'allow', scope: 'session' });
    request.flush(APPROVAL_BODY);

    await expect(pending).resolves.toEqual(APPROVAL_BODY);
  });

  it('maps a 409 envelope to an ApiError with its details', async () => {
    const pending = firstValueFrom(
      api
        .replyApproval('apv_1', { decision: 'allow', scope: 'once' })
        .pipe(catchError((error: ApiError) => of(error))),
    );

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

    const failure = asApiError(await pending);
    expect(failure.status).toBe(409);
    expect(failure.code).toBe('conflict');
    expect(failure.details?.['reason']).toBe('approval_already_answered');
  });

  it('falls back to the request id header when the body is not an envelope', async () => {
    const pending = firstValueFrom(
      api.getSession(CHAT).pipe(catchError((error: ApiError) => of(error))),
    );

    http.expectOne({ method: 'GET', url: `${SESSIONS_URL}/${CHAT}` }).flush('nope', {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'x-request-id': 'req_01JABCDEFGHJKMNPQRSW' },
    });

    const failure = asApiError(await pending);
    expect(failure.code).toBe('unauthorized');
    expect(failure.requestId).toBe('req_01JABCDEFGHJKMNPQRSW');
  });

  it('requests the sessions of one repository when a filter is given', async () => {
    const pending = firstValueFrom(api.listSessions({ repoId: 'repo_1' }));

    const request = http.expectOne(
      (candidate) => candidate.url === SESSIONS_URL && candidate.method === 'GET',
    );
    expect(request.request.urlWithParams).toBe('/v1/chat/sessions?repoId=repo_1');
    request.flush({ data: [SESSION], nextCursor: null });

    await expect(pending).resolves.toMatchObject({ data: [SESSION], nextCursor: null });
  });

  it('creates a session with the repository and omits an absent title', async () => {
    const pending = firstValueFrom(api.createSession({ repoId: REPO }));

    const request = http.expectOne({ method: 'POST', url: SESSIONS_URL });
    expect(request.request.body).toEqual({ repoId: REPO });
    request.flush(SESSION, { status: 201, statusText: 'Created' });

    await expect(pending).resolves.toEqual(SESSION);
  });

  it('posts an empty body for a free chat and keeps the title when given', async () => {
    const free = firstValueFrom(api.createSession({}));

    const created = http.expectOne({ method: 'POST', url: SESSIONS_URL });
    expect(created.request.body).toEqual({});
    created.flush(
      { ...SESSION, repoId: null, kind: 'free' },
      { status: 201, statusText: 'Created' },
    );

    await expect(free).resolves.toMatchObject({ repoId: null, kind: 'free' });

    const titled = firstValueFrom(api.createSession({ title: 'Scratch' }));
    const withTitle = http.expectOne({ method: 'POST', url: SESSIONS_URL });
    expect(withTitle.request.body).toEqual({ title: 'Scratch' });
    withTitle.flush(SESSION, { status: 201, statusText: 'Created' });
    await expect(titled).resolves.toEqual(SESSION);
  });

  it('lists the repositories with the page limit', async () => {
    const pending = firstValueFrom(api.listRepos());

    const request = http.expectOne((candidate) => candidate.url === '/v1/repos');
    expect(request.request.params.get('limit')).toBe('200');
    request.flush({ data: [], nextCursor: null });

    await expect(pending).resolves.toEqual({ data: [], nextCursor: null });
  });
});

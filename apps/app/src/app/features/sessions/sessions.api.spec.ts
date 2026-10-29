import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { DesignPreview, Session, SessionMessage } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import { SessionsApi } from './sessions.api';

const SESSION_ID = 'sess_01JABCDEFGHJK';

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
  createdAt: '2026-10-28T09:12:00Z',
  updatedAt: '2026-10-28T09:12:00Z',
  lastMessage: null,
};

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
  role: 'user',
  text: 'Update the tokens.',
  createdAt: '2026-10-28T09:13:00Z',
};

describe('SessionsApi', () => {
  let http: HttpTestingController;
  let api: SessionsApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), SessionsApi],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(SessionsApi);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('reads one session', () => {
    let session: Session | null = null;
    api.get(SESSION_ID).subscribe((result) => {
      session = result;
    });

    http.expectOne(`/v1/sessions/${SESSION_ID}`).flush(SESSION);

    expect(session).toEqual(SESSION);
  });

  it('reads the transcript with its limit and cursor', () => {
    let messages: readonly SessionMessage[] = [];
    api.messages(SESSION_ID, { limit: 100 }).subscribe((page) => {
      messages = page.data;
    });

    http
      .expectOne(`/v1/sessions/${SESSION_ID}/messages?limit=100`)
      .flush({ data: [MESSAGE], nextCursor: null });

    expect(messages).toEqual([MESSAGE]);
  });

  it('sends one message body', () => {
    let message: SessionMessage | null = null;
    api.send(SESSION_ID, 'Update the tokens.').subscribe((result) => {
      message = result;
    });

    const request = http.expectOne({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/messages` });
    expect(request.request.body).toEqual({ text: 'Update the tokens.' });
    request.flush(MESSAGE, { status: 202, statusText: 'Accepted' });

    expect(message).toEqual(MESSAGE);
  });

  it('interrupts and merges through their POST routes', () => {
    const sessions: Session[] = [];
    api.interrupt(SESSION_ID).subscribe((session) => sessions.push(session));
    http.expectOne({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/interrupt` }).flush(SESSION);

    api.merge(SESSION_ID).subscribe((session) => sessions.push(session));
    http.expectOne({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/merge` }).flush(SESSION);

    expect(sessions).toHaveLength(2);
  });

  it('reads the design preview with and without a revision', () => {
    let withRevision: DesignPreview | null = null;
    let head: DesignPreview | null = null;

    api.designPreview(SESSION.repoId, '9f1c2ab').subscribe((preview) => {
      withRevision = preview;
    });
    http
      .expectOne(`/v1/repos/${SESSION.repoId}/design?revision=9f1c2ab`)
      .flush(PREVIEW);

    api.designPreview(SESSION.repoId, null).subscribe((preview) => {
      head = preview;
    });
    http.expectOne(`/v1/repos/${SESSION.repoId}/design`).flush({ ...PREVIEW, revision: '4d2e0aa' });

    expect(withRevision).toEqual(PREVIEW);
    expect(head).toEqual({ ...PREVIEW, revision: '4d2e0aa' });
  });

  it('maps a malformed design preview to a contract failure', () => {
    const failures: ApiError[] = [];
    api.designPreview(SESSION.repoId, null).subscribe({
      error: (error: ApiError) => failures.push(error),
    });
    http
      .expectOne(`/v1/repos/${SESSION.repoId}/design`)
      .flush({ repoId: SESSION.repoId, revision: 'not-a-sha' });

    expect(failures[0]).toMatchObject({ status: 200, code: 'contract' });
  });

  it('maps the envelope and a boundary failure to ApiError', () => {
    const failures: ApiError[] = [];
    api.merge(SESSION_ID).subscribe({ error: (error: ApiError) => failures.push(error) });
    http
      .expectOne({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/merge` })
      .flush(
        { error: { code: 'conflict', message: 'No proposal', details: { reason: 'proposal_none' } } },
        { status: 409, statusText: 'Conflict' },
      );

    api.get(SESSION_ID).subscribe({ error: (error: ApiError) => failures.push(error) });
    http.expectOne(`/v1/sessions/${SESSION_ID}`).flush({ id: 'nope' });

    expect(failures[0]).toMatchObject({ status: 409, code: 'conflict' });
    expect(failures[1]).toMatchObject({ status: 200, code: 'contract' });
  });
});

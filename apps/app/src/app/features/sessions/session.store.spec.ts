import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Session, SessionMessage, SseStreamEvent } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from './session.store';

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

const MESSAGE: SessionMessage = {
  id: 'msg_01JABCDEFGHJK',
  sessionId: SESSION_ID,
  role: 'user',
  text: 'Update the tokens.',
  createdAt: TS,
};

describe('SessionStore', () => {
  let http: HttpTestingController;
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), SessionStore],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(SessionStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  function load(session: Session = SESSION, messages: readonly SessionMessage[] = [MESSAGE]): void {
    store.load(SESSION_ID);
    http.expectOne(SESSION_URL).flush(session);
    http.expectOne(MESSAGES_URL).flush({ data: [...messages], nextCursor: null });
  }

  it('loads the session and its transcript', () => {
    load();

    expect(store.session()).toEqual(SESSION);
    expect(store.thread().messages).toEqual([MESSAGE]);
    expect(store.loading()).toBe(false);
  });

  it('sends one message and clears the draft', () => {
    load();

    store.setDraft('  Update the tokens.  ');
    store.send();
    http
      .expectOne({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/messages` })
      .flush({ ...MESSAGE, id: 'msg_01JABCDEF02', role: 'assistant', text: 'Done.' }, {
        status: 202,
        statusText: 'Accepted',
      });
  });

  it('refuses to send while a proposal is pending', () => {
    load({ ...SESSION, pendingProposal: PROPOSAL });

    store.setDraft('Another change.');
    store.send();

    http.expectNone({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/messages` });
    expect(store.blocked()).toBe(true);
  });

  it('merges once and clears the pending proposal', () => {
    load({ ...SESSION, pendingProposal: PROPOSAL });

    store.merge();
    store.merge();
    http
      .expectOne({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/merge` })
      .flush({ ...SESSION, pendingProposal: null });

    expect(store.pendingProposal()).toBeNull();
    expect(store.mergeError()).toBeNull();
  });

  it('clears the proposal and names the refusal when the merge is refused', () => {
    load({ ...SESSION, pendingProposal: PROPOSAL });

    store.merge();
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

    expect(store.mergeError()).toMatchObject({ code: 'conflict' });
    expect(store.pendingProposal()).toBeNull();
    expect(store.blocked()).toBe(false);
  });

  it('interrupts the session', () => {
    load();

    store.interrupt();
    http
      .expectOne({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/interrupt` })
      .flush({ ...SESSION, status: 'idle' });

    expect(store.busy()).toBeNull();
  });

  it('applies a delta frame of its own session only', () => {
    load();

    const own: SseStreamEvent = {
      event: 'session.delta',
      data: { sessionId: SESSION_ID, seq: 1, ts: TS, delta: 'Thinking' },
    };
    const foreign: SseStreamEvent = {
      event: 'session.delta',
      data: { sessionId: 'sess_01JABCDEFGHJM', seq: 1, ts: TS, delta: 'Elsewhere' },
    };

    expect(store.applyEvent(own)).toBe('applied');
    expect(store.thread().messages).toHaveLength(2);
    expect(store.applyEvent(foreign)).toBe('ignored');
    expect(store.thread().messages).toHaveLength(2);
  });

  it('marks the session archived on its close frame and refetches on a gap', () => {
    load();

    const closed: SseStreamEvent = {
      event: 'session.closed',
      data: { sessionId: SESSION_ID, seq: 4, ts: TS, status: 'archived' },
    };
    store.applyEvent(closed);
    expect(store.session()?.status).toBe('archived');

    const gap: SseStreamEvent = { event: 'gap', data: { afterId: 1, latestId: 9, ts: TS } };
    expect(store.applyEvent(gap)).toBe('refetch');
  });

  it('keeps the pending proposal of the session it loaded', () => {
    load({ ...SESSION, pendingProposal: PROPOSAL });

    expect(store.pendingProposal()).toEqual(PROPOSAL);
    expect(store.blocked()).toBe(true);
  });
});

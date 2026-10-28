import type { Repo, Session, SessionMessage, Work } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreError } from './errors.js';
import { openInMemoryStore, type Store } from './store.js';

const NOW = '2026-10-28T09:12:00.000Z';
const LATER = '2026-10-28T10:12:00.000Z';

const REPO: Repo = {
  id: 'repo_000001',
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: [],
  enabled: true,
  createdAt: NOW,
};

const PROPOSAL = {
  branch: 'cb/design-edit',
  sha: '9f1c2ab',
  paths: ['design/tokens/core.json'],
  createdAt: NOW,
};

const WORK: Work = {
  id: 'wrk_000001',
  repoId: REPO.id,
  backlogRef: 'Task-35',
  title: 'Routine engine',
  prompt: 'Build the routine engine and its tests.',
  specSha: '9f1c2ab',
  state: 'needs_decision',
  origin: 'backlog',
  attempts: 1,
  maxAttempts: 2,
  usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
  contextTokens: 0,
  contextEpoch: 1,
  reviewedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const SESSION: Session = {
  id: 'sess_000001',
  repoId: REPO.id,
  target: 'design',
  workId: null,
  title: 'Edit the design tokens',
  status: 'idle',
  branch: 'cb/design-edit',
  pendingProposal: null,
  usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
  contextTokens: 0,
  contextEpoch: 1,
  createdAt: NOW,
  updatedAt: NOW,
  lastMessage: null,
};

function storeErrorOf(run: () => unknown): StoreError | null {
  try {
    run();
  } catch (error) {
    return error instanceof StoreError ? error : null;
  }
  return null;
}

let store: Store;

beforeEach(() => {
  store = openInMemoryStore();
  store.repos.create(REPO);
});

afterEach(() => {
  store.close();
});

describe('sessions.createSession and getSession', () => {
  it('round-trips a session whose pending proposal is set and then cleared', () => {
    expect(store.sessions.createSession(SESSION)).toEqual(SESSION);
    expect(store.sessions.getSession(SESSION.id)).toEqual(SESSION);
    expect(store.sessions.getSession('sess_999999')).toBeNull();

    const withProposal = store.sessions.updateSession(SESSION.id, {
      pendingProposal: PROPOSAL,
      updatedAt: LATER,
    });
    expect(withProposal.pendingProposal).toEqual(PROPOSAL);
    expect(store.sessions.getSession(SESSION.id)?.pendingProposal).toEqual(PROPOSAL);

    const cleared = store.sessions.updateSession(SESSION.id, {
      pendingProposal: null,
      updatedAt: LATER,
    });
    expect(cleared.pendingProposal).toBeNull();
    expect(store.sessions.getSession(SESSION.id)?.pendingProposal).toBeNull();
  });

  it('refuses a work session that names no work', () => {
    const withoutWork = storeErrorOf(() =>
      store.sessions.createSession({ ...SESSION, id: 'sess_000002', target: 'work' }),
    );
    expect(withoutWork?.code).toBe('check_violation');
    expect(withoutWork?.message).toBe('session target and work disagree');

    store.works.create(WORK);
    const named = store.sessions.createSession({
      ...SESSION,
      id: 'sess_000006',
      target: 'work',
      workId: WORK.id,
      branch: null,
    });
    expect(named.workId).toBe(WORK.id);
    expect(store.sessions.getSession(named.id)?.target).toBe('work');
  });

  it('refuses a new session that already carries a last message', () => {
    const message: SessionMessage = {
      id: 'msg_000001',
      sessionId: SESSION.id,
      role: 'user',
      text: 'Hello',
      createdAt: NOW,
    };
    const error = storeErrorOf(() =>
      store.sessions.createSession({ ...SESSION, lastMessage: message }),
    );
    expect(error?.code).toBe('invalid_row');
  });

  it('maps a missing repository to foreign_key_violation', () => {
    const error = storeErrorOf(() =>
      store.sessions.createSession({
        ...SESSION,
        id: 'sess_000004',
        repoId: 'repo_000404',
      }),
    );
    expect(error?.code).toBe('foreign_key_violation');
  });
});

describe('sessions.updateSession', () => {
  it('patches every editable field and stamps updated_at from the patch', () => {
    store.sessions.createSession(SESSION);
    const updated = store.sessions.updateSession(SESSION.id, {
      title: 'Edit the tokens again',
      status: 'working',
      branch: 'cb/design-edit-2',
      usage: { usd: 0.3, tokensIn: 700, tokensOut: 90 },
      contextTokens: 800,
      contextEpoch: 2,
      updatedAt: LATER,
    });
    expect(updated).toMatchObject({
      title: 'Edit the tokens again',
      status: 'working',
      branch: 'cb/design-edit-2',
      usage: { usd: 0.3, tokensIn: 700, tokensOut: 90 },
      contextTokens: 800,
      contextEpoch: 2,
      updatedAt: LATER,
    });
    expect(updated.createdAt).toBe(NOW);
  });

  it('maps an unknown id to not_found', () => {
    const error = storeErrorOf(() =>
      store.sessions.updateSession('sess_999999', { updatedAt: LATER }),
    );
    expect(error?.code).toBe('not_found');
    expect(error?.message).toBe('session not found');
  });
});

describe('sessions.listSessions', () => {
  it('fills the last message and filters by repository and target', () => {
    store.sessions.createSession(SESSION);
    store.sessions.createSession({
      ...SESSION,
      id: 'sess_000005',
      target: 'backlog',
      branch: null,
      title: 'Tick the backlog',
      updatedAt: LATER,
    });
    store.sessions.appendMessage({
      id: 'msg_000001',
      sessionId: SESSION.id,
      role: 'user',
      text: 'Older',
      createdAt: NOW,
    });
    store.sessions.appendMessage({
      id: 'msg_000002',
      sessionId: SESSION.id,
      role: 'assistant',
      text: 'Newer',
      createdAt: LATER,
    });

    const page = store.sessions.listSessions({ limit: 10, cursor: null });
    expect(page.data.map((session) => session.id)).toEqual(['sess_000005', 'sess_000001']);
    expect(page.nextCursor).toBeNull();
    expect(page.data[1]?.lastMessage?.text).toBe('Newer');

    const design = store.sessions.listSessions({
      repoId: REPO.id,
      target: 'design',
      limit: 10,
      cursor: null,
    });
    expect(design.data.map((session) => session.id)).toEqual(['sess_000001']);

    const paged = store.sessions.listSessions({ limit: 1, cursor: null });
    expect(paged.data.map((session) => session.id)).toEqual(['sess_000005']);
    expect(paged.nextCursor).not.toBeNull();
    const rest = store.sessions.listSessions({ limit: 1, cursor: paged.nextCursor });
    expect(rest.data.map((session) => session.id)).toEqual(['sess_000001']);
    expect(rest.nextCursor).toBeNull();
  });
});

describe('sessions.listMessages', () => {
  it('pages oldest first on (created_at, id)', () => {
    store.sessions.createSession(SESSION);
    const rows: SessionMessage[] = [
      { id: 'msg_000003', sessionId: SESSION.id, role: 'user', text: 'three', createdAt: LATER },
      { id: 'msg_000001', sessionId: SESSION.id, role: 'user', text: 'one', createdAt: NOW },
      { id: 'msg_000002', sessionId: SESSION.id, role: 'assistant', text: 'two', createdAt: NOW },
    ];
    for (const message of rows) store.sessions.appendMessage(message);

    const page = store.sessions.listMessages(SESSION.id, { limit: 2, cursor: null });
    expect(page.data.map((message) => message.text)).toEqual(['one', 'two']);
    expect(page.nextCursor).not.toBeNull();
    const rest = store.sessions.listMessages(SESSION.id, { limit: 2, cursor: page.nextCursor });
    expect(rest.data.map((message) => message.text)).toEqual(['three']);
    expect(rest.nextCursor).toBeNull();
    expect(store.sessions.listMessages('sess_999999', { limit: 10, cursor: null }).data).toEqual(
      [],
    );
  });

  it('maps a missing session to foreign_key_violation', () => {
    const error = storeErrorOf(() =>
      store.sessions.appendMessage({
        id: 'msg_000009',
        sessionId: 'sess_999999',
        role: 'user',
        text: 'Hello',
        createdAt: NOW,
      }),
    );
    expect(error?.code).toBe('foreign_key_violation');
    expect(error?.message).toBe('session is missing');
  });
});

import type { Repo, Work } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreError } from './errors.js';
import type { RunRecord } from './runs.js';
import { openInMemoryStore, type Store } from './store.js';

const REPO: Repo = {
  id: 'repo_000001',
  slug: 'octo/hello',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: [],
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const RUN_ID = 'run_0000001';
const CHAT_ID = 'chat_000001';
const WORK_ID = 'wrk_000001';
const SESSION_ID = 'sess_000001';
const TS = '2026-01-01T00:00:00.000Z';

const WORK: Work = {
  id: WORK_ID,
  repoId: REPO.id,
  backlogRef: 'Task-35',
  title: 'Routine engine',
  prompt: 'Build the routine engine and its tests.',
  specSha: '9f1c2ab',
  state: 'queued',
  origin: 'backlog',
  attempts: 0,
  maxAttempts: 2,
  usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
  contextTokens: 0,
  contextEpoch: 1,
  reviewedAt: null,
  createdAt: TS,
  updatedAt: TS,
};

function storeErrorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof StoreError ? error.code : 'unexpected-error';
  }
  return 'no-error';
}

function runRecord(): RunRecord {
  return {
    id: RUN_ID,
    repoId: REPO.id,
    jobId: null,
    state: 'running',
    trigger: 'manual',
    branch: 'cb/run_0000001-work',
    baseRef: 'main',
    pr: null,
    gate: null,
    guardrails: [],
    blockers: [],
    diff: null,
    cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
    createdAt: TS,
    finishedAt: null,
    baseSha: null,
    worktree: null,
    sessionId: null,
    prompt: 'do the work',
    promptHash: null,
    agent: 'build',
    model: null,
    gateCommand: null,
    scheduledFor: null,
    attempt: 1,
    failureCode: null,
    failureMessage: null,
    startedAt: null,
  };
}

let store: Store;

beforeEach(() => {
  store = openInMemoryStore();
  store.repos.create(REPO);
  store.runs.create(runRecord());
});

afterEach(() => {
  store.close();
});

describe('events', () => {
  it('event replay by seq and by Last-Event-ID is exact', () => {
    for (let index = 1; index <= 10; index += 1) {
      const seq = store.events.nextSeq({ runId: RUN_ID });
      expect(seq).toBe(index);
      const appended = store.events.append({
        runId: RUN_ID,
        chatId: null,
        seq,
        type: 'run.output',
        data: { runId: RUN_ID, seq, delta: `chunk ${index}`, ts: TS },
        ts: TS,
      });
      expect(appended.id).toBe(index);
      expect(appended.data['delta']).toBe(`chunk ${index}`);
    }

    const bySeq = store.events.readRunAfterSeq(RUN_ID, 4, 100);
    expect(bySeq.map((event) => event.seq)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(bySeq.map((event) => event.id)).toEqual([5, 6, 7, 8, 9, 10]);

    const byId = store.events.readAfterId(3, 100);
    expect(byId.map((event) => event.id)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(byId.map((event) => event.seq)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(byId.slice(1)).toEqual(bySeq);
    expect(store.events.latestId()).toBe(10);

    const duplicate = storeErrorCode(() =>
      store.events.append({
        runId: RUN_ID,
        chatId: null,
        seq: 10,
        type: 'run.output',
        data: { runId: RUN_ID, seq: 10, delta: 'again', ts: TS },
        ts: TS,
      }),
    );
    expect(duplicate).toBe('unique_violation');
    expect(store.events.latestId()).toBe(10);
  });

  it('keeps one sequence per run and one per chat', () => {
    store.chats.createSession(
      {
        id: CHAT_ID,
        repoId: REPO.id,
        title: 'Chat',
        status: 'idle',
        createdAt: TS,
        updatedAt: TS,
        lastMessage: null,
      },
      { opencodeSessionId: null, worktree: null },
    );

    expect(store.events.nextSeq({ runId: RUN_ID })).toBe(1);
    store.events.append({
      runId: RUN_ID,
      chatId: null,
      seq: 1,
      type: 'run.started',
      data: { runId: RUN_ID, seq: 1, ts: TS },
      ts: TS,
    });
    expect(store.events.nextSeq({ runId: RUN_ID })).toBe(2);
    expect(store.events.nextSeq({ chatId: CHAT_ID })).toBe(1);
    store.events.append({
      runId: null,
      chatId: CHAT_ID,
      seq: 1,
      type: 'chat.message',
      data: { chatId: CHAT_ID, seq: 1, messageId: 'msg_000001', ts: TS },
      ts: TS,
    });
    expect(store.events.nextSeq({ chatId: CHAT_ID })).toBe(2);
    expect(store.events.readRunAfterSeq(RUN_ID, 0, 10).map((event) => event.type)).toEqual([
      'run.started',
    ]);
  });

  it('keeps one sequence per works and one per session', () => {
    store.works.create(WORK);
    store.sessions.createSession({
      id: SESSION_ID,
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
      createdAt: TS,
      updatedAt: TS,
      lastMessage: null,
    });

    expect(store.events.nextSeq({ workId: WORK_ID })).toBe(1);
    const created = store.events.append({
      runId: null,
      chatId: null,
      workId: WORK_ID,
      seq: 1,
      type: 'work.created',
      data: { workId: WORK_ID, seq: 1, ts: TS },
      ts: TS,
    });
    expect(created.workId).toBe(WORK_ID);
    expect(created.sessionId).toBeNull();
    expect(store.events.nextSeq({ workId: WORK_ID })).toBe(2);

    expect(store.events.nextSeq({ sessionId: SESSION_ID })).toBe(1);
    store.events.append({
      runId: null,
      chatId: null,
      sessionId: SESSION_ID,
      seq: 1,
      type: 'session.delta',
      data: { sessionId: SESSION_ID, seq: 1, delta: 'Hola', ts: TS },
      ts: TS,
    });
    expect(store.events.nextSeq({ sessionId: SESSION_ID })).toBe(2);

    const replay = store.events.readAfterId(0, 10);
    expect(replay.map((event) => event.type)).toEqual(['work.created', 'session.delta']);
    expect(replay[0]?.workId).toBe(WORK_ID);
    expect(replay[1]?.sessionId).toBe(SESSION_ID);
    expect(replay[1]?.seq).toBe(1);

    const duplicate = storeErrorCode(() =>
      store.events.append({
        runId: null,
        chatId: null,
        sessionId: SESSION_ID,
        seq: 1,
        type: 'session.delta',
        data: { sessionId: SESSION_ID, seq: 1, delta: 'again', ts: TS },
        ts: TS,
      }),
    );
    expect(duplicate).toBe('unique_violation');
  });

  it('stores a global event with a null seq and no stream', () => {
    const event = store.events.append({
      runId: null,
      chatId: null,
      seq: null,
      type: 'telemetry',
      data: { ts: TS },
      ts: TS,
    });
    expect(event.id).toBe(1);
    expect(event.seq).toBeNull();
    expect(event.runId).toBeNull();
    expect(store.events.readAfterId(0, 10)).toHaveLength(1);
  });

  it('prunes events older than a timestamp and returns the count', () => {
    for (const ts of [
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    ]) {
      store.events.append({
        runId: RUN_ID,
        chatId: null,
        seq: store.events.nextSeq({ runId: RUN_ID }),
        type: 'run.gate',
        data: { runId: RUN_ID, ts },
        ts,
      });
    }
    expect(store.events.pruneBefore('2026-02-15T00:00:00.000Z')).toBe(2);
    expect(store.events.readAfterId(0, 10).map((event) => event.ts)).toEqual([
      '2026-03-01T00:00:00.000Z',
    ]);
    expect(store.events.pruneBefore('2030-01-01T00:00:00.000Z')).toBe(1);
    expect(store.events.pruneBefore('2030-01-01T00:00:00.000Z')).toBe(0);
  });

  it('refuses an event whose run does not exist', () => {
    expect(
      storeErrorCode(() =>
        store.events.append({
          runId: 'run_0000404',
          chatId: null,
          seq: 1,
          type: 'run.output',
          data: { ts: TS },
          ts: TS,
        }),
      ),
    ).toBe('foreign_key_violation');
  });
});

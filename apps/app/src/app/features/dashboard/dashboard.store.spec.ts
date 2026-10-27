import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  ChatMessage,
  ChatSession,
  Health,
  Repo,
  Run,
  RunState,
  Telemetry,
} from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../core/api/api-client';
import {
  DashboardStore,
  REVIEW_STATE,
  WORKING_STATES,
  countNeedsYou,
  isAwaitingAnswer,
  isUnreviewedChat,
} from './dashboard.store';

const TS = '2026-10-24T18:04:02Z';
const REVIEWED_AT = '2026-10-27T08:30:00Z';
const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';

const HEALTH: Health = {
  status: 'ok',
  db: 'ok',
  opencode: 'degraded',
  disk: { freeBytes: 12_000, totalBytes: 48_000, usedPercent: 75 },
  queue: { pending: 2, running: 1, maxConcurrency: 4 },
  version: '0.1.0',
};

const TELEMETRY: Telemetry = {
  range: '24h',
  since: TS,
  spendUsd: 1.25,
  runs: { total: 3, succeeded: 2, failed: 1, cancelled: 0 },
  disk: HEALTH.disk,
  queueDepth: 2,
};

const ZERO_TELEMETRY: Telemetry = {
  range: '24h',
  since: TS,
  spendUsd: 0,
  runs: { total: 0, succeeded: 0, failed: 0, cancelled: 0 },
  disk: HEALTH.disk,
  queueDepth: 0,
};

const REPO: Repo = {
  id: REPO_ID,
  slug: 'dani/example',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: ['.github/**'],
  enabled: true,
  createdAt: TS,
};

const PR = { number: 42, url: 'https://github.com/dani/example/pull/42', mergeable: true };

function messageAt(index: number, chatId: string, role: ChatMessage['role']): ChatMessage {
  return {
    id: `msg_01JABCDEFGHJKMNPQR${String(index).padStart(2, '0')}`,
    chatId,
    role,
    text: 'hi',
    createdAt: TS,
  };
}

interface SessionOptions {
  readonly role: ChatMessage['role'];
  readonly kind?: ChatSession['kind'];
  readonly reviewedAt?: string | null;
  readonly status?: ChatSession['status'];
}

function sessionAt(index: number, options: SessionOptions): ChatSession {
  const id = `chat_01JABCDEFGHJKMNPQR${String(index).padStart(2, '0')}`;
  return {
    id,
    repoId: REPO_ID,
    kind: options.kind ?? 'repo',
    title: `Chat ${index}`,
    status: options.status ?? 'idle',
    reviewedAt: options.reviewedAt ?? null,
    createdAt: TS,
    updatedAt: TS,
    lastMessage: messageAt(index, id, options.role),
  };
}

/** The four-session fixture of the plan plus an archived session that must add nothing. */
const NEEDS_YOU_SESSIONS: readonly ChatSession[] = [
  sessionAt(1, { role: 'assistant' }),
  sessionAt(2, { role: 'user' }),
  sessionAt(3, { role: 'assistant', kind: 'free' }),
  sessionAt(4, { role: 'assistant', reviewedAt: REVIEWED_AT }),
  sessionAt(5, { role: 'assistant', status: 'archived' }),
];

function runAt(index: number, state: RunState, pr: Run['pr'] = null): Run {
  return {
    id: `run_01JABCDEFGHJKMNPQR${String(index).padStart(2, '0')}`,
    repoId: REPO_ID,
    jobId: null,
    state,
    trigger: 'manual',
    branch: `cb/run-${index}`,
    baseRef: 'main',
    pr,
    gate: null,
    guardrails: [],
    blockers: [],
    diff: null,
    cost: { usd: 0.1, tokensIn: 10, tokensOut: 5 },
    createdAt: TS,
    finishedAt: null,
  };
}

const RUNNING = runAt(1, 'running');
const PR_OPEN = runAt(2, 'pr_open', PR);
const RUNS = [RUNNING, PR_OPEN, runAt(3, 'failed'), runAt(4, 'succeeded')];

const HEALTH_URL = '/v1/health';
const TELEMETRY_URL = '/v1/telemetry?range=24h';
const SESSIONS_URL = '/v1/chat/sessions?limit=50';
const RUNS_URL = '/v1/runs?limit=50';
const REPOS_URL = '/v1/repos?limit=1';

interface Reads {
  readonly health?: Health;
  readonly telemetry?: Telemetry;
  readonly sessions?: readonly ChatSession[];
  readonly runs?: readonly Run[];
  readonly repos?: readonly Repo[];
}

function envelope(code: string): Record<string, unknown> {
  return { error: { code, message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } };
}

describe('dashboard needs-you helpers', () => {
  it('sums the two sources over one pass of the chat page', () => {
    expect(countNeedsYou(NEEDS_YOU_SESSIONS)).toEqual({
      awaitingAnswer: 1,
      unreviewedChats: 1,
      total: 2,
    });
  });

  it('reads a session without the optional fields as a repo chat without a review', () => {
    const bare: ChatSession = {
      id: 'chat_01JABCDEFGHJKMNPQRSW',
      repoId: null,
      title: 'Bare',
      status: 'idle',
      createdAt: TS,
      updatedAt: TS,
      lastMessage: messageAt(9, 'chat_01JABCDEFGHJKMNPQRSW', 'assistant'),
    };
    expect(isUnreviewedChat(bare)).toBe(true);
    expect(isAwaitingAnswer(bare)).toBe(false);
  });

  it('adds nothing for an archived chat, a free chat or a reviewed one', () => {
    expect(isUnreviewedChat(sessionAt(5, { role: 'assistant', status: 'archived' }))).toBe(false);
    expect(isAwaitingAnswer(sessionAt(5, { role: 'user', status: 'archived' }))).toBe(false);
    expect(isUnreviewedChat(sessionAt(3, { role: 'assistant', kind: 'free' }))).toBe(false);
    expect(isUnreviewedChat(sessionAt(4, { role: 'assistant', reviewedAt: REVIEWED_AT }))).toBe(
      false,
    );
  });

  it('pins the working states and the review state', () => {
    expect(WORKING_STATES).toEqual(['queued', 'preparing', 'running', 'gating', 'merging']);
    expect(Object.isFrozen(WORKING_STATES)).toBe(true);
    expect(REVIEW_STATE).toBe('pr_open');
  });
});

describe('DashboardStore', () => {
  let http: HttpTestingController;
  let store: DashboardStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), DashboardStore],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(DashboardStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  function flushAll(reads: Reads = {}): void {
    http.expectOne(HEALTH_URL).flush(reads.health ?? HEALTH);
    http.expectOne(TELEMETRY_URL).flush(reads.telemetry ?? TELEMETRY);
    http.expectOne(SESSIONS_URL).flush({ data: [...(reads.sessions ?? [])], nextCursor: null });
    http.expectOne(RUNS_URL).flush({ data: [...(reads.runs ?? RUNS)], nextCursor: null });
    http.expectOne(REPOS_URL).flush({ data: [...(reads.repos ?? [REPO])], nextCursor: null });
  }

  it('issues five reads and derives every block from them', () => {
    store.load();

    expect(store.loading()).toBe(true);
    flushAll({ sessions: NEEDS_YOU_SESSIONS });

    expect(store.loading()).toBe(false);
    expect(store.health()).toEqual(HEALTH);
    expect(store.telemetry()).toEqual(TELEMETRY);
    expect(store.needsYou()).toEqual({ awaitingAnswer: 1, unreviewedChats: 1, total: 2 });
    expect(store.working().map((run) => run.id)).toEqual([RUNNING.id]);
    expect(store.ready().map((run) => run.id)).toEqual([PR_OPEN.id]);
    expect(store.recentRuns()).toHaveLength(4);
    expect(store.fresh()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.stale()).toBe(false);
  });

  it('keeps the five most recent runs only', () => {
    store.load();
    flushAll({ runs: [1, 2, 3, 4, 5, 6].map((index) => runAt(index, 'succeeded')) });

    expect(store.recentRuns()).toHaveLength(5);
  });

  it('renders a zero fixture as zeros', () => {
    store.load();
    flushAll({ telemetry: ZERO_TELEMETRY, sessions: [], runs: [], repos: [REPO] });

    expect(store.needsYou().total).toBe(0);
    expect(store.working()).toHaveLength(0);
    expect(store.ready()).toHaveLength(0);
    expect(store.health()).not.toBeNull();
    expect(store.telemetry()?.spendUsd).toBe(0);
    expect(store.fresh()).toBe(false);
  });

  it('marks a box with no repositories as fresh', () => {
    store.load();
    flushAll({ repos: [] });

    expect(store.fresh()).toBe(true);
  });

  it('keeps the blocks when the repository probe fails', () => {
    store.load();
    http.expectOne(HEALTH_URL).flush(HEALTH);
    http.expectOne(TELEMETRY_URL).flush(TELEMETRY);
    http.expectOne(SESSIONS_URL).flush({ data: [], nextCursor: null });
    http.expectOne(RUNS_URL).flush({ data: [...RUNS], nextCursor: null });
    http.expectOne(REPOS_URL).flush(envelope('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });

    expect(store.fresh()).toBe(false);
    expect(store.error()).toMatchObject({ code: 'internal' });
  });

  it('keeps health when the telemetry read fails', () => {
    store.load();
    http.expectOne(HEALTH_URL).flush(HEALTH);
    http.expectOne(TELEMETRY_URL).flush(envelope('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });
    http.expectOne(SESSIONS_URL).flush({ data: [], nextCursor: null });
    http.expectOne(RUNS_URL).flush({ data: [...RUNS], nextCursor: null });
    http.expectOne(REPOS_URL).flush({ data: [REPO], nextCursor: null });

    expect(store.health()).toEqual(HEALTH);
    expect(store.recentRuns()).toHaveLength(4);
    expect(store.telemetry()).toBeNull();
    expect(store.error()).toBeInstanceOf(ApiError);
    expect(store.error()).toMatchObject({ status: 500, code: 'internal' });
    expect(store.loading()).toBe(false);
  });

  it('marks the payload stale when a reload fails', () => {
    store.load();
    flushAll();

    store.reload();
    http.expectOne(HEALTH_URL).flush(envelope('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });
    http.expectOne(TELEMETRY_URL).flush(TELEMETRY);
    http.expectOne(SESSIONS_URL).flush({ data: [], nextCursor: null });
    http.expectOne(RUNS_URL).flush({ data: [...RUNS], nextCursor: null });
    http.expectOne(REPOS_URL).flush({ data: [REPO], nextCursor: null });

    expect(store.stale()).toBe(true);
    expect(store.health()).toEqual(HEALTH);
    expect(store.error()).toMatchObject({ code: 'internal' });
    expect(store.loading()).toBe(false);
  });

  it('does not mark stale when the first load fails', () => {
    store.load();
    http.expectOne(HEALTH_URL).flush(envelope('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });
    http.expectOne(TELEMETRY_URL).flush(TELEMETRY);
    http.expectOne(SESSIONS_URL).flush({ data: [], nextCursor: null });
    http.expectOne(RUNS_URL).flush({ data: [], nextCursor: null });
    http.expectOne(REPOS_URL).flush({ data: [REPO], nextCursor: null });

    expect(store.stale()).toBe(false);
    expect(store.error()).toMatchObject({ code: 'internal' });
  });

  it('clears the error on a fresh load', () => {
    store.load();
    http.expectOne(HEALTH_URL).flush(envelope('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });
    http.expectOne(TELEMETRY_URL).flush(TELEMETRY);
    http.expectOne(SESSIONS_URL).flush({ data: [], nextCursor: null });
    http.expectOne(RUNS_URL).flush({ data: [], nextCursor: null });
    http.expectOne(REPOS_URL).flush({ data: [REPO], nextCursor: null });
    expect(store.error()).not.toBeNull();

    store.load();
    expect(store.error()).toBeNull();
    flushAll();
    expect(store.error()).toBeNull();
  });

  it('reloads when a run frame touches a run on screen', () => {
    store.load();
    flushAll();

    expect(
      store.applyStreamEvent({
        event: 'run.started',
        data: { runId: RUNNING.id, seq: 1, ts: TS, branch: 'cb/run-1' },
      }),
    ).toBe('applied');
    flushAll();

    expect(
      store.applyStreamEvent({
        event: 'run.pr',
        data: { runId: PR_OPEN.id, seq: 2, ts: TS, pr: PR },
      }),
    ).toBe('applied');
    flushAll();

    expect(store.error()).toBeNull();
  });

  it('ignores a frame that does not touch a run on screen', () => {
    store.load();
    flushAll();

    expect(
      store.applyStreamEvent({
        event: 'run.finished',
        data: { runId: 'run_01JABCDEFGHJKMNPQRSV', seq: 3, ts: TS, state: 'succeeded' },
      }),
    ).toBe('ignored');
    expect(
      store.applyStreamEvent({ event: 'gap', data: { afterId: 1, latestId: 2, ts: TS } }),
    ).toBe('ignored');
    expect(
      store.applyStreamEvent({
        event: 'chat.idle',
        data: { chatId: 'chat_01JABCDEFGHJKMNPQRSV', seq: 4, ts: TS },
      }),
    ).toBe('ignored');
    expect(http.match(() => true)).toHaveLength(0);
  });
});

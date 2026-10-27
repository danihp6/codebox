import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ChatSession, Page, Repo, Telemetry } from '@codebox/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextSheetStore } from './context-sheet.store';

const TS = '2026-10-24T18:04:02Z';
const CHAT = 'chat_01JABCDEFGHJKMNPQRSV';
const REPO = 'repo_01JABCDEFGHJKMNPQRSV';
const REQUEST = 'req_01JABCDEFGHJKMNPQRSV';

const COMPACT_URL = `/v1/chat/sessions/${CHAT}/compact`;
const CREATE_URL = '/v1/chat/sessions';
const REPOS_URL = '/v1/repos';
const TELEMETRY_URL = '/v1/telemetry?range=24h';

const SESSION: ChatSession = {
  id: CHAT,
  repoId: REPO,
  kind: 'repo',
  title: 'Chat',
  status: 'idle',
  usage: { usd: 0.42, tokensIn: 12_400, tokensOut: 3_100 },
  contextTokens: 185_000,
  contextEpoch: 1,
  createdAt: TS,
  updatedAt: TS,
  lastMessage: null,
};

const COMPACTED: ChatSession = { ...SESSION, contextTokens: 0, contextEpoch: 2 };

const REPO_ROW: Repo = {
  id: REPO,
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: ['.github/**'],
  enabled: true,
  createdAt: TS,
};

const TELEMETRY: Telemetry = {
  range: '24h',
  since: TS,
  spendUsd: 3.5,
  runs: { total: 0, succeeded: 0, failed: 0, cancelled: 0 },
  disk: { freeBytes: 10_000, totalBytes: 100_000, usedPercent: 10 },
  queueDepth: 0,
};

interface Harness {
  readonly store: ContextSheetStore;
  readonly http: HttpTestingController;
}

function harness(): Harness {
  TestBed.configureTestingModule({
    providers: [ContextSheetStore, provideHttpClient(), provideHttpClientTesting()],
  });
  return { store: TestBed.inject(ContextSheetStore), http: TestBed.inject(HttpTestingController) };
}

function flushReads(http: HttpTestingController, spendUsd = TELEMETRY.spendUsd): void {
  http.expectOne(REPOS_URL).flush({ data: [REPO_ROW], nextCursor: null } satisfies Page<Repo>);
  http.expectOne(TELEMETRY_URL).flush({ ...TELEMETRY, spendUsd } satisfies Telemetry);
}

describe('ContextSheetStore', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('issues no request until load, which owns the repos and day-spend reads', () => {
    const { store, http } = harness();

    expect(store.session()).toBeNull();
    expect(store.daySpendUsd()).toBeNull();
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    http.expectNone(REPOS_URL);
    http.expectNone(TELEMETRY_URL);

    store.load(SESSION);

    expect(store.session()).toBe(SESSION);
    expect(store.loading()).toBe(true);
    flushReads(http, 3.5);

    expect(store.loading()).toBe(false);
    expect(store.daySpendUsd()).toBe(3.5);
    expect(store.repos().map((repo) => repo.slug)).toEqual(['acme/widgets']);
    expect(store.error()).toBeNull();
    http.expectNone(COMPACT_URL);
    http.expectNone(CREATE_URL);
  });

  it('keeps the day spend null, and the sheet usable, when the read fails', () => {
    const { store, http } = harness();
    store.load(SESSION);

    http.expectOne(REPOS_URL).flush({ data: [], nextCursor: null });
    http
      .expectOne(TELEMETRY_URL)
      .flush(
        { error: { code: 'internal', message: 'Telemetry failed', requestId: REQUEST } },
        { status: 500, statusText: 'Internal Server Error' },
      );

    expect(store.daySpendUsd()).toBeNull();
    expect(store.error()).toBeNull();
    expect(store.loading()).toBe(false);
    expect(store.session()?.id).toBe(CHAT);
  });

  it('posts one compact per in-flight tap and adopts the daemon answer', () => {
    const { store, http } = harness();
    store.load(SESSION);
    flushReads(http);

    store.compact();
    store.compact();
    const request = http.expectOne({ method: 'POST', url: COMPACT_URL });
    expect(request.request.body).toBeNull();
    http.expectNone({ method: 'POST', url: COMPACT_URL });
    expect(store.compacting()).toBe(true);

    request.flush(COMPACTED);

    expect(store.compacting()).toBe(false);
    expect(store.session()).toEqual(COMPACTED);
    expect(store.compactedEpoch()).toBe(2);

    store.compact();
    http.expectOne({ method: 'POST', url: COMPACT_URL }).flush(COMPACTED);
    expect(store.compactedEpoch()).toBe(2);
  });

  it('keeps the previous session and epoch when compact fails', () => {
    const { store, http } = harness();
    store.load(SESSION);
    flushReads(http);

    store.compact();
    http.expectOne({ method: 'POST', url: COMPACT_URL }).flush(
      {
        error: {
          code: 'conflict',
          message: 'The chat session is archived',
          requestId: REQUEST,
          details: { reason: 'chat_archived' },
        },
      },
      { status: 409, statusText: 'Conflict' },
    );

    expect(store.session()).toEqual(SESSION);
    expect(store.session()?.contextEpoch).toBe(1);
    expect(store.compactedEpoch()).toBeNull();
    expect(store.error()?.code).toBe('conflict');
    expect(store.error()?.status).toBe(409);
  });

  it('emits the created chat once and nothing at all for a free chat', () => {
    const { store, http } = harness();
    const created: ChatSession[] = [];
    store.created.subscribe((value) => created.push(value));
    store.load(SESSION);
    flushReads(http);

    store.createInRepo();
    store.createInRepo();
    const request = http.expectOne({ method: 'POST', url: CREATE_URL });
    expect(request.request.body).toEqual({ repoId: REPO });
    http.expectNone({ method: 'POST', url: CREATE_URL });

    request.flush(COMPACTED);

    expect(created).toEqual([COMPACTED]);
    expect(store.creating()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.session()?.id).toBe(CHAT);
  });

  it('refuses to create a chat in a repository the session does not have', () => {
    const { store, http } = harness();
    store.load({ ...SESSION, repoId: null, kind: 'free' });
    flushReads(http);

    store.createInRepo();

    http.expectNone({ method: 'POST', url: CREATE_URL });
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { Run, RunState } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunDetailStore } from './run-detail.store';

const RUN_ID = 'run_x';
const SERVER_ID = 'run_01JABCDEFGHJKMNPQRSV';
const NEXT_ID = 'run_01JABCDEFGHJKMNPQRSW';
const TS = '2026-10-24T18:04:02Z';

const RUN: Run = {
  id: SERVER_ID,
  repoId: 'repo_01JABCDEFGHJKMNPQRSV',
  jobId: null,
  state: 'running',
  trigger: 'manual',
  branch: 'cb/run-x',
  baseRef: 'main',
  pr: null,
  gate: null,
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0.42, tokensIn: 100, tokensOut: 50 },
  createdAt: '2026-10-24T18:03:11Z',
  finishedAt: null,
};

const CANCELLED: Run = { ...RUN, state: 'cancelled', finishedAt: '2026-10-24T18:05:00Z' };
const NEXT: Run = { ...RUN, id: NEXT_ID, trigger: 'revert' };

const PR = { number: 7, url: 'https://github.com/o/r/pull/7', mergeable: true };

const DIFF = {
  files: 6,
  added: 184,
  removed: 22,
  changedFiles: [{ path: 'src/a.ts', status: 'modified' as const, added: 12, removed: 3 }],
};

const EMPTY_PAGE = { data: [], nextCursor: null };

const GET_RUN_URL = `/v1/runs/${RUN_ID}`;
const EVENTS_URL = `/v1/runs/${RUN_ID}/events`;
const DIFF_URL = `/v1/runs/${RUN_ID}/diff`;
const CANCEL_URL = `/v1/runs/${RUN_ID}/cancel`;
const REVERT_URL = `/v1/runs/${RUN_ID}/revert`;

function refusal(reason: string): Record<string, unknown> {
  return {
    error: {
      code: 'conflict',
      message: 'Refused',
      requestId: 'req_01JABCDEFGHJKMNPQRSV',
      details: { reason },
    },
  };
}

describe('RunDetailStore', () => {
  let http: HttpTestingController;
  let router: Router;
  let store: RunDetailStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        RunDetailStore,
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    store = TestBed.inject(RunDetailStore);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function load(run: Run = RUN): void {
    store.load(RUN_ID);
    http.expectOne(GET_RUN_URL).flush(run);
    http.expectOne((candidate) => candidate.url === EVENTS_URL).flush(EMPTY_PAGE);
    http.expectOne(DIFF_URL).flush(DIFF);
  }

  it('loads the run, its event page and its diff as three independent reads', () => {
    store.load(RUN_ID);

    expect(store.loading()).toBe(true);
    http.expectOne(GET_RUN_URL).flush(RUN);
    expect(store.loading()).toBe(false);
    http.expectOne((candidate) => candidate.url === EVENTS_URL).flush(EMPTY_PAGE);
    http.expectOne(DIFF_URL).flush(DIFF);

    expect(store.run()).toMatchObject({ state: 'running' });
    expect(store.diff()).toMatchObject({ files: 6 });
    expect(store.error()).toBeNull();
  });

  it('keeps the diff refusal out of the error signal', () => {
    store.load(RUN_ID);
    http.expectOne(GET_RUN_URL).flush(RUN);
    http.expectOne((candidate) => candidate.url === EVENTS_URL).flush(EMPTY_PAGE);
    http
      .expectOne(DIFF_URL)
      .flush(refusal('diff_unavailable'), { status: 409, statusText: 'Conflict' });

    expect(store.diffUnavailable()).toBe(true);
    expect(store.diff()).toBeNull();
    expect(store.error()).toBeNull();
  });

  it('leaves the diff empty on any other refusal without an error', () => {
    store.load(RUN_ID);
    http.expectOne(GET_RUN_URL).flush(RUN);
    http.expectOne((candidate) => candidate.url === EVENTS_URL).flush(EMPTY_PAGE);
    http.expectOne(DIFF_URL).flush(refusal('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });

    expect(store.diffUnavailable()).toBe(false);
    expect(store.diff()).toBeNull();
    expect(store.error()).toBeNull();
  });

  it('cancels only after the confirmation and reflects the returned run', () => {
    load();

    store.cancel();
    http.expectNone(CANCEL_URL);

    store.askCancel();
    expect(store.confirmingCancel()).toBe(true);
    http.expectNone(CANCEL_URL);

    store.cancel();
    expect(store.busy()).toBe('cancel');
    store.cancel();
    const cancel = http.expectOne({ method: 'POST', url: CANCEL_URL });
    cancel.flush(CANCELLED);

    expect(store.run()).toMatchObject({ state: 'cancelled', finishedAt: '2026-10-24T18:05:00Z' });
    expect(store.confirmingCancel()).toBe(false);
    expect(store.busy()).toBeNull();
    expect(store.canCancel()).toBe(false);
  });

  it('dismisses the confirmation without a request', () => {
    load();

    store.askCancel();
    store.dismissCancel();

    expect(store.confirmingCancel()).toBe(false);
    http.expectNone(CANCEL_URL);
  });

  it('allows a cancel in the four cancellable states only', () => {
    load();

    const allowed: readonly RunState[] = ['queued', 'preparing', 'running', 'gating'];
    for (const state of allowed) {
      store.run.set({ ...RUN, state });
      expect(store.canCancel()).toBe(true);
    }

    const refused: readonly RunState[] = ['succeeded', 'failed', 'cancelled'];
    for (const state of refused) {
      store.run.set({ ...RUN, state });
      expect(store.canCancel()).toBe(false);
    }
  });

  it('reverts once with an idempotency key and opens the returned run', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    load({ ...RUN, state: 'succeeded', pr: PR });

    store.revert();
    store.revert();
    const revert = http.expectOne({ method: 'POST', url: REVERT_URL });
    const key = revert.request.headers.get('Idempotency-Key');
    expect(key).toMatch(/^revert-run_x-\d+$/);
    revert.flush(NEXT);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/runs', NEXT_ID]);
    expect(store.busy()).toBeNull();
  });

  it('keeps the page in place when the revert is refused', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    load({ ...RUN, state: 'succeeded', pr: PR });

    store.revert();
    http
      .expectOne({ method: 'POST', url: REVERT_URL })
      .flush(refusal('run_not_revertible'), { status: 409, statusText: 'Conflict' });

    expect(navigate).not.toHaveBeenCalled();
    expect(store.error()).toMatchObject({ status: 409, code: 'conflict', details: { reason: 'run_not_revertible' } });
    expect(store.busy()).toBeNull();
  });

  it('offers a revert only for a succeeded run with a pull request', () => {
    load();

    store.run.set({ ...RUN, state: 'succeeded', pr: PR });
    expect(store.canRevert()).toBe(true);

    store.run.set({ ...RUN, state: 'succeeded', pr: null });
    expect(store.canRevert()).toBe(false);

    store.run.set({ ...RUN, state: 'pr_open', pr: PR });
    expect(store.canRevert()).toBe(false);

    store.run.set({ ...RUN, state: 'failed', pr: PR });
    expect(store.canRevert()).toBe(false);
  });

  it('asks the page to refetch on a gap', () => {
    load();

    expect(
      store.applyStreamEvent({ event: 'gap', data: { afterId: 3, latestId: 90, ts: TS } }),
    ).toBe('refetch');
    http.expectNone(GET_RUN_URL);
    http.expectNone(EVENTS_URL);
  });

  it('ignores an event from another run or without a run id', () => {
    load();

    expect(
      store.applyStreamEvent({
        event: 'run.output',
        data: { runId: 'run_other', seq: 9, ts: TS, delta: 'x' },
      }),
    ).toBe('ignored');
    expect(
      store.applyStreamEvent({
        event: 'chat.delta',
        data: { chatId: 'chat_x', seq: 9, ts: TS, delta: 'x' },
      }),
    ).toBe('ignored');
    expect(store.timeline()).toHaveLength(0);
  });

  it('appends a run event once and refetches the run on a terminal event', () => {
    load();
    const event = {
      event: 'run.output',
      data: { runId: RUN_ID, seq: 3, ts: TS, delta: 'hello' },
    } as const;

    expect(store.applyStreamEvent(event)).toBe('applied');
    expect(store.applyStreamEvent(event)).toBe('applied');
    expect(store.timeline()).toHaveLength(1);
    expect(store.timeline()[0]).toMatchObject({ key: 'seq:3', detail: 'hello' });

    expect(
      store.applyStreamEvent({
        event: 'run.cancelled',
        data: { runId: RUN_ID, seq: 4, ts: TS, state: 'cancelled' },
      }),
    ).toBe('applied');
    http.expectOne(GET_RUN_URL).flush(CANCELLED);

    expect(store.run()).toMatchObject({ state: 'cancelled' });
    expect(store.timeline().map((item) => item.key)).toEqual(['seq:3', 'seq:4']);
  });

  it('merges a reload over the current timeline instead of replacing it', () => {
    load();
    store.applyStreamEvent({
      event: 'run.output',
      data: { runId: RUN_ID, seq: 2, ts: TS, delta: 'live' },
    });

    store.reload();
    http.expectOne(GET_RUN_URL).flush(RUN);
    http.expectOne((candidate) => candidate.url === EVENTS_URL).flush({
      data: [
        { id: 11, seq: 1, type: 'run.started', data: { runId: RUN_ID, seq: 1, ts: TS, branch: 'cb/run-x' }, ts: TS },
        { id: 12, seq: 2, type: 'run.output', data: { runId: RUN_ID, seq: 2, ts: TS, delta: 'live' }, ts: TS },
      ],
      nextCursor: null,
    });
    http.expectOne(DIFF_URL).flush(DIFF);

    // The live frame was already there; the replay only appends what the stream never delivered.
    expect(store.timeline().map((item) => item.key)).toEqual(['seq:2', 'seq:1']);
  });

  it('resets the previous run when the id changes', () => {
    load();

    store.load('run_y');

    expect(store.run()).toBeNull();
    expect(store.timeline()).toEqual([]);
    expect(store.diff()).toBeNull();
    expect(store.loading()).toBe(true);
    http.expectOne('/v1/runs/run_y').flush({ ...RUN, id: NEXT_ID });
    http.expectOne((candidate) => candidate.url === '/v1/runs/run_y/events').flush(EMPTY_PAGE);
    http.expectOne('/v1/runs/run_y/diff').flush(DIFF);
  });
});

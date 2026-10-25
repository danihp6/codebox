import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { GUARDRAIL_IDS, RUN_STATES } from '@codebox/contracts';
import type { Run, RunDiff, SseStreamEvent } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { NEVER, of, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../../core/api/api-client';
import type { RunEventPage } from '../../core/api/api-client';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { SecureStore } from '../../core/auth/secure-store';
import { SseService } from '../../core/events/sse.service';
import { RunDetailPage, formatUsd } from './run.page';

const TS = '2026-10-24T18:04:02Z';
const SERVER_ID = 'run_01JABCDEFGHJKMNPQRSV';
const ROUTE_ID = 'run_x';

const PR = { number: 7, url: 'https://github.com/o/r/pull/7', mergeable: true };

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

const DIFF: RunDiff = {
  files: 6,
  added: 184,
  removed: 22,
  changedFiles: [{ path: 'src/a.ts', status: 'modified', added: 12, removed: 3 }],
};

const EMPTY_PAGE: RunEventPage = { data: [], nextCursor: null };

interface FakeApi {
  readonly calls: string[];
  run: Run;
  events: RunEventPage;
  diff: RunDiff;
  cancelResult: Run;
  revertResult: Run;
  failRunWith: ApiError | null;
  failDiffWith: ApiError | null;
  getRun(id: string): Observable<Run>;
  runEvents(id: string): Observable<RunEventPage>;
  runDiff(id: string): Observable<RunDiff>;
  cancelRun(id: string): Observable<Run>;
  revertRun(id: string, idempotencyKey: string): Observable<Run>;
}

function createFakeApi(run: Run = RUN): FakeApi {
  const api: FakeApi = {
    calls: [],
    run,
    events: EMPTY_PAGE,
    diff: DIFF,
    cancelResult: { ...run, state: 'cancelled', finishedAt: TS },
    revertResult: { ...run, id: 'run_01JABCDEFGHJKMNPQRSW', trigger: 'revert' },
    failRunWith: null,
    failDiffWith: null,
    getRun: (id) => {
      api.calls.push(`getRun ${id}`);
      return api.failRunWith === null ? of(api.run) : throwError(() => api.failRunWith);
    },
    runEvents: (id) => {
      api.calls.push(`runEvents ${id}`);
      return of(api.events);
    },
    runDiff: (id) => {
      api.calls.push(`runDiff ${id}`);
      return api.failDiffWith === null ? of(api.diff) : throwError(() => api.failDiffWith);
    },
    cancelRun: (id) => {
      api.calls.push(`cancelRun ${id}`);
      return of(api.cancelResult);
    },
    revertRun: (id, idempotencyKey) => {
      api.calls.push(`revertRun ${id} ${idempotencyKey}`);
      return of(api.revertResult);
    },
  };
  return api;
}

function memoryStore(): SecureStore {
  const values = new Map<string, string>();
  return {
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    clear: () => {
      values.clear();
      return Promise.resolve();
    },
  };
}

interface Mounted {
  readonly fixture: ComponentFixture<RunDetailPage>;
  readonly element: HTMLElement;
  readonly sse: WritableSignal<SseStreamEvent | null>;
}

async function mount(api: FakeApi): Promise<Mounted> {
  const sse = signal<SseStreamEvent | null>(null);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      { provide: SECURE_STORE, useValue: memoryStore() },
      { provide: ApiClient, useValue: api },
      { provide: SseService, useValue: { event: sse } },
    ],
  });
  const fixture = TestBed.createComponent(RunDetailPage);
  fixture.componentRef.setInput('id', ROUTE_ID);
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, sse };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function cancelCalls(api: FakeApi): readonly string[] {
  return api.calls.filter((call) => call.startsWith('cancelRun'));
}

function revertCalls(api: FakeApi): readonly string[] {
  return api.calls.filter((call) => call.startsWith('revertRun'));
}

function readDictionary(locale: 'en' | 'es'): unknown {
  const file = resolve(process.cwd(), 'src/assets/i18n', `${locale}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

function lookup(dictionary: unknown, key: string): unknown {
  let current: unknown = dictionary;
  for (const segment of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

describe('RunDetailPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('renders each guardrail state from the contract field', async () => {
    const api = createFakeApi({
      ...RUN,
      guardrails: [
        { id: 'gate', state: 'pass' },
        { id: 'diff', state: 'fail', reason: '41 files' },
        { id: 'checks', state: 'skip' },
      ],
    });
    const { element } = await mount(api);

    const gate = hook(element, 'guardrail-gate');
    const diff = hook(element, 'guardrail-diff');
    const checks = hook(element, 'guardrail-checks');

    expect(gate?.getAttribute('data-state')).toBe('pass');
    expect(gate?.classList.contains('cb-guardrail--pass')).toBe(true);
    expect(diff?.getAttribute('data-state')).toBe('fail');
    expect(diff?.getAttribute('data-reason')).toBe('41 files');
    expect(diff?.classList.contains('cb-guardrail--fail')).toBe(true);
    expect(checks?.getAttribute('data-state')).toBe('skip');
    expect(checks?.classList.contains('cb-guardrail--skip')).toBe(true);
    expect(hook(element, 'guardrail-base')).toBeNull();
  });

  it('does not derive the state from the reason text', async () => {
    const api = createFakeApi({
      ...RUN,
      guardrails: [
        { id: 'gate', state: 'pass', reason: 'fail' },
        { id: 'diff', state: 'fail', reason: 'pass' },
        { id: 'checks', state: 'skip', reason: 'pass' },
      ],
    });
    const { element } = await mount(api);

    expect(hook(element, 'guardrail-gate')?.getAttribute('data-state')).toBe('pass');
    expect(hook(element, 'guardrail-diff')?.getAttribute('data-state')).toBe('fail');
    expect(hook(element, 'guardrail-checks')?.getAttribute('data-state')).toBe('skip');
  });

  it('follows the contract field when every state flips', async () => {
    const api = createFakeApi({
      ...RUN,
      guardrails: [
        { id: 'gate', state: 'fail' },
        { id: 'diff', state: 'skip' },
        { id: 'checks', state: 'pass' },
      ],
    });
    const { element } = await mount(api);

    const expected: ReadonlyArray<readonly [string, string]> = [
      ['guardrail-gate', 'fail'],
      ['guardrail-diff', 'skip'],
      ['guardrail-checks', 'pass'],
    ];
    for (const [id, state] of expected) {
      const guardrail = hook(element, id);
      expect(guardrail?.getAttribute('data-state')).toBe(state);
      expect(guardrail?.classList.contains(`cb-guardrail--${state}`)).toBe(true);
    }
  });

  it('asks for confirmation before cancelling and reflects the returned run', async () => {
    const api = createFakeApi();
    const { fixture, element } = await mount(api);

    expect(hook(element, 'run-detail')?.getAttribute('data-state')).toBe('running');
    expect(hook(element, 'cancel-confirm')).toBeNull();

    hook(element, 'cancel')?.click();
    await fixture.whenStable();
    expect(cancelCalls(api)).toHaveLength(0);
    expect(hook(element, 'cancel-confirm')).not.toBeNull();
    expect(hook(element, 'cancel-dismiss')).not.toBeNull();

    hook(element, 'cancel-confirm')?.click();
    await fixture.whenStable();

    expect(cancelCalls(api)).toEqual([`cancelRun ${ROUTE_ID}`]);
    expect(hook(element, 'run-detail')?.getAttribute('data-state')).toBe('cancelled');
    expect(hook(element, 'cancel')).toBeNull();
    expect(hook(element, 'cancel-confirm')).toBeNull();
    expect(hook(element, 'run-state')?.textContent).toBeTruthy();
  });

  it('hides the cancel action on a terminal run', async () => {
    const api = createFakeApi({ ...RUN, state: 'succeeded', finishedAt: TS });
    const { element } = await mount(api);

    expect(hook(element, 'cancel')).toBeNull();
    expect(cancelCalls(api)).toHaveLength(0);
  });

  it('refetches the run exactly once when a terminal stream event arrives', async () => {
    const api = createFakeApi();
    const { fixture, element, sse } = await mount(api);
    expect(api.calls.filter((call) => call.startsWith('getRun'))).toHaveLength(1);

    api.run = { ...RUN, state: 'cancelled', finishedAt: TS };
    sse.set({
      event: 'run.cancelled',
      data: { runId: ROUTE_ID, seq: 4, ts: TS, state: 'cancelled' },
    });
    await fixture.whenStable();

    expect(api.calls.filter((call) => call.startsWith('getRun'))).toHaveLength(2);
    expect(hook(element, 'run-detail')?.getAttribute('data-state')).toBe('cancelled');
    expect(cancelCalls(api)).toHaveLength(0);
  });

  it('refetches on a gap frame', async () => {
    const api = createFakeApi();
    const { fixture, sse } = await mount(api);

    sse.set({ event: 'gap', data: { afterId: 1, latestId: 9, ts: TS } });
    await fixture.whenStable();

    expect(api.calls.filter((call) => call.startsWith('getRun'))).toHaveLength(2);
    expect(api.calls.filter((call) => call.startsWith('runEvents'))).toHaveLength(2);
  });

  it('renders the run projection: gate, blockers, diff, PR, merge and cost', async () => {
    const api = createFakeApi({
      ...RUN,
      state: 'pr_open',
      pr: PR,
      gate: { status: 'passed', exitCode: 0, durationMs: 184000 },
      blockers: [{ code: 'base_moved', message: 'main moved during the run.' }],
      diff: { files: 6, added: 184, removed: 22 },
    });
    api.events = {
      data: [
        {
          id: 11,
          seq: 1,
          type: 'run.output',
          data: { runId: ROUTE_ID, seq: 1, ts: TS, delta: 'hello' },
          ts: TS,
        },
        {
          id: 12,
          seq: 2,
          type: 'run.merged',
          data: { runId: ROUTE_ID, seq: 2, ts: TS, pr: PR, mergeCommit: 'abc1234', method: 'squash' },
          ts: TS,
        },
      ],
      nextCursor: null,
    };
    const { element } = await mount(api);

    expect(element.querySelectorAll('[data-testid="timeline-item"]')).toHaveLength(2);
    expect(hook(element, 'timeline-empty')).toBeNull();
    expect(hook(element, 'run-loading')).toBeNull();
    expect(hook(element, 'gate-status')?.getAttribute('data-status')).toBe('passed');
    expect(hook(element, 'gate-exit')?.getAttribute('data-value')).toBe('0');
    expect(hook(element, 'gate-duration')?.getAttribute('data-value')).toBe('184000');
    expect(hook(element, 'gate-none')).toBeNull();
    expect(hook(element, 'blocker')?.getAttribute('data-code')).toBe('base_moved');
    expect(hook(element, 'blocker')?.textContent).toContain('main moved during the run.');
    expect(hook(element, 'blockers-empty')).toBeNull();
    expect(hook(element, 'diff-files')?.getAttribute('data-value')).toBe('6');
    expect(hook(element, 'diff-added')?.getAttribute('data-value')).toBe('184');
    expect(hook(element, 'diff-removed')?.getAttribute('data-value')).toBe('22');
    expect(hook(element, 'diff-unavailable')).toBeNull();
    const link = hook(element, 'pr-link');
    expect(link?.getAttribute('href')).toBe(PR.url);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(hook(element, 'merge-result')?.getAttribute('data-merged')).toBe('true');
    expect(hook(element, 'merge-result')?.getAttribute('data-detail')).toBe('abc1234');
    expect(hook(element, 'merge-none')).toBeNull();
    expect(hook(element, 'cost')?.textContent).toContain(formatUsd(0.42));
  });

  it('renders the empty timeline, no gate, no blockers, no PR and no merge', async () => {
    const api = createFakeApi({ ...RUN, diff: { files: 0, added: 0, removed: 0 } });
    const { element } = await mount(api);

    expect(element.querySelectorAll('[data-testid="timeline-item"]')).toHaveLength(0);
    expect(hook(element, 'timeline-empty')).not.toBeNull();
    expect(hook(element, 'gate-none')).not.toBeNull();
    expect(hook(element, 'blockers-empty')).not.toBeNull();
    expect(hook(element, 'pr-link')).toBeNull();
    expect(hook(element, 'merge-none')).not.toBeNull();
  });

  it('marks the diff unavailable when the endpoint refuses it', async () => {
    const api = createFakeApi({ ...RUN, diff: null });
    api.failDiffWith = new ApiError({
      message: 'No worktree',
      status: 409,
      code: 'conflict',
      requestId: null,
      details: { reason: 'diff_unavailable' },
    });
    const { element } = await mount(api);

    expect(hook(element, 'diff-unavailable')).not.toBeNull();
    expect(hook(element, 'diff-files')).toBeNull();
    expect(hook(element, 'run-error')).toBeNull();
  });

  it('falls back to the run diff stat when the endpoint fails for another reason', async () => {
    const api = createFakeApi({ ...RUN, diff: { files: 4, added: 10, removed: 2 } });
    api.failDiffWith = new ApiError({
      message: 'Boom',
      status: 500,
      code: 'internal',
      requestId: null,
      details: null,
    });
    const { element } = await mount(api);

    expect(hook(element, 'diff-files')?.getAttribute('data-value')).toBe('4');
    expect(hook(element, 'diff-unavailable')).toBeNull();
  });

  it('renders the error block and retries the run read', async () => {
    const api = createFakeApi();
    api.failRunWith = new ApiError({
      message: 'Missing',
      status: 404,
      code: 'not_found',
      requestId: null,
      details: null,
    });
    const { fixture, element } = await mount(api);

    expect(hook(element, 'run-error')?.getAttribute('data-code')).toBe('not_found');
    expect(hook(element, 'run-detail')?.hasAttribute('data-state')).toBe(false);
    expect(hook(element, 'run-loading')).toBeNull();

    api.failRunWith = null;
    hook(element, 'run-retry')?.click();
    await fixture.whenStable();

    expect(api.calls.filter((call) => call.startsWith('getRun'))).toHaveLength(2);
    expect(hook(element, 'run-detail')?.getAttribute('data-state')).toBe('running');
    expect(hook(element, 'run-error')).toBeNull();
  });

  it('offers revert only for a succeeded run with a PR and calls it once', async () => {
    const api = createFakeApi({ ...RUN, state: 'succeeded', pr: PR, finishedAt: TS });
    api.revertResult = { ...RUN, id: 'run_01JABCDEFGHJKMNPQRSW', trigger: 'revert' };

    const { fixture, element } = await mount(api);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const button = hook(element, 'revert');
    expect(button).not.toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(false);

    button?.click();
    await fixture.whenStable();

    const calls = revertCalls(api);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^revertRun run_x \S+$/);
    expect(navigate).toHaveBeenCalledWith(['/runs', 'run_01JABCDEFGHJKMNPQRSW']);
  });

  it('hides revert when the run has no PR or is not succeeded', async () => {
    const cases: ReadonlyArray<Run> = [
      { ...RUN, state: 'pr_open', pr: PR },
      { ...RUN, state: 'succeeded', pr: null },
      { ...RUN, state: 'failed', pr: PR },
    ];

    for (const run of cases) {
      TestBed.resetTestingModule();
      const api = createFakeApi(run);
      const { element } = await mount(api);

      expect(hook(element, 'revert')).toBeNull();
      expect(revertCalls(api)).toHaveLength(0);
    }
  });

  it('disables revert while the request is in flight', async () => {
    const api = createFakeApi({ ...RUN, state: 'succeeded', pr: PR, finishedAt: TS });
    api.revertRun = vi.fn(() => NEVER);
    const { fixture, element } = await mount(api);

    hook(element, 'revert')?.click();
    await fixture.whenStable();

    expect((hook(element, 'revert') as HTMLButtonElement | null)?.disabled).toBe(true);
  });

  it('formats a cost with US dollars', () => {
    expect(formatUsd(0.42)).toBe('$0.42');
    expect(formatUsd(12)).toBe('$12.00');
  });

  it('ships every run state and guardrail label in both dictionaries', () => {
    for (const locale of ['en', 'es'] as const) {
      const dictionary = readDictionary(locale);
      for (const id of GUARDRAIL_IDS) {
        const value = lookup(dictionary, `run.guardrail.${id}`);
        expect(typeof value, `${locale} run.guardrail.${id}`).toBe('string');
        expect(value as string, `${locale} run.guardrail.${id}`).not.toBe('');
      }
      for (const state of RUN_STATES) {
        const value = lookup(dictionary, `run.state.${state}`);
        expect(typeof value, `${locale} run.state.${state}`).toBe('string');
        expect(value as string, `${locale} run.state.${state}`).not.toBe('');
      }
      for (const key of [
        'run.title',
        'run.section.timeline',
        'run.section.gate',
        'run.section.guardrails',
        'run.section.blockers',
        'run.section.diff',
        'run.section.cost',
        'run.section.pullRequest',
        'run.section.merge',
        'run.action.cancel',
        'run.action.confirmCancel',
        'run.action.dismissCancel',
        'run.action.revert',
        'run.action.retry',
        'run.empty.timeline',
        'run.empty.blockers',
        'run.error.diffUnavailable',
        'run.event.other',
      ]) {
        const value = lookup(dictionary, key);
        expect(typeof value, `${locale} ${key}`).toBe('string');
        expect(value as string, `${locale} ${key}`).not.toBe('');
      }
    }
  });
});

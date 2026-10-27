import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  ChatMessage,
  ChatSession,
  Health,
  Repo,
  Run,
  RunState,
  SseStreamEvent,
  Telemetry,
} from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { signal } from '@angular/core';
import { afterEach, describe, expect, it } from 'vitest';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { SecureStore } from '../../core/auth/secure-store';
import { SseService } from '../../core/events/sse.service';
import { DashboardPage, formatUsd } from './dashboard.page';
import { STRINGS, translate } from './i18n';

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
const FAILED = runAt(3, 'failed');
const SUCCEEDED = runAt(4, 'succeeded');
const RUNS = [RUNNING, PR_OPEN, FAILED, SUCCEEDED];

const HEALTH_URL = '/v1/health';
const TELEMETRY_URL = '/v1/telemetry?range=24h';
const SESSIONS_URL = '/v1/chat/sessions?limit=50';
const RUNS_URL = '/v1/runs?limit=50';
const REPOS_URL = '/v1/repos?limit=1';

const USED_KEYS: readonly string[] = [
  'common.loading',
  'common.error',
  'dashboard.title',
  'dashboard.section.needs-you',
  'dashboard.section.working',
  'dashboard.section.ready',
  'dashboard.section.health',
  'dashboard.section.queue',
  'dashboard.section.spend',
  'dashboard.section.recent',
  'dashboard.needs-you.awaiting',
  'dashboard.needs-you.unreviewed',
  'dashboard.needs-you.unit',
  'dashboard.needs-you.open-chat',
  'dashboard.working.empty',
  'dashboard.ready.empty',
  'dashboard.ready.pr',
  'dashboard.start.title',
  'dashboard.start.body',
  'dashboard.start.repos',
  'dashboard.start.chat',
  'dashboard.vm.db',
  'dashboard.vm.opencode',
  'dashboard.vm.disk',
  'dashboard.queue.pending',
  'dashboard.queue.running',
  'dashboard.queue.max',
  'dashboard.action.retry',
  'dashboard.empty',
  'dashboard.stale',
  'dashboard.state.queued',
  'dashboard.state.preparing',
  'dashboard.state.running',
  'dashboard.state.gating',
  'dashboard.state.pr_open',
  'dashboard.state.merging',
  'dashboard.state.succeeded',
  'dashboard.state.failed',
  'dashboard.state.cancelled',
];

interface Reads {
  readonly health?: Health;
  readonly telemetry?: Telemetry;
  readonly sessions?: readonly ChatSession[];
  readonly runs?: readonly Run[];
  readonly repos?: readonly Repo[];
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

function envelope(code: string): Record<string, unknown> {
  return { error: { code, message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

interface Mounted {
  readonly fixture: ComponentFixture<DashboardPage>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
}

async function mount(): Promise<Mounted> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SECURE_STORE, useValue: memoryStore() },
      { provide: SseService, useValue: { event: signal<SseStreamEvent | null>(null) } },
    ],
  });
  const fixture = TestBed.createComponent(DashboardPage);
  await fixture.whenStable();
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
  };
}

function flushAll(http: HttpTestingController, reads: Reads = {}): void {
  http.expectOne(HEALTH_URL).flush(reads.health ?? HEALTH);
  http.expectOne(TELEMETRY_URL).flush(reads.telemetry ?? ZERO_TELEMETRY);
  http.expectOne(SESSIONS_URL).flush({ data: [...(reads.sessions ?? [])], nextCursor: null });
  http.expectOne(RUNS_URL).flush({ data: [...(reads.runs ?? [])], nextCursor: null });
  http.expectOne(REPOS_URL).flush({ data: [...(reads.repos ?? [REPO])], nextCursor: null });
}

describe('DashboardPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders every block from a zero fixture', async () => {
    const { fixture, element, http } = await mount();

    expect(hook(element, 'dashboard-loading')).not.toBeNull();
    expect(hook(element, 'page-dashboard')).not.toBeNull();

    flushAll(http);
    await fixture.whenStable();

    expect(hook(element, 'dashboard-loading')).toBeNull();
    expect(hook(element, 'dashboard-start')).toBeNull();
    expect(hook(element, 'dashboard-needs-you')?.getAttribute('data-total')).toBe('0');
    expect(hook(element, 'dashboard-needs-you')?.getAttribute('data-awaiting')).toBe('0');
    expect(hook(element, 'dashboard-needs-you')?.getAttribute('data-unreviewed')).toBe('0');
    expect(hook(element, 'dashboard-working')?.getAttribute('data-count')).toBe('0');
    expect(hook(element, 'dashboard-ready')?.getAttribute('data-count')).toBe('0');
    expect(hook(element, 'dashboard-working-empty')).not.toBeNull();
    expect(hook(element, 'dashboard-ready-empty')).not.toBeNull();
    expect(hook(element, 'health-spend')?.getAttribute('data-usd')).toBe('0');
    expect(hook(element, 'health-spend')?.getAttribute('data-runs')).toBe('0');
    expect(hook(element, 'health-vm')?.getAttribute('data-status')).toBe('ok');
    expect(hook(element, 'health-db')?.getAttribute('data-state')).toBe('ok');
    expect(hook(element, 'health-opencode')?.getAttribute('data-state')).toBe('degraded');
    expect(hook(element, 'health-disk')?.getAttribute('data-percent')).toBe('75');
    expect(hook(element, 'health-queue')?.getAttribute('data-pending')).toBe('2');
    expect(hook(element, 'health-queue')?.getAttribute('data-running')).toBe('1');
    expect(hook(element, 'health-queue')?.getAttribute('data-max')).toBe('4');
    expect(hook(element, 'dashboard-error')).toBeNull();
    expect(hook(element, 'dashboard-stale')).toBeNull();
  });

  it('replaces the zeros with the start card on a box without repositories', async () => {
    const { fixture, element, http } = await mount();

    flushAll(http, { repos: [] });
    await fixture.whenStable();

    const start = hook(element, 'dashboard-start');
    expect(start).not.toBeNull();
    expect(start?.getAttribute('data-repos')).toBe('0');
    expect(hook(element, 'dashboard-start-repos')?.getAttribute('href')).toBe('/repos');
    expect(hook(element, 'dashboard-start-chat')?.getAttribute('href')).toBe('/chat');
    expect(hook(element, 'dashboard-needs-you')).toBeNull();
    expect(hook(element, 'dashboard-working')).toBeNull();
    expect(hook(element, 'dashboard-ready')).toBeNull();
    expect(hook(element, 'health-spend')).toBeNull();
    expect(hook(element, 'health-vm')).toBeNull();
    expect(hook(element, 'health-queue')).toBeNull();
    expect(hook(element, 'dashboard-empty')).toBeNull();
  });

  it('renders the rows of the working and ready blocks', async () => {
    const { fixture, element, http } = await mount();

    flushAll(http, { runs: RUNS });
    await fixture.whenStable();

    const working = hook(element, 'dashboard-working');
    expect(working?.getAttribute('data-count')).toBe('1');
    const workingRows = element.querySelectorAll<HTMLElement>(
      '[data-testid="dashboard-working-run"]',
    );
    expect(workingRows).toHaveLength(1);
    expect(workingRows[0]?.getAttribute('data-run-id')).toBe(RUNNING.id);
    expect(workingRows[0]?.getAttribute('data-state')).toBe('running');
    expect(workingRows[0]?.getAttribute('href')).toBe(`/runs/${RUNNING.id}`);

    const ready = hook(element, 'dashboard-ready');
    expect(ready?.getAttribute('data-count')).toBe('1');
    const readyRows = element.querySelectorAll<HTMLElement>('[data-testid="dashboard-ready-run"]');
    expect(readyRows).toHaveLength(1);
    expect(readyRows[0]?.getAttribute('data-run-id')).toBe(PR_OPEN.id);
    expect(readyRows[0]?.getAttribute('data-pr')).toBe('42');

    const recent = [...element.querySelectorAll<HTMLElement>('[data-testid="recent-run"]')];
    expect(recent).toHaveLength(4);
    expect(recent.map((row) => row.getAttribute('data-run-id'))).toContain(FAILED.id);
    expect(recent.map((row) => row.getAttribute('data-run-id'))).toContain(SUCCEEDED.id);
    expect(working?.querySelector('[data-state="failed"]')).toBeNull();
    expect(working?.querySelector('[data-state="succeeded"]')).toBeNull();
    expect(ready?.querySelector('[data-state="failed"]')).toBeNull();
    expect(ready?.querySelector('[data-state="succeeded"]')).toBeNull();
  });

  it('reads the needs-you counts from the chat page', async () => {
    const { fixture, element, http } = await mount();

    flushAll(http, { sessions: NEEDS_YOU_SESSIONS });
    await fixture.whenStable();

    const block = hook(element, 'dashboard-needs-you');
    expect(block?.getAttribute('data-total')).toBe('2');
    expect(block?.getAttribute('data-awaiting')).toBe('1');
    expect(block?.getAttribute('data-unreviewed')).toBe('1');
    expect(block?.textContent).toContain('2');
    expect(hook(element, 'dashboard-needs-you-chat')?.getAttribute('href')).toBe('/chat');
  });

  it('renders the empty state for an empty runs page', async () => {
    const { fixture, element, http } = await mount();

    flushAll(http, { runs: [] });
    await fixture.whenStable();

    expect(hook(element, 'dashboard-empty')).not.toBeNull();
    expect(hook(element, 'recent-run')).toBeNull();
  });

  it('renders the error block and retries every read', async () => {
    const { fixture, element, http } = await mount();

    http.expectOne(HEALTH_URL).flush(envelope('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });
    http.expectOne(TELEMETRY_URL).flush(ZERO_TELEMETRY);
    http.expectOne(SESSIONS_URL).flush({ data: [], nextCursor: null });
    http.expectOne(RUNS_URL).flush({ data: [...RUNS], nextCursor: null });
    http.expectOne(REPOS_URL).flush({ data: [REPO], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'dashboard-error')?.getAttribute('data-code')).toBe('internal');
    expect(hook(element, 'health-vm')).toBeNull();

    hook(element, 'dashboard-retry')?.click();
    await fixture.whenStable();

    flushAll(http, { runs: RUNS });
    await fixture.whenStable();

    expect(hook(element, 'dashboard-error')).toBeNull();
    expect(hook(element, 'health-vm')?.getAttribute('data-status')).toBe('ok');
  });

  it('marks the payload stale when a reload fails', async () => {
    const { fixture, element, http } = await mount();

    flushAll(http, { telemetry: TELEMETRY, runs: RUNS });
    await fixture.whenStable();
    expect(hook(element, 'dashboard-stale')).toBeNull();

    fixture.componentInstance.store.reload();
    await fixture.whenStable();
    http.expectOne(HEALTH_URL).flush(HEALTH);
    http.expectOne(TELEMETRY_URL).flush(envelope('internal'), {
      status: 500,
      statusText: 'Internal Server Error',
    });
    http.expectOne(SESSIONS_URL).flush({ data: [], nextCursor: null });
    http.expectOne(RUNS_URL).flush({ data: [...RUNS], nextCursor: null });
    http.expectOne(REPOS_URL).flush({ data: [REPO], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'dashboard-stale')).not.toBeNull();
    expect(hook(element, 'health-spend')?.getAttribute('data-usd')).toBe('1.25');
    expect(hook(element, 'health-spend')?.textContent).toContain(formatUsd(1.25));
  });

  it('formats a spend with US dollars', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(12.5)).toBe('$12.50');
  });

  it('ships the same keys in both dictionaries and resolves every template key', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.es).sort());
    for (const locale of ['en', 'es'] as const) {
      for (const [key, value] of Object.entries(STRINGS[locale])) {
        expect(value, `${locale} ${key}`).not.toBe('');
        expect(translate(locale, key), `${locale} ${key}`).toBe(value);
      }
      for (const key of USED_KEYS) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});

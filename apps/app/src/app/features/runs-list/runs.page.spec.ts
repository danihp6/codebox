import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RUN_STATES } from '@codebox/contracts';
import type { Page, Run, SseStreamEvent } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { SecureStore } from '../../core/auth/secure-store';
import { SseService } from '../../core/events/sse.service';
import { STRINGS, translate } from './i18n';
import { RunsPage } from './runs.page';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const RUN_ID = 'run_01JABCDEFGHJKMNPQRSV';
const NEXT_ID = 'run_01JABCDEFGHJKMNPQRSW';
const TS = '2026-10-24T18:04:02Z';
const RUNS_URL = '/v1/runs?limit=50';

const RUN: Run = {
  id: RUN_ID,
  repoId: REPO_ID,
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

const OTHER: Run = { ...RUN, id: NEXT_ID, state: 'failed', branch: 'cb/run-y' };

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
  readonly fixture: ComponentFixture<RunsPage>;
  readonly element: HTMLElement;
  readonly sse: WritableSignal<SseStreamEvent | null>;
}

async function mount(): Promise<Mounted> {
  const sse = signal<SseStreamEvent | null>(null);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SECURE_STORE, useValue: memoryStore() },
      { provide: SseService, useValue: { event: sse } },
    ],
  });
  const fixture = TestBed.createComponent(RunsPage);
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, sse };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function templateKeys(file: string): readonly string[] {
  const source = readFileSync(resolve(process.cwd(), 'src/app/features/runs-list', file), 'utf8');
  const keys = new Set<string>();
  for (const match of source.matchAll(/\bt\('([^']+)'\)/g)) {
    const key = match[1];
    if (key !== undefined) keys.add(key);
  }
  return [...keys];
}

describe('RunsPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('renders one row per run with its state and cost', async () => {
    const { fixture, element } = await mount();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(RUNS_URL).flush({ data: [RUN, OTHER], nextCursor: null });
    await fixture.whenStable();

    const rows = element.querySelectorAll<HTMLElement>('[data-testid="run-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('data-run-id')).toBe(RUN_ID);
    expect(rows[0]?.getAttribute('data-state')).toBe('running');
    expect(rows[0]?.getAttribute('data-usd')).toBe('0.42');
    expect(rows[1]?.getAttribute('data-state')).toBe('failed');
    expect(hook(element, 'runs-loading')).toBeNull();
    expect(hook(element, 'runs-empty')).toBeNull();
    expect(hook(element, 'runs-more')).toBeNull();
  });

  it('filters by state when a chip is clicked', async () => {
    const { fixture, element } = await mount();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(RUNS_URL).flush({ data: [RUN], nextCursor: null });
    await fixture.whenStable();

    const chip = element.querySelector<HTMLElement>('[data-testid="run-chip"][data-state="failed"]');
    expect(chip).not.toBeNull();
    chip?.click();
    await fixture.whenStable();

    http.expectOne('/v1/runs?state=failed&limit=50').flush({ data: [OTHER], nextCursor: null });
    await fixture.whenStable();

    const rows = element.querySelectorAll<HTMLElement>('[data-testid="run-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-state')).toBe('failed');
    expect(element.querySelectorAll('[data-testid="run-chip"]')).toHaveLength(RUN_STATES.length);

    element.querySelector<HTMLElement>('[data-testid="run-chip-all"]')?.click();
    await fixture.whenStable();
    http.expectOne(RUNS_URL).flush({ data: [RUN, OTHER], nextCursor: null });
    await fixture.whenStable();
    expect(element.querySelectorAll('[data-testid="run-row"]')).toHaveLength(2);
  });

  it('renders the empty state and hides the cursor button', async () => {
    const { fixture, element } = await mount();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(RUNS_URL).flush({ data: [], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'runs-empty')).not.toBeNull();
    expect(hook(element, 'runs-more')).toBeNull();
    expect(element.querySelectorAll('[data-testid="run-row"]')).toHaveLength(0);
  });

  it('renders the cursor button only when there is a next page and loads it', async () => {
    const { fixture, element } = await mount();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(RUNS_URL).flush({ data: [RUN], nextCursor: 'c_next' });
    await fixture.whenStable();

    const more = hook(element, 'runs-more');
    expect(more).not.toBeNull();
    more?.click();
    await fixture.whenStable();

    http
      .expectOne((request) => request.url === '/v1/runs' && request.params.get('cursor') === 'c_next')
      .flush({ data: [OTHER], nextCursor: null } satisfies Page<Run>);
    await fixture.whenStable();

    expect(element.querySelectorAll('[data-testid="run-row"]')).toHaveLength(2);
    expect(hook(element, 'runs-more')).toBeNull();
  });

  it('renders the error block and retries the read', async () => {
    const { fixture, element } = await mount();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(RUNS_URL).flush(
      { error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
      { status: 500, statusText: 'Internal Server Error' },
    );
    await fixture.whenStable();

    expect(hook(element, 'runs-error')?.getAttribute('data-code')).toBe('internal');
    expect(hook(element, 'runs-loading')).toBeNull();

    hook(element, 'runs-retry')?.click();
    await fixture.whenStable();
    http.expectOne(RUNS_URL).flush({ data: [RUN], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'runs-error')).toBeNull();
    expect(element.querySelectorAll('[data-testid="run-row"]')).toHaveLength(1);
  });

  it('patches a row from a terminal stream frame without a request', async () => {
    const { fixture, element, sse } = await mount();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(RUNS_URL).flush({ data: [RUN], nextCursor: null });
    await fixture.whenStable();

    sse.set({
      event: 'run.finished',
      data: { runId: RUN_ID, seq: 2, ts: TS, state: 'succeeded' },
    });
    await fixture.whenStable();

    const row = element.querySelector<HTMLElement>('[data-testid="run-row"]');
    expect(row?.getAttribute('data-state')).toBe('succeeded');
    http.expectNone(RUNS_URL);
  });

  it('ships one dictionary with the same keys in both locales and resolves every template key', () => {
    const en = STRINGS.en;
    const es = STRINGS.es;
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());

    for (const [key, value] of Object.entries(en)) {
      expect(value, `en ${key}`).not.toBe('');
      expect(es[key], `es ${key}`).not.toBe('');
    }

    for (const state of RUN_STATES) {
      expect(translate('en', `runs.state.${state}`)).not.toBe(`runs.state.${state}`);
      expect(translate('es', `runs.state.${state}`)).not.toBe(`runs.state.${state}`);
    }

    const keys = templateKeys('runs.page.ts');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(translate('en', key), `en ${key}`).not.toBe(key);
      expect(translate('es', key), `es ${key}`).not.toBe(key);
    }
  });
});

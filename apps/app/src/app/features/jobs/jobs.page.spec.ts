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
import type { Job, Repo, Run, SseStreamEvent } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { SecureStore } from '../../core/auth/secure-store';
import { SseService } from '../../core/events/sse.service';
import { STRINGS, translate } from './i18n';
import { JobsPage } from './jobs.page';

const JOB_ID = 'job_01JABCDEFGHJKMNPQRSV';
const OTHER_ID = 'job_01JABCDEFGHJKMNPQRSW';
const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const RUN_ID = 'run_01JABCDEFGHJKMNPQRSV';
const TS = '2026-10-24T18:04:02Z';
const JOBS_URL = '/v1/jobs?limit=100';
const REPOS_URL = '/v1/repos?limit=200';
const ROUTINES_URL = '/v1/routines?limit=100';

const JOB: Job = {
  id: JOB_ID,
  repoId: REPO_ID,
  title: 'Nightly lockfile',
  prompt: 'Update the lockfile.',
  mode: 'work',
  agent: 'build',
  model: null,
  cron: '0 3 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  policy: 'auto',
  createdAt: '2026-10-24T18:03:11Z',
  nextFireAt: '2026-10-25T02:00:00Z',
};

const PAUSED: Job = {
  ...JOB,
  id: OTHER_ID,
  title: 'Weekly report',
  enabled: false,
  nextFireAt: null,
};

const REPO: Repo = {
  id: REPO_ID,
  slug: 'danihp6/codebox',
  defaultBranch: 'main',
  gate: 'npm run gate',
  policy: 'auto',
  protectedPaths: [],
  enabled: true,
  createdAt: '2026-10-24T18:03:11Z',
};

const RUN: Run = {
  id: RUN_ID,
  repoId: REPO_ID,
  jobId: OTHER_ID,
  state: 'queued',
  trigger: 'manual',
  branch: 'cb/run-x',
  baseRef: 'main',
  pr: null,
  gate: null,
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
  createdAt: '2026-10-24T18:03:11Z',
  finishedAt: null,
};

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
  readonly fixture: ComponentFixture<JobsPage>;
  readonly element: HTMLElement;
  readonly sse: WritableSignal<SseStreamEvent | null>;
  readonly http: HttpTestingController;
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
  const fixture = TestBed.createComponent(JobsPage);
  await fixture.whenStable();
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    sse,
    http: TestBed.inject(HttpTestingController),
  };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function typeInto(element: HTMLElement | null, value: string): void {
  if (element === null) throw new Error('missing input');
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = value;
  }
  element.dispatchEvent(new Event('input'));
}

function templateKeys(file: string): readonly string[] {
  const source = readFileSync(resolve(process.cwd(), 'src/app/features/jobs', file), 'utf8');
  const keys = new Set<string>();
  for (const match of source.matchAll(/\bt\('([^']+)'\)/g)) {
    const key = match[1];
    if (key !== undefined) keys.add(key);
  }
  return [...keys];
}

describe('JobsPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('renders one row per job with its schedule and next fire', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne(JOBS_URL).flush({ data: [JOB, PAUSED], nextCursor: null });
    await fixture.whenStable();

    const rows = element.querySelectorAll<HTMLElement>('[data-testid="job-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('data-job-id')).toBe(JOB_ID);
    expect(rows[0]?.getAttribute('data-enabled')).toBe('true');
    expect(rows[0]?.getAttribute('data-cron')).toBe('0 3 * * *');

    const next = rows[0]?.querySelector<HTMLElement>('[data-testid="job-next"]');
    expect(next?.getAttribute('data-at')).toBe(JOB.nextFireAt);
    expect(next?.textContent).toBeTruthy();

    expect(rows[1]?.getAttribute('data-enabled')).toBe('false');
    expect(rows[1]?.querySelector('[data-testid="job-next"]')).toBeNull();
    expect(hook(element, 'jobs-loading')).toBeNull();
    expect(hook(element, 'jobs-empty')).toBeNull();
  });

  it('keeps run-now enabled on a paused job and resumes instead of pausing', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne(JOBS_URL).flush({ data: [PAUSED], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'job-pause')).toBeNull();
    expect(hook(element, 'job-resume')).not.toBeNull();

    const runNow = hook(element, 'job-run-now') as HTMLButtonElement | null;
    expect(runNow).not.toBeNull();
    expect(runNow?.disabled).toBe(false);

    runNow?.click();
    await fixture.whenStable();

    const request = http.expectOne({ method: 'POST', url: `/v1/jobs/${OTHER_ID}/run` });
    expect(request.request.headers.get('Idempotency-Key')).toBe(`runnow-${OTHER_ID}-1`);
    request.flush(RUN, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();

    expect(hook(element, 'jobs-error')).toBeNull();
  });

  it('pauses an enabled job optimistically', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne(JOBS_URL).flush({ data: [JOB], nextCursor: null });
    await fixture.whenStable();

    hook(element, 'job-pause')?.click();
    await fixture.whenStable();

    const row = hook(element, 'job-row');
    expect(row?.getAttribute('data-enabled')).toBe('false');
    expect(hook(element, 'job-resume')).not.toBeNull();

    http
      .expectOne({ method: 'POST', url: `/v1/jobs/${JOB_ID}/pause` })
      .flush({ ...JOB, enabled: false, nextFireAt: null });
    await fixture.whenStable();

    expect(hook(element, 'job-row')?.getAttribute('data-enabled')).toBe('false');
  });

  it('renders the empty state', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne(JOBS_URL).flush({ data: [], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'jobs-empty')).not.toBeNull();
    expect(element.querySelectorAll('[data-testid="job-row"]')).toHaveLength(0);
  });

  it('renders the error block and retries the read', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne(JOBS_URL).flush(
      { error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
      { status: 500, statusText: 'Internal Server Error' },
    );
    await fixture.whenStable();

    expect(hook(element, 'jobs-error')?.getAttribute('data-code')).toBe('internal');

    hook(element, 'jobs-retry')?.click();
    await fixture.whenStable();
    http.expectOne(JOBS_URL).flush({ data: [JOB], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'jobs-error')).toBeNull();
    expect(element.querySelectorAll('[data-testid="job-row"]')).toHaveLength(1);
  });

  it('creates a job from the form and reloads the list', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne(JOBS_URL).flush({ data: [], nextCursor: null });
    await fixture.whenStable();

    hook(element, 'job-create')?.click();
    await fixture.whenStable();

    expect(hook(element, 'job-form')).not.toBeNull();
    http.expectOne(REPOS_URL).flush({ data: [REPO], nextCursor: null });
    await fixture.whenStable();

    const options = element.querySelectorAll<HTMLElement>('[data-testid="job-form-repo-option"]');
    expect(options).toHaveLength(1);
    expect(options[0]?.getAttribute('data-repo-id')).toBe(REPO_ID);

    typeInto(hook(element, 'job-form-title'), 'Nightly lockfile');
    typeInto(hook(element, 'job-form-prompt'), 'Update the lockfile.');
    typeInto(hook(element, 'job-form-timezone'), 'Europe/Madrid');
    await fixture.whenStable();

    hook(element, 'job-form-submit')?.click();
    await fixture.whenStable();

    const request = http.expectOne({ method: 'POST', url: '/v1/jobs' });
    expect(request.request.body).toMatchObject({
      repoId: REPO_ID,
      title: 'Nightly lockfile',
      prompt: 'Update the lockfile.',
      cron: '0 3 * * *',
      timezone: 'Europe/Madrid',
    });
    request.flush(JOB, { status: 201, statusText: 'Created' });
    await fixture.whenStable();

    http.expectOne(JOBS_URL).flush({ data: [JOB], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'job-form')).toBeNull();
    expect(element.querySelectorAll('[data-testid="job-row"]')).toHaveLength(1);
  });

  it('reloads exactly once on a job.changed frame', async () => {
    const { fixture, element, sse, http } = await mount();
    http.expectOne(JOBS_URL).flush({ data: [JOB], nextCursor: null });
    await fixture.whenStable();

    sse.set({ event: 'job.changed', data: { jobId: JOB_ID, change: 'paused', ts: TS } });
    await fixture.whenStable();

    http.expectOne(JOBS_URL).flush({ data: [{ ...JOB, enabled: false, nextFireAt: null }], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'job-row')?.getAttribute('data-enabled')).toBe('false');
    http.expectNone(JOBS_URL);
  });

  it('switches between the Jobs and the Routines tab without a navigation', async () => {
    const { fixture, element, http } = await mount();
    http.expectOne(JOBS_URL).flush({ data: [JOB], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'jobs-tab-jobs')).not.toBeNull();
    expect(hook(element, 'jobs-tab-routines')).not.toBeNull();
    expect(hook(element, 'page-jobs')?.getAttribute('data-tab')).toBe('jobs');
    expect(hook(element, 'jobs-tab-jobs')?.getAttribute('data-active')).toBe('true');
    expect(hook(element, 'jobs-tab-routines')?.getAttribute('data-active')).toBe('false');
    expect(hook(element, 'routines-panel')).toBeNull();
    http.expectNone(ROUTINES_URL);

    hook(element, 'jobs-tab-routines')?.click();
    await fixture.whenStable();

    expect(hook(element, 'page-jobs')?.getAttribute('data-tab')).toBe('routines');
    expect(hook(element, 'jobs-tab-routines')?.getAttribute('data-active')).toBe('true');
    expect(hook(element, 'routines-panel')).not.toBeNull();
    expect(hook(element, 'job-row')).toBeNull();

    http.expectOne(ROUTINES_URL).flush({ data: [], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'routines-empty')).not.toBeNull();

    hook(element, 'jobs-tab-jobs')?.click();
    await fixture.whenStable();

    expect(hook(element, 'page-jobs')?.getAttribute('data-tab')).toBe('jobs');
    http.expectNone(ROUTINES_URL);
    expect(element.querySelectorAll('[data-testid="job-row"]')).toHaveLength(1);
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
      expect(translate('en', `jobs.detail.state.${state}`)).not.toBe(`jobs.detail.state.${state}`);
      expect(translate('es', `jobs.detail.state.${state}`)).not.toBe(`jobs.detail.state.${state}`);
    }

    const keys = [
      ...templateKeys('jobs.page.ts'),
      ...templateKeys('job.page.ts'),
      ...templateKeys('routines-panel.ts'),
    ];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(translate('en', key), `en ${key}`).not.toBe(key);
      expect(translate('es', key), `es ${key}`).not.toBe(key);
    }
  });
});

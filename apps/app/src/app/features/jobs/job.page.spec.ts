import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Job, Run } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { SecureStore } from '../../core/auth/secure-store';
import { JobPage } from './job.page';

const JOB_ID = 'job_01JABCDEFGHJKMNPQRSV';
const ROUTE_ID = 'job_1';
const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const RUN_ID = 'run_01JABCDEFGHJKMNPQRSV';

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

const RUN: Run = {
  id: RUN_ID,
  repoId: REPO_ID,
  jobId: JOB_ID,
  state: 'succeeded',
  trigger: 'schedule',
  branch: 'cb/run-x',
  baseRef: 'main',
  pr: null,
  gate: null,
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0.1, tokensIn: 10, tokensOut: 5 },
  createdAt: '2026-10-24T18:03:11Z',
  finishedAt: '2026-10-24T18:09:00Z',
};

const DETAIL = {
  job: JOB,
  lastRuns: [RUN],
  nextFires: ['2026-10-25T02:00:00Z', '2026-10-26T02:00:00Z'],
};

const DETAIL_URL = `/v1/jobs/${ROUTE_ID}`;
const PATCH_URL = `/v1/jobs/${ROUTE_ID}`;
const NEXT_URL = `/v1/jobs/${ROUTE_ID}/next?count=5`;
const RUN_URL = `/v1/jobs/${ROUTE_ID}/run`;

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
  readonly fixture: ComponentFixture<JobPage>;
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
    ],
  });
  const fixture = TestBed.createComponent(JobPage);
  fixture.componentRef.setInput('id', ROUTE_ID);
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, http: TestBed.inject(HttpTestingController) };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function typeInto(element: HTMLElement | null, value: string): void {
  if (element === null) throw new Error('missing input');
  if (element instanceof HTMLInputElement) element.value = value;
  element.dispatchEvent(new Event('input'));
}

describe('JobPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  async function mountWithDetail(detail: Record<string, unknown> = DETAIL): Promise<Mounted> {
    const mounted = await mount();
    mounted.http.expectOne(DETAIL_URL).flush(detail);
    await mounted.fixture.whenStable();
    return mounted;
  }

  it('renders the job, its previewed fires and its recent runs', async () => {
    const { element } = await mountWithDetail();

    expect(hook(element, 'page-job')?.getAttribute('data-enabled')).toBe('true');
    expect(hook(element, 'job-detail-loading')).toBeNull();
    expect(hook(element, 'job-cron')).not.toBeNull();
    expect(hook(element, 'job-timezone')).not.toBeNull();

    const fires = element.querySelectorAll<HTMLElement>('[data-testid="job-next-fire"]');
    expect(fires).toHaveLength(2);
    expect(fires[0]?.getAttribute('data-at')).toBe('2026-10-25T02:00:00Z');

    const history = element.querySelectorAll<HTMLElement>('[data-testid="job-history-run"]');
    expect(history).toHaveLength(1);
    expect(history[0]?.getAttribute('data-run-id')).toBe(RUN_ID);
    expect(history[0]?.getAttribute('data-state')).toBe('succeeded');
    expect(hook(element, 'job-history-empty')).toBeNull();
  });

  it('renders the empty history', async () => {
    const { element } = await mountWithDetail({ ...DETAIL, lastRuns: [] });

    expect(hook(element, 'job-history-empty')).not.toBeNull();
    expect(element.querySelectorAll('[data-testid="job-history-run"]')).toHaveLength(0);
  });

  it('blocks an invalid cron expression before any request', async () => {
    const { fixture, element, http } = await mountWithDetail();

    typeInto(hook(element, 'cron-input'), '0 3 * *');
    await fixture.whenStable();

    hook(element, 'job-save')?.click();
    await fixture.whenStable();

    expect(hook(element, 'job-validation')?.getAttribute('data-problems')).toBe('field_count');
    http.expectNone(PATCH_URL);
    http.expectNone(NEXT_URL);
  });

  it('blocks an unknown timezone before any request', async () => {
    const { fixture, element, http } = await mountWithDetail();

    typeInto(hook(element, 'job-timezone'), 'Mars/Olympus');
    await fixture.whenStable();

    hook(element, 'job-save')?.click();
    await fixture.whenStable();

    expect(hook(element, 'job-timezone-error')).not.toBeNull();
    http.expectNone(PATCH_URL);
  });

  it('saves a valid cron and renders the server preview', async () => {
    const { fixture, element, http } = await mountWithDetail();

    typeInto(hook(element, 'cron-input'), '15 4 * * 1-5');
    await fixture.whenStable();

    hook(element, 'job-save')?.click();
    await fixture.whenStable();

    const patch = http.expectOne({ method: 'PATCH', url: PATCH_URL });
    expect(patch.request.body).toEqual({ cron: '15 4 * * 1-5', timezone: 'Europe/Madrid' });
    patch.flush({ ...JOB, cron: '15 4 * * 1-5' });
    await fixture.whenStable();

    http
      .expectOne(NEXT_URL)
      .flush({ fires: ['2026-10-26T03:15:00Z', '2026-10-27T03:15:00Z'] });
    await fixture.whenStable();

    const fires = element.querySelectorAll<HTMLElement>('[data-testid="job-next-fire"]');
    expect(fires).toHaveLength(2);
    expect(fires[0]?.getAttribute('data-at')).toBe('2026-10-26T03:15:00Z');
    expect(fires[1]?.getAttribute('data-at')).toBe('2026-10-27T03:15:00Z');
    expect(hook(element, 'job-validation')).toBeNull();
  });

  it('runs the job now with an idempotency key', async () => {
    const { fixture, element, http } = await mountWithDetail();

    hook(element, 'job-run-now')?.click();
    await fixture.whenStable();

    const request = http.expectOne({ method: 'POST', url: RUN_URL });
    expect(request.request.headers.get('Idempotency-Key')).toBe(`runnow-${ROUTE_ID}-1`);
    request.flush({ ...RUN, state: 'queued' }, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();

    expect(hook(element, 'job-detail-error')).toBeNull();
  });

  it('renders the read error', async () => {
    const mounted = await mount();
    mounted.http.expectOne(DETAIL_URL).flush(
      { error: { code: 'not_found', message: 'Missing', requestId: 'req_01JABCDEFGHJKMNPQRSV' } },
      { status: 404, statusText: 'Not Found' },
    );
    await mounted.fixture.whenStable();

    expect(hook(mounted.element, 'job-detail-error')?.getAttribute('data-code')).toBe('not_found');
    expect(hook(mounted.element, 'job-detail-loading')).toBeNull();
  });
});

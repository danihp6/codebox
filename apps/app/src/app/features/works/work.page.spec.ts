import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { Repo, Run, Work, WorkDetail } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nService } from '../../core/i18n/i18n.service';
import { WorkPage } from './work.page';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const WORK_ID = 'wrk_01JABCDEFGHJK';
const DETAIL_URL = `/v1/works/${WORK_ID}`;

const REPO: Repo = {
  id: REPO_ID,
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: [],
  enabled: true,
  createdAt: '2026-10-24T18:03:11Z',
};

const RUN: Run = {
  id: 'run_01JABCDEFGHJK',
  repoId: REPO_ID,
  jobId: null,
  state: 'failed',
  trigger: 'manual',
  branch: 'cb/workers',
  baseRef: 'main',
  pr: { number: 12, url: 'https://github.com/acme/widgets/pull/12', mergeable: true },
  gate: { status: 'failed', exitCode: 1, durationMs: 900 },
  guardrails: [],
  blockers: [],
  diff: null,
  cost: { usd: 0.25, tokensIn: 1, tokensOut: 1 },
  createdAt: '2026-10-28T09:12:00Z',
  finishedAt: '2026-10-28T09:42:00Z',
};

function workIn(state: Work['state']): Work {
  return {
    id: WORK_ID,
    repoId: REPO_ID,
    backlogRef: 'Task-77',
    title: 'Workers view',
    prompt: 'Build the workers view.',
    specSha: '9f1c2ab',
    state,
    origin: 'backlog',
    attempts: 1,
    maxAttempts: 2,
    usage: { usd: 0.25, tokensIn: 1200, tokensOut: 300 },
    contextTokens: 1500,
    contextEpoch: 1,
    reviewedAt: null,
    createdAt: '2026-10-28T09:12:00Z',
    updatedAt: '2026-10-28T10:12:00Z',
  };
}

const i18nStub = { locale: () => 'en' as const };

interface Mounted {
  readonly fixture: ComponentFixture<WorkPage>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
}

async function mount(detail: WorkDetail = { work: workIn('running'), repo: REPO, runs: [RUN] }): Promise<Mounted> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: i18nStub },
    ],
  });
  const fixture = TestBed.createComponent(WorkPage);
  fixture.componentRef.setInput('id', WORK_ID);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(DETAIL_URL).flush(detail);
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, http };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function actionCount(element: HTMLElement): number {
  return element.querySelectorAll(
    '[data-testid="work-resolve-doubt"], [data-testid="work-rework"]',
  ).length;
}

describe('WorkPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('carries no composer and no send button anywhere', async () => {
    const { element } = await mount();

    expect(element.querySelector('textarea')).toBeNull();
    expect(element.querySelector('[data-testid="composer"]')).toBeNull();
    const ids = [...element.querySelectorAll('[data-testid]')].map(
      (node) => node.getAttribute('data-testid') ?? '',
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => id.endsWith('-send'))).toEqual([]);
  });

  it('renders the header facts from the work', async () => {
    const { element } = await mount();

    expect(hook(element, 'page-work')).not.toBeNull();
    expect(hook(element, 'work-header')).not.toBeNull();
    expect(hook(element, 'work-repository')?.textContent?.trim()).toBe('acme/widgets');
    expect(hook(element, 'work-state')?.getAttribute('data-state')).toBe('running');
    expect(hook(element, 'work-backlog-ref')?.textContent?.trim()).toBe('Task-77');
    expect(hook(element, 'work-attempts')?.textContent?.trim()).toBe('1 of 2');
    expect(hook(element, 'work-context')?.textContent).toContain('1500');
    expect(hook(element, 'work-cost')?.textContent).toContain('$0.25');
  });

  it('renders the gate and PR cards from run state, not from prose', async () => {
    const { element } = await mount();

    const gate = hook(element, 'work-run-gate');
    expect(gate?.getAttribute('data-status')).toBe('failed');
    expect(gate?.getAttribute('data-exit-code')).toBe('1');
    expect(hook(element, 'work-run-pr')?.getAttribute('data-state')).toBe('open');
    expect(hook(element, 'work-run-branch')?.textContent?.trim()).toBe('cb/workers');
  });

  it('flips the gate card when only the gate status changes', async () => {
    const failed = await mount();
    const passed = await mount({
      work: workIn('running'),
      repo: REPO,
      runs: [{ ...RUN, gate: { status: 'passed', exitCode: 0, durationMs: 900 } }],
    });

    expect(hook(failed.element, 'work-run-gate')?.getAttribute('data-status')).toBe('failed');
    expect(hook(passed.element, 'work-run-gate')?.getAttribute('data-status')).toBe('passed');
    expect(hook(passed.element, 'work-run-gate')?.getAttribute('data-exit-code')).toBe('0');
    expect(hook(passed.element, 'work-run-pr')?.getAttribute('data-state')).toBe('open');
  });

  it('ticks the backlog item on a merged run', async () => {
    const { element } = await mount({
      work: workIn('merged'),
      repo: REPO,
      runs: [{ ...RUN, state: 'succeeded', gate: { status: 'passed', exitCode: 0, durationMs: 900 } }],
    });

    expect(hook(element, 'work-run-pr')?.getAttribute('data-state')).toBe('merged');
    expect(hook(element, 'work-run-backlog-tick')?.textContent?.trim()).toBe('Task-77');
  });

  it('offers exactly one action when the work is blocked', async () => {
    const blocked = await mount({ work: workIn('needs_decision'), repo: REPO, runs: [RUN] });
    expect(actionCount(blocked.element)).toBe(1);
    expect(hook(blocked.element, 'work-resolve-doubt')).not.toBeNull();
    expect(hook(blocked.element, 'work-rework')).toBeNull();

    const merged = await mount({ work: workIn('merged'), repo: REPO, runs: [RUN] });
    expect(actionCount(merged.element)).toBe(1);
    expect(hook(merged.element, 'work-rework')).not.toBeNull();
    expect(hook(merged.element, 'work-resolve-doubt')).toBeNull();

    const running = await mount();
    expect(actionCount(running.element)).toBe(0);
  });

  it('resolves the doubt from the one action', async () => {
    const { element, http, fixture } = await mount({
      work: workIn('needs_decision'),
      repo: REPO,
      runs: [RUN],
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    hook(element, 'work-resolve-doubt')?.click();
    await fixture.whenStable();

    http
      .expectOne({ method: 'POST', url: `/v1/works/${WORK_ID}/decision` })
      .flush(
        {
          id: 'sess_01JABCDEFGHJK',
          repoId: REPO_ID,
          target: 'work',
          workId: WORK_ID,
          title: 'Resolve the doubt',
          status: 'idle',
          branch: null,
          pendingProposal: null,
          usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
          contextTokens: 0,
          contextEpoch: 1,
          createdAt: '2026-10-28T09:12:00Z',
          updatedAt: '2026-10-28T09:12:00Z',
          lastMessage: null,
        },
        { status: 201, statusText: 'Created' },
      );
  });

  it('renders the error with its code and retries', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: I18nService, useValue: i18nStub },
      ],
    });
    const fixture = TestBed.createComponent(WorkPage);
    fixture.componentRef.setInput('id', WORK_ID);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne(DETAIL_URL)
      .flush(
        { error: { code: 'not_found', message: 'Gone' } },
        { status: 404, statusText: 'Not Found' },
      );
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(hook(element, 'work-error')?.getAttribute('data-code')).toBe('not_found');

    hook(element, 'work-retry')?.click();
    await fixture.whenStable();
    http.expectOne(DETAIL_URL).flush({ work: workIn('running'), repo: REPO, runs: [RUN] });
    await fixture.whenStable();

    expect(hook(element, 'work-error')).toBeNull();
    expect(hook(element, 'work-header')).not.toBeNull();
  });
});

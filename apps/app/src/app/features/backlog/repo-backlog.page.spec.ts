import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Backlog, BacklogItem, RepoDetail, SseStreamEvent, WorkState } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { STRINGS, translate } from './i18n';
import { RepoBacklogPage } from './repo-backlog.page';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const WORK_ID = 'wrk_01JABCDEFG';
const BACKLOG_URL = `/v1/repos/${REPO_ID}/backlog`;
const REPO_URL = `/v1/repos/${REPO_ID}`;

const REPO: RepoDetail = {
  id: REPO_ID,
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: ['.github/**'],
  enabled: true,
  createdAt: '2026-10-24T18:03:11Z',
  lastRun: null,
};

const FIXTURE_ITEM: BacklogItem = {
  ref: 'Task-77',
  title: "Workers view: the repository's Workers tab",
  checked: false,
  line: 1,
  needs: [],
  work: { id: WORK_ID, state: 'running', runs: 2 },
};

const DEP_ITEMS: readonly BacklogItem[] = [
  { ref: 'Task-01', title: 'Root', checked: false, line: 1, needs: [], work: null },
  { ref: 'Task-02', title: 'Chain', checked: false, line: 2, needs: ['Task-01'], work: null },
  {
    ref: 'Task-03',
    title: 'Branch',
    checked: false,
    line: 3,
    needs: ['Task-01', 'Task-02'],
    work: null,
  },
  { ref: 'Task-04', title: 'External', checked: false, line: 4, needs: ['Task-99'], work: null },
];

const STATES: readonly (WorkState | 'none')[] = [
  'queued',
  'running',
  'review',
  'merged',
  'failed',
  'needs_decision',
  'abandoned',
  'none',
];

function backlogOf(items: readonly BacklogItem[]): Backlog {
  return {
    repoId: REPO_ID,
    revision: '9f1c2ab',
    path: 'TODO.md',
    sections: [{ title: 'Batch 20', items: [...items] }],
  };
}

function stateItems(): readonly BacklogItem[] {
  return STATES.map((state, index) => ({
    ref: `Task-${80 + index}`,
    title: `Item ${state}`,
    checked: false,
    line: index + 1,
    needs: [],
    work:
      state === 'none' ? null : { id: `wrk_01JABCDEF${String(index).padStart(2, '0')}`, state, runs: index },
  }));
}

const i18nStub = { locale: () => 'en' as const };

interface Mounted {
  readonly fixture: ComponentFixture<RepoBacklogPage>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
  readonly stream: ReturnType<typeof signal<SseStreamEvent | null>>;
}

async function mount(backlog: Backlog = backlogOf([FIXTURE_ITEM])): Promise<Mounted> {
  const stream = signal<SseStreamEvent | null>(null);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: i18nStub },
      { provide: SseService, useValue: { event: stream } },
    ],
  });
  const fixture = TestBed.createComponent(RepoBacklogPage);
  fixture.componentRef.setInput('id', REPO_ID);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(REPO_URL).flush(REPO);
  http.expectOne(BACKLOG_URL).flush(backlog);
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, http, stream };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

describe('RepoBacklogPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders plan and state separately on one backlog row', async () => {
    const { element } = await mount();

    const row = hook(element, 'backlog-row');
    expect(row?.getAttribute('data-ref')).toBe('Task-77');
    expect(row?.getAttribute('data-state')).toBe('running');
    expect(row?.getAttribute('data-checked')).toBe('false');

    expect(hook(element, 'backlog-row-ref')?.textContent?.trim()).toBe('Task-77');
    const title = hook(element, 'backlog-row-title')?.textContent?.trim();
    expect(title).toBe("Workers view: the repository's Workers tab");
    expect(title).not.toContain(translate('en', 'backlog.state.running'));

    const chip = hook(element, 'backlog-row-state');
    expect(chip?.getAttribute('data-state')).toBe('running');
    expect(chip?.textContent?.trim()).toBe(translate('en', 'backlog.state.running'));
    expect(hook(element, 'backlog-row-runs')?.textContent?.trim()).toBe('2 runs');
    expect(hook(element, 'backlog-run-Task-77')).toBeNull();
  });

  it('labels every work state and none from the contract enum, with no fallback', async () => {
    const { element } = await mount(backlogOf(stateItems()));

    const chips = [...element.querySelectorAll<HTMLElement>('[data-testid="backlog-row-state"]')];
    expect(chips).toHaveLength(STATES.length);
    const labels = chips.map((chip) => chip.textContent?.trim() ?? '');
    expect(new Set(labels).size).toBe(STATES.length);
    for (const [index, state] of STATES.entries()) {
      expect(chips[index]?.getAttribute('data-state')).toBe(state);
      expect(labels[index]).toBe(translate('en', `backlog.state.${state}`));
    }
  });

  it('offers Run only on a pending item that has no live work', async () => {
    const { element } = await mount(
      backlogOf([
        { ref: 'Task-81', title: 'Pending', checked: false, line: 1, needs: [], work: null },
        { ref: 'Task-82', title: 'Checked', checked: true, line: 2, needs: [], work: null },
        {
          ref: 'Task-83',
          title: 'Failed',
          checked: false,
          line: 3,
          needs: [],
          work: { id: 'wrk_01JABCDEFG1', state: 'failed', runs: 1 },
        },
        {
          ref: 'Task-84',
          title: 'Merged',
          checked: false,
          line: 4,
          needs: [],
          work: { id: 'wrk_01JABCDEFG2', state: 'merged', runs: 2 },
        },
      ]),
    );

    expect(hook(element, 'backlog-run-Task-81')).not.toBeNull();
    expect(hook(element, 'backlog-run-Task-82')).toBeNull();
    expect(hook(element, 'backlog-run-Task-83')).not.toBeNull();
    expect(hook(element, 'backlog-run-Task-84')).not.toBeNull();
  });

  it('shows the live-work conflict and makes no second call', async () => {
    const { element, http, fixture } = await mount(
      backlogOf([
        { ref: 'Task-77', title: 'Workers view', checked: false, line: 1, needs: [], work: null },
      ]),
    );

    hook(element, 'backlog-run-Task-77')?.click();
    await fixture.whenStable();
    http
      .expectOne({ method: 'POST', url: '/v1/works' })
      .flush(
        {
          error: {
            code: 'conflict',
            message: 'Live work',
            details: { reason: 'live_work', workId: WORK_ID },
          },
        },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();

    expect(hook(element, 'backlog-live-work')).not.toBeNull();
    expect(hook(element, 'backlog-error')).toBeNull();
    http.expectNone({ method: 'POST', url: `/v1/works/${WORK_ID}/runs` });
  });

  it('renders the error with its code and retries', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: I18nService, useValue: i18nStub },
        { provide: SseService, useValue: { event: signal<SseStreamEvent | null>(null) } },
      ],
    });
    const fixture = TestBed.createComponent(RepoBacklogPage);
    fixture.componentRef.setInput('id', REPO_ID);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(REPO_URL).flush(REPO);
    http
      .expectOne(BACKLOG_URL)
      .flush(
        { error: { code: 'agent_unavailable', message: 'Down' } },
        { status: 502, statusText: 'Bad Gateway' },
      );
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(hook(element, 'backlog-error')?.getAttribute('data-code')).toBe('agent_unavailable');

    hook(element, 'backlog-retry')?.click();
    await fixture.whenStable();
    http.expectOne(BACKLOG_URL).flush(backlogOf([FIXTURE_ITEM]));
    await fixture.whenStable();
    expect(hook(element, 'backlog-error')).toBeNull();
  });

  it('refetches the backlog when this repository publishes backlog.changed', async () => {
    const { fixture, http, stream } = await mount();

    stream.set({
      event: 'backlog.changed',
      data: { repoId: 'repo_01JABCDEFGHJKMNPQRSW', revision: '9f1c2ab', ts: '2026-10-28T09:12:00Z' },
    });
    await fixture.whenStable();
    http.expectNone(BACKLOG_URL);

    stream.set({
      event: 'backlog.changed',
      data: { repoId: REPO_ID, revision: '9f1c2ac', ts: '2026-10-28T09:13:00Z' },
    });
    await fixture.whenStable();
    http.expectOne(BACKLOG_URL).flush(backlogOf([FIXTURE_ITEM]));
    await fixture.whenStable();

    expect(hook(fixture.nativeElement as HTMLElement, 'backlog-row')).not.toBeNull();
  });

  it('opens the new-session sheet from the header chat button', async () => {
    const { element, http, fixture } = await mount();

    expect(hook(element, 'repo-chat-button')).not.toBeNull();
    expect(element.querySelectorAll('[data-testid^="repo-tab-"]')).toHaveLength(4);
    hook(element, 'repo-chat-button')?.click();
    await fixture.whenStable();

    expect(hook(element, 'new-session-sheet')).not.toBeNull();
    http.expectNone({ method: 'POST', url: '/v1/sessions' });
  });

  it('draws one rail edge per dependency and none for a root', async () => {
    const { element } = await mount(backlogOf(DEP_ITEMS));

    expect(hook(element, 'backlog-rail')?.getAttribute('data-edges')).toBe('4');
    expect(hook(element, 'backlog-rail-empty')).toBeNull();
    const edges = [...element.querySelectorAll<HTMLElement>('[data-testid="backlog-rail-edge"]')];
    expect(
      edges.map((edge) => [
        edge.getAttribute('data-from'),
        edge.getAttribute('data-to'),
        edge.getAttribute('data-kind'),
      ]),
    ).toEqual([
      ['Task-02', 'Task-01', 'chain'],
      ['Task-03', 'Task-01', 'branch'],
      ['Task-03', 'Task-02', 'branch'],
      ['Task-04', 'Task-99', 'external'],
    ]);
    expect(edges.some((edge) => edge.getAttribute('data-from') === 'Task-01')).toBe(false);
    expect(edges[3]?.textContent).toContain('Task-04 → Task-99');
    expect(edges[3]?.textContent).toContain(translate('en', 'backlog.rail.external'));

    const root = element.querySelector<HTMLElement>('[data-testid="backlog-row"][data-ref="Task-01"]');
    expect(root?.getAttribute('data-needs')).toBe('');
    expect(root?.getAttribute('data-unmet-needs')).toBe('');
    expect(root?.querySelector('[data-testid="backlog-row-needs"]')).toBeNull();
    expect(root?.querySelector('[data-testid="backlog-row-unmet-needs"]')).toBeNull();
  });

  it('lists every need and every unmet need on its row', async () => {
    const { element } = await mount(backlogOf(DEP_ITEMS));

    const branch = element.querySelector<HTMLElement>(
      '[data-testid="backlog-row"][data-ref="Task-03"]',
    );
    expect(branch?.getAttribute('data-needs')).toBe('Task-01 Task-02');
    expect(branch?.getAttribute('data-unmet-needs')).toBe('Task-01 Task-02');
    const unmet = branch?.querySelector('[data-testid="backlog-row-unmet-needs"]');
    expect(unmet?.textContent).toContain('Task-01');
    expect(unmet?.textContent).toContain('Task-02');
    const needs = branch?.querySelector('[data-testid="backlog-row-needs"]');
    expect(needs?.textContent).toContain(`${translate('en', 'backlog.needs')}: Task-01, Task-02`);

    const select = branch?.querySelector('[data-testid="backlog-row-select"]');
    expect(select?.tagName).toBe('BUTTON');
    expect(select?.getAttribute('type')).toBe('button');
    expect(select?.getAttribute('aria-pressed')).toBe('false');
    expect(select?.querySelector('[data-testid="backlog-row-ref"]')?.textContent?.trim()).toBe(
      'Task-03',
    );
  });

  it('lists a missing dependency next to an unchecked one on a blocked row', async () => {
    const blocked: BacklogItem = {
      ref: 'Task-04',
      title: 'Blocked',
      checked: false,
      line: 4,
      needs: ['Task-01', 'Task-99'],
      work: null,
    };
    const { element } = await mount(
      backlogOf([...DEP_ITEMS.filter((item) => item.ref !== 'Task-04'), blocked]),
    );

    const row = element.querySelector<HTMLElement>('[data-testid="backlog-row"][data-ref="Task-04"]');
    expect(row?.getAttribute('data-unmet-needs')).toBe('Task-01 Task-99');
    const unmet = row?.querySelector('[data-testid="backlog-row-unmet-needs"]')?.textContent ?? '';
    expect(unmet).toContain('Task-01');
    expect(unmet).toContain('Task-99');
  });

  it('opens the detail panel for the selected row', async () => {
    const { element, fixture } = await mount(backlogOf(DEP_ITEMS));

    expect(hook(element, 'backlog-detail')).not.toBeNull();
    expect(hook(element, 'backlog-detail-empty')).not.toBeNull();
    expect(hook(element, 'backlog-detail-ref')).toBeNull();

    const row = element.querySelector<HTMLElement>('[data-testid="backlog-row"][data-ref="Task-03"]');
    const select = row?.querySelector<HTMLElement>('[data-testid="backlog-row-select"]');
    select?.click();
    await fixture.whenStable();

    expect(select?.getAttribute('aria-pressed')).toBe('true');
    expect(hook(element, 'backlog-detail-empty')).toBeNull();
    expect(hook(element, 'backlog-detail-ref')?.textContent?.trim()).toBe('Task-03');
    expect(hook(element, 'backlog-detail-title')?.textContent?.trim()).toBe('Branch');
    expect(hook(element, 'backlog-detail-needs')?.textContent?.trim()).toBe('Task-01, Task-02');
    expect(hook(element, 'backlog-detail-unmet')?.textContent?.trim()).toBe('Task-01, Task-02');
    expect(hook(element, 'backlog-detail-work')).toBeNull();
  });

  it('says none in the detail panel and links the work when there is one', async () => {
    const { element, fixture } = await mount();

    const select = element.querySelector<HTMLElement>('[data-testid="backlog-row-select"]');
    select?.click();
    await fixture.whenStable();

    expect(hook(element, 'backlog-detail-ref')?.textContent?.trim()).toBe('Task-77');
    expect(hook(element, 'backlog-detail-needs')?.textContent?.trim()).toBe(
      translate('en', 'backlog.detail.none'),
    );
    expect(hook(element, 'backlog-detail-unmet')?.textContent?.trim()).toBe(
      translate('en', 'backlog.detail.none'),
    );
    expect(hook(element, 'backlog-detail-work')?.getAttribute('href')).toBe(`/works/${WORK_ID}`);
  });

  it('says the rail is empty when no item declares a dependency', async () => {
    const { element } = await mount();

    expect(hook(element, 'backlog-rail')?.getAttribute('data-edges')).toBe('0');
    expect(hook(element, 'backlog-rail-empty')).not.toBeNull();
    expect(element.querySelectorAll('[data-testid="backlog-rail-edge"]')).toHaveLength(0);
  });

  it('ships the same dictionary keys in both locales, with the rail and detail copy', () => {
    expect(Object.keys(STRINGS.es).sort()).toEqual(Object.keys(STRINGS.en).sort());
    for (const key of [
      'backlog.rail',
      'backlog.rail.empty',
      'backlog.rail.chain',
      'backlog.rail.branch',
      'backlog.rail.external',
      'backlog.detail',
      'backlog.detail.empty',
      'backlog.detail.none',
      'backlog.detail.open',
      'backlog.needs',
      'backlog.unmet',
    ]) {
      expect(STRINGS.en[key]).toBeTruthy();
      expect(STRINGS.es[key]).toBeTruthy();
    }
  });
});

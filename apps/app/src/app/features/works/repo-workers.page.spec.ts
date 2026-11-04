import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Work, WorkState } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nService } from '../../core/i18n/i18n.service';
import { STRINGS, translate } from './i18n';
import { RepoWorkersPage } from './repo-workers.page';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';
const LIST_URL = `/v1/works?repoId=${REPO_ID}`;

function work(id: string, backlogRef: string, state: WorkState): Work {
  return {
    id,
    repoId: REPO_ID,
    backlogRef,
    title: `Work ${backlogRef}`,
    prompt: 'Do the thing.',
    specSha: '9f1c2ab',
    state,
    origin: 'backlog',
    attempts: 1,
    maxAttempts: 2,
    usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
    contextTokens: 0,
    contextEpoch: 1,
    reviewedAt: null,
    createdAt: '2026-10-28T09:12:00Z',
    updatedAt: '2026-10-28T09:12:00Z',
  };
}

function withCost(source: Work, usd: number): Work {
  return { ...source, usage: { ...source.usage, usd } };
}

const QUEUED = work('wrk_01JABCDEF01', 'Task-74', 'queued');
const RUNNING = work('wrk_01JABCDEF02', 'Task-78', 'running');
const REVIEW = work('wrk_01JABCDEF03', 'Task-75', 'review');
const BLOCKED = work('wrk_01JABCDEF04', 'Task-77', 'needs_decision');
const MERGED = work('wrk_01JABCDEF05', 'Task-76', 'merged');

const FIXTURE = [RUNNING, BLOCKED, MERGED, REVIEW, QUEUED] as const;

const i18nStub = { locale: () => 'en' as const };

interface Mounted {
  readonly fixture: ComponentFixture<RepoWorkersPage>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
}

function configure(): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: i18nStub },
    ],
  });
}

async function mount(works: readonly Work[]): Promise<Mounted> {
  configure();
  const fixture = TestBed.createComponent(RepoWorkersPage);
  fixture.componentRef.setInput('id', REPO_ID);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(LIST_URL).flush({ data: [...works], nextCursor: null });
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, http };
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function hooks(element: HTMLElement, id: string): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
}

function room(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="worker-room"][data-room="${id}"]`);
}

function roomFaces(element: HTMLElement, id: string): HTMLElement[] {
  return [
    ...(room(element, id)?.querySelectorAll<HTMLElement>('[data-testid="worker-face"]') ?? []),
  ];
}

function faces(element: HTMLElement): HTMLElement[] {
  return hooks(element, 'worker-face');
}

function facesWithState(element: HTMLElement, state: string): HTMLElement[] {
  return faces(element).filter((face) => face.getAttribute('data-state') === state);
}

function faceFor(element: HTMLElement, workId: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(
    `[data-testid="worker-face"][data-work-id="${workId}"]`,
  );
}

function decoration(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function must<T>(value: T | null): T {
  if (value === null) throw new Error('missing element');
  return value;
}

const MOTION_DECORATIONS = ['workers-truck', 'workers-package', 'workers-token'] as const;

/** The drawing's order, read off the document: the road in, the four rooms, the belt out. */
function factorySequence(element: HTMLElement): string[] {
  const container = must(element.querySelector<HTMLElement>('.cb-workers'));
  const sequence =
    '[data-testid="workers-road-in"], [data-testid="worker-room"], ' +
    '[data-testid="workers-token"], [data-testid="workers-belt-out"]';
  return [...container.querySelectorAll<HTMLElement>(sequence)].map((node) => {
    const testId = node.getAttribute('data-testid');
    return testId === 'worker-room'
      ? `room:${node.getAttribute('data-room') ?? ''}`
      : (testId ?? '');
  });
}

async function boardStateOf(works: readonly Work[]): Promise<string | null> {
  const { element } = await mount(works);
  return hook(element, 'page-repo-workers')?.getAttribute('data-board-state') ?? null;
}

describe('RepoWorkersPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the four states from the daemon states of five works', async () => {
    const { element } = await mount(FIXTURE);

    expect(faces(element)).toHaveLength(5);
    expect(facesWithState(element, 'queued')).toHaveLength(1);
    expect(facesWithState(element, 'needs-you')).toHaveLength(1);
    expect(facesWithState(element, 'asleep')).toHaveLength(1);
    // `review` and `running` share the floor state `running` (workers.model.ts), so DEV holds one
    // and QA holds the other.
    expect(facesWithState(element, 'running')).toHaveLength(2);

    expect(room(element, 'QA')?.contains(faceFor(element, REVIEW.id) ?? null)).toBe(true);
    expect(room(element, 'DEV')?.contains(faceFor(element, RUNNING.id) ?? null)).toBe(true);
    expect(room(element, 'ORQ')?.contains(faceFor(element, BLOCKED.id) ?? null)).toBe(true);
    expect(faceFor(element, QUEUED.id)?.getAttribute('data-state')).toBe('queued');
  });

  it('keeps the blocked task off the builder floor and badges it in ORQ', async () => {
    const { element } = await mount(FIXTURE);

    const orqFaces = roomFaces(element, 'ORQ');
    expect(orqFaces).toHaveLength(1);
    expect(orqFaces[0]?.getAttribute('data-work-id')).toBe(BLOCKED.id);
    expect(orqFaces[0]?.querySelector('[data-testid="worker-badge-needs-you"]')).not.toBeNull();

    const devFaces = roomFaces(element, 'DEV');
    expect(devFaces).toHaveLength(1);
    expect(devFaces[0]?.getAttribute('data-work-id')).toBe(RUNNING.id);
    expect(devFaces.some((face) => face.getAttribute('data-work-id') === BLOCKED.id)).toBe(false);
    expect(facesWithState(element, 'needs-you')).toHaveLength(1);
  });

  it('opens the agent log from every face and offers no per-agent button', async () => {
    const { element } = await mount(FIXTURE);
    const refs = new Map(FIXTURE.map((work) => [work.id, work.backlogRef]));

    for (const face of faces(element)) {
      const workId = face.getAttribute('data-work-id') ?? '';
      expect(face.tagName).toBe('A');
      expect(face.getAttribute('href')).toBe(`/works/${workId}`);
      expect(
        face.querySelector<HTMLElement>('[data-testid="worker-chip"]')?.textContent?.trim(),
      ).toBe(refs.get(workId));
      expect(face.querySelector('[data-testid="worker-face-title"]')).not.toBeNull();
      expect(
        face.querySelector<HTMLElement>('[data-testid="worker-face-state"]')?.textContent?.trim(),
      ).toMatch(/^(Queued|Running|Needs you|Asleep)$/);
    }

    expect(
      hooks(element, 'worker-face').some((face) => face.querySelector('button, [role="button"]')),
    ).toBe(false);
    expect(faces(element).some((face) => face.getAttribute('role') === 'button')).toBe(false);
    expect(hook(element, 'repo-workers-empty')).toBeNull();
  });

  it('draws the road in, the four rooms in order and the belt out', async () => {
    const { element } = await mount(FIXTURE);

    const roadIn = hook(element, 'workers-road-in');
    const beltOut = hook(element, 'workers-belt-out');
    expect(roadIn?.getAttribute('data-count')).toBe('1');
    expect(beltOut?.getAttribute('data-count')).toBe('1');
    expect(roadIn?.querySelector('[data-testid="worker-face"]')?.getAttribute('data-work-id')).toBe(
      QUEUED.id,
    );
    expect(
      beltOut?.querySelector('[data-testid="worker-face"]')?.getAttribute('data-work-id'),
    ).toBe(MERGED.id);

    const rooms = hooks(element, 'worker-room').map((section) => section.getAttribute('data-room'));
    expect(rooms).toEqual(['ORQ', 'ARC', 'DEV', 'QA']);
    expect(
      room(element, 'ARC')
        ?.querySelector('[data-testid="worker-room-empty"]')
        ?.getAttribute('data-room'),
    ).toBe('ARC');
    expect(roadIn?.getAttribute('data-testid')).toBe('workers-road-in');
    expect(beltOut?.getAttribute('data-testid')).toBe('workers-belt-out');
  });

  it('assigns the four blink phases in board order and wraps every four faces', async () => {
    const { element } = await mount(FIXTURE);

    const all = faces(element);
    expect(all).toHaveLength(5);
    const phases = all.map((face) => face.getAttribute('data-blink-phase'));
    for (const phase of phases) {
      expect(['0', '1', '2', '3']).toContain(phase);
    }
    expect(new Set(phases.slice(0, 4)).size).toBe(4);

    const phaseOf = (workId: string): string | null =>
      faceFor(element, workId)?.getAttribute('data-blink-phase') ?? null;
    expect(phaseOf(QUEUED.id)).toBe('0');
    expect(phaseOf(BLOCKED.id)).toBe('1');
    expect(phaseOf(RUNNING.id)).toBe('2');
    expect(phaseOf(REVIEW.id)).toBe('3');
    expect(phaseOf(MERGED.id)).toBe('0');
  });

  it('runs the truck, the package and the token without covering a face', async () => {
    const { element } = await mount(FIXTURE);

    for (const id of MOTION_DECORATIONS) {
      const node = must(decoration(element, id));
      expect(node.tagName).toBe('SPAN');
      expect(node.getAttribute('aria-hidden')).toBe('true');
      expect(node.textContent?.trim()).toBe('');
      expect(node.hasAttribute('role')).toBe(false);
      expect(node.querySelector('[data-testid="worker-face"]')).toBeNull();
    }

    expect(
      must(hook(element, 'workers-road-in')).contains(must(decoration(element, 'workers-truck'))),
    ).toBe(true);
    expect(
      must(hook(element, 'workers-belt-out')).contains(
        must(decoration(element, 'workers-package')),
      ),
    ).toBe(true);
    expect(decoration(element, 'workers-token')?.closest('[data-testid="worker-room"]')).toBeNull();
    expect(factorySequence(element)).toEqual([
      'workers-road-in',
      'room:ORQ',
      'room:ARC',
      'room:DEV',
      'workers-token',
      'room:QA',
      'workers-belt-out',
    ]);
  });

  it('keeps the factory shape on a repository with no work', async () => {
    const { element } = await mount([]);

    expect(hook(element, 'repo-workers-empty')?.getAttribute('data-board-state')).toBe('asleep');
    expect(hook(element, 'repo-workers-empty')?.textContent?.trim()).toBe(
      translate('en', 'workers.empty'),
    );
    expect(faces(element)).toHaveLength(0);
    expect(hooks(element, 'worker-room')).toHaveLength(4);
    expect(hooks(element, 'worker-room-empty')).toHaveLength(4);
    expect(hook(element, 'workers-road-in')?.getAttribute('data-count')).toBe('0');
    expect(hook(element, 'workers-belt-out')?.getAttribute('data-count')).toBe('0');
    for (const id of MOTION_DECORATIONS) {
      expect(decoration(element, id)).toBeNull();
    }
    expect(hook(element, 'workers-chip-waiting')?.getAttribute('data-count')).toBe('0');
    expect(hook(element, 'workers-chip-delivered')?.getAttribute('data-count')).toBe('0');
    expect(hook(element, 'page-repo-workers')?.getAttribute('data-board-state')).toBe('asleep');
  });

  it('renders the error with its code and retries', async () => {
    configure();
    const fixture = TestBed.createComponent(RepoWorkersPage);
    fixture.componentRef.setInput('id', REPO_ID);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne(LIST_URL)
      .flush(
        { error: { code: 'agent_unavailable', message: 'Down' } },
        { status: 502, statusText: 'Bad Gateway' },
      );
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(hook(element, 'repo-workers-error')?.getAttribute('data-code')).toBe(
      'agent_unavailable',
    );

    hook(element, 'repo-workers-retry')?.click();
    await fixture.whenStable();
    http.expectOne(LIST_URL).flush({ data: [RUNNING], nextCursor: null });
    await fixture.whenStable();

    expect(hook(element, 'repo-workers-error')).toBeNull();
    expect(faceFor(element, RUNNING.id)).not.toBeNull();
  });
});

describe('RepoWorkersPage board state', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('reads queued when the only work is waiting to enter', async () => {
    expect(await boardStateOf([QUEUED])).toBe('queued');
  });

  it('reads running when a work sits on the builder floor', async () => {
    expect(await boardStateOf([REVIEW])).toBe('running');
  });

  it('puts needs-you above running and queued', async () => {
    expect(await boardStateOf([QUEUED, RUNNING, BLOCKED])).toBe('needs-you');
  });

  it('reads asleep on an empty repository', async () => {
    expect(await boardStateOf([])).toBe('asleep');
  });

  it('reads asleep when every work has been delivered', async () => {
    expect(await boardStateOf([MERGED])).toBe('asleep');
  });
});

describe('RepoWorkersPage drawing', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('holds the room grid, the two lanes and the two chips inside the dashed plan card', async () => {
    const { element } = await mount(FIXTURE);
    const plan = must(hook(element, 'workers-plan'));

    expect(hook(element, 'workers-room-grid')).not.toBeNull();
    expect(plan.contains(must(hook(element, 'workers-room-grid')))).toBe(true);
    expect(plan.contains(must(hook(element, 'workers-road-in')))).toBe(true);
    expect(plan.contains(must(hook(element, 'workers-belt-out')))).toBe(true);
    expect(plan.contains(must(hook(element, 'workers-chip-waiting')))).toBe(true);
    expect(plan.contains(must(hook(element, 'workers-chip-delivered')))).toBe(true);
    expect(hooks(element, 'workers-face-ring')).toHaveLength(faces(element).length);
  });
  it('colours the ring around a face by that face state', async () => {
    const { element } = await mount(FIXTURE);

    for (const face of faces(element)) {
      const ring = must(face.querySelector<HTMLElement>('[data-testid="workers-face-ring"]'));
      expect(ring.getAttribute('data-state')).toBe(face.getAttribute('data-state'));
      expect(ring.textContent?.trim()).not.toBe('');
    }
    expect(
      must(faceFor(element, BLOCKED.id)).querySelector('[data-testid="workers-face-ring"]'),
    ).not.toBeNull();
  });

  it('carries the lane count on the two chips', async () => {
    const { element } = await mount(FIXTURE);

    const waiting = must(hook(element, 'workers-chip-waiting'));
    const delivered = must(hook(element, 'workers-chip-delivered'));
    expect(waiting.tagName).toBe('BUTTON');
    expect(waiting.getAttribute('type')).toBe('button');
    expect(waiting.getAttribute('data-count')).toBe('1');
    expect(delivered.getAttribute('data-count')).toBe('1');
    expect(waiting.getAttribute('aria-label')).toBe('Waiting to enter · 1');
    expect(delivered.getAttribute('aria-label')).toBe('Delivered · 1');
  });

  it('opens one sheet per chip with a row per lane card and closes it', async () => {
    const { fixture, element } = await mount(FIXTURE);

    expect(hook(element, 'workers-sheet')).toBeNull();

    must(hook(element, 'workers-chip-waiting')).click();
    await fixture.whenStable();
    const waiting = must(hook(element, 'workers-sheet'));
    expect(waiting.getAttribute('data-lane')).toBe('road-in');
    expect(
      hooks(waiting, 'workers-sheet-row').map((row) => row.getAttribute('data-work-id')),
    ).toEqual([QUEUED.id]);
    expect(waiting.querySelector('[data-testid="worker-face"]')).toBeNull();
    expect(waiting.querySelector('a')?.getAttribute('href')).toBe(`/works/${QUEUED.id}`);

    must(hook(element, 'workers-sheet-close')).click();
    await fixture.whenStable();
    expect(hook(element, 'workers-sheet')).toBeNull();

    must(hook(element, 'workers-chip-delivered')).click();
    await fixture.whenStable();
    const delivered = must(hook(element, 'workers-sheet'));
    expect(delivered.getAttribute('data-lane')).toBe('belt-out');
    expect(
      hooks(delivered, 'workers-sheet-row').map((row) => row.getAttribute('data-work-id')),
    ).toEqual([MERGED.id]);
  });

  it('closes the sheet with Escape', async () => {
    const { fixture, element } = await mount(FIXTURE);

    must(hook(element, 'workers-chip-waiting')).click();
    await fixture.whenStable();
    expect(hook(element, 'workers-sheet')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(hook(element, 'workers-sheet')).toBeNull();
  });

  it('says when an opened lane has nothing in it', async () => {
    const { fixture, element } = await mount([]);

    must(hook(element, 'workers-chip-waiting')).click();
    await fixture.whenStable();

    const sheet = must(hook(element, 'workers-sheet'));
    expect(hooks(sheet, 'workers-sheet-row')).toHaveLength(0);
    expect(sheet.textContent).toContain('No work here yet.');
  });

  it('keeps the ring a ring: needs you is a badge, never a room fill', async () => {
    const { element } = await mount(FIXTURE);

    const orq = must(room(element, 'ORQ'));
    expect(orq.classList.contains('cb-worker-room')).toBe(true);
    expect(orq.querySelectorAll('[data-testid="worker-badge-needs-you"]')).toHaveLength(1);
    expect(
      roomFaces(element, 'DEV').some(
        (face) => face.querySelector('[data-testid="worker-badge-needs-you"]') !== null,
      ),
    ).toBe(false);
  });

  it('sums the header sub line over the loaded works', async () => {
    const { element } = await mount([withCost(RUNNING, 0.2), withCost(REVIEW, 0.11), QUEUED]);

    const sub = element.querySelector<HTMLElement>('.cb-workers-sub');
    expect(sub?.textContent?.trim()).toBe('2 running · $0.31');
  });
});

describe('workers dictionary', () => {
  it('carries the same keys in both locales', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.es).sort());
  });

  it('names the two chips and the sheet in both locales', () => {
    const keys = [
      'workers.chip.waiting',
      'workers.chip.delivered',
      'workers.sheet.waiting',
      'workers.sheet.delivered',
      'workers.sheet.close',
      'workers.sheet.empty',
    ] as const;

    for (const locale of ['en', 'es'] as const) {
      for (const key of keys) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});

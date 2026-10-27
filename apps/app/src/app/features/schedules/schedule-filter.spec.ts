import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { ChatSession, Schedule } from '@codebox/contracts';
import { provideIonicAngular } from '@ionic/angular';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locale } from '../../core/i18n/i18n.service';
import { I18nService } from '../../core/i18n/i18n.service';
import type { ScheduleGroup } from './schedule-filter';
import { ScheduleFilterPage, groupSchedules, isWindowOpen } from './schedule-filter';
import { STRINGS, translate } from './schedules.i18n';

const SCHEDULES_URL = '/v1/schedules';
const MADRID = 'Europe/Madrid';

function scheduleFixture(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sch_01JABCDEFG',
    repoId: null,
    chatSessionId: null,
    title: 'Morning check',
    prompt: 'Summarise the repository.',
    mode: 'every',
    cron: '0 7 * * *',
    timezone: MADRID,
    windowStart: null,
    windowEnd: null,
    cooldownMinutes: 0,
    maxFires: null,
    maxCostPerFireUsd: null,
    firePolicy: 'new_chat',
    consecutiveFailures: 0,
    firesCount: 3,
    spendUsd: 1.25,
    enabled: true,
    policy: 'auto',
    nextFireAt: null,
    lastFiredAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function windowSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return scheduleFixture({
    mode: 'window',
    cron: null,
    windowStart: '22:00',
    windowEnd: '06:00',
    ...overrides,
  });
}

function group(schedule: Schedule, unreviewed = false): ScheduleGroup {
  return { schedule, nextFires: [], unreviewed };
}

function sessionFixture(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'chat_01JABCDEFA',
    repoId: null,
    kind: 'schedule',
    title: 'Nightly triage',
    status: 'idle',
    usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
    contextTokens: 0,
    reviewedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    lastMessage: null,
    ...overrides,
  };
}

const FAILURE = {
  error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' },
};

interface Mounted {
  readonly fixture: ComponentFixture<ScheduleFilterPage>;
  readonly element: HTMLElement;
  readonly http: HttpTestingController;
  readonly locale: WritableSignal<Locale>;
}

async function mount(locale: Locale = 'en'): Promise<Mounted> {
  const localeSignal = signal<Locale>(locale);
  TestBed.configureTestingModule({
    providers: [
      provideIonicAngular(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: I18nService, useValue: { locale: localeSignal } },
    ],
  });
  const fixture = TestBed.createComponent(ScheduleFilterPage);
  await fixture.whenStable();
  return {
    fixture,
    element: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
    locale: localeSignal,
  };
}

async function flushList(mounted: Mounted, schedules: readonly Schedule[]): Promise<void> {
  mounted.http
    .expectOne((request) => request.method === 'GET' && request.url === SCHEDULES_URL)
    .flush({ data: [...schedules], nextCursor: null });
  await mounted.fixture.whenStable();
}

async function flushDetails(
  mounted: Mounted,
  schedules: readonly Schedule[],
  fires: Readonly<Record<string, readonly string[]>> = {},
): Promise<void> {
  for (const schedule of schedules.slice(0, 20)) {
    mounted.http.expectOne({ method: 'GET', url: `${SCHEDULES_URL}/${schedule.id}` }).flush({
      schedule,
      nextFires: [...(fires[schedule.id] ?? [])],
    });
  }
  await mounted.fixture.whenStable();
}

function hook(element: HTMLElement, id: string): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function rows(element: HTMLElement): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>('[data-testid="schedule-group"]')];
}

function row(element: HTMLElement, id: string): HTMLElement {
  const found = element.querySelector<HTMLElement>(
    `[data-testid="schedule-group"][data-schedule-id="${id}"]`,
  );
  if (found === null) throw new Error(`missing row ${id}`);
  return found;
}

function spendText(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value);
}

describe('isWindowOpen', () => {
  it('treats a wrapping window as half-open in the schedule zone', () => {
    const night = { start: '22:00', end: '06:00', timezone: MADRID };
    expect(isWindowOpen(night, Date.parse('2026-07-01T21:30:00.000Z'))).toBe(true);
    expect(isWindowOpen(night, Date.parse('2026-07-02T03:59:00.000Z'))).toBe(true);
    expect(isWindowOpen(night, Date.parse('2026-07-02T04:00:00.000Z'))).toBe(false);
    expect(isWindowOpen(night, Date.parse('2026-07-01T19:59:00.000Z'))).toBe(false);
  });

  it('pins the half-open bounds of a daytime window', () => {
    const day = { start: '09:00', end: '17:00', timezone: MADRID };
    expect(isWindowOpen(day, Date.parse('2026-07-01T07:00:00.000Z'))).toBe(true);
    expect(isWindowOpen(day, Date.parse('2026-07-01T15:00:00.000Z'))).toBe(false);
    expect(isWindowOpen(day, Date.parse('2026-07-01T06:59:00.000Z'))).toBe(false);
  });

  it('closes a malformed window instead of throwing', () => {
    expect(isWindowOpen({ start: '25:00', end: '06:00', timezone: MADRID }, Date.now())).toBe(
      false,
    );
    expect(
      isWindowOpen({ start: '22:00', end: '06:00', timezone: 'Mars/Olympus' }, Date.now()),
    ).toBe(false);
    expect(isWindowOpen({ start: '22:00', end: '22:00', timezone: MADRID }, Date.now())).toBe(
      false,
    );
    expect(isWindowOpen({ start: '22:00', end: '06:00', timezone: MADRID }, Number.NaN)).toBe(
      false,
    );
  });
});

describe('groupSchedules', () => {
  const nowMs = Date.parse('2026-07-01T21:30:00.000Z');

  it('puts an open window before a closed one, even with a later next fire', () => {
    const open = windowSchedule({ id: 'sch_OPEN00001', title: 'Open window', nextFireAt: null });
    const closed = windowSchedule({
      id: 'sch_CLOSED001',
      title: 'Closed window',
      windowStart: '09:00',
      windowEnd: '17:00',
      nextFireAt: '2026-07-02T04:00:00.000Z',
    });
    expect(
      groupSchedules([group(closed), group(open)], nowMs).map((entry) => entry.schedule.id),
    ).toEqual(['sch_OPEN00001', 'sch_CLOSED001']);
  });

  it('orders by next fire ascending with nulls last and titles on a tie', () => {
    const alpha = scheduleFixture({
      id: 'sch_ALPHA0001',
      title: 'Alpha',
      nextFireAt: '2026-07-02T09:00:00.000Z',
    });
    const bravo = scheduleFixture({
      id: 'sch_BRAVO0001',
      title: 'Bravo',
      nextFireAt: null,
    });
    const charlie = scheduleFixture({
      id: 'sch_CHARLIE01',
      title: 'Charlie',
      nextFireAt: '2026-07-02T10:00:00.000Z',
    });
    const delta = scheduleFixture({
      id: 'sch_DELTA0001',
      title: 'Delta',
      nextFireAt: '2026-07-02T09:00:00.000Z',
    });

    const input = [group(charlie), group(bravo), group(alpha), group(delta)];
    const ordered = groupSchedules(input, nowMs);

    expect(ordered.map((entry) => entry.schedule.title)).toEqual([
      'Alpha',
      'Delta',
      'Charlie',
      'Bravo',
    ]);
    expect(input.map((entry) => entry.schedule.title)).toEqual([
      'Charlie',
      'Bravo',
      'Alpha',
      'Delta',
    ]);
  });

  it('is stable on equal keys', () => {
    const first = scheduleFixture({ id: 'sch_SAME00001', title: 'Same', nextFireAt: null });
    const second = scheduleFixture({ id: 'sch_SAME00002', title: 'Same', nextFireAt: null });
    expect(
      groupSchedules([group(first), group(second)], nowMs).map((entry) => entry.schedule.id),
    ).toEqual(['sch_SAME00001', 'sch_SAME00002']);
    expect(
      groupSchedules([group(second), group(first)], nowMs).map((entry) => entry.schedule.id),
    ).toEqual(['sch_SAME00002', 'sch_SAME00001']);
  });
});

describe('ScheduleFilterPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders a zero fixture without inventing a row and asks for no detail', async () => {
    const mounted = await mount();
    expect(hook(mounted.element, 'schedule-filter-loading')).not.toBeNull();

    await flushList(mounted, []);

    expect(rows(mounted.element)).toHaveLength(0);
    expect(hook(mounted.element, 'schedule-filter-empty')).not.toBeNull();
    expect(hook(mounted.element, 'page-schedule-filter')?.getAttribute('data-count')).toBe('0');
    expect(
      mounted.http.match((request) => request.url.startsWith(`${SCHEDULES_URL}/`)),
    ).toHaveLength(0);
    expect(
      mounted.http.match((request) => request.url.startsWith('/v1/chat/sessions/')),
    ).toHaveLength(0);
    mounted.http.verify();
  });

  it('renders one row per schedule with its mode, fires and spend', async () => {
    const mounted = await mount();
    const every = scheduleFixture({
      id: 'sch_01JABCDEFG',
      title: 'Alpha nightly',
      firesCount: 4,
      spendUsd: 1.25,
    });
    const once = scheduleFixture({
      id: 'sch_01JABCDEFH',
      title: 'Beta once',
      mode: 'once',
      firesCount: 1,
      spendUsd: 0,
      enabled: false,
    });
    const window = windowSchedule({
      id: 'sch_01JABCDEFJ',
      title: 'Gamma window',
      firesCount: 2,
      spendUsd: 0.5,
    });

    await flushList(mounted, [every, once, window]);
    await flushDetails(mounted, [every, once, window], {
      [every.id]: ['2026-07-02T05:00:00.000Z'],
    });

    expect(rows(mounted.element)).toHaveLength(3);
    expect(row(mounted.element, every.id).getAttribute('data-mode')).toBe('every');
    expect(hook(row(mounted.element, every.id), 'schedule-group-mode')?.textContent?.trim()).toBe(
      translate('en', 'schedules.mode.every'),
    );
    expect(hook(row(mounted.element, every.id), 'schedule-group-fires')?.textContent?.trim()).toBe(
      '4',
    );
    expect(hook(row(mounted.element, every.id), 'schedule-group-spend')?.textContent?.trim()).toBe(
      spendText(1.25, 'en'),
    );
    expect(
      hook(row(mounted.element, every.id), 'schedule-group-spend')?.getAttribute('data-spend'),
    ).toBe('1.25');
    expect(
      hook(row(mounted.element, every.id), 'schedule-group-next')?.getAttribute('data-at'),
    ).toBe('2026-07-02T05:00:00.000Z');

    expect(row(mounted.element, once.id).getAttribute('data-mode')).toBe('once');
    expect(hook(row(mounted.element, once.id), 'schedule-group-spend')?.textContent?.trim()).toBe(
      spendText(0, 'en'),
    );
    expect(row(mounted.element, window.id).getAttribute('data-mode')).toBe('window');
    expect(
      hook(row(mounted.element, window.id), 'schedule-group-next-none')?.textContent?.trim(),
    ).toBe(translate('en', 'schedules.next.none'));
    mounted.http.verify();
  });

  it('marks a fire unreviewed only when the schedule and its session agree', async () => {
    const mounted = await mount();
    const unreviewed = scheduleFixture({
      id: 'sch_UNREVIEW1',
      title: 'Unreviewed',
      lastFiredAt: '2026-07-01T06:00:00.000Z',
      chatSessionId: 'chat_01JABCDEFA',
    });
    const reviewed = scheduleFixture({
      id: 'sch_REVIEWED1',
      title: 'Reviewed',
      lastFiredAt: '2026-07-01T06:00:00.000Z',
      chatSessionId: 'chat_01JABCDEFB',
    });
    const neverFired = scheduleFixture({
      id: 'sch_NEVER0001',
      title: 'Never fired',
      lastFiredAt: null,
      chatSessionId: 'chat_01JABCDEFC',
    });
    const noSession = scheduleFixture({
      id: 'sch_NOSESS001',
      title: 'No session',
      lastFiredAt: '2026-07-01T06:00:00.000Z',
      chatSessionId: null,
    });
    const schedules = [unreviewed, reviewed, neverFired, noSession];

    await flushList(mounted, schedules);
    await flushDetails(mounted, schedules);

    const reads = mounted.http.match((request) => request.url.startsWith('/v1/chat/sessions/'));
    expect(reads.map((request) => request.request.url)).toEqual([
      '/v1/chat/sessions/chat_01JABCDEFA',
      '/v1/chat/sessions/chat_01JABCDEFB',
    ]);
    for (const read of reads) {
      const id = read.request.url.split('/').pop() ?? '';
      read.flush(
        sessionFixture({
          id,
          reviewedAt: id === 'chat_01JABCDEFA' ? null : '2026-07-01T07:00:00.000Z',
        }),
      );
    }
    await mounted.fixture.whenStable();

    expect(row(mounted.element, unreviewed.id).getAttribute('data-unreviewed')).toBe('true');
    expect(
      hook(row(mounted.element, unreviewed.id), 'schedule-group-unreviewed')?.textContent?.trim(),
    ).toBe(translate('en', 'schedules.unreviewed'));
    expect(row(mounted.element, reviewed.id).getAttribute('data-unreviewed')).toBe('false');
    expect(row(mounted.element, neverFired.id).getAttribute('data-unreviewed')).toBe('false');
    expect(row(mounted.element, noSession.id).getAttribute('data-unreviewed')).toBe('false');
    expect(
      mounted.element.querySelectorAll('[data-testid="schedule-group-unreviewed"]'),
    ).toHaveLength(1);
    mounted.http.verify();
  });

  it('reports a failed read and retries the list', async () => {
    const mounted = await mount();

    mounted.http
      .expectOne((request) => request.method === 'GET' && request.url === SCHEDULES_URL)
      .flush(FAILURE, { status: 500, statusText: 'Internal Server Error' });
    await mounted.fixture.whenStable();

    expect(hook(mounted.element, 'schedule-filter-error')?.getAttribute('data-code')).toBe(
      'internal',
    );
    expect(rows(mounted.element)).toHaveLength(0);

    hook(mounted.element, 'schedule-filter-retry')?.click();
    await mounted.fixture.whenStable();
    await flushList(mounted, []);

    expect(hook(mounted.element, 'schedule-filter-error')).toBeNull();
    expect(hook(mounted.element, 'schedule-filter-empty')).not.toBeNull();
    mounted.http.verify();
  });

  it('renders the Spanish copy and ships the same key set in both locales', async () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.es).sort());

    const mounted = await mount('es');
    await flushList(mounted, [scheduleFixture({ id: 'sch_01JABCDEFK', title: 'Rutina' })]);
    await flushDetails(mounted, [scheduleFixture({ id: 'sch_01JABCDEFK', title: 'Rutina' })]);

    expect(hook(mounted.element, 'page-schedule-filter')).not.toBeNull();
    expect(hook(mounted.element, 'schedule-group-mode')?.textContent?.trim()).toBe(
      translate('es', 'schedules.mode.every'),
    );
    expect(hook(mounted.element, 'schedule-group-spend')?.textContent?.trim()).toBe(
      spendText(1.25, 'es'),
    );
    mounted.http.verify();
  });
});

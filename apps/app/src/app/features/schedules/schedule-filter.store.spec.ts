import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ChatSession, Schedule } from '@codebox/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { ScheduleFilterStore } from './schedule-filter.store';

const SCHEDULES_URL = '/v1/schedules';
const CHATS_URL = '/v1/chat/sessions';

const FAILURE = {
  error: { code: 'internal', message: 'Boom', requestId: 'req_01JABCDEFGHJKMNPQRSV' },
};

interface Harness {
  readonly store: ScheduleFilterStore;
  readonly http: HttpTestingController;
}

function mount(): Harness {
  TestBed.configureTestingModule({
    providers: [ScheduleFilterStore, provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    store: TestBed.inject(ScheduleFilterStore),
    http: TestBed.inject(HttpTestingController),
  };
}

function scheduleFixture(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sch_01JABCDEFG',
    repoId: null,
    chatSessionId: null,
    title: 'Morning check',
    prompt: 'Summarise the repository.',
    mode: 'every',
    cron: '0 7 * * *',
    timezone: 'Europe/Madrid',
    windowStart: null,
    windowEnd: null,
    cooldownMinutes: 0,
    maxFires: null,
    maxCostPerFireUsd: null,
    firePolicy: 'new_chat',
    consecutiveFailures: 0,
    firesCount: 0,
    spendUsd: 0,
    enabled: true,
    policy: 'auto',
    nextFireAt: null,
    lastFiredAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
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

function lastSegment(url: string): string {
  return url.split('/').pop() ?? '';
}

function groupOf(store: ScheduleFilterStore, id: string) {
  const found = store.groups().find((entry) => entry.schedule.id === id);
  if (found === undefined) throw new Error(`missing group ${id}`);
  return found;
}

describe('ScheduleFilterStore', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('asks for at most twenty details and renders the tail without next fires', () => {
    const harness = mount();
    const schedules: Schedule[] = [];
    for (let index = 0; index < 25; index += 1) {
      schedules.push(
        scheduleFixture({
          id: `sch_BULK${String(index).padStart(4, '0')}`,
          title: `Schedule ${String(index).padStart(2, '0')}`,
        }),
      );
    }

    harness.store.load();
    const list = harness.http.expectOne(
      (request) => request.method === 'GET' && request.url === SCHEDULES_URL,
    );
    expect(list.request.params.get('limit')).toBe('100');
    list.flush({ data: schedules, nextCursor: null });

    const details = harness.http.match((request) => request.url.startsWith(`${SCHEDULES_URL}/`));
    expect(details).toHaveLength(20);
    const requested = details.map((request) => lastSegment(request.request.url));
    expect(requested).toEqual(schedules.slice(0, 20).map((schedule) => schedule.id));
    for (const request of details) {
      const id = lastSegment(request.request.url);
      const schedule = schedules.find((entry) => entry.id === id);
      if (schedule === undefined) throw new Error(`unexpected detail ${id}`);
      request.flush({ schedule, nextFires: ['2026-07-02T05:00:00.000Z'] });
    }

    expect(harness.store.error()).toBeNull();
    expect(harness.store.groups()).toHaveLength(25);
    expect(groupOf(harness.store, schedules[0]?.id ?? '').nextFires).toHaveLength(1);
    expect(groupOf(harness.store, schedules[19]?.id ?? '').nextFires).toHaveLength(1);
    expect(groupOf(harness.store, schedules[20]?.id ?? '').nextFires).toHaveLength(0);
    expect(groupOf(harness.store, schedules[24]?.id ?? '').nextFires).toHaveLength(0);
    expect(harness.http.match((request) => request.url.startsWith(CHATS_URL))).toHaveLength(0);
    harness.http.verify();
  });

  it('reads a session only for a schedule that fired and has one, and marks only a null reviewedAt', () => {
    const harness = mount();
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
    const schedules = [unreviewed, reviewed, neverFired];

    harness.store.load();
    harness.http
      .expectOne((request) => request.method === 'GET' && request.url === SCHEDULES_URL)
      .flush({ data: schedules, nextCursor: null });
    for (const schedule of schedules) {
      harness.http
        .expectOne({ method: 'GET', url: `${SCHEDULES_URL}/${schedule.id}` })
        .flush({ schedule, nextFires: [] });
    }

    const reads = harness.http.match((request) => request.url.startsWith(CHATS_URL));
    expect(reads.map((request) => request.request.url)).toEqual([
      `${CHATS_URL}/chat_01JABCDEFA`,
      `${CHATS_URL}/chat_01JABCDEFB`,
    ]);
    for (const read of reads) {
      const id = lastSegment(read.request.url);
      read.flush(
        sessionFixture({
          id,
          reviewedAt: id === 'chat_01JABCDEFA' ? null : '2026-07-01T07:00:00.000Z',
        }),
      );
    }

    expect(groupOf(harness.store, unreviewed.id).unreviewed).toBe(true);
    expect(groupOf(harness.store, reviewed.id).unreviewed).toBe(false);
    expect(groupOf(harness.store, neverFired.id).unreviewed).toBe(false);
    harness.http.verify();
  });

  it('keeps the rows when a single detail read fails', () => {
    const harness = mount();
    const schedule = scheduleFixture({ id: 'sch_DETAIL001' });

    harness.store.load();
    harness.http
      .expectOne((request) => request.method === 'GET' && request.url === SCHEDULES_URL)
      .flush({ data: [schedule], nextCursor: null });
    harness.http
      .expectOne({ method: 'GET', url: `${SCHEDULES_URL}/${schedule.id}` })
      .flush(FAILURE, { status: 500, statusText: 'Internal Server Error' });

    expect(harness.store.error()).toBeNull();
    expect(harness.store.groups()).toHaveLength(1);
    expect(groupOf(harness.store, schedule.id).nextFires).toHaveLength(0);
    harness.http.verify();
  });

  it('reports a failed list and reloads it', () => {
    const harness = mount();

    harness.store.load();
    harness.http
      .expectOne((request) => request.method === 'GET' && request.url === SCHEDULES_URL)
      .flush(FAILURE, { status: 500, statusText: 'Internal Server Error' });

    expect(harness.store.loading()).toBe(false);
    expect(harness.store.error()?.code).toBe('internal');
    expect(harness.store.groups()).toHaveLength(0);

    harness.store.reload();
    const reloaded = scheduleFixture({ id: 'sch_RELOAD001' });
    harness.http
      .expectOne((request) => request.method === 'GET' && request.url === SCHEDULES_URL)
      .flush({ data: [reloaded], nextCursor: null });
    harness.http
      .expectOne({ method: 'GET', url: `${SCHEDULES_URL}/${reloaded.id}` })
      .flush({ schedule: reloaded, nextFires: [] });

    expect(harness.store.error()).toBeNull();
    expect(harness.store.groups()).toHaveLength(1);
    harness.http.verify();
  });
});

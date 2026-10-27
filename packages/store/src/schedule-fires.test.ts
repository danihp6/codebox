import type { Schedule } from '@codebox/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreError } from './errors.js';
import { openInMemoryStore, openStore, type Store } from './store.js';

const NOW = '2026-10-24T18:03:11.000Z';
const SCHEDULED_FOR = '2026-10-25T20:00:00Z';
const FIRED_AT = '2026-10-25T20:00:05Z';
const NEXT_FIRE = '2026-10-25T20:20:00Z';

const SCHEDULE: Schedule = {
  id: 'sch_000001',
  repoId: 'repo_000001',
  chatSessionId: null,
  title: 'Nightly drain',
  prompt: 'Pick the next issue and open a PR.',
  mode: 'window',
  cron: null,
  timezone: 'Europe/Madrid',
  windowStart: '22:00',
  windowEnd: '06:00',
  cooldownMinutes: 20,
  maxFires: null,
  maxCostPerFireUsd: null,
  firePolicy: 'new_chat',
  consecutiveFailures: 0,
  firesCount: 0,
  spendUsd: 0,
  enabled: true,
  policy: 'auto',
  nextFireAt: SCHEDULED_FOR,
  lastFiredAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function storeErrorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof StoreError ? error.code : 'unexpected-error';
  }
  return 'no-error';
}

let directory: string;
const stores: Store[] = [];

function track(store: Store): Store {
  stores.push(store);
  return store;
}

function seed(): Store {
  const store = track(openInMemoryStore());
  store.repos.create({
    id: 'repo_000001',
    slug: 'acme/widgets',
    defaultBranch: 'main',
    gate: 'npm test',
    policy: 'auto',
    protectedPaths: [],
    enabled: true,
    createdAt: NOW,
  });
  store.schedules.create(SCHEDULE);
  return store;
}

function claimInput(): {
  scheduleId: string;
  scheduledFor: string;
  firedAt: string;
  nextFireAt: string | null;
} {
  return {
    scheduleId: SCHEDULE.id,
    scheduledFor: SCHEDULED_FOR,
    firedAt: FIRED_AT,
    nextFireAt: NEXT_FIRE,
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'codebox-schedule-fires-'));
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('scheduleFires.claim', () => {
  it('claims the fire and moves the schedule forward', () => {
    const store = seed();
    const fire = store.scheduleFires.claim(claimInput());
    expect(fire).not.toBeNull();
    expect(fire).toMatchObject({
      scheduleId: SCHEDULE.id,
      scheduledFor: SCHEDULED_FOR,
      firedAt: FIRED_AT,
      outcome: 'claimed',
      runId: null,
      chatId: null,
      costUsd: 0,
      detail: null,
    });
    const schedule = store.schedules.get(SCHEDULE.id);
    expect(schedule?.nextFireAt).toBe(NEXT_FIRE);
    expect(schedule?.lastFiredAt).toBe(FIRED_AT);
    expect(schedule?.firesCount).toBe(1);
  });

  it('returns null for a missing or disabled schedule and for a moved cursor', () => {
    const store = seed();
    expect(store.scheduleFires.claim({ ...claimInput(), scheduleId: 'sch_000404' })).toBeNull();

    store.schedules.update(SCHEDULE.id, { enabled: false });
    expect(store.scheduleFires.claim(claimInput())).toBeNull();
    expect(store.scheduleFires.listBySchedule(SCHEDULE.id, 10)).toEqual([]);

    store.schedules.update(SCHEDULE.id, { enabled: true, nextFireAt: NEXT_FIRE });
    expect(store.scheduleFires.claim(claimInput())).toBeNull();
    expect(store.schedules.get(SCHEDULE.id)?.nextFireAt).toBe(NEXT_FIRE);
  });

  it('returns null, never an exception, when the pair is already taken', () => {
    const store = seed();
    expect(store.scheduleFires.claim(claimInput())).not.toBeNull();
    store.schedules.update(SCHEDULE.id, { nextFireAt: SCHEDULED_FOR });
    expect(store.scheduleFires.claim(claimInput())).toBeNull();
    expect(store.scheduleFires.listBySchedule(SCHEDULE.id, 10)).toHaveLength(1);
  });
});

describe('scheduleFires.skip', () => {
  it('writes a skipped row without touching the last fire or the count', () => {
    const store = seed();
    const fire = store.scheduleFires.skip(claimInput());
    expect(fire?.outcome).toBe('skipped');
    const schedule = store.schedules.get(SCHEDULE.id);
    expect(schedule?.nextFireAt).toBe(NEXT_FIRE);
    expect(schedule?.lastFiredAt).toBeNull();
    expect(schedule?.firesCount).toBe(0);
  });

  it('uses the same guard as claim', () => {
    const store = seed();
    store.schedules.update(SCHEDULE.id, { enabled: false });
    expect(store.scheduleFires.skip(claimInput())).toBeNull();
  });
});

describe('scheduleFires.finish', () => {
  function claimed(store: Store, scheduledFor: string = SCHEDULED_FOR): number {
    store.schedules.update(SCHEDULE.id, { nextFireAt: scheduledFor });
    const fire = store.scheduleFires.claim({ ...claimInput(), scheduledFor });
    if (fire === null) throw new Error('the claim should have won');
    return fire.id;
  }

  it('records the outcome, the cost and the run or chat', () => {
    const store = seed();
    const fireId = claimed(store);
    const finished = store.scheduleFires.finish(fireId, {
      outcome: 'fired',
      costUsd: 0.42,
      runId: null,
      chatId: null,
      detail: 'run_started',
    });
    expect(finished).toMatchObject({
      id: fireId,
      outcome: 'fired',
      costUsd: 0.42,
      detail: 'run_started',
    });
    expect(store.schedules.get(SCHEDULE.id)?.spendUsd).toBeCloseTo(0.42);
  });

  it('accumulates the spend and resets or increments the failure streak', () => {
    const store = seed();
    const first = claimed(store);

    store.scheduleFires.finish(first, {
      outcome: 'failed',
      costUsd: 0.1,
      runId: null,
      chatId: null,
      detail: 'repo_missing',
    });
    expect(store.schedules.get(SCHEDULE.id)?.consecutiveFailures).toBe(1);

    const second = claimed(store, '2026-10-25T20:20:00Z');
    store.scheduleFires.finish(second, {
      outcome: 'failed',
      costUsd: 0.2,
      runId: null,
      chatId: null,
      detail: 'repo_missing',
    });
    expect(store.schedules.get(SCHEDULE.id)?.consecutiveFailures).toBe(2);

    const third = claimed(store, '2026-10-25T20:40:00Z');
    store.scheduleFires.finish(third, {
      outcome: 'fired',
      costUsd: 0.3,
      runId: null,
      chatId: null,
      detail: null,
    });
    const schedule = store.schedules.get(SCHEDULE.id);
    expect(schedule?.consecutiveFailures).toBe(0);
    expect(schedule?.spendUsd).toBeCloseTo(0.6);
  });

  it('refuses an unknown fire', () => {
    const store = seed();
    expect(
      storeErrorCode(() =>
        store.scheduleFires.finish(999, {
          outcome: 'fired',
          costUsd: 0,
          runId: null,
          chatId: null,
          detail: null,
        }),
      ),
    ).toBe('not_found');
  });
});

describe('scheduleFires reads', () => {
  it('lists the fires of one schedule newest first', () => {
    const store = seed();
    store.scheduleFires.claim(claimInput());
    store.schedules.update(SCHEDULE.id, { nextFireAt: '2026-10-25T20:20:00Z' });
    store.scheduleFires.claim({
      ...claimInput(),
      scheduledFor: '2026-10-25T20:20:00Z',
      firedAt: '2026-10-25T20:20:05Z',
    });
    const fires = store.scheduleFires.listBySchedule(SCHEDULE.id, 10);
    expect(fires.map((fire) => fire.firedAt)).toEqual([
      '2026-10-25T20:20:05Z',
      '2026-10-25T20:00:05Z',
    ]);
    expect(store.scheduleFires.listBySchedule(SCHEDULE.id, 1)).toHaveLength(1);
    expect(store.scheduleFires.listBySchedule('sch_000404', 10)).toEqual([]);
  });
});

describe('scheduleFires races', () => {
  it('20 concurrent claims on one file produce exactly one winner and 19 nulls', () => {
    const path = join(directory, 'state.db');
    const writer = openStore({ path });
    writer.repos.create({
      id: 'repo_000001',
      slug: 'acme/widgets',
      defaultBranch: 'main',
      gate: 'npm test',
      policy: 'auto',
      protectedPaths: [],
      enabled: true,
      createdAt: NOW,
    });
    writer.schedules.create(SCHEDULE);
    writer.close();

    const handles = Array.from({ length: 20 }, () => openStore({ path }));
    const results = handles.map((handle) => handle.scheduleFires.claim(claimInput()));
    for (const handle of handles) handle.close();

    const winners = results.filter((fire) => fire !== null);
    expect(winners).toHaveLength(1);
    expect(results.filter((fire) => fire === null)).toHaveLength(19);
    expect(winners[0]?.outcome).toBe('claimed');

    const fresh = track(openStore({ path }));
    expect(fresh.scheduleFires.listBySchedule(SCHEDULE.id, 10)).toHaveLength(1);
    const schedule = fresh.schedules.get(SCHEDULE.id);
    expect(schedule?.nextFireAt).toBe(NEXT_FIRE);
    expect(schedule?.lastFiredAt).toBe(FIRED_AT);
    expect(schedule?.firesCount).toBe(1);
  });
});

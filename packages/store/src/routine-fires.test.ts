import type { ReminderRoutine } from '@codebox/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreError } from './errors.js';
import { openInMemoryStore, openStore, type Store } from './store.js';

const REMINDER: ReminderRoutine = {
  id: 'rtn_000001',
  kind: 'reminder',
  title: 'Take the pill',
  cron: '0 8 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  notify: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  nextFireAt: '2026-10-25T08:00:00Z',
  lastFiredAt: null,
};

const SCHEDULED_FOR = '2026-10-25T08:00:00Z';
const FIRED_AT = '2026-10-25T08:00:02Z';
const NEXT_FIRE = '2026-10-26T08:00:00Z';

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
  store.routines.create(REMINDER);
  return store;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'codebox-routine-fires-'));
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('routineFires.claim', () => {
  it('claims the scheduled fire and moves the routine forward', () => {
    const store = seed();
    const fire = store.routineFires.claim({
      routineId: REMINDER.id,
      scheduledFor: SCHEDULED_FOR,
      firedAt: FIRED_AT,
      nextFireAt: NEXT_FIRE,
    });
    expect(fire).not.toBeNull();
    expect(fire?.routineId).toBe(REMINDER.id);
    expect(fire?.scheduledFor).toBe(SCHEDULED_FOR);
    expect(fire?.firedAt).toBe(FIRED_AT);
    expect(fire?.outcome).toBe('claimed');
    expect(fire?.detail).toBeNull();
    expect(typeof fire?.id).toBe('number');

    const routine = store.routines.get(REMINDER.id);
    expect(routine?.nextFireAt).toBe(NEXT_FIRE);
    expect(routine?.lastFiredAt).toBe(FIRED_AT);
  });

  it('records the detail the caller supplies', () => {
    const store = seed();
    const fire = store.routineFires.claim({
      routineId: REMINDER.id,
      scheduledFor: SCHEDULED_FOR,
      firedAt: FIRED_AT,
      nextFireAt: NEXT_FIRE,
      detail: 'tick-1',
    });
    expect(fire?.detail).toBe('tick-1');
  });

  it('returns null for a missing routine, a disabled routine and a moved cursor', () => {
    const store = seed();
    expect(
      store.routineFires.claim({
        routineId: 'rtn_000404',
        scheduledFor: SCHEDULED_FOR,
        firedAt: FIRED_AT,
        nextFireAt: NEXT_FIRE,
      }),
    ).toBeNull();

    store.routines.update(REMINDER.id, { enabled: false });
    expect(
      store.routineFires.claim({
        routineId: REMINDER.id,
        scheduledFor: SCHEDULED_FOR,
        firedAt: FIRED_AT,
        nextFireAt: NEXT_FIRE,
      }),
    ).toBeNull();
    expect(store.routineFires.listByRoutine(REMINDER.id, 10)).toEqual([]);

    store.routines.update(REMINDER.id, { enabled: true });
    store.routines.setNextFire(REMINDER.id, '2026-10-26T08:00:00Z');
    expect(
      store.routineFires.claim({
        routineId: REMINDER.id,
        scheduledFor: SCHEDULED_FOR,
        firedAt: FIRED_AT,
        nextFireAt: NEXT_FIRE,
      }),
    ).toBeNull();
    expect(store.routines.get(REMINDER.id)?.nextFireAt).toBe('2026-10-26T08:00:00Z');
  });

  it('returns null, never an exception, when the pair is already taken', () => {
    const store = seed();
    const input = {
      routineId: REMINDER.id,
      scheduledFor: SCHEDULED_FOR,
      firedAt: FIRED_AT,
      nextFireAt: NEXT_FIRE,
    };
    expect(store.routineFires.claim(input)).not.toBeNull();
    store.routines.setNextFire(REMINDER.id, SCHEDULED_FOR);
    expect(store.routineFires.claim(input)).toBeNull();
    expect(store.routineFires.listByRoutine(REMINDER.id, 10)).toHaveLength(1);
    expect(store.routines.get(REMINDER.id)?.nextFireAt).toBe(SCHEDULED_FOR);
  });
});

describe('routineFires.skip', () => {
  it('writes a skipped row and leaves the last fire alone', () => {
    const store = seed();
    const fire = store.routineFires.skip({
      routineId: REMINDER.id,
      scheduledFor: SCHEDULED_FOR,
      firedAt: FIRED_AT,
      nextFireAt: NEXT_FIRE,
      detail: 'outside_grace',
    });
    expect(fire?.outcome).toBe('skipped');
    expect(fire?.detail).toBe('outside_grace');

    const routine = store.routines.get(REMINDER.id);
    expect(routine?.nextFireAt).toBe(NEXT_FIRE);
    expect(routine?.lastFiredAt).toBeNull();
  });

  it('uses the same guard as claim', () => {
    const store = seed();
    expect(
      store.routineFires.skip({
        routineId: 'rtn_000404',
        scheduledFor: SCHEDULED_FOR,
        firedAt: FIRED_AT,
        nextFireAt: NEXT_FIRE,
      }),
    ).toBeNull();
    store.routines.update(REMINDER.id, { enabled: false });
    expect(
      store.routineFires.skip({
        routineId: REMINDER.id,
        scheduledFor: SCHEDULED_FOR,
        firedAt: FIRED_AT,
        nextFireAt: NEXT_FIRE,
      }),
    ).toBeNull();
  });
});

describe('routineFires.finish', () => {
  it('closes the row without touching the routine', () => {
    const store = seed();
    const fire = store.routineFires.claim({
      routineId: REMINDER.id,
      scheduledFor: SCHEDULED_FOR,
      firedAt: FIRED_AT,
      nextFireAt: NEXT_FIRE,
    });
    if (fire === null) throw new Error('the claim should have won');
    const finished = store.routineFires.finish(fire.id, 'replied', 'answered in chat');
    expect(finished.id).toBe(fire.id);
    expect(finished.outcome).toBe('replied');
    expect(finished.detail).toBe('answered in chat');

    const routine = store.routines.get(REMINDER.id);
    expect(routine?.nextFireAt).toBe(NEXT_FIRE);
    expect(routine?.lastFiredAt).toBe(FIRED_AT);
  });

  it('refuses an unknown fire', () => {
    const store = seed();
    expect(storeErrorCode(() => store.routineFires.finish(999, 'failed', null))).toBe('not_found');
  });
});

describe('routineFires reads', () => {
  it('reads one fire, one pair, the page and the latest', () => {
    const store = seed();
    const first = store.routineFires.claim({
      routineId: REMINDER.id,
      scheduledFor: '2026-10-25T08:00:00Z',
      firedAt: '2026-10-25T08:00:02Z',
      nextFireAt: '2026-10-26T08:00:00Z',
    });
    const second = store.routineFires.claim({
      routineId: REMINDER.id,
      scheduledFor: '2026-10-26T08:00:00Z',
      firedAt: '2026-10-26T08:00:02Z',
      nextFireAt: '2026-10-27T08:00:00Z',
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    expect(store.routineFires.get(Number(first?.id))?.id).toBe(first?.id);
    expect(store.routineFires.get(999)).toBeNull();
    expect(store.routineFires.getByScheduled(REMINDER.id, '2026-10-25T08:00:00Z')?.id).toBe(
      first?.id,
    );
    expect(store.routineFires.getByScheduled(REMINDER.id, '2026-10-27T08:00:00Z')).toBeNull();
    expect(store.routineFires.listByRoutine(REMINDER.id, 10).map((fire) => fire.id)).toEqual([
      second?.id,
      first?.id,
    ]);
    expect(store.routineFires.listByRoutine(REMINDER.id, 1).map((fire) => fire.id)).toEqual([
      second?.id,
    ]);
    expect(store.routineFires.latest(REMINDER.id)?.id).toBe(second?.id);
    expect(store.routineFires.latest('rtn_000404')).toBeNull();
  });
});

describe('routineFires races', () => {
  it('20 concurrent claims on one file produce exactly one winner', () => {
    const path = join(directory, 'state.db');
    const writer = openStore({ path });
    writer.routines.create(REMINDER);
    writer.close();

    const handles = Array.from({ length: 20 }, () => openStore({ path }));
    const results = handles.map((handle) =>
      handle.routineFires.claim({
        routineId: REMINDER.id,
        scheduledFor: SCHEDULED_FOR,
        firedAt: FIRED_AT,
        nextFireAt: NEXT_FIRE,
      }),
    );
    for (const handle of handles) handle.close();

    const winners = results.filter((fire) => fire !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.outcome).toBe('claimed');

    const fresh = track(openStore({ path }));
    expect(fresh.routineFires.listByRoutine(REMINDER.id, 10)).toHaveLength(1);
    const routine = fresh.routines.get(REMINDER.id);
    expect(routine?.nextFireAt).toBe(NEXT_FIRE);
    expect(routine?.lastFiredAt).toBe(FIRED_AT);
  });
});

describe('the misfire decision persisted', () => {
  it('claims once inside the grace and never retries the same fire', () => {
    const store = seed();
    const inside = {
      routineId: REMINDER.id,
      scheduledFor: '2026-10-24T00:30:00Z',
      firedAt: '2026-10-24T00:31:00Z',
      nextFireAt: '2026-10-25T00:30:00Z',
    };
    store.routines.setNextFire(REMINDER.id, inside.scheduledFor);
    expect(store.routineFires.claim(inside)?.outcome).toBe('claimed');
    expect(store.routineFires.claim(inside)).toBeNull();
    expect(store.routines.get(REMINDER.id)?.lastFiredAt).toBe(inside.firedAt);
  });

  it('records an outside-grace fire as skipped and leaves lastFiredAt null', () => {
    const store = seed();
    const outside = {
      routineId: REMINDER.id,
      scheduledFor: '2026-10-24T00:30:00Z',
      firedAt: '2026-10-24T00:46:00Z',
      nextFireAt: '2026-10-25T00:30:00Z',
      detail: 'outside_grace',
    };
    store.routines.setNextFire(REMINDER.id, outside.scheduledFor);
    expect(store.routineFires.skip(outside)?.outcome).toBe('skipped');
    expect(store.routineFires.skip(outside)).toBeNull();
    expect(store.routineFires.listByRoutine(REMINDER.id, 10)).toHaveLength(1);
    const routine = store.routines.get(REMINDER.id);
    expect(routine?.nextFireAt).toBe('2026-10-25T00:30:00Z');
    expect(routine?.lastFiredAt).toBeNull();
  });
});

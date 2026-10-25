import type { ReminderRoutine } from '@codebox/contracts';
import { describe, expect, it } from 'vitest';
import { isValidTimezone, nextFire, parseCron } from '../../core/src/cron.js';
import { resolveMisfire } from '../../core/src/misfire.js';
import { fromUpdate, nextRoutineFire, planRoutineTick, toSchedule } from './routines.js';
import type { RoutineTickPlan, SchedulerDeps } from './types.js';

const deps: SchedulerDeps = {
  cron: { parse: parseCron, nextFire, isValidTimezone },
  misfire: resolveMisfire,
};

const BASE: ReminderRoutine = {
  id: 'rtn_000001',
  kind: 'reminder',
  title: 'Take the pill',
  cron: '30 2 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  notify: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  nextFireAt: null,
  lastFiredAt: null,
};

function makeRoutine(overrides: Partial<ReminderRoutine> = {}): ReminderRoutine {
  return { ...BASE, ...overrides };
}

function plan(
  now: string,
  routines: readonly ReminderRoutine[],
  graceSeconds = 900,
): RoutineTickPlan {
  return planRoutineTick(deps, { now, routines, graceSeconds, limit: 10 });
}

describe('routine schedules', () => {
  it('maps a routine onto the Schedule row the job path already speaks', () => {
    expect(toSchedule(makeRoutine({ nextFireAt: '2026-10-25T00:30:00Z' }))).toEqual({
      kind: 'routine',
      ownerId: BASE.id,
      cron: BASE.cron,
      timezone: BASE.timezone,
      enabled: true,
      nextFireAt: '2026-10-25T00:30:00Z',
      createdAt: BASE.createdAt,
    });
  });

  it('maps a next-fire update back by owner id', () => {
    expect(
      fromUpdate({ kind: 'routine', ownerId: BASE.id, nextFireAt: '2026-10-26T01:30:00Z' }),
    ).toEqual({ routineId: BASE.id, nextFireAt: '2026-10-26T01:30:00Z' });
    expect(fromUpdate({ kind: 'routine', ownerId: BASE.id, nextFireAt: null })).toEqual({
      routineId: BASE.id,
      nextFireAt: null,
    });
  });

  it('routine: a new routine gets its first fire in its own zone', () => {
    expect(
      nextRoutineFire(deps, {
        cron: '0 8 * * *',
        timezone: 'Europe/Madrid',
        after: '2026-10-24T12:00:00Z',
      }),
    ).toBe('2026-10-25T07:00:00Z');
  });

  it('routine: a bad cron or zone has no next fire', () => {
    expect(
      nextRoutineFire(deps, { cron: '0 8 * *', timezone: 'UTC', after: '2026-10-24T12:00:00Z' }),
    ).toBeNull();
    expect(
      nextRoutineFire(deps, {
        cron: '0 8 * * *',
        timezone: 'Mars/Olympus',
        after: '2026-10-24T12:00:00Z',
      }),
    ).toBeNull();
  });
});

describe('routine tick in Europe/Madrid', () => {
  it('routine: the fall-back fire rolls to 02:30 CET', () => {
    const result = plan('2026-10-25T00:30:00Z', [
      makeRoutine({ nextFireAt: '2026-10-25T00:30:00Z' }),
    ]);
    expect(result.due).toHaveLength(1);
    expect(result.due[0]).toEqual({
      routineId: BASE.id,
      scheduledFor: '2026-10-25T00:30:00Z',
      ageSeconds: 0,
    });
    expect(result.skipped).toHaveLength(0);
    expect(result.updates).toEqual([{ routineId: BASE.id, nextFireAt: '2026-10-26T01:30:00Z' }]);
  });

  it('routine: the spring-forward fire lands on the first valid instant', () => {
    const result = plan('2027-03-28T00:30:00Z', [
      makeRoutine({ nextFireAt: '2027-03-28T00:30:00Z' }),
    ]);
    expect(result.due).toHaveLength(1);
    expect(result.updates).toEqual([{ routineId: BASE.id, nextFireAt: '2027-03-28T01:00:00Z' }]);
  });
});

describe('routine misfire grace', () => {
  it('routine: a fire 60 s late runs once and rolls to the next day', () => {
    const result = plan('2026-10-24T00:31:00Z', [
      makeRoutine({ nextFireAt: '2026-10-24T00:30:00Z' }),
    ]);
    expect(result.due).toHaveLength(1);
    expect(result.due[0]?.ageSeconds).toBe(60);
    expect(result.skipped).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]?.nextFireAt).toBe('2026-10-25T00:30:00Z');
  });

  it('routine: a fire 960 s late is skipped once and never retried', () => {
    const result = plan('2026-10-24T00:46:00Z', [
      makeRoutine({ nextFireAt: '2026-10-24T00:30:00Z' }),
    ]);
    expect(result.due).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toEqual({
      routineId: BASE.id,
      scheduledFor: '2026-10-24T00:30:00Z',
      ageSeconds: 960,
      reason: 'outside_grace',
    });
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]?.nextFireAt).toBe('2026-10-25T00:30:00Z');
  });
});

describe('routine tick order and edge cases', () => {
  it('routine: nothing is due for a paused routine or an empty set', () => {
    expect(
      plan('2026-10-24T00:31:00Z', [
        makeRoutine({ nextFireAt: '2026-10-24T00:30:00Z', enabled: false }),
      ]),
    ).toEqual({ due: [], skipped: [], updates: [] });
    expect(plan('2026-10-24T00:31:00Z', [])).toEqual({ due: [], skipped: [], updates: [] });
    expect(plan('2026-10-24T00:31:00Z', [makeRoutine({ nextFireAt: null })])).toEqual({
      due: [],
      skipped: [],
      updates: [],
    });
  });

  it('routine: order follows scheduledFor then createdAt then routine id', () => {
    const result = plan(
      '2026-10-24T12:00:00Z',
      [
        makeRoutine({
          id: 'rtn_000003',
          cron: '0 * * * *',
          timezone: 'UTC',
          nextFireAt: '2026-10-24T12:00:00Z',
        }),
        makeRoutine({
          id: 'rtn_000002',
          cron: '0 * * * *',
          timezone: 'UTC',
          nextFireAt: '2026-10-24T11:00:00Z',
        }),
        makeRoutine({
          id: 'rtn_000001',
          cron: '0 * * * *',
          timezone: 'UTC',
          nextFireAt: '2026-10-24T11:00:00Z',
        }),
      ],
      86_400,
    );
    expect(result.due.map((fire) => fire.routineId)).toEqual([
      'rtn_000001',
      'rtn_000002',
      'rtn_000003',
    ]);
    expect(result.updates.map((update) => update.routineId)).toEqual([
      'rtn_000001',
      'rtn_000002',
      'rtn_000003',
    ]);
  });

  it('routine: the claim limit truncates due and skips still roll over once', () => {
    const result = planRoutineTick(deps, {
      now: '2026-10-24T12:00:00Z',
      routines: [
        makeRoutine({
          id: 'rtn_000001',
          cron: '0 * * * *',
          timezone: 'UTC',
          nextFireAt: '2026-10-24T11:00:00Z',
        }),
        makeRoutine({
          id: 'rtn_000002',
          cron: '0 * * * *',
          timezone: 'UTC',
          nextFireAt: '2026-10-24T12:00:00Z',
        }),
        makeRoutine({
          id: 'rtn_000003',
          cron: '0 * * * *',
          timezone: 'UTC',
          nextFireAt: '2026-10-24T12:00:00Z',
          createdAt: '2026-10-02T00:00:00.000Z',
        }),
      ],
      graceSeconds: 900,
      limit: 1,
    });
    expect(result.due.map((fire) => fire.routineId)).toEqual(['rtn_000002']);
    expect(result.skipped.map((fire) => fire.routineId)).toEqual(['rtn_000001']);
    expect(result.skipped[0]?.reason).toBe('outside_grace');
    expect(result.updates).toEqual([
      { routineId: 'rtn_000002', nextFireAt: '2026-10-24T13:00:00Z' },
      { routineId: 'rtn_000001', nextFireAt: '2026-10-24T13:00:00Z' },
    ]);
  });

  it('routine: the same arguments always give the same plan', () => {
    const input = {
      now: '2026-10-24T00:31:00Z',
      routines: [makeRoutine({ nextFireAt: '2026-10-24T00:30:00Z' })],
      graceSeconds: 900,
      limit: 10,
    };
    expect(planRoutineTick(deps, input)).toEqual(planRoutineTick(deps, input));
  });
});

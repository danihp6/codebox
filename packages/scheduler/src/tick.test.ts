import { describe, expect, it } from 'vitest';
import { isValidTimezone, nextFire, parseCron } from '../../core/src/cron.js';
import { resolveMisfire } from '../../core/src/misfire.js';
import { claimKey, planFires, planTick } from './tick.js';
import type { Schedule, SchedulerDeps, TickPlan } from './types.js';

const deps: SchedulerDeps = {
  cron: { parse: parseCron, nextFire, isValidTimezone },
  misfire: resolveMisfire,
};

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    kind: 'job',
    ownerId: 'job-1',
    cron: '0 * * * *',
    timezone: 'UTC',
    enabled: true,
    nextFireAt: '2026-10-24T12:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error('expected a first element');
  return value;
}

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`expected an element at ${index}`);
  return value;
}

function applyUpdates(schedules: readonly Schedule[], plan: TickPlan): Schedule[] {
  const next = new Map<string, string | null>();
  for (const update of plan.updates)
    next.set(`${update.kind}:${update.ownerId}`, update.nextFireAt);
  return schedules.map((schedule) => {
    const key = `${schedule.kind}:${schedule.ownerId}`;
    return next.has(key) ? { ...schedule, nextFireAt: next.get(key) ?? null } : schedule;
  });
}

describe('grace', () => {
  it('grace: a fire at age 0 is due once and the next fire comes from now', () => {
    const plan = planTick(deps, {
      now: '2026-10-24T12:00:00Z',
      schedules: [makeSchedule()],
      graceSeconds: 900,
      limit: 10,
    });
    expect(plan.due).toEqual([
      { kind: 'job', ownerId: 'job-1', scheduledFor: '2026-10-24T12:00:00Z', ageSeconds: 0 },
    ]);
    expect(plan.skipped).toEqual([]);
    expect(plan.updates).toEqual([
      { kind: 'job', ownerId: 'job-1', nextFireAt: '2026-10-24T13:00:00Z' },
    ]);
  });

  it('grace: a fire at age 899 is still due', () => {
    const plan = planTick(deps, {
      now: '2026-10-24T12:14:59Z',
      schedules: [makeSchedule()],
      graceSeconds: 900,
      limit: 10,
    });
    expect(plan.due).toHaveLength(1);
    expect(first(plan.due).ageSeconds).toBe(899);
    expect(plan.skipped).toHaveLength(0);
    expect(first(plan.updates).nextFireAt).toBe('2026-10-24T13:00:00Z');
  });

  it('grace: a fire at age 900 is skipped once as outside_grace', () => {
    const plan = planTick(deps, {
      now: '2026-10-24T12:15:00Z',
      schedules: [makeSchedule()],
      graceSeconds: 900,
      limit: 10,
    });
    expect(plan.due).toHaveLength(0);
    expect(plan.skipped).toEqual([
      {
        kind: 'job',
        ownerId: 'job-1',
        scheduledFor: '2026-10-24T12:00:00Z',
        ageSeconds: 900,
        reason: 'outside_grace',
      },
    ]);
    expect(first(plan.updates).nextFireAt).toBe('2026-10-24T13:00:00Z');
  });

  it('grace: a fire at age 86 400 is skipped once and never catches up', () => {
    const plan = planTick(deps, {
      now: '2026-10-25T12:00:00Z',
      schedules: [makeSchedule()],
      graceSeconds: 900,
      limit: 10,
    });
    expect(plan.due).toHaveLength(0);
    expect(first(plan.skipped).reason).toBe('outside_grace');
    expect(first(plan.skipped).ageSeconds).toBe(86_400);
    expect(first(plan.updates).nextFireAt).toBe('2026-10-25T13:00:00Z');
  });

  it('grace: applying the update stops the same schedule from firing twice at the same now', () => {
    const now = '2026-10-24T12:05:00Z';
    const schedules = [makeSchedule()];
    const initial = planTick(deps, { now, schedules, graceSeconds: 900, limit: 10 });
    expect(initial.due).toHaveLength(1);
    const afterRun = applyUpdates(schedules, initial);
    const second = planTick(deps, { now, schedules: afterRun, graceSeconds: 900, limit: 10 });
    expect(second.due).toHaveLength(0);
    expect(second.skipped).toHaveLength(0);
    expect(second.updates).toHaveLength(0);
  });

  it('grace: a skipped fire is logged once and the applied update stops the repeat', () => {
    const now = '2026-10-24T12:20:00Z';
    const schedules = [makeSchedule()];
    const plan = planTick(deps, { now, schedules, graceSeconds: 900, limit: 10 });
    expect(plan.skipped).toHaveLength(1);
    const afterLog = applyUpdates(schedules, plan);
    const again = planTick(deps, { now, schedules: afterLog, graceSeconds: 900, limit: 10 });
    expect(again.due).toHaveLength(0);
    expect(again.skipped).toHaveLength(0);
  });
});

describe('double tick', () => {
  it('double tick: two plans in the same second produce the same claim key', () => {
    const input = {
      now: '2026-10-24T12:00:00Z',
      schedules: [makeSchedule()],
      graceSeconds: 900,
      limit: 10,
    };
    const planA = planTick(deps, input);
    const planB = planTick(deps, input);
    expect(claimKey(first(planA.due))).toBe(claimKey(first(planB.due)));
    expect(claimKey(first(planA.due))).toBe('job:job-1@2026-10-24T12:00:00Z');
    const applied = applyUpdates(input.schedules, planA);
    const third = planTick(deps, { ...input, schedules: applied });
    expect(third.due).toHaveLength(0);
  });

  it('double tick: two schedules with the same fire keep distinct claim keys', () => {
    const plan = planTick(deps, {
      now: '2026-10-24T12:00:00Z',
      schedules: [makeSchedule(), makeSchedule({ ownerId: 'job-2' })],
      graceSeconds: 900,
      limit: 10,
    });
    expect(plan.due).toHaveLength(2);
    expect(claimKey(first(plan.due))).not.toBe(claimKey(at(plan.due, 1)));
  });
});

describe('paused job', () => {
  it('paused: a paused job with a past next fire is never due, skipped or updated', () => {
    const plan = planTick(deps, {
      now: '2026-10-24T12:00:00Z',
      schedules: [makeSchedule({ enabled: false })],
      graceSeconds: 900,
      limit: 10,
    });
    expect(plan.due).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
  });

  it('paused: a paused job is invisible even beside a due job', () => {
    const plan = planTick(deps, {
      now: '2026-10-24T12:00:00Z',
      schedules: [makeSchedule({ enabled: false }), makeSchedule({ ownerId: 'job-2' })],
      graceSeconds: 900,
      limit: 10,
    });
    expect(plan.due.map((fire) => fire.ownerId)).toEqual(['job-2']);
    expect(plan.updates.map((update) => update.ownerId)).toEqual(['job-2']);
  });
});

describe('candidates', () => {
  it('leaves a schedule whose next fire is in the future alone', () => {
    const plan = planTick(deps, {
      now: '2026-10-24T11:59:59Z',
      schedules: [makeSchedule()],
      graceSeconds: 900,
      limit: 10,
    });
    expect(plan.due).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
  });

  it('ignores a schedule with no next fire without clearing anything', () => {
    const plan = planTick(deps, {
      now: '2026-10-24T12:00:00Z',
      schedules: [makeSchedule({ nextFireAt: null })],
      graceSeconds: 900,
      limit: 10,
    });
    expect(plan.due).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
  });
});

describe('next fire', () => {
  it('runs a due fire once and clears the next fire when the cron cannot fire again', () => {
    const plan = planTick(deps, {
      now: '2026-10-24T12:00:00Z',
      schedules: [makeSchedule({ cron: '0 0 30 2 *' })],
      graceSeconds: 900,
      limit: 10,
    });
    expect(plan.due).toHaveLength(1);
    expect(plan.updates).toEqual([{ kind: 'job', ownerId: 'job-1', nextFireAt: null }]);
  });

  it('skips an expired fire as no_next_fire when the cron cannot fire again', () => {
    const plan = planTick(deps, {
      now: '2026-10-25T12:00:00Z',
      schedules: [makeSchedule({ cron: '0 0 30 2 *' })],
      graceSeconds: 900,
      limit: 10,
    });
    expect(plan.due).toHaveLength(0);
    expect(first(plan.skipped).reason).toBe('no_next_fire');
    expect(first(plan.updates).nextFireAt).toBeNull();
  });

  it('never derives the next fire from the missed scheduledFor', () => {
    const plan = planTick(deps, {
      now: '2026-10-24T15:30:00Z',
      schedules: [makeSchedule()],
      graceSeconds: 86_400,
      limit: 10,
    });
    expect(plan.due).toHaveLength(1);
    expect(first(plan.updates).nextFireAt).toBe('2026-10-24T16:00:00Z');
  });
});

describe('next fires preview', () => {
  it('previews the next fires after the given instant', () => {
    expect(planFires(deps, '0 9 * * *', 'Europe/Madrid', '2026-10-24T00:00:00Z', 3)).toEqual([
      '2026-10-24T07:00:00Z',
      '2026-10-25T08:00:00Z',
      '2026-10-26T08:00:00Z',
    ]);
  });

  it('returns an empty list for an invalid cron or an unknown zone', () => {
    expect(planFires(deps, 'x * * * *', 'UTC', '2026-10-24T00:00:00Z', 3)).toEqual([]);
    expect(planFires(deps, '0 9 * * *', 'Mars/Olympus', '2026-10-24T00:00:00Z', 3)).toEqual([]);
    expect(planFires(deps, '60 * * * *', 'UTC', '2026-10-24T00:00:00Z', 3)).toEqual([]);
  });

  it('clamps the count between one and ten', () => {
    expect(planFires(deps, '0 0 * * *', 'UTC', '2026-10-24T00:00:00Z', 0)).toHaveLength(1);
    expect(planFires(deps, '0 0 * * *', 'UTC', '2026-10-24T00:00:00Z', -4)).toHaveLength(1);
    expect(planFires(deps, '0 0 * * *', 'UTC', '2026-10-24T00:00:00Z', 11)).toHaveLength(10);
    expect(planFires(deps, '0 0 * * *', 'UTC', '2026-10-24T00:00:00Z', 5)).toHaveLength(5);
  });

  it('stops at an expression that never fires again', () => {
    expect(planFires(deps, '0 0 30 2 *', 'UTC', '2026-10-24T00:00:00Z', 5)).toEqual([]);
  });
});

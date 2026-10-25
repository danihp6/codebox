import { describe, expect, it } from 'vitest';
import { isValidTimezone, nextFire, parseCron } from '../../core/src/cron.js';
import { resolveMisfire } from '../../core/src/misfire.js';
import { planTick } from './tick.js';
import type { Schedule, SchedulerDeps } from './types.js';

const deps: SchedulerDeps = {
  cron: { parse: parseCron, nextFire, isValidTimezone },
  misfire: resolveMisfire,
};

const NOW = '2026-10-24T12:00:00Z';

function makeSchedule(ownerId: string, nextFireAt: string, createdAt: string): Schedule {
  return {
    kind: 'job',
    ownerId,
    cron: '0 * * * *',
    timezone: 'UTC',
    enabled: true,
    nextFireAt,
    createdAt,
  };
}

const LATE = makeSchedule('job-late', '2026-10-24T12:00:00Z', '2026-10-01T00:00:00Z');
const MIDDLE = makeSchedule('job-middle', '2026-10-24T11:00:00Z', '2026-10-02T00:00:00Z');
const OLDEST = makeSchedule('job-oldest', '2026-10-24T11:00:00Z', '2026-10-01T00:00:00Z');

describe('ordering', () => {
  it('ordering: due follows scheduledFor, then createdAt, then ownerId', () => {
    const plan = planTick(deps, {
      now: NOW,
      schedules: [LATE, MIDDLE, OLDEST],
      graceSeconds: 86_400,
      limit: 10,
    });
    expect(plan.due.map((fire) => fire.ownerId)).toEqual(['job-oldest', 'job-middle', 'job-late']);
    expect(plan.due.map((fire) => fire.scheduledFor)).toEqual([
      '2026-10-24T11:00:00Z',
      '2026-10-24T11:00:00Z',
      '2026-10-24T12:00:00Z',
    ]);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.updates.map((update) => update.ownerId)).toEqual([
      'job-oldest',
      'job-middle',
      'job-late',
    ]);
  });

  it('ordering: the owner id breaks a full tie', () => {
    const plan = planTick(deps, {
      now: NOW,
      schedules: [
        makeSchedule('job-z', '2026-10-24T11:00:00Z', '2026-10-01T00:00:00Z'),
        makeSchedule('job-a', '2026-10-24T11:00:00Z', '2026-10-01T00:00:00Z'),
      ],
      graceSeconds: 86_400,
      limit: 10,
    });
    expect(plan.due.map((fire) => fire.ownerId)).toEqual(['job-a', 'job-z']);
  });

  it('ordering: limit truncates due after sorting and leaves the dropped fire untouched', () => {
    const plan = planTick(deps, {
      now: NOW,
      schedules: [LATE, MIDDLE, OLDEST],
      graceSeconds: 86_400,
      limit: 2,
    });
    expect(plan.due.map((fire) => fire.ownerId)).toEqual(['job-oldest', 'job-middle']);
    expect(plan.updates).toHaveLength(2);
    expect(plan.updates.map((update) => update.ownerId)).toEqual(['job-oldest', 'job-middle']);
    expect(plan.updates.map((update) => update.nextFireAt)).toEqual([
      '2026-10-24T13:00:00Z',
      '2026-10-24T13:00:00Z',
    ]);
    expect(plan.updates.some((update) => update.ownerId === 'job-late')).toBe(false);
  });

  it('ordering: skipped is never truncated and updates claim first, then skip', () => {
    const plan = planTick(deps, {
      now: NOW,
      schedules: [LATE, MIDDLE, OLDEST],
      graceSeconds: 0,
      limit: 1,
    });
    expect(plan.due).toHaveLength(0);
    expect(plan.skipped.map((fire) => fire.ownerId)).toEqual([
      'job-oldest',
      'job-middle',
      'job-late',
    ]);
    expect(plan.skipped.every((fire) => fire.reason === 'outside_grace')).toBe(true);
    expect(plan.updates).toHaveLength(3);
    expect(plan.updates.map((update) => update.ownerId)).toEqual([
      'job-oldest',
      'job-middle',
      'job-late',
    ]);
  });

  it('ordering: updates list the claimed fires before the skipped ones', () => {
    const plan = planTick(deps, {
      now: NOW,
      schedules: [OLDEST, LATE],
      graceSeconds: 900,
      limit: 10,
    });
    expect(plan.skipped.map((fire) => fire.ownerId)).toEqual(['job-oldest']);
    expect(plan.due.map((fire) => fire.ownerId)).toEqual(['job-late']);
    expect(plan.updates.map((update) => update.ownerId)).toEqual(['job-late', 'job-oldest']);
  });

  it('ordering: two runs of the same input are identical', () => {
    const input = {
      now: NOW,
      schedules: [LATE, MIDDLE, OLDEST],
      graceSeconds: 86_400,
      limit: 2,
    };
    expect(planTick(deps, input)).toEqual(planTick(deps, input));
  });
});

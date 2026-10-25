import { describe, expect, it } from 'vitest';
import type { ReminderRoutine } from '@codebox/contracts';
import { planRoutineTick } from './tick.js';

const NOW = new Date('2026-10-25T10:00:00.000Z');

function row(input: {
  readonly id: string;
  readonly cron: string;
  readonly nextFireAt: string | null;
  readonly timezone?: string;
}): ReminderRoutine {
  return {
    id: input.id,
    kind: 'reminder',
    title: `Routine ${input.id}`,
    cron: input.cron,
    timezone: input.timezone ?? 'UTC',
    enabled: true,
    notify: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    nextFireAt: input.nextFireAt,
    lastFiredAt: null,
  };
}

describe('routine tick plan', () => {
  it('fires a row inside the grace window and advances its schedule', () => {
    const due = [row({ id: 'rtn_000001', cron: '0 11 * * *', nextFireAt: '2026-10-25T09:59:30Z' })];

    const plan = planRoutineTick({ now: NOW, graceSeconds: 900, due });

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      scheduledFor: '2026-10-25T09:59:30Z',
      nextFireAt: '2026-10-25T11:00:00Z',
      decision: 'fire',
      reason: 'on_time',
    });
  });

  it('skips a row 901 seconds old with a 900 second grace', () => {
    const due = [row({ id: 'rtn_000002', cron: '0 * * * *', nextFireAt: '2026-10-25T09:44:59Z' })];

    const plan = planRoutineTick({ now: NOW, graceSeconds: 900, due });

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      nextFireAt: '2026-10-25T11:00:00Z',
      decision: 'skip',
      reason: 'outside_grace',
    });
  });

  it('skips an invalid cron as no_next_fire instead of retrying forever', () => {
    const due = [
      row({ id: 'rtn_000003', cron: '99 99 99 99 99', nextFireAt: '2026-10-25T09:59:30Z' }),
    ];

    const plan = planRoutineTick({ now: NOW, graceSeconds: 900, due });

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      nextFireAt: null,
      decision: 'skip',
      reason: 'no_next_fire',
    });
  });

  it('ignores a row whose next fire is null', () => {
    const plan = planRoutineTick({
      now: NOW,
      graceSeconds: 900,
      due: [row({ id: 'rtn_000004', cron: '0 11 * * *', nextFireAt: null })],
    });

    expect(plan).toEqual([]);
  });

  it('keeps the order of the due list', () => {
    const plan = planRoutineTick({
      now: NOW,
      graceSeconds: 900,
      due: [
        row({ id: 'rtn_000005', cron: '0 * * * *', nextFireAt: '2026-10-25T09:00:00Z' }),
        row({ id: 'rtn_000006', cron: '0 * * * *', nextFireAt: '2026-10-25T09:59:00Z' }),
      ],
    });

    expect(plan.map((item) => item.routine.id)).toEqual(['rtn_000005', 'rtn_000006']);
  });

  it('crosses the Madrid DST start with the cron engine next fire', () => {
    const now = new Date('2026-03-29T01:00:00Z');
    // Both rows are a day old, so a 25 h grace keeps them in their own day: the plan is about
    // the next instant the engine gives across the spring-forward gap, not about lateness.
    const plan = planRoutineTick({
      now,
      graceSeconds: 90_000,
      due: [
        row({
          id: 'rtn_000007',
          cron: '0 4 * * *',
          timezone: 'Europe/Madrid',
          nextFireAt: '2026-03-28T03:00:00Z',
        }),
        row({
          id: 'rtn_000008',
          cron: '30 2 * * *',
          timezone: 'Europe/Madrid',
          nextFireAt: '2026-03-28T01:30:00Z',
        }),
      ],
    });

    expect(plan.map((item) => item.decision)).toEqual(['fire', 'fire']);
    // 04:00 CEST is 02:00Z on the day the clocks move; 02:30 does not exist that day, so the
    // engine answers the next day's 02:30 CEST (00:30Z), never a phantom instant.
    expect(plan.map((item) => item.nextFireAt)).toEqual([
      '2026-03-29T02:00:00Z',
      '2026-03-30T00:30:00Z',
    ]);
  });
});

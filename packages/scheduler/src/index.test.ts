import { describe, expect, it } from 'vitest';
import { isValidTimezone, nextFire, parseCron } from '../../core/src/cron.js';
import { resolveMisfire } from '../../core/src/misfire.js';
import * as scheduler from './index.js';
import type { Schedule, SchedulerDeps } from './types.js';

const deps: SchedulerDeps = {
  cron: { parse: parseCron, nextFire, isValidTimezone },
  misfire: resolveMisfire,
};

const SCHEDULE: Schedule = {
  kind: 'job',
  ownerId: 'job-1',
  cron: '0 * * * *',
  timezone: 'UTC',
  enabled: true,
  nextFireAt: '2026-10-24T12:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
};

describe('public surface', () => {
  it('re-exports the frozen surface exactly once', () => {
    expect(Object.keys(scheduler).sort()).toEqual(
      [
        'SCHEDULER_TICK_SECONDS_DEFAULT',
        'SCHEDULER_TICK_SECONDS_MAX',
        'SCHEDULER_TICK_SECONDS_MIN',
        'claimKey',
        'isTickSeconds',
        'nextTickDelay',
        'planFires',
        'planPause',
        'planResume',
        'planTick',
        'validateSchedule',
      ].sort(),
    );
  });

  it('builds the claim key from kind, owner and fire', () => {
    expect(
      scheduler.claimKey({
        kind: 'routine',
        ownerId: 'routine-1',
        scheduledFor: '2026-10-24T12:00:00Z',
      }),
    ).toBe('routine:routine-1@2026-10-24T12:00:00Z');
  });

  it('plans a tick deterministically from the arguments alone', () => {
    const input = {
      now: '2026-10-24T12:00:00Z',
      schedules: [SCHEDULE],
      graceSeconds: 900,
      limit: 1,
    };
    const plan = scheduler.planTick(deps, input);
    expect(plan.due).toHaveLength(1);
    expect(plan).toEqual(scheduler.planTick(deps, input));
    expect(scheduler.planFires(deps, '0 * * * *', 'UTC', input.now, 2)).toEqual([
      '2026-10-24T13:00:00Z',
      '2026-10-24T14:00:00Z',
    ]);
  });

  it('validates and previews through the re-exported entry points', () => {
    expect(
      scheduler.validateSchedule(
        deps,
        { cron: '0 9 * * 1', timezone: 'Europe/Madrid' },
        '2026-10-24T00:00:00Z',
      ),
    ).toEqual({ ok: true, nextFireAt: '2026-10-26T08:00:00Z' });
    expect(scheduler.nextTickDelay(0, scheduler.SCHEDULER_TICK_SECONDS_DEFAULT)).toBe(15_000);
    expect(scheduler.isTickSeconds(scheduler.SCHEDULER_TICK_SECONDS_MIN)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { isValidTimezone, nextFire, parseCron } from '../../core/src/cron.js';
import { resolveMisfire } from '../../core/src/misfire.js';
import { planPause, planResume } from './resume.js';
import type { Schedule, SchedulerDeps } from './types.js';

const deps: SchedulerDeps = {
  cron: { parse: parseCron, nextFire, isValidTimezone },
  misfire: resolveMisfire,
};

const SCHEDULE: Schedule = {
  kind: 'job',
  ownerId: 'job-daily',
  cron: '30 2 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  nextFireAt: '2026-10-25T00:30:00Z',
  createdAt: '2026-10-01T00:00:00Z',
};

describe('paused and resumed schedules', () => {
  it('paused: planPause clears the next fire and keeps the schedule identity', () => {
    expect(planPause(SCHEDULE)).toEqual({
      kind: 'job',
      ownerId: 'job-daily',
      nextFireAt: null,
    });
  });

  it('paused: planResume computes the next fire from now, never from the missed fire', () => {
    const update = planResume(deps, { schedule: SCHEDULE, now: '2026-10-25T09:00:00Z' });
    expect(update).toEqual({
      kind: 'job',
      ownerId: 'job-daily',
      nextFireAt: '2026-10-26T01:30:00Z',
    });
    expect(update.nextFireAt).not.toBe(SCHEDULE.nextFireAt);
  });

  it('paused: a resume on an invalid zone has no next fire', () => {
    const update = planResume(deps, {
      schedule: { ...SCHEDULE, timezone: 'Mars/Olympus' },
      now: '2026-10-25T09:00:00Z',
    });
    expect(update.nextFireAt).toBeNull();
  });

  it('paused: a resume on an invalid cron has no next fire', () => {
    const update = planResume(deps, {
      schedule: { ...SCHEDULE, cron: '@daily' },
      now: '2026-10-25T09:00:00Z',
    });
    expect(update.nextFireAt).toBeNull();
  });

  it('paused: a routine schedule is updated with its own kind', () => {
    const update = planResume(deps, {
      schedule: { ...SCHEDULE, kind: 'routine', ownerId: 'routine-1' },
      now: '2026-10-25T09:00:00Z',
    });
    expect(update.kind).toBe('routine');
    expect(update.ownerId).toBe('routine-1');
  });
});

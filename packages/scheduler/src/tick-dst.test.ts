import { describe, expect, it } from 'vitest';
import { isValidTimezone, nextFire, parseCron } from '../../core/src/cron.js';
import { resolveMisfire } from '../../core/src/misfire.js';
import { planTick } from './tick.js';
import type { SchedulerDeps, Schedule, TickPlan } from './types.js';

const deps: SchedulerDeps = {
  cron: { parse: parseCron, nextFire, isValidTimezone },
  misfire: resolveMisfire,
};

interface MadridRow {
  readonly cron: string;
  readonly timezone: string;
  readonly nextFireAt: string;
  readonly now: string;
  readonly due: boolean;
  readonly expected: string;
}

const ROWS: readonly MadridRow[] = [
  {
    cron: '30 2 * * *',
    timezone: 'Europe/Madrid',
    nextFireAt: '2026-10-24T00:30:00Z',
    now: '2026-10-24T00:31:00Z',
    due: true,
    expected: '2026-10-25T00:30:00Z',
  },
  {
    cron: '30 2 * * *',
    timezone: 'Europe/Madrid',
    nextFireAt: '2026-10-24T00:30:00Z',
    now: '2026-10-24T00:46:00Z',
    due: false,
    expected: '2026-10-25T00:30:00Z',
  },
  {
    cron: '30 2 * * *',
    timezone: 'Europe/Madrid',
    nextFireAt: '2026-10-25T00:30:00Z',
    now: '2026-10-25T00:30:00Z',
    due: true,
    expected: '2026-10-26T01:30:00Z',
  },
  {
    cron: '30 2 * * *',
    timezone: 'Europe/Madrid',
    nextFireAt: '2027-03-28T00:30:00Z',
    now: '2027-03-28T00:30:00Z',
    due: true,
    expected: '2027-03-28T01:00:00Z',
  },
  {
    cron: '0 3 * * *',
    timezone: 'Europe/Madrid',
    nextFireAt: '2026-10-24T02:00:00Z',
    now: '2026-10-24T02:00:00Z',
    due: true,
    expected: '2026-10-25T02:00:00Z',
  },
  {
    cron: '0 0 * * *',
    timezone: 'UTC',
    nextFireAt: '2026-10-25T00:00:00Z',
    now: '2026-10-25T00:00:00Z',
    due: true,
    expected: '2026-10-26T00:00:00Z',
  },
];

function makeSchedule(row: MadridRow): Schedule {
  return {
    kind: 'job',
    ownerId: 'job-madrid',
    cron: row.cron,
    timezone: row.timezone,
    enabled: true,
    nextFireAt: row.nextFireAt,
    createdAt: '2026-10-01T00:00:00Z',
  };
}

function plan(row: MadridRow): TickPlan {
  return planTick(deps, {
    now: row.now,
    schedules: [makeSchedule(row)],
    graceSeconds: 900,
    limit: 10,
  });
}

describe('Europe/Madrid through planTick', () => {
  it('Madrid: a 02:30 fire inside the grace runs and rolls to the next day', () => {
    const row = ROWS[0] as MadridRow;
    const result = plan(row);
    expect(result.due).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]?.nextFireAt).toBe(row.expected);
  });

  it('Madrid: the same 02:30 fire outside the grace is skipped and still rolls over', () => {
    const row = ROWS[1] as MadridRow;
    const result = plan(row);
    expect(result.due).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe('outside_grace');
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]?.nextFireAt).toBe(row.expected);
  });

  it('Madrid: the fall-back 02:30 fires once and the next fire is 02:30 CET', () => {
    const row = ROWS[2] as MadridRow;
    const result = plan(row);
    expect(result.due).toHaveLength(1);
    expect(result.updates[0]?.nextFireAt).toBe(row.expected);
  });

  it('Madrid: the spring-forward 02:30 fires at the first valid instant', () => {
    const row = ROWS[3] as MadridRow;
    const result = plan(row);
    expect(result.due).toHaveLength(1);
    expect(result.updates[0]?.nextFireAt).toBe(row.expected);
  });

  it('Madrid: 03:00 across the fall-back lands on the CET occurrence', () => {
    const row = ROWS[4] as MadridRow;
    const result = plan(row);
    expect(result.due).toHaveLength(1);
    expect(result.updates[0]?.nextFireAt).toBe(row.expected);
  });

  it('Madrid: UTC stays one fire per day across the Madrid transition', () => {
    const row = ROWS[5] as MadridRow;
    const result = plan(row);
    expect(result.due).toHaveLength(1);
    expect(result.updates[0]?.nextFireAt).toBe(row.expected);
  });
});

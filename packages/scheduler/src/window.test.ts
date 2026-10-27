import { describe, expect, it } from 'vitest';
import { isValidTimezone, nextFire, parseCron } from '../../core/src/cron.js';
import { resolveMisfire } from '../../core/src/misfire.js';
import type { SchedulerDeps } from './types.js';
import { isInsideWindow, nextWindowOpen, planNextFire } from './window.js';
import type { ScheduleFireContext } from './window.js';

const deps: SchedulerDeps = {
  cron: { parse: parseCron, nextFire, isValidTimezone },
  misfire: resolveMisfire,
};

const WINDOW: ScheduleFireContext = {
  mode: 'window',
  timezone: 'Europe/Madrid',
  cron: null,
  windowStart: '22:00',
  windowEnd: '06:00',
  cooldownMinutes: 20,
  maxFires: null,
  maxCostPerFireUsd: null,
  firesCount: 0,
  consecutiveFailures: 0,
  lastCostUsd: 0,
  finishedAt: '2026-03-28T21:11:00Z',
  enabled: true,
};

function window(input: Partial<ScheduleFireContext>): ScheduleFireContext {
  return { ...WINDOW, ...input };
}

describe('planNextFire: the cooldown inside a window', () => {
  it('starts the next fire 20 minutes after the previous one finished', () => {
    // 21:31Z is 22:31 in Madrid: still inside 22:00–06:00, so the cooldown is the answer.
    expect(planNextFire(deps, WINDOW)).toEqual({
      nextFireAt: '2026-03-28T21:31:00Z',
      stop: null,
      skippedDstGap: false,
    });
  });

  it('jumps to the next opening when the candidate fell before it', () => {
    expect(
      planNextFire(
        deps,
        window({ finishedAt: '2026-10-24T18:00:00Z', cooldownMinutes: 20, windowStart: '22:00' }),
      ),
    ).toEqual({ nextFireAt: '2026-10-24T20:00:00Z', stop: null, skippedDstGap: false });
  });

  it('runs past midnight and keeps the cooldown inside the wrapped window', () => {
    // 23:50Z is 00:50 local on the 26th, still inside 22:00–06:00 after the fall back.
    expect(planNextFire(deps, window({ finishedAt: '2026-10-25T23:30:00Z' }))).toEqual({
      nextFireAt: '2026-10-25T23:50:00Z',
      stop: null,
      skippedDstGap: false,
    });
  });
});

describe('planNextFire: the DST gap of a zone', () => {
  const gapWindow: Partial<ScheduleFireContext> = {
    windowStart: '02:00',
    windowEnd: '04:00',
    finishedAt: '2026-03-29T00:30:00Z',
  };

  it('skips the day the window start does not exist and lands after the gap', () => {
    // Madrid jumps 02:00 CET to 03:00 CEST at 01:00Z: 02:00 local never happens.
    expect(planNextFire(deps, window(gapWindow))).toEqual({
      nextFireAt: '2026-03-29T01:00:00Z',
      stop: null,
      skippedDstGap: true,
    });
  });

  it('never reports a second fire on the skipped day', () => {
    expect(
      planNextFire(deps, window({ ...gapWindow, finishedAt: '2026-03-29T01:00:00Z' })),
    ).toEqual({ nextFireAt: '2026-03-30T00:00:00Z', stop: null, skippedDstGap: false });
  });

  it('resolves a wall clock that happens twice to its first occurrence', () => {
    expect(
      planNextFire(
        deps,
        window({
          windowStart: '02:30',
          windowEnd: '04:00',
          finishedAt: '2026-10-24T23:30:00Z',
        }),
      ),
    ).toEqual({ nextFireAt: '2026-10-25T00:30:00Z', stop: null, skippedDstGap: false });
  });
});

describe('planNextFire: the stops of D46', () => {
  it('pauses after three consecutive failures', () => {
    expect(planNextFire(deps, window({ consecutiveFailures: 3 }))).toEqual({
      nextFireAt: null,
      stop: 'failures',
      skippedDstGap: false,
    });
  });

  it('stops at maxFires', () => {
    expect(planNextFire(deps, window({ firesCount: 4, maxFires: 4 }))).toEqual({
      nextFireAt: null,
      stop: 'max_fires',
      skippedDstGap: false,
    });
  });

  it('stops when the fire that just ended reached the cost cap', () => {
    expect(planNextFire(deps, window({ lastCostUsd: 0.5, maxCostPerFireUsd: 0.5 }))).toEqual({
      nextFireAt: null,
      stop: 'max_cost',
      skippedDstGap: false,
    });
    expect(planNextFire(deps, window({ lastCostUsd: 0.49, maxCostPerFireUsd: 0.5 }))).toMatchObject(
      { stop: null },
    );
  });

  it('answers disabled first, then the caps', () => {
    expect(planNextFire(deps, window({ enabled: false, consecutiveFailures: 9 }))).toEqual({
      nextFireAt: null,
      stop: 'disabled',
      skippedDstGap: false,
    });
  });

  it('stops a once schedule after its fire and an every schedule that cannot advance', () => {
    const once: ScheduleFireContext = {
      ...window({}),
      mode: 'once',
      cron: '0 3 1 1 *',
      windowStart: null,
      windowEnd: null,
    };
    expect(planNextFire(deps, once)).toEqual({
      nextFireAt: null,
      stop: 'no_next_fire',
      skippedDstGap: false,
    });
    const broken: ScheduleFireContext = { ...once, mode: 'every', cron: '99 99 * * *' };
    expect(planNextFire(deps, broken)).toEqual({
      nextFireAt: null,
      stop: 'no_next_fire',
      skippedDstGap: false,
    });
  });

  it('advances an every schedule through the cron engine from the finish instant', () => {
    const every: ScheduleFireContext = {
      ...window({}),
      mode: 'every',
      cron: '0 3 * * *',
      timezone: 'UTC',
      windowStart: null,
      windowEnd: null,
      finishedAt: '2026-10-25T04:00:00Z',
    };
    expect(planNextFire(deps, every)).toEqual({
      nextFireAt: '2026-10-26T03:00:00Z',
      stop: null,
      skippedDstGap: false,
    });
  });

  it('closes a window that is empty or sits in an unknown zone', () => {
    expect(planNextFire(deps, window({ windowStart: '22:00', windowEnd: '22:00' }))).toMatchObject({
      stop: 'window_closed',
      nextFireAt: null,
    });
    expect(planNextFire(deps, window({ timezone: 'Mars/Olympus' }))).toMatchObject({
      stop: 'window_closed',
      nextFireAt: null,
    });
  });
});

describe('isInsideWindow', () => {
  const zone = 'Europe/Madrid';

  it('is half-open and wraps midnight', () => {
    // 21:00Z is 22:00 Madrid (CET in March) and 04:00Z is 05:00 Madrid.
    expect(
      isInsideWindow({
        timezone: zone,
        windowStart: '22:00',
        windowEnd: '06:00',
        at: '2026-03-01T21:00:00Z',
      }),
    ).toBe(true);
    expect(
      isInsideWindow({
        timezone: zone,
        windowStart: '22:00',
        windowEnd: '06:00',
        at: '2026-03-01T04:59:00Z',
      }),
    ).toBe(true);
    expect(
      isInsideWindow({
        timezone: zone,
        windowStart: '22:00',
        windowEnd: '06:00',
        at: '2026-03-01T05:00:00Z',
      }),
    ).toBe(false);
    expect(
      isInsideWindow({
        timezone: zone,
        windowStart: '22:00',
        windowEnd: '06:00',
        at: '2026-03-01T20:59:00Z',
      }),
    ).toBe(false);
  });

  it('excludes the end instant of a plain window', () => {
    expect(
      isInsideWindow({
        timezone: zone,
        windowStart: '08:00',
        windowEnd: '12:00',
        at: '2026-03-01T09:00:00Z',
      }),
    ).toBe(true);
    expect(
      isInsideWindow({
        timezone: zone,
        windowStart: '08:00',
        windowEnd: '12:00',
        at: '2026-03-01T11:00:00Z',
      }),
    ).toBe(false);
  });

  it('is never inside an always-empty window and survives bad input', () => {
    expect(
      isInsideWindow({
        timezone: zone,
        windowStart: '08:00',
        windowEnd: '08:00',
        at: '2026-03-01T09:00:00Z',
      }),
    ).toBe(false);
    expect(
      isInsideWindow({
        timezone: 'Mars/Olympus',
        windowStart: '08:00',
        windowEnd: '12:00',
        at: '2026-03-01T09:00:00Z',
      }),
    ).toBe(false);
    expect(
      isInsideWindow({
        timezone: zone,
        windowStart: '8:00',
        windowEnd: '12:00',
        at: '2026-03-01T09:00:00Z',
      }),
    ).toBe(false);
    expect(
      isInsideWindow({ timezone: zone, windowStart: '08:00', windowEnd: '12:00', at: 'nope' }),
    ).toBe(false);
  });
});

describe('nextWindowOpen', () => {
  it('returns the next opening strictly after the instant', () => {
    expect(
      nextWindowOpen({
        timezone: 'Europe/Madrid',
        windowStart: '22:00',
        windowEnd: '06:00',
        after: '2026-03-28T10:00:00Z',
      }),
    ).toBe('2026-03-28T21:00:00Z');
  });

  it('moves to tomorrow when the opening already happened today', () => {
    expect(
      nextWindowOpen({
        timezone: 'Europe/Madrid',
        windowStart: '22:00',
        windowEnd: '06:00',
        after: '2026-03-28T22:00:00Z',
      }),
    ).toBe('2026-03-29T20:00:00Z');
  });

  it('returns the first valid instant for a gap day and one instant for a repeated one', () => {
    expect(
      nextWindowOpen({
        timezone: 'Europe/Madrid',
        windowStart: '02:00',
        windowEnd: '04:00',
        after: '2026-03-29T00:30:00Z',
      }),
    ).toBe('2026-03-29T01:00:00Z');
    expect(
      nextWindowOpen({
        timezone: 'Europe/Madrid',
        windowStart: '02:30',
        windowEnd: '04:00',
        after: '2026-10-24T23:30:00Z',
      }),
    ).toBe('2026-10-25T00:30:00Z');
  });

  it('is null for an empty window, a bad zone and a bad instant', () => {
    expect(
      nextWindowOpen({
        timezone: 'Europe/Madrid',
        windowStart: '08:00',
        windowEnd: '08:00',
        after: '2026-03-28T10:00:00Z',
      }),
    ).toBeNull();
    expect(
      nextWindowOpen({
        timezone: 'Mars/Olympus',
        windowStart: '08:00',
        windowEnd: '12:00',
        after: '2026-03-28T10:00:00Z',
      }),
    ).toBeNull();
    expect(
      nextWindowOpen({
        timezone: 'Europe/Madrid',
        windowStart: '08:00',
        windowEnd: '12:00',
        after: 'nope',
      }),
    ).toBeNull();
  });
});

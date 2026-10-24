import { describe, expect, it } from 'vitest';
import { resolveMisfire } from './misfire.js';

describe('misfire', () => {
  const scheduledFor = '2026-10-24T12:00:00Z';
  const cases: ReadonlyArray<
    readonly [string, number, boolean, 'not_due' | 'on_time' | 'outside_grace', number]
  > = [
    ['2026-10-24T11:59:00Z', 900, false, 'not_due', -60],
    ['2026-10-24T12:00:00Z', 900, true, 'on_time', 0],
    ['2026-10-24T12:05:00Z', 900, true, 'on_time', 300],
    ['2026-10-24T12:14:59Z', 900, true, 'on_time', 899],
    ['2026-10-24T12:15:00Z', 900, false, 'outside_grace', 900],
    ['2026-10-24T12:15:01Z', 900, false, 'outside_grace', 901],
    ['2026-10-25T12:00:00Z', 900, false, 'outside_grace', 86400],
    ['2026-10-24T12:00:00Z', 0, false, 'outside_grace', 0],
  ];

  it('decides the grace window from the arguments alone', () => {
    for (const [now, graceSeconds, run, code, ageSeconds] of cases) {
      expect(resolveMisfire({ scheduledFor, now, graceSeconds })).toEqual({
        run,
        code,
        ageSeconds,
      });
    }
  });

  it('rounds the age down and keeps the sign', () => {
    const decision = resolveMisfire({
      scheduledFor,
      now: '2026-10-24T12:00:00.999Z',
      graceSeconds: 900,
    });
    expect(decision.ageSeconds).toBe(0);
    const early = resolveMisfire({
      scheduledFor,
      now: '2026-10-24T11:59:59.500Z',
      graceSeconds: 900,
    });
    expect(early.ageSeconds).toBe(-1);
    expect(early.run).toBe(false);
    expect(early.code).toBe('not_due');
  });
});

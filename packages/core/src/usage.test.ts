import { describe, expect, it } from 'vitest';
import {
  RANGE_MILLISECONDS,
  USAGE_RANGES,
  daysInWindow,
  summariseUsage,
  usageWindow,
  utcDayOf,
} from './usage.js';
import type { UsageEntry, UsageWindow } from './usage.js';

const NOW = new Date('2026-10-25T12:00:00.000Z');

function entry(overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    runId: 'run_0000001',
    day: '2026-10-25',
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.5,
    createdAt: '2026-10-25T11:00:00.000Z',
    ...overrides,
  };
}

describe('USAGE_RANGES', () => {
  it('pins the four ranges and their duration in milliseconds', () => {
    expect([...USAGE_RANGES]).toEqual(['1h', '24h', '7d', '30d']);
    expect(RANGE_MILLISECONDS).toEqual({
      '1h': 3_600_000,
      '24h': 86_400_000,
      '7d': 604_800_000,
      '30d': 2_592_000_000,
    });
  });
});

describe('usageWindow', () => {
  it('pins every range against a fixed now, with millisecond precision', () => {
    expect(usageWindow('1h', NOW)).toEqual({
      since: '2026-10-25T11:00:00.000Z',
      until: '2026-10-25T12:00:00.000Z',
    });
    expect(usageWindow('24h', NOW)).toEqual({
      since: '2026-10-24T12:00:00.000Z',
      until: '2026-10-25T12:00:00.000Z',
    });
    expect(usageWindow('7d', NOW)).toEqual({
      since: '2026-10-18T12:00:00.000Z',
      until: '2026-10-25T12:00:00.000Z',
    });
    expect(usageWindow('30d', NOW)).toEqual({
      since: '2026-09-25T12:00:00.000Z',
      until: '2026-10-25T12:00:00.000Z',
    });
  });

  it('keeps the sub-second part of now instead of truncating to the second', () => {
    const window = usageWindow('1h', new Date('2026-10-25T12:00:00.123Z'));
    expect(window.since).toBe('2026-10-25T11:00:00.123Z');
    expect(window.until).toBe('2026-10-25T12:00:00.123Z');
  });
});

describe('utcDayOf', () => {
  it('reads the UTC day of a late instant, never the local one', () => {
    expect(utcDayOf('2026-10-25T23:30:00.000Z')).toBe('2026-10-25');
    expect(utcDayOf('2026-10-25T00:00:00.000Z')).toBe('2026-10-25');
    expect(utcDayOf('2026-01-01T00:00:00.000Z')).toBe('2026-01-01');
  });
});

describe('daysInWindow', () => {
  it('spans both days of a window that crosses midnight, ascending and inclusive', () => {
    const window = usageWindow('24h', new Date('2026-10-25T23:30:00.000Z'));
    expect(window).toEqual({
      since: '2026-10-24T23:30:00.000Z',
      until: '2026-10-25T23:30:00.000Z',
    });
    expect([...daysInWindow(window)]).toEqual(['2026-10-24', '2026-10-25']);
  });

  it('returns the single day of a window inside one UTC day', () => {
    const window: UsageWindow = {
      since: '2026-10-25T08:00:00.000Z',
      until: '2026-10-25T12:00:00.000Z',
    };
    expect([...daysInWindow(window)]).toEqual(['2026-10-25']);
  });

  it('returns the two ends of the window even when the start is midnight', () => {
    const window: UsageWindow = {
      since: '2026-10-23T00:00:00.000Z',
      until: '2026-10-25T00:00:00.000Z',
    };
    expect([...daysInWindow(window)]).toEqual(['2026-10-23', '2026-10-24', '2026-10-25']);
  });
});

describe('summariseUsage', () => {
  const window: UsageWindow = {
    since: '2026-10-25T00:00:00.000Z',
    until: '2026-10-25T12:00:00.000Z',
  };

  it('sums tokens and spend and counts distinct runs inside the window', () => {
    const summary = summariseUsage(
      [
        entry(),
        entry({ runId: 'run_0000002', tokensIn: 10, tokensOut: 5, costUsd: 0.25 }),
        entry({ runId: 'run_0000001', tokensIn: 1, tokensOut: 1, costUsd: 0.25 }),
        entry({ runId: null, tokensIn: 1, tokensOut: 1, costUsd: 0.5 }),
      ],
      window,
    );
    expect(summary).toEqual({ spendUsd: 1.5, tokensIn: 112, tokensOut: 57, runs: 2 });
  });

  it('discards an entry one millisecond outside either end', () => {
    const summary = summariseUsage(
      [
        entry({ createdAt: '2026-10-24T23:59:59.999Z', costUsd: 10 }),
        entry({ createdAt: '2026-10-25T12:00:00.001Z', costUsd: 10 }),
        entry({ createdAt: '2026-10-25T00:00:00.000Z', costUsd: 0.5 }),
        entry({ createdAt: '2026-10-25T12:00:00.000Z', costUsd: 0.5 }),
      ],
      window,
    );
    expect(summary.spendUsd).toBe(1);
    expect(summary.tokensIn).toBe(200);
  });

  it('rounds a floating-point sum to six decimals', () => {
    const summary = summariseUsage(
      [
        entry({ runId: 'run_0000001', costUsd: 0.1 }),
        entry({ runId: 'run_0000002', costUsd: 0.2 }),
      ],
      window,
    );
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(summary.spendUsd).toBe(0.3);
    expect(summary.runs).toBe(2);
  });

  it('returns zeroes for an empty entry list', () => {
    expect(summariseUsage([], window)).toEqual({
      spendUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      runs: 0,
    });
  });
});

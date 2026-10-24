import { describe, expect, it } from 'vitest';
import {
  SCHEDULER_TICK_SECONDS_DEFAULT,
  SCHEDULER_TICK_SECONDS_MAX,
  SCHEDULER_TICK_SECONDS_MIN,
  isTickSeconds,
  nextTickDelay,
} from './clock.js';

describe('next tick delay', () => {
  it('pins the epoch-aligned tick promise', () => {
    expect(nextTickDelay(0, 15)).toBe(15000);
    expect(nextTickDelay(1, 15)).toBe(14999);
    expect(nextTickDelay(14999, 15)).toBe(1);
    expect(nextTickDelay(15000, 15)).toBe(15000);
    expect(nextTickDelay(15001, 15)).toBe(14999);
    expect(nextTickDelay(7, 30)).toBe(29993);
  });

  it('keeps the delay inside one tick for any instant', () => {
    for (const nowMs of [-30_000, -1, 0, 1, 7, 999, 14_999, 15_000, 123_456_789]) {
      const delay = nextTickDelay(nowMs, 15);
      expect(delay).toBeGreaterThanOrEqual(1);
      expect(delay).toBeLessThanOrEqual(15_000);
      expect((nowMs + delay) % 15_000 === 0).toBe(true);
    }
  });

  it('rejects a tick that is not an integer of at least one second', () => {
    for (const tickSeconds of [0, -15, 15.5, 1.5, Number.NaN]) {
      expect(() => nextTickDelay(0, tickSeconds)).toThrow(RangeError);
    }
  });
});

describe('tick seconds', () => {
  it('accepts only the configured integer range', () => {
    expect(SCHEDULER_TICK_SECONDS_DEFAULT).toBe(15);
    expect(SCHEDULER_TICK_SECONDS_MIN).toBe(15);
    expect(SCHEDULER_TICK_SECONDS_MAX).toBe(30);
    expect(isTickSeconds(15)).toBe(true);
    expect(isTickSeconds(30)).toBe(true);
    expect(isTickSeconds(14)).toBe(false);
    expect(isTickSeconds(31)).toBe(false);
    expect(isTickSeconds(15.5)).toBe(false);
    expect(isTickSeconds(Number.NaN)).toBe(false);
  });
});

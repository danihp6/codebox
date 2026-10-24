import { describe, expect, it } from 'vitest';
import { checkCost, checkRunTimeout } from './limits.js';

describe('limits', () => {
  it('stops at the daily cap and disables it with zero', () => {
    expect(
      checkCost({ spentTodayUsd: 9.5, dailyCapUsd: 10, runCostUsd: 0.5, jobMaxCostUsd: null }),
    ).toEqual({
      allowed: false,
      code: 'cost_cap_reached',
      message: 'The daily cost cap of 10 USD is reached.',
    });
    expect(
      checkCost({ spentTodayUsd: 9, dailyCapUsd: 10, runCostUsd: 0.5, jobMaxCostUsd: null }),
    ).toEqual({ allowed: true });
    expect(
      checkCost({ spentTodayUsd: 100, dailyCapUsd: 0, runCostUsd: 5, jobMaxCostUsd: null }),
    ).toEqual({ allowed: true });
  });

  it('stops at the job cap when the daily cap is not hit', () => {
    expect(
      checkCost({ spentTodayUsd: 0, dailyCapUsd: 10, runCostUsd: 1.5, jobMaxCostUsd: 1.5 }),
    ).toEqual({
      allowed: false,
      code: 'job_cost_exceeded',
      message: 'The job cost cap of 1.5 USD is reached.',
    });
    expect(
      checkCost({ spentTodayUsd: 0, dailyCapUsd: 10, runCostUsd: 1, jobMaxCostUsd: 1.5 }),
    ).toEqual({ allowed: true });
    expect(
      checkCost({ spentTodayUsd: 0, dailyCapUsd: 10, runCostUsd: 5, jobMaxCostUsd: null }),
    ).toEqual({ allowed: true });
  });

  it('checks the daily cap before the job cap', () => {
    expect(
      checkCost({ spentTodayUsd: 9.9, dailyCapUsd: 10, runCostUsd: 0.5, jobMaxCostUsd: 0.1 }),
    ).toEqual({
      allowed: false,
      code: 'cost_cap_reached',
      message: 'The daily cost cap of 10 USD is reached.',
    });
  });

  it('expires a run at the timeout and never before it', () => {
    const startedAt = '2026-10-24T12:00:00Z';
    expect(
      checkRunTimeout({ startedAt, now: '2026-10-24T13:30:00Z', timeoutSeconds: 5400 }),
    ).toEqual({ expired: true, elapsedMs: 5_400_000 });
    expect(
      checkRunTimeout({ startedAt, now: '2026-10-24T13:29:59Z', timeoutSeconds: 5400 }),
    ).toEqual({ expired: false, elapsedMs: 5_399_000 });
    expect(
      checkRunTimeout({ startedAt, now: '2026-10-24T11:00:00Z', timeoutSeconds: 5400 }),
    ).toEqual({ expired: false, elapsedMs: -3_600_000 });
    expect(checkRunTimeout({ startedAt, now: startedAt, timeoutSeconds: 0 })).toEqual({
      expired: true,
      elapsedMs: 0,
    });
  });
});

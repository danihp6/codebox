export const USAGE_RANGES = ['1h', '24h', '7d', '30d'] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const RANGE_MILLISECONDS: Readonly<Record<UsageRange, number>> = Object.freeze({
  '1h': HOUR_MS,
  '24h': 24 * HOUR_MS,
  '7d': 7 * 24 * HOUR_MS,
  '30d': 30 * 24 * HOUR_MS,
});

export interface UsageWindow {
  readonly since: string;
  readonly until: string;
}

export interface UsageEntry {
  readonly runId: string | null;
  readonly day: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
  readonly createdAt: string;
}

export interface UsageSummary {
  readonly spendUsd: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly runs: number;
}

const DAY_LENGTH = 10;
const MICRO = 1e6;

export function usageWindow(range: UsageRange, now: Date): UsageWindow {
  return {
    since: new Date(now.getTime() - RANGE_MILLISECONDS[range]).toISOString(),
    until: now.toISOString(),
  };
}

/** The `YYYY-MM-DD` prefix of a `Z` instant: never the host time zone. */
export function utcDayOf(instant: string): string {
  return instant.slice(0, DAY_LENGTH);
}

export function daysInWindow(window: UsageWindow): readonly string[] {
  const days: string[] = [];
  const last = Date.parse(`${utcDayOf(window.until)}T00:00:00.000Z`);
  let cursor = Date.parse(`${utcDayOf(window.since)}T00:00:00.000Z`);
  while (cursor <= last) {
    days.push(new Date(cursor).toISOString().slice(0, DAY_LENGTH));
    cursor += DAY_MS;
  }
  return days;
}

export function summariseUsage(entries: readonly UsageEntry[], window: UsageWindow): UsageSummary {
  let tokensIn = 0;
  let tokensOut = 0;
  let spend = 0;
  const runs = new Set<string>();
  for (const entry of entries) {
    if (entry.createdAt < window.since || entry.createdAt > window.until) continue;
    tokensIn += entry.tokensIn;
    tokensOut += entry.tokensOut;
    spend += entry.costUsd;
    if (entry.runId !== null) runs.add(entry.runId);
  }
  return {
    spendUsd: Math.round(spend * MICRO) / MICRO,
    tokensIn,
    tokensOut,
    runs: runs.size,
  };
}

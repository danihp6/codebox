import type { SchedulerDeps } from './types.js';

export type ScheduleStopReason =
  'disabled' | 'failures' | 'max_fires' | 'max_cost' | 'window_closed' | 'no_next_fire';

export interface ScheduleFireContext {
  readonly mode: 'once' | 'every' | 'window';
  readonly timezone: string;
  readonly cron: string | null;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly cooldownMinutes: number;
  readonly maxFires: number | null;
  readonly maxCostPerFireUsd: number | null;
  readonly firesCount: number;
  readonly consecutiveFailures: number;
  readonly lastCostUsd: number;
  readonly finishedAt: string;
  readonly enabled: boolean;
}

export interface ScheduleFirePlan {
  readonly nextFireAt: string | null;
  readonly stop: ScheduleStopReason | null;
  readonly skippedDstGap: boolean;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const HORIZON_DAYS = 8;
const TRANSITION_WINDOW_MS = 26 * HOUR_MS;

/** D46: three consecutive failures pause the loop. */
export const SCHEDULE_FAILURE_LIMIT = 3;

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface ResolvedWallClock {
  readonly instant: number;
  /** The wall clock does not exist that day: a spring-forward gap. */
  readonly missing: boolean;
}

interface ZoneClock {
  readonly formatter: Intl.DateTimeFormat;
}

function formatInstant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function parseInstant(value: string): number | null {
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

/** 'HH:MM' as minutes from midnight, or `null` for anything the schema would reject. */
function minutesOfTime(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Every instant is read through `Intl.DateTimeFormat` with the IANA zone: a fixed offset would
// be wrong on the two days a year the zone moves.
function createClock(timezone: string): ZoneClock | null {
  try {
    return {
      formatter: new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    };
  } catch {
    return null;
  }
}

function wallClockAt(clock: ZoneClock, instant: number): WallClock {
  const parts = clock.formatter.formatToParts(new Date(instant));
  let year = 0;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const part of parts) {
    switch (part.type) {
      case 'year':
        year = Number(part.value);
        break;
      case 'month':
        month = Number(part.value);
        break;
      case 'day':
        day = Number(part.value);
        break;
      case 'hour':
        hour = Number(part.value);
        break;
      case 'minute':
        minute = Number(part.value);
        break;
      case 'second':
        second = Number(part.value);
        break;
      default:
        break;
    }
  }
  return { year, month, day, hour, minute, second };
}

function civilDateOf(clock: ZoneClock, instant: number): CivilDate {
  const wall = wallClockAt(clock, instant);
  return { year: wall.year, month: wall.month, day: wall.day };
}

function offsetAt(clock: ZoneClock, instant: number): number {
  const wall = wallClockAt(clock, instant);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

function transitionAfter(clock: ZoneClock, target: number): number | null {
  const low = target - TRANSITION_WINDOW_MS;
  const high = target + TRANSITION_WINDOW_MS;
  const before = offsetAt(clock, low);
  const after = offsetAt(clock, high);
  if (after <= before) return null;
  let lowSecond = Math.floor(low / 1000);
  let highSecond = Math.ceil(high / 1000);
  while (lowSecond < highSecond) {
    const middle = Math.floor((lowSecond + highSecond) / 2);
    if (offsetAt(clock, middle * 1000) === after) highSecond = middle;
    else lowSecond = middle + 1;
  }
  return lowSecond * 1000;
}

// A wall clock that happens twice (fall back) resolves to its first occurrence; one that never
// happens (spring forward) resolves to the first valid instant after the gap.
function resolveWallClock(clock: ZoneClock, wall: WallClock): ResolvedWallClock {
  const target = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const offsets = new Set<number>();
  for (const shift of [-DAY_MS, 0, DAY_MS]) offsets.add(offsetAt(clock, target + shift));
  let earliest: number | null = null;
  for (const offset of offsets) {
    const candidate = target - offset;
    const local = wallClockAt(clock, candidate);
    if (
      local.year !== wall.year ||
      local.month !== wall.month ||
      local.day !== wall.day ||
      local.hour !== wall.hour ||
      local.minute !== wall.minute ||
      local.second !== wall.second
    ) {
      continue;
    }
    if (earliest === null || candidate < earliest) earliest = candidate;
  }
  if (earliest !== null) return { instant: earliest, missing: false };
  const transition = transitionAfter(clock, target);
  return { instant: transition ?? target, missing: true };
}

function startWallClock(date: CivilDate, startMinutes: number): WallClock {
  return {
    year: date.year,
    month: date.month,
    day: date.day,
    hour: Math.floor(startMinutes / 60),
    minute: startMinutes % 60,
    second: 0,
  };
}

function nextCivilDay(date: CivilDate, offset: number): CivilDate {
  const day = new Date(Date.UTC(date.year, date.month - 1, date.day) + offset * DAY_MS);
  return { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() };
}

function inside(
  clock: ZoneClock,
  startMinutes: number,
  endMinutes: number,
  instant: number,
): boolean {
  if (startMinutes === endMinutes) return false;
  const wall = wallClockAt(clock, instant);
  const at = wall.hour * 60 + wall.minute;
  if (startMinutes < endMinutes) return at >= startMinutes && at < endMinutes;
  return at >= startMinutes || at < endMinutes;
}

/**
 * The next instant strictly after `afterMs` at which the half-open window opens. The opening of
 * a spring-forward day is the first instant of the day that exists; the opening of a fall-back
 * day happens once, at its first occurrence.
 */
function nextOpening(
  clock: ZoneClock,
  startMinutes: number,
  afterMs: number,
): { readonly instant: number; readonly skippedDstGap: boolean } | null {
  const start = civilDateOf(clock, afterMs);
  for (let index = 0; index < HORIZON_DAYS; index += 1) {
    const day = nextCivilDay(start, index);
    const resolved = resolveWallClock(clock, startWallClock(day, startMinutes));
    if (resolved.instant > afterMs) {
      return { instant: resolved.instant, skippedDstGap: resolved.missing };
    }
  }
  return null;
}

function stopped(reason: ScheduleStopReason): ScheduleFirePlan {
  return { nextFireAt: null, stop: reason, skippedDstGap: false };
}

/** D46: the next fire of a schedule, decided in this order, first match wins. */
export function planNextFire(deps: SchedulerDeps, input: ScheduleFireContext): ScheduleFirePlan {
  if (!input.enabled) return stopped('disabled');
  if (input.consecutiveFailures >= SCHEDULE_FAILURE_LIMIT) return stopped('failures');
  if (input.maxFires !== null && input.firesCount >= input.maxFires) return stopped('max_fires');
  if (input.maxCostPerFireUsd !== null && input.lastCostUsd >= input.maxCostPerFireUsd) {
    return stopped('max_cost');
  }
  if (input.mode === 'once') return stopped('no_next_fire');
  const finishedMs = parseInstant(input.finishedAt);
  if (finishedMs === null) return stopped('no_next_fire');

  if (input.mode === 'every') {
    if (input.cron === null) return stopped('no_next_fire');
    const parsed = deps.cron.parse(input.cron);
    if (!parsed.ok) return stopped('no_next_fire');
    const next = deps.cron.nextFire(parsed.cron, input.timezone, new Date(finishedMs));
    if (next === null) return stopped('no_next_fire');
    return { nextFireAt: formatInstant(next), stop: null, skippedDstGap: false };
  }

  if (input.windowStart === null || input.windowEnd === null) return stopped('window_closed');
  const startMinutes = minutesOfTime(input.windowStart);
  const endMinutes = minutesOfTime(input.windowEnd);
  if (startMinutes === null || endMinutes === null) return stopped('window_closed');
  if (startMinutes === endMinutes) return stopped('window_closed');
  const clock = createClock(input.timezone);
  if (clock === null) return stopped('window_closed');

  const cooldown = Number.isFinite(input.cooldownMinutes)
    ? Math.max(0, Math.trunc(input.cooldownMinutes))
    : 0;
  const candidate = finishedMs + cooldown * MINUTE_MS;
  const candidateDay = civilDateOf(clock, candidate);
  const opening = resolveWallClock(clock, startWallClock(candidateDay, startMinutes));
  // A gap day is skipped as a window, not re-entered: the loop leaves on the first valid
  // instant after the gap and never fires a second time on that day.
  if (!opening.missing && inside(clock, startMinutes, endMinutes, candidate)) {
    return { nextFireAt: formatInstant(new Date(candidate)), stop: null, skippedDstGap: false };
  }
  const next = nextOpening(clock, startMinutes, candidate);
  if (next === null) return stopped('window_closed');
  return {
    nextFireAt: formatInstant(new Date(next.instant)),
    stop: null,
    skippedDstGap: next.skippedDstGap,
  };
}

/** Half-open `[start, end)` in the schedule's zone; `start > end` wraps midnight. */
export function isInsideWindow(input: {
  readonly timezone: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly at: string;
}): boolean {
  const startMinutes = minutesOfTime(input.windowStart);
  const endMinutes = minutesOfTime(input.windowEnd);
  if (startMinutes === null || endMinutes === null) return false;
  const at = parseInstant(input.at);
  if (at === null) return false;
  const clock = createClock(input.timezone);
  if (clock === null) return false;
  return inside(clock, startMinutes, endMinutes, at);
}

/** The next instant strictly after `after` at which the window opens; `null` for an empty one. */
export function nextWindowOpen(input: {
  readonly timezone: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly after: string;
}): string | null {
  const startMinutes = minutesOfTime(input.windowStart);
  const endMinutes = minutesOfTime(input.windowEnd);
  if (startMinutes === null || endMinutes === null) return null;
  if (startMinutes === endMinutes) return null;
  const after = parseInstant(input.after);
  if (after === null) return null;
  const clock = createClock(input.timezone);
  if (clock === null) return null;
  const next = nextOpening(clock, startMinutes, after);
  return next === null ? null : formatInstant(new Date(next.instant));
}

export interface ParsedCron {
  readonly source: string;
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: readonly number[];
  readonly months: readonly number[];
  readonly daysOfWeek: readonly number[];
  readonly dayOfMonthRestricted: boolean;
  readonly dayOfWeekRestricted: boolean;
}

export type CronFailureCode = 'field_count' | 'range' | 'step' | 'syntax';

export type CronParseResult =
  | { readonly ok: true; readonly cron: ParsedCron }
  | { readonly ok: false; readonly code: CronFailureCode; readonly message: string };

interface FieldSpec {
  readonly label: string;
  readonly min: number;
  readonly max: number;
}

type FieldResult =
  | { readonly ok: true; readonly values: readonly number[] }
  | { readonly ok: false; readonly code: CronFailureCode; readonly message: string };

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

interface ZoneClock {
  readonly formatter: Intl.DateTimeFormat;
}

interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const HORIZON_DAYS = 1827;
const TRANSITION_WINDOW_MS = 26 * HOUR_MS;

const FIELD_SPECS: readonly FieldSpec[] = [
  { label: 'minute', min: 0, max: 59 },
  { label: 'hour', min: 0, max: 23 },
  { label: 'day of month', min: 1, max: 31 },
  { label: 'month', min: 1, max: 12 },
  { label: 'day of week', min: 0, max: 7 },
];

const DIGITS = /^\d+$/;

function syntaxError(spec: FieldSpec, field: string): FieldResult {
  return { ok: false, code: 'syntax', message: `The ${spec.label} field "${field}" is not valid.` };
}

function parseNumber(text: string): number | null {
  return DIGITS.test(text) ? Number(text) : null;
}

function parseField(field: string, spec: FieldSpec): FieldResult {
  const values = new Set<number>();
  for (const item of field.split(',')) {
    if (item === '') return syntaxError(spec, field);
    const parts = item.split('/');
    if (parts.length > 2) return syntaxError(spec, field);
    const base = parts[0] ?? '';
    const stepText = parts[1];
    let step = 1;
    if (stepText !== undefined) {
      const parsedStep = parseNumber(stepText);
      if (parsedStep === null) return syntaxError(spec, field);
      if (parsedStep === 0) {
        return { ok: false, code: 'step', message: `The ${spec.label} step must be at least 1.` };
      }
      step = parsedStep;
    }
    let start: number;
    let end: number;
    if (base === '*') {
      start = spec.min;
      end = spec.max;
    } else {
      const range = base.split('-');
      if (range.length === 1) {
        if (stepText !== undefined) return syntaxError(spec, field);
        const value = parseNumber(base);
        if (value === null) return syntaxError(spec, field);
        if (value < spec.min || value > spec.max) {
          return {
            ok: false,
            code: 'range',
            message: `The ${spec.label} value ${value} is outside ${spec.min}-${spec.max}.`,
          };
        }
        values.add(value);
        continue;
      }
      if (range.length !== 2) return syntaxError(spec, field);
      const from = parseNumber(range[0] ?? '');
      const to = parseNumber(range[1] ?? '');
      if (from === null || to === null) return syntaxError(spec, field);
      if (from < spec.min || from > spec.max || to < spec.min || to > spec.max) {
        return {
          ok: false,
          code: 'range',
          message: `The ${spec.label} range ${base} is outside ${spec.min}-${spec.max}.`,
        };
      }
      if (from > to) {
        return {
          ok: false,
          code: 'range',
          message: `The ${spec.label} range ${base} is not valid.`,
        };
      }
      start = from;
      end = to;
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return { ok: true, values: [...values].sort((left, right) => left - right) };
}

export function parseCron(expression: string): CronParseResult {
  const trimmed = expression.trim();
  const fields = trimmed === '' ? [] : trimmed.split(/\s+/);
  if (fields.length !== FIELD_SPECS.length) {
    return {
      ok: false,
      code: 'field_count',
      message: `Expected 5 cron fields, found ${fields.length}.`,
    };
  }
  const parsed: number[][] = [];
  for (let index = 0; index < FIELD_SPECS.length; index += 1) {
    const spec = FIELD_SPECS[index];
    const field = fields[index];
    if (spec === undefined || field === undefined) continue;
    const result = parseField(field, spec);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    parsed.push([...result.values]);
  }
  const minutes = parsed[0] ?? [];
  const hours = parsed[1] ?? [];
  const daysOfMonth = parsed[2] ?? [];
  const months = parsed[3] ?? [];
  const rawDaysOfWeek = parsed[4] ?? [];
  const daysOfWeek = [...new Set(rawDaysOfWeek.map((day) => (day === 7 ? 0 : day)))].sort(
    (left, right) => left - right,
  );
  const dayOfMonthField = fields[2] ?? '';
  const dayOfWeekField = fields[4] ?? '';
  return {
    ok: true,
    cron: {
      source: trimmed,
      minutes,
      hours,
      daysOfMonth,
      months,
      daysOfWeek,
      dayOfMonthRestricted: dayOfMonthField !== '*',
      dayOfWeekRestricted: dayOfWeekField !== '*',
    },
  };
}

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

export function isValidTimezone(timezone: string): boolean {
  return createClock(timezone) !== null;
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

function offsetAt(clock: ZoneClock, instant: number): number {
  const wall = wallClockAt(clock, instant);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

// Binary search instead of a scan: a five-year horizon never visits every minute.
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

// D13: a wall clock that happens twice resolves to its first occurrence; one that never
// happens (spring forward) resolves to the transition instant, the first valid instant after it.
function resolveWallClock(clock: ZoneClock, wall: WallClock): number | null {
  const target = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0);
  const offsets = new Set<number>();
  for (const shift of [-DAY_MS, 0, DAY_MS]) {
    offsets.add(offsetAt(clock, target + shift));
  }
  let earliest: number | null = null;
  for (const offset of offsets) {
    const candidate = target - offset;
    const local = wallClockAt(clock, candidate);
    if (
      local.year !== wall.year ||
      local.month !== wall.month ||
      local.day !== wall.day ||
      local.hour !== wall.hour ||
      local.minute !== wall.minute
    ) {
      continue;
    }
    if (earliest === null || candidate < earliest) earliest = candidate;
  }
  if (earliest !== null) return earliest;
  return transitionAfter(clock, target);
}

function dayMatches(cron: ParsedCron, dayOfMonth: number, dayOfWeek: number): boolean {
  const monthDayMatch = cron.daysOfMonth.includes(dayOfMonth);
  const weekDayMatch = cron.daysOfWeek.includes(dayOfWeek);
  if (cron.dayOfMonthRestricted && cron.dayOfWeekRestricted) return monthDayMatch || weekDayMatch;
  if (cron.dayOfMonthRestricted) return monthDayMatch;
  if (cron.dayOfWeekRestricted) return weekDayMatch;
  return true;
}

function firstInstantOnDay(
  clock: ZoneClock,
  cron: ParsedCron,
  date: CivilDate,
  afterMs: number,
): number | null {
  for (const hour of cron.hours) {
    for (const minute of cron.minutes) {
      const instant = resolveWallClock(clock, {
        year: date.year,
        month: date.month,
        day: date.day,
        hour,
        minute,
        second: 0,
      });
      if (instant !== null && instant > afterMs) return instant;
    }
  }
  return null;
}

export function nextFire(cron: ParsedCron, timezone: string, after: Date): Date | null {
  const clock = createClock(timezone);
  if (clock === null) return null;
  const afterMs = after.getTime();
  if (!Number.isFinite(afterMs)) return null;
  const start = wallClockAt(clock, afterMs);
  const startDay = Date.UTC(start.year, start.month - 1, start.day);
  for (let index = 0; index < HORIZON_DAYS; index += 1) {
    const day = new Date(startDay + index * DAY_MS);
    const year = day.getUTCFullYear();
    const month = day.getUTCMonth() + 1;
    const dayOfMonth = day.getUTCDate();
    const dayOfWeek = day.getUTCDay();
    if (!cron.months.includes(month)) continue;
    if (!dayMatches(cron, dayOfMonth, dayOfWeek)) continue;
    const instant = firstInstantOnDay(clock, cron, { year, month, day: dayOfMonth }, afterMs);
    if (instant !== null) return new Date(instant);
  }
  return null;
}

export function nextFires(cron: ParsedCron, timezone: string, after: Date, count: number): Date[] {
  const fires: Date[] = [];
  let cursor = after;
  for (let index = 0; index < count; index += 1) {
    const next = nextFire(cron, timezone, cursor);
    if (next === null) break;
    fires.push(next);
    cursor = next;
  }
  return fires;
}

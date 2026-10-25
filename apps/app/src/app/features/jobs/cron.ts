export const CRON_FIELDS = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'] as const;

export type CronField = (typeof CRON_FIELDS)[number];

export interface CronParts {
  readonly minute: string;
  readonly hour: string;
  readonly dayOfMonth: string;
  readonly month: string;
  readonly dayOfWeek: string;
}

export type CronProblem = 'field_count' | 'syntax' | 'range';

export interface CronValidation {
  readonly ok: boolean;
  readonly problems: readonly CronProblem[];
}

const FIELD_RANGES: Readonly<Record<CronField, readonly [number, number]>> = Object.freeze({
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 7],
});

const PROBLEM_ORDER: readonly CronProblem[] = Object.freeze(['field_count', 'syntax', 'range']);

const ANY = '*';
const WEEKDAYS_RANGE = '1-5';
const NUMERIC = /^\d+$/;
const STAR_STEP = /^\*\/(\d+)$/;
const RANGE_STEP = /^(\d+)-(\d+)\/(\d+)$/;
const RANGE = /^(\d+)-(\d+)$/;
const START_STEP = /^(\d+)\/(\d+)$/;
const SINGLE = /^(\d+)$/;

const WEEKDAYS: Readonly<Record<'en' | 'es', readonly string[]>> = Object.freeze({
  en: Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']),
  es: Object.freeze(['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']),
});

interface SummaryWords {
  readonly everyDayAt: (time: string) => string;
  readonly everyWeekdayAt: (time: string) => string;
  readonly everyWeekdayNameAt: (day: string, time: string) => string;
  readonly everyMinutes: (count: string) => string;
  readonly everyHoursAtMinute: (count: string, minute: string) => string;
}

const WORDS: Readonly<Record<'en' | 'es', SummaryWords>> = Object.freeze({
  en: {
    everyDayAt: (time) => `Every day at ${time}`,
    everyWeekdayAt: (time) => `Every weekday at ${time}`,
    everyWeekdayNameAt: (day, time) => `Every ${day} at ${time}`,
    everyMinutes: (count) => `Every ${count} minutes`,
    everyHoursAtMinute: (count, minute) => `Every ${count} hours at minute ${minute}`,
  },
  es: {
    everyDayAt: (time) => `Cada día a las ${time}`,
    everyWeekdayAt: (time) => `Cada día laborable a las ${time}`,
    everyWeekdayNameAt: (day, time) => `Cada ${day} a las ${time}`,
    everyMinutes: (count) => `Cada ${count} minutos`,
    everyHoursAtMinute: (count, minute) => `Cada ${count} horas en el minuto ${minute}`,
  },
});

export function validateCron(expression: string): CronValidation {
  const fields = splitFields(expression);
  if (fields.length !== CRON_FIELDS.length) {
    return { ok: false, problems: ['field_count'] };
  }

  const found = new Set<CronProblem>();
  for (let index = 0; index < CRON_FIELDS.length; index += 1) {
    const field = CRON_FIELDS[index];
    if (field === undefined) continue;
    for (const problem of checkField(field, fields[index] ?? '')) found.add(problem);
  }

  const problems = PROBLEM_ORDER.filter((problem) => found.has(problem));
  return { ok: problems.length === 0, problems };
}

export function toExpression(parts: CronParts): string {
  return CRON_FIELDS.map((field) => parts[field].trim()).join(' ');
}

export function summarise(expression: string, locale: 'en' | 'es'): string {
  const trimmed = expression.trim();
  const fields = splitFields(trimmed);
  if (fields.length !== CRON_FIELDS.length || !validateCron(trimmed).ok) return trimmed;

  const [minute = '', hour = '', dayOfMonth = '', month = '', dayOfWeek = ''] = fields;
  if (month !== ANY || dayOfMonth !== ANY) return trimmed;

  const words = WORDS[locale];
  const minuteStep = STAR_STEP.exec(minute);
  if (minuteStep !== null && hour === ANY && dayOfWeek === ANY) {
    return words.everyMinutes(minuteStep[1] ?? '');
  }

  const hourStep = STAR_STEP.exec(hour);
  if (hourStep !== null && NUMERIC.test(minute) && dayOfWeek === ANY) {
    return words.everyHoursAtMinute(hourStep[1] ?? '', minute);
  }

  if (!NUMERIC.test(minute) || !NUMERIC.test(hour)) return trimmed;
  const time = `${pad(hour)}:${pad(minute)}`;

  if (dayOfWeek === ANY) return words.everyDayAt(time);
  if (dayOfWeek === WEEKDAYS_RANGE) return words.everyWeekdayAt(time);
  if (!NUMERIC.test(dayOfWeek)) return trimmed;

  const day = WEEKDAYS[locale][Number(dayOfWeek) % 7];
  if (day === undefined) return trimmed;
  return words.everyWeekdayNameAt(day, time);
}

function splitFields(expression: string): readonly string[] {
  const trimmed = expression.trim();
  return trimmed === '' ? [] : trimmed.split(/\s+/);
}

function checkField(field: CronField, value: string): readonly CronProblem[] {
  const [min, max] = FIELD_RANGES[field];
  const problems: CronProblem[] = [];

  for (const raw of value.split(',')) {
    const item = raw.trim();
    if (item === '') {
      problems.push('syntax');
      continue;
    }
    if (item === ANY) continue;

    const starStep = STAR_STEP.exec(item);
    if (starStep !== null) {
      if (!isStep(starStep[1])) problems.push('range');
      continue;
    }

    const rangeStep = RANGE_STEP.exec(item);
    if (rangeStep !== null) {
      if (!inRange(rangeStep[1], min, max) || !inRange(rangeStep[2], min, max)) {
        problems.push('range');
      } else if (!isStep(rangeStep[3])) {
        problems.push('range');
      }
      continue;
    }

    const range = RANGE.exec(item);
    if (range !== null) {
      if (!inRange(range[1], min, max) || !inRange(range[2], min, max)) problems.push('range');
      continue;
    }

    const startStep = START_STEP.exec(item);
    if (startStep !== null) {
      if (!inRange(startStep[1], min, max) || !isStep(startStep[2])) problems.push('range');
      continue;
    }

    const single = SINGLE.exec(item);
    if (single !== null) {
      if (!inRange(single[1], min, max)) problems.push('range');
      continue;
    }

    problems.push('syntax');
  }

  return problems;
}

function inRange(value: string | undefined, min: number, max: number): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max;
}

function isStep(value: string | undefined): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1;
}

function pad(value: string): string {
  return value.padStart(2, '0');
}

import { describe, expect, it } from 'vitest';
import { isValidTimezone, nextFire, nextFires, parseCron } from './cron.js';
import type { ParsedCron } from './cron.js';

function parse(expression: string): ParsedCron {
  const result = parseCron(expression);
  if (!result.ok) throw new Error(`expected ${expression} to parse: ${result.message}`);
  return result.cron;
}

function iso(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString().replace('.000Z', 'Z');
}

describe('cron parser', () => {
  it('expands the five fields of a wildcard expression', () => {
    const cron = parse('* * * * *');
    expect(cron.source).toBe('* * * * *');
    expect(cron.minutes).toHaveLength(60);
    expect(cron.minutes[0]).toBe(0);
    expect(cron.minutes[59]).toBe(59);
    expect(cron.hours).toHaveLength(24);
    expect(cron.daysOfMonth).toHaveLength(31);
    expect(cron.months).toHaveLength(12);
    expect(cron.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(cron.dayOfMonthRestricted).toBe(false);
    expect(cron.dayOfWeekRestricted).toBe(false);
  });

  it('accepts lists, ranges and steps and sorts the result', () => {
    const cron = parse('5,3,1 0-12/6 1,15,31 1-6 1-5');
    expect(cron.minutes).toEqual([1, 3, 5]);
    expect(cron.hours).toEqual([0, 6, 12]);
    expect(cron.daysOfMonth).toEqual([1, 15, 31]);
    expect(cron.months).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cron.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(cron.dayOfMonthRestricted).toBe(true);
    expect(cron.dayOfWeekRestricted).toBe(true);
    expect(parse('*/20 * * * *').minutes).toEqual([0, 20, 40]);
    expect(parse('1-5/2 * * * *').minutes).toEqual([1, 3, 5]);
    expect(parse('0-59 * * * *').minutes).toHaveLength(60);
    expect(parse(' 0 3 * * * ').source).toBe('0 3 * * *');
  });

  it('normalises day of week 7 to Sunday', () => {
    expect(parse('0 0 * * 7').daysOfWeek).toEqual([0]);
    expect(parse('0 0 * * 0,7').daysOfWeek).toEqual([0]);
    expect(parse('0 0 * * 5-7').daysOfWeek).toEqual([0, 5, 6]);
  });

  it('rejects the wrong number of fields', () => {
    for (const expression of ['', '   ', '* * * *', '* * * * * *']) {
      const result = parseCron(expression);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('field_count');
    }
  });

  it('rejects a value outside the field range', () => {
    for (const expression of [
      '60 * * * *',
      '* 24 * * *',
      '* * 0 * *',
      '* * 32 * *',
      '* * * 0 *',
      '* * * 13 *',
      '* * * * 8',
      '10-5 * * * *',
    ]) {
      const result = parseCron(expression);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('range');
    }
  });

  it('rejects a zero step', () => {
    for (const expression of ['*/0 * * * *', '1-5/0 * * * *']) {
      const result = parseCron(expression);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('step');
    }
  });

  it('rejects a syntax it does not understand', () => {
    for (const expression of [
      'x * * * *',
      '*/ * * * *',
      '1,,2 * * * *',
      '1-2-3 * * * *',
      '5/2 * * * *',
      '* * * * SUN',
    ]) {
      const result = parseCron(expression);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('syntax');
    }
    expect(parseCron('@daily').ok).toBe(false);
  });
});

describe('timezones', () => {
  it('accepts an IANA zone and refuses anything Intl does not know', () => {
    expect(isValidTimezone('Europe/Madrid')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('Europe/Madrid ')).toBe(false);
  });

  it('returns null for an unknown zone instead of throwing', () => {
    const next = nextFire(parse('0 3 * * *'), 'Mars/Olympus', new Date('2026-10-24T18:03:11Z'));
    expect(next).toBeNull();
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('next fire', () => {
  const MADRID_ROWS: ReadonlyArray<readonly [string, string, string]> = [
    ['0 3 * * *', '2026-10-24T18:03:11Z', '2026-10-25T02:00:00Z'],
    ['30 2 * * *', '2026-10-24T12:00:00Z', '2026-10-25T00:30:00Z'],
    ['30 2 * * *', '2026-10-25T00:30:00Z', '2026-10-26T01:30:00Z'],
    ['30 2 * * *', '2027-03-27T12:00:00Z', '2027-03-28T01:00:00Z'],
  ];

  it('Europe/Madrid DST produces the documented next fire', () => {
    for (const [expression, after, expected] of MADRID_ROWS) {
      const next = nextFire(parse(expression), 'Europe/Madrid', new Date(after));
      expect(iso(next)).toBe(expected);
    }
    expect(iso(nextFire(parse('0 0 30 2 *'), 'UTC', new Date('2026-10-24T00:00:00Z')))).toBeNull();
  });

  it('is strictly after the argument', () => {
    const cron = parse('0 0 * * *');
    expect(iso(nextFire(cron, 'UTC', new Date('2026-10-25T00:00:00Z')))).toBe(
      '2026-10-26T00:00:00Z',
    );
    expect(iso(nextFire(cron, 'UTC', new Date('2026-10-25T00:00:00.001Z')))).toBe(
      '2026-10-26T00:00:00Z',
    );
  });

  it('combines day of month and day of week with OR when both are restricted', () => {
    const both = parse('0 0 1 * 1');
    expect(iso(nextFire(both, 'UTC', new Date('2026-10-02T00:00:00Z')))).toBe(
      '2026-10-05T00:00:00Z',
    );
    expect(iso(nextFire(both, 'UTC', new Date('2026-10-30T00:00:00Z')))).toBe(
      '2026-11-01T00:00:00Z',
    );
    const dayOnly = parse('0 0 1 * *');
    expect(iso(nextFire(dayOnly, 'UTC', new Date('2026-10-02T00:00:00Z')))).toBe(
      '2026-11-01T00:00:00Z',
    );
    const weekDayOnly = parse('0 12 * * 7');
    expect(iso(nextFire(weekDayOnly, 'UTC', new Date('2026-10-24T00:00:00Z')))).toBe(
      '2026-10-25T12:00:00Z',
    );
  });

  it('honours the month field and reaches a leap day inside the horizon', () => {
    expect(iso(nextFire(parse('0 0 1 1 *'), 'UTC', new Date('2026-10-24T00:00:00Z')))).toBe(
      '2027-01-01T00:00:00Z',
    );
    expect(iso(nextFire(parse('0 0 29 2 *'), 'UTC', new Date('2026-10-24T00:00:00Z')))).toBe(
      '2028-02-29T00:00:00Z',
    );
  });

  it('steps local days and expands minutes instead of scanning every minute', () => {
    expect(iso(nextFire(parse('*/15 * * * *'), 'UTC', new Date('2026-10-24T12:07:00Z')))).toBe(
      '2026-10-24T12:15:00Z',
    );
    expect(iso(nextFire(parse('* * * * *'), 'UTC', new Date('2026-10-24T12:07:30Z')))).toBe(
      '2026-10-24T12:08:00Z',
    );
  });

  it('lists several fires in order and stops at an impossible date', () => {
    const fires = nextFires(parse('0 0 * * *'), 'UTC', new Date('2026-10-24T12:00:00Z'), 3);
    expect(fires.map(iso)).toEqual([
      '2026-10-25T00:00:00Z',
      '2026-10-26T00:00:00Z',
      '2026-10-27T00:00:00Z',
    ]);
    expect(nextFires(parse('0 0 * * *'), 'UTC', new Date('2026-10-24T12:00:00Z'), 0)).toEqual([]);
    expect(nextFires(parse('0 0 30 2 *'), 'UTC', new Date('2026-10-24T00:00:00Z'), 5)).toEqual([]);
  });

  it('returns null instead of scanning minutes for five years', () => {
    expect(
      nextFire(parse('0 0 31 2 *'), 'Europe/Madrid', new Date('2026-10-24T00:00:00Z')),
    ).toBeNull();
    expect(nextFire(parse('0 0 30 2 *'), 'UTC', new Date('2026-01-01T00:00:00Z'))).toBeNull();
  });
});

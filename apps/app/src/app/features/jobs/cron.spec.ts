import { describe, expect, it } from 'vitest';
import { CRON_FIELDS, summarise, toExpression, validateCron } from './cron';
import type { CronParts } from './cron';

const PARTS: CronParts = {
  minute: '0',
  hour: '3',
  dayOfMonth: '*',
  month: '*',
  dayOfWeek: '*',
};

const SUMMARY_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ['0 3 * * *', 'Every day at 03:00', 'Cada día a las 03:00'],
  ['*/15 * * * *', 'Every 15 minutes', 'Cada 15 minutos'],
  ['30 */6 * * *', 'Every 6 hours at minute 30', 'Cada 6 horas en el minuto 30'],
  ['0 8 * * 1', 'Every Monday at 08:00', 'Cada lunes a las 08:00'],
  ['15 4 * * 1-5', 'Every weekday at 04:15', 'Cada día laborable a las 04:15'],
  ['7 7 7 7 7', '7 7 7 7 7', '7 7 7 7 7'],
];

describe('cron', () => {
  it('exposes the five standard fields in order', () => {
    expect(CRON_FIELDS).toEqual(['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek']);
  });

  it('joins the parts with single spaces', () => {
    expect(toExpression(PARTS)).toBe('0 3 * * *');
    expect(
      toExpression({
        minute: ' 15 ',
        hour: '4',
        dayOfMonth: '*',
        month: '*',
        dayOfWeek: '1-5',
      }),
    ).toBe('15 4 * * 1-5');
  });

  it('rejects an expression with the wrong number of fields', () => {
    expect(validateCron('0 3 * *')).toEqual({ ok: false, problems: ['field_count'] });
    expect(validateCron('')).toEqual({ ok: false, problems: ['field_count'] });
    expect(validateCron('0 3 * * * *')).toEqual({ ok: false, problems: ['field_count'] });
  });

  it('rejects a value outside its field range', () => {
    expect(validateCron('61 3 * * *')).toEqual({ ok: false, problems: ['range'] });
    expect(validateCron('0 3 * * 8')).toEqual({ ok: false, problems: ['range'] });
    expect(validateCron('0 24 * * *')).toEqual({ ok: false, problems: ['range'] });
    expect(validateCron('0 3 0 * *')).toEqual({ ok: false, problems: ['range'] });
    expect(validateCron('0 3 * 13 *')).toEqual({ ok: false, problems: ['range'] });
  });

  it('rejects an expression with a syntax error', () => {
    expect(validateCron('0 3 * * x')).toEqual({ ok: false, problems: ['syntax'] });
    expect(validateCron('0 3 * * 1-')).toEqual({ ok: false, problems: ['syntax'] });
    expect(validateCron('*/ 3 * * *')).toEqual({ ok: false, problems: ['syntax'] });
  });

  it('de-duplicates problems and keeps their order', () => {
    expect(validateCron('61 99 * * x')).toEqual({ ok: false, problems: ['syntax', 'range'] });
  });

  it('accepts the forms the daemon accepts', () => {
    for (const expression of ['0 0/6 * * *', '0 3 1-5 * 1', '0 3 * * 1,3,5', '*/15 * * * *']) {
      expect(validateCron(expression), expression).toEqual({ ok: true, problems: [] });
    }
  });

  it('summarises the pinned expressions in both locales', () => {
    for (const [expression, en, es] of SUMMARY_ROWS) {
      expect(summarise(expression, 'en'), expression).toBe(en);
      expect(summarise(expression, 'es'), expression).toBe(es);
    }
  });

  it('returns the trimmed expression when it cannot summarise it', () => {
    expect(summarise('  7 7 7 7 7  ', 'en')).toBe('7 7 7 7 7');
    expect(summarise('0 3 * *', 'es')).toBe('0 3 * *');
    expect(summarise('', 'en')).toBe('');
  });
});

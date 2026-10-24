import { describe, expect, it } from 'vitest';
import { isValidTimezone, nextFire, parseCron } from '../../core/src/cron.js';
import { resolveMisfire } from '../../core/src/misfire.js';
import type { SchedulerDeps } from './types.js';
import { validateSchedule } from './validate.js';

const deps: SchedulerDeps = {
  cron: { parse: parseCron, nextFire, isValidTimezone },
  misfire: resolveMisfire,
};

describe('validateSchedule', () => {
  it('accepts a five-field expression in a known zone and returns the next fire', () => {
    expect(
      validateSchedule(
        deps,
        { cron: '0 9 * * 1', timezone: 'Europe/Madrid' },
        '2026-10-24T00:00:00Z',
      ),
    ).toEqual({ ok: true, nextFireAt: '2026-10-26T08:00:00Z' });
  });

  it('copies the parser failure code for the cron field', () => {
    expect(
      validateSchedule(deps, { cron: '60 * * * *', timezone: 'UTC' }, '2026-10-24T00:00:00Z'),
    ).toMatchObject({ ok: false, field: 'cron', code: 'range' });
    expect(
      validateSchedule(deps, { cron: 'x * * * *', timezone: 'UTC' }, '2026-10-24T00:00:00Z'),
    ).toMatchObject({ ok: false, field: 'cron', code: 'syntax' });
    expect(
      validateSchedule(deps, { cron: '@daily', timezone: 'UTC' }, '2026-10-24T00:00:00Z'),
    ).toMatchObject({ ok: false, field: 'cron', code: 'field_count' });
    expect(
      validateSchedule(deps, { cron: '* * * *', timezone: 'UTC' }, '2026-10-24T00:00:00Z'),
    ).toMatchObject({ ok: false, field: 'cron', code: 'field_count' });
    expect(
      validateSchedule(deps, { cron: '*/0 * * * *', timezone: 'UTC' }, '2026-10-24T00:00:00Z'),
    ).toMatchObject({ ok: false, field: 'cron', code: 'step' });
  });

  it('validates the zone after the expression', () => {
    expect(
      validateSchedule(
        deps,
        { cron: '0 9 * * *', timezone: 'Mars/Olympus' },
        '2026-10-24T00:00:00Z',
      ),
    ).toMatchObject({ ok: false, field: 'timezone', code: 'timezone' });
    expect(
      validateSchedule(
        deps,
        { cron: 'x * * * *', timezone: 'Mars/Olympus' },
        '2026-10-24T00:00:00Z',
      ),
    ).toMatchObject({ ok: false, field: 'cron', code: 'syntax' });
  });

  it('reports a valid expression that never fires as no_fire', () => {
    expect(
      validateSchedule(deps, { cron: '0 0 30 2 *', timezone: 'UTC' }, '2026-10-24T00:00:00Z'),
    ).toMatchObject({ ok: false, field: 'cron', code: 'no_fire' });
  });

  it('always carries the next fire on success, in ISO 8601 UTC without milliseconds', () => {
    const result = validateSchedule(
      deps,
      { cron: '*/15 * * * *', timezone: 'UTC' },
      '2026-10-24T12:07:30Z',
    );
    expect(result).toEqual({ ok: true, nextFireAt: '2026-10-24T12:15:00Z' });
  });

  it('returns a message next to the code', () => {
    const result = validateSchedule(
      deps,
      { cron: '0 9 * * *', timezone: 'Mars/Olympus' },
      '2026-10-24T00:00:00Z',
    );
    if (result.ok) throw new Error('expected the zone to be rejected');
    expect(result.message.length).toBeGreaterThan(0);
  });
});

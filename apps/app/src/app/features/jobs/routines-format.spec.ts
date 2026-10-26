import type { ReminderRoutine } from '@codebox/contracts';
import { describe, expect, it } from 'vitest';
import { routineLastFire, routineNextFire, routineSchedule } from './routines-format';

const ROUTINE: ReminderRoutine = {
  id: 'rtn_01JABCDEFGHJKMNPQRSV',
  kind: 'reminder',
  title: 'Stand up',
  cron: '0 7 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  notify: true,
  createdAt: '2026-10-24T18:03:11Z',
  nextFireAt: '2026-10-25T06:00:00Z',
  lastFiredAt: null,
};

describe('routines-format', () => {
  it('summarises the cron and appends the routine timezone', () => {
    expect(routineSchedule(ROUTINE, 'en')).toBe('Every day at 07:00 · Europe/Madrid');
    expect(routineSchedule(ROUTINE, 'es')).toBe('Cada día a las 07:00 · Europe/Madrid');
  });

  it('returns null for a missing next fire', () => {
    expect(routineNextFire({ ...ROUTINE, nextFireAt: null }, 'en')).toBeNull();
  });

  it('formats the next fire in the routine timezone', () => {
    const formatted = routineNextFire(ROUTINE, 'en');

    expect(formatted).not.toBeNull();
    expect(formatted).toContain('7:00');
  });

  it('returns null for a routine that never fired', () => {
    expect(routineLastFire(ROUTINE, 'es')).toBeNull();
  });

  it('formats the last fire in the routine timezone', () => {
    const formatted = routineLastFire({ ...ROUTINE, lastFiredAt: '2026-10-24T05:00:00Z' }, 'en');

    expect(formatted).not.toBeNull();
    expect(formatted).toContain('7:00');
  });
});

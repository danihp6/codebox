import { describe, expect, it } from 'vitest';
import { inQuietHours } from './quiet-hours.js';

const MADRID = 'Europe/Madrid';

function quietAt(iso: string, quietHours: string | null, timeZone = MADRID): boolean {
  return inQuietHours({ now: new Date(iso), quietHours, timeZone });
}

describe('quiet hours', () => {
  it('is never quiet without a window', () => {
    expect(quietAt('2026-11-10T21:30:00.000Z', null)).toBe(false);
  });

  it('holds a wrapping window between its start and midnight', () => {
    expect(quietAt('2026-11-10T21:30:00.000Z', '22:00-08:00')).toBe(true);
    expect(quietAt('2026-11-10T20:30:00.000Z', '22:00-08:00')).toBe(false);
  });

  it('holds a wrapping window after midnight and releases it at the end', () => {
    expect(quietAt('2026-01-15T06:00:00.000Z', '22:00-08:00')).toBe(true);
    expect(quietAt('2026-01-15T07:00:00.000Z', '22:00-08:00')).toBe(false);
  });

  it('treats a same-day window as half-open', () => {
    expect(quietAt('2026-06-01T06:59:00.000Z', '09:00-17:00')).toBe(false);
    expect(quietAt('2026-06-01T07:00:00.000Z', '09:00-17:00')).toBe(true);
    expect(quietAt('2026-06-01T14:59:00.000Z', '09:00-17:00')).toBe(true);
    expect(quietAt('2026-06-01T15:00:00.000Z', '09:00-17:00')).toBe(false);
  });

  it('treats an empty window as no window at all', () => {
    expect(quietAt('2026-11-10T21:30:00.000Z', '08:00-08:00')).toBe(false);
  });

  it('reads the wall clock in the configured zone', () => {
    expect(quietAt('2026-11-10T21:30:00.000Z', '22:00-08:00', 'UTC')).toBe(false);
    expect(quietAt('2026-11-10T23:30:00.000Z', '22:00-08:00', 'UTC')).toBe(true);
  });

  it('never throws on unusable input and stays out of quiet hours', () => {
    expect(quietAt('2026-11-10T21:30:00.000Z', '22:00-08:00', 'Mars/Olympus')).toBe(false);
    expect(quietAt('2026-11-10T21:30:00.000Z', '8:00-9:00')).toBe(false);
    expect(quietAt('2026-11-10T21:30:00.000Z', '22:00-25:00')).toBe(false);
    expect(quietAt('not-a-date', '22:00-08:00')).toBe(false);
  });
});

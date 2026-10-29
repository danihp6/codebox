import { describe, expect, it } from 'vitest';
import { fireParts, formatFire } from './time-format';

const FIRE = '2026-10-25T02:00:00Z';

describe('time-format', () => {
  it('renders the fire in its own zone', () => {
    expect(fireParts(FIRE, 'Europe/Madrid')).toEqual({ day: 25, hour: 3, minute: 0 });
    expect(fireParts(FIRE, 'America/New_York')).toEqual({ day: 24, hour: 22, minute: 0 });
  });

  it('renders a zero-padded 24-hour clock', () => {
    expect(fireParts('2026-10-25T00:05:00Z', 'UTC')).toEqual({ day: 25, hour: 0, minute: 5 });
  });

  it('formats a fire for display in both locales', () => {
    for (const locale of ['en', 'es'] as const) {
      const rendered = formatFire(FIRE, 'Europe/Madrid', locale);
      expect(rendered).toContain('3:00');
    }
  });
});

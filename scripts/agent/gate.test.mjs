import { describe, expect, it } from 'vitest';
import { decideGate } from './gate.mjs';

const base = {
  brake: 'on',
  windowFrom: null,
  windowUntil: null,
  now: 1_800_000_000,
  openTasks: 3,
  cyclesToday: 0,
  redToday: 0,
  cap: 0,
};

describe('decideGate', () => {
  it('starts a cycle when the brake is on and work remains', () => {
    expect(decideGate(base)).toMatchObject({ go: true, alert: null });
  });

  it('parks on anything that is not `on`, and says what it read', () => {
    for (const brake of ['off', 'ON', '', 'on.old', undefined]) {
      const decision = decideGate({ ...base, brake });
      expect(decision.go).toBe(false);
      expect(decision.reason).toContain('brake');
    }
  });

  it('tolerates the newline `brake.sh` writes', () => {
    expect(decideGate({ ...base, brake: 'on\n' }).go).toBe(true);
  });

  it('parks before a window opens and after it closes', () => {
    const from = base.now + 600;
    const until = base.now + 3600;
    expect(decideGate({ ...base, windowFrom: from, windowUntil: until })).toMatchObject({
      go: false,
    });
    expect(
      decideGate({ ...base, now: until, windowFrom: base.now - 3600, windowUntil: until }).go,
    ).toBe(false);
    expect(
      decideGate({ ...base, now: from + 1, windowFrom: from, windowUntil: until }).go,
    ).toBe(true);
  });

  it('parks with an alert when the backlog is empty', () => {
    const decision = decideGate({ ...base, openTasks: 0 });
    expect(decision.go).toBe(false);
    expect(decision.alert?.label).toBe('agent-blocked');
    expect(decision.alert?.title).toContain('nothing left');
  });

  it('parks after three red cycles, and the alert carries the limit', () => {
    expect(decideGate({ ...base, redToday: 2 }).go).toBe(true);
    const decision = decideGate({ ...base, redToday: 3 });
    expect(decision.go).toBe(false);
    expect(decision.alert?.title).toContain('3 red cycles');
    expect(decideGate({ ...base, redToday: 9 }).reason).toContain('limit 3');
  });

  it('caps the day only when a cap is set', () => {
    expect(decideGate({ ...base, cyclesToday: 99, cap: 0 }).go).toBe(true);
    expect(decideGate({ ...base, cyclesToday: 4, cap: 5 }).go).toBe(true);
    expect(decideGate({ ...base, cyclesToday: 5, cap: 5 }).go).toBe(false);
  });

  it('reads the brake before the window, so a manual off parks inside a range', () => {
    const decision = decideGate({
      ...base,
      brake: 'off',
      windowFrom: base.now - 60,
      windowUntil: base.now + 60,
    });
    expect(decision.go).toBe(false);
    expect(decision.reason).toContain('brake');
  });
});

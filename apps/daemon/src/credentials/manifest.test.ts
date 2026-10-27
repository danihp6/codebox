import { describe, expect, it } from 'vitest';
import { MANIFEST_STATE_TTL_SECONDS, createManifestStateStore } from './manifest.js';

function clock(start: string): { now: () => Date; advance(seconds: number): void } {
  let at = new Date(start);
  return {
    now: () => at,
    advance(seconds: number): void {
      at = new Date(at.getTime() + seconds * 1000);
    },
  };
}

describe('manifest state store', () => {
  it('issues an unguessable state and consumes it exactly once', () => {
    const time = clock('2026-10-27T10:00:00.000Z');
    const store = createManifestStateStore({ now: time.now });
    const state = store.issue();
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(state).not.toBe(store.issue());
    expect(store.consume(state)).toBe(true);
    expect(store.consume(state)).toBe(false);
  });

  it('refuses an unknown state', () => {
    const store = createManifestStateStore({ now: clock('2026-10-27T10:00:00.000Z').now });
    expect(store.consume('not-a-state')).toBe(false);
  });

  it('expires after the TTL and never revives', () => {
    const time = clock('2026-10-27T10:00:00.000Z');
    const store = createManifestStateStore({ now: time.now, ttlSeconds: 600 });
    const state = store.issue();
    time.advance(MANIFEST_STATE_TTL_SECONDS - 1);
    expect(store.consume(state)).toBe(true);

    const expired = store.issue();
    time.advance(MANIFEST_STATE_TTL_SECONDS);
    expect(store.consume(expired)).toBe(false);
  });
});

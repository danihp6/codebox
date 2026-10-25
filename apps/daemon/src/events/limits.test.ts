import { describe, expect, it } from 'vitest';
import { SSE_CONNECTIONS_PER_DEVICE, createConnectionLimiter } from './limits.js';

describe('SSE connection limiter', () => {
  it('enforces the per-device connection limit of three', () => {
    expect(SSE_CONNECTIONS_PER_DEVICE).toBe(3);
    const limiter = createConnectionLimiter();
    const releases = [
      limiter.open('dev_a'),
      limiter.open('dev_a'),
      limiter.open('dev_a'),
      limiter.open('dev_a'),
    ];
    expect(limiter.count('dev_a')).toBe(3);
    expect(limiter.count('dev_b')).toBe(0);

    releases[3]?.();
    expect(limiter.count('dev_a')).toBe(3);
  });

  it('frees a slot when a stream closes and ignores a double release', () => {
    const limiter = createConnectionLimiter();
    const release = limiter.open('dev_a');
    limiter.open('dev_a');
    limiter.open('dev_a');
    expect(limiter.count('dev_a')).toBe(3);

    release();
    expect(limiter.count('dev_a')).toBe(2);
    release();
    expect(limiter.count('dev_a')).toBe(2);

    expect(limiter.open('dev_a')).toBeTypeOf('function');
    expect(limiter.count('dev_a')).toBe(3);
  });

  it('counts devices apart and honours a custom limit', () => {
    const limiter = createConnectionLimiter(1);
    limiter.open('dev_a');
    limiter.open('dev_a');
    expect(limiter.count('dev_a')).toBe(1);
    expect(limiter.count('dev_b')).toBe(0);
    limiter.open('dev_b');
    expect(limiter.count('dev_b')).toBe(1);
  });
});

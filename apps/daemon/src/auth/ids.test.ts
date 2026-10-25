import { describe, expect, it } from 'vitest';
import { DeviceId } from '@codebox/contracts';
import { DEVICE_ID_RANDOM_CHARS, newDeviceId } from './ids.js';

describe('newDeviceId', () => {
  it('builds a DeviceId that validates against the contract', () => {
    for (let index = 0; index < 100; index += 1) {
      const id = newDeviceId();
      expect(id).toMatch(/^dev_[0-9A-HJKMNP-TV-Z]{20}$/);
      expect(DeviceId.safeParse(id).success).toBe(true);
    }
  });

  it('never repeats itself', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newDeviceId()));
    expect(ids.size).toBe(100);
  });

  it('takes its bytes from the injected source', () => {
    expect(newDeviceId(() => Buffer.alloc(DEVICE_ID_RANDOM_CHARS, 0))).toBe(
      'dev_00000000000000000000',
    );
    expect(newDeviceId(() => Buffer.alloc(DEVICE_ID_RANDOM_CHARS, 31))).toBe(
      'dev_ZZZZZZZZZZZZZZZZZZZZ',
    );
  });

  it('refuses a short random source', () => {
    expect(() => newDeviceId(() => Buffer.alloc(2))).toThrow(RangeError);
  });
});

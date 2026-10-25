import { describe, expect, it } from 'vitest';
import { SubscriptionId } from '@codebox/contracts';
import { SUBSCRIPTION_ID_RANDOM_CHARS, newSubscriptionId } from './ids.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function pinnedBytes(): Buffer {
  return Buffer.from(Array.from({ length: SUBSCRIPTION_ID_RANDOM_CHARS }, (_, index) => index * 7));
}

function expectedSuffix(): string {
  let suffix = '';
  for (const byte of pinnedBytes()) suffix += CROCKFORD.charAt(byte & 31);
  return suffix;
}

describe('push subscription ids', () => {
  it('mints the `sub_` shape the contract accepts', () => {
    const id = newSubscriptionId();
    expect(id).toHaveLength(SUBSCRIPTION_ID_RANDOM_CHARS + 'sub_'.length);
    expect(id.startsWith('sub_')).toBe(true);
    expect(SubscriptionId.safeParse(id).success).toBe(true);
  });

  it('pins the bytes it is given', () => {
    expect(newSubscriptionId(() => pinnedBytes())).toBe(`sub_${expectedSuffix()}`);
  });

  it('is unique across calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSubscriptionId()));
    expect(ids.size).toBe(50);
  });

  it('rejects a random source that returns too few bytes', () => {
    expect(() => newSubscriptionId(() => Buffer.alloc(4))).toThrow(RangeError);
  });
});

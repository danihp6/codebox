import { randomBytes } from 'node:crypto';
import { ID_PREFIXES } from '@codebox/contracts';
import type { SubscriptionId } from '@codebox/contracts';

export const SUBSCRIPTION_ID_RANDOM_CHARS = 20;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `sub_` plus 20 Crockford base32 characters, the shape `SubscriptionId` accepts. */
export function newSubscriptionId(random: (size: number) => Buffer = randomBytes): SubscriptionId {
  const bytes = random(SUBSCRIPTION_ID_RANDOM_CHARS);
  if (bytes.length < SUBSCRIPTION_ID_RANDOM_CHARS) {
    throw new RangeError('the random source returned fewer than 20 bytes');
  }
  let suffix = '';
  for (let index = 0; index < SUBSCRIPTION_ID_RANDOM_CHARS; index += 1) {
    suffix += CROCKFORD.charAt((bytes[index] ?? 0) & 31);
  }
  return `${ID_PREFIXES.pushSubscription}${suffix}`;
}

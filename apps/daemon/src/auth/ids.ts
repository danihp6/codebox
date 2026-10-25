import { randomBytes } from 'node:crypto';
import { ID_PREFIXES } from '@codebox/contracts';

export const DEVICE_ID_RANDOM_CHARS = 20;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * The only place the device id format lives: `dev_` plus 20 Crockford base32 characters, the
 * shape `DeviceId` accepts. `random` is injectable so a test can pin the bytes.
 */
export function newDeviceId(random: (size: number) => Buffer = randomBytes): string {
  const bytes = random(DEVICE_ID_RANDOM_CHARS);
  if (bytes.length < DEVICE_ID_RANDOM_CHARS) {
    throw new RangeError('the random source returned fewer than 20 bytes');
  }
  let suffix = '';
  for (let index = 0; index < DEVICE_ID_RANDOM_CHARS; index += 1) {
    suffix += CROCKFORD.charAt((bytes[index] ?? 0) & 31);
  }
  return `${ID_PREFIXES.device}${suffix}`;
}

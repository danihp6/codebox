import { randomBytes } from 'node:crypto';
import { ID_PREFIXES } from '@codebox/contracts';

export const ROUTINE_ID_RANDOM_BYTES = 20;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `rtn_` + 20 Crockford base32 chars, the shape `RoutineId` accepts. */
export function newRoutineId(random: (size: number) => Buffer = randomBytes): string {
  const bytes = random(ROUTINE_ID_RANDOM_BYTES);
  if (bytes.length < ROUTINE_ID_RANDOM_BYTES) {
    throw new RangeError('the random source returned fewer than 20 bytes');
  }
  let suffix = '';
  for (let index = 0; index < ROUTINE_ID_RANDOM_BYTES; index += 1) {
    suffix += CROCKFORD.charAt((bytes[index] ?? 0) & 31);
  }
  return `${ID_PREFIXES.routine}${suffix}`;
}

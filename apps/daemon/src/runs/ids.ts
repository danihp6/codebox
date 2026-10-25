import { randomBytes } from 'node:crypto';
import { ID_PREFIXES } from '@codebox/contracts';

export const ID_RANDOM_CHARS = 20;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * `run_` and `job_` plus 20 Crockford base32 characters, the shape `RunId` and `JobId` accept.
 * `random` is injectable so a test can pin the bytes.
 */
function mintId(prefix: string, random: (size: number) => Buffer): string {
  const bytes = random(ID_RANDOM_CHARS);
  if (bytes.length < ID_RANDOM_CHARS) {
    throw new RangeError('the random source returned fewer than 20 bytes');
  }
  let suffix = '';
  for (let index = 0; index < ID_RANDOM_CHARS; index += 1) {
    suffix += CROCKFORD.charAt((bytes[index] ?? 0) & 31);
  }
  return `${prefix}${suffix}`;
}

export function newRunId(random: (size: number) => Buffer = randomBytes): string {
  return mintId(ID_PREFIXES.run, random);
}

export function newJobId(random: (size: number) => Buffer = randomBytes): string {
  return mintId(ID_PREFIXES.job, random);
}

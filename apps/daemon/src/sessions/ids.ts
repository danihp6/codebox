import { randomBytes } from 'node:crypto';
import { ID_PREFIXES } from '@codebox/contracts';

export const SESSION_ID_RANDOM_CHARS = 20;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function mintId(prefix: string, random: (size: number) => Buffer): string {
  const bytes = random(SESSION_ID_RANDOM_CHARS);
  if (bytes.length < SESSION_ID_RANDOM_CHARS) {
    throw new RangeError('the random source returned fewer than 20 bytes');
  }
  let suffix = '';
  for (let index = 0; index < SESSION_ID_RANDOM_CHARS; index += 1) {
    suffix += CROCKFORD.charAt((bytes[index] ?? 0) & 31);
  }
  return `${prefix}${suffix}`;
}

/** `sess_` and `msg_` plus 20 Crockford base32 characters, the shapes the contract accepts. */
export function newSessionId(random: (size: number) => Buffer = randomBytes): string {
  return mintId(ID_PREFIXES.session, random);
}

export function newSessionMessageId(random: (size: number) => Buffer = randomBytes): string {
  return mintId(ID_PREFIXES.message, random);
}

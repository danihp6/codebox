import { randomBytes } from 'node:crypto';

export const CREDENTIAL_ID_RANDOM_CHARS = 10;
export const INTEGRATION_ID_RANDOM_CHARS = 10;

// `ID_PREFIXES` in `@codebox/contracts` is owned by another task in this batch, so the two
// prefixes live here until the contract promotes them; no other module may spell them.
const CREDENTIAL_PREFIX = 'cred_';
const INTEGRATION_PREFIX = 'int_';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function suffix(random: (size: number) => Buffer, chars: number): string {
  const bytes = random(chars);
  if (bytes.length < chars)
    throw new RangeError(`the random source returned fewer than ${chars} bytes`);
  let text = '';
  for (let index = 0; index < chars; index += 1) {
    text += CROCKFORD.charAt((bytes[index] ?? 0) & 31);
  }
  return text;
}

export function newCredentialId(random: (size: number) => Buffer = randomBytes): string {
  return `${CREDENTIAL_PREFIX}${suffix(random, CREDENTIAL_ID_RANDOM_CHARS)}`;
}

export function newIntegrationId(random: (size: number) => Buffer = randomBytes): string {
  return `${INTEGRATION_PREFIX}${suffix(random, INTEGRATION_ID_RANDOM_CHARS)}`;
}

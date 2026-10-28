import { randomBytes } from 'node:crypto';
import { ID_PREFIXES } from '@codebox/contracts';

export const PROVIDER_ACCOUNT_ID_CHARS = 10;
export const OAUTH_STATE_BYTES = 24;
export const OAUTH_STATE_CHARS = 32;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function crockfordSuffix(random: (size: number) => Buffer, chars: number): string {
  const bytes = random(chars);
  if (bytes.length < chars) {
    throw new RangeError(`the random source returned fewer than ${chars} bytes`);
  }
  let suffix = '';
  for (let index = 0; index < chars; index += 1) {
    suffix += CROCKFORD.charAt((bytes[index] ?? 0) & 31);
  }
  return suffix;
}

/** `acct_` + 10 Crockford characters, the `ProviderAccountId` grammar. */
export function newProviderAccountId(random: (size: number) => Buffer = randomBytes): string {
  return `${ID_PREFIXES.providerAccount}${crockfordSuffix(random, PROVIDER_ACCOUNT_ID_CHARS)}`;
}

/** 32 URL-safe characters from `randomBytes(24)`. */
export function newOauthState(random: (size: number) => Buffer = randomBytes): string {
  const bytes = random(OAUTH_STATE_BYTES);
  if (bytes.length < OAUTH_STATE_BYTES) {
    throw new RangeError(`the random source returned fewer than ${OAUTH_STATE_BYTES} bytes`);
  }
  return Buffer.from(bytes.subarray(0, OAUTH_STATE_BYTES)).toString('base64url');
}

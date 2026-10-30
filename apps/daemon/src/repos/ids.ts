import { randomBytes } from 'node:crypto';
import { ID_PREFIXES } from '@codebox/contracts';

export const REPO_ID_RANDOM_CHARS = 20;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `repo_` plus 20 Crockford base32 characters, the shape `RepoId` accepts. */
export function newRepoId(random: (size: number) => Buffer = randomBytes): string {
  const bytes = random(REPO_ID_RANDOM_CHARS);
  if (bytes.length < REPO_ID_RANDOM_CHARS) {
    throw new RangeError('the random source returned fewer than 20 bytes');
  }
  let suffix = '';
  for (let index = 0; index < REPO_ID_RANDOM_CHARS; index += 1) {
    suffix += CROCKFORD.charAt((bytes[index] ?? 0) & 31);
  }
  return `${ID_PREFIXES.repo}${suffix}`;
}

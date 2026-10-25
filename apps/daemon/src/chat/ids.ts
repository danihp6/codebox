import { randomBytes } from 'node:crypto';
import { ID_PREFIXES } from '@codebox/contracts';
import type { ChatId, MessageId } from '@codebox/contracts';

export const CHAT_ID_RANDOM_CHARS = 20;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function crockfordSuffix(random: (size: number) => Buffer): string {
  const bytes = random(CHAT_ID_RANDOM_CHARS);
  if (bytes.length < CHAT_ID_RANDOM_CHARS) {
    throw new RangeError('the random source returned fewer than 20 bytes');
  }
  let suffix = '';
  for (let index = 0; index < CHAT_ID_RANDOM_CHARS; index += 1) {
    suffix += CROCKFORD.charAt((bytes[index] ?? 0) & 31);
  }
  return suffix;
}

/**
 * The only place the chat id formats live: `chat_` and `msg_` plus 20 Crockford base32
 * characters, the shapes `ChatId` and `MessageId` accept. `random` is injectable so a test can
 * pin the bytes.
 */
export function newChatId(random: (size: number) => Buffer = randomBytes): ChatId {
  return `${ID_PREFIXES.chat}${crockfordSuffix(random)}`;
}

export function newMessageId(random: (size: number) => Buffer = randomBytes): MessageId {
  return `${ID_PREFIXES.message}${crockfordSuffix(random)}`;
}

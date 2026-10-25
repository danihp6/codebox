import { describe, expect, it } from 'vitest';
import { ChatId, MessageId } from '@codebox/contracts';
import { CHAT_ID_RANDOM_CHARS, newChatId, newMessageId } from './ids.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function pinnedBytes(): Buffer {
  return Buffer.from(Array.from({ length: CHAT_ID_RANDOM_CHARS }, (_, index) => index * 7));
}

function expectedSuffix(): string {
  let suffix = '';
  for (const byte of pinnedBytes()) suffix += CROCKFORD.charAt(byte & 31);
  return suffix;
}

describe('chat id generators', () => {
  it('mints the chat shape the contract accepts', () => {
    const id = newChatId();
    expect(id).toHaveLength(CHAT_ID_RANDOM_CHARS + 'chat_'.length);
    expect(id.startsWith('chat_')).toBe(true);
    expect(ChatId.safeParse(id).success).toBe(true);
  });

  it('mints the message shape the contract accepts', () => {
    const id = newMessageId();
    expect(id).toHaveLength(CHAT_ID_RANDOM_CHARS + 'msg_'.length);
    expect(id.startsWith('msg_')).toBe(true);
    expect(MessageId.safeParse(id).success).toBe(true);
  });

  it('pins the bytes it is given', () => {
    const random = (): Buffer => pinnedBytes();
    expect(newChatId(random)).toBe(`chat_${expectedSuffix()}`);
    expect(newMessageId(random)).toBe(`msg_${expectedSuffix()}`);
  });

  it('is unique across calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newChatId()));
    expect(ids.size).toBe(50);
  });

  it('rejects a random source that returns too few bytes', () => {
    expect(() => newChatId(() => Buffer.alloc(4))).toThrow(RangeError);
    expect(() => newMessageId(() => Buffer.alloc(0))).toThrow(RangeError);
  });
});

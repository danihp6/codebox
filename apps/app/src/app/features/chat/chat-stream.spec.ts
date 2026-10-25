import type { ChatMessage, Page, SseStreamEvent } from '@codebox/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_CHAT,
  appendMessage,
  applyChatEvent,
  markPermissionAnswered,
  mergeMessages,
} from './chat-stream';

const CHAT = 'chat_01JABCDEFGHJKMNPQRSV';
const OTHER = 'chat_01JABCDEFGHJKMNPQRSW';
const TS = '2026-10-24T18:04:02Z';
const APPROVAL = 'apv_01JABCDEFGHJKMNPQRSV';
const OTHER_APPROVAL = 'apv_01JABCDEFGHJKMNPQRSW';

function delta(seq: number, text: string, chatId: string = CHAT): SseStreamEvent {
  return { event: 'chat.delta', data: { chatId, seq, delta: text, ts: TS } };
}

function message(
  id: string,
  role: ChatMessage['role'],
  text: string,
  createdAt: string,
  chatId: string = CHAT,
): ChatMessage {
  return { id, chatId, role, text, createdAt };
}

function messageEvent(chatMessage: ChatMessage, seq: number): SseStreamEvent {
  return {
    event: 'chat.message',
    data: { chatId: chatMessage.chatId, seq, message: chatMessage, ts: TS },
  };
}

function permission(approvalId: string, seq: number): SseStreamEvent {
  return {
    event: 'chat.permission',
    data: { chatId: CHAT, seq, approvalId, tool: 'bash', title: 'Run ls', ts: TS },
  };
}

function resolved(approvalId: string): SseStreamEvent {
  return { event: 'approval.resolved', data: { approvalId, decision: 'allow', ts: TS } };
}

function page(...messages: readonly ChatMessage[]): Page<ChatMessage> {
  return { data: [...messages], nextCursor: null };
}

describe('applyChatEvent', () => {
  it('appends three deltas in order into one open buffer', () => {
    let state = applyChatEvent(EMPTY_CHAT, CHAT, delta(1, 'a'));
    state = applyChatEvent(state, CHAT, delta(2, 'b'));
    state = applyChatEvent(state, CHAT, delta(3, 'c'));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      key: `stream:${CHAT}`,
      role: 'assistant',
      text: 'abc',
      messageId: null,
      createdAt: null,
    });
    expect(state.working).toBe(true);
    expect(state.lastSeq).toBe(3);
  });

  it('ignores a replayed delta at or below lastSeq', () => {
    let state = applyChatEvent(EMPTY_CHAT, CHAT, delta(1, 'a'));
    state = applyChatEvent(state, CHAT, delta(2, 'b'));

    expect(applyChatEvent(state, CHAT, delta(2, 'b'))).toBe(state);
    expect(applyChatEvent(state, CHAT, delta(1, 'a'))).toBe(state);
  });

  it('ignores a delta for another chat', () => {
    const state = applyChatEvent(EMPTY_CHAT, CHAT, delta(1, 'a'));
    expect(applyChatEvent(state, CHAT, delta(2, 'b', OTHER))).toBe(state);
  });

  it('replaces the open buffer with the persisted assistant message', () => {
    let state = applyChatEvent(EMPTY_CHAT, CHAT, delta(1, 'hel'));
    state = applyChatEvent(state, CHAT, delta(2, 'lo'));

    const persisted = message('msg_01JABCDEFGHJKMNPQRSV', 'assistant', 'hello', TS);
    state = applyChatEvent(state, CHAT, messageEvent(persisted, 3));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      key: `msg:${persisted.id}`,
      role: 'assistant',
      text: 'hello',
      messageId: persisted.id,
      createdAt: TS,
    });
    expect(state.messages.some((item) => item.key.startsWith('stream:'))).toBe(false);
    expect(state.lastSeq).toBe(3);
  });

  it('inserts a user message without touching the buffer', () => {
    let state = applyChatEvent(EMPTY_CHAT, CHAT, delta(1, 'thinking'));
    const user = message('msg_01JABCDEFGHJKMNPQRSW', 'user', 'hi', TS);
    state = applyChatEvent(state, CHAT, messageEvent(user, 2));

    expect(state.messages.map((item) => item.key)).toEqual([`stream:${CHAT}`, `msg:${user.id}`]);
  });

  it('upserts a tool card by seq', () => {
    const start: SseStreamEvent = {
      event: 'chat.tool',
      data: { chatId: CHAT, seq: 4, tool: 'bash', status: 'start', ts: TS },
    };
    const done: SseStreamEvent = {
      event: 'chat.tool',
      data: { chatId: CHAT, seq: 4, tool: 'bash', status: 'ok', detail: 'exit 0', ts: TS },
    };

    let state = applyChatEvent(EMPTY_CHAT, CHAT, start);
    state = applyChatEvent(state, CHAT, done);

    expect(state.tools).toHaveLength(1);
    expect(state.tools[0]).toEqual({
      key: 'tool:4',
      tool: 'bash',
      status: 'ok',
      detail: 'exit 0',
      seq: 4,
    });
  });

  it('keeps one permission card per approval', () => {
    let state = applyChatEvent(EMPTY_CHAT, CHAT, permission(APPROVAL, 5));
    state = applyChatEvent(state, CHAT, permission(APPROVAL, 6));

    expect(state.permissions).toHaveLength(1);
    expect(state.permissions[0]).toMatchObject({
      key: `permission:${APPROVAL}`,
      approvalId: APPROVAL,
      tool: 'bash',
      title: 'Run ls',
      answered: false,
    });
  });

  it('marks only the matching permission card when the approval resolves', () => {
    let state = applyChatEvent(EMPTY_CHAT, CHAT, permission(APPROVAL, 5));
    state = applyChatEvent(state, CHAT, permission(OTHER_APPROVAL, 6));

    state = applyChatEvent(state, CHAT, resolved(APPROVAL));

    expect(state.permissions.map((card) => [card.approvalId, card.answered])).toEqual([
      [APPROVAL, true],
      [OTHER_APPROVAL, false],
    ]);
  });

  it('returns the identical state for a gap frame', () => {
    const state = applyChatEvent(EMPTY_CHAT, CHAT, delta(1, 'a'));
    const gap: SseStreamEvent = { event: 'gap', data: { afterId: 1, latestId: 9, ts: TS } };
    expect(applyChatEvent(state, CHAT, gap)).toBe(state);
  });

  it('clears working on chat.idle', () => {
    let state = applyChatEvent(EMPTY_CHAT, CHAT, delta(1, 'a'));
    expect(state.working).toBe(true);

    state = applyChatEvent(state, CHAT, {
      event: 'chat.idle',
      data: { chatId: CHAT, seq: 2, ts: TS },
    });

    expect(state.working).toBe(false);
    expect(state.lastSeq).toBe(2);
  });

  it('leaves unrelated event types alone', () => {
    const state = applyChatEvent(EMPTY_CHAT, CHAT, delta(1, 'a'));
    const telemetry: SseStreamEvent = {
      event: 'telemetry',
      data: {
        ts: TS,
        health: {
          status: 'ok',
          db: 'ok',
          opencode: 'ok',
          disk: { freeBytes: 1, totalBytes: 2, usedPercent: 50 },
          queue: { pending: 0, running: 0, maxConcurrency: 1 },
          version: '1.0.0',
        },
        spendTodayUsd: 0,
        queueDepth: 0,
      },
    };
    expect(applyChatEvent(state, CHAT, telemetry)).toBe(state);
  });
});

describe('mergeMessages', () => {
  it('keeps the length constant when the same page is merged twice', () => {
    const first = message('msg_01JABCDEFGHJKMNPQRSV', 'user', 'hi', '2026-10-24T18:00:00Z');
    const second = message(
      'msg_01JABCDEFGHJKMNPQRSW',
      'assistant',
      'hello',
      '2026-10-24T18:00:01Z',
    );

    const once = mergeMessages(EMPTY_CHAT, page(first, second));
    const twice = mergeMessages(once, page(first, second));

    expect(once.messages).toHaveLength(2);
    expect(twice.messages).toHaveLength(2);
    expect(twice).toBe(once);
  });

  it('orders by createdAt and breaks ties by id', () => {
    const late = message('msg_01JABCDEFGHJKMNPQRSV', 'user', 'later', '2026-10-24T18:00:09Z');
    const earlyB = message('msg_01JABCDEFGHJKMNPQRSX', 'assistant', 'b', '2026-10-24T18:00:01Z');
    const earlyA = message('msg_01JABCDEFGHJKMNPQRSW', 'user', 'a', '2026-10-24T18:00:01Z');

    const state = mergeMessages(EMPTY_CHAT, page(late, earlyB, earlyA));

    expect(state.messages.map((item) => item.text)).toEqual(['a', 'b', 'later']);
  });

  it('appends a single message and never duplicates it', () => {
    const item = message('msg_01JABCDEFGHJKMNPQRSV', 'user', 'hi', TS);
    const once = appendMessage(EMPTY_CHAT, item);
    const twice = appendMessage(once, item);

    expect(once.messages).toHaveLength(1);
    expect(twice.messages).toHaveLength(1);
  });
});

describe('markPermissionAnswered', () => {
  it('flips one card and is idempotent', () => {
    const state = applyChatEvent(EMPTY_CHAT, CHAT, permission(APPROVAL, 5));
    const answered = markPermissionAnswered(state, APPROVAL);

    expect(answered.permissions[0]?.answered).toBe(true);
    expect(markPermissionAnswered(answered, APPROVAL)).toBe(answered);
    expect(markPermissionAnswered(state, OTHER_APPROVAL)).toBe(state);
  });
});

import type {
  ChatMessage,
  Page,
  PromptRoutine,
  ReminderRoutine,
  Run,
  SseStreamEvent,
} from '@codebox/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_CHAT,
  ROUTINE_CREATE_WINDOW_SECONDS,
  appendMessage,
  applyChatEvent,
  isRoutineMessage,
  markPermissionAnswered,
  mergeMessages,
  pickCreatedRoutine,
  systemCardsOf,
  withRoutineCard,
  withRunCards,
} from './chat-stream';
import type { ChatStreamState } from './chat-stream';

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

const ROUTINE_ID = 'rtn_01JABCDEFGHJKMNPQRSV';
const OTHER_ROUTINE_ID = 'rtn_01JABCDEFGHJKMNPQRSW';
const REPO = 'repo_01JABCDEFGHJKMNPQRSV';
const WINDOW_MS = ROUTINE_CREATE_WINDOW_SECONDS * 1000;

function reminder(id: string, createdAt: string): ReminderRoutine {
  return {
    id,
    kind: 'reminder',
    title: 'Stand up',
    cron: '0 7 * * *',
    timezone: 'Europe/Madrid',
    enabled: true,
    notify: true,
    createdAt,
    nextFireAt: null,
    lastFiredAt: null,
  };
}

function prompt(id: string, createdAt: string, chatSessionId: string | null): PromptRoutine {
  return {
    id,
    kind: 'prompt',
    title: 'Morning summary',
    cron: '0 8 * * *',
    timezone: 'Europe/Madrid',
    enabled: true,
    notify: true,
    repoId: REPO,
    prompt: 'Summarise the repository.',
    chatSessionId,
    createdAt,
    nextFireAt: null,
    lastFiredAt: null,
  };
}

function replied(chatId: string, messageId: string): SseStreamEvent {
  return { event: 'routine.replied', data: { routineId: ROUTINE_ID, chatId, messageId, ts: TS } };
}

function at(offsetMs: number): string {
  return new Date(Date.parse(TS) + offsetMs).toISOString();
}

describe('routine.replied', () => {
  it('flags exactly its message id, idempotently and without touching lastSeq', () => {
    const start = applyChatEvent(EMPTY_CHAT, CHAT, delta(3, 'answer'));
    expect(start.lastSeq).toBe(3);

    const once = applyChatEvent(start, CHAT, replied(CHAT, 'message_01JABCDEFGHJKMNPQRSV'));
    expect(once.routineMessageIds).toEqual(['message_01JABCDEFGHJKMNPQRSV']);
    expect(once.lastSeq).toBe(3);
    expect(isRoutineMessage(once, 'message_01JABCDEFGHJKMNPQRSV')).toBe(true);
    expect(isRoutineMessage(once, null)).toBe(false);

    const twice = applyChatEvent(once, CHAT, replied(CHAT, 'message_01JABCDEFGHJKMNPQRSV'));
    expect(twice).toBe(once);
  });

  it('ignores another chat', () => {
    const state = applyChatEvent(EMPTY_CHAT, CHAT, delta(1, 'a'));
    expect(applyChatEvent(state, CHAT, replied(OTHER, 'message_01JABCDEFGHJKMNPQRSV'))).toBe(state);
  });
});

describe('pickCreatedRoutine', () => {
  it('picks the newest prompt routine of this chat inside the window', () => {
    const mine = prompt(ROUTINE_ID, at(-30_000), CHAT);
    const foreign = prompt(OTHER_ROUTINE_ID, at(-10_000), OTHER);

    expect(pickCreatedRoutine([foreign, mine], CHAT, TS)).toBe(mine);
  });

  it('falls back to a reminder', () => {
    const reminderRoutine = reminder(ROUTINE_ID, at(-10_000));

    expect(pickCreatedRoutine([reminderRoutine], CHAT, TS)).toBe(reminderRoutine);
  });

  it('returns null outside the 120 s window', () => {
    expect(pickCreatedRoutine([reminder(ROUTINE_ID, at(-WINDOW_MS - 1000))], CHAT, TS)).toBeNull();
  });

  it('accepts a routine created exactly at the window edge', () => {
    const edge = reminder(ROUTINE_ID, at(-WINDOW_MS));
    expect(pickCreatedRoutine([edge], CHAT, TS)).toBe(edge);
  });

  it('returns null for another chat prompt routine', () => {
    expect(pickCreatedRoutine([prompt(ROUTINE_ID, at(-10_000), OTHER)], CHAT, TS)).toBeNull();
    expect(pickCreatedRoutine([prompt(ROUTINE_ID, at(-10_000), null)], CHAT, TS)).toBeNull();
  });

  it('returns null for an unparsable tool timestamp', () => {
    expect(pickCreatedRoutine([reminder(ROUTINE_ID, at(-1000))], CHAT, 'not-a-date')).toBeNull();
  });
});

describe('withRoutineCard', () => {
  it('appends one card and never duplicates a routine id', () => {
    const routine = reminder(ROUTINE_ID, TS);
    const once = withRoutineCard(EMPTY_CHAT, routine);
    const twice = withRoutineCard(once, routine);

    expect(once.routines).toEqual([{ key: `routine:${ROUTINE_ID}`, routine }]);
    expect(twice).toBe(once);

    const other = withRoutineCard(once, reminder(OTHER_ROUTINE_ID, TS));
    expect(other.routines.map((card) => card.routine.id)).toEqual([ROUTINE_ID, OTHER_ROUTINE_ID]);
  });
});

describe('EMPTY_CHAT', () => {
  it('starts with no cards and no routine message ids', () => {
    const state: ChatStreamState = EMPTY_CHAT;

    expect(state.routines).toEqual([]);
    expect(state.routineMessageIds).toEqual([]);
    expect(state.system).toEqual([]);
  });
});

const RUN_ID = 'run_01JABCDEFGHJKMNPQRSV';
const PR_URL = 'https://github.com/o/r/pull/42';

function runFixture(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN_ID,
    repoId: REPO,
    jobId: null,
    state: 'pr_open',
    trigger: 'promote',
    branch: 'cb/run-x',
    baseRef: 'main',
    pr: { number: 42, url: PR_URL, mergeable: true },
    gate: { status: 'failed', exitCode: 2, durationMs: 1400 },
    guardrails: [],
    blockers: [],
    diff: null,
    cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
    createdAt: TS,
    finishedAt: null,
    ...overrides,
  };
}

describe('systemCardsOf', () => {
  it('builds the gate card then the PR card from the run object', () => {
    expect(systemCardsOf(runFixture())).toEqual([
      {
        key: `gate:${RUN_ID}`,
        kind: 'gate',
        runId: RUN_ID,
        status: 'failed',
        detail: 'exit 2 · 1400 ms',
        href: null,
      },
      {
        key: `pr:${RUN_ID}`,
        kind: 'pr',
        runId: RUN_ID,
        status: 'open',
        detail: '#42',
        href: PR_URL,
      },
    ]);
  });

  it('marks the PR merged once the run succeeded', () => {
    const cards = systemCardsOf(runFixture({ state: 'succeeded' }));

    expect(cards.map((card) => card.status)).toEqual(['failed', 'merged']);
  });

  it('returns no card for a run with neither a gate nor a PR', () => {
    expect(systemCardsOf(runFixture({ gate: null, pr: null }))).toEqual([]);
  });
});

describe('withRunCards', () => {
  it('replaces the cards of one run and is idempotent', () => {
    const run = runFixture();
    const once = withRunCards(EMPTY_CHAT, run);

    expect(once.system.map((card) => card.key)).toEqual([`gate:${RUN_ID}`, `pr:${RUN_ID}`]);

    const twice = withRunCards(once, run);
    expect(withRunCards(twice, run)).toBe(twice);
  });

  it('leaves the state alone for a run with no cards', () => {
    const state: ChatStreamState = EMPTY_CHAT;
    expect(withRunCards(state, runFixture({ gate: null, pr: null }))).toBe(state);
  });
});

describe('replayed frame batch', () => {
  it('leaves the thread identical when the same four frames arrive twice', () => {
    const persisted = message('msg_01JABCDEFGHJKMNPQRSV', 'assistant', 'Hello', TS);
    const batch: readonly SseStreamEvent[] = [
      delta(1, 'Hel'),
      delta(2, 'lo'),
      messageEvent(persisted, 3),
      {
        event: 'chat.tool',
        data: { chatId: CHAT, seq: 3, tool: 'bash', status: 'ok', detail: 'exit 0', ts: TS },
      },
    ];

    let first = EMPTY_CHAT;
    for (const frame of batch) first = applyChatEvent(first, CHAT, frame);

    let replayed = first;
    for (const frame of batch) replayed = applyChatEvent(replayed, CHAT, frame);

    expect(replayed).toBe(first);

    const assistants = first.messages.filter((item) => item.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.text).toBe('Hello');
    expect(first.tools).toHaveLength(1);
    expect(first.tools[0]?.key).toBe('tool:3');
  });
});

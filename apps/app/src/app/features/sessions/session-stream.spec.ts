import type { Page, SessionMessage, SseStreamEvent } from '@codebox/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_THREAD,
  appendMessage,
  applySessionEvent,
  mergeMessages,
} from './session-stream';
import type { SessionThread } from './session-stream';

const SESSION_ID = 'sess_01JABCDEFGHJK';
const OTHER_ID = 'sess_01JABCDEFGHJM';
const TS = '2026-10-28T09:12:00Z';

function messageAt(id: string, role: SessionMessage['role'], text: string, at = TS): SessionMessage {
  return { id, sessionId: SESSION_ID, role, text, createdAt: at };
}

function pageOf(messages: readonly SessionMessage[]): Page<SessionMessage> {
  return { data: [...messages], nextCursor: null };
}

function delta(sessionId: string, seq: number, text: string): SseStreamEvent {
  return { event: 'session.delta', data: { sessionId, seq, ts: TS, delta: text } };
}

function tool(sessionId: string, seq: number, status: 'start' | 'ok' | 'error'): SseStreamEvent {
  return {
    event: 'session.tool',
    data: { sessionId, seq, ts: TS, tool: 'bash', status, detail: 'ls' },
  };
}

describe('mergeMessages', () => {
  it('is idempotent across the same page merged twice', () => {
    const page = pageOf([messageAt('msg_01JABCDEF01', 'user', 'hello')]);

    const once = mergeMessages(EMPTY_THREAD, page);
    const twice = mergeMessages(once, page);

    expect(once.messages).toHaveLength(1);
    expect(twice).toBe(once);
    expect(twice.messages).toHaveLength(1);
  });

  it('orders the thread oldest first and keys every entry by message id', () => {
    const thread = mergeMessages(
      EMPTY_THREAD,
      pageOf([
        messageAt('msg_01JABCDEF02', 'assistant', 'second', '2026-10-28T09:13:00Z'),
        messageAt('msg_01JABCDEF01', 'user', 'first', '2026-10-28T09:12:00Z'),
      ]),
    );

    expect(thread.messages.map((message) => message.id)).toEqual([
      'msg_01JABCDEF01',
      'msg_01JABCDEF02',
    ]);
  });

  it('replaces the live delta buffer with the first real assistant message', () => {
    const streamed = applySessionEvent(EMPTY_THREAD, SESSION_ID, delta(SESSION_ID, 1, 'partial'));
    const merged = mergeMessages(
      streamed,
      pageOf([messageAt('msg_01JABCDEF01', 'assistant', 'partial answer')]),
    );

    expect(merged.messages).toHaveLength(1);
    expect(merged.messages[0]?.id).toBe('msg_01JABCDEF01');
  });

  it('appends through appendMessage without duplicating an id', () => {
    const message = messageAt('msg_01JABCDEF01', 'user', 'hello');

    const once = appendMessage(EMPTY_THREAD, message);
    const twice = appendMessage(once, message);

    expect(twice.messages).toHaveLength(1);
  });
});

describe('applySessionEvent', () => {
  it('never duplicates a replayed delta frame', () => {
    const frame = delta(SESSION_ID, 4, 'streamed text');

    const once = applySessionEvent(EMPTY_THREAD, SESSION_ID, frame);
    const twice = applySessionEvent(once, SESSION_ID, frame);

    expect(once.messages).toHaveLength(1);
    expect(twice.messages).toHaveLength(1);
    expect(twice.messages[0]?.text).toBe('streamed text');
    expect(twice.lastSeq).toBe(4);
  });

  it('appends consecutive deltas to the same assistant message', () => {
    const first = applySessionEvent(EMPTY_THREAD, SESSION_ID, delta(SESSION_ID, 1, 'Hel'));
    const second = applySessionEvent(first, SESSION_ID, delta(SESSION_ID, 2, 'lo'));

    expect(second.messages).toHaveLength(1);
    expect(second.messages[0]?.text).toBe('Hello');
    expect(second.messages[0]?.role).toBe('assistant');
    expect(second.working).toBe(true);
  });

  it('ignores a frame of another session and a gap', () => {
    const other = applySessionEvent(EMPTY_THREAD, SESSION_ID, delta(OTHER_ID, 1, 'nope'));
    expect(other).toBe(EMPTY_THREAD);

    const gap = applySessionEvent(EMPTY_THREAD, SESSION_ID, {
      event: 'gap',
      data: { afterId: 1, latestId: 9, ts: TS },
    });
    expect(gap).toBe(EMPTY_THREAD);
  });

  it('keys a tool card by session and seq and updates it in place', () => {
    const started = applySessionEvent(EMPTY_THREAD, SESSION_ID, tool(SESSION_ID, 3, 'start'));
    expect(started.tools[0]).toEqual({
      key: `${SESSION_ID}:3`,
      tool: 'bash',
      status: 'start',
      detail: 'ls',
      seq: 3,
    });

    const done = applySessionEvent(started, SESSION_ID, tool(SESSION_ID, 3, 'ok'));
    expect(done.tools).toHaveLength(1);
    expect(done.tools[0]?.status).toBe('ok');

    const replayed = applySessionEvent(done, SESSION_ID, tool(SESSION_ID, 3, 'ok'));
    expect(replayed).toBe(done);
  });

  it('sets the pending proposal and clears the working flag when the session closes', () => {
    const proposal = {
      branch: 'cb/design-edit',
      sha: '9f1c2ab',
      paths: ['design/tokens/core.json'],
      createdAt: TS,
    };
    const withProposal = applySessionEvent(EMPTY_THREAD, SESSION_ID, {
      event: 'session.proposal',
      data: { sessionId: SESSION_ID, seq: 5, ts: TS, proposal },
    });
    expect(withProposal.proposal).toEqual(proposal);

    const closed = applySessionEvent(withProposal, SESSION_ID, {
      event: 'session.closed',
      data: { sessionId: SESSION_ID, seq: 6, ts: TS, status: 'archived' },
    });
    expect(closed.working).toBe(false);
    expect(closed.lastSeq).toBe(6);
  });
});

describe('EMPTY_THREAD', () => {
  it('is an empty, frozen thread', () => {
    const thread: SessionThread = EMPTY_THREAD;

    expect(thread.messages).toEqual([]);
    expect(thread.tools).toEqual([]);
    expect(thread.proposal).toBeNull();
    expect(thread.working).toBe(false);
    expect(thread.lastSeq).toBe(0);
  });
});

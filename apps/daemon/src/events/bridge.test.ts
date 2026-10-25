import { afterEach, describe, expect, it } from 'vitest';
import type { SseEventName } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { EventRecord, NewEventRecord, Store } from '@codebox/store';
import { createSseBridge } from './bridge.js';
import type { SseFrame } from './bridge.js';

const CHAT_A = 'chat_bridge01';
const CHAT_B = 'chat_bridge02';
const RUN_A = 'run_bridge01';

const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function store(): Store {
  const opened = openInMemoryStore();
  stores.push(opened);
  // The bridge reads rows by their global id; the run or chat a fixture belongs to is not part
  // of what this suite measures, so the parent rows are not seeded.
  opened.db.exec('PRAGMA foreign_keys = OFF');
  return opened;
}

interface Seed {
  readonly type: SseEventName;
  readonly ts: string;
  readonly data: Record<string, unknown>;
  readonly chatId?: string;
  readonly runId?: string;
}

function append(target: Store, seed: Seed): EventRecord {
  const record: NewEventRecord = {
    runId: seed.runId ?? null,
    chatId: seed.chatId ?? null,
    seq: typeof seed.data['seq'] === 'number' ? seed.data['seq'] : null,
    type: seed.type,
    data: seed.data,
    ts: seed.ts,
  };
  return target.events.append(record);
}

function chatDelta(target: Store, chatId: string, seq: number, ts: string): EventRecord {
  return append(target, {
    type: 'chat.delta',
    chatId,
    ts,
    data: { chatId, seq, ts, delta: `delta-${seq}` },
  });
}

function runOutput(target: Store, runId: string, seq: number, ts: string): EventRecord {
  return append(target, { type: 'run.output', runId, ts, data: { runId, seq, ts, delta: 'x' } });
}

function runFinished(target: Store, runId: string, seq: number, ts: string): EventRecord {
  return append(target, {
    type: 'run.finished',
    runId,
    ts,
    data: { runId, seq, ts, state: 'succeeded' },
  });
}

function idsOf(frames: readonly SseFrame[]): number[] {
  return frames
    .filter((frame) => frame.kind === 'event')
    .map((frame) => (frame.kind === 'event' ? frame.id : -1));
}

describe('SSE bridge replay', () => {
  it('replays exactly the events after the given id and never an earlier one', () => {
    const db = store();
    for (let seq = 1; seq <= 5; seq += 1) {
      chatDelta(db, CHAT_A, seq, `2026-10-25T10:00:0${seq}.000Z`);
    }
    let now = Date.parse('2026-10-25T10:01:00.000Z');
    const bridge = createSseBridge({ store: db, clock: () => new Date(now) });
    const session = bridge.session({ afterId: 2, filter: {} });

    expect(idsOf(session.next())).toEqual([3, 4, 5]);
    expect(idsOf(session.next())).toEqual([]);
    expect(session.done()).toBe(false);

    now += 15_000;
    expect(session.next()).toEqual([{ kind: 'heartbeat' }]);
  });

  it('does not produce a gap when the range is contiguous or the start is zero', () => {
    const db = store();
    chatDelta(db, CHAT_A, 1, '2026-10-25T10:00:01.000Z');
    chatDelta(db, CHAT_A, 2, '2026-10-25T10:00:02.000Z');
    const bridge = createSseBridge({
      store: db,
      clock: () => new Date('2026-10-25T10:01:00.000Z'),
    });

    expect(bridge.session({ afterId: 0, filter: {} }).next()[0]?.kind).toBe('event');
    expect(
      bridge
        .session({ afterId: 1, filter: {} })
        .next()
        .map((frame) => frame.kind),
    ).toEqual(['event']);
  });

  it('sends one gap frame for a pruned range before the first row', () => {
    const db = store();
    for (let seq = 1; seq <= 5; seq += 1) {
      chatDelta(db, CHAT_A, seq, `2026-10-25T10:00:0${seq}.000Z`);
    }
    expect(db.events.pruneBefore('2026-10-25T10:00:03.000Z')).toBe(2);
    expect(db.events.latestId()).toBe(5);

    const bridge = createSseBridge({
      store: db,
      clock: () => new Date('2026-10-25T10:01:00.000Z'),
    });
    const frames = bridge.session({ afterId: 1, filter: {} }).next();

    expect(frames).toHaveLength(4);
    expect(frames[0]).toEqual({
      kind: 'gap',
      afterId: 1,
      latestId: 5,
      ts: '2026-10-25T10:01:00.000Z',
    });
    expect(idsOf(frames)).toEqual([3, 4, 5]);
  });

  it('ends the frames iterable after the terminal run event of the filtered run', async () => {
    const db = store();
    runOutput(db, RUN_A, 1, '2026-10-25T10:00:01.000Z');
    runFinished(db, RUN_A, 2, '2026-10-25T10:00:02.000Z');
    chatDelta(db, CHAT_A, 1, '2026-10-25T10:00:03.000Z');
    const bridge = createSseBridge({
      store: db,
      clock: () => new Date('2026-10-25T10:01:00.000Z'),
      wait: async () => undefined,
    });

    const seen: string[] = [];
    for await (const frame of bridge.frames({ afterId: 0, filter: { runId: RUN_A } })) {
      if (frame.kind === 'event') seen.push(frame.event);
    }
    expect(seen).toEqual(['run.output', 'run.finished']);
  });
});

describe('SSE bridge filters', () => {
  it('honours the type, chat and run filters without skipping cursor ids', () => {
    const db = store();
    chatDelta(db, CHAT_A, 1, '2026-10-25T10:00:01.000Z');
    runOutput(db, RUN_A, 1, '2026-10-25T10:00:02.000Z');
    append(db, {
      type: 'chat.tool',
      chatId: CHAT_A,
      ts: '2026-10-25T10:00:03.000Z',
      data: { chatId: CHAT_A, seq: 2, ts: '2026-10-25T10:00:03.000Z', tool: 'edit', status: 'ok' },
    });
    chatDelta(db, CHAT_A, 3, '2026-10-25T10:00:04.000Z');
    chatDelta(db, CHAT_B, 1, '2026-10-25T10:00:05.000Z');
    const clock = (): Date => new Date('2026-10-25T10:01:00.000Z');

    const deltas = createSseBridge({ store: db, clock }).session({
      afterId: 0,
      filter: { types: ['chat.delta'], chatId: CHAT_A },
    });
    const first = deltas.next();
    expect(first.map((frame) => (frame.kind === 'event' ? frame.event : frame.kind))).toEqual([
      'chat.delta',
      'chat.delta',
    ]);
    expect(first.map((frame) => (frame.kind === 'event' ? frame.data['delta'] : ''))).toEqual([
      'delta-1',
      'delta-3',
    ]);

    const byRun = createSseBridge({ store: db, clock }).session({
      afterId: 0,
      filter: { runId: RUN_A },
    });
    expect(
      byRun.next().map((frame) => (frame.kind === 'event' ? frame.event : frame.kind)),
    ).toEqual(['run.output']);
    expect(byRun.done()).toBe(false);
  });

  it('ends a filtered stream on a terminal event that carries the filtered run id', () => {
    const db = store();
    runOutput(db, RUN_A, 1, '2026-10-25T10:00:01.000Z');
    runFinished(db, RUN_A, 2, '2026-10-25T10:00:02.000Z');
    const bridge = createSseBridge({
      store: db,
      clock: () => new Date('2026-10-25T10:01:00.000Z'),
    });
    const session = bridge.session({ afterId: 0, filter: { runId: RUN_A } });

    expect(session.done()).toBe(false);
    session.next();
    expect(session.done()).toBe(true);
  });
});

describe('SSE bridge heartbeat and hard close', () => {
  it('waits on the poll and emits a heartbeat after the idle window', async () => {
    const db = store();
    chatDelta(db, CHAT_A, 1, '2026-10-25T10:00:01.000Z');
    const lastId = db.events.latestId();
    let now = Date.parse('2026-10-25T10:01:00.000Z');
    const waits: number[] = [];
    const bridge = createSseBridge({
      store: db,
      clock: () => new Date(now),
      wait: async (ms) => {
        waits.push(ms);
        now += ms;
      },
    });

    const iterator = bridge.frames({ afterId: lastId, filter: {} })[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ kind: 'heartbeat' });
    expect(waits).toHaveLength(15);
    expect(waits.every((ms) => ms === 1000)).toBe(true);
    expect(bridge.session({ afterId: lastId, filter: {} }).done()).toBe(false);
    await iterator.return?.(undefined);
  });

  it('closes an idle stream at the hard-close window', () => {
    const db = store();
    chatDelta(db, CHAT_A, 1, '2026-10-25T10:00:01.000Z');
    let now = Date.parse('2026-10-25T10:01:00.000Z');
    const session = createSseBridge({ store: db, clock: () => new Date(now) }).session({
      afterId: 1,
      filter: {},
    });

    expect(session.done()).toBe(false);
    now += 89_000;
    expect(session.done()).toBe(false);
    now += 1_000;
    expect(session.done()).toBe(true);
  });
});

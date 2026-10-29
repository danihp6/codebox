import type { Work, WorkState } from '@codebox/contracts';
import { WORK_STATES } from '@codebox/contracts';
import { describe, expect, it } from 'vitest';
import {
  WORKER_ROOMS,
  WORKER_STATES,
  laneOf,
  projectWorkers,
  workerStateOf,
} from './workers.model';
import type { WorkerLane } from './workers.model';

const REPO_ID = 'repo_01JABCDEFGHJKMNPQRSV';

function workAt(index: number, state: WorkState): Work {
  return {
    id: `wrk_01JABCDEF${String(index).padStart(2, '0')}`,
    repoId: REPO_ID,
    backlogRef: `Task-${70 + index}`,
    title: `Work ${index}`,
    prompt: 'Do the thing.',
    specSha: '9f1c2ab',
    state,
    origin: 'backlog',
    attempts: index,
    maxAttempts: 2,
    usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
    contextTokens: 0,
    contextEpoch: 1,
    reviewedAt: null,
    createdAt: '2026-10-28T09:12:00Z',
    updatedAt: '2026-10-28T09:12:00Z',
  };
}

const LANES: Readonly<Record<WorkState, WorkerLane>> = {
  queued: 'road-in',
  running: 'DEV',
  review: 'QA',
  needs_decision: 'ORQ',
  merged: 'belt-out',
  failed: 'belt-out',
  abandoned: 'belt-out',
};

const STATES: Readonly<Record<WorkState, ReturnType<typeof workerStateOf>>> = {
  queued: 'queued',
  running: 'running',
  review: 'running',
  needs_decision: 'needs-you',
  merged: 'asleep',
  failed: 'asleep',
  abandoned: 'asleep',
};

describe('laneOf and workerStateOf', () => {
  it('maps all seven work states, and nothing else', () => {
    expect([...WORK_STATES]).toEqual([
      'queued',
      'running',
      'review',
      'merged',
      'failed',
      'needs_decision',
      'abandoned',
    ]);
    for (const state of WORK_STATES) {
      expect(laneOf(state), state).toBe(LANES[state]);
      expect(workerStateOf(state), state).toBe(STATES[state]);
    }
  });

  it('never puts a work in the architect room', () => {
    for (const state of WORK_STATES) expect(laneOf(state)).not.toBe('ARC');
  });

  it('declares the four rooms and the four states in drawing order', () => {
    expect([...WORKER_ROOMS]).toEqual(['ORQ', 'ARC', 'DEV', 'QA']);
    expect([...WORKER_STATES]).toEqual(['queued', 'running', 'needs-you', 'asleep']);
    expect(Object.isFrozen(WORKER_ROOMS)).toBe(true);
    expect(Object.isFrozen(WORKER_STATES)).toBe(true);
  });
});

describe('projectWorkers', () => {
  it('always returns the four rooms in order and leaves ARC empty', () => {
    const board = projectWorkers([workAt(1, 'running')]);

    expect(board.rooms.map((room) => room.room)).toEqual(['ORQ', 'ARC', 'DEV', 'QA']);
    expect(board.rooms[1]?.cards).toEqual([]);
  });

  it('keeps the daemon order inside every lane', () => {
    const newest = workAt(2, 'running');
    const oldest = workAt(1, 'running');
    const mergedFirst = workAt(4, 'merged');
    const mergedSecond = workAt(3, 'merged');

    const board = projectWorkers([newest, oldest, mergedFirst, mergedSecond]);

    expect(board.rooms[2]?.cards.map((card) => card.workId)).toEqual([newest.id, oldest.id]);
    expect(board.beltOut.map((card) => card.workId)).toEqual([mergedFirst.id, mergedSecond.id]);
  });

  it('sends the blocked work to ORQ and the running one to DEV', () => {
    const blocked = workAt(1, 'needs_decision');
    const running = workAt(2, 'running');

    const board = projectWorkers([blocked, running]);

    const orq = board.rooms[0]?.cards ?? [];
    const dev = board.rooms[2]?.cards ?? [];
    expect(orq).toHaveLength(1);
    expect(orq[0]?.workId).toBe(blocked.id);
    expect(orq[0]?.state).toBe('needs-you');
    expect(dev).toHaveLength(1);
    expect(dev[0]?.workId).toBe(running.id);
    expect(dev.some((card) => card.workId === blocked.id)).toBe(false);
  });

  it('projects every field the floor draws from the work alone', () => {
    const work = workAt(5, 'review');

    const card = projectWorkers([work]).rooms[3]?.cards[0];

    expect(card).toEqual({
      workId: work.id,
      ref: work.backlogRef,
      title: work.title,
      state: 'running',
      lane: 'QA',
    });
  });

  it('draws an empty floor from no works', () => {
    const board = projectWorkers([]);

    expect(board.roadIn).toEqual([]);
    expect(board.beltOut).toEqual([]);
    for (const room of board.rooms) expect(room.cards).toEqual([]);
  });
});

import type { Work, WorkState } from '@codebox/contracts';

export type WorkerRoom = 'ORQ' | 'ARC' | 'DEV' | 'QA';

/** The four rooms, in drawing order. `ARC` is drawn and stays empty (see Coordination). */
export const WORKER_ROOMS: readonly WorkerRoom[] = Object.freeze(['ORQ', 'ARC', 'DEV', 'QA']);

export type WorkerState = 'queued' | 'running' | 'needs-you' | 'asleep';

/** The design's four states, in drawing order. `needs-you` is the attribute spelling of
 *  `needs you` so it survives in `data-state`. */
export const WORKER_STATES: readonly WorkerState[] = Object.freeze([
  'queued',
  'running',
  'needs-you',
  'asleep',
]);

/** Where a work sits. The road in and the belt out are outside the four rooms. */
export type WorkerLane = 'road-in' | WorkerRoom | 'belt-out';

export interface WorkerCard {
  readonly workId: string;
  readonly ref: string;
  readonly title: string;
  readonly state: WorkerState;
  readonly lane: WorkerLane;
}

export interface WorkerRoomView {
  readonly room: WorkerRoom;
  readonly cards: readonly WorkerCard[];
}

export interface WorkersBoard {
  readonly roadIn: readonly WorkerCard[];
  readonly rooms: readonly WorkerRoomView[];
  readonly beltOut: readonly WorkerCard[];
}

// The seven states of the daemon onto the floor: a closed table, one row per `WorkState`.
const LANE_BY_STATE: Readonly<Record<WorkState, WorkerLane>> = Object.freeze({
  queued: 'road-in',
  running: 'DEV',
  review: 'QA',
  needs_decision: 'ORQ',
  merged: 'belt-out',
  failed: 'belt-out',
  abandoned: 'belt-out',
});

const STATE_BY_STATE: Readonly<Record<WorkState, WorkerState>> = Object.freeze({
  queued: 'queued',
  running: 'running',
  review: 'running',
  needs_decision: 'needs-you',
  merged: 'asleep',
  failed: 'asleep',
  abandoned: 'asleep',
});

export function laneOf(state: WorkState): WorkerLane {
  return LANE_BY_STATE[state];
}

export function workerStateOf(state: WorkState): WorkerState {
  return STATE_BY_STATE[state];
}

/** Lanes keep the daemon's order: the app never re-sorts a room or a lane. */
export function projectWorkers(works: readonly Work[]): WorkersBoard {
  const byLane = new Map<WorkerLane, WorkerCard[]>();
  for (const work of works) {
    const lane = laneOf(work.state);
    const card: WorkerCard = {
      workId: work.id,
      ref: work.backlogRef,
      title: work.title,
      state: workerStateOf(work.state),
      lane,
    };
    const laneCards = byLane.get(lane);
    if (laneCards === undefined) byLane.set(lane, [card]);
    else laneCards.push(card);
  }

  return {
    roadIn: byLane.get('road-in') ?? [],
    rooms: WORKER_ROOMS.map((room) => ({ room, cards: byLane.get(room) ?? [] })),
    beltOut: byLane.get('belt-out') ?? [],
  };
}

import { SSE_HEARTBEAT_SECONDS } from '@codebox/contracts';
import type { SseEventName } from '@codebox/contracts';
import type { EventRecord, Store } from '@codebox/store';
import type { EventNotifier } from './notifier.js';

export const SSE_POLL_MS = 1000;
export const SSE_HARD_CLOSE_SECONDS = 90;

export interface SseFilter {
  readonly types?: readonly SseEventName[];
  readonly runId?: string;
  readonly chatId?: string;
}

export type SseFrame =
  | {
      readonly kind: 'event';
      readonly id: number;
      readonly event: SseEventName;
      readonly data: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: 'gap';
      readonly afterId: number;
      readonly latestId: number;
      readonly ts: string;
    }
  | { readonly kind: 'heartbeat' };

export interface SseBridgeOptions {
  readonly store: Store;
  readonly clock: () => Date;
  readonly notifier?: EventNotifier;
  readonly pollMs?: number;
  readonly batchSize?: number;
  readonly heartbeatSeconds?: number;
  readonly hardCloseSeconds?: number;
  readonly wait?: (ms: number) => Promise<void>;
}

export interface SseSession {
  /** Frames already available after `afterId`, in global id order, filter applied. */
  readonly next: () => readonly SseFrame[];
  /** True once the stream must end (terminal run event on a `runId` filter, hard close). */
  readonly done: () => boolean;
}

export interface SseBridge {
  session(input: { afterId: number; filter: SseFilter }): SseSession;
  /** Async frame source used by the HTTP handler; ends when `done()` is true. */
  frames(input: { afterId: number; filter: SseFilter }): AsyncIterable<SseFrame>;
}

const TERMINAL_RUN_EVENTS: readonly SseEventName[] = Object.freeze([
  'run.finished',
  'run.failed',
  'run.cancelled',
]);

function defaultWait(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, Math.trunc(ms)));
    timer.unref();
  });
}

function matches(record: EventRecord, filter: SseFilter): boolean {
  if (filter.types !== undefined && !filter.types.includes(record.type)) return false;
  if (filter.runId !== undefined && record.data['runId'] !== filter.runId) return false;
  if (filter.chatId !== undefined && record.data['chatId'] !== filter.chatId) return false;
  return true;
}

export function createSseBridge(options: SseBridgeOptions): SseBridge {
  const pollMs = options.pollMs ?? SSE_POLL_MS;
  const batchSize = Math.max(1, Math.trunc(options.batchSize ?? 200));
  const heartbeatMs = (options.heartbeatSeconds ?? SSE_HEARTBEAT_SECONDS) * 1000;
  const hardCloseMs = (options.hardCloseSeconds ?? SSE_HARD_CLOSE_SECONDS) * 1000;
  const wait = options.wait;
  const notifier = options.notifier;

  async function pause(ms: number): Promise<void> {
    if (wait !== undefined) {
      await wait(ms);
      return;
    }
    if (notifier !== undefined) {
      await notifier.wait(ms);
      return;
    }
    await defaultWait(ms);
  }

  function session(input: { afterId: number; filter: SseFilter }): SseSession {
    const filter = input.filter;
    const startedAt = options.clock().getTime();
    let cursor = Math.max(0, Math.trunc(input.afterId));
    let gapChecked = cursor === 0;
    let terminal = false;
    let lastFrameAt = startedAt;
    let lastEventAt = startedAt;

    function delivered(record: EventRecord): SseFrame {
      if (
        filter.runId !== undefined &&
        record.data['runId'] === filter.runId &&
        TERMINAL_RUN_EVENTS.includes(record.type)
      ) {
        terminal = true;
      }
      return { kind: 'event', id: record.id, event: record.type, data: record.data };
    }

    return {
      next(): readonly SseFrame[] {
        const at = options.clock();
        const rows = options.store.events.readAfterId(cursor, batchSize);
        const frames: SseFrame[] = [];
        if (rows.length > 0) {
          const first = rows[0];
          const last = rows[rows.length - 1];
          if (first !== undefined && last !== undefined) {
            // The cursor advances over every row read, filtered or not: the arithmetic of a gap
            // must never depend on what the client asked to see.
            if (!gapChecked && cursor > 0 && first.id > cursor + 1) {
              frames.push({
                kind: 'gap',
                afterId: cursor,
                latestId: options.store.events.latestId(),
                ts: at.toISOString(),
              });
            }
            gapChecked = true;
            cursor = last.id;
            for (const record of rows) {
              if (matches(record, filter)) frames.push(delivered(record));
            }
          }
        }
        const now = at.getTime();
        if (frames.length > 0) {
          lastFrameAt = now;
          lastEventAt = now;
          return frames;
        }
        if (rows.length === 0 && now - lastFrameAt >= heartbeatMs) {
          lastFrameAt = now;
          return [{ kind: 'heartbeat' }];
        }
        return frames;
      },

      done(): boolean {
        if (terminal) return true;
        return options.clock().getTime() - lastEventAt >= hardCloseMs;
      },
    };
  }

  async function* frames(input: { afterId: number; filter: SseFilter }): AsyncGenerator<SseFrame> {
    const current = session(input);
    for (;;) {
      const batch = current.next();
      for (const frame of batch) yield frame;
      if (current.done()) return;
      if (batch.length === 0) await pause(pollMs);
    }
  }

  return { session, frames };
}

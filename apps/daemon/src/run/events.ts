import { randomBytes } from 'node:crypto';
import { ID_PREFIXES, parseSseEvent } from '@codebox/contracts';
import type { SseEventName } from '@codebox/contracts';
import type { EventRecord, Store } from '@codebox/store';

export type RunEventName =
  | 'run.queued'
  | 'run.started'
  | 'run.gate'
  | 'run.pr'
  | 'run.merged'
  | 'run.finished'
  | 'run.failed'
  | 'run.cancelled';

export interface RunEventWriter {
  /** A `run.*` event: the writer adds the `runId`, `seq` and `ts` base fields. */
  appendRun(event: RunEventName, extra: Readonly<Record<string, unknown>>): EventRecord;
  /** Any other SSE event, whose payload already carries every field its schema requires. */
  appendRaw(event: SseEventName, data: Readonly<Record<string, unknown>>): EventRecord;
}

export interface RunEventWriterOptions {
  readonly store: Store;
  readonly clock: () => Date;
  readonly runId: string;
}

export const APPROVAL_ID_BYTES = 10;

/** `apv_` plus 20 hex characters, the `ApprovalId` shape of the contract. */
export function mintApprovalId(): string {
  return `${ID_PREFIXES.approval}${randomBytes(APPROVAL_ID_BYTES).toString('hex')}`;
}

function toRecord(value: object): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

/**
 * Every payload is parsed against the contract before it is stored, so a wrong field fails the
 * run here instead of reaching the app as an event the client cannot decode.
 */
export function createRunEventWriter(options: RunEventWriterOptions): RunEventWriter {
  const store = options.store;
  const runId = options.runId;

  function persist(
    event: SseEventName,
    data: Readonly<Record<string, unknown>>,
    seq: number | null,
    ts: string,
  ): EventRecord {
    const parsed = parseSseEvent({ event, data });
    return store.events.append({
      runId,
      chatId: null,
      seq,
      type: parsed.event,
      data: toRecord(parsed.data),
      ts,
    });
  }

  return {
    appendRun(event: RunEventName, extra: Readonly<Record<string, unknown>>): EventRecord {
      const seq = store.events.nextSeq({ runId });
      const ts = options.clock().toISOString();
      return persist(event, { runId, seq, ts, ...extra }, seq, ts);
    },

    appendRaw(event: SseEventName, data: Readonly<Record<string, unknown>>): EventRecord {
      const ts = typeof data['ts'] === 'string' ? data['ts'] : options.clock().toISOString();
      return persist(event, data, null, ts);
    },
  };
}

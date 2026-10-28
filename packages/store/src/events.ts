import type { SseEventName } from '@codebox/contracts';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { isForeignKeyViolation, isUniqueViolation } from './db.js';
import { StoreError } from './errors.js';
import { eventFromRow, jsonText, row } from './mappers.js';

export interface EventRecord {
  readonly id: number;
  readonly runId: string | null;
  readonly chatId: string | null;
  readonly workId?: string | null;
  readonly sessionId?: string | null;
  readonly seq: number | null;
  readonly type: SseEventName;
  readonly data: Record<string, unknown>;
  readonly ts: string;
}

export interface NewEventRecord {
  readonly runId: string | null;
  readonly chatId: string | null;
  readonly workId?: string | null;
  readonly sessionId?: string | null;
  readonly seq: number | null;
  readonly type: SseEventName;
  readonly data: Record<string, unknown>;
  readonly ts: string;
}

export interface EventRepository {
  nextSeq(
    scope: { runId: string } | { chatId: string } | { workId: string } | { sessionId: string },
  ): number;
  append(record: NewEventRecord): EventRecord;
  readAfterId(afterId: number, limit: number): EventRecord[];
  readRunAfterSeq(runId: string, afterSeq: number, limit: number): EventRecord[];
  latestId(): number;
  pruneBefore(ts: string): number;
}

const COLUMNS = 'id, run_id, chat_id, work_id, session_id, seq, type, payload, ts';

export function createEventRepository(db: DatabaseSync): EventRepository {
  const nextRunSeq = db.prepare(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM run_events WHERE run_id = ?',
  );
  const nextChatSeq = db.prepare(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM run_events WHERE chat_id = ?',
  );
  const nextWorkSeq = db.prepare(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM run_events WHERE work_id = ?',
  );
  const nextSessionSeq = db.prepare(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM run_events WHERE session_id = ?',
  );
  const insert = db.prepare(
    `INSERT INTO run_events (run_id, chat_id, work_id, session_id, seq, type, payload, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectAfterId = db.prepare(
    `SELECT ${COLUMNS} FROM run_events WHERE id > ? ORDER BY id ASC LIMIT ?`,
  );
  const selectRunAfterSeq = db.prepare(
    `SELECT ${COLUMNS} FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
  );
  const selectLatest = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM run_events');
  const deleteBefore = db.prepare('DELETE FROM run_events WHERE ts < ?');

  function nextFrom(statement: StatementSync, id: string): number {
    const value = statement.get(id)?.['next'];
    return value === null || value === undefined ? 1 : Number(value);
  }

  return {
    nextSeq(
      scope: { runId: string } | { chatId: string } | { workId: string } | { sessionId: string },
    ): number {
      if ('runId' in scope) return nextFrom(nextRunSeq, scope.runId);
      if ('chatId' in scope) return nextFrom(nextChatSeq, scope.chatId);
      if ('workId' in scope) return nextFrom(nextWorkSeq, scope.workId);
      return nextFrom(nextSessionSeq, scope.sessionId);
    },

    append(record: NewEventRecord): EventRecord {
      let inserted;
      try {
        inserted = insert.run(
          record.runId,
          record.chatId,
          record.workId ?? null,
          record.sessionId ?? null,
          record.seq,
          record.type,
          jsonText(record.data),
          record.ts,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError('unique_violation', 'event sequence already exists');
        }
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'event reference is missing');
        }
        throw error;
      }
      return {
        id: Number(inserted.lastInsertRowid),
        runId: record.runId,
        chatId: record.chatId,
        workId: record.workId ?? null,
        sessionId: record.sessionId ?? null,
        seq: record.seq,
        type: record.type,
        data: record.data,
        ts: record.ts,
      };
    },

    readAfterId(afterId: number, limit: number): EventRecord[] {
      return selectAfterId
        .all(Math.trunc(afterId), Math.max(1, Math.trunc(limit)))
        .map((value) => eventFromRow(row(value)));
    },

    readRunAfterSeq(runId: string, afterSeq: number, limit: number): EventRecord[] {
      return selectRunAfterSeq
        .all(runId, Math.trunc(afterSeq), Math.max(1, Math.trunc(limit)))
        .map((value) => eventFromRow(row(value)));
    },

    latestId(): number {
      const result = selectLatest.get();
      const value = result?.['id'];
      return value === null || value === undefined ? 0 : Number(value);
    },

    pruneBefore(ts: string): number {
      return Number(deleteBefore.run(ts).changes);
    },
  };
}

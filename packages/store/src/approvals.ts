import type { Approval } from '@codebox/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { decodeCursor, encodeCursor, type PageQuery, type PageResult } from './cursor.js';
import { StoreError } from './errors.js';
import { approvalFromRow, jsonText, row } from './mappers.js';

export interface ApprovalRepository {
  get(id: string): Approval | null;
  listPending(limit: number): Approval[];
  list(state: Approval['state'], query: PageQuery): PageResult<Approval>;
  create(approval: Approval): Approval;
  resolve(input: {
    id: string;
    state: 'allowed' | 'denied' | 'expired';
    resolvedAt: string;
  }): Approval;
}

const COLUMNS =
  'id, state, tool, title, run_id, chat_id, input, created_at, expires_at, resolved_at';

export function createApprovalRepository(db: DatabaseSync): ApprovalRepository {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM approvals WHERE id = ?`);
  const selectPending = db.prepare(`
    SELECT ${COLUMNS} FROM approvals WHERE state = 'pending'
    ORDER BY created_at ASC, id ASC LIMIT ?
  `);
  const insert = db.prepare(`
    INSERT INTO approvals (
      id, state, tool, title, run_id, chat_id, input, created_at, expires_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const resolvePending = db.prepare(
    "UPDATE approvals SET state = ?, resolved_at = ? WHERE id = ? AND state = 'pending'",
  );

  function findById(id: string): Approval | null {
    const value = selectById.get(id);
    return value === undefined ? null : approvalFromRow(row(value));
  }

  return {
    get(id: string): Approval | null {
      return findById(id);
    },

    listPending(limit: number): Approval[] {
      return selectPending
        .all(Math.max(1, Math.trunc(limit)))
        .map((value) => approvalFromRow(row(value)));
    },

    list(state: Approval['state'], query: PageQuery): PageResult<Approval> {
      const limit = Math.max(1, Math.trunc(query.limit));
      const conditions = ['state = ?'];
      const parameters: (string | number)[] = [state];
      if (query.cursor !== null) {
        const cursor = decodeCursor(query.cursor);
        conditions.push('(created_at > ? OR (created_at = ? AND id > ?))');
        parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      const values = db
        .prepare(
          `SELECT ${COLUMNS} FROM approvals WHERE ${conditions.join(' AND ')}
           ORDER BY created_at ASC, id ASC LIMIT ?`,
        )
        .all(...parameters, limit + 1)
        .map((value) => approvalFromRow(row(value)));
      const data = values.slice(0, limit);
      const last = values.at(limit - 1);
      return {
        data,
        nextCursor:
          values.length > limit && last !== undefined
            ? encodeCursor(last.createdAt, last.id)
            : null,
      };
    },

    create(approval: Approval): Approval {
      insert.run(
        approval.id,
        approval.state,
        approval.tool,
        approval.title,
        approval.runId,
        approval.chatId,
        jsonText(approval.input),
        approval.createdAt,
        approval.expiresAt,
        approval.resolvedAt,
      );
      const created = findById(approval.id);
      if (created === null) throw new StoreError('invalid_row', 'approval was not stored');
      return created;
    },

    resolve(input: {
      id: string;
      state: 'allowed' | 'denied' | 'expired';
      resolvedAt: string;
    }): Approval {
      const current = findById(input.id);
      if (current === null) throw new StoreError('not_found', 'approval not found');
      if (current.state !== 'pending') return current;
      resolvePending.run(input.state, input.resolvedAt, input.id);
      const resolved = findById(input.id);
      if (resolved === null) throw new StoreError('invalid_row', 'approval was not stored');
      return resolved;
    },
  };
}

import type { Work, WorkState } from '@codebox/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { decodeCursor, encodeCursor, type PageResult } from './cursor.js';
import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from './db.js';
import { StoreError } from './errors.js';
import { row, workFromRow } from './mappers.js';

export interface WorkFilter {
  readonly repoId?: string;
  readonly state?: WorkState;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface WorkPatch {
  readonly title?: string;
  readonly prompt?: string;
  readonly specSha?: string;
  readonly state?: WorkState;
  readonly attempts?: number;
  readonly maxAttempts?: number;
  readonly usage?: { readonly usd: number; readonly tokensIn: number; readonly tokensOut: number };
  readonly contextTokens?: number;
  readonly contextEpoch?: number;
  readonly reviewedAt?: string | null;
  readonly updatedAt: string;
}

export interface WorkRepository {
  get(id: string): Work | null;
  list(filter: WorkFilter): PageResult<Work>;
  create(work: Work): Work;
  update(id: string, patch: WorkPatch): Work;
  /** The newest work of that item, in any state; `null` when the item has none. */
  findByBacklogRef(repoId: string, backlogRef: string): Work | null;
}

const COLUMNS = [
  'id',
  'repo_id',
  'backlog_ref',
  'title',
  'prompt',
  'spec_sha',
  'state',
  'origin',
  'attempts',
  'max_attempts',
  'usage_usd',
  'usage_tokens_in',
  'usage_tokens_out',
  'context_tokens',
  'context_epoch',
  'reviewed_at',
  'created_at',
  'updated_at',
].join(', ');

const TEXT_COLUMNS: readonly [keyof WorkPatch, string][] = [
  ['title', 'title'],
  ['prompt', 'prompt'],
  ['specSha', 'spec_sha'],
  ['reviewedAt', 'reviewed_at'],
];

const VALUE_COLUMNS: readonly [keyof WorkPatch, string][] = [
  ['state', 'state'],
  ['attempts', 'attempts'],
  ['maxAttempts', 'max_attempts'],
  ['contextTokens', 'context_tokens'],
  ['contextEpoch', 'context_epoch'],
];

export function createWorkRepository(db: DatabaseSync): WorkRepository {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM works WHERE id = ?`);
  const selectByRef = db.prepare(
    `SELECT ${COLUMNS} FROM works
     WHERE repo_id = ? AND backlog_ref = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
  );
  const insert = db.prepare(`
    INSERT INTO works (
      id, repo_id, backlog_ref, title, prompt, spec_sha, state, origin, attempts, max_attempts,
      usage_usd, usage_tokens_in, usage_tokens_out, context_tokens, context_epoch, reviewed_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function findById(id: string): Work | null {
    const value = selectById.get(id);
    return value === undefined ? null : workFromRow(row(value));
  }

  function stored(id: string): Work {
    const value = findById(id);
    if (value === null) throw new StoreError('not_found', 'work not found');
    return value;
  }

  return {
    get(id: string): Work | null {
      return findById(id);
    },

    list(filter: WorkFilter): PageResult<Work> {
      const limit = Math.max(1, Math.trunc(filter.limit));
      const conditions: string[] = [];
      const parameters: (string | number)[] = [];
      if (filter.repoId !== undefined) {
        conditions.push('repo_id = ?');
        parameters.push(filter.repoId);
      }
      if (filter.state !== undefined) {
        conditions.push('state = ?');
        parameters.push(filter.state);
      }
      if (filter.cursor !== null) {
        const cursor = decodeCursor(filter.cursor);
        conditions.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
        parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
      const values = db
        .prepare(`SELECT ${COLUMNS} FROM works ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`)
        .all(...parameters, limit + 1)
        .map((value) => workFromRow(row(value)));
      const data = values.slice(0, limit);
      const last = data.at(-1);
      return {
        data,
        nextCursor:
          values.length > limit && last !== undefined
            ? encodeCursor(last.updatedAt, last.id)
            : null,
      };
    },

    create(work: Work): Work {
      try {
        insert.run(
          work.id,
          work.repoId,
          work.backlogRef,
          work.title,
          work.prompt,
          work.specSha,
          work.state,
          work.origin,
          work.attempts,
          work.maxAttempts,
          work.usage.usd,
          work.usage.tokensIn,
          work.usage.tokensOut,
          work.contextTokens,
          work.contextEpoch,
          work.reviewedAt,
          work.createdAt,
          work.updatedAt,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError('unique_violation', 'work already in flight for this backlog item');
        }
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'work repository is missing');
        }
        if (isCheckViolation(error)) {
          throw new StoreError('check_violation', 'work violates a state constraint');
        }
        throw error;
      }
      return stored(work.id);
    },

    update(id: string, patch: WorkPatch): Work {
      if (findById(id) === null) throw new StoreError('not_found', 'work not found');
      const assignments: string[] = [];
      const parameters: (string | number | null)[] = [];
      for (const [key, column] of TEXT_COLUMNS) {
        const value = patch[key];
        if (value !== undefined) {
          assignments.push(`${column} = ?`);
          parameters.push(value as string | null);
        }
      }
      for (const [key, column] of VALUE_COLUMNS) {
        const value = patch[key];
        if (value !== undefined) {
          assignments.push(`${column} = ?`);
          parameters.push(value as string | number);
        }
      }
      if (patch.usage !== undefined) {
        assignments.push('usage_usd = ?', 'usage_tokens_in = ?', 'usage_tokens_out = ?');
        parameters.push(patch.usage.usd, patch.usage.tokensIn, patch.usage.tokensOut);
      }
      assignments.push('updated_at = ?');
      parameters.push(patch.updatedAt);
      try {
        db.prepare(`UPDATE works SET ${assignments.join(', ')} WHERE id = ?`).run(
          ...parameters,
          id,
        );
      } catch (error) {
        if (isCheckViolation(error)) {
          throw new StoreError('check_violation', 'work violates a state constraint');
        }
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'work repository is missing');
        }
        throw error;
      }
      return stored(id);
    },

    findByBacklogRef(repoId: string, backlogRef: string): Work | null {
      const value = selectByRef.get(repoId, backlogRef);
      return value === undefined ? null : workFromRow(row(value));
    },
  };
}

import type { Job } from '@codebox/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { decodeCursor, encodeCursor, type PageResult } from './cursor.js';
import { isForeignKeyViolation, isUniqueViolation } from './db.js';
import { StoreError } from './errors.js';
import { booleanToInteger, jobFromRow, row } from './mappers.js';

export interface JobFilter {
  readonly repoId?: string;
  readonly enabled?: boolean;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface JobPatch {
  readonly title?: string;
  readonly prompt?: string;
  readonly agent?: string;
  readonly model?: string | null;
  readonly cron?: string;
  readonly timezone?: string;
  readonly enabled?: boolean;
  readonly policy?: 'auto' | 'manual';
  readonly maxCostUsd?: number | null;
  readonly nextFireAt?: string | null;
}

export interface JobRepository {
  get(id: string): Job | null;
  list(filter: JobFilter): PageResult<Job>;
  create(job: Job): Job;
  update(id: string, patch: JobPatch): Job;
  delete(id: string): void;
  setNextFire(id: string, nextFireAt: string | null): void;
  listDue(at: string, limit: number): Job[];
}

const COLUMNS = [
  'id',
  'repo_id',
  'title',
  'prompt',
  'mode',
  'agent',
  'model',
  'cron',
  'timezone',
  'enabled',
  'policy',
  'created_at',
  'next_fire_at',
].join(', ');

export function createJobRepository(db: DatabaseSync): JobRepository {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM jobs WHERE id = ?`);
  const selectDue = db.prepare(`
    SELECT ${COLUMNS} FROM jobs
    WHERE enabled = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= ?
    ORDER BY next_fire_at ASC, created_at ASC, id ASC
    LIMIT ?
  `);
  const insert = db.prepare(`
    INSERT INTO jobs (
      id, repo_id, title, prompt, mode, agent, model, cron, timezone, enabled, policy,
      max_cost_usd, next_fire_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `);
  const remove = db.prepare('DELETE FROM jobs WHERE id = ?');
  const updateNextFire = db.prepare('UPDATE jobs SET next_fire_at = ? WHERE id = ?');

  function findById(id: string): Job | null {
    const value = selectById.get(id);
    return value === undefined ? null : jobFromRow(row(value));
  }

  type ScalarPatchKey =
    | 'title'
    | 'prompt'
    | 'agent'
    | 'model'
    | 'cron'
    | 'timezone'
    | 'policy'
    | 'maxCostUsd'
    | 'nextFireAt';
  const updateColumns: readonly [ScalarPatchKey, string][] = [
    ['title', 'title'],
    ['prompt', 'prompt'],
    ['agent', 'agent'],
    ['model', 'model'],
    ['cron', 'cron'],
    ['timezone', 'timezone'],
    ['policy', 'policy'],
    ['maxCostUsd', 'max_cost_usd'],
    ['nextFireAt', 'next_fire_at'],
  ];

  return {
    get(id: string): Job | null {
      return findById(id);
    },

    list(filter: JobFilter): PageResult<Job> {
      const limit = Math.max(1, Math.trunc(filter.limit));
      const conditions: string[] = [];
      const parameters: (string | number)[] = [];
      if (filter.repoId !== undefined) {
        conditions.push('repo_id = ?');
        parameters.push(filter.repoId);
      }
      if (filter.enabled !== undefined) {
        conditions.push('enabled = ?');
        parameters.push(booleanToInteger(filter.enabled));
      }
      if (filter.cursor !== null) {
        const cursor = decodeCursor(filter.cursor);
        conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
        parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
      const values = db
        .prepare(`SELECT ${COLUMNS} FROM jobs ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
        .all(...parameters, limit + 1)
        .map((value) => jobFromRow(row(value)));
      const data = values.slice(0, limit);
      const last = data.at(-1);
      return {
        data,
        nextCursor:
          values.length > limit && last !== undefined
            ? encodeCursor(last.createdAt, last.id)
            : null,
      };
    },

    create(job: Job): Job {
      try {
        insert.run(
          job.id,
          job.repoId,
          job.title,
          job.prompt,
          job.mode,
          job.agent,
          job.model,
          job.cron,
          job.timezone,
          booleanToInteger(job.enabled),
          job.policy,
          job.nextFireAt,
          job.createdAt,
          job.createdAt,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError('unique_violation', 'job already exists');
        }
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'job repo does not exist');
        }
        throw error;
      }
      const created = findById(job.id);
      if (created === null) throw new StoreError('invalid_row', 'job was not stored');
      return created;
    },

    update(id: string, patch: JobPatch): Job {
      const assignments: string[] = [];
      const parameters: (string | number | null)[] = [];
      for (const [key, column] of updateColumns) {
        const value = patch[key];
        if (value !== undefined) {
          assignments.push(`${column} = ?`);
          parameters.push(value);
        }
      }
      if (patch.enabled !== undefined) {
        assignments.push('enabled = ?');
        parameters.push(booleanToInteger(patch.enabled));
      }
      if (assignments.length > 0) {
        try {
          db.prepare(`UPDATE jobs SET ${assignments.join(', ')} WHERE id = ?`).run(
            ...parameters,
            id,
          );
        } catch (error) {
          if (isForeignKeyViolation(error)) {
            throw new StoreError('foreign_key_violation', 'job reference is missing');
          }
          throw error;
        }
      }
      const updated = findById(id);
      if (updated === null) throw new StoreError('not_found', 'job not found');
      return updated;
    },

    delete(id: string): void {
      if (findById(id) === null) throw new StoreError('not_found', 'job not found');
      remove.run(id);
    },

    setNextFire(id: string, nextFireAt: string | null): void {
      const result = updateNextFire.run(nextFireAt, id);
      if (Number(result.changes) === 0) throw new StoreError('not_found', 'job not found');
    },

    listDue(at: string, limit: number): Job[] {
      return selectDue
        .all(at, Math.max(1, Math.trunc(limit)))
        .map((value) => jobFromRow(row(value)));
    },
  };
}

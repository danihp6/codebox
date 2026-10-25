import type { Routine, RoutineKind } from '@codebox/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { decodeCursor, encodeCursor, type PageResult } from './cursor.js';
import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from './db.js';
import { StoreError } from './errors.js';
import { booleanToInteger, row, routineFromRow } from './mappers.js';

export interface RoutineFilter {
  readonly kind?: RoutineKind;
  readonly enabled?: boolean;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface RoutinePatch {
  readonly title?: string;
  readonly cron?: string;
  readonly timezone?: string;
  readonly prompt?: string;
  readonly notify?: boolean;
  readonly enabled?: boolean;
  readonly chatSessionId?: string | null;
  readonly nextFireAt?: string | null;
  readonly lastFiredAt?: string | null;
}

export interface RoutineRepository {
  get(id: string): Routine | null;
  list(filter: RoutineFilter): PageResult<Routine>;
  create(routine: Routine): Routine;
  update(id: string, patch: RoutinePatch): Routine;
  delete(id: string): void;
  setNextFire(id: string, nextFireAt: string | null): void;
  /** enabled = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= at, oldest first. */
  listDue(at: string, limit: number): Routine[];
}

const COLUMNS = [
  'id',
  'kind',
  'title',
  'cron',
  'timezone',
  'enabled',
  'notify',
  'repo_id',
  'prompt',
  'chat_session_id',
  'next_fire_at',
  'last_fired_at',
  'created_at',
].join(', ');

type TextPatchKey =
  'title' | 'cron' | 'timezone' | 'prompt' | 'chatSessionId' | 'nextFireAt' | 'lastFiredAt';

const TEXT_COLUMNS: readonly [TextPatchKey, string][] = [
  ['title', 'title'],
  ['cron', 'cron'],
  ['timezone', 'timezone'],
  ['prompt', 'prompt'],
  ['chatSessionId', 'chat_session_id'],
  ['nextFireAt', 'next_fire_at'],
  ['lastFiredAt', 'last_fired_at'],
];

export function createRoutineRepository(db: DatabaseSync): RoutineRepository {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM routines WHERE id = ?`);
  const selectDue = db.prepare(`
    SELECT ${COLUMNS} FROM routines
    WHERE enabled = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= ?
    ORDER BY next_fire_at ASC, created_at ASC, id ASC
    LIMIT ?
  `);
  const insert = db.prepare(`
    INSERT INTO routines (
      id, kind, title, cron, timezone, enabled, notify, repo_id, prompt, chat_session_id,
      next_fire_at, last_fired_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const remove = db.prepare('DELETE FROM routines WHERE id = ?');
  const updateNextFire = db.prepare('UPDATE routines SET next_fire_at = ? WHERE id = ?');

  function findById(id: string): Routine | null {
    const value = selectById.get(id);
    return value === undefined ? null : routineFromRow(row(value));
  }

  return {
    get(id: string): Routine | null {
      return findById(id);
    },

    list(filter: RoutineFilter): PageResult<Routine> {
      const limit = Math.max(1, Math.trunc(filter.limit));
      const conditions: string[] = [];
      const parameters: (string | number)[] = [];
      if (filter.kind !== undefined) {
        conditions.push('kind = ?');
        parameters.push(filter.kind);
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
        .prepare(
          `SELECT ${COLUMNS} FROM routines ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(...parameters, limit + 1)
        .map((value) => routineFromRow(row(value)));
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

    create(routine: Routine): Routine {
      const prompt = routine.kind === 'prompt' ? routine : null;
      try {
        insert.run(
          routine.id,
          routine.kind,
          routine.title,
          routine.cron,
          routine.timezone,
          booleanToInteger(routine.enabled),
          booleanToInteger(routine.notify),
          prompt === null ? null : prompt.repoId,
          prompt === null ? null : prompt.prompt,
          prompt === null ? null : prompt.chatSessionId,
          routine.nextFireAt,
          routine.lastFiredAt,
          routine.createdAt,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError('unique_violation', 'routine already exists');
        }
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'routine reference is missing');
        }
        if (isCheckViolation(error)) {
          throw new StoreError('check_violation', 'routine violates a kind constraint');
        }
        throw error;
      }
      const created = findById(routine.id);
      if (created === null) throw new StoreError('invalid_row', 'routine was not stored');
      return created;
    },

    update(id: string, patch: RoutinePatch): Routine {
      const assignments: string[] = [];
      const parameters: (string | number | null)[] = [];
      for (const [key, column] of TEXT_COLUMNS) {
        const value = patch[key];
        if (value !== undefined) {
          assignments.push(`${column} = ?`);
          parameters.push(value);
        }
      }
      if (patch.notify !== undefined) {
        assignments.push('notify = ?');
        parameters.push(booleanToInteger(patch.notify));
      }
      if (patch.enabled !== undefined) {
        assignments.push('enabled = ?');
        parameters.push(booleanToInteger(patch.enabled));
      }
      if (assignments.length > 0) {
        try {
          db.prepare(`UPDATE routines SET ${assignments.join(', ')} WHERE id = ?`).run(
            ...parameters,
            id,
          );
        } catch (error) {
          if (isForeignKeyViolation(error)) {
            throw new StoreError('foreign_key_violation', 'routine reference is missing');
          }
          if (isCheckViolation(error)) {
            throw new StoreError('check_violation', 'routine violates a kind constraint');
          }
          throw error;
        }
      }
      const updated = findById(id);
      if (updated === null) throw new StoreError('not_found', 'routine not found');
      return updated;
    },

    delete(id: string): void {
      if (findById(id) === null) throw new StoreError('not_found', 'routine not found');
      remove.run(id);
    },

    setNextFire(id: string, nextFireAt: string | null): void {
      const result = updateNextFire.run(nextFireAt, id);
      if (Number(result.changes) === 0) throw new StoreError('not_found', 'routine not found');
    },

    listDue(at: string, limit: number): Routine[] {
      return selectDue
        .all(at, Math.max(1, Math.trunc(limit)))
        .map((value) => routineFromRow(row(value)));
    },
  };
}

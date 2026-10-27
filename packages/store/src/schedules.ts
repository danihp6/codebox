import type { Schedule } from '@codebox/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { decodeCursor, encodeCursor, type PageResult } from './cursor.js';
import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from './db.js';
import { StoreError } from './errors.js';
import { booleanToInteger, row, scheduleFromRow } from './mappers.js';

export interface ScheduleFilter {
  readonly repoId?: string;
  readonly enabled?: boolean;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface SchedulePatch {
  readonly title?: string;
  readonly prompt?: string;
  readonly mode?: 'once' | 'every' | 'window';
  readonly cron?: string | null;
  readonly timezone?: string;
  readonly windowStart?: string | null;
  readonly windowEnd?: string | null;
  readonly cooldownMinutes?: number;
  readonly maxFires?: number | null;
  readonly maxCostPerFireUsd?: number | null;
  readonly firePolicy?: 'new_chat' | 'continue';
  readonly chatSessionId?: string | null;
  readonly enabled?: boolean;
  readonly policy?: 'auto' | 'manual';
  readonly nextFireAt?: string | null;
  readonly lastFiredAt?: string | null;
}

export interface ScheduleRepository {
  get(id: string): Schedule | null;
  list(filter: ScheduleFilter): PageResult<Schedule>;
  create(schedule: Schedule): Schedule;
  update(id: string, patch: SchedulePatch): Schedule;
  delete(id: string): void;
  listDue(at: string, limit: number): Schedule[];
}

const COLUMNS = [
  'id',
  'repo_id',
  'chat_session_id',
  'title',
  'prompt',
  'mode',
  'cron',
  'timezone',
  'window_start',
  'window_end',
  'cooldown_minutes',
  'max_fires',
  'max_cost_per_fire_usd',
  'fire_policy',
  'consecutive_failures',
  'fires_count',
  'spend_usd',
  'enabled',
  'policy',
  'next_fire_at',
  'last_fired_at',
  'created_at',
  'updated_at',
].join(', ');

type ScalarPatchKey =
  'cron' | 'windowStart' | 'windowEnd' | 'maxFires' | 'nextFireAt' | 'lastFiredAt';

const TEXT_COLUMNS: readonly [ScalarPatchKey, string][] = [
  ['cron', 'cron'],
  ['windowStart', 'window_start'],
  ['windowEnd', 'window_end'],
  ['maxFires', 'max_fires'],
  ['nextFireAt', 'next_fire_at'],
  ['lastFiredAt', 'last_fired_at'],
];

type ValuePatchKey =
  | 'title'
  | 'prompt'
  | 'mode'
  | 'timezone'
  | 'cooldownMinutes'
  | 'maxCostPerFireUsd'
  | 'firePolicy'
  | 'chatSessionId'
  | 'policy';

const VALUE_COLUMNS: readonly [ValuePatchKey, string][] = [
  ['title', 'title'],
  ['prompt', 'prompt'],
  ['mode', 'mode'],
  ['timezone', 'timezone'],
  ['cooldownMinutes', 'cooldown_minutes'],
  ['maxCostPerFireUsd', 'max_cost_per_fire_usd'],
  ['firePolicy', 'fire_policy'],
  ['chatSessionId', 'chat_session_id'],
  ['policy', 'policy'],
];

// The frozen patch carries no timestamp, so the row's `updated_at` comes from SQLite itself,
// the same way `openStore` stamps the migration bookkeeping.
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export function createScheduleRepository(db: DatabaseSync): ScheduleRepository {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM schedules WHERE id = ?`);
  const selectDue = db.prepare(`
    SELECT ${COLUMNS} FROM schedules
    WHERE enabled = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= ?
    ORDER BY next_fire_at ASC, created_at ASC, id ASC
    LIMIT ?
  `);
  const insert = db.prepare(`
    INSERT INTO schedules (
      id, repo_id, chat_session_id, title, prompt, mode, cron, timezone, window_start,
      window_end, cooldown_minutes, max_fires, max_cost_per_fire_usd, fire_policy,
      consecutive_failures, fires_count, spend_usd, enabled, policy, next_fire_at,
      last_fired_at, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  const remove = db.prepare('DELETE FROM schedules WHERE id = ?');

  function findById(id: string): Schedule | null {
    const value = selectById.get(id);
    return value === undefined ? null : scheduleFromRow(row(value));
  }

  function stored(id: string): Schedule {
    const value = findById(id);
    if (value === null) throw new StoreError('not_found', 'schedule not found');
    return value;
  }

  return {
    get(id: string): Schedule | null {
      return findById(id);
    },

    list(filter: ScheduleFilter): PageResult<Schedule> {
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
        .prepare(
          `SELECT ${COLUMNS} FROM schedules ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(...parameters, limit + 1)
        .map((value) => scheduleFromRow(row(value)));
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

    create(schedule: Schedule): Schedule {
      try {
        insert.run(
          schedule.id,
          schedule.repoId,
          schedule.chatSessionId,
          schedule.title,
          schedule.prompt,
          schedule.mode,
          schedule.cron,
          schedule.timezone,
          schedule.windowStart,
          schedule.windowEnd,
          schedule.cooldownMinutes,
          schedule.maxFires,
          schedule.maxCostPerFireUsd,
          schedule.firePolicy,
          schedule.consecutiveFailures,
          schedule.firesCount,
          schedule.spendUsd,
          booleanToInteger(schedule.enabled),
          schedule.policy,
          schedule.nextFireAt,
          schedule.lastFiredAt,
          schedule.createdAt,
          schedule.updatedAt,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError('unique_violation', 'schedule already exists');
        }
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'schedule reference is missing');
        }
        if (isCheckViolation(error)) {
          throw new StoreError('check_violation', 'schedule violates a mode constraint');
        }
        throw error;
      }
      return stored(schedule.id);
    },

    update(id: string, patch: SchedulePatch): Schedule {
      const assignments: string[] = [];
      const parameters: (string | number | null)[] = [];
      for (const [key, column] of TEXT_COLUMNS) {
        const value = patch[key];
        if (value !== undefined) {
          assignments.push(`${column} = ?`);
          parameters.push(value);
        }
      }
      for (const [key, column] of VALUE_COLUMNS) {
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
      assignments.push(`updated_at = ${NOW}`);
      try {
        db.prepare(`UPDATE schedules SET ${assignments.join(', ')} WHERE id = ?`).run(
          ...parameters,
          id,
        );
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'schedule reference is missing');
        }
        if (isCheckViolation(error)) {
          throw new StoreError('check_violation', 'schedule violates a mode constraint');
        }
        throw error;
      }
      return stored(id);
    },

    delete(id: string): void {
      if (findById(id) === null) throw new StoreError('not_found', 'schedule not found');
      remove.run(id);
    },

    listDue(at: string, limit: number): Schedule[] {
      return selectDue
        .all(at, Math.max(1, Math.trunc(limit)))
        .map((value) => scheduleFromRow(row(value)));
    },
  };
}

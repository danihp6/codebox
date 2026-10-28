import type { RepoSchedule, Selection } from '@codebox/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { decodeCursor, encodeCursor, type PageResult } from './cursor.js';
import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from './db.js';
import { StoreError } from './errors.js';
import { booleanToInteger, jsonText, repoScheduleFromRow, row } from './mappers.js';

type RepoScheduleMode = RepoSchedule['mode'];

export interface RepoScheduleFilter {
  readonly repoId?: string;
  readonly enabled?: boolean;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface RepoSchedulePatch {
  readonly mode?: RepoScheduleMode;
  readonly cron?: string | null;
  readonly timezone?: string;
  readonly windowStart?: string | null;
  readonly windowEnd?: string | null;
  readonly cooldownMinutes?: number;
  readonly selection?: Selection;
  readonly refs?: readonly string[];
  readonly maxAttempts?: number;
  readonly maxFires?: number | null;
  readonly maxCostPerFireUsd?: number | null;
  readonly consecutiveFailures?: number;
  readonly firesCount?: number;
  readonly spendUsd?: number;
  readonly enabled?: boolean;
  readonly nextFireAt?: string | null;
  readonly lastFiredAt?: string | null;
  readonly updatedAt: string;
}

export interface RepoScheduleRepository {
  get(id: string): RepoSchedule | null;
  /** At most one per repository; `null` when the repository has none. */
  getByRepo(repoId: string): RepoSchedule | null;
  list(filter: RepoScheduleFilter): PageResult<RepoSchedule>;
  create(schedule: RepoSchedule): RepoSchedule;
  update(id: string, patch: RepoSchedulePatch): RepoSchedule;
  delete(id: string): void;
  listDue(at: string, limit: number): RepoSchedule[];
}

// A D56 schedule has no title, prompt, chat or policy. The legacy columns of 0004_schedules
// stay NOT NULL until the legacy /v1/schedules accessors are removed; the sentinels keep them
// readable instead of throwing in the legacy mapper.
const LEGACY_DEFAULTS = { title: '', prompt: '', firePolicy: 'new_chat', policy: 'auto' };

const COLUMNS = [
  'id',
  'repo_id',
  'mode',
  'cron',
  'timezone',
  'window_start',
  'window_end',
  'cooldown_minutes',
  'selection',
  'refs',
  'max_attempts',
  'max_fires',
  'max_cost_per_fire_usd',
  'consecutive_failures',
  'fires_count',
  'spend_usd',
  'enabled',
  'next_fire_at',
  'last_fired_at',
  'created_at',
  'updated_at',
].join(', ');

const TEXT_COLUMNS: readonly [keyof RepoSchedulePatch, string][] = [
  ['cron', 'cron'],
  ['timezone', 'timezone'],
  ['windowStart', 'window_start'],
  ['windowEnd', 'window_end'],
  ['maxAttempts', 'max_attempts'],
  ['maxFires', 'max_fires'],
  ['nextFireAt', 'next_fire_at'],
  ['lastFiredAt', 'last_fired_at'],
];

const VALUE_COLUMNS: readonly [keyof RepoSchedulePatch, string][] = [
  ['mode', 'mode'],
  ['cooldownMinutes', 'cooldown_minutes'],
  ['selection', 'selection'],
  ['maxCostPerFireUsd', 'max_cost_per_fire_usd'],
  ['consecutiveFailures', 'consecutive_failures'],
  ['firesCount', 'fires_count'],
  ['spendUsd', 'spend_usd'],
];

export function createRepoScheduleRepository(db: DatabaseSync): RepoScheduleRepository {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM schedules WHERE id = ?`);
  const selectByRepo = db.prepare(
    `SELECT ${COLUMNS} FROM schedules
     WHERE repo_id = ? AND title = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
  );
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
      last_fired_at, created_at, updated_at, selection, refs, max_attempts
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  const remove = db.prepare('DELETE FROM schedules WHERE id = ?');

  function findById(id: string): RepoSchedule | null {
    const value = selectById.get(id);
    return value === undefined ? null : repoScheduleFromRow(row(value));
  }

  function stored(id: string): RepoSchedule {
    const value = findById(id);
    if (value === null) throw new StoreError('not_found', 'schedule not found');
    return value;
  }

  return {
    get(id: string): RepoSchedule | null {
      return findById(id);
    },

    getByRepo(repoId: string): RepoSchedule | null {
      const value = selectByRepo.get(repoId, LEGACY_DEFAULTS.title);
      return value === undefined ? null : repoScheduleFromRow(row(value));
    },

    list(filter: RepoScheduleFilter): PageResult<RepoSchedule> {
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
        .map((value) => repoScheduleFromRow(row(value)));
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

    create(schedule: RepoSchedule): RepoSchedule {
      try {
        insert.run(
          schedule.id,
          schedule.repoId,
          null,
          LEGACY_DEFAULTS.title,
          LEGACY_DEFAULTS.prompt,
          schedule.mode,
          schedule.cron,
          schedule.timezone,
          schedule.windowStart,
          schedule.windowEnd,
          schedule.cooldownMinutes,
          schedule.maxFires,
          schedule.maxCostPerFireUsd,
          LEGACY_DEFAULTS.firePolicy,
          schedule.consecutiveFailures,
          schedule.firesCount,
          schedule.spendUsd,
          booleanToInteger(schedule.enabled),
          LEGACY_DEFAULTS.policy,
          schedule.nextFireAt,
          schedule.lastFiredAt,
          schedule.createdAt,
          schedule.updatedAt,
          schedule.selection,
          jsonText(schedule.refs),
          schedule.maxAttempts,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError('unique_violation', 'schedule already exists for this repository');
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

    update(id: string, patch: RepoSchedulePatch): RepoSchedule {
      if (findById(id) === null) throw new StoreError('not_found', 'schedule not found');
      const assignments: string[] = [];
      const parameters: (string | number | null)[] = [];
      for (const [key, column] of TEXT_COLUMNS) {
        const value = patch[key];
        if (value !== undefined) {
          assignments.push(`${column} = ?`);
          parameters.push(value as string | number | null);
        }
      }
      for (const [key, column] of VALUE_COLUMNS) {
        const value = patch[key];
        if (value !== undefined) {
          assignments.push(`${column} = ?`);
          parameters.push(value as string | number | null);
        }
      }
      if (patch.refs !== undefined) {
        assignments.push('refs = ?');
        parameters.push(jsonText(patch.refs));
      }
      if (patch.enabled !== undefined) {
        assignments.push('enabled = ?');
        parameters.push(booleanToInteger(patch.enabled));
      }
      assignments.push('updated_at = ?');
      parameters.push(patch.updatedAt);
      try {
        db.prepare(`UPDATE schedules SET ${assignments.join(', ')} WHERE id = ?`).run(
          ...parameters,
          id,
        );
      } catch (error) {
        if (isCheckViolation(error)) {
          throw new StoreError('check_violation', 'schedule violates a mode constraint');
        }
        if (isUniqueViolation(error)) {
          throw new StoreError('unique_violation', 'schedule already exists for this repository');
        }
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'schedule reference is missing');
        }
        throw error;
      }
      return stored(id);
    },

    delete(id: string): void {
      if (findById(id) === null) throw new StoreError('not_found', 'schedule not found');
      remove.run(id);
    },

    listDue(at: string, limit: number): RepoSchedule[] {
      return selectDue
        .all(at, Math.max(1, Math.trunc(limit)))
        .map((value) => repoScheduleFromRow(row(value)));
    },
  };
}

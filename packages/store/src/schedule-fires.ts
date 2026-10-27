import type { DatabaseSync } from 'node:sqlite';
import { isUniqueViolation, withTransaction } from './db.js';
import { StoreError } from './errors.js';
import { integerColumn, nullableTextColumn, row, scheduleFireFromRow } from './mappers.js';

export interface ClaimScheduleFireInput {
  readonly scheduleId: string;
  readonly scheduledFor: string;
  readonly firedAt: string;
  readonly nextFireAt: string | null;
}

export interface FinishScheduleFireInput {
  readonly outcome: 'fired' | 'failed';
  readonly costUsd: number;
  readonly runId: string | null;
  readonly chatId: string | null;
  readonly detail: string | null;
}

export interface ScheduleFireRepository {
  /** One transaction; `null` when the row lost the race (the schedule moved or is disabled). */
  claim(input: ClaimScheduleFireInput): ScheduleFireRecord | null;
  /** Like `claim` but records `skipped` and leaves `last_fired_at` alone. */
  skip(input: ClaimScheduleFireInput): ScheduleFireRecord | null;
  finish(fireId: number, input: FinishScheduleFireInput): ScheduleFireRecord;
  listBySchedule(scheduleId: string, limit: number): ScheduleFireRecord[];
}

export interface ScheduleFireRecord {
  readonly id: number;
  readonly scheduleId: string;
  readonly scheduledFor: string;
  readonly firedAt: string;
  readonly outcome: 'claimed' | 'fired' | 'skipped' | 'failed';
  readonly runId: string | null;
  readonly chatId: string | null;
  readonly costUsd: number;
  readonly detail: string | null;
}

const COLUMNS =
  'id, schedule_id, scheduled_for, fired_at, outcome, run_id, chat_id, cost_usd, detail';

export function createScheduleFireRepository(db: DatabaseSync): ScheduleFireRepository {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM schedule_fires WHERE id = ?`);
  const selectBySchedule = db.prepare(`
    SELECT ${COLUMNS} FROM schedule_fires WHERE schedule_id = ?
    ORDER BY fired_at DESC, id DESC LIMIT ?
  `);
  const selectSchedule = db.prepare('SELECT enabled, next_fire_at FROM schedules WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO schedule_fires (schedule_id, scheduled_for, fired_at, outcome)
    VALUES (?, ?, ?, ?)
  `);
  const claimSchedule = db.prepare(`
    UPDATE schedules
    SET next_fire_at = ?, last_fired_at = ?, fires_count = fires_count + 1, updated_at = ?
    WHERE id = ?
  `);
  const skipSchedule = db.prepare(
    'UPDATE schedules SET next_fire_at = ?, updated_at = ? WHERE id = ?',
  );
  const finishRow = db.prepare(`
    UPDATE schedule_fires
    SET outcome = ?, cost_usd = ?, run_id = ?, chat_id = ?, detail = ?
    WHERE id = ?
  `);
  const finishSchedule = db.prepare(`
    UPDATE schedules
    SET spend_usd = spend_usd + ?,
        consecutive_failures = CASE WHEN ? = 'failed' THEN consecutive_failures + 1 ELSE 0 END
    WHERE id = ?
  `);

  function findById(id: number): ScheduleFireRecord | null {
    const value = selectById.get(id);
    return value === undefined ? null : scheduleFireFromRow(row(value));
  }

  function stored(id: number): ScheduleFireRecord {
    const value = findById(id);
    if (value === null) throw new StoreError('not_found', 'schedule fire not found');
    return value;
  }

  function claimWith(
    outcome: 'claimed' | 'skipped',
    input: ClaimScheduleFireInput,
  ): ScheduleFireRecord | null {
    return withTransaction(db, () => {
      const schedule = selectSchedule.get(input.scheduleId);
      if (schedule === undefined) return null;
      if (integerColumn(row(schedule), 'enabled') !== 1) return null;
      if (nullableTextColumn(row(schedule), 'next_fire_at') !== input.scheduledFor) return null;
      let fireId: number;
      try {
        const result = insert.run(input.scheduleId, input.scheduledFor, input.firedAt, outcome);
        fireId = Number(result.lastInsertRowid);
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
      if (outcome === 'claimed') {
        claimSchedule.run(input.nextFireAt, input.firedAt, input.firedAt, input.scheduleId);
      } else {
        skipSchedule.run(input.nextFireAt, input.firedAt, input.scheduleId);
      }
      return stored(fireId);
    });
  }

  return {
    claim(input: ClaimScheduleFireInput): ScheduleFireRecord | null {
      return claimWith('claimed', input);
    },

    skip(input: ClaimScheduleFireInput): ScheduleFireRecord | null {
      return claimWith('skipped', input);
    },

    finish(fireId: number, input: FinishScheduleFireInput): ScheduleFireRecord {
      return withTransaction(db, () => {
        const result = finishRow.run(
          input.outcome,
          input.costUsd,
          input.runId,
          input.chatId,
          input.detail,
          fireId,
        );
        if (Number(result.changes) === 0) {
          throw new StoreError('not_found', 'schedule fire not found');
        }
        const fire = stored(fireId);
        finishSchedule.run(input.costUsd, input.outcome, fire.scheduleId);
        return stored(fireId);
      });
    },

    listBySchedule(scheduleId: string, limit: number): ScheduleFireRecord[] {
      return selectBySchedule
        .all(scheduleId, Math.max(1, Math.trunc(limit)))
        .map((value) => scheduleFireFromRow(row(value)));
    },
  };
}

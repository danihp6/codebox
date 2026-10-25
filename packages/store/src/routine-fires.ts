import type { DatabaseSync } from 'node:sqlite';
import { isUniqueViolation, withTransaction } from './db.js';
import { StoreError } from './errors.js';
import { integerColumn, nullableTextColumn, row, routineFireFromRow } from './mappers.js';

export type RoutineFireOutcome = 'claimed' | 'sent' | 'replied' | 'failed' | 'skipped';

export interface RoutineFireRecord {
  readonly id: number;
  readonly routineId: string;
  readonly scheduledFor: string;
  readonly firedAt: string;
  readonly outcome: RoutineFireOutcome;
  readonly detail: string | null;
}

export interface ClaimRoutineFireInput {
  readonly routineId: string;
  readonly scheduledFor: string;
  readonly firedAt: string;
  readonly nextFireAt: string | null;
  readonly detail?: string | null;
}

export interface RoutineFireRepository {
  /** `null` when the routine is missing, disabled, already moved past `scheduledFor`, or the pair is taken. */
  claim(input: ClaimRoutineFireInput): RoutineFireRecord | null;
  /** Same guard, `outcome: 'skipped'`, and `last_fired_at` is left alone. */
  skip(input: ClaimRoutineFireInput): RoutineFireRecord | null;
  finish(
    fireId: number,
    outcome: Exclude<RoutineFireOutcome, 'claimed' | 'skipped'>,
    detail: string | null,
  ): RoutineFireRecord;
  get(id: number): RoutineFireRecord | null;
  getByScheduled(routineId: string, scheduledFor: string): RoutineFireRecord | null;
  listByRoutine(routineId: string, limit: number): RoutineFireRecord[];
  latest(routineId: string): RoutineFireRecord | null;
}

const COLUMNS = 'id, routine_id, scheduled_for, fired_at, outcome, detail';

export function createRoutineFireRepository(db: DatabaseSync): RoutineFireRepository {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM routine_fires WHERE id = ?`);
  const selectByScheduled = db.prepare(
    `SELECT ${COLUMNS} FROM routine_fires WHERE routine_id = ? AND scheduled_for = ?`,
  );
  const selectByRoutine = db.prepare(`
    SELECT ${COLUMNS} FROM routine_fires WHERE routine_id = ?
    ORDER BY scheduled_for DESC, id DESC LIMIT ?
  `);
  const selectLatest = db.prepare(`
    SELECT ${COLUMNS} FROM routine_fires WHERE routine_id = ?
    ORDER BY scheduled_for DESC, id DESC LIMIT 1
  `);
  const selectRoutine = db.prepare('SELECT enabled, next_fire_at FROM routines WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO routine_fires (routine_id, scheduled_for, fired_at, outcome, detail)
    VALUES (?, ?, ?, ?, ?)
  `);
  const claimRoutine = db.prepare(
    'UPDATE routines SET next_fire_at = ?, last_fired_at = ? WHERE id = ?',
  );
  const skipRoutine = db.prepare('UPDATE routines SET next_fire_at = ? WHERE id = ?');
  const finishRow = db.prepare('UPDATE routine_fires SET outcome = ?, detail = ? WHERE id = ?');

  function findById(id: number): RoutineFireRecord | null {
    const value = selectById.get(id);
    return value === undefined ? null : routineFireFromRow(row(value));
  }

  function claimWith(
    outcome: 'claimed' | 'skipped',
    input: ClaimRoutineFireInput,
  ): RoutineFireRecord | null {
    return withTransaction(db, () => {
      const routine = selectRoutine.get(input.routineId);
      if (routine === undefined) return null;
      if (integerColumn(row(routine), 'enabled') !== 1) return null;
      if (nullableTextColumn(row(routine), 'next_fire_at') !== input.scheduledFor) return null;
      let fireId: number;
      try {
        const result = insert.run(
          input.routineId,
          input.scheduledFor,
          input.firedAt,
          outcome,
          input.detail ?? null,
        );
        fireId = Number(result.lastInsertRowid);
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
      if (outcome === 'claimed') {
        claimRoutine.run(input.nextFireAt, input.firedAt, input.routineId);
      } else {
        skipRoutine.run(input.nextFireAt, input.routineId);
      }
      const fire = findById(fireId);
      if (fire === null) throw new StoreError('invalid_row', 'routine fire was not stored');
      return fire;
    });
  }

  return {
    claim(input: ClaimRoutineFireInput): RoutineFireRecord | null {
      return claimWith('claimed', input);
    },

    skip(input: ClaimRoutineFireInput): RoutineFireRecord | null {
      return claimWith('skipped', input);
    },

    finish(
      fireId: number,
      outcome: Exclude<RoutineFireOutcome, 'claimed' | 'skipped'>,
      detail: string | null,
    ): RoutineFireRecord {
      const result = finishRow.run(outcome, detail, fireId);
      if (Number(result.changes) === 0) throw new StoreError('not_found', 'routine fire not found');
      const fire = findById(fireId);
      if (fire === null) throw new StoreError('not_found', 'routine fire not found');
      return fire;
    },

    get(id: number): RoutineFireRecord | null {
      return findById(id);
    },

    getByScheduled(routineId: string, scheduledFor: string): RoutineFireRecord | null {
      const value = selectByScheduled.get(routineId, scheduledFor);
      return value === undefined ? null : routineFireFromRow(row(value));
    },

    listByRoutine(routineId: string, limit: number): RoutineFireRecord[] {
      return selectByRoutine
        .all(routineId, Math.max(1, Math.trunc(limit)))
        .map((value) => routineFireFromRow(row(value)));
    },

    latest(routineId: string): RoutineFireRecord | null {
      const value = selectLatest.get(routineId);
      return value === undefined ? null : routineFireFromRow(row(value));
    },
  };
}

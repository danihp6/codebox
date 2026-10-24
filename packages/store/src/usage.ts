import type { DatabaseSync } from 'node:sqlite';
import { isForeignKeyViolation } from './db.js';
import { StoreError } from './errors.js';
import {
  integerColumn,
  nullableTextColumn,
  realColumn,
  row,
  textColumn,
  usageFromRow,
} from './mappers.js';

export interface UsageRecord {
  readonly id: number;
  readonly runId: string | null;
  readonly repoId: string | null;
  readonly day: string;
  readonly model: string | null;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
  readonly createdAt: string;
}

export interface UsageAggregate {
  readonly day: string;
  readonly repoId: string | null;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
  readonly runs: number;
}

export interface UsageRepository {
  record(input: Omit<UsageRecord, 'id'>): UsageRecord;
  spendOnDay(day: string): number;
  listByDay(day: string): UsageRecord[];
  aggregate(fromDay: string, toDay: string): readonly UsageAggregate[];
}

const COLUMNS = 'id, run_id, repo_id, day, model, tokens_in, tokens_out, cost_usd, created_at';

export function createUsageRepository(db: DatabaseSync): UsageRepository {
  const insert = db.prepare(`
    INSERT INTO usage (run_id, repo_id, day, model, tokens_in, tokens_out, cost_usd, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM usage WHERE id = ?`);
  const sumDay = db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS spend FROM usage WHERE day = ?');
  const selectDay = db.prepare(`SELECT ${COLUMNS} FROM usage WHERE day = ? ORDER BY id ASC`);
  const groupDays = db.prepare(`
    SELECT day, repo_id, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out,
           SUM(cost_usd) AS cost_usd, COUNT(DISTINCT run_id) AS runs
    FROM usage WHERE day >= ? AND day <= ?
    GROUP BY day, repo_id
    ORDER BY day ASC, repo_id ASC
  `);

  return {
    record(input: Omit<UsageRecord, 'id'>): UsageRecord {
      let inserted;
      try {
        inserted = insert.run(
          input.runId,
          input.repoId,
          input.day,
          input.model,
          input.tokensIn,
          input.tokensOut,
          input.costUsd,
          input.createdAt,
        );
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'usage run does not exist');
        }
        throw error;
      }
      const value = selectById.get(Number(inserted.lastInsertRowid));
      if (value === undefined) throw new StoreError('invalid_row', 'usage was not stored');
      return usageFromRow(row(value));
    },

    spendOnDay(day: string): number {
      const value = sumDay.get(day)?.['spend'];
      return value === null || value === undefined ? 0 : Number(value);
    },

    listByDay(day: string): UsageRecord[] {
      return selectDay.all(day).map((value) => usageFromRow(row(value)));
    },

    aggregate(fromDay: string, toDay: string): readonly UsageAggregate[] {
      return groupDays.all(fromDay, toDay).map((value) => {
        const rowValue = row(value);
        return {
          day: textColumn(rowValue, 'day'),
          repoId: nullableTextColumn(rowValue, 'repo_id'),
          tokensIn: integerColumn(rowValue, 'tokens_in'),
          tokensOut: integerColumn(rowValue, 'tokens_out'),
          costUsd: realColumn(rowValue, 'cost_usd'),
          runs: integerColumn(rowValue, 'runs'),
        };
      });
    },
  };
}

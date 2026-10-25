import { DatabaseSync } from 'node:sqlite';
import { StoreError } from './errors.js';

export interface OpenDatabaseOptions {
  readonly path: string;
  readonly busyTimeoutMs?: number;
}

const DEFAULT_BUSY_TIMEOUT_MS = 5000;

function normaliseBusyTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return DEFAULT_BUSY_TIMEOUT_MS;
  return Math.trunc(value);
}

export function openDatabase(options: OpenDatabaseOptions): DatabaseSync {
  const db = new DatabaseSync(options.path, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  // The pragma takes no bound parameter; the value is normalised to a non-negative integer.
  db.exec(`PRAGMA busy_timeout = ${normaliseBusyTimeout(options.busyTimeoutMs)}`);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function withTransaction<T>(db: DatabaseSync, run: () => T): T {
  if (db.isTransaction) {
    throw new StoreError('nested_transaction', 'a transaction is already open on this database');
  }
  db.exec('BEGIN IMMEDIATE');
  let result: T;
  try {
    result = run();
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Older drivers auto-rollback some failures; the original error is the one that matters.
    }
    throw error;
  }
  try {
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // See above: the COMMIT failure is the error worth reporting.
    }
    throw error;
  }
  return result;
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('FOREIGN KEY constraint failed');
}

export function isCheckViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('CHECK constraint failed');
}

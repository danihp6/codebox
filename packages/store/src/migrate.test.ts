import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db.js';
import { StoreError } from './errors.js';
import { MIGRATIONS_DIRECTORY, loadMigrationsFromDisk, runMigrations } from './migrate.js';

const TABLES = [
  'repos',
  'jobs',
  'chat_sessions',
  'chat_messages',
  'runs',
  'run_events',
  'approvals',
  'devices',
  'settings',
  'usage',
  'routines',
  'routine_fires',
];

const INDEXES = [
  'jobs_due',
  'runs_repo_created',
  'runs_state',
  'runs_job_created',
  'run_events_run_seq',
  'run_events_chat_seq',
  'run_events_ts',
  'approvals_state',
  'chat_messages_chat',
  'chat_sessions_repo',
  'devices_revoked',
  'usage_day_repo',
  'usage_run',
  'routines_due',
  'routines_created',
  'routine_fires_routine',
];

const FIXED_NOW = '2026-10-24T18:03:11.000Z';

function names(db: DatabaseSync, type: string): string[] {
  return db
    .prepare('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name')
    .all(type)
    .map((value) => String(value['name']));
}

function storeErrorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof StoreError ? error.code : 'unexpected-error';
  }
  return 'no-error';
}

function migrationDirectory(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'codebox-store-migrations-'));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(directory, name), sql);
  return directory;
}

let directory: string;
let db: DatabaseSync;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'codebox-store-migrate-'));
  db = openDatabase({ path: join(directory, 'state.db') });
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('migrations', () => {
  it('migrations apply to an empty database and are idempotent', () => {
    const files = loadMigrationsFromDisk(MIGRATIONS_DIRECTORY);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.map((file) => file.version)).toEqual([1, 2]);

    const first = runMigrations(db, files, () => FIXED_NOW);
    expect(first.applied.map((migration) => migration.version)).toEqual([1, 2]);
    expect(first.currentVersion).toBe(2);
    expect(first.applied.map((migration) => migration.name)).toEqual([
      '0001_init.sql',
      '0002_routines.sql',
    ]);

    const userVersion = db.prepare('PRAGMA user_version').get()?.['user_version'];
    expect(Number(userVersion)).toBe(2);

    const tables = names(db, 'table');
    for (const table of TABLES) expect(tables).toContain(table);
    expect(tables).toContain('schema_migrations');
    const indexes = names(db, 'index');
    for (const index of INDEXES) expect(indexes).toContain(index);

    const second = runMigrations(db, files, () => FIXED_NOW);
    expect(second.applied).toEqual([]);
    expect(second.currentVersion).toBe(2);

    const tampered = files.map((file) =>
      file.version === 2 ? { ...file, checksum: 'deadbeef' } : file,
    );
    let code = 'no-error';
    try {
      runMigrations(db, tampered, () => FIXED_NOW);
    } catch (error) {
      code = error instanceof StoreError ? error.code : 'unexpected-error';
    }
    expect(code).toBe('migration_checksum');
  });

  it('hashes the file bytes and sorts by version', () => {
    const files = loadMigrationsFromDisk(MIGRATIONS_DIRECTORY);
    const init = files[0];
    expect(init).toBeDefined();
    if (init === undefined) return;
    expect(init.checksum).toMatch(/^[0-9a-f]{64}$/);
    const expected = createHash('sha256').update(init.sql, 'utf8').digest('hex');
    expect(init.checksum).toBe(expected);
  });

  it('ignores files that are not SQL and rejects a SQL name that breaks the pattern', () => {
    const withReadme = migrationDirectory({ 'README.md': '# notes\n' });
    const mismatched = migrationDirectory({ 'init.sql': 'SELECT 1;' });
    try {
      expect(loadMigrationsFromDisk(withReadme)).toEqual([]);
      expect(storeErrorCode(() => loadMigrationsFromDisk(mismatched))).toBe('migration_invalid');
    } finally {
      rmSync(withReadme, { recursive: true, force: true });
      rmSync(mismatched, { recursive: true, force: true });
    }
  });

  it('rejects duplicate and non-contiguous versions', () => {
    const gap = migrationDirectory({ '0002_second.sql': 'SELECT 1;' });
    const duplicate = migrationDirectory({
      '0001_first.sql': 'SELECT 1;',
      '0001_again.sql': 'SELECT 1;',
    });
    try {
      expect(storeErrorCode(() => loadMigrationsFromDisk(gap))).toBe('migration_invalid');
      expect(storeErrorCode(() => loadMigrationsFromDisk(duplicate))).toBe('migration_invalid');
    } finally {
      rmSync(gap, { recursive: true, force: true });
      rmSync(duplicate, { recursive: true, force: true });
    }
  });

  it('rolls a failing migration back and leaves the bookkeeping untouched', () => {
    const broken = migrationDirectory({ '0001_broken.sql': 'CREATE TABLE broken (;' });
    try {
      const files = loadMigrationsFromDisk(broken);
      expect(storeErrorCode(() => runMigrations(db, files, () => FIXED_NOW))).toBe(
        'migration_failed',
      );
      const applied = db.prepare('SELECT COUNT(*) AS total FROM schema_migrations').get();
      expect(Number(applied?.['total'])).toBe(0);
      expect(names(db, 'table')).toEqual(['schema_migrations']);
      expect(Number(db.prepare('PRAGMA user_version').get()?.['user_version'])).toBe(0);
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });
});

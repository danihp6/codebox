import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { withTransaction } from './db.js';
import { StoreError } from './errors.js';

export interface MigrationFile {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

export interface MigrationReport {
  readonly applied: readonly AppliedMigration[];
  readonly currentVersion: number;
}

const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

export const MIGRATIONS_DIRECTORY: string = fileURLToPath(
  new URL('../migrations/', import.meta.url),
);

function assertSequence(files: readonly MigrationFile[]): void {
  const seen = new Set<number>();
  files.forEach((file, index) => {
    if (seen.has(file.version)) {
      throw new StoreError('migration_invalid', `duplicate migration version ${file.version}`);
    }
    seen.add(file.version);
    if (file.version !== index + 1) {
      throw new StoreError(
        'migration_invalid',
        `migration versions must be contiguous from 1, found ${file.version} at position ${index + 1}`,
      );
    }
  });
}

export function loadMigrationsFromDisk(directory: string): readonly MigrationFile[] {
  const files: MigrationFile[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
    const match = FILE_PATTERN.exec(entry.name);
    if (match === null) {
      throw new StoreError('migration_invalid', `invalid migration file name: ${entry.name}`);
    }
    const version = Number.parseInt(match[1] ?? '', 10);
    const bytes = readFileSync(join(directory, entry.name));
    files.push({
      version,
      name: entry.name,
      sql: bytes.toString('utf8'),
      checksum: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  files.sort((left, right) => left.version - right.version);
  assertSequence(files);
  return files;
}

function ensureBookkeeping(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

function appliedMigrations(db: DatabaseSync): AppliedMigration[] {
  const rows = db
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
    .all();
  return rows.map((value) => ({
    version: Number(value['version']),
    name: String(value['name']),
    checksum: String(value['checksum']),
  }));
}

function currentVersion(db: DatabaseSync): number {
  const result = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get();
  return Number(result?.['version'] ?? 0);
}

export function runMigrations(
  db: DatabaseSync,
  files: readonly MigrationFile[],
  now: () => string,
): MigrationReport {
  const ordered = [...files].sort((left, right) => left.version - right.version);
  assertSequence(ordered);
  ensureBookkeeping(db);

  const applied = appliedMigrations(db);
  const appliedByVersion = new Map(applied.map((migration) => [migration.version, migration]));
  for (const file of ordered) {
    const existing = appliedByVersion.get(file.version);
    if (existing !== undefined && existing.checksum !== file.checksum) {
      throw new StoreError(
        'migration_checksum',
        `migration ${file.version} (${file.name}) was already applied with a different checksum`,
      );
    }
  }

  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );
  const newlyApplied: AppliedMigration[] = [];
  for (const file of ordered) {
    if (appliedByVersion.has(file.version)) continue;
    const record: AppliedMigration = {
      version: file.version,
      name: file.name,
      checksum: file.checksum,
    };
    // A table rebuild needs the foreign keys off, and the pragma is a no-op inside a
    // transaction, so it is set before the BEGIN and restored in `finally` either way.
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      withTransaction(db, () => {
        db.exec(file.sql);
        const violations = db.prepare('PRAGMA foreign_key_check').all();
        if (violations.length > 0) {
          throw new StoreError(
            'migration_failed',
            `migration ${file.version} left ${violations.length} foreign key violations`,
          );
        }
        insert.run(file.version, file.name, file.checksum, now());
      });
    } catch (error) {
      if (error instanceof StoreError) throw error;
      throw new StoreError('migration_failed', `migration ${file.version} (${file.name}) failed`);
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    newlyApplied.push(record);
  }

  const version = currentVersion(db);
  db.exec(`PRAGMA user_version = ${version}`);
  return { applied: newlyApplied, currentVersion: version };
}

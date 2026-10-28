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
  'schedules',
  'schedule_fires',
  'works',
  'sessions',
  'session_messages',
  'schema_legacy',
  'providers',
  'provider_accounts',
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
  'chat_sessions_kind',
  'devices_revoked',
  'usage_day_repo',
  'usage_run',
  'routines_due',
  'routines_created',
  'routine_fires_routine',
  'schedules_due',
  'schedules_repo',
  'schedule_fires_schedule',
  'works_repo_state',
  'works_repo_backlog',
  'works_live_item',
  'sessions_repo',
  'sessions_target',
  'sessions_work',
  'session_messages_session',
  'schedules_one_per_repo',
  'runs_work_created',
  'run_events_work_seq',
  'run_events_session_seq',
  'provider_accounts_credential',
  'provider_accounts_selection',
  'provider_accounts_reset',
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

function countOf(db: DatabaseSync, table: string): number {
  return Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get()?.['total']);
}

/** Two bound chats plus one row in every child table that names `chat_sessions`. */
function seedChildren(target: DatabaseSync): void {
  target.exec(`
    INSERT INTO repos (id, slug, default_branch, gate, policy, protected_paths, enabled, created_at)
    VALUES ('repo_000001', 'acme/widgets', 'main', 'npm test', 'auto', '[]', 1, '${FIXED_NOW}');

    INSERT INTO chat_sessions (
      id, repo_id, title, status, opencode_session_id, worktree, created_at, updated_at,
      kind, usage_usd, usage_tokens_in, usage_tokens_out, context_tokens, context_epoch, reviewed_at
    ) VALUES (
      'chat_000001', 'repo_000001', 'First', 'idle', 'ses_1', '/tmp/wt-1', '${FIXED_NOW}', '${FIXED_NOW}',
      'repo', 0.5, 100, 20, 120, 1, NULL
    );
    INSERT INTO chat_sessions (
      id, repo_id, title, status, opencode_session_id, worktree, created_at, updated_at,
      kind, usage_usd, usage_tokens_in, usage_tokens_out, context_tokens, context_epoch, reviewed_at
    ) VALUES (
      'chat_000002', 'repo_000001', 'Second', 'archived', 'ses_2', NULL, '${FIXED_NOW}', '${FIXED_NOW}',
      'repo', 0, 0, 0, 0, 2, '${FIXED_NOW}'
    );

    INSERT INTO chat_messages (id, chat_id, role, text, origin, created_at)
    VALUES ('msg_000001', 'chat_000001', 'user', 'hello', 'user', '${FIXED_NOW}');
    INSERT INTO chat_messages (id, chat_id, role, text, origin, created_at)
    VALUES ('msg_000002', 'chat_000002', 'assistant', 'bye', 'assistant', '${FIXED_NOW}');

    INSERT INTO run_events (run_id, chat_id, seq, type, payload, ts)
    VALUES (NULL, 'chat_000001', 1, 'chat.idle', '{}', '${FIXED_NOW}');

    INSERT INTO approvals (id, state, tool, title, run_id, chat_id, input, created_at, expires_at)
    VALUES ('apv_000001', 'pending', 'bash', 'Run the tests', NULL, 'chat_000002', '{}', '${FIXED_NOW}', '${FIXED_NOW}');

    INSERT INTO routines (
      id, kind, title, cron, timezone, enabled, notify, repo_id, prompt, chat_session_id,
      next_fire_at, last_fired_at, created_at
    ) VALUES (
      'rtn_000001', 'prompt', 'Nightly', '0 3 * * *', 'UTC', 1, 1, 'repo_000001', 'Summarise.',
      'chat_000001', NULL, NULL, '${FIXED_NOW}'
    );

    INSERT INTO schedules (
      id, repo_id, chat_session_id, title, prompt, mode, cron, timezone, window_start,
      window_end, cooldown_minutes, max_fires, max_cost_per_fire_usd, fire_policy,
      consecutive_failures, fires_count, spend_usd, enabled, policy, next_fire_at, last_fired_at,
      created_at, updated_at
    ) VALUES (
      'sch_000001', NULL, 'chat_000002', 'Drain', 'Pick the next issue.', 'every', '0 3 * * *',
      'UTC', NULL, NULL, 0, NULL, NULL, 'new_chat', 0, 0, 0, 1, 'auto', NULL, NULL,
      '${FIXED_NOW}', '${FIXED_NOW}'
    );

    INSERT INTO schedule_fires (schedule_id, scheduled_for, fired_at, outcome, run_id, chat_id, cost_usd, detail)
    VALUES ('sch_000001', '${FIXED_NOW}', '${FIXED_NOW}', 'fired', NULL, 'chat_000002', 0, NULL);
  `);
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
    expect(files.map((file) => file.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const first = runMigrations(db, files, () => FIXED_NOW);
    expect(first.applied.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(first.currentVersion).toBe(7);
    expect(first.applied.map((migration) => migration.name)).toEqual([
      '0001_init.sql',
      '0002_routines.sql',
      '0003_chat_scope.sql',
      '0004_schedules.sql',
      '0005_chat_free.sql',
      '0006_works.sql',
      '0007_providers.sql',
    ]);

    const userVersion = db.prepare('PRAGMA user_version').get()?.['user_version'];
    expect(Number(userVersion)).toBe(7);

    const tables = names(db, 'table');
    for (const table of TABLES) expect(tables).toContain(table);
    expect(tables).toContain('schema_migrations');
    expect(tables).not.toContain('chat_sessions_new');
    const indexes = names(db, 'index');
    for (const index of INDEXES) expect(indexes).toContain(index);
    expect(Number(db.prepare('PRAGMA foreign_keys').get()?.['foreign_keys'])).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    const legacy = db
      .prepare('SELECT table_name, retired_by, read_only FROM schema_legacy ORDER BY table_name')
      .all();
    expect(legacy).toEqual([
      { table_name: 'chat_messages', retired_by: 'D44', read_only: 1 },
      { table_name: 'chat_sessions', retired_by: 'D44', read_only: 1 },
    ]);

    const second = runMigrations(db, files, () => FIXED_NOW);
    expect(second.applied).toEqual([]);
    expect(second.currentVersion).toBe(7);

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

  it('rebuilds chat_sessions for a free chat without losing a child row', () => {
    const files = loadMigrationsFromDisk(MIGRATIONS_DIRECTORY);
    const before = runMigrations(
      db,
      files.filter((file) => file.version < 5),
      () => FIXED_NOW,
    );
    expect(before.currentVersion).toBe(4);
    seedChildren(db);

    const applied = runMigrations(db, files, () => FIXED_NOW);
    expect(applied.applied.map((migration) => migration.version)).toEqual([5, 6, 7]);
    expect(applied.currentVersion).toBe(7);

    const sessions = db
      .prepare(
        'SELECT id, repo_id, kind, context_epoch, reviewed_at, worktree FROM chat_sessions ORDER BY id',
      )
      .all();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toEqual({
      id: 'chat_000001',
      repo_id: 'repo_000001',
      kind: 'repo',
      context_epoch: 1,
      reviewed_at: null,
      worktree: '/tmp/wt-1',
    });
    expect(sessions[1]).toEqual({
      id: 'chat_000002',
      repo_id: 'repo_000001',
      kind: 'repo',
      context_epoch: 2,
      reviewed_at: FIXED_NOW,
      worktree: null,
    });

    expect(countOf(db, 'chat_messages')).toBe(2);
    expect(countOf(db, 'run_events')).toBe(1);
    expect(countOf(db, 'approvals')).toBe(1);
    expect(countOf(db, 'routines')).toBe(1);
    expect(countOf(db, 'schedules')).toBe(1);
    expect(countOf(db, 'schedule_fires')).toBe(1);
    expect(db.prepare('SELECT chat_id FROM run_events').get()).toEqual({
      chat_id: 'chat_000001',
    });
    expect(db.prepare('SELECT chat_id FROM approvals').get()).toEqual({
      chat_id: 'chat_000002',
    });
    expect(db.prepare('SELECT chat_session_id FROM routines').get()).toEqual({
      chat_session_id: 'chat_000001',
    });
    expect(db.prepare('SELECT chat_session_id FROM schedules').get()).toEqual({
      chat_session_id: 'chat_000002',
    });
    expect(db.prepare('SELECT chat_id FROM schedule_fires').get()).toEqual({
      chat_id: 'chat_000002',
    });

    db.exec(`INSERT INTO chat_sessions (id, repo_id, title, status, created_at, updated_at)
             VALUES ('chat_000003', NULL, 'Free chat', 'idle', '${FIXED_NOW}', '${FIXED_NOW}')`);
    expect(
      db.prepare("SELECT repo_id, kind FROM chat_sessions WHERE id = 'chat_000003'").get(),
    ).toEqual({ repo_id: null, kind: 'repo' });
    expect(
      db.prepare('SELECT COUNT(*) AS total FROM chat_sessions WHERE repo_id IS NULL').get()?.[
        'total'
      ],
    ).toBe(1);

    let refused = false;
    try {
      db.exec(`INSERT INTO chat_sessions (id, repo_id, title, status, created_at, updated_at)
               VALUES ('chat_000004', 'repo_missing', 'Ghost', 'idle', '${FIXED_NOW}', '${FIXED_NOW}')`);
    } catch (error) {
      refused = error instanceof Error && error.message.includes('FOREIGN KEY constraint failed');
    }
    expect(refused).toBe(true);

    const indexes = names(db, 'index');
    expect(indexes).toContain('chat_sessions_repo');
    expect(indexes).toContain('chat_sessions_kind');
    expect(Number(db.prepare('PRAGMA foreign_keys').get()?.['foreign_keys'])).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
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

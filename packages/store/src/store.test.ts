import type { Repo } from '@codebox/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';
import { isForeignKeyViolation, isUniqueViolation, openDatabase, withTransaction } from './db.js';
import { StoreError } from './errors.js';
import { loadMigrationsFromDisk, MIGRATIONS_DIRECTORY, runMigrations } from './migrate.js';
import { openInMemoryStore, openStore, type Store } from './store.js';

const FIXED_NOW = '2026-10-24T18:03:11.000Z';

const REPO: Repo = {
  id: 'repo_000001',
  slug: 'octo/hello',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: ['.github/**'],
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function storeErrorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof StoreError ? error.code : 'unexpected-error';
  }
  return 'no-error';
}

let directory: string;
const stores: Store[] = [];

function track(store: Store): Store {
  stores.push(store);
  return store;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'codebox-store-'));
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('openStore', () => {
  it('applies migrations, enables WAL and foreign keys on a file database', () => {
    const store = track(openStore({ path: join(directory, 'state.db') }));
    expect(store.schemaVersion).toBe(5);
    expect(store.db.prepare('PRAGMA journal_mode').get()?.['journal_mode']).toBe('wal');
    expect(store.db.prepare('PRAGMA foreign_keys').get()?.['foreign_keys']).toBe(1);
    expect(store.db.prepare('PRAGMA busy_timeout').get()?.['timeout']).toBe(5000);
    const tables = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((value) => String(value['name']));
    expect(tables).toContain('repos');
    expect(tables).toContain('schema_migrations');
  });

  it('is a no-op on an already migrated database', () => {
    const path = join(directory, 'state.db');
    const first = openStore({ path });
    expect(first.schemaVersion).toBe(5);
    first.close();

    const second = track(openStore({ path }));
    expect(second.schemaVersion).toBe(5);
    const rows = second.db.prepare('SELECT version, applied_at FROM schema_migrations').all();
    expect(rows).toHaveLength(5);
    expect(String(rows[0]?.['applied_at'])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('opens a database migrated elsewhere without migrating again', () => {
    const path = join(directory, 'external.db');
    const raw = openDatabase({ path });
    runMigrations(
      raw,
      loadMigrationsFromDisk(MIGRATIONS_DIRECTORY),
      () => '2026-10-24T18:03:11.000Z',
    );
    raw.close();

    const store = track(openStore({ path, applyMigrations: false }));
    expect(store.schemaVersion).toBe(5);
    expect(store.repos.list()).toEqual([]);
    const applied = store.db.prepare('SELECT COUNT(*) AS total FROM schema_migrations').get();
    expect(Number(applied?.['total'])).toBe(5);
  });

  it('has an idempotent close', () => {
    const store = openStore({ path: join(directory, 'state.db') });
    store.close();
    expect(() => store.close()).not.toThrow();
    expect(store.db.isOpen).toBe(false);
  });
});

describe('openInMemoryStore', () => {
  it('gives every repository a migrated in-memory database', () => {
    const store = track(openInMemoryStore());
    expect(store.schemaVersion).toBe(5);
    expect(store.repos.list()).toEqual([]);
    expect(store.jobs.list({ limit: 10, cursor: null })).toEqual({ data: [], nextCursor: null });
    expect(store.runs.countLive()).toBe(0);
    expect(store.events.latestId()).toBe(0);
    expect(store.approvals.listPending(10)).toEqual([]);
    expect(store.chats.listSessions({ limit: 10, cursor: null }).data).toEqual([]);
    expect(store.devices.list({ limit: 10, cursor: null }).data).toEqual([]);
    expect(store.settings.getAll()).toEqual({});
    expect(store.usage.aggregate('2026-01-01', '2026-01-02')).toEqual([]);
    expect(store.schedules.list({ limit: 10, cursor: null })).toEqual({
      data: [],
      nextCursor: null,
    });
    expect(store.scheduleFires.listBySchedule('sch_000001', 10)).toEqual([]);
  });
});

describe('transactions', () => {
  it('commits, rolls back and refuses a nested call', () => {
    const store = track(openInMemoryStore());
    const result = withTransaction(store.db, () => {
      store.repos.create(REPO);
      return 'done';
    });
    expect(result).toBe('done');
    expect(store.repos.get(REPO.id)).not.toBeNull();

    const failure = new Error('boom');
    expect(() =>
      withTransaction(store.db, () => {
        store.repos.create({ ...REPO, id: 'repo_000002', slug: 'octo/other' });
        throw failure;
      }),
    ).toThrow(failure);
    expect(store.repos.get('repo_000002')).toBeNull();

    expect(
      storeErrorCode(() =>
        withTransaction(store.db, () => withTransaction(store.db, () => 'inner')),
      ),
    ).toBe('nested_transaction');
  });

  it('classifies driver errors without throwing on foreign values', () => {
    expect(isUniqueViolation(new Error('UNIQUE constraint failed: repos.slug'))).toBe(true);
    expect(isForeignKeyViolation(new Error('FOREIGN KEY constraint failed'))).toBe(true);
    for (const value of [undefined, null, 'text', 42, new Error('UNIQUE constraint failed')]) {
      expect(() => isUniqueViolation(value)).not.toThrow();
      expect(() => isForeignKeyViolation(value)).not.toThrow();
    }
    expect(isUniqueViolation(new Error('UNIQUE constraint failed'))).toBe(true);
    expect(isForeignKeyViolation('FOREIGN KEY constraint failed')).toBe(false);
  });
});

describe('cursor', () => {
  it('round-trips a timestamp and an id', () => {
    const cursor = encodeCursor(FIXED_NOW, 'run_0000001');
    expect(decodeCursor(cursor)).toEqual({ createdAt: FIXED_NOW, id: 'run_0000001' });
  });

  it('rejects anything that is not a cursor with invalid_row', () => {
    for (const value of ['', 'not-a-cursor', encodeCursor('', 'run_0000001')]) {
      expect(storeErrorCode(() => decodeCursor(value))).toBe('invalid_row');
    }
    expect(decodeCursor(encodeCursor(FIXED_NOW, 'run_0000001')).createdAt).toBe(FIXED_NOW);
  });
});

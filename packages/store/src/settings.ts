import type { DatabaseSync } from 'node:sqlite';
import { StoreError } from './errors.js';
import { jsonText, row, textColumn } from './mappers.js';

export interface SettingsRepository {
  getAll(): Record<string, unknown>;
  get(key: string): unknown;
  set(key: string, value: unknown, at: string): void;
  delete(key: string): void;
}

export function createSettingsRepository(db: DatabaseSync): SettingsRepository {
  const selectAll = db.prepare('SELECT key, value FROM settings ORDER BY key ASC');
  const selectOne = db.prepare('SELECT value FROM settings WHERE key = ?');
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const remove = db.prepare('DELETE FROM settings WHERE key = ?');

  function parse(value: string): unknown {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed;
    } catch {
      throw new StoreError('invalid_row', 'invalid JSON in column value');
    }
  }

  return {
    getAll(): Record<string, unknown> {
      const result: Record<string, unknown> = {};
      for (const value of selectAll.all()) {
        const rowValue = row(value);
        result[textColumn(rowValue, 'key')] = parse(textColumn(rowValue, 'value'));
      }
      return result;
    },

    get(key: string): unknown {
      const value = selectOne.get(key);
      if (value === undefined) return undefined;
      return parse(textColumn(row(value), 'value'));
    },

    set(key: string, value: unknown, at: string): void {
      upsert.run(key, jsonText(value), at);
    },

    delete(key: string): void {
      remove.run(key);
    },
  };
}

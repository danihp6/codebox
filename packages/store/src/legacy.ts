import type { DatabaseSync } from 'node:sqlite';
import { StoreError } from './errors.js';
import { integerColumn, row, textColumn } from './mappers.js';

export interface LegacyTable {
  readonly tableName: string;
  readonly retiredBy: string;
  readonly readOnly: true;
}

export interface LegacyRepository {
  list(): LegacyTable[];
}

export function createLegacyRepository(db: DatabaseSync): LegacyRepository {
  const selectAll = db.prepare(
    'SELECT table_name, retired_by, read_only FROM schema_legacy ORDER BY table_name ASC',
  );

  return {
    list(): LegacyTable[] {
      return selectAll.all().map((value) => {
        const rowValue = row(value);
        const readOnly = integerColumn(rowValue, 'read_only');
        if (readOnly !== 1) throw new StoreError('invalid_row', 'invalid column read_only');
        return {
          tableName: textColumn(rowValue, 'table_name'),
          retiredBy: textColumn(rowValue, 'retired_by'),
          readOnly: true,
        };
      });
    },
  };
}

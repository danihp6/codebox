import type { Device } from '@codebox/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { decodeCursor, encodeCursor, type PageQuery, type PageResult } from './cursor.js';
import { isUniqueViolation } from './db.js';
import { StoreError } from './errors.js';
import { deviceFromRow, deviceRecordFromRow, jsonText, row } from './mappers.js';

export interface DeviceRecord extends Device {
  readonly publicKey: string | null;
  readonly fingerprint: string | null;
  readonly refreshTokenHash: string;
  readonly refreshPreviousHash: string | null;
  readonly refreshExpiresAt: string;
  readonly revokedAt: string | null;
}

export interface DeviceRepository {
  get(id: string): Device | null;
  getRecord(id: string): DeviceRecord | null;
  getByRefreshHash(hash: string): DeviceRecord | null;
  list(query: PageQuery): PageResult<Device>;
  create(record: DeviceRecord): DeviceRecord;
  rotateRefresh(
    id: string,
    input: {
      readonly refreshTokenHash: string;
      readonly refreshPreviousHash: string;
      readonly refreshExpiresAt: string;
    },
  ): DeviceRecord;
  revoke(id: string, at: string): void;
  touch(id: string, at: string): void;
}

const COLUMNS = [
  'id',
  'name',
  'platform',
  'public_key',
  'fingerprint',
  'scopes',
  'refresh_token_hash',
  'refresh_previous_hash',
  'refresh_expires_at',
  'created_at',
  'last_seen_at',
  'revoked_at',
].join(', ');

export function createDeviceRepository(db: DatabaseSync): DeviceRepository {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM devices WHERE id = ?`);
  const selectByHash = db.prepare(
    `SELECT ${COLUMNS} FROM devices WHERE refresh_token_hash = ? OR refresh_previous_hash = ? LIMIT 1`,
  );
  const insert = db.prepare(`
    INSERT INTO devices (
      id, name, platform, public_key, fingerprint, scopes, refresh_token_hash,
      refresh_previous_hash, refresh_expires_at, created_at, last_seen_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const rotate = db.prepare(`
    UPDATE devices
    SET refresh_token_hash = ?, refresh_previous_hash = ?, refresh_expires_at = ?
    WHERE id = ?
  `);
  const revokeDevice = db.prepare(
    'UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
  );
  const touchDevice = db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?');

  function findRecord(id: string): DeviceRecord | null {
    const value = selectById.get(id);
    return value === undefined ? null : deviceRecordFromRow(row(value));
  }

  return {
    get(id: string): Device | null {
      const record = findRecord(id);
      return record === null ? null : deviceFromRow(record);
    },

    getRecord(id: string): DeviceRecord | null {
      return findRecord(id);
    },

    getByRefreshHash(hash: string): DeviceRecord | null {
      const value = selectByHash.get(hash, hash);
      return value === undefined ? null : deviceRecordFromRow(row(value));
    },

    list(query: PageQuery): PageResult<Device> {
      const limit = Math.max(1, Math.trunc(query.limit));
      const conditions: string[] = [];
      const parameters: (string | number)[] = [];
      if (query.cursor !== null) {
        const cursor = decodeCursor(query.cursor);
        conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
        parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
      const values = db
        .prepare(
          `SELECT ${COLUMNS} FROM devices ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(...parameters, limit + 1)
        .map((value) => deviceRecordFromRow(row(value)));
      const data = values.slice(0, limit).map((record) => deviceFromRow(record));
      const last = values.at(limit - 1);
      return {
        data,
        nextCursor:
          values.length > limit && last !== undefined
            ? encodeCursor(last.createdAt, last.id)
            : null,
      };
    },

    create(record: DeviceRecord): DeviceRecord {
      try {
        insert.run(
          record.id,
          record.name,
          record.platform,
          record.publicKey,
          record.fingerprint,
          jsonText(record.scopes),
          record.refreshTokenHash,
          record.refreshPreviousHash,
          record.refreshExpiresAt,
          record.createdAt,
          record.lastSeenAt,
          record.revokedAt,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError('unique_violation', 'device or refresh token already exists');
        }
        throw error;
      }
      const created = findRecord(record.id);
      if (created === null) throw new StoreError('invalid_row', 'device was not stored');
      return created;
    },

    rotateRefresh(
      id: string,
      input: {
        readonly refreshTokenHash: string;
        readonly refreshPreviousHash: string;
        readonly refreshExpiresAt: string;
      },
    ): DeviceRecord {
      try {
        rotate.run(input.refreshTokenHash, input.refreshPreviousHash, input.refreshExpiresAt, id);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError('unique_violation', 'refresh token already exists');
        }
        throw error;
      }
      const rotated = findRecord(id);
      if (rotated === null) throw new StoreError('not_found', 'device not found');
      return rotated;
    },

    revoke(id: string, at: string): void {
      revokeDevice.run(at, id);
    },

    touch(id: string, at: string): void {
      touchDevice.run(at, id);
    },
  };
}

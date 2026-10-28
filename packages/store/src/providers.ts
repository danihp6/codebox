import type { Provider, ProviderAccount, ProviderAccountState } from '@codebox/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from './db.js';
import { StoreError } from './errors.js';
import { providerAccountFromRow, providerFromRow, row } from './mappers.js';

export interface ProviderRepository {
  get(id: string): Provider | null;
  list(): Provider[];
  create(provider: Provider): Provider;
}

export interface ProviderAccountFilter {
  readonly providerId?: string;
  readonly state?: ProviderAccountState;
}

export interface ProviderAccountPatch {
  readonly label?: string;
  readonly credentialId?: string;
  readonly priority?: number;
  readonly state?: ProviderAccountState;
  readonly resetAt?: string | null;
  readonly budgetUsd?: number | null;
  readonly usedToday?: { readonly day: string; readonly usd: number };
  readonly updatedAt: string;
}

export interface ProviderAccountRepository {
  get(id: string): ProviderAccount | null;
  list(filter: ProviderAccountFilter): ProviderAccount[];
  create(account: ProviderAccount): ProviderAccount;
  update(id: string, patch: ProviderAccountPatch): ProviderAccount;
  /** D54: the lowest `priority` whose state is `active`, else `null`. */
  selectActive(providerId: string): ProviderAccount | null;
  /** `exhausted` accounts whose `reset_at <= at`, for the daemon's reset sweep. */
  listDueResets(at: string): ProviderAccount[];
}

const PROVIDER_COLUMNS = 'id, label, auth_kind, base_url, created_at, updated_at';

const ACCOUNT_COLUMNS = [
  'id',
  'provider_id',
  'label',
  'credential_id',
  'priority',
  'state',
  'reset_at',
  'budget_usd',
  'used_today_usd',
  'used_today_day',
  'created_at',
  'updated_at',
].join(', ');

export function createProviderRepository(db: DatabaseSync): ProviderRepository {
  const selectById = db.prepare(`SELECT ${PROVIDER_COLUMNS} FROM providers WHERE id = ?`);
  const selectAll = db.prepare(`SELECT ${PROVIDER_COLUMNS} FROM providers ORDER BY id ASC`);
  const insert = db.prepare(
    `INSERT INTO providers (${PROVIDER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  function stored(id: string): Provider {
    const value = selectById.get(id);
    if (value === undefined) throw new StoreError('not_found', 'provider not found');
    return providerFromRow(row(value));
  }

  return {
    get(id: string): Provider | null {
      const value = selectById.get(id);
      return value === undefined ? null : providerFromRow(row(value));
    },

    list(): Provider[] {
      return selectAll.all().map((value) => providerFromRow(row(value)));
    },

    create(provider: Provider): Provider {
      try {
        insert.run(
          provider.id,
          provider.label,
          provider.authKind,
          provider.baseUrl,
          provider.createdAt,
          provider.updatedAt,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError('unique_violation', 'provider already exists');
        }
        if (isCheckViolation(error)) {
          throw new StoreError('check_violation', 'provider auth kind is not supported');
        }
        throw error;
      }
      return stored(provider.id);
    },
  };
}

export function createProviderAccountRepository(db: DatabaseSync): ProviderAccountRepository {
  const selectById = db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM provider_accounts WHERE id = ?`);
  const selectActive = db.prepare(`
    SELECT ${ACCOUNT_COLUMNS} FROM provider_accounts
    WHERE provider_id = ? AND state = 'active'
    ORDER BY priority ASC, id ASC
    LIMIT 1
  `);
  const selectDueResets = db.prepare(`
    SELECT ${ACCOUNT_COLUMNS} FROM provider_accounts
    WHERE state = 'exhausted' AND reset_at IS NOT NULL AND reset_at <= ?
    ORDER BY reset_at ASC, id ASC
  `);
  const insert = db.prepare(
    `INSERT INTO provider_accounts (${ACCOUNT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  function findById(id: string): ProviderAccount | null {
    const value = selectById.get(id);
    return value === undefined ? null : providerAccountFromRow(row(value));
  }

  function stored(id: string): ProviderAccount {
    const value = findById(id);
    if (value === null) throw new StoreError('not_found', 'provider account not found');
    return value;
  }

  return {
    get(id: string): ProviderAccount | null {
      return findById(id);
    },

    list(filter: ProviderAccountFilter): ProviderAccount[] {
      const conditions: string[] = [];
      const parameters: string[] = [];
      if (filter.providerId !== undefined) {
        conditions.push('provider_id = ?');
        parameters.push(filter.providerId);
      }
      if (filter.state !== undefined) {
        conditions.push('state = ?');
        parameters.push(filter.state);
      }
      const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
      return db
        .prepare(
          `SELECT ${ACCOUNT_COLUMNS} FROM provider_accounts ${where}
           ORDER BY provider_id ASC, priority ASC, id ASC`,
        )
        .all(...parameters)
        .map((value) => providerAccountFromRow(row(value)));
    },

    create(account: ProviderAccount): ProviderAccount {
      try {
        insert.run(
          account.id,
          account.providerId,
          account.label,
          account.credentialId,
          account.priority,
          account.state,
          account.resetAt,
          account.budgetUsd,
          account.usedToday.usd,
          account.usedToday.day,
          account.createdAt,
          account.updatedAt,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError('unique_violation', 'provider account already exists');
        }
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'provider is missing');
        }
        if (isCheckViolation(error)) {
          throw new StoreError('check_violation', 'provider account state is inconsistent');
        }
        throw error;
      }
      return stored(account.id);
    },

    update(id: string, patch: ProviderAccountPatch): ProviderAccount {
      if (findById(id) === null) throw new StoreError('not_found', 'provider account not found');
      const assignments: string[] = [];
      const parameters: (string | number | null)[] = [];
      const scalars: readonly [keyof ProviderAccountPatch, string][] = [
        ['label', 'label'],
        ['credentialId', 'credential_id'],
        ['priority', 'priority'],
        ['state', 'state'],
        ['resetAt', 'reset_at'],
        ['budgetUsd', 'budget_usd'],
      ];
      for (const [key, column] of scalars) {
        const value = patch[key];
        if (value !== undefined) {
          assignments.push(`${column} = ?`);
          parameters.push(value as string | number | null);
        }
      }
      if (patch.usedToday !== undefined) {
        assignments.push('used_today_day = ?', 'used_today_usd = ?');
        parameters.push(patch.usedToday.day, patch.usedToday.usd);
      }
      assignments.push('updated_at = ?');
      parameters.push(patch.updatedAt);
      try {
        db.prepare(`UPDATE provider_accounts SET ${assignments.join(', ')} WHERE id = ?`).run(
          ...parameters,
          id,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError('unique_violation', 'provider account already exists');
        }
        if (isCheckViolation(error)) {
          throw new StoreError('check_violation', 'provider account state is inconsistent');
        }
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'provider is missing');
        }
        throw error;
      }
      return stored(id);
    },

    selectActive(providerId: string): ProviderAccount | null {
      const value = selectActive.get(providerId);
      return value === undefined ? null : providerAccountFromRow(row(value));
    },

    listDueResets(at: string): ProviderAccount[] {
      return selectDueResets.all(at).map((value) => providerAccountFromRow(row(value)));
    },
  };
}

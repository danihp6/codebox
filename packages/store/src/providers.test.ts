import type { Provider, ProviderAccount } from '@codebox/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreError } from './errors.js';
import { openInMemoryStore, type Store } from './store.js';

const NOW = '2026-10-28T09:12:00.000Z';
const LATER = '2026-10-28T10:12:00.000Z';

const PROVIDER: Provider = {
  id: 'opencode-go',
  label: 'OpenCode Go',
  authKind: 'oauth',
  baseUrl: 'https://opencode.ai',
  createdAt: NOW,
  updatedAt: NOW,
};

const OTHER_PROVIDER: Provider = {
  ...PROVIDER,
  id: 'anthropic',
  label: 'Anthropic',
  authKind: 'token',
  baseUrl: null,
};

const ACCOUNT: ProviderAccount = {
  id: 'acct_000001',
  providerId: PROVIDER.id,
  label: 'go · dani',
  credentialId: 'cred_000001',
  priority: 1,
  state: 'active',
  resetAt: null,
  budgetUsd: 20,
  usedToday: { day: '2026-10-28', usd: 2.4 },
  createdAt: NOW,
  updatedAt: NOW,
};

function storeErrorOf(run: () => unknown): StoreError | null {
  try {
    run();
  } catch (error) {
    return error instanceof StoreError ? error : null;
  }
  return null;
}

let store: Store;

beforeEach(() => {
  store = openInMemoryStore();
  store.providers.create(PROVIDER);
  store.providers.create(OTHER_PROVIDER);
});

afterEach(() => {
  store.close();
});

describe('providers', () => {
  it('round-trips a provider and lists them by id', () => {
    expect(store.providers.get(PROVIDER.id)).toEqual(PROVIDER);
    expect(store.providers.get('missing')).toBeNull();
    expect(store.providers.get(OTHER_PROVIDER.id)).toEqual(OTHER_PROVIDER);
    expect(store.providers.list().map((provider) => provider.id)).toEqual([
      'anthropic',
      'opencode-go',
    ]);
  });

  it('maps a duplicate id to unique_violation', () => {
    const error = storeErrorOf(() => store.providers.create({ ...PROVIDER, label: 'Again' }));
    expect(error?.code).toBe('unique_violation');
  });
});

describe('providerAccounts.create', () => {
  it('round-trips an account with its daily rollup', () => {
    expect(store.providerAccounts.create(ACCOUNT)).toEqual(ACCOUNT);
    expect(store.providerAccounts.get(ACCOUNT.id)).toEqual(ACCOUNT);
    expect(store.providerAccounts.get('acct_999999')).toBeNull();
  });

  it('maps a duplicate label, a duplicate credential and a missing provider', () => {
    store.providerAccounts.create(ACCOUNT);
    expect(
      storeErrorOf(() =>
        store.providerAccounts.create({
          ...ACCOUNT,
          id: 'acct_000002',
          credentialId: 'cred_000002',
        }),
      )?.code,
    ).toBe('unique_violation');
    expect(
      storeErrorOf(() =>
        store.providerAccounts.create({ ...ACCOUNT, id: 'acct_000003', label: 'go · spare' }),
      )?.code,
    ).toBe('unique_violation');
    expect(
      storeErrorOf(() =>
        store.providerAccounts.create({
          ...ACCOUNT,
          id: 'acct_000004',
          label: 'ghost',
          credentialId: 'cred_000004',
          providerId: 'missing',
        }),
      )?.code,
    ).toBe('foreign_key_violation');
  });

  it('refuses an exhausted account without a reset instant', () => {
    const error = storeErrorOf(() =>
      store.providerAccounts.create({ ...ACCOUNT, id: 'acct_000005', state: 'exhausted' }),
    );
    expect(error?.code).toBe('check_violation');
    expect(error?.message).toBe('provider account state is inconsistent');
  });
});

describe('providerAccounts.update', () => {
  it('writes a state, a reset instant and the daily rollup', () => {
    store.providerAccounts.create(ACCOUNT);
    const exhausted = store.providerAccounts.update(ACCOUNT.id, {
      state: 'exhausted',
      resetAt: '2026-10-28T15:00:00Z',
      usedToday: { day: '2026-10-28', usd: 5 },
      updatedAt: LATER,
    });
    expect(exhausted.state).toBe('exhausted');
    expect(exhausted.resetAt).toBe('2026-10-28T15:00:00Z');
    expect(exhausted.usedToday).toEqual({ day: '2026-10-28', usd: 5 });
    expect(exhausted.updatedAt).toBe(LATER);
  });

  it('maps an unknown id to not_found and a bad state to check_violation', () => {
    expect(
      storeErrorOf(() => store.providerAccounts.update('acct_999999', { updatedAt: LATER }))?.code,
    ).toBe('not_found');
    store.providerAccounts.create(ACCOUNT);
    const broken = storeErrorOf(() =>
      store.providerAccounts.update(ACCOUNT.id, { state: 'exhausted', updatedAt: LATER }),
    );
    expect(broken?.code).toBe('check_violation');
  });
});

describe('providerAccounts.list and selectActive', () => {
  it('selects the lowest priority active account and skips the rest', () => {
    store.providerAccounts.create({ ...ACCOUNT, priority: 3 });
    store.providerAccounts.create({
      ...ACCOUNT,
      id: 'acct_000006',
      label: 'go · spare',
      credentialId: 'cred_000006',
      priority: 2,
    });
    store.providerAccounts.create({
      ...ACCOUNT,
      id: 'acct_000007',
      label: 'go · dry',
      credentialId: 'cred_000007',
      priority: 0,
      state: 'exhausted',
      resetAt: '2026-10-29T15:00:00Z',
    });
    store.providerAccounts.create({
      ...ACCOUNT,
      id: 'acct_000008',
      label: 'go · revoked',
      credentialId: 'cred_000008',
      priority: 0,
      state: 'invalid',
    });
    store.providerAccounts.create({
      ...ACCOUNT,
      id: 'acct_000009',
      label: 'go · off',
      credentialId: 'cred_000009',
      priority: 0,
      state: 'disabled',
    });

    expect(store.providerAccounts.selectActive(PROVIDER.id)?.id).toBe('acct_000006');
    expect(store.providerAccounts.selectActive(OTHER_PROVIDER.id)).toBeNull();
    expect(store.providerAccounts.list({ providerId: PROVIDER.id })).toHaveLength(5);
    expect(store.providerAccounts.list({ state: 'active' }).map((account) => account.id)).toEqual([
      'acct_000006',
      'acct_000001',
    ]);
  });
});

describe('providerAccounts.listDueResets', () => {
  it('returns only the exhausted accounts whose reset instant has passed', () => {
    store.providerAccounts.create({
      ...ACCOUNT,
      id: 'acct_000010',
      label: 'due now',
      credentialId: 'cred_000010',
      state: 'exhausted',
      resetAt: '2026-10-28T09:00:00Z',
    });
    store.providerAccounts.create({
      ...ACCOUNT,
      id: 'acct_000011',
      label: 'due later',
      credentialId: 'cred_000011',
      state: 'exhausted',
      resetAt: '2026-10-28T20:00:00Z',
    });
    store.providerAccounts.create({
      ...ACCOUNT,
      id: 'acct_000012',
      label: 'still active',
      credentialId: 'cred_000012',
    });

    expect(store.providerAccounts.listDueResets(NOW).map((account) => account.id)).toEqual([
      'acct_000010',
    ]);
    expect(store.providerAccounts.listDueResets('2026-10-28T08:00:00Z')).toEqual([]);
    expect(
      store.providerAccounts.listDueResets('2026-10-28T21:00:00Z').map((account) => account.id),
    ).toEqual(['acct_000010', 'acct_000011']);
  });
});

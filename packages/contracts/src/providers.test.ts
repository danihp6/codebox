import { describe, expect, it } from 'vitest';
import { ContractParseError } from './parse.js';
import {
  PROVIDER_ACCOUNT_STATES,
  PROVIDER_AUTH_KINDS,
  accountDaySchema,
  parseProvider,
  parseProviderAccount,
  providerAccountSchema,
  providerAccountStateSchema,
  providerAuthKindSchema,
  providerIdSchema,
  providerSchema,
} from './providers.js';

const NOW = '2026-10-28T09:12:00Z';

const provider = {
  id: 'opencode-go',
  label: 'OpenCode Go',
  authKind: 'oauth',
  baseUrl: 'https://opencode.ai',
  createdAt: NOW,
  updatedAt: NOW,
};

const account = {
  id: 'acct_01JABCDEFG',
  providerId: 'opencode-go',
  label: 'go · dani',
  credentialId: 'cred_01JABCDEFG',
  priority: 1,
  state: 'active',
  resetAt: null,
  budgetUsd: 20,
  usedToday: { day: '2026-10-28', usd: 2.4 },
  createdAt: NOW,
  updatedAt: NOW,
};

function errorOf(run: () => unknown): unknown {
  try {
    run();
  } catch (thrown) {
    return thrown;
  }
  return null;
}

describe('provider', () => {
  it('round-trips a provider and freezes its vocabularies', () => {
    expect(parseProvider(provider)).toEqual(provider);
    expect(providerSchema.safeParse(provider).success).toBe(true);
    expect(providerSchema.safeParse({ ...provider, baseUrl: null }).success).toBe(true);
    expect([...PROVIDER_AUTH_KINDS]).toEqual(['oauth', 'token']);
    expect([...PROVIDER_ACCOUNT_STATES]).toEqual(['active', 'exhausted', 'invalid', 'disabled']);
    expect(providerAuthKindSchema.safeParse('token').success).toBe(true);
    expect(providerAuthKindSchema.safeParse('key').success).toBe(false);
    expect(providerAccountStateSchema.safeParse('disabled').success).toBe(true);
  });

  it('accepts a slug id and refuses anything else', () => {
    expect(providerIdSchema.safeParse('opencode-go').success).toBe(true);
    expect(providerIdSchema.safeParse('anthropic').success).toBe(true);
    expect(providerIdSchema.safeParse('a1').success).toBe(true);
    expect(providerIdSchema.safeParse('Opencode').success).toBe(false);
    expect(providerIdSchema.safeParse('-go').success).toBe(false);
    expect(providerIdSchema.safeParse('a').success).toBe(false);
    expect(providerIdSchema.safeParse(`${'a'.repeat(33)}`).success).toBe(false);
  });

  it('refuses a plain-http base URL and an unknown key', () => {
    expect(providerSchema.safeParse({ ...provider, baseUrl: 'http://opencode.ai' }).success).toBe(
      false,
    );
    expect(providerSchema.safeParse({ ...provider, extra: 'x' }).success).toBe(false);
    expect(providerSchema.safeParse({ ...provider, label: '' }).success).toBe(false);
  });

  it('names the provider boundary when a field fails', () => {
    const error = errorOf(() => parseProvider({ ...provider, authKind: 'key' }));
    expect(error).toBeInstanceOf(ContractParseError);
    expect(error instanceof ContractParseError ? error.boundary : null).toBe('provider');
  });
});

describe('provider account', () => {
  it('round-trips an account with its daily rollup', () => {
    expect(parseProviderAccount(account)).toEqual(account);
    expect(providerAccountSchema.safeParse(account).success).toBe(true);
    expect(accountDaySchema.safeParse('2026-10-28').success).toBe(true);
    expect(accountDaySchema.safeParse('2026-10-28T09:12:00Z').success).toBe(false);
    expect(
      providerAccountSchema.safeParse({ ...account, budgetUsd: null, resetAt: null }).success,
    ).toBe(true);
  });

  it('needs a reset instant on an exhausted account', () => {
    expect(
      providerAccountSchema.safeParse({ ...account, state: 'exhausted', resetAt: null }).success,
    ).toBe(false);
    expect(
      providerAccountSchema.safeParse({
        ...account,
        state: 'exhausted',
        resetAt: '2026-10-28T15:00:00Z',
      }).success,
    ).toBe(true);
  });

  it('refuses a negative priority, a bad day and an unknown key', () => {
    expect(providerAccountSchema.safeParse({ ...account, priority: -1 }).success).toBe(false);
    expect(
      providerAccountSchema.safeParse({ ...account, usedToday: { day: '28/10/2026', usd: 0 } })
        .success,
    ).toBe(false);
    expect(
      providerAccountSchema.safeParse({ ...account, usedToday: { day: '2026-10-28', usd: -1 } })
        .success,
    ).toBe(false);
    expect(providerAccountSchema.safeParse({ ...account, token: 'secret' }).success).toBe(false);
    expect(providerAccountSchema.safeParse({ ...account, id: 'acc_01JABCDEFG' }).success).toBe(
      false,
    );
  });

  it('names the providerAccount boundary when a field fails', () => {
    const error = errorOf(() => parseProviderAccount({ ...account, priority: -1 }));
    expect(error).toBeInstanceOf(ContractParseError);
    expect(error instanceof ContractParseError ? error.boundary : null).toBe('providerAccount');
  });
});

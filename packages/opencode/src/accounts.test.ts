import { describe, expect, it } from 'vitest';
import type { ProviderAccount } from '@codebox/contracts';
import {
  DEFAULT_ACCOUNT_COOLDOWN_SECONDS,
  QUOTA_REASON_PATTERN,
  classifyProviderFailure,
  decideFailover,
  selectAccount,
} from './accounts.js';
import type { ClassifiedProviderFailure, FailoverAction, ProviderFailureKind } from './accounts.js';

const NOW = new Date('2026-10-28T14:55:00.000Z');
const COOLDOWN = DEFAULT_ACCOUNT_COOLDOWN_SECONDS;

function account(
  overrides: Partial<ProviderAccount> & Pick<ProviderAccount, 'id'>,
): ProviderAccount {
  return {
    providerId: 'opencode-go',
    label: overrides.id,
    credentialId: `cred_${overrides.id}`,
    priority: 1,
    state: 'active',
    resetAt: null,
    budgetUsd: null,
    usedToday: { day: '1970-01-01', usd: 0 },
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:00:00.000Z',
    ...overrides,
  };
}

describe('classifyProviderFailure', () => {
  it('marks 401 and 403 as an auth failure on an invalid account', () => {
    const expected = {
      kind: 'auth',
      state: 'invalid',
      resetAt: null,
      retrySameAccount: false,
    };
    expect(
      classifyProviderFailure({ status: 401, reason: null, resetAt: null }, NOW, COOLDOWN),
    ).toEqual(expected);
    expect(
      classifyProviderFailure({ status: 403, reason: null, resetAt: null }, NOW, COOLDOWN),
    ).toEqual(expected);
  });

  it('marks 429 without a reported instant as exhausted for the default cooldown', () => {
    expect(
      classifyProviderFailure({ status: 429, reason: null, resetAt: null }, NOW, COOLDOWN),
    ).toEqual({
      kind: 'quota',
      state: 'exhausted',
      resetAt: '2026-10-28T15:10:00.000Z',
      retrySameAccount: false,
    });
  });

  it('keeps the instant the provider reports', () => {
    expect(
      classifyProviderFailure(
        { status: 429, reason: null, resetAt: '2026-10-28T15:00:00.000Z' },
        NOW,
        COOLDOWN,
      ).resetAt,
    ).toBe('2026-10-28T15:00:00.000Z');
  });

  it('marks 500 as a transient failure that is retried on the same account', () => {
    expect(
      classifyProviderFailure({ status: 500, reason: null, resetAt: null }, NOW, COOLDOWN),
    ).toEqual({ kind: 'transient', state: 'active', resetAt: null, retrySameAccount: true });
  });

  it('reads a quota reason when the status says nothing', () => {
    const quota = classifyProviderFailure(
      { status: null, reason: 'insufficient_quota', resetAt: null },
      NOW,
      COOLDOWN,
    );
    expect(quota.kind).toBe('quota');
    expect(quota.state).toBe('exhausted');
    expect(
      classifyProviderFailure({ status: null, reason: 'nope', resetAt: null }, NOW, COOLDOWN).kind,
    ).toBe('transient');
  });

  it('matches the quota reason case-insensitively', () => {
    expect(QUOTA_REASON_PATTERN.test('INSUFFICIENT_QUOTA')).toBe(true);
    expect(QUOTA_REASON_PATTERN.test('RateLimit')).toBe(true);
    expect(QUOTA_REASON_PATTERN.test('model_error')).toBe(false);
  });

  it('computes the cooldown from the argument, not from a constant', () => {
    expect(
      classifyProviderFailure({ status: 429, reason: null, resetAt: null }, NOW, 60).resetAt,
    ).toBe('2026-10-28T14:56:00.000Z');
  });
});

describe('decideFailover', () => {
  const kinds: readonly ProviderFailureKind[] = ['auth', 'quota', 'transient'];
  const classified: Readonly<Record<ProviderFailureKind, ClassifiedProviderFailure>> = {
    auth: { kind: 'auth', state: 'invalid', resetAt: null, retrySameAccount: false },
    quota: {
      kind: 'quota',
      state: 'exhausted',
      resetAt: '2026-10-28T15:10:00.000Z',
      retrySameAccount: false,
    },
    transient: { kind: 'transient', state: 'active', resetAt: null, retrySameAccount: true },
  };

  it('stops for every kind once a tool call was emitted', () => {
    for (const kind of kinds) {
      for (const retriedOnAccount of [false, true]) {
        expect(
          decideFailover({ failure: classified[kind], toolCallEmitted: true, retriedOnAccount }),
        ).toBe('stop');
      }
    }
  });

  it('retries a transient failure once on the same account', () => {
    expect(
      decideFailover({
        failure: classified.transient,
        toolCallEmitted: false,
        retriedOnAccount: false,
      }),
    ).toBe('retry_same');
  });

  it('moves to the next account otherwise', () => {
    const expected: Readonly<Record<string, FailoverAction>> = {
      'auth:false': 'next_account',
      'auth:true': 'next_account',
      'quota:false': 'next_account',
      'quota:true': 'next_account',
      'transient:true': 'next_account',
    };
    for (const kind of kinds) {
      for (const retriedOnAccount of [false, true]) {
        const key = `${kind}:${retriedOnAccount}`;
        const action = decideFailover({
          failure: classified[kind],
          toolCallEmitted: false,
          retriedOnAccount,
        });
        if (key === 'transient:false') continue;
        expect(action, key).toBe(expected[key]);
      }
    }
  });
});

describe('selectAccount', () => {
  it('answers null for an empty list', () => {
    expect(selectAccount([], NOW)).toBeNull();
  });

  it('takes the lowest priority that is usable', () => {
    const second = account({ id: 'acct_second0000', priority: 2 });
    const first = account({ id: 'acct_first00000', priority: 1 });
    expect(selectAccount([second, first], NOW)).toBe(first);
  });

  it('skips an invalid account and falls to the next priority', () => {
    const invalid = account({ id: 'acct_invalid000', priority: 1, state: 'invalid' });
    const next = account({ id: 'acct_next00000', priority: 2 });
    expect(selectAccount([invalid, next], NOW)).toBe(next);
  });

  it('skips an exhausted account until its reset instant passes', () => {
    const future = account({
      id: 'acct_future000',
      priority: 1,
      state: 'exhausted',
      resetAt: '2026-10-28T14:55:01.000Z',
    });
    const past = account({
      id: 'acct_past00000',
      priority: 1,
      state: 'exhausted',
      resetAt: '2026-10-28T14:54:59.000Z',
    });
    expect(selectAccount([future], NOW)).toBeNull();
    expect(selectAccount([past], NOW)).toBe(past);
  });

  it('ties an equal priority by the lower id', () => {
    const beta = account({ id: 'acct_beta00000', priority: 3 });
    const alpha = account({ id: 'acct_alpha0000', priority: 3 });
    expect(selectAccount([beta, alpha], NOW)).toBe(alpha);
  });

  it('never selects a disabled account', () => {
    expect(selectAccount([account({ id: 'acct_disabled0', state: 'disabled' })], NOW)).toBeNull();
  });
});

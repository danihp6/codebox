import type { ProviderAccount, ProviderAccountState } from '@codebox/contracts';

/** D54 fallback when the provider reports no reset instant. `docs/providers.md` §5.1. */
export const DEFAULT_ACCOUNT_COOLDOWN_SECONDS = 900;

/** `docs/providers.md` §5.1: 401/403, 429 or quota, anything else. */
export type ProviderFailureKind = 'auth' | 'quota' | 'transient';

export interface ProviderFailure {
  /** HTTP status observed at the provider edge, when there is one. */
  readonly status: number | null;
  /** A machine reason token the provider or the client reported, when there is one. */
  readonly reason: string | null;
  /** The instant the provider says the quota returns, when it says one. */
  readonly resetAt: string | null;
}

export interface ClassifiedProviderFailure {
  readonly kind: ProviderFailureKind;
  /** The state to persist on the account. */
  readonly state: ProviderAccountState;
  /** ISO instant, non-null exactly when `state === 'exhausted'`. */
  readonly resetAt: string | null;
  /** `true` only for a transient failure: it is retried once on the same account. */
  readonly retrySameAccount: boolean;
}

/** Matched case-insensitively against `ProviderFailure.reason`. */
export const QUOTA_REASON_PATTERN: RegExp = /quota|rate[\s_-]?limit|too[\s_-]?many[\s_-]?requests/i;

export type FailoverAction = 'retry_same' | 'next_account' | 'stop';

export interface FailoverInput {
  readonly failure: ClassifiedProviderFailure;
  /** `true` once the turn has emitted any tool call. Nothing may be replayed after it. */
  readonly toolCallEmitted: boolean;
  /** `true` when the transient retry of this account already happened. */
  readonly retriedOnAccount: boolean;
}

function usableAt(account: ProviderAccount, at: number): boolean {
  if (account.state === 'active') return true;
  if (account.state !== 'exhausted' || account.resetAt === null) return false;
  const reset = Date.parse(account.resetAt);
  return !Number.isNaN(reset) && reset <= at;
}

/**
 * The account a turn runs on: the lowest `priority` that is usable at `now`, tie-broken by id.
 * Usable = `state === 'active'`, or `state === 'exhausted'` with `resetAt` parseable and
 * `Date.parse(resetAt) <= now.getTime()`. `null` when nothing is usable.
 */
export function selectAccount(
  accounts: readonly ProviderAccount[],
  now: Date,
): ProviderAccount | null {
  const at = now.getTime();
  let chosen: ProviderAccount | null = null;
  for (const account of accounts) {
    if (!usableAt(account, at)) continue;
    const better =
      chosen === null ||
      account.priority < chosen.priority ||
      (account.priority === chosen.priority && account.id < chosen.id);
    if (better) chosen = account;
  }
  return chosen;
}

function quotaResetAt(reported: string | null, now: Date, cooldownSeconds: number): string {
  if (reported !== null && !Number.isNaN(Date.parse(reported))) return reported;
  return new Date(now.getTime() + cooldownSeconds * 1_000).toISOString();
}

/**
 * `1` `status` is 401 or 403 → `auth` / `invalid` / `resetAt: null` / `retrySameAccount: false`.
 * `2` otherwise, `status === 429` or a `reason` matching `QUOTA_REASON_PATTERN` → `quota` /
 *     `exhausted` / `resetAt = failure.resetAt` when it parses as an instant, else
 *     `new Date(now.getTime() + cooldownSeconds * 1_000).toISOString()` /
 *     `retrySameAccount: false`.
 * `3` anything else → `transient` / `active` / `resetAt: null` / `retrySameAccount: true`.
 */
export function classifyProviderFailure(
  failure: ProviderFailure,
  now: Date,
  cooldownSeconds: number,
): ClassifiedProviderFailure {
  if (failure.status === 401 || failure.status === 403) {
    return { kind: 'auth', state: 'invalid', resetAt: null, retrySameAccount: false };
  }
  const quota =
    failure.status === 429 ||
    (failure.reason !== null && QUOTA_REASON_PATTERN.test(failure.reason));
  if (quota) {
    return {
      kind: 'quota',
      state: 'exhausted',
      resetAt: quotaResetAt(failure.resetAt, now, cooldownSeconds),
      retrySameAccount: false,
    };
  }
  return { kind: 'transient', state: 'active', resetAt: null, retrySameAccount: true };
}

/**
 * `1` `toolCallEmitted === true` → `'stop'`, for every kind.
 * `2` `kind === 'transient'` and `retriedOnAccount === false` → `'retry_same'`.
 * `3` otherwise → `'next_account'`.
 */
export function decideFailover(input: FailoverInput): FailoverAction {
  if (input.toolCallEmitted) return 'stop';
  if (input.failure.kind === 'transient' && !input.retriedOnAccount) return 'retry_same';
  return 'next_account';
}

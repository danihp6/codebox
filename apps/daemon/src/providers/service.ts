import type {
  Provider,
  ProviderAccount,
  ProviderAccountId,
  ProviderAccountState,
  ProviderId,
} from '@codebox/contracts';
import {
  AgentError,
  DEFAULT_ACCOUNT_COOLDOWN_SECONDS,
  classifyProviderFailure,
  createAgentRuntime,
  decideFailover,
  selectAccount,
} from '@codebox/opencode';
import type { AgentRuntime, FailoverAction, ModelRef, ProviderFailure } from '@codebox/opencode';
import type { DaemonContext } from '../modules.js';
import { RunApiError } from '../runs/errors.js';
import { PROVIDER_CATALOG, providerCatalogRank } from './catalog.js';
import { createProviderCredentialPort } from './credentials.js';
import type { ProviderCredentialPort } from './credentials.js';
import { ProviderExhaustedError } from './errors.js';
import { newOauthState, newProviderAccountId } from './ids.js';
import { DEFAULT_OAUTH_ADAPTERS, OAUTH_STATE_TTL_SECONDS, encodeOauthEnvelope } from './oauth.js';
import type { ProviderOauthAdapter, ProviderOauthTokens } from './oauth.js';
import type {
  AddTokenAccountInput,
  CompleteOauthInput,
  PatchAccountInput,
  StartOauthInput,
} from './schemas.js';

export interface ProviderAccountView extends ProviderAccount {
  /** At most the last four characters of the sealed value; `''` when unknown. */
  readonly lastFour: string;
}

export interface ProviderView extends Provider {
  readonly accounts: readonly ProviderAccountView[];
}

/** `GET /v1/providers` — the only body the app reads for `/settings/providers`. */
export interface ProvidersResponse {
  readonly providers: readonly ProviderView[];
}

export interface AccountTestResult {
  readonly ok: boolean;
  readonly state: ProviderAccountState;
  /** `null`, `'not_active'`, `'agent_unavailable'` or `'provider_unknown'`. */
  readonly lastError: string | null;
}

export interface OauthStartResult {
  readonly authorizeUrl: string;
  readonly state: string;
}

export interface TurnHandle {
  readonly providerId: ProviderId;
  readonly accountId: ProviderAccountId;
  readonly credentialId: string;
  readonly model: string | null;
}

export interface TurnFailure {
  readonly accountId: ProviderAccountId;
  readonly failure: ProviderFailure;
  readonly toolCallEmitted: boolean;
  readonly retriedOnAccount: boolean;
}

export interface TurnFailureOutcome {
  readonly action: FailoverAction;
  readonly account: ProviderAccountView;
  /** The earliest `resetAt` among the provider's accounts, or `null`. */
  readonly retryAt: string | null;
}

export interface ProvidersService {
  list(): ProvidersResponse;
  addTokenAccount(providerId: ProviderId, input: AddTokenAccountInput): ProviderAccountView;
  patchAccount(id: ProviderAccountId, input: PatchAccountInput): ProviderAccountView;
  removeAccount(id: ProviderAccountId): void;
  testAccount(id: ProviderAccountId): Promise<AccountTestResult>;
  startOauth(providerId: ProviderId, input: StartOauthInput): OauthStartResult;
  completeOauth(providerId: ProviderId, input: CompleteOauthInput): Promise<ProviderAccountView>;
  /** Releases due resets, then selects. Throws `ProviderExhaustedError` when none is usable. */
  beginTurn(providerId: ProviderId): TurnHandle;
  /** Classifies, persists the state and answers what the caller does next. */
  recordFailure(input: TurnFailure): TurnFailureOutcome;
  /** Flips every `exhausted` account whose `resetAt <= now` back to `active`. Count of rows. */
  releaseDue(now: Date): number;
}

export interface CreateProvidersServiceOptions {
  readonly context: DaemonContext;
  readonly now?: () => Date;
  readonly credentials?: ProviderCredentialPort;
  readonly oauth?: readonly ProviderOauthAdapter[];
  readonly runtime?: Pick<AgentRuntime, 'listModels'>;
  readonly cooldownSeconds?: number;
}

const AGENT_REQUEST_TIMEOUT_MS = 30_000;
const AGENT_RECONNECT_DELAY_MS = 1_000;
const NEVER_USED_DAY = '1970-01-01';
const NO_ACTIVE_ACCOUNT = 'no_active_account';
const OAUTH_UNSUPPORTED = 'provider_oauth_unsupported';
const STATE_INVALID = 'state_invalid';
const PROVIDER_UNAVAILABLE = 'provider_unavailable';
const LAST_FOUR = 4;

interface PendingOauth {
  readonly providerId: string;
  readonly label: string;
  readonly priority: number;
  readonly expiresAt: number;
}

function atMostFour(value: string): string {
  return value.length > LAST_FOUR ? value.slice(-LAST_FOUR) : value;
}

function orderAccounts(left: ProviderAccount, right: ProviderAccount): number {
  if (left.priority !== right.priority) return left.priority - right.priority;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function orderProviders(left: Provider, right: Provider): number {
  const delta = providerCatalogRank(left.id) - providerCatalogRank(right.id);
  if (delta !== 0) return delta;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function credentialName(providerId: string, label: string): string {
  const rank = PROVIDER_CATALOG.find((descriptor) => descriptor.id === providerId);
  return `${rank?.label ?? providerId} · ${label}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createProvidersService(options: CreateProvidersServiceOptions): ProvidersService {
  const context = options.context;
  const config = context.config;
  const store = context.store;
  const logger = context.logger;
  const now = options.now ?? context.clock;
  const cooldownSeconds = options.cooldownSeconds ?? DEFAULT_ACCOUNT_COOLDOWN_SECONDS;
  const credentials = options.credentials ?? createProviderCredentialPort(context);
  const adapters = options.oauth ?? DEFAULT_OAUTH_ADAPTERS;
  const pending = new Map<string, PendingOauth>();
  const pendingTtlMs = OAUTH_STATE_TTL_SECONDS * 1_000;

  let runtime: Pick<AgentRuntime, 'listModels'> | null = options.runtime ?? null;

  // `ProviderAccountRepository` (Task-70) exposes no delete, and packages/store is outside this
  // task's paths: the single statement is prepared here, never built from input.
  const removeRow = store.db.prepare('DELETE FROM provider_accounts WHERE id = ?');

  function agent(): Pick<AgentRuntime, 'listModels'> {
    if (runtime === null) {
      runtime = createAgentRuntime({
        baseUrl: config.CB_OPENCODE_URL,
        token: config.CB_OPENCODE_TOKEN,
        healthPath: config.CB_OPENCODE_HEALTH_PATH,
        fetch: (input, init) => globalThis.fetch(input, init),
        requestTimeoutMs: AGENT_REQUEST_TIMEOUT_MS,
        reconnectDelayMs: AGENT_RECONNECT_DELAY_MS,
        sleep,
      });
    }
    return runtime;
  }

  function view(account: ProviderAccount): ProviderAccountView {
    return { ...account, lastFour: atMostFour(credentials.lastFour(account.credentialId)) };
  }

  function logState(account: ProviderAccount, reason: string | null): void {
    logger.info({
      msg: 'provider_account_state',
      providerId: account.providerId,
      accountId: account.id,
      state: account.state,
      reason,
    });
  }

  function requireAccount(id: string): ProviderAccount {
    const account = store.providerAccounts.get(id);
    if (account === null) {
      throw new RunApiError('not_found', 404, { path: 'providerAccount.id' });
    }
    return account;
  }

  function requireProvider(providerId: string): void {
    if (store.providers.get(providerId) === null) {
      throw new RunApiError('validation_failed', 422, { path: 'provider.id' });
    }
  }

  function activeCount(providerId: string): number {
    return store.providerAccounts.list({ providerId, state: 'active' }).length;
  }

  function retryAtOf(providerId: string): string | null {
    let earliest: string | null = null;
    let earliestMs = Number.POSITIVE_INFINITY;
    for (const account of store.providerAccounts.list({ providerId })) {
      if (account.resetAt === null) continue;
      const at = Date.parse(account.resetAt);
      if (Number.isNaN(at) || at >= earliestMs) continue;
      earliest = account.resetAt;
      earliestMs = at;
    }
    return earliest;
  }

  function release(at: Date): number {
    const iso = at.toISOString();
    let released = 0;
    for (const account of store.providerAccounts.listDueResets(iso)) {
      store.providerAccounts.update(account.id, { state: 'active', resetAt: null, updatedAt: iso });
      logger.info({
        msg: 'provider_account_reset',
        providerId: account.providerId,
        accountId: account.id,
      });
      released += 1;
    }
    return released;
  }

  function adapterFor(providerId: string): ProviderOauthAdapter | null {
    return adapters.find((adapter) => adapter.providerId === providerId) ?? null;
  }

  function prunePending(at: number): void {
    for (const [state, entry] of pending) {
      if (entry.expiresAt <= at) pending.delete(state);
    }
  }

  function takePending(state: string, at: number): PendingOauth | null {
    const entry = pending.get(state);
    pending.delete(state);
    prunePending(at);
    if (entry === undefined || entry.expiresAt <= at) return null;
    return entry;
  }

  function oauthRefused(providerId: string): RunApiError {
    logger.warn({ msg: 'provider_oauth_refused', providerId });
    return new RunApiError('validation_failed', 422, {
      path: 'provider.id',
      reason: OAUTH_UNSUPPORTED,
    });
  }

  function stateInvalid(): RunApiError {
    return new RunApiError('validation_failed', 422, {
      path: 'oauth.state',
      reason: STATE_INVALID,
    });
  }

  function sealAndCreate(input: {
    readonly providerId: string;
    readonly label: string;
    readonly priority: number;
    readonly value: string;
  }): ProviderAccountView {
    const at = now().toISOString();
    const credential = credentials.create({
      name: credentialName(input.providerId, input.label),
      value: input.value,
    });
    let account: ProviderAccount;
    try {
      account = store.providerAccounts.create({
        id: newProviderAccountId(),
        providerId: input.providerId,
        label: input.label,
        credentialId: credential.id,
        priority: input.priority,
        state: 'active',
        resetAt: null,
        budgetUsd: null,
        usedToday: { day: NEVER_USED_DAY, usd: 0 },
        createdAt: at,
        updatedAt: at,
      });
    } catch (error) {
      // The sealed credential must not outlive an account that was never stored.
      credentials.remove(credential.id);
      throw error;
    }
    logState(account, null);
    return { ...account, lastFour: atMostFour(credential.lastFour) };
  }

  return {
    list(): ProvidersResponse {
      const providers = [...store.providers.list()].sort(orderProviders);
      return {
        providers: providers.map((provider) => ({
          ...provider,
          accounts: store.providerAccounts
            .list({ providerId: provider.id })
            .sort(orderAccounts)
            .map(view),
        })),
      };
    },

    addTokenAccount(providerId: ProviderId, input: AddTokenAccountInput): ProviderAccountView {
      requireProvider(providerId);
      return sealAndCreate({
        providerId,
        label: input.label,
        priority: input.priority,
        value: input.value,
      });
    },

    patchAccount(id: ProviderAccountId, input: PatchAccountInput): ProviderAccountView {
      const account = requireAccount(id);
      const state: ProviderAccountState =
        input.enabled === undefined ? account.state : input.enabled ? 'active' : 'disabled';
      const resetAt = state === 'exhausted' ? account.resetAt : null;
      if (
        state !== 'active' &&
        account.state === 'active' &&
        activeCount(account.providerId) <= 1
      ) {
        throw new RunApiError('conflict', 409, { reason: NO_ACTIVE_ACCOUNT });
      }
      const stateChanged = state !== account.state || resetAt !== account.resetAt;
      const updated = store.providerAccounts.update(id, {
        updatedAt: now().toISOString(),
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.budgetUsd === undefined ? {} : { budgetUsd: input.budgetUsd }),
        ...(stateChanged ? { state, resetAt } : {}),
      });
      if (stateChanged) logState(updated, null);
      return view(updated);
    },

    removeAccount(id: ProviderAccountId): void {
      const account = requireAccount(id);
      if (account.state === 'active' && activeCount(account.providerId) <= 1) {
        throw new RunApiError('conflict', 409, { reason: NO_ACTIVE_ACCOUNT });
      }
      removeRow.run(id);
      credentials.remove(account.credentialId);
    },

    async testAccount(id: ProviderAccountId): Promise<AccountTestResult> {
      const account = requireAccount(id);
      if (account.state !== 'active') {
        return { ok: false, state: account.state, lastError: 'not_active' };
      }
      let models: readonly ModelRef[];
      try {
        models = await agent().listModels();
      } catch (error) {
        if (error instanceof AgentError) {
          return { ok: false, state: account.state, lastError: 'agent_unavailable' };
        }
        throw error;
      }
      const known = models.some((model) => model.providerId === account.providerId);
      return {
        ok: known,
        state: account.state,
        lastError: known ? null : 'provider_unknown',
      };
    },

    startOauth(providerId: ProviderId, input: StartOauthInput): OauthStartResult {
      const adapter = adapterFor(providerId);
      if (adapter === null) throw oauthRefused(providerId);
      const at = now().getTime();
      prunePending(at);
      const state = newOauthState();
      pending.set(state, {
        providerId,
        label: input.label,
        priority: input.priority,
        expiresAt: at + pendingTtlMs,
      });
      return { authorizeUrl: adapter.authorizeUrl({ state }), state };
    },

    async completeOauth(
      providerId: ProviderId,
      input: CompleteOauthInput,
    ): Promise<ProviderAccountView> {
      const entry = takePending(input.state, now().getTime());
      if (entry === null || entry.providerId !== providerId) throw stateInvalid();
      const adapter = adapterFor(providerId);
      if (adapter === null) throw oauthRefused(providerId);
      requireProvider(providerId);
      let tokens: ProviderOauthTokens;
      try {
        tokens = await adapter.exchange({ code: input.code });
      } catch {
        throw new RunApiError('provider_unavailable', 503, { reason: PROVIDER_UNAVAILABLE });
      }
      return sealAndCreate({
        providerId,
        label: entry.label,
        priority: entry.priority,
        value: encodeOauthEnvelope(tokens),
      });
    },

    beginTurn(providerId: ProviderId): TurnHandle {
      const at = now();
      release(at);
      const account = selectAccount(store.providerAccounts.list({ providerId }), at);
      if (account === null) {
        const retryAt = retryAtOf(providerId);
        logger.warn({ msg: 'provider_exhausted', providerId, retryAt });
        throw new ProviderExhaustedError(providerId, retryAt);
      }
      return {
        providerId,
        accountId: account.id,
        credentialId: account.credentialId,
        model: null,
      };
    },

    recordFailure(input: TurnFailure): TurnFailureOutcome {
      const account = requireAccount(input.accountId);
      const at = now();
      const failure = classifyProviderFailure(input.failure, at, cooldownSeconds);
      const action = decideFailover({
        failure,
        toolCallEmitted: input.toolCallEmitted,
        retriedOnAccount: input.retriedOnAccount,
      });
      let current = account;
      if (failure.kind !== 'transient') {
        current = store.providerAccounts.update(account.id, {
          state: failure.state,
          resetAt: failure.resetAt,
          updatedAt: at.toISOString(),
        });
        logState(current, failure.kind);
      }
      return {
        action,
        account: view(current),
        retryAt: retryAtOf(account.providerId),
      };
    },

    releaseDue(at: Date): number {
      return release(at);
    },
  };
}

# Spec: Task-73 — Provider accounts and failover

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** daemon (a new `providers` subsystem, its routes and its stored state) plus one
  pure module in a package. The decision is pure; the I/O stays in the daemon.
- **Role:** Dev.
- **Objective:** D54 exists in code. A provider error is **classified** instead of retried
  blindly, the account it happened on gets a state and a `resetAt`, the turn is re-sent on the
  next account **only when no tool call was emitted**, and a provider with no `active` account
  fails closed with `provider_exhausted` rather than degrading. The daemon exposes
  `GET /v1/providers` and the six account mutations of `docs/api.md` §5.9.1 (the documented
  table's seven rows), and the credential value never leaves the write-only store.
- **Environment:** worktree `../wt-cb-73`, branch `task-73`, base `main`.
- **Dependencies:** **Task-70 (merged, `c58d8be`)**. It produced
  `packages/contracts/src/providers.ts` (`providerSchema`, `providerAccountSchema`,
  `PROVIDER_ACCOUNT_STATES`, `Provider`, `ProviderAccount`, `ProviderAccountState`,
  `ProviderId`, `ProviderAuthKind`), migration `0007_providers.sql` (`providers`,
  `provider_accounts`) and `packages/store/src/providers.ts`
  (`createProviderRepository`, `createProviderAccountRepository`, `selectActive`,
  `listDueResets`), available as `store.providers` and `store.providerAccounts`.
  The token store this task writes through is Task-58's
  `apps/daemon/src/credentials/service.ts` (`createCredentialsService`, `open`, `list`,
  `remove`).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `packages/opencode/src/accounts.ts` (new)
- `packages/opencode/src/accounts.test.ts` (new)
- `packages/opencode/src/index.ts` (one export block added)
- `packages/opencode/README.md` (file map lines for the two files above)
- `apps/daemon/src/providers/index.ts` (new)
- `apps/daemon/src/providers/index.test.ts` (new)
- `apps/daemon/src/providers/service.ts` (new)
- `apps/daemon/src/providers/service.test.ts` (new)
- `apps/daemon/src/providers/routes.ts` (new)
- `apps/daemon/src/providers/routes.test.ts` (new)
- `apps/daemon/src/providers/schemas.ts` (new)
- `apps/daemon/src/providers/errors.ts` (new)
- `apps/daemon/src/providers/errors.test.ts` (new)
- `apps/daemon/src/providers/oauth.ts` (new)
- `apps/daemon/src/providers/oauth.test.ts` (new)
- `apps/daemon/src/providers/credentials.ts` (new)
- `apps/daemon/src/providers/credentials.test.ts` (new)
- `apps/daemon/src/providers/catalog.ts` (new)
- `apps/daemon/src/providers/catalog.test.ts` (new)
- `apps/daemon/src/providers/ids.ts` (new)
- `apps/daemon/src/providers/ids.test.ts` (new)
- `apps/daemon/src/modules.ts` (the registration seam: `SubsystemName`, `SUBSYSTEMS`,
  `DEFAULT_SUBSYSTEM_FLAGS`)
- `apps/daemon/src/modules.test.ts` (the pinned subsystem list)
- `apps/daemon/README.md` (file map lines for the new folder)
- `docs/providers.md` — **§5.1 only** (the `### 5.1 Provider accounts (D54)` subsection).

`apps/daemon/src/main.ts` is a **hot file and must not change**: subsystems are discovered by
name from `SUBSYSTEMS`, so `providers` joins by being listed there and shipping
`src/providers/index.ts` with `createModule`. Do not touch `packages/contracts/**`,
`package.json`, `package-lock.json`, `tsconfig.base.json`, `TODO.md`, `CHANGELOG.md`,
`docs/decisions.md`, `docs/api.md`, `docs/jobs.md`, `apps/app/**`, any generated API file, or
`apps/daemon/src/credentials/**`, `apps/daemon/src/cli/**`, `apps/daemon/src/runs/**`,
`apps/daemon/src/run/**`, `apps/daemon/src/schedules/**`, `apps/daemon/src/chat/**`.

### Inputs (read-only)

- `AGENTS.md`
- `docs/providers.md` (§5.1 — the section you correct)
- `docs/api.md` §5.9.1 and its row at line ~907 (the documented surface; **do not edit it**)
- `docs/jobs.md` §16.3 (a fire's failure codes, including `provider_exhausted`)
- `packages/contracts/src/providers.ts`, `packages/contracts/src/primitives.ts`
  (`ID_PREFIXES.providerAccount` is `acct_`), `packages/contracts/src/works.ts` (D54 rows)
- `packages/contracts/src/errors.ts` (`ERROR_CODES` — it has **no** `provider_exhausted`)
- `packages/store/src/providers.ts`, `packages/store/migrations/0007_providers.sql`
- `packages/store/src/store.ts` (`store.providers`, `store.providerAccounts`,
  `openInMemoryStore`)
- `apps/daemon/src/modules.ts`, `apps/daemon/src/app.ts`, `apps/daemon/src/runs/errors.ts`
  (`RunApiError`, `handle`, `json`, `readJson`, `requireScope`, `API_PREFIX`)
- `apps/daemon/src/credentials/service.ts`, `apps/daemon/src/credentials/schemas.ts`,
  `apps/daemon/src/credentials/storage.ts` (`createCredentialsService`, `PublicCredential`)
- `apps/daemon/src/credentials/index.test.ts` and `apps/daemon/src/schedules/routes.test.ts`
  (the test harness pattern: in-memory store, auth module, `mintAccessToken`)
- `packages/opencode/src/errors.ts` (`AgentError`, `status`), `packages/opencode/src/types.ts`
  (`AgentRuntime.listModels`, `ModelRef`), `packages/opencode/src/fake.ts`
  (`startFakeOpenCode`)
- `apps/daemon/package.json` (already depends on `@codebox/contracts`, `@codebox/store`,
  `@codebox/opencode`)

## 🔒 Contract

The public surface other tasks are written against **right now**. Task-72 (next batch) calls
`providersServiceFor(context)` and nothing else from here.

```ts
// packages/opencode/src/accounts.ts — pure: no clock read, no I/O, `now` injected
import type { ProviderAccount, ProviderAccountState } from '@codebox/contracts';

/** D54 fallback when the provider reports no reset instant. `docs/providers.md` §5.1. */
export const DEFAULT_ACCOUNT_COOLDOWN_SECONDS = 900;

/**
 * The account a turn runs on: the lowest `priority` that is usable at `now`, tie-broken by id.
 * Usable = `state === 'active'`, or `state === 'exhausted'` with `resetAt` parseable and
 * `Date.parse(resetAt) <= now.getTime()`. `null` when nothing is usable.
 */
export function selectAccount(
  accounts: readonly ProviderAccount[],
  now: Date,
): ProviderAccount | null;

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
export const QUOTA_REASON_PATTERN: RegExp;

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
): ClassifiedProviderFailure;

export type FailoverAction = 'retry_same' | 'next_account' | 'stop';

export interface FailoverInput {
  readonly failure: ClassifiedProviderFailure;
  /** `true` once the turn has emitted any tool call. Nothing may be replayed after it. */
  readonly toolCallEmitted: boolean;
  /** `true` when the transient retry of this account already happened. */
  readonly retriedOnAccount: boolean;
}

/**
 * `1` `toolCallEmitted === true` → `'stop'`, for every kind.
 * `2` `kind === 'transient'` and `retriedOnAccount === false` → `'retry_same'`.
 * `3` otherwise → `'next_account'`.
 */
export function decideFailover(input: FailoverInput): FailoverAction;
```

```ts
// packages/opencode/src/index.ts — one added block, same style as its neighbours
export {
  DEFAULT_ACCOUNT_COOLDOWN_SECONDS,
  QUOTA_REASON_PATTERN,
  classifyProviderFailure,
  decideFailover,
  selectAccount,
} from './accounts.js';
export type {
  ClassifiedProviderFailure,
  FailoverAction,
  FailoverInput,
  ProviderFailure,
  ProviderFailureKind,
} from './accounts.js';
```

```ts
// apps/daemon/src/providers/errors.ts
import { RunApiError } from '../runs/errors.js';

/** The D54 failure code. A run/fire code, **not** a contract `ErrorCode`. */
export const PROVIDER_EXHAUSTED = 'provider_exhausted' as const;
export type ProviderExhaustedCode = typeof PROVIDER_EXHAUSTED;

/** Thrown when a provider has no usable account. `retryAt` is informational. */
export class ProviderExhaustedError extends Error {
  readonly code: ProviderExhaustedCode;
  readonly providerId: string;
  readonly retryAt: string | null;
  constructor(providerId: string, retryAt: string | null);
}

/**
 * The one HTTP mapping, without adding to `packages/contracts/src/errors.ts`:
 * `new RunApiError('provider_unavailable', 503, { reason: 'provider_exhausted', retryAt })`,
 * whose message is the frozen `MESSAGES.provider_unavailable` text.
 */
export function providerExhaustedApiError(error: ProviderExhaustedError): RunApiError;
```

```ts
// apps/daemon/src/providers/schemas.ts — every request body, parsed at the edge
export const PROVIDER_LABEL_MAX_LENGTH = 80;
export const ACCOUNT_TOKEN_MAX_LENGTH = 16_384;

export const addTokenAccountSchema;   // strictObject { label, priority, auth: literal 'token', value }
export const patchAccountSchema;      // strictObject { label?, priority?, enabled?, budgetUsd? }
export const startOauthSchema;        // strictObject { label, priority }
export const completeOauthSchema;     // strictObject { code, state }
export type AddTokenAccountInput;
export type PatchAccountInput;
export type StartOauthInput;
export type CompleteOauthInput;
```

```ts
// apps/daemon/src/providers/catalog.ts
import type { Provider, ProviderAuthKind, ProviderId } from '@codebox/contracts';
import type { Store } from '@codebox/store';

export interface ProviderDescriptor {
  readonly id: ProviderId;
  readonly label: string;
  readonly authKind: ProviderAuthKind;
}

/** The adapters the box knows before any account exists. `docs/providers.md` §5.1. */
export const PROVIDER_CATALOG: readonly ProviderDescriptor[]; // opencode-go/oauth, anthropic/token, openai/token

/** Inserts the missing catalog rows. Idempotent; a second call changes nothing. */
export function seedProviderCatalog(store: Store, at: string): readonly Provider[];
```

```ts
// apps/daemon/src/providers/credentials.ts
import type { DaemonContext } from '../modules.js';

export interface ProviderCredentialPort {
  create(input: {
    readonly name: string;
    readonly value: string;
  }): { readonly id: string; readonly lastFour: string };
  lastFour(id: string): string;
  remove(id: string): void;
}

/** Wraps Task-58's store: `kind: 'model_key'`, `expose: 'daemon'`, never returns the value. */
export function createProviderCredentialPort(context: DaemonContext): ProviderCredentialPort;
```

```ts
// apps/daemon/src/providers/oauth.ts
import type { ProviderId } from '@codebox/contracts';

export const OAUTH_STATE_TTL_SECONDS = 600;
export const OAUTH_TOKEN_ENVELOPE_VERSION = 1;

export interface ProviderOauthTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string | null;
}

export interface ProviderOauthAdapter {
  readonly providerId: ProviderId;
  authorizeUrl(input: { readonly state: string }): string;
  exchange(input: { readonly code: string }): Promise<ProviderOauthTokens>;
}

/** Today: empty. A provider with no adapter answers `provider_oauth_unsupported`. */
export const DEFAULT_OAUTH_ADAPTERS: readonly ProviderOauthAdapter[];

/** `{"v":1,"access":"…","refresh":null,"expiresAt":null}` — the sealed value of an OAuth account. */
export function encodeOauthEnvelope(tokens: ProviderOauthTokens): string;
export function decodeOauthEnvelope(value: string): ProviderOauthTokens | null;
```

```ts
// apps/daemon/src/providers/ids.ts
/** `acct_` + 10 Crockford characters, the `ProviderAccountId` grammar. */
export function newProviderAccountId(random?: (size: number) => Buffer): string;
/** 32 URL-safe characters from `randomBytes(24)`. */
export function newOauthState(random?: (size: number) => Buffer): string;
```

```ts
// apps/daemon/src/providers/service.ts
import type { AgentRuntime } from '@codebox/opencode';
import type {
  Provider,
  ProviderAccount,
  ProviderAccountId,
  ProviderAccountState,
  ProviderId,
} from '@codebox/contracts';
import type { DaemonContext } from '../modules.js';

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

export function createProvidersService(options: CreateProvidersServiceOptions): ProvidersService;
```

```ts
// apps/daemon/src/providers/index.ts
import type { DaemonContext, DaemonModule } from '../modules.js';

// `createModule`: seeds PROVIDER_CATALOG through the store, then `register` mounts the routes.
// `providersServiceFor` builds once per context (WeakMap, like `chatServiceFor`), seeds too, and
// is the handle Task-72 uses.
export function createModule(context: DaemonContext): DaemonModule; // name: 'providers'
export function providersServiceFor(context: DaemonContext): ProvidersService; // one per context
export { createProvidersService } from './service.js';
export { PROVIDER_EXHAUSTED, ProviderExhaustedError, providerExhaustedApiError } from './errors.js';
export type {
  AccountTestResult,
  OauthStartResult,
  ProviderAccountView,
  ProvidersResponse,
  ProviderView,
  ProvidersService,
  TurnFailure,
  TurnFailureOutcome,
  TurnHandle,
} from './service.js';
```

```ts
// apps/daemon/src/providers/routes.ts
import type { DaemonApp } from '../modules.js';

export function registerProviderRoutes(app: DaemonApp, service: ProvidersService): void;
```

**HTTP surface** (`docs/api.md` §5.9.1; the dev implements it and edits neither that file nor
`packages/contracts/src/openapi.ts`). `API_PREFIX` is `/v1`; every handler goes through
`handle(c, 'providerAccount' | 'provider', …)`, reads its body with `readJson`, and calls
`requireScope(c, 'admin')` on everything but the GET.

| Method | Path | Success | Documented refusals |
| --- | --- | --- | --- |
| `GET` | `/v1/providers` | `200` `ProvidersResponse`, catalog order then `priority`, then `id` | — (`read` scope comes from the auth middleware) |
| `POST` | `/v1/providers/{id}/accounts` | `201` `ProviderAccountView` | `422` invalid body or `provider.id`; `503` `provider_unavailable` with `details.reason = "secrets_not_configured"`; `409` `conflict` with `details.reason = "unique_violation"` for a repeated `label` |
| `POST` | `/v1/providers/{id}/oauth/start` | `200` `{ authorizeUrl, state }` | `422` `validation_failed` with `{ path: "provider.id", reason: "provider_oauth_unsupported" }` when no adapter is registered |
| `POST` | `/v1/providers/{id}/oauth/complete` | `201` `ProviderAccountView` | `422` `{ path: "oauth.state", reason: "state_invalid" }` for unknown, replayed or expired state; `503` `provider_unavailable` with `{ reason: "provider_unavailable" }` when the exchange fails |
| `PATCH` | `/v1/provider-accounts/{id}` | `200` `ProviderAccountView` | `404` `{ path: "providerAccount.id" }`; `409` `conflict` with `{ reason: "no_active_account" }` when the patch would leave no `active` account |
| `POST` | `/v1/provider-accounts/{id}/test` | `200` `AccountTestResult` | `404` `{ path: "providerAccount.id" }` |
| `DELETE` | `/v1/provider-accounts/{id}` | `204` no body | `404`; `409` `{ reason: "no_active_account" }` |

- **Errors:** the envelope is `handle`'s. `ProviderExhaustedError` is mapped by
  `providerExhaustedApiError` (`503`, `code: "provider_unavailable"`,
  `details.reason: "provider_exhausted"`, `details.retryAt`) — never a new contract error code.
  `packages/contracts/src/errors.ts` is not touched.
- **Purity:** `classifyProviderFailure`, `decideFailover` and `selectAccount` read no clock and
  no environment; `now` and `cooldownSeconds` are arguments. A token value exists only inside
  `createProviderCredentialPort` and the credential store; no type above carries it, no log line
  contains it, and no response contains more than four characters of it.
- **Ordering:** `beginTurn` calls `releaseDue(now)` first, then selects. `recordFailure`
  classifies, writes the account, logs once (`provider_account_state`), then answers.
- **Log lines** (structured, redacted):
  `provider_account_state` `{ providerId, accountId, state, reason }` on every write;
  `provider_account_reset` `{ providerId, accountId }` per released row;
  `provider_exhausted` `{ providerId, retryAt }` when `beginTurn` finds nothing;
  `provider_oauth_refused` `{ providerId }` when no adapter answers.

### Data

| Name | Shape | Default | Owner |
| --- | --- | --- | --- |
| `providers.id` | `providerIdSchema`, a slug (`opencode-go`, `anthropic`, `openai`) | from `PROVIDER_CATALOG` | `packages/contracts` |
| `provider_accounts.state` | `active \| exhausted \| invalid \| disabled` | `active` at creation | `packages/contracts` |
| `resetAt` | ISO instant, non-null exactly when `state = exhausted` (the table `CHECK` enforces it) | `now + 900 s` when the provider reports none | this task |
| `priority` | integer ≥ 0, lower wins | required in every create body | `packages/contracts` |
| `budgetUsd` | number ≥ 0 or `null` | `null` | `packages/contracts` |
| `usedToday` | `{ day: 'YYYY-MM-DD' (UTC), usd }` | `{ day: '1970-01-01', usd: 0 }` | `packages/store` |
| account credential | one `model_key` credential, `expose: 'daemon'`, value sealed | — | Task-58 store |
| OAuth sealed value | `{"v":1,"access":"…","refresh":…,"expiresAt":…}` | — | this task |
| `lastFour` | string, `''` or exactly the last four characters | `''` | this task |
| `DEFAULT_ACCOUNT_COOLDOWN_SECONDS` | `900` seconds | `900` | `packages/opencode` |
| `OAUTH_STATE_TTL_SECONDS` | `600` seconds, single use | `600` | this task |

`PATCH` semantics: `enabled: true` writes `state = 'active', resetAt = null`; `enabled: false`
writes `state = 'disabled', resetAt = null`. `state` is never accepted from a client.

## 🧩 Configuration

**No `CB_*` key is added, read or parsed by this task.** Two keys documented in
`docs/providers.md` §5.1 do not exist in `packages/contracts/src/config.ts`, and this task may
not add them:

- `CB_ACCOUNT_COOLDOWN_SECONDS` → the daemon uses `DEFAULT_ACCOUNT_COOLDOWN_SECONDS` (`900`) via
  `CreateProvidersServiceOptions.cooldownSeconds`.
- `CB_ACCOUNT_DAILY_USD` → the per-account stop is the account's `budgetUsd` column.

The §5.1 edit therefore removes both phantom keys and says the cooldown is the constant until a
contracts task parses the key. Reading `process.env` in `apps/daemon/src/providers/**` is
forbidden: every environment read goes through `apps/daemon/src/config.ts` and the contracts
schema.

**The `docs/providers.md` §5.1 edit, exactly — four changes, nothing outside the subsection:**

1. The `credentialId` table row stops claiming a credential kind that does not exist. It reads:
   one credential per account in the write-only store (D49), `kind: model_key`,
   `expose: daemon`; an OAuth account seals `{"v":1,"access","refresh","expiresAt"}`. (The kinds
   in `apps/daemon/src/credentials/schemas.ts` are `api_key`, `bearer`, `basic`, `github_app`,
   `model_key` — there is no `oauth` or `token` kind, and `model_key` is the only kind
   `expose: env` is allowed for.)
2. The `resetAt` row: "the provider's reported instant, or `now + 900 s`
   (`DEFAULT_ACCOUNT_COOLDOWN_SECONDS`; `CB_ACCOUNT_COOLDOWN_SECONDS` is not parsed by
   `packages/contracts/src/config.ts` yet and the constant is the behaviour until a contracts
   task adds it)".
3. The `usedToday` row: "informational unless the account carries `budgetUsd`" — the
   `CB_ACCOUNT_DAILY_USD` mention goes.
4. One closing paragraph (two or three sentences) that says how exhaustion surfaces: a
   `503` with `code: provider_unavailable` and `details.reason: "provider_exhausted"` plus
   `details.retryAt`; a fire row records the bare string `provider_exhausted`
   (`docs/jobs.md` §16.3); and the account's key reaches the agent through the `opencode serve`
   environment because the pinned client creates a session with a `model`, not a credential.

## 🧪 Test and Validation Plan (for QA)

Run from the task worktree, in this order.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` — must exit 0 (this task changes no
    `package.json`, so the lockfile is untouched).
  - `npm run lint` — must pass.
  - `npm test` — the whole gate, including the app suite, the workspace coverage guard and this
    task's tests.
  - `npx vitest run --project apps/daemon` and `npx vitest run --project packages/opencode` —
    the two projects this task touches.
  - `npm run build` — must pass; `apps/daemon/dist/providers/index.js` exists.
  - `git diff --name-only main...task-73 | sort` — the scope audit.

- **Acceptance criteria:**
  - [ ] `[unit]` `npm ci && npm run lint && npm test && npm run build` all exit 0.
  - [ ] `[unit]` `accounts.test.ts` pins the three tables exactly:
    `classifyProviderFailure({status: 401, …})` → `{kind:'auth', state:'invalid', resetAt:null,
    retrySameAccount:false}`; `{status: 403}` the same; `{status: 429, resetAt: null}` →
    `{kind:'quota', state:'exhausted', resetAt: <now + 900 s>, retrySameAccount:false}`;
    `{status: 429, resetAt: '2026-10-28T15:00:00.000Z'}` keeps that instant;
    `{status: 500}` → `{kind:'transient', state:'active', resetAt:null, retrySameAccount:true}`;
    `{status: null, reason: 'insufficient_quota'}` → `quota`; `{status: null, reason: 'nope'}` →
    `transient`; a non-null `cooldownSeconds` argument other than 900 changes the computed
    instant. `decideFailover` for every combination of the three kinds × `toolCallEmitted` ×
    `retriedOnAccount`: any `toolCallEmitted: true` → `'stop'`; transient and not retried →
    `'retry_same'`; everything else → `'next_account'`. `selectAccount([])` → `null`; two
    accounts at priorities 2 and 1 → priority 1; a priority-1 `invalid` → priority 2; an
    `exhausted` account whose `resetAt` is one second in the future → skipped, one second in the
    past → returned; equal priorities → the lower id.
  - [ ] `[unit]` `service.test.ts` proves, against `openInMemoryStore()` and an injected clock:
    `addTokenAccount` seals exactly one `model_key` credential through the injected port and the
    returned view's `JSON.stringify` contains neither the token nor any prefix longer than four
    characters; `beginTurn` with no accounts throws `ProviderExhaustedError` with `retryAt ===
    null`; `recordFailure` with a 429 writes `exhausted` and `now + 900 s`, logs
    `provider_account_state`, answers `action: 'next_account'`, and the **next** `beginTurn`
    returns the second account; `recordFailure` with a 401 writes `invalid`; with
    `toolCallEmitted: true` it answers `'stop'` **and still writes the state**; a transient
    failure answers `'retry_same'` without writing, and with `retriedOnAccount: true` answers
    `'next_account'`; `releaseDue` flips an `exhausted` row whose `resetAt` has passed to
    `active` with `resetAt: null`, logs `provider_account_reset`, returns `1`, and a second call
    returns `0`; after the only account is exhausted, `beginTurn` throws with `retryAt` equal to
    that account's `resetAt`; `testAccount` answers `{ok:true, state:'active', lastError:null}`
    when `listModels()` contains the provider, `lastError: 'provider_unknown'` when it does not,
    `lastError: 'agent_unavailable'` when the runtime throws an `AgentError`, and
    `lastError: 'not_active'` for a `disabled` account without calling the runtime.
  - [ ] `[unit]` `catalog.test.ts`: `seedProviderCatalog(store, at)` twice leaves exactly three
    rows (`opencode-go`, `anthropic`, `openai`), the second call writes nothing (the rows'
    `updatedAt` is unchanged), and `GET`-visible order is catalog order.
  - [ ] `[unit]` `oauth.test.ts`: `encodeOauthEnvelope`/`decodeOauthEnvelope` round-trip and
    reject `'{"v":2}'`, `'not json'` and `'{"v":1,"access":""}'`; a started state is single use
    and expires after `OAUTH_STATE_TTL_SECONDS` (injected clock); `startOauth` for a provider
    with no adapter throws `RunApiError` `422` with
    `details.reason === 'provider_oauth_unsupported'`; with a fake adapter it returns the
    adapter's URL and a state, `completeOauth` seals one credential whose decoded envelope
    carries the tokens, and a replay of the same state is `422 state_invalid`.
  - [ ] `[unit]` `ids.test.ts`: `newProviderAccountId()` matches `ProviderAccountId` from
    `@codebox/contracts`; `newOauthState()` is 32 URL-safe characters and two calls differ.
  - [ ] `[unit]` `errors.test.ts`: `providerExhaustedApiError(new ProviderExhaustedError('opencode-go',
    '2026-10-28T15:00:00.000Z'))` is a `RunApiError` with `status === 503`,
    `code === 'provider_unavailable'`, `details` equal to
    `{ reason: 'provider_exhausted', retryAt: '2026-10-28T15:00:00.000Z' }`, and
    `error.message === 'The provider is unavailable'`; the same with a `null` `retryAt` carries
    `retryAt: null`.
  - [ ] `[unit]` `routes.test.ts` drives the real Hono app (in-memory store, `createApp`,
    `createAuthModule`, `createModule`, a device token with `['read','write','runs','admin']`):
    `GET /v1/providers` is `200` and its body has `providers[].accounts[]` with `lastFour`,
    `usedToday`, `state` and `priority`; the raw body does not contain the sealed token;
    `POST /v1/providers/opencode-go/accounts` with
    `{label, priority, auth: 'token', value}` is `201`; the same `label` again is `409`
    `unique_violation`; `auth: 'oauth'` is `422` with a `details.path` starting
    `providerAccount.`; `PATCH /v1/provider-accounts/{id}` with `{"enabled": false}` on the only
    active account is `409` with `details.reason === 'no_active_account'`, and with a second
    active account is `200` with `state: 'disabled'`; `DELETE` of the only active account is
    `409`, of a non-active account is `204` and calls the credential port's `remove` with that
    account's `credentialId`; `POST /v1/provider-accounts/{id}/test` is `200` with
    `{ok, state, lastError}`; `POST /v1/providers/opencode-go/oauth/start` with no adapter is
    `422` with `details.reason === 'provider_oauth_unsupported'`; a device with only `['read']`
    gets `403` on every mutating route and `200` on the GET; no log line emitted during the run
    contains the token.
  - [ ] `[unit]` `index.test.ts`: `createModule(context).name === 'providers'`;
    `providersServiceFor(context)` returns the same instance twice and a different one for a
    second context; and with `loadModules` and an injected `importModule` that answers the real
    `./providers/index.js` and `ERR_MODULE_NOT_FOUND` for every other subsystem, `providers` is
    in `loaded` and every other name is in `absent` (no full daemon boot is required).
  - [ ] `[unit]` `modules.test.ts` expects fourteen names with `'providers'` immediately after
    `'credentials'`, its test title says fourteen, `DEFAULT_SUBSYSTEM_FLAGS` has the same key
    order, and every flag is `true`.
  - [ ] `[unit]` `git diff --name-only main...task-73 | sort` prints exactly this list and
    nothing else: `apps/daemon/README.md`, `apps/daemon/src/modules.test.ts`,
    `apps/daemon/src/modules.ts`, `apps/daemon/src/providers/catalog.test.ts`,
    `apps/daemon/src/providers/catalog.ts`, `apps/daemon/src/providers/credentials.test.ts`,
    `apps/daemon/src/providers/credentials.ts`, `apps/daemon/src/providers/errors.test.ts`,
    `apps/daemon/src/providers/errors.ts`, `apps/daemon/src/providers/ids.test.ts`,
    `apps/daemon/src/providers/ids.ts`, `apps/daemon/src/providers/index.test.ts`,
    `apps/daemon/src/providers/index.ts`, `apps/daemon/src/providers/oauth.test.ts`,
    `apps/daemon/src/providers/oauth.ts`, `apps/daemon/src/providers/routes.test.ts`,
    `apps/daemon/src/providers/routes.ts`, `apps/daemon/src/providers/schemas.ts`,
    `apps/daemon/src/providers/service.test.ts`, `apps/daemon/src/providers/service.ts`,
    `docs/providers.md`, `packages/opencode/README.md`, `packages/opencode/src/accounts.test.ts`,
    `packages/opencode/src/accounts.ts`, `packages/opencode/src/index.ts`.
  - [ ] `[unit]` `git diff main...task-73 -- docs/providers.md` has no hunk outside
    `### 5.1 Provider accounts (D54)`, `grep -c 'CB_ACCOUNT_' docs/providers.md` is `0` after
    the edit, and `git diff main...task-73 -- apps/daemon/src/main.ts package.json
    package-lock.json packages/contracts` prints nothing.
  - [ ] `[live]` On the box, with one sealed account created through the API:
    `curl -s -H "authorization: Bearer $CB_TOKEN" http://127.0.0.1:8787/v1/providers -o /tmp/providers.json`
    then `jq -r '.providers[].accounts[].lastFour | length' /tmp/providers.json` prints `4` for
    every account, and
    `grep -c "$(printf %s "$ACCOUNT_TOKEN" | tail -c 8)" /tmp/providers.json` prints `0` —
    measured on the box, on the real response body.
  - [ ] `[live]` On the box: `PATCH /v1/provider-accounts/{id}` `{"enabled":false}` on the only
    `active` account answers `HTTP/1.1 409` with `details.reason == "no_active_account"`
    (`curl -si … | head -1` and `jq -r '.details.reason'`); after a second account is added the
    same call answers `200` and `GET /v1/providers` shows the first `disabled` and the second
    `active`. Both are measured on the box, never assumed.
  - [ ] `[live]` **Not claimed here:** the `[live]` clause of the backlog line ("two
    `opencode-go` accounts, the first dry, the run finishes on the second") is **not** delivered
    by this task — see Coordination. QA reports it as a measurement issue for a follow-up, and
    it must not be ticked as passing.

## 📣 Coordination

- **For Task-72 (next batch):** the D54 seam is `providersServiceFor(context)`.
  `beginTurn(providerId)` before a session's first prompt, `recordFailure(...)` on every
  `AgentError` from the turn, and `decideFailover`'s answer decides whether you re-send. A
  `'stop'` never resumes the same session (D48: the next run opens a new one).
- **For Task-72:** `provider_exhausted` is a **fire/run** code, not a contract `ErrorCode`.
  `ScheduleFireErrorCode` in `apps/daemon/src/schedules/fire.ts` is a closed union today and does
  not contain it; that file is not in this task's paths and **Task-72 must extend it** (or map
  the error) when it wires the fire path. Import the literal from
  `apps/daemon/src/providers/errors.js` (`PROVIDER_EXHAUSTED`) rather than spelling it.
- **For Task-72:** `ProviderExhaustedError` thrown out of a route reaches `app.onError` as a
  `500`; a route that can raise it must call `providerExhaustedApiError` and answer `503`
  `provider_unavailable` with `details.reason = "provider_exhausted"`, `details.retryAt`.
- **For Task-75 (app, next batch):** `GET /v1/providers` returns
  `{ providers: [{ …providerSchema, accounts: [{ …providerAccountSchema, lastFour }] }] }`.
  `packages/contracts` has no list schema for it — Task-75 declares a read type in the app until
  a contracts task adds one. `spentTodayUsd`/`lastUsedAt`/`authKinds` in the `docs/api.md`
  §5.9.1 example do **not** exist: the contract rows are `usedToday.usd`, no `lastUsedAt`, and a
  single `authKind`. The contracts win (Task-70 froze them).
- **For the Orchestrator — two deviations to record at merge:**
  1. `docs/api.md` documents `GET /v1/providers` **twice**: §5.1 line 171 as the retired
     `{provider, configured, mode, lastOkAt, fingerprint}` health body
     (`providersSchema`, which nothing serves and `cb doctor` reads optionally), and §5.9.1
     line 679 as the D54 account list. §5.9.1 wins because it is the section this task is named
     for and the screen table maps to it. Consequence: `cb doctor`'s `github` check
     (`apps/daemon/src/cli/doctor.ts` `githubCheck`, which parses `providersSchema` and throws
     `bad_response` on a shape it does not know) will report a hard failure once this route
     answers. The follow-up is one small task: point that check at `GET /v1/integrations` or
     drop the row from `docs/api.md` §5.1 and the `providersSchema` use with the CLI.
  2. The OAuth endpoints for `opencode-go` are nowhere in the repository and no `CB_*` key may be
     added to carry them, so `POST …/oauth/start` answers `422 provider_oauth_unsupported`
     against `DEFAULT_OAUTH_ADAPTERS = []`. The state machine, TTL and single use are complete
     and tested; a real adapter needs a contracts task for its client id/endpoints.
- **For the next docs pass:** `docs/providers.md` §5.1 still says the daemon "hands its key to
  the session". The pinned client (`packages/opencode/src/types.ts`) creates a session with a
  `model`, not a credential, so the account's key reaches the agent only through the
  `opencode serve` environment. Account **selection** and the state machine are this task; a
  per-account handoff (supervisor env, or a pinned provider-auth endpoint) is a follow-up task
  and it is what the deferred `[live]` criterion needs.

## ⛔ Out of scope

- No change to `packages/contracts` (no `provider_exhausted` in `ERROR_CODES`, no
  `providersViewSchema`, no `CB_ACCOUNT_*` key in the config schema).
- No change to `docs/api.md`, `docs/jobs.md`, `docs/decisions.md` or `packages/contracts/src/openapi.ts`.
- No change to `apps/daemon/src/main.ts`, `apps/daemon/src/credentials/**`,
  `apps/daemon/src/cli/**`, `apps/daemon/src/run/**`, `apps/daemon/src/runs/**`,
  `apps/daemon/src/schedules/**`, `apps/daemon/src/chat/**`.
- No wiring of the account key into an OpenCode session or the supervisor environment; no
  provider HTTP client outside the injected `ProviderOauthAdapter`; no invented OAuth URL.
- No refresh-token rotation loop, no usage projection for `usedToday` (the column is read, not
  recomputed), no per-account budget enforcement beyond storing `budgetUsd`.
- No timer: the reset sweep happens inside `beginTurn` and `releaseDue`, and the module registers
  no shutdown hook.
- No new npm dependency, no change to any `package.json`, and no reformatting of a file this task
  did not have to touch.

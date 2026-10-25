# Spec: Task-12 — Auth and pairing

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** daemon.
- **Role:** Dev.
- **Objective:** after this task the daemon has a real device identity layer: one operator
  mints a one-time pairing code on the loopback admin surface, an app exchanges it for a
  device row plus an access token and a rotating refresh token, every `/v1` route except
  health, version and pairing refuses an unauthenticated request through one middleware
  registered once, and device listing and revoke work with scopes. Nothing in this task may
  invent a second token format: `@codebox/security` owns the primitives and
  `packages/store` owns the rows.
- **Environment:** worktree `../wt-cb-12` (absolute `/home/runner/work/codebox/wt-cb-12`),
  branch `task-12`, base `main` at the tip of `origin/main`. Node 24, npm 11, ESM,
  TypeScript.
- **Dependencies:** all merged. Task-06 produced `@codebox/security` (`generatePairingCode`,
  `hashSecret`, `verifySecret`, `deviceFingerprint`, `mintAccessToken`, `verifyAccessToken`,
  `issueRefreshToken`, `hashRefreshToken`, `hasScope`, `authorizeDevice`); Task-11 produced
  `apps/daemon/src/{main,app,modules,config}.ts`, the `DaemonModule` seam and the subsystem
  loader; Task-03 produced `Device`, `DeviceId`, `Me`, `Scope`, `SCOPES`, `ERROR_STATUS`;
  Task-04 produced `DeviceRepository` and the `devices` table.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/daemon/src/auth/**` (new directory: `index.ts`, `service.ts`, `routes.ts`,
  `middleware.ts`, `errors.ts`, `ids.ts`, plus `*.test.ts`)
- `apps/daemon/src/app.ts` — **one** change, described under "The route seam" below. No other
  edit to this file.
- `apps/daemon/src/app.test.ts` — only to add the two assertions named below.
- `apps/daemon/src/start.test.ts` — only the three consequences of the first module existing
  on disk: `report.absent` drops by one (`11` → `10`), `report.loaded` equals `['auth']`, and
  `GET /v1/nope` becomes `401 unauthorized` instead of `404` (the middleware now guards an
  unknown API path). Nothing else in that file.
- `docs/api.md` (§2 "Authentication and pairing" only; no other section, no other doc)
- `apps/daemon/README.md` — one line per new file in the `## Files` list, plus a `## Notes`
  bullet if a non-obvious rule needs it. Do **not** write how many `@codebox/*` packages
  `prebuild` builds (Task-14 adds more); say "the `@codebox/*` packages the daemon
  value-imports".

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/api.md` §2, §3, §4 and §5.7
- `docs/security.md` §4 and §5
- `docs/providers.md` §4
- `docs/architecture.md` §3.1
- `apps/daemon/src/{main,app,modules,config,logger}.ts` and their tests
- `packages/contracts/src/{index,primitives,resources,errors,parse}.ts`
- `packages/security/src/{index,tokens,pairing,hash,constant-time}.ts`
- `packages/store/src/{index,store,devices,cursor,errors}.ts`
- `packages/store/migrations/0001_init.sql` (the `devices` table)

## 🔒 Contract

### The route seam (the one edit to `apps/daemon/src/app.ts`)

`createApp` registers `app.get('*')` **before** the subsystem modules register their routes.
Today that catch-all answers every `GET` whose path starts with `/v1/` with `not_found`, so a
module-registered `GET /v1/me` can never be reached. Change exactly this: the catch-all takes
Hono's `next`, and for an API path it calls `await next()` and returns instead of returning
`notFound`. Everything else in the handler (raw-target dot-segment check, static serving,
`not_built`) stays byte-identical, and a request that no route matches must still end in the
existing `not_found` envelope through `app.notFound` — same `code`, same `details.path`.

The two assertions to add to `apps/daemon/src/app.test.ts` (do not rewrite existing tests):

1. `GET /v1/nope` (a path no route serves) is `404` with `error.code === "not_found"` and
   `error.details.path === "/v1/nope"` — a module cannot turn an unknown API path into
   `index.html`.
2. `GET /` (no build on disk) still answers the existing `app_not_built` `404`, proving the
   static fallback is unchanged.

### Exported surface

```ts
// apps/daemon/src/auth/index.ts — the DaemonModule seam, loaded as `auth/index.js`.
export function createModule(context: DaemonContext): DaemonModule;

// apps/daemon/src/auth/service.ts
export interface PairingCode {
  readonly code: string;       // plaintext, returned once
  readonly expiresAt: string;  // ISO timestamp
  readonly scopes: readonly Scope[];
  readonly name: string;
}

export interface PairExchangeInput {
  readonly code: string;
  readonly deviceName: string;
  readonly platform: 'ios' | 'android' | 'web' | 'cli';
  readonly devicePublicKey: string;
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;        // seconds, CB_ACCESS_TOKEN_TTL_SECONDS
  readonly scopes: readonly Scope[];
}

export interface PairResult extends TokenPair {
  readonly device: Device;           // contracts Device, never the refresh hash
}

export interface AuthenticatedDevice {
  readonly id: string;
  readonly scopes: readonly Scope[];
}

export interface AuthService {
  issueCode(input: { name: string; ttlSeconds?: number; scopes?: readonly Scope[] }): Promise<PairingCode>;
  exchange(input: PairExchangeInput, source: string): Promise<PairResult>;
  refresh(input: { refreshToken: string }): Promise<TokenPair>;
  logout(deviceId: string): void;
  authenticate(accessToken: string): AuthenticatedDevice | null;
}

export function createAuthService(options: {
  readonly store: Store;
  readonly config: Pick<CodeboxConfig,
    | 'CB_SESSION_SECRET'
    | 'CB_PAIRING_TTL_SECONDS'
    | 'CB_ACCESS_TOKEN_TTL_SECONDS'
    | 'CB_REFRESH_TOKEN_TTL_DAYS'>;
  readonly clock: () => Date;
  readonly logger: Logger;
  readonly newDeviceId?: () => string;                 // tests
  readonly generateCode?: () => string;                // tests
}): AuthService;

// apps/daemon/src/auth/errors.ts
export type AuthFailureReason =
  | 'unknown_code' | 'expired_code' | 'used_code' | 'rate_limited'
  | 'invalid_payload' | 'unauthorized' | 'forbidden' | 'not_found';
export class AuthError extends Error {
  readonly reason: AuthFailureReason;
  readonly status: 400 | 401 | 403 | 404 | 422 | 429;
  readonly details?: Record<string, unknown>;
}

// apps/daemon/src/auth/routes.ts
export function registerAuthRoutes(app: DaemonApp, service: AuthService, options: {
  readonly now: () => Date;
  readonly isLoopback: (c: Context) => boolean;
  readonly rateLimit: RateLimiter;   // apps/daemon/src/auth/middleware.ts
}): void;
```

**Note:** the refresh TTL key is exactly `CB_REFRESH_TOKEN_TTL_DAYS`
(`packages/contracts/src/config.ts`). Read the real field names from `CodeboxConfig` before
writing the `Pick`.

### Routes (exact)

| Method | Path | Auth | Success |
| --- | --- | --- | --- |
| `POST` | `/v1/pair/code` | loopback source, or an `admin` bearer | `201 { code, expiresAt, scopes, name }` |
| `POST` | `/v1/pair` | none (rate-limited) | `200` the `PairResult` shape |
| `POST` | `/v1/auth/refresh` | refresh token in the body | `200` the `TokenPair` shape |
| `POST` | `/v1/auth/logout` | bearer | `204`, no body |
| `GET` | `/v1/me` | bearer | `200 { device, scopes, serverTime }` (`meSchema`) |
| `GET` | `/v1/devices` | bearer + `read` | `200 { data: Device[], nextCursor }`, `limit` 1–200 default 50 |
| `DELETE` | `/v1/devices/{id}` | bearer + `admin` | `204` |

- Every body is parsed by a zod schema at the edge with `strictObject`: an unknown field or a
  wrong type is `422 validation_failed` with `details.path` naming the field (use
  `ContractParseError`/`toParseIssues` from `@codebox/contracts`, do not hand-roll paths).
- Middleware is registered **once**, on `/v1/*`, by the auth module. Public: `GET
  /v1/health`, `GET /v1/version`, `POST /v1/pair`, `POST /v1/pair/code` (which owns its own
  issuer check) and `POST /v1/auth/refresh` (refresh token instead of a bearer). Every other
  `/v1` request — including a path no route serves — is `401 unauthorized` without a valid
  `Authorization: Bearer <accessToken>`.
- Scope map for authenticated routes: `GET` → `read`; `DELETE /v1/devices/{id}` → `admin`;
  `/v1/auth/logout` and `/v1/me` need a valid, non-revoked device and no particular scope. A
  valid token without the required scope is `403 forbidden` with `details.reason =
  "insufficient_scope"`.
- Bearer parsing: `authorization` must be exactly `Bearer <one token>`; anything else is
  `401`. `verifyAccessToken` is stateless; after it returns claims, load the device row and
  reject (`401`) when it is missing or `revokedAt !== null`. Touch `lastSeenAt` with
  `store.devices.touch` after a successful authentication.
- `POST /v1/pair/code` loopback test: read `c.env.incoming.socket.remoteAddress` (the Hono
  node-server env) and accept `127.0.0.1`, `::1`, `::ffff:127.0.0.1`; with no such env (a
  test calling `app.request`) the source is **not** loopback. A non-loopback request without
  an `admin` bearer is `403 forbidden` with `details.reason = "loopback_required"`.
- `issueCode`: `name` is 1–64 characters; `ttlSeconds` optional, integer 30–3600, default
  `CB_PAIRING_TTL_SECONDS`; `scopes` optional, default `SCOPES` (all five). The code is
  generated by `generatePairingCode`, stored only as its `hashSecret` scrypt hash, and the
  plaintext is returned once. The pending-code store is **in memory** (a daemon restart
  invalidates codes; there is no table and this task does not add a migration).
- `exchange`: normalise with `normalisePairingCode`, look the pending code up by
  `sha256Hex(normalised)` in the in-memory map, then verify with `verifyPairingCode` against
  the stored hash. Mark `usedAt` **after** the await and re-check it synchronously before
  setting, so two concurrent correct exchanges cannot both create a device. A used, expired
  or unknown code is `401 unauthorized` with `details.reason = "unknown_code" |
  "expired_code" | "used_code"` and never creates a row. On success: `deviceFingerprint(publicKey)`,
  `issueRefreshToken({ secret: CB_SESSION_SECRET })`, then
  `store.devices.create({ id, name: deviceName, platform, publicKey, fingerprint, scopes,
  refreshTokenHash: hash, refreshPreviousHash: null, refreshExpiresAt, createdAt,
  lastSeenAt: null, revokedAt: null })`, then mint the access token with
  `mintAccessToken({ deviceId, scopes, secret, now, ttlSeconds })`.
- `refresh`: body `{ refreshToken }`. Look up with `store.devices.getByRefreshHash(
  hashRefreshToken(token, secret))`; it matches the current **or** the previous hash. No row →
  `401 unauthorized`. Row with `revokedAt !== null` or `refreshExpiresAt <= now` → `401` and
  `store.devices.revoke` if it was not already revoked. A match on
  `refreshPreviousHash` is a replay: revoke the device, `401`, log `warn`
  `{ msg: "refresh_token_replay", deviceId }` (no token, no hash). A match on the current
  hash rotates: new refresh token, `refreshPreviousHash = old hash`, new expiry
  (`CB_REFRESH_TOKEN_TTL_DAYS * 86_400` seconds), a fresh access token.
- `logout`: `store.devices.revoke(deviceId, now)`; idempotent; `204`.
- `DELETE /v1/devices/{id}`: unknown id → `404 not_found`; otherwise revoke and `204`. A
  device may revoke itself (the app clears its store on the next `401`).
- Pairing rate limit: 10 requests per rolling hour per source for `POST /v1/pair` **and**
  `POST /v1/pair/code` together. The counter is in memory and injectable for tests; over the
  limit → `429 rate_limited`, `Retry-After: <seconds>` and `details.retryAfter`.

### Data

- No schema change, no migration, no new `CB_*` key. `CB_SESSION_SECRET` (≥ 32 characters,
  already required by the config schema) is the access-token HMAC key and the refresh-token
  hash key.
- Access-token TTL is `CB_ACCESS_TOKEN_TTL_SECONDS` (900); refresh TTL is
  `CB_REFRESH_TOKEN_TTL_DAYS` (30) and rotates on every use; pairing TTL is
  `CB_PAIRING_TTL_SECONDS` (300).
- Device ids are `dev_` + 20 Crockford base32 characters, validated against `DeviceId` before
  the insert. `apps/daemon/src/auth/ids.ts` holds the only generator; no other file encodes
  the format.

## 🧩 Configuration

No new key. Keys read: `CB_SESSION_SECRET`, `CB_PAIRING_TTL_SECONDS`,
`CB_ACCESS_TOKEN_TTL_SECONDS`, `CB_REFRESH_TOKEN_TTL_DAYS`. A missing or short
`CB_SESSION_SECRET` already fails at boot with the key name and no value (Task-11); do not
duplicate that validation.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `CHECKPOINT_DISABLE=1 npm run lint` — must pass. (The variable only stops the Packer
    version check in `ops/image/test/template.test.mjs` from reaching the network; it is not a
    gate change.)
  - `CHECKPOINT_DISABLE=1 npm test` — Vitest, headless. The baseline suite is green on
    `main`; no pre-existing test may be deleted and only the two assertions above may be
    added to `apps/daemon/src/app.test.ts`.
  - `CHECKPOINT_DISABLE=1 npm run build` — `tsc` for every workspace.
  - `git diff --name-only origin/main...task-12` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` Lint, tests and build are green; `apps/daemon/src/auth/` has tests for every
        rule below and they pass.
  - [ ] `[unit]` **Pairing happy path:** issue a code from a loopback source, exchange it for
        `{ device, accessToken, refreshToken, expiresIn: 900, scopes: [read, chat, runs, write,
        admin] }`, call `GET /v1/me` with the access token and get the same device id; the
        response body validates against `meSchema` and never contains `refreshTokenHash` or
        any hash.
  - [ ] `[unit]` **Single use:** a second exchange with the same code is `401` with
        `details.reason = "used_code"` and `store.devices.list` still has one row. A code
        whose `expiresAt` is in the past is `401 expired_code`; an unknown code is `401
        unknown_code`.
  - [ ] `[unit]` **Rotation and replay:** refresh returns a different refresh token; the old
        refresh token is then `401` and the device row is revoked (its access token is `401`
        on the next request). Refreshing again with the new token works before that.
  - [ ] `[unit]` **Every `/v1` route is guarded:** a table of `GET /v1/me`, `GET /v1/devices`,
        `DELETE /v1/devices/dev_00000000000000000000`, `POST /v1/auth/logout` and `GET
        /v1/unknown` all answer `401 unauthorized` with no token; `GET /v1/health`,
        `GET /v1/version` and `POST /v1/pair` answer without one. This test builds the app
        with `createApp` + `createModule`, not a hand-rolled router.
  - [ ] `[unit]` **Revoked device:** after `DELETE /v1/devices/{id}` by an admin device, the
        revoked device's next `/v1/me` is `401`; a `read`-only device calling `DELETE` is
        `403 insufficient_scope`.
  - [ ] `[unit]` **Issuer gate:** `POST /v1/pair/code` from a source that is not loopback and
        without an admin bearer is `403 loopback_required`; with an `admin` bearer it is
        `201`. The `app.request` env in the test sets
        `{ incoming: { socket: { remoteAddress: "127.0.0.1" } } }` for the loopback case.
  - [ ] `[unit]` **Rate limit:** the 11th pairing request (exchange or code issue) from one
        source inside the hour is `429` with a `Retry-After` header; a different source is
        still served.
  - [ ] `[unit]` **Edge validation:** an exchange with an unknown field or `platform:
        "toaster"` is `422 validation_failed` and `details.path` names the field; malformed
        JSON is `400 bad_request`; a token without the `Bearer ` prefix is `401`.
  - [ ] `[unit]` **The seam:** `GET /v1/unknown` with a valid token is `404 not_found` with
        `details.path`, `GET /` still answers `app_not_built`, and the pre-existing
        `apps/daemon/src/app.test.ts` tests pass unchanged; `apps/daemon/src/start.test.ts`
        carries only the three consequences listed in the exclusive paths and still boots the
        daemon on an ephemeral port.
  - [ ] `[unit]` Everything outside the exclusive paths is untouched:
        `git diff --name-only origin/main...task-12`.
  - [ ] `[live]` Not measurable on the pipeline host: a real pairing from the CLI to a phone
        emulator in under two minutes. The Orchestrator opens the `agent-review` issue; the
        dev does not claim it.

## 📣 Coordination

- For the next batch: `createAuthService` + `registerAuthRoutes` are the seam Tasks 13–17
  import for the middleware and the scope table. They must not re-implement bearer parsing.
  `GET /v1/me` now works through `createApp`, which proves the module route seam added to
  `app.ts`; every later module can register routes the same way.
- For the Architect: `docs/api.md` §2 gains the literal request/response bodies, the 429 and
  the loopback-or-admin rule for `POST /v1/pair/code`. No other doc moves. Device pairing is
  in memory by design; a restart invalidates an unused code.
- For the app (Task-18): the exchange response is the `PairResult` shape above;
  `expiresIn` is seconds; refresh sends `{ refreshToken }` and receives a new pair.

## ⛔ Out of scope

- No new dependency; no new `CB_*` key; no migration; no change to `packages/store`,
  `packages/security` or `packages/contracts`.
- No Origin/CSRF checks, no body-size cap, no security headers (Task-28); no admin socket
  (Task-17); no SSE auth (Task-13); no CLI.
- No change to `apps/daemon/src/main.ts`, `modules.ts` or the config schema.
- No refactor of `app.ts` beyond the catch-all fall-through.

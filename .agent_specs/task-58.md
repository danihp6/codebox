# Spec: Task-58 — Generic credentials and integrations (D49, D50)

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (`packages/security`) + contracts (`config.ts`, `openapi.ts`) + daemon
  (I/O, HTTP, crypto-at-rest, an outbound `fetch`) + docs. No UI.
- **Role:** Dev.
- **Objective:** after this task the operator can connect a third-party service **at runtime**
  without a redeploy. The daemon keeps every credential in an encrypted, write-only store under
  `CB_STATE_DIR/secrets` and exposes only `configured`, `lastFour` and `lastUsedAt`; it records
  an `Integration` (base URL, auth kind, credential, host allowlist) and executes
  `integration.request` server-side, injecting the header and refusing any host outside the
  allowlist **before** any DNS lookup; and it can create the GitHub App through the **manifest
  flow** and mint its first installation token from the stored PEM.
- **Environment:** worktree `../wt-cb-58`, branch `task-58`, base `main` (`origin/main` @
  `c72dd61`).
- **Dependencies (all merged):** Task-03 (`packages/contracts`, `parseConfig`, `ConfigInput`,
  `CONFIG_DEFAULTS`, `SECRET_CONFIG_KEYS`, `ERROR_STATUS`, `parsePage`); Task-06
  (`packages/security`: `redact`, `sha256Hex`, `safeEqual`); Task-11 (`DaemonContext`,
  `context.paths.stateDir`, `context.config`, `context.logger`, `modules.ts` discovery);
  Task-12 (`requireScope`, `AuthError`); Task-09/Task-15 (`handle`, `json`, `readJson`,
  `RunApiError` in `apps/daemon/src/runs/errors.ts`). No task in this batch produces a file you
  read.

### Exclusive paths (single writer)

Nothing outside this list.

- `packages/contracts/src/config.ts`
- `packages/contracts/src/config.test.ts`
- `packages/contracts/src/openapi.ts`
- `packages/contracts/src/openapi.test.ts`
- `packages/security/**` (whole package: `src/index.ts`, `src/credential-vault.ts`,
  `src/integration-allowlist.ts`, their tests, `README.md`)
- `apps/daemon/src/credentials/**` (new directory)
- `apps/daemon/src/integrations/**` (new directory)
- `apps/daemon/README.md`
- `docs/providers.md` — **sections §1, §6 (including the new §6.1) only.**
- `docs/api.md` — **a new §5.9 only**, inserted after §5.8 and before `## 6. SSE`.

Explicitly **not** yours: `packages/contracts/src/resources.ts`, `primitives.ts` and
`index.ts` (Task-53 owns all three in this batch), `apps/daemon/src/modules.ts` (Task-53 adds
your subsystem name), `apps/daemon/src/auth/**` (the callback is authenticated; you do not widen
the public route list), `apps/daemon/src/chat/**`, `apps/daemon/src/run/**`,
`apps/daemon/src/credentials` neighbours, `TODO.md`, `CHANGELOG.md`, `docs/decisions.md`,
`docs/security.md`, `docs/jobs.md`.

### Inputs (read-only)

Beyond `AGENTS.md`:

- `packages/contracts/src/config.ts` (before you edit it), `errors.ts`, `pagination.ts`,
  `parse.ts`, `openapi.ts`
- `packages/security/src/index.ts`, `redact.ts`, `constant-time.ts`, `hash.ts`, `tokens.ts`
- `apps/daemon/src/modules.ts`, `config.ts` (`StatePaths`), `logger.ts`,
  `runs/errors.ts` (`RunApiError`, `handle`, `json`, `readJson`, `requireScope`),
  `runs/routes.ts` (route + schema style), `jobs/routes.ts`, `auth/middleware.ts` (the scope
  table), `routines/index.ts` (the module seam)
- `docs/providers.md` (§1, §6), `docs/api.md` (§4, §5), `docs/decisions.md` (D19, D20, D49,
  D50)

## 🔒 Contract

Exact names and shapes. No addition without amending this file.

### 1. `packages/security/src/credential-vault.ts` — encryption at rest, no I/O

```ts
export const SEALED_SECRET_VERSION = 1;
export const MASTER_KEY_BYTES = 32;
export const MASTER_KEY_BASE64_LENGTH = 44; // 32 bytes, standard base64, one '=' pad

export interface SealedSecret {
  readonly v: 1;
  readonly iv: string;         // base64, 12 bytes
  readonly tag: string;        // base64, 16 bytes
  readonly ciphertext: string; // base64
}

export type VaultCode = 'invalid_key' | 'invalid_sealed' | 'decrypt_failed';

export class VaultError extends Error {
  readonly code: VaultCode;
  constructor(code: VaultCode);
}

export function decodeMasterKey(base64: string): Uint8Array; // 32 bytes, else VaultError('invalid_key')
export function sealSecret(plaintext: string, masterKey: Uint8Array): SealedSecret;
export function openSecret(sealed: SealedSecret, masterKey: Uint8Array): string;

/** At most the last four characters; `''` when the value is four characters or shorter. */
export function lastFour(value: string): string;
```

AES-256-GCM from `node:crypto` (`createCipheriv('aes-256-gcm', …)`), a fresh random 12-byte IV
per seal, `utf8` in and out. `openSecret` throws `VaultError('decrypt_failed')` on a wrong key
or a tampered tag. No clock, no filesystem, no environment, no network in this file.

### 2. `packages/security/src/integration-allowlist.ts` — the boundary, and nothing else

```ts
export type AllowlistRejection = 'invalid_url' | 'scheme' | 'host';
export type AllowlistResult =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: AllowlistRejection };

/** `https` only; `path` must start with '/'; the resolved host must match an entry exactly. */
export function checkIntegrationUrl(input: {
  readonly baseUrl: string;
  readonly path: string;
  readonly allowedHosts: readonly string[];
}): AllowlistResult;

export function hostAllowed(host: string, allowedHosts: readonly string[]): boolean;
```

`hostAllowed` lowercases both sides and compares the **full** host: `api.example.com` does not
allow `evil-api.example.com`, `api.example.com.evil.test`, `api.example.com.` (trailing dot) or
an IP literal unless that literal is listed. No `node:dns`, no `node:net`, no subprocess: this
module only parses. `packages/security/src/index.ts` re-exports `SEALED_SECRET_VERSION`,
`MASTER_KEY_BYTES`, `MASTER_KEY_BASE64_LENGTH`, `VaultError`, `decodeMasterKey`, `sealSecret`,
`openSecret`, `lastFour`, `checkIntegrationUrl`, `hostAllowed`, and the types `SealedSecret`,
`VaultCode`, `AllowlistRejection`, `AllowlistResult`.

### 3. `packages/contracts/src/config.ts` — two keys, no other change

- `CB_SECRETS_KEY: string | null` — 32 random bytes, standard base64, exactly 44 characters
  (43 payload chars + one `=`). Not in `CONFIG_DEFAULTS` (its default is `null`). **Added to
  `SECRET_CONFIG_KEYS`**, so an invalid value is reported as `CB_SECRETS_KEY is invalid` and
  the value is never echoed.
- `CB_INTEGRATION_TIMEOUT_SECONDS: number` — default `15`, `intField(15)` (non-negative
  integer). Added to `CONFIG_DEFAULTS`.
- Schema fields, in the existing tables: `CB_SECRETS_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/)
  .optional().transform((value) => value ?? null)` under §4; `CB_INTEGRATION_TIMEOUT_SECONDS:
  intField(15)` under §8.
- Nothing is renamed, removed or made required: `loadConfig({ CB_ENV: 'test',
  CB_SESSION_SECRET })` must still succeed (the existing suites depend on it).
- `configKeyNames()` grows by exactly these two names.

### 4. `@codebox/contracts` OpenAPI + `docs/api.md` §5.9

`packages/contracts/src/openapi.ts` gains **eight new paths**, all with `tag: 'credentials'`
and `response: null` (no new component schema exists in this batch, and `null` is the
established way to say "documented in the markdown"):

| Method | Path | operationId | status |
| --- | --- | --- | --- |
| `GET` | `/v1/credentials` | `listCredentials` | `200` |
| `POST` | `/v1/credentials` | `createCredential` | `201` |
| `DELETE` | `/v1/credentials/{id}` | `deleteCredential` | `204` |
| `POST` | `/v1/credentials/{id}/rotate` | `rotateCredential` | `200` |
| `GET` | `/v1/integrations` | `listIntegrations` | `200` |
| `POST` | `/v1/integrations` | `createIntegration` | `201` |
| `DELETE` | `/v1/integrations/{id}` | `deleteIntegration` | `204` |
| `POST` | `/v1/integrations/{id}/request` | `requestIntegration` | `200` |
| `POST` | `/v1/integrations/github/manifest` | `startGithubManifest` | `200` |
| `POST` | `/v1/integrations/github/complete` | `completeGithubManifest` | `200` |

Ten operations over eight distinct paths. `openapi.test.ts` keeps both assertions honest:
`Object.keys(document.paths)` must equal `docsPaths()`, and the pinned length becomes **54**
(46 + 8). Write the §5.9 table in `docs/api.md` with exactly these method/path pairs, in a
`| Method | Path | Auth | Purpose |` table, because `docsPaths()` parses it. §5.9 documents:

```json
{ "id": "cred_01JABCDEFG", "name": "OpenAI", "kind": "model_key", "expose": "env",
  "configured": true, "lastFour": "abcd", "createdAt": "2026-10-27T10:00:00Z",
  "updatedAt": "2026-10-27T10:00:00Z", "lastUsedAt": null }
```

- `kind`: `api_key`, `bearer`, `basic`, `github_app`, `model_key`.
- `expose`: `daemon`, `tool`, `env`; **`env` only with `kind: 'model_key'`**, otherwise `422`
  with `details.reason = 'env_not_allowed'`.
- No route returns `value`, a prefix longer than four characters, or the sealed form.
- Integration body/response: `{ "id": "int_01JABCDEFG", "name": "Linear", "baseUrl":
  "https://api.linear.app", "auth": "bearer", "headerName": null, "credentialId":
  "cred_01JABCDEFG", "allowedHosts": ["api.linear.app"], "createdAt": "…", "updatedAt": "…" }`.
  `auth` ∈ `none`, `bearer`, `header` (needs `headerName`), `basic`.
- §5.9 also states the scopes (`read` for the two lists, `admin` for every write,
  `runs` for `…/request`), the 403/422/503 reasons, and that `POST /v1/integrations/github/
  manifest` returns `{ action, manifest, state }` for a browser form and `…/complete` takes
  `{ code, state }` — the app receives GitHub's redirect, never the daemon.

### 5. `apps/daemon/src/credentials/**`

- `ids.ts` — `newCredentialId(): string` (`cred_` + 10 Crockford chars) and
  `newIntegrationId(): string` (`int_` + 10 Crockford chars), injectable randomness, the only
  generators. Contracts cannot carry these prefixes in this batch (Task-53 owns
  `primitives.ts`); say so in a comment.
- `schemas.ts` — the zod boundary: `createCredentialSchema`, `rotateCredentialSchema`,
  `createIntegrationSchema`, `publicCredentialSchema`, `publicIntegrationSchema`,
  `integrationRequestSchema`, `githubCompleteSchema`. Strict objects: an unknown key is a `422`.
- `storage.ts` — the write-only store:

  ```ts
  export interface StoredCredential {
    readonly id: string; readonly name: string; readonly kind: CredentialKind;
    readonly expose: ExposeKind; readonly sealed: SealedSecret;
    readonly createdAt: string; readonly updatedAt: string; readonly lastUsedAt: string | null;
  }
  export interface CredentialStorage {
    readonly configured: boolean;
    list(): readonly StoredCredential[];
    get(id: string): StoredCredential | null;
    save(credential: StoredCredential): void;
    remove(id: string): void;
    touch(id: string, at: string): void;
  }
  export function createFileCredentialStorage(options: {
    readonly directory: string;          // `${CB_STATE_DIR}/secrets/credentials`
    readonly masterKey: Uint8Array | null;
  }): CredentialStorage;
  ```

  Directory `0700`, file `0600`, one JSON document per credential, written through a
  `*.tmp` + rename. A directory or file with a wider mode is `chmod`ed on open, not trusted.
  `configured` is `masterKey !== null`.
- `service.ts` — `createCredentialsService({ context, now?, storage? })`:
  `list`, `create`, `rotate`, `remove`, `listIntegrations`, `createIntegration`,
  `removeIntegration`, `request`. `create` seals the value; `list` maps to the public shape and
  never opens the seal; `request` opens it, builds the header, calls the injected `fetch`, and
  touches `lastUsedAt` only on a 2xx.
- `manifest.ts` — `createManifestStateStore({ now, ttlSeconds: 600 })` with
  `issue(): string`, `consume(state: string): boolean` (single use, constant time).
- `routes.ts` — the ten handlers, mounted under `API_PREFIX`, each wrapped in
  `handle(c, 'credentials', …)`.
- `index.ts` — `createModule(context): DaemonModule` with `name: 'credentials'`, registering the
  credential routes **and** `registerIntegrationRoutes(app, service)` from `../integrations/`.
  **In your branch `apps/daemon/src/modules.ts` does not list `credentials` yet** (Task-53 adds
  it and merges first). Do not edit it: test the module by calling `createModule(context)`
  and `.register(app, context)` yourself.

HTTP surface and failures (`RunApiError`; `details.reason` is the machine token):

| Method | Path | Scope | Success | Refusals |
| --- | --- | --- | --- | --- |
| `GET` | `/v1/credentials` | middleware `read` | `200` `{ data, nextCursor: null }` | — |
| `POST` | `/v1/credentials` | `admin` | `201` public credential | `403`; `422` `details.path='credential.<key>'`; `503` `secrets_not_configured` |
| `DELETE` | `/v1/credentials/{id}` | `admin` | `204` | `403`; `404` `details.path='credential.id'` |
| `POST` | `/v1/credentials/{id}/rotate` | `admin` | `200` public credential | `403`; `404`; `422`; `503` |
| `GET` | `/v1/integrations` | middleware `read` | `200` `{ data, nextCursor: null }` | — |
| `POST` | `/v1/integrations` | `admin` | `201` public integration | `403`; `404` `details.path='integration.credentialId'`; `422` |
| `DELETE` | `/v1/integrations/{id}` | `admin` | `204` | `403`; `404` |
| `POST` | `/v1/integrations/{id}/request` | `runs` | `200` result | `403`; `404`; `422` `host_not_allowed`; `503` `integration_unreachable` |
| `POST` | `/v1/integrations/github/manifest` | `admin` | `200` `{ action, manifest, state }` | `403`; `503` `secrets_not_configured` |
| `POST` | `/v1/integrations/github/complete` | `admin` | `200` `{ configured: true, appId, credentialId }` | `403`; `422` `details.reason='state_invalid'`; `503` `provider_unavailable` |

Logs (structured, never a value): `credential_saved`, `credential_rotated`,
`credential_removed`, `integration_created`, `integration_removed`,
`integration_request_refused` (`reason`), `integration_request_failed` (`status` or error code),
`secrets_store_unconfigured` (once, at boot of the module, `warn`),
`github_manifest_started`, `github_manifest_completed` (`appId`).

### 6. `apps/daemon/src/integrations/**`

- `service.ts` — `createIntegrationsService({ context, now?, fetch?, storage, credentials })`:
  `list`, `create`, `remove`, and

  ```ts
  export interface IntegrationRequestInput {
    readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    readonly path: string;                       // must start with '/'
    readonly query?: Record<string, string>;
    readonly headers?: Record<string, string>;   // only `accept` and `content-type` survive
    readonly body?: string;                      // <= 65 536 bytes
  }
  export interface IntegrationRequestResult {
    readonly status: number;
    readonly contentType: string | null;
    readonly body: string;                       // truncated to 65 536 characters
    readonly truncated: boolean;
  }
  export function request(input: IntegrationRequestInput):
    Promise<IntegrationRequestResult>;
  ```

  Order is the contract: resolve the integration, `checkIntegrationUrl` (this refuses before
  any DNS lookup **and before the injected `fetch` is called**), then open the credential, then
  build the header (`bearer` → `Authorization: Bearer <value>`; `header` →
  `<headerName>: <value>`; `basic` → `Authorization: Basic base64(<value>)`; `none` → nothing),
  then `fetch` with `AbortSignal.timeout(CB_INTEGRATION_TIMEOUT_SECONDS * 1000)`. A transport
  error or an abort is `503 provider_unavailable` `integration_unreachable`, never a 500.
- `routes.ts` — `registerIntegrationRoutes(app, service)` for the four integration routes plus
  the two GitHub ones; `index.ts` re-exports `registerIntegrationRoutes` and the service types.
- The **`integration.request` tool** is this service's `request` behind the
  `POST /v1/integrations/{id}/request` route. Exposing it to an OpenCode session is **not** this
  task (see Out of scope): no file under `apps/daemon/src/chat/**` or
  `apps/daemon/src/run/**` changes.

## 🧩 Configuration

| Key | Default | Validation failure |
| --- | --- | --- |
| `CB_SECRETS_KEY` | `null` | Present and not exactly 43 base64 chars + `=`: `parseConfig` throws, the boot fails naming `CB_SECRETS_KEY` and never the value. Absent: boot succeeds, the store is unconfigured, every write is `503 provider_unavailable` `details.reason='secrets_not_configured'`. |
| `CB_INTEGRATION_TIMEOUT_SECONDS` | `15` | Not a non-negative integer: boot fails naming the key. `0` means no timeout beyond the platform default; document it. |

Both keys get their line in `docs/providers.md` **in this task**, in the new §6.1 table, and
`CB_SECRETS_KEY` also joins the "Secrets are write-only" bullet of §1.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint`
  - `npm test`
  - `npm run build` (`tsc -b` for every workspace, `ng build`; the app must build unchanged)
  - Targeted: `npx vitest run --project packages/security`,
    `npx vitest run --project packages/contracts`, `npx vitest run --project apps/daemon`
  - `git diff --name-only main...task-58` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `npm run lint && npm test && npm run build` pass.
  - [ ] `[unit]` `sealSecret`/`openSecret` round-trip; a wrong key and a flipped tag both throw
        `VaultError`; `JSON.stringify(sealed)` contains neither the plaintext nor any 5-char
        slice of it.
  - [ ] `[unit]` `lastFour('abcdef')` is `'cdef'`, `lastFour('abc')` is `''`, and
        `lastFour('abcd')` is `''`.
  - [ ] `[unit]` no route returns the value: for every response of the ten routes, the test
        walks the parsed body and asserts the plaintext, the sealed `ciphertext` and any suffix
        longer than four characters of the plaintext are absent.
  - [ ] `[unit]` `POST /v1/credentials` without the `admin` scope is a `403` with
        `details.reason='insufficient_scope'`; with `expose:'env'` on a non-`model_key` it is a
        `422` with `details.reason='env_not_allowed'`.
  - [ ] `[unit]` `checkIntegrationUrl` refuses `http://api.example.com/x` (`scheme`),
        `https://evil-api.example.com/x` (`host`), `https://api.example.com.evil.test/x`
        (`host`), `https://api.example.com./x` (`host`) and `https://169.254.169.254/x`
        (`host`), and a refused host never calls the injected `fetch` (the fake records zero
        calls).
  - [ ] `[unit]` an allowed request injects `Authorization: Bearer <value>`, returns
        `{ status, contentType, body, truncated }`, truncates a body over 65 536 characters
        with `truncated: true`, and turns a transport error into `503`
        `integration_unreachable`.
  - [ ] `[unit]` the manifest routes: `state` is single-use and expires after 600 s (injected
        clock); `…/complete` with a wrong state is `422 state_invalid`; with a stubbed `fetch`
        returning `{ id: 123, pem: '…' }` it answers `200`, writes one credential of kind
        `github_app` and `expose: 'daemon'`, and the PEM appears in no response byte.
  - [ ] `[unit]` `parseConfig` accepts `CB_SECRETS_KEY` of 44 base64 chars and defaults
        `CB_INTEGRATION_TIMEOUT_SECONDS` to 15; rejects `CB_SECRETS_KEY: 'short'` naming the
        key and not the value; accepts its absence.
  - [ ] `[unit]` `openapi.test.ts` still compares the document to `docs/api.md` and now pins
        **54** paths; every one of the eight new paths is in both.
  - [ ] `[unit]` `git diff --name-only main...task-58` touches nothing under
        `packages/contracts/src/resources.ts`, `index.ts`, `primitives.ts`,
        `apps/daemon/src/modules.ts`, `apps/daemon/src/auth/**`, `apps/daemon/src/chat/**`,
        `apps/app/**` or `docs/decisions.md`.
  - [ ] `[live]` a GitHub App is created by manifest and mints a first installation token
        without a redeploy — **measured later by a human on the VM**: `POST
        /v1/integrations/github/manifest`, complete the form, `…/complete`, then
        `GET /v1/integrations` shows `github_app` configured and the app's first installation
        token works (`cb doctor` or a `POST /v1/repos/{id}/verify`). Recorded as `[?]` until
        measured.
  - [ ] `[live]` `CB_SESSION_SECRET` still comes from the host — **measured later by a human on
        the VM**: `systemctl cat codebox` shows the `EnvironmentFile` and `GET /v1/me` answers
        after a restart; no secret is read from SQLite or from `CB_STATE_DIR`.

## 📣 Coordination

- For the Architect: the credential/integration **types are not in `packages/contracts`** in
  this batch. Task-53 holds `resources.ts` + `index.ts` (the `Schedule` object), and one task
  cannot add two export blocks a sibling cut from the same base cannot see. The app-facing
  truth is `docs/api.md` §5.9, frozen above; `packages/security` carries the crypto and the
  allowlist, and the daemon carries the zod boundary. The task that gives the app its
  credentials screen owns the promotion into `packages/contracts/src/credentials.ts` + the
  `index.ts` export in the next batch.
- For Task-53 (same batch): `apps/daemon/src/modules.ts` must list `credentials` after
  `routines`; you do not edit it. `apps/daemon/README.md` is yours — add one line per file of
  `apps/daemon/src/schedules/**` **and** per file of `src/credentials/**` / `src/integrations/**`
  in the same change.
- For the next batch: `POST /v1/integrations/{id}/request` is the tool seam; wiring it into an
  OpenCode session (D50's `integration.request`) is a separate task because the seam lives in
  the chat/run session configuration, which this batch does not own.
- For QA: `apps/daemon/src/modules.ts` is untouched by design; a diff there is a fail, and a
  route mounted twice is a fail.

## ⛔ Out of scope

- No `runtime` wiring of the tool into OpenCode sessions, no `docs/agent-runtime.md`.
- No OAuth connectors (D50: OAuth needs endpoints and a registered client; it stays a
  connector), no OAuth client registration.
- No new dependency (`node:crypto` and the platform `fetch` are enough).
- No `packages/contracts/src/resources.ts`, `primitives.ts`, `index.ts`, `apps/daemon/src/
  modules.ts`, `apps/daemon/src/auth/**`, `apps/app/**`, `docs/security.md`, `TODO.md`,
  `CHANGELOG.md`, `docs/decisions.md`.
- No key rotation timer, no re-encryption of an existing store, no migration for credentials
  (files, not SQLite).

## Turnstile (read this before you stop)

Work only inside `../wt-cb-58`. Never touch `main`. Commit everything. Run the gate. Then leave
an empty commit on the branch tip with the exact subject `dev: done task-58` and
`git push origin task-58`. The branch is the durable unit.

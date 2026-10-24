# Spec: Task-06 — Security primitives

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (`packages/security`) — pure cryptography, no I/O, no network.
- **Role:** Dev.
- **Objective:** `@codebox/security` holds every primitive D17 needs and every secret that
  leaves a process: pairing codes that are single-use, TTL-bounded and compared in constant
  time; scrypt hashing for the values that are compared and a deterministic keyed hash for the
  refresh token the daemon must look up; access-token minting, verification and scope
  authorisation; the redactor that every log line passes through; and the Cloudflare Access JWT
  verifier. After this task the daemon never invents a token format, a comparison or a
  redaction rule.
- **Environment:** worktree `../wt-cb-06`, branch `task-06`, base `main` (`611a788`, which
  already contains the merged Task-03).
- **Dependencies:** Task-03 — merged; it produced `packages/contracts/src/primitives.ts` (the
  `Scope` type, `SCOPES`) and `packages/contracts/src/config.ts` (the `CB_SESSION_SECRET`
  contract). Task-01 — merged; it produced the workspace skeleton,
  `packages/security/tsconfig.json` and the Vitest project `packages/security`.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path. Removing a stray `.gitkeep` from a directory this task populates is
allowed.

- `packages/security/README.md`
- `packages/security/src/index.ts`
- `packages/security/src/constant-time.ts`
- `packages/security/src/hash.ts`
- `packages/security/src/pairing.ts`
- `packages/security/src/tokens.ts`
- `packages/security/src/redact.ts`
- `packages/security/src/access-jwt.ts`
- `packages/security/src/constant-time.test.ts`
- `packages/security/src/hash.test.ts`
- `packages/security/src/pairing.test.ts`
- `packages/security/src/tokens.test.ts`
- `packages/security/src/redact.test.ts`
- `packages/security/src/access-jwt.test.ts`
- `docs/security.md` — **section: `## 4. Paired devices` only** (the four numbered steps, the
  rules list, and one new `### Primitives (`@codebox/security`)` sub-block inside it). No other
  heading, including §3 exposure, §5 request security, §7 secrets, §11 review checklist and §12
  incident response.

`packages/security/package.json` and `packages/security/tsconfig.json` are **not** in the list.
Do not add a dependency, a script or a path mapping. Argon2id is **not** available as a Node
built-in; this package ships scrypt, and that choice is written into the Contract and into
`docs/security.md` §4.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/security.md` (§1 assets, §3 exposure, §4 paired devices, §5 request security, §7
  secrets, §11 review checklist)
- `docs/api.md` (§2 authentication and pairing, §3 errors)
- `docs/providers.md` (§4 auth and devices)
- `docs/decisions.md` (D17, D19, D20, D24)
- `packages/contracts/src/primitives.ts`, `packages/contracts/src/config.ts`,
  `packages/contracts/src/resources.ts`
- `packages/contracts/README.md`
- `packages/security/package.json`, `packages/security/tsconfig.json`,
  `packages/security/README.md`
- `vitest.config.ts`, `tsconfig.base.json`, `eslint.config.js`

## 🔒 Contract

The public surface other tasks are written against **right now**. It is a promise, not a
suggestion. Exact exported names, signatures and types.

Everything exported from the package goes through `packages/security/src/index.ts`, which
re-exports every name exactly once, grouped by module, with `export type { … }` for types.
`tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`.

### Imports and purity

- `@codebox/contracts` is imported **type-only**, always `import type { Scope } from
  '@codebox/contracts';`. Never a value import: `npm test` runs before `npm run build` in CI
  and `packages/contracts/dist` does not exist at that point.
- Allowed built-ins: `node:crypto`, `node:buffer`.
- Forbidden in `packages/security/src/**` outside `*.test.ts`: `node:fs`, `node:http`,
  `node:child_process`, `fetch(`, `process.env`, `Date.now()`, `new Date()` without an
  argument, `Math.random()`. Time is a `Date` argument; randomness is `randomBytes`.
- No function throws for bad input that came from a request. A token, a code, a JWT or a stored
  hash that does not parse is a typed failure, never an exception. The two exceptions are
  programming errors and are documented where they appear.
- Nothing here decides policy, scope mapping or HTTP status: the daemon maps a `false`, a
  `null` or a rejection reason to `401`/`403` and logs the reason, never the value.

### `constant-time.ts`

```ts
export function safeEqual(a: string | Buffer, b: string | Buffer): boolean;
export function sha256Hex(value: string | Buffer): string;
```

`safeEqual` compares two UTF-8 strings or buffers without leaking their content through timing:
it hashes both sides with SHA-256 and compares the 32-byte digests with `timingSafeEqual`.
Different lengths are `false`, and the comparison cost does not depend on where the inputs
differ. `sha256Hex` is lowercase hex.

### `hash.ts`

```ts
export interface ScryptParams {
  readonly N: number;         // CPU/memory cost, default 16384
  readonly r: number;         // block size, default 8
  readonly p: number;         // parallelisation, default 1
  readonly keyLength: number; // default 32
}

export const DEFAULT_SCRYPT_PARAMS: ScryptParams; // { N: 16384, r: 8, p: 1, keyLength: 32 }

export function hashSecret(secret: string, params?: ScryptParams): Promise<string>;
export function verifySecret(secret: string, stored: string): Promise<boolean>;
export function deviceFingerprint(publicKey: string): string;
```

- **scrypt, not Argon2id.** Argon2id is not in `node:crypto` and this batch adds no dependency,
  so the built-in option is scrypt. `docs/security.md` §4 states it.
- `hashSecret` generates a fresh 16-byte salt with `randomBytes`, derives the key with
  `scrypt`, and returns `scrypt$<N>$<r>$<p>$<saltBase64url>$<keyBase64url>`.
- `verifySecret` parses that format, re-derives with the stored salt and parameters, and
  compares with `safeEqual`. A malformed or truncated `stored` value returns `false`; it never
  throws and never logs.
- `deviceFingerprint` returns `'sha256:' + sha256Hex(publicKey)` for the device's public key as
  the app sent it (UTF-8 PEM or base64url SPKI, verbatim). It is a stable identifier shown in
  the devices list; it is not a secret and never contains key material beyond the digest.

### `pairing.ts`

```ts
export const PAIRING_CODE_LENGTH = 10;
export const PAIRING_CODE_ALPHABET: string; // Crockford base32 without I, L, O, U

export interface PendingPairingCode {
  readonly hash: string;      // produced by hashSecret, stored by the daemon
  readonly expiresAt: string; // RFC 3339 UTC
  readonly usedAt: string | null;
}

export type PairingRejection = 'unknown' | 'expired' | 'used';

export type PairingVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PairingRejection };

export function generatePairingCode(random?: (bytes: number) => Buffer): string;
export function normalisePairingCode(input: string): string;
export function verifyPairingCode(input: {
  readonly code: string;
  readonly pending: PendingPairingCode | null;
  readonly now: Date;
}): Promise<PairingVerification>;
```

- `generatePairingCode` draws 10 characters from the 32-character alphabet using
  `randomBytes(16)` with rejection-free modulo-free indexing (map each byte with `byte & 31`),
  so the output is `^[0-9A-HJKMNP-TV-Z]{10}$`. It takes an injectable byte source for tests.
- `normalisePairingCode` uppercases, removes spaces and hyphens, and maps the ambiguous
  characters `I`→`1`, `L`→`1`, `O`→`0` (so a QR read by a human still works). It never throws.
- `verifyPairingCode` order: `pending === null` → `unknown`; `usedAt !== null` → `used`;
  `Date.parse(expiresAt) <= now.getTime()` → `expired`; otherwise `await verifySecret`. When
  `pending === null` it still performs one `verifySecret` against a fixed dummy hash before
  returning `unknown`, so the timing does not reveal whether a code exists.
- Single use is the caller's write: after `ok`, the daemon sets `usedAt`. The function refuses a
  code whose `usedAt` is set, which is the "never pairs twice" guarantee.

### `tokens.ts`

```ts
import type { Scope } from '@codebox/contracts';

export const ACCESS_TOKEN_PREFIX = 'cb1';

export interface AccessTokenClaims {
  readonly v: 1;
  readonly sub: string;         // device id
  readonly scopes: readonly Scope[];
  readonly iat: number;         // seconds since the epoch
  readonly exp: number;         // seconds since the epoch
}

export interface MintedAccessToken {
  readonly token: string;
  readonly claims: AccessTokenClaims;
}

export interface IssuedRefreshToken {
  readonly token: string;
  readonly hash: string;
}

export function mintAccessToken(input: {
  readonly deviceId: string;
  readonly scopes: readonly Scope[];
  readonly secret: string;
  readonly now: Date;
  readonly ttlSeconds: number;
}): MintedAccessToken;

export function verifyAccessToken(input: {
  readonly token: string;
  readonly secret: string;
  readonly now: Date;
}): AccessTokenClaims | null;

export function issueRefreshToken(input?: { readonly bytes?: number }): IssuedRefreshToken;

export function hashRefreshToken(token: string, secret: string): string;

export function hasScope(granted: readonly Scope[], required: Scope): boolean;

export function authorizeDevice(input: {
  readonly device: { readonly scopes: readonly Scope[]; readonly revokedAt: string | null };
  readonly required: Scope;
  readonly now: Date;
}): boolean;
```

- Access token format: `cb1.<base64url(JSON claims)>.<base64url(hmac)>` with
  `hmac = HMAC-SHA256(secret, "cb1.<payload>")`. The token is stateless: `CB_SESSION_SECRET`
  rotation invalidates every access token and leaves refresh tokens alone (`docs/providers.md`
  §16).
- `verifyAccessToken` returns `null` for a wrong number of parts, a bad signature, a payload
  that is not the frozen shape (`v === 1`, `sub` non-empty string, `scopes` an array of
  strings, integer `iat`/`exp`) or `exp <= floor(now/1000)`. It never throws.
- `issueRefreshToken` returns 32 random bytes as base64url (43 characters) and
  `hash = hashRefreshToken(token, secret)`.
- `hashRefreshToken` is `HMAC-SHA256(secret, token)` lowercase hex — **deterministic on
  purpose**: the daemon looks a device up by `refresh_token_hash`, which a salted scrypt hash
  cannot support. A database copy without `CB_SESSION_SECRET` still grants nothing.
- `hasScope` is exact membership, with no implied scopes: `admin` does not imply `write`
  (`docs/api.md` §2 lists five independent scopes and a narrower device is deliberate).
- `authorizeDevice` is `device.revokedAt === null && hasScope(device.scopes, required)`. A
  revoked device fails **every** scope, which is the `docs/security.md` §4 rule and the reason
  this function exists instead of a bare `hasScope`.

### `redact.ts`

```ts
export const REDACTED_PLACEHOLDER = '[redacted]';
export const REDACTION_KEY_PATTERNS: readonly string[];
export function isSecretKey(key: string): boolean;
export function redact(value: unknown): unknown;
```

- `REDACTION_KEY_PATTERNS` is exactly
  `['token', 'secret', 'password', 'key', 'authorization', 'cookie', 'private']`
  (`docs/security.md` §7). `isSecretKey` is a case-insensitive substring test, so
  `CB_SESSION_SECRET`, `ANTHROPIC_API_KEY`, `set-cookie` and `privateKey` all match. A false
  positive such as `tokensIn` is accepted: fail closed.
- `redact` returns a **new** value and never mutates the input:
  - `null`, `undefined`, string, number, boolean, bigint → unchanged;
  - `Array` → a new array, each element redacted;
  - `Date` → its `toISOString()`;
  - `Error` → `{ name, message }` (the message is not rewritten: it is data, not a key);
  - `Buffer` / `Uint8Array` → `'[binary]'`;
  - plain object (`Object.getPrototypeOf(value) === Object.prototype || null`) → a new object,
    a key where `isSecretKey(key)` is true becomes `REDACTED_PLACEHOLDER`, every other value is
    redacted;
  - a cyclic reference → `'[circular]'` (tracked with a `WeakSet`);
  - any other object → `'[unsupported]'`.
- It is total: it returns `'[unsupported]'` rather than throwing.

### `access-jwt.ts`

```ts
export interface AccessJwk {
  readonly kid: string;
  readonly kty: 'RSA';
  readonly n: string;
  readonly e: string;
  readonly alg?: string;
}

export interface AccessJwks {
  readonly keys: readonly AccessJwk[];
}

export interface AccessClaims {
  readonly email: string | null;
  readonly aud: readonly string[];
  readonly iss: string;
  readonly iat: number;
  readonly exp: number;
}

export type AccessRejection =
  | 'malformed'
  | 'unsupported_alg'
  | 'unknown_kid'
  | 'bad_signature'
  | 'expired'
  | 'wrong_aud'
  | 'wrong_issuer';

export type AccessVerification =
  | { readonly ok: true; readonly claims: AccessClaims }
  | { readonly ok: false; readonly reason: AccessRejection };

export function verifyAccessJwt(input: {
  readonly token: string;
  readonly jwks: AccessJwks;
  readonly aud: string;
  readonly teamDomain: string;
  readonly now: Date;
}): AccessVerification;
```

- Cloudflare Access is the outer layer (`docs/security.md` §3). The **daemon** fetches the
  JWKS from `https://<teamDomain>/cdn-cgi/access/certs`; this function never fetches and never
  reads the network.
- Checks in this order, stopping at the first failure: three dot-separated parts
  (`malformed`); header `alg === 'RS256'` (`unsupported_alg` — an `alg: "none"` token is
  unsigned and dies here); `kid` present in `jwks` (`unknown_kid`); signature verified with
  `createPublicKey({ key: { kty: 'RSA', n, e }, format: 'jwk' })` and `RSA-SHA256`
  (`bad_signature`); payload parses and `exp`/`iat` are numbers (`malformed`); `exp >
  floor(now/1000)` (`expired`); `aud` is a string or an array of strings that contains the
  configured `aud` (`wrong_aud`); `iss === 'https://' + teamDomain` (`wrong_issuer`).
- Claims: `email` from the `email` claim when it is a string, otherwise `null`; `aud` always an
  array in the result.

### Data

The wire shapes this task freezes:

| Key | Shape |
| --- | --- |
| pairing code | 10 characters, `^[0-9A-HJKMNP-TV-Z]{10}$`, TTL 300 s (`CB_PAIRING_TTL_SECONDS`), single use |
| scrypt hash | `scrypt$<N>$<r>$<p>$<saltBase64url>$<keyBase64url>`, defaults `16384$8$1` |
| access token | `cb1.<base64url(claims)>.<base64url(HMAC-SHA256(secret, "cb1.<claims>"))>`, TTL 900 s |
| access claims | `{ v: 1, sub, scopes, iat, exp }`, seconds since the epoch |
| refresh token | 32 random bytes base64url; stored as `HMAC-SHA256(CB_SESSION_SECRET, token)` lowercase hex |
| device fingerprint | `sha256:<64 lowercase hex>` |
| redaction placeholder | `[redacted]` |
| redaction key patterns | `token`, `secret`, `password`, `key`, `authorization`, `cookie`, `private` |
| Access JWT | `RS256`, `iss = https://<teamDomain>`, `aud` must match, `exp` in seconds |

## 🧩 Configuration

No new `CB_*` key and no `process.env` read: the caller passes `secret`, `aud`, `teamDomain`,
TTLs and `now`. The values this package is written against come from `CONFIG_DEFAULTS`
(`packages/contracts/src/config.ts`) and are documented in `docs/providers.md` §4:
`CB_SESSION_SECRET` (32+ bytes, required), `CB_PAIRING_TTL_SECONDS` 300,
`CB_ACCESS_TOKEN_TTL_SECONDS` 900, `CB_REFRESH_TOKEN_TTL_DAYS` 30, `CB_ACCESS_TEAM_DOMAIN`
and `CB_ACCESS_AUD` (both `null` disables the Access check). A missing or short session secret
is the config schema's failure (exit 1), not this package's.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing
else is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; includes the tests this task adds.
  - `npx vitest run --project packages/security` — this package alone.
  - `npm run build` — `tsc -b` and the app build when this task touches it.
  - `git diff --name-only main...task-06` — audit against the exclusive paths.
  - Every test injects `now`, every generator is seeded or its output is only round-tripped; no
    test touches the network, the filesystem, a real phone or a real Cloudflare team.
- **Acceptance criteria:** every one tagged **`[unit]`** (a headless command, a decoded value,
  a pinned number) or **`[live]`** (only exists in the running system: a stream, a push, a
  tunnel, a UI state). A `[live]` criterion states its **measurement** — what to read, on which
  surface, against which bound.
  - [ ] `[unit]` It typechecks, lints and builds clean: `npm run lint && npm run build`.
  - [ ] `[unit]` The declared tests exist and pass: `npx vitest run --project packages/security`
        reports at least the six test files above and zero failures.
  - [ ] `[unit]` A used or expired code never pairs twice:
        `npx vitest run --project packages/security -t 'a used or expired code never pairs twice'`
        passes; it hashes a generated code, verifies it once with `usedAt: null` (`ok`), sets
        `usedAt`, verifies again (`used`), verifies a code whose `expiresAt` is 1 s in the past
        (`expired`), and verifies with `pending: null` (`unknown`).
  - [ ] `[unit]` A revoked device fails every scope:
        `npx vitest run --project packages/security -t 'a revoked device fails every scope'`
        passes; it loops the five scopes of the contract (`read`, `chat`, `runs`, `write`,
        `admin`), asserts `authorizeDevice` is `true` with `revokedAt: null` and a granted
        scope, and `false` for every scope with `revokedAt` set — including `admin`.
  - [ ] `[unit]` Redaction removes the documented key list from a nested object and never
        mutates the input:
        `npx vitest run --project packages/security -t 'redaction removes the documented key list and never mutates the input'`
        passes; it redacts a fixture that nests `authorization`, `cookie`, `password`,
        `clientSecret`, `privateKey`, `refresh_token` and `ANTHROPIC_API_KEY` three levels
        deep, asserts each becomes `[redacted]`, asserts a non-secret sibling survives, asserts
        `JSON.stringify(input)` is byte-identical before and after, and asserts the result is a
        different object (`result !== input`, `result.inner !== input.inner`).
  - [ ] `[unit]` Access JWT verification rejects a wrong `aud`, an expired token and an
        unsigned token:
        `npx vitest run --project packages/security -t 'Access JWT verification rejects a wrong aud, an expired token and an unsigned token'`
        passes; the test generates an RSA pair with `node:crypto`, signs a valid token
        (`ok`, `email` present), then asserts `wrong_aud`, `expired`, and `unsupported_alg` for
        an `alg: "none"` token, plus `bad_signature` for a one-byte-flipped payload and
        `unknown_kid` for another `kid`.
  - [ ] `[unit]` Tokens verify and expire deterministically:
        `npx vitest run --project packages/security -t 'an access token verifies before its expiry and not after'`
        passes; it also asserts `hashRefreshToken` is stable for the same input, that a tampered
        signature returns `null`, and that two `issueRefreshToken()` calls differ.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-06` lists only files from the list above.
  - [ ] `[unit]` Purity: `grep -rnE "process\.env|Date\.now\(\)|new Date\(\)|Math\.random|fetch\(|node:fs|node:http" packages/security/src --include=*.ts | grep -v '\.test\.ts'`
        prints nothing, and `grep -rn "from '@codebox/contracts'" packages/security/src` matches
        only lines beginning `import type`.
  - [ ] `[unit]` The document matches the code: `grep -n "scrypt\|verifyAccessJwt\|redact(" docs/security.md`
        finds them inside §4 only, and `git diff -U0 main...task-06 -- docs/security.md`
        touches no heading other than `## 4. Paired devices`.

## 📣 Coordination

- For the Architect: `docs/security.md` §4 now names scrypt and the keyed refresh-token hash;
  Argon2id is not a Node built-in and no dependency is added in this batch. The doc's rule 2
  ("Tokens are stored hashed (Argon2id or scrypt)") is split in two: compared values use
  scrypt, looked-up values use `HMAC-SHA256(CB_SESSION_SECRET, token)`.
- For Task-12 (Batch 4): the exchange sequence is `generatePairingCode` → `hashSecret` stored
  with `expiresAt`; on `POST /v1/pair` → `normalisePairingCode` + `verifyPairingCode`, then
  `issueRefreshToken`/`hashRefreshToken` and `mintAccessToken`; on refresh → look the device up
  by `getByRefreshHash`, refuse when the presented hash equals `refresh_previous_hash`
  (theft → revoke), otherwise `rotateRefresh`. `verifyAccessToken` returns `null` → `401
  unauthorized`; `authorizeDevice` false → `403 forbidden`. The `10/hour/source` pairing rate
  limit and the middleware registration are Task-12, not here.
- For Task-11/Task-28: every log statement goes through `redact` before `JSON.stringify`.
  Task-28 owns `packages/security/**` later and extends the 30-fixture corpus and the
  controls; it should extend `REDACTION_KEY_PATTERNS` rather than add a second redactor.
- For QA: the scope list asserted in the revoked-device test is the contract's `SCOPES`
  (`read`, `chat`, `runs`, `write`, `admin`); do not add a sixth.

## ⛔ Out of scope

- No new dependency outside the spec — and in particular no Argon2id binding.
- No refactor of a file this task did not have to touch.
- No change to `docs/decisions.md` unless the task is the decision owner.
- No JWKS fetch, no cache, no Cloudflare call: the daemon fetches and passes the keys.
- No GitHub webhook signature verification: webhooks are optional and Q18 is still open.
- No HTTP status, middleware, rate limiter, device storage or session logic — those are
  Task-12.
- No 30-fixture redaction corpus (Task-28); this task proves the documented key list with one
  nested fixture.

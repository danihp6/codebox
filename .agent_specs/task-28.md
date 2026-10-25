# Spec: Task-28 — Security hardening

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (pure scanner + corpus) + daemon (HTTP middleware, gate step) + ops
  (systemd units) + docs.
- **Role:** Dev.
- **Objective:** the request controls that `docs/security.md` §5 and `docs/api.md` §7 already
  promise are enforced by the daemon — a 1 MiB body cap, an `Origin` allowlist driven by
  `CB_ALLOWED_ORIGINS`, the security headers, and the 120/min-per-device plus 10/min
  work-route rate limits — and a run whose diff adds a credential fails its gate before a PR
  exists. The three long-running systemd units stop being able to do anything a non-root
  Node/cloudflared process does not need.
- **Environment:** worktree `../wt-cb-28`, branch `task-28`, base `main`.
- **Dependencies:** Task-06 (`@codebox/security`, the redactor this task extends), Task-14
  (`apps/daemon/src/run/engine.ts`, `gate/run-gate.ts` — the gate step it extends), Task-25
  (`ops/vm/systemd/**`). All three are merged. No new dependency.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path.

- `packages/security/src/secret-scan.ts` (new)
- `packages/security/src/secret-scan.test.ts` (new)
- `packages/security/src/redact-corpus.ts` (new)
- `packages/security/src/redact-corpus.test.ts` (new)
- `packages/security/src/index.ts` (add the `secret-scan` export block and the corpus export)
- `packages/security/README.md`
- `apps/daemon/src/app.ts`
- `apps/daemon/src/app.test.ts`
- `apps/daemon/src/auth/middleware.ts`
- `apps/daemon/src/auth/middleware.test.ts` (new)
- `apps/daemon/src/auth/index.ts`
- `apps/daemon/src/auth/routes.test.ts`
- `apps/daemon/src/gate/secret-scan.ts` (new)
- `apps/daemon/src/gate/secret-scan.test.ts` (new)
- `apps/daemon/src/gate/README.md`
- `apps/daemon/src/run/engine.ts`
- `apps/daemon/src/run/engine.test.ts`
- `apps/daemon/src/run/README.md`
- `ops/vm/systemd/codebox.service`
- `ops/vm/systemd/codebox-opencode.service`
- `ops/vm/systemd/cloudflared.service`
- `ops/vm/test/systemd.test.mjs` (new)
- `ops/vm/README.md`
- `docs/security.md` (sections: §5 Request security, §6 the agent table)
- `docs/api.md` (section: §7 Rate limits)
- `docs/jobs.md` (section: §5 The gate)
- `docs/decisions.md` (one appended row, D40)

**Do not touch** `apps/daemon/src/main.ts`, `packages/contracts/src/**` (no new error code: an
oversized body is `bad_request` 400 and a refused origin is `forbidden` 403, both already in
`ERROR_CODES`), `packages/core/src/permissions.ts` (the D27 matrix is frozen), `apps/app/**`,
`docs/providers.md` (no new `CB_*` key), `docs/operations.md`, `apps/daemon/README.md`
(`src/gate/` and `src/run/` carry their own README).

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/security.md` (§3, §5, §6, §7, §8), `docs/api.md` (§3, §7), `docs/jobs.md` (§5, §7),
  `docs/decisions.md` (the table and D12), `docs/agent-runtime.md` (§6)
- `packages/contracts/src/errors.ts`, `src/config.ts` (`CB_ALLOWED_ORIGINS`, `CB_PUBLIC_URL`),
  `src/primitives.ts`
- `packages/security/src/redact.ts`, `src/constant-time.ts`, `src/index.ts`
- `packages/workspaces/src/types.ts` (`GitRunner`, `GitCommandInput`, `GitResult`),
  `src/git.ts` (`GIT_ENV`)
- `apps/daemon/src/modules.ts` (`DaemonApp`, `DaemonContext`), `src/config.ts`, `src/logger.ts`
- `apps/daemon/src/auth/errors.ts`, `src/auth/service.ts`, `src/auth/routes.ts`
- `apps/daemon/src/run/engine.ts` (`gating`, `RunContext`), `src/run/ports.ts`,
  `src/gate/run-gate.ts`
- `apps/daemon/src/cli/doctor.ts` (`MISSING_ROUTE` and the 404-is-skip convention)
- `ops/vm/systemd/*.service`, `ops/image/scripts/70-harden.sh`
- `apps/daemon/src/push/routes.ts` and `src/chat/routes.ts` (the per-route scope-check style)

## 🔒 Contract

### `@codebox/security` — `src/secret-scan.ts`

Pure: no I/O, no clock, no `node:fs`.

```ts
export const SECRET_PATTERN_NAMES = [
  'private_key',
  'github_pat',
  'github_token',
  'anthropic_key',
  'openai_key',
  'aws_access_key',
  'jwt',
  'slack_token',
  'generic_secret',
] as const;
export type SecretPatternName = (typeof SECRET_PATTERN_NAMES)[number];

/** Compiled with flags `g`; the source is exposed so a test can pin every one of the nine. */
export const SECRET_PATTERN_SOURCES: Readonly<Record<SecretPatternName, string>>;

export const SECRET_SCAN_ALLOW_MARKER = 'codebox-secret-scan: allow';
export const SECRET_PLACEHOLDERS: readonly string[]; // see below

export interface SecretFinding {
  readonly path: string; // repo-relative, from the diff's `+++ b/<path>`
  readonly line: number; // 1-based line number in the new file
  readonly pattern: SecretPatternName;
}

export function scanPatchForSecrets(patch: string): readonly SecretFinding[];
export function formatSecretFinding(finding: SecretFinding): string;
```

Frozen pattern sources (a test pins each string):

| Name | Source |
| --- | --- |
| `private_key` | `-----BEGIN (?:RSA \|EC \|DSA \|OPENSSH \|PGP )?PRIVATE KEY-----` |
| `github_pat` | `\bgithub_pat_[A-Za-z0-9_]{22,}\b` |
| `github_token` | `\bgh[pousr]_[A-Za-z0-9]{36}\b` |
| `anthropic_key` | `\bsk-ant-[A-Za-z0-9_-]{20,}\b` |
| `openai_key` | `\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b` |
| `aws_access_key` | `\b(?:AKIA\|ASIA)[0-9A-Z]{16}\b` |
| `jwt` | `\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b` |
| `slack_token` | `\bxox[abprs]-[A-Za-z0-9-]{10,}\b` |
| `generic_secret` | `\b(?:api[_-]?key\|secret\|token\|password)\b\s*[:=]\s*["'][A-Za-z0-9_./+=-]{16,}["']` (case-insensitive) |

`SECRET_PLACEHOLDERS` (matched value lowercased, `includes`): `['[redacted]', 'example',
'placeholder', 'changeme', 'dummy', 'replace', 'your_', 'xxxx']`.

`scanPatchForSecrets` rules, all pinned by tests:

- It reads a unified diff and scans **only added lines**. State machine:
  - `diff --git a/X b/Y` → remember `Y` as the pending path.
  - `+++ b/Y` → current path = `Y` with a leading `b/` stripped; `+++ /dev/null` clears it and
    the hunk is skipped.
  - `@@ -a,b +c,d @@` → `nextLine = c`.
  - A line starting with `+` that is not `+++` → scan it at `nextLine`, then `nextLine += 1`.
  - A line starting with a single space → `nextLine += 1`.
  - A line starting with `-`, and `\ No newline at end of file`, leave `nextLine` alone.
  - `index`, `---`, `old mode`, `new mode`, `deleted file mode`, `similarity`,
    `rename from`, `rename to` are ignored.
  - A trailing `\r` is stripped before matching.
- A line containing `SECRET_SCAN_ALLOW_MARKER` is skipped.
- A match whose own text, lowercased, contains a `SECRET_PLACEHOLDERS` entry is skipped.
- Patterns are applied in `SECRET_PATTERN_NAMES` order; a line may yield several findings.
- Findings are deduped by `(path, line, pattern)` and sorted by `path`, `line`, `pattern`.
- The finding never carries the matched text.
- `formatSecretFinding` returns `` `${path === '' ? '(unknown)' : path}:${line} ${pattern}` ``.

### `@codebox/security` — `src/redact-corpus.ts`

```ts
export interface RedactionFixture {
  readonly name: string;
  /** The secret literals that must not survive `redact()`, in any depth. */
  readonly secrets: readonly string[];
  readonly input: unknown;
}

/** Exactly thirty fixtures; `redact-corpus.test.ts` asserts the length. */
export const REDACTION_CORPUS: readonly RedactionFixture[];
```

The corpus covers, at least once each: a nested object, an array of objects, a `Map`-free
record with a numeric key, an `Error`, a `Date`, a `Uint8Array`, a circular reference, a
`BigInt`, `undefined`, and keys `token`, `access_token`, `refreshToken`, `secret`,
`client_secret`, `password`, `apiKey`, `privateKey`, `authorization`, `cookie`, `set-cookie`,
`private_key_pem`. Every fixture's `secrets` array holds the literal strings planted in its
`input`; the test serialises `redact(fixture.input)` with `JSON.stringify` and asserts no
`secrets` entry appears in the result.

### `apps/daemon/src/app.ts`

```ts
export const MAX_REQUEST_BYTES = 1_048_576;
export const BODY_TOO_LARGE_PATH = 'request.body';
export const ORIGIN_REFUSAL_REASON = 'origin';
export const SECURITY_HEADERS: Readonly<Record<string, string>>;
export function originAllowed(origin: string, allowed: readonly string[]): boolean;
```

- `SECURITY_HEADERS` is exactly:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
  These four are set on every response the app produces, JSON and static alike, after the
  route ran and never overwriting a header a route already set.
- `originAllowed(origin, allowed)` compares lowercased, trailing-slash-free strings and
  returns `true` when `allowed` is empty (development). The config already folds
  `CB_PUBLIC_URL` into `CB_ALLOWED_ORIGINS` when the list is empty and `CB_PUBLIC_URL` is set,
  so a production boot always has a non-empty list.
- A second `app.use('*')`, registered **after** the existing request-id/log middleware and
  **before** the first route, applies, for a `/v1` path only:
  1. `Origin` present and `originAllowed(origin, context.config.CB_ALLOWED_ORIGINS) === false`
     → `403`, body from `errorBody({ code: 'forbidden', message: 'Forbidden', requestId,
     details: { reason: ORIGIN_REFUSAL_REASON } })`, `Content-Type:
     application/json; charset=utf-8`.
  2. `content-length` present, numeric and greater than `MAX_REQUEST_BYTES` → `400`, body from
     `errorBody({ code: 'bad_request', message: 'Bad request', requestId, details: {
     limitBytes: MAX_REQUEST_BYTES, path: BODY_TOO_LARGE_PATH } })`. The route must never run,
     so nothing is parsed.
  A non-API path (the hosted app and the SPA fallback) is never origin-checked; a
  `content-length` on it is not capped (static responses carry none).
- Both refusals are logged by the existing request middleware with their status; no extra log
  line.

### `apps/daemon/src/auth/middleware.ts`

```ts
export const API_RATE_LIMIT = 120;
export const API_RATE_WINDOW_SECONDS = 60;
export const WORK_RATE_LIMIT = 10;
export const WORK_RATE_WINDOW_SECONDS = 60;

export interface ApiRateLimiters {
  readonly api: RateLimiter;
  readonly work: RateLimiter;
}

export function createApiRateLimiters(options: { readonly now: () => Date }): ApiRateLimiters;
export function isWorkRoute(method: string, path: string): boolean;
export function createAuthMiddleware(
  service: AuthService,
  limiters?: ApiRateLimiters,
): MiddlewareHandler<{ Variables: AppVariables }>;
```

- `isWorkRoute` is true for exactly `POST /v1/runs`, `POST /v1/jobs/{id}/run` and
  `POST /v1/routines/{id}/run` (the last is a path this release does not serve yet; the
  predicate is forward-looking and pinned by a test).
- In the middleware, **after** authentication and the scope check and **before** `next()`, and
  only when `limiters` is provided: take from `work` when `isWorkRoute(method, path)`, else from
  `api`, with the key `device:<device.id>`. A refusal throws
  `new AuthError('rate_limited', 429, { retryAfter: decision.retryAfterSeconds })` inside the
  existing `try`, so the body and the `Retry-After` header are the ones `auth/errors.ts`
  already emits. A work route is counted in `work` only, never in both.
- `auth/index.ts` builds the pair with `context.clock` and passes it to
  `createAuthMiddleware`. The pairing limiter (10/hour/source, in `auth/routes.ts`) is
  unchanged.
- Existing `createRateLimiter` is reused as-is; do not write a second window implementation.

### `apps/daemon/src/gate/secret-scan.ts`

```ts
export const MAX_SECRET_SCAN_BYTES = 4_194_304;
export type SecretScanFailureCode = 'git_failed';

export class SecretScanError extends Error {
  readonly code: SecretScanFailureCode;
}

export interface SecretScanOutcome {
  readonly findings: readonly SecretFinding[];
  readonly oversized: boolean;
}

export function scanWorktree(
  git: GitRunner,
  input: { readonly cwd: string; readonly baseSha: string; readonly timeoutMs: number },
): Promise<SecretScanOutcome>;
```

- One `git.run` call, exactly:
  `{ args: ['diff', '--no-color', '--unified=0', '--no-ext-diff', input.baseSha, '--'], cwd: input.cwd, timeoutMs: input.timeoutMs, env: GIT_ENV }`.
- `code !== 0` → throw `new SecretScanError('git_failed')` (fail closed: a gate that cannot read
  the diff does not pass).
- `Buffer.byteLength(stdout, 'utf8') > MAX_SECRET_SCAN_BYTES` →
  `{ findings: [], oversized: true }`.
- Otherwise `{ findings: scanPatchForSecrets(stdout), oversized: false }`.

### `apps/daemon/src/run/engine.ts` — the gate step

Inside `gating()`, after `ports.gate` resolved and only when `result.status === 'passed'` and
`!ctx.cancelled`:

1. `const scan = await scanWorktree(ports.gitRunner, { cwd: worktree.path, baseSha:
   worktree.baseSha, timeoutMs: settings.gitTimeoutMs })`.
2. Build `lines`:
   - `oversized` → one line `secret_scan: patch exceeded 4194304 bytes`;
   - per finding → `formatSecretFinding(finding)` in the `[unit]` form `path:line pattern`.
3. When `scan.findings.length > 0 || scan.oversized`, replace the result with
   `{ ...result, status: 'failed', exitCode: 1, tail: [...result.tail, ...lines].slice(-GATE_TAIL_LINES) }`,
   append `lines` to `result.logFile` with a best-effort `appendFileSync` (a failure there is
   swallowed and the tail still carries them), and log once:
   `logger.error({ msg: 'secret_scan_failed', runId: ctx.input.runId, findings: scan.findings.length, oversized: scan.oversized })`.
   No matched value, no path outside the repo and no diff text reaches the log.
4. `new SecretScanError('git_failed')` → the same replacement with the single line
   `secret_scan: git_failed`, and `logger.error({ msg: 'secret_scan_failed', runId,
   code: 'git_failed' })`.

The existing `run.gate` event and the `gate_failed` run failure stay the only observable
outcome: G1 keeps its meaning, so no guardrail and no `docs/decisions.md` D12 row changes. The
`RunPorts` interface is **not** modified — the scanner is a direct import so the frozen port
list from Task-14 keeps its shape.

### `ops/vm/systemd` — the three long-running units

Add this block to `codebox.service`, `codebox-opencode.service` and `cloudflared.service`,
after `PrivateTmp=true` and before `ReadWritePaths=...`:

```ini
CapabilityBoundingSet=
AmbientCapabilities=
LockPersonality=true
PrivateDevices=true
ProtectClock=true
ProtectControlGroups=true
ProtectHostname=true
ProtectKernelLogs=true
ProtectKernelModules=true
ProtectKernelTunables=true
RemoveIPC=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
UMask=0027
```

`MemoryDenyWriteExecute=yes` must never be added to these units: it disables the write-execute
mapping V8's JIT needs and Node dies at boot. Keep every existing directive (`User=`,
`Group=`, `EnvironmentFile=`, `ReadWritePaths=`, `Restart=`, `ExecStart=`) exactly as it is.

### Data

No new `CB_*` key, no new error code, no new contract type. The only numbers this task freezes:

| Constant | Value | Meaning |
| --- | --- | --- |
| `MAX_REQUEST_BYTES` | `1_048_576` | largest accepted `/v1` body |
| `API_RATE_LIMIT` / window | `120` / `60 s` | every `/v1` route per device |
| `WORK_RATE_LIMIT` / window | `10` / `60 s` | run-creating routes per device |
| `MAX_SECRET_SCAN_BYTES` | `4_194_304` | above it the gate fails with `oversized` |

## 🧩 Configuration

No new key. This task makes `CB_ALLOWED_ORIGINS` (default: empty, or the origin of
`CB_PUBLIC_URL` when that is set) load-bearing; its documentation already exists in
`docs/providers.md` §4 and is not edited here. The empty list means "development, accept every
origin" and must be written down in `docs/security.md` §5.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; includes the tests this task adds (the `ops` project runs
    `ops/vm/test/*.test.mjs`).
  - `npm run build` — `tsc -b` (the app build must stay green with the new headers).
  - `git diff --name-only main...task-28` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean.
  - [ ] `[unit]` `secret-scan.test.ts` pins the nine pattern sources and finds each of: a
        `github_pat_` token, `ghp_`, `sk-ant-`, `sk-proj-`, `AKIA`, a JWT, `xoxb-`, a
        `password = "…"` assignment and a BEGIN PRIVATE KEY block, each on its own added line
        with the right `path` and `line`.
  - [ ] `[unit]` It ignores a secret on a **context** line and on a **removed** line, honours
        `codebox-secret-scan: allow`, skips a `[redacted]`/`example`/`CHANGEME` value, keeps
        two patterns firing on one line, and returns findings sorted and deduped.
  - [ ] `[unit]` `redact-corpus.test.ts` asserts `REDACTION_CORPUS.length === 30` and that no
        literal in any fixture's `secrets` survives `JSON.stringify(redact(fixture.input))`.
  - [ ] `[unit]` `app.test.ts`: every response carries the four `SECURITY_HEADERS`;
        `Origin: https://evil.example` with `CB_ALLOWED_ORIGINS=https://box.example` is `403`
        `forbidden` with `details.reason === 'origin'`; `https://box.example` passes;
        no `Origin` passes; an empty allowlist passes; a `content-length` of `1048577` on
        `POST /v1/runs` is `400` `bad_request` with `details.limitBytes === 1048576` and the
        handler never runs.
  - [ ] `[unit]` `auth/middleware.test.ts`: `isWorkRoute` is true for the three paths and
        false for `GET /v1/runs` and `POST /v1/jobs/{id}/pause`; the 121st request from one
        device on a non-work route is `429` with a positive `Retry-After`; the 11th
        `POST /v1/runs` is `429`; a second device is unaffected.
  - [ ] `[unit]` `run/engine.test.ts`: a fake `git diff` adding a `ghp_` token fails the run with
        `gate_failed`, the stored gate is `{ status: 'failed', exitCode: 1 }`, and the tail
        carries `src/x.ts:3 github_token` while the secret literal appears in neither the tail
        nor the logs; a `git diff` exit code of 1 fails the run with `secret_scan: git_failed`;
        a clean diff leaves the existing success path byte-identical.
  - [ ] `[unit]` `ops/vm/test/systemd.test.mjs` asserts every directive of the block above is
        present in all three units, that `MemoryDenyWriteExecute` is absent or not `yes`, and
        that `ReadWritePaths=/var/lib/codebox /srv/codebox` survived.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched.
  - [ ] `[live]` On the reference VM after `sudo systemctl restart codebox codebox-opencode
        cloudflared`: `systemd-analyze security codebox.service --no-pager | tail -n 1` reports
        an exposure **≤ 5.0** (and the same for `codebox-opencode.service`), `/v1/health`
        answers `200` with `status: "ok"`, and `journalctl -u codebox -n 50` shows no
        `EPERM`/`SystemCall` denial. Report the three numbers.
  - [ ] `[live]` Through the tunnel, `curl -s -o /dev/null -w '%{http_code}' -X POST
        -H 'Origin: https://evil.example' -H "Authorization: Bearer $TOKEN" --data '{}'
        https://<public-hostname>/v1/runs` answers `403`, and the same call with the app's own
        origin answers `202`/`422` (not `403`). Report both codes.

## 📣 Coordination

- For the Architect: this task also appends decision **D40** to `docs/decisions.md` (the row
  after D39): request controls are enforced in the daemon, and the secret scan is a gate step,
  not a ninth guardrail. It owns `docs/decisions.md` for the batch; no other task may edit it.
- For the next batch: `packages/security` now exports `scanPatchForSecrets`,
  `formatSecretFinding`, `SECRET_PATTERN_NAMES`, `SECRET_PATTERN_SOURCES`,
  `SECRET_SCAN_ALLOW_MARKER` and `REDACTION_CORPUS`; any later secret-scanning work reuses
  them. The `rate_limited` refusal for a device now happens in the auth middleware, so a new
  route never needs its own limiter.
- For Task-23: a `429` from any settings action is a normal `ApiError` with `retryAfter` in
  `details`; render it, do not retry in a loop.
- For Task-27: `apps/daemon/src/app.ts` gains the origin and body guards; a telemetry request
  is a plain `GET` with no body and no origin problem.

## ⛔ Out of scope

- No new dependency outside the spec.
- No refactor of a file this task did not have to touch.
- No change to `docs/decisions.md` beyond the single appended D40 row.
- No container/bubblewrap runner: `docs/security.md` §6 must say it is not shipped in v1 and
  the systemd sandbox is the isolation boundary. Do not add a decision row for it.
- No egress filtering: `docs/security.md` §6's "Network" row must stop promising it for
  "Batch 7" and say what is true — no inbound listener, outbound allowed, the permission
  matrix and the sandbox are the boundary.
- No change to the D12 guardrail list, `PERMISSION_MATRIX`, `decidePermission`, the protected
  paths or the diff budget.
- No egress filtering, no TLS change, no Cloudflare Access change and no change to the pairing
  or token code.
- No scanner for the bare-clone cache or history: only the run's diff against its base.
- No `apps/app/**` change: the CSP already allows the built bundle.

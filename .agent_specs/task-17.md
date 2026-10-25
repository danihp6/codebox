# Spec: Task-17 — CLI

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** daemon (a second entry point in the daemon package, no HTTP route).
- **Role:** Dev.
- **Objective:** after this task the box has a `cb` executable that speaks only HTTP to `/v1`.
  It implements `cb pair`, `status`, `doctor`, `run`, `jobs`, `logs`, `events`, `brake`,
  `update`, `backup`, `revert`, with stable exit codes, a `--json` form for machine use and one
  `cb doctor` line per dependency. It never reads SQLite, never imports another daemon module,
  and never prints a token.
- **Environment:** worktree `../wt-cb-17`, branch `task-17`, base `main`.
- **Dependencies (all merged):**
  - Task-03 `@codebox/contracts` — `parseHealth`, `parseProviders`, `parseTelemetry`,
    `parseRun`, `parseJob`, `parseApproval`, `pageOfJob`, `pageOfRun`,
    `errorEnvelopeSchema`, `idempotencyKeySchema`.
  - Task-11 `apps/daemon/src/app.ts` — `GET /v1/health` and `GET /v1/version`, the only routes
    this CLI can smoke-test against the tree today. The `/v1/runs`, `/v1/jobs`, `/v1/settings`
    and `/v1/admin/*` routes it calls are Task-15's and Task-19's work; the CLI speaks to them
    over HTTP only and its own tests use an injected transport.
  - Task-12 `apps/daemon/src/auth/**` — `POST /v1/pair/code` from a loopback source is the
    local admin path this CLI uses; the bearer routes it calls are documented in `docs/api.md`
    §2.
  - `ops/vm/{upgrade,backup}.sh` — the scripts `cb update` and `cb backup` wrap (already on
    `main`).

### Exclusive paths (single writer)

- `apps/daemon/bin/cb.mjs` — the `cb` entry point: shebang, argv hand-off, exit code.
- `apps/daemon/src/cli/main.ts` — `run(argv, options)`; command dispatch; exit-code mapping.
- `apps/daemon/src/cli/args.ts` — the argv parser (commands, flags, `--json`, `--url`,
  `--token`, `--help`, `--version`).
- `apps/daemon/src/cli/transport.ts` — `CliTransport`, `createHttpTransport`, `TransportError`,
  the error-envelope decoder.
- `apps/daemon/src/cli/output.ts` — human and `--json` rendering, table padding,
  `redactToken`.
- `apps/daemon/src/cli/doctor.ts` — the eight checks and the pass/fail rule.
- `apps/daemon/src/cli/commands.ts` — one function per command, all over the transport.
- `apps/daemon/src/cli/README.md` — the file map.
- `apps/daemon/src/cli/main.test.ts`, `args.test.ts`, `transport.test.ts`, `doctor.test.ts`,
  `commands.test.ts`.
- `apps/daemon/package.json` — **hot file, you alone**: add `"bin": { "cb": "./bin/cb.mjs" }`,
  add `"bin"` to `files`, and nothing else. No dependency, no new script, no version bump.
- `docs/operations.md` — **section 12, `## 12. CLI reference`, only**. Add the environment,
  exit-code and QR bullets described below. Do not touch §3, §7 or any other section.

Explicitly not yours: `apps/daemon/README.md`, `src/{main,modules,app,config,logger}.ts`,
`src/{auth,chat,events,jobs,runs,run,gate}/**`, `apps/app/**`, `packages/**`,
`package-lock.json`, `TODO.md`, `CHANGELOG.md`, `docs/decisions.md`, `docs/providers.md`,
`docs/api.md`, `tsconfig.base.json`, `opencode.json`, `.github/**`, `ops/**`.

The CLI must **not** import `apps/daemon/src/**`. Its only relative imports are inside
`src/cli/**`; everything else is `node:*` and `@codebox/contracts`. It must not add a route to
the daemon.

### Inputs (read-only)

- `docs/operations.md` (all of it; you edit §12 only), `docs/api.md` §1–§7, `docs/security.md`
  (the scope table and the no-secret-in-output rule).
- `packages/contracts/src/{index,resources,errors,parse,primitives}.ts`.
- `apps/daemon/src/app.ts` (the health/version shape), `src/auth/routes.ts` (the pairing body),
  `src/logger.ts` (the redaction key list).
- `ops/vm/upgrade.sh`, `ops/vm/backup.sh` (their flags and exit codes).
- `apps/daemon/package.json`, `apps/daemon/tsconfig.json`, `eslint.config.js`.

## 🔒 Contract

```ts
// apps/daemon/src/cli/main.ts
export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}
export interface CliOptions {
  readonly argv: readonly string[];
  readonly io?: CliIo;                     // default process.stdout / process.stderr
  readonly env?: Record<string, string | undefined>; // default process.env
  readonly transport?: CliTransport;       // tests; default createHttpTransport(...)
  readonly runner?: CommandRunner;         // tests; default spawns a script
  readonly version?: string;               // default apps/daemon package.json version
}
export function run(options: CliOptions): Promise<number>;
```

```ts
// apps/daemon/src/cli/transport.ts
export interface CliRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;                   // always starts with '/v1/'
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  readonly token?: string | null;
  readonly idempotencyKey?: string;
}
export interface CliResponse {
  readonly status: number;
  readonly body: unknown;                  // parsed JSON, or null for an empty body
}
export interface CliTransport {
  send(request: CliRequest): Promise<CliResponse>;
}
export function createHttpTransport(options: {
  readonly baseUrl: string;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;             // default 10000
}): CliTransport;
export class TransportError extends Error {
  readonly kind: 'unreachable' | 'timeout' | 'bad_response';
}
```

`createHttpTransport` sets `accept: application/json`, `content-type: application/json` when a
body exists, `authorization: Bearer <token>` when a token exists and `idempotency-key` when a key
exists. A non-2xx answer is **not** a `TransportError`: it is returned with its status and the
decoded `error` envelope (`errorEnvelopeSchema.safeParse`), so callers can map it. A network
failure or a body that is not JSON is a `TransportError`.

```ts
// apps/daemon/src/cli/args.ts
export interface ParsedArgs {
  readonly command: string;                // 'pair' | … | 'help' | 'version'
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}
export function parseArgs(argv: readonly string[]): ParsedArgs; // throws UsageError
export class UsageError extends Error { readonly flag: string | null; }
```

```ts
// apps/daemon/src/cli/doctor.ts
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';
export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
}
export interface DoctorReport {
  readonly checks: readonly CheckResult[];
  readonly ok: boolean;                    // false when any check is 'fail'
}
export async function doctorChecks(
  transport: CliTransport,
  options: { readonly now: () => Date; readonly token: string | null },
): Promise<DoctorReport>;
export function formatDoctor(report: DoctorReport): string[]; // one line per check
export function doctorJson(report: DoctorReport): { checks: readonly CheckResult[]; ok: boolean };
```

`formatDoctor` line format, exactly: the name left-padded to 12 columns, the status left-padded
to 6, then a single space and the detail — `db           ok     wal, 4 tables`. `--json` prints
`{"checks":[{"name","status","detail"}],"ok":true|false}` on one line and nothing else.

The eight checks, in this order, from these surfaces only:

| Check | Source | `ok` / `warn` / `fail` / `skip` |
| --- | --- | --- |
| `db` | `GET /v1/health` | `health.db === 'ok'` → ok; `degraded` → warn; `down` → fail |
| `opencode` | `GET /v1/health` | same rule on `health.opencode` |
| `tunnel` | `GET /v1/health` (`CB_PUBLIC_URL` is unknown to the CLI) | `health.status === 'ok'` → ok; `degraded` → warn; `down` → fail; detail names the local URL it reached |
| `github` | `GET /v1/providers` | provider `github`: `configured` → ok, else warn; `404` → skip `missing_route` |
| `disk` | `GET /v1/health` → `disk.usedPercent` | `< 70` ok, `70–84.99` warn, `>= 85` fail |
| `queue` | `GET /v1/health` → `queue` | `running < maxConcurrency` ok, else warn |
| `cost` | `GET /v1/telemetry?range=24h` → `spendUsd` | `404` → skip `missing_route`; `< 10` ok, `10–19.99` warn, `>= 20` fail (no route exposes `CB_DAILY_COST_USD` to the CLI; Task-27 replaces these fixed bounds) |
| `backup` | no route exists | always skip `missing_route` |

A `warn` never fails the command; a `fail` exits `1`; a `skip` is printed and ignored. A
transport failure on `GET /v1/health` stops the run and exits `3` (the daemon is unreachable, so
there is nothing to report). A `401` exits `4`.

Commands, frozen:

| Command | HTTP | Notes |
| --- | --- | --- |
| `cb pair --name <n> [--ttl <seconds>]` | `POST /v1/pair/code` with `{ name, ttlSeconds? }`, no token | Prints the code, its expiry and `codebox://pair?url=<base>&code=<code>`. Exit `0`. |
| `cb status` | `GET /v1/health`, `GET /v1/runs?state=running&limit=5`, `GET /v1/settings` (404 → skip brake line) | Human block: status, version, queue, running ids, brake. `--json` merges the bodies. |
| `cb doctor [--json]` | the table above | One line per check; exit `1` if any `fail`. |
| `cb run <jobId>` | `POST /v1/jobs/{id}/run` with a fresh `Idempotency-Key` | Prints the run id and state; exit `0`, or the server error's exit code. |
| `cb jobs [--pause <id>] [--resume <id>]` | `GET /v1/jobs?limit=50`; `POST /v1/jobs/{id}/pause` / `resume` | Table `id  title  cron  timezone  enabled  nextFireAt`. |
| `cb logs <runId>` | `GET /v1/runs/{id}/events?after=0&limit=200` | Prints one line per event: `ts type data` with `data` JSON, tool secrets already redacted server-side. |
| `cb events <runId>` | same route | Identical rendering; kept because `docs/operations.md` §8 names both. |
| `cb brake on\|off\|status` | `on` → `POST /v1/admin/brake { enabled: true }`; `off` → `{ enabled: false }`; `status` → `GET /v1/settings` | Prints `brake <on\|off>`. A `404` prints `unsupported` and exits `5`. |
| `cb update [--to <v>] [--rollback]` | none | Runs `/usr/local/lib/codebox/upgrade.sh` with `--to <v>` or `--rollback` through `CommandRunner`; passes the child's exit code through (`install.sh` uses 3/4/6). |
| `cb backup [--verify]` | none | Runs `/usr/local/lib/codebox/backup.sh` with `--verify` when asked; child's exit code. |
| `cb revert <runId> [--job <jobId>]` | `POST /v1/runs/{id}/revert` with a fresh `Idempotency-Key` | Prints the new run id. |
| `cb help`, `cb --help`, `cb --version` | none | Usage text / `codebox <package version>`; exit `0`. |

```ts
// apps/daemon/src/cli/commands.ts
export interface CommandRunner {
  run(input: {
    readonly file: string;
    readonly args: readonly string[];
  }): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
}
export function defaultCommandRunner(): CommandRunner; // node:child_process spawn, stdout/stderr captured
```

Transport-first design: every command receives `{ transport, io, env, runner, now }` and returns
`Promise<number>`. No command calls `process.exit`, writes to `process.stdout` directly, or
reads `process.env` outside `run()`.

Exit codes, frozen:

| Code | Meaning |
| --- | --- |
| `0` | success |
| `1` | a `cb doctor` check failed |
| `2` | usage: unknown command, unknown flag, missing positional, invalid value |
| `3` | the daemon is unreachable, timed out, or answered with a non-JSON body |
| `4` | `401`/`403` from the API (no token, expired token, missing scope) |
| `5` | any other non-2xx answer (including `404` and `500`) |
| child's code | `cb update` and `cb backup` pass the script's exit code through |

**No token may ever reach stdout, stderr or a JSON body.** `redactToken(text, token)` replaces
every occurrence of the token (and of `Bearer <token>`) with `<redacted>` before any write, and
`output.ts` never renders request headers. An API error prints exactly
`<code>: <message> (requestId <id>)` from the envelope — never the raw response.

### Data

- Environment: `CODEBOX_URL` (default `http://127.0.0.1:8787`), `CODEBOX_TOKEN` (no default),
  `CODEBOX_STATE_DIR` (default `/var/lib/codebox`). These are **not** `CB_*` and must not be
  documented in `docs/providers.md`; they belong to `docs/operations.md` §12.
- Token resolution order: `--token` flag, then `CODEBOX_TOKEN`, then the file
  `<CODEBOX_STATE_DIR>/cli.token` (read as UTF-8, trimmed, max 4096 bytes, mode ignored). Missing
  for an authenticated command → a one-line `no token: set CODEBOX_TOKEN or --token` on stderr
  and exit `4`. `cb pair` needs no token (loopback admin path).
- `--url` overrides `CODEBOX_URL`. The CLI never sends a token to a URL that is not the
  configured base.
- Base URL normalisation: strip one trailing `/`; every request path starts with `/v1/`.

## 🧩 Configuration

No `CB_*` key is added or read. The CLI's own environment is `CODEBOX_URL`, `CODEBOX_TOKEN`,
`CODEBOX_STATE_DIR` (see Data). Do not add `CB_*` aliases: `packages/contracts/src/config.ts`
rejects an unknown `CB_*` key and `docs/providers.md` is not in this task's paths.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`.
  - `npm run lint` — must pass (it lints `bin/*.mjs` and `src/cli/*.ts`).
  - `npm test` — Vitest, headless; includes the tests this task adds.
  - `npx vitest run --project apps/daemon src/cli` — the CLI suite alone.
  - `npm run build` — this is what produces `apps/daemon/dist/cli/main.js`, so run the three
    `node bin/cb.mjs` checks **after** it.
  - `git diff --name-only main...task-17` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean.
  - [ ] `[unit]` Argument parsing and exit codes:
    `npx vitest run --project apps/daemon src/cli -t 'arguments'`. Covers: no arguments → usage
    and exit `2`; `--help`/`-h` → exit `0`; `--version` → the package version; unknown command and
    unknown flag → exit `2` with the flag named; `--url` without a value → exit `2`.
  - [ ] `[unit]` `cb doctor` exits non-zero with one line per failed check:
    `npx vitest run --project apps/daemon src/cli -t 'doctor'`. With a fake transport whose
    `/v1/health` says `{ status: 'down', db: 'down', opencode: 'ok', disk: { usedPercent: 91 } }`,
    the report has exactly eight checks in the documented order, `formatDoctor` returns eight
    lines, the exit code is `1`, and the lines for `db` and `disk` start with `db` and `disk` and
    read `fail`. A healthy answer exits `0`. A `404` from `/v1/providers` and `/v1/telemetry`
    produces `skip`, never `fail`.
  - [ ] `[unit]` The CLI never prints a token:
    `npx vitest run --project apps/daemon src/cli -t 'never prints a token'`. Every command is
    run with `CODEBOX_TOKEN=cb-secret-value` against a fake transport that echoes the token in an
    error body and in a header-like field; the captured stdout and stderr contain no
    `cb-secret-value` and no `Bearer`.
  - [ ] `[unit]` Request shapes: `npx vitest run --project apps/daemon src/cli -t 'requests'`.
    `cb run job_ABC` sends `POST /v1/jobs/job_ABC/run` with an `idempotency-key` header of 1–255
    characters; `cb brake on` sends `POST /v1/admin/brake` with `{ enabled: true }`; `cb logs`
    sends `GET /v1/runs/{id}/events?after=0&limit=200`. No command imports `../app.js` or any
    sibling daemon module: the test asserts `readdirSync` of `src/cli` has no import outside
    `./`, `node:*` and `@codebox/contracts` (a comment-only regex assertion is acceptable).
  - [ ] `[unit]` `cb update`/`cb backup` pass the child's exit code:
    `npx vitest run --project apps/daemon src/cli -t 'scripts'`. A fake runner returning `3`
    yields exit `3` and `upgrade.sh --to 0.2.0` was invoked with the expected arguments.
  - [ ] `[unit]` `node bin/cb.mjs --help` exits `0`
    (`node apps/daemon/bin/cb.mjs --help > /dev/null; echo $?` prints `0`).
  - [ ] `[unit]` An unreachable daemon is exit `3` and prints no token:
    `CODEBOX_TOKEN=cb-secret-value node apps/daemon/bin/cb.mjs status --url http://127.0.0.1:9 > /tmp/cb-out.txt 2> /tmp/cb-err.txt; echo $?`
    prints `3`, and `grep -c cb-secret-value /tmp/cb-out.txt /tmp/cb-err.txt` prints `0` for both.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched: the `git diff --name-only`
    output lists only `apps/daemon/bin/cb.mjs`, `apps/daemon/src/cli/**`,
    `apps/daemon/package.json` and `docs/operations.md`.
  - [ ] `[live]` `cb pair` on the VM prints a code the app accepts. Measurement: run
    `cb pair --name "Dani iPhone"` on the box, paste the printed code into `/pair` on the phone,
    and the pairing succeeds once with a green dashboard; a second use of the same code answers
    `401` with `details.reason = "used_code"`. Not run on CI.

## 📣 Coordination

- For the Architect: `cb pair` uses the merged loopback admin path (`POST /v1/pair/code` from
  `127.0.0.1`), so no unix socket is added — a socket would need `src/main.ts`, which no task in
  this batch owns. `docs/operations.md` §3 and §12 say "local admin socket"; §12 is this task's
  section and carries the clarification below. §3 is not edited.
- For the next batch: `cb doctor` reports `backup` and `tunnel` from what `/v1/health` and
  `/v1/telemetry` expose today, because no route reports a backup age and the CLI cannot read
  SQLite. Task-27 ("`cb doctor` checks") should replace those `skip` lines with real routes and
  extend `doctorChecks`; it will also own the `cost` threshold against `CB_DAILY_COST_USD`.
- For Task-15 (same batch, no shared file): the CLI is written against `docs/api.md`. Its
  `POST /v1/runs/{id}/revert`, `POST /v1/jobs/{id}/run`, `GET /v1/runs?state=…` and
  `GET /v1/runs/{id}/events` shapes are the ones in that task's spec, so no import is needed;
  the CLI's own tests fake the transport and never need a daemon.
- `docs/operations.md` §12 additions, exactly: the three `CODEBOX_*` variables; the exit-code
  table; one line saying `cb pair` prints the code and a `codebox://pair` deep link and that a
  terminal QR renderer is deferred (no QR dependency is added in v1); one line saying the local
  admin path is loopback HTTP, not a unix socket.

## ⛔ Out of scope

- No QR renderer, no interactive prompt, no shell completion, no `cb restore`, `cb prune`,
  `cb cost`, `cb cancel`, `cb onboard` (a later task, when the routes exist).
- No new dependency, no new `CB_*` key, no daemon route, no import of a sibling daemon module.
- No retry loop around a failing request: one attempt, one exit code.
- No change to `apps/daemon/src/main.ts` or to the daemon's `exports` map.

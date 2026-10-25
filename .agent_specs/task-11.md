# Spec: Task-11 — Daemon skeleton

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** daemon.
- **Role:** Dev.
- **Objective:** turn `apps/daemon` from an empty stub into a startable daemon: an injected
  context (config, store, logger, clock, feature flags), a zod-validated `CB_*` configuration
  loader that fails fast without ever printing a value, a structured JSON logger with key
  redaction, a Hono app with `/v1/health` and `/v1/version` plus static hosting of the built
  app, graceful shutdown, boot reconciliation of orphaned runs and stale locks, and one
  extension surface (`DaemonModule`) so that Tasks 12–17, 27 and 35 add a directory under
  `apps/daemon/src/` and never edit `main.ts` again.
- **Environment:** worktree `../wt-cb-11`, branch `task-11`, base `main`.
- **Dependencies:** Task-01 (workspaces, root gate), Task-03 (`@codebox/contracts`:
  `parseConfig`, `healthSchema`, `versionSchema`, `errorEnvelopeSchema`, `RequestId`),
  Task-04 (`@codebox/store`: `openStore`, `Store`, `withTransaction`, `PAGINATION_MAX_LIMIT`
  is in contracts), Task-06 (`@codebox/security`: `redact`). Tasks 06 and 04 are merged; this
  task reads the files they produced, not the tasks themselves.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path.

- `apps/daemon/src/main.ts` — hot file, held by this task alone in this batch.
- `apps/daemon/src/config.ts`
- `apps/daemon/src/logger.ts`
- `apps/daemon/src/modules.ts`
- `apps/daemon/src/health.ts`
- `apps/daemon/src/boot.ts`
- `apps/daemon/src/static.ts`
- `apps/daemon/src/app.ts`
- `apps/daemon/src/config.test.ts`
- `apps/daemon/src/logger.test.ts`
- `apps/daemon/src/modules.test.ts`
- `apps/daemon/src/health.test.ts`
- `apps/daemon/src/boot.test.ts`
- `apps/daemon/src/static.test.ts`
- `apps/daemon/src/app.test.ts`
- `apps/daemon/src/start.test.ts`
- `apps/daemon/package.json`
- `apps/daemon/README.md`
- `package-lock.json` — hot file, held by this task alone in this batch. It changes because
  `apps/daemon` gains two runtime dependencies (see Contract). No other task in the batch
  changes a dependency, so this is the only writer.
- `vitest.config.ts` — **claimed, outside the brief's box, reported to the Orchestrator.** The
  `apps/daemon` project must resolve `@codebox/*` to the package sources, because this is the
  first package in the tree that value-imports another workspace at runtime (see Contract).
  The edit is confined to the `apps/daemon` project object; no other project changes. No other
  task in this batch touches this file.

`apps/daemon/tsconfig.json` is **not** modified: it already includes `src/**/*.ts` and excludes
`src/**/*.test.ts`.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/api.md` (§1 Rules, §3 Errors, §5.1 Health, version, telemetry) — the source of truth
  for the two routes. Do not edit it.
- `docs/architecture.md` (§2 `apps/daemon`, `packages/store`) — do not edit it; Task-34 owns
  the `packages/store` table section in this same batch.
- `docs/providers.md` (§2–§11 defaults, §14 the systemd `EnvironmentFile`, §15 the config
  failure table).
- `docs/agent-ci.md` §7 and §10 (how a `[live]` criterion is measured; `CB_AGENT_*` never
  appears in `apps/daemon`).
- `packages/contracts/src/config.ts` (`CONFIG_DEFAULTS`, `SECRET_CONFIG_KEYS`,
  `parseConfig`, `CodeboxConfig`, `LogLevel`, `ConfigInput`).
- `packages/contracts/src/parse.ts` (`ContractParseError`, `ParseIssue`).
- `packages/contracts/src/errors.ts` (`ERROR_STATUS`, `errorEnvelopeSchema`, `ErrorCode`).
- `packages/contracts/src/resources.ts` (`healthSchema`, `diskSchema`, `queueSchema`,
  `versionSchema`, `parseHealth`, `parseVersion`, types `Health`, `Version`).
- `packages/contracts/src/primitives.ts` (`RUN_STATES`, `RUN_STATE_TERMINAL`, `RequestId`,
  `ID_PREFIXES`).
- `packages/contracts/src/events.ts` (`runFailedDataSchema`, `NewEventRecord` shape).
- `packages/store/src/index.ts`, `store.ts`, `db.ts`, `runs.ts`, `events.ts`, `repos.ts`.
- `packages/security/src/redact.ts` (`redact`, `isSecretKey`).
- `apps/daemon/package.json`, `apps/daemon/tsconfig.json`, `apps/daemon/README.md`,
  `apps/daemon/src/main.ts`.
- `eslint.config.js`, `tsconfig.base.json`.

## 🔒 Contract

The public surface other tasks are written against **right now**. It is a promise, not a
suggestion. Exact exported names, signatures and types. Every file is ESM with NodeNext
resolution: every relative import ends in `.js`, every type import uses `import type`.

### `apps/daemon/package.json`

```json
{
  "dependencies": {
    "@codebox/contracts": "0.0.0",
    "@codebox/security": "0.0.0",
    "@codebox/store": "0.0.0",
    "@hono/node-server": "2.1.5",
    "hono": "4.13.13"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "start": "node dist/main.js",
    "test": "cd ../.. && vitest run --project apps/daemon"
  }
}
```

- Exact versions, no `^` and no `~`. `@hono/node-server@2.1.5` peers on `hono ^4 || ^5`, has no
  dependencies of its own, and needs Node ≥ 20. `hono@4.13.13` needs Node ≥ 16.9.
- `zod` is **not** added: every schema is imported from `@codebox/contracts`, which owns zod
  (`zod@4.6.7`). Re-declaring a schema here is a defect.
- No other dependency may be added. `node:fs`, `node:fs/promises`, `node:http`, `node:path`,
  `node:url`, `node:crypto`, `node:os`, `node:process` are the only other modules used.
- `package-lock.json` must be regenerated (`npm install --no-audit --no-fund`) and committed
  in the same commit; `npm ci` from a clean `node_modules` must succeed afterwards.

### `vitest.config.ts` — the `apps/daemon` project only

`packages/store/src/mappers.ts` states the rule this task is the first to hit:

> The contract enums are re-declared here because `@codebox/contracts` is imported type-only:
> a value import would need `packages/contracts/dist`, which does not exist during `npm test`.

The daemon cannot follow that rule: it must call `parseConfig`, `parseHealth`, `parseVersion`,
`openStore`, `withTransaction`, `redact` and `PAGINATION_MAX_LIMIT` at runtime, and the root
gate runs `npm test` **before** `npm run build` (`ci.yml`, `AGENTS.md` Workflow). A bare
`@codebox/*` specifier resolves through each package's `exports` to `./dist/…`, which a fresh
worktree does not have.

So the `apps/daemon` project gains one regex alias, and nothing else in the file changes:

```ts
{
  test: {
    name: 'apps/daemon',
    root: './apps/daemon',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
  resolve: {
    alias: [
      {
        find: /^@codebox\/([a-z-]+)$/,
        replacement: `${fileURLToPath(new URL('./packages/', import.meta.url))}$1/src/index.ts`,
      },
    ],
  },
}
```

- The same trick already works in `packages/scheduler/src/tick-dst.test.ts`, which imports
  `../../core/src/cron.js`: Vite resolves a `.js` specifier to the `.ts` file beside it.
- Only the test runner is affected. `tsc` still resolves the real `dist` types and the built
  daemon still imports `@codebox/*` through node_modules.
- Do **not** add an alias for any other project and do not change `passWithNoTests`,
  `include` or the project list.

### `apps/daemon/src/config.ts`

```ts
import type { CodeboxConfig, ConfigInput } from '@codebox/contracts';
import type { ContractParseError } from '@codebox/contracts';

export interface BindAddress {
  readonly hostname: string;
  readonly port: number;
}

export interface StatePaths {
  readonly stateDir: string;
  readonly tmpDir: string;
  readonly dbFile: string;      // <stateDir>/state.db
  readonly locksDir: string;    // <stateDir>/locks
  readonly daemonFile: string;  // <stateDir>/daemon.json
}

export interface BuildInfo {
  readonly version: string;      // apps/daemon/package.json "version", "0.0.0" fallback
  readonly commit: string | null; // config.CB_COMMIT
  readonly builtAt: string | null; // always null in this task
}

export interface ConfigFailure {
  readonly missing: readonly string[];  // keys with no value and no default, sorted
  readonly invalid: readonly string[];  // keys present but rejected or unknown, sorted
  readonly messages: readonly string[]; // one per key: "<KEY> is required" | "<KEY> is invalid" | "<KEY> is not a known configuration key"
}

/** Thin wrapper over `parseConfig` that turns a `ContractParseError` into a key list. */
export function loadConfig(input: ConfigInput): CodeboxConfig;

/** Never includes an issue message or a value: the key name plus one fixed phrase. */
export function describeConfigFailure(
  error: ContractParseError,
  input: ConfigInput,
): ConfigFailure;

/** "127.0.0.1:8787", "[::1]:8787", "127.0.0.1:0". Throws on an unparseable value. */
export function parseBind(bind: string): BindAddress;

export function resolvePaths(config: CodeboxConfig): StatePaths;

/** mkdir -p stateDir and locksDir with mode 0750. Idempotent. */
export function ensureDirectories(paths: StatePaths): void;

/** Reads `apps/daemon/package.json` relative to this module; "0.0.0" if unreadable. */
export function readBuildInfo(config: CodeboxConfig): BuildInfo;
```

- `loadConfig` throws the original `ContractParseError`; it does not exit the process. Only
  `main.ts` decides the exit code.
- `describeConfigFailure` rule, per issue: take `key = issue.path.split('.')[1]`. If
  `input[key]` is `undefined` or `''` → `missing` + `"<key> is required"`. Else if
  `issue.code === 'unrecognized_keys'` → `invalid` + `"<key> is not a known configuration
  key"`. Else → `invalid` + `"<key> is invalid"`. Sorted and de-duplicated. `issue.message` is
  never used: a zod message may echo a received value, and a secret value must never leave
  the process.
- `parseBind` splits at the last `:` and validates the port is `0–65535`; `[` `]` around an
  IPv6 host are stripped. `CB_BIND` was already validated as `host:port` by the config schema.
- Purity: `loadConfig`, `parseBind` and `resolvePaths` are pure. `ensureDirectories` and
  `readBuildInfo` touch the filesystem and take everything they need as an argument.

### `apps/daemon/src/logger.ts`

```ts
import type { LogLevel } from '@codebox/contracts';

export const LOG_LEVEL_RANK: Readonly<Record<LogLevel, number>>; // trace 10, debug 20, info 30, warn 40, error 50
export const LOG_LEVELS: readonly LogLevel[];                    // ['trace','debug','info','warn','error']

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  trace(fields: LogFields): void;
  debug(fields: LogFields): void;
  info(fields: LogFields): void;
  warn(fields: LogFields): void;
  error(fields: LogFields): void;
  child(bindings: LogFields): Logger;
}

export interface CreateLoggerOptions {
  readonly level: LogLevel;
  readonly sink?: (line: string) => void;   // default: (line) => process.stdout.write(`${line}\n`)
  readonly now?: () => Date;                // default: () => new Date()
  readonly base?: LogFields;                // default: {}
  readonly includeStack?: boolean;          // default: false
}

export function createLogger(options: CreateLoggerOptions): Logger;
/** Bootstrap only: a `CB_LOG_LEVEL` that fails validation cannot stop the failure being logged. */
export function isLogLevel(value: string): value is LogLevel;
/**
 * The final string for one record: prepends `ts` (from `now`), keeps `level` then `msg` first,
 * runs the whole object through `redact`, and `JSON.stringify`s it. Exported for the test.
 */
export function formatLogLine(record: LogFields, now: Date): string;
```

- One line per record, no trailing newline inside the string (`sink` appends it).
- Shape: `{"ts":"<RFC3339 with ms, UTC>","level":"<level>","msg":"<string>"}` then the `base`
  bindings then the call's fields, in that order. `String(JSON.stringify(...))`.
- `msg` is required and must be a string: `fields.msg` missing → `msg: ""`; `ts`, `level` and
  `msg` cannot be overridden by `base` or by the call's fields.
- Redaction: the whole record (base + fields) passes through `redact` from
  `@codebox/security` before serialisation, so any key containing `token`, `secret`,
  `password`, `key`, `authorization`, `cookie` or `private` becomes `[redacted]`.
- An `Error` value under `err` or `error` is serialised as `{name, message}` and, when
  `includeStack` is true, also `stack`.
- A record is written when `LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[options.level]`.
- Serialisation never throws: a circular or unserialisable value becomes the string
  `[unsupported]` (already the behaviour of `redact`).
- Field names that a logger must not use because redaction eats them: `keys`, `apiKey`,
  `secretName`. Use `missing`, `invalid`, `messages`, `err`, `code`, `requestId`, `port`.

### `apps/daemon/src/modules.ts`

```ts
import type { Hono } from 'hono';
import type { CodeboxConfig } from '@codebox/contracts';
import type { Store } from '@codebox/store';
import type { BuildInfo, StatePaths } from './config.js';
import type { Logger } from './logger.js';

export interface AppVariables {
  requestId: string;
}
export type DaemonApp = Hono<{ Variables: AppVariables }>;

export type SubsystemName =
  | 'auth' | 'chat' | 'events' | 'run' | 'gate' | 'jobs'
  | 'runs' | 'push' | 'routines' | 'telemetry' | 'cli';

export const SUBSYSTEMS: readonly SubsystemName[];   // the eleven names above, in that order
export type SubsystemFlags = Readonly<Record<SubsystemName, boolean>>;
export const DEFAULT_SUBSYSTEM_FLAGS: SubsystemFlags; // every flag true
export function subsystemPath(name: SubsystemName): string; // `./${name}/index.js`

export type ShutdownHook = () => void | Promise<void>;
export interface ShutdownRegistry {
  register(name: string, hook: ShutdownHook): void;
  run(): Promise<readonly { readonly name: string; readonly error: string | null }[]>;
}
export function createShutdownRegistry(logger: Logger): ShutdownRegistry;

export interface DaemonContext {
  readonly config: CodeboxConfig;
  readonly store: Store;
  readonly logger: Logger;
  readonly clock: () => Date;
  readonly flags: SubsystemFlags;
  readonly build: BuildInfo;
  readonly paths: StatePaths;
  readonly appDir: string;                     // <CB_INSTALL_DIR>/app
  readonly shutdown: ShutdownRegistry;
}

export interface DaemonModule {
  readonly name: string;
  register(app: DaemonApp, context: DaemonContext): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

/** The export every subsystem directory must provide at `src/<name>/index.ts`. */
export interface ModuleFactory {
  createModule(context: DaemonContext): DaemonModule;
}

export interface ModuleLoadReport {
  readonly loaded: readonly SubsystemName[];
  readonly disabled: readonly SubsystemName[];
  readonly absent: readonly SubsystemName[];
  readonly failed: readonly { readonly name: SubsystemName; readonly error: string }[];
}

export interface LoadModulesOptions {
  readonly app: DaemonApp;
  readonly context: DaemonContext;
  readonly root?: URL;                                  // default: new URL('./', import.meta.url)
  readonly importModule?: (specifier: string) => Promise<unknown>; // default: (s) => import(s)
}

export async function loadModules(options: LoadModulesOptions): Promise<ModuleLoadReport>;
export function isMissingSubsystem(error: unknown, name: SubsystemName): boolean;
```

- `loadModules` walks `SUBSYSTEMS` in order. Flag off → `disabled`, nothing imported. Flag on
  and the candidate file is missing → `absent` (logged at `info`, not an error). Flag on and
  the module throws or has no `createModule` function → `failed` with
  `error: error.message` (or `"no createModule export"`), and the app keeps booting so the
  failure is reported once by `main.ts`; `main.ts` then exits 1.
- `isMissingSubsystem` is true only for an `ERR_MODULE_NOT_FOUND` whose message contains
  `subsystemPath(name)`. A missing dependency *inside* an existing module is a `failed`
  module, never `absent`.
- `register` is awaited in order; `ShutdownRegistry.run()` runs the hooks in reverse
  registration order, sequentially, and never throws (a throwing hook becomes
  `{name, error: message}`). `shutdown` on a module, when present, is registered as
  `module:<name>`.
- `DaemonContext` lives in this file, not in `app.ts`, because `app.ts` imports `modules.ts`:
  the other direction would be a cycle. `modules.ts` imports `app.ts` never.

### `apps/daemon/src/health.ts`

```ts
import type { Health } from '@codebox/contracts';
import type { DaemonContext } from './modules.js';

/** `Health['status']` — 'ok' | 'degraded' | 'down'. The contracts package does not name it. */
export type HealthState = Health['status'];
/** `Health['disk']` — { freeBytes, totalBytes, usedPercent }. */
export type DiskInfo = Health['disk'];

export const HEALTH_PROBE_TIMEOUT_MS = 1000;
export const DISK_DEGRADED_PERCENT = 85;
export const DISK_DOWN_PERCENT = 95;
export const DISK_UNKNOWN: DiskInfo;  // { freeBytes: 0, totalBytes: 1, usedPercent: 100 }

export interface QueueSnapshot {
  readonly pending: number;
  readonly running: number;
  readonly maxConcurrency: number;
}

export interface HealthProbes {
  db(): Promise<HealthState> | HealthState;
  opencode(): Promise<HealthState> | HealthState;
  disk(): Promise<DiskInfo> | DiskInfo;
  queue(): QueueSnapshot;
}

export function createProbes(context: DaemonContext): HealthProbes;
export async function collectHealth(probes: HealthProbes, version: string): Promise<Health>;
export function aggregateStatus(input: {
  readonly db: HealthState;
  readonly opencode: HealthState;
  readonly disk: HealthState;
}): HealthState;
export function diskState(info: DiskInfo): HealthState;
```

- `aggregateStatus`: `db === 'down'` → `'down'`; else any of the three not `'ok'` →
  `'degraded'`; else `'ok'`.
- `diskState`: `usedPercent >= DISK_DOWN_PERCENT` → `'down'`; `>= DISK_DEGRADED_PERCENT` →
  `'degraded'`; else `'ok'`.
- `createProbes(context)`:
  - `db`: `context.store.db.prepare('SELECT 1 AS ok').get()` inside `try`; throws → `'down'`,
    else `'ok'`.
  - `opencode`: `fetch(new URL(context.config.CB_OPENCODE_HEALTH_PATH, context.config.CB_OPENCODE_URL), { signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) })`;
    2xx → `'ok'`; any other status, a timeout or a rejected fetch → `'down'`.
  - `disk`: `statfs(context.paths.stateDir)` from `node:fs/promises`;
    `totalBytes = blocks * bsize`, `freeBytes = bavail * bsize`,
    `usedPercent = Math.round(((blocks - bfree) / blocks) * 1000) / 10`; `blocks === 0` or a
    throw → `DISK_UNKNOWN` (and `diskState(DISK_UNKNOWN) === 'down'`).
  - `queue`: `running: context.store.runs.countLive()`,
    `pending: context.store.runs.list({ state: 'queued', limit: PAGINATION_MAX_LIMIT }).data.length`,
    `maxConcurrency: Math.max(1, context.config.CB_MAX_CONCURRENCY)`. The `Math.max(1, …)` keeps
    `parseHealth` satisfiable (`queueSchema.maxConcurrency` is `positive`); the `200`-row cap on
    `pending` is the contract limit and is documented in `apps/daemon/README.md`.
- `collectHealth` awaits the three probes (in parallel), builds the object
  `{ status, db, opencode, disk, queue, version }` and returns `parseHealth(result)` so a shape
  regression throws here, not at the client.
- Purity: `aggregateStatus`, `diskState` and `collectHealth` are pure over their arguments.

### `apps/daemon/src/boot.ts`

```ts
import type { Store } from '@codebox/store';
import type { Logger } from './logger.js';
import type { StatePaths } from './config.js';

export const STALE_LOCK_MS = 60_000;
export const ORPHAN_FAILURE_CODE = 'orphaned';
export const ORPHAN_FAILURE_MESSAGE = 'daemon restarted while this run was live';

export interface ReconcileDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly paths: StatePaths;
  readonly clock: () => Date;
  readonly staleLockMs?: number;                          // default STALE_LOCK_MS
  readonly isProcessAlive?: (pid: number) => boolean;     // default: process.kill(pid, 0) does not throw
}

export interface ReconcileResult {
  readonly failedRuns: readonly string[];
  readonly removedLocks: readonly string[];
  readonly durationMs: number;
}

export function reconcile(deps: ReconcileDeps): ReconcileResult;
```

- Runs **before** the HTTP server listens, so no request can observe a half-reconciled
  database.
- Orphaned runs: for every state in `RUN_STATES` where `!isTerminalRunState(state)`, read
  `store.runs.list({ state, limit: PAGINATION_MAX_LIMIT })` and, for each run id, in one
  `withTransaction(store.db, …)`: `store.runs.update(id, { state: 'failed', failureCode:
  ORPHAN_FAILURE_CODE, failureMessage: ORPHAN_FAILURE_MESSAGE, finishedAt: now })` and
  `store.events.append({ runId: id, chatId: null, seq: store.events.nextSeq({ runId: id }),
  type: 'run.failed', data: { runId: id, seq, ts: now, state: 'failed', code:
  ORPHAN_FAILURE_CODE, message: ORPHAN_FAILURE_MESSAGE }, ts: now })`. The data is
  `runFailedDataSchema`-shaped. One `warn` log line per run:
  `{"msg":"run_orphaned","runId":…,"state":…}`.
- Idempotent: a second `reconcile` on the same store finds no live run and appends no event.
  `failedRuns` is `[]`.
- Locks: `<locksDir>/*.lock`, each `{"pid":<number>,"at":"<RFC3339>"}`. A lock is removed when
  the pid is not alive, when `now - at > staleLockMs`, or when the file is not valid JSON
  (logged `warn` as `lock_malformed`). `removedLocks` holds the file names, sorted. A missing
  `locksDir` is not an error. `daemonFile` (`daemon.json`) is never touched here.
- `reconcile` is synchronous (the store is synchronous) and never throws for a per-run or
  per-lock failure: it logs `error` and continues.

### `apps/daemon/src/static.ts`

```ts
export interface StaticOptions {
  readonly root: string;      // absolute directory
  readonly index?: string;    // default 'index.html'
}

export const CONTENT_TYPES: Readonly<Record<string, string>>;

/** null when the path escapes the root or contains a NUL byte. */
export function resolveStaticPath(root: string, requestPath: string): string | null;
export function contentTypeFor(filePath: string): string;  // CONTENT_TYPES[ext] ?? 'application/octet-stream'
export function createStaticHandler(options: StaticOptions): (requestPath: string) => Promise<StaticHit>;
export type StaticHit =
  | { readonly kind: 'file'; readonly body: Uint8Array; readonly contentType: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'not_built' };
```

- `resolveStaticPath`: percent-decode, reject NUL, reject any `..` segment, normalise, join onto
  `root`, and return `null` unless the result is `root` itself or starts with `root + sep`.
- `createStaticHandler`: an existing regular file → `file`. Otherwise, a request path whose
  last segment has **no** dot → the index file (SPA fallback) when it exists, else `not_built`.
  Otherwise → `missing`. A missing index counts as `not_built`.
- `CONTENT_TYPES` keys (with dot): `.html text/html; charset=utf-8`, `.js` and `.mjs`
  `text/javascript; charset=utf-8`, `.css text/css; charset=utf-8`, `.json`
  `application/json; charset=utf-8`, `.map application/json; charset=utf-8`, `.svg
  image/svg+xml`, `.png image/png`, `.ico image/x-icon`, `.webmanifest
  application/manifest+json`, `.woff2 font/woff2`, `.txt text/plain; charset=utf-8`.
- Purity: `resolveStaticPath` and `contentTypeFor` are pure; the handler may read the
  filesystem and takes `root` as an argument (never `process.cwd()`).

### `apps/daemon/src/app.ts`

```ts
import type { Context } from 'hono';
import type { ErrorCode } from '@codebox/contracts';
import type { DaemonApp, DaemonContext } from './modules.js';
import type { HealthProbes } from './health.js';
import { createStaticHandler } from './static.js';

export const API_PREFIX = '/v1';
export const REQUEST_ID_HEADER = 'x-request-id';

export interface CreateAppOptions {
  readonly context: DaemonContext;
  readonly probes?: HealthProbes;   // default createProbes(context)
}

export function createApp(options: CreateAppOptions): DaemonApp;
export function newRequestId(): string;        // 'req_' + a ULID-shaped 26-char base32 suffix
export function errorBody(input: {
  readonly code: ErrorCode;
  readonly message: string;
  readonly requestId: string;
  readonly details?: Record<string, unknown>;
}): { error: { code: ErrorCode; message: string; requestId: string; details?: Record<string, unknown> } };
```

Routes, exact:

| Method | Path | Auth | Success |
| --- | --- | --- | --- |
| `GET` | `/v1/health` | none | `200` with `parseHealth` body when `status !== 'down'`; `503` with the same body when `status === 'down'` |
| `GET` | `/v1/version` | none | `200` with `parseVersion` body |
| `GET` | `/` and any non-`/v1` path | none | the static handler |

- A request id middleware on `'*'` sets `requestId` in the context variables and echoes it as
  `x-request-id`. An inbound `x-request-id` is reused only when `RequestId.safeParse` accepts
  it; otherwise a new one is generated (an inbound header is external input, parsed at the
  edge).
- One `info` log line per completed request: `{"msg":"request","requestId","method","path","status","durationMs"}`.
- `notFound`: an unknown `/v1` path, a `missing` static file and a `static` path outside the
  root all answer `404` with the envelope `not_found` and `details.path` = the request path.
  A `not_built` answer is `404` with `details.reason = 'app_not_built'`.
- The static route inspects the **raw** request target first: a path with a `..` segment
  (plain or percent-encoded, `.`/`%2e`) answers `404 not_found` before Hono/WHATWG
  normalisation can collapse it, so the SPA fallback never returns `index.html` for a
  traversal attempt.
- `onError`: `500` with the envelope `internal` (never the error message) and one `error` line
  `{"msg":"request_failed","requestId","err"}`. The message is not echoed to the client.
- Everything is `Content-Type: application/json; charset=utf-8` except a served file.
- `errorBody` output satisfies `errorEnvelopeSchema`; `ERROR_STATUS` from `@codebox/contracts`
  is the status of a code.
- `createApp` registers the middleware first and returns the app **without** any module:
  `loadModules` calls `module.register(app, context)` afterwards. Hono applies `use('*')`,
  `notFound` and `onError` to routes registered later, so a module inherits the request id, the
  envelope and the logging. A module that throws in `register` therefore throws out of
  `loadModules`, not out of `createApp`.

### `apps/daemon/src/main.ts`

```ts
export interface MainIo {
  readonly out: (line: string) => void;   // default: process.stdout.write(line + '\n')
  readonly err: (line: string) => void;   // default: process.stderr.write(line + '\n')
}

export interface RunMainOptions {
  readonly env?: NodeJS.ProcessEnv;       // default process.env
  readonly io?: MainIo;
  readonly signals?: boolean;             // default false
}

/** The whole process, except `process.exit`. Returns the exit code. */
export async function runMain(options?: RunMainOptions): Promise<number>;

export interface StartOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly appDir?: string;               // default <CB_INSTALL_DIR>/app
  readonly sink?: (line: string) => void; // passed to createLogger
}

export interface DaemonHandle {
  readonly port: number;
  readonly hostname: string;
  readonly context: DaemonContext;
  readonly report: ModuleLoadReport;
  stop(reason: string): Promise<void>;
}

/** Config → store → reconcile → app → listen, in that order. */
export async function startDaemon(options?: StartOptions): Promise<DaemonHandle>;
```

- Boot order, pinned: `loadConfig` → `createLogger` → `resolvePaths` → `ensureDirectories` →
  `openStore` → `createShutdownRegistry` → `createApp` → `loadModules` → **if
  `report.failed` is non-empty, log each and exit 1 before listening** → `reconcile` →
  `serve`. Nothing listens before the reconciliation.
- `runMain` returns `1` and writes **one** line to `io.err` when the config is invalid:
  `{"ts":…,"level":"fatal","msg":"config_invalid","missing":[…],"invalid":[…],"messages":[…]}`.
  No value from the environment appears anywhere in that line. `docs/providers.md` §15 pins
  exit `1`; the `messages` entry for a missing secret is `<KEY> is required`.
- `runMain` returns `1` for a failed `ensureDirectories`, a failed `openStore`/migration, a
  non-empty `report.failed`, or a failed `listen`; the line is
  `{"level":"fatal","msg":"<state_dir_failed|store_open_failed|module_failed|listen_failed>", …}`.
- On success `runMain` does not return until shutdown. With `signals: true` it traps
  `SIGTERM` and `SIGINT`, calls `stop(reason)`, and returns `0`. `stop()` runs the shutdown
  hooks (reverse order), closes the store, removes `daemon.json`, closes the server, and is
  idempotent. A shutdown that exceeds 5 000 ms logs `shutdown_timeout` and the process exits
  with code `1`.
- `startDaemon` never installs a signal handler and never calls `process.exit`. It writes
  `<stateDir>/daemon.json` atomically (`daemon.json.tmp` + `rename`) as
  `{"pid":<number>,"port":<number>,"hostname":"<string>","version":"<string>","startedAt":"<RFC3339>"}`
  after the listener reports its port, and logs
  `{"msg":"listening","port":<number>,"hostname":"<string>","version":"<string>"}` at `info`.
- `serve({ fetch: app.fetch, port, hostname }, (info) => …)` from `@hono/node-server`;
  `CB_BIND` port `0` binds an ephemeral port and `daemon.json` carries the real one.
- Module-level entry (only when the file is executed, never when imported):
  `void runMain({ signals: true }).then((code) => { process.exitCode = code; })`.

### Data

| Key / shape | Where | Unit / default |
| --- | --- | --- |
| Log line | `logger.ts` | `{ts, level, msg, ...base, ...fields}`, one JSON object per line |
| `<CB_STATE_DIR>/state.db` | `resolvePaths` | the store's SQLite file; `openStore` migrates at boot |
| `<CB_STATE_DIR>/locks/<name>.lock` | `boot.ts` | `{"pid":<int>,"at":"<RFC3339>"}`, stale after 60 000 ms |
| `<CB_STATE_DIR>/daemon.json` | `main.ts` | `{pid, port, hostname, version, startedAt}`; removed on a clean shutdown |
| `<CB_INSTALL_DIR>/app` | `main.ts` | the built Angular app; a missing `index.html` is `not_built` |
| `health.status` | `health.ts` | `down` if db is down; `degraded` if any dependency is not ok; else `ok` |
| `/v1/health` HTTP status | `app.ts` | `200` unless `status === 'down'`, then `503` |

## 🧩 Configuration

**No `CB_*` key is added or changed by this task.** `configSchema` in
`packages/contracts/src/config.ts` is a `z.strictObject`, so an unknown `CB_*` key is a
validation failure; a new key would be a contracts change (its own task) and is out of scope.

Keys read, with the defaults that already live in `CONFIG_DEFAULTS`:

| Key | Default | Read by | Validation failure |
| --- | --- | --- | --- |
| `CB_ENV` | `production` | logger (`includeStack`) | anything outside `production\|staging\|development\|test` → `CB_ENV is invalid` |
| `CB_BIND` | `127.0.0.1:8787` | `parseBind` | not `host:port` → `CB_BIND is invalid` |
| `CB_LOG_LEVEL` | `info` | `createLogger` | not one of the five levels → `CB_LOG_LEVEL is invalid` |
| `CB_INSTANCE_NAME` | `cb-instance` | logger base, `daemon.json` | — |
| `CB_COMMIT` | `null` | `BuildInfo.commit` | — |
| `CB_STATE_DIR` | `/var/lib/codebox` | `resolvePaths`, disk probe | uncreatable → `state_dir_failed`, exit 1 |
| `CB_TMP_DIR` | `/var/tmp/codebox` | `resolvePaths.tmpDir` | — |
| `CB_INSTALL_DIR` | `/opt/codebox` | `appDir` = `<CB_INSTALL_DIR>/app` | — |
| `CB_SESSION_SECRET` | — (required, min 32 chars) | nothing yet; validated | missing → `CB_SESSION_SECRET is required`; present and short → `CB_SESSION_SECRET is invalid` |
| `CB_OPENCODE_URL` | `http://127.0.0.1:4096` | opencode probe | — |
| `CB_OPENCODE_HEALTH_PATH` | `/api/info` | opencode probe | — |
| `CB_MAX_CONCURRENCY` | `2` | `queue.maxConcurrency` | — |

There is no feature-flag environment key: `SubsystemFlags` is a constructor argument
(`DEFAULT_SUBSYSTEM_FLAGS` at boot, an explicit object in tests). A `CB_*` flag cannot be
added without a contracts change.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing
else is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
    This is the first check: it proves `package-lock.json` matches `apps/daemon/package.json`.
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; includes the `apps/daemon` project.
  - `npm run build` — `tsc -b` and the app build when this task touches it (it does not).
  - `npx playwright test` — not applicable, this task has no web flow.
  - `git diff --name-only main...task-11` — audit against the exclusive paths.
    `.agent_specs/task-11.md` is **excluded** from that audit: the pipeline force-adds the
    spec as the branch's first commit and strips it again in the merge to `main`, so it is
    never part of the task's content. Every other path in the diff must be on the list.
  - Every command runs from the worktree root with **no** `CB_*` variable exported. Nothing
    here needs `/var/lib/codebox`, `/etc/codebox/instance.env`, port 8787, `codebox.service`
    or a real credential.

- **Acceptance criteria:** every one tagged **`[unit]`** (a headless command, a decoded value,
  a pinned number) or **`[live]`** (only exists in the running system: a stream, a push, a
  tunnel, a UI state). A `[live]` criterion states its **measurement** — what to read, on which
  surface, against which bound.

  - [ ] `[unit]` It typechecks, lints and builds clean:
        `npm run lint && npm run build` exits 0.
  - [ ] `[unit]` The declared tests exist and pass: `npm test` exits 0 and
        `npx vitest run --project apps/daemon` reports eight test files
        (`config`, `logger`, `modules`, `health`, `boot`, `static`, `app`, `start`).
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-11 | grep -v '^\.agent_specs/'` lists only paths
        from the list above, and
        `git diff --name-only main...task-11 -- '*.md' | grep -v '^\.agent_specs/'` is exactly
        `apps/daemon/README.md`.
  - [ ] `[unit]` **The daemon's tests run before the build.** Command:
        `rm -rf packages/*/dist apps/*/dist && npm test` exits 0 and reports the
        `apps/daemon` project as passed. This is the proof that the `@codebox/*` alias in
        `vitest.config.ts` works and that no test depends on a stale `dist`; run it once
        before `npm run build` on a clean worktree. A failure here means the alias is missing
        or a value import escaped it.
  - [ ] `[unit]` **A missing required env fails fast with the key name and no secret in the
        message.** Command: `npx vitest run --project apps/daemon -t 'config'`. The test calls
        `runMain({ env: {}, io })` and expects: the returned code is `1`; exactly one line is
        written; it parses as JSON with `level: "fatal"` and `msg: "config_invalid"`; `missing`
        contains `CB_SESSION_SECRET`; `messages` contains `CB_SESSION_SECRET is required`. Then
        with `env: { CB_SESSION_SECRET: 'too-short' }`: code `1`, `invalid` contains
        `CB_SESSION_SECRET`, `messages` contains `CB_SESSION_SECRET is invalid`, and the
        literal `too-short` appears in **no** line. Then with a valid env plus an unknown key
        `CB_NOPE=1`: code `1` and `messages` contains `CB_NOPE is not a known configuration
        key`. `loadConfig({})` on its own throws `ContractParseError` and never exits.
  - [ ] `[unit]` **`/v1/health` reports db, opencode and disk.** In `health.test.ts`:
        `collectHealth` with injected probes returns an object that passes `parseHealth`,
        carries `db`, `opencode` and `disk` (`{freeBytes, totalBytes, usedPercent}`), and
        `aggregateStatus` returns `down` when db is down, `degraded` when only opencode is
        down, `ok` when everything is ok. In `app.test.ts`:
        `createApp({ context, probes })` with `db: 'ok'`, `opencode: 'down'`, `disk: 'ok'`
        answers `GET /v1/health` with HTTP `200` and `status: 'degraded'`, and answers `503`
        with `status: 'down'` when the db probe answers `'down'`. Command:
        `npx vitest run --project apps/daemon -t health`.
  - [ ] `[unit]` **Boot reconciliation marks a fake running run failed once.**
        In `boot.test.ts`: create a repo and a `running` run through the store, call
        `reconcile` → `failedRuns` is `[thatId]`, the run's state is `failed`, its
        `failureCode` is `orphaned`, `store.events.readRunAfterSeq(id, 0, 10)` holds exactly
        one `run.failed` event that passes `runFailedDataSchema`; call `reconcile` again →
        `failedRuns` is `[]` and the event count is still one.
  - [ ] `[live]` **`npm start` serves the health endpoint and the built app on the configured
        port.** Measurement, in a single shell block:
        ```bash
        ROOT=$(mktemp -d); mkdir -p "$ROOT/install/app"
        printf '<!doctype html><title>cb</title>' > "$ROOT/install/app/index.html"
        npm run build
        CB_ENV=test CB_SESSION_SECRET=0123456789abcdef0123456789abcdef \
        CB_STATE_DIR="$ROOT/state" CB_INSTALL_DIR="$ROOT/install" \
        CB_BIND=127.0.0.1:0 node apps/daemon/dist/main.js > "$ROOT/out.log" 2>&1 &
        PID=$!
        for i in $(seq 1 100); do [ -f "$ROOT/state/daemon.json" ] && break; sleep 0.1; done
        PORT=$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$ROOT/state/daemon.json','utf8')).port))")
        curl -fsS "http://127.0.0.1:$PORT/v1/health"; echo
        curl -fsS "http://127.0.0.1:$PORT/v1/version"; echo
        curl -fsS "http://127.0.0.1:$PORT/" | cmp - "$ROOT/install/app/index.html"; echo "app=$?"
        curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$PORT/v1/nope"
        kill -TERM $PID; wait $PID; echo "exit=$?"
        ```
        Bound and surface: `/v1/health` is `200` with `"db":"ok"` and a `disk` object holding
        `freeBytes`, `totalBytes` and `usedPercent`; `/v1/version` is `200` with `node`
        starting `v24.` and `version` `0.0.0`; the `cmp` prints `app=0` (the fixture
        `index.html` is served byte for byte); the unknown route prints `404`; `kill -TERM`
        makes the process exit `0` within 5 s and `$ROOT/state/daemon.json` is gone.
        `$PID` must be the daemon process itself: `npm start` adds a wrapper that swallows
        the signal, so the block launches `node apps/daemon/dist/main.js` — the exact command
        `npm start` resolves to — and signals that PID. A `143` exit or a surviving process
        means the signal reached the wrapper, not the daemon, and is not a pass. The
        fixture directory stands in for the built Angular app, which this task does not
        produce; the path (`<CB_INSTALL_DIR>/app`) is the contract Task-18/20 fill. If the run
        cannot be executed on this host, QA reports it `not run` with the literal error and the
        Orchestrator opens an `agent-review` issue; the merge does not wait.

Additional `[unit]` evidence this task owes:

  - [ ] `[unit]` The dependency set is exactly the allowed one:
        `node -e "const p=require('./apps/daemon/package.json');console.log(JSON.stringify(p.dependencies))"`
        prints those five and only those five entries; no version starts with `^` or `~`.
  - [ ] `[unit]` No pipeline key leaked into the daemon:
        `! grep -R "CB_AGENT_" apps/daemon` exits 0.
  - [ ] `[unit]` `apps/daemon/README.md` maps every file added (one line per file, no exported
        names), per `AGENTS.md`.
  - [ ] `[unit]` `npx vitest run --project apps/daemon -t static` covers traversal:
        `resolveStaticPath(root, p)` returns `null` for `/../package.json`,
        `/%2e%2e/package.json`, `/a/../../etc/passwd` and a path containing `%00`, and the
        same paths requested through `createApp` answer `404` with `code: "not_found"`.
        The encoded form `/a/%2e%2e/%2e%2e/etc/passwd` is part of that set: `app.ts` inspects
        the raw request target before WHATWG normalisation collapses its dot-segments, so the
        SPA fallback never answers a traversal attempt with `index.html`. A `200` there is a
        fail even though no file leaves the root.

## 📣 Coordination

- **For the Architect:** `docs/api.md` §5.1 does not pin the HTTP status of `/v1/health`; this
  spec freezes `200` for `ok|degraded` and `503` for `down`, with the same body. A later task
  that wants "always 200" must change this spec, `docs/api.md` and the app together.
  `docs/providers.md` §15 pins exit code `1` for a config failure, so this task uses `1`
  rather than `78`; the literal message for a missing key is `<KEY> is required` to match the
  table in §15.
- **For the Architect — one path outside the brief's box:** `vitest.config.ts` gains a
  `@codebox/*` → `packages/*/src/index.ts` regex alias **on the `apps/daemon` project only**.
  Without it the daemon cannot value-import `@codebox/contracts|store|security` during
  `npm test`, because the gate tests before it builds and each package's `exports` points at
  `./dist/…`. That is verbatim the constraint `packages/store/src/mappers.ts` records for the
  type-only imports. The alternative — duplicating schemas in the daemon, or reordering the
  gate in `ci.yml` — is worse, and both are outside this task. The edit is additive, scoped to
  one project, and no other task in the batch holds the file.
- **For every later daemon task:** value imports from `@codebox/*` are now fine in both the
  build and the tests; do not re-declare a contract enum in `apps/daemon`.
- **For the next batch (12, 13, 14, 15, 16, 17, 27, 35):** add `apps/daemon/src/<name>/index.ts`
  exporting `createModule(context: DaemonContext): DaemonModule`, with `<name>` one of
  `auth, chat, events, run, gate, jobs, runs, push, routines, telemetry, cli`. Nothing else is
  needed: `main.ts` already lists those paths, and `register(app, context)` receives the typed
  `DaemonApp`, so `c.get('requestId')` works. Use `context.shutdown.register(name, hook)` for
  timers and children. A route that is not `GET /v1/health` or `GET /v1/version` must be
  registered by a module, not in `app.ts`.
- **For Task-12 (auth):** the request-id middleware runs first and every route can read
  `c.get('requestId')`; the error envelope helper is `errorBody({code, message, requestId,
  details?})` in `app.ts`.
- **For Task-15 and Task-27:** `queue.pending` counts at most `PAGINATION_MAX_LIMIT` (200)
  queued runs through `store.runs.list`. When `store` gains a `countByState`, replace
  `createProbes`' queue probe; the shape does not change.
- **For Task-29:** `BuildInfo.builtAt` is `null` until the release artifact supplies it; the
  field is already in `/v1/version`.
- **For QA:** the `[live]` block runs the root `npm run build` first (the daemon's `tsc` needs
  `packages/*/dist` for its `@codebox/*` types); the daemon project's own `test` script is
  `cd ../.. && vitest run --project apps/daemon` and is only a convenience — the root
  `npm test` is the gate.

## ⛔ Out of scope

- No new dependency outside the five named ones; no `zod` in `apps/daemon`.
- No new or changed `CB_*` key, no edit to `packages/contracts`, `docs/api.md`,
  `docs/architecture.md`, `docs/providers.md`, `TODO.md`, `CHANGELOG.md`, `docs/decisions.md`,
  `tsconfig.base.json`, `eslint.config.js` or the root `package.json`.
- In `vitest.config.ts`, only the `apps/daemon` project may change, and only by gaining the
  `@codebox/*` alias: no other project, no `include`, no `passWithNoTests`, no project list.
- No authentication, no SSE endpoint, no chat, no run engine, no scheduler wiring, no OpenCode
  client, no push, no CLI and no telemetry route: only the two public routes and the extension
  surface they will register on.
- No subsystem directory (`src/auth/`, `src/chat/`, …) may be created, not even empty: an
  absent module is a supported state and the test covers it.
- No process supervision (systemd), no logger transport, no log file writer, no metrics.
- No refactor of a file this task did not have to touch.

# Spec: Task-27 — Observability and cost

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package + daemon (pure domain math + HTTP + a timer + filesystem).
- **Role:** Dev.
- **Objective:** `GET /v1/telemetry?range=` answers the `Telemetry` resource of
  `docs/api.md` §5.1 with a real spend, run counts, disk and queue depth, and the daemon runs a
  retention pass that deletes exactly the expired rows and log directories named in
  `docs/security.md` §8. The dashboard's spend card (`apps/app/src/app/features/dashboard`)
  already calls this route and currently gets a 404; after this task it renders a number, and
  `cb doctor`'s `cost` check stops reporting `missing_route`.
- **Environment:** worktree `../wt-cb-27`, branch `task-27`, base `main`.
- **Dependencies:** Task-04 (`@codebox/store` repositories, `StoreError`, `events.pruneBefore`),
  Task-11 (`apps/daemon/src/modules.ts` module seam, `DaemonContext`, `src/health.ts` probes).
  Both are merged. This task adds no dependency to any `package.json`.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path. Removing a stray `.gitkeep` from a directory this task populates is
allowed.

- `packages/core/src/usage.ts` (new)
- `packages/core/src/usage.test.ts` (new)
- `packages/core/src/index.ts` (add the `usage` export block only)
- `packages/core/README.md`
- `packages/store/src/runs.ts`
- `packages/store/src/runs.test.ts`
- `packages/store/src/chats.ts`
- `packages/store/src/approvals.ts`
- `packages/store/src/repositories.test.ts`
- `apps/daemon/src/telemetry/README.md` (new)
- `apps/daemon/src/telemetry/index.ts` (new)
- `apps/daemon/src/telemetry/service.ts` (new)
- `apps/daemon/src/telemetry/routes.ts` (new)
- `apps/daemon/src/telemetry/retention.ts` (new)
- `apps/daemon/src/telemetry/service.test.ts` (new)
- `apps/daemon/src/telemetry/routes.test.ts` (new)
- `apps/daemon/src/telemetry/retention.test.ts` (new)
- `docs/operations.md` (section: §11 Cost, including a new `### 11.1 Telemetry`)

**Do not touch** `apps/daemon/README.md` (the `src/telemetry/` folder carries its own README),
`apps/daemon/src/main.ts` or `apps/daemon/src/modules.ts` (`telemetry` is already in
`SubsystemName`, `SUBSYSTEMS` and `DEFAULT_SUBSYSTEM_FLAGS`, and `loadModules` imports
`./telemetry/index.js` by convention), `packages/contracts/src/**` (the `Telemetry` schema and
`TELEMETRY_RANGES` already exist and must not change), `apps/app/**`, `apps/daemon/src/app.ts`
and `docs/api.md` §5.1.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/api.md` §5.1 (`Telemetry`, `/v1/telemetry`, the range table), §3 (error envelope), §4
- `docs/security.md` §8 (the retention table this task implements)
- `docs/operations.md` §8 and §11 (what /v1/telemetry is documented to answer)
- `packages/contracts/src/resources.ts` (`telemetrySchema`, `diskSchema`, `parseTelemetry`,
  `TELEMETRY_RANGES`), `packages/contracts/src/primitives.ts` (`timestampSchema`, `RUN_STATES`)
- `packages/store/src/store.ts`, `src/usage.ts`, `src/events.ts`, `src/runs.ts`, `src/chats.ts`,
  `src/approvals.ts`, `src/mappers.ts`, `src/errors.ts`
- `packages/core/src/index.ts`, `src/limits.ts` (style), `src/cron.ts` (the `formatInstant`
  convention)
- `apps/daemon/src/modules.ts`, `src/health.ts`, `src/config.ts`, `src/logger.ts`
- `apps/daemon/src/push/index.ts` (the module + timer pattern), `src/push/service.ts`
- `apps/daemon/src/runs/errors.ts` (`json`, `handle`, `queryInput`), `src/jobs/routes.ts`
- `apps/daemon/src/start.test.ts`, `src/modules.test.ts` (the boot contract this module joins)
- `apps/app/src/app/features/dashboard/dashboard.api.ts` (the caller whose URL is frozen)
- `apps/daemon/src/cli/doctor.ts` (the consumer of the response; read only, never edit)

## 🔒 Contract

### `@codebox/core` — `src/usage.ts`

Pure: no clock, no I/O, no environment, and no `@codebox/store` import — `packages/core` has
no `dependencies`, so this module defines the window and entry shapes structurally.

```ts
export const USAGE_RANGES = ['1h', '24h', '7d', '30d'] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

/** 3_600_000, 86_400_000, 604_800_000, 2_592_000_000. */
export const RANGE_MILLISECONDS: Readonly<Record<UsageRange, number>>;

export interface UsageWindow {
  readonly since: string; // ISO 8601 UTC, inclusive
  readonly until: string; // ISO 8601 UTC, inclusive
}

export interface UsageEntry {
  readonly runId: string | null;
  readonly day: string; // YYYY-MM-DD UTC
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
  readonly createdAt: string; // ISO 8601 UTC
}

export interface UsageSummary {
  readonly spendUsd: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly runs: number; // distinct non-null runId
}

export function usageWindow(range: UsageRange, now: Date): UsageWindow;
export function utcDayOf(instant: string): string;
export function daysInWindow(window: UsageWindow): readonly string[];
export function summariseUsage(
  entries: readonly UsageEntry[],
  window: UsageWindow,
): UsageSummary;
```

Rules, all pinned by tests:

- `usageWindow(range, now)` → `since = new Date(now.getTime() - RANGE_MILLISECONDS[range]).toISOString()`,
  `until = now.toISOString()`. Millisecond precision is kept (`.000Z`), like every other
  daemon timestamp.
- `utcDayOf(instant)` → the first ten characters of the ISO string (`YYYY-MM-DD`). It must not
  use the local time zone.
- `daysInWindow(window)` → every UTC day from `utcDayOf(since)` to `utcDayOf(until)`
  **inclusive**, ascending. A 24 h window that starts at 23:30 therefore yields two days.
- `summariseUsage` keeps an entry when `createdAt >= window.since && createdAt <= window.until`,
  compares the ISO strings lexicographically (all inputs are `Z`), sums `tokensIn`,
  `tokensOut` and `costUsd`, counts distinct non-null `runId` as `runs`, and returns
  `spendUsd` rounded to six decimals: `Math.round(sum * 1e6) / 1e6`.
- `USAGE_RANGES` must stay equal to `TELEMETRY_RANGES` from `@codebox/contracts`; the daemon
  test asserts the two lists are equal element by element, so the duplication cannot drift.

Export the module from `packages/core/src/index.ts` as one block, after the limits block:

```ts
// Usage: the telemetry window and its in-range summary.
export { USAGE_RANGES, RANGE_MILLISECONDS, usageWindow, utcDayOf, daysInWindow, summariseUsage } from './usage.js';
export type { UsageRange, UsageWindow, UsageEntry, UsageSummary } from './usage.js';
```

### `@codebox/store` — four repository methods over three files

`packages/store/src/runs.ts`:

```ts
export interface RunRepository {
  // ... existing methods unchanged ...
  /** Counts runs whose `created_at` is in [since, until], by state; every key is present. */
  countByState(filter: { readonly since: string; readonly until: string }):
    Readonly<Record<RunState, number>>;
  /** Deletes terminal runs finished before `cutoff`; returns the number of rows removed. */
  pruneBefore(cutoff: string): number;
}
```

- `countByState`: `SELECT state, COUNT(*) AS n FROM runs WHERE created_at >= ? AND created_at <= ? GROUP BY state`,
  folded into an object with every member of `RUN_STATES` present and `0` when absent. `runs.ts`
  must add `RUN_STATES` to its value import from `@codebox/contracts` (today it imports types
  only).
- `pruneBefore`: `DELETE FROM runs WHERE finished_at IS NOT NULL AND finished_at < ?`, return
  `Number(result.changes)`. A live run has `finished_at = NULL` and is never deleted. The
  delete relies on the shipped foreign keys: `run_events.run_id` and `approvals.run_id` are
  `ON DELETE CASCADE`, `usage.run_id` is `ON DELETE SET NULL`.

`packages/store/src/chats.ts`:

```ts
  /** Deletes archived sessions untouched since `cutoff`; messages cascade. */
  pruneArchivedBefore(cutoff: string): number;
```

`DELETE FROM chat_sessions WHERE status = 'archived' AND updated_at < ?`.

`packages/store/src/approvals.ts`:

```ts
  /** Deletes resolved or expired approvals created before `cutoff`; a pending one is kept. */
  pruneResolvedBefore(cutoff: string): number;
```

`DELETE FROM approvals WHERE state <> 'pending' AND created_at < ?`.

All three return `Number(result.changes)` and throw nothing on zero rows.

### `apps/daemon/src/telemetry`

`index.ts` exports exactly `createModule(context: DaemonContext): DaemonModule` (the seam
already frozen in `modules.ts`) and, for tests, `createTelemetryService` re-exported from
`service.ts`.

`service.ts`:

```ts
export const TELEMETRY_DEFAULT_RANGE = '24h';
export const RETENTION_INTERVAL_MS = 21_600_000; // six hours
export const RETENTION_FIRST_DELAY_MS = 60_000;

export interface RetentionReport {
  readonly runs: number;
  readonly events: number;
  readonly chats: number;
  readonly approvals: number;
  readonly logDirectories: number;
}

export interface CreateTelemetryServiceOptions {
  readonly context: DaemonContext;
  /** Defaults to `createProbes(context)`; a test injects disk and queue. */
  readonly probes?: Pick<HealthProbes, 'disk' | 'queue'>;
  readonly now?: () => Date;
  readonly retentionIntervalMs?: number;
  readonly firstDelayMs?: number;
  /** Defaults to `join(context.config.CB_STATE_DIR, 'logs')`, where the run engine writes gate logs. */
  readonly logsDir?: string;
}

export interface TelemetryService {
  report(range: UsageRange): Promise<Telemetry>;
  retention(at?: Date): RetentionReport;
  start(): void;
  stop(): void;
}

export function createTelemetryService(options: CreateTelemetryServiceOptions): TelemetryService;
```

- `report(range)`:
  1. `const window = usageWindow(range, now())`.
  2. `const entries = daysInWindow(window).flatMap((day) => store.usage.listByDay(day))` and
     `summariseUsage(entries, window)`.
  3. `const counts = store.runs.countByState({ since: window.since, until: window.until })`.
  4. `const disk = await probes.disk()`; `const queue = probes.queue()`.
  5. Return `parseTelemetry({ range, since: window.since, spendUsd: summary.spendUsd, runs: { total, succeeded: counts.succeeded, failed: counts.failed, cancelled: counts.cancelled }, disk, queueDepth: queue.pending })`
     where `total` is the sum of every value of `counts`.
  A contract violation must throw: the route turns it into a 500 by letting it reach
  `app.onError`.
- `retention(at = now())` cuts off with `new Date(at.getTime() - days * 86_400_000).toISOString()`
  per table below and returns the five counts. Order matters and is fixed: **events, then
  approvals, then runs, then archived chats, then log directories**. The short windows
  (events 14 d, approvals 7 d) are applied before the 90 d run delete, because the run delete
  cascades `run_events` and `approvals` and would otherwise keep a 30-day-old event alive
  until its run is 90 days old. It never deletes a `usage` row — the ledger is the record of
  spend.
- `retention` logs one line: `logger.info({ msg: 'retention_done', runs, events, chats, approvals, logDirectories })`.
  A thrown repository or filesystem error is caught by `start()`'s timer wrapper and logged as
  `logger.error({ msg: 'retention_failed', err })`; `retention()` itself may throw.
- `start()` sets one timer to run `retention()` after `firstDelayMs`, then every
  `retentionIntervalMs`; the timer is `unref()`ed; a second `start()` is a no-op; `stop()`
  clears it and is idempotent.

`retention.ts`:

```ts
export interface RetentionCutoffs {
  readonly runs: string;
  readonly events: string;
  readonly chats: string;
  readonly approvals: string;
  readonly logs: string;
}
export function retentionCutoffs(at: Date, config: CodeboxConfig): RetentionCutoffs;
export function pruneLogDirectories(logsDir: string, before: string): number;
```

| Rows | Cutoff | Source |
| --- | --- | --- |
| runs | `at - CB_RETENTION_RUNS_DAYS` | terminal runs only |
| run events | `at - CB_RETENTION_EVENTS_DAYS` | `events.pruneBefore` |
| archived chats | `at - CB_RETENTION_CHAT_DAYS` | archived only |
| approvals | `at - CB_RETENTION_APPROVALS_DAYS` | not pending |
| log directories | `at - CB_RETENTION_LOGS_DAYS` | `logsDir/run-<runId>/` by mtime |

`pruneLogDirectories` reads the direct children of `logsDir`, keeps only directory names matching
`/^run-run_[0-9A-Za-z]{6,40}$/` (the run engine writes `<state>/logs/run-<runId>/gate.log`, so
the name is `run-` followed by the full `run_…` id), compares `statSync(entry).mtimeMs` with
`Date.parse(before)`, removes a stale directory with
`rmSync(entry, { recursive: true, force: true })`, returns the count, and returns `0` when
`logsDir` does not exist. It must never follow a symlink out of `logsDir` and never throw for
one unreadable entry (log a `warn` with `msg: 'retention_entry_failed'`).

`routes.ts`:

```ts
export function registerTelemetryRoutes(app: DaemonApp, service: TelemetryService): void;
```

- One route: `GET /v1/telemetry`, registered on `API_PREFIX` imported from `../app.js`, with the
  query parsed by
  `z.strictObject({ range: telemetryRangeSchema.default(TELEMETRY_DEFAULT_RANGE) })`.
- Use `queryInput(c, 'telemetry')` and `handle(c, 'telemetry', ...)` from `../runs/errors.js`,
  so a repeated key, an unknown key or a value outside `TELEMETRY_RANGES` is `422`
  `validation_failed` with `details.path` of the form `telemetry.range`.
- Success is `200` with the `Telemetry` object and
  `Content-Type: application/json; charset=utf-8`, through the `json` helper of
  `../runs/errors.js`.
- The auth middleware already requires `read` on every `GET /v1/*`; the route adds no scope
  check of its own.
- Failure surface: `422` for a bad range (code `validation_failed`), `401` from the
  middleware when the bearer is missing, `500` `internal` from `app.onError` when the read or
  the contract parse throws. No new log line on the success path (the request logger already
  records method, path, status and duration).

`index.ts` builds the service once, registers the routes in `register`, calls `start()`, and
registers `stop()` on `context.shutdown` through the returned `DaemonModule.shutdown` hook.
Building the service must perform no I/O: no probe, no query and no directory read at
`createModule` or at route registration.

### Data

- `Telemetry` is unchanged (`packages/contracts/src/resources.ts`). `since` is the inclusive
  start of the window, `spendUsd` the six-decimal sum, `runs.total` the sum over every state of
  `created_at` in the window, and `disk`/`queueDepth` come from the probes that already serve
  `/v1/health`.
- `RetentionReport` keys are the five counts above, in that order.

## 🧩 Configuration

No new `CB_*` key. This task reads, and must not redefine, the defaults already in
`packages/contracts/src/config.ts`:

| Key | Default | Used for |
| --- | --- | --- |
| `CB_RETENTION_RUNS_DAYS` | `90` | terminal runs |
| `CB_RETENTION_EVENTS_DAYS` | `14` | `run_events` |
| `CB_RETENTION_LOGS_DAYS` | `30` | `logs/run-run_*/` directories |
| `CB_RETENTION_CHAT_DAYS` | `90` | archived chat sessions |
| `CB_RETENTION_APPROVALS_DAYS` | `7` | non-pending approvals |
| `CB_STATE_DIR` | `/var/lib/codebox` | `logsDir = <state>/logs` |

`docs/providers.md` is unchanged.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; includes the tests this task adds.
  - `npm run build` — `tsc -b` and the app build, unchanged here but must stay green.
  - `npx vitest run --project packages/core --project packages/store --project apps/daemon`
  - `git diff --name-only main...task-27` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean.
  - [ ] `[unit]` `packages/core/src/usage.test.ts` pins `usageWindow` for all four ranges
        (a fixed `now` of `2026-10-25T12:00:00.000Z`), the inclusive `daysInWindow` across a
        midnight boundary, `utcDayOf` on a `23:30Z` instant, and `summariseUsage` discarding an
        entry one millisecond outside the window and rounding two rows of `0.1 + 0.2` to
        `0.3`.
  - [ ] `[unit]` `USAGE_RANGES` equals `TELEMETRY_RANGES` element by element (asserted in
        `apps/daemon/src/telemetry/service.test.ts`).
  - [ ] `[unit]` `store.runs.countByState` returns every `RUN_STATES` key with `0` for a state
        that has no row, and counts only rows whose `created_at` is inside the window.
  - [ ] `[unit]` `store.runs.pruneBefore` deletes a finished run and returns `1`, keeps a live
        run (`finished_at` null), and leaves the `usage` row of the deleted run with
        `run_id = NULL`.
  - [ ] `[unit]` `store.chats.pruneArchivedBefore` deletes an archived session and its
        messages, and keeps an idle one that predates the cutoff.
  - [ ] `[unit]` `store.approvals.pruneResolvedBefore` deletes a resolved approval, keeps a
        pending one, and returns `0` when nothing matches.
  - [ ] `[unit]` `GET /v1/telemetry?range=1h|24h|7d|30d` answers `200`, the body passes
        `telemetrySchema` (assert with `telemetrySchema.safeParse(...).success`), `since` equals
        the window start for that range, and `queueDepth` is the probe's pending count.
  - [ ] `[unit]` `GET /v1/telemetry` with no query uses `24h`; `?range=2d`, `?range=24h&range=1h`
        and `?rangexx=1h` answer `422` with `error.code = "validation_failed"` and
        `error.details.path` starting `telemetry.`.
  - [ ] `[unit]` `GET /v1/telemetry` without a bearer answers `401`; with a `read`-less device
        answers `403`.
  - [ ] `[unit]` `retention()` deletes exactly the expired rows of a fixture (one old finished
        run, one old event, one old archived chat, one old resolved approval, one fresh of
        each) and returns `{ runs: 1, events: 1, chats: 1, approvals: 1, logDirectories: 1 }`
        with a temp `logs/run-run_01JABCDEF/` directory older than the cutoff and no other
        directory touched.
  - [ ] `[unit]` The telemetry module loads through `loadModules` with `DEFAULT_SUBSYSTEM_FLAGS`
        and appears in `report.loaded`; `startDaemon` (`src/start.test.ts` style, temporary
        `CB_STATE_DIR`) still boots and stops, and `stop()` leaves no timer behind (the test
        calls `stop()` twice without throwing).
  - [ ] `[unit]` Nothing outside the exclusive paths was touched.
  - [ ] `[live]` On the reference VM, `curl -s -H "Authorization: Bearer $TOKEN" \
        'http://127.0.0.1:8787/v1/telemetry?range=24h'` reports a `spendUsd` within 5 % of
        `sqlite3 /var/lib/codebox/state.db "SELECT SUM(cost_usd) FROM usage WHERE created_at >=
        strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours')"`, and `/dashboard`'s spend card
        (`[data-testid="health-spend"]`) shows the same value. Report the two numbers.

## 📣 Coordination

- For the Architect: this task extends `packages/store` with `countByState`,
  `runs.pruneBefore`, `chats.pruneArchivedBefore` and `approvals.pruneResolvedBefore`. No other
  task in the batch reads `packages/store/**`; the additions are additive and no migration is
  needed.
- For the next batch: a run still in a live state is counted in `runs.total` and in none of
  `succeeded`/`failed`/`cancelled`, so a client must not assume the three add up to the total.
  The `telemetry` SSE event remains unemitted: nothing in the repo defines the
  `disk_low`/`cost_cap` discriminator `docs/jobs.md` §13 mentions, and this task does not
  invent one.
- For Task-23: the settings screen must not re-derive spend; `/v1/telemetry` is the only
  source.

## ⛔ Out of scope

- No new dependency outside the spec.
- No refactor of a file this task did not have to touch.
- No change to `docs/decisions.md` unless the task is the decision owner.
- No contract change: `telemetrySchema`, `TELEMETRY_RANGES` and `docs/api.md` §5.1/§3 are
  already correct.
- No retention of `usage` rows, bare-clone cache or worktrees (`cb prune` and the run engine
  own those), and no cleanup of any directory other than `<state>/logs/run_*/`.
- No `telemetry` SSE emission, no push, and no CLI change: `cb doctor` already reads the route
  and its `cost` check becomes measured without an edit.
- No UI change: the dashboard already calls `/v1/telemetry?range=24h`.

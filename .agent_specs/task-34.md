# Spec: Task-34 — Routine store and scheduler

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (`packages/store`, `packages/scheduler`) + docs.
- **Role:** Dev.
- **Objective:** persist chat routines and their fires in SQLite through a new numbered,
  forward-only migration, expose the repositories the daemon will call, and make the existing
  scheduler package fire routines through the same D13 rules it already applies to jobs — the
  claim on `(routine_id, scheduled_for)` is transactional and has exactly one winner, and the
  next fire is computed in the routine's IANA zone with the misfire grace.
- **Environment:** worktree `../wt-cb-34`, branch `task-34`, base `main`.
- **Dependencies:** Task-04 (merged): `packages/store`, migration `0001_init.sql`, `openStore`,
  `withTransaction`, the claim pattern in `runs.ts`. Task-09 (merged): `packages/scheduler`,
  `planTick`, `Schedule`, `SchedulerDeps`. Task-33 (merged): `packages/contracts/src/routines.ts`
  (`Routine`, `RoutineKind`, `RoutineId`, `parseRoutine`) and the three routine events. Task-05
  (merged): `@codebox/core` `parseCron`, `nextFire`, `isValidTimezone`, `resolveMisfire`.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path.

- `packages/store/migrations/0002_routines.sql`
- `packages/store/src/routines.ts`
- `packages/store/src/routine-fires.ts`
- `packages/store/src/mappers.ts` (add the routine and fire row mappers)
- `packages/store/src/store.ts` (add the two repositories to `Store`)
- `packages/store/src/index.ts`
- `packages/store/src/errors.ts` (the one new code) and `packages/store/src/db.ts` (the one new
  classifier) — touched only for that
- `packages/store/src/routines.test.ts`
- `packages/store/src/routine-fires.test.ts`
- `packages/store/src/store.test.ts` (only the assertions pinned to schema version 1: the five
  `expect(store.schemaVersion).toBe(1)`, `expect(rows).toHaveLength(1)` and
  `Number(applied?.['total'])).toBe(1)`)
- `packages/store/src/migrate.test.ts` (only `TABLES`, `INDEXES` and the pinned version numbers)
- `packages/store/README.md`
- `packages/scheduler/src/routines.ts`
- `packages/scheduler/src/index.ts`
- `packages/scheduler/src/index.test.ts` (only the frozen `public surface` export list:
  `fromUpdate`, `nextRoutineFire`, `planRoutineTick`, `toSchedule` join it)
- `packages/scheduler/src/routines.test.ts`
- `packages/scheduler/README.md`
- `docs/architecture.md` — **§2 `### packages/store` only** (the two routines table rows and
  the "planned" wording in the paragraph above the table). No other section.
- `docs/jobs.md` — **§15 only, and only by appending a new subsection at its end.** The
  existing sentences of §15 are not edited (Task-35 owns routine *execution* prose there).

`0001_init.sql` is **never** edited: it is applied on every existing database and the runner
pins its checksum.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/architecture.md` §2, `docs/jobs.md` §2 (scheduling) and §15 (routines),
  `docs/decisions.md` D13 and D38, `docs/api.md` §5.8 (the `/v1/routines` shapes).
- `packages/contracts/src/routines.ts`, `primitives.ts` (`ROUTINE_KINDS`, `RoutineId`),
  `events.ts` (`routineEventBase`, `routineFiredDataSchema`, `routineRepliedDataSchema`,
  `routineFailedDataSchema`), `pagination.ts` (`pageOfRoutine`).
- `packages/store/src/{index,store,db,errors,mappers,cursor,migrate,jobs,runs,repos,chats}.ts`,
  `packages/store/migrations/0001_init.sql`, `packages/store/src/{store,migrate,repositories}.test.ts`,
  `packages/store/README.md`, `packages/store/package.json`, `packages/store/tsconfig.json`.
- `packages/scheduler/src/{index,types,tick,resume,validate,clock}.ts` and the tests
  `tick-dst.test.ts`, `ordering.test.ts`, `index.test.ts`; `packages/scheduler/README.md`,
  `packages/scheduler/package.json`.
- `packages/core/src/{cron,misfire}.ts`, `packages/core/src/index.ts`.
- `vitest.config.ts`, `eslint.config.js`, `tsconfig.base.json`.

## 🔒 Contract

The public surface other tasks are written against **right now**. It is a promise, not a
suggestion.

### `packages/store/migrations/0002_routines.sql`

Header comment: why the file exists and that it is forward-only. Then, exactly:

```sql
CREATE TABLE routines (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('prompt', 'reminder')),
  title           TEXT NOT NULL,
  cron            TEXT NOT NULL,
  timezone        TEXT NOT NULL,
  enabled         INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  notify          INTEGER NOT NULL CHECK (notify IN (0, 1)),
  repo_id         TEXT REFERENCES repos(id) ON DELETE RESTRICT,
  prompt          TEXT,
  chat_session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
  next_fire_at    TEXT,
  last_fired_at   TEXT,
  created_at      TEXT NOT NULL,
  CHECK (kind <> 'prompt' OR (repo_id IS NOT NULL AND prompt IS NOT NULL AND prompt <> '')),
  CHECK (kind <> 'reminder' OR (repo_id IS NULL AND prompt IS NULL AND chat_session_id IS NULL))
);

CREATE TABLE routine_fires (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id    TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,
  fired_at      TEXT NOT NULL,
  outcome       TEXT NOT NULL CHECK (outcome IN ('claimed', 'sent', 'replied', 'failed', 'skipped')),
  detail        TEXT,
  UNIQUE (routine_id, scheduled_for)
);

CREATE INDEX routines_due            ON routines (enabled, next_fire_at);
CREATE INDEX routines_created        ON routines (created_at DESC, id DESC);
CREATE INDEX routine_fires_routine   ON routine_fires (routine_id, scheduled_for DESC);
```

- Ids and timestamps are caller-supplied `TEXT`; booleans are `INTEGER` 0/1; objects are JSON
  `TEXT` — the conventions `0001_init.sql` states in its header.
- `UNIQUE (routine_id, scheduled_for)` **is** the idempotency key of D38 and the only
  concurrency primitive in this task.
- A `reminder` carrying a `repo_id`, `prompt` or `chat_session_id` is refused by the CHECK, not
  only by the schema in `@codebox/contracts`.

### `packages/store/src/routines.ts`

```ts
import type { Routine, RoutineKind } from '@codebox/contracts';
import type { PageResult } from './cursor.js';

export interface RoutineFilter {
  readonly kind?: RoutineKind;
  readonly enabled?: boolean;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface RoutinePatch {
  readonly title?: string;
  readonly cron?: string;
  readonly timezone?: string;
  readonly prompt?: string;
  readonly notify?: boolean;
  readonly enabled?: boolean;
  readonly chatSessionId?: string | null;
  readonly nextFireAt?: string | null;
  readonly lastFiredAt?: string | null;
}

export interface RoutineRepository {
  get(id: string): Routine | null;
  list(filter: RoutineFilter): PageResult<Routine>;
  create(routine: Routine): Routine;
  update(id: string, patch: RoutinePatch): Routine;
  delete(id: string): void;
  setNextFire(id: string, nextFireAt: string | null): void;
  /** enabled = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= at, oldest first. */
  listDue(at: string, limit: number): Routine[];
}

export function createRoutineRepository(db: DatabaseSync): RoutineRepository;  // internal to the package
```

- `list` order: `created_at DESC, id DESC` with the `(createdAt, id)` cursor of `cursor.ts`,
  the same envelope `repos.list`/`jobs.list` return (`docs/api.md` §4, "newest first").
- `listDue` order: `next_fire_at ASC, created_at ASC, id ASC`, `LIMIT ?` — the same queue
  order as `jobs.listDue`.
- `create` maps a SQLite failure to a typed error: unique → `unique_violation`, foreign key →
  `foreign_key_violation`, CHECK → `check_violation`.
- `update` applies only the keys present in the patch (an explicit `undefined` means "leave
  it"); a `null` is written as `NULL`. Unknown id → `StoreError('not_found')`.
- `setNextFire` is `UPDATE routines SET next_fire_at = ? WHERE id = ?`; unknown id →
  `not_found`.
- A `reminder` row is mapped to the `reminderRoutineSchema` shape (no `repoId`, `prompt` or
  `chatSessionId` keys at all) and a `prompt` row to the `promptRoutineSchema` shape; the
  mapper returns a value that `parseRoutine` accepts. `Routine` has **no** `updatedAt`.
- `@codebox/contracts` stays a **type-only** import, exactly like every other file in this
  package (`mappers.ts` says why: a value import would need `packages/contracts/dist` during
  `npm test`). The kind and outcome literals are re-declared as local `as const` arrays, the
  way `mappers.ts` already re-declares `RUN_STATES`.

### `packages/store/src/routine-fires.ts`

```ts
import type { DatabaseSync } from 'node:sqlite';

export type RoutineFireOutcome = 'claimed' | 'sent' | 'replied' | 'failed' | 'skipped';

export interface RoutineFireRecord {
  readonly id: number;
  readonly routineId: string;
  readonly scheduledFor: string;
  readonly firedAt: string;
  readonly outcome: RoutineFireOutcome;
  readonly detail: string | null;
}

export interface ClaimRoutineFireInput {
  readonly routineId: string;
  readonly scheduledFor: string;
  readonly firedAt: string;
  readonly nextFireAt: string | null;
  readonly detail?: string | null;
}

export interface RoutineFireRepository {
  /** `null` when the routine is missing, disabled, already moved past `scheduledFor`, or the pair is taken. */
  claim(input: ClaimRoutineFireInput): RoutineFireRecord | null;
  /** Same guard, `outcome: 'skipped'`, and `last_fired_at` is left alone. */
  skip(input: ClaimRoutineFireInput): RoutineFireRecord | null;
  finish(
    fireId: number,
    outcome: Exclude<RoutineFireOutcome, 'claimed' | 'skipped'>,
    detail: string | null,
  ): RoutineFireRecord;
  get(id: number): RoutineFireRecord | null;
  getByScheduled(routineId: string, scheduledFor: string): RoutineFireRecord | null;
  listByRoutine(routineId: string, limit: number): RoutineFireRecord[];
  latest(routineId: string): RoutineFireRecord | null;
}

export function createRoutineFireRepository(db: DatabaseSync): RoutineFireRepository; // internal
```

- `claim`, in **one** `withTransaction(db, …)`:
  1. `SELECT enabled, next_fire_at FROM routines WHERE id = ?`; missing, `enabled <> 1`, or
     `next_fire_at !== input.scheduledFor` → `null` (the compare-and-set; a stale tick loses).
  2. `INSERT INTO routine_fires (routine_id, scheduled_for, fired_at, outcome, detail)` with
     `outcome = 'claimed'`; a UNIQUE violation → `null`, never an exception.
  3. `UPDATE routines SET next_fire_at = ?, last_fired_at = ? WHERE id = ?` with
     `input.nextFireAt` and `input.firedAt`.
- `skip` is the same transaction with `outcome = 'skipped'`, and its `UPDATE` sets
  `next_fire_at` only: a skipped fire never happened.
- `finish` sets `outcome` and `detail` on the row, `not_found` for an unknown id. It does not
  touch the routine.
- `listByRoutine` order: `scheduled_for DESC, id DESC`, `LIMIT ?`. `latest` is
  `ORDER BY scheduled_for DESC, id DESC LIMIT 1`.
- The outcome literal array is local (`as const`), not imported as a value.

### `packages/store/src/store.ts`, `index.ts`, `errors.ts`, `db.ts`

```ts
// store.ts
export interface Store {
  readonly db: DatabaseSync;
  readonly schemaVersion: number;
  readonly repos: RepoRepository;
  readonly jobs: JobRepository;
  readonly runs: RunRepository;
  readonly events: EventRepository;
  readonly approvals: ApprovalRepository;
  readonly chats: ChatRepository;
  readonly devices: DeviceRepository;
  readonly settings: SettingsRepository;
  readonly usage: UsageRepository;
  readonly routines: RoutineRepository;        // new
  readonly routineFires: RoutineFireRepository; // new
  close(): void;
}

// errors.ts
export type StoreErrorCode = /* the ten existing codes */ | 'check_violation';

// db.ts
export function isCheckViolation(error: unknown): boolean; // message includes 'CHECK constraint failed'

// index.ts (additions, grouped with the existing exports)
export type { RoutineFilter, RoutinePatch, RoutineRepository } from './routines.js';
export type {
  RoutineFireOutcome,
  RoutineFireRecord,
  ClaimRoutineFireInput,
  RoutineFireRepository,
} from './routine-fires.js';
export { isCheckViolation } from './db.js';
```

- Both repositories are constructed in `openStore` from the same `db` handle, in the same
  object literal that builds the other nine.
- `index.ts` keeps the existing grouping and comments; the new names go in the two right
  groups (Repositories; Connection) rather than a new block at the bottom.

### `packages/scheduler/src/routines.ts`

```ts
import type { Routine } from '@codebox/contracts';
import type { NextFireUpdate, SchedulerDeps, Schedule } from './types.js';

export interface RoutineDue {
  readonly routineId: string;
  readonly scheduledFor: string;
  readonly ageSeconds: number;
}

export interface RoutineSkipped {
  readonly routineId: string;
  readonly scheduledFor: string;
  readonly ageSeconds: number;
  readonly reason: 'outside_grace' | 'no_next_fire';
}

export interface RoutineNextFire {
  readonly routineId: string;
  readonly nextFireAt: string | null;
}

export interface RoutineTickInput {
  readonly now: string;
  readonly routines: readonly Routine[];
  readonly graceSeconds: number;   // CB_MISFIRE_GRACE_SECONDS
  readonly limit: number;          // max claims per tick, >= 1
}

export interface RoutineTickPlan {
  readonly due: readonly RoutineDue[];
  readonly skipped: readonly RoutineSkipped[];
  readonly updates: readonly RoutineNextFire[];
}

/** The `Schedule` row the job path already speaks; `kind` is 'routine'. */
export function toSchedule(routine: Routine): Schedule;

export function fromUpdate(update: NextFireUpdate): RoutineNextFire;

/** `planTick` over the mapped rows: same order, same grace, same truncation. */
export function planRoutineTick(deps: SchedulerDeps, input: RoutineTickInput): RoutineTickPlan;

/** The first fire strictly after `after`, in the routine's zone; `null` for a bad cron or zone. */
export function nextRoutineFire(
  deps: SchedulerDeps,
  input: { readonly cron: string; readonly timezone: string; readonly after: string },
): string | null;
```

- `toSchedule` maps `{ kind: 'routine', ownerId: routine.id, cron, timezone, enabled,
  nextFireAt, createdAt }`.
- `planRoutineTick` delegates to `planTick(deps, { now, schedules: routines.map(toSchedule),
  graceSeconds, limit })` and maps `DueFire`/`SkippedFire`/`NextFireUpdate` back by
  `ownerId → routineId`. It asserts nothing about `kind`; the mapping is total by construction.
- `nextRoutineFire` is `planFires(deps, cron, timezone, after, 1)[0] ?? null` — reuse, do not
  reimplement the arithmetic.
- `index.ts` exports the new group under a `// Routines: the chat schedules of D38.` comment:

```ts
export { fromUpdate, nextRoutineFire, planRoutineTick, toSchedule } from './routines.js';
export type {
  RoutineDue, RoutineNextFire, RoutineSkipped, RoutineTickInput, RoutineTickPlan,
} from './routines.js';
```

- Purity: this package stays pure — no clock, no I/O, no environment, no timers. The daemon
  passes `now`, the rows and the grace.

### Data

| Key | Owner | Shape |
| --- | --- | --- |
| `routines.next_fire_at` | store | the fire not yet claimed; `NULL` means paused |
| `routines.last_fired_at` | store | set by a claim, **not** by a skip |
| `routine_fires.scheduled_for` | store | the `next_fire_at` value that was claimed |
| `routine_fires.outcome` | store | `claimed` → `sent`/`replied`/`failed` via `finish`, or `skipped` |
| `routines_due` index | migration | `(enabled, next_fire_at)` — the `listDue` path |
| claim key | scheduler + store | `(routine_id, scheduled_for)`, "exactly one winner" |

## 🧩 Configuration

**No `CB_*` key is added or read.** The grace arrives as an argument
(`CB_MISFIRE_GRACE_SECONDS`, default `900`, already in `CONFIG_DEFAULTS`); the tick interval
(`CB_SCHEDULER_TICK_SECONDS`, default `15`) belongs to the daemon and is untouched.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing
else is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`.
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; `npx vitest run --project packages/store` and
    `npx vitest run --project packages/scheduler` run one package each.
  - `npm run build` — `tsc -b`, and it must stay green: this task adds no dependency.
  - `npx playwright test` — not applicable, this task has no web flow.
  - `git diff --name-only main...task-34` — audit against the exclusive paths.
    `.agent_specs/task-34.md` is **excluded**: the pipeline force-adds the spec as the
    branch's first commit and strips it in the merge to `main`.
  - Every command runs with no `CB_*` variable set and no network; the tests use
    `openInMemoryStore()` or a file database under `os.tmpdir()`.

- **Acceptance criteria:** every one tagged **`[unit]`** (a headless command, a decoded value,
  a pinned number) or **`[live]`** (only exists in the running system: a stream, a push, a
  tunnel, a UI state). A `[live]` criterion states its **measurement** — what to read, on which
  surface, against which bound.

  - [ ] `[unit]` It typechecks, lints and builds clean: `npm run lint && npm run build` exits 0.
  - [ ] `[unit]` The declared tests exist and pass: `npm test` exits 0;
        `npx vitest run --project packages/store` reports `routines.test.ts` and
        `routine-fires.test.ts`; `npx vitest run --project packages/scheduler` reports
        `routines.test.ts`.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-34 | grep -v '^\.agent_specs/'` lists only paths
        from the list above, and
        `git diff --name-only main...task-34 -- packages/store/migrations/0001_init.sql`
        is empty.
  - [ ] `[unit]` **Migrations apply to an empty database and are idempotent.** In
        `migrate.test.ts` and `store.test.ts`: `loadMigrationsFromDisk(MIGRATIONS_DIRECTORY)`
        returns `[1, 2]` with names `0001_init.sql`, `0002_routines.sql`; the first
        `runMigrations` returns `currentVersion: 2`, the second returns `applied: []` and
        `currentVersion: 2`; `PRAGMA user_version` is `2`; `sqlite_master` contains `routines`
        and `routine_fires` and the three new indexes; tampering with `0002`'s checksum is
        refused with `migration_checksum`; `openStore({ path })` on the same file twice reports
        `schemaVersion === 2` both times. Command:
        `npx vitest run --project packages/store -t migration`.
  - [ ] `[unit]` **20 concurrent claims produce one winner.** In `routine-fires.test.ts`:
        create a repo-less `reminder` routine with `nextFireAt = '2026-10-25T08:00:00Z'` in a
        file database; open **20** `openStore({ path })` handles on that file; call
        `routineFires.claim({ routineId, scheduledFor: '2026-10-25T08:00:00Z', firedAt:
        '2026-10-25T08:00:02Z', nextFireAt: '2026-10-26T08:00:00Z' })` once on each; close all.
        Expectations: exactly one non-null result, its `outcome` is `'claimed'`; a fresh store
        reports `routineFires.listByRoutine(routineId, 10)` of length `1`; `routines.get(id)`
        has `nextFireAt === '2026-10-26T08:00:00Z'` and `lastFiredAt ===
        '2026-10-25T08:00:02Z'`. Also: claiming a disabled routine, a missing routine, or a
        routine whose `nextFireAt` already moved returns `null`.
  - [ ] `[unit]` **A DST transition in `Europe/Madrid` produces the expected next fire.**
        Through `planRoutineTick`, with the injected `CronEngine`/`MisfireResolver` from
        `@codebox/core` (import them in the test the way `tick-dst.test.ts` does), the pinned
        rows already used for jobs hold for a routine: `30 2 * * *` —
        `nextFireAt '2026-10-25T00:30:00Z'`, `now '2026-10-25T00:30:00Z'` is **due** and the
        single update is `nextFireAt '2026-10-26T01:30:00Z'` (CET); `nextFireAt
        '2027-03-28T00:30:00Z'`, `now '2027-03-28T00:30:00Z'` is **due** and the update is
        `'2027-03-28T01:00:00Z'` (the first valid instant after the spring-forward gap). Plus
        `nextRoutineFire({ cron: '0 8 * * *', timezone: 'Europe/Madrid', after:
        '2026-10-24T12:00:00Z' }) === '2026-10-25T07:00:00Z'`. Command:
        `npx vitest run --project packages/scheduler -t routine`.
  - [ ] `[unit]` **A missed fire inside the grace runs once and outside it is skipped.**
        Same two rows as `tick-dst.test.ts` with `graceSeconds: 900`: `now
        '2026-10-24T00:31:00Z'` (age 60 s) → `due` length 1, one update rolling to the next
        day; `now '2026-10-24T00:46:00Z'` (age 960 s) → `due` length 0, `skipped` length 1 with
        `reason: 'outside_grace'`, and exactly one `updates` entry (the fire is not retried).
        The same pair is then persisted through the store: `claim` then a second `claim` with
        the same `scheduledFor` returns `null`, and `skip` on an outside-grace fire writes one
        row with `outcome: 'skipped'` and leaves `lastFiredAt` `null`.
  - [ ] `[live]` Not applicable: this task ships no runtime surface, no stream and no route.
        The first measurable routine surface is Task-35's `[live]` criterion (a routine created
        in chat fires and answers in that session). QA records `not applicable` rather than
        inventing a measurement.

Additional `[unit]` evidence this task owes:

  - [ ] `[unit]` The CHECK constraints are real: inserting a `reminder` with a `repo_id`, a
        `prompt` routine with no `prompt`, and an empty `prompt` each raise
        `StoreError` with code `check_violation`.
  - [ ] `[unit]` A round trip preserves the discriminated union: a `prompt` routine with
        `chatSessionId: null` comes back with exactly the keys `promptRoutineSchema` declares,
        a `reminder` with exactly the keys `reminderRoutineSchema` declares, and both pass
        `parseRoutine`.
  - [ ] `[unit]` Deleting a routine cascades to its fires, and deleting a chat session nulls
        `routines.chat_session_id` without deleting the routine.
  - [ ] `[unit]` `packages/store/README.md` and `packages/scheduler/README.md` map every file
        added or renamed (one line per file, no exported names), per `AGENTS.md`.

## 📣 Coordination

- **For the Architect:** the search for a `[live]` criterion in Task-34's `TODO.md` line fails:
  the four `*Acceptance:*` items are all headless and no runtime surface exists until Task-35.
  This spec says so explicitly instead of inventing one. `docs/architecture.md` and
  `0001_init.sql` already name the migration `0002_routines.sql`, so the file name is frozen.
- **For the Architect — the two existing tests that this migration breaks, and the exact
  edit:** `packages/store/src/store.test.ts` pins `schemaVersion` to `1` in five places and
  asserts `schema_migrations` has one row and a `COUNT(*)` of `1`; `packages/store/src/
  migrate.test.ts` pins `files.map(version)` / `applied.map(version)` to `[1]`,
  `currentVersion` to `1`, `PRAGMA user_version` to `1`, and lists the ten tables and thirteen
  indexes. All of them move to `2` / `[1, 2]` / twelve tables / sixteen indexes, and
  `TABLES`/`INDEXES` gain `routines`, `routine_fires`, `routines_due`, `routines_created`,
  `routine_fires_routine`. Nothing else in those two files changes. Both are in this task's
  exclusive paths for exactly that reason.
- **For Task-35 (routine engine):** read a routine with `store.routines`, ask
  `planRoutineTick` once per tick (`context.clock()` gives `now`), then for each `due` entry
  `store.routineFires.claim({ routineId, scheduledFor, firedAt: now, nextFireAt })` where
  `nextFireAt` comes from `updates` for the same `routineId`; a `null` from `claim` means
  another tick or another process won and the fire must be skipped silently. For each
  `skipped` entry call `routineFires.skip(...)` and log the reason once. `finish(fireId,
  'sent' | 'replied' | 'failed', detail)` closes the row; the three SSE events
  (`routine.fired`, `routine.replied`, `routine.failed`) are emitted by the daemon, not here.
  `nextRoutineFire` is what a newly created routine uses to get its first `nextFireAt`.
- **For Task-36 (routines UI):** `routine_fires` is the "last result" surface;
  `latest(routineId)` is the cheapest read.
- **For Task-15/27 (`/v1/routines`):** `store.routines.list` uses the same `(createdAt, id)`
  cursor as every other list; `pageOfRoutine` already exists in `pagination.ts`.
- **For the next batch:** if routines need per-day cost attribution, that is a `usage` column
  and a third migration — not an edit to `0002`.

## ⛔ Out of scope

- No daemon code, no route, no SSE event emission, no chat tool, no timers: `apps/daemon/**` is
  Task-35's.
- No `packages/contracts` change: `Routine`, the tool schemas and the three events already
  exist and are read type-only.
- No `@codebox/core` change: `parseCron`, `nextFire`, `resolveMisfire` are reused, not rewritten.
- No edit to `0001_init.sql`, to `packages/scheduler/src/tick.ts`/`types.ts`/`resume.ts`, or to
  any store file that does not need it.
- No `CB_*` key, no `package.json` dependency, no SQL outside `packages/store`, no I/O inside
  `packages/scheduler` or `packages/core`.
- No `TODO.md`, `CHANGELOG.md`, `docs/decisions.md` or `docs/api.md` edit.
- No refactor of a file this task did not have to touch.

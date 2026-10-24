# Spec: Task-09 — Scheduler

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (pure logic; no clock, no filesystem, no network, no timers).
- **Role:** Dev.
- **Objective:** after this task, `@codebox/scheduler` is the one seam the daemon calls on
  every tick: it validates a job's cron and IANA zone, turns the due rows it is given into an
  ordered claim plan with the D13 grace decision and the *next* fire already recomputed from
  `now`, previews the next N fires for the app, and recomputes the next fire on resume so a
  pause never causes catch-up. The cron arithmetic itself stays in `@codebox/core` (Task-05)
  and is passed in as a `CronEngine`; this package adds no second parser and no clock.
- **Environment:** worktree `../wt-cb-09`, branch `task-09`, base `main`.
- **Dependencies (merged on `main`; read these, do not re-implement them):**
  - Task-03 — `packages/contracts/src/resources.ts` (`jobNextSchema` → `JobNext` =
    `{ fires: string[] }`), `packages/contracts/src/primitives.ts` (`cronSchema`,
    `timezoneSchema`, `timestampSchema`).
  - Task-05 — `packages/core/src/cron.ts` (`ParsedCron`, `CronParseResult`, `CronFailureCode`,
    `parseCron`, `nextFire`, `nextFires`, `isValidTimezone`),
    `packages/core/src/misfire.ts` (`MisfireDecision`, `MisfireCode`, `resolveMisfire`):
    their **types** are imported here, their **values** are injected.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `packages/scheduler/src/index.ts`
- `packages/scheduler/src/types.ts`
- `packages/scheduler/src/validate.ts`
- `packages/scheduler/src/tick.ts`
- `packages/scheduler/src/resume.ts`
- `packages/scheduler/src/clock.ts`
- `packages/scheduler/src/index.test.ts`
- `packages/scheduler/src/validate.test.ts`
- `packages/scheduler/src/tick.test.ts`
- `packages/scheduler/src/tick-dst.test.ts`
- `packages/scheduler/src/ordering.test.ts`
- `packages/scheduler/src/resume.test.ts`
- `packages/scheduler/src/clock.test.ts`
- `packages/scheduler/README.md`
- `docs/jobs.md` **(§2 "Scheduling" only — one writer; see the hard boundary below)**

### Inputs (read-only)

Beyond `AGENTS.md`:

- `docs/jobs.md` §1 (the job field table) and §2, `docs/decisions.md` (D13, D15, D38),
  `docs/providers.md` §8, `docs/architecture.md` §2 (`packages/scheduler`).
- `packages/core/src/{cron,misfire,index}.ts` and `packages/core/src/*.test.ts` (the pinned
  Madrid rows you must reproduce).
- `packages/contracts/src/{resources,primitives}.ts`
- `packages/store/src/jobs.ts` (`listDue(at, limit)`, `setNextFire(id, at)`) — the repository
  this plan feeds; **read-only**, do not edit.
- `packages/scheduler/{package.json,tsconfig.json,README.md}`
- `vitest.config.ts`, `tsconfig.base.json`, `eslint.config.js`

**Hard boundary on `docs/jobs.md`:** this task edits **§2 "Scheduling" and nothing else**.
§3 (lifecycle), §7 (guardrails) and §11 (probation) belong to Task-05 and are frozen; §6
("Commit, push and PR") belongs to Task-10 in this same batch. Do not renumber, do not touch
the front matter or §1, §4, §5, §8–§10, §12–§15. If a fact you need belongs to another
section, report it instead of editing it.

## 🔒 Contract

Frozen public surface, re-exported exactly once from `src/index.ts`, grouped by module, in
this order.

**Three constraints before you write a line:**

1. **No new npm dependency, no `package.json` / `tsconfig` edit.** No cron library: the maths
   is `@codebox/core`'s and it arrives as an injected `CronEngine`.
2. **Workspace imports are type-only.** `import type { … } from '@codebox/core'` only. The
   root gate runs `npm test` **before** `npm run build`, so `packages/core/dist` does not exist
   while tests run; a runtime import of `@codebox/core` in `src/**` would break the
   fresh-clone gate. Only `src/*.test.ts` may import core's source relatively
   (`../../core/src/cron.js`, `../../core/src/misfire.js`) to build the real engine for the
   table-driven tests; test files are excluded from `tsc`.
3. **No clock, no environment, no I/O.** `now` is always a string argument, `Date` is built
   only from it, `process.env` is never read, nothing is spawned, nothing is written. Ordering
   is total and deterministic for equal inputs. No timers: the daemon schedules the tick and
   this package only says how long until the next one.

```ts
// ---------- src/types.ts ----------
import type { CronParseResult, MisfireDecision, ParsedCron } from '@codebox/core';

/** The D13 cron arithmetic, supplied by the daemon from `@codebox/core`. */
export interface CronEngine {
  parse(expression: string): CronParseResult;
  nextFire(cron: ParsedCron, timezone: string, after: Date): Date | null;
  isValidTimezone(timezone: string): boolean;
}

/** `resolveMisfire` from `@codebox/core`, supplied by the daemon. */
export type MisfireResolver = (input: {
  readonly scheduledFor: string;
  readonly now: string;
  readonly graceSeconds: number;
}) => MisfireDecision;

export interface SchedulerDeps {
  readonly cron: CronEngine;
  readonly misfire: MisfireResolver;
}

export type ScheduleKind = 'job' | 'routine';

/** One schedulable row. `job` and `routine` share it so Task-34 reuses this package. */
export interface Schedule {
  readonly kind: ScheduleKind;
  readonly ownerId: string; // JobId or RoutineId
  readonly cron: string; // 5 fields
  readonly timezone: string; // IANA
  readonly enabled: boolean;
  readonly nextFireAt: string | null; // ISO 8601 UTC, the fire not yet claimed
  readonly createdAt: string; // ISO 8601, tie-breaker for the queue order
}

export interface DueFire {
  readonly kind: ScheduleKind;
  readonly ownerId: string;
  readonly scheduledFor: string; // the `nextFireAt` that was claimed
  readonly ageSeconds: number;
}

export interface SkippedFire {
  readonly kind: ScheduleKind;
  readonly ownerId: string;
  readonly scheduledFor: string;
  readonly ageSeconds: number;
  readonly reason: 'outside_grace' | 'no_next_fire';
}

export interface NextFireUpdate {
  readonly kind: ScheduleKind;
  readonly ownerId: string;
  readonly nextFireAt: string | null;
}

export interface TickInput {
  readonly now: string; // ISO 8601 UTC, the tick instant
  readonly schedules: readonly Schedule[];
  readonly graceSeconds: number; // CB_MISFIRE_GRACE_SECONDS
  readonly limit: number; // max claims per tick, >= 1
}

export interface TickPlan {
  readonly due: readonly DueFire[]; // ordered, ready to claim
  readonly skipped: readonly SkippedFire[]; // ordered, to log once
  readonly updates: readonly NextFireUpdate[]; // ordered, to persist with the claims
}

export interface ScheduleFields {
  readonly cron: string;
  readonly timezone: string;
}

export type ScheduleField = 'cron' | 'timezone';
export type ScheduleFailureCode = 'field_count' | 'range' | 'step' | 'syntax' | 'no_fire' | 'timezone';

export type ScheduleValidation =
  | { readonly ok: true; readonly nextFireAt: string }
  | {
      readonly ok: false;
      readonly field: ScheduleField;
      readonly code: ScheduleFailureCode;
      readonly message: string;
    };

// ---------- src/clock.ts ----------
export const SCHEDULER_TICK_SECONDS_DEFAULT = 15;
export const SCHEDULER_TICK_SECONDS_MIN = 15;
export const SCHEDULER_TICK_SECONDS_MAX = 30;

/** Milliseconds until the next epoch-aligned tick; 1 <= result <= tickSeconds * 1000. */
export function nextTickDelay(nowMs: number, tickSeconds: number): number;
/** Accepts an integer in [MIN, MAX]; anything else is out of contract. */
export function isTickSeconds(value: number): boolean;

// ---------- src/validate.ts ----------
export function validateSchedule(
  deps: SchedulerDeps,
  fields: ScheduleFields,
  after: string,
): ScheduleValidation;

// ---------- src/tick.ts ----------
export function planTick(deps: SchedulerDeps, input: TickInput): TickPlan;
/** Stable claim key: `${kind}:${ownerId}@${scheduledFor}`. */
export function claimKey(fire: Pick<DueFire, 'kind' | 'ownerId' | 'scheduledFor'>): string;
/** Next `count` fires as ISO strings; `[]` for an invalid cron or zone. 1 <= count <= 10. */
export function planFires(
  deps: SchedulerDeps,
  cron: string,
  timezone: string,
  after: string,
  count: number,
): readonly string[];

// ---------- src/resume.ts ----------
/** Resume: the next fire is computed from `now`, never from the missed `nextFireAt`. */
export function planResume(deps: SchedulerDeps, input: { readonly schedule: Schedule; readonly now: string }): NextFireUpdate;
/** Pause: `nextFireAt: null`, so `job.nextFireAt` is null in the API and in `listDue`. */
export function planPause(schedule: Schedule): NextFireUpdate;
```

### Rules the implementation must obey

- **Candidate:** a schedule is a candidate for a tick iff `enabled === true`,
  `nextFireAt !== null`, and `Date.parse(nextFireAt) <= Date.parse(now)`. A paused schedule is
  **never** due and is never reported: no `due` entry, no `skipped` entry, no `updates` entry.
- **Decision:** for a candidate, `decision = deps.misfire({ scheduledFor: nextFireAt, now,
  graceSeconds })`. `decision.run === true` (code `on_time`, i.e. `0 <= age < graceSeconds`)
  → `due`. Otherwise (code `outside_grace`) → `skipped` with
  `reason: 'outside_grace'`. `ageSeconds` is copied from the decision; this package never
  recomputes it.
- **Next fire is always recomputed from `now`.** For every candidate, first
  `next = deps.cron.nextFire(parsed, timezone, new Date(now))`, then:
  - `decision.run === true` and `next !== null` → `due` entry with
    `scheduledFor = nextFireAt`, plus one `NextFireUpdate` carrying `iso(next)`;
  - `decision.run === true` and `next === null` → `due` entry plus one `NextFireUpdate` with
    `nextFireAt: null` (the fire runs once and the schedule stops being selected);
  - `decision.run === false` and `next !== null` → `skipped` with `reason: 'outside_grace'`,
    plus one `NextFireUpdate` carrying `iso(next)`;
  - `decision.run === false` and `next === null` → `skipped` with `reason: 'no_next_fire'`,
    plus one `NextFireUpdate` with `nextFireAt: null`.

  Every candidate that survives into `due` (after `limit`, below) or into `skipped` ends in
  exactly one update, so a schedule can never be selected twice for the same `scheduledFor`,
  and no schedule can loop on a past `nextFireAt`. Never derive the next fire from
  `scheduledFor`: that is the catch-up storm D13 forbids.
- **Ordering** of `due` and of `skipped`: by `scheduledFor` ascending, then the schedule's
  `createdAt` ascending, then `ownerId` ascending. Tie-breaking must be total, so two runs of
  the same input are identical arrays.
- **Limit:** `limit` (integer ≥ 1) truncates `due` **after** sorting. `skipped` is never
  truncated. `updates` contains one entry per fire still in `due` (after truncation) plus one
  per `skipped` entry, in exactly that order: the truncated `due` list first, then `skipped`.
  A candidate dropped by `limit` therefore keeps its `nextFireAt` and is re-planned on the next
  tick — and if that tick lands outside the grace window it is skipped, logged once, which is
  the documented behaviour.
- **No catch-up:** at most one fire per schedule per tick, whatever the age. It is `due` or
  `skipped`, never both, never repeated inside one plan.
- **`validateSchedule`:** `field: 'cron'` with `code` copied from `deps.cron.parse`'s
  `CronFailureCode` (`field_count` / `range` / `step` / `syntax`); `field: 'timezone'`,
  `code: 'timezone'` when `deps.cron.isValidTimezone` is false; `code: 'no_fire'` when the
  expression parses, the zone is valid and `nextFire` returns `null` within the horizon.
  Success always carries `nextFireAt`: the next fire strictly after `after`, as ISO 8601 UTC
  with second precision.
- **`planFires`:** clamps `count` to `1..10`, returns `[]` (never throws) for an invalid cron
  or an unknown zone, and otherwise the next `count` fires strictly after `after`, each as ISO
  8601 UTC with second precision (`.toISOString().replace(/\.\d{3}Z$/, 'Z')`). This is the
  payload of `jobNextSchema` (`{ fires: string[] }`).
- **`nextTickDelay`:** ticks are epoch-aligned (`nowMs` modulo `tickSeconds * 1000`), so the
  delay is `tickMs - (nowMs % tickMs)`, and `tickMs` when the remainder is 0. Throws
  `RangeError` when `tickSeconds` is not an integer ≥ 1.
- **Determinism:** no `Math.random`, no `Date.now`, no locale-dependent formatting, no
  `Intl` call in this package (the zone work is core's).

### Data

- ISO 8601 UTC, second precision, everywhere (`toISOString().replace(/\.\d{3}Z$/, 'Z')`).
- `Schedule` mirrors the `jobs` row fields the scheduler needs: `cron`, `timezone`,
  `enabled`, `next_fire_at`, `created_at` (`packages/store/src/jobs.ts`). `kind` +
  `ownerId` are this package's addition so Task-34 can reuse the same plan for routines.
- `TickPlan` is the only value the daemon needs per tick: `due` → `runs.claimScheduledRun`
  (or `routine_fires` later), `skipped` → one log line each, `updates` → `jobs.setNextFire`
  in the same transaction as the claims.
- The claim key is `(kind, ownerId, scheduledFor)`; the uniqueness that makes a double tick
  harmless is the store's `UNIQUE(job_id, scheduled_for)` (Task-04), not a lock here.

## 🧩 Configuration

**This package adds no `CB_*` key and reads `process.env` never.** Existing keys arrive as
arguments:

| Key (`docs/providers.md`) | Argument | Default |
| --- | --- | --- |
| `CB_MISFIRE_GRACE_SECONDS` | `TickInput.graceSeconds` | `900` |
| `CB_SCHEDULER_TICK_SECONDS` | `nextTickDelay(nowMs, tickSeconds)` | `15` |
| `CB_TIMEZONE` | `Schedule.timezone` when a job has none | `Europe/Madrid` |
| `CB_MAX_CONCURRENCY` / `CB_MAX_CONCURRENCY_PER_REPO` | **not this package**: the engine refuses to start a run and leaves it `queued` | `2` / `1` |

An out-of-range `tickSeconds` (`< 15` or `> 30`) is logged by the daemon and clamped to the
default; the package exposes `isTickSeconds` for that check. No line is added to
`docs/providers.md`.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim from the task worktree `../wt-cb-09`.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless.
  - `npm run build`.
  - `npx vitest run --project packages/scheduler` — this package alone.
  - `git diff --name-only main...task-09` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `npm ci --prefer-offline --no-audit --no-fund && npm run lint && npm test && npm run build` exits 0.
  - [ ] `[unit]` `npx vitest run --project packages/scheduler` reports `0 failed` and at least
        35 passing tests across the seven `*.test.ts` files named above.
  - [ ] `[unit]` Next fire matches a table of known cases across DST:
        `npx vitest run --project packages/scheduler -t 'Madrid'` passes. The engine is built
        from core's source in the test
        (`import { isValidTimezone, nextFire, parseCron } from '../../core/src/cron.js'`,
        `import { resolveMisfire } from '../../core/src/misfire.js'`). Each row is a
        `Schedule` whose `nextFireAt` is the missed fire, with `graceSeconds = 900`, asserting
        `planTick(...).due.length` and `updates[0].nextFireAt` exactly:

        | cron | timezone | `nextFireAt` | `now` | due | expected `nextFireAt` |
        | --- | --- | --- | --- | --- | --- |
        | `30 2 * * *` | `Europe/Madrid` | `2026-10-24T00:30:00Z` | `2026-10-24T00:31:00Z` | yes | `2026-10-25T00:30:00Z` |
        | `30 2 * * *` | `Europe/Madrid` | `2026-10-24T00:30:00Z` | `2026-10-24T00:46:00Z` | no | `2026-10-25T00:30:00Z` |
        | `30 2 * * *` | `Europe/Madrid` | `2026-10-25T00:30:00Z` | `2026-10-25T00:30:00Z` | yes | `2026-10-26T01:30:00Z` |
        | `30 2 * * *` | `Europe/Madrid` | `2027-03-27T00:30:00Z` | `2027-03-27T00:30:00Z` | yes | `2027-03-28T01:00:00Z` |
        | `0 3 * * *` | `Europe/Madrid` | `2026-10-24T02:00:00Z` | `2026-10-24T02:00:00Z` | yes | `2026-10-25T02:00:00Z` |
        | `0 0 * * *` | `UTC` | `2026-10-25T00:00:00Z` | `2026-10-25T00:00:00Z` | yes | `2026-10-26T00:00:00Z` |

        These are `packages/core/src/cron.test.ts`'s pinned rows observed through `planTick`; if
        core's shipped behaviour differs, core wins — fix the row **and say so in the commit
        body**.
  - [ ] `[unit]` A missed fire inside the grace runs once, outside it is logged once and
        skipped: `npx vitest run --project packages/scheduler -t 'grace'` passes, covering
        `age 0` and `age 899` (due), `age 900` and `age 86 400` (skipped with
        `reason: 'outside_grace'`), and the case where the *same* schedule is planned, the
        `updates` are applied, and the next `planTick` at the same `now` returns no `due` and
        no `skipped` for it.
  - [ ] `[unit]` Two ticks in the same second claim one run:
        `npx vitest run --project packages/scheduler -t 'double tick'` passes, asserting
        `claimKey(planA.due[0]) === claimKey(planB.due[0])` for two `planTick` calls with the
        same `now`, and that after applying `planA.updates` a third call yields
        `due.length === 0`.
  - [ ] `[unit]` A paused job is never due: `npx vitest run --project packages/scheduler -t 'paused'`
        passes with `enabled: false` and `nextFireAt` in the past, asserting `due`, `skipped`
        and `updates` are all empty; `planPause` returns `{ nextFireAt: null }`; `planResume`
        from `now = '2026-10-25T09:00:00Z'` returns `2026-10-26T01:30:00Z` for a daily
        `30 2 * * *` Madrid schedule (never the missed `00:30`).
  - [ ] `[unit]` Ordering and the limit: `npx vitest run --project packages/scheduler -t 'ordering'`
        passes for three schedules ordered by `scheduledFor`, then `createdAt`, then
        `ownerId`, and for `limit: 2` asserting exactly two `due` entries, all three
        `skipped`-equivalent totals, and that `updates` covers only the two claimed plus the
        skipped ones.
  - [ ] `[unit]` Validation: `npx vitest run --project packages/scheduler -t 'validate'`
        passes — `'60 * * * *'` → `{field: 'cron', code: 'range'}`; `'@daily'` →
        `{field: 'cron', code: 'syntax'}`; `'* * * *'` → `{field: 'cron', code:
        'field_count'}`; `Mars/Olympus` → `{field: 'timezone', code: 'timezone'}`;
        `'0 0 30 2 *'` → `{field: 'cron', code: 'no_fire'}`; `'0 9 * * 1'` in
        `Europe/Madrid` after `2026-10-24T00:00:00Z` → `{ok: true, nextFireAt:
        '2026-10-26T08:00:00Z'}`.
  - [ ] `[unit]` `nextTickDelay` is pinned: `npx vitest run --project packages/scheduler -t 'tick'`
        passes for `(0, 15) → 15000`, `(1, 15) → 14999`, `(14999, 15) → 1`,
        `(15000, 15) → 15000`, and a `RangeError` for `0` and for `15.5`.
  - [ ] `[unit]` `planFires` produces `jobNextSchema`-shaped data: the test asserts
        `planFires(deps, '0 9 * * *', 'Europe/Madrid', '2026-10-24T00:00:00Z', 3)` equals
        `['2026-10-24T07:00:00Z', '2026-10-25T08:00:00Z', '2026-10-26T08:00:00Z']` and that
        `planFires` returns `[]` for `'x * * * *'` and for `Mars/Olympus`.
  - [ ] `[unit]` No runtime workspace import and no ambient clock:
        `git grep -nE "from '@codebox/(contracts|core)'" -- packages/scheduler/src | grep -v 'import type'`
        prints nothing; `git grep -nE 'process\.env|Date\.now\(|new Date\(\)|setTimeout|setInterval|Math\.random|Intl\.' -- packages/scheduler/src`
        prints nothing.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-09` lists only the 15 paths above, and
        `git diff main...task-09 -- docs/jobs.md` changes lines inside §2 only — §1 and §§3–15
        are byte-identical (`git diff -U0 main...task-09 -- docs/jobs.md` must not show a
        hunk header for any line of §3, §6, §7 or §11).
  - [ ] `[unit]` `packages/scheduler/README.md` maps every file added, one line per file.

There is **no `[live]` criterion**: every rule is a pure function of its arguments and is
pinned above with a fixed clock and a fixed zone.

## 📣 Coordination

- **For the Architect:** no new dependency and no `croner`/equivalent: the parser is Task-05's
  and arrives as `CronEngine`. `docs/architecture.md` §2 still names `croner or equivalent` —
  Task-09 must not edit that file; the next docs pass (Task-30) should drop the library name.
  `packages/scheduler` gains one forward-looking field pair (`kind`, `ownerId`) so Task-34
  reuses it unchanged.
- **For Task-11 / Task-14 (daemon):** construct the deps once —
  `{ cron: { parse: parseCron, nextFire, isValidTimezone }, misfire: resolveMisfire }` from
  `@codebox/core`. Per tick: `const { due, skipped, updates } = planTick(deps, { now: iso,
  schedules: store.jobs.listDue(now, limit).map(toSchedule), graceSeconds:
  config.CB_MISFIRE_GRACE_SECONDS, limit: config.CB_MAX_CONCURRENCY })`. Claim each `due` with
  `runs.claimScheduledRun({ …, scheduledFor: fire.scheduledFor })` and write the matching
  `updates` in the same transaction; log each `skipped` once at `warn` with
  `{ jobId, scheduledFor, reason }`. Schedule the next tick with
  `nextTickDelay(Date.now(), config.CB_SCHEDULER_TICK_SECONDS)`.
- **For Task-15 (`GET /v1/jobs/{id}/next`):** respond
  `{ fires: planFires(deps, job.cron, job.timezone, now, 5) }` — it already matches
  `jobNextSchema`.
- **For Task-34 (routine store and scheduler):** pass `kind: 'routine'` schedules with the
  same `Schedule` shape and key the claim on `(ownerId, scheduledFor)`; nothing in this
  package changes.
- **For QA of later batches:** the whole suite is table-driven with a fixed `now`; never
  sleep, never use the real clock.

## ⛔ Out of scope

- No cron parser, no timezone maths, no `Intl`, no library: core owns the arithmetic.
- No store, no SQL, no transaction, no log emission, no timer, no daemon route.
- No concurrency accounting, no queue depth, no run creation: the engine owns those.
- No routines table, no routine claim: Task-34.
- No edit to `docs/jobs.md` outside §2, and none to `docs/architecture.md`,
  `docs/providers.md`, `docs/decisions.md`, `packages/core/**` or `packages/contracts/**`.

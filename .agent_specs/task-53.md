# Spec: Task-53 — One recurring object: the schedule (D44, D46)

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package + store + daemon (pure rules, SQL, HTTP, timers). No UI.
- **Role:** Dev.
- **Objective:** after this task there is a **`Schedule`** object that the daemon owns end to
  end: a zod contract in `@codebox/contracts`, an additive `schedules` + `schedule_fires` pair
  of tables (migration `0004`), a repository in `@codebox/store`, the D46 loop as a pure
  function in `@codebox/scheduler`, and a `/v1/schedules` subsystem in the daemon that claims
  one fire at a time, survives a restart and never catches up a missed fire. `jobs` keeps
  working untouched: this task is **additive**, and `docs/jobs.md` says so explicitly.
- **Environment:** worktree `../wt-cb-53`, branch `task-53`, base `main` (`origin/main` @
  `c72dd61`).
- **Dependencies (all merged):**
  - Task-03 — `packages/contracts` (`zod` 4.6.7, `parseOrThrow`, `timestampSchema`,
    `cronSchema`, `timezoneSchema`, `repoPolicySchema`, `pageSchema`/`parsePage`).
  - Task-04 — `packages/store` (`openStore`, the numbered migration runner, `withTransaction`,
    `StoreError`, `encodeCursor`/`decodeCursor`).
  - Task-09 — `packages/scheduler` (`planTick`, `planFires`, `SchedulerDeps`, `ScheduleKind`).
  - Task-34/Task-35 — the `routines`/`routine_fires` pattern you copy: `packages/store/src/
    routines.ts`, `packages/store/src/routine-fires.ts`, `apps/daemon/src/routines/**`.
  - Task-44 — `CB_MAX_CONCURRENCY` = 3 and `planAdmission`; a schedule fire goes through the
    same admission as a run (`queueRun` → `queued`).
  - Task-51 — `chat_sessions.kind` exists (`0003_chat_scope.sql`), so a schedule fire may point
    at a chat.
  - Task-11 — `apps/daemon/src/modules.ts`: a subsystem is discovered by directory name.

### Exclusive paths (single writer)

Nothing outside this list. No other task in this batch claims any of these.

- `packages/contracts/src/primitives.ts`
- `packages/contracts/src/primitives.test.ts`
- `packages/contracts/src/resources.ts`
- `packages/contracts/src/resources.test.ts`
- `packages/contracts/src/index.ts` — **hot file; this task is its only holder in the batch.**
- `packages/scheduler/**` (whole package, including `src/index.ts`, `src/window.ts`, its tests
  and `README.md`)
- `packages/store/**` (whole package, including `migrations/0004_schedules.sql`, the two new
  repository files, `src/store.ts`, `src/index.ts`, `README.md` and the tests that pin the
  schema version)
- `apps/daemon/src/schedules/**` (new directory: `index.ts`, `service.ts`, `routes.ts`,
  `fire.ts`, their `.test.ts`)
- `apps/daemon/src/modules.ts`
- `apps/daemon/src/modules.test.ts`
- `docs/jobs.md` — **sections §1 (one added paragraph), §2 (one added bullet) and the new
  §16.** No other section of that file.

Explicitly **not** yours: `apps/app/**` (the app must keep compiling against the contract that
remains), `apps/daemon/src/jobs/**`, `apps/daemon/src/runs/**`, `apps/daemon/README.md`
(Task-58 writes it), `docs/api.md` (Task-58 owns it), `docs/providers.md`,
`packages/contracts/src/config.ts` (Task-58 owns it), `TODO.md`, `CHANGELOG.md`,
`docs/decisions.md`.

### Inputs (read-only)

Beyond `AGENTS.md`:

- `packages/contracts/src/resources.ts` (before you edit it), `primitives.ts`, `pagination.ts`,
  `parse.ts`
- `packages/store/migrations/0001_init.sql`, `0002_routines.sql`, `0003_chat_scope.sql`
- `packages/store/src/routines.ts`, `routine-fires.ts`, `mappers.ts`, `store.ts`, `index.ts`,
  `migrate.ts`
- `packages/scheduler/src/types.ts`, `tick.ts`, `routines.ts`, `index.ts`
- `packages/core/src/cron.ts` (`parseCron`, `nextFire`, `isValidTimezone`),
  `packages/core/src/misfire.ts`
- `apps/daemon/src/modules.ts`, `apps/daemon/src/jobs/service.ts` (`runNow` → `queueRun`),
  `apps/daemon/src/jobs/routes.ts` (route style), `apps/daemon/src/runs/errors.ts`
  (`RunApiError`, `handle`, `json`, `readJson`, `queryInput`, `requireScope`),
  `apps/daemon/src/runs/service.ts` (`queueRun`, `requireRepo`), `apps/daemon/src/routines/**`
  (the tick + claim pattern), `apps/daemon/src/chat/service.ts` + `index.ts`
  (`chatServiceFor`), `apps/daemon/src/events/notifier.ts`
- `docs/jobs.md` (§1, §2, §15), `docs/decisions.md` (D44, D46 only)

## 🔒 Contract

This is a promise. Exact names, exact shapes, no additions without amending this file.

### 1. `@codebox/contracts` (additive only)

`packages/contracts/src/primitives.ts`:

```ts
// ID_PREFIXES gains one entry, before `request`:
schedule: 'sch_',
// and, beside RoutineId:
export const ScheduleId = idSchema('schedule');
```

`packages/contracts/src/resources.ts`:

```ts
export const SCHEDULE_MODES = ['once', 'every', 'window'] as const;
export const scheduleModeSchema = z.enum(SCHEDULE_MODES);
export type ScheduleMode = z.infer<typeof scheduleModeSchema>;

export const SCHEDULE_FIRE_POLICIES = ['new_chat', 'continue'] as const;
export const scheduleFirePolicySchema = z.enum(SCHEDULE_FIRE_POLICIES);
export type ScheduleFirePolicy = z.infer<typeof scheduleFirePolicySchema>;

export const scheduleWindowTimeSchema: z.ZodString; // /^([01]\d|2[0-3]):[0-5]\d$/

export const scheduleSchema: z.ZodType<Schedule>;   // the object below, superRefined
export type Schedule = {
  id: string;                     // ScheduleId, `sch_…`
  repoId: string | null;          // RepoId, null = a chat schedule (D44)
  chatSessionId: string | null;   // ChatId, the chat a `continue` fire appends to
  title: string;                  // 1–120
  prompt: string;                 // 1–8000
  mode: ScheduleMode;
  cron: string | null;            // 5-field; null only for `window`
  timezone: string;               // IANA
  windowStart: string | null;     // 'HH:MM'; non-null only for `window`
  windowEnd: string | null;       // 'HH:MM'; non-null only for `window`
  cooldownMinutes: number;        // int >= 0
  maxFires: number | null;        // int >= 1
  maxCostPerFireUsd: number | null; // number >= 0
  firePolicy: ScheduleFirePolicy;
  consecutiveFailures: number;    // int >= 0
  firesCount: number;             // int >= 0
  spendUsd: number;               // number >= 0
  enabled: boolean;
  policy: 'auto' | 'manual';      // repoPolicySchema
  nextFireAt: string | null;      // ISO 8601 UTC, the fire not yet claimed
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const scheduleDetailSchema = z.strictObject({
  schedule: scheduleSchema,
  nextFires: z.array(timestampSchema), // up to 5 ISO instants, preview only
});
export type ScheduleDetail = z.infer<typeof scheduleDetailSchema>;

export function parseSchedule(input: unknown): Schedule;
export function parseScheduleDetail(input: unknown): ScheduleDetail;
```

The `superRefine` enforces exactly two rules and reports `path: ['mode']`:
`mode === 'window'` ⇒ `cron === null && windowStart !== null && windowEnd !== null &&
windowStart !== windowEnd`; otherwise ⇒ `cron !== null && windowStart === null &&
windowEnd === null`.

`packages/contracts/src/index.ts` re-exports, in the existing "Resources" block and in its type
block, exactly: `SCHEDULE_MODES`, `scheduleModeSchema`, `SCHEDULE_FIRE_POLICIES`,
`scheduleFirePolicySchema`, `scheduleWindowTimeSchema`, `scheduleSchema`,
`scheduleDetailSchema`, `parseSchedule`, `parseScheduleDetail`, and the types `Schedule`,
`ScheduleMode`, `ScheduleFirePolicy`, `ScheduleDetail`. `ScheduleId` joins the primitives block.
**Nothing existing is renamed or removed.** `pageOfSchedule` is **not** added: the daemon pages
with `parsePage(scheduleSchema, page, 'schedules')`.

### 2. `@codebox/scheduler` — the D46 loop (pure)

New file `packages/scheduler/src/window.ts`, no clock, no I/O, no environment; it receives every
instant as an argument:

```ts
export type ScheduleStopReason =
  | 'disabled'
  | 'failures'
  | 'max_fires'
  | 'max_cost'
  | 'window_closed'
  | 'no_next_fire';

export interface ScheduleFireContext {
  readonly mode: 'once' | 'every' | 'window';
  readonly timezone: string;
  readonly cron: string | null;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly cooldownMinutes: number;
  readonly maxFires: number | null;
  readonly maxCostPerFireUsd: number | null;
  readonly firesCount: number;
  readonly consecutiveFailures: number;
  readonly lastCostUsd: number;   // cost of the fire that just ended
  readonly finishedAt: string;    // ISO UTC, when that fire finished
  readonly enabled: boolean;
}

export interface ScheduleFirePlan {
  readonly nextFireAt: string | null;
  readonly stop: ScheduleStopReason | null;
  readonly skippedDstGap: boolean;
}

export function planNextFire(deps: SchedulerDeps, input: ScheduleFireContext): ScheduleFirePlan;

export function isInsideWindow(input: {
  readonly timezone: string;
  readonly windowStart: string; // 'HH:MM'
  readonly windowEnd: string;   // 'HH:MM', may be earlier than start (wraps midnight)
  readonly at: string;          // ISO UTC
}): boolean;

export function nextWindowOpen(input: {
  readonly timezone: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly after: string;       // ISO UTC
}): string | null;
```

`planNextFire` decides in this **exact order**, first match wins:

1. `!enabled` → `{ nextFireAt: null, stop: 'disabled', skippedDstGap: false }`.
2. `consecutiveFailures >= 3` → `{ null, 'failures', false }` (D46: three failures pause it).
3. `maxFires !== null && firesCount >= maxFires` → `{ null, 'max_fires', false }`.
4. `maxCostPerFireUsd !== null && lastCostUsd >= maxCostPerFireUsd` → `{ null, 'max_cost', false }`.
   (D46 bounds the loop by this cap; it is also handed to the run as its cost cap.)
5. `mode === 'once'` → `{ null, 'no_next_fire', false }`.
6. `mode === 'every'` → `deps.cron.nextFire(parsed, timezone, new Date(finishedAt))`; a null
   cron, an unparsable cron or a `nextFire` of `null` → `{ null, 'no_next_fire', false }`.
7. `mode === 'window'`:
   - `candidate = finishedAt + cooldownMinutes * 60000`.
   - Inside the window (`isInsideWindow`) → `{ nextFireAt: candidate, stop: null, skippedDstGap: false }`.
   - Otherwise `next = nextWindowOpen(after = candidate)`. `null` → `{ null, 'window_closed', false }`.
   - If the local wall clock of the window start does not exist that day (spring-forward gap),
     the fire is **skipped**: the result is the first valid instant after the gap and
     `skippedDstGap: true`. A wall clock that exists twice (fall-back) yields **one** instant,
     the first occurrence.

`isInsideWindow` is half-open `[start, end)` in the schedule's zone, with `start > end` meaning
it wraps midnight (`22:00`–`06:00`). `nextWindowOpen` returns the next instant strictly after
`after` at which the half-open window opens, in the same zone, `null` only when
`windowStart === windowEnd` (an always-empty window). Both functions use `Intl.DateTimeFormat`
with the IANA zone — never a fixed offset — and stay pure.

`packages/scheduler/src/index.ts` exports `planNextFire`, `isInsideWindow`, `nextWindowOpen`
and the types `ScheduleFireContext`, `ScheduleFirePlan`, `ScheduleStopReason`.

### 3. Store — migration `0004_schedules.sql` and two repositories

`packages/store/migrations/0004_schedules.sql` is forward-only and does **not** touch `jobs`,
`runs` or `chat_sessions`:

```sql
CREATE TABLE schedules (
  id                    TEXT PRIMARY KEY,
  repo_id               TEXT REFERENCES repos(id) ON DELETE RESTRICT,
  chat_session_id       TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL,
  prompt                TEXT NOT NULL,
  mode                  TEXT NOT NULL CHECK (mode IN ('once', 'every', 'window')),
  cron                  TEXT,
  timezone              TEXT NOT NULL,
  window_start          TEXT,
  window_end            TEXT,
  cooldown_minutes      INTEGER NOT NULL DEFAULT 0 CHECK (cooldown_minutes >= 0),
  max_fires             INTEGER CHECK (max_fires IS NULL OR max_fires >= 1),
  max_cost_per_fire_usd REAL CHECK (max_cost_per_fire_usd IS NULL OR max_cost_per_fire_usd >= 0),
  fire_policy           TEXT NOT NULL CHECK (fire_policy IN ('new_chat', 'continue')),
  consecutive_failures  INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  fires_count           INTEGER NOT NULL DEFAULT 0 CHECK (fires_count >= 0),
  spend_usd             REAL NOT NULL DEFAULT 0 CHECK (spend_usd >= 0),
  enabled               INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  policy                TEXT NOT NULL CHECK (policy IN ('auto', 'manual')),
  next_fire_at          TEXT,
  last_fired_at         TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  CHECK ((mode = 'window') = (cron IS NULL)),
  CHECK ((mode = 'window') = (window_start IS NOT NULL AND window_end IS NOT NULL)),
  CHECK (window_start IS NULL OR window_start <> window_end),
  CHECK (repo_id IS NOT NULL OR chat_session_id IS NOT NULL)
);

CREATE TABLE schedule_fires (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id   TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,
  fired_at      TEXT NOT NULL,
  outcome       TEXT NOT NULL CHECK (outcome IN ('claimed', 'fired', 'skipped', 'failed')),
  run_id        TEXT REFERENCES runs(id) ON DELETE SET NULL,
  chat_id       TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
  cost_usd      REAL NOT NULL DEFAULT 0,
  detail        TEXT,
  UNIQUE (schedule_id, scheduled_for)
);

CREATE INDEX schedules_due            ON schedules (enabled, next_fire_at);
CREATE INDEX schedules_repo           ON schedules (repo_id, created_at DESC);
CREATE INDEX schedule_fires_schedule  ON schedule_fires (schedule_id, fired_at DESC);
```

`packages/store/src/schedules.ts`:

```ts
export interface ScheduleFilter {
  readonly repoId?: string;
  readonly enabled?: boolean;
  readonly limit: number;
  readonly cursor: string | null;
}
export interface SchedulePatch {
  readonly title?: string;
  readonly prompt?: string;
  readonly mode?: 'once' | 'every' | 'window';
  readonly cron?: string | null;
  readonly timezone?: string;
  readonly windowStart?: string | null;
  readonly windowEnd?: string | null;
  readonly cooldownMinutes?: number;
  readonly maxFires?: number | null;
  readonly maxCostPerFireUsd?: number | null;
  readonly firePolicy?: 'new_chat' | 'continue';
  readonly chatSessionId?: string | null;
  readonly enabled?: boolean;
  readonly policy?: 'auto' | 'manual';
  readonly nextFireAt?: string | null;
  readonly lastFiredAt?: string | null;
}
export interface ScheduleRepository {
  get(id: string): Schedule | null;
  list(filter: ScheduleFilter): PageResult<Schedule>;
  create(schedule: Schedule): Schedule;
  update(id: string, patch: SchedulePatch): Schedule;
  delete(id: string): void;
  listDue(at: string, limit: number): Schedule[];
}
```

`packages/store/src/schedule-fires.ts`:

```ts
export interface ClaimScheduleFireInput {
  readonly scheduleId: string;
  readonly scheduledFor: string;   // the `next_fire_at` being claimed
  readonly firedAt: string;
  readonly nextFireAt: string | null;
}
export interface FinishScheduleFireInput {
  readonly outcome: 'fired' | 'failed';
  readonly costUsd: number;
  readonly runId: string | null;
  readonly chatId: string | null;
  readonly detail: string | null;
}
export interface ScheduleFireRepository {
  /** One transaction; `null` when the row lost the race (the schedule moved or is disabled). */
  claim(input: ClaimScheduleFireInput): ScheduleFireRecord | null;
  /** Like `claim` but records `skipped` and leaves `last_fired_at` alone. */
  skip(input: ClaimScheduleFireInput): ScheduleFireRecord | null;
  finish(fireId: number, input: FinishScheduleFireInput): ScheduleFireRecord;
  listBySchedule(scheduleId: string, limit: number): ScheduleFireRecord[];
}
export interface ScheduleFireRecord {
  readonly id: number;
  readonly scheduleId: string;
  readonly scheduledFor: string;
  readonly firedAt: string;
  readonly outcome: 'claimed' | 'fired' | 'skipped' | 'failed';
  readonly runId: string | null;
  readonly chatId: string | null;
  readonly costUsd: number;
  readonly detail: string | null;
}
```

`claim` must, in **one** `withTransaction`: re-read that the schedule is `enabled = 1` and its
`next_fire_at` still equals `scheduledFor`; insert the fire row as `claimed`; then
`UPDATE schedules SET next_fire_at = ?, last_fired_at = ?, fires_count = fires_count + 1,
updated_at = ? WHERE id = ?`. A `UNIQUE (schedule_id, scheduled_for)` violation returns `null`,
never throws. `skip` writes `skipped` and moves `next_fire_at` **without** touching
`last_fired_at` or `fires_count`. `finish` sets the outcome, `cost_usd`, `run_id`, `chat_id`,
`detail`, and adds to the schedule: `spend_usd = spend_usd + ?`, and
`consecutive_failures = CASE WHEN ? = 'failed' THEN consecutive_failures + 1 ELSE 0 END`.

`packages/store/src/store.ts` gains `readonly schedules: ScheduleRepository` and
`readonly scheduleFires: ScheduleFireRepository`, built in `openStore`.
`packages/store/src/index.ts` exports the four types of each file and `ScheduleFireRecord`.
`Schedule` comes from `@codebox/contracts` (type-only import, like `Job`).

### 4. Daemon — the `schedules` subsystem

`apps/daemon/src/schedules/index.ts` exports `createModule(context: DaemonContext):
DaemonModule` with `name: 'schedules'`; `register` mounts the routes **and** calls
`service.start()`; `shutdown` calls `service.stop()`.

`apps/daemon/src/schedules/service.ts`:

```ts
export interface ScheduleFirePort {
  startRun(input: {
    readonly schedule: Schedule;
    readonly scheduledFor: string;
    readonly costCapUsd: number | null;
  }): { readonly runId: string };
  startChat(input: {
    readonly schedule: Schedule;
    readonly scheduledFor: string;
  }): { readonly chatId: string; readonly messageId: string };
}

export interface ScheduleTickReport {
  readonly due: number;
  readonly fired: number;
  readonly skipped: number;
  readonly lost: number;
}

export interface CreateSchedulesServiceOptions {
  readonly context: DaemonContext;
  readonly now?: () => Date;
  readonly tickMs?: number;                 // default max(15, CB_SCHEDULER_TICK_SECONDS) * 1000
  readonly fire?: ScheduleFirePort;         // default: fire.ts
}

export interface SchedulesService {
  list(query: { repoId?: string; enabled?: boolean; limit: number; cursor: string | null }):
    PageResult<Schedule>;
  create(input: CreateScheduleInput): Schedule;
  get(id: string): ScheduleDetail;
  patch(id: string, patch: SchedulePatch): Schedule;
  remove(id: string): void;
  pause(id: string): Schedule;
  resume(id: string): Schedule;
  tick(at?: Date): Promise<ScheduleTickReport>;
  start(): void;
  stop(): void;
}

export interface CreateScheduleInput {
  readonly title: string;
  readonly prompt: string;
  readonly mode: 'once' | 'every' | 'window';
  readonly cron?: string | null;
  readonly timezone: string;
  readonly windowStart?: string | null;
  readonly windowEnd?: string | null;
  readonly cooldownMinutes?: number;
  readonly maxFires?: number | null;
  readonly maxCostPerFireUsd?: number | null;
  readonly firePolicy?: 'new_chat' | 'continue';
  readonly repoId?: string | null;
  readonly chatSessionId?: string | null;
  readonly policy?: 'auto' | 'manual';
}
```

`tick(at = now())` is one pass, non-overlapping (a second `tick` while one is running returns
`{ due: 0, fired: 0, skipped: 0, lost: 0 }`): read `store.schedules.listDue(at.toISOString(), 20)`,
and for each row apply the D13 grace rule with `resolveMisfire` from `@codebox/core` and
`CB_MISFIRE_GRACE_SECONDS` — inside the grace call `claim`, outside it call `skip` and log
`{ msg: 'schedule_fire_skipped', scheduleId, scheduledFor, reason: 'outside_grace' }` at
`info`. A lost claim logs `{ msg: 'schedule_fire_lost', scheduleId, scheduledFor }` at `warn`
and never throws. A `claim` for a row whose `repoId !== null` calls
`fire.startRun({ schedule, scheduledFor, costCapUsd: schedule.maxCostPerFireUsd })`; a row with
`repoId === null` calls `fire.startChat(...)`. The fire promise is tracked but never awaited by
`tick`; when it settles, `finish` records `fired` with the run's or chat's id, or `failed` with
`detail` = the failure code and logs `{ msg: 'schedule_fire_failed', scheduleId, code }` at
`error`. A `claimed` fire still open at `end` is allowed to finish: nothing cancels it.

`apps/daemon/src/schedules/fire.ts` supplies the default port: `startRun` calls `queueRun` with
`trigger: 'schedule'`, `jobId: null`, the schedule's repo, title, prompt, `CB_DEFAULT_AGENT`,
`CB_DEFAULT_MODEL` and `scheduledFor`; `startChat` appends one `origin: routine`-shaped message
to `schedule.chatSessionId` (creating a chat session when it is `null`) and starts the chat
turn, exactly as `apps/daemon/src/routines/service.ts` does. Both are reachable through the
same injected `fetch`-free seams those files use.

`apps/daemon/src/schedules/routes.ts` mounts, under `API_PREFIX`:

| Method | Path | Scope | Body | Success |
| --- | --- | --- | --- | --- |
| `GET` | `/v1/schedules` | (middleware `read`) | query `repoId?`, `enabled?=true\|false`, `limit?` 1–200 default 50, `cursor?` | `200` page of `Schedule` |
| `POST` | `/v1/schedules` | `write` | strict create body | `201` `Schedule` |
| `GET` | `/v1/schedules/{id}` | `read` | — | `200` `ScheduleDetail` |
| `PATCH` | `/v1/schedules/{id}` | `write` | strict patch body | `200` `Schedule` |
| `DELETE` | `/v1/schedules/{id}` | `write` | — | `204` |
| `POST` | `/v1/schedules/{id}/pause` | `write` | — | `200` `Schedule` |
| `POST` | `/v1/schedules/{id}/resume` | `write` | — | `200` `Schedule` |

Failures, all through `handle(c, 'schedules', …)` and `RunApiError`:
`404 not_found` with `details.path = 'schedule.id'`; `422 validation_failed` with
`details.path` one of `schedule.cron`, `schedule.timezone`, `schedule.windowStart`,
`schedule.windowEnd`, `schedule.repoId`, `schedule.chatSessionId` and `details.reason` the
machine token (`field_count`/`range`/`step`/`syntax`/`no_fire`/`timezone`, or `window`,
`repo_missing`, `repo_required`). Unknown body keys are a `422`, never a silent default.
`GET` is not scope-checked in the handler (the auth middleware covers `read`), every other
route calls `requireScope(c, 'write')`.

`nextFireAt` is never accepted from a client: `create` and every `patch` that changes `mode`,
`cron`, `timezone`, `windowStart`, `windowEnd`, `cooldownMinutes` or `enabled` recompute it from
`now`, and `enabled: false` stores `null`.

`apps/daemon/src/modules.ts` gains **two** subsystem names in all three places
(`SubsystemName`, `SUBSYSTEMS`, `DEFAULT_SUBSYSTEM_FLAGS`), in this order after `routines`:
`schedules`, `credentials`. `credentials` belongs to Task-58, which merges after you; an absent
module is a supported boot state (`module_absent`, logged at `info`), so listing it now is safe
and keeps that task out of this file. `apps/daemon/src/modules.test.ts` understands 13
subsystems.

## 🧩 Configuration

No new `CB_*` key. This task reads, and must not change the meaning of:
`CB_SCHEDULER_TICK_SECONDS` (default 15), `CB_MISFIRE_GRACE_SECONDS` (default 900),
`CB_TIMEZONE` (default `Europe/Madrid`), `CB_MAX_CONCURRENCY` (3, through `queueRun`).

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint` — must pass.
  - `npm test` — the root gate: `test:guard`, the app suite and every Vitest project.
  - `npm run build` — `tsc -b` for every workspace plus `ng build`; the app must still compile
    against the old contract plus your additive fields.
  - Targeted re-runs while developing: `npx vitest run --project packages/scheduler`,
    `npx vitest run --project packages/store`, `npx vitest run --project packages/contracts`,
    `npx vitest run --project apps/daemon`.
  - `git diff --name-only main...task-53` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `npm run lint && npm test && npm run build` pass.
  - [ ] `[unit]` `planNextFire` returns `2026-03-28T21:31:00Z` for a `window` schedule in
        `Europe/Madrid` (`22:00`–`06:00`, `cooldownMinutes: 20`) whose previous fire finished
        at `2026-03-28T21:11:00Z` — `T+31`, not `T+20`.
  - [ ] `[unit]` the spring-forward gap produces **zero** fires and never two: a `window`
        schedule in `Europe/Madrid` (`02:00`–`04:00`) whose candidate falls on
        `2026-03-29` returns `nextFireAt = 2026-03-29T01:00:00Z` with `skippedDstGap: true`,
        and a second call from that instant returns the next day, not a second fire.
  - [ ] `[unit]` the fall-back day (`2026-10-25`, `02:30` local exists twice) returns exactly
        one instant, `2026-10-25T00:30:00Z`.
  - [ ] `[unit]` `consecutiveFailures: 3` returns `stop: 'failures'` and `nextFireAt: null`;
        `firesCount === maxFires` returns `'max_fires'`; `lastCostUsd >= maxCostPerFireUsd`
        returns `'max_cost'`; each is a separate test.
  - [ ] `[unit]` `mode: 'once'` returns `'no_next_fire'` after one fire; `mode: 'every'`
        advances through `deps.cron.nextFire` from `finishedAt`.
  - [ ] `[unit]` `0004_schedules.sql` applies to an empty database, is idempotent on a second
        `openStore`, and `store.schemaVersion` is 4 (`packages/store/src/store.test.ts` and
        `migrate.test.ts` updated, not weakened).
  - [ ] `[unit]` 20 concurrent `scheduleFires.claim` calls for the same
        `(scheduleId, scheduledFor)` produce exactly one winner and 19 `null`s.
  - [ ] `[unit]` `finish(..., 'failed')` increments `consecutive_failures`; a `fired` resets it
        to 0; `spend_usd` accumulates both.
  - [ ] `[unit]` the seven routes answer `201/422/200/200/204/200/200` and `404`, checked with
        `app.request` against a fake `ScheduleFirePort`; a `GET /v1/schedules` body parses with
        `parsePage(scheduleSchema, …)`; an unknown body key is `422` with
        `details.path = 'schedule.<key>'`.
  - [ ] `[unit]` `git diff --name-only main...task-53` lists only files inside the exclusive
        paths; in particular nothing under `apps/app/**`, `apps/daemon/src/jobs/**`,
        `apps/daemon/src/runs/**`, `docs/api.md` or `packages/contracts/src/config.ts`.
  - [ ] `[unit]` the existing jobs suite (`apps/daemon/src/jobs/**`, `packages/store/src/
        jobs.*`) still passes untouched: the app and the old routes are unaffected.
  - [ ] `[live]` a window drains a repository overnight and every fire opens a PR: measured on
        the VM by a human (a seed schedule with `cooldownMinutes: 20`, `22:00`–`06:00`), read
        from `GET /v1/schedules/{id}` (`firesCount`, `spendUsd`, `lastFiredAt`) and the run
        list; recorded as `[?]` until then, never assumed.

## 📣 Coordination

- For the Architect: this ships the schedule object **additively**. D44's "retire `jobs`" is
  *stated, not executed*: the jobs routes, table and app screens keep working, and
  `docs/jobs.md` §1 carries one deprecation paragraph pointing at schedules. Removing `jobs`
  needs `apps/app/src/app/features/jobs/**`, `apps/daemon/src/jobs/**` and `runs.jobId`, which
  are not this batch.
- For Task-58 (same batch): `apps/daemon/src/modules.ts` already lists `credentials`; do not
  edit that file. `apps/daemon/README.md` is yours — add one line per file of
  `apps/daemon/src/schedules/**` in the same change:
  `src/schedules/index.ts` (the subsystem module: service, routes and the tick),
  `src/schedules/service.ts` (list/create/patch/pause and the one-pass tick),
  `src/schedules/routes.ts` (the `/v1/schedules` handlers and their body schemas),
  `src/schedules/fire.ts` (the default port: a run for a repo schedule, a chat turn otherwise).
- For the next batch (Task-61, Task-65): the app reads `Schedule` from `@codebox/contracts`,
  `GET /v1/schedules` (page), `GET /v1/schedules/{id}` (`{ schedule, nextFires }`) and the
  seven routes above. `docs/api.md` does **not** list them yet — Task-68 owns that doc plus
  `packages/contracts/src/openapi.ts`, because adding a route table there without the OpenAPI
  row fails `packages/contracts/src/openapi.test.ts`.
- For QA: `apps/app` must build untouched; a diff under it is a fail.

## ⛔ Out of scope

- No change to `jobs`, `runs`, `chat` or the app. No dependency migration, no dropdown.
- No new dependency. No new `CB_*` key.
- No `docs/api.md`, no `packages/contracts/src/openapi.ts`, no `docs/decisions.md`.
- No `apps/daemon/README.md` (Task-58 writes it), no `TODO.md`, no `CHANGELOG.md`.
- No `run now` route, no schedule editor, no UI, no SSE event for a schedule fire (a run
  already emits its own events; a chat fire emits the chat events).
- No catch-up of missed fires, no backfill, no rewrite of `0001`–`0003`.

## Turnstile (read this before you stop)

Work only inside `../wt-cb-53`. Never touch `main`. Commit everything you change. Run the gate
above. Then leave an empty commit on the branch tip with the exact subject
`dev: done task-53` and `git push origin task-53`. The branch is the durable unit: an
unpushed worktree is a lost task.

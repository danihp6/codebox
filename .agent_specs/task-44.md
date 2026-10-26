# Spec: Task-44 — Concurrency three

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (pure rules) + daemon (admission in the run engine) + contract
  (default value) + docs. No UI, no migration, no new route.
- **Role:** Dev.
- **Objective:** `CB_MAX_CONCURRENCY` defaults to **3** and rejects a non-positive value;
  `@codebox/core` exports the pure admission rule and `@codebox/scheduler` exports the pure
  waiting-list planner; the run engine consults them on every `start` and again whenever a run
  ends, so at most three runs are active, a second run on an already-running repository waits,
  and everything else stays in `queued` (never `failed`) in a deterministic repository-first
  order. D15, the `docs/jobs.md` concurrency bullet and the `docs/providers.md` table carry
  the new numbers.
- **Environment:** worktree `../wt-cb-44`, branch `task-44`, base `main`.
- **Dependencies:**
  - Task-03 — `packages/contracts/src/config.ts` (`CB_MAX_CONCURRENCY`, `intField`,
    `CONFIG_DEFAULTS`) and its tests.
  - Task-09 — `packages/scheduler/src/{index,types,tick}.ts` (`SchedulerDeps`, `planTick`) and
    its test style; this task adds a sibling module, it does not touch the tick.
  - Task-15 — `apps/daemon/src/run/{engine,ports}.ts` and `apps/daemon/src/runs/{service,engine}.ts`
    (the `queueRun` → `engine.start` seam the admission hooks into).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `packages/core/src/admission.ts` (new)
- `packages/core/src/admission.test.ts` (new)
- `packages/core/src/index.ts`
- `packages/core/README.md` — `src/` list: add the two files above.
- `packages/scheduler/src/admission.ts` (new)
- `packages/scheduler/src/admission.test.ts` (new)
- `packages/scheduler/src/index.ts`
- `packages/scheduler/src/index.test.ts`
- `packages/scheduler/README.md` — `src/` list: add the two files above.
- `packages/contracts/src/config.ts`
- `packages/contracts/src/config.test.ts`
- `apps/daemon/src/run/ports.ts`
- `apps/daemon/src/run/engine.ts`
- `apps/daemon/src/run/engine.test.ts`
- `apps/daemon/src/run/README.md` — the `engine.ts` line gains "admission".
- `apps/daemon/src/runs/engine.ts`
- `apps/daemon/src/runs/engine.test.ts`
- `apps/daemon/src/config.test.ts`
- `apps/daemon/src/health.test.ts`
- `apps/daemon/package.json`
- `package-lock.json` (**hot file, this task is the only holder in this batch**)
- `docs/jobs.md` — section: the **Concurrency** bullet of §2 only.
- `docs/providers.md` — section: §8 table, the `CB_MAX_CONCURRENCY` and
  `CB_MAX_CONCURRENCY_PER_REPO` rows only.
- `docs/decisions.md` — **hot file, this task is the only holder in this batch**. Sections: the
  **D15** row of the decision table, and the `CB_MAX_CONCURRENCY` /
  `CB_MAX_CONCURRENCY_PER_REPO` rows of the "Environment prefix and core values" table (those
  two rows *are* D15's frozen values).

The daemon files under `src/runs/` and the two daemon test files are added because the change
cannot otherwise be wired or kept green:
`apps/daemon/src/runs/engine.ts` is the only place that builds `RunSettings` from config, and
`apps/daemon/src/config.test.ts` / `apps/daemon/src/health.test.ts` pin the old default `2`.
They collide with no other task in this cycle.

### Inputs (read-only)

- `packages/core/src/limits.ts`, `packages/core/src/run-state.ts` — the pure-function style:
  exported interfaces, `readonly` fields, no clock, no I/O, typed result unions.
- `packages/scheduler/src/types.ts`, `packages/scheduler/src/tick.ts` — `planTick(deps, input)`
  is the shape to mirror: an injected dependency object plus an input, no runtime import of
  `@codebox/core`.
- `packages/scheduler/src/ordering.test.ts` — the ordering vocabulary already promised by
  `docs/jobs.md` ("`scheduled_for`, then `created_at`, then the job id").
- `apps/daemon/src/run/engine.ts` — the whole flow, `inflight`, `queue()`, `runFlow()`,
  `cancelRun()`, `active()`.
- `apps/daemon/src/runs/service.ts` — `queueRun()` creates the `queued` row *before*
  `engine.start`; the engine adopts that row, it does not create a second one.
- `docs/jobs.md` §2 and §3, `docs/decisions.md` D15, `docs/providers.md` §8.

## 🔒 Contract

Exact names and signatures. These are a promise: the daemon, the tests and the docs are
written against them.

### `@codebox/core` — `packages/core/src/admission.ts`

Pure. No clock, no environment, no filesystem, no network, no randomness, no imports beyond
types. Deterministic for equal input.

```ts
export interface AdmissionLimits {
  readonly maxConcurrency: number; // CB_MAX_CONCURRENCY, >= 1 by config
  readonly maxPerRepo: number; // CB_MAX_CONCURRENCY_PER_REPO, >= 1 by config
}

export interface ActiveRunRef {
  readonly runId: string;
  readonly repoId: string;
}

export type AdmissionCode = 'slots_full' | 'repo_busy';

export type AdmissionDecision =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly code: AdmissionCode };

export interface AdmissionQuery {
  readonly repoId: string;
  readonly active: readonly ActiveRunRef[];
  readonly limits: AdmissionLimits;
}

export function canAdmitRun(query: AdmissionQuery): AdmissionDecision;
```

Rules, in this order:

1. `active` entries whose `repoId` equals `query.repoId` are counted. If that count is
   `>= query.limits.maxPerRepo`, return `{ admitted: false, code: 'repo_busy' }`. The
   repository check runs **first**, so a busy repository never consumes a global slot and the
   reason is precise.
2. Otherwise, if `query.active.length >= query.limits.maxConcurrency`, return
   `{ admitted: false, code: 'slots_full' }`.
3. Otherwise `{ admitted: true }`.

No clamping and no throwing: a `maxConcurrency` of `0` returns `slots_full` for every query, a
`maxPerRepo` of `0` returns `repo_busy` for every query. Config rejects both; the function is
still total.

Re-export from `packages/core/src/index.ts`, in the existing grouped style:

```ts
// Admission: the D15 global and per-repository caps as a pure rule.
export { canAdmitRun } from './admission.js';
export type {
  ActiveRunRef,
  AdmissionCode,
  AdmissionDecision,
  AdmissionLimits,
  AdmissionQuery,
} from './admission.js';
```

### `@codebox/scheduler` — `packages/scheduler/src/admission.ts`

Pure. The rule arrives injected, exactly like `SchedulerDeps.cron` / `.misfire`, so the
package keeps building before `@codebox/core`'s `dist` exists (`import type` only).

```ts
import type {
  ActiveRunRef,
  AdmissionDecision,
  AdmissionLimits,
  AdmissionQuery,
} from '@codebox/core';

export interface WaitingRun {
  readonly runId: string;
  readonly repoId: string;
  readonly createdAt: string; // ISO 8601 UTC, the run row's created_at
}

export interface AdmissionInput {
  readonly active: readonly ActiveRunRef[];
  readonly waiting: readonly WaitingRun[];
  readonly limits: AdmissionLimits;
}

export interface AdmissionPlan {
  readonly admitted: readonly WaitingRun[]; // in the order they must start
  readonly waiting: readonly WaitingRun[]; // still queued, same deterministic order
}

export interface AdmissionDeps {
  readonly admit: (query: AdmissionQuery) => AdmissionDecision;
}

export function planAdmission(deps: AdmissionDeps, input: AdmissionInput): AdmissionPlan;
```

Algorithm, frozen:

1. Sort a copy of `input.waiting` by `repoId` (code-unit `<`), then `Date.parse(createdAt)`
   ascending, then `createdAt` (string, ties after a failed parse), then `runId` (code-unit
   `<`). This is the "repository order" of the TODO item: the repository id is the primary
   key, so two identical inputs always admit the same runs.
2. Start with `simulated = [...input.active]`. Walk the sorted list once. For each candidate
   call `deps.admit({ repoId: candidate.repoId, active: simulated, limits: input.limits })`:
   - admitted → append to `admitted` and to `simulated` (so the walk never over-fills either
     cap);
   - refused → append to `waiting`.
3. Return `{ admitted, waiting }`. `input.waiting` is never mutated; `input.active` is
   order-preserving in every query.

Re-export from `packages/scheduler/src/index.ts`:

```ts
// Admission: the D15 waiting list as a pure plan over the active runs.
export { planAdmission } from './admission.js';
export type { AdmissionDeps, AdmissionInput, AdmissionPlan, WaitingRun } from './admission.js';
```

`packages/scheduler/src/index.test.ts` pins the public surface exactly; add `planAdmission`
to that sorted list (types are not runtime exports).

### `apps/daemon/src/run/ports.ts`

`RunSettings` gains two required readonly fields:

```ts
readonly maxConcurrency: number; // config.CB_MAX_CONCURRENCY
readonly maxPerRepo: number; // config.CB_MAX_CONCURRENCY_PER_REPO
```

`RunEngine` is unchanged in signature, but `active()` gains a doc comment: *the ids of the
runs whose flow is running, in start order; a run waiting for a slot is not active.*

### `apps/daemon/src/run/engine.ts` — observable behaviour

The engine imports `{ canAdmitRun }` from `@codebox/core` and `{ planAdmission }` from
`@codebox/scheduler` and uses them as the only admission logic. Internal names are free; the
following is not.

1. **`start(input)`** — unchanged duplicate handling: a second call with a live `runId`
   returns the same promise, and a waiting `runId` is also found. The run row is ensured
   **before** any waiting: call the existing `queue(ctx)` first (`runFlow` no longer starts
   with it). `queue()` keeps its current semantics: it adopts a pre-existing `queued` row and
   emits nothing, or inserts the row and emits `run.queued`.
2. **Admission** — build the active list from the runs whose flow has started, call
   `canAdmitRun({ repoId: input.repo.id, active, limits: { maxConcurrency, maxPerRepo } })`
   from `settings`. Admitted → set the entry active **synchronously** and continue with the
   flow. Refused → park the entry as waiting and log at `info`:

   ```
   { "msg": "run_waiting", "runId": "<id>", "repoId": "<id>", "active": <n>, "maxConcurrency": <n> }
   ```

   Model it as `queue(ctx); await admission(ctx); runFlow(ctx)` inside the existing async
   wrapper: the existing `cancelled || timeoutExpired` guard that followed `queue` moves to
   just before `prepare`, so a run that waited still starts with a clean cancel check. The
   parked promise resolves only when that run starts and finishes, or when it is cancelled;
   nothing awaits it in production (`queueRun` fire-and-forgets).
3. **Re-plan on completion** — when any run's promise settles (succeeded, failed, cancelled,
   or a parked run cancelled), remove it from the active set and re-plan with
   `planAdmission({ admit: canAdmitRun }, { active, waiting, limits })`. Every returned
   `admitted` run starts in that order (resolve its admission waiter, once) and logs at
   `info`:

   ```
   { "msg": "run_admitted", "runId": "<id>", "repoId": "<id>" }
   ```

   Ordering on the row: the parked run's `createdAt` is read once from
   `store.runs.getRecord(runId).createdAt` after `queue(ctx)`.
4. **`active()`** — the ids whose flow is running, in start order. A waiting run is not
   listed and its row stays `state = 'queued'` with no new event.
5. **`cancel(runId, reason?)`** — a waiting run is cancellable: remove it from the waiting set
   first, then reuse `cancelRun(ctx, reason)` so it takes the normal
   `queued → cancelled` transition, appends `run.cancelled` with
   `{ state: 'cancelled', reason: 'operator' }`, and resolves its promise with
   `{ runId, state: 'cancelled', pr: null, gate: null, blockers: [], failure: null }`.
   Return `true`. An unknown id still returns `false`; a running id keeps today's behaviour.
6. **No HTTP, no event, no schema change.** `POST /v1/runs` and the jobs path still answer
   `202` with a `queued` row; the only new surface is the two log lines and the waiting state.
   A run that waits does not consume `CB_RUN_TIMEOUT_SECONDS` (the timer starts in
   `prepare`, when `startedAt` is set), and it never becomes `failed` for waiting.

### `apps/daemon/src/runs/engine.ts`

`createDaemonSettings` copies the two new fields from config:

```ts
maxConcurrency: config.CB_MAX_CONCURRENCY,
maxPerRepo: config.CB_MAX_CONCURRENCY_PER_REPO,
```

### Tests this change forces you to update

- `apps/daemon/src/run/engine.test.ts` — the harness `settings` literal needs
  `maxConcurrency` and `maxPerRepo`. The test `runs two runs at once and reports both as
  active` starts both runs on the same `repo_engine01`; with `maxPerRepo: 1` the second one
  must now wait. Seed a second repository in the harness store and give the second `runInput`
  a distinct `repo: { id: 'repo_engine02', … }` so the test keeps proving "two live runs". Do
  not lower `maxPerRepo` to keep the old shape.
- `apps/daemon/src/config.test.ts` — `config.CB_MAX_CONCURRENCY` is asserted as `2`; it
  becomes `3`.
- `apps/daemon/src/health.test.ts` — `queue.maxConcurrency` from a parsed config is asserted
  as `2`; it becomes `3`. Leave the hand-built config at `CB_MAX_CONCURRENCY: 0` alone: it is
  merged after parsing and keeps proving the `Math.max(1, …)` guard in `health.ts`.
- `apps/daemon/src/runs/engine.test.ts` — add the two new fields to the `toMatchObject`
  expectation of `copies every run setting from the CB_* configuration`.
- `packages/scheduler/src/index.test.ts` — add `planAdmission` to the sorted export list.

### Tests to add, with these exact titles (QA filters on them)

- `packages/core/src/admission.test.ts`
  - `refuses a busy repository before a full queue`
  - `admits while both limits have room`
  - `treats a zero limit as no room`
- `packages/scheduler/src/admission.test.ts`
  - `fills three slots in repository order`
  - `leaves the fourth run waiting`
  - `skips a busy repository and admits the next one`
  - `is deterministic for the same input`
- `apps/daemon/src/run/engine.test.ts`
  - `keeps the fourth run queued on three repositories`
  - `keeps a second run on a busy repository queued`
  - `starts the waiting run when a slot frees`
  - `cancels a queued run before it starts`
  - `admits waiting runs in repository order`
- `packages/contracts/src/config.test.ts`
  - `config rejects a zero concurrency`

### `packages/contracts/src/config.ts`

- `CONFIG_DEFAULTS.CB_MAX_CONCURRENCY` becomes `3`; `CB_MAX_CONCURRENCY_PER_REPO` stays `1`.
- Add one module-private helper next to `intField`:

  ```ts
  function positiveIntField(fallback: number): z.ZodType<number, string | undefined> {
    return z
      .string()
      .regex(/^[1-9]\d*$/, 'expected a positive integer')
      .default(String(fallback))
      .transform(Number);
  }
  ```

- `CB_MAX_CONCURRENCY: positiveIntField(3)` and
  `CB_MAX_CONCURRENCY_PER_REPO: positiveIntField(1)`. Every other key keeps `intField`.
- A rejected value keeps the existing error shape: `ContractParseError` with
  `path = 'config.CB_MAX_CONCURRENCY'` (or `config.CB_MAX_CONCURRENCY_PER_REPO`) and the zod
  regex message `expected a positive integer`. Neither key is a secret, so
  `parseConfig`'s redaction leaves the message alone.
- The exported type, `configKeyNames()`, `SECRET_CONFIG_KEYS` and the key count (76) are
  unchanged.

### `apps/daemon/package.json` and `package-lock.json`

The engine now value-imports `@codebox/scheduler`:

- add `"@codebox/scheduler": "0.0.0"` to `dependencies`;
- add `-w @codebox/scheduler` to the `prebuild` list (the root build runs `apps/*` before
  `packages/*`, so the daemon needs the package's `dist`);
- regenerate the lock with `npm install --package-lock-only --ignore-scripts` and confirm
  `npm ci --prefer-offline --no-audit --no-fund` succeeds from a clean tree.

### Docs (exact edits)

- `docs/jobs.md` — replace the Concurrency bullet under §2 with:

  > - **Concurrency:** at most `CB_MAX_CONCURRENCY_PER_REPO` (1) run per repository and
  >   `CB_MAX_CONCURRENCY` (3) runs globally; both must be at least 1. A run that cannot start
  >   stays `queued`; it does not fail. The rule is `canAdmitRun` in `@codebox/core` and the
  >   waiting list is `planAdmission` in `@codebox/scheduler`: the waiting runs are ordered by
  >   repository, then `created_at`, then the run id, so two identical ticks admit the same
  >   runs. A slot that frees goes to the first waiting run whose repository is free.

  Leave the rest of §2 and all of §3 untouched (`queued` already says "A slot and a worktree
  exist").
- `docs/providers.md` §8 — `CB_MAX_CONCURRENCY` default `3`, meaning
  `Global concurrent runs; 0 is rejected.`; `CB_MAX_CONCURRENCY_PER_REPO` default `1`, meaning
  `Per-repo concurrent runs; 0 is rejected.`
- `docs/decisions.md` — D15 row becomes:

  > | **D15** | Concurrency: **1 run per repository, 3 globally** (configurable down, never up
  > without a decision); both settings must be at least 1. | Sized for the 8 vCPU / 16 GB spot
  > floor: three repositories with their agent, build and Chromium run together and the fourth
  > waits in `queued`; two agents never fight over one repository. The measurement that
  > confirms the sizing is the bring-up of Task-46, recorded in `docs/aws.md`. |

  and the two frozen-value rows: `CB_MAX_CONCURRENCY` → `3`,
  `CB_MAX_CONCURRENCY_PER_REPO` → `1`.

### Data

| Key | Shape | Default |
| --- | --- | --- |
| `RunSettings.maxConcurrency` | `number` | `config.CB_MAX_CONCURRENCY` (3) |
| `RunSettings.maxPerRepo` | `number` | `config.CB_MAX_CONCURRENCY_PER_REPO` (1) |
| `AdmissionDecision.code` | `'slots_full' \| 'repo_busy'` | — |
| `AdmissionPlan.admitted` / `.waiting` | ordered `WaitingRun[]` | repository, then `created_at`, then run id |
| `run_waiting` log | `{ msg, runId, repoId, active, maxConcurrency }` | `info` |
| `run_admitted` log | `{ msg, runId, repoId }` | `info` |
| `active()` | admitted run ids, start order | excludes waiting runs |
| run row of a waiting run | `state = 'queued'`, no new event | unchanged `createdAt` |

## 🧩 Configuration

| Key | Default | Validation | Failure |
| --- | --- | --- | --- |
| `CB_MAX_CONCURRENCY` | `3` | `/^[1-9]\d*$/`, at least 1 | `ContractParseError`, path `config.CB_MAX_CONCURRENCY`, at boot, before any listener; the daemon exits non-zero naming the key and no value |
| `CB_MAX_CONCURRENCY_PER_REPO` | `1` | `/^[1-9]\d*$/`, at least 1 | same, path `config.CB_MAX_CONCURRENCY_PER_REPO` |

No new `CB_*` key and no new external dependency. The only package change is the workspace
link to `@codebox/scheduler`; `zod` and the other workspace packages are already listed.

## 🧪 Test and Validation Plan (for QA)

- **Method:** from the worktree root, on a cold tree:
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint` — must pass.
  - `npm test` — Vitest, all projects: `packages/contracts`, `packages/core`,
    `packages/scheduler`, `apps/daemon` (the daemon project aliases `@codebox/*` to
    `packages/*/src/index.ts`, so the new scheduler module resolves without its `dist`).
  - `npm run build` — `tsc` per workspace plus the Angular build. The daemon's `prebuild`
    must build `@codebox/scheduler` first, or this step fails.
  - `git diff --name-only main...task-44` — audit against the exclusive paths.
  - `git diff main...task-44 -- package-lock.json | head` — the lock must gain the scheduler
    link and no unexpected package.

- **Acceptance criteria:** every one tagged **`[unit]`** or **`[live]`**.
  - [ ] `[unit]` The default parses to 3 and rejects 0:
        `npx vitest run --project packages/contracts -t "config accepts documented defaults"`
        and `npx vitest run --project packages/contracts -t "config rejects a zero concurrency"`
        → each exit 0, `Tests  1 passed`; the first asserts
        `parseConfig(<dev env>).CB_MAX_CONCURRENCY === 3` and
        `.CB_MAX_CONCURRENCY_PER_REPO === 1`, the second asserts
        `firstPath(... CB_MAX_CONCURRENCY: '0') === 'config.CB_MAX_CONCURRENCY'` and the same
        for `'0'` on the per-repo key.
  - [ ] `[unit]` The core rule is pure and ordered:
        `npx vitest run --project packages/core -t "refuses a busy repository before a full queue"`
        → exit 0, `Tests  1 passed`; it asserts `repo_busy` wins over `slots_full`, that
        `admitted` is a fresh literal, and that the input arrays are untouched.
  - [ ] `[unit]` Three runs on three repos start and the fourth stays queued:
        `npx vitest run --project apps/daemon -t "keeps the fourth run queued on three repositories"`
        → exit 0, `Tests  1 passed`; with `maxConcurrency: 3, maxPerRepo: 1` and four runs on
        four repositories: `engine.active()` has length 3 and contains the first three run
        ids, `store.runs.getRecord(<fourth>).state === 'queued'`, and no `run.started` event
        exists for it.
  - [ ] `[unit]` Two runs on one repo are still refused:
        `npx vitest run --project apps/daemon -t "keeps a second run on a busy repository queued"`
        → exit 0, `Tests  1 passed`; one active run on repo A plus one waiting run on repo A:
        `engine.active()` has length 1, the second row is `queued`, and the log line is
        `run_waiting` (never `run_admitted`).
  - [ ] `[unit]` A freed slot starts the waiting run:
        `npx vitest run --project apps/daemon -t "starts the waiting run when a slot frees"`
        → exit 0, `Tests  1 passed`; after one active run reaches a terminal state the fourth
        run is active, its row leaves `queued`, and one `run_admitted` line exists for it.
  - [ ] `[unit]` A queued run cancels before it starts:
        `npx vitest run --project apps/daemon -t "cancels a queued run before it starts"`
        → exit 0, `Tests  1 passed`; `cancel()` resolves `true`, the row is `cancelled`, one
        `run.cancelled` event with `reason: 'operator'` exists, and no agent session was
        created.
  - [ ] `[unit]` The plan is repository-first and deterministic:
        `npx vitest run --project packages/scheduler -t "fills three slots in repository order"`
        → exit 0, `Tests  1 passed`; and
        `npx vitest run --project packages/scheduler -t "is deterministic for the same input"`
        → exit 0, `Tests  1 passed`.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-44` → every path is in the list above; `TODO.md`,
        `CHANGELOG.md`, `packages/contracts/src/index.ts` and `apps/daemon/src/main.ts` are
        absent.
  - [ ] `[live]` Three real repositories run at once with their browser tests and no
        out-of-memory kill.
        **Measurement:** on the spot box (`c7g.2xlarge`, 8 vCPU / 16 GB) start three manual
        runs on three registered repositories whose gate includes the Playwright suite; read
        `GET /v1/health` while they run — `queue.running === 3`, `queue.maxConcurrency === 3`,
        `queue.pending === 0` — then after each finishes read `GET /v1/runs/{id}` and require
        `state === "succeeded"` and a green `run.gate`; require
        `journalctl -k --since "<start>" | grep -c -i 'out of memory'` → `0`,
        `journalctl -u codebox --since "<start>" | grep -c run_admitted` → `3`, and
        `systemctl show -p Result codebox.service` → `Result=success`. Bound: three green runs,
        zero OOM lines, one admit line per run.
        **Not measurable on a GitHub runner** (needs the 16 GB arm64 box, three real
        repositories, a real model provider and Chromium). QA reports it `not run` there; the
        Orchestrator opens an `agent-review` issue.

## 📣 Coordination

- For the Orchestrator: this task claims the two hot files `package-lock.json` and
  `docs/decisions.md` (sole holder in this batch) and adds paths the TODO item did not list —
  `apps/daemon/src/runs/engine.ts`, `apps/daemon/src/runs/engine.test.ts`,
  `apps/daemon/src/config.test.ts`, `apps/daemon/src/health.test.ts` — because raising the
  default to 3 and wiring `RunSettings` cannot pass `npm test` otherwise. It also adds
  `apps/daemon/package.json` and the lock because the engine now value-imports
  `@codebox/scheduler`, which the daemon did not depend on before. The three folder READMEs
  (`packages/core`, `packages/scheduler`, `apps/daemon/src/run`) are the AGENTS.md duty for
  the two new files and the one changed file description. All are disjoint from Task-43 and
  from Task-38.
- For the next batch: the scheduler package is now a daemon dependency; a future task that
  wires the actual cron tick into the daemon (there is none today — `src/routines/tick.ts`
  still re-derives its plan) should reuse `@codebox/scheduler` rather than add a second
  planner.
- For Task-45: `docs/architecture.md` ("concurrency stays 2"), `docs/roadmap.md` ("at two
  concurrent runs") and `docs/aws.md` ("D15 caps at two globally") still say two. They are
  outside this task's paths and belong to the host-neutral docs pass.
- For Task-46: the measured bring-up is what confirms D15's sizing; record the three-run
  measurement in `docs/aws.md`.
- `docs/jobs.md` §3 is deliberately untouched: `queued` already leaves "when a slot and a
  worktree exist".

## ⛔ Out of scope

- No new dependency beyond the workspace `@codebox/scheduler` link; no external queue, no
  semaphore package, no migration, no store change.
- Do not change `apps/daemon/src/runs/service.ts`: `queueRun` and its `202 queued` answer stay
  as they are. Do not touch `apps/daemon/src/main.ts` or `packages/contracts/src/index.ts`.
- Do not change the run state machine, the guardrails, the tick, or `planTick`'s ordering.
- Do not enforce admission in SQL or in the scheduler's claim; it is a pure rule plus the
  engine's in-memory waiting list.
- Do not touch the app: `/v1/health` already carries `queue.maxConcurrency` and the dashboard
  renders it.
- No `docs/architecture.md`, `docs/aws.md`, `docs/roadmap.md`, `docs/operations.md`, `TODO.md`
  or `CHANGELOG.md` edit.
- No gold-plating: no per-repo fairness beyond "repository, then `created_at`, then id"; no
  priority queue, no aging, no starvation metrics.

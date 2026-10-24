# Spec: Task-05 — Core rules

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (`packages/core`) — pure domain logic, no I/O.
- **Role:** Dev.
- **Objective:** `@codebox/core` holds every rule the daemon must not re-implement: the D14 run
  state machine with a typed rejection per illegal move, the D12 auto-merge evaluation as one
  function of facts, the D13 cron parser / next-fire / misfire rule that is DST-correct in an
  IANA zone, the D26 protected-path and diff-budget checks, the D27 permission policy as data,
  and the D29 cost and timeout guards. After this task the daemon decides nothing about those
  rules on its own: it feeds facts and renders the result.
- **Environment:** worktree `../wt-cb-05`, branch `task-05`, base `main` (`611a788`, which
  already contains the merged Task-03).
- **Dependencies:** Task-03 — merged; it produced `packages/contracts/src/primitives.ts`
  (`RunState`, `GuardrailId`, `BlockerCode` as types) and
  `packages/contracts/src/resources.ts` (the guardrail and blocker schemas). Task-01 — merged;
  it produced the workspace skeleton, `packages/core/tsconfig.json` and the Vitest project
  `packages/core`.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path. Removing a stray `.gitkeep` from a directory this task populates is
allowed.

- `packages/core/README.md`
- `packages/core/src/index.ts`
- `packages/core/src/run-state.ts`
- `packages/core/src/guardrails.ts`
- `packages/core/src/cron.ts`
- `packages/core/src/misfire.ts`
- `packages/core/src/protected-paths.ts`
- `packages/core/src/diff-budget.ts`
- `packages/core/src/permissions.ts`
- `packages/core/src/limits.ts`
- `packages/core/src/run-state.test.ts`
- `packages/core/src/guardrails.test.ts`
- `packages/core/src/cron.test.ts`
- `packages/core/src/misfire.test.ts`
- `packages/core/src/protected-paths.test.ts`
- `packages/core/src/diff-budget.test.ts`
- `packages/core/src/permissions.test.ts`
- `packages/core/src/limits.test.ts`
- `docs/jobs.md` — **section: `## 3. Run lifecycle` only**, and **section:
  `## 7. Guardrails (D12)` only**. No other heading in that file, including §1, §2, §4–§6 and
  §8–§15.

`packages/core/package.json` and `packages/core/tsconfig.json` are **not** in the list. Do not
add a dependency, a script or a path mapping. `packages/core/src/usage.ts` is **not** in the
list: it belongs to Task-27.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/jobs.md` (§1 the job, §2 scheduling, §3 lifecycle, §5 the gate, §7 guardrails, §8
  merge, §9 cancel/timeout/cost, §10 retries, §11 probation, §14 what a run never does)
- `docs/decisions.md` (D11, D12, D13, D14, D15, D26, D27, D29, D38)
- `docs/agent-runtime.md` (§6 permissions, §9 cost and limits)
- `docs/providers.md` (§8 runs, merge and scheduler)
- `docs/api.md` (§5.4 runs, §9 timeouts and limits)
- `packages/contracts/src/primitives.ts`, `packages/contracts/src/resources.ts`,
  `packages/contracts/src/config.ts`
- `packages/contracts/README.md`
- `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/README.md`
- `vitest.config.ts`, `tsconfig.base.json`, `eslint.config.js`

## 🔒 Contract

The public surface other tasks are written against **right now**. It is a promise, not a
suggestion. Exact exported names, signatures and types.

Everything exported from the package goes through `packages/core/src/index.ts`, which
re-exports every name exactly once, grouped by module, with `export type { … }` for types.
`tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`: index access yields `T | undefined`, and an optional property is
never assigned `undefined` explicitly.

### Purity (this is the review criterion)

- `@codebox/contracts` is imported **type-only**, always `import type { RunState } from
  '@codebox/contracts';`. Never a value import: `npm test` runs before `npm run build` in CI
  and `packages/contracts/dist` does not exist at that point.
- `packages/core/src/**` (outside `*.test.ts`) imports **no** `node:` module, reads no
  `process.env`, calls no `Date.now()`, `new Date()` without arguments, `Math.random`,
  `crypto`, `fetch` or `console`. Time and randomness are always arguments.
- `Intl.DateTimeFormat` with an explicit `timeZone` is allowed — that is how the zone rules are
  read — but the result must depend only on the arguments.
- Every function is total: it returns a typed result, it does not throw for bad domain input.
  The only `throw` allowed in the package is in `globToRegExp`, for a pattern that is not a
  string (a programming error, not data).

### `run-state.ts`

```ts
import type { RunState } from '@codebox/contracts';

export const RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>>;
export const TERMINAL_STATES: readonly RunState[];
export const CANCELLABLE_STATES: readonly RunState[];

export type TransitionRejectionCode = 'illegal_transition' | 'terminal_state' | 'same_state';

export type TransitionOutcome =
  | { readonly allowed: true; readonly from: RunState; readonly to: RunState }
  | {
      readonly allowed: false;
      readonly from: RunState;
      readonly to: RunState;
      readonly code: TransitionRejectionCode;
      readonly message: string;
    };

export function canTransition(from: RunState, to: RunState): boolean;
export function transitionRun(from: RunState, to: RunState): TransitionOutcome;
export function canCancel(state: RunState): boolean;
export function isTerminal(state: RunState): boolean;
```

`TERMINAL_STATES` is exactly `['succeeded', 'failed', 'cancelled']` (the contract's
`RUN_STATE_TERMINAL` list; do not import it as a value, repeat the three literals).
`CANCELLABLE_STATES` is exactly `['queued', 'preparing', 'running', 'gating']` — `docs/api.md`
§5.4 and `docs/jobs.md` §3 allow cancel only there; `merging` is refused because the merge call
is atomic.

`RUN_TRANSITIONS` is exactly:

| From | To |
| --- | --- |
| `queued` | `preparing`, `failed`, `cancelled` |
| `preparing` | `running`, `failed`, `cancelled` |
| `running` | `gating`, `failed`, `cancelled` |
| `gating` | `pr_open`, `failed`, `cancelled` |
| `pr_open` | `merging`, `failed` |
| `merging` | `succeeded`, `pr_open`, `failed` |
| `succeeded` | — |
| `failed` | — |
| `cancelled` | — |

`merging → pr_open` is the documented re-evaluation path (`docs/jobs.md` §8: a 405/409 is
re-evaluated once against fresh facts; a second failure parks the run). It is the only
"backwards" edge and it is intentional. Rejection messages are stable English text:
`Illegal transition running → succeeded.`, `A queued run cannot move to running.`-style is not
used — keep the one template and the code. `transitionRun(x, x)` returns `same_state`; a move
out of a terminal state returns `terminal_state`; anything not in the table returns
`illegal_transition`. Cancelling `merging` is a refusal the **caller** makes with
`canCancel('merging') === false`; `transitionRun` still reports `illegal_transition` because
`merging → cancelled` is not in the table.

### `guardrails.ts`

```ts
import type { BlockerCode, GuardrailId } from '@codebox/contracts';

export interface GuardrailFact {
  readonly id: GuardrailId;
  readonly state: 'pass' | 'fail' | 'skip';
  readonly reason?: string; // the blocker code, when it failed
}

export interface MergeBlocker {
  readonly code: BlockerCode;
  readonly message: string;
}

export interface MergeFacts {
  readonly gate: { readonly status: 'passed' | 'failed' | 'skipped'; readonly exitCode: number };
  readonly checks: readonly {
    readonly name: string;
    readonly conclusion: 'success' | 'failure' | 'neutral' | 'skipped' | 'pending' | 'cancelled';
  }[];
  readonly pullRequest: {
    readonly mergeable: boolean;
    readonly conflicting: boolean;
    readonly labels: readonly string[];
  };
  readonly base: { readonly recordedSha: string; readonly currentSha: string };
  readonly diff: { readonly files: number; readonly added: number; readonly removed: number };
  readonly changedPaths: readonly string[];
  readonly policy: {
    readonly repo: 'auto' | 'manual';
    readonly job: 'auto' | 'manual';
    readonly automerge: 'on' | 'off';
    readonly probationRuns: number;
    readonly consecutiveGreenRuns: number;
  };
  readonly budget: { readonly maxFiles: number; readonly maxLines: number };
  readonly protectedPaths: readonly string[];
}

export interface MergeEvaluation {
  readonly merge: boolean;
  readonly guardrails: readonly GuardrailFact[];
  readonly blockers: readonly MergeBlocker[];
}

export function evaluateAutoMerge(facts: MergeFacts): MergeEvaluation;
```

Evaluation, in exactly this order (the app renders the arrays verbatim, so the order is part of
the contract). `merge` is `true` iff `blockers` is empty.

| # | `GuardrailId` | Fails when | `BlockerCode` and message |
| --- | --- | --- | --- |
| G1 | `gate` | `gate.status !== 'passed'` or `gate.exitCode !== 0` | `gate_failed` — `The gate exited with code <n>.` (`skipped` also fails: fail closed) |
| G2 | `checks` | any check `conclusion !== 'success'`, or `!pullRequest.mergeable`, or `pullRequest.conflicting` | `checks_red` — `Required checks are not green: <first name>.`; and when the PR is not mergeable `not_mergeable` — `The pull request is not mergeable.` (both can appear, `checks_red` first) |
| G4 | `base` | `base.recordedSha !== base.currentSha` | `base_moved` — `The base branch moved during the run.` |
| G5 | `diff` | `diff.files > budget.maxFiles` or `diff.added + diff.removed > budget.maxLines` | `diff_budget` — `The diff is too large: <files> files, <lines> changed.` |
| G6 | `protected_paths` | `scanProtectedPaths(changedPaths, protectedPaths).length > 0` | `protected_path` — `The diff touches <first hit path>.` |
| G7 | `labels` | `pullRequest.labels` contains `do-not-merge` | `label_do_not_merge` — `The pull request carries the do-not-merge label.` |
| G8a | `policy` | `policy.repo !== 'auto'` or `policy.job !== 'auto'`, or `policy.probationRuns > 0 && policy.consecutiveGreenRuns < policy.probationRuns` | `policy_manual` — `Auto-merge is not enabled for this repository and job.` / `Probation is not met: <n> of <m> green runs.` |
| G8b | `automerger` | `policy.automerge !== 'on'` | `automerger_off` — `Auto-merge is switched off globally.` |

Notes that the daemon and the app rely on:

- The contract has eight guardrail ids and no id for "PR mergeable" (G3 in the document):
  G3 is reported on `checks` and its blocker is `not_mergeable`. `docs/jobs.md` §7 is updated
  in this task to say so.
- The document's failure-code column uses `diff_too_large` and `vetoed`; the **contract wins**
  (`diff_budget`, `label_do_not_merge`), and §7 is updated to the contract vocabulary.
- A guardrail that passed is `{ id, state: 'pass' }`; a failed one carries
  `reason: '<blocker code>'`; no guardrail is ever `skip` in v1 — the `skip` member exists
  because the contract's `guardrailStateSchema` has it.
- `MergeEvaluation.guardrails` has exactly eight entries, in the order above.

### `cron.ts`

```ts
export interface ParsedCron {
  readonly source: string;
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: readonly number[];
  readonly months: readonly number[];
  readonly daysOfWeek: readonly number[]; // 0 = Sunday
  readonly dayOfMonthRestricted: boolean;
  readonly dayOfWeekRestricted: boolean;
}

export type CronFailureCode = 'field_count' | 'range' | 'step' | 'syntax';

export type CronParseResult =
  | { readonly ok: true; readonly cron: ParsedCron }
  | { readonly ok: false; readonly code: CronFailureCode; readonly message: string };

export function parseCron(expression: string): CronParseResult;
export function isValidTimezone(timezone: string): boolean;
export function nextFire(cron: ParsedCron, timezone: string, after: Date): Date | null;
export function nextFires(
  cron: ParsedCron,
  timezone: string,
  after: Date,
  count: number,
): Date[];
```

- Exactly five whitespace-separated fields (no seconds, no aliases, no `L`/`W`/`#`).
- Each field accepts `*`, integers, ranges `a-b`, lists `a,b,c` and steps `*/n` or `a-b/n`.
  Ranges: minute 0–59, hour 0–23, day of month 1–31, month 1–12, day of week 0–7 with `7`
  normalised to `0`. A value outside the range is `CronFailureCode 'range'`; `n === 0` in a
  step is `'step'`.
- Day-of-month and day-of-week combine with **OR** when both are restricted (standard cron
  semantics); when one is `*` the other decides.
- `nextFire` returns the first instant **strictly after** `after` whose local time in
  `timezone` matches the cron, or `null` when no instant matches within 1 827 local days
  (5 years) — `0 0 30 2 *` must return `null`. It must not iterate minute-by-minute over the
  horizon; step by local day and expand the matching hours and minutes per day.
- DST (`docs/jobs.md` §2, D13):
  - a local time that does not exist (spring forward) fires at **the first valid instant after
    it**;
  - a local time that occurs twice (fall back) fires **once, at the first occurrence**.
- An IANA zone that `Intl` does not know is a programming error: `nextFire` returns `null` and
  `isValidTimezone` returns `false` (`isValidTimezone` never throws).

Pinned values the tests must assert (Europe/Madrid):

| Expression | `after` | Expected |
| --- | --- | --- |
| `0 3 * * *` | `2026-10-24T18:03:11Z` | `2026-10-25T02:00:00Z` (03:00 CET) |
| `30 2 * * *` | `2026-10-24T12:00:00Z` | `2026-10-25T00:30:00Z` (first 02:30, CEST) |
| `30 2 * * *` | `2026-10-25T00:30:00Z` | `2026-10-26T01:30:00Z` (the second 02:30 of the 25th is skipped) |
| `30 2 * * *` | `2027-03-27T12:00:00Z` | `2027-03-28T01:00:00Z` (02:30 does not exist; 03:00 CEST) |

### `misfire.ts`

```ts
export type MisfireCode = 'not_due' | 'on_time' | 'outside_grace';

export interface MisfireDecision {
  readonly run: boolean;
  readonly code: MisfireCode;
  readonly ageSeconds: number;
}

export function resolveMisfire(input: {
  readonly scheduledFor: string;
  readonly now: string;
  readonly graceSeconds: number;
}): MisfireDecision;
```

- `ageSeconds` is `(now - scheduledFor) / 1000`, signed, rounded down.
- `age < 0` → `{ run: false, code: 'not_due' }`.
- `0 <= age < graceSeconds` → `{ run: true, code: 'on_time' }` (the fire missed by **less
  than** the grace still runs once, `docs/jobs.md` §2).
- `age >= graceSeconds` → `{ run: false, code: 'outside_grace' }` (logged once by the caller,
  never a catch-up storm).
- The window is the caller's `CB_MISFIRE_GRACE_SECONDS` (900 default), passed in; the package
  never reads configuration.

### `protected-paths.ts`

```ts
export const DEFAULT_PROTECTED_PATHS: readonly string[]; // ['.github/**','ops/**','infra/**','**/*.env','CODEOWNERS','.gitmodules']

export interface ProtectedPathHit {
  readonly path: string;
  readonly pattern: string;
}

export function globToRegExp(pattern: string): RegExp;
export function matchesGlob(pattern: string, path: string): boolean;
export function normaliseRepoPath(path: string): string;
export function scanProtectedPaths(
  paths: readonly string[],
  patterns: readonly string[],
): readonly ProtectedPathHit[];
```

- Glob semantics (the six default patterns must behave exactly like this):
  - `*` matches any run of characters except `/`;
  - `**` matches any run of characters including `/`;
  - `**/` also matches **zero** leading segments, so `**/*.env` matches `.env` and
    `config/.env`;
  - `?` matches one character except `/`;
  - every other character is literal; the pattern is anchored at both ends.
- `normaliseRepoPath` strips a leading `./` and collapses `//`; it does not resolve `..` (a
  `..` in a diff path is the caller's problem and must be rejected upstream).
- `scanProtectedPaths` returns one hit per `(path, pattern)` pair in input order, deduplicated
  by path and pattern.
- Pinned cases: `.github/workflows/x.yml` hits `.github/**`; `ops/vm/install.sh` hits `ops/**`;
  `src/.env` and `.env` hit `**/*.env`; `src/index.ts` hits nothing; `ops` alone does **not**
  hit `ops/**` (a directory is not a file path).

### `diff-budget.ts`

```ts
export interface DiffSize {
  readonly files: number;
  readonly added: number;
  readonly removed: number;
}

export interface DiffBudget {
  readonly maxFiles: number;
  readonly maxLines: number;
}

export interface DiffBudgetResult {
  readonly ok: boolean;
  readonly files: number;
  readonly lines: number;
  readonly reason: 'files' | 'lines' | 'files_and_lines' | null;
}

export const DEFAULT_DIFF_BUDGET: DiffBudget; // { maxFiles: 40, maxLines: 2000 }

export function evaluateDiffBudget(diff: DiffSize, budget: DiffBudget): DiffBudgetResult;
```

`lines` is `added + removed`. `ok` is `files <= maxFiles && lines <= maxLines`. Pinned:
`{ files: 40, added: 1500, removed: 500 }` is ok (2 000 lines exactly); `{ files: 41, … }` is
not ok with reason `files`; `{ files: 1, added: 2000, removed: 1 }` is not ok with reason
`lines`.

### `permissions.ts`

```ts
export type PermissionMode = 'chat' | 'run';
export type PermissionTool = 'read' | 'edit' | 'bash' | 'webfetch' | 'other';
export type PermissionDecision = 'allow' | 'ask' | 'deny';

export const PERMISSION_MATRIX: Readonly<
  Record<PermissionMode, Readonly<Record<PermissionTool, PermissionDecision>>>
>;

export interface PermissionRequest {
  readonly tool: string;
  readonly mode: PermissionMode;
  readonly path: string | null;   // absolute path the tool names, when it names one
  readonly worktree: string;      // absolute worktree root of the run or chat
}

export function classifyTool(tool: string): PermissionTool;
export function isInsideWorktree(path: string, worktree: string): boolean;
export function decidePermission(request: PermissionRequest): PermissionDecision;
```

`PERMISSION_MATRIX` is exactly the `docs/agent-runtime.md` §6 table plus the read class:

| Tool class | chat | run | outside the worktree |
| --- | --- | --- | --- |
| `read` | `allow` | `allow` | `deny` |
| `edit` | `ask` | `allow` | `deny` |
| `bash` | `ask` | `allow` | `deny` |
| `webfetch` | `deny` | `deny` | `deny` |
| `other` | `deny` | `deny` | `deny` |

`classifyTool` (case-insensitive, exact names):
`read`, `list`, `glob`, `grep`, `lsp` → `read`; `edit`, `write`, `patch`, `multiedit`,
`apply_patch` → `edit`; `bash`, `shell`, `terminal` → `bash`; `webfetch`, `websearch`,
`fetch` → `webfetch`; anything else → `other`. The last line is what makes an unknown tool fail
closed (D27).

`decidePermission`: `path === null` inherits the worktree (the tool works in the session's
directory, which is the worktree) and therefore is "inside"; a `path` that is not inside
`worktree` is `deny` regardless of class, except that `webfetch`/`other` are `deny` anyway.
`isInsideWorktree` compares path segments, not strings: `worktree` `/srv/wt/run_01J` does not
contain `/srv/wt/run_01J-evil` and does not contain `/srv/wt/run_01J/../etc`.

### `limits.ts`

```ts
export type CostGuardCode = 'cost_cap_reached' | 'job_cost_exceeded';

export type CostGuardResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: CostGuardCode; readonly message: string };

export interface CostGuardInput {
  readonly spentTodayUsd: number;   // the UTC day, from the usage ledger
  readonly dailyCapUsd: number;     // CB_DAILY_COST_USD, 0 disables the cap
  readonly runCostUsd: number;      // this run so far
  readonly jobMaxCostUsd: number | null;
}

export function checkCost(input: CostGuardInput): CostGuardResult;

export interface TimeoutCheck {
  readonly expired: boolean;
  readonly elapsedMs: number;
}

export function checkRunTimeout(input: {
  readonly startedAt: string;
  readonly now: string;
  readonly timeoutSeconds: number;
}): TimeoutCheck;
```

- The daily cap is hit when `dailyCapUsd > 0 && spentTodayUsd + runCostUsd >= dailyCapUsd`
  → code `cost_cap_reached`, message `The daily cost cap of <cap> USD is reached.`
- Otherwise the per-job cap is hit when `jobMaxCostUsd !== null && runCostUsd >=
  jobMaxCostUsd` → `job_cost_exceeded`, message `The job cost cap of <cap> USD is reached.`
- The daily cap is checked first, because it pauses the whole queue (`docs/jobs.md` §9).
- `elapsedMs` is `Date.parse(now) - Date.parse(startedAt)`; `expired` is
  `elapsedMs >= timeoutSeconds * 1000`. A negative elapsed time is not expired.

### Data

The vocabularies this task freezes, all of them already in the contract and none of them
renamed here:

| Key | Values |
| --- | --- |
| run states | `queued`, `preparing`, `running`, `gating`, `pr_open`, `merging`, `succeeded`, `failed`, `cancelled` |
| cancellable states | `queued`, `preparing`, `running`, `gating` |
| guardrail ids, in evaluation order | `gate`, `checks`, `base`, `diff`, `protected_paths`, `labels`, `policy`, `automerger` |
| blocker codes | `gate_failed`, `checks_red`, `not_mergeable`, `base_moved`, `diff_budget`, `protected_path`, `label_do_not_merge`, `policy_manual`, `automerger_off` |
| permission modes / classes / decisions | `chat` \| `run` / `read` \| `edit` \| `bash` \| `webfetch` \| `other` / `allow` \| `ask` \| `deny` |
| cost codes | `cost_cap_reached`, `job_cost_exceeded` |
| misfire codes | `not_due`, `on_time`, `outside_grace` |
| diff budget default | 40 files, 2 000 changed lines |

## 🧩 Configuration

No new `CB_*` key, and the package reads no environment variable. Every default named in this
spec is a **caller argument**; Batch 4 passes the values from `CONFIG_DEFAULTS`
(`CB_DIFF_MAX_FILES` 40, `CB_DIFF_MAX_LINES` 2000, `CB_PROTECTED_PATHS` as the six patterns,
`CB_MISFIRE_GRACE_SECONDS` 900, `CB_RUN_TIMEOUT_SECONDS` 5400, `CB_DAILY_COST_USD` 10,
`CB_PROBATION_RUNS` 0). `DEFAULT_PROTECTED_PATHS` and `DEFAULT_DIFF_BUDGET` are the compiled
fallbacks and must equal those defaults.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing
else is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; includes the tests this task adds.
  - `npx vitest run --project packages/core` — this package alone.
  - `npm run build` — `tsc -b` and the app build when this task touches it.
  - `git diff --name-only main...task-05` — audit against the exclusive paths.
  - Every test is a table or a pinned value; no test reads the real clock, the network or the
    filesystem.
- **Acceptance criteria:** every one tagged **`[unit]`** (a headless command, a decoded value,
  a pinned number) or **`[live]`** (only exists in the running system: a stream, a push, a
  tunnel, a UI state). A `[live]` criterion states its **measurement** — what to read, on which
  surface, against which bound.
  - [ ] `[unit]` It typechecks, lints and builds clean: `npm run lint && npm run build`.
  - [ ] `[unit]` The declared tests exist and pass: `npx vitest run --project packages/core`
        reports at least the eight test files above and zero failures.
  - [ ] `[unit]` Every legal transition is accepted and every illegal one rejected with a
        reason: `npx vitest run --project packages/core -t 'every legal transition is accepted and every illegal one is rejected'`
        passes; the test walks all 9 × 9 pairs, asserts the 17 legal pairs of the table above,
        asserts `same_state` for the diagonal, `terminal_state` out of the three terminal
        states, `illegal_transition` for the rest, and that `canCancel` is true only for the
        four cancellable states.
  - [ ] `[unit]` A table-driven test covers each guardrail red and green, including the "base
        moved" and "protected path" cases:
        `npx vitest run --project packages/core -t 'each guardrail is red and green'` passes; it
        asserts the eight ids in contract order, exactly one blocker per red case, `merge` true
        only when all eight are green, and `not_mergeable` for a conflicting PR.
  - [ ] `[unit]` DST transitions in `Europe/Madrid` produce the documented next fire:
        `npx vitest run --project packages/core -t 'Europe/Madrid DST produces the documented next fire'`
        passes with the four pinned rows of the table above, and
        `nextFire(parseCron('0 0 30 2 *'), 'UTC', …)` returns `null`.
  - [ ] `[unit]` A diff of 41 files or 2 001 lines fails the budget:
        `npx vitest run --project packages/core -t 'the diff budget fails at 41 files or 2001 lines'`
        passes and also asserts 40 files / 2 000 lines passes.
  - [ ] `[unit]` The permission policy fails closed:
        `npx vitest run --project packages/core -t 'the permission policy fails closed'` passes;
        it asserts `webfetch`, an unknown tool and a path outside the worktree are `deny`, and
        that `edit` is `ask` in chat and `allow` in a run.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-05` lists only files from the list above.
  - [ ] `[unit]` Purity: `grep -rnE "from 'node:|process\.env|Date\.now\(\)|new Date\(\)|Math\.random|console\.|fetch\(" packages/core/src --include=*.ts | grep -v '\.test\.ts'`
        prints nothing, and `grep -rn "from '@codebox/contracts'" packages/core/src` matches only
        lines beginning `import type`.
  - [ ] `[unit]` The document matches the code: `grep -n "evaluateAutoMerge\|transitionRun" docs/jobs.md`
        finds both names in §3 and §7 and nothing outside those sections changed
        (`git diff -U0 main...task-05 -- docs/jobs.md` touches only the §3 and §7 hunks).

## 📣 Coordination

- For the Architect: §7's failure-code column is reconciled to the **contract** vocabulary
  (`diff_budget`, `label_do_not_merge`, plus `automerger_off`), and the PR-mergeable condition
  is reported on the `checks` guardrail because the contract has no `mergeable` id. §1's
  `cron: string?` stays wrong (the contract `Job.cron` is required); §1 is not in this task's
  paths.
- For the next batch: Task-07 uses `decidePermission` and `classifyTool`; Task-09 uses
  `parseCron` / `nextFire` / `nextFires` / `resolveMisfire` and keeps the claim itself in the
  store; Task-14 uses `transitionRun` before every write, `evaluateAutoMerge` with facts,
  `evaluateDiffBudget` and `scanProtectedPaths`, and maps `blocker.code` straight into
  `run.blockers[]` (the contract schema accepts these codes); Task-27 adds
  `packages/core/src/usage.ts` and must not touch these files.
- `pr_open` is not cancellable, per the exhaustive list in `docs/api.md` §5.4. If Task-14 needs
  a parked run to be cancellable, that is a new decision that amends §3 and this table.
- The `GuardrailFact` and `MergeBlocker` shapes are structurally identical to the contract's
  `guardrailSchema` and `blockerSchema`, so `parseRun` accepts them. The contract does not
  export the `Guardrail`/`Blocker` **type aliases**, which is why they are declared here.
- For QA: the purity grep uses `grep`, not `rg`, so it runs on any runner.

## ⛔ Out of scope

- No new dependency outside the spec.
- No refactor of a file this task did not have to touch.
- No change to `docs/decisions.md` unless the task is the decision owner.
- No pricing table, no usage aggregation, no token accounting (`packages/core/src/usage.ts`,
  Task-27).
- No cron library: the five-field parser is written here.
- No scheduler queue, no claim, no SQL, no HTTP, no logger, no config parsing: the daemon calls
  these functions and persists the result.
- No prompt envelope and no gate command building (`packages/opencode`, Task-07).
- No change to §1 or §2 of `docs/jobs.md`; if the code shows the document is wrong there,
  report it in the task report instead of editing.

# Spec: Task-83 — The design check stops skipping (issue #75)

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** daemon + package + docs (a **gate and security change**).
- **Role:** Dev.
- **Objective:** a green gate is no longer green until the design documents in the run's own
  worktree have been checked. `gating()` calls the existing `scanDesign` after the secret scan,
  a new pure rule in `packages/core` decides which finding fails the run (`colour_outside_tokens`,
  `route_without_component`, `snapshot_hash_mismatch`, and any rule this build does not know) and
  which is only reported (`screen_state_missing`, suffixed `(report-only)`), and the policy is
  written down in `docs/jobs.md` §5 and a new decision record D57 that amends D52.
- **Environment:** worktree `../wt-cb-83`, branch `task-83`, base `main` @ `47c1cce`. A fresh
  worktree has no `node_modules`: start with `npm ci --prefer-offline --no-audit --no-fund`.
  **Unattended run:** commit on `task-83`; when the gate is green, publish with an empty commit `dev: done task-83` followed by `git push origin task-83`; never commit to `main`; never use the
  question tool. A real block is an issue:
  `node scripts/agent/issue.mjs --label agent-blocked --title "Task-83: <what>" --body "<the literal error and the decision needed>"` (`docs/agent-ci.md` §7).
- **Dependencies:** none. The gate step (`apps/daemon/src/gate/design-check.ts`), the design
  package and the engine are on `main`. Task-84 lands `design/tokens.json` in the same wave;
  **this task's tests must not read that file**, because it does not exist on this branch.

### Exclusive paths (single writer)

- `apps/daemon/src/run/engine.ts` (the gate step and its ordering)
- `apps/daemon/src/run/engine.test.ts` (the new design-step cases and the exact-call assertion)
- `apps/daemon/src/gate/design-check.ts` (**held; expected byte-identical** — see Coordination)
- `apps/daemon/src/gate/design-check.test.ts` (**held; expected byte-identical**)
- `packages/core/src/design-gate.ts` (new)
- `packages/core/src/design-gate.test.ts` (new)
- `packages/core/src/index.ts` (the re-export block)
- `packages/core/README.md` (the file map)
- `docs/jobs.md` (section: **§5 The gate**, only)
- `docs/decisions.md` (the **D57 row** only)

`apps/daemon/src/main.ts` and `packages/contracts/src/index.ts` are hot files and are **not**
yours: no new setting, no new event type, no new contract key. `docs/security.md`,
`docs/api.md`, `apps/daemon/src/gate/run-gate.ts`, `secret-scan.ts` and `apps/daemon/src/run/ports.ts`
are out of bounds.

### Inputs (read-only)

- `apps/daemon/src/gate/design-check.ts` — `scanDesign`, `DesignScanOutcome`
  (`{ findings, skipped, oversized }`), `DesignScanError` (`code: 'git_failed'`),
  `formatDesignFinding` (`<file>:<line> <rule>`), `DESIGN_CHECK_MAX_BYTES`.
- `apps/daemon/src/gate/secret-scan.ts` — `scanWorktree`, `SecretScanError`, the shape the new
  step mirrors.
- `apps/daemon/src/gate/run-gate.ts` — `GateExecutionResult` (`status`, `exitCode`, `durationMs`,
  `timedOut`, `cancelled`, `tail`, `logFile`), `GATE_TAIL_LINES` (100).
- `apps/daemon/src/run/engine.ts` — `gating()`, `secretScanStep()`, `appendToGateLog()`,
  `failRun()`, `RunFailure`.
- `apps/daemon/src/run/ports.ts` — `RunPorts` (`gitRunner`, `settings.gitTimeoutMs`), `RunSettings`.
- `packages/design/src/types.ts` — `DesignFinding`, `DesignRule`.
- `packages/design/src/check.ts` — `checkDocuments`, `checkPatch` (what the step runs).
- `docs/jobs.md` §5, `docs/decisions.md` (D52 and the table's row format), `design/README.md` §5.

## 🔒 Contract

### `packages/core/src/design-gate.ts` (new, exported from `packages/core/src/index.ts`)

```ts
export type DesignRuleEnforcement = 'enforced' | 'report-only';

/** Exactly one rule is report-only until L5 draws the missing frames (D57). */
export const REPORT_ONLY_DESIGN_RULES: readonly string[];

export function designRuleEnforcement(rule: string): DesignRuleEnforcement;

export interface ClassifiedDesignFindings<T> {
  readonly enforced: readonly T[];
  readonly reportOnly: readonly T[];
}

export function classifyDesignFindings<T extends { readonly rule: string }>(
  findings: readonly T[],
): ClassifiedDesignFindings<T>;
```

- `REPORT_ONLY_DESIGN_RULES` is frozen and contains exactly `['screen_state_missing']`.
- `designRuleEnforcement(rule)` returns `'report-only'` **only** for a member of that list.
  Every other string — `colour_outside_tokens`, `route_without_component`,
  `snapshot_hash_mismatch`, `''`, `something_new` — returns `'enforced'`: an unknown rule fails
  closed.
- `classifyDesignFindings` partitions in input order and preserves it inside each half.
- Pure: no I/O, no clock, no environment, and **no import of `@codebox/design`** — `@codebox/core`
  has no runtime dependency on it, the rule arrives as a plain `string`, and its `package.json`
  is not in this task's paths.

### `apps/daemon/src/run/engine.ts`

The gate flow becomes, in `gating()`:

```ts
const scanned = result.status === 'passed' ? await secretScanStep(ctx, result) : result;
const designed =
  !ctx.cancelled && scanned.status === 'passed' ? await designScanStep(ctx, scanned) : scanned;
ctx.gate = designed;
const gate = { status: designed.status, exitCode: designed.exitCode, durationMs: designed.durationMs };
amend(ctx, { gate, diff: diffStatOf(status.diff) }, [{ event: 'run.gate', data: { gate } }]);
return designed;
```

`designScanStep(ctx, result)` is a new local function next to `secretScanStep`:

1. `scanDesign(ports.gitRunner, { cwd: worktree.path, baseSha: worktree.baseSha, timeoutMs:
   settings.gitTimeoutMs })` — no `io` injection, the real worktree is read.
2. `DesignScanError` → lines `['design_scan: ' + error.code]` (today always
   `design_scan: git_failed`); one `logger.error({ msg: 'design_scan_failed', runId, code })`;
   `appendToGateLog(result.logFile, lines)`; return `{ ...result, status: 'failed', exitCode: 1,
   tail: [...result.tail, ...lines].slice(-GATE_TAIL_LINES) }`.
3. `outcome.skipped` (no `design/tokens.json`) → return `result` untouched: no line, no log, the
   run is exactly as before.
4. `outcome.oversized` → return `result` untouched. Unreachable through `gating()` (the secret scan
   already fails a patch over 4 MiB), so it is a pass-through, not a second verdict.
5. Otherwise classify `outcome.findings` with `classifyDesignFindings` and build the tail lines
   **in the findings' order**, one per finding:
   - `formatDesignFinding(finding)` for an enforced rule,
   - `` `${formatDesignFinding(finding)} (report-only)` `` for a report-only rule.
6. Exactly one log per run that had findings:
   `logger.error` if `enforced.length > 0` else `logger.info`, with
   `{ msg: 'design_scan_reported', runId, findings: outcome.findings.length,
   enforced: enforced.length, reportOnly: reportOnly.length, oversized: false }`. Never the file
   contents, never a diff.
7. `appendToGateLog(result.logFile, lines)`; then
   - `enforced.length > 0` → `{ ...result, status: 'failed', exitCode: 1, tail:
     [...result.tail, ...lines].slice(-GATE_TAIL_LINES) }`, which `runFlow` turns into
     `failRun(ctx, 'gate_failed')` — no push, no PR, worktree kept;
   - `enforced.length === 0` → `{ ...result, tail: [...result.tail, ...lines].slice(-GATE_TAIL_LINES) }`:
     `status` and `exitCode` stay `passed`, so the run still succeeds while the `(report-only)`
     lines are in the tail and the log.
8. No new `RunFailureCode`, no new `RunSettings` field, no new event type, no new `CB_*` key.

**Ordering is the contract:** command gate → secret scan → design scan → one `run.gate` event.
Because the design step only runs when the secret scan left the gate `passed`, **a patch that
trips the secret scan is reported by the secret scan alone** (no `design_scan` line, no
`design_scan_*` log).

### Docs

- `docs/jobs.md` §5, in the design-check paragraph: replace the closing sentence "The step is a
  module only: the run engine does not call it yet, so a green gate on the running box is not
  re-decided by this check until that one call is added." with the wired policy, stated as
  facts: called on every run after the secret scan and only when the gate and the secret scan are
  green; the three enforced rules and the three-way split; `screen_state_missing` reported as
  `<file>:<line> <rule> (report-only)` and never failing the run; an unknown rule enforced; the
  tail and log line formats; one `design_scan_reported` (counts) and, on a fail-closed error, one
  `design_scan_failed` (`code`); `design_scan: git_failed`; a repository without
  `design/tokens.json` skipped with the run unchanged; the secret-first ordering. Do not touch
  any other section of the file.
- `docs/decisions.md`: one new table row `**D57**` immediately after `**D56**`, in the same
  `| ID | Decision | Why / consequence |` shape. Proposed text, keep or tighten but keep every
  clause: *"The design check is the **second gate step**, run after the secret scan and only on a
  green gate. `colour_outside_tokens`, `route_without_component` and `snapshot_hash_mismatch`
  fail the run; `screen_state_missing` is report-only until L5 draws the missing frames, and a
  rule this build does not know is enforced. No `design/tokens.json` skips the step; a git
  failure is `design_scan: git_failed` and fails closed. Amends D52."* The "why" cell states the
  two reasons: the check was a module nobody called (issue #75), and a null state is not yet a
  fact the agent can fix because the frames do not exist. Do not renumber or edit another row.

## 🧩 Configuration

None. No `CB_*` key, no setting, no default, no `docs/providers.md` line. The step reuses
`settings.gitTimeoutMs` (`CB_GIT_TIMEOUT_SECONDS`) and nothing else.

## 🧪 Test and Validation Plan (for QA)

Run inside `../wt-cb-83` (branch `task-83`), from the worktree root.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint` — must pass.
  - `npm test` — the whole gate, headless.
  - `npm run build` — `tsc -b` across the workspaces.
  - `npx vitest run --project packages/core` and `npx vitest run --project apps/daemon` — the two
    suites this task changes.
  - `git diff --name-only 47c1cce...HEAD` — audit against the exclusive paths.
  - **No `[live]` criterion.** This is a gate step and every property is a pure decision or a
    headless engine run; nothing here exists only on the box.
- **The fixture every engine case uses.** The engine test writes the design documents into the
  harness worktree (`test.workspaces.worktree.path`, already created), because `designScanStep`
  reads the real directory:
  - a `design/tokens.json` **authored in the test**, twelve leaves with the values
    `#0b0f14`, `#121821`, `#e6edf3`, `#8b98a5`, `#22c55e`, `#f59e0b`, `#ef4444`, `#5b6772`,
    `#f7f9fb`, `#ffffff`, `#15803d`, `#b45309` (build the DTCG object from a
    `Record<string, string>` of dot paths, or a literal string — either way it is the test's own
    document, not `design/tokens.json`);
  - `design/routes.json` = `{"routes":[{"path":"/dashboard","screen":"Dashboard","component":"DashboardPage"}]}`;
  - `design/screens/dashboard.json` with all three states, `snapshotSha256` omitted.
  `#0b1120` is deliberately **not** in that document: it is the item's "outside" colour. The run
  diff is the empty string unless a case says otherwise; only the two *token literal / drift*
  cases supply an added line, and it is the only colour line in that diff.
- **Acceptance criteria.** Each is `[unit]`; the test file is named for reproduction.
  - [ ] `[unit]` It typechecks, lints and builds clean.
  - [ ] `[unit]` *Classification* (`packages/core/src/design-gate.test.ts`):
        `designRuleEnforcement` returns `'report-only'` for `screen_state_missing` and `'enforced'`
        for `colour_outside_tokens`, `route_without_component`, `snapshot_hash_mismatch`, `''` and
        `'something_new'`; `REPORT_ONLY_DESIGN_RULES` deep-equals `['screen_state_missing']` and is
        frozen; `classifyDesignFindings` on a mixed list returns the two halves in input order.
  - [ ] `[unit]` *Token literal passes, drift fails* (`apps/daemon/src/run/engine.test.ts`): with
        the fixture above and a run diff whose added line holds `#0b0f14`, the run ends
        `succeeded` and the tail has no `colour_outside_tokens`; with `#0b1120`, the run ends
        `failed`. Both are asserted against `checkPatch` behaviour through the engine, never
        against `design/tokens.json`.
  - [ ] `[unit]` *Outside colour fails the run*: a screen spec whose `error` state caption contains
        `#0b1120` ends the run `failed` with `failure.code === 'gate_failed'`,
        `outcome.gate.status === 'failed'`, `outcome.gate.exitCode === 1`, the tail containing
        `design/screens/dashboard.json:1 colour_outside_tokens`, `test.git.pushes` and
        `test.git.opened` empty, no `run.pr` event, and one `design_scan_reported` log with
        `{ findings: 1, enforced: 1, reportOnly: 0 }`.
  - [ ] `[unit]` *Null state only reports*: with the fixture and `states.empty: null` (nothing
        else wrong) the run ends `succeeded`, `outcome.gate.status === 'passed'`,
        `exitCode === 0`, the tail contains
        `design/screens/dashboard.json:1 screen_state_missing (report-only)`, a PR is opened, and
        there is exactly **one** `design_scan_reported` log with
        `{ runId: RUN_ID, findings: 1, enforced: 0, reportOnly: 1 }` at `info`.
  - [ ] `[unit]` *No token document skips*: the default `harness()` (empty worktree) ends
        `succeeded`, `test.git.pushes` has one entry, `test.lines` holds no `design_scan_*` log and
        the tail holds no `design_scan` line (`outcome.gate?.tail` is `['gate ok']`).
  - [ ] `[unit]` *Git failure fails closed*: extend the test git double so the **second** non-cached
        `diff` call fails (`{ code: 1 }`) while the first succeeds — the secret scan is the first
        caller. The run ends `failed` with `failure.code === 'gate_failed'`, the tail contains
        `design_scan: git_failed` and no `secret_scan:` line, and one `design_scan_failed` log has
        `{ runId: RUN_ID, code: 'git_failed' }`.
  - [ ] `[unit]` *The secret is reported alone*: a run diff holding a `ghp_…` literal **and** a
        `#0b1120` added line, with the fixture design documents present, ends `failed`, the tail
        contains the secret's `<path>:<line> github_token` and no `colour_outside_tokens` line, and
        `test.lines` holds no `design_scan_*` log.
  - [ ] `[unit]` *A red command gate never reaches the design step*: the existing "parks a red gate"
        case (repo gate `exit 1`) still ends `failed`/`gate_failed`, its tail holds no
        `design_scan` line, and `test.lines` holds no `design_scan_*` log.
  - [ ] `[unit]` *Exact calls updated*: the `does not commit when the agent already committed` case
        asserts two identical entries — the secret scan's diff and the design scan's diff:
        `[['diff', '--no-color', '--unified=0', '--no-ext-diff', BASE_SHA, '--'], [same]]`. This is
        the one existing assertion this task must change (`scanDesign` reads the diff before it
        checks for the token document).
  - [ ] `[unit]` *The step module is unchanged*:
        `git diff --stat 47c1cce...HEAD -- apps/daemon/src/gate/design-check.ts
        apps/daemon/src/gate/design-check.test.ts` is empty and
        `npx vitest run --project apps/daemon` keeps every existing `scanDesign` case green.
  - [ ] `[unit]` *Docs*: `docs/jobs.md` §5 contains `(report-only)`, `design_scan: git_failed` and
        `design_scan_reported`, and no longer contains "the run engine does not call it yet";
        `docs/decisions.md` has exactly one `**D57**` row, it is the last row of the table, it
        names D52, and `git diff 47c1cce...HEAD -- docs/decisions.md` touches one line;
        `grep -c '^## 5\. The gate' docs/jobs.md` is `1` and every other `^## ` heading of that
        file is unchanged.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched; in particular
        `git diff --stat 47c1cce...HEAD -- apps/daemon/src/main.ts packages/contracts
        docs/security.md docs/api.md` is empty.
  - [ ] `[unit]` `packages/core/README.md` maps `design-gate.ts` and `design-gate.test.ts` with one
        line each.

- **Integration criterion (runs on the combined tree, after Task-84 is merged; not a blocker for
  this task's own QA).** `design/tokens.json` exists and the rule still reads it:
  ```bash
  npm run build
  node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { parseTokens, tokenValues, checkPatch } from "./packages/design/dist/index.js";
  const values = tokenValues(parseTokens(JSON.parse(readFileSync("design/tokens.json", "utf8"))));
  const diff = (line) => ["diff --git a/apps/app/src/theme/x.css b/apps/app/src/theme/x.css", "--- a/apps/app/src/theme/x.css", "+++ b/apps/app/src/theme/x.css", "@@ -1,0 +1,1 @@", "+color: " + line + ";", ""].join("\n");
  console.log(JSON.stringify([checkPatch({ patch: diff("#0b0f14"), tokenValues: values }).length, checkPatch({ patch: diff("#0b1120"), tokenValues: values }).length]));
  '
  ```
  Expect `[0,1]`.

## 📣 Coordination

- **Deviation from the item's wording, and why.** The acceptance says "a run whose screen declares
  `#ffffff` ends `failed`". That cannot hold once Task-84 lands: `#ffffff` is one of the twelve
  values (`color.surface.raised-light`), so it is a legal literal. The measurable form is kept —
  "a screen that declares a colour outside the tokens fails the run" — and it is measured with
  `#0b1120`, the item's own outside colour two clauses earlier. The engine tests use a token
  document authored in the test, exactly as the batch note asks, so they never depend on Task-84.
- **For the Architect / the next cycle:** `scanDesign` reads the diff *before* it looks for
  `design/tokens.json`, so from this task on every green-gate run issues two identical
  `git diff` calls. The exact-call assertion in `engine.test.ts` is updated in this task; no other
  file observes that count.
- **For Task-84:** once `design/tokens.json` lands, this repository stops skipping: `checkPatch`
  enforces the colour rule on every diff, and `checkDocuments` reports the screens' null states as
  `(report-only)` until L6 writes the specs.
- **`docs/security.md` is deliberately untouched:** D12's guardrail list does not change (a design
  finding is a red gate, not an eighth guardrail) and the batch plan gives this task `docs/jobs.md`
  §5 and the decision row only.
- **Hot file:** this task is the **only** holder of `docs/decisions.md` in the batch (D57). It does
  not touch `TODO.md`, `CHANGELOG.md`, `package.json`, `apps/daemon/src/main.ts` or
  `packages/contracts/src/index.ts`.

## ⛔ Out of scope

- No new gate command, no new run state, no new event type, no new HTTP route, no `CB_*` key.
- No change to `docs/security.md`, `docs/api.md`, `docs/app.md`, `docs/providers.md`,
  `design/**`, `TODO.md`, `CHANGELOG.md`, `AGENTS.md`.
- No refactor of `gating()`, `secretScanStep`, `failRun` or the merge path beyond inserting the
  step; no change to `design-check.ts` or its test.
- No pixel comparison, no new rule name, no promotion of `screen_state_missing` to enforced.

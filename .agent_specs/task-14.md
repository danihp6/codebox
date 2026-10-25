# Spec: Task-14 — Run engine

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** daemon.
- **Role:** Dev.
- **Objective:** after this task the daemon can execute one run end to end as a library:
  clone → worktree → OpenCode session → unattended prompt → local gate → commit → push → PR →
  required checks → D12 guardrails → merge, with cancellation, timeout, cost cap, one
  transport retry and a PR body generated from facts. Every state change is a row in
  `runs`, every event is persisted with a monotonic `seq` and handed to an injected
  emitter, and every external effect lives behind an injected port so the whole flow is
  proven with fakes. No HTTP route is added here: Task-15 owns the API.
- **Environment:** worktree `../wt-cb-14` (absolute `/home/runner/work/codebox/wt-cb-14`),
  branch `task-14`, base `main` at the tip of `origin/main`. Node 24, npm 11, ESM,
  TypeScript.
- **Dependencies:** all merged. Task-05 (`@codebox/core`: `transitionRun`, `canCancel`,
  `evaluateAutoMerge`, `evaluateDiffBudget`, `checkCost`, `checkRunTimeout`,
  `decidePermission`, `classifyTool`, `isInsideWorktree`), Task-07 (`@codebox/opencode`:
  `createNormaliser`, `buildRunEnvelope`, `AgentRuntime`, `AgentError`), Task-08
  (`@codebox/workspaces`: `WorkspaceManager`, `branchName`, `slugifyTitle`, `createGitRunner`,
  `GIT_ENV`), Task-09 (`@codebox/scheduler`, only if you need the tick; it is not required by
  this task), Task-10 (`@codebox/git-provider`: `GitProvider`, `PullRequest`,
  `startFakeGitHub`), Task-11 (`DaemonContext`, `Logger`, `Store`), Task-04
  (`RunRepository`, `EventRepository`, `ApprovalRepository`), Task-03 (`Run`, `RunState`,
  `SseEvent`, `guardrailSchema`, `blockerSchema`, `runDiffSchema`).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/daemon/src/run/**` (new: `ports.ts`, `engine.ts`, `commit.ts`, `pr-body.ts`,
  `events.ts`, `README.md`, `*.test.ts`)
- `apps/daemon/src/gate/**` (new: `run-gate.ts`, `README.md`, `*.test.ts`)
- `apps/daemon/package.json` — add the four `@codebox/*` workspace dependencies listed below,
  nothing else.
- `package-lock.json` — only the lines `npm install --package-lock-only` writes.
- `docs/jobs.md` — §3 "Run lifecycle", §5 "The gate", §6 "Commit, push and PR", §9 "Cancel,
  timeout and cost" **only**.
- `CHANGELOG.md` — **do not touch it**; the Orchestrator writes the entry at merge.

Do **not** create `apps/daemon/src/run/index.ts` or `apps/daemon/src/gate/index.ts`: the
subsystem loader imports `./<name>/index.js` and fails the boot when the file exists without a
`createModule` export. Both subsystems must stay **absent**, which the loader supports. A
test proves it.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/jobs.md` (all), `docs/agent-runtime.md` §2–§9, `docs/architecture.md` §3.3–§3.4,
  `docs/providers.md` §5–§8
- `apps/daemon/src/{main,app,modules,config,logger,health}.ts` and their tests
- `packages/core/src/{index,run-state,guardrails,diff-budget,limits,permissions,protected-paths}.ts`
- `packages/store/src/{index,store,runs,events,approvals,usage,mappers}.ts`
- `packages/opencode/src/{index,types,normalise,prompt,errors,fake}.ts`
- `packages/workspaces/src/{index,types,git,paths,fake?}.ts`
- `packages/git-provider/src/{index,types,fake}.ts`
- `packages/contracts/src/{resources,events,primitives,errors,parse}.ts`

## 🔒 Contract

### `apps/daemon/src/gate/run-gate.ts`

```ts
export interface GateExecution {
  readonly cwd: string;               // the run worktree
  readonly command: string;           // repo.gate || CB_GATE_DEFAULT, never model output
  readonly shell: string;             // CB_GATE_SHELL, default /bin/bash
  readonly timeoutMs: number;         // CB_GATE_TIMEOUT_SECONDS * 1000
  readonly runId: string;
  readonly logFile: string;           // <stateDir>/logs/run-<id>/gate.log
  readonly signal?: AbortSignal;
}

export interface GateExecutionResult {
  readonly status: 'passed' | 'failed';
  readonly exitCode: number;          // 124 timeout, 130 cancelled, 127 spawn failure
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly tail: readonly string[];   // last 100 lines, oldest first
  readonly logFile: string;
}

export interface GateDeps {
  readonly spawn?: typeof import('node:child_process').spawn;
  readonly inheritedEnv?: Readonly<Record<string, string | undefined>>;
}

export function runGate(input: GateExecution, deps?: GateDeps): Promise<GateExecutionResult>;
```

Rules:

- `spawn(shell, ['-lc', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env })`. `detached` is what makes the process-group kill possible.
- Child env is **not** the daemon env: start from `PATH`, `HOME`, `TMPDIR` of
  `inheritedEnv` (default `process.env`) and add exactly `CI=1`, `NO_COLOR=1`,
  `CB_RUN_ID=<runId>`. No other `CB_*`, `GITHUB*`, `OPENCODE*`, `AWS*` or `OCI*` may reach the
  child. A test sets `CB_GITHUB_TOKEN` in the inherited env and asserts the child's `env`
  output does not contain it.
- stdout and stderr are appended verbatim to `logFile` (create the directory, mode 0750) and
  the last 100 lines are kept in memory; each retained line is truncated to 2 000 characters.
- timeout → `process.kill(-pid, 'SIGTERM')`, wait 2 000 ms, then `process.kill(-pid,
  'SIGKILL')`; result `status: 'failed'`, `exitCode: 124`, `timedOut: true`.
- abort → same kill sequence; `status: 'failed'`, `exitCode: 130`, `cancelled: true`.
- `runGate` never rejects: a spawn error is `status: 'failed'`, `exitCode: 127`, with the
  message as the single tail line.
- A clean `exit 0` is `status: 'passed'`, `cancelled: false`, `timedOut: false`.

### `apps/daemon/src/run/ports.ts`

```ts
export interface RunPorts {
  readonly workspaces: Pick<WorkspaceManager,
    'ensureClone' | 'createWorktree' | 'removeWorktree' | 'writeRunMarker' | 'status'>;
  readonly agent: Pick<AgentRuntime,
    'createSession' | 'prompt' | 'subscribe' | 'interrupt' | 'closeSession'>;
  readonly git: Pick<GitProvider,
    'getRepo' | 'pushBranch' | 'openPullRequest' | 'getPullRequest' | 'getChecks'
    | 'mergePullRequest' | 'deleteBranch'>;
  readonly gitRunner: GitRunner;      // @codebox/workspaces; used only by commit.ts
  readonly gate: typeof runGate;
  readonly store: Store;
  readonly clock: () => Date;
  readonly logger: Logger;
  readonly emit: (event: EventRecord) => void;   // the SSE hub, injected by Task-13
  readonly spentTodayUsd: () => number;
  readonly settings: RunSettings;
}

export interface RunSettings {
  readonly gateDefault: string;
  readonly gateShell: string;
  readonly gateTimeoutSeconds: number;
  readonly runTimeoutSeconds: number;
  readonly dailyCostUsd: number;
  readonly automerge: 'on' | 'off';
  readonly mergeMethod: 'squash' | 'merge';
  readonly protectedPaths: readonly string[];
  readonly diffMaxFiles: number;
  readonly diffMaxLines: number;
  readonly probationRuns: number;
  readonly consecutiveGreenRuns: number;
  readonly logsDir: string;
  readonly author: { readonly name: string; readonly email: string };
  readonly gitTimeoutMs: number;
}

export interface RunStartInput {
  readonly runId: string;                       // caller-minted `run_…`, so the API can answer before the run exists
  readonly repo: {
    readonly id: string;
    readonly slug: string;
    readonly defaultBranch: string;
    readonly gate: string | null;               // repo.gate, nullable
    readonly policy: 'auto' | 'manual';
    readonly protectedPaths: readonly string[];
    readonly cloneUrl: string;                  // credential-bearing; never logged
  };
  readonly jobId: string | null;
  readonly trigger: 'schedule' | 'manual' | 'promote' | 'revert' | 'retry';
  readonly title: string;
  readonly prompt: string;
  readonly agent: string;
  readonly model: string | null;
  readonly baseRef?: string;                    // default repo.defaultBranch
}

export interface RunOutcome {
  readonly runId: string;
  readonly state: 'succeeded' | 'failed' | 'cancelled' | 'pr_open';
  readonly pr: PullRequest | null;
  readonly gate: GateExecutionResult | null;
  readonly blockers: readonly MergeBlocker[];
  readonly failure: { readonly code: string; readonly message: string } | null;
}

export interface RunEngine {
  start(input: RunStartInput): Promise<RunOutcome>;   // never throws
  cancel(runId: string, reason?: 'operator' | 'timeout' | 'cost_cap_reached'): Promise<boolean>;
  active(): readonly string[];
}

export function createRunEngine(ports: RunPorts): RunEngine;
```

`start()` must be safe to call concurrently for two different `runId`s; one engine instance
owns at most one in-flight entry per run id (`active()` returns those ids).

### The flow (state writes and event order are the contract)

Every transition goes through `transitionRun` from `@codebox/core` — an illegal edge is a bug,
not a skip. Every event is persisted with `store.events.append({ runId, chatId: null,
seq: store.events.nextSeq({ runId }), type, data, ts })` and then passed to
`ports.emit(record)`. Data shapes come from `packages/contracts/src/events.ts` and include the
`runId`, `seq` and `ts` base fields of `runEventBase`; do not invent a field.

1. **queued.** `store.runs.create` with `branch: branchName(runId, title)`,
   `baseRef`, `prompt`, `agent`, `model`, `gateCommand: repo.gate ?? settings.gateDefault`,
   `attempt: 1`, `createdAt`, `cost: { usd: 0, tokensIn: 0, tokensOut: 0 }`, empty
   `guardrails`/`blockers`. Emit `run.queued`.
2. **preparing.** `workspaces.ensureClone({ slug, defaultBranch, cloneUrl })`,
   `workspaces.createWorktree({ repo, runId, baseRef, title })`,
   `workspaces.writeRunMarker(worktree, { runId, repoSlug, branch, baseRef, baseSha,
   promptHash: sha256Hex(prompt), createdAt })`. Persist `baseSha`, `worktree`, `startedAt`.
3. **running.** `agent.createSession({ title: \`cb-run-${runId}\`, directory: worktree.path,
   agent, model })`, persist `sessionId`, emit `run.started { branch }`. Build
   `createNormaliser({ scope: { kind: 'run', runId, branch }, nextSeq: () =>
   store.events.nextSeq({ runId }), now: () => clock().toISOString(), resolveApproval })`,
   then `agent.prompt(sessionId, buildRunEnvelope({ repo: slug, baseBranch, branch, prompt }))`.
   For every raw event from `agent.subscribe({ sessionId })`: normalise, persist and emit each
   event; stop on outcome `idle` (success), `error` (fail with `failure.code =
   agent_unavailable | protocol`), or after the run timeout.
   `resolveApproval` decides with `classifyTool` + `decidePermission` (mode `run`): `allow` →
   `agent.replyPermission(sessionId, permissionId, 'once')` and **no** approval row; `deny` →
   reply `'reject'`; `ask` → create an `approvals` row `pending` with
   `expiresAt = now + CB_APPROVAL_TTL_SECONDS`, emit `approval.created`, and reply `'reject'`
   when it expires (no human is watching a scheduled run). Return the permission id.
4. **gating.** `workspaces.status(worktree, repo.protectedPaths)` gives the diff, the changed
   paths, the protected hits and `commitsAhead`; `runGate` runs the stored `gateCommand`.
   Persist `gate: { status, exitCode, durationMs }` and the `diff`; emit `run.gate`.
   - **failed** → persist state `failed`, `failureCode: 'gate_failed'`, `finishedAt`, emit
     `run.failed { code: 'gate_failed', message }`, **keep the worktree**, return. Nothing is
     pushed and no PR exists (fix the §6 sentence in `docs/jobs.md` that still says "draft PR
     when the gate failed").
5. **pr_open.** If `commitsAhead === 0`, `commitWorktree` (below) creates one commit with the
   job title as subject and `Codebox-Run: <runId>` as the trailer. `git.pushBranch({ repo,
   worktree: worktree.path, branch })`. Build the PR body with `buildPrBody` (below) and
   `git.openPullRequest({ ... draft: false, labels: ['cb:auto-merge'] })`. Persist `pr` and the
   `diff`; emit `run.pr { pr }`. Read `git.getChecks({ repo, number, headSha, baseRef })` and
   evaluate `evaluateAutoMerge` with facts built from the row and the provider — the exact
   eight guardrails, `budget` from `settings`, `policy` from the repo and job (this engine has
   no job policy yet: use `'auto'` for the job), `automerge` from `settings`, `probationRuns`
   and `consecutiveGreenRuns` from settings, `base.recordedSha` = the worktree's `baseSha`,
   `base.currentSha` = the PR's `baseSha`, `diff` from the status, `changedPaths`,
   `protectedPaths`, and `checks` from `getChecks`.
   - any blocker → persist state `pr_open`, `guardrails`, `blockers`, `finishedAt: null`,
     emit nothing further, return `RunOutcome` with those blockers. **Not** `failed`.
6. **merging.** Only when `evaluation.merge` is true: persist `merging`,
   `git.mergePullRequest({ repo, number, method: settings.mergeMethod, commitTitle:
   \`${title} (#${number})\`, commitMessage: trailer, sha: pr.headSha })`. On `merged: false`
   with `retryable: true`, re-read the PR and checks **once**, re-evaluate, and retry the merge
   once; a second refusal parks the run in `pr_open` with the matching blocker (`base_moved`,
   `checks_red`, `not_mergeable`). On success: `git.deleteBranch`, remove the worktree, persist
   `succeeded` + `finishedAt`, emit `run.merged { pr, mergeCommit, method }` then
   `run.finished { state: 'succeeded' }`.
7. **failed anywhere else.** Persist `failed`, `failureCode` (`agent_unavailable`,
   `provider_unavailable`, `workspace_error`, `internal`, `timeout`, `cost_cap_reached`),
   `failureMessage` with no token, URL or upstream body, `finishedAt`; emit `run.failed
   { code, message }`; release the session (`closeSession`, best effort); keep the worktree
   when the failure is useful to inspect (agent or gate), remove it when preparing never
   produced one. Never throw out of `start()`.

### Cancellation, timeout, cost and retry

- `cancel(runId)` returns `false` for an unknown id, a terminal run, or state `merging`
  (`canCancel` is the authority). Otherwise it aborts the gate signal, calls
  `agent.interrupt(sessionId)` then `closeSession`, removes the worktree (a run that never
  reached `pr_open` has nothing to inspect; a run in `pr_open` keeps it for retention), sets
  `cancelled` + `finishedAt`, emits `run.cancelled { state: 'cancelled', reason }` and returns
  `true`.
- The run timeout is checked before each step and on every normalised event with
  `checkRunTimeout({ startedAt, now, timeoutSeconds: settings.runTimeoutSeconds })`; expiry is
  a cancel with `reason: 'timeout'` and `failureCode: 'timeout'`.
- After every usage signal (`NormalisationResult.usage`), persist
  `cost = { usd: cumulative, tokensIn, tokensOut }` and run
  `checkCost({ spentTodayUsd: ports.spentTodayUsd(), dailyCapUsd: settings.dailyCostUsd,
  runCostUsd: cumulative, jobMaxCostUsd: null })`; `allowed: false` is a cancel with the
  returned `code`.
- One transport retry: if the agent fails with `agent_unavailable` **before** the first
  `run.tool` event, re-open a session once, set `attempt: 2` and re-prompt; a second failure
  fails the run. A retry never resumes a run and never reuses a partial commit.

### `apps/daemon/src/run/commit.ts`

```ts
export function commitWorktree(input: {
  readonly worktree: string;
  readonly subject: string;        // the job title, ≤ 72 characters after trimming
  readonly body: string;           // "Codebox-Run: <runId>"
  readonly author: { readonly name: string; readonly email: string };
  readonly git: GitRunner;
  readonly timeoutMs: number;
}): Promise<{ readonly sha: string; readonly created: boolean }>;
```

`created: false` when the worktree already has commits ahead of base (the caller decides
that; this function is only called when it must commit). It runs, in this order and through
the injected runner only: `add -A`, `commit --no-verify -m <subject> -F -` with the trailer
(the body is passed as stdin, never interpolated into a shell), `rev-parse HEAD`. It never
spawns `git` itself and never touches `process.env`.

### `apps/daemon/src/run/pr-body.ts`

```ts
export function buildPrBody(input: {
  readonly title: string;
  readonly runId: string;
  readonly jobId: string | null;
  readonly agent: string;
  readonly model: string | null;
  readonly agentMessage: string;      // trimmed to 2 000 characters
  readonly gate: GateExecutionResult;
  readonly diff: RunDiff;
  readonly guardrails: readonly GuardrailFact[];
  readonly blockers: readonly MergeBlocker[];
}): string;
```

The sections are exactly docs/jobs.md §6: title, the `Run: … · Job: … · Agent: … · Model: …`
line, `### What changed`, `### Gate` (command, exit code, duration and the last 20 lines in a
collapsed block), `### Diff` (`n files · +a −r`), `### Guardrails` (one `- [x]` / `- [ ]` line
per guardrail in table order, with the blocker reason after the failing one). No token, no
clone URL, no absolute host path.

### Dependencies to declare

Add to `apps/daemon/package.json` `dependencies`, version `0.0.0` like the others:
`@codebox/core`, `@codebox/opencode`, `@codebox/workspaces`, `@codebox/git-provider`. Then
`npm install --package-lock-only --no-audit --no-fund` so the lockfile records them; commit
only that. Do not bump any version and do not add an external package.

## 🧩 Configuration

No new `CB_*` key; `packages/contracts` already carries every value the engine reads
(`CB_GATE_DEFAULT`, `CB_GATE_SHELL`, `CB_GATE_TIMEOUT_SECONDS`, `CB_RUN_TIMEOUT_SECONDS`,
`CB_DAILY_COST_USD`, `CB_AUTOMERGE`, `CB_MERGE_METHOD`, `CB_PROTECTED_PATHS`,
`CB_DIFF_MAX_FILES`, `CB_DIFF_MAX_LINES`, `CB_PROBATION_RUNS`,
`CB_APPROVAL_TTL_SECONDS`, `CB_GIT_AUTHOR_NAME`, `CB_GIT_AUTHOR_EMAIL`,
`CB_GIT_HTTP_TIMEOUT_SECONDS`). `RunPorts.settings` is filled by the caller (Task-15) from
those keys; this task does not read `process.env`.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `CHECKPOINT_DISABLE=1 npm run lint` — must pass.
  - `CHECKPOINT_DISABLE=1 npm test` — Vitest, headless. The baseline suite is green on
    `main`; no pre-existing test may be modified.
  - `CHECKPOINT_DISABLE=1 npm run build` — every workspace, including the daemon.
  - `git diff --name-only origin/main...task-14` — audit against the exclusive paths.
- **Fakes available (do not re-invent them):** `startFakeOpenCode` (`@codebox/opencode`),
  `startFakeGitHub` (`@codebox/git-provider`), in-memory `WorkspaceManager` and `GitRunner`
  doubles written in the test file, and `openInMemoryStore()` (`@codebox/store`).
- **Acceptance criteria:**
  - [ ] `[unit]` Lint, tests and build are green.
  - [ ] `[unit]` **Happy path:** a fake successful run walks
        `queued → preparing → running → gating → pr_open → merging → succeeded`, each state
        written exactly once in that order (assert against the recorded `runs.update` calls
        **and** `store.runs.get(runId).state`), and appends exactly
        `run.queued, run.started, run.gate, run.pr, run.merged, run.finished` in that order with
        strictly increasing `seq`. Every event body parses with `parseSseEvent`.
  - [ ] `[unit]` **Red gate:** a gate that exits 1 never reaches `merging`, never calls
        `pushBranch` / `openPullRequest`, ends `failed` with `failureCode === 'gate_failed'`,
        emits `run.gate` then `run.failed`, and keeps the worktree (`removeWorktree` not
        called).
  - [ ] `[unit]` **Protected path:** a status whose `changedPaths` include
        `ops/vm/install.sh` reaches `pr_open` with a `protected_path` blocker, exactly eight
        guardrails in `GUARDRAIL_IDS` order, `mergePullRequest` never called.
  - [ ] `[unit]` **Base moved / checks red:** each parks the run in `pr_open` with the
        matching blocker; a retryable merge refusal is retried exactly once and a second
        refusal parks.
  - [ ] `[unit]` **Cancel during running:** `cancel(runId)` resolves `true`,
        `agent.interrupt` and `closeSession` were called with the session id,
        `removeWorktree` was called, the row is `cancelled`, `run.cancelled` was emitted, and
        `cancel` on a `merging` run resolves `false` without side effects.
  - [ ] `[unit]` **Timeout:** with `runTimeoutSeconds: 1` and a fake clock advanced by 2 s, the
        run ends `cancelled` with `failureCode === 'timeout'`.
  - [ ] `[unit]` **Cost cap:** a usage signal that crosses `dailyCostUsd` ends the run
        `cancelled` with `cost_cap_reached` and the cumulative cost persisted.
  - [ ] `[unit]` **One retry:** `agent_unavailable` before the first tool event re-opens the
        session once, sets `attempt: 2` and succeeds if the second attempt does; two failures
        end `failed`. A failure **after** a tool event is not retried.
  - [ ] `[unit]` **Gate runner:** `runGate` passes on `true`, fails with the child's exit
        code, writes `gate.log` with the full output, keeps at most 100 tail lines, returns
        `exitCode: 124, timedOut: true` for a `sleep 10` with `timeoutMs: 100` and leaves no
        child process behind, and exposes no inherited `CB_GITHUB_TOKEN` to the child (the
        child prints its env). A spawn failure is `127`, never a rejection.
  - [ ] `[unit]` **Commit and PR body:** `commitWorktree` against a real temporary git
        repository creates one commit whose body carries `Codebox-Run: <runId>` and returns its
        sha; a worktree the fake runner reports as already clean is not committed twice.
        `buildPrBody` renders every section, checks the box for a passing guardrail and leaves
        it empty with the reason for a failing one, and never contains the clone URL or a
        token.
  - [ ] `[unit]` **Module seam:** `loadModules` reports `run` and `gate` as `absent`, not
        `failed`, and `startDaemon` still boots with an ephemeral port and a temporary
        `CB_STATE_DIR`.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched.
  - [ ] `[live]` Not measurable on the pipeline host: a real run on a scratch repository opens
        a PR and merges only after the gate and the checks are green. The Orchestrator opens
        the `agent-review` issue; the dev does not claim it.

## 📣 Coordination

- For Task-15 (next batch): construct `RunPorts` from `DaemonContext` + config + the real
  `@codebox/opencode`, `@codebox/workspaces` and `@codebox/git-provider` implementations, and
  call `createRunEngine(ports).start(...)` after inserting the idempotency record. The engine
  creates the run row, so the API must mint the `run_…` id first and return it. `emit` is
  Task-13's SSE hub. Do not re-implement state transitions, event ordering or the PR body.
- For Task-13: `emit(record)` receives the same `EventRecord` that was persisted; the hub can
  fan it out without re-reading the store.
- For the Architect: `docs/jobs.md` now says what the engine does — a red gate pushes nothing
  and opens no PR, and a cancel during `running` removes the worktree. §7 and §8 are
  unchanged.
- For the Orchestrator: this task holds `package-lock.json` and `apps/daemon/package.json` for
  the batch; no other in-flight task may touch them.

## ⛔ Out of scope

- No HTTP route, no CLI, no SSE hub, no scheduler tick (Tasks 13, 15, 17).
- No new migration, no new table, no change to `packages/*`.
- No new external dependency; only the four workspace packages above.
- No change to `apps/daemon/src/main.ts`, `app.ts`, `modules.ts` or `config.ts`.
- No revert, no probation bookkeeping, no notification transport (Tasks 15, 16, 26).

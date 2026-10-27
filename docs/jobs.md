# Schedules, runs and auto-merge

A schedule is a saved intention: a prompt, a time rule and an optional repository (D44). A run
is one execution of it. This document owns the state machine, the gate, the PR and the
guardrails that decide whether a green run may merge itself (D11, D12). The guardrail functions
live in `packages/core` and are tested as pure functions; this file is their specification.

## 1. The one recurring object: Schedule

A **schedule** carries a prompt, a time rule and an optional repository (D44), and it is the one
recurring object the daemon owns end to end.

- **With a repository** it produces a **run**: a worktree, the gate, a PR and the merge decision
  of D11/D12 — everything §3–§14 specify.
- **Without one**, or bound to a chat, it produces a **chat turn** on the fire path of §15.

`mode` is `once`, `every` or `window`, and the schedule id prefix is `sch_`. §16 owns the field
table, the three modes, the claim and the routes — §16.1 is the window loop — and the API object
is [`docs/api.md`](api.md) §5.10.

## 1.1 Legacy jobs

The `jobs` table, `POST /v1/jobs` and the job screens still exist on `main`: they are retained
for compatibility and they are not the product's path. A row is still served, still fires and
still owns its runs through `runs.jobId`; what D44 changed is which object the product creates,
and `runs.jobId` is null for every run a schedule creates. Retiring the table needs the app
screens, the routes and `runs.job_id` in one change, so it is a later batch.

| Field | Type | Rules |
| --- | --- | --- |
| `repoId` | id | Must be a registered, enabled repository. |
| `title` | string | 1–80 chars, shown in notifications. |
| `prompt` | string | 1–8 000 chars, wrapped in the unattended envelope. |
| `mode` | `work` \| `chat` | `work` opens a branch and a PR; `chat` never leaves the worktree. |
| `agent` | string | An OpenCode agent name; defaults to `CB_DEFAULT_AGENT`. |
| `model` | string? | `provider/model`; defaults to `CB_DEFAULT_MODEL`. |
| `cron` | string? | 5-field expression; absent = manual only. |
| `timezone` | IANA | Defaults to `CB_TIMEZONE`. |
| `enabled` | boolean | A paused row is not selected by the scheduler. |
| `policy` | `auto` \| `manual` | Auto-merge opt-in per row; the repo can forbid it. |
| `maxCostUsd` | number? | Optional per-run cap below the global one. |

A job belongs to exactly one repository. "Run now" is a manual trigger of the same definition,
not a second one.

## 2. Scheduling

- **5-field cron** (minute hour day-of-month month day-of-week) in an **IANA timezone**
  (D13). No seconds, no `@daily` aliases, no cron dialect beyond the standard five fields.
- **DST** is resolved by the zone: a time that does not exist (spring forward) fires at the
  first valid instant after it; a time that happens twice (fall back) fires once, at the
  first occurrence.
- **Misfire:** on boot or after a pause, a fire missed by less than
  `CB_MISFIRE_GRACE_SECONDS` (900) runs once; older misses are logged once and skipped. No
  catch-up storm.
- **One fire per tick:** only an enabled schedule whose `next_fire_at` is at or before the tick
  is a candidate. Each candidate ends in exactly one decision — due inside the grace window,
  skipped outside it — plus one `next_fire_at` written in the same transaction as the claim
  and recomputed from the tick instant, never from the missed fire. A schedule is never both
  due and skipped, and never claimed twice for the same `next_fire_at`.
- **Claiming:** the scheduler ticks every `CB_SCHEDULER_TICK_SECONDS` (15) and claims due rows in
  one SQLite transaction with `UNIQUE(schedule_id, scheduled_for)`. Two ticks cannot both win.
- **Queue order:** `scheduled_for`, then `created_at`, then the schedule id, so two ticks of the
  same rows are identical. A cap on claims truncates that order after sorting; the schedule left
  out keeps its `next_fire_at` for the next tick. Manual runs sort with the current time.
- **Preview:** `GET /v1/jobs/{id}/next` returns the next five fires after now in the schedule's
  own zone; an invalid cron or an unknown zone previews as an empty list.
- **Concurrency:** at most `CB_MAX_CONCURRENCY_PER_REPO` (1) run per repository and
  `CB_MAX_CONCURRENCY` (3) runs globally; both must be at least 1. A run that cannot start
  stays `queued`; it does not fail. The rule is `canAdmitRun` in `@codebox/core` and the
  waiting list is `planAdmission` in `@codebox/scheduler`: the waiting runs are ordered by
  repository, then `created_at`, then the run id, so two identical ticks admit the same
  runs. A slot that frees goes to the first waiting run whose repository is free.
- **Pause:** `enabled=false` removes it from selection; resuming recomputes the next fire from
  now, never from the missed schedule.
- **Owner:** `packages/scheduler` holds these rules as pure functions over a row plus the tick
  instant; `@codebox/core` owns the cron arithmetic and the grace decision.
- **Schedules:** this list is the schedule's rule set (D44). §16 repeats it with the object:
  five cron fields, one IANA zone, the same DST rule, the same grace, one claim per
  `(schedule_id, scheduled_for)` and a pause that recomputes from now. Its `window` mode swaps
  the cron for the D46 loop of §16.1, which the same tick drives.

## 3. Run lifecycle

```
queued → preparing → running → gating → pr_open → merging → succeeded
   │         │          │         │         │         │
   └─────────┴──────────┴─────────┴─────────┴─────────┴──> failed | cancelled
```

| State | Enters when | Leaves when | Event |
| --- | --- | --- | --- |
| `queued` | Claimed or created manually | A slot and a worktree exist | `run.queued` |
| `preparing` | Clone/fetch and worktree creation start | The OpenCode session exists | `run.started` |
| `running` | The session exists and the envelope is sent | The agent is idle, or a timeout/cancel | `run.output`, `run.tool` |
| `gating` | Agent finished | The gate exits | `run.gate` |
| `pr_open` | Branch pushed, PR opened | All guardrails pass, or a blocker stops the run | `run.pr` |
| `merging` | Guardrails green and merge started | GitHub confirms the merge | `run.merged` |
| `succeeded` | Merge confirmed, branch deleted | — | `run.finished` |
| `failed` | Any step errored | — | `run.failed` |
| `cancelled` | The operator or a cap cancelled it | — | `run.cancelled` |

Rules:

- Every transition is persisted with its event in the same transaction; the app's timeline
  and the audit log cannot disagree. The run engine (`apps/daemon/src/run/engine.ts`) is the
  single writer of `runs` and `run_events` during a run: the API mints the `run_…` id first
  and the engine creates the row as `queued`.
- `pr_open` is an outcome, not an error. A guardrail refusal parks the run there with its
  guardrails and blockers and emits nothing further; only a failed step ends `failed`.
- The table is data in `@codebox/core` (`RUN_TRANSITIONS`) and every move goes through
  `transitionRun(from, to)`, which returns either `{ allowed: true, from, to }` or
  `{ allowed: false, from, to, code, message }` with `same_state`, `terminal_state` or
  `illegal_transition`. The daemon writes the event only for an allowed outcome and maps the
  rejection to a 409.
- `TERMINAL_STATES` is `succeeded`, `failed`, `cancelled`; nothing leaves them.
  `CANCELLABLE_STATES` is `queued`, `preparing`, `running` and `gating` (`canCancel`).
- `merging → pr_open` is the re-evaluation path of §8, not a second lifecycle: it happens
  once, when the merge call answers 405/409 and the guardrails are re-evaluated against fresh
  facts. It is the only edge that points backwards.
- No state moves backwards otherwise. A retry is a **new run**, never a resumed one.
- `merging` is atomic: cancel is refused there (409), and recovery is a revert. The refusal is
  the caller's (`canCancel('merging') === false`); the transition table reports
  `illegal_transition` for `merging → cancelled` like any absent edge.
- A run records the exact prompt, the agent, the model, the base commit and the gate command
  before it starts.

## 4. Preparing

1. `ensureClone(repo)`: bare clone under `/srv/codebox/repos/<owner>__<name>.git`, fetched with
   `--prune`. A failed clone leaves no half directory.
2. `createWorktree(runId, baseRef)`: `/srv/codebox/worktrees/<runId>`, branch
   `cb/<runId>-<slug>`; `slug` is a kebab-case slice of the title, at most 40 chars.
3. Write `.git/codebox-run.json` inside the worktree: run id, repo, base sha, prompt hash.
4. Start the OpenCode session in that directory and send the envelope.

A dirty or missing worktree is a hard failure, never a fallback to the repository cache.

## 5. The gate

The gate is the repository's own check, run in the worktree before any PR exists:

```bash
/bin/bash -lc "<the repo's gate, or CB_GATE_DEFAULT>"
```

- The repository's `gate` field wins; `CB_GATE_DEFAULT` is the fallback. Neither is
  interpolated by the model, and the command is stored on the run before it starts.
- Default `npm test && npm run build`; a repo can override it. CI of record stays GitHub
  Actions when the repo has it (product §"not a general CI").
- Timeout `CB_GATE_TIMEOUT_SECONDS` (1 800); on timeout the process group is killed. The gate
  runs detached, so `SIGTERM` and then `SIGKILL` reach every child it spawned; the result is
  exit `124` and `timedOut: true`. A cancel aborts the same group and reports `130`; a shell
  that cannot start is `127` and never rejects the caller.
- Environment: the run's allowlist, not the daemon's. `CI=1`, `NO_COLOR=1`, and `CB_RUN_ID`
  (the run's id, for a gate that wants to name its artifact). `CB_RUN_ID` is set for the
  child; it is not a configuration key. Nothing else crosses over: a `CB_GITHUB_TOKEN` in the
  daemon's environment is not visible to the gate.
- Output is captured to `logs/run-<id>/gate.log` (directory mode `0750`); the last 100 lines
  (each at most 2 000 characters) and the exit code are attached to the run and the PR.
- **A green gate is scanned for secrets before anything is pushed.** The daemon reads
  `git diff --no-color --unified=0 --no-ext-diff <baseSha> --` in the worktree and scans the
  **added** lines of that patch for nine patterns: a PEM private key, `github_pat_`, `ghp_`/
  `gho_`/`ghu_`/`ghs_`/`ghr_`, `sk-ant-`, `sk-`, an `AKIA`/`ASIA` access key, a JWT, a
  `xox?-` Slack token and a `secret|token|password|api_key = "<value>"` assignment. A hit, or a
  patch over 4 MiB, turns the gate result into `failed` with exit `1`, appends
  `<path>:<line> <pattern>` (or `secret_scan: patch exceeded 4194304 bytes`) to the gate tail and
  its log, and logs one `secret_scan_failed` line with the count and the flags — never the
  matched text, never the diff. A diff git cannot produce is `secret_scan: git_failed` and fails
  the same way: a gate that cannot read the diff does not pass. A line carrying
  `codebox-secret-scan: allow`, or a value that is obviously a placeholder (`[redacted]`,
  `example`, `placeholder`, `changeme`, `dummy`, `replace`, `your_`, `xxxx`), is skipped.
- A red gate stops the run **before** the PR: it pushes nothing, opens no PR, and the run ends
  `failed` with `gate_failed`. The worktree is kept for inspection.

## 6. Commit, push and PR

- One commit is created by the daemon if the agent did not commit: subject from the schedule
  title (trimmed to 72 characters), body with the run trailer `Codebox-Run: <runId>` (D25),
  written with the configured author through the injected git runner. Nothing is committed
  twice: a clean index returns the current `HEAD` and leaves the history alone.
- The branch is pushed with the installation token; the author is `codebox[bot]`.
- The PR body is generated, not written by the model:

```markdown
## <schedule title>

Run: run_01J… · Schedule: sch_01J… · Agent: build · Model: …

### What changed
<the agent's final message, trimmed>

### Gate
`npm ci && npm test && npm run build` — exit 0 in 3m 04s
<last 20 lines, collapsed>

### Diff
6 files · +184 −22

### Guardrails
- [x] gate
- [x] checks
- [x] base
- [x] diff
- [x] protected_paths
- [x] labels
- [x] policy
- [x] automerger
```

A failing guardrail is `- [ ] <id> — <blocker message>`; the eight ids are the
`GuardrailId` vocabulary in `GUARDRAIL_IDS` order, rendered from the same evaluation that
decides the merge. The body is built when the PR opens, before the provider's checks and base
sha exist, so its guardrail section carries the facts known at that moment; the merge decision
is a second evaluation against the PR.

- A PR exists only after a green gate: a red gate pushes nothing and opens no PR, so there is
  no draft for it. The PR is always normal (`draft: false`).
- Labels: `cb:auto-merge` when the PR opens; `cb:needs-review` when a guardrail parks it;
  `do-not-merge` is honoured as an operator veto. `cb:gate-failed` is unused: a red gate never
  reaches a PR.
- Idempotency is by branch: a second push to the same branch updates the existing PR instead
  of opening a duplicate.
- The push comes from `@codebox/git-provider` over an injected git runner; the run engine never
  spawns `git` itself. The installation token appears only inside the remote argument of that
  one `git push`: it is never logged, never returned and never persisted. A 401 from GitHub
  invalidates the cached installation token and retries the same request once; a second 401
  fails the step, and a daemon with no credential at all fails the step read-only.
- The check summary the guardrails read is the provider's: the head sha's check runs joined
  with the base branch's required-status-checks rule. When that rule cannot be read (404/403)
  every check on the head sha counts as required, so an unknown rule fails closed; a check that
  is not `completed` counts as pending.
- The PR is looked up by `owner:branch` before it is created, and the labels above are applied
  only once the PR number exists. That is what makes a retried push a patch, not a second PR.

## 7. Guardrails (D12)

Auto-merge requires **all** of the following. A single failure leaves the PR open and
notifies once.

| # | Guardrail id | Check | Failure code |
| --- | --- | --- | --- |
| G1 | `gate` | local gate exited 0 | `gate_failed` |
| G2 | `checks` | every required check on the head sha is `success` | `checks_red` |
| G3 | `checks` | `mergeable: true`, no conflict (reported on the `checks` guardrail; the contract has no id for it) | `not_mergeable` |
| G4 | `base` | base sha equals the one recorded at prepare | `base_moved` |
| G5 | `diff` | ≤ 40 files and ≤ 2 000 changed lines | `diff_budget` |
| G6 | `protected_paths` | no file matches `CB_PROTECTED_PATHS` | `protected_path` |
| G7 | `labels` | no `do-not-merge` label | `label_do_not_merge` |
| G8a | `policy` | repo and the unit that fired the run are `auto` — contract field `policy.job` — probation met | `policy_manual` |
| G8b | `automerger` | `CB_AUTOMERGE=on` | `automerger_off` |

The failure codes are the `@codebox/contracts` `BlockerCode` vocabulary, and the guardrail
ids are its `GuardrailId` vocabulary: the app renders those codes and this document does not
invent a second spelling.

G5 counts `git diff --numstat` against the base, so a rename counts as its real line delta.
G6 matches with glob semantics against the normalised repo-relative path, including files
added, modified, renamed and deleted. The default list is in `docs/providers.md`.

The evaluation is one pure function:

```ts
evaluateAutoMerge(facts: MergeFacts): {
  merge: boolean;
  guardrails: GuardrailFact[];
  blockers: MergeBlocker[];
}
```

`MergeFacts` includes the gate result, checks, PR state, base shas, diff stat, changed paths,
labels, policy, diff budget, protected paths and the global switch. `guardrails` holds exactly
eight entries in the order of the table, a passing one is `{ id, state: 'pass' }` and a failing
one carries `reason: <blocker code>`; `blockers` is empty if and only if `merge` is true. The
app renders both arrays verbatim; it never re-derives a guardrail from a string.

## 8. Merge

- Method `CB_MERGE_METHOD` (`squash` default, or `merge`). Squash subject: the schedule title
  plus `(#<pr>)`; the body keeps the trailer.
- The merge is attempted once. A 405/409 (head moved, check re-ran) is re-evaluated once
  against fresh facts; a second failure parks the run in `pr_open`.
- After the merge: delete the branch, remove the worktree (retention still applies to the
  log), emit `run.merged` and `run.finished`, notify.
- If the merge succeeded but the app never saw the event, the next fetch reconciles from
  GitHub by PR number. The database is not the only record of a merge.

## 9. Cancel, timeout and cost

| Trigger | Effect |
| --- | --- |
| Operator cancel | Interrupt the session, close it, abort the gate's process group, stop the gate, remove the worktree (a run that never reached `pr_open` has nothing to inspect), keep the branch. The row becomes `cancelled` with `finishedAt`, and `run.cancelled` carries the reason. |
| `CB_RUN_TIMEOUT_SECONDS` | The same cancel, checked before every step and on every agent event, with `failureCode: 'timeout'` and `reason: 'timeout'`. |
| Daily cost cap | Cancel the current run after persisting the cumulative cost, pause the queue until the next UTC day, code `cost_cap_reached`. |
| `maxCostPerFireUsd` | Cancel that fire only; the per-repository policy still applies. |
| Disk low | Refuse new runs, clean past-retention worktrees, emit `telemetry`. |

A cancel is refused — `cancel()` answers `false` without touching the session or the worktree —
for an unknown id, a terminal run, and a run in `merging`, where `canCancel` is the authority.
A run parked in `pr_open` is not cancellable either: its PR is the operator's to close.

Cancel during `merging` is refused: the merge call is not interruptible, and a half-merged
state is worse than a late one.

## 10. Retries

- A failed run is never resumed. "Retry" creates a new run with the same schedule and prompt, a
  new id and a new branch, so history stays honest.
- Automatic retry exists only for **transport** failures before the first tool call: one
  retry, same run id, `attempt: 2` recorded.
- A misfire is not a retry; it is a missed schedule handled by D13.

## 11. Probation

`CB_PROBATION_RUNS` (default 0) makes G8 stricter: a repository with `policy: auto` still
waits for a tap until it has N consecutive green runs with no protected-path diff and no
revert. Probation is per repository and resets on any red run or revert in that repo.

## 12. Revert

`POST /v1/runs/{id}/revert` creates a new run whose prompt is a deterministic instruction to
revert the merge commit, on a fresh branch, through the same gate and guardrails. It is not an
emergency override: if the gate fails, the revert does not merge either. The original run
keeps a link to its revert.

## 13. Notifications

One push per **outcome**, not per event:

| Event | Push |
| --- | --- |
| `run.finished` (succeeded) | "Merged: <schedule title>" with the PR link. |
| `run.failed` | "Run failed: <code>" with the run link. |
| `run.pr` with blockers | "Waiting on you: <first blocker>". |
| `approval.created` | The permission card, for a row written before the inline decision landed; a fresh install's inbox is empty by construction. |
| `telemetry` with `disk_low` / `cost_cap` | A blocking banner plus one push. |

Quiet hours hold everything except a legacy `approval.created` and failures of a schedule marked
critical.

## 14. What a run never does

- Never pushes to `main` or to the base branch.
- Never merges without the full G1–G8 set.
- Never touches a protected path with auto-merge on.
- Never waits for a permission answer: an `ask` is answered `reject` in place, so no run stalls
  on an operator who is asleep (D45).
- Never retries itself in a loop, and never reuses a worktree.
- Never rewrites history: no force-push, no amend of a pushed commit.

## 15. Routines (chat schedules)

A routine is **not** a run. It is a cron entry with a `kind` (D38):

- `reminder` — push only, no model, no session, no worktree. "Remind me to take the pill."
- `prompt` — the daemon appends an `origin: routine` message to its `chatSessionId`, or creates
  a new chat session for the routine when it has none or the old one was archived, sends it to
  OpenCode and streams the reply; the chat stays a chat (D36).

The **chat agent creates them** through the `routine.create` tool; unattended run agents never
get the tool. The app can list, pause, run now and delete, but creation is conversational. The
scheduler claims `(routine_id, scheduled_for)` transactionally and uses the same D13 misfire
rule as a schedule. A `prompt` with no `chatSessionId` — or whose session was archived — gets a
new chat session on that fire; it never appends to an unrelated one. A `reminder` costs nothing;
a `prompt` is a chat turn, and the chat path does not yet write a usage row, so a routine prompt
is not capped in this release — the cap and the ledger are a follow-up on the chat path.

### 15.1 Storage and the claim (Task-34)

`0002_routines.sql` adds two tables, forward only:

| Table | Holds |
| --- | --- |
| `routines` | The schedule: `kind` (`prompt` or `reminder`), title, `cron`, IANA timezone, `enabled`, `notify`, the `prompt` kind's `repo_id`/`prompt`/`chat_session_id`, `next_fire_at` and `last_fired_at`. |
| `routine_fires` | One row per fire: `scheduled_for`, `fired_at` and the `outcome` — `claimed`, then `sent`/`replied`/`failed`, or `skipped`. |

`next_fire_at` is the fire **not yet claimed**; `NULL` means the routine is paused. A claim is
one transaction: the routine must be enabled and its `next_fire_at` must still equal the
`scheduled_for` being claimed, the fire row is inserted, and `next_fire_at` moves on with
`last_fired_at = fired_at`. `UNIQUE (routine_id, scheduled_for)` makes that exactly one
winner: a tick that loses the race — a second process, a double tick, a stale read — gets
`null` instead of an error and never fires twice. A `skipped` fire writes its row and moves
`next_fire_at`, but leaves `last_fired_at` alone, because the fire never happened.

### 15.2 The fire (Task-35)

`apps/daemon/src/routines` owns the tick. One `setInterval` runs every
`max(15, CB_SCHEDULER_TICK_SECONDS)` seconds (unref'd, one pass at a time: a second tick that
starts while one is running returns an empty report). A pass reads the due rows oldest first
(`enabled = 1 AND next_fire_at <= now`, twenty at a time), computes the next fire with the same
cron arithmetic as a schedule, and applies D13: inside `CB_MISFIRE_GRACE_SECONDS` the routine fires;
outside it the fire is recorded as `skipped` and `next_fire_at` moves on; a schedule the engine
cannot advance is skipped once as `no_next_fire`, so the routine stops instead of retrying.

The claim is the D38 transaction (§15.1): exactly one tick, process or manual call wins a
`(routine_id, scheduled_for)`, and a loser writes no second event.

- `reminder` — one `routine.fired` event and one `sent` fire row. No model, no chat, no
  worktree.
- `prompt` — the fire row is `claimed`; the routine then appends one `origin: routine` message
  to its chat (creating the session when it has none or the old one was archived, and storing
  the new id on the routine), streams the turn through the normal chat pump, and stores
  `routine.replied` with the chat and message ids, or `routine.failed` with a code and a fixed
  sentence. At most one prompt fire runs at a time: a second due prompt stays due for the next
  tick, inside the grace. The fire row ends `replied` with the message id, or `failed` with the
  code.

**One push per outcome** (§13): a reminder's `routine.fired` is its push; a prompt's
`routine.fired` is not, so the prompt pushes once at `routine.replied`, with the answer's text
as the body and a link to the chat. A routine with `notify = false` pushes neither, and quiet
hours hold both.

`POST /v1/routines/{id}/run` fires by hand: it appends `routine.fired` and runs the same work
without a `routine_fires` row and without touching `next_fire_at`, `last_fired_at` or `enabled`,
so a manual fire never consumes the schedule. A routine never creates a `runs` row, a gate or a
PR.

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/routines` | `read` | Page of routines, newest first; `kind` and `enabled` filters. |
| `GET` | `/v1/routines/{id}` | `read` | One routine with its next and last fire. |
| `PATCH` | `/v1/routines/{id}` | `write` | `title`, `cron`, `timezone`, `prompt`, `notify` or `enabled`; a cron or timezone change recomputes `nextFireAt`. |
| `POST` | `/v1/routines/{id}/pause` | `write` | `enabled = false`, `nextFireAt = null`. |
| `POST` | `/v1/routines/{id}/resume` | `write` | `enabled = true`, `nextFireAt` recomputed from now. |
| `POST` | `/v1/routines/{id}/run` | `runs` | Fire once now, outside the schedule. |
| `DELETE` | `/v1/routines/{id}` | `write` | Delete the routine and stop its schedule; `204`. |

`POST /v1/routines` is not mounted in this release: creation is the `routine.create` chat
tool's responsibility (Task-38), so `docs/api.md` §5.8's create row stays aspirational until
that task.

## 16. Schedules (D44, D46)

A **schedule** is the one recurring object the daemon owns end to end. It is not a job and not
a routine: it carries the trigger *and* the intention, it may belong to a repository or to a
chat, and it decides its own next fire. The legacy table stays as §1.1 says; this section is the
new path.

| Field | Rules |
| --- | --- |
| `repoId` | A registered repository, or `null` for a chat schedule. |
| `chatSessionId` | The chat a `continue` fire appends to; `null` for a fresh chat. |
| `title`, `prompt` | 1–120 and 1–8 000 characters. |
| `mode` | `once`, `every` or `window` (below). |
| `cron` | Five fields; non-null for `once` and `every`, `null` for `window`. |
| `timezone` | IANA zone, used for both the cron and the window. |
| `windowStart`, `windowEnd` | `HH:MM`, non-null only for `window`, never equal. |
| `cooldownMinutes` | Minutes between a fire's **finish** and the next fire inside a window. |
| `maxFires` | Optional cap on the fires of the whole schedule. |
| `maxCostPerFireUsd` | Optional cap on the cost of one fire; a fire that reaches it stops the loop. |
| `firePolicy` | `new_chat` opens a chat per fire; `continue` appends to `chatSessionId`. |
| `consecutiveFailures`, `firesCount`, `spendUsd` | Written by the fire rows, never by a client. |
| `enabled`, `policy` | Paused schedules are not selected; `policy` is the run's auto-merge opt-in. |
| `nextFireAt`, `lastFiredAt` | The fire **not yet claimed**, and when the last claim fired. |

`repoId` and `chatSessionId` cannot both be null: the row belongs to something.

### 16.1 The three modes

- **`once`** fires once at the cron's next instant and then has no next fire. It is a deferred
  manual run, not a recurring one.
- **`every`** is the §2 rule in `packages/scheduler/window.ts`: the next fire is the next cron
  instant strictly after the previous fire **finished**, computed by `@codebox/core`.
- **`window`** is the D46 loop. The window is half-open `[start, end)` in the schedule's zone;
  `start > end` wraps midnight (`22:00`–`06:00`). After a fire finishes, the candidate is
  `finish + cooldownMinutes`; inside the window it is the next fire, outside it the next
  opening is. The loop is anchored on the finish, never on the claim: a fire that takes eleven
  minutes pushes the next one out by eleven minutes, which is the whole point of D46.

**DST** applies to the window exactly as §2 applies it to a cron. The opening wall clock that
does not exist (spring forward) marks the day as skipped: the schedule leaves on the first
valid instant after the gap and reports `skippedDstGap: true` once, and a second call from that
instant moves to the **next day**, so a shortened night never fires twice. A wall clock that
happens twice (fall back) resolves to its **first** occurrence, one fire, not two.

**Stops**, decided in this order by `planNextFire`: `disabled` → `failures` (three consecutive
failed fires pause the schedule) → `max_fires` → `max_cost` (the fire that just ended reached
`maxCostPerFireUsd`) → `no_next_fire` (a `once` schedule, an unparsable cron, or none) →
`window_closed` (a window that never opens again). A stopped schedule stores `nextFireAt = null`
and leaves the selection; `failures` also stores `enabled = false`.

### 16.2 Storage and the claim

`0004_schedules.sql` adds two tables, forward only and additively:

| Table | Holds |
| --- | --- |
| `schedules` | The object above, with `CHECK`s that pin the mode to its cron or window family. |
| `schedule_fires` | One row per fire: `scheduled_for`, `fired_at`, the `outcome` (`claimed`, `fired`, `skipped`, `failed`), the run or chat it opened, its cost and a code. |

A claim is one transaction: the schedule must be enabled and its `next_fire_at` must still
equal the `scheduled_for` being claimed, the fire row is inserted, then `next_fire_at` moves on
with `last_fired_at` and `fires_count = fires_count + 1`. `UNIQUE (schedule_id, scheduled_for)`
makes that exactly one winner: a tick that loses the race — a second process, a double tick, a
stale read — gets `null`, logs `schedule_fire_lost` once and never throws. A `skipped` fire
writes its row and moves `next_fire_at` but leaves `last_fired_at` and `fires_count` alone,
because the fire never happened. `finish` writes the outcome plus the run or chat id, adds the
cost to `spend_usd`, and increments `consecutive_failures` on `failed` or resets it to zero on
`fired`.

### 16.3 The tick

`apps/daemon/src/schedules` owns the loop, with the same shape as §15.2: one unref'd
`setInterval` every `max(15, CB_SCHEDULER_TICK_SECONDS)` seconds, twenty due rows per pass,
one pass at a time (a second tick that starts while one is running returns zeros). A pass
applies the D13 grace with `CB_MISFIRE_GRACE_SECONDS`: inside the grace the schedule claims and
fires, outside it the fire is recorded as `skipped` and `next_fire_at` moves on. A missed fire
is never caught up.

A claimed fire is started, not awaited: `tick` returns while the work runs. A schedule with a
repository starts a run through `queueRun` with `trigger: 'schedule'`, `jobId: null` and the
claimed instant as `scheduled_for`, so it obeys the same `CB_MAX_CONCURRENCY` admission as a
manual run. A schedule without one appends an `origin: routine` message to its chat and starts
the chat turn; when it has no chat, or the old one was archived, it opens a session named after
the schedule — which needs a repository, because `chat_sessions.repo_id` is still `NOT NULL`, so
a repo-less schedule with no chat fails `chat_missing` instead of guessing one. When the fire
settles, its row ends `fired` with the run or chat id, or `failed` with a code (`repo_missing`,
`chat_unavailable`, `chat_missing`, `internal`), and the next fire is recomputed from that
instant. A fire still working at the window's end is allowed to finish; nothing cancels it.

### 16.4 The routes

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/schedules` | `read` | Page of schedules, newest first; `repoId` and `enabled` filters. |
| `POST` | `/v1/schedules` | `write` | Create; `201` with the stored object. |
| `GET` | `/v1/schedules/{id}` | `read` | `{ schedule, nextFires }`, up to five preview instants. |
| `PATCH` | `/v1/schedules/{id}` | `write` | The editable fields; a change of mode, cron, zone, window, cooldown or `enabled` recomputes `nextFireAt`. |
| `DELETE` | `/v1/schedules/{id}` | `write` | Delete the schedule and its fires; `204`. |
| `POST` | `/v1/schedules/{id}/pause` | `write` | `enabled = false`, `nextFireAt = null`. |
| `POST` | `/v1/schedules/{id}/resume` | `write` | `enabled = true`, `nextFireAt` recomputed from now. |

`nextFireAt` is never accepted from a client: an unknown body key is a `422` that names
`schedule.<key>`, and a cron, a zone or a window that cannot produce a fire is a `422` with
`details.path` and a machine `details.reason` (`field_count`, `range`, `step`, `syntax`,
`no_fire`, `timezone`, `window`, `repo_missing`, `repo_required`). A schedule fire emits no
event of its own: the run or the chat it opens emits the events of §3 and §15.

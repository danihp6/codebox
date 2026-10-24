# Jobs, runs and auto-merge

A job is a saved intention. A run is one execution of it. This document owns the state
machine, the gate, the PR and the guardrails that decide whether a green run may merge itself
(D11, D12). The guardrail functions live in `packages/core` and are tested as pure functions;
this file is their specification.

## 1. The job

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
| `enabled` | boolean | Paused jobs are not selected by the scheduler. |
| `policy` | `auto` \| `manual` | Auto-merge opt-in per job; the repo can forbid it. |
| `maxCostUsd` | number? | Optional per-run cap below the global one. |

A job belongs to exactly one repository. "Run now" is a manual trigger of the same job, not a
second definition.

## 2. Scheduling

- **5-field cron** (minute hour day-of-month month day-of-week) in an **IANA timezone**
  (D13). No seconds, no `@daily` aliases, no cron dialect beyond the standard five fields.
- **DST** is resolved by the zone: a time that does not exist (spring forward) fires at the
  first valid instant after it; a time that happens twice (fall back) fires once, at the
  first occurrence.
- **Misfire:** on boot or after a pause, a fire missed by less than
  `CB_MISFIRE_GRACE_SECONDS` (900) runs once; older misses are logged once and skipped. No
  catch-up storm.
- **Claiming:** the scheduler ticks every `CB_SCHEDULER_TICK_SECONDS` (15) and claims due
  jobs in one SQLite transaction with `UNIQUE(job_id, scheduled_for)`. Two ticks cannot both
  win.
- **Queue order:** `scheduled_for`, then `created_at`. Manual runs sort with the current time.
- **Concurrency:** at most `CB_MAX_CONCURRENCY_PER_REPO` (1) and `CB_MAX_CONCURRENCY` (2)
  runs. A due job that cannot start stays `queued`; it does not fail.
- **Pause:** `enabled=false` removes it from selection; resuming recomputes the next fire from
  now, never from the missed schedule.

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
| `running` | The prompt is sent | The agent is idle, or a timeout/cancel | `run.output`, `run.tool` |
| `gating` | Agent finished | The gate exits | `run.gate` |
| `pr_open` | Branch pushed, PR opened | All guardrails pass, or a blocker stops the run | `run.pr` |
| `merging` | Guardrails green and merge started | GitHub confirms the merge | `run.merged` |
| `succeeded` | Merge confirmed, branch deleted | — | `run.finished` |
| `failed` | Any step errored | — | `run.failed` |
| `cancelled` | The operator or a cap cancelled it | — | `run.cancelled` |

Rules:

- Every transition is persisted with its event in the same transaction; the app's timeline
  and the audit log cannot disagree.
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
- Timeout `CB_GATE_TIMEOUT_SECONDS` (1 800); on timeout the process group is killed.
- Environment: the job allowlist, not the daemon's. `CI=1`, `NO_COLOR=1`, and `CB_RUN_ID`
  (the run's id, for a gate that wants to name its artifact). `CB_RUN_ID` is set for the
  child; it is not a configuration key.
- Output is captured to `logs/run-<id>/gate.log`; the last 100 lines and the exit code are
  attached to the PR and the run.
- A red gate stops the run **before** the PR: it pushes nothing and the run ends `failed`
  with `gate_failed`. The worktree is kept for inspection.

## 6. Commit, push and PR

- One commit is created by the daemon if the agent did not commit: subject from the job
  title, body with the run trailer `Codebox-Run: <runId>` (D25).
- The branch is pushed with the installation token; the author is `codebox[bot]`.
- The PR body is generated, not written by the model:

```markdown
## <job title>

Run: run_01J… · Job: job_01J… · Agent: build · Model: …

### What changed
<the agent's final message, trimmed>

### Gate
`npm ci && npm test && npm run build` — exit 0 in 3m 04s
<last 20 lines, collapsed>

### Diff
6 files · +184 −22

### Guardrails
- [x] gate
- [x] required checks
- [ ] base unchanged — main moved during the run
```

- Draft PR when the gate failed; normal PR when it passed.
- Labels: `cb:gate-failed`, `cb:needs-review`, `cb:auto-merge`. `do-not-merge` is honoured as
  an operator veto.
- Idempotency is by branch: a second push to the same branch updates the existing PR instead
  of opening a duplicate.

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
| G8a | `policy` | repo and job are `auto`, probation met | `policy_manual` |
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

- Method `CB_MERGE_METHOD` (`squash` default, or `merge`). Squash subject: the job title plus
  `(#<pr>)`; the body keeps the trailer.
- The merge is attempted once. A 405/409 (head moved, check re-ran) is re-evaluated once
  against fresh facts; a second failure parks the run in `pr_open`.
- After the merge: delete the branch, remove the worktree (retention still applies to the
  log), emit `run.merged` and `run.finished`, notify.
- If the merge succeeded but the app never saw the event, the next fetch reconciles from
  GitHub by PR number. The database is not the only record of a merge.

## 9. Cancel, timeout and cost

| Trigger | Effect |
| --- | --- |
| Operator cancel | Interrupt the session, stop the gate process group, keep the branch, remove the worktree after retention. |
| `CB_RUN_TIMEOUT_SECONDS` | Same as cancel; code `timeout`. |
| Daily cost cap | Cancel the current run, pause the queue until the next UTC day, code `cost_cap_reached`. |
| Per-job `maxCostUsd` | Cancel that run only. |
| Disk low | Refuse new runs, clean past-retention worktrees, emit `telemetry`. |

Cancel during `merging` is refused: the merge call is not interruptible, and a half-merged
state is worse than a late one.

## 10. Retries

- A failed run is never resumed. "Retry" creates a new run with the same job and prompt, a new
  id and a new branch, so history stays honest.
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
| `run.finished` (succeeded) | "Merged: <job title>" with the PR link. |
| `run.failed` | "Run failed: <code>" with the run link. |
| `run.pr` with blockers | "Waiting on you: <first blocker>". |
| `approval.created` | The permission card. |
| `telemetry` with `disk_low` / `cost_cap` | A blocking banner plus one push. |

Quiet hours hold everything except `approval.created` and failures of a job marked critical.

## 14. What a run never does

- Never pushes to `main` or to the base branch.
- Never merges without the full G1–G8 set.
- Never touches a protected path with auto-merge on.
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
rule as a job. A `prompt` with no `chatSessionId` — or whose session was archived — gets a new
chat session on that fire; it never appends to an unrelated one. A `reminder` costs nothing; a
`prompt` counts against `CB_DAILY_COST_USD`.

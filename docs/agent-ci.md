# The CI host

[`agent-pipeline.md`](agent-pipeline.md) owns the protocol: batches, specs, markers, two QA
waves, one push per task. This file is the **GitHub Actions** host of that protocol. The
other host is [`agent-vm.md`](agent-vm.md); both read `scripts/agent/vm/prompt.md` and both
implement the same rules, so they cannot drift.

**Why Actions at all.** Batch 1 needs a loop before the VM exists. Actions is the bootstrap
host: it is wired by the same batch that bootstraps the repository, it needs no capacity
wait, and it is the manual fallback afterwards (`gh workflow run agent-cycle.yml`). The box
takes over the unattended loop when it is born. Whether that is a cost decision or a
convenience depends on the source repository's visibility: **private** is the assumption here
(a private tool tends to have private source), and then its minutes are billed; a **public**
repository would make Actions free and the box merely warmer and faster.

## 1. The pieces

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | push to `main`, pull requests | The gate: `npm ci && npm run lint && npm test && npm run build`. Read-only. |
| `agent-smoke.yml` | dispatch | Proves the inference credential, the CLI and `CB_AGENT_MODEL` answer. Spends a few cents. |
| `agent-role-smoke.yml` | dispatch | Proves a roled agent starts headless, loads its prompt, uses a tool under `--auto`, and can push a throwaway branch. |
| `agent-cycle.yml` | dispatch (the driver dispatches it) | **One batch, end to end.** The only workflow that merges into `main`. |
| `agent-autopilot.yml` | `schedule` every 30 min, dispatch | The loop: decides whether a cycle may start and dispatches one. Spends no tokens. |
| `agent-autopilot-window.yml` | dispatch, `schedule` hourly | The timed brake: arms `CB_AGENT_AUTOPILOT` for a range and turns it off on the range's edges. |

`ci.yml` is the repository's gate of record. `agent-cycle.yml` runs the same commands again
after each merge; it does not replace `ci.yml`, it repeats it on the merged tree before the
push, so a green `main` is never waiting for a workflow to agree.

## 2. One cycle

The Orchestrator drives it (`opencode run --agent orchestrator --auto`, prompt file piped on
stdin). It first reads the resume table (`.agent_specs/resume.md`, written from the refs by
`scripts/agent/recon.mjs`), adopts any task already in flight, and only then takes **the
lowest pending batch whole**, filling free slots from later batches per
[`agent-pipeline.md`](agent-pipeline.md) §2. It writes one spec per task, pushes each
`task-<ID>` branch with the spec as its first commit, gives each dev a worktree and only its
own spec, runs one Task QA per task in parallel from its own integration tree, adds the
integration pass for a batch of two or more, and ships **one task per push** in ID order:
merge `--no-ff`, drop the spec, tick `TODO.md`, append `CHANGELOG.md`, run the gate, push,
delete the branch and the worktree.

Every subagent is launched **in the foreground and waited for**. This is a single pass: when
the Orchestrator's turn ends the process ends, and a background subagent dies with the
runner. That failure was measured in the donor project: a cycle "succeeded" in seven minutes
having written a spec and launched a dev it never waited for.

A cycle that moves nothing is a **red** cycle, not a quiet one. It must leave a merge, a
`[!]` mark or an issue, or the verdict fails and the red-streak guard parks the loop instead
of chaining the same no-op forever.

Two facts the local flow takes for granted and a runner must be told:

- **There is no human.** The `question` tool would hang the job until the six-hour cap. A
  blocking doubt becomes an `agent-blocked` issue with the literal error and the decision
  needed. An issue whose body is a placeholder is a failure, not a block.
- **There is no warm tree.** Every job checks out fresh and pays `npm ci` plus the Angular
  build; only the npm cache is restored. The box in [`agent-vm.md`](agent-vm.md) exists
  partly to stop paying that.

## 3. The task is the durable unit

A runner is ephemeral and a model stream is not reliable. The batch does not survive; the
**task** does. Two refs and one convention carry the state:

| Ref | Means |
| --- | --- |
| `origin/main` | shipped, with each task's tick and `CHANGELOG.md` entry |
| `origin/task-<ID>` | a task in flight, its spec as the first commit |
| the branch tip's subject | whose turn it is |

The tip is a turnstile:

- `dev: done task-<ID>` — the dev finished and its own gate was green; QA is next.
- `qa: pass task-<ID>` — QA validated that exact tip; the merge is next.
- anything else — the dev died. The branch is **deleted and redone**, never resumed: trusting
  half a task costs more than paying for the dev again.

`scripts/agent/recon.mjs` is the only reader. It fetches, lists live `task-*` branches,
checks which are already in `main`, reads the marker and the spec, and writes the table the
Orchestrator adopts. Its pure parts are unit-tested (`recon.test.mjs`), so the state a cycle
acts on is a function of the refs, not of a model's memory.

A QA verdict is a commit, not a message: an empty commit `qa: pass task-<ID>` whose body
carries `Verified-At`, `Tip`, `Gates` and `Report`. A later commit moves the tip and the
verdict stops applying.

## 4. One push per task

The merge, the `TODO.md` tick and the `CHANGELOG.md` entry are committed together and pushed
once. `main` is therefore consistent at every boundary: no cycle leaves code shipped but
unticked, or a tick without the code. The spec travels in the branch (force-added, because
`.agent_specs/` is ignored) and is removed from the index before the merge commit, so it
never reaches `main`.

The cost is history: each task adds its dev commits, two empty markers and one merge commit.
The benefit is that a kill at any instant loses at most the task in flight.

**The pipeline's merge is not the product's merge.** `agent-cycle.yml` merges task branches
to `main` with git. It does not open a PR, does not run the G1–G8 guardrails from
[`jobs.md`](jobs.md) and does not touch `cbd`. Those guardrails protect the repositories
Codebox *operates*; the pipeline's guardrails are the gate, the two QA waves and the brake.

## 5. The verdict

The job's conclusion is the outcome, not the agent's exit code. `Run the cycle` and the gate
are `continue-on-error`, and `The cycle's verdict` decides:

- gate red → red, whatever else happened;
- `main` moved or an issue was opened → green, with a warning when the agent exited non-zero
  (`♻️ Interrupted, resumable` in the summary);
- `merge: false` and a clean exit → green, "stopped after QA";
- nothing moved and no issue → **red**. That is the measured failure mode the guard exists
  for: an agent that launches work in the background and ends its turn.

A transport drop that shipped nothing is retried **once inside the job**, after a fresh
Recon, so the second attempt adopts whatever the first one pushed. A drop that already
shipped a task is not retried: the next cycle resumes and the run is green, so a bad socket
cannot consume one of the day's three red slots.

`scripts/agent/verdict.mjs` is the pure function behind that paragraph, unit-tested
(`verdict.test.mjs`) and shared with the VM host.

## 6. Task states

`TODO.md` is the queue and the checkbox is the state:

| Mark | Means |
| --- | --- |
| `- [ ]` | available. The driver counts only these. |
| `- [~]` | claimed by a live `task-<ID>` branch; the next cycle adopts it. |
| `- [!]` | blocked. The cycle writes `BLOCKED: <reason>` next to it and pushes the mark, so no later cycle picks it again until a human frees it. |
| ticked | shipped and archived in `CHANGELOG.md`; the item is deleted from `TODO.md`. |

A `*Decision:*` line on an item is the human's answer, frozen. **Its absence means the audit
found no decision was needed** — it is not a block. A decision is never invented; if one is
genuinely missing, the task is blocked or the cycle escalates.

## 7. `[live]` criteria

A `[live]` criterion only exists in the running system: an SSE stream, a push, a tunnel, a
rendered screen, a paired device. The cycle measures it and says how:

| Kind | Measurement |
| --- | --- |
| API | `curl`/`fetch` against a daemon started on an ephemeral port with a temporary `CB_STATE_DIR`. |
| Event | the event id and type observed on `/v1/events`, plus the resource it changed. |
| App | `npx playwright test` against the built app and a daemon wired to `FakeOpenCode` and a stub `GitProvider`. |
| Push | a recorded payload on a local fake endpoint, never a real FCM/APNs send. |
| VM | a command on the box (`docs/agent-vm.md`), with its output quoted. |

The rule is unchanged: **a `[live]` criterion with an objective measurement passes.** Only
the subjective residue — "the layout reads well", "the wording feels right" — becomes an
`agent-review` issue, and that issue does not stop the merge while the `[unit]` criteria are
green. Nothing is reported as passing without being measured.

The deliberate trade: **a merge never waits for a human.** A review issue asks for a second
look at something already in `main`, so a defect it finds becomes a new task or a
`git revert -m 1 <merge>`, not a blocked merge.

No criterion in this repository may require a real GitHub token, a real model provider spend
beyond the smoke test, or a real tunnel. A pipeline that needs any of those is a spec bug.

## 8. The loop's guards

`agent-autopilot.yml` starts a cycle only when all of them hold:

- `CB_AGENT_AUTOPILOT` (repository variable) is exactly `on`. **This is the brake**; anything
  else parks the loop. It takes effect at a cycle boundary, so no merge is cut in half.
- No `agent-cycle` run is in flight, other than the one that asked. A cycle hands the baton
  at its end by dispatching this workflow with its own run id in `ignore_run`.
- At least one `- [ ]` task remains. With none, the loop parks itself and says so in one
  issue per day.
- Fewer than three red cycles today. **Red means the verdict above**, not any non-zero exit:
  a run that shipped and then lost its socket is green. Three in a day is a broken loop, not
  a busy one; a human resets it.
- At most `CB_AGENT_DAILY_CYCLES` cycles today, when that variable is a positive number.
  **Unset or `0` means no cap.**
- Inside the armed window, when one exists: `CB_AGENT_FROM` / `CB_AGENT_UNTIL` hold absolute
  UTC instants and the driver parks outside them even if the brake still reads `on`, so a
  late cron cannot start a cycle past the end.
- The plan's monthly Actions allowance is not exhausted. The loop cannot read billing without
  an admin-scoped token it should not hold, so this stays a human check
  (`gh api /settings/billing/actions`) and the hard stop is GitHub refusing to start a job;
  the window and the red-streak guard keep the spend small in the meantime.

Chaining matters and it is measured: cron is a request. The donor's `*/30` schedule fired
three times in six hours overnight, so the schedule is the safety net and the chain is the
loop. `agent-cycle.yml` dispatches the driver at its end and the driver decides.

`agent-cycle.yml` is also dispatchable by hand, which is the recovery path when the loop is
parked. Its first step refuses to start unless the brake reads `on` **or** the dispatch sets
`force: true`, and the summary records which. A forced run is the only way a human overrides
the brake; it is a decision, not a retry.

## 9. The timed window

Setting `CB_AGENT_AUTOPILOT=on` by hand is the manual mode and stays the default. The timed
window is the other mode:

```bash
gh workflow run agent-autopilot-window.yml -f hours=4          # from now
gh workflow run agent-autopilot-window.yml -f hours=6 -f start=23:00
```

It writes the range into `CB_AGENT_FROM` / `CB_AGENT_UNTIL`, turns the brake on, and asks the
driver for a cycle right away, so the range starts when it is dispatched, not when the cron
next fires.

Both edges then belong to the hourly pass: it arms the brake when the range opens (and starts
the chain, because a range that opens with the loop parked has no cycle to hand the baton),
and when the range closes it turns the brake off **and clears the range**. Clearing matters:
the driver parks whenever `CB_AGENT_UNTIL` is set, so a range left in the past would keep a
human's own `on` parked forever. One invariant covers it: **with a range set, the brake
mirrors the range.** A manual `off` inside an open range lasts until the next pass;
`hours: 0` is a stop — brake off, range cleared. With no range set the hourly pass skips
itself entirely.

Two costs, stated plainly: the range lives in repository variables, and writing one is **not
in `GITHUB_TOKEN`'s permission set** (`actions/variables` answers 403), so the workflow needs
a PAT in the `CB_AGENT_TOKEN` secret — fine-grained, `Variables: read and write`, this
repository only. It is exported to the two steps that touch a variable and to nothing else.
Asking the driver for a cycle uses the workflow's own token, which carries `actions: write`.
Without the secret the window workflow fails with a message that says so; the manual brake
still works. The edges are hourly: the cycle boundary usually turns the brake off sooner,
but the pass is the guarantee.

## 10. Permissions and secrets

Workflow permissions are per job, minimal:

| Workflow | `permissions` |
| --- | --- |
| `ci.yml` | `contents: read` |
| `agent-smoke.yml` | `contents: read` |
| `agent-role-smoke.yml` | `contents: write` (throwaway branch only) |
| `agent-cycle.yml` | `contents: write`, `issues: write` |
| `agent-autopilot.yml` | `actions: write`, `issues: write`, `contents: read` |
| `agent-autopilot-window.yml` | `actions: write`, `contents: read` |

`GITHUB_TOKEN` is the cycle's git credential: `actions/checkout` persists it, so the agent
pushes branches without a long-lived secret. The token cannot write repository variables,
which is exactly why the window has its own secret.

Pipeline keys use the `CB_AGENT_` prefix and never leak into the daemon (D19, and
[`providers.md`](providers.md) §1). Provider keys are the exception: they keep the name
OpenCode documents, so only the one the chosen model needs is set as a repository secret.

| Key | Kind | Default | Meaning |
| --- | --- | --- | --- |
| `CB_AGENT_AUTOPILOT` | variable | unset (`off`) | `on` arms the loop; anything else parks it. |
| `CB_AGENT_FROM` | variable | — | Start of the armed window, absolute UTC (`2026-10-24T22:00:00Z`). |
| `CB_AGENT_UNTIL` | variable | — | End of the armed window. Present ⇒ the driver parks outside it. |
| `CB_AGENT_DAILY_CYCLES` | variable | `0` | Cycles per UTC day; `0` or unset means no cap. |
| `CB_AGENT_MAX_DEVS` | variable | `2` | Dev slots per wave; ceiling 4. The runner has 2 cores. |
| `CB_AGENT_MODEL` | variable | required | `provider/model` passed to `opencode run --model`. |
| `CB_AGENT_TOKEN` | secret | required for the window | Fine-grained PAT with `Variables: read and write`. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | secret | one of them | Inference key, under the name OpenCode reads. |

`CB_AGENT_*` belongs to the pipeline; `CB_*` belongs to `cbd`. A test greps both trees and
fails if a daemon key appears in a workflow or a pipeline key appears in `apps/daemon`. The
two namespaces exist because the box will eventually run both on the same machine.

## 11. Budget

A cycle is not cheap. The donor measured **1h32m** for a three-task batch on a 2-core runner,
so roughly half an hour per task; Codebox re-measures in Batch 1 and replaces this sentence
with its own number. A private repository spends the plan's monthly minute allowance, shared
across the account, and running out **blocks** Actions rather than slowing it down. That is
why the allowance check exists and why the box is the target host.

The finite backlog is the real bound: eight batches of tasks is a few dozen hours of runner,
after which there is no `- [ ]` left and the loop parks. The timed window adds a ~10-second
hourly job while a range is armed (and none at all when it is not, because the job skips
itself), which is cheap next to the cycle it exists to stop starting.

## 12. Known holes

- A branch whose dev died mid-task is redone, not resumed: the spec and the partial commits
  are dropped. Deliberate; it costs one dev per interrupted task.
- The markers are the state, so a human committing on a `task-*` branch makes a verdict stale
  (the tip no longer reads `qa: pass`, and the next cycle re-runs QA). Only the Orchestrator
  owns those branches.
- `main` has no server-side protection unless the plan offers rulesets for a private
  repository. Where it does not, the only barrier between the agent and `main` is the gate,
  the QA waves and the job's `contents: write` — which is why only `agent-cycle.yml` and
  `agent-role-smoke.yml` hold it, and the smoke is limited to one throwaway branch that it
  deletes.
- The agent runs with `--auto`, a shell, an inference key in its environment and write access
  to `main`. `webfetch` is denied for every pipeline role, so a poisoned document inside the
  repository is the injection risk worth watching; protected paths are the product's answer
  and the pipeline has no equivalent for itself.
- A human push to `main` while a cycle is in flight can reject the cycle's final push. The
  cycle is told to bring `origin/main` into its branch and re-gate before pushing; if it
  cannot, it leaves the branch at `qa: pass` and the next cycle ships it.
- `CB_AGENT_TOKEN` is the one long-lived credential the Actions host needs and the only one
  kept for the brake's sake. A fine-grained token with `Variables: read and write` keeps the
  blast radius small; rotation is a human's job and the workflow fails loudly at its first
  `gh variable set` when it expires.
- The window's edges are hourly and GitHub's cron is a request, so a late edge can leave the
  recorded brake reading stale for up to an hour. The driver's own gate is what makes that
  harmless: it cannot start a cycle outside the range.
- No artifact or `node_modules` cache survives between jobs beyond the npm cache, so a cycle
  pays install and build time on every run. The box removes that cost; until then it is the
  price of a fresh runner.

## 13. What Batch 1 must prove

- `ci.yml` is green from a fresh clone with the empty workspace stubs.
- `agent-smoke.yml` answers with `CB_AGENT_MODEL` and reports the model id it used.
- `agent-role-smoke.yml` starts `orchestrator` headless, proves a tool call under `--auto`,
  and pushes a branch that is deleted afterwards.
- One manual `agent-cycle.yml` — forced, or with the brake armed for the run — ships a
  docs-only task through the full ritual, and the brake is off again afterwards.
- A cycle that moves nothing is red, and the third red parks the loop.
- `gh workflow run agent-autopilot-window.yml -f hours=0` leaves the brake off and the range
  empty.
- `CB_AGENT_*` appears in no daemon file and `CB_*` in no workflow.

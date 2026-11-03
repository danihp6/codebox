# Spec: Task-02 — Agent pipeline verification and archival

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** pipeline (docs-only verification). No application code, no script, no workflow
  and no role file is written by this task.
- **Role:** Dev.
- **Objective:** After this task the three pipeline design documents state only what the
  shipped tree does. Every sentence listed under **Claims to correct** is either corrected to
  the required content or proven true with the observation quoted in the marker commit; the
  verification itself (the commands, their results and the `[live]` handoff) is recorded in the
  body of the `dev: done task-02` commit. The pipeline's behaviour does not change — its
  description does.
- **Environment:** worktree `../wt-cb-02`, branch `task-02`, base `main` at commit `ed1708b`
  (the line numbers below are anchors from that commit; the quoted sentence is the real anchor
  if a line moved).
- **Dependencies:** Task-01 (merged) — root `package.json` gate scripts and the `scripts`
  project in `vitest.config.ts`; Task-48 (merged) — `scripts/agent/issue.mjs` and
  `docs/agent-ci.md` §7 (the issue handoff). This is a **one-task batch**: there is no
  batch-mate and no hot file is claimed.

### Exclusive paths (single writer)

Every path this task may create or modify. **Nothing outside this list.**

- `docs/agent-vm.md` — §1 slot-count sentence (line 27), §3 state list (line 79), §4 the two
  cycle bullets (lines 95 and 104-107), §5 credentials paragraph (lines 146-147), §7 the
  recovery paragraph (lines 218-220), §8 table (line 230), §9 recovery row (line 249), §10
  security bullet (lines 267-269), §12 proof bullet (line 291).
- `docs/agent-ci.md` — §2 first paragraph (lines 31-32), §9 timed-window code block (line 237),
  §10 permissions table (line 271), §10 `CB_AGENT_MAX_DEVS` row (line 305), §10 namespace
  paragraph (lines 311-313), §12 `webfetch` bullet (lines 340-343).
- `docs/agent-pipeline.md` — §8 timed-window bullet (lines 165-166).
- `scripts/README.md` — **only** if the Dev adds, renames or deletes a file under `scripts/`
  (the folder map in `AGENTS.md` then requires it). No such change is expected; a no-op edit
  to this file is not allowed.

The spec file `.agent_specs/task-02.md` is written by the Architect and force-added by the
Orchestrator. It is not yours: do not edit it.

### Inputs (read-only)

Beyond `AGENTS.md`, read only these. The shipped files are the evidence; the docs are the
defendant.

- `opencode.json`
- `.github/workflows/agent-cycle.yml`, `.github/workflows/agent-autopilot.yml`,
  `.github/workflows/agent-autopilot-window.yml`, `.github/workflows/ci.yml`
- `.agent_roles/orchestrator.md`, `.agent_roles/architect.md`, `.agent_roles/dev.md`,
  `.agent_roles/qa.md`
- `.gitignore`
- `scripts/agent/recon.mjs`, `scripts/agent/gate.mjs`, `scripts/agent/verdict.mjs`,
  `scripts/agent/issue.mjs` and their four `.test.mjs` siblings
- `scripts/agent/vm/run-driver.sh`, `run-cycle.sh`, `brake.sh`, `lib.sh`, `install.sh`,
  `prompt.md`, `agent.env.example`, `cb-agent.service.in`, `README.md`
- `scripts/README.md`
- `package.json`, `vitest.config.ts`
- `docs/agent-spec-template.md`
- `packages/contracts/src/config.test.ts` (lines 155-171) and `apps/daemon/src/start.test.ts`
  (lines 105-112), for claim C8
- `docs/providers.md` — read-only cross-check. **It is not in your exclusive paths**; if you
  find a false claim there, report it under Coordination, do not edit it.

### Claims to correct (the audit this task carries)

Each claim below was read as false against the shipped tree at `main` @ `ed1708b`. **Verify
each observation yourself before editing.** If an observation does not reproduce, do not edit
that sentence: record it in the report as a spec bug. Write every replacement positively (what
happens), never as a correction narrative — the old phrase must not survive in the file.

**C1 — the Actions push credential** (`docs/agent-vm.md:146-147`). Old: "On Actions the
ephemeral `GITHUB_TOKEN` covered the push; a service needs one that outlives a job."
Observation: `agent-cycle.yml:60-66` checks out with
`token: ${{ secrets.CB_AGENT_TOKEN }}`; `docs/agent-ci.md:273-277` already calls that PAT the
cycle's git credential. Required: say the Actions cycle checks out with the **`CB_AGENT_TOKEN`
PAT**, so a service needs the same kind of long-lived token. Keep the following sentence about
the VM token's scope unchanged (see Out of scope).

**C2 — the credential table** (`docs/agent-vm.md:230`). Old cell: "`GITHUB_TOKEN`, per run".
Observation: the same as C1. Required: the Actions cell reads **`CB_AGENT_TOKEN` PAT, per run**.

**C3 — how the prompt reaches the model, Actions** (`docs/agent-ci.md:31-32`). Old: "(`opencode
run --agent orchestrator --auto`, prompt file piped on stdin)". Observation:
`agent-cycle.yml:142,147` reads the file into `PROMPT`, substitutes `{{MERGE}}`, and passes
`"$PROMPT"` as the message argument; nothing is piped. Required: name the substitution and the
message argument; drop "piped on stdin".

**C4 — how the prompt reaches the model, VM** (`docs/agent-vm.md:95`). Old:
`opencode run ... < scripts/agent/vm/prompt.md`. Observation: `run-cycle.sh:64,69` does the
same substitution and passes `"$prompt"` as the message. A literal `<` would leave the
`{{MERGE}}` placeholder unsubstituted. Required: show the substituted prompt passed as the
message (a `# prompt.md with {{MERGE}} substituted` comment is enough), never stdin
redirection of the raw file.

**C5 — the window's start input** (`docs/agent-ci.md:237`). Old:
`-f hours=6 -f start=23:00`. Observation: `agent-autopilot-window.yml:35-42` declares inputs
`hours` and **`from`**; there is no `start`, and `gh` rejects an unknown input. Required:
`-f hours=6 -f from=23:00`.

**C6 — the window workflow's permissions** (`docs/agent-ci.md:271`). Old:
"`actions: write`, `contents: read`". Observation: `agent-autopilot-window.yml:53-56` declares
only `actions: write`; it never checks the repository out. Required: `actions: write` only.

**C7 — `CB_AGENT_MAX_DEVS` on Actions** (`docs/agent-ci.md:305`). Old: "Dev slots per wave;
ceiling 4. The runner has 2 cores." Observation: `grep -rn MAX_DEVS .github scripts
.agent_roles` hits only `scripts/agent/vm/agent.env.example:27` and `lib.sh:16,22` (where it is
resolved and exported); no workflow passes it to the cycle, no prompt or role reads it. The
real ceiling is the Orchestrator prompt's "add tasks ... up to four". Required: say the key is
documented and exported but **read by no shipped workflow, script, prompt or role**, and that
the wave's size is the Orchestrator's judgement.

**C8 — the namespace guard** (`docs/agent-ci.md:311-312`). Old: "A test greps both trees and
fails if a daemon key appears in a workflow or a pipeline key appears in `apps/daemon`."
Observation: no test reads `.github/workflows`. The real guards are
`packages/contracts/src/config.test.ts:155-171` (the daemon schema pins its key list and
rejects any `^CB_(AGENT|OCI)_` name) and `apps/daemon/src/start.test.ts:105-112` (an unknown
key fails `loadConfig`). Required: state exactly those two guards; say the workflow side is
caught by review, not by the gate. Keep the sentence that explains why the namespaces exist.

**C9 — `webfetch`** (`docs/agent-ci.md:340-343` and `docs/agent-vm.md:267-269`). Old:
"`webfetch` is denied for every pipeline role" / "the repository is the only input".
Observation: `opencode.json:12-16` denies it for the Orchestrator; `:23-33` **allows** it for
the Architect; `:35-45` (Dev) and `:46-60` (QA) set no `webfetch` rule at all. Required: "only
the Orchestrator denies `webfetch`; the Architect allows it and the Dev and QA set no rule",
then keep the injection-risk consequence in each doc. Do **not** change `opencode.json`; the
permission decision is reported, not taken (see Out of scope).

**C10 — log retention and the disk guard** (`docs/agent-vm.md:79` and `:249`). Old: "kept 14
days" and "`cb-agent` refuses to start a cycle below 2 GB free and opens one issue".
Observation: no script under `scripts/agent` contains an mtime prune, a `df` call or any
free-space check; `run-cycle.sh:47-50` force-removes every `../wt-cb-*` worktree and prunes
`git worktree` metadata. Required: state that logs are **not** pruned and no free-space guard
exists (the disk is a human's concern); describe the worktree removal as it is (every
`../wt-cb-*`, not only merged ones).

**C11 — the recon/install order** (`docs/agent-vm.md:104-105`). Old: "`recon.mjs` runs before
any install so a broken dependency tree cannot hide the state of the branches." Observation:
`run-cycle.sh:52-55` runs the conditional `npm ci` **before** `recon.mjs` at `:60-62`, and the
model at `:69`. Required: `recon.mjs` uses Node built-ins and needs no `node_modules`; it runs
after the conditional install and before the model. Keep the true facts (verdict is built-ins,
`opencode` is global, dev worktrees install their own, the post-merge gate installs from the
lockfile).

**C12 — where the timed window lives** (`docs/agent-pipeline.md:165-166`). Old:
"(`CB_AGENT_FROM`/`CB_AGENT_UNTIL`, absolute UTC)". Observation: the VM scripts read neither
variable; `brake.sh` writes `$CB_AGENT_STATE/window` as `"<from epoch> <until epoch>"` and
`gate.mjs readWindow` reads it. Required: name both hosts — `CB_AGENT_FROM`/`CB_AGENT_UNTIL` on
Actions, `$CB_AGENT_STATE/window` on the box — and keep "absolute UTC".

**C13 — the VM slot-count sentence** (`docs/agent-vm.md:27`). Old: "the pipeline's slot count
is resource-bound: `CB_AGENT_MAX_DEVS=2` on 2/12, rising to 4 only on a 4/24 resize."
Observation: the same as C7 — nothing reads the value. Required: speak of the template's
suggested value, not an enforced bound; say no shipped script, prompt or workflow reads it
yet, so the wave stays the Orchestrator's judgement.

**C14 — the recovery command** (`docs/agent-vm.md:218-220` and `:291`). Old:
"`run-cycle.sh --force`, which ignores the brake for that cycle and records `forced` in the
ledger" and the §12 bullet "One manual `run-cycle.sh --force`". Observation: `run-cycle.sh`
parses no arguments and has no `--force`; it checks no brake of its own (the driver's
`gate.mjs` does), and the ledger written at `:128-137` has no `forced` field. Required: a
direct `run-cycle.sh` run is the recovery path because the script itself checks no brake; the
ledger records the cycle like any other, with no `forced` flag. Fix the §12 bullet to
`run-cycle.sh` with no flag.

### The `[live]` criterion — measured by a human, not here

The backlog line is: **"one dispatched `agent-cycle` on a throwaway branch moves `main` or opens
an `agent-blocked` issue and the run summary says which."**

It is **not measurable in this run**, and it must be recorded as `[live] not measured here` by
the Dev and by QA:

- `agent-cycle.yml:25-27` states the rule: a `[live]` criterion is never reported as passing
  from inside an Actions runner; it becomes an `agent-review` issue.
- Dispatching a cycle from a dev or QA worktree would need `actions: write`, the repository's
  `CB_AGENT_*` variables and a model budget, none of which this task holds. Do not run
  `gh workflow run`.

The measurement, for the Orchestrator or a human with repository admin:

1. Publish a throwaway ref at the merged `main`: `git push origin main:refs/heads/probe/cycle-02`
2. Dispatch one cycle on it: `gh workflow run agent-cycle.yml --ref probe/cycle-02 -f merge=true`
   (`merge=false` stops after QA and is green without moving `main`; it does not satisfy this
   criterion).
3. Find the run: `gh run list --workflow=agent-cycle.yml --limit 1`
4. Read the `The cycle's verdict` step's line (format frozen at `agent-cycle.yml:202`):
   `main <before-sha> -> <after-sha> (moved: yes|no), issues <n> -> <m>, agent: <outcome>, gate: <outcome>, merge: <input>`
5. Pass iff `moved: yes` **or** `m > n`; quote the line and the run URL in the work order.
6. Clean up: `git push origin --delete probe/cycle-02`. Any issue the run opened stays for a
   human; `issue.mjs` never closes one.

The Orchestrator — not the Dev — opens the work order:

```bash
node scripts/agent/issue.mjs --label agent-review \
  --title "Task-02: measure one dispatched agent-cycle on a throwaway branch" \
  --body-file -
```

with the six steps above on stdin, and the exact line to read.

## 🔒 Contract

This task exports no code. The promise is the **shipped pipeline's observable surface**, which
the docs must describe and must not rename. If a doc sentence conflicts with this table, the
table wins and the doc is corrected; the code is not.

| Surface | Frozen value |
| --- | --- |
| Branch / worktree | `task-<ID>` / `../wt-cb-<ID>` (never `wt-pkm-`, never `wt-task-`) |
| Dev marker | empty commit whose subject is exactly `dev: done task-<ID>` |
| QA marker | empty commit whose subject is exactly `qa: pass task-<ID>`; body keys `Verified-At`, `Tip`, `Gates`, `Report` |
| `recon.mjs` | flags `--todo` / `--base` / `--out`; defaults `TODO.md` / `origin/main` / `.agent_specs/resume.md`; states `ship`, `qa`, `partial`, `blocked`, `orphan`, `merged`; report line `- branches alive: <n>` |
| `gate.mjs` | flags `--state` (default `.`), `--now`, `--open`, `--cycles-today`, `--red-today`, `--cap`; one JSON line `{go,reason,alert}`; order brake → window → backlog → red streak → cap |
| `verdict.mjs` | flags `--gate`, `--agent`, `--moved`, `--issued`, `--merge` (each `true`/`yes`/`1`); one JSON line `{ok,status,reason}`; statuses `shipped`, `resumed`, `stopped`, `failed` |
| `issue.mjs` | `--label` ∈ {`agent-review`, `agent-blocked`}, `--title`, `--body` or `--body-file -`; stdout `{action,number,url,duplicates}`; exit 0 success, 1 `gh`/label failure, 2 usage |
| `brake.sh` | `on`, `off`, `window <hours> [HH:MM]`, `status`, `reset`; `brake.sh window 0` writes `off` and clears the window |
| `run-cycle.sh` | holds `flock` on `$STATE/lock` itself; refuses a dirty clone; ledger keys below |
| Workflows | `agent-cycle.yml` inputs `model` (string, `''`) and `merge` (boolean, `true`); `agent-autopilot.yml` input `ignore_run` (string, `''`); `agent-autopilot-window.yml` inputs `hours` (required, `'4'`) and `from` (string, `''`) |
| Verdict step | the step is named exactly `The cycle's verdict`; its line is `main <a> -> <b> (moved: yes|no), issues <n> -> <m>, agent: <o>, gate: <g>, merge: <i>` |
| Labels | `agent-review` (subjective residue, does not block a merge) and `agent-blocked` (a decision or a fix is needed) |
| Gitignore | `.agent_specs/` is ignored and the spec is force-added on the task branch only |

- **Errors and exit codes (frozen):** `run-cycle.sh` exits 0 when the verdict's `ok` is true and
  1 otherwise (`run-cycle.sh:156`); `run-driver.sh` exits 1 through `die` when a required
  binary or key is missing, with a message naming it; `issue.mjs` exits 0/1/2 as in the table.
  No HTTP surface, no `/v1` route and no `CB_*` daemon key is involved in this task.
- **Purity:** `gate.mjs` and `verdict.mjs` are pure functions plus a CLI; `recon.mjs` reads git
  through `execFileSync`; the docs describe them, they are not changed here.
- **Ordering:** `gate.mjs` decides brake → window → backlog → red streak → cap; the cycle is
  fetch → reset → conditional install → recon → model → post-merge gate → verdict → ledger
  (`run-cycle.sh`). The docs must not reorder either.

### Data

- **Ledger** (`$CB_AGENT_STATE/cycles.ndjson`, one JSON object per line), keys in this order:
  `ts`, `status`, `reason`, `model`, `before`, `head`, `tasks`, `tests`, `moved`, `issued`,
  `gate`, `agent`, `open`, `blocked`. `status` is the verdict's status; `ts` is ISO-8601 UTC;
  `moved`/`issued`/`gate`/`agent` are booleans.
- **Brake** (`$CB_AGENT_STATE/brake`): the literal `on` or anything else.
- **Window** (`$CB_AGENT_STATE/window`): `"<from epoch> <until epoch>"`, both seconds, present
  only while a range is armed.
- **Last summary** (`$CB_AGENT_STATE/last-cycle.md`): rows `Verdict`, `Tasks`, `main`, `Gate`,
  `Agent`, `Backlog`, `In flight`, `Log`.
- **Resume table** (`.agent_specs/resume.md`): line `- branches alive: <n>`; states as in the
  Contract table.
- **Issue JSON**: `{"action":"created"|"commented","number":<n>,"url":"<url>","duplicates":[<n>,...]}`;
  failure is `{"error":"<message>"}` on stderr.

## 🧩 Configuration

This task **adds no key, renames no key and changes no default**. It documents these, which are
frozen:

| Key | Where | Default | Read by |
| --- | --- | --- | --- |
| `CB_AGENT_MODEL` | VM env / Actions variable | none (required) | `run-driver.sh:19,40`, `run-cycle.sh:15,19`, `agent-cycle.yml:131,139` |
| `CB_AGENT_GIT_TOKEN` | VM env | none (required) | `run-driver.sh:19,25`, `run-cycle.sh:15,17` |
| `CB_AGENT_STATE` | VM env | `/var/lib/cb-agent` | `lib.sh:12` |
| `CB_AGENT_REPO` | VM env | `/srv/cb-agent/codebox` | `lib.sh:11` |
| `CB_AGENT_ENV` | VM env | `/etc/codebox/cb-agent.env` | `lib.sh:13` |
| `CB_AGENT_DAILY_CYCLES` | VM env / Actions variable | `0` (no cap) | `lib.sh:15`, `run-driver.sh:59`, `agent-autopilot.yml:74` |
| `CB_AGENT_MERGE` | VM env | `true` | `lib.sh:17`, `run-cycle.sh:18` |
| `CB_AGENT_MAX_DEVS` | VM env / Actions variable | `2` | **nothing** (see C7/C13) |
| `CB_AGENT_AUTOPILOT` | Actions variable | unset (`off`) | `agent-autopilot.yml:65` |
| `CB_AGENT_FROM` / `CB_AGENT_UNTIL` | Actions variable | unset | `agent-autopilot.yml:68-69`, `agent-autopilot-window.yml:68-69` |
| `CB_AGENT_TOKEN` | Actions secret | none (required) | `agent-cycle.yml:66`, window workflow |
| `OPENCODE_CLIENT_ID` | Actions variable | none (required) | `agent-cycle.yml:105` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `OPENCODE_API_KEY` | secret / VM env | one required | `run-driver.sh:21`, `agent-cycle.yml:132-134` |

The validation failures are the shipped ones: `need` dies naming the key, `run-driver.sh` dies
with `no provider key in ...`, the workflow uses `${VAR:?message}`. This task does not change
them; it only makes the docs tell the truth about them.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing
else is not a criterion.

### Method

```bash
# 0. A fresh worktree has no node_modules.
npm ci --prefer-offline --no-audit --no-fund

# 1. The ported pure modules (the task's first [unit] criterion).
npx vitest run scripts/agent
# expected: exit 0; "Test Files  4 passed (4)" and "Tests  33 passed (33)"
# (measured on main @ ed1708b). A different count means the pipeline changed since this spec
# was written: report it as a spec bug, do not call it a pass.

# 2. A dry brake status on a throwaway state directory (the second [unit] criterion).
state=$(mktemp -d)
CB_AGENT_STATE="$state" CB_AGENT_ENV=/nonexistent bash scripts/agent/vm/brake.sh status
# expected: exit 0 and exactly these three lines:
#   brake:  unset
#   window: none
#   cycles: 0 today (0 red)
test -f "$state/cycles.ndjson" && test -d "$state/logs"   # expected: exit 0

# 3. The two pure CLIs run before any build (Node built-ins only).
node scripts/agent/gate.mjs --state "$state" --open 3 --cycles-today 0 --red-today 0 --cap 0
# expected: {"go":false,"reason":"brake is 'unset'","alert":null}
node scripts/agent/verdict.mjs --gate true --agent true --moved false --issued false --merge true
# expected: {"ok":false,"status":"failed","reason":"the cycle moved nothing and opened no issue"}

# 4. The gate.
npm run lint
npm test
npm run build
# expected: exit 0 for each. npm test includes the scripts project (the 33 above), the app
# unit suite and the workspace coverage guard.

# 5. The diff audit. The spec is force-added on the branch by the Orchestrator; it is expected
#    and is the only non-docs path allowed here.
git diff --name-only main...task-02
# expected: only .agent_specs/task-02.md and files under docs/ named in the exclusive paths.
test -z "$(git diff --name-only main...task-02 -- \
  scripts .github .agent_roles opencode.json TODO.md CHANGELOG.md docs/decisions.md \
  docs/providers.md docs/agent-spec-template.md \
  package.json package-lock.json tsconfig.base.json vitest.config.ts)"
# expected: exit 0 (nothing printed) -- no behaviour, workflow, role or hot file changed.

# 6. The marker and its archival body.
git fetch origin task-02
git log -1 --format=%B origin/task-02
# expected: the first line is exactly "dev: done task-02"; the body carries the commands and
# their results from steps 1-4, the C-claim table (corrected / refuted with evidence), and the
# literal line "[live] not measured here".
```

The Dev runs steps 0-4 and the audit in step 5 before its own `dev: done`; QA re-runs steps
0-5 in its integration worktree and runs step 6 against `origin/task-02`.

### Acceptance criteria

- [ ] `[unit]` Clean install, `npm run lint`, `npm test` and `npm run build` all exit 0.
- [ ] `[unit]` `npx vitest run scripts/agent` exits 0 with `Test Files  4 passed (4)` and
      `Tests  33 passed (33)`. Any other count is a failure: this task changes no file under
      `scripts/`, so it cannot legitimately move.
- [ ] `[unit]` The dry `brake.sh status` prints exactly `brake:  unset`, `window: none`,
      `cycles: 0 today (0 red)`, exits 0, and has created `cycles.ndjson` and `logs/`.
- [ ] `[unit]` `gate.mjs` and `verdict.mjs` print the exact JSON lines shown in Method step 3.
- [ ] `[unit]` Nothing outside the exclusive paths was touched: the `test -z "$(git diff ...)"`
      command in Method step 5 exits 0, and `git diff --name-only main...task-02` shows no
      file under `scripts/`, `.github/`, `.agent_roles/` or `opencode.json`.
- [ ] `[unit]` Each of **C1-C14** is either corrected to the required content or refuted with an
      observation that reproduces; the marker body lists every one as `corrected` or `refuted`.
      The reviewer checks the corrected sentence against the observation; the following greps
      must print nothing (the old, false wording is gone):
      ```bash
      grep -n 'ephemeral `GITHUB_TOKEN` covered the push' docs/agent-vm.md
      grep -n 'piped on' docs/agent-ci.md
      grep -n '< scripts/agent/vm/prompt.md' docs/agent-vm.md
      grep -n -- '-f start=' docs/agent-ci.md
      grep -n '`actions: write`, `contents: read`' docs/agent-ci.md
      grep -n 'greps both trees' docs/agent-ci.md
      grep -n '`webfetch` is denied for' docs/agent-ci.md docs/agent-vm.md
      grep -n 'kept 14 days' docs/agent-vm.md
      grep -n '2 GB free' docs/agent-vm.md
      grep -n 'before any install' docs/agent-vm.md
      grep -n 'run-cycle.sh --force' docs/agent-vm.md
      grep -n '`forced`' docs/agent-vm.md
      grep -n 'Dev slots per wave; ceiling 4' docs/agent-ci.md
      ```
      and these must print a line (the true fact is present):
      ```bash
      grep -n 'CB_AGENT_TOKEN' docs/agent-vm.md
      grep -n 'from=23:00' docs/agent-ci.md
      grep -n 'CB_AGENT_STATE/window' docs/agent-pipeline.md
      grep -n 'config.test.ts' docs/agent-ci.md
      grep -n 'webfetch' docs/agent-ci.md docs/agent-vm.md
      ```
      The semantic half is read, not grepped: each corrected sentence must state the fact in
      the C-claim, and no replacement may contain the old claim in negated form.
- [ ] `[unit]` `git log -1 --format=%B origin/task-02` has the subject `dev: done task-02` and
      a body that names the commands with their results and contains `[live] not measured
      here`.
- [ ] `[live]` **Not measured here.** The criterion is one dispatched `agent-cycle` on a
      throwaway branch whose verdict line reads `moved: yes` or `issues n -> m` with `m > n`.
      Measurement: the six steps under **The `[live]` criterion**. Dev and QA record
      `[live] not measured here`; QA must not run `gh workflow run` and must not report it as
      passing. The Orchestrator opens the `agent-review` work order.

## 📣 Coordination

- **For the Orchestrator:** this is a one-task batch and the only task left in Batch 1.
  Tick `TODO.md` and append `CHANGELOG.md` at merge (you own both; this task does not touch
  them). Open the `agent-review` issue for the `[live]` criterion with the recipe above, using
  `scripts/agent/issue.mjs`, after the merge. Merge only if the diff audit shows no file
  outside `docs/agent-pipeline.md`, `docs/agent-ci.md`, `docs/agent-vm.md` (plus the
  force-added spec); a change to a script, workflow, role or `opencode.json` is a red task.
- **For the Dev's report:** the C-claim table (`C1..C14` → corrected / refuted + evidence), the
  exact commands with their result lines, the out-of-scope findings below, and
  `[live] not measured here`. The same table goes in the marker body.
- **For the Architect / next batch (Batch 1 closes here):** the docs are the baseline. These
  findings are **outside this task's writable set** and must not be fixed here; they need their
  own task or an operator decision:
  1. `docs/providers.md:277` says `CB_AGENT_TOKEN` is "for the window workflow only"; it is
     also `agent-cycle.yml`'s checkout token (`:66`). False, and `providers.md` is read-only
     for this task.
  2. `docs/providers.md:286-287` repeats the two-tree grep claim that C8 corrects in
     `agent-ci.md`. The two docs will disagree until it is fixed; only `agent-ci.md` is in
     scope.
  3. `scripts/agent/vm/agent.env.example:15` says "Actions uses GITHUB_TOKEN instead"; false
     for the git credential (`agent-cycle.yml:66`). Read-only for this task.
  4. `docs/agent-vm.md:148-149` scopes the VM PAT with "no `workflows`", but a cycle that ships
     a task touching `.github/workflows/**` cannot push with that scope, while
     `docs/agent-ci.md:347-352` calls the Workflows scope deliberate. This is a security
     decision; the Dev reports it and changes nothing.
  5. `CB_AGENT_MAX_DEVS` has no reader (C7/C13 make the docs say so). Enforcing it is a new
     task that edits `scripts/agent/vm/prompt.md`, `.agent_roles/orchestrator.md` and
     `agent-cycle.yml` — not this one.
  6. `docs/agent-ci.md:220-222` says a park opens an issue; only the empty-backlog and red-streak
     parks do. Wording only; not in the C list, leave it unless the Dev is already in that
     paragraph.

## ⛔ Out of scope

- **No behaviour change.** Do not edit any file under `scripts/`, `.github/`, `.agent_roles/`;
  do not edit `opencode.json`, `package.json`, `package-lock.json`, `tsconfig.base.json`,
  `vitest.config.ts`. The whole point is that the code is already shipped and verified.
- No new dependency, no refactor, no reflow of paragraphs outside the C-claims, no
  `npm run format` (the docs are Prettier-ignored; a reflow would bury the real diff).
- Do not implement what C7/C8/C10/C13 describe as missing: no 14-day log pruning, no free-space
  guard, no workflow-namespace test, no `CB_AGENT_MAX_DEVS` reader. Those are behaviour; this
  task makes the docs true about the absence.
- Do not change the PAT scope guidance at `docs/agent-vm.md:148-149` or §10, and do not change
  `opencode.json` to match C9. Both are security decisions and belong to a follow-up with an
  explicit decision record.
- Do not edit `TODO.md`, `CHANGELOG.md`, `docs/decisions.md`; the Orchestrator owns all three
  at merge.
- Do not edit `docs/providers.md`, `scripts/agent/vm/agent.env.example`, `scripts/agent/vm/README.md`
  or `scripts/README.md` (unless the folder-map condition above applies). Report instead.
- Do not run `gh workflow run`, do not dispatch `agent-cycle`, do not open an issue. The Dev and
  QA only **record** the `[live]` criterion as not measured; the Orchestrator hands it off.
- If every C-claim is proven true and the diff is empty, that is a legitimate outcome: record
  the observations in the body of an allow-empty `dev: done task-02` commit and say so in the
  report. An empty diff is not a failure; an unverified claim is.

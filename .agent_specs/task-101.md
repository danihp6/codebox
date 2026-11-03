# Spec: Task-101 — The guards the pipeline's docs promise and its code does not carry

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** pipeline (`opencode.json`, `scripts/agent/**`, one workflow line, docs).
- **Role:** Dev.
- **Objective:** Four guards that three design documents already describe become real in the
  tree, and the four sentences outside Task-02's writable set stop lying. After this task:
  every pipeline role (not just the Orchestrator) denies `webfetch` in `opencode.json` and a
  test pins it; `CB_AGENT_MAX_DEVS` has exactly one reader in code (`run-cycle.sh`), reaches
  the Orchestrator through `prompt.md`'s `{{MAX_DEVS}}` placeholder and is recorded as
  `maxDevs` in `cycles.ndjson`; a cycle prunes `cycle-*.log` older than 14 days and refuses to
  start below 2 GB free, opening one `agent-blocked` order through
  `scripts/agent/issue.mjs`; and `--force` exists — a pure `decideGate({force:true})` that the
  driver spends for one pass, and `forced: true|false` in every ledger line. `docs/security.md`
  §2 and a new `D60` record the webfetch change; the stale `CB_AGENT_TOKEN`,
  `CB_AGENT_MAX_DEVS` and namespace sentences and the env template's Actions-credential
  sentence are corrected in the same change.
- **Environment:** worktree `../wt-cb-101`, branch `task-101`, base `main` at `96db807`.
- **Dependencies:**
  - **Task-02** — merged 2026-11-03. It produced the reconciled `docs/agent-pipeline.md`,
    `docs/agent-ci.md` and `docs/agent-vm.md` this task corrects, and its residual findings are
    the Task-101 item's four bullets (`TODO.md`, Batch 24).
  - **Task-48** — merged. It produced `scripts/agent/issue.mjs` (the create-once / comment-on-
    repeat helper, `HANDOFF_LABELS = ['agent-review','agent-blocked']`), which guard 3 calls.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `opencode.json`
- `.github/workflows/agent-cycle.yml` — **one line only**: the `PROMPT=$(sed …)` line at
  `agent-cycle.yml:142` gains a second `-e "s|{{MAX_DEVS}}|4|g"` expression. No other line of
  that workflow changes.
- `scripts/agent/opencode-config.test.mjs` *(new)*
- `scripts/agent/gate.mjs` — the `force` parameter of `decideGate`
- `scripts/agent/gate.test.mjs` — the test for `force`
- `scripts/agent/vm/lib.sh` — `prune_logs`, `free_gb`
- `scripts/agent/vm/run-cycle.sh` — argument parse, `max_devs`, prune, disk guard, ledger keys
- `scripts/agent/vm/run-driver.sh` — its own `--force` argument, one pass only
- `scripts/agent/vm/run-cycle.test.mjs` *(new)*
- `scripts/agent/vm/prompt.md` — the `{{MAX_DEVS}}` paragraph and step 1b
- `scripts/agent/vm/agent.env.example` — the `CB_AGENT_GIT_TOKEN` comment, the
  `CB_AGENT_MAX_DEVS` comment
- `scripts/agent/vm/README.md` — folder map: add `run-cycle.test.mjs`
- `scripts/README.md` — folder map: add `agent/opencode-config.test.mjs`
- `docs/security.md` §2 (Adversaries table — the `Malicious repository content` row only)
- `docs/decisions.md` — the new `D60` row, appended after `D59`. No existing ID moves; the
  `## Frozen values` section is not touched.
- `docs/providers.md` §13 (the `CB_AGENT_TOKEN` row, the `CB_AGENT_MAX_DEVS` row, and the
  namespace paragraph under the table). **§10 of this file is `Notifications` and holds none
  of the false sentences: do not touch it** (see Coordination — the item's "§10" is stale).
- `docs/agent-ci.md` §8 (the park paragraph), §10 (the `CB_AGENT_MAX_DEVS` row), §12 (the
  `webfetch` bullet only)
- `docs/agent-vm.md` §1 (the `CB_AGENT_MAX_DEVS` sentence), §3 (the pieces table's
  `run-cycle.sh` row and the `logs/cycle-*.log` state line), §4 (the one `# prompt.md, its
  {{MERGE}} placeholder substituted` line), §7 (operating it — `--force`), §9 (the `Disk fills`
  row), §10 (the `webfetch` bullet only)
- `docs/agent-pipeline.md` §2 (the `Filling` paragraph — the sentence naming
  `CB_AGENT_MAX_DEVS` only)

**Not yours, ever — the Orchestrator owns them at merge:** `TODO.md` and `CHANGELOG.md`. Do not
tick the item, do not write the changelog entry, do not edit the batch header. The merge, the
tick and the entry are one push by the Orchestrator after QA.

### Inputs (read-only)

Beyond `AGENTS.md`, `TODO.md` (the Task-101 item) and `docs/agent-spec-template.md`:

- `opencode.json` (written — read it first: four agents, `orchestrator` already
  `"webfetch": "deny"`)
- `scripts/agent/vm/{lib.sh,run-cycle.sh,run-driver.sh,brake.sh,install.sh,prompt.md,agent.env.example,cb-agent.service.in}`
  (all are inputs; the first five are the ones you touch)
- `scripts/agent/{gate.mjs,gate.test.mjs,issue.mjs,issue.test.mjs,recon.mjs,verdict.mjs}`
- `scripts/release/upgrade.test.mjs` — the pattern for a Vitest test that shells out to `bash`
- `ops/image/test/template.test.mjs` — the `have(binary)` / `spawnSync('sh', ['-c', 'command -v …'])`
  skip pattern
- `.github/workflows/agent-cycle.yml` (one line written, the rest read)
- `.agent_roles/{orchestrator,architect,dev,qa}.md`
- `docs/{agent-ci,agent-vm,agent-pipeline,security,providers,decisions}.md`
- `vitest.config.ts` and `package.json` — the `scripts` project includes `**/*.test.mjs` under
  `scripts/`, and `npm test` runs `test:guard && test:app && vitest run`

## 🔒 Contract

Pipeline contract. Nothing here is a TypeScript export; these are the names, keys and strings
other scripts, tests and documents are written against **after** this task.

**`opencode.json`** — every one of the four agents (`orchestrator`, `architect`, `dev`, `qa`)
carries `permission.webfetch: "deny"`. Nothing else in the file changes.

**`scripts/agent/gate.mjs`**

```js
export function decideGate({
  brake,
  windowFrom = null,
  windowUntil = null,
  now,
  openTasks,
  cyclesToday,
  redToday = 0,
  cap = 0,
  force = false,          // new, last, default false
})
```

- `force === true` returns `{ go: true, reason: 'forced by --force', alert: null }` **before**
  the brake check — a forced pass bypasses brake, window, backlog, red streak and cap together,
  because `--force` bypasses `gate.mjs`, not one guard inside it.
- `force` absent/false: byte-identical behaviour to today. The existing `gate.test.mjs` cases
  must pass unmodified.
- Purity is unchanged: no clock, no filesystem, no environment.

**`scripts/agent/vm/lib.sh`** (sourced, never executed; both helpers are pure sh + coreutils)

```sh
# Free space in GiB, floored, on the filesystem that holds $1. Non-zero status when df or awk
# cannot answer; the caller treats that as 0 and refuses.
free_gb() { df -Pk "$1" 2>/dev/null | awk 'NR==2 {printf "%d", $4/1048576}'; }

# Delete $LOGS/cycle-*.log older than <days> (default 14). Prints the number removed.
prune_logs() { … }
```

- `prune_logs` finds `-maxdepth 1 -type f -name 'cycle-*.log' -mtime +"$days" -delete`, is a
  no-op when `$LOGS` does not exist, and prints `pruned <n> log(s) older than <days> day(s)`
  only when `n > 0` (silence otherwise, so a quiet cycle log stays quiet).

**`scripts/agent/vm/run-cycle.sh`** — `run-cycle.sh [--force]`

- `--force` as the first and only argument sets `forced=true`; no argument sets `forced=false`;
  any other argument dies with `unknown argument '<arg>' (try: --force)`, exit 1.
- `forced` does **not** read the brake, the window or the backlog: the script reads none of
  them before or after this change. It is a ledger annotation for the box's cycle and the
  driver's bypass marker.
- New start-of-cycle block, in this order, immediately after `cd "$CB_AGENT_REPO"` and before
  `git fetch`:
  1. `prune_logs`
  2. `free=$(free_gb "$STATE")`; a non-zero status sets `free=0` (fail closed)
  3. when `free < MIN_FREE_GB` (`MIN_FREE_GB=2`, a constant, not a `CB_*` key): open the order,
     then `die`.

```sh
MIN_FREE_GB=2
prune_logs
free=$(free_gb "$STATE") || free=0
if [ "$free" -lt "$MIN_FREE_GB" ]; then
  open_disk_order "$free" || log "error: could not open the disk order; the refusal stands"
  die "refusing to start: only $free GB free, below the ${MIN_FREE_GB} GB floor"
fi
```

- `open_disk_order()` runs exactly this, from the clone (cwd is `$CB_AGENT_REPO`):
  `node scripts/agent/issue.mjs --label agent-blocked --title "Autopilot refused: less than 2 GB free on the box" --body-file -`
  with the body on stdin naming the measured GiB, `$STATE`, the 2 GB floor, and the decision a
  human must take (free space on the box, then `brake.sh on`). The title carries **no number
  and no date**, so `issue.mjs` creates at most one order for the condition and comments on it
  afterwards. A failure of the helper never cancels the refusal.
- `max_devs=${CB_AGENT_MAX_DEVS:-2}`, validated right after the argument parse and **before**
  the lock and the `cd`: an empty value, a non-digit, or a number outside `1..4` dies with
  `CB_AGENT_MAX_DEVS=<value> is outside 1..4 (the box's ceiling)`, exit 1.
- The prompt substitution becomes:
  ```sh
  prompt=$(sed -e "s|{{MERGE}}|$MERGE|g" -e "s|{{MAX_DEVS}}|$max_devs|g" "$VM_DIR/prompt.md")
  ```
  No raw `{{MAX_DEVS}}` may survive; the test in
  `scripts/agent/vm/run-cycle.test.mjs` proves it from the argv the `opencode` stub captured.
- The start log line becomes `cycle $stamp starts on $model (merge=$MERGE, devs=$max_devs)`.
- The ledger line gains two keys, and the jq call gains two arguments
  (`--argjson maxDevs "$max_devs" --argjson forced "$forced"`), inserting them after `model`.
  Every other key keeps its position and meaning (see **Data**).

**`scripts/agent/vm/run-driver.sh`** — `run-driver.sh [--force]`

- `--force` is read once at startup (`forced_once=true`); any other argument dies with the same
  `unknown argument` shape. On the first pass of the loop the driver skips
  `node …/gate.mjs` entirely, logs `gate bypassed for one cycle (--force)`, runs
  `"$VM_DIR/run-cycle.sh" --force`, and sets `forced_once=false`; every later pass asks
  `gate.mjs` again and runs `run-cycle.sh` with no argument.
- Nothing else in the loop changes: the brake is not cleared, the ledger is not written here, a
  red verdict still parks, and `flock` still lives in `run-cycle.sh`.

**`scripts/agent/vm/prompt.md`**

- Under `ENVIRONMENT FACTS`, one new bullet, worded exactly as
  `- Dev slots: this run may use at most {{MAX_DEVS}} devs in parallel; the ceiling is 4. Fewer`
  `cores are a reason to take fewer tasks, never a licence to serialise and never a reason to`
  `exceed the number.` (three source lines, one bullet). Step 1b's "add tasks from later batches
  **up to four**" becomes "up to `{{MAX_DEVS}}`".
- Nothing else in the prompt changes: the merge authorisation line, the issue rule and the
  `[live]` rule stay word for word.

**`scripts/agent/opencode-config.test.mjs`** *(new)*

```js
const config = JSON.parse(readFileSync(new URL('../../opencode.json', import.meta.url), 'utf8'));
for (const role of ['orchestrator', 'architect', 'dev', 'qa']) { /* webfetch === 'deny' */ }
```

It must also fail when a role key is missing, so the loop asserts presence, not just the value.

### Docs — the exact corrections (frozen claims)

These are the sentences to write. Anything not listed in a section stays as Task-02 left it.

- **`docs/security.md` §2** — the `Malicious repository content` row's third cell becomes:

  > Untrusted-content rule, permission policy, protected paths, diff budget; no pipeline role
  > has `webfetch` — `opencode.json` denies it for `orchestrator`, `architect`, `dev` and `qa`
  > (D60) — so a poisoned document cannot be fetched by URL.

- **`docs/decisions.md`** — one row appended after `D59`, table syntax and columns exactly as
  the rows above it:

  > | **D60** | **No pipeline role fetches the web (2026-11-03).** `opencode.json` denies
  > `webfetch` for all four agents — `orchestrator`, `architect`, `dev` and `qa` — and
  > `scripts/agent/opencode-config.test.mjs` fails if any role's `permission.webfetch` is
  > anything but `deny`. | D27 denies the network to the unattended agent, but the config
  > allowed three of the four pipeline roles to pull an arbitrary URL into their context while
  > `docs/agent-ci.md` §10 and `docs/agent-vm.md` §10 promised the rule for every role. Those
  > roles read untrusted repository content by construction, so `webfetch` was the remaining
  > way to turn a poisoned document into an instruction with a network round-trip. A permission
  > nobody tests drifts; the test is the control. |

- **`docs/providers.md` §13** — three edits in the table and the paragraph under it:
  - `CB_AGENT_TOKEN` row, `Where`/`Meaning` cells:

    > Actions secret | Fine-grained PAT, this repository only: `Contents`, `Workflows` and
    > `Variables` write. It is `agent-cycle.yml`'s checkout credential — `actions/checkout`
    > persists it, because `GITHUB_TOKEN` cannot write under `.github/workflows/**` — and the
    > window workflow's `gh variable set` writer; `GH_TOKEN` stays `GITHUB_TOKEN` for the issue
    > and dispatch calls.

  - `CB_AGENT_MAX_DEVS` row:

    > variable | Dev slots per wave; ceiling 4, default 2. Read by
    > `scripts/agent/vm/run-cycle.sh` only: substituted into `prompt.md` as `{{MAX_DEVS}}` and
    > recorded as `maxDevs` in `cycles.ndjson`. The Actions host renders the ceiling 4.

  - the namespace paragraph — replace the sentence that calls a key in a workflow a test
    failure with:

    > **`CB_*` and `CB_AGENT_*` must not collide**: `packages/contracts/src/config.test.ts`
    > pins the daemon's key list and `apps/daemon/src/start.test.ts` fails `loadConfig` on a key
    > it does not know, so a pipeline key in `apps/daemon` is a test failure; neither reads
    > `.github/workflows`, so a daemon key in a workflow is caught by review, not by the gate.

- **`docs/agent-ci.md` §8** — the park paragraph:

  > A park repeats on every pass, and only the empty-backlog and red-streak parks open one:
  > each goes through `scripts/agent/issue.mjs` with the `agent-blocked` label, and a later pass
  > **comments** on the open issue instead of opening a second one. The brake, the window and
  > the daily cap park silently in the log. The title is the comparison key, so it never
  > carries the day's count; the body does.

- **`docs/agent-ci.md` §10** — the `CB_AGENT_MAX_DEVS` row:

  > Documented and exported by the VM scripts; `run-cycle.sh` reads it, substitutes it into the
  > prompt as `{{MAX_DEVS}}` and records `maxDevs` in the ledger. Ceiling 4, default 2. No
  > GitHub workflow reads it, so on the Actions host the wave's size is the Orchestrator's
  > judgement under the ceiling.

- **`docs/agent-ci.md` §12** — the `webfetch` bullet only:

  > `webfetch` is denied for every pipeline role — `opencode.json` sets it for `orchestrator`,
  > `architect`, `dev` and `qa`, and `scripts/agent/opencode-config.test.mjs` pins it (D60) —
  > so a poisoned document has to arrive inside the repository. A poisoned document is still
  > the injection risk worth watching: protected paths are the product's answer and the
  > pipeline has no equivalent for itself.

- **`docs/agent-vm.md` §1** — the `CB_AGENT_MAX_DEVS` clause:

  > … rising to 4 only on a 4/24 resize; `run-cycle.sh` reads `CB_AGENT_MAX_DEVS`, substitutes
  > it into the prompt as `{{MAX_DEVS}}` and records it as `maxDevs` in the ledger, so a wave's
  > size is the operator's setting under the ceiling, never a guess.

- **`docs/agent-vm.md` §3** — the `run-cycle.sh` row gains, after its verdict clause:

  > Refuses to start below 2 GB free, prunes `cycle-*.log` older than 14 days, and takes
  > `--force` to record a deliberate cycle.

  and the state line becomes `logs/cycle-*.log full transcript of every cycle, pruned after 14 days`.
- **`docs/agent-vm.md` §4** — the cycle sketch's comment line becomes
  `# prompt.md, its {{MERGE}} and {{MAX_DEVS}} placeholders substituted`.
- **`docs/agent-vm.md` §7** — after the direct-invocation paragraph, add:

  > A human can also run `run-cycle.sh --force` when the cycle is deliberate rather than
  > recovered: the ledger records `forced: true` either way, and the flag changes nothing else
  > — the script still reads no brake. `run-driver.sh --force` spends that bypass for exactly
  > one pass: the first pass skips `gate.mjs`, logs `gate bypassed for one cycle (--force)` and
  > runs the cycle with `--force`; every later pass asks the gate again. The brake is never
  > cleared by either flag.

- **`docs/agent-vm.md` §9** — the `Disk fills` row:

  > Not any more. Every cycle prunes `cycle-*.log` older than 14 days first, then measures the
  > filesystem that holds `CB_AGENT_STATE`; below 2 GB free it opens one `agent-blocked` order
  > through `scripts/agent/issue.mjs` (title `Autopilot refused: less than 2 GB free on the
  > box`, so a repeat comments instead of duplicating) and refuses to start. Under the driver
  > that non-zero exit becomes a red cycle through `record_failure`. `run-cycle.sh` also removes
  > every `../wt-cb-*` worktree and prunes the `git worktree` metadata at the start of a cycle.

- **`docs/agent-vm.md` §10** — the `webfetch` bullet only:

  > The agent runs with `--auto`, a shell and write access to `main`. `webfetch` is denied for
  > all four pipeline roles and pinned by `scripts/agent/opencode-config.test.mjs` (D60), so a
  > fetched page cannot enter a role's context; a poisoned document inside the repository is
  > the injection risk worth watching, and the pipeline has no protected-path list of its own.
  > The brake and the red-streak guard are the containment.

- **`docs/agent-pipeline.md` §2** — the clause from `The env template suggests` to the end of
  the paragraph becomes:

  > The env template suggests two dev slots (`CB_AGENT_MAX_DEVS=2`) on 2/12, rising to 4 only
  > on a 4/24 resize; `run-cycle.sh` reads the key and passes it to the prompt and the ledger,
  > and the Actions host renders the ceiling 4, so fewer cores are a reason to take fewer
  > tasks, never a licence to serialise.

- **`scripts/agent/vm/agent.env.example`** — the `CB_AGENT_GIT_TOKEN` comment becomes

  ```sh
  # The pipeline's only durable git credential on the box: contents: write + issues: write,
  # this repository only. Required on the VM. On Actions the cycle checks out with the
  # CB_AGENT_TOKEN PAT and GITHUB_TOKEN covers issues and dispatch.
  ```

  and the `CB_AGENT_MAX_DEVS` comment becomes

  ```sh
  # Dev slots per wave, read by run-cycle.sh and passed to the prompt.
  # Ceiling 4; 2 on the 2 OCPU box.
  ```

### Data

`$CB_AGENT_STATE/cycles.ndjson`, one JSON object per line, gains exactly two keys:

| Key | Type | Value | Default when absent in an old line |
| --- | --- | --- | --- |
| `maxDevs` | number | the substituted slot count, `1..4` | none — old lines are left alone |
| `forced` | boolean | `true` when the cycle was run with `--force`, else `false` | none — old lines are left alone |

Insertion order: `ts, status, reason, model, maxDevs, forced, before, head, tasks, tests, moved, issued, gate, agent, open, blocked`. `jq -r .forced` on the last line prints `true` or
`false`, never a string. No other key is renamed or removed, and `verdict.mjs` keeps its input.

Logs: `$CB_AGENT_STATE/logs/cycle-*.log`, pruned at 14 days; nothing else in `logs/` is touched.

## 🧩 Configuration

| Key | Read by | Default | Validation failure |
| --- | --- | --- | --- |
| `CB_AGENT_MAX_DEVS` | `scripts/agent/vm/run-cycle.sh` — **the only reader**, substituted into `prompt.md` as `{{MAX_DEVS}}` and recorded as `maxDevs` | `2`, from `${CB_AGENT_MAX_DEVS:-2}` (`lib.sh` does not mention the key today; `agent.env.example` ships `2`) | not an integer in `1..4` → `die "CB_AGENT_MAX_DEVS=<value> is outside 1..4 (the box's ceiling)"`, exit 1, before the lock |
| `CB_AGENT_MERGE` | unchanged | `true` | unchanged |

No new `CB_*`/`CB_AGENT_*` key is introduced, so no new row is owed. The existing
`CB_AGENT_MAX_DEVS` row in `docs/providers.md` §13 and its row in `docs/agent-ci.md` §10 are
**corrected in this task** (both currently claim nothing reads the key). The 2 GB floor and the
14-day window are constants inside the scripts, documented in `docs/agent-vm.md` §9, not keys.

`.github/workflows/agent-cycle.yml` renders `{{MAX_DEVS}}` as the literal `4`: on Actions there
is no wave-size setting and the ceiling is what the runner can honour. The key itself keeps one
reader.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim from the task's integration worktree.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — the root gate: `test:guard`, the app suite and `vitest run` (which includes the
    new `scripts/agent/**` tests).
  - `npm run build` — must pass (this task changes no workspace source; it proves nothing broke).
  - `npx vitest run scripts/agent` — the pipeline suite alone; must be green.
  - `git diff --name-only main...task-101` — audit against the exclusive paths. The only
    expected extra is `.agent_specs/task-101.md` (the spec travels in the branch and is dropped
    from the merge).

- **The harness `scripts/agent/vm/run-cycle.test.mjs` uses (frozen, so the assertion is stable):**
  - One helper builds a temp `CB_AGENT_STATE` (with `logs/` and `cycles.ndjson`), a temp clone
    directory containing a `TODO.md` with one `- [ ] **[Task-1]** …` line and an empty
    `.agent_specs/`, and a `bin/` directory of stubs that goes **first** on `PATH`.
  - `CB_AGENT_ENV` points at a path that does not exist; `CB_AGENT_MODEL=stub/model`,
    `CB_AGENT_GIT_TOKEN=stub` and `CB_AGENT_REPO=<temp clone>` are exported, and every
    inherited `CB_*`/`CB_AGENT_*` is removed first (the `isolatedEnv()` pattern of
    `scripts/release/upgrade.test.mjs`).
  - Stubs (bash scripts, `chmod +x`):
    - `git` — skips a leading `-C <dir>` pair; `status --porcelain` prints nothing;
      `rev-parse origin/main` prints 40 `a`, `rev-parse HEAD` prints 40 `b`; `log …` prints
      `dev: done task-101`; `remote get-url origin` prints `https://github.com/owner/repo.git`;
      `fetch|checkout|reset|worktree|config|diff` exit 0.
    - `gh` — `api …` prints `[]`; anything else exits 0.
    - `node` — when its argv contains `verdict.mjs` it prints
      `{"status":"shipped","reason":"stub cycle","ok":true}`; when it contains `issue.mjs` it
      appends its argv to `$NODE_LOG` and prints
      `{"action":"created","number":1,"url":"https://example.invalid/1","duplicates":[]}`;
      otherwise (recon) it exits 0.
    - `npm` — exits 0 for every subcommand. `flock` — exits 0.
    - `opencode` — appends its **last argument** (the rendered prompt) to `$PROMPT_LOG` and
      prints one line, exit 0. No marker file when `opencode` is never called.
    - `df` — prints a header line and `stub 1000000 0 $DF_AVAILABLE_KB 100% /`;
      `DF_AVAILABLE_KB=1048576` is the 1 GB refusal, `2097152` (or more) is the healthy box.
  - Real `bash`, `jq`, `sed`, `grep`, `date`, `awk` and `find` are used, so the file is
    `describe.skipIf(!have('bash') || !have('jq'))` — the `have()` helper of
    `ops/image/test/template.test.mjs` — and it must not `sleep`.
  - Test names must carry these strings, because the criteria filter on them: `prune_logs`,
    `refuses below 2 GB`, `ledger`, `MAX_DEVS`, `driver --force`. `-t` in Vitest matches the
    full test name, so a `describe('run-cycle.sh')` wrapper plus an `it('…prune_logs…')` is
    enough.

- **Acceptance criteria:**
  - [ ] `[unit]` **Every role denies `webfetch`.** `npx vitest run scripts/agent/opencode-config.test.mjs`
        passes; it reads `opencode.json` and fails if any of `orchestrator`, `architect`, `dev`,
        `qa` is missing or has `permission.webfetch !== 'deny'`.
        Also: `jq -r '.agent | to_entries[] | "\(.key) \(.value.permission.webfetch)"' opencode.json`
        prints four lines, every one ending in `deny`.
  - [ ] `[unit]` **The prune removes the old log and keeps the fresh one.**
        `npx vitest run scripts/agent/vm/run-cycle.test.mjs -t 'prune_logs'` passes: with
        `CB_AGENT_STATE` pointing at a temp directory, a `logs/cycle-2026-seed.log` touched 15
        days ago is gone after `prune_logs` and a `logs/cycle-today.log` created now is still
        there — proven by sourcing `lib.sh` in `bash`, not by reading the source.
  - [ ] `[unit]` **Below 2 GB the cycle refuses and never reaches the model.**
        `npx vitest run scripts/agent/vm/run-cycle.test.mjs -t 'refuses below 2 GB'` passes:
        with a fake `df` on `PATH` answering 1 GB available, `run-cycle.sh` exits non-zero and
        its stderr contains `2 GB`; the `opencode` stub's marker file is absent (the model was
        never called) and the `node` stub's argv log shows one
        `scripts/agent/issue.mjs --label agent-blocked` invocation with the title
        `Autopilot refused: less than 2 GB free on the box`.
  - [ ] `[unit]` **`--force` is in the ledger, both ways.**
        `npx vitest run scripts/agent/vm/run-cycle.test.mjs -t 'ledger'` passes: a cycle run
        with `--force` appends a line whose `.forced` is `true` and whose `.maxDevs` is the
        configured slot count; a cycle run with no argument appends `.forced === false`. Both
        read back with `tail -1 "$CB_AGENT_STATE/cycles.ndjson" | jq -r .forced`.
        And `npx vitest run scripts/agent/vm/run-cycle.test.mjs -t 'MAX_DEVS'` passes: the
        prompt handed to the `opencode` stub contains `at most 2 devs` (the default) and no
        `{{MAX_DEVS}}`, while `prompt.md` still contains `{{MAX_DEVS}}` and the word `4`; and
        `CB_AGENT_MAX_DEVS=9` makes `run-cycle.sh` exit non-zero naming the key.
  - [ ] `[unit]` **The bypass is a pure decision.** `npx vitest run scripts/agent/gate.test.mjs`
        passes, including the new case: `decideGate({…base, brake: 'off', openTasks: 0, force: true})`
        returns `{ go: true, reason: 'forced by --force', alert: null }`, and `force` omitted
        returns the same result as before for every existing case.
  - [ ] `[unit]` **The driver spends the bypass for exactly one pass.**
        `npx vitest run scripts/agent/vm/run-cycle.test.mjs -t 'driver --force'` passes: the test
        copies `scripts/agent/vm/**` to a temp dir, replaces the copy's `run-cycle.sh` with a stub
        that appends its arguments to `$CYCLE_LOG`, puts a `sleep` stub that exits 0 and a
        `timeout`-safe `gate.mjs` stub in the temp clone's `scripts/agent/gate.mjs` that always
        answers `{"go":false,"reason":"brake is 'off'","alert":null}`, runs
        `timeout 3 <temp-vm>/run-driver.sh --force > "$DRIVER_LOG" 2>&1 || true`, and then asserts:
        `"gate bypassed for one cycle (--force)"` appears in `$DRIVER_LOG`, the cycle stub log has
        exactly **one** line and it ends in `--force`, and `$DRIVER_LOG` also contains
        `parked: brake is 'off'` after it (the second pass asked the gate again). No `sleep` of
        the real driver is allowed to elapse — the `sleep` stub makes each wait instant.
  - [ ] `[unit]` **The scripts still parse and lint.** `bash -n scripts/agent/vm/lib.sh
        scripts/agent/vm/run-cycle.sh scripts/agent/vm/run-driver.sh` exits 0 for each, and
        `command -v shellcheck >/dev/null && shellcheck -x scripts/agent/vm/*.sh` exits 0 when
        shellcheck is installed (skip with a note when it is not).
  - [ ] `[unit]` **The false sentences are gone.** Each command below prints nothing:
        `grep -rn 'read by no shipped' docs/`,
        `grep -rn 'role reads' docs/`,
        `grep -rn 'Only the Orchestrator denies' docs/`,
        `grep -rn 'never pruned' docs/`,
        `grep -rn 'nothing prunes the logs' docs/`,
        `grep -rn 'for the window workflow only' docs/`,
        `grep -rn 'Actions uses GITHUB_TOKEN instead' scripts/`.
        And each command below prints at least one hit: `grep -n '\*\*D60\*\*' docs/decisions.md`,
        `grep -c '{{MAX_DEVS}}' scripts/agent/vm/prompt.md` (≥ 2),
        `grep -n 'pruned after 14 days' docs/agent-vm.md`,
        `grep -n '2 GB' docs/agent-vm.md`, `grep -n 'run-cycle.sh --force' docs/agent-vm.md`,
        `grep -n 'only the empty-backlog and red-streak parks' docs/agent-ci.md`.
        (`role reads` is the detector for the `CB_AGENT_MAX_DEVS` claim in
        `docs/agent-vm.md` §1 and `docs/agent-pipeline.md` §2: the sentence wraps, so the longer
        phrase must not be used as the pattern.)
  - [ ] `[unit]` **The gate is green.** `npm ci && npm run lint && npm test && npm run build`
        all pass on the merged tree.
  - [ ] `[unit]` **Nothing outside the exclusive paths was touched.**
        `git diff --name-only main...task-101` lists only the paths in *Exclusive paths* plus
        `.agent_specs/task-101.md`; no `apps/**`, no `packages/**`, no `TODO.md`, no
        `CHANGELOG.md`.
  - [ ] `[live]` **The box measures the three guards.** On the VM, with the brake **off**, as
        `cb-agent`: (a) seed `touch -d '15 days ago' "$CB_AGENT_STATE/logs/cycle-seed.log"`, run
        `scripts/agent/vm/run-cycle.sh --force`, then `test ! -e "$CB_AGENT_STATE/logs/cycle-seed.log"`
        → true; (b) put a fake `df` first on `PATH` that answers 1 GB in the `Available` column,
        run `scripts/agent/vm/run-cycle.sh --force`, and read the exit status and the message —
        non-zero and containing `2 GB`, with one `agent-blocked` issue titled
        `Autopilot refused: less than 2 GB free on the box` open (a second run comments on it,
        it does not open a second); (c) `tail -1 "$CB_AGENT_STATE/cycles.ndjson" | jq -r .forced`
        prints `true` for the forced cycle and `false` for a later unflagged
        `scripts/agent/vm/run-cycle.sh`.
        **Measurement:** those three reads (`test -e`, the exit status + message, `jq -r .forced`
        on the last ledger line). It needs the VM and a provider key, so a CI runner cannot take
        it: when it is not run, the dev opens one `agent-review` order through
        `node scripts/agent/issue.mjs --label agent-review` with these three commands, the
        literal output it did obtain, and the sentence "not measured here: no VM, no model key".

## 📣 Coordination

- **For the Architect / the human — path-list deviations, all deliberate:**
  1. `docs/providers.md` — the item says "§10's `CB_AGENT_TOKEN` row"; §10 of that file is
     `Notifications` and holds none of the four sentences. The `CB_AGENT_TOKEN` row, the
     `CB_AGENT_MAX_DEVS` row and the namespace paragraph are all in **§13**, and §13 is what
     this task claims. §10 stays untouched.
  2. Change (1) makes two sentences outside the item's list false: `docs/agent-vm.md` §10's
     security bullet ("Only the Orchestrator denies `webfetch` … so a subagent can fetch a
     page") and `docs/agent-ci.md` §12's known-holes bullet (same claim). Both are claimed and
     corrected; leaving them would ship the very contradiction the task exists to remove.
  3. Change (2) makes `docs/agent-pipeline.md` §2's `Filling` paragraph false ("no shipped
     workflow, script, prompt or role reads that key"). Its last clause is claimed and corrected.
  4. `prompt.md` is the canonical copy both hosts read. `{{MAX_DEVS}}` therefore needs a
     substitution on the Actions host too, or that host receives a raw placeholder; one line of
     `.github/workflows/agent-cycle.yml` renders it as the literal `4` (the ceiling). The key
     keeps exactly one reader.
  5. `.agent_roles/orchestrator.md` holds **no** slot-ceiling sentence (checked: the only
     "dev slots" wording in `.agent_roles/` is `architect.md`'s generic line). It is untouched:
     the per-run ceiling arrives through the prompt, where it can change without editing a role.
- **For QA / integration:** the two new test files are picked up automatically by the `scripts`
  Vitest project (`vitest.config.ts`, `include: ['**/*.test.mjs']`, `root: './scripts'`), so
  `npx vitest run scripts/agent` and the root `npm test` both run them. The `run-cycle` test
  shells out to `bash` with a stub `PATH` (the `scripts/release/upgrade.test.mjs` pattern); it
  must skip with `it.skipIf` when `bash` or `jq` is absent, exactly like
  `ops/image/test/template.test.mjs` does for its binaries.
- **For the next batch:** the frozen surface is `decideGate({force})`, `run-cycle.sh [--force]`,
  `run-driver.sh [--force]`, the `{{MAX_DEVS}}`/`{{MERGE}}` placeholders, `lib.sh`'s `free_gb`
  and `prune_logs`, and the ledger keys `maxDevs`/`forced`. Nothing else may be assumed.
- **For the Orchestrator at merge:** tick `[Task-101]` in `TODO.md` and add the `CHANGELOG.md`
  entry in the same push as the merge. The dev leaves both files untouched.

## ⛔ Out of scope

- **The product is out of bounds.** No file under `apps/**` or `packages/**`. In particular
  `packages/core/src/permissions.ts` already denies `webfetch` for `cbd`'s runs and does not
  change; `packages/contracts` gains no key; the app gains no screen.
- No behaviour change beyond the four bullets: no new guard, no new `CB_*`/`CB_AGENT_*` key, no
  change to `verdict.mjs`, `recon.mjs`, `issue.mjs`, `brake.sh`, `install.sh`,
  `cb-agent.service.in` or any other workflow than the one `sed` line above.
- No rotation of the 14-day window or the 2 GB floor into configuration; they are constants and
  are documented as such.
- No refactor of `run-cycle.sh`'s existing steps (the retry branch, the post-merge gate, the
  verdict and the summary table keep their order and wording except the two additions named
  above).
- No `TODO.md`, no `CHANGELOG.md`, no `.agent_specs/resume.md`, no reformatting of a doc section
  this task does not have to correct.
- No new dependency; `jq`, `find`, `df`, `awk` and `sed` are already assumed by the scripts.

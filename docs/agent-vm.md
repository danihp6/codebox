# The VM host

[`agent-ci.md`](agent-ci.md) describes the protocol and its GitHub Actions host.
[`agent-pipeline.md`](agent-pipeline.md) owns the rules. This file describes the other host:
one always-on Linux box that runs the same cycle itself, with no runner minutes, no
dispatched workflows and no cron. The cycle's semantics do not change — `main` plus the live
`task-<ID>` branches are still the only state — only who executes the ritual changes.

This box is also the product's box. That is the one thing the donor project did not have to
solve, and most of this document is about keeping the two apart.

## 1. Why the box

Three facts push the loop off Actions:

- **The source repository is assumed private**, so minutes are billed and a three-task cycle
  is roughly an hour and a half of them. On a public repository this reason disappears and the
  box is left with the other two.
- **Cron is a request, not a promise.** The donor's `*/30` schedule fired three times in six
  hours overnight, so the loop already chains itself from inside a cycle; a dead cycle ends
  the chain.
- **A job is capped at six hours** and the runner is 2 cores with a cold tree: every cycle
  pays `npm ci`, the Angular build and (for `[live]` criteria) a Playwright browser download.

The OCI Always Free Ampere box — 2 OCPU / 12 GB, 100 GB boot volume — removes all three and
keeps `node_modules` and the browser warm. It is not a big machine, so the pipeline's slot
count is resource-bound: `CB_AGENT_MAX_DEVS=2` on 2/12, rising to 4 only on a 4/24 resize.

## 2. Separation from the product

The product and the pipeline share a kernel and nothing else. Different users, units,
directories, ports and credentials:

| | Product (`cbd`) | Pipeline |
| --- | --- | --- |
| User | `codebox` | `cb-agent` |
| Unit | `codebox.service` (+ `codebox-opencode.service`) | `cb-agent.service` (the driver) |
| Code | `/opt/codebox` release artifact | `/srv/cb-agent/codebox` git clone |
| State | `/var/lib/codebox` | `/var/lib/cb-agent` |
| Worktrees | `/srv/codebox/worktrees/<runId>` | `/srv/cb-agent/wt-cb-<ID>` |
| Listener | `127.0.0.1:8787`, OpenCode on `4096` | no fixed listener; `opencode run` may use a loopback ephemeral port |
| Config | `/etc/codebox/instance.env` | `/etc/codebox/cb-agent.env` |
| Credentials | GitHub App, Vault, tunnel token | one scoped PAT and one inference key |

Rules that follow from the table:

- The pipeline **never** reads `instance.env`, writes `/var/lib/codebox`, opens port 4096 or
  installs a release. It builds and tests the product in its own clone; it does not operate
  the product.
- The product **never** reads `cb-agent.env`, and systemd starts the two units independently.
  A pipeline cycle that dies does not degrade `cbd`; a `cbd` restart does not interrupt a
  cycle.
- A test that needs a running daemon starts one **on an ephemeral port with a temporary
  `CB_STATE_DIR`**, wired to `FakeOpenCode` and a stub `GitProvider`. It does not start the
  systemd units and does not need a real GitHub token.
- The pipeline's merge to `main` is git, not `cbd`'s PR path. The product's G1–G8 guardrails
  protect the repositories Codebox operates; the pipeline's guardrails are its gate and its
  QA waves.

## 3. The pieces

| Piece | What it does |
| --- | --- |
| `run-driver.sh` | The loop: reads the brake, the backlog and today's ledger, asks `gate.mjs`, and runs a cycle when the answer is yes. Runs as a systemd service. |
| `run-cycle.sh` | One cycle: fetch, reset, recon, `opencode run --agent orchestrator --auto`, post-merge gate, verdict, one line in the ledger. Holds the lock. |
| `gate.mjs` | The decision, pure and unit-tested (`gate.test.mjs`): brake, window, backlog, red streak, cap — in that order. |
| `verdict.mjs` | The cycle's verdict, pure and unit-tested (`verdict.test.mjs`): a red gate fails; a moved `main` or an opened issue is green even when the stream died. Shared with Actions. |
| `brake.sh` | The brake by hand (`on`, `off`) or by window (`window 4`), plus `status` and `reset`. |
| `prompt.md` | The Orchestrator's prompt. **The canonical copy**: `agent-cycle.yml` reads this file too, so the two hosts cannot drift. |
| `install.sh` | Bootstrap: user, directories, git, Node 24, OpenCode, Playwright dependencies, the env template and the unit. |
| `recon.mjs` | The same ref reader the Actions host uses. Node built-ins only, so it runs before `npm ci`. |

State lives in `$CB_AGENT_STATE` (default `/var/lib/cb-agent`):

```
brake            `on` or anything else
window           "<from epoch> <until epoch>", present only while a range is armed
cycles.ndjson    one line per cycle: ts, status, tasks, gate, agent, moved, issued…
logs/cycle-*.log full transcript of every cycle, kept 14 days
last-cycle.md    the markdown summary of the last one
lock             flock target: one cycle at a time
alerts           "title:date" lines, so a parked loop nags once a day, not every wake-up
```

**Nothing in that directory is required to resume.** It is evidence, not state; the refs are
the state. Losing it costs history, not a task.

## 4. One cycle on the box

```bash
flock "$CB_AGENT_STATE/lock" run-cycle.sh
  git fetch --prune
  git checkout main && git reset --hard origin/main
  node scripts/agent/recon.mjs                    # built-ins only
  opencode run --agent orchestrator --auto --model "$CB_AGENT_MODEL" < scripts/agent/vm/prompt.md
  npm ci --prefer-offline --no-audit --no-fund && npm run lint && npm test && npm run build
  node scripts/agent/verdict.mjs                  # green / red + reason
  append cycles.ndjson; write last-cycle.md
```

- `git reset --hard origin/main` is safe **because nobody edits that clone**: every change
  travels through a `task-<ID>` branch on `origin`. A dirty tree or a rebase in progress is a
  hard refusal, not a discard — the script stops and says which file is dirty.
- `recon.mjs` runs before any install so a broken dependency tree cannot hide the state of the
  branches. The clone needs no `node_modules` before the cycle: `recon.mjs` and `verdict.mjs`
  use Node built-ins and `opencode` is installed globally. The dev worktrees install their own
  dependencies; the post-merge gate installs from the lockfile.
- The lock is `flock`, not a pid file: a killed process releases it and the next cycle
  proceeds. `run-cycle.sh` refuses to start if another cycle holds it.
- The post-merge gate is the same command as `ci.yml`, run on the merged tree. A red gate
  after a merge is a **red cycle** and parks the loop; the merge is not undone automatically,
  because a revert is a decision.
- The transcript is appended, never truncated. A cycle that hangs holds the lock until
  `TimeoutStartSec` on the unit (see §6) kills it; the next cycle then reads a branch that is
  mid-task and adopts it per the markers.

## 5. Bootstrap

On the VM, as the `ubuntu` user:

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/<owner>/codebox.git /srv/cb-agent/codebox
sudo /srv/cb-agent/codebox/scripts/agent/vm/install.sh
```

The clone is made once with the admin's credential (SSH key or a PAT); `install.sh` re-owns
the tree to `cb-agent` and installs the token-backed helper, so the admin credential is not
needed afterwards.

`install.sh` creates the `cb-agent` user (system, no password, `nologin`), `/var/lib/cb-agent`
and `/srv/cb-agent`, installs Node 24 and OpenCode, runs `npm ci` once, installs the
Playwright browser, writes `/etc/codebox/cb-agent.env` from a template (`0600`,
`root:cb-agent`) and enables `cb-agent.service` **without starting it**.

Then the two credentials, neither of which is in the repository:

```ini
# /etc/codebox/cb-agent.env, 0600 root:cb-agent
ANTHROPIC_API_KEY=…            # whichever provider CB_AGENT_MODEL names
CB_AGENT_MODEL=anthropic/claude-…
CB_AGENT_GIT_TOKEN=github_pat_…   # contents: write + issues: write, this repo only
CB_AGENT_STATE=/var/lib/cb-agent
```

`CB_AGENT_GIT_TOKEN` is the pipeline's only durable credential on the box. On Actions the
ephemeral `GITHUB_TOKEN` covered the push; a service needs one that outlives a job. Scope it
to this repository, grant `contents: write` and `issues: write`, nothing else — no
`variables`, no `workflows`, no admin. The inference key is the second.

`install.sh` installs a credential helper in the clone that reads the token from the
environment file through `GIT_ASKPASS`, so the secret never appears in `argv` (and therefore
never in `ps` or a shell history). `run-driver.sh` refuses to start when `CB_AGENT_MODEL` or
its provider key is missing, naming the key and exiting 1: a half-configured service would
burn one red cycle per wake-up.

```bash
/srv/cb-agent/codebox/scripts/agent/vm/brake.sh status   # must read off
sudo systemctl start cb-agent
journalctl -u cb-agent -f
```

The brake is **off** after install. Arming it is a deliberate human act.

## 6. The unit

```ini
[Unit]
Description=Codebox agent driver
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=cb-agent
Group=cb-agent
EnvironmentFile=/etc/codebox/cb-agent.env
ExecStart=/srv/cb-agent/codebox/scripts/agent/vm/run-driver.sh
Restart=on-failure
RestartSec=30
TimeoutStartSec=21600
Nice=10
CPUQuota=150%
MemoryMax=10G
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/cb-agent /srv/cb-agent
```

- `CPUQuota=150%` leaves half of the 2 OCPU box for `cbd` and its OpenCode child;
  `MemoryMax=10G` leaves the daemon headroom on 12 GB. On a 4/24 resize both move up
  (`300%`, `20G`) and `CB_AGENT_MAX_DEVS` may rise to 4.
- `TimeoutStartSec=21600` (six hours) is the same ceiling Actions gives a job, so a hung
  cycle is killed by systemd rather than by a human noticing.
- `ProtectSystem=strict` makes `/etc` and `/opt` read-only, which is also what stops the
  pipeline from touching the product's release or its env file.
- The unit is enabled at boot. A reboot mid-cycle loses that cycle; the branch is adopted.

## 7. Operating it

```bash
brake.sh status             # what the driver would read: brake, window, today's counts
brake.sh off                # park at the next boundary; a merge is never cut in half
brake.sh window 6           # run for six hours, starting now
brake.sh window 6 23:00     # ... starting today at 23:00 UTC
brake.sh reset              # forget today's red streak, after a human looked at it
systemctl status cb-agent
tail -f /var/lib/cb-agent/cycles.ndjson
```

The guards are the Actions loop's guards, deliberately: an empty backlog parks with one
issue a day, three red cycles park the loop, `CB_AGENT_DAILY_CYCLES` caps the day when set,
and the window is a belt under the brake — a stale `on` cannot start a cycle past its end.
`brake.sh` is the only writer of that state.

A human at the shell can run one cycle with `run-cycle.sh --force`, which ignores the brake
for that cycle and records `forced` in the ledger. It is the recovery path when the loop is
parked, not a way to keep working with the brake off.

## 8. What differs from the workflow

| | Actions | VM |
| --- | --- | --- |
| Trigger | cron + a chain from the cycle's last step | a `while` loop, 30 s between cycles |
| Concurrency | `concurrency: agent-cycle` | `flock` on `$CB_AGENT_STATE/lock` |
| Brake | repository variable `CB_AGENT_AUTOPILOT` | `$CB_AGENT_STATE/brake` |
| Window | `CB_AGENT_FROM`/`UNTIL` + an hourly workflow | `$CB_AGENT_STATE/window`, read by the gate |
| Credential for `main` | `GITHUB_TOKEN`, per run | a scoped PAT in `cb-agent.env` |
| Machine | 2 cores, 7 GB, cold every time | 2 cores, 12 GB, warm caches, also runs the product |
| Job limit | 6 h, then killed | `TimeoutStartSec=21600`, then killed |
| History | run summaries in the UI | `cycles.ndjson`, `logs/`, `last-cycle.md` |
| The cycle's code | `agent-cycle.yml` | `run-cycle.sh` + the same `prompt.md` |

`agent-cycle.yml` stays as the manual fallback (`gh workflow run agent-cycle.yml`): it
appears in the runs UI, it can be dispatched on a branch, and it is the way to run a single
cycle without waking the box. The two hosts share `prompt.md` and the two pure modules; both
are fine with the other being the primary.

## 9. Recovery

| Situation | What happens |
| --- | --- |
| The driver dies | `Restart=on-failure` restarts it; `flock` is released, so no stale lock. |
| A cycle hangs | `TimeoutStartSec` kills it; the next cycle adopts the live branch from its marker. |
| The box reboots | The unit starts; one cycle runs when the brake allows. A mid-task branch is adopted. |
| `main` moved during the final push | Fetch, merge `origin/main` into the task branch, re-gate, push. If it still fails, the branch stays at `qa: pass` for the next cycle. |
| Disk fills | `run-cycle.sh` prunes merged worktrees at start and keeps 14 days of logs. `cb-agent` refuses to start a cycle below 2 GB free and opens one issue. |
| The box is rebuilt | `install.sh`, two credentials, clone; the refs restore every task. The state directory is not restored — it is evidence |
| The product is unhealthy | Not the pipeline's business, unless the cycle's gate says so. `cb doctor` is the product's tool, not the driver's. |

A rebuild takes minutes because the image (`docs/vm-image.md`) already carries Node, git and
the tools; only `npm ci` and the Playwright browser are paid again.

## 10. Security

- Inbound: SSH only, from the admin address (`docs/oci.md`). The pipeline has no listener.
- The `cb-agent` user cannot read `/etc/codebox/instance.env` (mode `0600`,
  `root:codebox`) and is not in the `codebox` group. `ProtectSystem=strict` makes `/opt`
  read-only.
- The PAT lives in one `0600` file, scoped to this repository, with `contents: write` and
  `issues: write`. It cannot change repository variables, workflows or settings, so a
  compromised box cannot rewrite the loop's own brake on the Actions host.
- The inference key is the other secret. Both rotate by hand: `brake.sh off`, edit,
  `systemctl restart cb-agent`.
- The agent runs with `--auto`, a shell and write access to `main`. `webfetch` is denied for
  every pipeline role, so the repository is the only input; a poisoned document inside it is
  the injection risk worth watching, and the pipeline has no protected-path list of its own.
  The brake and the red-streak guard are the containment.
- The pipeline never gets the product's GitHub App key, Vault token or tunnel token. It does
  not need them: it pushes to one repository and opens issues there.

## 11. Going back to Actions

The box is not load-bearing: `main` and the branches are the state.

```bash
sudo systemctl disable --now cb-agent
gh variable set CB_AGENT_AUTOPILOT --body on
gh workflow run agent-autopilot.yml
```

Set `CB_AGENT_FROM` / `CB_AGENT_UNTIL` first if a window is wanted. Nothing in the
repository changes, and the two hosts can alternate a cycle at a time as long as both are not
armed at once — they share `main` and the markers, not a lock.

## 12. What Batch 1 must prove

- `brake.sh status` reads **off** after `install.sh`, and the unit is enabled but idle.
- One manual `run-cycle.sh --force` ships a docs-only task through the full ritual on the box.
- A cycle that moves nothing is red, and three reds park the loop until `brake.sh reset`.
- `brake.sh window 0` leaves the brake off and the window file empty.
- A reboot mid-task is adopted by the next cycle, not redone blindly.
- The driver can read `/srv/cb-agent/codebox` but not `/etc/codebox/instance.env` or
  `/var/lib/codebox`; `systemd-analyze verify` is clean.
- `CB_AGENT_*` appears in no daemon file and `CB_*` in no pipeline file.

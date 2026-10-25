# Spec: Task-37 — Instance liveness

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

> **Plan deviation, read first.** The batch cut listed `ops/image/scripts/60-service.sh` but not
> two files the task cannot work without:
>
> 1. `ops/image/codebox.pkr.hcl`. That template uploads **every** host script and unit one `file`
>    provisioner at a time (lines 92–150); a `60-service.sh` that installs `keepalive.sh` without a
>    matching upload block fails the image build with
>    `install: cannot stat '/tmp/codebox/vm/keepalive.sh'`.
> 2. `ops/image/test/template.test.mjs`. It asserts the **exact** unit list
>    (`expect(units).toEqual([...5 names...])`, line 172) and the sandbox block on **every**
>    `.service` (lines 181–192). Two new unit files fail it until the expected list names them.
>
> Both are exclusive paths of this task; no other task in Batch 5 claims either.

## 🎯 Scope

- **Task type:** ops (host shell + systemd units + a headless Node test). No TypeScript, no
  daemon, no app.
- **Role:** Dev.
- **Objective:** After this task, the box measures its own liveness instead of guessing at it:
  `ops/vm/keepalive.sh` samples `/proc` twice a second apart, appends one JSON line to
  `/var/lib/codebox/logs/keepalive.jsonl`, and then runs a bounded, useful pass (`cb doctor`,
  `cb prune`, a loopback `GET /v1/health`) in which every step is optional and a missing CLI or
  a stopped daemon is reported `skipped` and never fails the run. `codebox-keepalive.service` and
  `codebox-keepalive.timer` run it every six hours with `Persistent=true`, and the image installs
  and enables both units beside the backup pair. No synthetic load: D39 refuses a burner, it does
  not forget one.
- **Environment:** worktree `../wt-cb-37`, branch `task-37`, base `main`.
- **Dependencies:** Task-25 (merged): `ops/vm/lib.sh` (`ROOT`, `die`, `log`, `rooted`, `need`,
  `need_bin`, `usage`), `ops/vm/systemd/codebox-backup.service` and `.timer` (the shape to copy),
  `ops/image/scripts/60-service.sh` (the installer to extend), `ops/image/codebox.pkr.hcl` (the
  upload list to extend), `ops/vm/test/backup.test.mjs` (the test pattern).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `ops/vm/keepalive.sh` (new)
- `ops/vm/systemd/codebox-keepalive.service` (new)
- `ops/vm/systemd/codebox-keepalive.timer` (new)
- `ops/vm/test/keepalive.test.mjs` (new)
- `ops/image/scripts/60-service.sh` (modify: the script loop, two unit installs, one enable)
- `ops/image/codebox.pkr.hcl` (modify: three `file` provisioners — see the deviation note)
- `ops/image/test/template.test.mjs` (modify: the expected unit list and the describe title)
- `ops/vm/README.md` (modify: the files table, the unit counts, the commands block)
- `docs/oci.md` (section §6 only — "Capacity and shape")
- `docs/operations.md` (section §10.5 only — "The instance vanished")

### Inputs (read-only)

- `ops/vm/lib.sh`, `ops/vm/backup.sh`, `ops/vm/systemd/codebox-backup.service`,
  `ops/vm/systemd/codebox-backup.timer`, `ops/vm/systemd/codebox.service`
- `ops/image/scripts/60-service.sh`, `ops/image/codebox.pkr.hcl`,
  `ops/image/test/template.test.mjs`
- `ops/vm/test/backup.test.mjs`, `ops/vm/test/verify.test.mjs`
- `docs/oci.md` §6, `docs/operations.md` §10.5, `docs/decisions.md` (D33, D39)
- `packages/contracts/src/config.ts` (only to confirm `CB_BIND` defaults to `127.0.0.1:8787`)
- `apps/daemon/src/cli/args.ts` (only to confirm which `cb` commands exist)

## 🔒 Contract

### `ops/vm/keepalive.sh`

Bash, `#!/usr/bin/env bash`, `set -euo pipefail`, sources `lib.sh` from its own directory exactly
like `backup.sh` does. Executable (`0755`), installed as `0750 root:root`.

**CLI**

```
usage: keepalive.sh [--report] [--proc DIR] [--root DIR] [--log FILE]
                    [--health-url URL] [--cb PATH] [--help]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--report` | off | Print the sample to stdout as exactly one JSON line and **skip the pass**. |
| `--proc` | `/proc` | Directory the sample is read from (`/proc/stat`, `/proc/meminfo`, `/proc/net/dev`, `/proc/loadavg`, `/proc/uptime`). |
| `--root` | `/` | Sets `ROOT` for `rooted` (already implemented in `lib.sh`). |
| `--log` | `$(rooted /var/lib/codebox)/logs/keepalive.jsonl` | Append target. Its parent directory is created with `mkdir -p`. |
| `--health-url` | `http://127.0.0.1:8787/v1/health` | The only URL the script may contact. Its host must be `127.0.0.1`, `localhost` or `[::1]`; anything else exits `2` with `codebox: error: health-url is not loopback`. |
| `--cb` | resolved (see below) | Path to the `cb` executable. |

Any unknown flag, or a value flag without a value: print `usage_text` to stderr and exit `2`.
`--help` prints `usage_text` to stdout and exits `0` (`usage` from `lib.sh`).

**`cb` resolution, in order**

1. `--cb PATH` when given (used verbatim, even if it does not exist — that is how "absent" is
   tested).
2. `command -v cb`.
3. `$(rooted /opt/codebox)/current/apps/daemon/bin/cb.mjs` when that file exists → run it as
   `node <file>`.
4. Otherwise the CLI is **absent**.

**The sample**

Two reads of the four `/proc` files, one second apart (`sleep 1`). One JSON object, one line,
keys in exactly this order, no spaces after `:` or `,`:

```json
{"at":"2026-10-25T06:40:00Z","cpuBusyPct":1.4,"memUsedPct":37.2,"netBytes":123456,"load1":0.08,"uptimeSeconds":345600}
```

| Key | Type | Derivation |
| --- | --- | --- |
| `at` | string | `date -u +%Y-%m-%dT%H:%M:%SZ` at the second read. |
| `cpuBusyPct` | number, 1 decimal | From the `cpu` line of `/proc/stat`: `total` = sum of fields 1–8 (`user nice system idle iowait irq softirq steal`), `idle` = `idle + iowait`. `100 * (Δtotal − Δidle) / Δtotal`, `printf '%.1f'`. **`0.0` when Δtotal is 0** (a static stub, a frozen `/proc`). |
| `memUsedPct` | number, 1 decimal | From `/proc/meminfo`: `100 * (1 − MemAvailable/MemTotal)`, `printf '%.1f'`. Both keys in kB. |
| `netBytes` | integer | From `/proc/net/dev`, second read: for every interface **except `lo`**, `rx_bytes` (field 1) + `tx_bytes` (field 9), summed. Cumulative, never a rate. |
| `load1` | number, 2 decimals | First token of `/proc/loadavg`, `printf '%.2f'`. |
| `uptimeSeconds` | integer | First token of `/proc/uptime`, floored (`printf '%.0f'`). |

A missing or unreadable input file, or a `/proc/meminfo` without `MemTotal`/`MemAvailable`, is
`die 2 "<path> is not readable"`. Never print a partially filled line.

**The pass** (only when `--report` is absent), in this order, each step bounded by
`timeout 120`:

| Step | Command | `ok` | `skipped` | `failed` |
| --- | --- | --- | --- | --- |
| `doctor` | `<cb> doctor` | exit `0` | CLI absent (`absent`) | any other non-zero exit |
| `prune` | `<cb> prune` | exit `0` | CLI absent (`absent`), or stderr contains `unknown command: prune` (`unsupported`) | any other non-zero exit |
| `health` | `curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "$health_url"` | HTTP `200`–`299` | anything else, detail `http <code>` (`000` for a refused connection) | never |

One stderr line per step, through `log`:

```
codebox: step doctor ok
codebox: step prune skipped: unsupported
codebox: step health skipped: http 000
```

The pass **never** changes the exit code. `prune` is `skipped: unsupported` today because
`apps/daemon/src/cli/args.ts` has no `prune` command; the step is written so that it turns `ok`
the day the CLI grows one, and that forward compatibility is the reason it is not an error.

**Exit codes** (the `lib.sh` table): `0` success — including every pass outcome; `2` usage, a
missing input or a non-loopback `--health-url`. Never `1`, `3`, `4`, `5` or `6`.

**Output**

- The JSON line is **always** appended to `$log` (`>>`, one `printf`, trailing newline).
- With `--report` it is **also** printed to stdout, exactly once, and nothing else goes to stdout.
- Without `--report` stdout stays empty; the sample lives in the log, the steps on stderr.

### `ops/vm/systemd/codebox-keepalive.service`

Copy the shape of `codebox-backup.service`: `Type=oneshot`, `User=codebox`, `Group=codebox`, the
sandbox block (`NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`,
`PrivateTmp=true`, and **exactly** `ReadWritePaths=/var/lib/codebox /srv/codebox` — `/srv/codebox`
is there because `cb prune` removes finished worktrees under `/srv/codebox/worktrees`), **no
`[Install]` section** (the timer triggers it), plus `TimeoutStartSec=300`.
`ExecStart=/usr/local/lib/codebox/keepalive.sh`, no arguments.
`After=network-online.target` and `Wants=network-online.target`. The exact `ReadWritePaths` line
matters: `ops/image/test/template.test.mjs` asserts it on every `.service` file.

### `ops/vm/systemd/codebox-keepalive.timer`

```
[Unit]
Description=Codebox liveness pass every six hours

[Timer]
OnCalendar=*-*-* 00/6:40:00
Persistent=true
Unit=codebox-keepalive.service

[Install]
WantedBy=timers.target
```

Four fires a day at 00:40, 06:40, 12:40 and 18:40 UTC → **28 lines in seven days**, the number
`docs/oci.md` §6 and the `[live]` criterion quote. No `RandomizedDelaySec`: the count must be
exact.

### `ops/image/scripts/60-service.sh`

- Add `keepalive.sh` to the existing `for script in ...` loop (nothing else in the loop changes).
- `install -m 0644 -o root -g root "$staging/units/codebox-keepalive.service"
  /etc/systemd/system/codebox-keepalive.service` and the same for the `.timer`, after the backup
  pair.
- `systemctl enable` gains `codebox-keepalive.timer` on the same line.
- The header comment's "the five units" becomes "the seven units".

### `ops/image/codebox.pkr.hcl`

Three `file` provisioners after the backup pair, in this exact shape:

```hcl
  provisioner "file" {
    source      = "${path.root}/../vm/systemd/codebox-keepalive.service"
    destination = "/tmp/codebox/units/codebox-keepalive.service"
  }
```

and the same for `codebox-keepalive.timer` → `/tmp/codebox/units/codebox-keepalive.timer`, and
`${path.root}/../vm/keepalive.sh` → `/tmp/codebox/vm/keepalive.sh`. Nothing else in the template
changes.

### `ops/image/test/template.test.mjs`

Two edits, no more:

- The expected list in `it('ships the four services and the timer', …)` becomes the sorted list of
  **seven**: `cloudflared.service`, `codebox-backup.service`, `codebox-backup.timer`,
  `codebox-keepalive.service`, `codebox-keepalive.timer`, `codebox-opencode.service`,
  `codebox.service`. Rename the `it` to `'ships the five services and the two timers'`.
- The `describe('the five units', …)` title becomes `'the seven units'`.

Leave the sandbox loop and the secret scan untouched: the new service already satisfies both, and
`keepalive.test.mjs` must not contain any of the ten token patterns the scan looks for.

### Data

No new `CB_*` key, no new dependency, no change to `packages/contracts`. The only new file path is
`/var/lib/codebox/logs/keepalive.jsonl`, one JSON object per line, append-only, written by the
`codebox` user. Retention is **not** this task's problem (Task-27 owns retention).

## 🧩 Configuration

None. No `CB_*` variable is added or read: the script's knobs are flags, because a `CB_*` key
would owe a line in `docs/providers.md`, which is outside this task's paths. The default health
URL matches `CB_BIND`'s default (`127.0.0.1:8787`) and is a flag precisely so the two cannot
drift silently.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass (`eslint .` covers `ops/vm/test/keepalive.test.mjs`).
  - `npm test` — Vitest. The root config's `ops` project already includes
    `ops/**/test/**/*.test.mjs`, so this task's test runs there with no config change. Confirm
    `ops/vm/test/keepalive.test.mjs` appears in the run.
  - `npm run build` — must pass; this task adds no TypeScript, so it is a regression gate only.
  - `bash -n ops/vm/keepalive.sh` and `bash -n ops/image/scripts/60-service.sh` — syntax.
  - `command -v shellcheck >/dev/null && shellcheck ops/vm/keepalive.sh ops/image/scripts/60-service.sh`
    — run it when available, do not install it.
  - `git diff --name-only main...task-37` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` It lints, tests and builds clean.
  - [ ] `[unit]` `bash -n` passes on both shell files and
        `packer fmt -check -recursive ops/image` reports no change (skip the `packer` command when
        the binary is absent, and say so in the report).
  - [ ] `[unit]` `node --input-type=module -e` style check by hand:
        `bash ops/vm/keepalive.sh --report --proc <stub> --log <tmp>` prints **exactly one** line,
        it parses as JSON, `Object.keys()` is exactly
        `['at','cpuBusyPct','memUsedPct','netBytes','load1','uptimeSeconds']`, exit code `0`, and
        `<tmp>` now holds the identical line.
  - [ ] `[unit]` On a stub `/proc` with `MemTotal: 1000 kB` / `MemAvailable: 250 kB`, an `eth0`
        line of `rx 1000 / tx 500` and a `lo` line with large counters, `loadavg` `0.08 0.04 0.01`
        and `uptime` `345600.00 1.00`, the printed object is exactly
        `{"at":"<ts>","cpuBusyPct":0.0,"memUsedPct":75.0,"netBytes":1500,"load1":0.08,"uptimeSeconds":345600}`
        with `at` matching `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`. A static `/proc` makes
        Δtotal 0, which pins `cpuBusyPct` to `0.0`.
  - [ ] `[unit]` With `--cb /nonexistent/cb` and a `--health-url` on a port that was bound and
        then closed by the test, the run exits `0`, writes the JSON line, and stderr contains
        `step doctor skipped`, `step prune skipped` and `step health skipped` (three lines, one
        each). Nothing on stdout.
  - [ ] `[unit]` With a stub `cb` that exits `0` for `doctor` and prints `cb: unknown command: prune`
        to stderr and exits `5` for `prune`, stderr contains `step doctor ok` and
        `step prune skipped: unsupported`, exit `0`.
  - [ ] `[unit]` With a `node:http` server on `127.0.0.1:0` answering `200 {"status":"ok"}`, the
        run reports `step health ok` and exits `0`.
  - [ ] `[unit]` `--health-url http://example.com/v1/health` exits `2`, stderr contains
        `health-url is not loopback`, and no `curl` was attempted (assert no `step health` line).
  - [ ] `[unit]` Loopback only, statically: the file contains exactly one `curl` invocation, that
        line contains `"$health_url"`, and the only `http://`/`https://` literal in the file is the
        default `http://127.0.0.1:8787/v1/health`. A fixture run (previous criterion) proves the
        same at runtime.
  - [ ] `[unit]` `ops/image/scripts/60-service.sh` (read as text) installs `keepalive.sh` through
        the host-script loop, installs `codebox-keepalive.service` and `codebox-keepalive.timer`
        under `/etc/systemd/system/`, and its `systemctl enable` line names
        `codebox-keepalive.timer`.
  - [ ] `[unit]` `ops/image/codebox.pkr.hcl` (read as text) has three `file` provisioners whose
        destinations are `/tmp/codebox/vm/keepalive.sh`, `/tmp/codebox/units/codebox-keepalive.service`
        and `/tmp/codebox/units/codebox-keepalive.timer`.
  - [ ] `[unit]` `ops/image/test/template.test.mjs` passes, including the unit list (seven sorted
        names) and the sandbox loop, which now also runs over `codebox-keepalive.service`.
  - [ ] `[unit]` The timer file contains `OnCalendar=*-*-* 00/6:40:00`, `Persistent=true` and
        `Unit=codebox-keepalive.service`; the service file contains
        `ExecStart=/usr/local/lib/codebox/keepalive.sh`, has no `[Install]` section and carries
        `NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true` and
        `ReadWritePaths=/var/lib/codebox /srv/codebox` verbatim.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-37` lists only the ten paths above.
  - [ ] `[live]` **Reported as `[?]`, never as passing in CI.** There is no VM and no OCI console on
        a GitHub Actions runner. On the reference box, after seven days: `wc -l
        /var/lib/codebox/logs/keepalive.jsonl` reports **28**, `systemctl list-timers
        codebox-keepalive.timer` shows the next elapse within six hours, and the OCI console's
        instance page shows **no** "idle / will be reclaimed" warning for the instance. Measurement
        to run on the box, reported as `[?]` with the two outputs pasted into the QA report:
        `ssh cb 'wc -l /var/lib/codebox/logs/keepalive.jsonl; systemctl list-timers codebox-keepalive.timer --no-pager'`.

## 📣 Coordination

- **For the Architect:** two files had to join this task's paths (see the deviation note):
  `ops/image/codebox.pkr.hcl` (the upload list) and `ops/image/test/template.test.mjs` (the exact
  unit list). Three other facts for the plan: (a) `cb prune` does not exist in
  `apps/daemon/src/cli/args.ts`, so the step is `skipped: unsupported` on the box today — the
  `docs/oci.md` §6 sentence that names `cb prune` stays true, and no task owns adding the command;
  (b) `docs/operations.md` §10.5 is a `docs/*.md` section shared with no other task in this batch;
  (c) the keepalive service needs `/srv/codebox` in `ReadWritePaths` because `prune` deletes
  worktrees, which is also why the image's sandbox assertion passes unchanged.
- **For the Orchestrator:** the `[live]` criterion needs a human at the OCI console on day seven.
  It must be filed as `[?]`, not as a pass.
- **For the next batch:** Task-27 (retention) owns trimming `keepalive.jsonl`; Task-28 touches
  `ops/vm/systemd/**` and must keep the keepalive units' sandbox block identical to the backup
  pair's.
- **For QA:** the stub `/proc` is a directory of five files; `--proc` must not be given a path with
  a trailing slash that breaks `printf '%s/%s'`.

## ⛔ Out of scope

- No synthetic load, no CPU burner, no `stress-ng`, no `yes > /dev/null` (D39).
- No new dependency (no `jq`: the JSON is built with `printf`; no `sysstat`, no `vnstat`).
- No new `CB_*` key, no change to `docs/providers.md`, no change to `docs/decisions.md`.
- No change to `ops/vm/install.sh`, `upgrade.sh`, `backup.sh`, `restore.sh`, `cloud-init.sh` or
  `lib.sh`.
- No log rotation, no retention policy, no alerting, no metric endpoint.
- No `cb prune` implementation: the CLI is not this task's path.
- No edit to `apps/app/README.md`, `ops/image/README.md` or `CHANGELOG.md` (the batch owner updates
  them once, after the merge).

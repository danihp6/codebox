# Operations

The runbook for one box. Everything here is executed by the owner over SSH or from the `cb`
CLI; nothing assumes a second operator, a pager or a monitoring vendor (D23).

## 1. Layout on the host

| Path | Contents | Owner |
| --- | --- | --- |
| `/etc/codebox/` | `instance.env` (0600), tunnel config | `root:codebox` |
| `/opt/codebox/` | Installed release: daemon, app build, migrations | `root`, read-only |
| `/var/lib/codebox/` | `state.db`, `events/`, `logs/`, `artifacts/`, `backups/` | `codebox` |
| `/srv/codebox/repos/` | Bare clone cache, `<owner>__<name>.git` | `codebox` |
| `/srv/codebox/worktrees/` | One directory per live run | `codebox` |
| `/var/tmp/codebox/` | Gate scratch, archives | `codebox` |

Units: `codebox.service` (daemon), `codebox-opencode.service` (agent server),
`cloudflared.service` (tunnel). The daemon may own the OpenCode child itself; the unit exists
for crash isolation, and only one of the two may listen on 4096.

The development pipeline on the same box is `cb-agent.service`, with its own user, clone and
state under `/srv/cb-agent` and `/var/lib/cb-agent`. It is not part of the product and is
documented in [`agent-vm.md`](agent-vm.md); this runbook never touches it.

## 2. Install

```bash
# as root on a fresh image
/usr/local/lib/codebox/install.sh --artifact codebox-0.1.0.tar.gz --version 0.1.0 --sha256 <checksum>
systemctl enable --now codebox.service cloudflared.service
cb doctor
```

`install.sh` verifies the artifact checksum, unpacks it to
`/opt/codebox/releases/<version>`, moves the `current` symlink, restarts the daemon and polls
`/v1/health`. A failed checksum aborts before anything is replaced (exit 3); an archive
without `apps/daemon/dist/main.js` is refused and its release directory removed (exit 6); a
daemon that does not answer within `--health-timeout` puts `current` back on the previous
release (exit 4). Migrations are **not** applied here: the daemon runs them at boot
(`openStore`). No secret is read or written by the installer.

First boot (cloud-init, `docs/vm-image.md`) writes `/etc/codebox/instance.env` from Vault,
sets the hostname and the instance name, then starts the units — `codebox-opencode.service` is
started, not enabled, because the daemon may own that child. The daemon fails fast if a
required key is missing, naming the key and never its value.

## 3. Pair the first device

```bash
cb pair --name "Dani iPhone"     # prints a QR and a code, TTL 300 s
```

Pairing is reachable only over SSH or a loopback admin socket. The app scans the code, stores
the refresh token in the OS keystore and opens the dashboard. If the code expires, run the
command again; a used code never works twice.

## 4. Upgrade and rollback

```bash
cb update --to 0.2.0            # downloads, verifies, restarts, health-checks
cb update --rollback            # swaps current and previous
```

- `cb update` is a thin wrapper over `/usr/local/lib/codebox/upgrade.sh`, which hands the
  artifact to `install.sh`: checksum, unpack under `/opt/codebox/releases/<version>`, the
  `current` symlink, a restart and a `/v1/health` poll. The `previous` symlink is what a
  rollback moves back to, and two rollbacks in a row return to the release that was abandoned.
- Migrations run in the daemon at boot, so they are forward-only; a rollback across a
  destructive migration is refused with the migration id, and the recovery is a restore.
- `upgrade.sh --prune` keeps the two newest directories under `/opt/codebox/releases/` and
  removes the rest.
- The upgrade path from N-1 is tested before a release (Task-29); an N-2 upgrade is a fresh
  install plus a restore.
- `cb doctor` after the upgrade reports the version, the schema and each provider.
- The release is a signed artifact with a published checksum; the installer refuses a
  mismatch (exit 3) and an archive without the daemon entry point (exit 6).

## 5. Backup and restore

Nightly, 03:20 local:

```bash
cb backup                       # sqlite .backup + config + manifest, age-encrypted
cb backup --verify              # decrypt, open the db, count rows
```

- Target `cb-backups` (OCI Object Storage), path `db/<YYYY>/<MM>/<DD>.age`, 30 daily copies
  (D33).
- The archive contains `state.db` (consistent snapshot, not a raw copy), the instance env
  **without** secrets, the tunnel config and a manifest with versions and sizes. The age
  private key never lives on the VM.
- **Restore drill** (beta exit): launch a scratch instance from the image, stop the daemon,
  `cb restore --from <object>`, start, pair, compare jobs and the last ten runs. Target RTO
  45 minutes.

A backup that was never restored is a hope, not a backup. The drill is recorded with its
duration.

## 6. The brake

Auto-merge has three independent stops:

| Stop | Scope | Command |
| --- | --- | --- |
| Global switch | Every repository | `cb brake on` → `CB_AUTOMERGE=off` |
| Repo policy | One repository | `PATCH /v1/repos/{id} { "policy": "manual" }` |
| Job policy | One job | `PATCH /v1/jobs/{id} { "policy": "manual" }` |

The switch takes effect at the next guardrail evaluation, so a merge already in `merging`
finishes. `cb brake status` shows the switch, the policies and the runs currently past
`gating`.

## 7. `cb doctor`

One line per check, exit non-zero if any is red:

```
db            ok    wal, 412 MB, last migration 0007
opencode      ok    1.2.3 on 127.0.0.1:4096
tunnel        ok    https://cb.example.com → 200 in 84 ms
github        ok    app installation 123456, 3 repos, token 41 min left
vault         ok    read at 03:20, 6 keys
disk          warn  78% used, worktrees 41 GB
queue         ok    0 running, 2 queued, oldest 4 min
cost          ok    $1.84 today of $10
backup        warn  last success 31 h ago
```

`--json` is the machine form used by CI; `--fix` only performs safe actions (prune worktrees,
vacuum the WAL) and never rotates a credential.

## 8. Logs and events

- `journalctl -u codebox -f` — process log, JSON lines, redacted.
- `cb logs <runId>` — the gate and agent transcript of a run.
- `cb events <runId>` — the persisted timeline, in order.
- `state.db` is the record; a log is an aid. Retention is D28.
- A `requestId` in an API error is in the log with the same value.

## 9. Disk

| Threshold | Behaviour |
| --- | --- |
| 70 % | `telemetry` warn; worktrees older than 24 h are pruned. |
| 85 % | New runs refused with `disk_low`; the app shows a blocking banner. |
| 95 % | The daemon stops claiming jobs; only cancel and cleanup work. |

`cb prune --worktrees --older-than 24h` is safe at any time; it never touches the bare clones
or a live run.

## 10. Incidents

### 10.1 The app cannot connect

1. `cb doctor` on the VM: is the daemon up, is the tunnel up, does the public URL answer?
2. `systemctl status cloudflared`; `journalctl -u cloudflared -n 100`. A rotated tunnel token
   is the usual cause.
3. If the tunnel is healthy but the app 401s, revoke and re-pair the device.
4. Runs continue while the tunnel is down; nothing is lost.

### 10.2 Every run fails at `preparing`

Usually git: an expired installation token, a rename of the repository, or a full disk.
`cb doctor` names the provider; the log has the exact git error. Rotate the App key, refresh
the installation, or prune.

### 10.3 A run is stuck in `running`

1. `cb runs --state running`; note the run id and the OpenCode session.
2. `cb cancel <runId>` — it interrupts the session and stops the gate process group.
3. If the daemon itself is stuck, restart `codebox.service`; boot reconciliation marks the run
   `failed` with `instance_restarted` and removes the stale lock.
4. The worktree is kept; inspect it before pruning.

### 10.4 A bad merge landed

1. `cb brake on` if more merges are in flight.
2. `cb revert <runId>` — a new run with the revert prompt, the same gate and the same
   guardrails.
3. If the revert cannot merge, revert by hand on GitHub and record why in the run.
4. Add the missing guardrail test before re-enabling auto-merge for that repo.

### 10.5 The instance vanished

Always Free compute can be reclaimed after a week of idleness. Launch from the image
(`ops/oci/launch.sh`), restore the last backup, re-point the tunnel, pair the device. The
repositories are on GitHub; the state is in the backup. Target RTO 45 minutes.

## 11. Cost

- `cb cost` prints today, the last seven days and the top jobs by spend.
- The daily cap (`CB_DAILY_COST_USD`) cancels the current run and pauses the queue until the
  next UTC day; it is a brake, not a throttle.
- The OCI shape is Always Free; the billable surfaces are model tokens and egress. Both are
  visible in the dashboard and in `GET /v1/telemetry`.

## 12. CLI reference

| Command | Purpose |
| --- | --- |
| `cb pair` | Mint a pairing code (loopback HTTP). |
| `cb status` | Health, queue, current runs, brake. |
| `cb doctor` | Every dependency, one line each. |
| `cb run <jobId>` | Manual trigger. |
| `cb jobs` | List, pause, resume. |
| `cb logs <runId>` | Gate and agent output. |
| `cb events <runId>` | Persisted timeline. |
| `cb brake on\|off\|status` | Auto-merge switch. |
| `cb update [--to X\|--rollback]` | Release management. |
| `cb backup [--verify]` / `cb restore` | Backup and restore. |
| `cb revert <runId>` | Revert a merge through a run. |
| `cb prune` | Worktrees and WAL housekeeping. |

The CLI is a thin client over `/v1`; it never reads SQLite directly, so it cannot drift from
the API. The local admin path is **loopback HTTP** (`POST /v1/pair/code` from `127.0.0.1`),
not a unix socket.

- **Environment.** `CODEBOX_URL` (default `http://127.0.0.1:8787`), `CODEBOX_TOKEN` (no
  default) and `CODEBOX_STATE_DIR` (default `/var/lib/codebox`, where `cli.token` is read when
  no flag or variable supplies a token). `--url` and `--token` override them for one command.
  These are the CLI's own variables: the daemon's `CB_*` table is unchanged.
- **Exit codes.** `0` success; `1` a `cb doctor` check failed; `2` usage (unknown command or
  flag, missing positional, invalid value); `3` the daemon is unreachable, timed out or answered
  with a non-JSON body; `4` `401`/`403` (missing, expired or weak token); `5` any other non-2xx
  answer; `cb update` and `cb backup` pass the script's exit code through.
- **Pairing.** `cb pair --name "Dani iPhone"` prints the code, its expiry and a
  `codebox://pair?url=<base>&code=<code>` deep link. A terminal QR renderer is deferred: v1 adds
  no QR dependency, so the operator types or copies the code.

## 13. Change management

- A release is a task, a changelog entry and an artifact; never a hand edit on the box.
- A configuration change is an env edit plus a restart; `cb doctor` proves it.
- A migration is numbered, forward-only and tested against a copy of production data.
- A runbook change ships with the incident that motivated it (Task-30 reconciles the docs).

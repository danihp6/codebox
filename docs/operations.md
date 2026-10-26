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

First boot (cloud-init, `docs/vm-image.md`) writes `/etc/codebox/instance.env` from
`/etc/codebox/secret-bundles.json` when the operator delivered that file, and from OCI Vault
on OCI when it is absent; it sets the hostname and the instance name, then starts the units —
`codebox-opencode.service` is started, not enabled, because the daemon may own that child. The
daemon fails fast if a required key is missing, naming the key and never its value. The AWS
spot host runs the same first boot; its stack is in `docs/aws.md`.

The measured AWS bring-up, from `terraform apply` to `destroy`, is
[§14](#14-aws-spot-bring-up).

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

OCI Always Free compute can be reclaimed after a week of idleness. Launch from the image
(`ops/oci/launch.sh`), restore the last backup, re-point the tunnel, pair the device. The
repositories are on GitHub; the state is in the backup. Target RTO 45 minutes.

`codebox-keepalive.timer` is the early warning: after seven days the log holds 28 lines (four
samples a day), so `wc -l /var/lib/codebox/logs/keepalive.jsonl` answers 28 and
`systemctl list-timers codebox-keepalive.timer` shows the next elapse within six hours. A short
file means the timer did not fire — a stopped instance runs no timers — so read
`journalctl -u codebox-keepalive.service` before blaming the provider.

## 11. Cost

- `cb cost` prints today, the last seven days and the top jobs by spend.
- The daily cap (`CB_DAILY_COST_USD`) cancels the current run and pauses the queue until the
  next UTC day; it is a brake, not a throttle.
- The OCI shape is Always Free; the billable surfaces are model tokens and egress. Both are
  visible in the dashboard and in `GET /v1/telemetry`.

### 11.1 Telemetry

`GET /v1/telemetry?range=1h|24h|7d|30d` (default `24h`, scope `read`) answers the `Telemetry`
resource of `docs/api.md` §5.1: `range`, `since`, `spendUsd`, `runs`, `disk` and `queueDepth`.
It is the only source the app and `cb doctor`'s `cost` check read; nothing recomputes spend
elsewhere.

- `spendUsd` is the sum of `usage.cost_usd` for the rows whose `created_at` falls in the
  window, rounded to six decimals. A run that outlived the window contributes only the rows it
  wrote inside it.
- `since` is the inclusive start of the window (`until` is `now`); the window is computed from
  the daemon clock, never from the client.
- `runs.total` counts the runs created inside the window in any state, so a live run is in the
  total and in none of `succeeded` / `failed` / `cancelled`.
- `disk` and `queueDepth` are the probes `/v1/health` already uses.
- A `range` outside the four values, a repeated key or an unknown key is a `422`
  `validation_failed` with `details.path` starting `telemetry.`. A failing read is a `500`
  `internal` whose `requestId` names the log line.

Retention runs on the same timer table as `docs/security.md` §8 — runs 90 d, events 14 d, chat
90 d, approvals 7 d, log directories 30 d, all from the `CB_RETENTION_*_DAYS` values — six
hours apart, one minute after boot. It deletes whole rows and whole `logs/run-run_*/`
directories, logs one `retention_done` line with the counts, and never touches a `usage` row:
the ledger is the record of spend. Short windows go first, so a 14-day event is not kept until
its 90-day run ages out. To reclaim disk sooner, use `cb prune`, which owns the worktrees and
the bare clones.

```bash
curl -s -H "Authorization: Bearer $TOKEN" 'http://127.0.0.1:8787/v1/telemetry?range=24h'
sqlite3 /var/lib/codebox/state.db \
  "SELECT SUM(cost_usd) FROM usage WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours')"
```

The two numbers agree within the rounding of the six-decimal sum; a gap larger than a cent
means a row is outside the day list the query walks.

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

## 14. AWS spot bring-up

Every command in this section runs from the operator's workstation with a named `AWS_PROFILE` —
never with a key in this repository — and the box itself is reached over SSM. Neither CI nor the
agent pipeline (`docs/agent-vm.md` §2) executes any step here: the run is the operator's from
`terraform apply` to `terraform destroy`.

### 14.1 Preconditions

The L3 entry in `TODO.md` §"Local / human" is still an open checkbox (`- [ ]`): the dedicated IAM
user with MFA, the pinned region and the budget alarm are the operator's, and this runbook does
not create them. Confirm L3 before applying — `docs/aws.md` §10, first bullet, asks exactly that.
Credentials come from the environment and never from a file in this tree (`docs/aws.md` §6, §10
last paragraph; D37). The state bucket is created once by `infra/aws/bootstrap` and is not managed
by the root module (`docs/aws.md` §5), and the dump bucket name must be globally unique because S3
names are global (`docs/aws.md` §6).

```bash
export AWS_PROFILE=codebox-admin          # the L3 user's profile, never the root account
aws sts get-caller-identity --query 'Arn' --output text
aws configure get region                  # eu-west-1, the region backend.tf and bootstrap use
aws s3api head-bucket --bucket cb-codebox-tfstate
```

Expected: an ARN ending `/user/<name>` — never `:root`, which means the profile is wrong and the
run stops here; `eu-west-1`; and `head-bucket` exits 0. A `404` means the bucket does not exist
yet: run the bootstrap block of `docs/aws.md` §5 once
(`cd infra/aws/bootstrap && terraform init && terraform plan && terraform apply`), then re-run
`head-bucket`.

### 14.2 Deploy

The module's backend and its native S3 locking are `infra/aws/backend.tf` and `docs/aws.md` §5:
`use_lockfile = true` keeps the lock in a `.tflock` object beside the state, so there is no
DynamoDB table to create or forget. `admin_cidr` is the only required variable and the four
outputs are the contract (`infra/aws/outputs.tf`, `docs/aws.md` §6); the security group keeps the
single ingress rule of `docs/aws.md` §3. `terraform test` asserts the same shape offline
(`infra/aws/tests/stack.tftest.hcl`, `docs/aws.md` §9), and the operator still runs
`terraform plan -var-file=terraform.tfvars` and reads the diff before applying.

```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars
git check-ignore -q terraform.tfvars && echo "tfvars is ignored: it is never committed"
$EDITOR terraform.tfvars                  # admin_cidr, budget_alert_email, backup_bucket_name, ami_id
terraform init
terraform plan  -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
terraform output instance_id
terraform output public_ip
terraform output backup_uri
terraform output security_group_id
```

Expected: `init` writes state to `cb-codebox-tfstate/infra/aws/terraform.tfstate` with a `.tflock`
object; `plan` shows additions only and one `aws_security_group` with a single `tcp/22` ingress;
`apply` ends `Apply complete!`; the four outputs print an `i-…` id, an IPv4 address,
`s3://<bucket>` and an `sg-…` id. `terraform output -raw instance_id` and
`terraform output -raw backup_uri` are the two values the next steps paste into the box.

### 14.3 The four secret bundles over SSM

No secret is ever in user-data, in `terraform.tfvars` or in the Packer template
(`docs/vm-image.md` §7; `docs/security.md` §7). `/etc/codebox/secret-bundles.json` is the only
secret source on a host whose identity has no Vault grant (`ops/vm/cloud-init.sh`
`read_secrets_file`; `ops/vm/README.md` §Commands), so the file must exist before first boot:
without it `cloud-init.sh` falls through to Vault and refuses to boot on AWS.

The bundle, built on the workstation, with placeholders only:

```json
{
  "githubAppPrivateKeyBase64": "<base64 of the GitHub App private key PEM>",
  "sessionSecret": "<base64 of 48 random bytes: openssl rand -base64 48>",
  "tunnelToken": "<the tunnel token JSON exactly as Cloudflare prints it>",
  "providerKeys": "ANTHROPIC_API_KEY=<key>\nOPENAI_API_KEY=<key>"
}
```

| Key | Kind | Constraint |
| --- | --- | --- |
| `githubAppPrivateKeyBase64` | string | Non-empty; the PEM, base64-encoded (`docs/providers.md` §6 → `CB_GITHUB_APP_PRIVATE_KEY_BASE64`). |
| `sessionSecret` | string | Non-empty; 32+ random bytes, base64 (`docs/providers.md` §4 → `CB_SESSION_SECRET`). |
| `tunnelToken` | string | Non-empty; the Cloudflare tunnel token, a JSON object with `a`, `s` and `t`. |
| `providerKeys` | string | May be empty; newline-separated `KEY=VALUE`, names exactly as `docs/providers.md` §2 documents them, written into `instance.env` verbatim. |

`cloud-init.sh` reads `bundles.providerKeys ?? ""`, so an empty value still needs the key present,
and a fifth key is ignored.

```bash
# workstation: one base64 line, so the value never sits in a file
base64 < secret-bundles.json | tr -d '\n'
terraform -chdir=infra/aws output -raw instance_id     # prints i-…
aws ssm start-session --target i-…                    # paste the id
```

`-chdir=infra/aws` is why the `terraform` line runs from the repository root rather than from
`infra/aws`.

```bash
# inside the session, on the box: the value is typed with echo off
stty -echo; read -r B64; stty echo
printf '%s' "$B64" | base64 -d | sudo tee /etc/codebox/secret-bundles.json >/dev/null
unset B64
sudo chown root:codebox /etc/codebox/secret-bundles.json
sudo chmod 600 /etc/codebox/secret-bundles.json
sudo stat -c '%a %U:%G %n' /etc/codebox/secret-bundles.json
sudo jq -r 'keys[]' /etc/codebox/secret-bundles.json
sudo jq -e 'has("githubAppPrivateKeyBase64") and has("sessionSecret") and has("tunnelToken") and has("providerKeys")' /etc/codebox/secret-bundles.json
```

Expected: `600 root:codebox /etc/codebox/secret-bundles.json`; the four keys one per line in `jq`
order — `githubAppPrivateKeyBase64`, `providerKeys`, `sessionSecret`, `tunnelToken`; and `true`.

Never print the file: the value is typed with echo off, `tee` writes to `/dev/null`, `jq` prints
the keys and `stat` prints the mode, so no command shows a value. If the SSM session does not open
— no agent, or SSM still registering — SSH from the admin `/32` is the break-glass path
(`docs/aws.md` §3) and `scp` delivers the same file; the prohibition does not change.

### 14.4 First boot

`cloud-init.sh` writes `/etc/codebox/instance.env` (`0600`, `root:codebox`), renders
`/etc/cloudflared/config.yml`, starts `codebox-opencode` (started, never enabled) and then
`codebox` and `cloudflared`, and polls `/v1/health` for `--health-timeout` 120 s
(`ops/vm/README.md` §Commands; `docs/vm-image.md` §5). `/etc/codebox/image.json` is baked by
`ops/image/scripts/60-service.sh` (mode `0644`, `root:root`; version, commit, build time and the
`node`, `opencode` and `cloudflared` versions — `docs/vm-image.md` §9). The box proves it with the
`stat` and `jq` lines below, because `cb doctor` reads no image file: it asks the daemon for
`/v1/health`, `/v1/providers` and `/v1/telemetry` and prints one line per dependency — `db`,
`opencode`, `tunnel`, `github`, `disk`, `queue`, `cost` and `backup`
(`apps/daemon/src/cli/doctor.ts`, `docs/operations.md` §7) — exiting `1` only when one of them
fails. On this host nothing runs the script at launch —
`infra/aws/compute.tf` declares no `user_data` — so the operator runs it once over the session;
that is the one manual step besides the bundles, and the ≤ 5 minute bound starts at `T0`, not at
launch.

```bash
# workstation
terraform -chdir=infra/aws output -raw instance_id
terraform -chdir=infra/aws output -raw public_ip
```

```bash
# on the box
INSTANCE_ID=i-…
T0=$(date -u +%s)
sudo env CB_INSTANCE_NAME=cb-spot CB_PUBLIC_URL=https://cb.<domain> \
  /usr/local/lib/codebox/cloud-init.sh --instance-id "$INSTANCE_ID"
T1=$(date -u +%s); echo "first boot took $((T1-T0)) s"
sudo stat -c '%a %U:%G %n' /etc/codebox/instance.env /etc/cloudflared/config.yml /etc/codebox/image.json
sudo jq -c '{version, commit, builtAt}' /etc/codebox/image.json
systemctl status codebox.service cloudflared.service --no-pager
cb doctor; echo "doctor=$?"
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/v1/health
curl -sS http://127.0.0.1:8787/v1/health | jq -r '.status'
sudo grep -cE '^(CB_INSTANCE_NAME|CB_PUBLIC_URL|CB_GITHUB_APP_PRIVATE_KEY_BASE64|CB_SESSION_SECRET|CB_TUNNEL_TOKEN)=' /etc/codebox/instance.env
sudo tail -n 1 /var/lib/codebox/first-boot.jsonl
```

Expected: `600 root:codebox /etc/codebox/instance.env`,
`640 root:codebox /etc/cloudflared/config.yml`, `644 root:root /etc/codebox/image.json`; one
`{"version":…,"commit":…,"builtAt":…}` line from the manifest; both units `active (running)`;
`doctor=0` on the eight dependency lines — a `warn` never fails, `docs/operations.md` §7; `200`;
`ok`; `5`; and a JSON line ending `"result":"ok"`. The `systemctl` and `curl` lines are the only
health evidence, and the probe never leaves the box.

### 14.5 Tunnel hostname and pairing

The tunnel credentials are rendered from the token at first boot into
`/etc/cloudflared/config.yml` (`docs/vm-image.md` §5, step 3); the public hostname is attached to
the tunnel in the Cloudflare dashboard and no origin port is opened (`docs/aws.md` §3, D18); the
daemon trusts `CB_PUBLIC_URL` (`docs/providers.md` §2) and `CB_ALLOWED_ORIGINS`, which defaults to
it (`docs/providers.md` §4); Q8 in `docs/open-questions.md` lists everything a hostname change
touches.

In the dashboard: Zero Trust → Networks → Tunnels → the tunnel → Public Hostname → `cb.<domain>` →
`http://127.0.0.1:8787`. The DNS record stays proxied, and nothing is published on 80 or 443.

```bash
sudo sed -i 's|^CB_PUBLIC_URL=.*|CB_PUBLIC_URL=https://cb.<domain>|' /etc/codebox/instance.env
sudo systemctl restart codebox.service
curl -sS http://127.0.0.1:8787/v1/health | jq -r '.status'
cb pair --name "<device name>"
```

```bash
# from the operator's machine, through the tunnel only
curl -sS https://cb.<domain>/v1/health | jq -r '.status'
```

Expected: `ok` inside and `ok` through the tunnel; `cb pair` prints the code, its expiry and a
`codebox://pair?url=…&code=…` deep link (`docs/operations.md` §3, §12). Pairing is the operator's,
on a real device, and a used or expired code never works twice.

### 14.6 Backup and restore

The nightly unit runs `backup.sh --upload` (`ops/vm/systemd/codebox-backup.service` line 13);
`CB_BACKUP_S3_URI` and `CB_BACKUP_AGE_RECIPIENT` are host variables in a drop-in, never in
`instance.env` (`ops/vm/README.md` §Units); the age private key never lives on the VM
(`ops/vm/backup.sh` header; `docs/security.md` §8); `_latest` is the pointer `restore.sh --latest`
reads, and `restore.sh` never starts or stops a unit (`ops/vm/README.md` §Commands). The key pair
is made once on the operator's workstation — `age-keygen -o age.key` prints the `age1…` recipient
— the recipient goes into the drop-in, and the identity is pasted into a session only for a
restore, then shredded.

```bash
sudo systemctl edit codebox-backup.service
# [Service]
# Environment=CB_BACKUP_S3_URI=s3://<bucket>
# Environment=CB_BACKUP_AGE_RECIPIENT=age1…
sudo systemctl daemon-reload
sudo systemctl start codebox-backup.service
sudo journalctl -u codebox-backup.service -n 20 --no-pager
aws s3 ls "s3://<bucket>/db/" --recursive            # workstation
```

Expected: one `db/<YYYY>/<MM>/<DD>.age` object and the `_latest` pointer (`ops/vm/README.md`
§Commands). `<bucket>` is the name inside `backup_uri` from 14.2.

```bash
sudo systemctl stop codebox.service
stty -echo; read -r AGEKEY; stty echo                 # paste base64 of the age identity
printf '%s' "$AGEKEY" | base64 -d | sudo tee /root/age.key >/dev/null
unset AGEKEY; sudo chmod 600 /root/age.key
sudo env CB_BACKUP_S3_URI="s3://<bucket>" CB_BACKUP_AGE_IDENTITY=/root/age.key \
  /usr/local/lib/codebox/restore.sh --latest --identity /root/age.key
sudo shred -u /root/age.key
sudo systemctl start codebox.service
sudo sqlite3 /var/lib/codebox/state.db "SELECT (SELECT COUNT(*) FROM jobs)||'/'||(SELECT COUNT(*) FROM chat_messages);"
cb jobs
```

Expected: `restore.sh` exits 0 after verifying the row counts it installs; the `jobs/messages`
pair and `cb jobs` match the values recorded before the destroy (14.9). Both table names come from
`packages/store/migrations/0001_init.sql` (`docs/architecture.md` §2).

### 14.7 Three repositories at once

`CB_MAX_CONCURRENCY` is `3` and the per-repository cap stays `1` (`docs/providers.md` §8,
`docs/jobs.md` §2, D15 as amended by Task-44); `c7g.2xlarge` (8 vCPU / 16 GB) is the floor for
three repositories, each with its agent, build and Chromium, beside the daemon, OpenCode and the
tunnel (`docs/aws.md` §4); the browser is baked and nothing is downloaded at run time
(`docs/vm-image.md` §4, §9). `PLAYWRIGHT_BROWSERS_PATH` is written into `/etc/environment` by
`ops/image/scripts/45-browser.sh`, which systemd never reads, so it must also be in the unit's
environment. Do not install the agent pipeline on this box for the measurement: its unit reserves
10 GB of a 12 GB box and is not part of the product (`docs/agent-vm.md` §1, §6).

```bash
sudo install -d /etc/systemd/system/codebox.service.d
sudo tee /etc/systemd/system/codebox.service.d/override.conf >/dev/null <<'EOF'
[Service]
Environment=CB_MAX_CONCURRENCY=3
Environment=PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
EOF
sudo systemctl daemon-reload && sudo systemctl restart codebox.service
curl -sS http://127.0.0.1:8787/v1/health | jq '.queue'
PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright npx playwright test --workers=1
cb run <jobId-A>
cb run <jobId-B>
cb run <jobId-C>
cb status
```

```bash
# second session, while the three runs are in flight
watch -n 10 'free -m'
awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo
sudo journalctl -k --since '-20 min' | grep -ci 'out of memory'
```

Expected: `.queue.maxConcurrency` is `3`; one green `npx playwright test --workers=1` inside a
worktree on the box, with no download; `cb status` prints `3 running, 0 pending, max 3` on its
`queue` row and names the three run ids, comma-separated, on its `running` row — that row lists at
most five, so three fit; `MemAvailable` never below `1024` MiB; the OOM count is `0`; and all three
runs end `succeeded`. Each job's prompt is the repository's own gate, which includes
`npx playwright test --workers=1` (`.agent_roles/qa.md`).

### 14.8 Cost

The cap is `spot_max_price` (default `0.40` an hour, `docs/aws.md` §4); a month is `730` hours;
and the budget the stack alarms on is `budget_limit_usd` (`docs/aws.md` §8).

```bash
aws ec2 describe-spot-price-history --region eu-west-1 --instance-types c7g.2xlarge \
  --product-descriptions "Linux/UNIX" --start-time "$(date -u +%Y-%m-%dT00:00:00Z)" \
  --query 'SpotPriceHistory[0].[SpotPrice,Timestamp]' --output text
aws ce get-cost-and-usage --time-period Start=$(date -u +%Y-%m-01),End=$(date -u +%Y-%m-%d) \
  --granularity MONTHLY --metrics UnblendedCost     # only if the L3 user holds ce:GetCostAndUsage
```

Expected: a USD/hour price and its timestamp; the `ce` line is optional, and the spot price is the
figure the criterion asks for. Record `price × 730` as `monthly_cost_usd` in
[`docs/aws.md`](aws.md) §10.1 and in the Task-46 `agent-review` issue: the cell stays `—` until
measured, and the bound is `monthly_cost_usd ≤ budget_limit_usd`.

### 14.9 Teardown and rebuild

`destroy` removes the network, the instance, the security group, the budget and the dump bucket;
the state bucket and a **non-empty** dump bucket survive by design (`docs/aws.md` §6,
`force_destroy = false` in `infra/aws/storage.tf`).

```bash
cd infra/aws
terraform destroy -var-file=terraform.tfvars
terraform state list                                   # no output
aws s3api head-bucket --bucket cb-codebox-tfstate      # exits 0: the state bucket survives
aws s3api head-bucket --bucket "$(sed -n 's/^backup_bucket_name *= *"\([^"]*\)"/\1/p' terraform.tfvars)"   # exits 0 while it holds dumps
aws ec2 describe-instances --filters "Name=tag:Name,Values=codebox-spot" \
  --query 'Reservations[].Instances[].State.Name' --output text   # empty
```

Expected: `Destroy complete!`; no state; both buckets still answer; no instance with the tag.
Then **rebuild from zero**: `terraform apply -var-file=terraform.tfvars` again, then repeat 14.3
(the bundles), 14.4 (first boot) and 14.6 (the restore) with the new `instance_id`. The rebuild is
the same AMI, because an image is immutable (`docs/aws.md` §7).

### 14.10 The four measurements

One row per `[Task-46]` acceptance line. The account, the box and the tunnel are the operator's,
so none of these is measured by CI:

| Criterion | Command | Bound | Recorded in | Note |
| --- | --- | --- | --- | --- |
| boot to `/v1/health` | `T0`/`T1` around `cloud-init.sh`, then `curl … /v1/health` | `T1-T0 ≤ 300` s | `first-boot.jsonl` last line | operator-run; not measured by CI |
| three runs, Playwright green, no OOM | `cb status`, `free -m`, `journalctl -k` | 3 running, `MemAvailable ≥ 1024` MiB, 0 OOM | the runs' gates and `journalctl` | operator-run; not measured by CI |
| rebuilt box restores the newest dump | `restore.sh --latest`, then the `jobs/chat_messages` counts | equal counts, same `cb jobs` | the restore output | operator-run; not measured by CI |
| monthly spot cost | `describe-spot-price-history` × 730 | `≤ budget_limit_usd` | `docs/aws.md` §10.1 | operator-run; not measured by CI |

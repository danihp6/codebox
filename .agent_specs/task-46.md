# Spec: Task-46 — Spot bring-up, measured

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** ops + docs. No TypeScript, no tests to add, no runtime code.
- **Role:** Dev.
- **Objective:** after this task the repository carries the two things an operator needs to
  bring the AWS spot host up by hand and measure it: a committed **parameters file**,
  `infra/aws/terraform.tfvars.example`, whose variables match `infra/aws/variables.tf`
  one-for-one and whose every value is a safe placeholder; and a new **runbook section**
  `## 14. AWS spot bring-up` in `docs/operations.md` that goes from `terraform init` to
  `terraform destroy` and a rebuild from zero, delivering the four secret bundles over SSM,
  running first boot, switching the tunnel hostname, restoring the newest dump, running three
  repositories at once with their Playwright suites, and recording the spot cost in
  `docs/aws.md` §10.1. The stack and the image already exist (Task-42, Task-43, Task-44,
  Task-45, all merged); this task writes down how to drive them, not new behaviour.
- **Environment:** worktree `../wt-cb-46`, branch `task-46`, base `main`.
- **Dependencies:** all four are merged; the file each one produced is listed.
  - Task-42 — `infra/aws/*.tf` (variables, outputs, compute, network, storage, budget,
    backend), `infra/aws/tests/stack.tftest.hcl`, `docs/aws.md`.
  - Task-43 — `ops/vm/backup.sh`, `ops/vm/restore.sh`, `ops/vm/spot-notice.sh`,
    `ops/vm/README.md` (the S3 target, `_latest`, the age identity).
  - Task-44 — `CB_MAX_CONCURRENCY` default `3` and the admission rule
    (`docs/providers.md` §8, `docs/jobs.md` §concurrency).
  - Task-45 — `docs/operations.md` §2 and the host-neutral wording of `docs/aws.md`.

### This task is authoring only. The bring-up is operator-run.

The machine that runs you has **no AWS credentials, no `terraform` binary, and no browser**.
`terraform` is not installed; `packer` and the `aws` CLI may be present but must not be used.
Therefore:

- The deliverable is the **parameters file and the runbook text**. Nothing in this task is
  deployed, applied, planned, tunnelled, paired or measured.
- All four acceptance criteria of `TODO.md` `[Task-46]` stay **`[live]`** and are reported
  **not run** by QA. The Orchestrator carries them in one `agent-review` issue.
- **Forbidden, for the dev and for QA:** `terraform` (any subcommand, including `init`,
  `fmt`, `validate`, `plan`, `apply`, `test`, `destroy`), `aws` (any subcommand, including
  `ssm start-session` and `s3`), `packer`, `cloudflared`, `cb pair`, any AWS access key, any
  tunnel token, any DNS change, any device pairing, any `curl` to a public hostname. A
  `terraform: command not found` is the expected state of the runner, not a failure.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** Removing a stray
`.gitkeep` from a directory this task populates is allowed.

- `infra/aws/terraform.tfvars.example` — **new file**, placeholders only. It must **not** be
  named `terraform.tfvars`: that name is ignored by `infra/aws/.gitignore` line 6, so a real
  parameters file can never be committed, and an accidental `apply` can never pick it up.
  Never create `infra/aws/terraform.tfvars` in the worktree.
- `docs/operations.md` — **two places only**:
  - a new section `## 14. AWS spot bring-up`, appended after §13 (end of file), with the
    subsections `14.1`–`14.10` listed below;
  - **at most one sentence** at the end of §2 (`## 2. Install`), exactly this markdown
    sentence, starting a new source line and wrapping only after `from`:
    "The measured AWS bring-up, from `terraform apply` to `destroy`, is
    [§14](#14-aws-spot-bring-up)."
    Nothing else in §2.
- `docs/aws.md` — **§10 only**: a new subsection `### 10.1 Measured spot cost` appended
  after the §10 bullet list (end of file). No other heading, bullet or line in this file.

Nothing else. In particular: no `.tf` file, no `infra/aws/bootstrap/**`, no `docs/README.md`
index row, no new document, no `docs/providers.md`, no `docs/decisions.md`, no `TODO.md`, no
`CHANGELOG.md`, no `package.json`, no workflow, no `.gitignore`.

### Required content of §14 — the commands, verbatim

This is the deliverable's heart. Each subsection below lists the facts you must state (with the
file and section that owns each fact) and the commands the operator pastes. You may write the
prose around them and you must cite the source of every fact in backticks; you may **not**
rename a flag, drop a step or reword a command. The ten headings are fixed (U6).

Open §14 with two sentences that apply to all of it: every command runs from the operator's
workstation with a named `AWS_PROFILE` (never a key in this repository), the box is reached
over SSM, and neither CI nor the agent pipeline (`docs/agent-vm.md` §2) executes any of it.

#### 14.1 Preconditions

Facts: L3 in `TODO.md` §"Local / human" is still `- [ ]` — the dedicated IAM user with MFA, the
pinned region and the budget alarm are the operator's, and the runbook **does not create them**;
confirm L3 before applying (`docs/aws.md` §10, first bullet). Credentials come from the
environment (`docs/aws.md` §6, §10 last paragraph; D37). The state bucket is created once by
`infra/aws/bootstrap` and is not managed by the root module (`docs/aws.md` §5). The dump bucket
name must be globally unique (`docs/aws.md` §6).

```bash
export AWS_PROFILE=codebox-admin          # the L3 user's profile, never the root account
aws sts get-caller-identity --query 'Arn' --output text
aws configure get region                  # eu-west-1, the region backend.tf and bootstrap use
aws s3api head-bucket --bucket cb-codebox-tfstate
```

Expected: an ARN ending `/user/<name>` (not `:root`); `eu-west-1`; `head-bucket` exits 0.
A `404` means the bucket does not exist yet — run the bootstrap block of `docs/aws.md` §5 once
(`cd infra/aws/bootstrap && terraform init && terraform plan && terraform apply`), then re-run
`head-bucket`.

#### 14.2 Deploy

Facts: the module's backend and its native S3 locking (`infra/aws/backend.tf`,
`docs/aws.md` §5); the single ingress rule (`docs/aws.md` §3); `admin_cidr` is the only required
variable and the four outputs are the contract (`docs/aws.md` §6, `infra/aws/outputs.tf`).

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

Expected: `init` writes state to `cb-codebox-tfstate/infra/aws/terraform.tfstate` with a
`.tflock` object; `plan` shows additions only and one `aws_security_group` with a single
`tcp/22` ingress; `apply` ends `Apply complete!`; the four outputs print an `i-…` id, an IPv4,
`s3://<bucket>` and an `sg-…` id. `terraform output -raw instance_id` and
`terraform output -raw backup_uri` are the values the next steps paste into the box.

#### 14.3 The four secret bundles over SSM

Facts: **No secret is ever in user-data, in `terraform.tfvars` or in the Packer template**
(`docs/vm-image.md` §7; `docs/security.md` §7). `/etc/codebox/secret-bundles.json` is the only
secret source on a host whose identity has no Vault grant (`ops/vm/cloud-init.sh`
`read_secrets_file`; `ops/vm/README.md` §Commands). The file must exist **before** first boot,
or `cloud-init.sh` falls through to Vault and refuses to boot on AWS.

The shape, built on the workstation, with placeholders only in the runbook:

```json
{
  "githubAppPrivateKeyBase64": "<base64 of the GitHub App private key PEM>",
  "sessionSecret": "<base64 of 48 random bytes: openssl rand -base64 48>",
  "tunnelToken": "<the tunnel token JSON exactly as Cloudflare prints it>",
  "providerKeys": "ANTHROPIC_API_KEY=<key>\nOPENAI_API_KEY=<key>"
}
```

`providerKeys` is one `KEY=VALUE` per line with the names `docs/providers.md` §2 documents; it
may be empty, but the key itself must be present (`cloud-init.sh` reads
`bundles.providerKeys ?? ""`). A fifth key is ignored.

```bash
# workstation: one base64 line, so the value never sits in a file
base64 < secret-bundles.json | tr -d '\n'
terraform -chdir=infra/aws output -raw instance_id     # prints i-…
aws ssm start-session --target i-…                    # paste the id
```

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

Expected: `600 root:codebox /etc/codebox/secret-bundles.json`; the four keys one per line in
`jq` order — `githubAppPrivateKeyBase64`, `providerKeys`, `sessionSecret`, `tunnelToken`; `true`.
Nothing prints a value: `read` runs with echo off, `tee` writes to `/dev/null`, `jq` prints keys,
`stat` prints the mode. The runbook must say "never print the file", and the literal string
`cat /etc/codebox/secret-bundles.json` must not appear anywhere in it — not even inside a
prohibition, so phrase the rule as words only. Never show a populated bundle. If the SSM session
does not open (no agent), SSH from the admin `/32` is the break-glass path (`docs/aws.md` §3) and
`scp` delivers the same file; the prohibition does not change.

#### 14.4 First boot

Facts: `cloud-init.sh` writes `/etc/codebox/instance.env` (`0600`, `root:codebox`), renders
`/etc/cloudflared/config.yml`, starts `codebox-opencode` (started, never enabled), `codebox` and
`cloudflared`, and polls `/v1/health` for `--health-timeout` 120 s (`ops/vm/README.md`
§Commands; `docs/vm-image.md` §5). `/etc/codebox/image.json` is baked by
`ops/image/scripts/60-service.sh` (mode `0644`, `root:root`) and printed by `cb doctor`
(`docs/vm-image.md` §9). On this host nothing runs the script at launch —
`infra/aws/compute.tf` declares no `user_data` — so the operator runs it once over the session.
That is the one manual step besides the bundles, and the ≤ 5 minute bound starts at `T0`.

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
systemctl status codebox.service cloudflared.service --no-pager
cb doctor; echo "doctor=$?"
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/v1/health
curl -sS http://127.0.0.1:8787/v1/health | jq -r '.status'
sudo grep -cE '^(CB_INSTANCE_NAME|CB_PUBLIC_URL|CB_GITHUB_APP_PRIVATE_KEY_BASE64|CB_SESSION_SECRET|CB_TUNNEL_TOKEN)=' /etc/codebox/instance.env
sudo tail -n 1 /var/lib/codebox/first-boot.jsonl
```

Expected: `600 root:codebox /etc/codebox/instance.env`, `640 root:codebox
/etc/cloudflared/config.yml`, `644 root:root /etc/codebox/image.json`; both units
`active (running)`; `doctor=0` (a `warn` never fails, `docs/operations.md` §7); `200`; `ok`;
`5`; a JSON line ending `"result":"ok"`. The two `systemctl`/`curl` lines are the only health
evidence — the probe never leaves the box.

#### 14.5 Tunnel hostname and pairing

Facts: the tunnel credentials are rendered from the token at first boot into
`/etc/cloudflared/config.yml` (`docs/vm-image.md` §5.3); the public hostname is attached to the
tunnel in the Cloudflare dashboard and no origin port is opened (`docs/aws.md` §3, D18); the
daemon trusts `CB_PUBLIC_URL` and `CB_ALLOWED_ORIGINS` defaults to it (`docs/providers.md` §2);
Q8 in `docs/open-questions.md` lists everything a hostname change touches.

Dashboard step, written as prose: Zero Trust → Networks → Tunnels → the tunnel → Public Hostname
→ `cb.<domain>` → `http://127.0.0.1:8787`; the DNS record stays proxied.

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
on a real device; the runbook says a used or expired code never works twice.

#### 14.6 Backup and restore

Facts: the nightly unit runs `backup.sh --upload`
(`ops/vm/systemd/codebox-backup.service` line 13); `CB_BACKUP_S3_URI` and
`CB_BACKUP_AGE_RECIPIENT` are host variables in a drop-in, never in `instance.env`
(`ops/vm/README.md` §Units); the age private key never lives on the VM (`ops/vm/backup.sh`
header; `docs/security.md` §8); `_latest` is the pointer `restore.sh --latest` reads, and
`restore.sh` never starts or stops a unit (`ops/vm/README.md` §Commands). The key pair is made
once on the operator's workstation (`age-keygen -o age.key` prints the `age1…` recipient); the
recipient goes into the drop-in, and the identity is pasted into a session only for a restore,
then shredded.

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

Expected: one `db/<YYYY>/<MM>/<DD>.age` object and the `_latest` pointer
(`ops/vm/README.md` §Commands). The `<bucket>` is the name inside `backup_uri` from 14.2.

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
pair and `cb jobs` match the values recorded before the destroy (14.9). The table names come
from `packages/store/migrations/0001_init.sql` (`docs/architecture.md` §2).

#### 14.7 Three repositories at once

Facts: `CB_MAX_CONCURRENCY` is `3` and per-repo stays `1` (`docs/providers.md` §8,
`docs/jobs.md` §concurrency, D15 as amended by Task-44); `c7g.2xlarge` (8 vCPU / 16 GB) is the
floor for three repositories × agent + build + Chromium beside the daemon, OpenCode and the
tunnel (`docs/aws.md` §4); the browser is baked and nothing is downloaded at run time
(`docs/vm-image.md` §4, §9). `PLAYWRIGHT_BROWSERS_PATH` is written into `/etc/environment`
(`ops/image/scripts/45-browser.sh`), which systemd never reads, so it must also be in the
unit's environment. Do **not** install the agent pipeline on this box for the measurement: its
unit reserves 10 GB of a 12 GB box and is not part of the product (`docs/agent-vm.md` §1, §6).

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
cb runs --state running
```

```bash
# second session, while the three runs are in flight
watch -n 10 'free -m'
awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo
sudo journalctl -k --since '-20 min' | grep -ci 'out of memory'
```

Expected: `.queue.maxConcurrency` is `3`; one green `npx playwright test --workers=1` inside a
worktree on the box with no download; `cb status` prints `3 running, 0 pending, max 3`;
`cb runs --state running` lists three; `MemAvailable` never below `1024` MiB; the OOM count is
`0`; all three runs end `succeeded`. Each job's prompt is the repository's own gate, which
includes `npx playwright test --workers=1` (`.agent_roles/qa.md`).

#### 14.8 Cost

Facts: the cap is `spot_max_price` (default `0.40`/h, `docs/aws.md` §4); a month is `730`
hours; the budget the stack alarms on is `budget_limit_usd` (`docs/aws.md` §8).

```bash
aws ec2 describe-spot-price-history --region eu-west-1 --instance-types c7g.2xlarge \
  --product-descriptions "Linux/UNIX" --start-time "$(date -u +%Y-%m-%dT00:00:00Z)" \
  --query 'SpotPriceHistory[0].[SpotPrice,Timestamp]' --output text
aws ce get-cost-and-usage --time-period Start=$(date -u +%Y-%m-01),End=$(date -u +%Y-%m-%d) \
  --granularity MONTHLY --metrics UnblendedCost     # only if the L3 user holds ce:GetCostAndUsage
```

Expected: a USD/hour price and its timestamp (the `ce` line is optional; the spot price is the
figure the criterion asks for). The runbook ends this subsection with: record
`price × 730` as `monthly_cost_usd` in [`docs/aws.md`](aws.md) §10.1 and in the Task-46
`agent-review` issue; the cell stays `—` until measured, and the bound is
`monthly_cost_usd ≤ budget_limit_usd`.

#### 14.9 Teardown and rebuild

Facts: `destroy` removes the network, the instance, the security group, the budget and the dump
bucket; the state bucket and a **non-empty** dump bucket survive by design
(`docs/aws.md` §6, `force_destroy = false` in `infra/aws/storage.tf`).

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
Then **rebuild from zero**: `terraform apply -var-file=terraform.tfvars` again, then repeat
14.3 (bundles), 14.4 (first boot) and 14.6 (restore), with the new `instance_id`. The rebuild
is the same AMI, because an image is immutable (`docs/aws.md` §7).

#### 14.10 The four measurements

A table with exactly four rows, one per `[Task-46]` acceptance line, and a final `Note` column:

| Criterion | Command | Bound | Recorded in | Note |
| --- | --- | --- | --- | --- |
| boot to `/v1/health` | `T0`/`T1` around `cloud-init.sh`, then `curl … /v1/health` | `T1-T0 ≤ 300` s | `first-boot.jsonl` last line | operator-run; not measured by CI |
| three runs, Playwright green, no OOM | `cb runs --state running`, `free -m`, `journalctl -k` | 3 running, `MemAvailable ≥ 1024` MiB, 0 OOM | the runs' gates and `journalctl` | operator-run; not measured by CI |
| rebuilt box restores the newest dump | `restore.sh --latest`, then the `jobs/chat_messages` counts | equal counts, same `cb jobs` | the restore output | operator-run; not measured by CI |
| monthly spot cost | `describe-spot-price-history` × 730 | `≤ budget_limit_usd` | `docs/aws.md` §10.1 | operator-run; not measured by CI |

Those four `Note` cells are what U14 counts; write them exactly like that.

### Required content of `docs/aws.md` §10.1

Append this to the end of the file, after the §10 bullets, and nothing else:

```markdown
### 10.1 Measured spot cost

The monthly figure is the measured spot price for `c7g.2xlarge` in `eu-west-1` multiplied by
the hours in the table; the cap and the alarm it is compared against are `spot_max_price` and
`budget_limit_usd` (§4, §8). Measure it with the commands of
[`operations.md`](operations.md) §14.8 and record the result in the row below.

| Date | Shape | Spot price | Hours/month | Monthly | Source |
| --- | --- | --- | --- | --- | --- |
| _to be filled at the measured bring-up (Task-46)_ | `c7g.2xlarge` | `—` | 730 | `—` | `aws ec2 describe-spot-price-history` |
```

The `—` cells stay `—` until the operator measures. That is deliberate: no figure in this
repository is invented, and the criterion that asks for the number stays `[live]`.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `TODO.md` — the `[Task-46]` item (authoritative acceptance and paths) and §"Local / human"
  (L3, L4).
- `docs/aws.md` — the whole file; §1–§10 are the facts the runbook cites.
- `docs/operations.md` — the whole file; §2, §5, §7, §10.5 and §12 are the ones the runbook
  reuses.
- `docs/vm-image.md` — §1, §3, §5, §7, §9.
- `docs/providers.md` — §1, §2, §8, §11, §14, §15.
- `docs/security.md` — §7 (secrets) and §8 (backups).
- `docs/jobs.md` — the concurrency section.
- `docs/open-questions.md` — Q8 (domain, tunnel hostname, Access).
- `docs/agent-vm.md` — §1, §2, §6 (the pipeline shares the box; keep it out of the run).
- `docs/decisions.md` — **lookup only**, to confirm a `D<n>` you cite already exists. Never
  invent a decision id; never edit this file.
- `infra/aws/variables.tf`, `infra/aws/outputs.tf`, `infra/aws/compute.tf`,
  `infra/aws/network.tf`, `infra/aws/storage.tf`, `infra/aws/budget.tf`,
  `infra/aws/backend.tf`, `infra/aws/bootstrap/main.tf`, `infra/aws/tests/stack.tftest.hcl`,
  `infra/aws/.gitignore`, `.gitignore`.
- `ops/vm/cloud-init.sh` (the `read_secrets_file` function), `ops/vm/README.md`,
  `ops/vm/backup.sh`, `ops/vm/restore.sh`, `ops/vm/spot-notice.sh`,
  `ops/vm/systemd/codebox.service`.
- `ops/image/http/cloud-init.yaml`, `ops/image/scripts/45-browser.sh`,
  `ops/image/scripts/60-service.sh`.
- `packages/store/migrations/0001_init.sql` — the table names the restore check counts.

## 🔒 Contract

**This task exports no TypeScript.** Nothing is added to `packages/contracts`; no API payload,
event type or `CB_*` key changes.

The contract has two literal halves, plus the data they carry:

### 1. The parameters file's variable names

`infra/aws/terraform.tfvars.example` must assign **exactly** the twelve variables declared in
`infra/aws/variables.tf`, once each, with these values and types:

| Variable | Type | Value in the example | Why that value |
| --- | --- | --- | --- |
| `aws_region` | string | `"eu-west-1"` | Matches `backend.tf` and `bootstrap/main.tf` defaults. |
| `admin_cidr` | string | `"203.0.113.7/32"` | TEST-NET-3 (RFC 5737), the same placeholder `tests/stack.tftest.hcl` uses. Passes both validations (`/32`, never `0.0.0.0/0`). |
| `vpc_cidr` | string | `"10.42.0.0/16"` | Default in `variables.tf`; RFC 1918. |
| `public_subnet_cidr` | string | `"10.42.1.0/24"` | Default in `variables.tf`; RFC 1918. |
| `ami_id` | string | `""` | Empty resolves the newest Canonical Ubuntu 24.04 arm64 AMI (`compute.tf`). The comment must say the bring-up sets the `cb-image-<version>-<sha>` AMI id from `packer build -only=amazon-ebs.codebox` (`docs/vm-image.md` §3). |
| `instance_type` | string | `"c7g.2xlarge"` | 8 vCPU / 16 GB, the documented floor (`docs/aws.md` §4). |
| `spot_max_price` | string | `"0.40"` | Default; a decimal, never empty. |
| `root_volume_gb` | number | `100` | Default; encrypted `gp3`. |
| `backup_bucket_name` | string | `"cb-codebox-backups-example"` | A valid placeholder; S3 names are global, so the operator must change it (`docs/aws.md` §6). |
| `budget_limit_usd` | number | `50` | Default. |
| `budget_alert_email` | string | `"operator@example.com"` | `example.com` is reserved; passes the validation. |
| `project` | string | `"codebox"` | Default; prefixes every resource name. |

Rules for the file, all checkable:

- Every value satisfies its `validation` block in `variables.tf`. The example must be
  **applyable as-is** after the operator edits `admin_cidr`, `budget_alert_email`,
  `backup_bucket_name` and `ami_id` — it is a starting point, not a puzzle.
- **No real value:** no IPv4 outside `203.0.113.0/24` (TEST-NET-3) and the two RFC 1918
  defaults, no real email, no 12-digit account id, no `arn:aws:`, no `AKIA`, no `ghp_`, no
  `github_pat_`, no `-----BEGIN`, no provider key. `example.com` and `203.0.113.7` only.
- A short `#` comment per group is allowed and expected (this is a parameters file, not code);
  no other content, no `terraform { }` block, no provider block.
- The file must stay **tracked**: `git check-ignore` on it exits `1`. The applied name
  `terraform.tfvars` is ignored by `infra/aws/.gitignore`, so the operator copies the example
  to it and the copy never reaches git.

### 2. The runbook's command names

The runbook promises the operator these exact commands and outputs; nothing else in it may be
renamed:

- `terraform init`, `terraform plan -var-file=terraform.tfvars`,
  `terraform apply -var-file=terraform.tfvars`,
  `terraform destroy -var-file=terraform.tfvars`.
- `terraform output instance_id`, `terraform output -raw instance_id`, `public_ip`,
  `backup_uri` (prints `s3://<bucket>`) and `security_group_id` — the four outputs of
  `infra/aws/outputs.tf`.
- `aws ssm start-session --target <instance_id>` — the shell (`docs/aws.md` §3).
- `/usr/local/lib/codebox/cloud-init.sh` (first boot, `ops/vm/README.md`),
  `/usr/local/lib/codebox/backup.sh --upload`,
  `/usr/local/lib/codebox/restore.sh --latest --identity <file>` (`ops/vm/README.md`
  §Commands), `cb doctor`, `cb pair --name "<device>"`, `cb run <jobId>`, `cb status`,
  `cb jobs` (`docs/operations.md` §12), `npx playwright test --workers=1`.

### Data

The four secret-bundle keys, as `ops/vm/cloud-init.sh` `read_secrets_file` reads them from
`/etc/codebox/secret-bundles.json` (`0600`, `root:codebox`):

| Key | Kind | Constraint the runbook must state |
| --- | --- | --- |
| `githubAppPrivateKeyBase64` | string | Non-empty; the PEM, base64-encoded (`docs/providers.md` §6 → `CB_GITHUB_APP_PRIVATE_KEY_BASE64`). |
| `sessionSecret` | string | Non-empty; 32+ random bytes, base64 (`docs/providers.md` §4 → `CB_SESSION_SECRET`). |
| `tunnelToken` | string | Non-empty; the Cloudflare tunnel token, a JSON object with `a`, `s`, `t` (read at `cloud-init.sh` tunnel step). |
| `providerKeys` | string | May be empty; newline-separated `KEY=VALUE`, names exactly as `docs/providers.md` §2 documents them, written into `instance.env` verbatim (`cloud-init.sh` strips CRLF and blank lines). |

The operator may not add a fifth key: `cloud-init.sh` ignores anything else.

## 🧩 Configuration

**No `CB_*` key is added.** The runbook only *uses* keys that already exist and are documented;
it must not introduce a row in `docs/providers.md` (that file is not in the exclusive paths).

| Name the runbook sets or reads | Where it is documented today | Note for the runbook |
| --- | --- | --- |
| `CB_MAX_CONCURRENCY=3` | `docs/providers.md` §8 (default `3`), `docs/jobs.md` §concurrency | Set explicitly in a `codebox.service` drop-in so the measurement is not an accident of a default. |
| `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` | `docs/vm-image.md` §9, `ops/image/scripts/45-browser.sh` | The image writes it to `/etc/environment`, which **systemd does not read**; the runbook adds it to the `codebox.service` drop-in with `Environment=`. |
| `CB_BACKUP_S3_URI` | `ops/vm/README.md` §Commands — **host variable, not in `docs/providers.md`** | Value is `terraform output -raw backup_uri`. Verified: it exists in `ops/vm/backup.sh`, `ops/vm/restore.sh` and `ops/vm/README.md`; `docs/providers.md` deliberately does not carry the `CB_BACKUP_*` host variables, and Task-30 owns that reconciliation. Do **not** add a row for it here. |
| `CB_BACKUP_AGE_IDENTITY` | `ops/vm/README.md` §Commands | Temporary `/root/age.key`, removed after the restore. |
| `CB_PUBLIC_URL` | `docs/providers.md` §2 | Required by `cloud-init.sh`; the tunnel hostname switch changes it. |
| `CB_INSTANCE_NAME`, `CB_INSTANCE_ID`, `CB_SECRETS_FILE` | `ops/vm/cloud-init.sh`, `ops/vm/README.md` §Commands | Passed inline to first boot; `CB_SECRETS_FILE` already defaults to `/etc/codebox/secret-bundles.json`. |

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim, from a clean integration worktree (branch `task-46` merged onto
`main`), with no AWS credential and no expectation of a `terraform` binary. Every command
below is offline. **No command in this plan may reach the network, an account or a browser.**

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass (the diff is docs + one `.tfvars.example`; the gate must stay
    green regardless).
  - `npm test` — Vitest, headless.
  - `npm run build` — `tsc -b` and the app build.
  - No `npx playwright test`: this task tags no web flow.
  - `git diff --name-only main...task-46` — audit against the exclusive paths.

### `[unit]` acceptance criteria

Run each from the repository root of the integration worktree. "Output" is what QA must see.

- [ ] **U1 · The gate is green.**
  ```bash
  npm ci --prefer-offline --no-audit --no-fund && npm run lint && npm test && npm run build; echo "exit=$?"
  ```
  Output ends `exit=0`.

- [ ] **U2 · Nothing outside the exclusive paths was touched.**
  ```bash
  git diff --name-only main...task-46 -- . ':!.agent_specs' | sort
  ```
  Output **exactly** these three lines, nothing else:
  ```
  docs/aws.md
  docs/operations.md
  infra/aws/terraform.tfvars.example
  ```
  (`.agent_specs/` is excluded because the Orchestrator force-adds the spec to the branch as
  its first commit; it is not part of the deliverable.)

- [ ] **U3 · The applied name does not exist and the example is not ignored.**
  ```bash
  test ! -e infra/aws/terraform.tfvars && echo "no tfvars"
  git check-ignore -q infra/aws/terraform.tfvars; echo "ignored=$?"
  git check-ignore -q infra/aws/terraform.tfvars.example; echo "example-ignored=$?"
  ```
  Output must be `no tfvars`, `ignored=0`, `example-ignored=1`.

- [ ] **U4 · The example assigns exactly the twelve variables of `variables.tf`.**
  ```bash
  node -e '
  const fs=require("node:fs");
  const vf=fs.readFileSync("infra/aws/variables.tf","utf8");
  const tf=[...vf.matchAll(/^variable "([a-z0-9_]+)"/gm)].map(m=>m[1]).sort();
  const ex=fs.readFileSync("infra/aws/terraform.tfvars.example","utf8");
  const as=[...ex.matchAll(/^([a-z0-9_]+)\s*=/gm)].map(m=>m[1]).sort();
  const ok=tf.length===as.length&&tf.every((n,i)=>n===as[i]);
  console.log(ok?"ok":("tfvars="+tf.join(",")+" example="+as.join(",")));
  process.exit(ok?0:1);
  '
  ```
  Output `ok`, exit `0`.

- [ ] **U5 · Every value is a placeholder.** No secret-shaped string, and every IPv4/CIDR is a
  documentation or private range.
  ```bash
  grep -nE 'AKIA|ghp_|github_pat_|-----BEGIN|(^|[^A-Za-z0-9])sk-[A-Za-z0-9]|arn:aws:|[0-9]{12}' infra/aws/terraform.tfvars.example; echo "secrets=$?"
  sed -n 's/^[a-z_]* *= *"\([^"]*\)".*/\1/p' infra/aws/terraform.tfvars.example | grep -E '^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]+)?$' | sort -u
  ```
  First output is `secrets=1` (no match). Second prints exactly:
  ```
  10.42.0.0/16
  10.42.1.0/24
  203.0.113.7/32
  ```
  (The 12-digit check is what keeps an AWS account id out; the `arn:aws:` check keeps a
  resource ARN out.)

- [ ] **U6 · `docs/operations.md` has exactly the required structure.**
  ```bash
  grep -c '^## 14\. AWS spot bring-up$' docs/operations.md
  awk '/^## /{print $2}' docs/operations.md | tail -3
  grep -c '^### 14\.' docs/operations.md
  grep -n '^### 14\.' docs/operations.md
  ```
  Outputs: `1`; then `12.` `13.` `14.` (so §14 is the last section); then `10`; then ten lines
  in this order and with these exact texts:
  ```
  14.1 Preconditions
  14.2 Deploy
  14.3 The four secret bundles over SSM
  14.4 First boot
  14.5 Tunnel hostname and pairing
  14.6 Backup and restore
  14.7 Three repositories at once
  14.8 Cost
  14.9 Teardown and rebuild
  14.10 The four measurements
  ```

- [ ] **U7 · The runbook contains every command and name the task owes.** Each of these must
  appear inside §14 (scoped with `awk`, so an older section cannot satisfy the check):
  ```bash
  awk '/^## 14\. AWS spot bring-up$/,0' docs/operations.md > /tmp/t46.md
  for s in 'secret-bundles.json' 'chmod 600' 'aws ssm start-session --target' \
           'No secret is ever in user-data' 'terraform init' \
           'terraform plan -var-file=terraform.tfvars' \
           'terraform apply -var-file=terraform.tfvars' \
           'terraform destroy -var-file=terraform.tfvars' \
           'security_group_id' 'backup_uri' \
           'githubAppPrivateKeyBase64' 'sessionSecret' 'tunnelToken' 'providerKeys' \
           '/etc/codebox/instance.env' '/etc/codebox/image.json' \
           'systemctl status codebox.service cloudflared.service' 'cb doctor' \
           '/v1/health' 'cb pair --name' 'restore.sh --latest' \
           'CB_BACKUP_S3_URI' 'CB_MAX_CONCURRENCY=3' \
           'PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright' 'npx playwright test --workers=1' \
           'free -m' 'c7g.2xlarge'; do
    grep -qF -- "$s" /tmp/t46.md || echo "MISSING: $s"
  done; echo "done"
  ```
  Output is exactly `done`. Any `MISSING:` line fails the criterion.

- [ ] **U8 · The runbook and §10.1 carry no secret and no real account detail.**
  ```bash
  grep -nE 'ghp_|github_pat_|-----BEGIN|(^|[^A-Za-z0-9])sk-[A-Za-z0-9]|AKIA' docs/operations.md docs/aws.md; echo "shapes=$?"
  awk '/^## 14\. AWS spot bring-up$/,0' docs/operations.md | grep -nE '[0-9]{12}|arn:aws:|AKIA'; echo "account=$?"
  awk '/^## 14\. AWS spot bring-up$/,0' docs/operations.md | grep -c 'cat /etc/codebox/secret-bundles.json'
  ```
  Outputs `shapes=1`, `account=1`, and `0`. The last line proves the runbook never prints the
  bundle file — not even as a prohibition — and reads it only through `jq keys`/`has(...)` and
  `grep -cE '^(CB_…|…)='`.

- [ ] **U9 · `docs/aws.md` changed only by a new §10.1, and the cost is not faked.**
  ```bash
  git diff main...task-46 -- docs/aws.md | grep -c '^@@'
  git diff main...task-46 -- docs/aws.md | grep -c '^-[^-]'
  grep -c '^### 10\.1 Measured spot cost$' docs/aws.md
  awk '/^### 10\.1 Measured spot cost$/,0' docs/aws.md | grep -c 'describe-spot-price-history'
  awk '/^### 10\.1 Measured spot cost$/,0' docs/aws.md | grep -c '730'
  awk '/^### 10\.1 Measured spot cost$/,0' docs/aws.md | grep -c '_to be filled at the measured bring-up (Task-46)_'
  ```
  Outputs: `1` hunk, `0` removed lines (a single deletion is tolerated only if it is the
  unchanged last line re-emitted because the file gained its trailing newline, printed verbatim
  in the diff), `1` heading, `1`, `1`, `1`. The table row that will hold the measured figures is
  present and still a placeholder — no number is reported as measured.

- [ ] **U10 · The §2 pointer is at most one sentence and §14 is a pure append.**
  ```bash
  git diff main...task-46 -- docs/operations.md | grep -c '^@@'
  git diff main...task-46 -- docs/operations.md | grep -c '^-[^-]'
  git diff main...task-46 -- docs/operations.md | grep -c '^+The measured AWS bring-up'
  ```
  Outputs: hunk count `1` or `2`; deletions `0` (a single deletion is tolerated only if it is
  the unchanged §13 closing line re-emitted for a trailing newline, printed verbatim in the
  diff); pointer count `0` or `1`.

- [ ] **U11 · Every relative markdown link in the touched files resolves.**
  ```bash
  node -e '
  const fs=require("node:fs"),path=require("node:path");
  const files=["docs/operations.md","docs/aws.md","infra/aws/terraform.tfvars.example"];
  let bad=0;
  for (const f of files) {
    for (const m of fs.readFileSync(f,"utf8").matchAll(/\]\(([^)\s]+)\)/g)) {
      const t=m[1];
      if (/^(https?:|mailto:|#)/.test(t)) continue;
      const p=path.resolve(path.dirname(f), t.split("#")[0]);
      if (!fs.existsSync(p)) { console.log("missing", f, t); bad++; }
    }
  }
  console.log(bad?bad+" broken":"links ok");
  process.exit(bad?1:0);
  '
  ```
  Output `links ok`, exit `0`.

- [ ] **U12 · No invented decision id.**
  ```bash
  for d in $(git diff -U0 main...task-46 -- docs/operations.md docs/aws.md | grep '^+' | grep -oE 'D[0-9]{1,3}' | sort -u); do
    grep -qE "\b$d\b" docs/decisions.md || echo "MISSING $d";
  done; echo "decisions ok"
  ```
  Output is exactly `decisions ok`.

- [ ] **U13 · No new `CB_*` key.** Every `CB_*` the diff names must already exist on `main`.
  ```bash
  for n in $(git diff -U0 main...task-46 -- docs/operations.md docs/aws.md | grep '^+' | grep -oE 'CB_[A-Z0-9_]+' | sort -u); do
    git grep -q -- "$n" main -- . || echo "NEW $n";
  done; echo "keys ok"
  ```
  Output is exactly `keys ok`. Any `NEW <name>` line is a failure: a genuinely new key would
  need a `docs/providers.md` row this task may not write. The keys the runbook is expected to
  name are `CB_BACKUP_AGE_IDENTITY`, `CB_BACKUP_S3_URI`, `CB_ENV`,
  `CB_GITHUB_APP_PRIVATE_KEY_BASE64`, `CB_INSTANCE_ID`, `CB_INSTANCE_NAME`,
  `CB_MAX_CONCURRENCY`, `CB_MAX_CONCURRENCY_PER_REPO`, `CB_PUBLIC_URL`, `CB_SECRETS_FILE`,
  `CB_SESSION_SECRET`, `CB_TUNNEL_TOKEN` — every one of them is already in the tree.

- [ ] **U14 · The four `[live]` criteria are documented as operator-run.** The runbook's
  §14.10 must map each one to a command and a bound, and
  ```bash
  awk '/^### 14\.10 /,0' docs/operations.md | grep -c 'operator-run; not measured by CI'
  ```
  Output is `4` or more (one per criterion).

### `[live]` acceptance criteria — all four reported **not run**

Each of these is the `[Task-46]` acceptance line. They need the AWS account, the box and a
real tunnel; this runner has none of them. QA must report each as **not run** with the reason
"needs the L3 AWS account and the live box", never as a pass, and the Orchestrator carries them
in one `agent-review` issue.

- [ ] `[live]` **Boot to `/v1/health` in ≤ 5 minutes with no manual step but the bundles.**
  *Measurement:* on the box, `T0=$(date -u +%s)` before
  `sudo env CB_INSTANCE_NAME=cb-spot CB_PUBLIC_URL=https://cb.<domain> /usr/local/lib/codebox/cloud-init.sh --instance-id "$INSTANCE_ID"`,
  `T1=$(date -u +%s)` on the first `200` from
  `curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/v1/health`; the bounded
  value is `T1-T0 ≤ 300`, the surface is `/var/lib/codebox/first-boot.jsonl` with its last
  line `"result":"ok"`, and `curl -sS http://127.0.0.1:8787/v1/health | jq -r '.status'` reads
  `ok`. **operator-run; not measured by CI; reported not run and carried by an `agent-review`
  issue.**
- [ ] `[live]` **Three parallel runs with Playwright are green and the box stays under the
  memory ceiling.** *Measurement:* `cb run` on three jobs, one per repository, started inside
  one minute; `curl -sS http://127.0.0.1:8787/v1/health | jq '.queue'` reads `running: 3` and
  `maxConcurrency: 3`; each run's gate ends green including
  `npx playwright test --workers=1`; `awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo`
  sampled every 10 s never reads below `1024` (MiB) on the 16 GB `c7g.2xlarge`, and
  `sudo journalctl -k --since '-20 min' | grep -ci 'out of memory'` reads `0`. **operator-run;
  not measured by CI; reported not run and carried by an `agent-review` issue.**
- [ ] `[live]` **The rebuilt box restores the newest dump and serves the same jobs and chat.**
  *Measurement:* on the first box, record
  `sudo sqlite3 /var/lib/codebox/state.db "SELECT (SELECT COUNT(*) FROM jobs)||'/'||(SELECT COUNT(*) FROM chat_messages);"`
  and `cb jobs`; after `terraform destroy` and a second `apply`, deliver the bundles, run first
  boot, restore with `restore.sh --latest` against `CB_BACKUP_S3_URI` from `backup_uri`, then
  re-read the same two commands: the pair of counts and the job list are identical. **operator-run;
  not measured by CI; reported not run and carried by an `agent-review` issue.**
- [ ] `[live]` **The monthly cost at the spot price is recorded in `docs/aws.md`.** *Measurement:*
  `aws ec2 describe-spot-price-history --region eu-west-1 --instance-types c7g.2xlarge --product-descriptions "Linux/UNIX" --start-time "$(date -u +%Y-%m-%dT00:00:00Z)" --query 'SpotPriceHistory[0].[SpotPrice,Timestamp]' --output text`
  gives USD/hour; the row in `docs/aws.md` §10.1 records `spot price × 730` as
  `monthly_cost_usd`; the bound is `monthly_cost_usd ≤ budget_limit_usd` (the budget the stack
  alarms on). **operator-run; not measured by CI; reported not run and carried by an
  `agent-review` issue.**

### QA verdict for this task

- Run U1–U14. All must pass.
- Report the four `[live]` criteria as **not run**, each with one line of reason.
- Verdict: green for merging on the strength of the `[unit]` criteria, **degraded** on the
  live half; say so explicitly (`.agent_roles/qa.md` §Reporting).

## 📣 Coordination

### The batch, and the three empty slots

Batch 14 is **exactly one task**: Task-46 is the only open item whose dependencies
(Task-42, Task-43, Task-44, Task-45) are all `[x]`. The other open items are ineligible, so
the three remaining dev slots stay empty for cause:

| Slot | Candidate | Constraint that emptied it |
| --- | --- | --- |
| 2 | Task-30 | Unmerged dependency: Task-29 is `[!]` (the runner's installation token has no `workflows` permission, issue #11). |
| 3 | Task-31 | Unmerged dependencies: Task-26 is `[!]` (same `workflows` block) and Task-30 is open. |
| 4 | Task-32 | Unmerged dependency: Task-31 is open. |

Task-02, Task-26 and Task-29 are already `[!]` and are never counted as fillers. No later-batch
task has disjoint paths at this depth: the only remaining work is behind the `workflows`
permission (#11) or behind Task-30/31.

**Hot files:** Task-46 claims **none**. `docs/operations.md` and `docs/aws.md` are claimed by
section (`operations.md` §14 plus one sentence in §2; `aws.md` §10.1), which is the only way a
path is shared and here it is not even shared. `infra/aws/terraform.tfvars.example` is new and
touched by nobody else. `TODO.md` and `CHANGELOG.md` are the Orchestrator's, at merge time.

### For the Orchestrator

- One task, so its per-task tree is the combined tree: a single QA pass covers both scopes
  (`.agent_roles/qa.md` §Context).
- Merge is docs + one example file. The `[live]` half is **not run**; open one `agent-review`
  issue naming the four measurements and the runbook section that carries them, and tick the
  `TODO.md` item as the merge does today.
- Do not attempt the bring-up from the cycle. There is no credential and no `terraform`.

### For the human / operator (and the next planning cycle)

Four facts this task must not paper over; none of them blocks the in-repo deliverable, and
each is a candidate for a later task:

1. **`infra/aws/compute.tf` declares no `user_data`.** `aws_instance.host` (lines 79–110) has
   no user-data, so nothing runs `cloud-init.sh` at launch. That is why `TODO.md` words
   Task-46 as "run first boot over SSM" and why the runbook starts the script over the SSM
   session. Consequently the "≤ 5 min" clock starts at the operator's `T0`, not at
   `LaunchTime`; the runbook says so. If the bound must be measured from launch, a later task
   adds `user_data = templatefile(...)` to `compute.tf` plus a variable — a resource change,
   deliberately **not** smuggled into this task's "parameters" path.
2. **`PLAYWRIGHT_BROWSERS_PATH` lives in `/etc/environment`** (`45-browser.sh`), which systemd
   services never read. The runbook installs a `codebox.service` drop-in with `Environment=`;
   if that proves load-bearing, the clean fix is a line in
   `ops/vm/systemd/codebox.service`, which is not this task's path.
3. **`CB_BACKUP_S3_URI` and `CB_BACKUP_AGE_IDENTITY` are host variables**, documented in
   `ops/vm/README.md` §Commands and **not** in `docs/providers.md`. The runbook cites
   `ops/vm/README.md`; Task-30 owns reconciling the `CB_*` inventory.
4. **L3 is still `- [ ]`** under `TODO.md` §"Local / human": the dedicated IAM user with MFA,
   the pinned region and the budget alarm are the operator's, not the repository's. §14.1
   tells the operator to confirm L3 before applying. L4 (the OCI cutover) consumes this
   runbook later and is out of scope.

### For the next batch

- The parameters contract is the twelve names in `infra/aws/variables.tf`; a future variable
  must be added to the example in the same task, and a future resource change is a task of its
  own with `docs/aws.md` §6–§7 and `tests/stack.tftest.hcl` in its paths.
- The runbook's §14.10 is the table any later measurement extends; keep the four rows and add
  columns, do not redefine them.

## ⛔ Out of scope

- **No Terraform change of any kind:** no resource, no variable, no output, no `bootstrap/`,
  no `user_data`, no `tests/stack.tftest.hcl`. If a parameter seems missing, report it — this
  task's answer is the runbook, not a `.tf` edit.
- **No execution:** no `terraform`, `aws`, `packer`, `cloudflared`, `cb pair`, no `apply`,
  `plan`, `destroy`, no tunnel, no DNS, no device, no `curl` to a public hostname, no AWS
  credential of any kind.
- **No new `CB_*` key**, and therefore no `docs/providers.md` edit.
- No `docs/README.md` index row (no new document), no `docs/decisions.md`, no `TODO.md`, no
  `CHANGELOG.md`, no `README.md`, no `AGENTS.md`.
- No `package.json`, `package-lock.json`, workflow, `.gitignore`, CI step or new dependency.
- No invented cost figure, no "measured" claim, no placeholder number presented as a result.
- No prose rewrite of §1–§13 of `docs/operations.md` or §1–§9 of `docs/aws.md`: this task adds,
  it does not reconcile. Task-30 owns reconciliation.
- No new file under `infra/aws/` other than `terraform.tfvars.example`; no `terraform.tfvars`
  in the worktree.

## 📋 Report

The dev closes with this, in this order; QA mirrors it in its verdict body.

- **tip:** the `task-46` branch sha that reads `dev: done task-46`, and the same sha again
  after the empty marker commit.
- **commands:** every command run, verbatim, with its exit code — including the three gate
  commands and U2/U4/U7/U10 as the dev ran them. A command that was not run is written
  `not run` with the reason; never a green it did not earn.
- **criteria:** U1–U14 each marked pass/fail with the output that proves it; the four
  `[live]` criteria each marked **not run** with one line of reason.
- **files:** the three exclusive paths, with one line each saying what was added (for
  `docs/operations.md`: §14 with its ten subsections, and the §2 pointer if written).
- **deviations:** anything the spec asked for that the repository could not support, any
  command that behaved differently than documented, and any assumption made — with the file
  and line that contradicts the spec. If none, write `none`.

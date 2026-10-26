# OCI

Codebox runs on one Oracle Cloud instance. The static footprint — the network, the two IAM
policies, the dynamic group, the vault and the bucket — is the Terraform root module in
[`../infra/oci`](../infra/oci); the instance itself is launched by a retry action in
[`../ops/oci`](../ops/oci), extracted from `pkm-randomlike` (D22, D34). Every resource is
named `cb-*`, and nothing here is read by the daemon at runtime except the instance identity.

## 1. Inventory

| Resource | Name | Purpose |
| --- | --- | --- |
| VCN | `cb-vcn` | `10.0.0.0/16`; the whole network. |
| Internet gateway | `cb-igw` | Outbound internet; no inbound 80/443. |
| Route table | `cb-rt` | `0.0.0.0/0 → cb-igw`. |
| Security list | `cb-sl` | Ingress 22 from the admin `/32` only; all egress. |
| Subnet | `cb-subnet` | `10.0.1.0/24`, public, uses `cb-rt` and `cb-sl`. |
| Instance | `cb-instance` | `VM.Standard.A1.Flex`, Ubuntu 24.04 arm64. |
| Boot volume | `cb-boot` | 100 GB, preserved on terminate. |
| Block volume (optional) | `cb-workspaces` | 100 GB for worktrees when the boot disk is tight. |
| CI user | `cb-ci` | API-key-only identity used by Actions. |
| CI group | `cb-ci` | Group the `cb-ci-policy` policy attaches to. |
| CI policy | `cb-ci-policy` | Launch, volumes, VNIC/public IP, the network reads the launch needs, and the Terraform state object in `cb-backups`. |
| Instance dynamic group | `cb-instance-dg` | Matches `cb-instance` by compartment + name. |
| Instance policy | `cb-instance-policy` | Lets the instance read its own secrets in Vault. |
| Vault | `cb-vault` | Secrets: GitHub App key, session secret, tunnel token, provider keys. |
| Object Storage bucket | `cb-backups` | Nightly encrypted SQLite dumps, 30 days. |
| Cloudflare tunnel | `cb-tunnel` | Outbound connector; the only public path. |

Names are contract (D22). A resource created under another name is a bug, and the `terraform
test` suite in `infra/oci` plus a `plan` against the tenancy fail on a mismatch.

## 2. IAM

Two principals, two policies, no overlap.

**`cb-ci` (provisioning, launch and Terraform, from GitHub Actions):**

```
Allow group cb-ci to manage instances in tenancy
Allow group cb-ci to use volumes in tenancy
Allow group cb-ci to use vnics in tenancy
Allow group cb-ci to use private-ips in tenancy
Allow group cb-ci to use public-ips in tenancy
Allow group cb-ci to use subnets in tenancy
Allow group cb-ci to use vcns in tenancy
Allow group cb-ci to use security-lists in tenancy
Allow group cb-ci to use route-tables in tenancy
Allow group cb-ci to use internet-gateways in tenancy
Allow group cb-ci to read instance-images in tenancy
Allow group cb-ci to read objects in compartment <compartment> where target.bucket.name = 'cb-backups'
Allow group cb-ci to manage objects in compartment <compartment> where target.bucket.name = 'cb-backups'
```

The last two statements exist for Terraform and nothing else: the state object
`infra/oci/terraform.tfstate` and its `.tflock` sibling live in `cb-backups`, so a `terraform
init`/`plan`/`apply` authenticated as `cb-ci` must read and write them. The grant is narrowed
to that one bucket, and `cb-ci` still has nothing on Vault, IAM or bucket administration.

**`cb-instance` (runtime, through the instance principal):**

```
Allow dynamic-group cb-instance-dg to read secret-bundles in compartment <compartment>
Allow dynamic-group cb-instance-dg to read objects in compartment <compartment> where target.bucket.name = 'cb-backups'
Allow dynamic-group cb-instance-dg to manage objects in compartment <compartment> where target.bucket.name = 'cb-backups'
```

The instance never holds an OCI API key. It authenticates with its instance principal, which
is why the image can be rebuilt without carrying a credential (D20).

## 3. The Terraform module

[`../infra/oci`](../infra/oci) is one root module with Terraform `>= 1.10.0` and
`hashicorp/oci` pinned in `.terraform.lock.hcl`. It owns everything in §1 except the instance,
the boot volume and the block volume, and it is idempotent by construction: a second `apply`
reports no change.

```bash
terraform -chdir=infra/oci init -backend-config=backend.hcl
terraform -chdir=infra/oci plan
terraform -chdir=infra/oci apply
terraform -chdir=infra/oci destroy   # §9
```

| Variable | Type | Default | Meaning |
| --- | --- | --- | --- |
| `tenancy_ocid` | string | required | Tenancy: the home of the dynamic group. |
| `compartment_ocid` | string | required | Compartment of every resource. |
| `region` | string | required | e.g. `eu-madrid-1`. |
| `admin_cidr` | string | required | The operator's `/32`; a `validation` rejects anything else, `0.0.0.0/0` in particular. |
| `instance_name` | string | `cb-instance` | Display name the dynamic group matches. |
| `vcn_cidr` | string | `10.0.0.0/16` | |
| `subnet_cidr` | string | `10.0.1.0/24` | |
| `vault_name` | string | `cb-vault` | |
| `bucket_name` | string | `cb-backups` | |
| `secret_names` | list(string) | the four `cb-*` names | One Vault secret per entry. |

`terraform.tfvars` (gitignored, loaded automatically) carries the four required values. They
are the values `launch.sh` reads as `CB_OCI_*`: `CB_OCI_COMPARTMENT_ID` is
`compartment_ocid`, `CB_OCI_ADMIN_CIDR` is `admin_cidr`, `CB_OCI_INSTANCE_NAME` is
`instance_name`, and `CB_OCI_SUBNET_ID` is the module's `subnet_id` output. The outputs are
`vcn_id`, `subnet_id`, `vault_id`, `bucket_name`, `instance_name` and `dynamic_group_id`.

An `apply` creates, in dependency order:

1. `cb-vcn` (`10.0.0.0/16`) → `cb-igw` → `cb-rt` (`0.0.0.0/0 → cb-igw`) → `cb-sl` (one
   ingress, tcp/22 from `admin_cidr`, all egress) → `cb-subnet` (`10.0.1.0/24`, public, on
   `cb-rt` and `cb-sl`).
2. `cb-instance-dg`, whose rule is `instance.compartment.id = '<compartment>',
   instance.display-name = '<instance_name>'`, then `cb-ci-policy` and `cb-instance-policy`
   with the statements of §2.
3. `cb-vault` (`DEFAULT`), one AES-256 master key and one secret per `secret_names` entry,
   each holding the `CHANGE_ME` placeholder. A value is written into Vault by hand, never by
   the module and never by CI (D20): no secret is in the tree or in the Terraform state.
4. `cb-backups`, versioning off, with a lifecycle that deletes its objects after 30 days.
5. Nothing about the instance. Launching stays `launch.sh`'s job because capacity is the
   slow, retryable part: a `terraform apply` that waited for an A1 slot would hold the whole
   module for hours. The split is what lets the network, the IAM, the vault and the bucket be
   applied and destroyed while the capacity wait is open (§4).

The offline path needs no tenancy and no credential: `terraform -chdir=infra/oci init
-backend=false`, then `validate` and `test`. `test` plans the module against a mocked provider
and asserts the §1 names and CIDRs, the single `/32` ingress, the absence of 80/443 and of a
`0.0.0.0/0` ingress, the four placeholders, the bucket lifecycle and the two policy names.

State:

- The backend is `s3` against OCI Object Storage's S3-compatible endpoint, with native
  `use_lockfile` locking, `encrypt = true` and path-style requests. The bucket is
  `cb-backups` — the one the module creates — and the key is `infra/oci/terraform.tfstate`.
- `backend.tf` carries the bucket, the key and the switches; the tenancy's Object Storage
  namespace is not in the tree. `region` and the `endpoints { s3 = ... }` block come from
  `-backend-config=backend.hcl`, a gitignored copy of `infra/oci/backend.hcl.example`.
- State credentials are the environment's, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` as an
  OCI customer secret key, never a file in the tree. `init -backend=false` needs neither the
  namespace nor the key, which is why the offline checks run anywhere.

## 4. The retry action

`ops/oci/launch.sh` (shell, POSIX-ish, runs under `bash`) is the extracted `oci-launch.sh`
from `pkm-randomlike`, renamed and de-hardcoded. It exists because A1 capacity in Madrid is
exhausted for long stretches; the launch call answers `OutOfHostCapacity` until a slot opens.
The migration landed on 2026-10-24, before parity, by operator decision (D34 amended).
Until `docs/vm-image.md` ships, `CB_OCI_IMAGE_ID` points at the platform
`Canonical-Ubuntu-24.04-aarch64` image and the bootstrap in `docs/agent-vm.md` is manual;
swapping in the Packer image is a repository-variable change, not a code change.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CB_OCI_COMPARTMENT_ID` | required | Compartment for the instance. |
| `CB_OCI_SUBNET_ID` | required | `cb-subnet` OCID. |
| `CB_OCI_IMAGE_ID` | required | The Packer-built image (`docs/vm-image.md`). |
| `CB_OCI_AD` | required | Availability domain; Madrid has one. |
| `CB_OCI_SHAPES` | `2/12 2/12 1/6` | Rotation, one entry per attempt; repeats weight it. |
| `CB_OCI_INSTANCE_NAME` | `cb-instance` | Display name and idempotency key. |
| `CB_OCI_BOOT_GB` | `100` | Boot volume size. |
| `CB_OCI_SSH_PUBLIC_KEY` | required | Public key injected at launch. |
| `CB_OCI_RETRY` | `on` | `off` parks the chain. |
| `CB_OCI_ATTEMPTS` | `1` (CI: 8) | Attempts per run. |
| `CB_OCI_ATTEMPT_SLEEP` | `300` | Seconds between attempts. |
| `CB_OCI_THROTTLE_SLEEP` | `600` | Extra wait after a 429. |
| `CB_OCI_START_DELAY` | `300` | Warm-up before the first attempt of a chained run. |
| `CB_OCI_BUDGET` | `3600` | Wall-clock budget for the run. |

Rules carried over from the donor, each for a measured reason:

- **The run holds the cadence, not cron.** A schedule is a request; a chained run is a
  guarantee. The workflow's cron is a safety net.
- **One chain per tenancy.** Two loops share a launch rate limiter and the second gets
  `TooManyRequests`. `concurrency` in the workflow keeps exactly one run alive.
- **~5 minutes between attempts, 10 after a throttle.** At 2.5 minutes half the calls were
  429s, which look like capacity but are not.
- **A warm-up before the first attempt of a chained run**, or the last attempt of one run and
  the first of the next land a minute apart.
- **A missing public key exits 2** without launching: a slot spent on an unreachable box is
  worse than a red run.
- **A misspelt shape is a real error** (`InvalidParameter`), not "no capacity": stop the chain
  instead of waiting forever on a typo.
- **Idempotent by name:** each attempt looks for a `RUNNING` instance first, so a chained run
  that loses its state parks instead of launching a second box.
- **Throttle and capacity are different outcomes:** a 429 is logged and retried later; a full
  region is the normal, expected answer and exits 0.

On success it waits for the public IP and opens or updates one `oci-ready` issue with the
instance, the shape and the address. It never writes state to disk; the instance list is the
state.

## 5. The workflow

`.github/workflows/oci-retry.yml`:

- `workflow_dispatch` (manual, with `attempts`) and a `schedule` every 10 minutes as a safety
  net.
- `concurrency: cb-oci-retry` with `cancel-in-progress: false`.
- `timeout-minutes: 75`, above the script's own budget.
- Steps: checkout, install the OCI CLI, configure the key from `CB_OCI_CLI_KEY_CONTENT`, run
  `ops/oci/launch.sh`, create the `oci-ready` label if missing, announce, and chain the next
  run when the chain is still armed.
- The chain step is skipped when an instance exists, when `CB_OCI_RETRY=off`, or when the
  attempt step failed for a configuration reason.
- No model tokens, no secrets in the summary, no resource created outside `cb-*`.
- The repository is public, so Actions minutes are free: the chain costs nothing while it
  waits for capacity.

## 6. Capacity and shape

- Always Free Ampere: **2 OCPU / 12 GB** (since August 2026) or **4/24** on a pay-as-you-go
  account inside the allowance. Madrid has one AD, so there is no AD rotation.
- The rotation asks for the ceiling twice and `1/6` once; a half-size box today beats a
  full-size one that never appears.
- **Growing a 1/6 box** is a deliberate, braked operation: stop the chain, stop the
  instance, update `shape-config`, start it, re-arm the chain. A stopped instance is not
  `RUNNING`, so a live chain would launch a second box beside it.
- Always Free compute can be reclaimed after a week of idleness. The rule is not "was it
  touched" but the **95th percentile of CPU, memory and network over seven days**: a spike
  every few hours does not move it, so the box is kept by doing its real work, not by a burner
  (D39). `codebox-keepalive.timer` runs the liveness pass every six hours — `cb doctor`,
  `cb prune`, a loopback health probe — and appends the reading it took to
  `/var/lib/codebox/logs/keepalive.jsonl`, which is how the operator sees the box drifting
  towards the threshold instead of guessing. Four fires a day at 00:40, 06:40, 12:40 and 18:40
  UTC make **28 lines in seven days**: that count is the liveness check the operator reads. If
  it is ever reclaimed, the backup and the image are the answer, not a second instance
  (`docs/operations.md` §10.5).

## 7. Cost

The network, the A1 instance, the 100 GB boot volume and the bucket all sit inside the Always
Free allowance. The billable surfaces are a shape above the allowance, extra block storage and
egress; `terraform plan` in `infra/oci` is the review, and it lists every resource a change
would add or replace before anything is created.

## 8. Extraction from `pkm-randomlike` (D34)

What moves, and what does not:

| From pkm | To Codebox | Change |
| --- | --- | --- |
| `scripts/agent/vm/oci-launch.sh` | `ops/oci/launch.sh` | Prefix `pkm-` → `cb-`, `PKM_*`/`OCI_*` → `CB_OCI_*`, no game paths, tests rewritten. |
| `.github/workflows/oci-retry.yml` | `.github/workflows/oci-retry.yml` | Chain, brake, shapes and announcement kept; variables renamed. |
| Inline VCN/IGW/subnet calls | `infra/oci/` | Extracted in this repository as an idempotent shell script under `ops/oci/`, retired when the Terraform module landed; the network, the IAM, the vault and the bucket are `infra/oci` now. |
| Policy fragments in docs | `ops/oci/policy.md` | Split `cb-ci` and `cb-instance`. |
| `pkm-agent-driver` service | `ops/vm/systemd/cb-agent.service` | A separate unit and user from the product's `codebox.service` (see `agent-vm.md` §2). |

On 2026-10-24 the operator pulled the migration forward, before parity (D34 amended). The
`pkm-randomlike` chain was braked (`OCI_RETRY=off`) and its in-flight run cancelled; its
`pkm-vcn` and `pkm-subnet` were deleted; the `cb-*` network and the `cb-ci` identity were
created from this repository. The game repository keeps its workflow file and its OCI
variables, but they point at a subnet that no longer exists: re-arming that chain would fail
at launch, so `OCI_RETRY` stays `off`. Task-32 is reduced to deleting the duplicate and the
stale variables.

## 9. Teardown

```bash
terraform -chdir=infra/oci destroy
```

`cb-instance` is not in the module, so a destroy never terminates it: brake the retry chain,
terminate the instance from `launch.sh` or the console, and only then destroy — the VCN cannot
go while its VNIC exists. The image is not in the module either, so the rebuild path always
survives, and `cb-boot` is preserved or not by the terminate call, not by Terraform.

`cb-backups` **is** in the module, so a destroy takes it with the network, the policies, the
dynamic group and the vault. That bucket holds two things worth a thought before the command:
the nightly dumps (D33) and the Terraform state of this very module. A teardown is therefore a
full one — copy out what you want to keep (`terraform -chdir=infra/oci state pull >
cb-oci.tfstate`, `oci os object bulk-download`) — and the final state write has nowhere to go
once the bucket is gone, so expect Terraform to report it after the resources are already
deleted. The next `apply` starts from an empty state and rebuilds the same `cb-*` resources.

## 10. Checks

| Check | Frequency | Fails when |
| --- | --- | --- |
| `terraform fmt -check -recursive`, `terraform validate`, `terraform test` | On change, by hand until a workflow exists (issue #11) | A name is not `cb-*`, a CIDR moved, ingress is wider than `/32`. |
| `terraform plan` against the tenancy | Monthly, by hand | A `cb-*` resource drifts from the code, or a name or CIDR moved. |
| `launch.sh --dry-run` | On change | A required variable is missing or a shape is malformed. |
| `oci iam policy list` | Monthly, by hand | A policy grants more than §2. |
| Bucket lifecycle | Monthly | Not `30 days`, or versioning on. |
| Instance shape | After a resize | Above the free allowance without a note. |

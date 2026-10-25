# OCI

Codebox runs on one Oracle Cloud instance, provisioned by scripts in `ops/oci/` and launched
by a retry action extracted from `pkm-randomlike` (D22, D34). Every resource is named `cb-*`,
and nothing here is read by the daemon at runtime except the instance identity.

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
| CI policy | `cb-ci-policy` | Launch, volumes, VNIC/public IP and the network reads the launch needs. |
| Instance dynamic group | `cb-instance-dg` | Matches `cb-instance` by compartment + name. |
| Instance policy | `cb-instance-policy` | Lets the instance read its own secrets in Vault. |
| Vault | `cb-vault` | Secrets: GitHub App key, session secret, tunnel token, provider keys. |
| Object Storage bucket | `cb-backups` | Nightly encrypted SQLite dumps, 30 days. |
| Cloudflare tunnel | `cb-tunnel` | Outbound connector; the only public path. |

Names are contract (D22). A script that creates a resource with another name is a bug, and
`provision.sh --plan` fails on a mismatch.

## 2. IAM

Two principals, two policies, no overlap.

**`cb-ci` (provisioning, from GitHub Actions):**

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
```

Nothing about Vault, Object Storage or IAM itself.

**`cb-instance` (runtime, through the instance principal):**

```
Allow dynamic-group cb-instance-dg to read secret-bundles in compartment <compartment>
Allow dynamic-group cb-instance-dg to read objects in compartment <compartment> where target.bucket.name = 'cb-backups'
Allow dynamic-group cb-instance-dg to manage objects in compartment <compartment> where target.bucket.name = 'cb-backups'
```

The instance never holds an OCI API key. It authenticates with its instance principal, which
is why the image can be rebuilt without carrying a credential (D20).

## 3. Provisioning order

`ops/oci/provision.sh` is idempotent and ordered:

```bash
ops/oci/provision.sh --plan                    # prints the plan; makes no call
ops/oci/provision.sh --apply                   # creates what is missing, updates nothing else
ops/oci/provision.sh --apply --with-vault --with-bucket
ops/oci/provision.sh --destroy --plan          # §9, in reverse
ops/oci/provision.sh --destroy --apply [--purge]
```

1. VCN → IGW → route table → security list → subnet.
2. Dynamic group and instance policy (needs the compartment and the instance name).
3. Vault and the secret bundle placeholders (values are written by a human, never by CI).
4. Bucket `cb-backups` with lifecycle `30 days`.
5. Nothing about the instance: launching is `launch.sh`'s job, because capacity is the slow,
   retryable part.

Required variables: `CB_OCI_COMPARTMENT_ID` and `CB_OCI_ADMIN_CIDR`, the admin `/32` the
security list admits on port 22 — the operator's address, not a repository default. Optional:
`CB_OCI_SUBNET_ID`, `CB_OCI_VAULT_ID`, `CB_OCI_BUCKET` and `CB_OCI_INSTANCE_NAME` (default
`cb-instance`). A missing required variable is `error: <VAR> is empty` on stderr and exit 2,
with no partial plan. The region is not a `CB_*` key: `--apply` and `--destroy` let the CLI
read `OCI_CLI_REGION`, and `--plan` needs no region at all.

`--plan` is the review artifact. It prints one line per resource, in the order above, as
`<verb> <kind> <name> …details`: the verb is `create`, `reuse`, `delete` or `terminate`, the
kind is `vcn`, `igw`, `route-table`, `security-list`, `subnet`, `dynamic-group`, `policy`,
`vault`, `secret`, `bucket` or `instance`, and the name is always the `cb-*` name from §1 — a
name that is not `cb-*` is exit 2. It prints the exact CIDRs (`10.0.0.0/16` for `cb-vcn`,
`10.0.1.0/24` for `cb-subnet`, `0.0.0.0/0` as the route destination), the ingress rule
`ingress tcp/22 from <CB_OCI_ADMIN_CIDR>`, the OCIDs it already knows from the environment
(`CB_OCI_COMPARTMENT_ID`, and `CB_OCI_SUBNET_ID` when set), and the literal `-` for every
value it can only know after creation. It invokes no `oci` binary and makes no network call,
so it exits 0 on a machine with neither the CLI nor `jq`. `--with-vault` adds `cb-vault` and
the four secret names `cb-github-app`, `cb-session-secret`, `cb-tunnel-token` and
`cb-provider-keys`; `--with-bucket` adds `cb-backups`; nothing else changes.

`--apply` looks every resource up by name inside `CB_OCI_COMPARTMENT_ID` before it creates
it, so a second run prints `reuse` and calls no `create`. It never deletes, and never updates
a resource it did not create. `--destroy` walks the same order backwards (§9), terminates
`cb-instance` with `cb-boot` preserved and never deletes the image, which is the rebuild
path. The script writes no state — no cache, no lock file, no `.state` directory: the
tenancy is the state, as §4 requires of the retry.

`ops/oci/test/provision.test.mjs` runs `--plan` against a fixture `oci` and asserts both the
names and that the fixture was never called, so the plan cannot quietly start talking to the
network.

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
  towards the threshold instead of guessing. If it is ever reclaimed, the backup and the image
  are the answer, not a second instance (`docs/operations.md` §10.5).

## 7. Cost

The network, the A1 instance, the 100 GB boot volume and the bucket all sit inside the Always
Free allowance. The billable surfaces are a shape above the allowance, extra block storage and
egress. `provision.sh --plan` prints a warning when a shape or a volume exceeds the free
tier.

## 8. Extraction from `pkm-randomlike` (D34)

What moves, and what does not:

| From pkm | To Codebox | Change |
| --- | --- | --- |
| `scripts/agent/vm/oci-launch.sh` | `ops/oci/launch.sh` | Prefix `pkm-` → `cb-`, `PKM_*`/`OCI_*` → `CB_OCI_*`, no game paths, tests rewritten. |
| `.github/workflows/oci-retry.yml` | `.github/workflows/oci-retry.yml` | Chain, brake, shapes and announcement kept; variables renamed. |
| Inline VCN/IGW/subnet calls | `ops/oci/provision.sh` | Extracted, idempotent, `--plan`. |
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
ops/oci/provision.sh --destroy --plan    # what would be deleted
ops/oci/provision.sh --destroy --apply   # network, bucket, vault policy; keeps the image
```

The instance is terminated with its boot volume preserved for one week; `cb-backups` is
emptied only with an explicit `--purge`, and the image is never deleted by teardown — it is
the rebuild path.

## 10. Checks

| Check | Frequency | Fails when |
| --- | --- | --- |
| `provision.sh --plan` names | CI, on change | A name is not `cb-*`, a CIDR moved, ingress is wider than `/32`. |
| `launch.sh --dry-run` | On change | A required variable is missing or a shape is malformed. |
| `oci iam policy list` | Monthly, by hand | A policy grants more than §2. |
| Bucket lifecycle | Monthly | Not `30 days`, or versioning on. |
| Instance shape | After a resize | Above the free allowance without a note. |

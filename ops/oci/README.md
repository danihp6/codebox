# ops/oci

Provisioning and the launch retry. The inventory, the IAM split and the extraction record
are in [`../../docs/oci.md`](../../docs/oci.md).

| File | What it is |
| --- | --- |
| `launch.sh` | `CB_OCI_*` retry loop: one `launch` call per attempt, parks on a `RUNNING` `cb-instance`, reports `id` / `ip` / `shape`. `--dry-run` validates without calling OCI. |
| `provision.sh` | Idempotent `cb-*` network, dynamic group, policy, Vault and bucket. `--plan` prints the whole plan with no `oci` call; `--apply` creates what is missing; `--destroy` runs §3 backwards and keeps the image. |
| `policy.md` | The `cb-ci` and `cb-instance` statements from `docs/oci.md` §2, verbatim. |
| `launch.test.mjs` | Fixture-driven shell tests for `launch.sh`: capacity, throttle, bad shape, missing key, an instance already running. Lives in `test/`. |
| `provision.test.mjs` | Fixture-driven shell tests for `provision.sh`: the `--plan` names and CIDRs, the optional blocks, a missing variable, the destroy order. Lives in `test/`. |
| `README.md` | This map. |

Both test files are plain Node plus `vitest`; they build a fake `oci` in a temporary
directory, put it first on `PATH` and assert on the recorded arguments. `npm test` runs them
through the `ops` project of `vitest.config.ts`, and `npx vitest run --project ops` runs this
folder alone. No tenancy, no CLI and no credential are needed.

The workflow that drives the retry is
[`.github/workflows/oci-retry.yml`](../../.github/workflows/oci-retry.yml). It is the only
writer of the chain: do not run a second loop against the same tenancy, both would share one
launch rate limiter.

## Operating it

```bash
# The network, in full, without a call: the review artifact
CB_OCI_COMPARTMENT_ID=... CB_OCI_ADMIN_CIDR=203.0.113.7/32 bash ops/oci/provision.sh --plan

# Create what is missing; a second run prints reuse and creates nothing
CB_OCI_COMPARTMENT_ID=... CB_OCI_ADMIN_CIDR=... OCI_CLI_REGION=eu-madrid-1 \
  bash ops/oci/provision.sh --apply --with-vault --with-bucket

# Tear it down: cb-instance stops with cb-boot preserved, the image stays
CB_OCI_COMPARTMENT_ID=... CB_OCI_ADMIN_CIDR=... bash ops/oci/provision.sh --destroy --plan

# Validate the launch configuration without calling OCI
CB_OCI_COMPARTMENT_ID=... CB_OCI_SUBNET_ID=... CB_OCI_IMAGE_ID=... CB_OCI_AD=... \
CB_OCI_SSH_PUBLIC_KEY=... OCI_CLI_USER=... OCI_CLI_FINGERPRINT=... OCI_CLI_TENANCY=... \
OCI_CLI_REGION=... OCI_CLI_KEY_CONTENT=... bash ops/oci/launch.sh --dry-run

# Brake the chain: the runs stay green and do nothing
gh variable set CB_OCI_RETRY --body off

# Re-arm it
gh variable set CB_OCI_RETRY --body on
```

A stopped instance is not `RUNNING`: brake the chain before stopping or resizing it, or the
next run reads the box as gone and launches a second one beside it (`docs/oci.md` §6).

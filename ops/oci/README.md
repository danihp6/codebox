# ops/oci

The launch retry. The inventory, the IAM split and the extraction record are in
[`../../docs/oci.md`](../../docs/oci.md).

Terraform owns the static footprint — `cb-vcn`, the internet gateway, the route table, the
security list, `cb-subnet`, `cb-instance-dg`, the two policies, `cb-vault` and `cb-backups` —
in [`../../infra/oci`](../../infra/oci). This folder owns the instance: `launch.sh` waits for
A1 capacity and consumes the module's `subnet_id` and `instance_name` outputs, because no
`apply` can wait for capacity.

| File | What it is |
| --- | --- |
| `launch.sh` | `CB_OCI_*` retry loop: one `launch` call per attempt, parks on a `RUNNING` `cb-instance`, reports `id` / `ip` / `shape`. `--dry-run` validates without calling OCI. |
| `policy.md` | The `cb-ci` and `cb-instance` statements from `docs/oci.md` §2, verbatim. |
| `launch.test.mjs` | Fixture-driven shell tests for `launch.sh`: capacity, throttle, bad shape, missing key, an instance already running. Lives in `test/`. |
| `README.md` | This map. |

The test file is plain Node plus `vitest`; it builds a fake `oci` in a temporary directory,
puts it first on `PATH` and asserts on the recorded arguments. `npm test` runs it through the
`ops` project of `vitest.config.ts`, and `npx vitest run --project ops` runs this folder
alone. No tenancy, no CLI and no credential are needed.

The workflow that drives the retry is
[`.github/workflows/oci-retry.yml`](../../.github/workflows/oci-retry.yml). It is the only
writer of the chain: do not run a second loop against the same tenancy, both would share one
launch rate limiter.

## Operating it

```bash
# The network, IAM, Vault and bucket: review, change, then the subnet to launch in
terraform -chdir=infra/oci init -backend-config=backend.hcl
terraform -chdir=infra/oci plan
terraform -chdir=infra/oci apply
terraform -chdir=infra/oci output subnet_id

# The teardown: everything the module owns, never cb-instance, never the image
terraform -chdir=infra/oci destroy

# Validate the launch configuration without calling OCI
CB_OCI_COMPARTMENT_ID=... CB_OCI_SUBNET_ID=... CB_OCI_IMAGE_ID=... CB_OCI_AD=... \
CB_OCI_SSH_PUBLIC_KEY=... OCI_CLI_USER=... OCI_CLI_FINGERPRINT=... OCI_CLI_TENANCY=... \
OCI_CLI_REGION=... OCI_CLI_KEY_CONTENT=... bash ops/oci/launch.sh --dry-run

# Brake the chain: the runs stay green and do nothing
gh variable set CB_OCI_RETRY --body off

# Re-arm it
gh variable set CB_OCI_RETRY --body on
```

`infra/oci/backend.hcl` holds the Object Storage namespace and is gitignored (copy
`infra/oci/backend.hcl.example`); `infra/oci/terraform.tfvars` holds the tenancy, compartment,
region and admin `/32`, and is gitignored too. The state credentials are the environment's, an
OCI customer secret key in `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. A teardown is
`terraform -chdir=infra/oci destroy` and it takes the bucket with it: read `docs/oci.md` §9
first.

A stopped instance is not `RUNNING`: brake the chain before stopping or resizing it, or the
next run reads the box as gone and launches a second one beside it (`docs/oci.md` §6).

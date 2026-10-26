# infra/oci

The OCI static footprint as Terraform: `cb-vcn` and its internet gateway, route table,
security list and subnet, the `cb-instance-dg` dynamic group, the `cb-ci-policy` and
`cb-instance-policy` policies, `cb-vault` with its four secret placeholders and the
`cb-backups` bucket.

The instance is **not** in this module on purpose. No `apply` can wait for A1 capacity, so
`ops/oci/launch.sh` keeps the retry loop and consumes the `subnet_id` and `instance_name`
outputs; the module owns everything that can be created in seconds and destroyed in seconds.

| File | What it is |
| --- | --- |
| `versions.tf` | Terraform `>= 1.10.0` and `hashicorp/oci` pinned to `9.11.0`. |
| `backend.tf` | `s3` backend on OCI Object Storage: `cb-backups`, `infra/oci/terraform.tfstate`, native `use_lockfile` locking. |
| `providers.tf` | The `oci` provider, authenticated from the OCI CLI environment. |
| `variables.tf` | The inputs: tenancy, compartment, region, the admin `/32`, the CIDRs and the `cb-*` names. |
| `network.tf` | `cb-vcn`, `cb-igw`, `cb-rt`, `cb-sl` and `cb-subnet`. |
| `iam.tf` | `cb-instance-dg` and the two policies, with the statements of `docs/oci.md` §2. |
| `vault.tf` | `cb-vault`, its AES-256 master key and one `CHANGE_ME` secret per `secret_names` entry. |
| `storage.tf` | `cb-backups`, versioning off, objects deleted after 30 days. |
| `outputs.tf` | `vcn_id`, `subnet_id`, `vault_id`, `bucket_name`, `instance_name`, `dynamic_group_id`. |
| `tests/cb.tftest.hcl` | `mock_provider "oci"` plus `command = plan`: the CIDRs, the single `/32` ingress, the four placeholders, the lifecycle and the policy names. |
| `backend.hcl.example` | Copy to `backend.hcl` for the tenancy's Object Storage namespace; the endpoint is never committed. |
| `.gitignore` | `.terraform/`, state and plan files, `terraform.tfvars`, `*.auto.tfvars`, `backend.hcl`. |
| `.terraform.lock.hcl` | Provider checksums (linux_amd64). Committed. |
| `README.md` | This map. |

The inventory, the IAM split and the teardown are in [`../../docs/oci.md`](../../docs/oci.md).

## State

The state lives in `cb-backups`, the bucket this module also creates, so the backend is
configured in two halves: `backend.tf` holds the bucket, the key and the S3-compat switches,
and the tenancy-specific part comes from a local file that is not committed, because the
Object Storage namespace differs per tenancy and must not be guessed.

```bash
cp infra/oci/backend.hcl.example infra/oci/backend.hcl   # then set the namespace and region
terraform -chdir=infra/oci init -backend-config=backend.hcl
```

The endpoint credentials are the environment's, never a file: an OCI customer secret key in
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, or an `~/.aws/credentials` profile. Locking
is S3-native (`use_lockfile`), so no DynamoDB table exists and none is needed.

## Operating it

```bash
# The offline checks: no credential, no tenancy, no network call
terraform -chdir=infra/oci init -backend=false
terraform -chdir=infra/oci fmt -check -recursive
terraform -chdir=infra/oci validate
terraform -chdir=infra/oci test

# The review, then the change, against the tenancy
terraform -chdir=infra/oci plan
terraform -chdir=infra/oci apply

# The teardown: everything the module owns, never cb-instance, never the image
terraform -chdir=infra/oci destroy
```

`terraform.tfvars` holds `tenancy_ocid`, `compartment_ocid`, `region` and `admin_cidr`; it is
gitignored and loaded automatically. The values are the same ones `ops/oci/launch.sh` reads as
`CB_OCI_COMPARTMENT_ID`, `CB_OCI_ADMIN_CIDR` and `CB_OCI_INSTANCE_NAME`; `CB_OCI_SUBNET_ID` is
this module's `subnet_id` output.

A **destroy deletes `cb-backups`**, and the Terraform state lives in that bucket: see
[`../../docs/oci.md`](../../docs/oci.md) §9 before running one.

## Why there is no test of the instance

`grep -rn oci_core_instance infra/oci/*.tf` prints nothing, and that is the check: the
instance is `launch.sh`'s, so no plan, apply or destroy here can terminate it or wait for
capacity.

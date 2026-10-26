# Spec: Task-47 — `infra/oci`: Terraform for the OCI resources

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** ops (Terraform + docs).
- **Role:** Dev.
- **Objective:** `infra/oci/` becomes the root Terraform module that owns the OCI static
  footprint — `cb-vcn`, the internet gateway, the route table, the security list (SSH only
  from the admin `/32`, no 80/443), `cb-subnet`, the instance dynamic group, the `cb-ci` and
  `cb-instance` policies, `cb-vault` with its four secret placeholders and the `cb-backups`
  bucket — with remote state in that bucket. The instance stays out on purpose:
  `ops/oci/launch.sh` keeps the capacity wait and consumes the module's outputs.
  `ops/oci/provision.sh` and its test are deleted, and the docs that described them are
  rewritten to describe the module.
- **Environment:** worktree `../wt-cb-47`, branch `task-47`, base `origin/main`.
- **Dependencies:** Task-24 (merged). It produced `ops/oci/provision.sh`, its test,
  `ops/oci/README.md` and the inventory in `docs/oci.md` §1–§3 that this task retires.

### Exclusive paths (single writer)

- `infra/oci/**` (new: `versions.tf`, `backend.tf`, `variables.tf`, the resource files,
  `outputs.tf`, `.gitignore`, `.terraform.lock.hcl`, `tests/*.tftest.hcl`)
- `ops/oci/provision.sh` (delete)
- `ops/oci/test/provision.test.mjs` (delete)
- `ops/oci/README.md`
- `ops/oci/policy.md`
- `docs/oci.md`
- `AGENTS.md` (the **Repository layout** section only — add the `infra/` block with both
  `infra/oci/` and `infra/aws/`; Task-42 creates `infra/aws/` in this same batch and does not
  edit this file)

Nothing else. No `TODO.md`, no `CHANGELOG.md`, no `docs/README.md` (Task-42 owns it), no
`docs/vm-image.md` (Task-41), no `ops/image/**`, no `ops/oci/launch.sh`, no `.github/**`,
no `.agent_specs/`.

### Inputs (read-only)

- `AGENTS.md` (stack decisions, host paragraph, layout).
- `docs/oci.md` as it stands (all sections).
- `docs/decisions.md` (D20, D22, D33, D34, D39).
- `docs/providers.md` §12 (`CB_OCI_*` keys — unchanged by this task).
- `ops/oci/provision.sh`, `ops/oci/policy.md`, `ops/oci/README.md`,
  `ops/oci/test/provision.test.mjs`.
- `ops/oci/launch.sh` — the variable table it reads.

## 🔒 Contract

### Module surface

Root module at `infra/oci/`, Terraform `>= 1.10.0` (S3 native locking `use_lockfile`),
provider `hashicorp/oci` pinned, `.terraform.lock.hcl` committed (generated with
`terraform providers lock` on linux_amd64).

Variables (names are the contract):

| Variable | Type | Default | Meaning |
| --- | --- | --- | --- |
| `tenancy_ocid` | string | required | Tenancy. |
| `compartment_ocid` | string | required | Compartment of every resource. |
| `region` | string | required | e.g. `eu-madrid-1`. |
| `admin_cidr` | string | required | The operator's `/32`; `validation` rejects anything else and `0.0.0.0/0`. |
| `instance_name` | string | `cb-instance` | Display name the dynamic group matches; `launch.sh`'s `CB_OCI_INSTANCE_NAME`. |
| `vcn_cidr` | string | `10.0.0.0/16` | |
| `subnet_cidr` | string | `10.0.1.0/24` | |
| `vault_name` | string | `cb-vault` | |
| `bucket_name` | string | `cb-backups` | |
| `secret_names` | list(string) | `["cb-github-app","cb-session-secret","cb-tunnel-token","cb-provider-keys"]` | |

Resources, names exactly as `docs/oci.md` §1 (D22: a name that is not `cb-*` is a bug):

- `oci_core_vcn` `cb-vcn` (`vcn_cidr`, DNS label); `oci_core_internet_gateway` `cb-igw`;
  `oci_core_route_table` `cb-rt` with `0.0.0.0/0 → cb-igw`; `oci_core_security_list` `cb-sl`
  with **one** ingress rule `tcp/22` from `var.admin_cidr` and all egress, and **no ingress on
  80/443 and no `0.0.0.0/0` ingress**; `oci_core_subnet` `cb-subnet` (`subnet_cidr`, public,
  uses `cb-rt` and `cb-sl`).
- `oci_identity_dynamic_group` `cb-instance-dg` with the matching rule
  `instance.compartment.id = '<compartment>', instance.display-name = '<instance_name>'`
  (the rule `provision.sh` uses today — preserve it; do not widen it).
- `oci_identity_policy` `cb-ci-policy` and `cb-instance-policy` whose statements are exactly
  the blocks in `docs/oci.md` §2 **after** your edit below. `cb-ci-policy` must also be able
  to read and write the state object in `cb-backups` (see State); add those statements to
  §2 and to `ops/oci/policy.md` rather than leaving them implicit.
- `oci_kms_vault` `cb-vault` (`DEFAULT`), one `oci_kms_key` (`AES`, 32 bytes) and one
  `oci_vault_secret` per `secret_names` entry, content type `BASE64` and **placeholder content
  only** (e.g. `CHANGE_ME`), named `cb-<name>`. No real secret, no `sensitive` value in a
  committed var-file.
- `oci_objectstorage_bucket` `cb-backups`, versioning **disabled** (the docs §10 check fails
  on versioning), and `oci_objectstorage_object_lifecycle_policy` deleting objects after
  **30 days**.
- Outputs consumed by `launch.sh` and later tasks: `vcn_id`, `subnet_id`, `vault_id`,
  `bucket_name`, `instance_name`, `dynamic_group_id`.
- **No `oci_core_instance` resource.** The instance stays `launch.sh`'s job because no
  `apply` can wait for A1 capacity. Say that in the module README/comment.

State:

- `backend.tf` is `backend "s3"` against OCI Object Storage's S3-compatible endpoint (the
  `cb-backups` bucket already exists): `key = "infra/oci/terraform.tfstate"`,
  `use_lockfile = true`, `encrypt = true`, `skip_credentials_validation = true`,
  `skip_region_validation = true`, `skip_requesting_account_id = true`,
  `use_path_style = true`, and an `endpoints { s3 = ... }` block fed by a
  `-backend-config`/variable (the object-storage namespace is per tenancy, so it must not be
  guessed). Credentials come from the environment (`AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY`, an OCI customer secret key), never a file. `terraform init
  -backend=false` must work without them.
- `.gitignore` ignores `.terraform/`, `*.tfstate`, `*.tfstate.*`, `*.tfplan`, `crash.log`,
  `terraform.tfvars`, `*.auto.tfvars`; `.terraform.lock.hcl` is committed.

Test (`tests/cb.tftest.hcl`), `mock_provider "oci"`, `command = plan`, asserting at least:

- `cb-vcn` CIDR `10.0.0.0/16` and `cb-subnet` CIDR `10.0.1.0/24`;
- the security list has exactly one ingress, tcp/22, source = `var.admin_cidr`; no rule with
  `0.0.0.0/0` or port 80/443;
- the route rule destination is `0.0.0.0/0` and targets the internet gateway;
- exactly four vault secrets with the four names and placeholder content;
- the bucket is `cb-backups`, its lifecycle deletes at 30 days and versioning is off;
- the two policy names and the dynamic group rule contain the compartment and
  `cb-instance`;
- there is **no** `oci_core_instance` in the plan (a `expect_failures`/length trick or a grep
  in the acceptance below — your choice, but prove it).

### Retirements and docs

- Delete `ops/oci/provision.sh` and `ops/oci/test/provision.test.mjs`. Nothing may reference
  them afterwards.
- `ops/oci/README.md`: drop the two `provision.sh`/`provision.test.mjs` rows and the
  `provision.sh` commands; add the Terraform commands (`terraform -chdir=infra/oci init`,
  `plan`, `apply`, `destroy`, with the backend/credential note); keep `launch.sh`, its test
  and the `policy.md` row; state the split (Terraform owns the network/IAM/Vault/bucket,
  `launch.sh` owns the instance).
- `ops/oci/policy.md`: copy the amended §2 blocks verbatim, in the same order; the `cb-ci`
  block gains only the two object-storage statements for the state object in `cb-backups`
  (`read`/`manage objects … where target.bucket.name = 'cb-backups'`); the file's closing
  paragraph ("Nothing … grants Object Storage to cb-ci") must be rewritten to say exactly
  what changed and why (Terraform state), or the doc lies.
- `docs/oci.md`:
  - §2: add the state-object statements to `cb-ci` and note they exist for Terraform state.
  - §3: replace the `provision.sh` section with the module — variables, `terraform
    -chdir=infra/oci plan/apply/destroy`, what it creates, what it deliberately does not (the
    instance), the state bucket and locking, and the `-backend=false` validation path.
  - §7: the cost warning is now `terraform plan`'s output; remove the `provision.sh --plan`
    sentence without inventing a replacement feature.
  - §8: the extraction table row for `provision.sh` says it was retired when `infra/oci`
    landed; keep the historical sentence that the network was created from this repository.
  - §9: teardown is `terraform destroy`; it keeps the bucket and the image, and it never
    terminates `cb-instance` (that is `launch.sh`/the console). If destroy does remove the
    bucket, fix §9 to match what the module does — the image must always survive.
  - §10: the checks table rows that named `provision.sh --plan` become `terraform fmt
    -check`, `terraform validate`, `terraform test` (CI, on change) and `terraform plan`
    against the tenancy (monthly, by hand) — same failure language (a name that is not `cb-*`,
    a CIDR that moved, ingress wider than `/32`).
- `AGENTS.md` layout section: add

  ```
  infra/
    oci/               # Terraform: cb-vcn, IAM, Vault, cb-backups (the instance stays in ops/oci)
    aws/               # Terraform: VPC, spot box, IAM, backup bucket (Task-42)
  ```

  and nothing else in the file.

## 🧩 Configuration

No new `CB_*` key. `CB_OCI_COMPARTMENT_ID`, `CB_OCI_ADMIN_CIDR`, `CB_OCI_SUBNET_ID`,
`CB_OCI_INSTANCE_NAME` remain `launch.sh`'s inputs; the module takes the same values as
Terraform variables. Do not edit `docs/providers.md`.

## 🧪 Test and Validation Plan (for QA)

Run from the task's integration worktree, verbatim.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `export TF_PLUGIN_CACHE_DIR=/tmp/cb-tf-plugin-cache`
  - `terraform -chdir=infra/oci fmt -check -recursive`
  - `terraform -chdir=infra/oci init -backend=false`
  - `terraform -chdir=infra/oci validate`
  - `terraform -chdir=infra/oci test`
  - `grep -rn 'provision\.sh\|provision\.test' --include='*.md' --include='*.sh' --include='*.mjs' --include='*.yml' .` (excluding `node_modules` and `.agent_specs`) — must print nothing
  - `git diff --name-only origin/main...HEAD` — audit against the exclusive paths.
  - `git ls-files infra/oci | grep -E 'tfstate|\.terraform/|tfvars$'` — must print nothing.
- **Acceptance criteria:**
  - [ ] `[unit]` `terraform fmt -check -recursive` exits 0.
  - [ ] `[unit]` `terraform init -backend=false` + `terraform validate` exit 0 (provider
    download allowed; no OCI credential, no tenancy call).
  - [ ] `[unit]` `terraform test` exits 0 and proves the CIDRs, the single `/32` ingress, no
    80/443, the four secret placeholders, the bucket lifecycle, the policy names and the
    absence of an instance resource.
  - [ ] `[unit]` No `tfstate`, `.terraform/` or `terraform.tfvars` is tracked; no credential
    in the diff.
  - [ ] `[unit]` `provision.sh`, its test and every reference to them are gone; `npm test` is
    green after the deletion.
  - [ ] `[unit]` `npm run lint`, `npm test` and `npm run build` are green.
  - [ ] `[unit]` No file outside the exclusive paths changed.
  - [ ] `[live]` A `plan` against the existing tenancy shows no drift, `destroy` removes the
    network and keeps the bucket and the image, and a second `apply` rebuilds it. Measurement:
    on the operator's tenancy, `plan` exits 0 with no resource to change; `destroy` then
    `oci network vcn list` shows no `cb-vcn` while `oci os bucket get --name cb-backups` still
    succeeds; `apply` restores the VCN. **Cannot be measured on GitHub Actions** (no
    tenancy): report `not run`; the Orchestrator opens an `agent-review` issue.

## 📣 Coordination

- For Task-45 (host-neutral docs): `AGENTS.md` already carries both `infra/` lines and
  `docs/oci.md` §3 describes Terraform; the remaining host-neutral rewrite is Task-45's.
- For Task-46: `terraform apply`/`destroy` are the deployment tool; `launch.sh` reads
  `CB_OCI_SUBNET_ID` from this module's `subnet_id` output.
- For Task-42: the module shapes and the doc style are the reference; no shared path.

## ⛔ Out of scope

- No `terraform apply`/`destroy`, no tenancy call, no real OCID in the tree.
- No instance resource, no change to `ops/oci/launch.sh`, no Vault secret value.
- No new npm dependency, no CI workflow (the runner has no `workflows` permission — issue
  #11).
- No rewrite of `docs/oci.md` sections unrelated to provisioning/teardown/checks.

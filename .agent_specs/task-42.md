# Spec: Task-42 — `infra/aws`: Terraform for the spot host

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** ops (Terraform).
- **Role:** Dev.
- **Objective:** `infra/aws/` becomes a root Terraform module that creates the whole AWS
  footprint of the spot host — VPC, one public subnet, an internet gateway and route table, a
  security group that admits SSH only from the admin `/32` and nothing on 80/443, a spot
  `c7g.2xlarge` with a 100 GB gp3 root volume and IMDSv2 required, an instance profile that
  grants SSM Session Manager and the backup bucket only, the versioned + SSE dump bucket with
  a 30-day lifecycle, a budget alarm and the documented outputs. State lives in S3 with native
  locking; a one-file `bootstrap/` creates the state bucket the first time. A `terraform test`
  with a mocked `aws` provider proves the security invariants offline, and `docs/aws.md`
  documents the stack in the documentation index.
- **Environment:** worktree `../wt-cb-42`, branch `task-42`, base `origin/main`.
- **Dependencies:** none. Task-40 (the `amazon-ebs` builder, in this batch) supplies the AMI
  later; `ami_id` must default to a Canonical Ubuntu 24.04 arm64 lookup so the stack applies
  before that image exists. Task-47 (also in this batch) writes the one `AGENTS.md` layout
  line for `infra/aws/`; **do not edit `AGENTS.md` yourself.**

### Exclusive paths (single writer)

- `infra/aws/**` (new: `versions.tf`, `backend.tf`, `variables.tf`, `main.tf` or one file per
  concern, `outputs.tf`, `.gitignore`, `.terraform.lock.hcl`, `bootstrap/main.tf`,
  `tests/*.tftest.hcl`)
- `docs/aws.md` (new)
- `docs/README.md` (one index row; renumber the rows below it)

Nothing else. In particular: no `AGENTS.md`, no `TODO.md`, no `CHANGELOG.md`, no `docs/oci.md`,
no `docs/vm-image.md`, no `ops/**`, no `.github/**`, no `package.json`, no
`.agent_specs/`.

### Inputs (read-only)

- `AGENTS.md` (stack decisions, host paragraph).
- `docs/oci.md` (§1, §2, §6, §7 — the shape of the sibling stack and the cost language).
- `docs/vm-image.md` (§2, §4 — what the image is and where the AMI comes from).
- `docs/decisions.md` (D20, D21, D33, D37).
- `docs/README.md` as it stands.

## 🔒 Contract

### Module surface

Root module at `infra/aws/`, Terraform `>= 1.10.0` (required for S3 native locking
`use_lockfile`), provider `hashicorp/aws` pinned to a major (`~> 6.0` or the current major you
verify with `terraform init`), and a committed `.terraform.lock.hcl` produced by
`terraform providers lock` on linux_amd64.

Variables (names are the contract; defaults in brackets):

| Variable | Type | Meaning |
| --- | --- | --- |
| `aws_region` | string | Region; `[eu-west-1]`. |
| `admin_cidr` | string | The operator's `/32`; required, no default. `validation` rejects anything that does not end in `/32` and rejects `0.0.0.0/0`. |
| `vpc_cidr` | string | `[10.42.0.0/16]`. |
| `public_subnet_cidr` | string | `[10.42.1.0/24]`. |
| `ami_id` | string | `[""]` — empty means the `data "aws_ami"` lookup below. |
| `instance_type` | string | `[c7g.2xlarge]`; the documented degradation is `c7g.xlarge`. |
| `spot_max_price` | string | `["0.40"]` — the price cap; never empty. |
| `root_volume_gb` | number | `[100]`. |
| `backup_bucket_name` | string | `[cb-codebox-backups]`; overridable because S3 names are global. |
| `budget_limit_usd` | number | `[50]` — monthly budget alarm. |
| `project` | string | `[codebox]` — the tag value. |

Resources, named exactly:

- `aws_vpc` with DNS support/hostnames on; `aws_internet_gateway`; `aws_route_table` with
  `0.0.0.0/0 → igw`; `aws_subnet` with `map_public_ip_on_launch = true`.
- `aws_security_group`: **one** ingress rule, `tcp/22` from `var.admin_cidr`, and **no other
  ingress** — in particular no rule whose CIDR is `0.0.0.0/0`, and nothing on 80 or 443.
  Egress all.
- `data "aws_ami" "ubuntu"`: owner `099720109477`, arm64, `hvm`, name
  `ubuntu/images/hvm-ssd*/ubuntu-noble-24.04-arm64-server-*`, `most_recent = true`. The
  instance uses `var.ami_id == "" ? data.aws_ami.ubuntu.id : var.ami_id` (`coalesce`/`try`
  both fine), so the stack applies before the Codebox image exists (Task-40/46).
- `aws_iam_role` + `aws_iam_instance_profile` + `aws_iam_role_policy_attachment` for
  `arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore`, and one inline
  `aws_iam_role_policy` whose statements touch **only**
  `arn:aws:s3:::<backup_bucket_name>` and `arn:aws:s3:::<backup_bucket_name>/*`
  (`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`,
  `s3:AbortMultipartUpload`). No wildcard resource, no `*` action.
- `aws_instance`: `ami`, `instance_type`, `subnet_id`, the instance profile,
  `metadata_options { http_endpoint = "enabled", http_tokens = "required" }` (IMDSv2),
  `root_block_device { volume_size = var.root_volume_gb, volume_type = "gp3",
  encrypted = true }`, `instance_market_options { market_type = "spot", spot_options {
  max_price = var.spot_max_price, spot_instance_type = "one-time" } }`, and tags.
- `aws_s3_bucket` (`var.backup_bucket_name`), `aws_s3_bucket_versioning = Enabled`,
  `aws_s3_bucket_server_side_encryption_configuration` (AES256), and
  `aws_s3_bucket_lifecycle_configuration` with `expiration { days = 30 }`.
- `aws_budgets_budget`: `COST`, monthly, `limit_amount = var.budget_limit_usd`, with one
  notification at 80 % (email is a variable; skip the subscriber if it is empty).
- Outputs: `instance_id`, `public_ip`, `backup_uri` (`s3://<bucket>`), `security_group_id`.

State:

- `backend.tf` uses `backend "s3"` with `bucket`, `key = "infra/aws/terraform.tfstate"`,
  `region`, `encrypt = true`, `use_lockfile = true` (native S3 locking — **no DynamoDB
  table**). The backend block takes the bucket name from `-backend-config` or a literal; if
  literal, it must match the `bootstrap/` variable default.
- `bootstrap/main.tf`: one file, its own variable `bucket_name`, creates the state bucket with
  versioning and SSE. Run once by a human; it is not wired to the root module's state.
- `.gitignore` ignores `.terraform/`, `*.tfstate`, `*.tfstate.*`, `*.tfplan`, `crash.log`,
  `terraform.tfvars`, `*.auto.tfvars`. `.terraform.lock.hcl` **is committed**.

Test (`tests/stack.tftest.hcl`), `mock_provider "aws"` plus the `mock_data` entries the
`aws_ami`/caller-identity lookups need, `command = plan`, asserting at least:

- the security group has exactly one ingress rule, port 22, `cidr_blocks = [var.admin_cidr]`;
- no ingress rule anywhere contains `0.0.0.0/0`, and none uses port 80 or 443;
- `aws_instance.metadata_options[0].http_tokens == "required"`;
- `aws_instance.instance_market_options[0].market_type == "spot"` and
  `spot_options[0].max_price == var.spot_max_price`;
- the bucket is versioned, AES256-encrypted and expires objects at 30 days;
- the inline policy has no `Resource = "*"` and no `Action = "*"`.

### `docs/aws.md` and the index

New `docs/aws.md` (the reference doc for the sibling host): what the stack creates, the
two-host story (spot now, OCI when capacity lands, D40's one image), the admin `/32` and why
there is no 80/443, the spot shape and the `c7g.xlarge` degradation, state in S3 with native
locking and how to bootstrap it, `terraform plan/apply/destroy` from `infra/aws`, the monthly
budget alarm, and the fact that the Codebox AMI is not required to apply (Canonical default
until Task-40/46). Say plainly that `apply`/`destroy` is `[live]` and needs the AWS account of
L3 (a dedicated IAM user with MFA, no root). No secret, no account id.

`docs/README.md`: insert the `aws.md` row (13, shifting `oci` and the rest by one) and keep
every other row intact.

## 🧩 Configuration

No `CB_*` key. Terraform inputs are build/deploy inputs; do not touch `docs/providers.md`.

## 🧪 Test and Validation Plan (for QA)

Run from the task's integration worktree, verbatim.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `export TF_PLUGIN_CACHE_DIR=/tmp/cb-tf-plugin-cache` (shared, content-addressed; safe for
    parallel agents)
  - `terraform -chdir=infra/aws fmt -check -recursive`
  - `terraform -chdir=infra/aws init -backend=false`
  - `terraform -chdir=infra/aws validate`
  - `terraform -chdir=infra/aws test`
  - `git diff --name-only origin/main...HEAD` — audit against the exclusive paths.
  - `git ls-files infra/aws | grep -E 'tfstate|\.terraform/|tfvars$'` — must print nothing.
- **Acceptance criteria:**
  - [ ] `[unit]` `terraform fmt -check -recursive` exits 0.
  - [ ] `[unit]` `terraform init -backend=false` + `terraform validate` exit 0 (provider
    download from the registry is allowed; no AWS credential is used).
  - [ ] `[unit]` `terraform test` exits 0 and its assertions cover: no `0.0.0.0/0` ingress,
    SSH as one `/32`, IMDSv2 required, spot with a price cap, the bucket with SSE, versioning
    and the 30-day lifecycle.
  - [ ] `[unit]` A second `plan` after `apply` is empty — *not run* without an AWS account;
    state the reason. (The offline proof is the mocked `plan` in `terraform test`.)
  - [ ] `[unit]` `npm run lint`, `npm test` and `npm run build` are green.
  - [ ] `[unit]` No state file, `.terraform/` directory or `terraform.tfvars` is tracked; no
    credential appears in the diff.
  - [ ] `[unit]` No file outside the exclusive paths changed; `docs/README.md` rows after the
    insertion are still numbered without gaps.
  - [ ] `[live]` `terraform apply` creates the stack and `terraform destroy` keeps only the
    bucket. Measurement: on the L3 account, `apply` then `aws ec2 describe-instances` shows
    one running `c7g.2xlarge`, `aws s3 ls` shows the bucket, then `destroy` leaves the bucket
    and no VPC/instance; the second `plan` is empty. **Cannot be measured on GitHub Actions**
    (no AWS account): report `not run`; the Orchestrator opens an `agent-review` issue.

## 📣 Coordination

- For Task-46 (measured bring-up): the outputs are `instance_id`, `public_ip`, `backup_uri`;
  the state backend and the bucket name are stable.
- For Task-40: `ami_id` accepts the packer-built AMI; the default Canonical lookup keeps the
  stack applyable before it exists.
- For Task-47: it writes the `infra/aws/` line in `AGENTS.md`; do not edit that file.
- For the Architect: `docs/aws.md` is the host reference the later runbook (Task-46) extends.

## ⛔ Out of scope

- No `terraform apply`, no AWS credential, no real account id in the tree.
- No Codebox image build, no user-data with a secret, no tunnel.
- No Terraform for OCI (Task-47 owns `infra/oci`), no change to `ops/**`.
- No new npm dependency, no CI workflow (the runner has no `workflows` permission — issue
  #11).

# AWS

`infra/aws/` is the **spot host**: one Terraform root module that creates the whole AWS
footprint Codebox needs when a second, cheaper box is worth having. It is a sibling of the OCI
stack in [`oci.md`](oci.md), not a replacement: the OCI Ampere box stays the Always Free
default, and this stack exists because the same image can run anywhere (D21). Nothing here is
read by the daemon at runtime except the instance identity, exactly like the Oracle box.

The module is protected by D26: a run that touches `infra/**` never auto-merges.

## 1. Inventory

| Resource | Name | Purpose |
| --- | --- | --- |
| VPC | `codebox-vpc` | `10.42.0.0/16`; DNS support and hostnames on. |
| Internet gateway | `codebox-igw` | Outbound internet; no inbound 80/443. |
| Route table | `codebox-rt` | `0.0.0.0/0 → codebox-igw`, associated with the subnet. |
| Subnet | `codebox-subnet` | `10.42.1.0/24`, public, `map_public_ip_on_launch`. |
| Security group | `codebox-sg` | One ingress rule, `tcp/22` from `admin_cidr`; all egress. |
| Instance | `codebox-spot` | `c7g.2xlarge` spot, Ubuntu 24.04 arm64, IMDSv2 required. |
| Root volume | attached | 100 GB `gp3`, encrypted. |
| IAM role + profile | `codebox-role` / `codebox-host` | `AmazonSSMManagedInstanceCore` plus the dump bucket only. |
| Backup bucket | `cb-codebox-backups` | Versioned, AES256, 30-day expiry (D33). |
| Budget | `codebox-monthly` | `COST`/`MONTHLY`, `budget_limit_usd`, alarm at 80 %. |

State bucket `cb-codebox-tfstate` is created once by `bootstrap/` and is deliberately not
managed by the root module (§5).

## 2. Two hosts, one image

The product runs on one box, and which box that is, is an operational choice:

- **Spot now.** `c7g.2xlarge` (8 vCPU, 16 GB, arm64) costs a fraction of on-demand and is
  terminated with two minutes' notice. The box is disposable by construction: SQLite plus git
  refs are the durable state, and the dump bucket below is the copy that survives.
- **OCI when capacity lands.** The Always Free Ampere instance in [`oci.md`](oci.md) remains
  the permanent, free home; the retry chain waits for `OutOfHostCapacity`. When it lands, the
  spot stack is destroyed (or kept for parallel work) and the same image boots there.
- **One image.** `ops/image/` bakes Ubuntu 24.04 arm64 with Packer (D21). `ami_id` exists so
  the Codebox image can replace the Canonical one without touching the rest of the module;
  until that image exists the Canonical lookup keeps the stack applyable (§7).

The two hosts differ only in where the instance comes from. Neither bakes a secret (D20):
the AWS instance gets none from this module, and the bring-up runbook that follows owns how
the daemon's configuration reaches it — a user-data with a secret is out of scope here.

## 3. The single door

The security group has **one** ingress rule: `tcp/22` from `admin_cidr`, the operator's own
`/32`. The variable has no default and two validations: it must parse as a `/32`, and it may
never be `0.0.0.0/0`. Two rules follow from D18:

- **Nothing on 80 or 443.** The daemon binds loopback and is reached through Cloudflare
  Tunnel; a public HTTPS listener would be a second, unmanaged entrance. The lifecycle rule
  is not "add a port when convenient".
- **SSM instead of a bastion.** Session Manager through the instance profile gives a shell
  without opening another port or distributing a key; SSH stays as the break-glass path from
  the operator's address.

`terraform test` asserts all of this offline: exactly one ingress rule, port 22, the admin
`/32`, no `0.0.0.0/0` anywhere and no 80/443 (see `tests/stack.tftest.hcl`).

## 4. Shape and the price cap

| Variable | Default | Meaning |
| --- | --- | --- |
| `instance_type` | `c7g.2xlarge` | 8 vCPU / 16 GB arm64, the same architecture as the OCI box. |
| `spot_max_price` | `"0.40"` | Hourly cap; the request is `one-time`, so a spot reclaim is a terminated box, not a restart. |
| `root_volume_gb` | `100` | `gp3`, encrypted, matching the OCI boot volume. |

The documented degradation is `c7g.xlarge` (4 vCPU / 8 GB): the daemon, OpenCode and one run
fit, two concurrent runs do not (D15 caps at two globally). Change `instance_type` and the cap
together; `spot_max_price` is validated as a decimal and can never be empty, because an empty
cap falls back to the on-demand ceiling. `terraform test` asserts the market type and that
`spot_options.max_price` carries the variable.

## 5. State in S3, native locking

```hcl
backend "s3" {
  bucket       = "cb-codebox-tfstate"
  key          = "infra/aws/terraform.tfstate"
  region       = "eu-west-1"
  encrypt      = true
  use_lockfile = true
}
```

`use_lockfile` is why the module requires Terraform `>= 1.10`: S3 native locking uses a
conditional `PutObject` on `<key>.tflock` instead of a DynamoDB table, so there is no lock
table to create, pay for or forget. State is encrypted at rest, versioned and private like
every other bucket here.

The state bucket cannot create itself, so `bootstrap/` is a one-file root module run once by a
human with administrator rights:

```bash
cd infra/aws/bootstrap
terraform init
terraform plan          # creates one versioned, AES256, private bucket
terraform apply
```

Its `bucket_name` default (`cb-codebox-tfstate`) is the literal in `backend.tf`; change both
together or pass `-backend-config="bucket=..."`. `bootstrap/` has its own local state, which
`.gitignore` keeps out of the tree; the bucket is the durable part. The bucket is not managed
by the root module on purpose: a `destroy` must not be able to delete the state that describes
the destroy, and `prevent_destroy` on it makes that explicit.

## 6. Plan, apply, destroy

Run from `infra/aws` with AWS credentials in the environment (never in a file in this repo):

```bash
terraform init
terraform plan  -var="admin_cidr=<operator-address>/32"
terraform apply -var="admin_cidr=<operator-address>/32"
terraform output instance_id public_ip backup_uri security_group_id
terraform destroy -var="admin_cidr=<operator-address>/32"
```

`admin_cidr` is the only required variable. The useful overrides are
`-var="budget_alert_email=<address>"` (adds the 80 % subscriber),
`-var="backup_bucket_name=<globally-unique-name>"` (S3 names are global) and
`-var="instance_type=c7g.xlarge"` for the degraded shape.

Outputs are the contract for the runbook that follows:

| Output | Used for |
| --- | --- |
| `instance_id` | SSM session, `aws ec2 describe-instances`, spot interruption checks. |
| `public_ip` | The SSH `known_hosts` entry and the first-boot probe. |
| `backup_uri` | `s3://cb-codebox-backups`, the daemon's dump target. |
| `security_group_id` | Auditing that no second ingress rule ever appears. |

A second `plan` after `apply` is empty. That is an offline claim only in the mocked
`terraform test`; against the real account it is a `[live]` measurement (§10).

`destroy` removes the network, the instance, the security group, the budget and the dump
bucket. Two things survive on purpose: the state bucket from §5, which the root module does
not manage, and a dump bucket that still holds objects — `force_destroy = false` makes S3
refuse the delete, so backups are never removed by a stray teardown. Empty it by hand first if
that is really what you want.

## 7. The AMI, and applying before the Codebox image exists

```hcl
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd*/ubuntu-noble-24.04-arm64-server-*"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}
```

`ami_id = ""` (the default) resolves to the newest Canonical Ubuntu 24.04 arm64 image, and the
instance uses `var.ami_id == "" ? data.aws_ami.ubuntu.id : var.ami_id`. The stack therefore
applies today, before `ops/image/` produces a Codebox AMI; the box boots stock Ubuntu and the
runtime arrives the same way it does on the Oracle host — from the release artifact, never
baked with a secret (D21). Once the Packer build exists, pass its AMI id as `ami_id` — no
other change.

The AMI lookup needs `ec2:DescribeImages`; a principal that can apply the rest of the stack
has it. The image is immutable: a new Codebox build is a new AMI id and a replaced instance,
never an in-place patch (D21).

## 8. Backups and the budget alarm

The dump bucket is `aws_s3_bucket` `var.backup_bucket_name` with:

- versioning `Enabled`, so an overwritten dump is recoverable;
- default encryption `AES256` with bucket keys;
- a lifecycle rule `expire-dumps` with `expiration { days = 30 }` (D33);
- public access fully blocked.

The instance role grants exactly two statements: `s3:ListBucket` on the bucket and
`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload` on its objects.
There is no wildcard resource and no wildcard action; `terraform test` decodes the inline
policy and asserts both. Everything else the instance can do comes from
`AmazonSSMManagedInstanceCore`, which is the shell path from §3 and nothing else.

`aws_budgets_budget` is a monthly `COST` budget of `budget_limit_usd` (default 50 USD) with
one notification at 80 % of actual spend. The subscriber is
`budget_alert_email`; an empty value skips the notification rather than failing the plan, so a
fresh stack applies without an address. That address is the only subscriber this module
manages; add more in the AWS console if the alarm must reach a second person.

## 9. Checks

| Check | Where | Fails when |
| --- | --- | --- |
| `terraform fmt -check -recursive` | CI on change | The HCL is not formatted. |
| `terraform init -backend=false && terraform validate` | CI on change | A block or variable is invalid. |
| `terraform test` | CI on change | An ingress rule, IMDSv2, the spot cap, the bucket or the inline policy regressed. |
| `terraform plan` | Before every apply | Anything unexpected, especially a security-group or IAM change. |
| Second `plan` empty | `[live]`, after apply | Drift, or a resource the module cannot round-trip. |

The tests use `mock_provider "aws"`: no credential, no API call, no account. `mock_data` and
one `override_resource` (`override_during = plan`) supply the AMI id and the bucket ARN the
plan-time assertions read, because computed attributes are unknown during a mocked plan.

## 10. What is `[live]`

Everything that needs the account is `[live]` and is **not** measured by CI:

- `terraform apply` on the L3 account (a dedicated IAM user with MFA — never the root
  account) creates the VPC, the instance, the bucket and the budget.
- `aws ec2 describe-instances` shows one `running` `c7g.2xlarge`;
  `aws s3 ls` shows the dump bucket.
- A second `terraform plan` is empty.
- `terraform destroy` removes the VPC, the instance and the security group, and leaves the
  state bucket behind; a dump bucket that still holds objects survives too (§6).

No credential, key or account id belongs in this repository (D37); the account is supplied by
the environment at run time.

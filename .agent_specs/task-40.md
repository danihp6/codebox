# Spec: Task-40 — Second builder: AWS

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** ops.
- **Role:** Dev.
- **Objective:** The single Packer template in `ops/image/codebox.pkr.hcl` gains a second
  `amazon-ebs` source inside the **same** `build` block as `oracle-oci`, so the eight shared
  provisioners bake the same Ubuntu 24.04 arm64 image on either host. The AWS side takes its
  region, subnet, base AMI, build instance type and name/tag from variables; `packer build
  -only` selects one host; no credential is declared in the template or the committed
  var-file. The build-step list becomes a lexicographic discovery of `scripts/*.sh`, so the
  browser step Task-41 adds in this same batch needs no second edit of this template.
- **Environment:** worktree `../wt-cb-40`, branch `task-40`, base `origin/main`.
- **Dependencies:** Task-25 (merged). It produced `ops/image/codebox.pkr.hcl`,
  `ops/image/example.pkrvars.hcl`, `ops/image/test/template.test.mjs` and
  `ops/image/README.md`, all of which this task edits.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path.

- `ops/image/codebox.pkr.hcl`
- `ops/image/example.pkrvars.hcl`
- `ops/image/test/template.test.mjs`
- `ops/image/README.md`

`ops/image/scripts/**` belongs to Task-41 in this batch. Do not touch it. Do not touch `docs/`
(Task-41 owns `docs/vm-image.md`, Task-42 owns `docs/README.md` and `docs/aws.md`, Task-47
owns `docs/oci.md`), `TODO.md`, `CHANGELOG.md`, `AGENTS.md` or `.agent_specs/`.

### Inputs (read-only)

- `docs/vm-image.md` (§2, §3, §4, §8, §9).
- `docs/decisions.md` (D21).
- `ops/image/scripts/**` — read them, do not edit them.
- The four exclusive files as they stand on `origin/main`.

## 🔒 Contract

### Template surface

```hcl
packer {
  required_version = ">= 1.9.0"
  required_plugins {
    oracle = { version = ">= 1.0.2", source = "github.com/hashicorp/oracle" }
    amazon = { version = ">= 1.3.0", source = "github.com/hashicorp/amazon" }
  }
}
```

New variables, all consumed by the `amazon-ebs` source:

| Variable | Type | Default | Meaning |
| --- | --- | --- | --- |
| `aws_region` | string | `eu-west-1` | Region of the build instance and the AMI. |
| `aws_subnet_id` | string | none (required) | Subnet with egress, so the build instance reaches apt and npm. |
| `aws_source_ami` | string | none (optional) | Base Ubuntu 24.04 arm64 AMI. Empty means "resolve it from the Canonical AMI (`data "amazon-ami"` or a documented pin") — the template must work with `-var aws_source_ami=`. |
| `aws_instance_type` | string | `c7g.xlarge` | Build instance; arm64 so the image is arm64 on arm64. |
| `aws_ssh_username` | string | `ubuntu` | Canonical default. |
| `aws_spot_max_price` | string | `""` | Empty means on-demand for the *build* instance. Do not add a spot market block here: Task-42 owns the spot runtime box. |

The names above are the contract: `ops/image/test/template.test.mjs` and `docs/vm-image.md`
are read against them. If one cannot work, say so in the report; do not rename silently.

```hcl
source "amazon-ebs" "codebox" {
  region        = var.aws_region
  subnet_id     = var.aws_subnet_id
  source_ami    = var.aws_source_ami
  instance_type = var.aws_instance_type
  ssh_username  = var.aws_ssh_username
  ami_name      = "cb-image-${var.image_version}-${var.git_sha}"
  tags = {
    Name            = "cb-image-${var.image_version}-${var.git_sha}"
    "codebox:version" = var.image_version
    "codebox:commit"  = var.git_sha
  }
}

build {
  sources = ["source.oracle-oci.codebox", "source.amazon-ebs.codebox"]
  # every provisioner stays exactly once, shared by both sources
}
```

- The `build` block has **one** `sources` list with both sources and **one** copy of every
  provisioner. A second `build` block, or duplicated provisioners, is a failure: the point of
  the task is that the eight steps stay shared.
- `packer build -only=amazon-ebs.codebox ops/image` builds the AMI;
  `-only=oracle-oci.codebox` builds the OCI image. Without `-only`, both are built.
- No credential variable: no `access_key`, `secret_key`, `session_token`, `aws_secret`,
  `vault`, `sensitive = true` or profile with a key. Authentication comes from the ambient AWS
  environment/profile, exactly as OCI uses `oci_config_file`.

### Build-step discovery (required, because Task-41 adds a step in this batch)

Replace the explicit `scripts = [ ... ]` list in the single `provisioner "shell"` block with a
lexicographic discovery of the numbered steps:

```hcl
scripts = [for f in fileset("${path.root}/scripts", "*.sh") : "${path.root}/scripts/${f}"]
```

Verified on Packer 1.16.1: `packer validate` accepts this and the resulting order is
lexicographic (`10-`, `20-`, `30-`, `40-`, `45-`, `50-`, `60-`, `70-`, `90-`). The resolution
is evaluated when the build starts, so a step file added by Task-41 is picked up without
editing this template. Add one sentence above the block saying every `scripts/NN-*.sh` is a
build step and the numeric prefix is the order.

### `example.pkrvars.hcl`

Every new variable gets a dummy value, in the existing aligned style, and the file keeps its
"no credential" property (the test asserts it does not match `/key|secret|token/i`):

```hcl
aws_region         = "eu-west-1"
aws_subnet_id      = "subnet-0123456789abcdef0"
aws_source_ami     = "ami-0123456789abcdef0"
aws_instance_type  = "c7g.xlarge"
aws_ssh_username   = "ubuntu"
```

### Test updates (`ops/image/test/template.test.mjs`)

- `packer init` must install both plugins; `packer validate` (with the throwaway OCI config it
  already generates) must pass against `example.pkrvars.hcl`.
- Assert both sources exist and both are in the one `sources` list.
- Assert there is exactly one `build {` block and the provisioner count is unchanged (one
  `shell` with the scripts list, plus the `file` provisioners).
- Replace the hard-coded eight-script assertion with a discovery assertion: every
  `ops/image/scripts/*.sh` appears in the computed list, in lexicographic order, and every
  `scripts/*.sh` file on disk is matched. Keep the `bash -n` walk.
- Assert the AWS variables are declared, `example.pkrvars.hcl` has a dummy for each, and no
  credential-shaped variable exists.
- Keep the existing secret-pattern walk over `ops/image` and `ops/vm`.

### `ops/image/README.md`

Update the `codebox.pkr.hcl` row to name both builders, and add rows for
`scripts/45-browser.sh` (browser/Playwright step, Task-41 in this batch) and the new variables
in the Build section. **Task-41 does not edit this file**; the row for its script is written
here on purpose, so the map is correct once the batch lands.

## 🧩 Configuration

No `CB_*` key. The Packer variables above are build inputs, not runtime configuration; do not
add them to `docs/providers.md`.

## 🧪 Test and Validation Plan (for QA)

Run from the task's integration worktree, verbatim.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `npx vitest run --project ops ops/image/test/template.test.mjs`
  - `packer fmt -check -recursive ops/image`
  - `packer init ops/image` then `packer validate -var-file=ops/image/example.pkrvars.hcl ops/image`
    (the test generates a throwaway `oci_config_file`; if validating by hand, do the same or
    `packer validate` fails on the missing tenancy config, which is an environment fact, not a
    task failure).
  - `git diff --name-only origin/main...HEAD` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `packer fmt -check -recursive ops/image` exits 0.
  - [ ] `[unit]` `packer init` + `packer validate -var-file=ops/image/example.pkrvars.hcl`
    exits 0 with both plugins installed.
  - [ ] `[unit]` `npx vitest run --project ops ops/image/test/template.test.mjs` is green and
    asserts both sources, one shared build block, the discovery-ordered script list and the
    AWS dummies.
  - [ ] `[unit]` `npm run lint`, `npm test` and `npm run build` are green.
  - [ ] `[unit]` No file outside the four exclusive paths changed.
  - [ ] `[live]` A build (after Task-39's first-boot merge) produces an arm64 AMI whose
    `/etc/codebox/image.json` matches the OCI image built from the same commit. Measurement:
    boot the AMI, read `/etc/codebox/image.json`, compare `version`, `commit`, `node`,
    `opencode` and `cloudflared` with the OCI image from the same `git_sha`; no manual step
    beyond the instance launch. **Cannot be measured on GitHub Actions** (no AWS account, no
    AMI): report it `not run` and name the missing credential; the Orchestrator opens an
    `agent-review` issue.

## 📣 Coordination

- For Task-41: the template discovers `scripts/*.sh` lexicographically; add
  `scripts/45-browser.sh` and it runs between 40 and 50 with no HCL edit.
- For Task-42: the packer-built AMI is referenced by `ami_id`; its default data source keeps
  `infra/aws` applyable before the image exists.
- For the next batch: `docs/vm-image.md` §2 is updated by Task-41 for the new step; this task
  updates only `ops/image/README.md`.

## ⛔ Out of scope

- No `packer build`. Never build an image from CI or a laptop; the build happens on the host.
- No spot market block on the builder, no AWS credential, no DynamoDB, no Terraform.
- No change to an existing build step's content.
- No new npm dependency.

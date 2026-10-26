# Spec: Task-45 — Host-neutral docs and ADRs

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** docs (no code, no configuration, no workflow).
- **Role:** Dev.
- **Objective:** the repository says what is true — **one image, two hosts**. The Packer image is
  provider-neutral Ubuntu 24.04 arm64; the builder and the secret source are per host; both hosts
  are Terraform stacks under `infra/{oci,aws}`; OCI stays the primary target and the AWS spot box
  runs the same image while OCI A1 capacity is pending. A new decision **D42** records that, D20
  and D21 are amended **in place** without renumbering, and every reconciled doc drops the claim
  that the image, the builder or the secret source is OCI-only.
- **Environment:** worktree `../wt-cb-45`, branch `task-45`, base `main`.
- **Dependencies (merged; read them, do not edit them):**
  - Task-39 — `ops/vm/cloud-init.sh` (bundles file first, Vault otherwise) and
    `ops/vm/README.md` (its own accurate description).
  - Task-40 — `ops/image/codebox.pkr.hcl` (both builders), `ops/image/example.pkrvars.hcl`,
    `ops/image/README.md`.
  - Task-42 — `infra/aws/**` and `docs/aws.md` (which already says "Two hosts, one image").
  - Task-43 — `ops/vm/backup.sh` and `restore.sh` (the object store the backup wording in
    `docs/security.md` §8 must attribute per host).
  - Task-47 — `infra/oci/**` and `docs/oci.md`.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `docs/decisions.md`
- `docs/vm-image.md`
- `docs/security.md`
- `docs/architecture.md`
- `docs/operations.md`
- `docs/roadmap.md`
- `AGENTS.md`
- `README.md`

`docs/decisions.md` is a hot file and this task is its **only** holder in the batch. No code,
`package.json`, `TODO.md`, `CHANGELOG.md`, `docs/oci.md`, `docs/aws.md`, `docs/providers.md` or
workflow file is touched.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/oci.md` (the per-host OCI detail — link to it, do not duplicate it)
- `docs/aws.md` (the per-host AWS detail — link to it, do not duplicate it)
- `docs/providers.md` (§2–§11, the `CB_*` table)
- `docs/jobs.md` §15 (the routine cost truth the roadmap currently overstates)
- `ops/vm/cloud-init.sh`, `ops/vm/README.md`
- `ops/image/codebox.pkr.hcl`, `ops/image/example.pkrvars.hcl`, `ops/image/README.md`
- `infra/oci/**`, `infra/aws/**` (existence and module contents only)
- `TODO.md` (read the Task-45 text; **do not edit it**)

## 🔒 Contract

The frozen public surface for this task is the decision record. Paste these rows exactly.

### `docs/decisions.md` — D42 appended after D41, before `## Frozen values`

```
| **D42** | **One image, two hosts.** The image is Ubuntu 24.04 arm64 with **no provider baked in**: the builder and the secret source are per host, and both hosts are Terraform stacks under `infra/{oci,aws}`. The OCI Ampere box stays the primary target; an AWS spot box runs the same image while OCI A1 capacity is pending. | The A1 wait has no date, and OCI-only docs would make the shipped AWS path look unsupported. Keeping the artefact provider-neutral means one rebuild and one release cover both hosts, and a host swap is a stack plus the same first boot. Secrets follow the host: `/etc/codebox/secret-bundles.json` first, OCI Vault only where it exists (D20). The `infra/` split keeps each provider's static resources reviewable on its own; the OCI instance stays with `ops/oci/launch.sh` because no `apply` can wait for capacity. |
```

### `docs/decisions.md` — D20 and D21 amended in place

Replace the two rows' text, keep the IDs, keep the order, add `(amended by D42)`:

```
| **D20** | Secrets live in **the host's own store**: the four bundles in `/etc/codebox/secret-bundles.json` (`0600`, operator-written) when it exists, **OCI Vault** read by the instance principal on OCI otherwise; a `0600` env file is the development fallback. Nothing is baked into the image or user-data (amended by D42). | The image is shareable and rebuildable without carrying credentials, and the same image boots on a host whose identity has no Vault grant. |
| **D21** | The VM image is **one provider-neutral Ubuntu 24.04 arm64 image** built with **Packer** from a per-host source (`oracle-oci`, `amazon-ebs`); **no secrets are baked**. The app is installed from a signed release artifact (amended by D42). | Reproducible images, fast boot, no snowflake instance, and one artefact for both hosts. Details in `docs/vm-image.md`. |
```

Rules:

- D40 (request controls) and D41 (loopback MCP routine tools) are **taken**; the new decision is
  **D42**. Never renumber, never reuse an ID, never delete a row. The backlog's "add D40" is
  stale — D42 is the correction.
- Other decisions (D18, D22, D33, D34, D37, D39) govern the OCI tenancy and stay as written; they
  are provider decisions, not claims that the product is OCI-only. Do not rewrite them.
- No task IDs in these docs (the repository rule: task IDs live only in `TODO.md`).

### Facts the docs must now state (verified in the tree — do not re-derive, do not invent)

| Fact | Evidence to read |
| --- | --- |
| One build block, two sources, one shared provisioner list | `ops/image/codebox.pkr.hcl`: `source "oracle-oci" "codebox"`, `source "amazon-ebs" "codebox"`, `build { sources = ["source.oracle-oci.codebox", "source.amazon-ebs.codebox"] }` |
| `-only` selects the host; one committed var-file carries both hosts' dummies | `ops/image/README.md`, `ops/image/example.pkrvars.hcl` |
| First boot takes `/etc/codebox/secret-bundles.json` when it exists and only then falls back to OCI Vault | `ops/vm/cloud-init.sh` (`secret_bundles=${CB_SECRETS_FILE:-/etc/codebox/secret-bundles.json}`, `if [ -f "$bundles_path" ] … else …`) and `ops/vm/README.md` |
| The bundles file carries `githubAppPrivateKeyBase64`, `sessionSecret`, `tunnelToken`, `providerKeys` | `ops/vm/cloud-init.sh` `read_secrets_file` |
| Both Terraform roots exist | `infra/oci/*.tf` (network, IAM, vault, storage, outputs) and `infra/aws/*.tf` (+ `bootstrap/`) |
| The OCI instance is launched by `ops/oci/launch.sh`, not by Terraform | `infra/oci` has no instance resource; `docs/oci.md` §3 |
| The AWS instance type is `c7g.2xlarge` spot with a 100 GB gp3 volume and the S3 dump bucket | `docs/aws.md` §1, §4, §8 |
| The image bakes no provider CLI or credential | `ops/image/scripts/*` |

### Required edits per file (content, not prose style)

- **`docs/vm-image.md`** — the intro (one image, two hosts, D42); §1 the `Base` row (Ubuntu
  24.04 arm64 with no provider in it; the base id is per host); §2 the template listing comment
  for `codebox.pkr.hcl` (one build block, two sources) and the builder paragraph (two builders,
  `-only` selects, one shared provisioner list; the per-host builder detail is in `docs/oci.md`
  §3 and `docs/aws.md` §7); §3 the build commands for both sources, the variable groups and the
  per-host output (`CB_OCI_IMAGE_ID` / the AMI id); §5 step 2 (the bundles file first, OCI
  Vault otherwise) and the closing sentence about the user-data; §7 (per-host secret source,
  rotation unchanged); §9 the tag sentence (OCI display name and AMI name both carry
  `cb-image-<version>-<sha>`).
- **`docs/security.md`** — §1 the two asset rows that name the secret source and the host; §3 the
  sentence naming the OCI security list; §7 secrets; §8 the `SQLite` and `Backups` rows; §10 the
  idle-reclaim row (OCI idle rule **and** AWS spot reclaim).
- **`docs/architecture.md`** — §1 the host subgraph label and the host→secret-store edge; §4 the
  topology diagram becomes host-neutral (one host, one tunnel, one object store, one boot
  volume) and **one** bullet names both providers' resource names and points to `docs/oci.md`
  §1 and `docs/aws.md` §1 instead of repeating them.
- **`docs/operations.md`** — §2 the first-boot sentence only: `/etc/codebox/secret-bundles.json`
  when the operator delivered it, OCI Vault on OCI otherwise, and a pointer to `docs/aws.md` for
  the spot host.
- **`docs/roadmap.md`** — Phase 4's outcome and exit criterion (a host, either one, from the same
  image); Phase 7's "prompt routines spend the daily cap" (false: a prompt routine is a chat
  turn and the chat path writes no usage row, so it is **not** capped in this release — see
  `docs/jobs.md` §15); the "OCI A1 never yields a slot" row of *What would make us change the
  plan* (the AWS spot host already exists).
- **`AGENTS.md`** — the **Status** paragraph (the daemon, the app, the image and both Terraform
  roots exist; the A1 wait is still open; the backlog is `TODO.md`) and the **Host** bullet under
  *Stack decisions* (per-host builder and secret source, OCI primary, AWS spot while capacity is
  pending, D42). Verify the Repository layout already lists `infra/oci/` and `infra/aws/` — it
  does — and change nothing else there.
- **`README.md`** — the Status block, the `VM` subgraph label in *The shape*, the `Host` row in
  *Decisions at a glance*, and one new row in the Documentation table for `docs/aws.md`.

## 🧩 Configuration

- No `CB_*` key is added, renamed, defaulted or read by this task; `docs/providers.md` is
  **read-only** and must not gain a row.
- No dependency, no code, no workflow.

## 🧪 Test and Validation Plan (for QA)

**Method** — run from the repository root in the worktree:

```bash
npm ci --prefer-offline --no-audit --no-fund
npm run lint
npm test
npm run build
git diff --name-only main...task-45
```

Then the doc checks. Each one prints its own evidence; a failure quote the exact line.

**Acceptance criteria** — all `[unit]`; this task has **no `[live]` criterion** (docs cannot be
measured on a phone or a stream).

- [ ] `[unit]` The four gate commands exit 0 and `git diff --name-only main...task-45` prints
  exactly the eight paths below (order irrelevant):

  ```
  AGENTS.md
  README.md
  docs/architecture.md
  docs/decisions.md
  docs/operations.md
  docs/roadmap.md
  docs/security.md
  docs/vm-image.md
  ```

- [ ] `[unit]` **No doc claims the image, the builder or the secret source is OCI-only.** This
  command must print nothing and exit 1:

  ```bash
  grep -rnE 'OCI platform image|The builder uses the \*\*Oracle OCI\*\* plugin|oracle-oci builder, arm64 shape|reads the four secret bundles from \*\*OCI Vault\*\*|Production secrets come from \*\*OCI Vault\*\*|instance\.env` from Vault|encrypted OCI boot volume|age-encrypted in OCI Object Storage' \
    docs/vm-image.md docs/security.md docs/architecture.md docs/operations.md docs/roadmap.md docs/decisions.md AGENTS.md README.md
  ```

- [ ] `[unit]` **Every remaining host-specific token is on a line that names its host.** This
  command must print nothing:

  ```bash
  grep -nE 'VM\.Standard\.A1\.Flex|cb-vcn|cb-subnet|cb-vault|cb-backups|OutOfHostCapacity|c7g\.2xlarge|Always Free|from Vault|instance principal' \
    docs/vm-image.md docs/security.md docs/architecture.md docs/operations.md docs/roadmap.md AGENTS.md README.md \
    | grep -vE 'OCI|oci\.md|ops/oci|AWS|aws\.md|Oracle|Ampere'
  ```

  `docs/decisions.md` is exempt from this check: its OCI rows record OCI decisions. The new and
  amended rows are checked by the next criterion.

- [ ] `[unit]` **The decision record is intact and D42 exists once.**

  ```bash
  grep -oE '\*\*D[0-9]+\*\*' docs/decisions.md | sort | uniq -d        # no duplicate IDs: no output
  grep -oE '\*\*D[0-9]+\*\*' docs/decisions.md | sed 's/[^0-9]//g' | sort -n | tail -1   # prints 42
  grep -c 'amended by D42' docs/decisions.md                            # prints 2
  grep -c '^| \*\*D42\*\*' docs/decisions.md                            # prints 1
  grep -n 'One image, two hosts' docs/decisions.md                      # one hit, in the D42 row
  ```

- [ ] `[unit]` **The reconciled docs carry the required host-neutral facts.** All of these must
  succeed (each prints a count ≥ 1, or the listed string):

  ```bash
  grep -c 'amazon-ebs' docs/vm-image.md
  grep -c 'oracle-oci' docs/vm-image.md
  grep -c 'secret-bundles.json' docs/vm-image.md docs/security.md docs/operations.md
  grep -c 'AWS' docs/vm-image.md docs/security.md docs/architecture.md docs/operations.md docs/roadmap.md AGENTS.md README.md
  grep -n 'infra/{oci,aws}' docs/decisions.md
  ```

- [ ] `[unit]` **Every `CB_*` in code still appears in `docs/providers.md` — scoped to "no new
  drift", because the tree already contains names that are not daemon config keys.** This task
  changes no code, so both sets must be identical to `main`:

  ```bash
  git grep -hoE 'CB_[A-Z0-9_]+' main -- apps packages ops infra scripts .github | sort -u > /tmp/cb-keys-main.txt
  git grep -hoE 'CB_[A-Z0-9_]+' task-45 -- apps packages ops infra scripts .github | sort -u > /tmp/cb-keys-task.txt
  diff /tmp/cb-keys-main.txt /tmp/cb-keys-task.txt        # no output, exit 0
  comm -23 /tmp/cb-keys-task.txt <(grep -oE 'CB_[A-Z0-9_]+' docs/providers.md | sort -u) > /tmp/cb-keys-undocumented.txt
  wc -l < /tmp/cb-keys-undocumented.txt                   # same number as the main-derived set
  ```

  Expected: the `diff` is empty; the undocumented set is unchanged from `main`. The known
  pre-existing drift is **script-local or ops-input names, not daemon configuration**:
  `CB_SECRETS_FILE`, `CB_SECRETS_PATH`, `CB_SECRETS_DIR`, `CB_VAULT_REGION`,
  `CB_VAULT_*_OCID`, `CB_BACKUP_*`, `CB_S3_*`, `CB_OCI_ATTEMPTS`, `CB_OCI_ATTEMPT_SLEEP`,
  `CB_OCI_THROTTLE_SLEEP`, `CB_OCI_START_DELAY`, `CB_OCI_BUDGET`, `CB_OCI_BOOT_GB`,
  `CB_IMAGE_*`, `CB_INSTANCE_ID`, `CB_BODY`, `CB_TOKEN`, `CB_CREDENTIALS`, `CB_DB`, `CB_SRC`,
  `CB_SQL`, `CB_FILE`, `CB_ARCHIVE`, `CB_HASH`, `CB_OBJECT_KEY`, `CB_CREATED_AT`, `CB_DB_BYTES`,
  `CB_ENCRYPTED`, `CB_MANIFEST`. **`docs/providers.md` must not gain or lose a row in this
  task.** If the dev edits any file under `apps/`, `packages/`, `ops/`, `infra/`, `scripts/` or
  `.github/`, this task has failed its scope.

- [ ] `[unit]` **Internal markdown links resolve.** This must print `links ok in 8 files` and
  exit 0:

  ```bash
  node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { dirname, resolve } from "node:path";
  import { execFileSync } from "node:child_process";
  const files = execFileSync("git", ["diff", "--name-only", "main...task-45", "--", "*.md"], { encoding: "utf8" })
    .split("\n").filter(Boolean);
  const broken = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1].split("#")[0].split("?")[0];
      if (target === "" || /^(https?:|mailto:)/.test(target) || target.endsWith("/")) continue;
      try { readFileSync(resolve(dirname(file), target)); }
      catch { broken.push(`${file} -> ${target}`); }
    }
  }
  if (broken.length > 0) { for (const line of broken) console.log(`BROKEN ${line}`); process.exit(1); }
  console.log(`links ok in ${files.length} files`);
  '
  ```

- [ ] `[unit]` **The docs describe shipped reality, not intentions.** These inventory greps must
  match the numbers shown:

  ```bash
  grep -c '/etc/codebox/secret-bundles.json' ops/vm/cloud-init.sh          # 1
  grep -c 'source "oracle-oci" "codebox"' ops/image/codebox.pkr.hcl        # 1
  grep -c 'source "amazon-ebs" "codebox"' ops/image/codebox.pkr.hcl        # 1
  test -d infra/oci && test -d infra/aws && echo both-stacks              # both-stacks
  ```

## 📣 Coordination

- **For the Architect:** the backlog says "add D40", but **D40 and D41 are taken** (request
  controls; loopback MCP routine tools). The new decision is **D42**; `TODO.md` should say so on
  its next tick. The brief's section list for `docs/security.md` was §7/§8 and for
  `docs/operations.md` §2; this spec additionally allows a one-line attribution in
  `docs/security.md` §1 (the asset row that says "rendered from Vault") and §10 (the
  idle-reclaim risk, which gains the spot-reclaim counterpart), because the acceptance criterion
  "every remaining OCI-only statement is attributed" cannot pass otherwise. No other section of
  those files moves.
- **For the next batch (measured bring-up):** nothing in this task was measured on a real host.
  Do not upgrade any `[live]` criterion of the AWS bring-up because these docs now describe it;
  `docs/aws.md` §10 still owns what `[live]` means there.
- **For whoever owns the image next:** `ops/vm/cloud-init.sh`'s Vault fallback shells out to
  `oci secrets secret-bundle get`, and no script under `ops/image/scripts/` installs the OCI CLI.
  This task documents the fallback as the OCI path and must not claim the CLI is baked. Fixing
  the image is a separate task, not this one.
- **For QA:** this task changes no code, so `npm test` and `npm run build` prove only that the
  tree still gates; the doc checks above are the real acceptance. A pre-existing broken link in
  one of the eight files is this task's to fix (the file is claimed); a broken link in any other
  file is reported, not fixed.

## ⛔ Out of scope

- No code, no `CB_*` change, no `docs/providers.md` row, no dependency, no workflow.
- No edit to `docs/oci.md` or `docs/aws.md`: the per-host detail stays there and is linked, never
  duplicated.
- No new migration section, no new document, no diagram rework beyond the host label and the
  host-neutral secret edge in `docs/architecture.md`.
- No renumbering, deletion or rewriting of decisions other than D20/D21 (amended) and D42 (new).
- No `TODO.md`, `CHANGELOG.md` or `CHANGELOG` entry — the Orchestrator owns the tick.
- No claim that a host was launched, applied or measured; that is the bring-up task.

## 📋 Report shape (return exactly this)

```
tip: <git rev-parse HEAD>
commands:
  npm ci --prefer-offline --no-audit --no-fund   exit <n>
  npm run lint                                  exit <n>
  npm test                                      exit <n>
  npm run build                                 exit <n>
  <each doc check command>                      exit <n> / output <one line>
criteria:
  [unit] <criterion> — pass/fail (<evidence>)
  ...
files: <git diff --name-only main...task-45, one per line>
deviations: <none, or each one with the reason and who must confirm>
```

# Spec: Task-25 — VM image

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** ops.
- **Role:** Dev.
- **Objective:** make the box reproducible from the repository: a Packer template that bakes
  Ubuntu 24.04 arm64 with Node 24, the CLI tools, `opencode`, `cloudflared`, the `codebox`
  service user and the systemd units; a cloud-init first boot that gives the fresh instance
  its identity and its secrets from OCI Vault without baking either; and the four host
  commands the runbook uses — `install.sh`, `upgrade.sh`, `backup.sh`, `restore.sh` — all
  runnable headless against a temporary root, with no secret in the image, in user-data or in
  the templates.
- **Environment:** worktree `../wt-cb-25`, branch `task-25`, base `main`.
- **Dependencies:** Task-24 (merged): `ops/oci/provision.sh --with-vault` creates `cb-vault`
  with the four secret names `cb-github-app`, `cb-session-secret`, `cb-tunnel-token` and
  `cb-provider-keys` (`docs/oci.md` §1, §3). Task-11 is in this batch but is **not** a
  dependency: nothing here imports daemon code, and the health URL is a configuration value.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path.

- `ops/image/codebox.pkr.hcl`
- `ops/image/example.pkrvars.hcl`
- `ops/image/http/cloud-init.yaml`
- `ops/image/scripts/10-base.sh`
- `ops/image/scripts/20-node.sh`
- `ops/image/scripts/30-tools.sh`
- `ops/image/scripts/40-opencode.sh`
- `ops/image/scripts/50-cloudflared.sh`
- `ops/image/scripts/60-service.sh`
- `ops/image/scripts/70-harden.sh`
- `ops/image/scripts/90-verify.sh`
- `ops/image/README.md`
- `ops/image/test/template.test.mjs`
- `ops/image/test/cloud-init.test.mjs`
- `ops/vm/lib.sh`
- `ops/vm/cloud-init.sh`
- `ops/vm/install.sh`
- `ops/vm/upgrade.sh`
- `ops/vm/backup.sh`
- `ops/vm/restore.sh`
- `ops/vm/systemd/codebox.service`
- `ops/vm/systemd/codebox-opencode.service`
- `ops/vm/systemd/cloudflared.service`
- `ops/vm/systemd/codebox-backup.service`
- `ops/vm/systemd/codebox-backup.timer`
- `ops/vm/README.md`
- `ops/vm/test/install.test.mjs`
- `ops/vm/test/upgrade.test.mjs`
- `ops/vm/test/backup.test.mjs`
- `ops/vm/test/restore.test.mjs`
- `ops/vm/test/cloud-init.test.mjs`
- `ops/vm/test/verify.test.mjs`
- `docs/vm-image.md` — whole file.
- `docs/operations.md` — **sections §2 Install and §4 Upgrade and rollback only.** §1 Layout,
  §3, §5 and later belong to other owners; do not touch them.

No `package.json`, no lockfile and no dependency: the tests are plain `.mjs` and run through
the `ops` project already declared in `vitest.config.ts` (`root: ./ops`, include
`**/test/**/*.test.mjs`).

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/vm-image.md`, `docs/operations.md`, `docs/oci.md` (§1, §2, §3), `docs/security.md`
  §"secrets" table and the `instance.env` paragraph, `docs/providers.md` §14–§15,
  `docs/agent-vm.md` §1 (the product/pipeline split).
- `ops/oci/launch.sh`, `ops/oci/provision.sh`, `ops/oci/README.md` — style, the `need` helper,
  the `error: <VAR> is empty` convention and the fixture-binary test pattern.
- `ops/oci/test/launch.test.mjs`, `ops/oci/test/provision.test.mjs` — the test conventions
  (temporary directory, fake binary first on `PATH`, assert the recorded arguments).
- `scripts/agent/vm/README.md`, `scripts/agent/vm/install.sh`, `scripts/agent/vm/cb-agent.service.in`
  — the pipeline's own install and unit. Read to avoid duplicating it; do not edit it.
- `vitest.config.ts`, `eslint.config.js`, `tsconfig.base.json`, `.prettierrc.json`.

## 🔒 Contract

Every script is `#!/usr/bin/env bash` + `set -euo pipefail`, passes `bash -n` and
`shellcheck -S warning -x`, writes diagnostics to **stderr** as `codebox: <message>` (no
timestamp, so a test can assert on it) and its machine-readable result to **stdout**.

### Shared conventions (`ops/vm/lib.sh`, sourced)

```bash
# Sourced, never executed.
ROOT=/            # prefix for every filesystem path; set by --root
die CODE MESSAGE  # "codebox: error: MESSAGE" on stderr, exit CODE
log MESSAGE       # "codebox: MESSAGE" on stderr
rooted PATH       # "${ROOT%/}${PATH}"  (ROOT=/ -> the path itself)
need VAR...       # an empty variable -> "codebox: error: VAR is empty", exit 2
need_bin NAME...  # a missing command -> "codebox: error: NAME is not installed", exit 2
usage TEXT        # prints TEXT to stdout, exit 0  (for --help)
```

Exit codes, identical in every script: `0` success, `2` usage or a missing input, `3`
checksum mismatch, `4` unhealthy after a restart, `5` no previous release, `6` bad archive or
bad database. Nothing exits `1` on purpose.

### `ops/vm/install.sh`

```
usage: install.sh --artifact FILE --version V --sha256 HEX
                  [--root DIR] [--no-restart]
                  [--health-url URL] [--health-timeout SECONDS] [--help]
```

- Defaults: `--root /`, `--health-url http://127.0.0.1:8787/v1/health`, `--health-timeout 60`.
  `--root` also implies `--no-restart` is *not* automatic: a caller that passes `--root`
  without `--no-restart` still tries `systemctl` and fails; QA always passes `--no-restart`.
- Steps, in order:
  1. `need` the three required flags; anything else → exit 2 with the usage line.
  2. `sha256sum "$artifact"` != `$sha256` → `error: checksum mismatch: <actual> != <expected>`,
     exit 3, **nothing created**.
  3. `release="$(rooted /opt/codebox/releases)/$version"`, `mkdir -p "$release"`.
  4. Already installed (the directory exists and contains `apps/daemon/dist/main.js`) →
     `log "reuse $release"`, skip the unpack **and** the symlink step, go to step 7.
  5. `tar -xzf "$artifact" -C "$release"` (strip nothing: the archive is unpacked as-is); then
     `-f "$release/apps/daemon/dist/main.js"` or `rm -rf "$release"` +
     `error: artifact has no apps/daemon/dist/main.js`, exit 6.
  6. If `$(rooted /opt/codebox)/current` exists, point
     `$(rooted /opt/codebox)/previous` at its target (`ln -sfn "$(readlink current)" previous`).
     Then `ln -sfn "releases/$version" current` — a **relative** link, so the root can be moved.
  7. Print `installed <version> <release>` on stdout. With `--no-restart`, exit 0 here.
  8. `systemctl daemon-reload && systemctl restart codebox.service`, then poll
     `--health-url` up to `--health-timeout` seconds (one request per second, any HTTP status
     below 600 is a live daemon). No answer in time → restore `current` from `previous`,
     `systemctl restart codebox.service`, `error: unhealthy after restart`, exit 4.
- The installer never writes the database, never reads `instance.env` and never prints a
  secret. Migrations are applied by the daemon at boot (`openStore` already runs them); the
  `docs/operations.md` §2 sentence that says the installer applies them is corrected in this
  task.

### `ops/vm/upgrade.sh`

```
usage: upgrade.sh (--artifact FILE --version V --sha256 HEX | --rollback)
                  [--root DIR] [--no-restart] [--prune] [--help]
```

- Without `--rollback`: executes `install.sh` with the same `--root` and `--no-restart`.
- `--rollback`: `previous="$(rooted /opt/codebox)/previous"`; missing or dangling →
  `error: no previous release`, exit 5. Otherwise swap: the current target becomes
  `previous`, `current` becomes the old `previous`. It prints `rolled back to <version>` where
  `<version>` is the directory name the link points into. Two rollbacks in a row return to the
  release that was abandoned.
- `--prune`: keep the two newest directories under `releases/` (sorted by version, then by
  name) and `rm -rf` the rest, one `prune <path>` line each. Runs after a successful upgrade.
- It never touches `/etc/codebox`, the database or a secret.

### `ops/vm/backup.sh`

```
usage: backup.sh [--db FILE] [--out DIR] [--recipient AGE_RECIPIENT] [--plaintext]
                 [--verify] [--upload] [--root DIR] [--help]
```

- Defaults: `--db $(rooted /var/lib/codebox)/state.db`,
  `--out $(rooted /var/lib/codebox)/backups`, recipient from `CB_BACKUP_AGE_RECIPIENT`.
- `--verify`: open the newest archive instead of writing one; print
  `verify ok runs=<n> jobs=<n> routines=<n>` and exit 0, or exit 6.
- A backup:
  1. `need_bin node tar`; a missing `--db` → `error: no database at <path>`, exit 6.
  2. A consistent snapshot through `node:sqlite`, never a file copy. `VACUUM INTO` needs the
     destination as a SQL literal, so the literal is built by `sed` and travels in the
     environment; the script itself has no nested quoting:
     ```bash
     CB_SRC="$db" \
     CB_SQL="VACUUM INTO '$(printf '%s' "$tmp/state.db" | sed "s/'/''/g")'" \
     node --input-type=module -e '
       import { DatabaseSync } from "node:sqlite";
       const db = new DatabaseSync(process.env.CB_SRC);
       db.exec(process.env.CB_SQL);
       db.close();
     '
     ```
     A snapshot failure → `error: cannot snapshot <path>`, exit 6, no archive.
  3. Two extra members: `manifest.json` = `{"version":<the string in
     <root>/etc/codebox/image.json ".version", or null>,"createdAt":"<RFC3339>","dbBytes":<n>,
     "encrypted":<bool>}` and `instance.env` = `$(rooted /etc/codebox)/instance.env` with every
     assignment that names a key in `SECRET_CONFIG_KEYS` replaced by `KEY=[redacted]`
     (`docs/security.md`: a backup carries the config, never the credentials).
  4. `tar -czf "$tmp/archive.tar.gz" -C "$tmp" state.db manifest.json instance.env`.
  5. Encrypt unless `--plaintext`: `age -r "$recipient" -o "$archive" "$tmp/archive.tar.gz"`.
     `--plaintext` logs `warn: plaintext backup` and keeps `.tar.gz`.
  6. Archive name `cb-backup-<UTC YYYYMMDDTHHMMSSZ>.age` (or `.tar.gz`); prints
     `archive <absolute path>` on stdout.
  7. `--upload`: `need --recipient` (an encrypted archive), `need_bin oci`,
     `oci os object put --bucket-name "${CB_BACKUP_BUCKET:-cb-backups}" --file "$archive"
     --name "db/<Y>/<M>/<D>.age" --force`, then `log "uploaded db/<Y>/<M>/<D>.age"`.
- The age private key never exists on the box; `restore.sh` takes an identity file supplied by
  the operator.

### `ops/vm/restore.sh`

```
usage: restore.sh --from ARCHIVE [--db FILE] [--identity FILE] [--plaintext] [--force]
                  [--verify] [--root DIR] [--help]
```

- Defaults: `--db $(rooted /var/lib/codebox)/state.db`. `--identity` defaults to
  `CB_BACKUP_AGE_IDENTITY`.
- Refuses to overwrite an existing database without `--force` → `error: <path> exists, use
  --force`, exit 2, touched nothing.
- Decrypts (`age -d -i "$identity"` unless `--plaintext`), extracts to a temporary directory,
  runs the same `--verify` row counts as `backup.sh`, and only then moves `state.db` into
  place with `install -m 0640 -o codebox -g codebox` (skipped under a non-root `--root`).
  A corrupt archive or a missing `state.db` inside it → exit 6, the target untouched.
- Prints `restored <db> runs=<n> jobs=<n> routines=<n>`.
- The daemon is expected to be stopped; the script never starts or stops a unit.

### `ops/vm/cloud-init.sh`

```
usage: cloud-init.sh [--root DIR] [--no-services] [--instance-id ID]
                     [--health-url URL] [--health-timeout SECONDS] [--help]
```

Inputs from the environment (all `need`ed unless stated): `CB_VAULT_REGION` (or
`OCI_CLI_REGION`), `CB_INSTANCE_NAME` (default `cb-instance`), `CB_PUBLIC_URL`,
`CB_VAULT_GITHUB_APP_SECRET_OCID`, `CB_VAULT_SESSION_SECRET_OCID`,
`CB_VAULT_TUNNEL_TOKEN_OCID`, `CB_VAULT_PROVIDER_KEYS_OCID`. The instance id comes from
`--instance-id` or from the instance metadata service
(`curl -fsS -H 'Authorization: Bearer Oracle' http://169.254.169.254/opc/v2/instance/id`).

Each Vault read is exactly
`oci secrets secret-bundle get --region "$CB_VAULT_REGION" --secret-id "$ocid" --query 'data."secret-bundle-content".content' --raw-output`,
whose answer is base64 and is decoded with `base64 -d`. The script calls it **once per
secret**, four times, and nothing else calls `oci`. That shape is what the test's fixture
binary implements (`ops/vm/test/cloud-init.test.mjs`: a temporary `oci` first on `PATH` that
prints a fixed base64 bundle — a tunnel token JSON
`{"a":"acct","t":"11111111-2222-3333-4444-555555555555","s":"tunnel-secret-value"}` — and
appends `"$*"` to `$CB_FAKE_OCI_LOG`), exactly the pattern `ops/oci/test/launch.test.mjs`
uses.

Writes, all idempotent:

| Path | Mode | Content |
| --- | --- | --- |
| `<root>/etc/hostname` | 0644 | `cb-<last 8 characters of the instance id, lowercased>` (`ocid1.instance.oc1..ABCDEF12` → `cb-abcdef12`) |
| `<root>/etc/hosts` | 0644 | appends `127.0.1.1 <hostname>` **only if the line is absent** |
| `<root>/etc/codebox/instance.env` | 0600 `root:codebox` | the sorted `KEY=VALUE` list below, no timestamp |
| `<root>/etc/cloudflared/config.yml` | 0640 `root:codebox` | `tunnel: <uuid>` + `credentials-file: /etc/cloudflared/<uuid>.json` |
| `<root>/etc/cloudflared/<uuid>.json` | 0600 `root:root` | `{"AccountTag","TunnelSecret","TunnelID"}`, decoded from the token |
| `<root>/var/lib/codebox/first-boot.jsonl` | 0640 `codebox:codebox` | one line appended per run |

`instance.env` keys, always in this order and always without a value leak:
`CB_ENV=production`, `CB_INSTANCE_NAME`, `CB_PUBLIC_URL`, `CB_GITHUB_APP_PRIVATE_KEY_BASE64`,
`CB_SESSION_SECRET`, `CB_TUNNEL_TOKEN`, then one line per provider key from the
`cb-provider-keys` bundle (verbatim, in the order the bundle lists them). Nothing else: a
`CB_*` key that is not in `packages/contracts/src/config.ts` makes the daemon refuse to boot.

`first-boot.jsonl` line: `{"ts":"<RFC3339>","instance":"<hostname>","result":"ok"}`, or on
failure `{"ts":…,"instance":…,"result":"failed","step":"<name>","message":"…"}`; a failed step
makes the script exit non-zero and never leaves a partially written `instance.env`
(write to `instance.env.tmp`, `install` into place last).

`--no-services` skips every `systemctl` call and the health wait, which is what a test uses.
With services: `systemctl daemon-reload`, `systemctl start codebox-opencode.service` (the
opencode unit has no `[Install]`, so it is started, not enabled), then
`codebox.service`, then `cloudflared.service`, then poll `--health-url`
(default `http://127.0.0.1:8787/v1/health`) up to `--health-timeout` (default 120) seconds for
any HTTP answer below 600, and log `first boot ok instance=<name> status=<status>` — the
daemon answers `200` for `ok|degraded` and `503` for `down`; any of the three proves it is up.
No answer → one `first boot failed` line and exit 4.

The script never prints a secret value on stdout or stderr; the only values it echoes are
paths, the hostname and the health status.

### `ops/image/scripts/90-verify.sh`

```
usage: 90-verify.sh [--root DIR] [--only CHECK] [--help]
checks: runtime tools units user layout secrets image   (default: all)
```

One line per check on stdout: `ok <check>` or `fail <check> <detail>`; exit 1 if any failed.
`--root` prefixes every path (default `/`).

- `runtime`: `node --version` starts `v24.`, `npm --version`, `corepack --version`.
- `tools`: `git`, `gh`, `sqlite3`, `age`, `jq`, `cloudflared`, `opencode` each answer
  `--version`.
- `units`: `systemctl is-enabled --quiet` for all five unit files (`codebox.service`,
  `codebox-opencode.service`, `cloudflared.service`, `codebox-backup.service`,
  `codebox-backup.timer`) and `systemd-analyze verify` on all five is clean.
- `user`: `id codebox`, its shell is not a login shell, and `passwd -S codebox` reports
  `L`/`NP`.
- `layout`: `<root>/opt/codebox` is absent or empty (the release is installed from the
  artifact, never baked).
- `secrets`: grep `<root>/etc`, `<root>/opt`, `<root>/var/lib` for the literal patterns
  `ghp_`, `ghs_`, `gho_`, `ghu_`, `github_pat_`, `-----BEGIN`, `cf-tunnel`, `sk-`, `xoxb-`,
  `AKIA`. A hit prints `fail secrets <path>:<pattern>`; a missing directory is skipped.
- `image`: `<root>/etc/codebox/image.json` parses, has `version`, `commit`, `builtAt`, `node`,
  `opencode`, `cloudflared`, and `<root>/etc/codebox` contains no file with a value that is
  not a placeholder (every `KEY=` line is empty or `[redacted]`).

`--only secrets` is the one mode a test runs, because every other check needs the image.

### `ops/vm/systemd/*`

| Unit | Contract |
| --- | --- |
| `codebox.service` | `User=codebox`, `Group=codebox`, `EnvironmentFile=/etc/codebox/instance.env`, `ExecStart=/usr/bin/env node /opt/codebox/current/apps/daemon/dist/main.js`, `Restart=on-failure`, `RestartSec=5`, `TimeoutStopSec=30`, `After=network-online.target codebox-opencode.service`, `WantedBy=multi-user.target` |
| `codebox-opencode.service` | `User=codebox`, the OpenCode server on `127.0.0.1:4096` only, `Restart=on-failure`; the daemon may own the child instead, so the unit does **not** start by default (`[Install]` omitted, no `WantedBy`) |
| `cloudflared.service` | `User=codebox`, `EnvironmentFile=/etc/codebox/instance.env`, `ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel --config /etc/cloudflared/config.yml run`, `Restart=on-failure`, `WantedBy=multi-user.target` |
| `codebox-backup.service` | `Type=oneshot`, `User=codebox`, `ExecStart=/usr/local/lib/codebox/backup.sh --upload` |
| `codebox-backup.timer` | `OnCalendar=*-*-* 03:20:00`, `Persistent=true`, `WantedBy=timers.target` |

Every unit carries `NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`,
`PrivateTmp=true`, `ReadWritePaths=/var/lib/codebox /srv/codebox` — the block
`docs/providers.md` §14 prints verbatim. Task-28 hardens them further by editing these files.

### `ops/image/codebox.pkr.hcl`

- One `packer` block requiring `oracle` (`>= 1.0.2`) from `github.com/hashicorp/oracle`.
- One `source "oracle-oci" "codebox"` with: `shape = "VM.Standard.A1.Flex"`,
  `shape_config { ocpus = 2, memory_in_gbs = 12 }` (the free tier, `docs/oci.md` §6),
  `base_image_ocid`, `compartment_ocid`, `subnet_ocid`, `availability_domain`,
  `image_name = "cb-image-${var.image_version}-${var.git_sha}"`,
  `ssh_username = "ubuntu"`, a 100 GB boot volume, and
  `scripts = ["scripts/10-base.sh", …]` in numeric order (10, 20, 30, 40, 50, 60, 70, 90) —
  every path must exist.
- Variables: `compartment_ocid`, `subnet_ocid`, `availability_domain`, `base_image_ocid`,
  `image_version`, `git_sha` (required); `node_version` (default `24.22.1`),
  `opencode_version` (default `1.19.4`), `cloudflared_channel` (default `stable`) with
  defaults. Each required variable is `type = string` with a `description` and no default, so
  `packer validate` without a var-file fails and with one passes.
- `provisioner "shell"` steps pass `environment_vars` only:
  `CB_IMAGE_VERSION`, `CB_IMAGE_COMMIT`, `CB_IMAGE_BUILT_AT = "{{timestamp}}"`, `NODE_VERSION`,
  `OPENCODE_VERSION`. No file provisioner carries a secret; there is no `sensitive` variable
  and no `env` inherited from the operator.
- `ops/image/example.pkrvars.hcl` holds **dummy** OCIDs (`ocid1.compartment.oc1..example`),
  `availability_domain = "AD-1"`, an example base image OCID, `image_version = "0.1.0"` and
  `git_sha = "0000000"`. It is committed; a real `prod.pkrvars.hcl` is local and never
  committed, and `docs/vm-image.md` §3 says so.
- `ops/image/http/cloud-init.yaml` starts with `#cloud-config`, sets `hostname` from
  `CB_INSTANCE_NAME`'s template variable, installs `cloud-init` ordering, and its only
  `runcmd` entry is `[bash, /usr/local/lib/codebox/cloud-init.sh]`. No `ssh_authorized_keys`
  value, no `password`, no `write_files` content that is not a placeholder: the secrets come
  from Vault at first boot.

### Data

| Key | Where | Value |
| --- | --- | --- |
| `/usr/local/lib/codebox/*.sh` | `60-service.sh` | `lib.sh`, `cloud-init.sh`, `install.sh`, `upgrade.sh`, `backup.sh`, `restore.sh`, `90-verify.sh`; 0750 `root:root` |
| `/opt/codebox/releases/<version>` | `install.sh` | one unpacked artifact |
| `/opt/codebox/current` | `install.sh` | relative symlink `releases/<version>` |
| `/opt/codebox/previous` | `install.sh`, `upgrade.sh` | relative symlink, the rollback target |
| `/etc/codebox/image.json` | `60-service.sh` | `{version, commit, builtAt, node, opencode, cloudflared}` |
| `/etc/codebox/instance.env` | `cloud-init.sh` | 0600 `root:codebox`, `docs/security.md` §secrets |
| `/var/lib/codebox/first-boot.jsonl` | `cloud-init.sh` | one line per boot, `result` `ok` or `failed` |
| `/var/lib/codebox/backups/cb-backup-<stamp>.age` | `backup.sh` | the encrypted archive |
| `CB_BACKUP_BUCKET` | `backup.sh --upload` | default `cb-backups`; object `db/<Y>/<M>/<D>.age` |
| `CB_BACKUP_AGE_RECIPIENT` | `backup.sh` | age recipient; empty and no `--plaintext` → exit 2 |
| `CB_BACKUP_AGE_IDENTITY` | `restore.sh` | age identity file; empty and no `--plaintext` → exit 2 |

## 🧩 Configuration

This task adds **no** `CB_*` key to the daemon: `packages/contracts/src/config.ts` is a
`z.strictObject` and is not in this task's paths. The names above (`CB_BACKUP_*`,
`CB_VAULT_*`, `CB_IMAGE_*`) are host and build variables, not daemon configuration, and they
live only in `ops/vm/**`, `ops/image/**` and their READMEs — never in `instance.env`, never in
a unit's `EnvironmentFile`.

| Variable | Default | Failure |
| --- | --- | --- |
| `CB_VAULT_REGION` | `OCI_CLI_REGION` | empty → `CB_VAULT_REGION is empty`, exit 2 |
| `CB_VAULT_*_OCID` (4) | — | empty → `error: <VAR> is empty`, exit 2 |
| `CB_INSTANCE_NAME` | `cb-instance` | — |
| `CB_PUBLIC_URL` | — | empty → exit 2 (it is written into `instance.env`) |
| `CB_BACKUP_AGE_RECIPIENT` | — | empty without `--plaintext` → exit 2 |
| `CB_BACKUP_BUCKET` | `cb-backups` | — |
| `CB_BACKUP_AGE_IDENTITY` | — | empty without `--plaintext` → exit 2 |
| `NODE_VERSION` | `24.22.1` | empty → exit 2 (image build) |
| `OPENCODE_VERSION` | `1.19.4` | empty → exit 2 (image build) |

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing
else is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass. `eslint .` lints the `.mjs` tests too.
  - `npm test` — Vitest, headless; `npx vitest run --project ops` runs this task's tests alone.
  - `npm run build` — must stay green (this task adds no TypeScript).
  - `npx playwright test` — not applicable.
  - `git diff --name-only main...task-25` — audit against the exclusive paths.
  - `bash -n ops/vm/*.sh ops/image/scripts/*.sh ops/image/http/cloud-init.yaml` is **not** run
    on the YAML; use `bash -n` on the `.sh` files only.
  - Nothing here needs a real OCI tenancy, a Vault, a Packer build, `/var/lib/codebox`,
    `/etc/codebox/instance.env`, `codebox.service` or a real credential. Any test that needs a
    binary the runner does not have (packer, shellcheck, cloud-init, age) **skips with the
    reason recorded**; it never fails for its absence, because the runner is not the image.

- **Acceptance criteria:** every one tagged **`[unit]`** (a headless command, a decoded value,
  a pinned number) or **`[live]`** (only exists in the running system: a stream, a push, a
  tunnel, a UI state). A `[live]` criterion states its **measurement** — what to read, on which
  surface, against which bound.

  - [ ] `[unit]` It lints, tests and builds clean: `npm run lint && npm test && npm run build`
        exits 0.
  - [ ] `[unit]` The declared tests exist and pass: `npx vitest run --project ops` reports at
        least eight test files under `ops/image/test/` and `ops/vm/test/`, none skipped for a
        reason other than a missing host binary.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-25 | grep -v '^\.agent_specs/'` lists only paths
        from the list above. `.agent_specs/task-25.md` is excluded: the pipeline force-adds
        the spec and strips it in the merge.
  - [ ] `[unit]` **`packer validate` passes.** Command:
        `packer init ops/image && packer validate -var-file=ops/image/example.pkrvars.hcl ops/image`.
        Expected: `packer init` installs `github.com/hashicorp/oracle`, `packer validate`
        prints `The configuration is valid.` and exits 0. **Degradation:** `packer init` needs
        the plugin registry. If it fails for lack of network, record the literal error, run
        `packer fmt -check -recursive ops/image` instead (HCL2 syntax without a plugin) and
        report the criterion `not run` — the Orchestrator opens an `agent-review` issue; the
        merge does not wait.
  - [ ] `[unit]` **A grep of the built image's `/etc` and `/opt` finds no token pattern.**
        There is no built image on this host, so the same checker the build runs is executed
        against a stub root, two-sided:
        ```bash
        T=$(mktemp -d); mkdir -p "$T/etc/codebox" "$T/opt"
        printf 'CB_SESSION_SECRET=[redacted]\n' > "$T/etc/codebox/instance.env"
        bash ops/image/scripts/90-verify.sh --root "$T" --only secrets; echo "clean=$?"
        printf 'helper --token ghp_AAAABBBBCCCC\n' > "$T/etc/leak.txt"
        bash ops/image/scripts/90-verify.sh --root "$T" --only secrets; echo "leak=$?"
        ```
        Expected: `clean=0` with `ok secrets`; `leak=1` with `fail secrets <path>/etc/leak.txt:ghp_`.
        `ops/image/test/template.test.mjs` additionally greps every file this task adds for
        the same ten patterns and fails on a hit, so the templates cannot carry a credential.
  - [ ] `[unit]` **Cloud-init is idempotent on a second boot.** Command:
        `npx vitest run --project ops -t 'cloud-init idempotency'` (file
        `ops/vm/test/cloud-init.test.mjs`). The test runs `ops/vm/cloud-init.sh` twice against
        the **same** temporary `--root`, with `--no-services`, a fixed `--instance-id
        ocid1.instance.oc1..ABCDEF12`, `CB_INSTANCE_NAME=cb-test`,
        `CB_PUBLIC_URL=https://cb.example.com`, the four `CB_VAULT_*_OCID` values, and the
        fixture `oci` described under `cloud-init.sh`. It asserts, in order:
        1. both runs exit `0`;
        2. `<root>/etc/codebox/instance.env` and `<root>/etc/cloudflared/config.yml` have the
           same SHA-256 after run 2 as after run 1 (byte-identical, no timestamp in either);
        3. `<root>/var/lib/codebox/first-boot.jsonl` has exactly `2` lines, both with
           `"result":"ok"` and distinct `ts`;
        4. `<root>/etc/hosts` contains exactly one `127.0.1.1 cb-abcdef12` line;
        5. the fixture `oci` log holds exactly `8` invocations after the two runs (four per
           run) and each one names its secret OCID;
        6. neither stdout nor stderr of either run contains `tunnel-secret-value`, and
           `instance.env` is mode `0600` `root:codebox` when the test runs as root (that
           assertion is skipped otherwise, with the reason recorded).
  - [ ] `[live]` **An instance launched from the image boots, starts the tunnel and answers
        `/v1/health` without manual steps.** Not measurable on Actions: it needs a built image,
        a launched OCI instance and a Cloudflare tunnel. Measurement when a box exists:
        `ssh ubuntu@<ip> 'systemctl is-active codebox cloudflared && cat /var/lib/codebox/first-boot.jsonl && curl -sS http://127.0.0.1:8787/v1/health'`
        — bound: `active` for both units, exactly one `"result":"ok"` line, and a
        `/v1/health` body whose `status` is `ok`, within 5 minutes of the launch and with no
        command typed on the box. On Actions QA reports it `not run` with that literal command;
        the Orchestrator opens an `agent-review` issue and the merge does not wait.

Additional `[unit]` evidence this task owes:

  - [ ] `[unit]` Every shell script parses and lints:
        `for f in ops/vm/*.sh ops/image/scripts/*.sh; do bash -n "$f" || exit 1; done` exits 0,
        and `shellcheck -S warning -x ops/vm/*.sh ops/image/scripts/*.sh` exits 0 (if
        `shellcheck` is absent, `not run` with the reason).
  - [ ] `[unit]` `install.sh` refuses a bad artifact:
        `npx vitest run --project ops -t install` covers a checksum mismatch (exit 3, no
        `releases/` entry created), a missing entry point (exit 6, the release directory
        removed), a missing flag (exit 2), and a second install of the same version printing
        `reuse` and leaving `previous` alone.
  - [ ] `[unit]` `upgrade.sh --rollback` with no `previous` exits 5 and changes nothing;
        after two installs it swaps `current` back and prints `rolled back to <version>`.
  - [ ] `[unit]` `backup.sh --plaintext` writes an archive whose `tar -tzf` lists exactly
        `state.db`, `manifest.json`, `instance.env`; the `instance.env` member has
        `CB_SESSION_SECRET=[redacted]`; `--verify` prints `verify ok` with the row count of the
        fixture database.
  - [ ] `[unit]` `restore.sh` refuses an existing database without `--force` (exit 2, the file
        untouched) and restores a backup into an empty root so that `--verify` reports the same
        counts.
  - [ ] `[unit]` The image templates contain no credential:
        ```bash
        ! grep -RInE 'ghp_|ghs_|gho_|ghu_|github_pat_|-----BEGIN|cf-tunnel|sk-|xoxb-|AKIA' \
            --exclude=90-verify.sh --exclude=template.test.mjs --exclude=cloud-init.test.mjs \
            ops/image ops/vm
        ```
        exits 0. The three exclusions are the pattern list itself and the fixtures that must
        name the patterns to test them; every other file under `ops/image` and `ops/vm` is
        clean, and `ops/image/test/template.test.mjs` re-runs the same grep in the suite.
  - [ ] `[unit]` `ops/vm/README.md` and `ops/image/README.md` map every file (one line per
        file), per `AGENTS.md`.

## 📣 Coordination

- **For the Architect:** `docs/vm-image.md` and `docs/operations.md` disagree with what ships,
  and this task reconciles them inside its own paths:
  1. `docs/vm-image.md` §4 says `/opt/codebox` is "absent or empty" while
     `docs/operations.md` §2 runs `/opt/codebox/install.sh`. The scripts are therefore baked
     at **`/usr/local/lib/codebox/`** and the runbook command becomes
     `/usr/local/lib/codebox/install.sh …`. §1/§2/§4 of `vm-image.md` and §2 of
     `operations.md` say so after this task.
  2. `docs/operations.md` §2 says the installer "applies migrations". It does not: the daemon
     migrates at boot (`openStore`). The installer restarts and rolls the `current` symlink
     back when the daemon does not come up. §2 is corrected.
  3. `docs/operations.md` §5 promises a nightly `cb backup` to Object Storage. A unit must
     schedule it, so this task adds `codebox-backup.service` + `codebox-backup.timer`; the
     "three units" in `docs/vm-image.md` §1/§4 become three long-running units plus the timer.
  4. `docs/vm-image.md` §7 says `instance.env` is "readable by root and the `codebox` group"
     while §5 and `docs/security.md` pin `0600 root:codebox`. `0600` wins (the units read it
     with `EnvironmentFile=`, as `docs/providers.md` §14 shows) and §7's sentence is fixed.
  5. §1 of `docs/operations.md` has no `/usr/local/lib/codebox` row. That row is **not** added
     here: §1 is outside this task's section box. It is doc debt for Task-30.
- **For Task-29 (release pipeline):** the artifact is a `.tar.gz` whose entry point is
  `apps/daemon/dist/main.js`; `install.sh` verifies the checksum given with `--sha256`,
  unpacks under `/opt/codebox/releases/<version>` and refuses an archive without that file.
  The release must also keep the previous release on disk so `--rollback` works.
- **For Task-28 (hardening):** the five unit files exist here with the base block from
  `docs/providers.md` §14; hardening edits them in place, it does not recreate them.
- **For Task-17 (`cb update`, `cb backup`):** the CLI is a thin wrapper over
  `/usr/local/lib/codebox/upgrade.sh` and `backup.sh`; their flags are stable and documented in
  `ops/vm/README.md`.
- **For QA:** `packer build` is never run. `packer init` + `packer validate` is the whole
  template gate, and it degrades as written above rather than blocking.

## ⛔ Out of scope

- No `cb-agent.service` and no `scripts/agent/**` edit: the pipeline's unit is
  `scripts/agent/vm/cb-agent.service.in` and its own `install.sh`, shipped by Task-02.
- No `ops/oci/**` edit, no `docs/oci.md` edit, no `.github/workflows/**` edit (so no CI job for
  `packer validate`; the `ops` vitest project is the CI surface).
- No daemon code, no `packages/**` edit, no `CB_*` key added to the config schema.
- No `packer build`, no OCI API call, no real Vault read, no Cloudflare tunnel in any test.
- No `docs/operations.md` edit outside §2 and §4; no `docs/security.md`,
  `docs/providers.md`, `docs/decisions.md`, `TODO.md` or `CHANGELOG.md` edit.
- No new dependency, no `package.json` change, no `.gitignore` change: a real
  `prod.pkrvars.hcl` is simply never committed and `docs/vm-image.md` §3 says so.
- No secret rotation, no Vault policy edit (Task-24's `provision.sh` owns the policy).
- No refactor of `ops/oci/**`; the style is copied, not shared.

# VM image

The instance is rebuildable, not precious (D21). A **Packer** template bakes Ubuntu 24.04
arm64 with the runtime, the CLI tools and the systemd units; **cloud-init** gives the fresh
instance its identity and its secrets at first boot. Nothing secret is ever baked.

## 1. What the image contains

| Layer | Contents |
| --- | --- |
| Base | Canonical Ubuntu 24.04 LTS arm64 (OCI platform image). |
| Runtime | Node 24 LTS from the official arm64 tarball, `npm`, `corepack`. |
| Tools | `git`, `gh`, `curl`, `jq`, `age`, `unzip`, `build-essential`, `python3`, `sqlite3`. |
| Agent | `opencode` pinned to the tested version. |
| Edge | `cloudflared` from Cloudflare's apt repository. |
| Service user | `codebox` (system, no shell login, home `/var/lib/codebox`). |
| Units | `codebox.service`, `codebox-opencode.service`, `cloudflared.service`, and the nightly `codebox-backup.service` behind `codebox-backup.timer`. |
| Host commands | `lib.sh`, `cloud-init.sh`, `install.sh`, `upgrade.sh`, `backup.sh`, `restore.sh` and `90-verify.sh` in `/usr/local/lib/codebox/`, mode `0750 root:root`. |
| Config | `/etc/codebox/` skeleton, no values, plus `image.json`. |
| Hardening | `unattended-upgrades` (security only), `fail2ban` for SSH, journald cap, sysctl basics. |

Not in the image: a repository, a token, an SSH private key, a tunnel credential, the
database, a model key. The release artifact is installed by `install.sh` from the signed
bundle into `/opt/codebox/releases/<version>`, so the image and the app version can move
independently.

## 2. Template

```
ops/image/
  codebox.pkr.hcl          # oracle-oci builder, arm64 shape, image name cb-image-<version>-<sha>
  example.pkrvars.hcl      # dummy OCIDs, committed; prod.pkrvars.hcl is local
  http/cloud-init.yaml     # first boot only, passed as instance user-data
  scripts/
    10-base.sh             # apt, timezone, locale, journald
    20-node.sh             # Node 24 + corepack, pinned and checksum-verified
    30-tools.sh            # git, gh, age, sqlite3, jq
    40-opencode.sh         # pinned binary + version check
    50-cloudflared.sh      # repo, package, no token
    60-service.sh          # user, directories, units, host commands, image.json
    70-harden.sh           # sshd, fail2ban, unattended-upgrades, sysctl
    90-verify.sh           # fails the build on any check in §4
```

The builder uses the **Oracle OCI** plugin with an A1 Flex shape in the target compartment and
subnet. Builds run in OCI (arm64 on arm64), not on the operator's machine, so the
architecture and the kernel match. Provisioner paths are rooted at the template directory, so
the commands below work from the repository root.

The plugin has no boot-volume field: OCI creates the volume at launch, so the 100 GB of the
Always Free shape is `ops/oci/launch.sh`'s `CB_OCI_BOOT_GB` (default `100`).

## 3. Build

```bash
export PKR_VAR_oci_config_file="$HOME/.oci/config"
packer init ops/image
packer validate -var-file=prod.pkrvars.hcl ops/image
packer build   -var-file=prod.pkrvars.hcl ops/image
```

Variables: compartment, subnet, availability domain, base image OCID, image version and git
sha (all required, no default); `node_version` (`24.22.1`), `opencode_version` (`1.19.4`) and
`cloudflared_channel` (`stable`) carry the pinned defaults. `example.pkrvars.hcl` is committed
with dummy OCIDs; a real `prod.pkrvars.hcl` is local, never committed and never carries a
secret — the tenancy config it points at is the operator's `~/.oci/config`.

Output: a custom image OCID. `CB_OCI_IMAGE_ID` is updated to it, and `launch.sh` uses it on
the next attempt. The image is immutable; a change is a new image, never an in-place edit.

Build time is ~15 minutes. A build that fails `90-verify.sh` produces no image.

## 4. Verification (the build fails if any of these fail)

- `node --version` is 24.x; `npm --version` works; `corepack` is present.
- `git`, `gh`, `sqlite3`, `age`, `jq`, `cloudflared`, `opencode` answer `--version`.
- `systemctl is-enabled` reports the five units; `systemd-analyze verify` is clean.
- The `codebox` user exists, has no password and cannot log in.
- `/opt/codebox` is absent or empty (the app is installed from the artifact, not baked).
- A grep of `/etc`, `/opt` and `/var/lib` for token-shaped strings (`ghp_`, `ghs_`, `gho_`,
  `ghu_`, `github_pat_`, `-----BEGIN`, `cf-tunnel`, `sk-`, `xoxb-`, `AKIA`) finds nothing.
- No file under `/etc/codebox` contains a value other than a placeholder.
- `cloud-init schema --config-file http/cloud-init.yaml` passes.

`/usr/local/lib/codebox/90-verify.sh` prints one `ok <check>` or `fail <check> <detail>` line per
check and exits 1 on the first red one. It is the same checker
`ops/vm/test/verify.test.mjs` runs against a stub root, which is how the repository proves the
greps two-sided without building an image.

## 5. First boot

`cloud-init` runs once, on the instance, and is idempotent on a second boot:

1. `ops/vm/cloud-init.sh` sets the hostname to `cb-<short-instance-id>` and appends
   `127.0.1.1 <hostname>` to `/etc/hosts` once.
2. It reads the four secret bundles from **OCI Vault** through the instance principal — one
   `oci secrets secret-bundle get` per secret, never a second call — and writes
   `/etc/codebox/instance.env` (`0600`, `root:codebox`) last, so a failed read leaves no
   partial environment behind.
3. It renders `/etc/cloudflared/config.yml` and the tunnel credentials (`0600`, `root:root`)
   from the tunnel token, without printing the token.
4. It starts `codebox-opencode`, then `codebox`, then `cloudflared` — the OpenCode unit is
   started, not enabled, because it carries no `[Install]`.
5. It waits for `/v1/health` on loopback and appends one line to
   `/var/lib/codebox/first-boot.jsonl`: `ok`, or `failed` with the failing step. The daemon
   answers `200` for `ok|degraded` and `503` for `down`; any of the three proves it is up.
6. No answer within `--health-timeout` (120 s) is one `first boot failed` line and exit 4.

The user-data is `ops/image/http/cloud-init.yaml`: `#cloud-config`, the hostname from the
`CB_INSTANCE_NAME` template variable, and one `runcmd` entry. It carries no SSH key, no
password and no written file — the instance gets its SSH key from the launch metadata
(`ops/oci/launch.sh`) and its secrets from Vault.

```bash
# render and launch by hand until launch.sh grows a --user-data flag
CB_INSTANCE_NAME=cb-test envsubst < ops/image/http/cloud-init.yaml > /tmp/user-data.yaml
oci compute instance launch … --user-data file:///tmp/user-data.yaml
```

The first boot needs outbound network only. There is no inbound port to wait for.

## 6. Update and rollback

Two independent axes:

| Change | Mechanism | Rollback |
| --- | --- | --- |
| App release | `cb update --to <version>`, a wrapper over `/usr/local/lib/codebox/upgrade.sh` | `cb update --rollback` |
| OS / runtime / hardening | New image + relaunch, then restore the backup | Relaunch the previous image |

- A patch to the image is a new image; the instance is replaced, not patched in place.
- A release upgrade keeps the same instance and the same database.
- `/opt/codebox/current` and `/opt/codebox/previous` are relative symlinks into
  `/opt/codebox/releases/`, so the prefix can move. `upgrade.sh --rollback` swaps them and
  two rollbacks in a row return to the release that was abandoned.
- The previous release stays under `/opt/codebox/releases/` until the next successful upgrade;
  `--prune` keeps the two newest directories.
- The upgrade path from N-1 is tested in CI before a release (Task-29); N-2 is a fresh install
  plus a restore.

## 7. Secrets

- None in the image, none in user-data, none in the Packer variables.
- Vault is read with the instance principal; the policy is `cb-instance-policy` (see
  `oci.md` §2).
- The tunnel token, GitHub App key, session secret and provider keys are written to
  `instance.env` at `0600`, `root:codebox`, and never echoed. systemd reads it as root through
  `EnvironmentFile=`; the `codebox` user reads it only through the daemon.
- Rotating a secret is a Vault write plus a restart; it does not need a new image.

## 8. arm64 notes

- Every package must exist for arm64; `90-verify.sh` runs `--version` on each one.
- Node is installed from the official arm64 tarball (or NodeSource, which publishes arm64);
  a source build is not acceptable — it doubles the image time and pins a compiler.
- `cloudflared` publishes arm64 `.deb`; do not copy an amd64 binary.
- `better-sqlite3` is not installed: the store uses `node:sqlite` (D8). If the fallback is
  ever needed, the image must gain the build toolchain at that point, not preemptively.

## 9. Image hygiene

- `apt-get clean`, no `/var/lib/apt/lists`, no compiler cache, no npm cache in the image.
- Journald capped at 200 MB; the app's own logs live in `/var/lib/codebox/logs`.
- The image carries a build manifest at `/etc/codebox/image.json`: version, commit, build time,
  `node`, `opencode` and `cloudflared`. `cb doctor` prints it.
- The image is tagged `cb-image-<semver>-<gitsha>`; the OCI display name matches the tag.

## 10. Checks

| Check | Where | Fails when |
| --- | --- | --- |
| `packer fmt -check -recursive` | CI on change | The HCL is not formatted. |
| `packer validate` | CI on change | Template or variables are invalid. |
| `90-verify.sh` | Build | A binary, unit or permission is wrong. |
| Secret grep | Build and `ops/image/test/template.test.mjs` | Any token pattern is found. |
| cloud-init schema | CI | The first-boot config is invalid. |
| Second-boot idempotency | `ops/vm/test/cloud-init.test.mjs`, then `[live]` | A reboot rewrites or breaks the env. |
| Health without manual steps | `[live]` | The tunnel or daemon needs a human after launch. |

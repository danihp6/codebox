# VM image

The instance is rebuildable, not precious (D21). A **Packer** template bakes Ubuntu 24.04
arm64 with the runtime, the CLI tools and the systemd units; **cloud-init** gives the fresh
instance its identity and its secrets at first boot. Nothing secret is ever baked.

## 1. What the image contains

| Layer | Contents |
| --- | --- |
| Base | Canonical Ubuntu 24.04 LTS arm64 (OCI platform image). |
| Runtime | Node 24 LTS (NodeSource or the official tarball), `npm`, `corepack`. |
| Tools | `git`, `gh`, `curl`, `jq`, `age`, `unzip`, `build-essential`, `python3`, `sqlite3`. |
| Agent | `opencode` pinned to the tested minor. |
| Edge | `cloudflared` from Cloudflare's apt repository. |
| Service user | `codebox` (system, no shell login, home `/var/lib/codebox`). |
| Units | `codebox.service`, `codebox-opencode.service`, `cloudflared.service`. |
| Config | `/etc/codebox/` skeleton, no values. |
| Hardening | `unattended-upgrades` (security only), `fail2ban` for SSH, journald cap, sysctl basics. |

Not in the image: a repository, a token, an SSH private key, a tunnel credential, the
database, a model key. The release artifact (`/opt/codebox`) is installed by `install.sh` from
the signed bundle, so the image and the app version can move independently.

## 2. Template

```
ops/image/
  codebox.pkr.hcl          # oracle-oci builder, arm64 shape, 100 GB
  http/cloud-init.yaml     # first boot only
  scripts/
    10-base.sh             # apt, timezone, locale, journald
    20-node.sh             # Node 24 + corepack, pinned
    30-tools.sh            # git, gh, age, sqlite3, build tools
    40-opencode.sh         # pinned binary + version check
    50-cloudflared.sh      # repo, package, no token
    60-service.sh          # user, directories, units, tmpfiles
    70-harden.sh           # sshd, fail2ban, unattended-upgrades, sysctl
    90-verify.sh           # fails the build on any check below
```

The builder uses the **Oracle OCI** plugin with an A1 Flex shape in the target compartment and
subnet. Builds run in OCI (arm64 on arm64), not on the operator's machine, so the
architecture and the kernel match.

## 3. Build

```bash
packer init ops/image
packer validate -var-file=ops/image/prod.pkrvars.hcl ops/image
packer build   -var-file=ops/image/prod.pkrvars.hcl ops/image
```

Variables: compartment, subnet, availability domain, base image OCID, shape (`2/12` while
building), image name `cb-image-<version>-<sha>`, and the release version to stamp.

Output: a custom image OCID. `CB_OCI_IMAGE_ID` is updated to it, and `launch.sh` uses it on
the next attempt. The image is immutable; a change is a new image, never an in-place edit.

Build time is ~15 minutes. A build that fails `90-verify.sh` produces no image.

## 4. Verification (the build fails if any of these fail)

- `node --version` is 24.x; `npm --version` works; `corepack` is present.
- `git`, `gh`, `sqlite3`, `age`, `jq`, `cloudflared`, `opencode` answer `--version`.
- `systemctl is-enabled` is true for the three units; `systemd-analyze verify` is clean.
- The `codebox` user exists, has no password and cannot log in.
- `/opt/codebox` is absent or empty (the app is installed from the artifact, not baked).
- A grep of `/etc`, `/opt` and `/var/lib` for token-shaped strings (`ghp_`, `github_pat_`,
  `-----BEGIN`, `cf-tunnel`, `sk-`) finds nothing.
- No file under `/etc/codebox` contains a value other than a placeholder.
- `cloud-init schema --config-file http/cloud-init.yaml` passes.

## 5. First boot

`cloud-init` runs once, on the instance, and is idempotent on a second boot:

1. Set the hostname to `cb-<short-instance-id>` and `CB_INSTANCE_NAME` to the display name.
2. Read the secret bundle from **OCI Vault** through the instance principal and write
   `/etc/codebox/instance.env` (`0600`, `root:codebox`). No secret is in user-data.
3. Render the tunnel config from the token, without printing it.
4. Start `codebox-opencode`, then `codebox`, then `cloudflared`.
5. Wait for `/v1/health` on loopback and write one line to the journal: version, instance,
   healthy or the failing key name.
6. On failure, retry the Vault read three times and leave a clear journal line; the daemon
   exits non-zero rather than starting with a partial configuration.

The first boot needs outbound network only. There is no inbound port to wait for.

## 6. Update and rollback

Two independent axes:

| Change | Mechanism | Rollback |
| --- | --- | --- |
| App release | `cb update --to <version>` from the signed artifact | `cb update --rollback` |
| OS / runtime / hardening | New image + relaunch, then restore the backup | Relaunch the previous image |

- A patch to the image is a new image; the instance is replaced, not patched in place.
- A release upgrade keeps the same instance and the same database.
- The previous release stays under `/opt/codebox/releases/` until the next successful upgrade.
- The upgrade path from N-1 is tested in CI before a release (Task-29); N-2 is a fresh
  install plus a restore.

## 7. Secrets

- None in the image, none in user-data, none in the Packer variables.
- Vault is read with the instance principal; the policy is `cb-instance-policy` (see
  `oci.md` §2).
- The tunnel token, GitHub App key, session secret and provider keys are written to
  `instance.env`, readable by `root` and the `codebox` group, and never echoed.
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
- The image carries a build manifest at `/etc/codebox/image.json`: version, build time, commit,
  package versions. `cb doctor` prints it.
- The image is tagged `cb-image-<semver>-<gitsha>`; the OCI display name matches the tag.

## 10. Checks

| Check | Where | Fails when |
| --- | --- | --- |
| `packer validate` | CI on change | Template or variables are invalid. |
| `90-verify.sh` | Build | A binary, unit or permission is wrong. |
| Secret grep | Build | Any token pattern is found. |
| cloud-init schema | CI | The first-boot config is invalid. |
| Second-boot idempotency | `[live]`, Task-25 | A reboot rewrites or breaks the env. |
| Health without manual steps | `[live]`, Task-25 | The tunnel or daemon needs a human after launch. |

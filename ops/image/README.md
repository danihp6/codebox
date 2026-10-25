# ops/image

The Packer template that bakes the box: Ubuntu 24.04 arm64, Node 24, the CLI tools, `opencode`,
`cloudflared`, the `codebox` user and the five systemd units. No identity and no credential is
baked — first boot reads OCI Vault through the instance principal (`ops/vm/cloud-init.sh`).

## Files

| File | What it is |
| --- | --- |
| `codebox.pkr.hcl` | The `oracle-oci` builder: A1 Flex 2/12, the pinned versions, and the eight provisioners in numeric order. |
| `example.pkrvars.hcl` | The committed var-file: dummy OCIDs only. A real `prod.pkrvars.hcl` is local and never committed. |
| `http/cloud-init.yaml` | The user-data handed to a launched instance; `${CB_INSTANCE_NAME}` is substituted before launch. |
| `scripts/10-base.sh` | apt, Europe/Madrid, `en_US.UTF-8`, the journal cap at 200 MB, no apt cache. |
| `scripts/20-node.sh` | Node 24 from the official arm64 tarball, checksum-verified, plus `corepack`. |
| `scripts/30-tools.sh` | `git`, `gh`, `sqlite3`, `age`, `jq`; every binary answers `--version`. |
| `scripts/40-opencode.sh` | `opencode` at the pinned version, with a version check afterwards. |
| `scripts/50-cloudflared.sh` | `cloudflared` from Cloudflare's apt repository; no token anywhere. |
| `scripts/60-service.sh` | The `codebox` user, the directory skeleton, the units, the host scripts, `/etc/codebox/image.json`. |
| `scripts/70-harden.sh` | Key-only SSH, fail2ban, security-only unattended upgrades, the sysctl baseline. |
| `scripts/90-verify.sh` | The build gate: `runtime`, `tools`, `units`, `user`, `layout`, `secrets`, `image`. |
| `test/template.test.mjs` | The template's variables, the eight scripts, the build environment, `packer fmt` and `packer validate`. |
| `test/cloud-init.test.mjs` | The user-data: cloud-config, one `runcmd`, no key, no password, no written file. |
| `README.md` | This map. |

## Build

```bash
export PKR_VAR_oci_config_file="$HOME/.oci/config"   # or edit ops/image/example.pkrvars.hcl
packer init ops/image
packer validate -var-file=prod.pkrvars.hcl ops/image
packer build   -var-file=prod.pkrvars.hcl ops/image
```

`packer` resolves the provisioner paths from `${path.root}`, so the commands work from the
repository root and from `ops/image`.

Two notes on the environment, because both are easy to trip over:

- The OCI builder refuses to prepare without a tenancy config: `oci_config_file` (default
  `~/.oci/config`) must exist. `ops/image/test/template.test.mjs` validates the template
  against a throwaway key generated in a temporary directory, so the check runs without a real
  credential; a host with no OCI config reports the criterion `not run`.
- `cloudflared_channel` is declared for the apt channel, but the provisioner passes exactly the
  five documented build variables, so `50-cloudflared.sh` falls back to `stable`. Change both
  together if a channel ever matters.
- The builder has no boot-volume field. The 100 GB of the free tier is a launch parameter
  (`ops/oci/launch.sh`, `CB_OCI_BOOT_GB`), not an image property.

`packer build` is never run in CI and never on a developer machine: the build happens on OCI,
arm64 on arm64 (`docs/vm-image.md` §2).

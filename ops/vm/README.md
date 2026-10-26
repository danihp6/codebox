# ops/vm

The host side of one box: first boot, the release commands and the eight systemd units. Every
script here is installed to `/usr/local/lib/codebox/` by `60-service.sh`, runs headless against
a temporary `--root`, and keeps its machine-readable answer on stdout and its diagnostics on
stderr as `codebox: <message>`.

## Files

| File | What it is |
| --- | --- |
| `lib.sh` | Shared helpers: `ROOT`, `die`, `log`, `rooted`, `need`, `need_bin`, `usage`. Sourced, never executed. |
| `cloud-init.sh` | First boot: hostname, the secret bundles (the host file first, OCI Vault otherwise), `/etc/codebox/instance.env`, the tunnel config, the first-boot journal line. |
| `install.sh` | Verifies an artifact, unpacks it under `/opt/codebox/releases/<version>`, moves `current`, restarts and rolls back when the daemon stays down. |
| `upgrade.sh` | `install.sh` plus `--rollback` (swap the two symlinks) and `--prune` (keep the two newest releases). |
| `backup.sh` | Consistent SQLite snapshot plus a redacted `instance.env` and a manifest, age-encrypted by default; `--verify` reads the newest local archive, `--upload` sends it to any S3-compatible target and `--fetch` reads one object back. |
| `restore.sh` | Puts a local archive, a named object or `_latest` back on a stopped box, verifies the row counts first and installs the database last. |
| `spot-notice.sh` | Polls the two-minute spot interruption notice and runs one final `backup.sh --upload`, guarded by a marker and a lock so a retry never uploads twice. |
| `keepalive.sh` | Two `/proc` samples a second apart, one JSON line appended to `/var/lib/codebox/logs/keepalive.jsonl`, then a bounded pass (`cb doctor`, `cb prune`, a loopback health probe) whose every step is optional. |
| `systemd/codebox.service` | The daemon, `codebox` user, `instance.env` as its environment file. |
| `systemd/codebox-opencode.service` | The OpenCode server on `127.0.0.1:4096`; no `[Install]`, because the daemon may own the child. |
| `systemd/cloudflared.service` | The tunnel, outbound only. |
| `systemd/codebox-backup.service` | The nightly backup job behind the timer. |
| `systemd/codebox-backup.timer` | `OnCalendar=*-*-* 03:20:00`, `Persistent=true`. |
| `systemd/codebox-keepalive.service` | The liveness pass behind the timer; no `[Install]`. |
| `systemd/codebox-keepalive.timer` | `OnCalendar=*-*-* 00/6:40:00`, `Persistent=true`. |
| `systemd/codebox-spot-notice.service` | The spot interruption listener; `Type=simple`, restarts on failure until the final backup succeeds. |
| `test/install.test.mjs` | Checksum mismatch, missing entry point, missing flag, `reuse` on a second install. |
| `test/upgrade.test.mjs` | `--rollback` without a previous release, the swap, the second rollback, `--prune`. |
| `test/backup.test.mjs` | Plaintext archive shape, redaction, manifest, `--verify` counts. |
| `test/restore.test.mjs` | Overwrite refusal, restore into an empty root, corrupt archive. |
| `test/cloud-init.test.mjs` | Two boots against one root: byte-identical files, two journal lines, eight Vault reads, plus the bundle-file source, `CB_INSTANCE_ID` and the IMDSv2 probe. |
| `test/verify.test.mjs` | `90-verify.sh --only secrets` on a clean and on a leaky stub root. |
| `test/spot-notice.test.mjs` | No notice, one final backup for repeated notices, a failed backup with no marker, and the unit plus its image wiring. |
| `test/keepalive.test.mjs` | The sample on a stub `/proc`, the three step outcomes, the loopback-only rule, the units and the image wiring. |
| `test/systemd.test.mjs` | The sandbox block in the three long-running units, its position, the surviving directives and the absent `MemoryDenyWriteExecute`. |
| `README.md` | This map. |

## Commands

```bash
# install or move a release (as root, on the box)
/usr/local/lib/codebox/install.sh --artifact codebox-0.1.0.tar.gz --version 0.1.0 --sha256 <hex>
/usr/local/lib/codebox/upgrade.sh --artifact codebox-0.2.0.tar.gz --version 0.2.0 --sha256 <hex> --prune
/usr/local/lib/codebox/upgrade.sh --rollback

# backup and restore
/usr/local/lib/codebox/backup.sh --recipient "$CB_BACKUP_AGE_RECIPIENT"
/usr/local/lib/codebox/backup.sh --upload
/usr/local/lib/codebox/backup.sh --verify
/usr/local/lib/codebox/backup.sh --fetch cb/db/2026/10/26.age > today.age
/usr/local/lib/codebox/restore.sh --from cb-backup-20261025T032000Z.age --identity /root/age.key
/usr/local/lib/codebox/restore.sh --latest --identity /root/age.key --force

# liveness
/usr/local/lib/codebox/keepalive.sh --report
```

`install.sh --no-restart` stops after the symlink, which is what a test and a `--root` run use.
`keepalive.sh --report` prints the sample instead of running the pass; the timer runs the whole
script every six hours. `restore.sh` never starts or stops a unit: stop `codebox.service` first.
`backup.sh --verify` reads the newest local archive; an `.age` one needs
`CB_BACKUP_AGE_IDENTITY`, and the box does not hold that key by design. `backup.sh --upload`
writes `<archive>.sha256` beside the archive, uploads `db/<YYYY>/<MM>/<DD>.age` plus the
`_latest` pointer, verifies both and keeps the 30 newest daily objects; `--fetch KEY` takes the
object key inside the bucket, exactly as `_latest` prints it. `restore.sh --latest` reads that
pointer and restores the object it names.

`cloud-init.sh` takes the four bundles from `CB_SECRETS_FILE` (default
`/etc/codebox/secret-bundles.json`, `0600`, never in user-data) when that file exists, and from
OCI Vault through the instance principal otherwise; a host with neither refuses to boot. The
hostname is `cb-<id8>` from `--instance-id`, `CB_INSTANCE_ID` or the metadata service (the OCI
bearer probe, then the AWS IMDSv2 handshake).

Exit codes are the same in every script: `0` success, `2` usage or a missing input, `3`
checksum mismatch, `4` unhealthy after a restart, `5` no previous release, `6` bad archive or
bad database.

## Units

The six service units carry the sandbox block from `docs/providers.md` §14
(`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp` and the two writable
paths). The three long-running services — `codebox`, `codebox-opencode` and `cloudflared` — add
the extended block after `PrivateTmp=true` and before `ReadWritePaths=`: no capabilities, no
ambient capabilities, `LockPersonality`, `PrivateDevices`, `ProtectClock`,
`ProtectControlGroups`, `ProtectHostname`, `ProtectKernelLogs`, `ProtectKernelModules`,
`ProtectKernelTunables`, `RemoveIPC`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`,
`RestrictNamespaces`, `RestrictRealtime`, `RestrictSUIDSGID`,
`SystemCallArchitectures=native`, `SystemCallFilter=@system-service` with
`SystemCallErrorNumber=EPERM`, and `UMask=0027`. That block, not a container, is the agent's
isolation boundary (`docs/security.md` §6).

`MemoryDenyWriteExecute=yes` must never be added to them: it removes the write-execute mapping
V8's JIT needs and Node dies at boot. `test/systemd.test.mjs` fails if it appears. The two
timers have no `[Service]` section, so they have nothing to sandbox.

`CB_BACKUP_AGE_RECIPIENT`, `CB_BACKUP_S3_URI`, `CB_BACKUP_S3_ENDPOINT` and
`CB_BACKUP_S3_REGION` are host variables, not daemon configuration: the operator sets them in a
drop-in (`systemctl edit codebox-backup.service`, and the same names plus the metadata endpoint
for `codebox-spot-notice.service`) and they never reach `/etc/codebox/instance.env`.
`CB_BACKUP_S3_URI` is `s3://bucket[/prefix]` and defaults to no target at all; the endpoint
defaults to `https://s3.<region>.amazonaws.com`, the region to `AWS_REGION`,
`AWS_DEFAULT_REGION` and then `eu-west-1`. Credentials come from `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN` when set, and from the instance profile at
`AWS_EC2_METADATA_SERVICE_ENDPOINT` (default `http://169.254.169.254`) otherwise. Both scripts
and the spot notice read the same names.

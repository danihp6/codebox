# ops/vm

The host side of one box: first boot, the release commands and the seven systemd units. Every
script here is installed to `/usr/local/lib/codebox/` by `60-service.sh`, runs headless against
a temporary `--root`, and keeps its machine-readable answer on stdout and its diagnostics on
stderr as `codebox: <message>`.

## Files

| File | What it is |
| --- | --- |
| `lib.sh` | Shared helpers: `ROOT`, `die`, `log`, `rooted`, `need`, `need_bin`, `usage`. Sourced, never executed. |
| `cloud-init.sh` | First boot: hostname, OCI Vault reads, `/etc/codebox/instance.env`, the tunnel config, the first-boot journal line. |
| `install.sh` | Verifies an artifact, unpacks it under `/opt/codebox/releases/<version>`, moves `current`, restarts and rolls back when the daemon stays down. |
| `upgrade.sh` | `install.sh` plus `--rollback` (swap the two symlinks) and `--prune` (keep the two newest releases). |
| `backup.sh` | Consistent SQLite snapshot plus a redacted `instance.env` and a manifest, age-encrypted by default, `--verify` and `--upload`. |
| `restore.sh` | Puts an archive back on a stopped box, verifies the row counts first and installs the database last. |
| `keepalive.sh` | Two `/proc` samples a second apart, one JSON line appended to `/var/lib/codebox/logs/keepalive.jsonl`, then a bounded pass (`cb doctor`, `cb prune`, a loopback health probe) whose every step is optional. |
| `systemd/codebox.service` | The daemon, `codebox` user, `instance.env` as its environment file. |
| `systemd/codebox-opencode.service` | The OpenCode server on `127.0.0.1:4096`; no `[Install]`, because the daemon may own the child. |
| `systemd/cloudflared.service` | The tunnel, outbound only. |
| `systemd/codebox-backup.service` | The nightly backup job behind the timer. |
| `systemd/codebox-backup.timer` | `OnCalendar=*-*-* 03:20:00`, `Persistent=true`. |
| `systemd/codebox-keepalive.service` | The liveness pass behind the timer; no `[Install]`. |
| `systemd/codebox-keepalive.timer` | `OnCalendar=*-*-* 00/6:40:00`, `Persistent=true`. |
| `test/install.test.mjs` | Checksum mismatch, missing entry point, missing flag, `reuse` on a second install. |
| `test/upgrade.test.mjs` | `--rollback` without a previous release, the swap, the second rollback, `--prune`. |
| `test/backup.test.mjs` | Plaintext archive shape, redaction, manifest, `--verify` counts. |
| `test/restore.test.mjs` | Overwrite refusal, restore into an empty root, corrupt archive. |
| `test/cloud-init.test.mjs` | Two boots against one root: byte-identical files, two journal lines, eight Vault reads. |
| `test/verify.test.mjs` | `90-verify.sh --only secrets` on a clean and on a leaky stub root. |
| `test/keepalive.test.mjs` | The sample on a stub `/proc`, the three step outcomes, the loopback-only rule, the units and the image wiring. |
| `README.md` | This map. |

## Commands

```bash
# install or move a release (as root, on the box)
/usr/local/lib/codebox/install.sh --artifact codebox-0.1.0.tar.gz --version 0.1.0 --sha256 <hex>
/usr/local/lib/codebox/upgrade.sh --artifact codebox-0.2.0.tar.gz --version 0.2.0 --sha256 <hex> --prune
/usr/local/lib/codebox/upgrade.sh --rollback

# backup and restore
/usr/local/lib/codebox/backup.sh --recipient "$CB_BACKUP_AGE_RECIPIENT"
/usr/local/lib/codebox/backup.sh --verify
/usr/local/lib/codebox/restore.sh --from cb-backup-20261025T032000Z.age --identity /root/age.key

# liveness
/usr/local/lib/codebox/keepalive.sh --report
```

`install.sh --no-restart` stops after the symlink, which is what a test and a `--root` run use.
`keepalive.sh --report` prints the sample instead of running the pass; the timer runs the whole
script every six hours. `restore.sh` never starts or stops a unit: stop `codebox.service` first.
`backup.sh --verify` reads the newest archive; an `.age` one needs `CB_BACKUP_AGE_IDENTITY`, and
the box does not hold that key by design.

Exit codes are the same in every script: `0` success, `2` usage or a missing input, `3`
checksum mismatch, `4` unhealthy after a restart, `5` no previous release, `6` bad archive or
bad database.

## Units

The five service units carry the sandbox block from `docs/providers.md` §14
(`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp` and the two writable
paths). The two timers have no `[Service]` section, so they have nothing to sandbox.

`CB_BACKUP_AGE_RECIPIENT` and `CB_BACKUP_BUCKET` are host variables, not daemon configuration:
the operator sets them in a drop-in (`systemctl edit codebox-backup.service`) and they never
reach `/etc/codebox/instance.env`.

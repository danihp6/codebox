#!/usr/bin/env bash

# The service user, the directory skeleton, the five units, the host scripts and the image
# manifest. /opt/codebox is created empty on purpose: the release is installed from the
# artifact, never baked.

set -euo pipefail

log() { printf 'image: %s\n' "$*" >&2; }
staging=/tmp/codebox

user=codebox
home=/var/lib/codebox

if ! id -u "$user" >/dev/null 2>&1; then
  log "creating $user"
  useradd --system --home-dir "$home" --no-create-home --shell /usr/sbin/nologin "$user"
fi

log "creating the directory skeleton"
install -d -m 0750 -o root -g "$user" /etc/codebox /etc/cloudflared
install -d -m 0750 -o "$user" -g "$user" "$home" \
  "$home/logs" "$home/events" "$home/artifacts" "$home/backups"
install -d -m 0750 -o "$user" -g "$user" /srv/codebox /srv/codebox/repos /srv/codebox/worktrees
install -d -m 0700 -o "$user" -g "$user" /var/tmp/codebox
install -d -m 0755 /opt/codebox
install -d -m 0750 /usr/local/lib/codebox

log "installing the host scripts"
for script in lib.sh cloud-init.sh install.sh upgrade.sh backup.sh restore.sh; do
  install -m 0750 -o root -g root "$staging/vm/$script" "/usr/local/lib/codebox/$script"
done
install -m 0750 -o root -g root "$staging/90-verify.sh" /usr/local/lib/codebox/90-verify.sh

log "installing the units"
install -m 0644 -o root -g root "$staging/units/codebox.service" /etc/systemd/system/codebox.service
install -m 0644 -o root -g root "$staging/units/codebox-opencode.service" \
  /etc/systemd/system/codebox-opencode.service
install -m 0644 -o root -g root "$staging/units/cloudflared.service" \
  /etc/systemd/system/cloudflared.service
install -m 0644 -o root -g root "$staging/units/codebox-backup.service" \
  /etc/systemd/system/codebox-backup.service
install -m 0644 -o root -g root "$staging/units/codebox-backup.timer" \
  /etc/systemd/system/codebox-backup.timer

systemctl daemon-reload
# codebox-opencode.service carries no [Install] on purpose: the daemon may own the child.
systemctl enable codebox.service cloudflared.service codebox-backup.timer

built_at=${CB_IMAGE_BUILT_AT:-}
if [[ "$built_at" =~ ^[0-9]+$ ]]; then
  built_at=$(date -u -d "@$built_at" +%Y-%m-%dT%H:%M:%SZ)
fi
CB_MANIFEST=/etc/codebox/image.json \
  CB_VERSION="${CB_IMAGE_VERSION:-0.0.0}" \
  CB_COMMIT="${CB_IMAGE_COMMIT:-unknown}" \
  CB_BUILT_AT="${built_at:-unknown}" \
  CB_NODE="$(node --version)" \
  CB_OPENCODE="$(opencode --version 2>&1 | head -n 1)" \
  CB_CLOUDFLARED="$(/usr/bin/cloudflared --version 2>&1 | head -n 1)" \
  node --input-type=module -e '
    import { writeFileSync } from "node:fs";
    const manifest = {
      version: process.env.CB_VERSION,
      commit: process.env.CB_COMMIT,
      builtAt: process.env.CB_BUILT_AT,
      node: process.env.CB_NODE,
      opencode: process.env.CB_OPENCODE,
      cloudflared: process.env.CB_CLOUDFLARED,
    };
    writeFileSync(process.env.CB_MANIFEST, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o644 });
  '
log "wrote /etc/codebox/image.json"

rm -rf "$staging"

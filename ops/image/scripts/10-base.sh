#!/usr/bin/env bash

# Base layer: an up-to-date Ubuntu 24.04, the timezone the scheduler assumes, a UTF-8 locale
# and a capped journal. No package list survives into the image.

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

log() { printf 'image: %s\n' "$*" >&2; }

log "updating the base system"
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl gnupg unzip git jq sqlite3 age \
  build-essential python3 locales tzdata chrony

log "setting Europe/Madrid and en_US.UTF-8"
ln -sfn /usr/share/zoneinfo/Europe/Madrid /etc/localtime
printf 'Europe/Madrid\n' >/etc/timezone
sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen
locale-gen
update-locale LANG=en_US.UTF-8

log "capping the journal at 200 MB"
install -d -m 0755 /etc/systemd/journald.conf.d
cat >/etc/systemd/journald.conf.d/90-codebox.conf <<'EOF'
[Journal]
SystemMaxUse=200M
RuntimeMaxUse=64M
EOF

log "cleaning the apt cache"
apt-get clean
rm -rf /var/lib/apt/lists/*

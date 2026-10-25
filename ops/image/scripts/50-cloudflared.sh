#!/usr/bin/env bash

# cloudflared from Cloudflare's apt repository. The tunnel token is not here: it arrives from
# Vault at first boot and lands in /etc/cloudflared at 0600.

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

log() { printf 'image: %s\n' "$*" >&2; }

channel=${CLOUDFLARED_CHANNEL:-stable}
log "installing cloudflared from the $channel channel"

install -d -m 0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflared/pubkey |
  gpg --dearmor --yes -o /usr/share/keyrings/cloudflare-main.gpg
chmod 0644 /usr/share/keyrings/cloudflare-main.gpg
printf 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main\n' \
  >/etc/apt/sources.list.d/cloudflared.list
apt-get update -qq
apt-get install -y -qq --no-install-recommends cloudflared

/usr/bin/cloudflared --version
apt-get clean
rm -rf /var/lib/apt/lists/*

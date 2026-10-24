#!/usr/bin/env bash

# Bootstrap an Ubuntu 24.04 host (the Oracle Always Free Ampere VM) for the autopilot.
# Idempotent: run it again after a reboot or an image update and it only fills the gaps.
#
# It creates the `cb-agent` user and its directories, installs git/gh/Node 24/OpenCode,
# the Playwright browser, writes the env template and the systemd unit, and leaves the
# service enabled but stopped until a human fills the env and arms the brake.

set -euo pipefail
# shellcheck source=lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

[ "$(id -u)" -eq 0 ] || die "run this as root: sudo <repo>/scripts/agent/vm/install.sh"

repo=$(cd "$VM_DIR/../../.." && pwd)
user=cb-agent
home=/srv/cb-agent
state=${CB_AGENT_STATE:-/var/lib/cb-agent}
envfile=${CB_AGENT_ENV:-/etc/codebox/cb-agent.env}
unit=cb-agent.service

arch=$(uname -m)
[ "$arch" = aarch64 ] || log "warning: $arch is not the Always Free Ampere shape; continuing"

log "installing base packages"
apt-get update -qq
apt-get install -y -qq git jq curl ca-certificates gnupg openssh-client build-essential

if ! node --version 2>/dev/null | grep -q '^v24\.'; then
  log "installing node 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi

if ! command -v gh >/dev/null 2>&1; then
  log "installing the GitHub CLI"
  mkdir -p -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg |
    tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" |
    tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq gh
fi

if ! command -v opencode >/dev/null 2>&1; then
  log "installing the opencode CLI"
  npm install -g @opencode/cli
fi

if ! id -u "$user" >/dev/null 2>&1; then
  log "creating the $user user"
  useradd --system --home-dir "$home" --no-create-home --shell /usr/sbin/nologin "$user"
fi

mkdir -p "$home" "$state" "$(dirname "$envfile")"
chown -R "$user:$user" "$home" "$repo" "$state" 2>/dev/null || true
chmod 700 "$state"

log "installing dependencies in $repo"
runuser -u "$user" -- env HOME="$home" bash -c "cd '$repo' && npm ci --prefer-offline --no-audit --no-fund"

# The cycle measures `[live]` criteria against a headless Chromium. Best effort: a host
# that cannot install it still runs the [unit] criteria, and QA reports the rest as
# degraded (docs/agent-ci.md §7).
if ! npx --yes playwright install-deps chromium >>/dev/null 2>&1; then
  log "warning: could not install the Chromium system dependencies"
fi
if ! runuser -u "$user" -- env HOME="$home" bash -c "cd '$repo' && npx --yes playwright install chromium" >>/dev/null 2>&1; then
  log "warning: could not install the Chromium build for $user"
fi

if [ ! -f "$envfile" ]; then
  cp "$VM_DIR/agent.env.example" "$envfile"
  log "wrote $envfile — fill it before starting the service"
fi
chown root:"$user" "$envfile"
chmod 600 "$envfile"

# The token is in the service's environment; the askpass helper never reads a file and
# never prints the secret into argv (docs/agent-vm.md §5).
cat > /usr/local/bin/cb-agent-git-askpass <<'HELPER'
#!/bin/sh
case "${1:-}" in
  *Username*) echo x-access-token ;;
  *Password*) printf '%s\n' "${CB_AGENT_GIT_TOKEN:-}" ;;
esac
HELPER
chmod 755 /usr/local/bin/cb-agent-git-askpass
runuser -u "$user" -- git -C "$repo" config --local core.askpass \
  /usr/local/bin/cb-agent-git-askpass

log "installing the systemd unit"
sed -e "s|@USER@|$user|g" -e "s|@HOME@|$home|g" -e "s|@REPO@|$repo|g" -e "s|@STATE@|$state|g" \
  "$VM_DIR/$unit.in" > "/tmp/$unit"
install -m 644 "/tmp/$unit" "/etc/systemd/system/$unit"
rm -f "/tmp/$unit"
systemctl daemon-reload
systemctl enable "$unit" >/dev/null 2>&1

printf 'off\n' > "$state/brake"
chown "$user:$user" "$state/brake"

if grep -qE '^CB_AGENT_MODEL=.+' "$envfile" && grep -qE '^(ANTHROPIC|OPENAI|OPENROUTER|OPENCODE)_API_KEY=.+' "$envfile"; then
  log "$envfile looks complete; start with: systemctl start $unit"
else
  log "$envfile is still empty; the service is enabled but stopped"
fi

log "done. Next: fill $envfile, then scripts/agent/vm/brake.sh on && systemctl start $unit"

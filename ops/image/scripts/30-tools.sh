#!/usr/bin/env bash

# The CLI tools the daemon, the gate and the runbook call. `gh` comes from GitHub's apt
# repository; `age` and `sqlite3` come from Ubuntu.

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

log() { printf 'image: %s\n' "$*" >&2; }

log "installing the GitHub CLI"
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod 0644 /etc/apt/keyrings/githubcli-archive-keyring.gpg
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n' \
  "$(dpkg --print-architecture)" >/etc/apt/sources.list.d/github-cli.list
apt-get update -qq
apt-get install -y -qq --no-install-recommends gh

for tool in git gh sqlite3 age jq; do
  command -v "$tool" >/dev/null || {
    printf 'error: %s is not installed\n' "$tool" >&2
    exit 2
  }
  log "$tool $("$tool" --version 2>&1 | head -n 1)"
done

apt-get clean
rm -rf /var/lib/apt/lists/*

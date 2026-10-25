#!/usr/bin/env bash

# The agent runtime, pinned by the template: the daemon starts it on loopback, so the binary
# (and its version) has to be in the image rather than downloaded at run time.

set -euo pipefail

log() { printf 'image: %s\n' "$*" >&2; }

version=${OPENCODE_VERSION:-}
[ -n "$version" ] || {
  printf 'error: OPENCODE_VERSION is empty\n' >&2
  exit 2
}

log "installing opencode $version"
npm install -g --no-fund --no-audit "@opencode/cli@${version}"

installed=$(opencode --version 2>&1 | head -n 1)
case "$installed" in
  *"$version"*) log "opencode $installed" ;;
  *)
    printf 'error: opencode reported %s, expected %s\n' "$installed" "$version" >&2
    exit 2
    ;;
esac

npm cache clean --force >/dev/null 2>&1 || true

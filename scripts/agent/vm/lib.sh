#!/usr/bin/env bash

# Shared plumbing for the VM's autopilot: paths, the env file, logging and the two
# helpers every script needs. Sourced, never executed.

VM_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Everything below is resolved again after the env file is read, because a value may
# live there (`CB_AGENT_STATE`, `CB_AGENT_REPO`) and the derived paths must follow it.
resolve_paths() {
  CB_AGENT_REPO=${CB_AGENT_REPO:-/srv/cb-agent/codebox}
  CB_AGENT_STATE=${CB_AGENT_STATE:-/var/lib/cb-agent}
  CB_AGENT_ENV=${CB_AGENT_ENV:-/etc/codebox/cb-agent.env}
  CB_AGENT_MODEL=${CB_AGENT_MODEL:-}
  CB_AGENT_DAILY_CYCLES=${CB_AGENT_DAILY_CYCLES:-0}
  CB_AGENT_MAX_DEVS=${CB_AGENT_MAX_DEVS:-2}
  CB_AGENT_MERGE=${CB_AGENT_MERGE:-true}
  STATE=$CB_AGENT_STATE
  LOGS=$STATE/logs
  CYCLES=$STATE/cycles.ndjson
  export CB_AGENT_REPO CB_AGENT_STATE CB_AGENT_ENV CB_AGENT_MODEL CB_AGENT_DAILY_CYCLES \
    CB_AGENT_MAX_DEVS CB_AGENT_MERGE STATE LOGS CYCLES
}

resolve_paths

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
  log "error: $*" >&2
  exit 1
}

need() {
  local name
  for name in "$@"; do
    [ -n "${!name:-}" ] || die "$name is empty; set it in $CB_AGENT_ENV"
  done
}

have() {
  local name
  for name in "$@"; do
    command -v "$name" >/dev/null 2>&1 || die "$name is not installed; run scripts/agent/vm/install.sh"
  done
}

# The env file is shell, so a value may contain `$HOME`; it is sourced as such. Under
# systemd the file is `0600 root:cb-agent` and systemd reads it as root, so the service's
# environment already has the values and the file is not readable by the user.
load_env() {
  if [ -r "$CB_AGENT_ENV" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$CB_AGENT_ENV"
    set +a
    resolve_paths
    return
  fi
  [ -n "${CB_AGENT_MODEL:-}" ] ||
    die "no readable env file at $CB_AGENT_ENV and CB_AGENT_MODEL is unset"
}

ensure_state() {
  mkdir -p "$STATE" "$LOGS"
  chmod 700 "$STATE" 2>/dev/null || true
  [ -f "$CYCLES" ] || : > "$CYCLES"
}

# The repo's slug, for `gh api repos/<slug>`; works with https and ssh remotes.
repo_slug() {
  local url
  url=$(git -C "$CB_AGENT_REPO" remote get-url origin)
  url=${url%.git}
  url=${url#*github.com:}
  url=${url#*github.com/}
  printf '%s\n' "$url"
}

today_utc() {
  date -u +%Y-%m-%d
}

# Counts today's cycles, and today's failures when asked for `red`, from the ledger.
count_today() {
  local field=$1 date
  date=$(today_utc)
  jq -s --arg date "$date" --arg field "$field" '
    map(select((.ts // "") >= $date
      and (if $field == "red" then .status == "failed" else true end))) | length
  ' "$CYCLES" 2>/dev/null || echo 0
}

# Appends one synthetic failure so a cycle that died before writing its own line still
# counts towards the red streak the gate reads.
record_failure() {
  ensure_state
  jq -nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg reason "$1" \
    '{ts:$ts,status:"failed",reason:$reason}' >> "$CYCLES"
}

#!/usr/bin/env bash

# The brake, by hand or by window. This is the VM's replacement for the repository
# variable `CB_AGENT_AUTOPILOT` and for `agent-autopilot-window.yml`: the same promise,
# kept locally, with the same invariant — **with a range set, the brake mirrors the range.**
#
#   brake.sh on                    manual: the loop may start cycles
#   brake.sh off                   manual: parked, and any armed range is cleared
#   brake.sh window 4              the loop may run for the next 4 hours
#   brake.sh window 4 22:30        ... starting today at 22:30 UTC
#   brake.sh window 0              stop: brake off, range cleared
#   brake.sh status                what the driver would read right now
#   brake.sh reset                 forget today's red streak (a human looked at it)

set -uo pipefail
# shellcheck source=lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

[ -f "$CB_AGENT_ENV" ] && load_env
ensure_state

command=${1:-status}
hours=${2:-}
start=${3:-}

iso() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }

case "$command" in
  on)
    printf 'on\n' > "$STATE/brake"
    rm -f "$STATE/window"
    log "brake on (manual, no window)"
    ;;
  off)
    printf 'off\n' > "$STATE/brake"
    rm -f "$STATE/window"
    log "brake off (manual); the loop parks at the next boundary"
    ;;
  window)
    [ -n "$hours" ] || die "usage: brake.sh window <hours> [HH:MM]"
    if [ "$hours" -eq 0 ] 2>/dev/null; then
      printf 'off\n' > "$STATE/brake"
      rm -f "$STATE/window"
      log "window stopped: brake off, range cleared"
      exit 0
    fi
    now=$(date -u +%s)
    if [ -n "$start" ]; then
      today=$(date -u +%Y-%m-%d)
      from=$(date -u -d "$today $start" +%s) || die "cannot read the start time '$start'"
    else
      from=$now
    fi
    until=$((from + hours * 3600))
    printf '%s %s\n' "$from" "$until" > "$STATE/window"
    printf 'on\n' > "$STATE/brake"
    log "window armed: $(iso "$from") -> $(iso "$until") ($hours h)"
    ;;
  reset)
    today=$(today_utc)
    jq -c --arg today "$today" 'select((.ts // "") < $today or .status != "failed")' \
      "$CYCLES" > "$CYCLES.tmp" && mv "$CYCLES.tmp" "$CYCLES"
    log "red streak cleared for $today"
    ;;
  status)
    brake=$(cat "$STATE/brake" 2>/dev/null || echo unset)
    if [ -f "$STATE/window" ]; then
      read -r from until < "$STATE/window"
      window="$(iso "$from") -> $(iso "$until")"
    else
      window='none'
    fi
    printf 'brake:  %s\nwindow: %s\ncycles: %s today (%s red)\n' \
      "$brake" "$window" "$(count_today all)" "$(count_today red)"
    ;;
  *)
    die "unknown command '$command' (try: on, off, window, status, reset)"
    ;;
esac

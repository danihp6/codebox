#!/usr/bin/env bash

# The loop. It decides whether a cycle may start and, unlike the GitHub driver, it then
# runs that cycle itself instead of dispatching a workflow: there is no runner to wake up
# and no cron to miss.
#
# The brake is `$STATE/brake` (anything but `on` parks) and it is read at a boundary, so
# no merge is ever cut in half. `brake.sh` owns the file and the timed window. Every
# decision is taken by `gate.mjs`, which is pure and unit-tested.

set -uo pipefail
# shellcheck source=lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

load_env
ensure_state
have git jq gh node npm opencode flock

need CB_AGENT_MODEL CB_AGENT_GIT_TOKEN

if [ -z "${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}${OPENROUTER_API_KEY:-}${OPENCODE_API_KEY:-}" ]; then
  die "no provider key in $CB_AGENT_ENV: set the one CB_AGENT_MODEL needs (ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY or OPENCODE_API_KEY)"
fi

export GH_TOKEN=$CB_AGENT_GIT_TOKEN

trap 'log "driver stopping"; exit 0' TERM INT

alerted_for() {
  # The backlog-empty alert is once a day, not once every parked wake-up.
  local key="$1:$(today_utc)"
  grep -qxF "$key" "$STATE/alerts" 2>/dev/null
}

mark_alerted() {
  local key="$1:$(today_utc)"
  printf '%s\n' "$key" >> "$STATE/alerts"
}

log "driver starting: repo=$CB_AGENT_REPO state=$STATE model=$CB_AGENT_MODEL cap=$CB_AGENT_DAILY_CYCLES"

while :; do
  if ! git -C "$CB_AGENT_REPO" fetch --prune --quiet origin; then
    log "fetch failed; will retry"
    sleep 120
    continue
  fi

  open=$(git -C "$CB_AGENT_REPO" show origin/main:TODO.md 2>/dev/null |
    grep -cE '^[[:space:]]*-[[:space:]]*\[ \][[:space:]]*\*\*\[Task-' || true)
  cycles_today=$(count_today all)
  red_today=$(count_today red)

  decision=$(node "$CB_AGENT_REPO/scripts/agent/gate.mjs" \
    --state "$STATE" \
    --open "${open:-0}" \
    --cycles-today "${cycles_today:-0}" \
    --red-today "${red_today:-0}" \
    --cap "${CB_AGENT_DAILY_CYCLES:-0}")

  go=$(printf '%s' "$decision" | jq -r .go)
  reason=$(printf '%s' "$decision" | jq -r .reason)
  alert=$(printf '%s' "$decision" | jq -r '.alert // empty')

  if [ "$go" != true ]; then
    log "parked: $reason"
    if [ -n "$alert" ]; then
      title=$(printf '%s' "$alert" | jq -r .title)
      if ! alerted_for "$title"; then
        slug=$(repo_slug)
        gh issue create --repo "$slug" --label agent-blocked --title "$title" \
          --body "$(printf '%s' "$alert" | jq -r .body)" || true
        mark_alerted "$title"
      fi
    fi
    sleep 300
    continue
  fi

  log "starting a cycle: $reason"
  before_lines=$(wc -l < "$CYCLES")
  "$VM_DIR/run-cycle.sh"
  status=$?
  after_lines=$(wc -l < "$CYCLES")
  if [ "$status" -ne 0 ] && [ "$after_lines" -eq "$before_lines" ]; then
    record_failure "run-cycle exited $status before writing its verdict"
  fi

  # A short breath between cycles: the next one fetches, recons and adopts anything this
  # one left in flight.
  sleep 30
done

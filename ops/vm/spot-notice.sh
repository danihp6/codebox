#!/usr/bin/env bash

# EC2 gives two minutes between a spot interruption notice and the reclaim. This unit turns
# that window into one final uploaded backup plus a marker in the state directory, so a retry
# after a successful backup never uploads a second time.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=ops/vm/lib.sh
. "$here/lib.sh"

usage_text='usage: spot-notice.sh [--once] [--interval SECONDS] [--endpoint URL] [--state DIR]
                      [--backup-script FILE] [--help]'

once=0
interval=30
state=/var/lib/codebox/spot-notice
backup_script=/usr/local/lib/codebox/backup.sh
endpoint=${AWS_EC2_METADATA_SERVICE_ENDPOINT:-http://169.254.169.254}

while [ $# -gt 0 ]; do
  case "$1" in
    --once)
      once=1
      shift
      ;;
    --interval)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      interval=$2
      shift 2
      ;;
    --endpoint)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      endpoint=$2
      shift 2
      ;;
    --state)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      state=$2
      shift 2
      ;;
    --backup-script)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      backup_script=$2
      shift 2
      ;;
    --help)
      usage "$usage_text"
      ;;
    *)
      printf '%s\n' "$usage_text" >&2
      exit 2
      ;;
  esac
done

while [ "${endpoint%/}" != "$endpoint" ]; do endpoint=${endpoint%/}; done

need_bin curl node

mkdir -p "$state"
# The marker makes the final backup idempotent; the lock keeps a retry from racing the first
# run while it is still uploading.
exec 9>"$state/lock"
flock -n 9 || exit 0

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

no_notice() {
  if [ "$once" -eq 1 ]; then
    log "no spot notice"
    exit 0
  fi
}

rejected() {
  if [ "$once" -eq 1 ]; then
    die 6 "metadata token rejected"
  fi
  log "warn: metadata token rejected"
}

failed() {
  local code=$1
  if [ "$once" -eq 1 ]; then
    die 6 "metadata http $code"
  fi
  log "warn: metadata http $code"
}

handle() {
  local body=$1 notice_time marker
  notice_time=$(CB_BODY="$body" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    try {
      const parsed = JSON.parse(readFileSync(process.env.CB_BODY, "utf8"));
      if (typeof parsed.time === "string") process.stdout.write(parsed.time);
    } catch {
      process.stdout.write("");
    }
  ' || true)
  [ -n "$notice_time" ] || notice_time=$(cat "$body")
  marker=$state/final-$(printf '%s' "$notice_time" | sed 's/[^A-Za-z0-9]/-/g').done

  if [ -e "$marker" ]; then
    log "notice $notice_time already handled"
    exit 0
  fi

  if "$backup_script" --upload >&2; then
    cp "$body" "$marker" || die 6 "cannot write $marker"
    log "final backup for $notice_time"
    exit 0
  fi
  exit 6
}

poll() {
  local token code body
  body=$tmp/notice.json
  token=$(curl --max-time 2 -s -X PUT \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600' \
    "$endpoint/latest/api/token" 2>/dev/null || true)
  code=$(curl --max-time 2 -s -o "$body" -w '%{http_code}' \
    -H "X-aws-ec2-metadata-token: $token" \
    "$endpoint/latest/meta-data/spot/instance-action" 2>/dev/null || true)
  case "$code" in
    [0-9][0-9][0-9]) ;;
    *) code=000 ;;
  esac

  case "$code" in
    404) no_notice ;;
    200) handle "$body" ;;
    401 | 403) rejected ;;
    *) failed "$code" ;;
  esac
}

if [ "$once" -eq 1 ]; then
  poll
  exit 0
fi

while :; do
  poll
  sleep "$interval"
done

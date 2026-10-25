#!/usr/bin/env bash

# Measures the box's own liveness instead of guessing at it (D39): two /proc samples one second
# apart, one JSON line appended to a log, then a bounded pass whose every step is optional. A
# synthetic load would game the Always Free rule and buy nothing, so this script only does work
# the box would do anyway and never fails because a piece of it is missing.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=ops/vm/lib.sh
. "$here/lib.sh"

usage_text='usage: keepalive.sh [--report] [--proc DIR] [--root DIR] [--log FILE]
                    [--health-url URL] [--cb PATH] [--help]'

report=0
proc_dir=/proc
log_path=
health_url=http://127.0.0.1:8787/v1/health
cb_path=

while [ $# -gt 0 ]; do
  case "$1" in
    --report)
      report=1
      shift
      ;;
    --proc)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      proc_dir=$2
      shift 2
      ;;
    --root)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      ROOT=$2
      shift 2
      ;;
    --log)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      log_path=$2
      shift 2
      ;;
    --health-url)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      health_url=$2
      shift 2
      ;;
    --cb)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      cb_path=$2
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

proc_dir=${proc_dir%/}
log_path=${log_path:-$(rooted /var/lib/codebox)/logs/keepalive.jsonl}

# The probe is the only thing this script may contact, so the host is checked before anything
# else runs: a flag that drifts off loopback is a usage error, not a network call.
authority=${health_url#*://}
authority=${authority%%/*}
case "$authority" in
  \[*\]:* | \[*\]) host=${authority%%]*}] ;;
  *) host=${authority%%:*} ;;
esac
case "$host" in
  127.0.0.1 | localhost | '[::1]') ;;
  *) die 2 "health-url is not loopback" ;;
esac

read_inputs() {
  local name path
  for name in stat meminfo net/dev loadavg uptime; do
    path=$(printf '%s/%s' "$proc_dir" "$name")
    [ -r "$path" ] || die 2 "$path is not readable"
  done
}

sample_cpu() {
  local user nice system idle iowait irq softirq steal
  read -r _ user nice system idle iowait irq softirq steal _ <"$proc_dir/stat" ||
    die 2 "$proc_dir/stat is not readable"
  cpu_total=$((user + nice + system + idle + iowait + irq + softirq + steal))
  cpu_idle=$((idle + iowait))
}

sample_net() {
  local line iface rx tx
  net_bytes=0
  while read -r line; do
    case "$line" in
      *:*) ;;
      *) continue ;;
    esac
    iface=${line%%:*}
    iface=${iface//[[:space:]]/}
    if [ "$iface" = lo ]; then
      continue
    fi
    line=${line/:/ }
    read -r iface rx _ _ _ _ _ _ _ tx _ <<<"$line"
    case "$rx$tx" in
      '' | *[!0-9]*) continue ;;
    esac
    net_bytes=$((net_bytes + rx + tx))
  done <"$proc_dir/net/dev"
}

sample_mem() {
  local key value
  mem_total=
  mem_available=
  while read -r key value _ _; do
    case "$key" in
      MemTotal:) mem_total=$value ;;
      MemAvailable:) mem_available=$value ;;
    esac
  done <"$proc_dir/meminfo"
  case "$mem_total" in
    '' | *[!0-9]*) die 2 "$proc_dir/meminfo is not readable" ;;
  esac
  case "$mem_available" in
    '' | *[!0-9]*) die 2 "$proc_dir/meminfo is not readable" ;;
  esac
}

format_pct() {
  printf '%.1f' "$(($1 / 10)).$(($1 % 10))"
}

read_inputs

sample_cpu
cpu_total1=$cpu_total
cpu_idle1=$cpu_idle
sleep 1

sample_cpu
cpu_total2=$cpu_total
cpu_idle2=$cpu_idle
sample_net
sample_mem
read -r load1_raw _ <"$proc_dir/loadavg" || die 2 "$proc_dir/loadavg is not readable"
read -r uptime_raw _ <"$proc_dir/uptime" || die 2 "$proc_dir/uptime is not readable"
at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cpu_busy_tenths=0
if [ "$cpu_total2" -gt "$cpu_total1" ]; then
  delta_total=$((cpu_total2 - cpu_total1))
  delta_idle=$((cpu_idle2 - cpu_idle1))
  [ "$delta_idle" -le "$delta_total" ] || delta_idle=$delta_total
  cpu_busy_tenths=$(((1000 * (delta_total - delta_idle) + delta_total / 2) / delta_total))
fi

mem_used_tenths=0
if [ "$mem_total" -gt 0 ]; then
  [ "$mem_available" -le "$mem_total" ] || mem_available=$mem_total
  mem_used_tenths=$(((1000 * (mem_total - mem_available) + mem_total / 2) / mem_total))
fi

line=$(printf '{"at":"%s","cpuBusyPct":%s,"memUsedPct":%s,"netBytes":%s,"load1":%s,"uptimeSeconds":%s}' \
  "$at" \
  "$(format_pct "$cpu_busy_tenths")" \
  "$(format_pct "$mem_used_tenths")" \
  "$net_bytes" \
  "$(printf '%.2f' "$load1_raw")" \
  "$(printf '%.0f' "$uptime_raw")")

mkdir -p "$(dirname "$log_path")"
printf '%s\n' "$line" >>"$log_path"

if [ "$report" -eq 1 ]; then
  printf '%s\n' "$line"
  exit 0
fi

# Resolution order: an explicit --cb, then the installed CLI, then the release's own entry point.
# An explicit path that is not executable counts as absent, which is how a test pins that case.
cb_argv=()
if [ -n "$cb_path" ]; then
  if [ -x "$cb_path" ]; then
    cb_argv=("$cb_path")
  fi
else
  cb_found=$(command -v cb || true)
  cb_entry=$(rooted /opt/codebox)/current/apps/daemon/bin/cb.mjs
  if [ -n "$cb_found" ]; then
    cb_argv=("$cb_found")
  elif [ -f "$cb_entry" ]; then
    cb_argv=(node "$cb_entry")
  fi
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if [ "${#cb_argv[@]}" -eq 0 ]; then
  log "step doctor skipped: absent"
  log "step prune skipped: absent"
else
  if timeout 120 "${cb_argv[@]}" doctor >"$tmp/doctor.out" 2>"$tmp/doctor.err"; then
    log "step doctor ok"
  else
    log "step doctor failed"
  fi
  # A CLI without `prune` is not an error: the step turns ok the day the command exists.
  if timeout 120 "${cb_argv[@]}" prune >"$tmp/prune.out" 2>"$tmp/prune.err"; then
    log "step prune ok"
  elif grep -q 'unknown command: prune' "$tmp/prune.err"; then
    log "step prune skipped: unsupported"
  else
    log "step prune failed"
  fi
fi

health_code=$(timeout 120 curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "$health_url" 2>/dev/null || :)
case "$health_code" in
  [0-9][0-9][0-9]) ;;
  *) health_code=000 ;;
esac
case "$health_code" in
  2[0-9][0-9]) log "step health ok" ;;
  *) log "step health skipped: http $health_code" ;;
esac

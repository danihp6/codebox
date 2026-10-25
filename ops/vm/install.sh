#!/usr/bin/env bash

# Installs one release artifact under <root>/opt/codebox and, unless --no-restart, moves the
# `current` symlink and restarts the daemon, rolling the link back when the daemon does not
# answer. It never writes the database: migrations run in the daemon at boot (openStore), and
# it never reads instance.env, so it cannot leak a secret.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=ops/vm/lib.sh
. "$here/lib.sh"

usage_text='usage: install.sh --artifact FILE --version V --sha256 HEX
                  [--root DIR] [--no-restart]
                  [--health-url URL] [--health-timeout SECONDS] [--help]'

artifact=
version=
sha256=
no_restart=0
health_url=http://127.0.0.1:8787/v1/health
health_timeout=60

while [ $# -gt 0 ]; do
  case "$1" in
    --artifact)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      artifact=$2
      shift 2
      ;;
    --version)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      version=$2
      shift 2
      ;;
    --sha256)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      sha256=$2
      shift 2
      ;;
    --root)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      ROOT=$2
      shift 2
      ;;
    --no-restart)
      no_restart=1
      shift
      ;;
    --health-url)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      health_url=$2
      shift 2
      ;;
    --health-timeout)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      health_timeout=$2
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

for name in artifact version sha256; do
  if [ -z "${!name:-}" ]; then
    printf '%s\n' "$usage_text" >&2
    die 2 "$name is empty"
  fi
done
[[ "$health_timeout" =~ ^[0-9]+$ ]] || die 2 "health-timeout is not a number"

[ -f "$artifact" ] || die 2 "$artifact is not a file"
need_bin sha256sum tar

actual=$(sha256sum "$artifact" | cut -d' ' -f1 | tr '[:upper:]' '[:lower:]')
expected=$(printf '%s' "$sha256" | tr '[:upper:]' '[:lower:]')
[ "$actual" = "$expected" ] || die 3 "checksum mismatch: $actual != $expected"

install_dir=$(rooted /opt/codebox)
release="$install_dir/releases/$version"
mkdir -p "$release"

if [ -f "$release/apps/daemon/dist/main.js" ]; then
  log "reuse $release"
else
  tar -xzf "$artifact" -C "$release" || die 6 "cannot unpack $artifact"
  if [ ! -f "$release/apps/daemon/dist/main.js" ]; then
    rm -rf "$release"
    die 6 "artifact has no apps/daemon/dist/main.js"
  fi

  if [ -L "$install_dir/current" ] || [ -e "$install_dir/current" ]; then
    ln -sfn "$(readlink "$install_dir/current")" "$install_dir/previous"
  fi
  # Relative, so the whole prefix can move and the link still resolves.
  ln -sfn "releases/$version" "$install_dir/current"
fi

printf 'installed %s %s\n' "$version" "$release"

if [ "$no_restart" -eq 1 ]; then
  exit 0
fi

need_bin systemctl curl
if ! systemctl daemon-reload || ! systemctl restart codebox.service; then
  die 4 "cannot restart codebox.service"
fi

healthy=0
deadline=$((SECONDS + health_timeout))
while [ "$SECONDS" -le "$deadline" ]; do
  status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "$health_url" 2>/dev/null || true)
  if [[ "$status" =~ ^[0-9]{3}$ ]] && [ "$status" -lt 600 ]; then
    healthy=1
    break
  fi
  sleep 1
done

if [ "$healthy" -ne 1 ]; then
  if [ -L "$install_dir/previous" ]; then
    ln -sfn "$(readlink "$install_dir/previous")" "$install_dir/current"
  fi
  systemctl restart codebox.service || true
  die 4 "unhealthy after restart"
fi

log "healthy on $health_url"

#!/usr/bin/env bash

# The build's own gate: one line per check, exit 1 if any of them fails, so a Packer build
# that would produce a broken or leaky image produces no image at all. It is also the checker
# the repository's tests run against a stub root.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# Installed next to lib.sh in /usr/local/lib/codebox; in the repository it lives in
# ops/image/scripts, one level away from ops/vm.
if [ -f "$here/lib.sh" ]; then
  # shellcheck source=/dev/null
  . "$here/lib.sh"
else
  # shellcheck source=../../vm/lib.sh
  . "$here/../../vm/lib.sh"
fi

usage_text='usage: 90-verify.sh [--root DIR] [--only CHECK] [--help]
checks: runtime tools units user layout secrets image browser   (default: all)'

only=all

while [ $# -gt 0 ]; do
  case "$1" in
    --root)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      ROOT=$2
      shift 2
      ;;
    --only)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      only=$2
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

checks=(runtime tools units user layout secrets image browser)
case " ${checks[*]} " in
  *" $only "*) ;;
  *) printf '%s\n' "$usage_text" >&2; die 2 "$only is not a check" ;;
esac

patterns=(ghp_ ghs_ gho_ ghu_ github_pat_ '-----BEGIN' cf-tunnel sk- xoxb- AKIA)
units=(codebox.service codebox-opencode.service cloudflared.service codebox-backup.service
  codebox-backup.timer)
tools=(git gh sqlite3 age jq cloudflared opencode)

check_runtime() {
  local version
  if ! version=$(node --version 2>/dev/null) || [[ "$version" != v24.* ]]; then
    printf 'fail runtime node %s\n' "${version:-missing}"
    return 1
  fi
  if ! version=$(npm --version 2>/dev/null); then
    printf 'fail runtime npm missing\n'
    return 1
  fi
  if ! version=$(corepack --version 2>/dev/null); then
    printf 'fail runtime corepack missing\n'
    return 1
  fi
  printf 'ok runtime\n'
}

check_tools() {
  local tool
  for tool in "${tools[@]}"; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      printf 'fail tools %s is missing\n' "$tool"
      return 1
    fi
    if ! "$tool" --version >/dev/null 2>&1; then
      printf 'fail tools %s --version\n' "$tool"
      return 1
    fi
  done
  printf 'ok tools\n'
}

check_units() {
  local name file
  for name in "${units[@]}"; do
    if ! systemctl --root="$ROOT" is-enabled --quiet "$name" 2>/dev/null; then
      printf 'fail units %s is not enabled\n' "$name"
      return 1
    fi
  done
  for name in "${units[@]}"; do
    file=$(rooted /etc/systemd/system)/$name
    [ -f "$file" ] || continue
    if ! systemd-analyze verify "$file" >/dev/null 2>&1; then
      printf 'fail units systemd-analyze %s\n' "$file"
      return 1
    fi
  done
  printf 'ok units\n'
}

check_user() {
  local shell entry status
  if ! entry=$(getent passwd codebox); then
    printf 'fail user codebox is missing\n'
    return 1
  fi
  shell=$(printf '%s' "$entry" | cut -d: -f7)
  case "$shell" in
    /usr/sbin/nologin | /sbin/nologin | /bin/false) ;;
    *)
      printf 'fail user codebox shell is %s\n' "$shell"
      return 1
      ;;
  esac
  status=$(passwd -S codebox 2>/dev/null | cut -d' ' -f2)
  case "$status" in
    L | NP) ;;
    *)
      printf 'fail user codebox password state is %s\n' "${status:-unknown}"
      return 1
      ;;
  esac
  printf 'ok user\n'
}

check_layout() {
  local dir
  dir=$(rooted /opt/codebox)
  if [ -d "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
    printf 'fail layout %s is not empty\n' "$dir"
    return 1
  fi
  printf 'ok layout\n'
}

check_secrets() {
  local dir pattern hit
  for dir in "$(rooted /etc)" "$(rooted /opt)" "$(rooted /var/lib)"; do
    [ -d "$dir" ] || continue
    for pattern in "${patterns[@]}"; do
      hit=$(grep -RIl -- "$pattern" "$dir" 2>/dev/null | head -n 1 || true)
      if [ -n "$hit" ]; then
        printf 'fail secrets %s:%s\n' "$hit" "$pattern"
        return 1
      fi
    done
  done
  printf 'ok secrets\n'
}

check_image() {
  local file line key value
  file=$(rooted /etc/codebox)/image.json
  if [ ! -f "$file" ]; then
    printf 'fail image %s is missing\n' "$file"
    return 1
  fi
  if ! node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const manifest = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const missing = ["version", "commit", "builtAt", "node", "opencode", "cloudflared"].filter(
      (key) => !(key in manifest),
    );
    if (missing.length > 0) {
      process.stderr.write(`missing ${missing.join(",")}\n`);
      process.exit(1);
    }
  ' "$file"; then
    printf 'fail image %s does not parse\n' "$file"
    return 1
  fi
  for file in "$(rooted /etc/codebox)"/*; do
    [ -f "$file" ] || continue
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        '' | '#'*) continue ;;
        *=*) ;;
        *) continue ;;
      esac
      key=${line%%=*}
      value=${line#*=}
      case "$key" in
        '' | *[!A-Z0-9_]* | [0-9]*) continue ;;
      esac
      case "$value" in
        '' | '[redacted]') ;;
        *)
          printf 'fail image %s: %s has a value\n' "$file" "$key"
          return 1
          ;;
      esac
    done <"$file"
  done
  printf 'ok image\n'
}

check_browser() {
  local dir file revision binary library
  dir=$(rooted /opt/ms-playwright)
  if [ ! -d "$dir" ]; then
    printf 'fail browser %s is missing\n' "$dir"
    return 1
  fi
  file=$(rooted /etc/environment)
  if [ ! -f "$file" ] || ! grep -qx 'PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright' "$file"; then
    printf 'fail browser %s does not set PLAYWRIGHT_BROWSERS_PATH\n' "$file"
    return 1
  fi
  revision=$(find "$dir" -mindepth 1 -maxdepth 1 -type d -name 'chromium-*' -printf '%f\n' \
    2>/dev/null | sort -V | tail -n 1 || true)
  if [ -z "$revision" ]; then
    printf 'fail browser no chromium revision under %s\n' "$dir"
    return 1
  fi
  binary=$(find "$dir/$revision" -maxdepth 3 -type f -name chrome 2>/dev/null | sort -V |
    tail -n 1 || true)
  if [ -z "$binary" ]; then
    printf 'fail browser no chrome binary under %s\n' "$dir/$revision"
    return 1
  fi
  if [ ! -x "$binary" ]; then
    printf 'fail browser %s is not executable\n' "$binary"
    return 1
  fi
  library=$(ldd "$binary" 2>/dev/null | awk '/not found/ {print $1; exit}' || true)
  if [ -n "$library" ]; then
    printf 'fail browser %s needs %s\n' "$binary" "$library"
    return 1
  fi
  if ! timeout 60 "$binary" --headless=new --no-sandbox --disable-dev-shm-usage \
    --dump-dom about:blank >/dev/null 2>&1; then
    printf 'fail browser headless launch failed\n'
    return 1
  fi
  printf 'ok browser\n'
}

failed=0
for check in "${checks[@]}"; do
  if [ "$only" != all ] && [ "$only" != "$check" ]; then
    continue
  fi
  "check_$check" || failed=1
done

[ "$failed" -eq 0 ] || exit 1

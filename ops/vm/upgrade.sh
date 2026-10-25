#!/usr/bin/env bash

# The release axis of `docs/vm-image.md` §6: a thin wrapper over install.sh plus the two
# operations the operator needs on the box — roll the symlinks back and prune the releases
# that will never be rolled back to. It never touches /etc/codebox, the database or a secret.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=ops/vm/lib.sh
. "$here/lib.sh"

usage_text='usage: upgrade.sh (--artifact FILE --version V --sha256 HEX | --rollback)
                  [--root DIR] [--no-restart] [--prune] [--help]'

artifact=
version=
sha256=
rollback=0
no_restart=0
prune=0

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
    --rollback)
      rollback=1
      shift
      ;;
    --no-restart)
      no_restart=1
      shift
      ;;
    --prune)
      prune=1
      shift
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

prune_releases() {
  local releases name kept
  releases="$(rooted /opt/codebox)/releases"
  [ -d "$releases" ] || return 0
  kept=2
  for name in $(find "$releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
    LC_ALL=C sort -V |
    awk -v keep="$kept" '{ line[NR] = $0 } END { for (i = 1; i <= NR - keep; i++) print line[i] }'); do
    printf 'prune %s\n' "$releases/$name"
    rm -rf "${releases:?}/$name"
  done
}

if [ "$rollback" -eq 1 ]; then
  install_dir=$(rooted /opt/codebox)
  previous="$install_dir/previous"
  current="$install_dir/current"
  { [ -e "$previous" ] && [ -L "$previous" ]; } || die 5 "no previous release"
  old_previous=$(readlink "$previous")
  old_current=$(readlink "$current" 2>/dev/null || true)
  [ -n "$old_previous" ] || die 5 "no previous release"
  if [ -n "$old_current" ]; then
    ln -sfn "$old_current" "$previous"
  else
    rm -f "$previous"
  fi
  ln -sfn "$old_previous" "$current"
  printf 'rolled back to %s\n' "${old_previous##*/}"
  exit 0
fi

for name in artifact version sha256; do
  if [ -z "${!name:-}" ]; then
    printf '%s\n' "$usage_text" >&2
    die 2 "$name is empty"
  fi
done

args=(--artifact "$artifact" --version "$version" --sha256 "$sha256" --root "$ROOT")
if [ "$no_restart" -eq 1 ]; then
  args+=(--no-restart)
fi

status=0
bash "$here/install.sh" "${args[@]}" || status=$?
[ "$status" -eq 0 ] || exit "$status"

if [ "$prune" -eq 1 ]; then
  prune_releases
fi

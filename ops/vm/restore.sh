#!/usr/bin/env bash

# Puts a backup back on the box. It never starts or stops a unit: the daemon is expected to be
# stopped, because a writer next to a replaced database is how a restore loses its last hour.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=ops/vm/lib.sh
. "$here/lib.sh"

usage_text='usage: restore.sh --from ARCHIVE [--db FILE] [--identity FILE] [--plaintext] [--force]
                  [--verify] [--root DIR] [--help]'

from=
db=
identity=${CB_BACKUP_AGE_IDENTITY:-}
plaintext=0
force=0
verify=0

while [ $# -gt 0 ]; do
  case "$1" in
    --from)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      from=$2
      shift 2
      ;;
    --db)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      db=$2
      shift 2
      ;;
    --identity)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      identity=$2
      shift 2
      ;;
    --plaintext)
      plaintext=1
      shift
      ;;
    --force)
      force=1
      shift
      ;;
    --verify)
      verify=1
      shift
      ;;
    --root)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      ROOT=$2
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

[ -n "$from" ] || { printf '%s\n' "$usage_text" >&2; die 2 "from is empty"; }
db=${db:-$(rooted /var/lib/codebox)/state.db}

count_rows() {
  CB_DB=$1 node --input-type=module -e '
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.env.CB_DB, { readOnly: true });
    const count = (table) => {
      try {
        return db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
      } catch {
        return 0;
      }
    };
    process.stdout.write(`runs=${count("runs")} jobs=${count("jobs")} routines=${count("routines")}`);
    db.close();
  '
}

[ -f "$from" ] || die 6 "no archive at $from"
if [ "$verify" -ne 1 ] && [ "$force" -ne 1 ] && [ -e "$db" ]; then
  die 2 "$db exists, use --force"
fi

need_bin node tar
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

tarball=$from
case "$from" in
  *.age)
    if [ "$plaintext" -eq 0 ]; then
      need_bin age
      [ -n "$identity" ] || die 2 "CB_BACKUP_AGE_IDENTITY is empty"
      tarball=$tmp/archive.tar.gz
      age -d -i "$identity" -o "$tarball" "$from" || die 6 "cannot decrypt $from"
    fi
    ;;
esac

tar -xzf "$tarball" -C "$tmp" state.db || die 6 "bad archive $from"
[ -f "$tmp/state.db" ] || die 6 "bad archive $from"
rows=$(count_rows "$tmp/state.db") || die 6 "bad database in $from"

if [ "$verify" -eq 1 ]; then
  printf 'verify ok %s\n' "$rows"
  exit 0
fi

mkdir -p "$(dirname "$db")"
if [ "${ROOT%/}" = "" ] && [ "$(id -u)" -eq 0 ]; then
  install -m 0640 -o codebox -g codebox "$tmp/state.db" "$db" || die 6 "cannot install $db"
else
  install -m 0640 "$tmp/state.db" "$db" || die 6 "cannot install $db"
fi

printf 'restored %s %s\n' "$db" "$rows"

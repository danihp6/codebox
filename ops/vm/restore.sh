#!/usr/bin/env bash

# Puts a backup back on the box, from a local file or from the S3-compatible target itself. It
# never starts or stops a unit: the daemon is expected to be stopped, because a writer next to
# a replaced database is how a restore loses its last hour.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=ops/vm/lib.sh
. "$here/lib.sh"

usage_text='usage: restore.sh (--from ARCHIVE | --remote KEY | --latest) [--db FILE] [--identity FILE]
                  [--plaintext] [--force] [--verify] [--s3-uri URI] [--root DIR] [--help]'

from=
remote=
latest=0
s3_uri=${CB_BACKUP_S3_URI:-}
db=
identity=${CB_BACKUP_AGE_IDENTITY:-}
plaintext=0
force=0
verify=0
tmp=

while [ $# -gt 0 ]; do
  case "$1" in
    --from)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      from=$2
      shift 2
      ;;
    --remote)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      remote=$2
      shift 2
      ;;
    --latest)
      latest=1
      shift
      ;;
    --s3-uri)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      s3_uri=$2
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

sources=0
if [ -n "$from" ]; then sources=$((sources + 1)); fi
if [ -n "$remote" ]; then sources=$((sources + 1)); fi
if [ "$latest" -eq 1 ]; then sources=$((sources + 1)); fi
if [ "$sources" -eq 0 ]; then
  printf '%s\n' "$usage_text" >&2
  die 2 "from is empty"
fi
if [ "$sources" -gt 1 ]; then
  printf '%s\n' "$usage_text" >&2
  die 2 "exactly one of --from, --remote or --latest"
fi

db=${db:-$(rooted /var/lib/codebox)/state.db}

# The pointer lives at <prefix>/_latest and its body is the full object key, which is what
# backup.sh --fetch expects: no bucket, no endpoint, no prefix added twice.
latest_key() {
  local rest=${1#s3://}
  case "$rest" in
    */*) rest=${rest#*/} ;;
    *) rest= ;;
  esac
  while [ "${rest#/}" != "$rest" ]; do rest=${rest#/}; done
  while [ "${rest%/}" != "$rest" ]; do rest=${rest%/}; done
  case "$rest" in
    '') printf '_latest' ;;
    *) printf '%s/_latest' "$rest" ;;
  esac
}

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

fetch_object() {
  local key=$1 target=$2 status=0
  bash "$here/backup.sh" --fetch "$key" --s3-uri "$s3_uri" --root "$ROOT" >"$target" || status=$?
  return "$status"
}

if [ "$latest" -eq 1 ] || [ -n "$remote" ]; then
  [ -n "$s3_uri" ] || die 2 "CB_BACKUP_S3_URI is empty"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  if [ "$latest" -eq 1 ]; then
    fetch_object "$(latest_key "$s3_uri")" "$tmp/latest" || exit $?
    remote=$(cat "$tmp/latest")
    [ -n "$remote" ] || die 6 "_latest is empty"
  fi

  case "$remote" in
    *.age) from=$tmp/object.age ;;
    *) from=$tmp/object.tar.gz ;;
  esac
  fetch_object "$remote" "$from" || exit $?
fi

[ -f "$from" ] || die 6 "no archive at $from"
if [ "$verify" -ne 1 ] && [ "$force" -ne 1 ] && [ -e "$db" ]; then
  die 2 "$db exists, use --force"
fi

need_bin node tar
if [ -z "$tmp" ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
fi

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

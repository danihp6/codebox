#!/usr/bin/env bash

# Writes one restorable backup of the box: a consistent SQLite snapshot, the configuration
# without its credentials and a manifest, age-encrypted by default. The age private key never
# lives here — restoring needs an identity file the operator holds (docs/security.md §7).

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=ops/vm/lib.sh
. "$here/lib.sh"

usage_text='usage: backup.sh [--db FILE] [--out DIR] [--recipient AGE_RECIPIENT] [--plaintext]
                 [--verify] [--upload] [--root DIR] [--help]'

db=
out=
recipient=${CB_BACKUP_AGE_RECIPIENT:-}
plaintext=0
verify=0
upload=0

while [ $# -gt 0 ]; do
  case "$1" in
    --db)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      db=$2
      shift 2
      ;;
    --out)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      out=$2
      shift 2
      ;;
    --recipient)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      recipient=$2
      shift 2
      ;;
    --plaintext)
      plaintext=1
      shift
      ;;
    --verify)
      verify=1
      shift
      ;;
    --upload)
      upload=1
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

# The daemon's own secret list (packages/contracts/src/config.ts): a backup carries the
# configuration, never a credential.
secret_keys=(
  CB_SESSION_SECRET
  CB_GITHUB_APP_PRIVATE_KEY_BASE64
  CB_GITHUB_WEBHOOK_SECRET
  CB_GITHUB_TOKEN
  CB_OPENCODE_TOKEN
  CB_VAPID_PRIVATE_KEY
  CB_FCM_SERVICE_ACCOUNT_BASE64
  CB_APNS_PRIVATE_KEY_BASE64
  CB_TUNNEL_TOKEN
)

db=${db:-$(rooted /var/lib/codebox)/state.db}
out=${out:-$(rooted /var/lib/codebox)/backups}
image_json=$(rooted /etc/codebox)/image.json
instance_env=$(rooted /etc/codebox)/instance.env

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

redact_env() {
  local source=$1 line key entry
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      '' | '#'*)
        printf '%s\n' "$line"
        continue
        ;;
    esac
    key=${line%%=*}
    for entry in "${secret_keys[@]}"; do
      if [ "$key" = "$entry" ]; then
        printf '%s=[redacted]\n' "$key"
        continue 2
      fi
    done
    printf '%s\n' "$line"
  done <"$source"
}

newest_archive() {
  local found
  found=$(find "$out" -maxdepth 1 -type f \( -name '*.age' -o -name '*.tar.gz' \) \
    -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -n 1 | cut -d' ' -f2-)
  [ -n "$found" ] || die 6 "no backup in $out"
  printf '%s' "$found"
}

open_archive() {
  local archive=$1 target=$2
  case "$archive" in
    *.age)
      need_bin age
      [ -n "${CB_BACKUP_AGE_IDENTITY:-}" ] || die 2 "CB_BACKUP_AGE_IDENTITY is empty"
      age -d -i "$CB_BACKUP_AGE_IDENTITY" -o "$target" "$archive" || die 6 "cannot decrypt $archive"
      ;;
    *) cp "$archive" "$target" ;;
  esac
}

if [ "$verify" -eq 1 ]; then
  need_bin node tar
  archive=$(newest_archive)
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  open_archive "$archive" "$tmp/archive.tar.gz"
  tar -xzf "$tmp/archive.tar.gz" -C "$tmp" state.db || die 6 "bad archive $archive"
  [ -f "$tmp/state.db" ] || die 6 "bad archive $archive"
  rows=$(count_rows "$tmp/state.db") || die 6 "bad database in $archive"
  printf 'verify ok %s\n' "$rows"
  exit 0
fi

need_bin node tar
[ -f "$db" ] || die 6 "no database at $db"

if [ "$plaintext" -eq 0 ]; then
  [ -n "$recipient" ] || die 2 "CB_BACKUP_AGE_RECIPIENT is empty"
  need_bin age
fi
if [ "$upload" -eq 1 ] && [ "$plaintext" -eq 1 ]; then
  die 2 "CB_BACKUP_AGE_RECIPIENT is empty"
fi

mkdir -p "$out"
out=$(cd "$out" && pwd)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# VACUUM INTO needs its destination as an SQL literal, so the literal is built here and
# travels in the environment; the script keeps no nested quoting of its own.
snapshot() {
  CB_SRC="$db" \
    CB_SQL="VACUUM INTO '$(printf '%s' "$tmp/state.db" | sed "s/'/''/g")'" \
    node --input-type=module -e '
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(process.env.CB_SRC);
      db.exec(process.env.CB_SQL);
      db.close();
    '
}
snapshot || die 6 "cannot snapshot $db"

encrypted=false
[ "$plaintext" -eq 0 ] && encrypted=true
db_bytes=$(wc -c <"$tmp/state.db" | tr -d ' ')
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

CB_IMAGE_JSON="$image_json" CB_DB_BYTES="$db_bytes" CB_ENCRYPTED="$encrypted" \
  CB_CREATED_AT="$created_at" CB_MANIFEST="$tmp/manifest.json" node --input-type=module -e '
    import { readFileSync, writeFileSync } from "node:fs";
    let version = null;
    try {
      const image = JSON.parse(readFileSync(process.env.CB_IMAGE_JSON, "utf8"));
      if (typeof image.version === "string") version = image.version;
    } catch {
      version = null;
    }
    const manifest = {
      version,
      createdAt: process.env.CB_CREATED_AT,
      dbBytes: Number(process.env.CB_DB_BYTES),
      encrypted: process.env.CB_ENCRYPTED === "true",
    };
    writeFileSync(process.env.CB_MANIFEST, JSON.stringify(manifest) + "\n");
  ' || die 6 "cannot write manifest"

if [ -f "$instance_env" ]; then
  redact_env "$instance_env" >"$tmp/instance.env"
else
  log "warn: no $instance_env"
  : >"$tmp/instance.env"
fi

tar -czf "$tmp/archive.tar.gz" -C "$tmp" state.db manifest.json instance.env ||
  die 6 "cannot archive $db"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
if [ "$plaintext" -eq 1 ]; then
  log "warn: plaintext backup"
  archive=$out/cb-backup-$stamp.tar.gz
  cp "$tmp/archive.tar.gz" "$archive"
else
  archive=$out/cb-backup-$stamp.age
  age -r "$recipient" -o "$archive" "$tmp/archive.tar.gz" || die 6 "cannot encrypt $archive"
fi
chmod 0640 "$archive"
printf 'archive %s\n' "$archive"

if [ "$upload" -eq 1 ]; then
  need_bin oci
  bucket=${CB_BACKUP_BUCKET:-cb-backups}
  day=$(date -u +%Y/%m/%d)
  oci os object put --bucket-name "$bucket" --file "$archive" --name "db/$day.age" --force ||
    die 6 "cannot upload db/$day.age"
  log "uploaded db/$day.age"
fi

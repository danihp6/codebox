#!/usr/bin/env bash

# Writes one restorable backup of the box: a consistent SQLite snapshot, the configuration
# without its credentials and a manifest, age-encrypted by default, then uploads it to any
# S3-compatible target on request. The age private key never lives here — restoring needs an
# identity file the operator holds (docs/security.md §7).

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=ops/vm/lib.sh
. "$here/lib.sh"

usage_text='usage: backup.sh [--db FILE] [--out DIR] [--recipient AGE_RECIPIENT] [--plaintext]
                 [--verify] [--upload] [--fetch KEY] [--s3-uri URI] [--root DIR] [--help]'

db=
out=
recipient=${CB_BACKUP_AGE_RECIPIENT:-}
plaintext=0
verify=0
upload=0
fetch=
s3_uri=${CB_BACKUP_S3_URI:-}

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
    --fetch)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      fetch=$2
      shift 2
      ;;
    --s3-uri)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      s3_uri=$2
      shift 2
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

# Every S3 call of this script lives in this one Node program: SigV4, the credentials, the
# transfer, the prune and the verification. It writes only the fetched bytes to stdout and
# every diagnostic to stderr, like the rest of the script.
s3_node='
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const die = (code, message) => {
  process.stderr.write(`codebox: error: ${message}\n`);
  process.exit(code);
};
const warn = (message) => process.stderr.write(`codebox: warn: ${message}\n`);
const sha256hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
const encode = (value) =>
  encodeURIComponent(value).replace(
    /[!\x27()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const target = process.env.CB_S3_URI ?? "";
const parsed = /^s3:\/\/([A-Za-z0-9][A-Za-z0-9.-]*)(\/.*)?$/.exec(target);
if (!parsed) die(2, "CB_BACKUP_S3_URI is not an s3:// URI");
const bucket = parsed[1];
const prefix = (parsed[2] ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
const region =
  process.env.CB_S3_REGION ||
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  "eu-west-1";
const endpoint = (
  process.env.CB_S3_ENDPOINT || `https://s3.${region}.amazonaws.com`
).replace(/\/+$/, "");
const imds = (
  process.env.AWS_EC2_METADATA_SERVICE_ENDPOINT || "http://169.254.169.254"
).replace(/\/+$/, "");
const withPrefix = (name) => (prefix === "" ? name : `${prefix}/${name}`);

const readCredentials = async () => {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      token: process.env.AWS_SESSION_TOKEN || "",
    };
  }
  try {
    const tokenResponse = await fetch(`${imds}/latest/api/token`, {
      method: "PUT",
      headers: { "x-aws-ec2-metadata-token-ttl-seconds": "21600" },
      signal: AbortSignal.timeout(2000),
    });
    if (!tokenResponse.ok) return null;
    const token = await tokenResponse.text();
    const roleResponse = await fetch(`${imds}/latest/meta-data/iam/security-credentials/`, {
      headers: { "x-aws-ec2-metadata-token": token },
      signal: AbortSignal.timeout(2000),
    });
    if (!roleResponse.ok) return null;
    const role = (await roleResponse.text()).trim().split("\n")[0];
    if (role === "") return null;
    const credentialResponse = await fetch(
      `${imds}/latest/meta-data/iam/security-credentials/${encodeURIComponent(role)}`,
      { headers: { "x-aws-ec2-metadata-token": token }, signal: AbortSignal.timeout(2000) },
    );
    if (!credentialResponse.ok) return null;
    const body = await credentialResponse.json();
    if (typeof body.AccessKeyId !== "string" || typeof body.SecretAccessKey !== "string") {
      return null;
    }
    return {
      accessKeyId: body.AccessKeyId,
      secretAccessKey: body.SecretAccessKey,
      token: typeof body.Token === "string" ? body.Token : "",
    };
  } catch {
    return null;
  }
};

const signed = async (credentials, method, key, options = {}) => {
  const body = options.body;
  const payloadHash = sha256hex(body ?? Buffer.alloc(0));
  const path =
    key === ""
      ? `/${encode(bucket)}`
      : `/${encode(bucket)}/${key.split("/").map(encode).join("/")}`;
  const query = Object.entries(options.query ?? {})
    .map(([name, value]) => `${encode(name)}=${encode(value)}`)
    .sort()
    .join("&");
  const url = `${endpoint}${path}${query === "" ? "" : `?${query}`}`;
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const headers = {
    host: new URL(url).host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": date,
  };
  if (credentials.token !== "") headers["x-amz-security-token"] = credentials.token;
  if (options.metaSha256) headers["x-amz-meta-sha256"] = options.metaSha256;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const canonicalRequest = [
    method,
    path,
    query,
    canonicalHeaders,
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${date.slice(0, 8)}/${region}/s3/aws4_request`;
  const toSign = [
    "AWS4-HMAC-SHA256",
    date,
    scope,
    sha256hex(Buffer.from(canonicalRequest)),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, date.slice(0, 8)), region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  return fetch(url, {
    method,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
};

const decodeXml = (value) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, `"`)
    .replace(/&apos;/g, `&#39;`)
    .replace(/&amp;/g, "&");

const listKeys = async (credentials) => {
  const keys = [];
  let token = "";
  for (;;) {
    const query = { "list-type": "2", prefix: withPrefix("db/") };
    if (token !== "") query["continuation-token"] = token;
    const response = await signed(credentials, "GET", "", { query });
    if (!response.ok) throw new Error(`list failed with ${response.status}`);
    const text = await response.text();
    for (const match of text.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) keys.push(decodeXml(match[1]));
    if (!/<IsTruncated>true<\/IsTruncated>/.test(text)) return keys;
    const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(text);
    if (!next) return keys;
    token = decodeXml(next[1]);
  }
};

const dailyKey = (key) => {
  const head = prefix === "" ? "" : `${prefix}/`;
  if (head !== "" && !key.startsWith(head)) return null;
  const relative = key.slice(head.length);
  return /^db\/\d{4}\/\d{2}\/\d{2}\.age$/.test(relative) ? relative : null;
};

const prune = async (credentials) => {
  const daily = (await listKeys(credentials)).filter((key) => dailyKey(key) !== null);
  daily.sort();
  const keep = new Set(daily.slice(-30));
  for (const key of daily) {
    if (keep.has(key)) continue;
    try {
      const response = await signed(credentials, "DELETE", key);
      if (!response.ok) warn(`cannot prune ${key}`);
    } catch {
      warn(`cannot prune ${key}`);
    }
  }
};

const upload = async (credentials) => {
  const key = process.env.CB_OBJECT_KEY ?? "";
  const hash = process.env.CB_HASH ?? "";
  const archive = readFileSync(process.env.CB_ARCHIVE ?? "");
  const pointer = `${key}\n`;

  const put = await signed(credentials, "PUT", key, { body: archive, metaSha256: hash });
  if (!put.ok) die(6, `cannot upload ${key}`);
  const putPointer = await signed(credentials, "PUT", withPrefix("_latest"), {
    body: Buffer.from(pointer),
  });
  if (!putPointer.ok) die(6, `cannot upload ${withPrefix("_latest")}`);

  await prune(credentials);

  const head = await signed(credentials, "HEAD", key);
  const latest = await signed(credentials, "GET", withPrefix("_latest"));
  if (head.status !== 200 || latest.status !== 200) die(6, `cannot verify ${key}`);
  if (head.headers.get("content-length") !== String(archive.byteLength)) {
    die(6, `cannot verify ${key}`);
  }
  if (head.headers.get("x-amz-meta-sha256") !== hash) die(6, `cannot verify ${key}`);
  if ((await latest.text()) !== pointer) die(6, `cannot verify ${key}`);
};

const fetchObject = async (credentials) => {
  const key = process.env.CB_OBJECT_KEY ?? "";
  const response = await signed(credentials, "GET", key);
  if (!response.ok) die(6, `cannot fetch ${key}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) !== bytes.byteLength) die(6, `short read ${key}`);
  process.stdout.write(bytes);
};

const credentials = await readCredentials();
if (credentials === null) die(2, "AWS credentials are empty");

try {
  if (process.env.CB_S3_OP === "upload") await upload(credentials);
  else if (process.env.CB_S3_OP === "fetch") await fetchObject(credentials);
  else die(2, "CB_S3_OP is not set");
} catch (error) {
  die(6, error instanceof Error ? error.message : String(error));
}
'

valid_key() {
  local key=$1
  case "$key" in
    '' | /*) return 1 ;;
  esac
  case "$key" in
    *[!A-Za-z0-9._/-]*) return 1 ;;
  esac
  case "/$key/" in
    *'/../'*) return 1 ;;
  esac
  return 0
}

# The prefix of s3://bucket[/prefix]: no leading or trailing slash, empty for a bare bucket.
s3_prefix() {
  local rest=${1#s3://}
  case "$rest" in
    */*) rest=${rest#*/} ;;
    *) rest= ;;
  esac
  while [ "${rest#/}" != "$rest" ]; do rest=${rest#/}; done
  while [ "${rest%/}" != "$rest" ]; do rest=${rest%/}; done
  printf '%s' "$rest"
}

# --fetch short-circuits before the database, the recipient and the archive, exactly like
# --verify: it is a transfer, not a backup.
if [ -n "$fetch" ]; then
  valid_key "$fetch" || die 2 "$fetch is not a valid object key"
  [ -n "$s3_uri" ] || die 2 "CB_BACKUP_S3_URI is empty"
  need_bin node
  CB_S3_URI="$s3_uri" \
    CB_S3_ENDPOINT="${CB_BACKUP_S3_ENDPOINT:-}" \
    CB_S3_REGION="${CB_BACKUP_S3_REGION:-}" \
    CB_S3_OP=fetch \
    CB_OBJECT_KEY="$fetch" \
    node --input-type=module -e "$s3_node"
  exit 0
fi

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
  hash=$(CB_FILE="$archive" node --input-type=module -e '
    import { createHash } from "node:crypto";
    import { readFileSync } from "node:fs";
    process.stdout.write(
      createHash("sha256").update(readFileSync(process.env.CB_FILE)).digest("hex"),
    );
  ') || die 6 "cannot hash $archive"
  printf '%s  %s\n' "$hash" "$(basename "$archive")" >"$archive.sha256"

  # The local archive is already on disk, so a missing target stops the run here and leaves
  # today's copy behind instead of losing both.
  [ -n "$s3_uri" ] || die 2 "CB_BACKUP_S3_URI is empty"

  prefix=$(s3_prefix "$s3_uri")
  key=db/$(date -u +%Y/%m/%d).age
  if [ -n "$prefix" ]; then key=$prefix/$key; fi
  valid_key "$key" || die 2 "$key is not a valid object key"

  status=0
  CB_S3_URI="$s3_uri" \
    CB_S3_ENDPOINT="${CB_BACKUP_S3_ENDPOINT:-}" \
    CB_S3_REGION="${CB_BACKUP_S3_REGION:-}" \
    CB_S3_OP=upload \
    CB_OBJECT_KEY="$key" \
    CB_HASH="$hash" \
    CB_ARCHIVE="$archive" \
    node --input-type=module -e "$s3_node" || status=$?
  [ "$status" -eq 0 ] || exit "$status"

  printf 'uploaded %s\n' "$key"
fi

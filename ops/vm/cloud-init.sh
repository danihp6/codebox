#!/usr/bin/env bash

# First boot of a launched instance: gives it its identity and its secrets without baking
# either. Every secret comes from OCI Vault through the instance principal, is written once
# and is never echoed; a second boot rewrites the same bytes.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=ops/vm/lib.sh
. "$here/lib.sh"

usage_text='usage: cloud-init.sh [--root DIR] [--no-services] [--instance-id ID]
                     [--health-url URL] [--health-timeout SECONDS] [--help]'

no_services=0
instance_id=
health_url=http://127.0.0.1:8787/v1/health
health_timeout=120

while [ $# -gt 0 ]; do
  case "$1" in
    --root)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      ROOT=$2
      shift 2
      ;;
    --no-services)
      no_services=1
      shift
      ;;
    --instance-id)
      [ $# -ge 2 ] || { printf '%s\n' "$usage_text" >&2; exit 2; }
      instance_id=$2
      shift 2
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

region=${CB_VAULT_REGION:-${OCI_CLI_REGION:-}}
[ -n "$region" ] || die 2 "CB_VAULT_REGION is empty"
instance_name=${CB_INSTANCE_NAME:-cb-instance}
need CB_PUBLIC_URL CB_VAULT_GITHUB_APP_SECRET_OCID CB_VAULT_SESSION_SECRET_OCID \
  CB_VAULT_TUNNEL_TOKEN_OCID CB_VAULT_PROVIDER_KEYS_OCID
[[ "$health_timeout" =~ ^[0-9]+$ ]] || die 2 "health-timeout is not a number"
need_bin base64 node

if [ -z "$instance_id" ]; then
  need_bin curl
  instance_id=$(curl -fsS -H 'Authorization: Bearer Oracle' \
    http://169.254.169.254/opc/v2/instance/id) || die 2 "cannot read the instance id"
fi
lowered=${instance_id,,}
hostname="cb-${lowered: -8}"

etc_codebox=$(rooted /etc/codebox)
etc_cloudflared=$(rooted /etc/cloudflared)
var_lib=$(rooted /var/lib/codebox)
first_boot=$var_lib/first-boot.jsonl
instance_env=$etc_codebox/instance.env
config=$etc_cloudflared/config.yml

as_root=0
[ "$(id -u)" -eq 0 ] && as_root=1

chown_if_root() {
  local path=$1 group=$2
  [ "$as_root" -eq 1 ] || return 0
  getent group "$group" >/dev/null 2>&1 || return 0
  chown "root:$group" "$path"
}

mkdir -p "$etc_codebox" "$etc_cloudflared" "$var_lib"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

now() {
  date -u +%Y-%m-%dT%H:%M:%S.%NZ
}

escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

record_failed() {
  local step=$1 message=$2
  printf '{"ts":"%s","instance":"%s","result":"failed","step":"%s","message":"%s"}\n' \
    "$(now)" "$(escape "$hostname")" "$(escape "$step")" "$(escape "$message")" \
    >>"$first_boot" 2>/dev/null || true
}

fail_step() {
  local code=$1 message=$2
  trap - ERR
  record_failed "$current_step" "$message"
  log "first boot failed instance=$instance_name step=$current_step"
  exit "$code"
}

current_step=start
failure_message="see journalctl -u codebox -u cloudflared"
on_error() {
  local status=$?
  trap - ERR
  fail_step "$status" "$failure_message"
}
trap on_error ERR

current_step=hostname
failure_message="cannot write the hostname"
printf '%s\n' "$hostname" >"$tmp/hostname"
install -m 0644 "$tmp/hostname" "$(rooted /etc/hostname)"
if [ ! -f "$(rooted /etc/hosts)" ]; then
  : >"$tmp/hosts"
else
  cp "$(rooted /etc/hosts)" "$tmp/hosts"
fi
if ! grep -qxF "127.0.1.1 $hostname" "$tmp/hosts"; then
  printf '127.0.1.1 %s\n' "$hostname" >>"$tmp/hosts"
fi
install -m 0644 "$tmp/hosts" "$(rooted /etc/hosts)"
log "hostname $hostname"

current_step=vault
failure_message="cannot read the secret bundle"
need_bin oci
read_secret() {
  local ocid=$1 encoded
  encoded=$(oci secrets secret-bundle get --region "$region" --secret-id "$ocid" \
    --query 'data."secret-bundle-content".content' --raw-output) || return 1
  printf '%s' "$encoded" | base64 -d
}

github_key=$(read_secret "$CB_VAULT_GITHUB_APP_SECRET_OCID")
session_secret=$(read_secret "$CB_VAULT_SESSION_SECRET_OCID")
tunnel_token=$(read_secret "$CB_VAULT_TUNNEL_TOKEN_OCID")
provider_keys=$(read_secret "$CB_VAULT_PROVIDER_KEYS_OCID")
provider_keys=$(printf '%s' "$provider_keys" | sed -e 's/\r$//' -e '/^[[:space:]]*$/d')

current_step=tunnel
failure_message="cannot render the tunnel configuration"
printf '%s' "$tunnel_token" >"$tmp/tunnel-token.json"
chmod 0600 "$tmp/tunnel-token.json"
uuid=$(CB_TOKEN="$tmp/tunnel-token.json" CB_CREDENTIALS="$etc_cloudflared/tunnel-credentials.json" \
  node --input-type=module -e '
    import { readFileSync, writeFileSync } from "node:fs";
    const token = JSON.parse(readFileSync(process.env.CB_TOKEN, "utf8"));
    const credentials = {
      AccountTag: token.a,
      TunnelSecret: token.s,
      TunnelID: token.t,
    };
    writeFileSync(process.env.CB_CREDENTIALS, JSON.stringify(credentials, null, 2) + "\n", {
      mode: 0o600,
    });
    process.stdout.write(String(token.t ?? ""));
  ') || fail_step 2 "cannot read the tunnel token"
[ -n "$uuid" ] || fail_step 2 "cannot read the tunnel token"

credentials=$etc_cloudflared/$uuid.json
mv "$etc_cloudflared/tunnel-credentials.json" "$credentials"
chmod 0600 "$credentials"
{
  printf 'tunnel: %s\n' "$uuid"
  printf 'credentials-file: /etc/cloudflared/%s.json\n' "$uuid"
} >"$tmp/config.yml"
install -m 0640 "$tmp/config.yml" "$config"
chown_if_root "$config" codebox
log "wrote $config"

current_step=instance-env
failure_message="cannot write the instance environment"
{
  printf 'CB_ENV=production\n'
  printf 'CB_INSTANCE_NAME=%s\n' "$instance_name"
  printf 'CB_PUBLIC_URL=%s\n' "$CB_PUBLIC_URL"
  printf 'CB_GITHUB_APP_PRIVATE_KEY_BASE64=%s\n' "$github_key"
  printf 'CB_SESSION_SECRET=%s\n' "$session_secret"
  printf 'CB_TUNNEL_TOKEN=%s\n' "$tunnel_token"
  if [ -n "$provider_keys" ]; then
    printf '%s\n' "$provider_keys"
  fi
} >"$instance_env.tmp"
chmod 0600 "$instance_env.tmp"
if [ "$as_root" -eq 1 ] && getent group codebox >/dev/null 2>&1; then
  install -m 0600 -o root -g codebox "$instance_env.tmp" "$instance_env"
else
  install -m 0600 "$instance_env.tmp" "$instance_env"
fi
rm -f "$instance_env.tmp"
log "wrote $instance_env"

current_step=services
if [ "$no_services" -eq 0 ]; then
  failure_message="cannot start the units"
  need_bin systemctl curl
  systemctl daemon-reload
  # The OpenCode unit has no [Install] on purpose (the daemon may own the child), so it is
  # started and never enabled.
  systemctl start codebox-opencode.service
  systemctl enable --now codebox.service
  systemctl enable --now cloudflared.service
  failure_message="unhealthy after first boot"
  deadline=$((SECONDS + health_timeout))
  status=
  while [ "$SECONDS" -le "$deadline" ]; do
    answer=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "$health_url" 2>/dev/null || true)
    if [[ "$answer" =~ ^[0-9]{3}$ ]] && [ "$answer" -lt 600 ]; then
      status=$answer
      break
    fi
    sleep 1
  done
  [ -n "$status" ] || fail_step 4 "unhealthy after first boot"
  log "first boot ok instance=$instance_name status=$status"
else
  log "first boot ok instance=$instance_name"
fi

current_step=record
printf '{"ts":"%s","instance":"%s","result":"ok"}\n' "$(now)" "$(escape "$hostname")" \
  >>"$first_boot"
chmod 0640 "$first_boot" 2>/dev/null || true
if [ "$as_root" -eq 1 ] && getent passwd codebox >/dev/null 2>&1; then
  chown codebox:codebox "$first_boot" 2>/dev/null || true
fi

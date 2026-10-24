#!/usr/bin/env bash

# Idempotent provisioning of the `cb-*` network, dynamic group, policy, Vault and bucket
# (D22). `--plan` prints the whole plan from the environment alone: it invokes no `oci`
# binary and opens no socket, so it is the review artifact CI can run anywhere. `--apply`
# creates what is missing and touches nothing it did not create. `--destroy` walks the same
# order backwards, terminates `cb-instance` with `cb-boot` preserved and never deletes the
# image, which is the rebuild path (`docs/oci.md` §9).
#
# Required: CB_OCI_COMPARTMENT_ID and CB_OCI_ADMIN_CIDR (the admin `/32` the security list
# admits on port 22). Optional: CB_OCI_SUBNET_ID, CB_OCI_VAULT_ID, CB_OCI_BUCKET and
# CB_OCI_INSTANCE_NAME (default `cb-instance`). The region is not a `CB_*` key: `--apply` and
# `--destroy` let the OCI CLI read `OCI_CLI_REGION`, and `--plan` needs no region at all.
#
# No state is written anywhere: the tenancy is the state.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: provision.sh --plan   [--with-vault] [--with-bucket]
       provision.sh --apply  [--with-vault] [--with-bucket]
       provision.sh --destroy --plan
       provision.sh --destroy --apply [--purge]
EOF
  exit 2
}

need() {
  local name
  for name in "$@"; do
    [ -n "${!name:-}" ] || { echo "error: $name is empty" >&2; exit 2; }
  done
}

mode=
destroy=0
with_vault=0
with_bucket=0
purge=0

while [ $# -gt 0 ]; do
  case "$1" in
    --plan | --apply)
      [ -z "$mode" ] || usage
      mode=${1#--}
      ;;
    --destroy) destroy=1 ;;
    --with-vault) with_vault=1 ;;
    --with-bucket) with_bucket=1 ;;
    --purge) purge=1 ;;
    *) usage ;;
  esac
  shift
done
[ -n "$mode" ] || usage

need CB_OCI_COMPARTMENT_ID CB_OCI_ADMIN_CIDR

if ! [[ "$CB_OCI_ADMIN_CIDR" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/32$ ]]; then
  echo "error: CB_OCI_ADMIN_CIDR is not <ipv4>/32" >&2
  exit 2
fi

compartment=$CB_OCI_COMPARTMENT_ID
admin_cidr=$CB_OCI_ADMIN_CIDR
instance=${CB_OCI_INSTANCE_NAME:-cb-instance}
subnet_id=${CB_OCI_SUBNET_ID:-}
vault_id=${CB_OCI_VAULT_ID:-}
bucket=${CB_OCI_BUCKET:-cb-backups}

# §1 freezes the names: a resource created under any other name is a bug, so the two
# operator overrides are held to the same prefix.
[[ $instance == cb-* ]] || { echo "error: CB_OCI_INSTANCE_NAME is not a cb-* name" >&2; exit 2; }
[[ $bucket == cb-* ]] || { echo "error: CB_OCI_BUCKET is not a cb-* name" >&2; exit 2; }

vcn_name=cb-vcn
igw_name=cb-igw
rt_name=cb-rt
sl_name=cb-sl
subnet_name=cb-subnet
dg_name=cb-instance-dg
policy_name=cb-instance-policy
vault_name=cb-vault
secret_names=(cb-github-app cb-session-secret cb-tunnel-token cb-provider-keys)

print_plan() {
  local secret

  if [ "$destroy" -eq 1 ]; then
    echo "terminate instance $instance preserve boot volume cb-boot"
    if [ "$with_vault" -eq 1 ]; then
      for secret in "${secret_names[@]}"; do
        echo "delete secret $secret vault $vault_name"
      done
      echo "delete vault $vault_name"
    fi
    if [ "$with_bucket" -eq 1 ]; then
      echo "delete bucket $bucket lifecycle 30 days"
    fi
    echo "delete policy $policy_name compartment $compartment"
    echo "delete dynamic-group $dg_name compartment $compartment"
    echo "delete subnet $subnet_name ${subnet_id:--} cidr 10.0.1.0/24"
    echo "delete security-list $sl_name"
    echo "delete route-table $rt_name"
    echo "delete igw $igw_name"
    echo "delete vcn $vcn_name"
    return 0
  fi

  echo "create vcn $vcn_name cidr 10.0.0.0/16 compartment $compartment"
  echo "create igw $igw_name vcn - route 0.0.0.0/0"
  echo "create route-table $rt_name vcn - route 0.0.0.0/0 via $igw_name"
  echo "create security-list $sl_name vcn - ingress tcp/22 from $admin_cidr egress all"
  if [ -n "$subnet_id" ]; then
    echo "reuse subnet $subnet_name $subnet_id cidr 10.0.1.0/24"
  else
    echo "create subnet $subnet_name vcn - cidr 10.0.1.0/24 route-table - security-list -"
  fi
  echo "create dynamic-group $dg_name compartment $compartment instance $instance"
  echo "create policy $policy_name compartment $compartment statements 3"

  if [ "$with_vault" -eq 1 ]; then
    if [ -n "$vault_id" ]; then
      echo "reuse vault $vault_name $vault_id"
    else
      echo "create vault $vault_name compartment $compartment"
    fi
    for secret in "${secret_names[@]}"; do
      echo "create secret $secret vault ${vault_id:--} value -"
    done
  fi

  if [ "$with_bucket" -eq 1 ]; then
    if [ -n "${CB_OCI_BUCKET:-}" ]; then
      echo "reuse bucket $bucket lifecycle 30 days compartment $compartment"
    else
      echo "create bucket $bucket lifecycle 30 days compartment $compartment"
    fi
  fi
}

lookup() {
  local found
  found=$(oci "$@" 2>/dev/null) || found=
  case "$found" in
    '' | null) printf '' ;;
    *) printf '%s' "$found" ;;
  esac
}

oci_run() {
  local output
  if ! output=$(oci "$@" 2>&1); then
    echo "error: oci $1 $2 $3 failed: $(printf '%s' "$output" | tr '\n' ' ' | cut -c1-300)" >&2
    exit 1
  fi
  printf '%s' "$output"
}

apply_network() {
  local vcn igw rt sl subnet

  vcn=$(lookup network vcn list --compartment-id "$compartment" --display-name "$vcn_name" \
    --lifecycle-state AVAILABLE --query 'data[0].id' --raw-output)
  if [ -n "$vcn" ]; then
    echo "reuse vcn $vcn_name $vcn"
  else
    echo "create vcn $vcn_name cidr 10.0.0.0/16 compartment $compartment"
    vcn=$(oci_run network vcn create --cidr-blocks '["10.0.0.0/16"]' \
      --display-name "$vcn_name" --compartment-id "$compartment" --dns-label cbvcn \
      --query 'data.id' --raw-output)
  fi

  igw=$(lookup network internet-gateway list --compartment-id "$compartment" --vcn-id "$vcn" \
    --display-name "$igw_name" --query 'data[0].id' --raw-output)
  if [ -n "$igw" ]; then
    echo "reuse igw $igw_name $igw"
  else
    echo "create igw $igw_name vcn $vcn route 0.0.0.0/0"
    igw=$(oci_run network internet-gateway create --display-name "$igw_name" \
      --compartment-id "$compartment" --vcn-id "$vcn" --is-enabled true \
      --query 'data.id' --raw-output)
  fi

  rt=$(lookup network route-table list --compartment-id "$compartment" --vcn-id "$vcn" \
    --display-name "$rt_name" --query 'data[0].id' --raw-output)
  if [ -n "$rt" ]; then
    echo "reuse route-table $rt_name $rt"
  else
    echo "create route-table $rt_name vcn $vcn route 0.0.0.0/0 via $igw_name"
    rt=$(oci_run network route-table create --display-name "$rt_name" \
      --compartment-id "$compartment" --vcn-id "$vcn" \
      --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$igw\"}]" \
      --query 'data.id' --raw-output)
  fi

  sl=$(lookup network security-list list --compartment-id "$compartment" --vcn-id "$vcn" \
    --display-name "$sl_name" --query 'data[0].id' --raw-output)
  if [ -n "$sl" ]; then
    echo "reuse security-list $sl_name $sl"
  else
    echo "create security-list $sl_name vcn $vcn ingress tcp/22 from $admin_cidr egress all"
    sl=$(oci_run network security-list create --display-name "$sl_name" \
      --compartment-id "$compartment" --vcn-id "$vcn" \
      --ingress-security-rules "[{\"protocol\":\"6\",\"source\":\"$admin_cidr\",\"isStateless\":false,\"tcpOptions\":{\"destinationPortRange\":{\"min\":22,\"max\":22}}}]" \
      --egress-security-rules '[{"protocol":"all","destination":"0.0.0.0/0","isStateless":false}]' \
      --query 'data.id' --raw-output)
  fi

  if [ -n "$subnet_id" ]; then
    echo "reuse subnet $subnet_name $subnet_id"
  else
    subnet=$(lookup network subnet list --compartment-id "$compartment" --vcn-id "$vcn" \
      --display-name "$subnet_name" --lifecycle-state AVAILABLE --query 'data[0].id' \
      --raw-output)
    if [ -n "$subnet" ]; then
      echo "reuse subnet $subnet_name $subnet"
    else
      echo "create subnet $subnet_name vcn $vcn cidr 10.0.1.0/24"
      subnet=$(oci_run network subnet create --display-name "$subnet_name" \
        --cidr-block 10.0.1.0/24 --compartment-id "$compartment" --vcn-id "$vcn" \
        --route-table-id "$rt" --security-list-ids "[\"$sl\"]" --dns-label cbsubnet \
        --query 'data.id' --raw-output)
    fi
  fi
}

apply_iam() {
  local dg statements

  dg=$(lookup iam dynamic-group list --compartment-id "$compartment" --name "$dg_name" \
    --query 'data[0].id' --raw-output)
  if [ -n "$dg" ]; then
    echo "reuse dynamic-group $dg_name $dg"
  else
    echo "create dynamic-group $dg_name compartment $compartment instance $instance"
    dg=$(oci_run iam dynamic-group create --name "$dg_name" --compartment-id "$compartment" \
      --description 'cb-instance matched by compartment and name' \
      --matching-rule "instance.compartment.id = '$compartment', instance.display-name = '$instance'" \
      --query 'data.id' --raw-output)
  fi

  statements="[\"Allow dynamic-group $dg_name to read secret-bundles in compartment $compartment\",\"Allow dynamic-group $dg_name to read objects in compartment $compartment where target.bucket.name = '$bucket'\",\"Allow dynamic-group $dg_name to manage objects in compartment $compartment where target.bucket.name = '$bucket'\"]"
  if [ -n "$(lookup iam policy list --compartment-id "$compartment" --name "$policy_name" \
    --query 'data[0].id' --raw-output)" ]; then
    echo "reuse policy $policy_name"
  else
    echo "create policy $policy_name compartment $compartment statements 3"
    oci_run iam policy create --name "$policy_name" --compartment-id "$compartment" \
      --description 'cb-instance reads its own secrets and writes the backups bucket' \
      --statements "$statements" >/dev/null
  fi
}

apply_vault() {
  local vault key endpoint secret existing

  vault=$(lookup kms vault list --compartment-id "$compartment" --display-name "$vault_name" \
    --query 'data[0].id' --raw-output)
  if [ -z "$vault" ] && [ -n "$vault_id" ]; then
    vault=$vault_id
  fi
  if [ -n "$vault" ]; then
    echo "reuse vault $vault_name $vault"
  else
    echo "create vault $vault_name compartment $compartment"
    vault=$(oci_run kms vault create --display-name "$vault_name" \
      --compartment-id "$compartment" --vault-type DEFAULT --query 'data.id' --raw-output)
  fi

  # A secret cannot exist without a master key, and the inventory names no `cb-*` key: the
  # key is the operator's, so a vault without one is a configuration error rather than a
  # name this script invents.
  endpoint=$(lookup kms vault get --vault-id "$vault" \
    --query 'data."management-endpoint"' --raw-output)
  key=$(lookup kms management key list --compartment-id "$compartment" --endpoint "$endpoint" \
    --query 'data[0].id' --raw-output)
  if [ -z "$key" ]; then
    echo "error: $vault_name has no master key; create the key and the four secret values" >&2
    exit 1
  fi

  for secret in "${secret_names[@]}"; do
    existing=$(lookup vault secret list --compartment-id "$compartment" --vault-id "$vault" \
      --name "$secret" --query 'data[0].id' --raw-output)
    if [ -n "$existing" ]; then
      echo "reuse secret $secret $existing"
      continue
    fi
    echo "create secret $secret vault $vault value -"
    oci_run vault secret create-base64 --secret-name "$secret" \
      --compartment-id "$compartment" --vault-id "$vault" --key-id "$key" \
      --secret-content-content "$(printf 'unset' | base64)" >/dev/null
  done
}

apply_bucket() {
  local existing

  existing=$(lookup os bucket list --compartment-id "$compartment" \
    --query "data[?name=='$bucket'].name | [0]" --raw-output)
  if [ -n "$existing" ]; then
    echo "reuse bucket $bucket lifecycle 30 days"
    return 0
  fi
  echo "create bucket $bucket lifecycle 30 days"
  oci_run os bucket create --name "$bucket" --compartment-id "$compartment" >/dev/null
  oci_run os object-lifecycle-policy put --bucket-name "$bucket" \
    --items '[{"action":"DELETE","timeAmount":30,"timeUnit":"DAYS","isEnabled":true,"name":"expire-30-days"}]' \
    >/dev/null
}

terminate_instance() {
  local found state

  found=$(lookup compute instance list --compartment-id "$compartment" \
    --display-name "$instance" --query 'data[0].id' --raw-output)
  if [ -z "$found" ]; then
    echo "skip instance $instance (not running)"
    return 0
  fi
  echo "terminate instance $instance preserve boot volume cb-boot"
  oci_run compute instance terminate --instance-id "$found" --preserve-boot-volume true \
    --force >/dev/null

  # The VCN cannot go while the VNIC exists, and terminate is asynchronous.
  for _ in $(seq 1 60); do
    state=$(lookup compute instance get --instance-id "$found" \
      --query 'data."lifecycle-state"' --raw-output)
    case "$state" in
      '' | TERMINATED | TERMINATING) return 0 ;;
    esac
    sleep 10
  done
  echo "error: $instance is still $state after 10 minutes" >&2
  exit 1
}

destroy_vault() {
  local vault endpoint secret found

  vault=$(lookup kms vault list --compartment-id "$compartment" --display-name "$vault_name" \
    --query 'data[0].id' --raw-output)
  if [ -z "$vault" ] && [ -n "$vault_id" ]; then
    vault=$vault_id
  fi
  if [ -z "$vault" ]; then
    echo "skip vault $vault_name (not found)"
    return 0
  fi
  endpoint=$(lookup kms vault get --vault-id "$vault" \
    --query 'data."management-endpoint"' --raw-output)

  for secret in "${secret_names[@]}"; do
    found=$(lookup vault secret list --compartment-id "$compartment" --vault-id "$vault" \
      --name "$secret" --query 'data[0].id' --raw-output)
    if [ -z "$found" ]; then
      echo "skip secret $secret (not found)"
      continue
    fi
    echo "delete secret $secret"
    oci_run vault secret schedule-deletion --secret-id "$found" --force >/dev/null
  done

  echo "delete vault $vault_name"
  oci_run kms management vault schedule-deletion --vault-id "$vault" --endpoint "$endpoint" \
    --force >/dev/null
}

destroy_bucket() {
  local existing

  existing=$(lookup os bucket list --compartment-id "$compartment" \
    --query "data[?name=='$bucket'].name | [0]" --raw-output)
  if [ -z "$existing" ]; then
    echo "skip bucket $bucket (not found)"
    return 0
  fi
  if [ "$purge" -eq 1 ]; then
    echo "delete bucket $bucket objects"
    oci_run os object bulk-delete --bucket-name "$bucket" --force >/dev/null
  fi
  echo "delete bucket $bucket"
  oci_run os bucket delete --bucket-name "$bucket" --force >/dev/null
}

destroy_network() {
  local id

  id=$(lookup iam policy list --compartment-id "$compartment" --name "$policy_name" \
    --query 'data[0].id' --raw-output)
  if [ -n "$id" ]; then
    echo "delete policy $policy_name"
    oci_run iam policy delete --policy-id "$id" --force >/dev/null
  else
    echo "skip policy $policy_name (not found)"
  fi

  id=$(lookup iam dynamic-group list --compartment-id "$compartment" --name "$dg_name" \
    --query 'data[0].id' --raw-output)
  if [ -n "$id" ]; then
    echo "delete dynamic-group $dg_name"
    oci_run iam dynamic-group delete --dynamic-group-id "$id" --force >/dev/null
  else
    echo "skip dynamic-group $dg_name (not found)"
  fi

  id=${subnet_id:-}
  if [ -z "$id" ]; then
    id=$(lookup network subnet list --compartment-id "$compartment" \
      --display-name "$subnet_name" --query 'data[0].id' --raw-output)
  fi
  if [ -n "$id" ]; then
    echo "delete subnet $subnet_name"
    oci_run network subnet delete --subnet-id "$id" --force >/dev/null
  else
    echo "skip subnet $subnet_name (not found)"
  fi

  local vcn
  vcn=$(lookup network vcn list --compartment-id "$compartment" --display-name "$vcn_name" \
    --query 'data[0].id' --raw-output)

  id=$(lookup network security-list list --compartment-id "$compartment" --vcn-id "$vcn" \
    --display-name "$sl_name" --query 'data[0].id' --raw-output)
  if [ -n "$id" ]; then
    echo "delete security-list $sl_name"
    oci_run network security-list delete --security-list-id "$id" --force >/dev/null
  else
    echo "skip security-list $sl_name (not found)"
  fi

  id=$(lookup network route-table list --compartment-id "$compartment" --vcn-id "$vcn" \
    --display-name "$rt_name" --query 'data[0].id' --raw-output)
  if [ -n "$id" ]; then
    echo "delete route-table $rt_name"
    oci_run network route-table delete --route-table-id "$id" --force >/dev/null
  else
    echo "skip route-table $rt_name (not found)"
  fi

  id=$(lookup network internet-gateway list --compartment-id "$compartment" --vcn-id "$vcn" \
    --display-name "$igw_name" --query 'data[0].id' --raw-output)
  if [ -n "$id" ]; then
    echo "delete igw $igw_name"
    oci_run network internet-gateway delete --ig-id "$id" --force >/dev/null
  else
    echo "skip igw $igw_name (not found)"
  fi

  if [ -n "$vcn" ]; then
    echo "delete vcn $vcn_name"
    oci_run network vcn delete --vcn-id "$vcn" --force >/dev/null
  else
    echo "skip vcn $vcn_name (not found)"
  fi
}

if [ "$mode" = plan ]; then
  print_plan
  exit 0
fi

if [ "$destroy" -eq 1 ]; then
  terminate_instance
  if [ "$with_vault" -eq 1 ]; then destroy_vault; fi
  if [ "$with_bucket" -eq 1 ]; then destroy_bucket; fi
  destroy_network
else
  apply_network
  apply_iam
  if [ "$with_vault" -eq 1 ]; then apply_vault; fi
  if [ "$with_bucket" -eq 1 ]; then apply_bucket; fi
fi

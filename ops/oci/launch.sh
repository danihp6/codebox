#!/usr/bin/env bash

# Attempts at the Always Free Ampere instance, for the GitHub driver to call on a
# schedule. Extracted from `pkm-randomlike` (D22, D34) and de-hardcoded: no game paths,
# every knob prefixed `CB_OCI_`, the instance is `cb-instance`.
#
# It is deliberately dumb: no state, no bookkeeping, one `launch` call per attempt, and an
# exit code. The wait is the workflow's job. A run makes several attempts by itself
# because the schedule is only a request: measured on the donor repository a `*/30` cron
# fired three times in six hours, so one attempt per run is a run that mostly did nothing.
#
# Auth is the environment form the OCI CLI understands, so nothing is written to disk:
#   OCI_CLI_USER, OCI_CLI_FINGERPRINT, OCI_CLI_TENANCY, OCI_CLI_REGION,
#   OCI_CLI_KEY_CONTENT
# the placement:
#   CB_OCI_COMPARTMENT_ID, CB_OCI_SUBNET_ID, CB_OCI_IMAGE_ID, CB_OCI_AD
# and the only thing that makes the instance usable once it exists:
#   CB_OCI_SSH_PUBLIC_KEY  the public half, injected as `ssh_authorized_keys` metadata.
#                          Without it the slot would be spent on a box nobody can log into,
#                          so it is required and the run fails loudly instead of launching
#                          blind.
#
# Knobs, all optional:
#   CB_OCI_ATTEMPTS        attempts this invocation makes (default 1 — a one-shot probe by
#                          hand; CI passes 8)
#   CB_OCI_ATTEMPT_SLEEP   seconds to wait after a capacity answer (default 60)
#   CB_OCI_THROTTLE_SLEEP  seconds to wait after a `TooManyRequests` (default 300)
#   CB_OCI_START_DELAY     seconds before the first attempt (default 0). A chained run
#                          starts the moment the previous one ends, so without it the last
#                          attempt of one run and the first of the next land ~1 minute apart
#                          and the limiter sees two launches back to back.
#   CB_OCI_BUDGET          seconds the attempt loop may spend before handing the wait back
#                          to the schedule (default 2400)
#   CB_OCI_SHAPES          space-separated `<ocpus>/<gb>` requests, rotated one per attempt
#                          (default `2/12 2/12 1/6`)
#   CB_OCI_INSTANCE_NAME   display name and idempotency key (default `cb-instance`)
#   CB_OCI_BOOT_GB         boot volume size (default 100)
#
# `--dry-run` validates the configuration and prints the first request without calling
# OCI; it is the check `docs/oci.md` promises.

set -uo pipefail
export SUPPRESS_LABEL_WARNING=True

dry_run=0
if [ "${1:-}" = "--dry-run" ]; then
  dry_run=1
elif [ $# -gt 0 ]; then
  echo "usage: $0 [--dry-run]" >&2
  exit 2
fi

need() {
  local name
  for name in "$@"; do
    [ -n "${!name:-}" ] || { echo "error: $name is empty" >&2; exit 2; }
  done
}

need OCI_CLI_USER OCI_CLI_FINGERPRINT OCI_CLI_TENANCY OCI_CLI_REGION OCI_CLI_KEY_CONTENT \
  CB_OCI_COMPARTMENT_ID CB_OCI_SUBNET_ID CB_OCI_IMAGE_ID CB_OCI_AD
if [ -z "${CB_OCI_SSH_PUBLIC_KEY:-}" ]; then
  echo "error: CB_OCI_SSH_PUBLIC_KEY is empty — set the repository variable to the public" >&2
  echo "half of the key you will log in with; a slot without it is unusable." >&2
  exit 2
fi

name=${CB_OCI_INSTANCE_NAME:-cb-instance}
out=${GITHUB_OUTPUT:-/dev/null}
attempts=${CB_OCI_ATTEMPTS:-1}
pause=${CB_OCI_ATTEMPT_SLEEP:-60}
throttle=${CB_OCI_THROTTLE_SLEEP:-300}
delay=${CB_OCI_START_DELAY:-0}
budget=${CB_OCI_BUDGET:-2400}
boot_gb=${CB_OCI_BOOT_GB:-100}
started=$SECONDS
throttled=0
read -r -a shapes <<< "${CB_OCI_SHAPES:-2/12 2/12 1/6}"
[ "${#shapes[@]}" -gt 0 ] || { echo "error: CB_OCI_SHAPES is empty" >&2; exit 2; }
# Fixed once, so a run of attempts is a strict rotation; the wall clock still moves the
# starting point between one-attempt invocations.
start_minute=$((10#$(date -u +%M)))

for entry in "${shapes[@]}"; do
  ocpus=${entry%%/*}
  gb=${entry##*/}
  if ! [[ $ocpus =~ ^[0-9]+$ && $gb =~ ^[0-9]+$ ]]; then
    echo "error: CB_OCI_SHAPES entry '$entry' is not <ocpus>/<gb>" >&2
    exit 2
  fi
done

if [ "$dry_run" -eq 1 ]; then
  echo "dry run: ${name} in ${CB_OCI_AD}, subnet ${CB_OCI_SUBNET_ID}, shape ${shapes[0]}, boot ${boot_gb} GB"
  echo "dry run: ${attempts} attempt(s), ${pause}s between capacity answers, ${throttle}s after a throttle"
  exit 0
fi

command -v oci >/dev/null || { echo "error: the OCI CLI is not installed" >&2; exit 2; }

emit() {
  [ "$out" = /dev/null ] || printf '%s=%s\n' "$1" "$2" >> "$out"
}

public_ip() {
  local ip
  ip=$(oci compute instance list-vnics --instance-id "$1" \
    --query 'data[0]."public-ip"' --raw-output 2>/dev/null || true)
  [ "$ip" = null ] && ip=
  printf '%s' "$ip"
}

shape_of() {
  local ocpus gb
  ocpus=$(oci compute instance get --instance-id "$1" \
    --query 'data."shape-config".ocpus' --raw-output 2>/dev/null || true)
  gb=$(oci compute instance get --instance-id "$1" \
    --query 'data."shape-config".memoryInGBs' --raw-output 2>/dev/null || true)
  [ -n "$ocpus" ] && [ "$ocpus" != null ] && printf '%s/%s' "$ocpus" "$gb"
}

# Parking is by observation, not by state: an instance already RUNNING is the answer this
# run would have produced, so it hands back its id, its address and its size and stops
# attempting.
park() {
  echo "already running: $1"
  emit id "$1"
  emit ip "$(public_ip "$1")"
  emit shape "$(shape_of "$1")"
  exit 0
}

running_id() {
  oci compute instance list --compartment-id "$CB_OCI_COMPARTMENT_ID" \
    --display-name "$name" --lifecycle-state RUNNING \
    --query 'data[0].id' --raw-output 2>/dev/null || true
}

# A chained run starts seconds after the previous one ended, at the tail of its last
# `launch` call. Waiting here is what keeps the limiter from seeing two launches a minute
# apart; the delay is charged to the budget like any other wait.
first=$(running_id)
if [ -n "$first" ] && [ "$first" != null ]; then
  park "$first"
fi
if [ "$delay" -gt 0 ]; then
  echo "waiting ${delay}s before the first attempt: the previous run may have just launched"
  sleep "$delay"
fi

for attempt in $(seq 1 "$attempts"); do
  existing=$(running_id)
  if [ -n "$existing" ] && [ "$existing" != null ]; then
    park "$existing"
  fi

  entry=${shapes[$(( (start_minute + attempt - 1) % ${#shapes[@]} ))]}
  ocpus=${entry%%/*}
  gb=${entry##*/}
  echo "attempt $attempt/$attempts: ${ocpus} OCPU / ${gb} GB in $CB_OCI_AD"

  err=$(mktemp)
  id=$(oci compute instance launch --compartment-id "$CB_OCI_COMPARTMENT_ID" \
    --availability-domain "$CB_OCI_AD" --shape VM.Standard.A1.Flex \
    --shape-config "{\"ocpus\":$ocpus,\"memoryInGBs\":$gb}" \
    --image-id "$CB_OCI_IMAGE_ID" --subnet-id "$CB_OCI_SUBNET_ID" \
    --assign-public-ip true --display-name "$name" \
    --boot-volume-size-in-gbs "$boot_gb" \
    --metadata "{\"ssh_authorized_keys\":\"$CB_OCI_SSH_PUBLIC_KEY\"}" \
    --query 'data.id' --raw-output 2>"$err")
  status=$?

  if [ "$status" -ne 0 ] || [ -z "$id" ] || [ "$id" = null ]; then
    detail=$(tr '\n' ' ' < "$err" | cut -c1-300)
    code=$(printf '%s' "$detail" | sed -n 's/.*"code": *"\([A-Za-z]*\)".*/\1/p' | head -n 1)
    rm -f "$err"
    case "$code" in
      TooManyRequests)
        throttled=$((throttled + 1))
        echo "rate-limited by Oracle: $detail"
        wait=$throttle
        ;;
      OutOfHostCapacity | InternalError)
        echo "no capacity yet: $detail"
        wait=$pause
        ;;
      *)
        case "$detail" in
          *"Out of host capacity"* | *OutOfHostCapacity*)
            echo "no capacity yet: $detail"
            wait=$pause
            ;;
          *)
            echo "error: $detail" >&2
            exit 1
            ;;
        esac
        ;;
    esac

    # A sleep that would outlive the budget is the schedule's job, not a killed job's: the
    # next run picks the wait up a few minutes later.
    if [ $(( SECONDS - started + wait )) -ge "$budget" ]; then
      echo "budget spent after $attempt attempt(s); the next run picks the wait up"
      exit 0
    fi
    sleep "$wait"
    continue
  fi
  rm -f "$err"
  echo "launched $id (${ocpus} OCPU / ${gb} GB)"
  emit id "$id"
  emit shape "${ocpus}/${gb}"

  # The IP is what makes the instance usable, so the job waits for it rather than handing
  # back an id somebody has to chase.
  state=
  for _ in $(seq 1 30); do
    state=$(oci compute instance get --instance-id "$id" --query 'data."lifecycle-state"' --raw-output 2>/dev/null || true)
    [ "$state" = RUNNING ] && break
    sleep 10
  done
  ip=$(public_ip "$id")
  echo "state=$state ip=${ip:-unknown} shape=${ocpus}/${gb}"
  emit ip "$ip"

  { echo "### A slot opened"; echo; echo "- instance: \`$id\`"; echo "- shape: ${ocpus} OCPU / ${gb} GB"; echo "- ip: \`${ip:-unknown}\`"; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit 0
done

# Running out of attempts is the expected answer for now: the region is full, not broken.
# Exiting non-zero here would paint the runs list red for a wait that is going fine.
echo "no capacity in $attempts attempt(s), $throttled of them throttled; the next run picks the wait up"
{ echo "### No slot yet"; echo; echo "- attempts: $attempts"; echo "- throttled: $throttled"; echo "- the run hands the wait to the next one"; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
exit 0

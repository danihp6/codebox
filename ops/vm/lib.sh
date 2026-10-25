#!/usr/bin/env bash

# Shared by every host script in this directory. Sourced, never executed, so it declares
# functions only. The messages have no timestamp on purpose: a test asserts on them.
#
# Exit codes, identical in every script: 0 success, 2 usage or a missing input, 3 checksum
# mismatch, 4 unhealthy after a restart, 5 no previous release, 6 bad archive or bad
# database. Nothing exits 1 on purpose.

ROOT=${ROOT:-/}

die() {
  local code=$1
  shift
  printf 'codebox: error: %s\n' "$*" >&2
  exit "$code"
}

log() {
  printf 'codebox: %s\n' "$*" >&2
}

rooted() {
  printf '%s%s' "${ROOT%/}" "$1"
}

need() {
  local name
  for name in "$@"; do
    [ -n "${!name:-}" ] || die 2 "$name is empty"
  done
}

need_bin() {
  local name
  for name in "$@"; do
    command -v "$name" >/dev/null 2>&1 || die 2 "$name is not installed"
  done
}

usage() {
  printf '%s\n' "$*"
  exit 0
}

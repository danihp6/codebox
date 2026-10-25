#!/usr/bin/env bash

# Node 24 from the official arm64 tarball: no source build, no NodeSource script, and the
# version is pinned by the template so the image and the release agree (docs/vm-image.md §8).

set -euo pipefail

log() { printf 'image: %s\n' "$*" >&2; }

version=${NODE_VERSION:-}
[ -n "$version" ] || {
  printf 'error: NODE_VERSION is empty\n' >&2
  exit 2
}

arch=$(dpkg --print-architecture)
[ "$arch" = arm64 ] || log "warning: $arch is not the arm64 shape this template targets"

tarball=node-v${version}-linux-arm64.tar.xz

log "installing node $version"
curl -fsSLo "/tmp/$tarball" "https://nodejs.org/dist/v${version}/$tarball"
curl -fsSLo /tmp/SHASUMS256.txt "https://nodejs.org/dist/v${version}/SHASUMS256.txt"
(cd /tmp && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -)
tar -xJf "/tmp/$tarball" -C /usr/local --strip-components=1 \
  --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
rm -f "/tmp/$tarball" /tmp/SHASUMS256.txt

corepack enable
node --version | grep -q '^v24\.' || {
  printf 'error: node is not 24.x\n' >&2
  exit 2
}
log "node $(node --version), npm $(npm --version)"

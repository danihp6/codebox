#!/usr/bin/env bash

# Chromium for Playwright, baked at a fixed path so the e2e suite and the app's web flow never
# download a browser at run time. The version is pinned by this script, the browser and its
# shared libraries are installed under /opt/ms-playwright, and the directory is world-readable
# because the service user runs the tests (docs/vm-image.md §1 and §9).

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

log() { printf 'image: %s\n' "$*" >&2; }

readonly playwright_version='1.64.1'
readonly browsers_path='/opt/ms-playwright'

log "pinning playwright $playwright_version"
npm install -g --no-fund --no-audit "playwright@${playwright_version}"

installed=$(playwright --version 2>&1 | head -n 1)
case "$installed" in
  *"$playwright_version"*) log "playwright $(printf '%s' "$installed" | awk '{print $2}')" ;;
  *)
    printf 'error: playwright reported %s, expected %s\n' "$installed" "$playwright_version" >&2
    exit 2
    ;;
esac

log "installing chromium's apt dependencies"
npx --yes "playwright@${playwright_version}" install-deps chromium

log "downloading chromium into $browsers_path"
install -d -m 0755 -o root -g root "$browsers_path"
PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
  npx --yes "playwright@${playwright_version}" install --with-deps chromium

log "publishing $browsers_path to the runtime user"
if [ ! -f /etc/environment ]; then
  install -m 0644 /dev/null /etc/environment
fi
if grep -q 'PLAYWRIGHT_BROWSERS_PATH=' /etc/environment; then
  sed -i 's|PLAYWRIGHT_BROWSERS_PATH=.*|PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright|' \
    /etc/environment
else
  printf 'PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright\n' >>/etc/environment
fi
export PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
chown -R root:root "$browsers_path"
chmod -R a+rX "$browsers_path"

# A browser queued by npm would live under root's home and never be reachable by the service
# user, so it is removed instead of shipped.
rm -rf /root/.cache/ms-playwright
[ ! -e /root/.cache/ms-playwright ] || {
  printf 'error: /root/.cache/ms-playwright survived the cleanup\n' >&2
  exit 2
}

binary=$(find "$browsers_path" -type f -path '*/chromium-[0-9]*/chrome-linux*/chrome' |
  sort -V | tail -n 1)
[ -n "$binary" ] || {
  printf 'error: no chromium binary under %s\n' "$browsers_path" >&2
  exit 2
}

log "smoke-launching $binary"
if ! timeout 60 "$binary" --headless=new --no-sandbox --disable-dev-shm-usage \
  --dump-dom about:blank >/dev/null 2>&1; then
  printf 'error: chromium did not launch headless\n' >&2
  exit 2
fi

log "cleaning the apt cache"
apt-get clean
rm -rf /var/lib/apt/lists/*

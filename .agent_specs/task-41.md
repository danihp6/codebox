# Spec: Task-41 — A browser in the image

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** ops.
- **Role:** Dev.
- **Objective:** The image ships Chromium for Playwright, installed at build time under
  `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`, readable by the `codebox` user and with no
  run-time download. A new numbered build step installs it with its apt dependencies; the
  build gate `90-verify.sh` gains a `browser` check that fails the build when the browser, a
  shared library or a headless launch is missing; a repository test proves the failure path
  against a stub root; nothing is left under `/root/.cache`.
- **Environment:** worktree `../wt-cb-41`, branch `task-41`, base `origin/main`.
- **Dependencies:** Task-25 (merged). It produced `ops/image/scripts/90-verify.sh`,
  `ops/vm/test/verify.test.mjs` and `docs/vm-image.md`, all of which this task edits.

### Exclusive paths (single writer)

- `ops/image/scripts/45-browser.sh` (new)
- `ops/image/scripts/90-verify.sh`
- `ops/vm/test/verify.test.mjs`
- `docs/vm-image.md` (whole file)

`ops/image/codebox.pkr.hcl` and `ops/image/README.md` belong to Task-40 in this batch:
**do not edit them.** Task-40 changes the build-step list to discover every `scripts/*.sh`
lexicographically, so adding `45-browser.sh` is enough to have it run between 40 and 50, and
it writes the README row for the new script. Do not touch `ops/image/test/` (Task-40 owns
`template.test.mjs`), `TODO.md`, `CHANGELOG.md`, `AGENTS.md`, `docs/oci.md`, `docs/aws.md`,
`docs/README.md` or `.agent_specs/`.

### Inputs (read-only)

- `AGENTS.md`.
- `docs/vm-image.md` as it stands.
- `ops/image/scripts/10-base.sh`, `20-node.sh`, `30-tools.sh`, `40-opencode.sh`,
  `60-service.sh`, `70-harden.sh`, `90-verify.sh`.
- `ops/vm/lib.sh`, `ops/vm/test/verify.test.mjs`.
- `docs/decisions.md` (D21, D39).

## 🔒 Contract

### `ops/image/scripts/45-browser.sh` (new)

Same shape as the neighbouring steps: `#!/usr/bin/env bash`, `set -euo pipefail`, `log()` from
the file's own prefix (the other scripts define their own; copy the house style), one
`log "..."` per phase, no secret, no token, no interactive prompt. It runs as root during the
build with network access.

It must, in this order:

1. Export and persist `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` in
   `/etc/environment` (or a `/etc/profile.d/` drop-in — pick one and say which in the report)
   so the runtime user sees the same path.
2. Install Playwright's apt dependencies (`npx playwright install-deps chromium` or the
   documented equivalent) non-interactively with `DEBIAN_FRONTEND=noninteractive`.
3. Install the **pinned** Playwright package globally, with the version written as a literal
   semver in a `readonly playwright_version='<x.y.z>'` at the top of the script. Resolve the
   latest version once with `npm view playwright version` **while writing the task**, then pin
   it; a floating `latest`, a caret range or a run-time `npx` download is a failure.
4. `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright npx --yes playwright@<pinned> install --with-deps chromium`
   so the browser and the driver land under `/opt/ms-playwright`.
5. Make `/opt/ms-playwright` recursively readable by `codebox` (`chmod -R a+rX`, owner
   `root:root`; nothing writable by the service user) and prove no browser cache is left under
   `/root/.cache/ms-playwright` (remove it if `npm`/`playwright` queued one).
6. One headless smoke launch of the installed Chromium with `--no-sandbox --disable-dev-shm-usage`
   (as root in the build) and fail the step if it exits non-zero.
7. `apt-get clean` and remove `/var/lib/apt/lists/*` — the image hygiene rule of
   `docs/vm-image.md` §9.

### `90-verify.sh`: the `browser` check

- Add `browser` to `checks=(...)` and to the `usage_text` check list. It runs in the default
  `all` pass, and `--only browser` works.
- It honours `$ROOT` like every other check: the browser directory is
  `$ROOT/opt/ms-playwright`, the environment file is `$ROOT/etc/environment`.
- It prints exactly one `ok browser` line on success; on failure one
  `fail browser <detail>` line naming the missing piece (the browser directory, the pinned
  revision, a library reported by `ldd` as `not found`, or the failed headless launch) and
  exits 1. It must not print a token or a file body.
- The launch is bounded: `timeout 60` around the Chromium smoke run, `--no-sandbox
  --disable-dev-shm-usage`, `--headless=new`, `--dump-dom about:blank` (or equivalent) and the
  binary path resolved from the installed revision, not hard-coded.
- Keep every existing check (`runtime`, `tools`, `units`, `user`, `layout`, `secrets`,
  `image`) byte-for-byte in behaviour: the existing tests must stay green.

### `ops/vm/test/verify.test.mjs`

Keep every existing case. Add at least:

- `--only browser` on a stub root with no `/opt/ms-playwright` prints one `fail browser ...`
  line and exits 1.
- `--only browser` on a stub root whose fake browser binary exits 0 and whose `ldd` reports no
  `not found` prints `ok browser` and exits 0. Build the stub so the test does not need
  Chromium (a small shell script at the resolved path and an `ldd` shim on `PATH` are
  acceptable).
- `--only browser` on a stub root with a fake browser that exits 1 prints `fail browser ...`
  and exits 1.
- The default `all` pass still lists `browser` (assert the usage/check list contains it).

### `docs/vm-image.md` (whole file, but change only what is true)

- §1 gains a **Browser** row: Playwright's pinned Chromium plus its apt dependencies under
  `/opt/ms-playwright`, world-readable, no run-time download.
- §2 gains `45-browser.sh` in the right numeric position of the script tree.
- §4 gains the `browser` verification line (binary present, `ldd` clean, one headless launch).
- §9 states that no browser cache lives under `/root/.cache` and `PLAYWRIGHT_BROWSERS_PATH`
  is set system-wide.
- Keep the tone and the `[unit]`/`[live]` discipline; do not renumber sections.

## 🧩 Configuration

No `CB_*` key. `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` is an image-level environment
variable for the runtime user, not daemon configuration; it does not belong in
`docs/providers.md`. If you choose a path other than `/opt/ms-playwright`, that is a contract
break with this spec: do not.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `bash -n ops/image/scripts/45-browser.sh`
  - `npx vitest run --project ops ops/vm/test/verify.test.mjs`
  - `bash ops/image/scripts/90-verify.sh --root "$(mktemp -d)" --only browser` (expected exit
    1 on an empty root — this is the negative proof, not a failure of the task)
  - `git diff --name-only origin/main...HEAD` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `bash -n` passes on the new script and `npx vitest run --project ops
    ops/vm/test/verify.test.mjs` is green with the new browser cases.
  - [ ] `[unit]` `90-verify.sh --root <empty temp dir> --only browser` exits 1 and prints one
    `fail browser ...` line; the same check on the stub root of the test prints `ok browser`.
  - [ ] `[unit]` `npm run lint`, `npm test` and `npm run build` are green.
  - [ ] `[unit]` The script pins an exact Playwright semver (a grep shows no `latest`, no
    `^`/`~` range, no run-time `npx playwright install` without the pinned package) and writes
    `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`.
  - [ ] `[unit]` No file outside the exclusive paths changed.
  - [ ] `[live]` On the built image, `90-verify.sh --only browser` prints `ok browser` (one
    headless launch, `ldd` clean) and `npx playwright test` runs one headless spec with
    `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` while the network is disabled, so no
    download happens. Measurement: run both on a built image and record the exit codes; the
    same commands on a VM with the network dropped must still exit 0. **Cannot be measured on
    GitHub Actions** (no built image): report `not run`; the Orchestrator opens an
    `agent-review` issue.

## 📣 Coordination

- For Task-40: the build-step list is discovered from `scripts/*.sh`; this task adds
  `45-browser.sh` only.
- For the next batch: the `browser` check is part of the image gate and its name is stable.
- For Task-26 (e2e) and Task-44 (three browsers at once): the image now has Chromium at a
  fixed path; `npx playwright test` must not download.

## ⛔ Out of scope

- No Firefox/WebKit. Chromium only.
- No browser download at run time, no `npm install` in the daemon's start path.
- No change to `codebox.pkr.hcl`, `ops/image/test/template.test.mjs` or `ops/image/README.md`.
- No new runtime dependency in `package.json`.

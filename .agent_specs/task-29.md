# Spec: Task-29 — Release pipeline

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** ops / pipeline (a release build script, a tag-driven workflow and two doc
  sections).
- **Role:** Dev.
- **Objective:** after this task, one tag `v<version>` produces the documented release
  artifacts — `codebox-<version>.tar.gz` and `codebox-<version>.tar.gz.sha256`, with a
  `release.json` manifest inside the archive — reproducibly, without writing the version
  anywhere; the same scripts prove headlessly that a dry release names and checksums its
  output and that `ops/vm/upgrade.sh` refuses a corrupted checksum; and `docs/operations.md`
  §4/§13 documents the version rule, the artifact layout, the image tag, the rollback and the
  unsigned-artifact boundary (L1/Q1).
- **Environment:** worktree `../wt-cb-29`, branch `task-29`, base `main`.
- **Dependencies:** Task-25 (merged) produced `ops/vm/install.sh`, `ops/vm/upgrade.sh`,
  `ops/vm/lib.sh`, `ops/image/codebox.pkr.hcl` and the image tag scheme
  `cb-image-<version>-<sha>`. Task-17 (merged) produced `docs/operations.md` §4. The merged
  tree's `CHANGELOG.md` carries the `## Unreleased` section this task reads and never edits.

### Exclusive paths (single writer)

Every path this task creates or modifies. Nothing outside this list. No other task in the
batch claims any of them; `package.json`, `package-lock.json`, `tsconfig.base.json` and every
other hot file are **not** this task's.

- `.github/workflows/release.yml` (new)
- `scripts/release/stage.mjs` (new)
- `scripts/release/build.mjs` (new)
- `scripts/release/notes.mjs` (new)
- `scripts/release/stage.test.mjs` (new)
- `scripts/release/build.test.mjs` (new)
- `scripts/release/notes.test.mjs` (new)
- `scripts/release/upgrade.test.mjs` (new)
- `scripts/release/fixtures/stage/**` (new: a minimal staged tree — no `node_modules`; see
  Contract)
- `scripts/README.md` — **only** a new `## scripts/release` block appended after the last
  existing block. No existing line changes.
- `docs/operations.md` — **§4 “Upgrade and rollback” and §13 “Change management” only**. No
  other section, heading, table or line of that file changes.

### Inputs (read-only)

Beyond `AGENTS.md`, and only these:

- `ops/vm/install.sh`, `ops/vm/upgrade.sh`, `ops/vm/lib.sh` — the installer the artifact must
  satisfy, the exit codes (`2` usage, `3` checksum, `4` unhealthy, `5` no previous release,
  `6` bad archive) and `rooted()`.
- `ops/vm/test/install.test.mjs`, `ops/vm/test/upgrade.test.mjs` — the established fixture
  shape for a fake artifact (`tar -czf … -C staging .` with `apps/daemon/dist/main.js`).
- `ops/vm/README.md` — the install/upgrade command lines and the `<archive>.sha256` naming.
- `ops/image/codebox.pkr.hcl` — `image_name = "cb-image-${var.image_version}-${var.git_sha}"`,
  the image tag scheme this task documents.
- `ops/image/README.md` — the `image_version`/`git_sha` inputs.
- `docs/vm-image.md` §6 — the release axis on the image.
- `docs/operations.md` — the whole file, to edit only §4 and §13; §2 also fixes the installer
  flags the doc must keep true.
- `docs/providers.md` — `CB_INSTALL_DIR`'s default (`/opt/codebox`), which §4's layout note
  must not contradict silently; the file itself is not edited.
- `docs/open-questions.md` Q1 and `TODO.md` L1 — the frozen boundary: Task-29 builds
  **unsigned** artifacts and checksums; the operator signs and distributes.
- `CHANGELOG.md` — read the `## Unreleased` section; never write it.
- `package.json` — read `version` (today `0.0.0`) and the `build`/`test` scripts; never write
  it.
- `.github/workflows/ci.yml` — the shape, runner and Node setup of an existing workflow.
- `vitest.config.ts` — the `scripts` project already runs `scripts/**/*.test.mjs`; this task
  relies on it and does not edit it.
- `eslint.config.js` — the lint surface for `scripts/**/*.mjs`.
- `scripts/README.md`, `docs/agent-ci.md` §1 and §10 (the workflow conventions).

## 🔒 Contract

The surface QA, the workflow and the next task are written against. Exact names, signatures,
file names and exit codes.

```js
// scripts/release/build.mjs
export const ARTIFACT_PREFIX = 'codebox-';
export const MANIFEST_NAME = 'release.json';

export function artifactName(version: string): string; // `codebox-${version}.tar.gz`
export function checksumName(version: string): string; // `codebox-${version}.tar.gz.sha256`
export function manifestJson(input: {
  version: string;
  commit: string | null;
  builtAt: string; // ISO 8601, e.g. '2026-01-01T00:00:00Z'
}): string; // JSON + '\n', keys in this order: version, commit, builtAt

export interface BuildReleaseInput {
  readonly stage: string;   // payload directory, resolved against CWD
  readonly out: string;     // output directory, created if absent
  readonly version: string; // semver without a leading 'v'
  readonly builtAt: string; // ISO 8601; the archive mtime and release.json
  readonly commit?: string | null;
}
export interface BuildReleaseResult {
  readonly archive: string;      // <out>/codebox-<version>.tar.gz
  readonly checksumFile: string; // <out>/codebox-<version>.tar.gz.sha256
  readonly sha256: string;       // lowercase hex
}
export function buildRelease(input: BuildReleaseInput): Promise<BuildReleaseResult>;
```

`build.mjs` CLI: `node scripts/release/build.mjs --stage DIR --out DIR --version V --built-at ISO
[--commit SHA] [--check-package-version] [--root DIR] [--help]`.
`--check-package-version` reads `<root>/package.json` and requires its `version` to equal
`--version`; `--root` defaults to `.`. The CLI writes the two files and publishes nothing; a
“dry release” is exactly this command, and the workflow's `dry_run` input only skips
`gh release create`.
Exit codes: `0` ok; `2` usage or an unknown flag; `3` version mismatch; `4` stage is missing
`apps/daemon/dist/main.js` or `app/index.html`; `5` `tar`/`gzip` failed.

Deterministic archive, frozen: entries sorted by name, `mtime` = `--built-at` epoch, owner and
group `0`, numeric owner, GNU format, gzip level 9 with no name and no timestamp
(`tar --sort=name --mtime=@<epoch> --owner=0 --group=0 --numeric-owner --format=gnu -cf - .`
piped through `gzip -n -9`). Two builds of the same stage with the same `--version`,
`--built-at` and `--commit` produce the same sha256.

The manifest is written to `<stage>/release.json` before the archive is cut and removed in a
`finally` block afterwards, so the stage is not mutated on disk after the call. It is always
the archive member `release.json` at the root.

The checksum file contains exactly one line:
`<sha256><two spaces>codebox-<version>.tar.gz<LF>` (`sha256sum` format, so
`sha256sum -c codebox-<version>.tar.gz.sha256` passes from `<out>`).

```js
// scripts/release/stage.mjs
export interface StageEntry { readonly from: string; readonly to: string; }
export function stagePlan(root: string): readonly StageEntry[];
export function stageRelease(input: { root: string; out: string }): Promise<{ files: number }>;
```

CLI: `node scripts/release/stage.mjs --out DIR [--root DIR] [--help]`; `--root` defaults to
`.`; exit `0` ok, `2` usage, `4` a required build output is absent.

`stagePlan(root)` is the copy plan, in this order, from `<root>` to `<out>`:
`apps/daemon/dist` → `apps/daemon/dist`, `apps/daemon/bin` → `apps/daemon/bin`,
`apps/daemon/package.json` → `apps/daemon/package.json`, every `packages/<name>/dist` and
`packages/<name>/package.json` → the same relative path, `apps/app/dist/browser` → `app`,
`node_modules` → `node_modules` (optional; skipped when absent), `package.json` →
`package.json`. `stageRelease` fails (exit `4`) when `apps/daemon/dist/main.js` or
`apps/app/dist/browser/index.html` is absent; it copies nothing from `apps/*/src`,
`packages/*/src`, `.git`, `coverage` or `.agent_specs`. Symlinks are copied as symlinks, never
dereferenced: `node_modules/@codebox/*` are the workspace's relative links and must still
resolve inside the staged tree.

The committed fixture `scripts/release/fixtures/stage/` contains exactly
`apps/daemon/dist/main.js`, `apps/daemon/bin/cb.mjs`, `apps/daemon/package.json`,
`packages/contracts/dist/index.js`, `packages/contracts/package.json` and `app/index.html`.
It deliberately has no `node_modules`: that path is `.gitignore`d and a fixture must be a
committed file. `stage.test.mjs` creates its own temporary `node_modules` to prove the copy.

```js
// scripts/release/notes.mjs
export class ReleaseNotesMissingError extends Error {}
export function releaseNotes(input: { markdown: string; version: string }): string;
```

`releaseNotes` returns `# Codebox <version>\n\n` plus the body of the first matching heading:
`## [<version>]` (optionally followed by a date) or, when absent, `## Unreleased`; the body
runs to the next `^## ` heading and is trimmed. An empty body throws
`ReleaseNotesMissingError`. CLI: `node scripts/release/notes.mjs --version V
[--changelog FILE] [--out FILE]`; exit `0` ok, `2` usage, `4` missing section.
`CHANGELOG.md` is never written.

**Signing is not this task's.** The item's “signed daemon/app artifacts” is superseded by two
frozen decisions: Q1 (distribution) is open and L1 states “Task-29 builds unsigned artifacts
and checksums; the operator signs and distributes”. The workflow therefore produces unsigned
artifacts plus the `.sha256` file, §4 says so in one sentence, and no key, certificate or
signing step is added.

`.github/workflows/release.yml`, frozen shape:

- `name: Release`.
- `on: push: tags: ['v*.*.*']` and `workflow_dispatch` with one input,
  `version` (required string). The job parses the tag or input with
  `/^v?\d+\.\d+\.\d+$/` and fails before building on anything else. A dispatch is always a
  dry run: it builds and uploads the artifacts and never creates a release.
- `permissions: contents: write` — a GitHub Release and its assets, nothing else.
- One job `release` on `ubuntu-24.04`, `timeout-minutes: 30`, steps: checkout with
  `fetch-depth: 0`; `actions/setup-node@v4` with Node 24 and `cache: npm`; `npm ci`;
  `npm run build`; `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`;
  `node scripts/release/stage.mjs --out .release/stage`;
  `node scripts/release/build.mjs --stage .release/stage --out .release/out --version "$VERSION" --built-at "$(git show -s --format=%cI HEAD)" --commit "$(git rev-parse HEAD)" --check-package-version`;
  `node scripts/release/notes.mjs --version "$VERSION" --out .release/out/RELEASE-NOTES.md`;
  `actions/upload-artifact@v4` for `.release/out`; and, only on a tag push,
  `gh release create "v$VERSION" .release/out/codebox-"$VERSION".tar.gz
  .release/out/codebox-"$VERSION".tar.gz.sha256 --notes-file .release/out/RELEASE-NOTES.md`
  with `GH_TOKEN: ${{ github.token }}`.
- `VERSION` is `${{ github.ref_name }}` with a leading `v` stripped on a tag, or
  `inputs.version` on a dispatch; a value that is not `<major>.<minor>.<patch>` fails the job
  before building.
- No signing step. The signature is the operator's (L1); the workflow produces unsigned
  artifacts and checksums and says so in the release notes.
- `docs/operations.md` §4 must contain, in prose, the exact strings
  `codebox-<version>.tar.gz` (the two files and the `install.sh --sha256` argument),
  `cb-image-<version>-<sha>` (the image tag) and `unsigned` (the L1 boundary); it must state
  the archive layout (`apps/daemon/dist/main.js`, `apps/daemon/bin/cb.mjs`, `app/index.html`,
  `release.json`) and that the host points the daemon at the release with
  `CB_INSTALL_DIR=/opt/codebox/current`. §13 must state the release procedure: bump the root
  `package.json` version in a PR, tag `v<version>`, let the workflow build, verify the names
  and checksums, then the operator signs and distributes.

### Data

`release.json` is the only new persisted shape:

```json
{"version":"0.1.0","commit":"<40 hex or null>","builtAt":"2026-01-01T00:00:00Z"}
```

No `CB_*` key, no API payload and no event type is added.

## 🧩 Configuration

- No new `CB_*` key, no `docs/providers.md` change.
- Workflow-only configuration: the two dispatch inputs above and `permissions: contents:
  write`.
- The build takes its clock from `--built-at` (the workflow passes the HEAD commit time) so
  the artifact is a function of the tree, not of the job's wall clock.

## 🧪 Test and Validation Plan (for QA)

**No signing, no network, no VM, no Packer.** Everything below except the `[live]` line is
headless on this runner. The `[live]` line is measured on the box by the operator; this QA
records it `not-run` and hands it to the Orchestrator.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`.
  - `npm run lint` — must pass (`scripts/release/**/*.mjs` is linted).
  - `npm test` — the root gate; the `scripts` Vitest project picks up
    `scripts/release/*.test.mjs` with no config change.
  - `npm run build` — `tsc -b` and the app build (the workflow needs the build outputs).
  - `git diff --name-only main...task-29` — audit against the exclusive paths.
  - The explicit runs below use `mktemp -d`; they never write into the repository.
- **Acceptance criteria:**
  - [ ] `[unit]` `npm run lint`, `npm test` and `npm run build` are green; the new tests are
        listed in the `npm test` output (grep for `release/build.test.mjs` or
        `scripts` project).
  - [ ] `[unit]` A dry release produces the documented names and checksums. Run:
        ```bash
        OUT=$(mktemp -d)
        node scripts/release/build.mjs --stage scripts/release/fixtures/stage --out "$OUT" \
          --version 0.0.0 --built-at 2026-01-01T00:00:00Z --commit 0000000000000000000000000000000000000000
        ls "$OUT"                          # codebox-0.0.0.tar.gz and codebox-0.0.0.tar.gz.sha256
        (cd "$OUT" && sha256sum -c codebox-0.0.0.tar.gz.sha256)
        tar -tzf "$OUT/codebox-0.0.0.tar.gz" | sort   # includes ./release.json, ./apps/daemon/dist/main.js, ./app/index.html
        tar -xzOf "$OUT/codebox-0.0.0.tar.gz" ./release.json
        ```
        and the printed JSON is exactly
        `{"version":"0.0.0","commit":"0000000000000000000000000000000000000000","builtAt":"2026-01-01T00:00:00Z"}`.
  - [ ] `[unit]` Reproducibility: two builds of the same fixture into two different output
        directories produce the same sha256 (`sha256sum` of both archives is equal).
  - [ ] `[unit]` The version guard: `node scripts/release/build.mjs --stage
        scripts/release/fixtures/stage --out "$(mktemp -d)" --version 9.9.9 --built-at
        2026-01-01T00:00:00Z --check-package-version` exits `3` and prints a message naming
        `package.json` and the two versions.
  - [ ] `[unit]` The upgrade script refuses a checksum mismatch: the test named
        `upgrade.sh refuses a checksum mismatch` in `scripts/release/upgrade.test.mjs` builds
        two artifacts, installs the first with `upgrade.sh --root <tmp> --no-restart`, attempts
        the second with one byte of its hex altered, asserts exit `3`, and asserts
        `readlink <tmp>/opt/codebox/current` still ends `/releases/0.0.0`. A correct second
        install moves `current`, and `upgrade.sh --rollback --root <tmp>` returns it. Give the
        test an explicit 120 s timeout (cold `bash`/`tar` spawns).
        Run: `npx vitest run --project scripts -t "checksum mismatch"`.
  - [ ] `[unit]` `releaseNotes({ markdown: <CHANGELOG.md>, version: '0.0.0' })` returns the
        `## Unreleased` body with a `# Codebox 0.0.0` header; an unknown version throws
        `ReleaseNotesMissingError` (covered by `notes.test.mjs`).
  - [ ] `[unit]` `docs/operations.md` documents the frozen names and the unsigned boundary:
        `grep -F 'codebox-<version>.tar.gz' docs/operations.md`,
        `grep -F 'cb-image-<version>-<sha>' docs/operations.md` and
        `grep -F 'unsigned' docs/operations.md` all exit 0; `git diff main...task-29 --
        docs/operations.md` shows only §4 and §13.
  - [ ] `[unit]` `.github/workflows/release.yml` carries the frozen shape:
        `node -e "const y=require('fs').readFileSync('.github/workflows/release.yml','utf8');
        for (const s of ['name: Release','tags:','contents: write','scripts/release/build.mjs'])
        if(!y.includes(s)) process.exit(1)"`.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched (`package.json`,
        `package-lock.json`, `tsconfig.base.json`, `CHANGELOG.md` and `docs/decisions.md` are
        byte-identical to `main`).
  - [ ] `[live]` **An N-1 instance upgrades and answers health with the new version.**
        Measurement: on a scratch box from the image, install N-1 with
        `upgrade.sh --artifact codebox-<N-1>.tar.gz --version <N-1> --sha256 <hex>`, confirm
        `curl -sS http://127.0.0.1:8787/v1/health | jq -r .version` prints `<N-1>`, then run
        `cb update --to <N>` (which hands the N artifact to `upgrade.sh`), wait for the
        documented `--health-timeout 120`, and confirm `/v1/health` prints `<N>` and
        `cb doctor` exits `0`; the bound is exact version equality and health inside 120 s.
        Not measurable on this runner (no VM); the Orchestrator files
        `node scripts/agent/issue.mjs --label agent-review --title "Task-29: N-1 upgrade answers health with the new version" --body-file -`
        with this measurement.

## 📣 Coordination

- For the Orchestrator: this task holds **no hot file**. `package.json`, `package-lock.json`,
  `tsconfig.base.json`, `CHANGELOG.md`, `TODO.md` and `docs/decisions.md` are read-only here.
  The version is bumped in `package.json` by a normal PR **before** the tag; the workflow reads
  it and fails `3` when the tag and the file disagree.
- For the Orchestrator: `scripts/README.md` is a forced addition — `AGENTS.md` requires the
  folder's file map to move with the files, and this task appends only the
  `## scripts/release` block.
- For Task-30 (docs pass): `docs/operations.md` §2 says the installer unpacks to
  `/opt/codebox/releases/<version>` and §4 says the daemon is pointed at
  `CB_INSTALL_DIR`; the release bundle puts the SPA at `app/` inside the release, so the host
  must set `CB_INSTALL_DIR=/opt/codebox/current` (or the operator keeps a `/opt/codebox/app`
  symlink). This task states that in §4; `docs/providers.md` still documents the `/opt/codebox`
  default and is Task-30's to reconcile.
- For Task-31 (onboarding): a release is now `v<version>` → the workflow → the two files. The
  operator signs and distributes (L1); probation uses `cb update --to`.
- The image is **not** built by this workflow: `ops/image` (Packer) is operator-run and its
  name is `cb-image-<version>-<sha>`. The doc names it; the workflow does not.

## ⛔ Out of scope

- No signing, no key, no certificate, no store upload, no distribution channel: Q1 is open and
  L1 says the operator signs and distributes.
- No Packer run, no OCI/AWS image build, no Terraform change.
- No change to `ops/vm/**` or `ops/image/**`: the scripts are called, never edited.
- No `package.json`/`package-lock.json`/`tsconfig.base.json`/`CHANGELOG.md`/`docs/decisions.md`
  edit.
- No new npm dependency. The scripts use Node built-ins and the system `tar`/`gzip`.
- No change to `ci.yml` or any other workflow.
- No release of the app stores, no APK/IPA, no TestFlight.

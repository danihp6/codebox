# scripts

Local scripts. `## scripts/agent` maps the pipeline's deterministic half; `## Local development`
is the loop that builds and runs the app and the daemon on this machine.

## Local development

| File | What it is |
| --- | --- |
| `dev-local.mjs` | The local loop in one command: build the app and the daemon, link the bundle into `<CB_INSTALL_DIR>/app`, start the daemon with `.env` and mint a pairing code (`--no-build`, `--fresh`, `--port`, `--open`, `--no-pair`). |
| `dev-local.test.mjs` | Unit tests for the flags, the bind port, the `--port` rewrite and the install path. |

## scripts/agent

The deterministic half of the agent pipeline: it reads git refs and writes decisions, and it
runs before any dependency is installed (Node built-ins only). `scripts/agent/issue.mjs` is the
only sanctioned way to open a work order.

| File | What it is |
| --- | --- |
| `recon.mjs` | Reads `origin/main`, the live `origin/task-<ID>` refs and `TODO.md`, and writes `.agent_specs/resume.md`: what is in flight, whose turn it is and what to do next. |
| `recon.test.mjs` | Unit tests for the TODO parser, the turnstile classifier, the report and the ref collector. |
| `gate.mjs` | The driver's decision: brake, window, backlog, red streak and daily cap — in that order. Pure. |
| `gate.test.mjs` | Unit tests for every parking reason and the order that decides which one wins. |
| `verdict.mjs` | The cycle's outcome: a red gate fails; a moved `main` or an opened issue is green even when the stream died. Pure. |
| `verdict.test.mjs` | Unit tests for shipped, resumed, stopped and failed. |
| `issue.mjs` | Opens a work order at most once: lists the open `agent-review` and `agent-blocked` issues, creates one or comments on the lowest match. |
| `issue.test.mjs` | Unit tests for the title key, the duplicate finder, the decision, and create-once/comment-on-repeat against a fake port. |
| `vm/` | The VM host: driver, cycle, brake, install, unit, env template and the canonical prompt (`scripts/agent/vm/README.md`). |
| `README.md` | This map. |

The hosts are `docs/agent-ci.md` (GitHub Actions) and `docs/agent-vm.md` (the box). The
protocol they implement is `docs/agent-pipeline.md`.

## scripts/design

| File | What it is |
| --- | --- |
| `import.mjs` | The Figma import command: fetches the mapped page, projects its frames and writes `design/routes.json`, `design/screens/<slug>.json` and `design/exports/<slug>.png` (`--file`, `--map`, `--root`, `--check`). |
| `import.test.mjs` | Unit tests over fixture responses and an injected `fetch`: the projection, the three artifact families, `--check` drift and every exit code. |
| `layout.test.mjs` | The measured layout: autolayout padding and gap, reading order, a `COMPONENT` child, a traversed `SECTION`, the token-keyed specs and a byte-stable `--check`. |
| `fixtures/file-layout.json` | A `/v1/files` body with an autolayout frame, an inferred frame, a `COMPONENT`, a `SECTION` and the TEXT nodes the type scale needs. |
| `fixtures/import-layout.json` | The two-entry map that projects the component and the section frame of `file-layout.json`. |

## scripts/release

The release build: one staged payload, one reproducible archive and the notes, with no
credential, no network and no signing step.

| File | What it is |
| --- | --- |
| `stage.mjs` | Copies the built tree into a release payload: the daemon `dist` and `bin`, every package's `dist` and `package.json`, the SPA at `app/`, the production `node_modules` and the root `package.json` (`--out`, `--root`). |
| `build.mjs` | Cuts `codebox-<version>.tar.gz` reproducibly (sorted entries, fixed mtime and owner, `gzip -n -9`), writes the `sha256sum` file and puts `release.json` inside the archive (`--stage`, `--out`, `--version`, `--built-at`, `--commit`, `--check-package-version`). |
| `notes.mjs` | Reads one version's section from `CHANGELOG.md`, or `## Unreleased` when the tag has none, and writes the release notes (`--version`, `--changelog`, `--out`). |
| `stage.test.mjs` | The copy plan, the optional `node_modules`, symlinks kept as symlinks and the missing build output. |
| `build.test.mjs` | The artifact and checksum names, the manifest, the archive members, reproducibility and the version guard. |
| `notes.test.mjs` | The version section, the `## Unreleased` fallback and the missing section. |
| `upgrade.test.mjs` | `ops/vm/upgrade.sh` against a built artifact: a corrupted checksum keeps `current`, a good one moves it, `--rollback` returns it. |
| `fixtures/stage/` | A committed minimal payload for the tests and the dry release: the daemon `dist` and `bin`, the contracts `dist` and the SPA, and no `node_modules`. |

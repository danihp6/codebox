# Changelog

All notable changes to Codebox. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer once the
first release exists.

## Unreleased

### Added — 2026-10-24 (OCI migration, pulled forward)

- `ops/oci/launch.sh`: the retry loop extracted from `pkm-randomlike`, with `CB_OCI_*`
  knobs, `cb-instance` as the idempotency key and a `--dry-run` check.
- `.github/workflows/oci-retry.yml`: the chained wait, the `CB_OCI_RETRY=off` brake, the
  `oci-ready` announcement and a 10-minute cron as the safety net.
- The `cb-*` network (`cb-vcn`, `cb-igw`, `cb-rt`, `cb-sl`, `cb-subnet`), the `cb-ci`
  identity and its API key in OCI; `danihp6/codebox` is public so the wait spends no
  Actions minutes.

### Added — 2026-10-24 (Task-01, monorepo bootstrap)

- npm workspaces for `apps/daemon`, `apps/app` and the eight `packages/*` stubs, so every
  later batch has a home and one lockfile.
- Root scripts (`lint`, `test`, `build`, `typecheck`, `format`), `tsconfig.base.json`,
  ESLint + Prettier, the Vitest workspace, `.editorconfig` and `.gitignore`.
- Node 24 pinned in `engines`; the CI gate runs `npm ci && npm run lint && npm test &&
  npm run build` on every push to `main` and every pull request
  (`.github/workflows/ci.yml`).

### Added — 2026-10-24 (design batch)

The first delivery is documentation only. It fixes the name, the product, the architecture,
the contracts and the delivery plan before any code exists.

- Product definition, personas, flows, MVP scope, non-goals and success criteria
  (`docs/product.md`).
- Architecture: components, trust boundaries, data model, flows, deployment topology,
  failure modes and the deliberate non-goals (`docs/architecture.md`).
- Frozen decisions D1–D36 (`docs/decisions.md`).
- The hybrid app plan: Angular 22 + Ionic Angular 9 + Capacitor, screens, templates,
  offline, push, auth and release (`docs/app.md`).
- The versioned HTTP + SSE contract (`docs/api.md`).
- OpenCode V2 runtime integration, session model, permission policy and event normalisation
  (`docs/agent-runtime.md`).
- Job scheduling, run lifecycle, gate, PR and auto-merge guardrails (`docs/jobs.md`).
- The complete `CB_*` configuration and provider matrix (`docs/providers.md`).
- Threat model, controls and accepted risks (`docs/security.md`).
- The extracted OCI inventory, renamed resources and the reusable retry action
  (`docs/oci.md`).
- The Packer-based VM image, first boot, update and rollback (`docs/vm-image.md`).
- The operations runbook, backup/restore drill and incident playbooks
  (`docs/operations.md`).
- The adapted multi-agent batch pipeline, spec template and four role prompts
  (`docs/agent-pipeline.md`, `docs/agent-spec-template.md`, `.agent_roles/`).
- The GitHub Actions and VM hosts of the autopilot (`docs/agent-ci.md`,
  `docs/agent-vm.md`).
- Roadmap, open questions and the execution backlog (`docs/roadmap.md`,
  `docs/open-questions.md`, `TODO.md`).

### Changed

- D37: the source repository is **public**, so the OCI wait and the agent loop spend no
  Actions minutes. `docs/agent-ci.md` §8 and §11 now treat the private-plan allowance as a
  fallback for the day it goes private.
- `AGENTS.md` and `README.md` moved from *design only* to *bootstrap* after Task-01 merged.
- Task-24 and Task-32 re-scoped to what is actually left: Task-24 keeps the reproducible OCI
  part (`provision.sh`, `policy.md`, shell tests), Task-32 only deletes pkm's duplicate
  workflow and stale variables.
- D34 amended: the OCI retry moved out of `pkm-randomlike` before parity. That repository
  is braked (`OCI_RETRY=off`), its `pkm-vcn`/`pkm-subnet` are deleted, and its remaining OCI
  variables are stale by design; Task-32 is now only the cleanup.
- The project was renamed from the working title *Groundstation* to **Codebox** before the
  first commit: binary `codebox` with alias `cb`, daemon `cbd`, environment prefix `CB_`,
  OCI resources `cb-*`, branch prefix `cb/`. *Groundstation* was dropped because
  **AWS Ground Station** already owns the name.

### Fixed

- Nothing yet.

### Security

- No code, no running service, no credential in this repository. The security section
  describes the future controls; it does not claim they exist.

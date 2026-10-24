# Changelog

All notable changes to Codebox. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer once the
first release exists.

## Unreleased

### Added — 2026-10-24 (Task-33, routine contracts)

- `Routine` is now a contract: a discriminated union on `kind` where a `prompt` requires a
  repo and a prompt while a `reminder` carries neither, with `rtn_` ids, the chat-tool input
  and output schemas, and the `/v1/routines` shapes.
- The `routine.fired`, `routine.replied` and `routine.failed` events join the frozen list
  (23 names), the OpenAPI document grows from 41 to 46 paths and both are checked against
  `docs/api.md` and `docs/decisions.md`.

### Added — 2026-10-24 (Task-06, security primitives)

- `@codebox/security` ships the pairing code (ten Crockford characters, single use, TTL,
  constant-time compare), scrypt hashing and device fingerprints, HMAC access tokens with
  scopes and a deterministic refresh-token hash for device lookup.
- `redact` walks a nested object on a new graph and never mutates its input, matching the
  documented key patterns; Cloudflare Access JWT verification returns a typed reason
  (`wrong_aud`, `expired`, `bad_signature`, `unsupported_alg`, `unknown_kid`, …).
- Argon2id is not a Node built-in and no dependency was added: the doc's "Argon2id or scrypt"
  is now scrypt for compared values and a keyed hash for looked-up values, written into
  `docs/security.md` §4.

### Added — 2026-10-24 (Task-05, core rules)

- `@codebox/core` holds the domain as pure functions: the run state machine with its legal
  transitions and cancellable states, and `evaluateAutoMerge` over the eight D12 guardrails in
  a fixed order with a typed blocker per red case.
- Cron parsing and next-fire in an IANA zone with the two DST rules, the D13 misfire decision,
  the D26 protected-path globs and the 41-file / 2 001-line diff budget.
- The D27 permission matrix (`allow`/`ask`/`deny`, fails closed outside the worktree) and the
  D29 cost/timeout checks; the clock is always an argument, so every rule is table-tested.

### Added — 2026-10-24 (Task-04, store)

- `@codebox/store` is the only SQL owner: `0001_init.sql` creates the ten tables and their
  named indexes in WAL mode with foreign keys enforced, and the runner is checksum-pinned,
  forward-only and one transaction per file.
- Repositories for repos, jobs, runs, events, approvals, chats, devices, settings and usage,
  an in-memory store for tests, stable cursor pagination and a `claimScheduledRun`
  transaction that returns one winner under concurrent attempts.
- Event replay is exact both by per-run `seq` and by the global `Last-Event-ID`, and a repo
  with a live run cannot be deleted.

### Added — 2026-10-24 (Task-24, reproducible OCI network)

- `ops/oci/provision.sh`: `--plan` prints every `cb-*` name, CIDR and ingress rule with no
  OCI call, `--apply` creates what is missing by name and `--destroy` tears the network down
  in reverse order while keeping `cb-boot` and the image; the tenancy is the only state.
- `ops/oci/policy.md`: the `cb-ci` / `cb-instance` grants verbatim from `docs/oci.md`, with
  the D20 rule that the instance holds no OCI API key.
- Nine fixture-driven shell tests (five `launch.sh` outcomes, four `provision.sh` contracts)
  under a new `ops` Vitest project, so `npm test` covers the retry loop.
- The `[live]` criterion (one dispatched `oci-retry` run finding the existing `cb-instance`)
  is **not measured** here; an `agent-review` issue carries its measurement.

### Added — 2026-10-24 (Task-03, contracts)

- `@codebox/contracts` is now the executable form of the API: zod schemas and inferred types
  for every resource (`Repo`, `Job`, `Run`, `Approval`, `ChatSession`, `Device`, `Telemetry`,
  health, settings, push), the error envelope with the documented status per code, pagination
  and idempotency, and one `parse*` helper per boundary that throws a path-carrying typed
  error.
- The 20 D14/D16 SSE event names and their strict `data` shapes, the two run/chat bases and
  the `gap` control frame; the event list cannot drift from the schema.
- The `CB_*` config schema for `docs/providers.md` §2–§11 with every documented default, the
  secret redaction list, and validation that never echoes a secret value.
- A generated OpenAPI 3.1 document (`buildOpenApiDocument`) whose 41 paths are checked against
  `docs/api.md`; `zod@4.6.7` is the only new dependency.

### Added — 2026-10-24 (OCI migration, pulled forward)

- `ops/oci/launch.sh`: the retry loop extracted from `pkm-randomlike`, with `CB_OCI_*`
  knobs, `cb-instance` as the idempotency key and a `--dry-run` check.
- `.github/workflows/oci-retry.yml`: the chained wait, the `CB_OCI_RETRY=off` brake, the
  `oci-ready` announcement and a 10-minute cron as the safety net.
- The `cb-*` network (`cb-vcn`, `cb-igw`, `cb-rt`, `cb-sl`, `cb-subnet`), the `cb-ci`
  identity and its API key in OCI; `danihp6/codebox` is public so the wait spends no
  Actions minutes.

### Added — 2026-10-24 (Task-02, agent pipeline)

- The deterministic core (`recon`, `gate`, `verdict`) with its unit tests, `opencode.json`
  wired to the four roles, the Actions host (`agent-cycle`, `agent-autopilot`, the timed
  window) and the VM host (`run-cycle`, `run-driver`, `brake`, `install.sh`,
  `cb-agent.service`).
- The smoke workflow is removed and `docs/agent-ci.md` no longer describes it.
- **Blocked:** the `[live]` criterion (one real cycle that moves `main` or opens an issue)
  needs `CB_AGENT_MODEL` and a provider key. Task-02 stays `[!]` until it is measured.

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

- D38: **two schedules, one clock.** Jobs stay repo transactions; **routines** are chat
  schedules (`prompt`/`reminder`) created by the chat agent through a daemon tool, fired by the
  same scheduler. A prompt routine with no session — or an archived one — gets a new chat on
  fire. Tasks 33–36 and the local L1/L2 items are in the backlog.
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

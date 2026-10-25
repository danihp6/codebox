# Codebox — Roadmap (TODO)

Private control plane for OpenCode on an OCI VM, controlled by a hybrid Angular app.
Backlog source of truth. One branch per task off `main` (`task-<ID>` for an agent batch).

Legend: `[ ]` open, `[~]` in progress, `[!]` **blocked** (the mark carries its
`BLOCKED: <reason>` in the item, and the cycle skips it — `docs/agent-ci.md` §Task states).
Only open work lives here; completed items are archived in `CHANGELOG.md`, grouped by phase.
A phase is "done" when every box in it is ticked and its exit criterion is met.

- **IDs.** `[Task-NN]` is bound to a task only in this file; everywhere else a task is
  referenced by name. Two digits, in backlog order.
- **Dependencies.** Every open item ends with `*Dependencies:*` — the authoritative graph. A
  dependency exists only when a task cannot be written without a file, type, schema or
  generated asset another task produces. Phase order is not a dependency.
- **Batches.** A batch is an antichain: no task depends on another task in it, and no two
  tasks create or modify the same path — except a `docs/*.md` file shared by disjoint
  sections, named in the plan. A batch is a label on open items, not a rewrite of the
  backlog. Batches run in order; a task's branch is cut from `main` once every earlier batch
  is merged.
- **Hot files.** At most one task per batch claims `package.json`, `package-lock.json`,
  `tsconfig.base.json`, `apps/app/angular.json`, `apps/app/src/app/app.routes.ts`,
  `apps/app/src/main.ts`, `apps/daemon/src/main.ts`, `packages/contracts/src/index.ts`,
  `opencode.json`, `TODO.md`, `CHANGELOG.md`, `docs/decisions.md`, or any generated API file.
  Each batch names the holder below.
- **Batch filling.** A one-task batch never wastes the other dev slots: the Orchestrator
  pulls dependency-free tasks from later batches when their paths are disjoint, they need no
  file a batch-mate produces, and their dependencies are merged. The cut is the floor, not
  the ceiling.
- **Acceptance tags.** `[unit]` = a headless command, a decoded value, a pinned number.
  `[live]` = only exists in the running system (streaming, a push, a tunnel, a UI state);
  it states its measurement. An untagged criterion is a spec bug.

## Batch plan

**Batch 0 (design) is shipped.** It produced this documentation set; there is no code yet.

| Batch | Theme | Tasks | Parallel slots |
| --- | --- | --- | --- |
| 1 | Repository bootstrap + agent pipeline | 01–02 | 2 |
| 2 | Contracts, store, core rules, security | 03 → 04–06 | 1, then 3 |
| 3 | Integrations: OpenCode, workspaces, scheduler, GitHub | 07–10 | 4 |
| 4 | Daemon: config, auth, chat, runs, CLI | 11–12, 13–17 | 2, then 4 |
| 5 | Hybrid app shell and screens | 18 → 19–23 | 1, then 5 |
| 6 | OCI extraction and VM image | 24–25, 33 | 3 |
| 7 | Hardening, e2e, observability, release | 26–30 | 5 |
| 8 | Beta, onboarding, migration of pkm | 31–32, 34 | 3 |
| 9 | Chat routines and reminders | 35–36 | 1, then 2 |

**Critical path:** `03 → 04/05/06 → 09 → 14 → 15 → 18 → 20 → 26 → 31`. Everything else can
fill a slot beside it. The four hot files that serialise the tail are `docs/decisions.md`,
`packages/contracts/src/index.ts`, `apps/app/src/app/app.routes.ts` and
`apps/daemon/src/main.ts`.

**Serial resources:** `packages/contracts/src/index.ts` (Task-03 owns it for Batch 2; later
contract changes are their own task), `apps/app/src/app/app.routes.ts` (Task-18 predeclares
every lazy route so Batch 5 fills in parallel), `apps/daemon/src/main.ts` (Task-11 wires every
subsystem behind feature flags; later tasks add modules, not imports), `opencode.json` and
`package.json` (Task-01 only, unless a task is explicitly the dependency owner).

---

## Batch 0 — Design (shipped 2026-10-24)

The documentation set below is the deliverable of this batch. It is kept in the tree because
later batches cite it; it is not a code batch.

- [x] **Design-01** Product, architecture and decisions. `README.md`, `docs/product.md`,
      `docs/architecture.md`, `docs/decisions.md`.
- [x] **Design-02** App, API and provider contracts. `docs/app.md`, `docs/api.md`,
      `docs/providers.md`.
- [x] **Design-03** Runtime, jobs and auto-merge. `docs/agent-runtime.md`, `docs/jobs.md`.
- [x] **Design-04** Security, OCI and VM image. `docs/security.md`, `docs/oci.md`,
      `docs/vm-image.md`.
- [x] **Design-05** Operations and agent pipeline. `docs/operations.md`,
      `docs/agent-pipeline.md`, `docs/agent-spec-template.md`, `.agent_roles/*`.
- [x] **Design-06** Roadmap and open questions. `docs/roadmap.md`,
      `docs/open-questions.md`, `TODO.md`, `CHANGELOG.md`.

**Exit criterion:** a new agent can read `AGENTS.md` plus one spec and implement a task
without asking a question that the docs already answer.

---

## Batch 1 — Repository bootstrap + agent pipeline

**Hot-file holders:** Task-01 holds `package.json`, `package-lock.json`, `tsconfig.base.json`,
`.gitignore`, `.github/workflows/ci.yml`; Task-02 holds `opencode.json`, `.agent_roles/**`,
`scripts/agent/**`, `.github/workflows/agent-*.yml`.

- [x] **[Task-01]** Monorepo bootstrap. Create npm workspaces (`apps/daemon`, `apps/app`,
      `packages/{contracts,core,store,opencode,workspaces,scheduler,git-provider,security}`),
      root `package.json` scripts (`lint`, `test`, `build`, `typecheck`), `tsconfig.base.json`,
      ESLint/Prettier, Vitest workspace, `.gitignore`, `.editorconfig`, stub `README.md` per
      package, and the CI workflow (`npm ci && npm run lint && npm test && npm run build`).
      Pin Node 24 and TypeScript. *Paths:* root configs, `apps/*/package.json`,
      `packages/*/package.json`, `packages/*/README.md`, `.github/workflows/ci.yml`.
      *Dependencies:* none. *Acceptance:* `[unit]` clean install from a fresh clone, `npm run
      lint`, `npm test` and `npm run build` pass with the empty stubs; `[unit]` every
      workspace resolves through the root lockfile; `[unit]` no package has a dependency it
      does not import.
- [!] **[Task-02]** Agent pipeline wiring. Implement the pipeline designed in
      `docs/agent-pipeline.md`, `docs/agent-ci.md` and `docs/agent-vm.md`, adapted from
      `pkm-randomlike` with Codebox names: reconcile `.agent_roles/{orchestrator,architect,dev,qa}.md`
      with the scripts, and add `opencode.json`, `scripts/agent/{recon.mjs,gate.mjs,verdict.mjs}`,
      `scripts/agent/vm/{run-driver.sh,run-cycle.sh,brake.sh,lib.sh,install.sh,prompt.md}`,
      and `.github/workflows/{agent-cycle,agent-autopilot,agent-autopilot-window}.yml`.
      Do not copy project-specific asset logic. The three design docs are the source of truth:
      where the port and a doc disagree, the code changes. If the doc itself is wrong, amend it
      here and say so in the report. *Paths:* `opencode.json`, `.agent_roles/**`,
      `scripts/agent/**`, `docs/agent-pipeline.md`, `docs/agent-ci.md`, `docs/agent-vm.md`,
      `.github/workflows/agent-*.yml`, `.gitignore` (only the `.agent_specs/` line, coordinated
      with Task-01).
      *Dependencies:* Task-01 (root scripts and workspace names). *Acceptance:* `[unit]`
      `gate.mjs` and `verdict.mjs` have their ported tests and pass; `[unit]` a dry `brake.sh
      status` on a temp state directory reports the expected fields; `[live]` one dispatched
      `agent-cycle` on a throwaway branch moves `main` or opens an `agent-blocked` issue and
      the run summary says which.
      BLOCKED: the `[live]` criterion is not measured — it needs `CB_AGENT_MODEL` and a
      provider-key secret (`OPENCODE_API_KEY` / `ANTHROPIC_API_KEY` / …). The code and both
      `[unit]` criteria are on `main`; free this task once the secrets exist.

---

## Batch 2 — Contracts, store, core rules, security

**Hot-file holders:** Task-03 holds `packages/contracts/src/index.ts` and
`docs/api.md` (schema section); Task-04 holds `packages/store/migrations/**`; Task-05 holds
`docs/jobs.md` (guardrail section); Task-06 holds `docs/security.md` (auth section).

- [x] **[Task-03]** Contracts. Zod schemas and TypeScript types for every API resource
      (`Repo`, `Job`, `Run`, `Approval`, `ChatSession`, `Device`, `Telemetry`), every SSE
      event in D14/D16, the config schema for `docs/providers.md`, and the error envelope.
      Export a `parse` helper per boundary. Generate or check `docs/api.md` against the
      schemas. *Paths:* `packages/contracts/**`, `docs/api.md` (schema section only).
      *Dependencies:* Task-01. *Acceptance:* `[unit]` a fixture per resource and event parses;
      `[unit]` an invalid payload returns a typed error with a path; `[unit]` the config
      schema rejects a missing secret and accepts the documented defaults; `[unit]` the
      OpenAPI document builds and validates (3.1).

- [x] **[Task-04]** Store. SQLite WAL schema from `docs/architecture.md` §2, numbered
      migrations, repositories for repos/jobs/runs/events/approvals/chat/devices/settings/
      usage, an in-memory fake for tests, and the transactional claim used by the scheduler.
      *Paths:* `packages/store/**`, `docs/architecture.md` (table section only).
      *Dependencies:* Task-03. *Acceptance:* `[unit]` migrations apply to an empty database
      and are idempotent; `[unit]` the claim transaction returns one winner under 20
      concurrent attempts; `[unit]` event replay by `seq` and by `Last-Event-ID` is exact;
      `[unit]` foreign keys are enforced and a deleted repo refuses to orphan a live run.

- [x] **[Task-05]** Core rules. Pure functions for the run state machine, the D12 auto-merge
      guardrails, D13 cron/misfire, D26 protected paths and diff budget, D27 permission
      policy, D29 cost/timeout. *Paths:* `packages/core/**`, `docs/jobs.md` (guardrail and
      lifecycle sections only). *Dependencies:* Task-03. *Acceptance:* `[unit]` every legal
      transition is accepted and every illegal one rejected with a reason; `[unit]` a
      table-driven test covers each guardrail red and green, including the "base moved" and
      "protected path" cases; `[unit]` DST transitions in `Europe/Madrid` produce the
      documented next fire; `[unit]` a diff of 41 files or 2 001 lines fails the budget.

- [x] **[Task-06]** Security primitives. Pairing codes (TTL, single use, constant-time),
      device key fingerprints, access/refresh tokens, scopes, Argon2id/scrypt hashing,
      redaction, and optional Cloudflare Access JWT verification. *Paths:*
      `packages/security/**`, `docs/security.md` (auth section only). *Dependencies:* Task-03.
      *Acceptance:* `[unit]` a used or expired code never pairs twice; `[unit]` a revoked
      device fails every scope; `[unit]` redaction removes the documented key list from a
      nested object and never mutates the input; `[unit]` Access JWT verification rejects a
      wrong `aud`, an expired token and an unsigned token.

---

## Batch 3 — Integrations

**Hot-file holders:** Task-07 holds `docs/agent-runtime.md`; Task-08 holds
`packages/workspaces/README.md`; Task-09 holds `docs/jobs.md` (scheduling section); Task-10
holds `docs/jobs.md` (PR section) — Task-05 already holds the guardrail section, so 09 and 10
must not edit it.

- [x] **[Task-07]** OpenCode wrapper. Pin `@opencode/client`; implement session create,
      prompt, interrupt, event subscription, permission list/reply, models and agents;
      normalise events into contracts; record fixtures from a fake server. Add a supervisor
      (start/health/restart) and a `FakeOpenCode` for tests. *Paths:* `packages/opencode/**`,
      `docs/agent-runtime.md`. *Dependencies:* Task-03, Task-05 (permission policy).
      *Acceptance:* `[unit]` every normalised event validates against its schema; `[unit]` a
      fixture replay produces the documented timeline for a run; `[unit]` a dropped stream
      reconnects once and reports `agent_unavailable` if it cannot; `[unit]` the supervisor
      restarts a dead child and refuses a second listener on the port.

- [x] **[Task-08]** Workspaces. Bare clone cache, fetch, worktree create/remove, branch
      naming, diff stat, protected-path scan, disk cleanup, and an injectable git runner for
      tests. *Paths:* `packages/workspaces/**`, `docs/architecture.md` (workspace section
      only). *Dependencies:* Task-03, Task-05. *Acceptance:* `[unit]` two worktrees from one
      bare clone do not share a path; `[unit]` removal leaves the cache intact; `[unit]` a
      failed clone does not leave a half directory; `[unit]` the protected-path scan finds
      `.github/workflows/x.yml` and `ops/vm/install.sh`; `[live]` on the reference VM a
      100 MB repo clones once and a second run reuses the cache in under 5 s.

- [x] **[Task-09]** Scheduler. Cron parsing, next-run in IANA timezone, due selection with
      grace, misfire policy, queue ordering, and the 15-second tick contract. *Paths:*
      `packages/scheduler/**`, `docs/jobs.md` (scheduling section only). *Dependencies:*
      Task-03, Task-05. *Acceptance:* `[unit]` next fire matches a table of known cases across
      DST; `[unit]` a missed fire inside the grace runs once, outside it is logged once and
      skipped; `[unit]` two ticks in the same second claim one run; `[unit]` a paused job is
      never due.

- [x] **[Task-10]** GitHub provider. App JWT → installation token, repo verification, branch
      push, PR open, checks read, merge (squash/merge), close, and idempotency by branch.
      PAT fallback. Mock the GitHub HTTP surface in tests. *Paths:*
      `packages/git-provider/**`, `docs/jobs.md` (PR section only). *Dependencies:* Task-03,
      Task-05. *Acceptance:* `[unit]` a 401 refreshes the installation token once and retries;
      `[unit]` a second push to the same branch updates the PR instead of opening a duplicate;
      `[unit]` a red required check maps to `checks_red`; `[unit]` every error maps to a
      contract error code, never a raw GitHub body.

---

## Batch 4 — Daemon

**Hot-file holders:** Task-11 holds `apps/daemon/src/main.ts` and the static hosting config;
Task-12 holds `docs/api.md` (auth section); Task-13 holds `docs/api.md` (chat section);
Task-14 holds `apps/daemon/src/run/**`; Task-15 holds `docs/api.md` (jobs/runs section);
Task-16 holds `docs/providers.md` (push section); Task-17 holds `apps/daemon/src/cli/**`.

- [x] **[Task-11]** Daemon skeleton. Config load/validate, logger, SQLite wiring, Hono app,
      health/version, static app hosting, graceful shutdown, boot reconciliation (orphaned
      runs → `failed`, stale locks removed), and feature flags for the subsystems later tasks
      add. *Paths:* `apps/daemon/src/{main,config,app,health,boot}.ts`,
      `apps/daemon/package.json`, `apps/daemon/README.md`. *Dependencies:* Task-01, Task-03,
      Task-04. *Acceptance:* `[unit]` a missing required env fails fast with the key name and
      no secret in the message; `[unit]` `/v1/health` reports db, opencode and disk; `[unit]`
      boot reconciliation marks a fake running run failed once; `[live]` `npm start` serves
      the health endpoint and the built app on the configured port.

- [x] **[Task-12]** Auth and pairing. Pairing code issue (admin-only), exchange, refresh,
      logout, device list/revoke, scopes, and middleware for every `/v1` route except health
      and pairing. *Paths:* `apps/daemon/src/auth/**`, `docs/api.md` (auth section only).
      *Dependencies:* Task-06, Task-11. *Acceptance:* `[unit]` no `/v1` route responds without
      a token except the documented two; `[unit]` refresh rotates and invalidates the old
      token; `[unit]` a revoked device gets 401 on the next request; `[live]` a real pairing
      from the CLI to a phone emulator completes in under two minutes.

- [x] **[Task-13]** Chat API and event bridge. Persistent chat sessions bound to a repo,
      message post, history cursor, interrupt, OpenCode session mapping, SSE normalisation,
      and permission cards. *Paths:* `apps/daemon/src/chat/**`,
      `apps/daemon/src/events/**`, `docs/api.md` (chat section only). *Dependencies:* Task-07,
      Task-11, Task-12. *Acceptance:* `[unit]` a fixture conversation replays in order with
      monotonic `seq`; `[unit]` an interrupt ends the stream and marks the session idle;
      `[unit]` a permission request becomes one approval and a reply reaches OpenCode;
      `[live]` two devices see the same chat delta within 1.5 s.

- [x] **[Task-14]** Run engine. Orchestrate worktree → session → prompt → gate → commit →
      push → PR → guardrails → merge; cancellation, timeout, cost cap, retries that are new
      runs, and the post-merge notification. *Paths:* `apps/daemon/src/run/**`,
      `apps/daemon/src/gate/**`. *Dependencies:* Task-05, Task-07, Task-08, Task-09, Task-10,
      Task-11. *Acceptance:* `[unit]` a fake successful run walks every state once and emits
      the documented event sequence; `[unit]` a red gate never reaches `merging`; `[unit]` a
      protected-path diff stays in `pr_open` with a `protected_path` blocker; `[unit]` cancel
      during `running` kills the session and removes the worktree; `[live]` a real run on a
      scratch repo opens a PR and merges only after the gate and the checks are green.

- [x] **[Task-15]** Jobs/runs API. CRUD for jobs, run now, pause/resume, runs list/detail,
      cancel, event replay, approvals inbox and reply. Idempotency keys. *Paths:*
      `apps/daemon/src/jobs/**`, `apps/daemon/src/runs/**`, `docs/api.md` (jobs/runs section
      only). *Dependencies:* Task-11, Task-12, Task-14. *Acceptance:* `[unit]` every route
      matches its contract schema; `[unit]` a duplicate `Idempotency-Key` returns the first
      run; `[unit]` cursor pagination is stable while new runs arrive; `[live]` the app can
      create a job and see it fire without a page reload.

- [ ] **[Task-16]** Notifications. Web Push subscription, VAPID signing, Capacitor push
      payload mapping, deduplication, and per-event preferences. *Paths:*
      `apps/daemon/src/push/**`, `docs/providers.md` (push section only). *Dependencies:*
      Task-11, Task-13 (events). *Acceptance:* `[unit]` a finished run produces one push per
      device and not one per event; `[unit]` an expired subscription is pruned; `[live]` a
      real browser subscription receives the push and deep-links to the run.

- [x] **[Task-17]** CLI. `cb pair`, `cb status`, `cb doctor`, `cb run`, `cb jobs`, `cb logs`,
      `cb brake`, `cb update`, `cb backup`, `cb revert`. Thin client over `/v1` plus a local
      admin socket for pairing/brake. *Paths:* `apps/daemon/src/cli/**`,
      `apps/daemon/bin/**`, `docs/operations.md` (CLI section only). *Dependencies:* Task-11,
      Task-12. *Acceptance:* `[unit]` `cb doctor` exits non-zero with one line per failed
      check; `[unit]` the CLI never prints a token; `[live]` `cb pair` on the VM prints a QR
      that the app accepts.

---

## Batch 5 — Hybrid app

**Hot-file holders:** Task-18 holds `apps/app/angular.json`, `apps/app/src/main.ts`,
`apps/app/src/app/app.routes.ts`, `apps/app/src/app/app.config.ts`, the theme and the API
client. Tasks 19–23 own disjoint feature folders and do not edit the router.

- [x] **[Task-18]** App shell. Ionic Angular 22 standalone starter (tabs), theme tokens,
      Capacitor config, secure storage, API client generated from contracts, auth/pairing
      flow, SSE service with reconnect, route placeholders for every screen, i18n scaffold
      (EN/ES), PWA manifest and service worker. *Paths:* `apps/app/**` except the feature
      folders reserved by 19–23, `docs/app.md` (stack section). *Dependencies:* Task-03,
      Task-12. *Acceptance:* `[unit]` `ng build` and `ng test` pass; `[unit]` a mocked API
      pairing succeeds and stores nothing in `localStorage`; `[unit]` the SSE client
      reconnects with backoff and resumes from `Last-Event-ID`; `[live]` the built PWA runs
      in a mobile viewport with no horizontal scroll and the pairing screen is usable at
      320 px.

- [ ] **[Task-19]** Dashboard and repos. Health cards (VM, queue, spend), recent runs, repo
      list, add repo wizard, gate/policy editor, protected-paths preview. *Paths:*
      `apps/app/src/app/features/dashboard/**`,
      `apps/app/src/app/features/repos/**`. *Dependencies:* Task-18. *Acceptance:* `[unit]`
      the repo form rejects a slug without `owner/name`; `[unit]` a policy change is sent as
      a PATCH and reflected optimistically; `[live]` adding a repo shows its gate result
      without a reload.

- [ ] **[Task-20]** Chat. Session list, message stream, tool cards, permission cards,
      interrupt, markdown/code rendering, repo switcher, "promote to run" action. *Paths:*
      `apps/app/src/app/features/chat/**`. *Dependencies:* Task-18. *Acceptance:* `[unit]`
      deltas append in order and a reconnect does not duplicate a message; `[unit]` a
      permission card disables after reply; `[live]` a 200-token stream renders without
      layout jump and the input stays usable while the agent works.

- [ ] **[Task-21]** Jobs and runs list. Job list, create/edit with a cron picker and timezone,
      pause/resume, run now, next-fire preview, runs list with filters and status chips.
      *Paths:* `apps/app/src/app/features/jobs/**`,
      `apps/app/src/app/features/runs-list/**`. *Dependencies:* Task-18. *Acceptance:*
      `[unit]` the cron picker produces a valid 5-field expression and a human summary;
      `[unit]` a paused job hides "run now" only for the scheduler, not for the manual
      action; `[live]` a created job appears in the list with the next fire in the selected
      timezone.

- [ ] **[Task-22]** Run detail. Timeline, gate output, guardrail checklist, diff stat, PR
      link, merge result, cost, cancel, revert. *Paths:*
      `apps/app/src/app/features/run-detail/**`. *Dependencies:* Task-18. *Acceptance:*
      `[unit]` each guardrail renders red/green from the contract, not from a string match;
      `[unit]` cancel is confirmed and reflects the `cancelled` event; `[live]` a run's
      timeline updates live and the revert action opens the generated PR in the browser.

- [ ] **[Task-23]** Settings, devices and notifications. Profile, paired devices with revoke,
      notification preferences, provider status, danger zone (brake, wipe cache), about.
      *Paths:* `apps/app/src/app/features/settings/**`. *Dependencies:* Task-18. *Acceptance:*
      `[unit]` revoking the current device logs out locally and clears the secure store;
      `[unit]` notification preferences are validated against the contract; `[live]` a
      preference change is reflected in the next push.

---

## Batch 6 — OCI extraction and VM image

- [x] **[Task-24]** OCI extraction, remainder. The retry already moved early (2026-10-24,
      D34 amended): `ops/oci/launch.sh`, `.github/workflows/oci-retry.yml` and the `cb-*`
      resources exist. What is missing is the reproducible part: `ops/oci/provision.sh` (VCN,
      IGW, route table, security list, subnet; `--plan`, `--apply`, `--destroy`),
      `ops/oci/policy.md` (the `cb-ci` / instance split) and the shell tests around
      `launch.sh`. *Paths:* `ops/oci/**`, `.github/workflows/oci-retry.yml`, `docs/oci.md`.
      *Dependencies:* Task-01. *Acceptance:* `[unit]` the launch script's shell tests pass
      (fixture `oci` binary) for capacity, throttle, bad shape, missing key and an
      already-running instance; `[unit]` a dry `provision.sh --plan` prints the exact `cb-*`
      resource names and makes no call; `[live]` one dispatched retry run finds the existing
      instance, parks, announces it once and does not chain.

- [x] **[Task-25]** VM image. Packer template for Ubuntu 24.04 arm64 installing Node 24, git,
      gh, opencode, cloudflared, build tools and the systemd units; cloud-init for first boot
      (hostname, instance identity, Vault fetch); `ops/vm/install.sh`, `upgrade.sh`,
      `backup.sh`, `restore.sh`; no secrets baked. *Paths:* `ops/image/**`, `ops/vm/**`,
      `docs/vm-image.md`, `docs/operations.md` (install/upgrade sections). *Dependencies:*
      Task-24. *Acceptance:* `[unit]` `packer validate` passes; `[unit]` a grep of the built
      image's `/etc` and `/opt` finds no token pattern; `[unit]` cloud-init is idempotent on
      second boot; `[live]` an instance launched from the image boots, starts the tunnel and
      answers `/v1/health` without manual steps.

- [x] **[Task-33]** Routine contracts. Zod schemas and types for `Routine` (`kind` =
      `prompt`/`reminder`, cron, IANA timezone, optional `repoId` and `prompt`, optional
      `chatSessionId`, `enabled`, `nextFireAt`, `lastFiredAt`, `notify`) and for the chat tool
      input/output that creates them; the `routine.fired`, `routine.replied` and
      `routine.failed` events; the `/v1/routines` shapes. *Paths:* `packages/contracts/**`,
      `docs/api.md` (routine section). *Dependencies:* Task-03. *Acceptance:* `[unit]` a
      fixture per kind parses; `[unit]` a prompt routine without repo/prompt is rejected and a
      reminder without prompt is accepted; `[unit]` the tool schema rejects a missing timezone;
      `[unit]` the OpenAPI document lists the three events.

---

## Batch 7 — Hardening, e2e, observability, release

- [ ] **[Task-26]** End-to-end happy path. Playwright against the built app with a fake
      OpenCode and a fake GitHub: pair → add repo → run → gate → PR → merge → push. *Paths:*
      `e2e/**`, `.github/workflows/e2e.yml`. *Dependencies:* Task-20, Task-22, Task-14,
      Task-15. *Acceptance:* `[unit]` the suite is deterministic with a fixed clock and seed;
      `[live]` the full flow passes twice in a row on CI with no network access; `[live]` a
      forwarded push is observed by a service worker.

- [ ] **[Task-27]** Observability and cost. Telemetry endpoint, usage ledger, daily cost
      aggregation, disk/queue metrics, retention job, `cb doctor` checks. *Paths:*
      `apps/daemon/src/telemetry/**`, `packages/core/src/usage.ts`,
      `docs/operations.md` (telemetry section). *Dependencies:* Task-04, Task-11, Task-17.
      *Acceptance:* `[unit]` usage aggregates by day and repo with no double count; `[unit]`
      retention deletes exactly the expired rows; `[live]` the dashboard shows today's spend
      within 5% of the ledger.

- [ ] **[Task-28]** Security hardening. systemd sandboxing, per-job env allowlist, optional
      container/bubblewrap runner, rate limits, request size limits, CSRF/origin checks for
      the app, secret scanning in the gate, and the redaction test corpus. *Paths:*
      `packages/security/**`, `ops/vm/systemd/**`, `docs/security.md` (controls section).
      *Dependencies:* Task-06, Task-14, Task-25. *Acceptance:* `[unit]` the redaction corpus
      (30 fixtures) leaks nothing; `[unit]` a job cannot read `CB_GITHUB_*` or the Vault
      token; `[live]` `systemd-analyze security` reports the documented hardening score;
      `[live]` an oversized request is rejected before parsing.

- [!] **[Task-29]** Release pipeline. Versioning, signed daemon/app artifacts, image tag
      scheme, changelog generation, rollback, and the upgrade path from N-1. *Paths:*
      `.github/workflows/release.yml`, `scripts/release/**`, `docs/operations.md` (release
      section). *Dependencies:* Task-25. *Acceptance:* `[unit]` a dry release produces the
      documented artifact names and checksums; `[unit]` the upgrade script refuses a
      checksum mismatch; `[live]` an N-1 instance upgrades and answers health with the new
      version.
      BLOCKED: the runner's installation token has no `workflows` permission, so a branch
      touching `.github/workflows/release.yml` cannot be pushed (issue #11). Grant the App
      `Workflows: read and write`, or publish that one file manually and drop it from scope.

- [ ] **[Task-30]** Docs and ADR pass. Reconcile every doc with the shipped code, add the
      runbook for the five most likely incidents, and amend the decisions that moved. *Paths:*
      `docs/**` (all, disjoint sections per task), `README.md`, `AGENTS.md`. *Dependencies:*
      Task-29. *Acceptance:* `[unit]` every internal link resolves; `[unit]` every
      `CB_*` in code appears in `docs/providers.md` and vice versa; `[live]` a new operator
      follows the runbook and restores a backup in a scratch VM.

---

## Batch 8 — Beta, onboarding, migration

- [ ] **[Task-31]** First repositories and probation. Onboard the chosen repos (see
      `docs/open-questions.md`), run the first ten jobs with auto-merge in probation (merge
      only after N green runs), record the outcomes. *Paths:* none in this repo except
      `docs/operations.md` (onboarding section). *Dependencies:* Task-26, Task-28, Task-30.
      *Acceptance:* `[live]` ten real runs, zero red gates merged, one deliberate revert
      exercised, and the measured latency/cost targets in `docs/product.md` met or explained.
- [ ] **[Task-32]** Retire the OCI copy in `pkm-randomlike`. The chain was braked
      (`OCI_RETRY=off`) and its network deleted on 2026-10-24; the game repository still holds
      the workflow and the stale OCI variables. Delete the duplicate workflow and the
      variables, and leave a pointer to `ops/oci`. *Paths:* external repository; this repo
      updates `docs/oci.md` (migration section). *Dependencies:* Task-24, Task-31.
      *Acceptance:* `[live]` pkm has no `oci-retry` workflow, `OCI_RETRY` is `off` or gone,
      and a search of that repository finds no `pkm-` OCI resource identifier.
- [x] **[Task-34]** Routine store and scheduler. Add `routines` and `routine_fires` (a
      numbered migration; never edit an applied one), the repositories, and the transactional
      claim on `(routine_id, scheduled_for)`; next fire in the IANA zone with the D13 misfire
      rule. *Paths:* `packages/store/**`, `packages/scheduler/**`,
      `docs/architecture.md` (table section), `docs/jobs.md` (routine scheduling section).
      *Dependencies:* Task-04, Task-09, Task-33. *Acceptance:* `[unit]` migrations apply to an
      empty database and are idempotent; `[unit]` 20 concurrent claims produce one winner;
      `[unit]` a DST transition in `Europe/Madrid` produces the expected next fire; `[unit]` a
      missed fire inside the grace runs once and outside it is skipped.

---

## Batch 9 — Chat routines and reminders

A routine is not a run: no worktree, no gate, no PR (D38). The agent defines it from chat, the
scheduler fires it, the app lists and pauses it. `reminder` costs no tokens; `prompt` counts
against the daily cap.

- [ ] **[Task-35]** Routine engine and the chat tool. On a fire: a `reminder` pushes and does
      nothing else; a `prompt` appends an `origin: routine` message to its `chatSessionId`, or
      creates a new chat session for the routine when it has none or the old one was archived,
      sends it to OpenCode and streams the reply, pushing a summary at the end. Expose
      `routine.create` / `list` / `pause` to **chat sessions only** — an unattended run never
      gets the tool — and write the agent instructions for it. No worktree, no gate, no PR.
      *Paths:* `apps/daemon/src/routines/**`, `docs/jobs.md` (routine execution section),
      `docs/agent-runtime.md` (routine tool section). *Dependencies:* Task-13, Task-16,
      Task-34. *Acceptance:* `[unit]` a reminder writes one push and no chat message; `[unit]`
      a prompt fire writes one message, streams the reply and never opens a PR; `[unit]` a
      prompt routine with no session creates one; `[unit]` a run agent cannot call the tool;
      `[live]` a routine created from chat fires and its answer appears in that session.
- [ ] **[Task-36]** Routines UI. A routines tab in the jobs screen: list, next fire, last
      result, pause/resume, run now and delete; the chat shows a confirmation card when the
      agent creates one (kind, local time, cost) and a badge on routine messages. Notification
      preference `routine`. *Paths:* `apps/app/src/app/features/jobs/**` (routines tab),
      `docs/app.md` (chat and jobs sections). *Dependencies:* Task-21, Task-35. *Acceptance:*
      `[unit]` pause/resume and delete call the contract; `[unit]` a reminder and a prompt
      routine render their distinct kind and cost; `[live]` a routine created in chat appears
      in the list without a reload and its push arrives on the phone.

---

## Local / human (never picked by the driver)

The driver only counts `- [ ] **[Task-NN]**`; these `L<n>` items are outside the queue by
construction. They need a local key, an external tool or a store account.

- [ ] **L1 — Release signing.** Keep the Android keystore and the Apple certificate off the
      repository and off Actions; Task-29 builds unsigned artifacts and checksums; the operator
      signs and distributes. *Dependencies:* Q1 (distribution) and Task-29.
- [ ] **L2 — Visual prototype.** A Figma file with the seven screens (pair, dashboard, repos,
      chat, jobs, run detail, settings) and the tokens in `docs/app.md` §9; export PNGs and a
      screen-to-route map into `design/`. Task-18 implements from it. *Dependencies:* none.

---

## Retired / not scheduled

- **Voice control.** Not wanted for v1; revisit only with a new decision.
- **GitLab adapter.** The port is in place; the adapter waits for a real repository.
- **A web-based code editor.** Out of scope by `docs/product.md` §7.
- **Native desktop app.** The PWA covers desktop; Electron/Tauri is not worth the surface.

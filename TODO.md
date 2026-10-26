# Codebox — Roadmap (TODO)

Private control plane for OpenCode on your own VM — OCI Always Free, or an AWS spot host with
its own Terraform stack (`infra/aws`) — controlled by a hybrid Angular app.
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
| 5 | Hybrid app shell, screens and instance liveness | 18 → 37, 19–23 | 1, then 4 |
| 6 | OCI extraction and VM image | 24–25, 33 | 3 |
| 7 | Hardening, e2e, observability, release | 26–30 | 5 |
| 8 | Beta, onboarding, migration of pkm | 31–32, 34 | 3 |
| 9 | Chat routines and reminders | 35–36 | 1, then 2 |
| 10 | Terraform for both hosts (OCI first) | 42, 47 | 2 |
| 11 | Provider-neutral image: host-local secrets, AWS builder, browser | 39–41 | 3 |
| 12 | Durable backups and concurrency three | 43–44 | 2 |
| 13 | Host-neutral docs and ADRs | 45 | 1 |
| 14 | Measured AWS spot bring-up | 46 | 1 |

**Priority override — 2026-10-26.** The host track (Batches 10–12) is pulled **ahead of 7–9**.
OCI Always Free capacity has no date and the box cannot be deployed until it lands. Terraform
goes first because it is what lets the operator create and destroy the OCI footprint while the
wait is still open; the spot host reuses the same tool with the same image. Batches 7–9 keep
their internal order behind it. Nothing is dropped, only displaced.

**Cut — cycle after Task-44 (one of four slots used, Task-38).** The queue was thin: the only
dependency-free tasks were Task-38 (Batch 9) and Task-45 (Batch 13), and both claim
`docs/decisions.md` — a hot file, one owner per batch — so they could not travel together.
Task-38 went first because it is the lower batch and its own dependant (Task-36) is waiting;
Task-45 is displaced to the next cut. The other three slots were empty for cause, not by
choice: Task-26 and Task-29 are `[!]` on the `workflows` permission (issue #11); Task-30 waits
for Task-29; Task-31 for Task-26/28/30; Task-32 for Task-31; Task-36 for Task-38 (merged) and
is eligible next cycle; Task-46 for Task-42–45, with Task-45 still open.
**Hot-file holders in this cut:** Task-38 held `docs/decisions.md` (D41); `package.json`,
`package-lock.json`, `tsconfig.base.json`, `packages/contracts/src/index.ts`,
`apps/app/src/app/app.routes.ts`, `apps/app/src/main.ts`, `apps/daemon/src/main.ts`,
`opencode.json`, `TODO.md` and `CHANGELOG.md` were held by no task.

**Critical path:** `03 → 04/05/06 → 09 → 14 → 15 → 18 → 20 → 26 → 31`. Everything else can
fill a slot beside it. The four hot files that serialise the tail are `docs/decisions.md`,
`packages/contracts/src/index.ts`, `apps/app/src/app/app.routes.ts` and
`apps/daemon/src/main.ts`. The **host track** is its own chain — `47 → 42 → 46` for Terraform
and `40/41 → 46` for the image, with `43` and `44` feeding the measured bring-up — and it is the
path to a deployed box, not to the beta.

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

- [x] **[Task-16]** Notifications. Web Push subscription, VAPID signing, Capacitor push
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

## Batch 5 — Hybrid app and instance liveness

**Hot-file holders:** Task-18 holds `apps/app/angular.json`, `apps/app/src/main.ts`,
`apps/app/src/app/app.routes.ts`, `apps/app/src/app/app.config.ts`, the theme and the API
client. Tasks 19–23 own disjoint feature folders and do not edit the router.

**Cut:** four slots, five open tasks, and the order is deliberate. Task-37 goes first — the box
must not vanish under the screens — then Tasks 19–21; Task-23 waits for the next cycle,
unchanged and already disjoint. Task-37 is ops-only (`ops/vm`, `ops/image/scripts/60-service.sh`,
`docs/oci.md` §6, `docs/operations.md` §10.5) and shares no path with the screens.

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

- [x] **[Task-37]** Instance liveness. Always Free compute is reclaimed after seven days of
      idleness, and today the answer is only recovery (D33). Ship the measurement half, as
      D39 requires: `ops/vm/keepalive.sh` samples `/proc` twice a second apart and prints one
      JSON line (`at`, `cpuBusyPct`, `memUsedPct`, `netBytes`, `load1`, `uptimeSeconds`),
      appends it to `/var/lib/codebox/logs/keepalive.jsonl`, and then runs the bounded, useful
      pass a parked box would otherwise skip — `cb doctor`, `cb prune` and a loopback
      `GET /v1/health` — with every step optional, so a missing CLI or a stopped daemon is
      logged as `skipped` and never fails the run. `codebox-keepalive.service` runs it every
      six hours (`Persistent=true`) and `60-service.sh` installs and enables both units beside
      the backup pair. No synthetic load: D39 explains why a burner is refused, not
      forgotten. *Paths:* `ops/vm/keepalive.sh`,
      `ops/vm/systemd/codebox-keepalive.service`, `ops/vm/systemd/codebox-keepalive.timer`,
      `ops/vm/test/keepalive.test.mjs`, `ops/image/scripts/60-service.sh`, `ops/vm/README.md`,
      `docs/oci.md` (§6 only), `docs/operations.md` (§10.5 only). *Dependencies:* Task-25.
      *Acceptance:* `[unit]` `keepalive.sh --report` on a stub `/proc` prints exactly one JSON
      line with the six fields and exits 0; `[unit]` with the daemon down and `cb` absent the
      pass reports `skipped` for both steps, still writes the line and exits 0; `[unit]` the
      script contacts nothing but loopback (its `curl` targets are greped and a fixture run
      proves it); `[unit]` `60-service.sh` installs both units and enables the timer; `[live]`
      after seven days `keepalive.jsonl` holds 28 lines and the OCI console shows no
      reclamation warning — read by a human in the console, so it is reported as `[?]`, never
      as passing.

- [x] **[Task-19]** Dashboard and repos. Health cards (VM, queue, spend), recent runs, repo
      list, add repo wizard, gate/policy editor, protected-paths preview. *Paths:*
      `apps/app/src/app/features/dashboard/**`,
      `apps/app/src/app/features/repos/**`. *Dependencies:* Task-18. *Acceptance:* `[unit]`
      the repo form rejects a slug without `owner/name`; `[unit]` a policy change is sent as
      a PATCH and reflected optimistically; `[live]` adding a repo shows its gate result
      without a reload.

- [x] **[Task-20]** Chat. Session list, message stream, tool cards, permission cards,
      interrupt, markdown/code rendering, repo switcher, "promote to run" action. *Paths:*
      `apps/app/src/app/features/chat/**`. *Dependencies:* Task-18. *Acceptance:* `[unit]`
      deltas append in order and a reconnect does not duplicate a message; `[unit]` a
      permission card disables after reply; `[live]` a 200-token stream renders without
      layout jump and the input stays usable while the agent works.

- [x] **[Task-21]** Jobs and runs list. Job list, create/edit with a cron picker and timezone,
      pause/resume, run now, next-fire preview, runs list with filters and status chips.
      *Paths:* `apps/app/src/app/features/jobs/**`,
      `apps/app/src/app/features/runs-list/**`. *Dependencies:* Task-18. *Acceptance:*
      `[unit]` the cron picker produces a valid 5-field expression and a human summary;
      `[unit]` a paused job hides "run now" only for the scheduler, not for the manual
      action; `[live]` a created job appears in the list with the next fire in the selected
      timezone.

- [x] **[Task-22]** Run detail. Timeline, gate output, guardrail checklist, diff stat, PR
      link, merge result, cost, cancel, revert. *Paths:*
      `apps/app/src/app/features/run-detail/**`. *Dependencies:* Task-18. *Acceptance:*
      `[unit]` each guardrail renders red/green from the contract, not from a string match;
      `[unit]` cancel is confirmed and reflects the `cancelled` event; `[live]` a run's
      timeline updates live and the revert action opens the generated PR in the browser.

- [x] **[Task-23]** Settings, devices and notifications. Profile, paired devices with revoke,
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

- [!] **[Task-26]** End-to-end happy path. Playwright against the built app with a fake
      OpenCode and a fake GitHub: pair → add repo → run → gate → PR → merge → push. *Paths:*
      `e2e/**`, `.github/workflows/e2e.yml`. *Dependencies:* Task-20, Task-22, Task-14,
      Task-15. *Acceptance:* `[unit]` the suite is deterministic with a fixed clock and seed;
      `[live]` the full flow passes twice in a row on CI with no network access; `[live]` a
      forwarded push is observed by a service worker.
      BLOCKED: its branch has to create `.github/workflows/e2e.yml`, and the runner's
      installation token has no `workflows` permission (issue #11 — the same block as
      Task-29), so the branch cannot be pushed. Grant the App `Workflows: read and write`, or
      publish that one file manually and drop it from scope, then free this task.

- [x] **[Task-27]** Observability and cost. Telemetry endpoint, usage ledger, daily cost
      aggregation, disk/queue metrics, retention job, `cb doctor` checks. *Paths:*
      `apps/daemon/src/telemetry/**`, `packages/core/src/usage.ts`,
      `docs/operations.md` (telemetry section). *Dependencies:* Task-04, Task-11, Task-17.
      *Acceptance:* `[unit]` usage aggregates by day and repo with no double count; `[unit]`
      retention deletes exactly the expired rows; `[live]` the dashboard shows today's spend
      within 5% of the ledger.

- [x] **[Task-28]** Security hardening. systemd sandboxing, per-job env allowlist, optional
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
scheduler fires it, the app lists and pauses it. `reminder` costs no tokens; `prompt` is a chat
turn and is not capped until the chat path writes a usage row (Task-35 records that gap).

- [x] **[Task-35]** Routine engine. On a fire: a `reminder` pushes and does nothing else; a
      `prompt` appends an `origin: routine` message to its `chatSessionId`, or creates a new
      chat session for the routine when it has none or the old one was archived, sends it to
      OpenCode and streams the reply, pushing a summary at the end. Expose the `/v1/routines`
      list, detail, patch, pause, resume, run-now and delete routes; creation stays with the
      chat tool of Task-38. No run worktree, no gate, no PR. *Paths:*
      `apps/daemon/src/routines/**`, `apps/daemon/src/chat/{service,index}.ts`,
      `apps/daemon/src/push/{mapping,service}.ts`, `docs/jobs.md` (routine execution section).
      *Dependencies:* Task-13, Task-16, Task-34. *Acceptance:* `[unit]` a reminder writes one
      push and no chat message; `[unit]` a prompt fire writes one message, streams the reply
      and never opens a PR; `[unit]` a prompt routine with no session creates one; `[live]` a
      seeded routine fires and its answer appears in that session.
- [x] **[Task-36]** Routines UI. A routines tab in the jobs screen: list, next fire, last
      result, pause/resume, run now and delete; the chat shows a confirmation card when the
      agent creates one (kind, local time, cost) and a badge on routine messages. Notification
      preference `routine`. *Paths:* `apps/app/src/app/features/jobs/**` (routines tab),
      `docs/app.md` (chat and jobs sections). *Dependencies:* Task-21, Task-35 (the routines
      tab), Task-38 (the chat confirmation card). *Acceptance:*
      `[unit]` pause/resume and delete call the contract; `[unit]` a reminder and a prompt
      routine render their distinct kind and cost; `[live]` a routine created in chat appears
      in the list without a reload and its push arrives on the phone.

- [x] **[Task-38]** Routine tool seam. Mount `routine.create` / `list` / `pause` in **chat
      sessions only** — an unattended run never gets the tool — over a mechanism the pinned
      OpenCode client actually exposes (a loopback MCP server owned by the daemon, or an
      equivalent pinned-API surface), reclassify the three names as chat-allowed and run-denied
      in the D27 matrix, and write the agent instructions that describe the tool. This is a
      **security change**: it moves a tool across the permission boundary, so it owes
      `docs/security.md` (§6), `docs/agent-runtime.md` (§2 and §6), an ADR in
      `docs/decisions.md`, and the `packages/core` tests that today assert `routine.create` is
      denied in chat mode. The chat confirmation card of Task-36 lands with this task; the
      routines tab does not. *Paths:* the daemon seam the ADR names, `packages/core/**`,
      `docs/security.md` (§6), `docs/agent-runtime.md` (§2, §6), `docs/decisions.md`.
      *Dependencies:* Task-13 (the chat session and its permission replies), Task-35 (the
      routine store, the fire engine and the target the tool writes to). *Acceptance:* `[unit]`
      a chat session can create, list and pause a routine through the tool, and a run's tool
      set does not contain it; `[unit]` `decidePermission` allows `routine.*` in chat and
      denies it in run, with the matrix test updated and the reason recorded; `[unit]` the ADR
      names the mechanism and the boundary; `[live]` a routine created from a real chat on the
      VM appears in `GET /v1/routines` and fires.

---

## Batch 10 — Terraform for both hosts

The operator has to be able to create and destroy the OCI footprint **while the A1 capacity
wait is still open**, and the spot host must be built the same way. One tool, two providers:
`plan` is the `--plan` the shell scripts hand-rolled and `destroy` is the brake. Terraform owns
the static resources on both sides; the instance stays with `ops/oci/launch.sh` on OCI, because
no `apply` can wait for capacity.

- [x] **[Task-42]** `infra/aws`: Terraform for the spot host. One root module (Terraform 1.9+,
      the `aws` provider pinned, remote S3 state with native locking, and a one-file
      `bootstrap/` that creates the state bucket and its lock the first time): a VPC with a
      public subnet and **no inbound 80/443**, a security group allowing SSH only from the
      admin `/32`, `ami_id` defaulting to the current Canonical Ubuntu 24.04 arm64 image from a
      `data` source so the stack applies before the Codebox image exists, a **spot**
      `c7g.2xlarge` (8 vCPU / 16 GB arm64 — the floor for three repos × agent + build +
      Chromium plus the daemon, OpenCode and the tunnel) with a 100 GB gp3 volume and IMDSv2
      required, an instance profile that grants SSM Session Manager and the backup bucket
      only, the S3 dump bucket (SSE, versioned, 30-day lifecycle), a budget alarm and outputs
      (instance id, public IP, backup URI). `c7g.xlarge` is the documented degradation.
      *Paths:* `infra/aws/**`, `docs/aws.md`, `docs/README.md` (index row).
      *Dependencies:* none (Task-40 supplies the AMI later). *Acceptance:*
      `[unit]` `terraform fmt -check` and `terraform validate` pass offline, and `terraform
      test` with a mocked `aws` provider proves no `0.0.0.0/0` ingress, SSH as one `/32`,
      IMDSv2 required, spot with a price cap, and the bucket with SSE and lifecycle;
      `[unit]` a second `plan` after `apply` is empty; `[live]` `apply` creates the stack and
      `destroy` keeps only the bucket.

- [x] **[Task-47]** `infra/oci`: Terraform for the OCI resources. One root module (the `oci`
      provider pinned, remote state in the existing `cb-backups` bucket) describing `cb-vcn`,
      the IGW, the route table, the security list (SSH only from the admin `/32`, no 80/443),
      `cb-subnet`, the dynamic group, the `cb-ci` and `cb-instance` policies, `cb-vault` with
      its four secret placeholders and `cb-backups`. The instance stays out on purpose: no
      `apply` can wait for A1 capacity, so `ops/oci/launch.sh` keeps that job and consumes
      the stack outputs. That split is what lets the operator apply and `destroy` the network
      while the capacity wait is open. `provision.sh` and its test retire once `plan` against
      the live tenancy is empty; `launch.sh` stays. *Paths:* `infra/oci/**`,
      `ops/oci/provision.sh` (deleted), `ops/oci/test/provision.test.mjs` (deleted),
      `ops/oci/README.md`, `docs/oci.md`, `AGENTS.md` (layout section, with both `infra/aws/`
      and `infra/oci/`). *Dependencies:* Task-24. *Acceptance:* `[unit]` `terraform fmt -check`
      and `terraform validate` pass
      offline, and `terraform test` with a mocked `oci` provider proves the CIDRs, the `/32`
      ingress and the four secret placeholders; `[unit]` no state file or credential is
      committed; `[live]` a `plan` against the existing tenancy shows no drift, `destroy`
      removes the network and keeps the bucket and the image, and a second `apply` rebuilds
      it.

---

## Batch 11 — Provider-neutral image

The OCI wait has no date, so the image must boot on a host whose identity has no Vault grant:
the same artefact runs on OCI later and on an AWS spot box now (D40). Nothing here touches
the app or the API.

- [x] **[Task-39]** First boot off the provider store. `ops/vm/cloud-init.sh` takes the four
      bundles from `/etc/codebox/secret-bundles.json` (`0600`, operator-written) when it
      exists and from OCI Vault otherwise, and names the host from `--instance-id`,
      `CB_INSTANCE_ID` or the metadata service (the OCI bearer probe, then IMDSv2). *Paths:*
      `ops/vm/cloud-init.sh`, `ops/vm/test/cloud-init.test.mjs`, `ops/vm/README.md`.
      *Dependencies:* Task-25. *Acceptance:* `[unit]` the file source boots with no `oci`
      binary and no Vault variables; `[unit]` a bundle missing a key exits 2, records step
      `secrets` and writes no `instance.env`; `[unit]` `CB_INSTANCE_ID` and the IMDSv2 probe
      both name the host `cb-<id8>`; `[unit]` the Vault source keeps its eight reads over two
      boots and echoes no secret; `[unit]` the second boot rewrites byte-identical files.

- [x] **[Task-40]** Second builder: AWS. Add `amazon-ebs` beside `oracle-oci` in one build
      block so the eight provisioners stay shared; variables for region, subnet, the base
      Ubuntu 24.04 arm64 AMI, the build instance and the name/tag `cb-image-<version>-<sha>`;
      the AWS dummies join `example.pkrvars.hcl`. `packer build -only` selects the host.
      *Paths:* `ops/image/codebox.pkr.hcl`, `ops/image/example.pkrvars.hcl`,
      `ops/image/test/template.test.mjs`, `ops/image/README.md`. *Dependencies:* Task-25.
      *Acceptance:* `[unit]` `packer fmt -check` and `packer validate` pass for both
      var-files; `[unit]` the test asserts both sources, the shared provisioner list and no
      credential variable; `[live]` a build (after Task-39 merges) produces an arm64 AMI
      whose `/etc/codebox/image.json` matches the OCI image built from the same commit.

- [x] **[Task-41]** A browser in the image. The e2e gate and the app's own checks need
      Chromium: install Playwright's pinned browser with its apt dependencies, system-wide
      and read-only for `codebox`, under `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`, with
      no download at run time. `90-verify.sh` proves the binary, the shared libraries and one
      headless launch. *Paths:* `ops/image/scripts/45-browser.sh`,
      `ops/image/scripts/90-verify.sh`, `ops/vm/test/verify.test.mjs`, `docs/vm-image.md`
      (§1, §4, §9). *Dependencies:* Task-25. *Acceptance:* `[unit]` the verify script fails
      when the browser or a library is missing and passes on the built image; `[unit]`
      nothing lives under `/root/.cache` (the runtime user owns the browser); `[live]` `npx
      playwright test` runs one headless spec on the box without downloading anything.

---

## Batch 12 — Durable backups and concurrency three

D33 owns the recovery path and D15 owns how many jobs are in flight; both move before the box
is asked to hold three repositories at once.

- [x] **[Task-43]** Backups that survive a reclaimed host. `backup.sh` uploads the
      age-encrypted dump to any S3-compatible target (`CB_BACKUP_S3_URI`, credentials from
      the instance profile), keeps 30 daily copies and a `_latest` pointer, and verifies the
      upload; `restore.sh` reads the same target; `codebox-spot-notice.service` polls the
      two-minute interruption notice and takes one final backup. *Paths:*
      `ops/vm/backup.sh`, `ops/vm/restore.sh`, `ops/vm/spot-notice.sh`,
      `ops/vm/systemd/codebox-backup.service`,
      `ops/vm/systemd/codebox-spot-notice.service`,
      `ops/vm/test/{backup,restore,spot-notice}.test.mjs`, `ops/vm/README.md`.
      *Dependencies:* Task-25. *Acceptance:* `[unit]` an upload against a fixture endpoint
      writes the documented path and checksum; `[unit]` a missing target exits non-zero and
      keeps the local archive; `[unit]` repeated notices run one backup, not two; `[live]` a
      simulated interruption leaves a dump that restores on a fresh box.

- [x] **[Task-44]** Concurrency three. Raise `CB_MAX_CONCURRENCY` to 3 (per repo stays 1) and
      implement the admission the docs promise: a pure rule in `packages/core`, the waiting
      list in `packages/scheduler`, and the daemon creating at most three runs while the
      fourth stays `queued`, in repository order. Amend D15 with the measured sizing.
      *Paths:* `packages/core/**`, `packages/scheduler/**`, `apps/daemon/src/run/**`,
      `packages/contracts/src/config.ts` (with its tests), `docs/jobs.md` (§ concurrency),
      `docs/providers.md` (env table), `docs/decisions.md` (D15). *Dependencies:* Task-03,
      Task-09, Task-15. *Acceptance:* `[unit]` the default parses to 3 and rejects 0;
      `[unit]` three runs on three repos start and the fourth stays `queued`; `[unit]` two
      runs on one repo are still refused; `[live]` three real repositories run at once with
      their browser tests and no out-of-memory kill.

---

## Batch 13 — Host-neutral docs

- [x] **[Task-45]** Host-neutral docs and ADRs. Say what is true: the image is Ubuntu 24.04
      arm64 with no provider in it, the builder and the secret source are per host, both hosts
      are Terraform stacks under `infra/`, and OCI stays the primary target. Amend D20/D21, add
      D40 (one image, two hosts, Terraform for both, spot while OCI capacity is pending), and
      reconcile `docs/vm-image.md`, `docs/security.md` (§7, §8),
      `docs/architecture.md` (diagram), `docs/operations.md` (§2), `docs/roadmap.md` and the
      host rows in `AGENTS.md` and `README.md`. *Paths:* `docs/vm-image.md`,
      `docs/security.md`, `docs/architecture.md`, `docs/operations.md`, `docs/roadmap.md`,
      `docs/decisions.md`, `AGENTS.md`, `README.md`. *Dependencies:* Task-39, Task-40,
      Task-41, Task-42, Task-44, Task-47. *Acceptance:* `[unit]` no doc claims the image is
      OCI-only, and every remaining OCI statement lives in `docs/oci.md`, `docs/aws.md` or a
      migration section; `[unit]` every `CB_*` in code still appears in `docs/providers.md`;
      `[live]` none (docs).

---

## Batch 14 — Measured bring-up

- [ ] **[Task-46]** Spot bring-up, measured. Deploy the stack, deliver the four bundles with
      no secret in user-data or the template, run first boot over SSM, switch the tunnel
      hostname, restore the newest dump, pair a device, run three repositories at once with
      their browser tests, then `terraform destroy` and rebuild from zero. *Paths:* `infra/aws/**`
      (parameters), `docs/operations.md` (AWS runbook section). *Dependencies:* Task-42,
      Task-43, Task-44, Task-45. *Acceptance:* `[live]` boot to `/v1/health` in ≤ 5 minutes
      with no manual step but the bundles; `[live]` three parallel runs with Playwright are
      green and the box stays under the memory ceiling; `[live]` the rebuilt box restores the
      newest dump and serves the same jobs and chat; `[live]` the monthly cost at the spot
      price is recorded in `docs/aws.md`.

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
- [ ] **L3 — AWS account guardrails.** A dedicated IAM user with MFA (never root), the region
      pinned, the access keys rotated and a budget alarm above the spot cost; `terraform` deploys
      with a named profile and no key in the repository. *Dependencies:* Task-42.
- [ ] **L4 — OCI cutover.** When capacity lands: launch the OCI image, restore the newest
      dump, repoint the tunnel, destroy the spot stack and keep `docs/aws.md` as the bench.
      *Dependencies:* Task-42, Task-46, Task-47.

---

## Retired / not scheduled

- **Voice control.** Not wanted for v1; revisit only with a new decision.
- **GitLab adapter.** The port is in place; the adapter waits for a real repository.
- **A web-based code editor.** Out of scope by `docs/product.md` §7.
- **Native desktop app.** The PWA covers desktop; Electron/Tauri is not worth the surface.

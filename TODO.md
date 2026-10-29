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
| 5 | Hybrid app shell, screens and instance liveness | 18 → 37, 19–23, 50 | 1, then 4 |
| 6 | OCI extraction and VM image | 24–25, 33 | 3 |
| 7 | Hardening, e2e, observability, release | 26–30 | 5 |
| 8 | Beta, onboarding, migration of pkm | 31–32, 34 | 3 |
| 9 | Chat routines and reminders | 35–36 | 1, then 2 |
| 10 | Terraform for both hosts (OCI first) | 42, 47 | 2 |
| 11 | Provider-neutral image: host-local secrets, AWS builder, browser | 39–41 | 3 |
| 12 | Durable backups and concurrency three | 43–44 | 2 |
| 13 | Host-neutral docs and ADRs | 45 | 1 |
| 14 | Measured AWS spot bring-up | 46 | 1 |
| 15 | Agent pipeline hygiene | 48–49 | 2 |
| 16 | Contract and daemon for the reshape | 51–54, 58 | 4 |
| 17 | One task per screen | 55–57, 59–67 | 4 |
| 18 | Documentation and legal | 68–69 | 1 |
| 20 | Repo views: workers factory, backlog deps, design preview | 77–80 | 4 |

**Priority override — 2026-10-26.** The host track (Batches 10–12) is pulled **ahead of 7–9**.
OCI Always Free capacity has no date and the box cannot be deployed until it lands. Terraform
goes first because it is what lets the operator create and destroy the OCI footprint while the
wait is still open; the spot host reuses the same tool with the same image. Batches 7–9 keep
their internal order behind it. Nothing is dropped, only displaced.

**Cut — cycle after Task-51 (four of four slots used).** Batch 16 cannot run whole: Task-52 and
Task-53 both need the next numbered migration under `packages/store/migrations/`, Task-52 and
Task-54 both need `apps/daemon/src/chat/**` (54 removes the permission bridge from the chat
path), Task-53 and Task-54 both claim `docs/jobs.md`, Task-52 and Task-58 both claim
`docs/api.md`, and Task-54 and Task-58 both claim `packages/security/**`. The only legal pair
inside the batch is Task-53 + Task-58, filled to four slots with Task-55 and Task-66 from Batch
17 (both depend only on the merged Task-51 and their paths are disjoint from the pair). Task-52
and Task-54 were deferred to the next cut; **Task-52 shipped 2026-10-27**, so only Task-54 stays
deferred; Task-67 waits.
**Cut — cycle after Task-66 (three of four slots used).** Task-52, the deferred half of Batch 16,
is the dependency root of five Batch 17 screens, so it goes first and excludes Task-54, which
edits the same `apps/daemon/src/chat/**`. Filled with Task-62 and Task-69. The fourth slot has no
legal candidate: every other open task is blocked on an unmerged dependency (56, 57, 59, 60, 65
on Task-52; 30, 31, 32 on Task-29/Task-26; 68 on 51–67), blocked outright (02, 26, 29), or an app
task that would collide on `apps/app/README.md` and `app.routes.ts` with Task-62 (61, 63, 64, 67)
— one app task per batch, because `readme.spec.ts` makes every app task a writer of that README.
**Cut — cycle after Task-56/Task-54 (four of four slots used).** No task branch was alive, so
the lowest open work was Batch 17, and all four slots were filled with tasks whose dependencies
are merged: Task-57, Task-64, Task-65 and Task-67. Their paths are disjoint except
`apps/app/README.md`, which `readme.spec.ts` forces every app task to write; it was claimed by
section — each task owned only the lines of its own feature folder — and the four merged without
a conflict. No hot file was claimed. Nothing else was legal: 59, 60 and 61 would collide with
57 on the `features/chat/` README block, 63 would collide with 64 on `features/settings/`, 68
waits on 51–67, and 30, 31 and 32 wait on the blocked Task-29/Task-26. Four deviations are
recorded in the measurement issues #48–#51: no durable chat→run link (57), no
`/settings/notifications` route in the frozen router (64), two `Needs you` sources absent from
the contracts (65), and no compile-time build identity (67).
**Hot-file holders in this cut:** Task-62 holds `apps/app/src/app/app.routes.ts`. No task holds
`package.json`, `package-lock.json`, `tsconfig.base.json`, `apps/app/angular.json`,
`apps/app/src/main.ts`, `apps/daemon/src/main.ts`, `packages/contracts/src/index.ts`,
`opencode.json`, `TODO.md`, `CHANGELOG.md` or `docs/decisions.md`; Task-52 deliberately did not
need `packages/contracts/src/index.ts` because its named re-exports already carried the surface.
**Hot-file holders in this cut:** Task-53 holds `packages/contracts/src/index.ts`; Task-55
holds `apps/app/src/app/app.routes.ts`. `package.json`, `package-lock.json`,
`tsconfig.base.json`, `apps/app/angular.json`, `apps/app/src/main.ts`,
`apps/daemon/src/main.ts`, `opencode.json`, `TODO.md`, `CHANGELOG.md` and `docs/decisions.md`
are held by no task.
**Cut — cycle after Task-63 (one of four slots used).** No task branch was alive and the queue
held four open items, three of which cannot start: Task-30 waits on Task-29 and Task-31 on
Task-26, both `[!]` on issue #11 (the App token has no `workflows` permission), while Task-31
also waits on Task-30 and Task-32 on Task-31. Task-68 is the only eligible item — its
dependencies, Task-51 to Task-67, are all merged — so the batch is one task and the three empty
slots have no legal candidate. Task-68 claims no hot file: `TODO.md` and `CHANGELOG.md` stayed
with the Orchestrator at merge time.
**Cut — cycle after Task-70 (two of four slots used).** Batch 19 opens with Task-71 and Task-73;
no task branch was alive and `main` was `c58d8be`. Task-71 is the dependency root — Task-72 is
written against its three names — and it is the riskier one, so it holds the only new npm
workspace. Task-73 is path-disjoint from it and needs only the merged Task-70. The two empty
slots have no legal candidate: Task-72 depends on Task-71 (this batch), Task-75 on Task-72 and
Task-76 on Task-72 + Task-75; Task-74 would create a **second** new workspace (`packages/design`)
in the same batch as `packages/backlog`, and both must add a project to `vitest.config.ts` and
update the lockfile — a workspace missing from `package-lock.json` makes `npm ci` fail with
`EUSAGE … Missing: @codebox/<name>@0.0.0 from lock file`; Task-02, Task-26 and Task-29 are `[!]`,
and Task-30/31/32 wait on them. **Hot-file holders in this cut:** Task-71 holds
`package-lock.json` and `vitest.config.ts`; no task holds `package.json`,
`tsconfig.base.json`, `apps/app/angular.json`, `apps/app/src/app/app.routes.ts`,
`apps/app/src/main.ts`, `apps/daemon/src/main.ts`, `packages/contracts/src/index.ts`,
`opencode.json`, `TODO.md`, `CHANGELOG.md` or `docs/decisions.md`. Docs are shared by section
only: Task-71 holds `docs/jobs.md` §16 and `docs/architecture.md` §5; Task-73 holds
`docs/providers.md` §5.1.

**Cut — cycle after Task-72 (two of four slots used).** No task branch was alive and `main` was
`b93e224`. The lowest open work was the rest of Batch 19: Task-74 and Task-75. Both are eligible
— their dependencies (Task-70, Task-72) are merged, their paths are disjoint
(`packages/design/**` + one gate step + `docs/jobs.md` §5 against `apps/app/src/app/**` +
`docs/app.md` §4/§8), and no hot file is claimed twice. **Hot-file holders in this cut:**
Task-74 holds `package-lock.json` (and `vitest.config.ts`, the new workspace wiring); Task-75
holds `apps/app/src/app/app.routes.ts`. No task holds `package.json`, `tsconfig.base.json`,
`apps/app/angular.json`, `apps/app/src/main.ts`, `apps/daemon/src/main.ts`,
`packages/contracts/src/index.ts`, `opencode.json`, `TODO.md`, `CHANGELOG.md` or
`docs/decisions.md`. The two empty slots have no legal candidate: Task-76 depends on Task-75
(this batch); Tasks 77–80 each depend on Task-75 and/or would collide on
`apps/app/src/app/features/works/**` (77 and 80) or on the contract (78); Task-30 depends on
Task-29 and Task-31 on Task-26/28/30, and those roots (Task-02, Task-26, Task-29) are `[!]` on
issue #11.

**Cut — cycle after Task-75 (one of four slots used).** No task branch was alive and `main` was
`11f11af`. The lowest open work was Batch 19's last item, Task-76 — its dependencies (Task-72,
Task-75) are merged — so it is the batch, and the three empty slots have no legal candidate. The
constraint is the path list: Task-76 deletes
`apps/app/src/app/features/{jobs,runs-list,run-detail,approvals,chat,schedules}/**` and therefore
must rewrite `apps/app/README.md` (`readme.spec.ts` fails otherwise), while every other open task
(77, 78, 79, 80) is an app task that claims the same README — and Task-77 also claims the hot file
`apps/app/src/app/app.routes.ts`, which Task-76 edits to drop `/jobs`, `/jobs/:id`, `/runs`,
`/runs/:id` and `/approvals`. Task-78 depends on Task-79 and Task-80 on Task-77, both unmerged in
this cut by construction, and Task-30/31/32 sit behind Task-29/Task-26, `[!]` on issue #11.
**Hot-file holders in this cut:** Task-76 holds `apps/app/src/app/app.routes.ts`; no task holds
`package.json`, `package-lock.json`, `tsconfig.base.json`, `apps/app/angular.json`,
`apps/app/src/main.ts`, `apps/daemon/src/main.ts`, `packages/contracts/src/index.ts`,
`opencode.json`, `TODO.md`, `CHANGELOG.md` or `docs/decisions.md` — `packages/contracts` is not
touched at all. Docs are claimed by section (one task): `docs/app.md` §3–§4, `docs/security.md`
§6, `docs/agent-runtime.md` §2. The spec also corrected the item's stale `apps/daemon/src/routes/**`
path: each daemon subsystem owns its own `routes.ts`, and the real removals live in
`apps/daemon/src/chat/**`, `apps/daemon/src/routines/**`, the two `modules.ts` entries, the
`promote` route `apps/daemon/src/runs/routes.ts` still mounted, the `startChat` stub Task-72 left
in `apps/daemon/src/schedules/**`, and the app consumers the item did not name
(`features/schedules/**`, the dashboard's `/v1/chat/sessions` read).

**Cut — cycle after Task-76 (two of four slots used).** No task branch was alive and `main` was
`0a17286`. Batch 20 is two waves by construction, and this cut is **wave 1**: Task-77 (the
repository's `Workers` tab) and Task-79 (the design session's preview card). **Wave 2 waits for
it:** Task-78's `*Dependencies:*` line names Task-79 and Task-80's names Task-77, and neither
dependency is merged until this wave lands; on top of the graph, Task-78 claims
`packages/contracts/src/index.ts` — Task-79's serial contract slice, which carries `design.ts`,
`openapi.ts` and `openapi.test.ts` — and edits `apps/daemon/src/backlog/**`, while Task-80
claims `apps/app/src/app/features/works/**`, which Task-77 rewrites and Task-79 does not touch.
The two empty slots have no legal candidate in any later batch: Task-30 and Task-31 wait on
Task-29 and Task-26, `[!]` on issue #11, and Task-32 waits on Task-31. **Hot-file holders in
this cut:** Task-77 holds `apps/app/src/app/app.routes.ts`; Task-79 holds
`packages/contracts/src/index.ts` and, with it, the whole contract surface it has to keep
coherent (`packages/contracts/src/design.ts`, `openapi.ts`, `openapi.test.ts`, `docs/api.md`
§5.2). No task holds `package.json`, `package-lock.json`, `tsconfig.base.json`,
`apps/app/angular.json`, `apps/app/src/main.ts`, `apps/daemon/src/main.ts`, `opencode.json`,
`TODO.md`, `CHANGELOG.md` or `docs/decisions.md`. Docs are claimed by section only: Task-77
holds `docs/app.md` §4; Task-79 holds `docs/app.md` §8's *Session* block and `docs/api.md`
§5.2; `apps/app/README.md` is split by line block — Task-77 owns the `features/works/**` lines
(adds `repo-workers.page.*` and `workers.model.*`, removes `repo-works.page.*`), Task-79 owns
the `features/sessions/**` lines (adds `design-preview.card.*`), and neither edits the other's.
**Deviations from the items' `*Paths:*` lines.** Task-77 **releases**
`packages/contracts/src/**`: `workSchema` (`state`, `backlogRef`, `title`, `attempts`,
`updatedAt`) and `WorkState` already carry everything the factory draws, the room is a
presentation of the daemon's state machine and not a new fact (D51), and the one gap — no work
phase or agent role, so nothing can be attributed to the `ARC` room — is rendered as an honest
empty room and recorded in the spec for a later contract task. Task-77 **claims** four app paths
the item did not name, because the tab strip is one component and a renamed route with a stale
link is a dead tab: `apps/app/src/app/app.routes.spec.ts` (the frozen path table the rename
breaks), `features/repos/repo-tabs.ts`, `features/repos/repo-tabs.spec.ts` and
`features/repos/repo-chrome.i18n.ts` (`repoTabs.works` → `repoTabs.workers`, its two locale
lines only). Task-77 **narrows** `docs/app.md` to §4: §8's *Work* block stays true because
`/works/:id` survives as the agent's log, and §8's *Session* block belongs to Task-79. `/works/:id`
is kept on purpose — deleting it would leave the `features/backlog` links
(`repo-backlog.page.ts`, `backlog.store.ts`), outside this task's paths, pointing at nothing, and
`design/README.md` §7 already says a face is a target to its own log. Both app tasks also claim
`apps/app/README.md`, which `readme.spec.ts` forces on any task that adds or deletes a file under
`src/app`; the block split is the one described above. Task-79 **adds** the
daemon surface the preview cannot do without — `packages/contracts/src/design.ts`,
`packages/contracts/src/design.test.ts`, `openapi.ts`, `openapi.test.ts`,
`packages/contracts/README.md`, a new `apps/daemon/src/design/**` subsystem (the sixteenth
`SubsystemName`, appended last to `SUBSYSTEMS`, so `apps/daemon/src/main.ts` does not move) with its
`modules.ts`/`modules.test.ts` entries, `apps/daemon/README.md`, `docs/api.md` §5.2, and the app
consumers `features/sessions/{sessions.api.ts,sessions.api.spec.ts,session.page.ts,
session.page.spec.ts,i18n.ts}` — because no route serves `design/` today (`gate/design-check.ts`
is the only reader) and a card without a route would be a fixture pretending to be a preview.
Task-79 **releases** `packages/design/**` (the projection is built over the package's existing
`parseTokens`, `parseRoutes`, `parseScreenSpec` and `checkDocuments`, with no new pure rule) and
`design/README.md` (no section of it is false once the task lands: §1 already maps
`/repos/:id/workers`, §7 already states the preview rule, and this task adds no route to
`app.routes.ts`). Two readings are frozen in the specs instead of guessed at run time: the
repository keeps **four** tabs (`Backlog · Workers · Schedule · Design`) because retiring the
schedule and design tabs has no home for the schedule configuration yet and is not in any open
item, so `design/README.md`'s "two tabs" prose is the target of a later cut, not of this one;
and the `needs you` decision session opens from the blocked work's log, which already carries
the one allowed action, because the item forbids a per-agent button on the board.

**Cut — cycle after Task-79 (two of four slots used).** No task branch was alive and `main` was
`38bd0f3`. This is **wave 2** of Batch 20: Task-78 (the backlog dependency rail) and Task-80
(workers motion), in parallel. Both are legal now: Task-76, Task-77 and Task-79 are merged,
Task-78's own dependency Task-75 is merged and the contract slice Task-79 held
(`design.ts`, `openapi.ts`, `openapi.test.ts`, `packages/contracts/src/index.ts`) is no longer
in flight, and Task-80's dependency Task-77 is merged. Their paths are disjoint: Task-78 holds
`packages/contracts/src/index.ts` (the spec freezes the surface but the task needs no edit
there) together with `packages/contracts/src/works.ts`/`works.test.ts`,
`packages/backlog/**`, `apps/daemon/src/backlog/**`,
`apps/app/src/app/features/backlog/**` and `docs/api.md` §5.6; Task-80 holds
`apps/app/src/app/features/works/**` and `apps/app/src/theme/**` and claims no hot file. The
only shared path is `apps/app/README.md`, which `readme.spec.ts` forces on both app tasks: it
is split by line block — Task-78 owns the `features/backlog/**` lines, Task-80 owns the
`features/works/**` and `src/theme/**` lines, and neither edits the other's. The two empty
slots have no legal candidate: Task-30 and Task-31 wait on Task-29 and Task-26, `[!]` on issue
#11, and Task-32 waits on Task-31. **Hot-file holders in this cut:** Task-78 holds
`packages/contracts/src/index.ts`; no task holds `package.json`, `package-lock.json`,
`tsconfig.base.json`, `apps/app/angular.json`, `apps/app/src/app/app.routes.ts`,
`apps/app/src/main.ts`, `apps/daemon/src/main.ts`, `opencode.json`, `TODO.md`, `CHANGELOG.md`
or `docs/decisions.md`. Docs are claimed by section only: Task-78 holds `docs/api.md` §5.6; no
other doc is touched. **Deviations from the items' `*Paths:*` lines.** Task-78 **adds**
`apps/daemon/src/backlog/**` (the projection must carry `needs` to the app; the item's
`*Paths:*` line omits it and the Batch 20 note names it), `packages/contracts/src/works.ts` and
`works.test.ts` (the `needs` key and its contract tests; `index.ts` is held and left unchanged
because `BacklogItem` is already exported), `packages/backlog/src/dependencies.ts` and its test
(one grammar for `*Dependencies:*`), and `docs/api.md` §5.6 (the payload is a contract change).
It **releases** `packages/contracts/src/openapi.ts` and `openapi.test.ts`: the `Backlog`
component is built from `backlogSchema`, no route is added, and the pinned path count stays
**63**. Task-80 **narrows** `apps/app/src/theme/**` to `variables.css` (the motion keyframes and
the reduced-motion block; `tokens.ts` is not touched) and adds `workers.motion.ts`/
`workers.motion.spec.ts` for the phase rule. Both app tasks claim `apps/app/README.md`, the
line-block split above.

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

- [x] **[Task-50]** Pairing screen. `/pair` still renders the Task-18 placeholder
      (`Pairing — tasks 19-23`): measured on 2026-10-27 in Chromium at 320×640, the route has
      **0 inputs and 0 buttons**, so the app cannot pair and no app-level `[live]` criterion is
      reachable. Build the screen the design signs off: pairing code, device name, submit, an
      inline error for a used or expired code, the 320 px floor, EN/ES copy, and the redirect
      to `/dashboard` on success through the existing `AuthStore.pair`. Do not invent a visual
      language: this task consumes L2's signed-off screens. *Paths:*
      `apps/app/src/app/features/pairing/**`, `docs/app.md` (§4 and §9 only). *Dependencies:*
      L2 (the signed-off screens), Task-18 (the `AuthStore.pair` seam and the route).
      *Acceptance:* `[unit]` the form rejects an empty code or device name and calls
      `AuthStore.pair` once with the trimmed values; `[unit]` a used or expired code renders
      the message and re-enables submit; `[unit]` the new dictionary has EN/ES parity;
      `[live]` a real code from `cb pair` pairs the browser at 320 px in under two minutes and
      lands on the dashboard with no horizontal scroll.

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

- [x] **[Task-46]** Spot bring-up, measured. Deploy the stack, deliver the four bundles with
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

## Batch 15 — Agent pipeline hygiene

Two gaps in the harness that the 2026-10-26 cycles exposed: the loop can duplicate its own work
orders, and the app unit suite is not in the gate. Both are path-disjoint, so they run together;
they share no path with Batch 1 (Task-02 is blocked on its `[live]` criterion and does not touch
these files again).

- [x] **[Task-48]** Issue dedupe. The cycle of 2026-10-26 opened #22 and #23 with the same
      batch, the same body and one minute apart, doubling the measurement backlog; a retry of
      an issue-opening step does the same. Open the issue through a deterministic helper that
      first searches the open `agent-review` and `agent-blocked` issues for the same title (and
      comments there when it finds one), so two attempts or two agents cannot race a check the
      model performs by hand. *Paths:* `scripts/agent/**`, `scripts/agent/vm/prompt.md`,
      `.agent_roles/orchestrator.md`, `docs/agent-ci.md` (issue handoff section),
      `scripts/README.md`. *Dependencies:* none (the scripts and the prompt are on `main`).
      *Acceptance:* `[unit]` the helper creates one issue and a second call with the same title
      creates none and comments on the first; `[unit]` a different title still creates a new
      issue; `[unit]` the prompt, the role file and `docs/agent-ci.md` point at the helper
      instead of a bare `gh issue create`; `[live]` a cycle that finishes two batches leaves
      two issues, and re-running the same batch leaves the count unchanged.

- [x] **[Task-49]** The app unit suite is outside the gate. Root `npm test` runs the Vitest
      projects in `vitest.config.ts`; `apps/app` is not one of them, and neither the CI job nor
      `npm run build` invokes `ng test`, so 364 app specs never run on a PR. Make the documented
      gate run the app suite exactly once — the root `test` script is the natural place, so
      `npm test` means the same thing in CI and on a laptop — and add the guard that keeps a
      workspace with a `test` script from silently falling out of the gate again. *Paths:*
      `package.json` (the `test` script), `.github/workflows/ci.yml`, `docs/agent-pipeline.md`
      (gate table), `AGENTS.md` (Workflow section). *Dependencies:* none. *Acceptance:*
      `[unit]` a fresh `npm ci && npm test` runs the app suite and fails when one app spec is
      deliberately broken; `[unit]` a workspace whose `test` script is not covered fails the
      guard; `[live]` a PR's CI log shows the app suite and the job stays under the documented
      time budget.
      SHIPPED WITHOUT the `ci.yml` half: the App token cannot push `.github/workflows/**`
      (issue #11), so the `timeout-minutes` bump stays deferred to the token fix. CI already
      runs `npm test`, so the app suite reaches CI through the root script. The `[live]` check
      is an `agent-review` issue.

## Batch 16 - Contract and daemon

Signed off with the operator against the Figma prototype (L2). This batch owns D43-D50 and the
daemon that carries them; every screen in Batch 17 reads these types, so this one lands first.
A task here that disagrees with a decision reopens it before any code moves.

- [x] **[Task-51]** Chat scope, context and review state. `chatSessionSchema` gains `kind`
      (`free`/`repo`/`schedule`), a nullable `repoId`, `usage`, `contextTokens`, `contextEpoch`
      and `reviewedAt`; `createSessionSchema.repoId` becomes optional; one numbered migration
      backfills `kind = 'repo'` for existing rows. *Paths:* `packages/contracts/src/resources.ts`,
      `packages/store/src/migrations/`, `packages/store/src/chats.ts`, `docs/api.md` (chat
      section). *Dependencies:* none. *Acceptance:* `[unit]` a session parses with and without a
      repo; `[unit]` the migration leaves every pre-existing session `kind = 'repo'`; `[unit]`
      `reviewedAt` is null on create and set once by the daemon.
      LANDED WITHOUT the nullable `repoId` and the optional `createSessionSchema.repoId`: both
      need `apps/daemon/src/chat/{routes,service}.ts` and the twelve-step rebuild of
      `chat_sessions` (its `repo_id` is still `NOT NULL`), so they move to Task-52, which owns
      those paths. The scope columns, the `kind = 'repo'` backfill and the accounting shipped
      here.
- [x] **[Task-52]** Chat lifecycle routes. `POST /v1/chat/sessions/{id}/repo` (clone, worktree,
      new OpenCode session, deterministic ten-turn handoff), `POST .../compact` (same worktree,
      new session, `chat.compacted`), `POST .../reviewed`, and `POST .../promote` restricted to
      `kind = 'repo'`. *Paths:* `apps/daemon/src/chat/`, `packages/opencode/src/`,
      `packages/contracts/src/resources.ts`, `packages/store/migrations/`, `docs/api.md`.
      *Dependencies:* Task-51. *Acceptance:* `[unit]` binding twice is a
      `409`; `[unit]` compact keeps the worktree path and bumps `contextEpoch`; `[unit]` promote
      on a free chat is `409`; `[unit]` a free chat parses with `repoId: null` and the five chat
      fields require no default; `[live]` a bound chat answers with the preamble in context.
      CARRIED FROM Task-51: make `chatSessionSchema.repoId` nullable (and `kind`, `usage`,
      `contextTokens`, `contextEpoch`, `reviewedAt` required once the daemon always sets them),
      make `createSessionSchema.repoId` optional, and rebuild `chat_sessions` with a nullable
      `repo_id` without dropping its children.
- [x] **[Task-53]** One recurring object. Retire `jobs`, extend the schedule table with
      `mode` (`once`/`every`/`window`), `windowStart`, `windowEnd`, `cooldownMinutes`,
      `maxFires`, `maxCostPerFire`, `repoId`, `firePolicy` (`new_chat`/`continue`) and
      `consecutiveFailures`; implement D46 (finish-anchored relaunch, no catch-up, DST skip,
      three failures pause it, a running fire finishes). *Paths:*
      `packages/scheduler/**`, `packages/store/src/migrations/`, `apps/daemon/src/schedules/`,
      `docs/jobs.md`. *Dependencies:* Task-51, Task-44 retired. *Acceptance:* `[unit]` a
      20-minute fire that takes 11 minutes lands at T+31, not T+20; `[unit]` a DST gap produces
      zero fires and never two; `[unit]` the third failure pauses; `[unit]` `maxFires` and
      `maxCostPerFire` both stop the loop; `[live]` a window drains a repo overnight and every
      fire opens a PR.
- [x] **[Task-54]** Remove interactive approvals and isolate the agent. Delete the permission
      bridge and the approval queue from the chat path; run the agent as an unprivileged user
      that cannot read `/etc/codebox/`, the secret bundles or `~/.ssh`; prove it with a test
      that tries. *Paths:* `apps/daemon/src/permissions/` (removal), `ops/vm/**`,
      `docs/security.md`, `docs/jobs.md`, `packages/security/**`. *Dependencies:* none.
      *Acceptance:* `[unit]` no route writes an approval row; `[live]` a shell tool reading
      `/etc/codebox/instance.env` fails with `EACCES` and the failure is logged redacted;
      `[live]` a run still opens a PR with the gate green.
- [x] **[Task-58]** Generic credentials and integrations (D49, D50). An encrypted write-only
      store under `CB_STATE_DIR/secrets` (0600, master key from the host), a `credential` row
      (`{name, kind, value, expose}`), an `integration` row (`baseUrl`, `auth`, `credentialId`,
      `allowedHosts`) and an `integration.request` tool that injects the auth header server-side
      and rejects any host outside the allowlist. GitHub App by **manifest flow**; no route
      returns a value; `expose = env` is limited to the model key. *Paths:*
      `apps/daemon/src/credentials/`, `apps/daemon/src/integrations/`,
      `packages/contracts/src/config.ts`, `packages/security/**`, `docs/providers.md` (rewrite
      §1 and the GitHub section), `docs/api.md`. *Dependencies:* none. *Acceptance:* `[unit]` no
      route returns a credential or a prefix longer than four characters; `[unit]` a write
      without `admin` is a `403`; `[unit]` `integration.request` to a host outside the allowlist
      is refused before any DNS lookup; `[live]` a GitHub App is created by manifest and mints a
      first installation token without a redeploy; `[live]` `CB_SESSION_SECRET` still comes from
      the host.
---

## Batch 17 - One task per screen

Cut so no two tasks touch the same path. The shell owns `app.routes.ts` and `app.config.ts`;
every other task owns one feature folder, and the two shared components are named per owner.
All of them read the Batch 16 types and none of them invents a shape: a screen that needs a
field the contract lacks is a Task-51 amendment, not a local type.

- [x] **[Task-55]** Shell, three tabs and the router (D47). `app.routes.ts` gains the three tab
      roots plus the pushed screens; `tabs.page.ts` renders `Dashboard · Chat · Settings`;
      `app.config.ts` wires the guard. *Paths:* `apps/app/src/app/shell/**`,
      `apps/app/src/app/app.routes.ts`, `apps/app/src/app/app.config.ts`. *Dependencies:*
      Task-51. *Acceptance:* `[unit]` every route resolves and every route but `/pair` is
      guarded; `[unit]` the tab bar renders three items from one source of truth; `[live]` no
      screen scrolls horizontally at 320 px.
- [x] **[Task-56]** Chat list. Search, five filters (`All`/`Repo`/`Schedule`/`Unread`/
      `Archived`), one scope chip per row and the **two signals** — unread dot and unreviewed
      edge — plus the cost/context micro-text as a flow, never at a fixed x. *Paths:*
      `apps/app/src/app/features/chat/chat-list.*`, `shared/chat-row.ts`. *Dependencies:*
      Task-51, Task-52. *Acceptance:* `[unit]` fixtures render the five filters and both
      signals; `[unit]` the archived filter lists archived sessions and nothing else; `[live]`
      the longest row fits at 320 px with no clip.
- [x] **[Task-57]** Chat. Thread rendering (deltas appended once per `(messageId, seq)`),
      tool cards, gate and PR cards as system messages, composer with stop, and the promote
      action. *Paths:* `apps/app/src/app/features/chat/chat.*`, `chat-store.ts`,
      `chat-stream.ts`. *Dependencies:* Task-51, Task-52. *Acceptance:* `[unit]` a replayed
      frame never duplicates a message; `[unit]` gate and PR render from run state, not from
      prose; `[live]` a streamed run ends with the PR card without a reload.
- [x] **[Task-59]** Context sheet and compact. Usage bar with the 75/90/95 states, cost of the
      chat and of the day, environment rows, `Compact context` and `New chat in this repo`.
      *Paths:* `apps/app/src/app/features/chat/context-sheet.*`. *Dependencies:* Task-52.
      *Acceptance:* `[unit]` each threshold renders its state from a fixture; `[unit]` compact
      posts once and the divider appears at the handoff; `[live]` `context_full` blocks the
      composer and offers the action.
- [x] **[Task-60]** New chat, connect a repository, converting. The empty state with two
      proposals, the repository picker (`connected` / `cloning` / `unavailable`), and the clone
      progress with the disabled composer. *Paths:*
      `apps/app/src/app/features/chat/new-chat.*`, `features/repos/repo-picker.*`.
      *Dependencies:* Task-52. *Acceptance:* `[unit]` the composer stays usable while the
      proposals are shown; `[unit]` the picker never offers an archived repository; `[live]`
      converting shows progress, then the handoff divider.
- [x] **[Task-61]** Schedule created by chat, and the Schedule filter. The propose card that
      only a tap can create, the assumption block, and the filter that groups fires by schedule
      with the running window on top. *Paths:* `apps/app/src/app/features/schedules/**`,
      `features/chat/schedule-propose.*`. *Dependencies:* Task-53. *Acceptance:* `[unit]` the
      card cannot create without a tap; `[unit]` the filter groups by schedule and marks the
      unreviewed fire; `[live]` a sentence in a chat creates a schedule whose first fire lands
      unreviewed.
- [x] **[Task-62]** Credentials screens. The catalog (services and open credentials), the
      connect-a-service sheet and the add-credential sheet with the three visibility modes.
      *Paths:* `apps/app/src/app/features/credentials/**`. *Dependencies:* Task-58.
      *Acceptance:* `[unit]` saving requires the confirm step; `[unit]` an `env` credential
      renders its warning and the others do not; `[live]` an agent-tool credential never
      appears in the agent's environment.
- [x] **[Task-63]** Settings, Devices and Providers. The three rows that reach real actions,
      scopes per device, revoke, and the model choice with the "running sessions keep theirs"
      rule. *Paths:* `features/settings/settings.page.ts`, `devices.*`, `providers.*`.
      *Dependencies:* Task-55. *Acceptance:* `[unit]` the current device cannot revoke itself;
      `[unit]` changing the model never touches a running chat; `[live]` a revoked device's
      next request is a 401.
- [x] **[Task-64]** Notifications. Five toggleable events plus the non-toggleable
      `Credential changed`, quiet hours evaluated on the daemon, and a payload that carries no
      prompt, diff or path. *Paths:* `features/settings/notifications.*`. *Dependencies:*
      Task-55. *Acceptance:* `[unit]` the payload builder emits `{type, id, title}` and nothing
      else; `[unit]` `Credential changed` has no toggle; `[live]` a question interrupts quiet
      hours and a finished run does not.
- [x] **[Task-65]** Dashboard and first run. The five blocks, `Needs you` summing its four
      sources, and the start card that replaces an empty dashboard. *Paths:*
      `features/dashboard/**`. *Dependencies:* Task-52, Task-53. *Acceptance:* `[unit]` every
      block renders from a zero fixture; `[unit]` `Needs you` sums questions, approvals retired
      and unreviewed; `[live]` a fresh box shows the start card, not a dashboard of zeros.
- [x] **[Task-66]** Unpaired and offline. The 401 hand-off with its reason, and the offline banner
      that keeps cached rows read-only instead of queueing writes. The pairing screen itself is
      **Task-50** on `docs/task-48-issue-dedupe`: this task does not touch
      `features/pairing/**`. *Paths:* `shared/offline-banner.ts`, `core/auth/auth.guard.ts`.
      *Dependencies:* Task-51. *Acceptance:* `[unit]` a 401 clears the session and routes to
      `/pair` with the reason; `[unit]` an offline tap fails loudly instead of queueing;
      `[live]` the banner disappears on the first successful refetch.
- [x] **[Task-67]** About. Version, commit and build time injected at build, server health and
      the licences row. *Paths:* `features/about/**`. *Dependencies:* none. *Acceptance:*
      `[unit]` version and commit come from the build, never from a literal; `[live]` the health
      rows match `GET /v1/health`.

---

## Batch 18 - Documentation and legal

- [x] **[Task-68]** Documentation catch-up for the runtime. **Narrowed:** the product language
      already landed (AGENTS.md, README.md, `docs/app.md` §4 and §9, `docs/product.md`), so this
      task covers only what needs code to be true. `docs/api.md` gains the four chat routes
      (repo, compact, reviewed, promote), the credential write route and the schedule object;
      `docs/jobs.md` stops describing jobs and documents schedules, the window loop and the
      guardrails it already owns; `docs/security.md` records D45's boundary and the allowlist;
      `docs/agent-runtime.md` documents the ten-turn handoff preamble. *Paths:* `docs/api.md`,
      `docs/jobs.md`, `docs/security.md`, `docs/agent-runtime.md`. *Dependencies:* Task-51 to
      Task-67. *Acceptance:* `[unit]` every route in `app.routes.ts` has a request and a response
      shape in `docs/api.md`; `[unit]` no document promises an approval prompt or a `jobs`
      table; `[unit]` `design/README.md` and the screens table still agree.
      LANDED AS: the `jobs` table and `/v1/jobs` still exist on `main`, so both documents mark
      them **legacy** in one named section (`docs/jobs.md` §1.1, `docs/api.md` §5.3 and §5.5)
      instead of claiming they are gone; the generated OpenAPI document does not carry
      `/v1/schedules`, so `docs/api.md` §5.10 documents the seven schedule routes as bullets
      and the contracts guard still counts 57 paths — adding those operations to
      `packages/contracts/src/openapi.ts` and bumping the count is a later contracts task.
      `docs/app.md` §8 and §12 still describe permission cards and an approval step that D45
      removed: that file is outside this task's paths and is a deviation for a later docs pass.

- [x] **[Task-69]** Licence and third-party notices. The repository has **no `LICENSE`** while
      `docs/product.md`, `design/README.md` and the About screen all claim MIT, and the About row
      "Open source licences" points at nothing. Add `LICENSE` (MIT, with the owner's name and
      year) and generate `NOTICE` from the production dependency tree — Angular, Ionic and
      Capacitor in the app, Hono in the daemon. *Paths:* `LICENSE`, `NOTICE`, `docs/app.md`
      (About section). *Dependencies:* none. *Acceptance:* `[unit]` `NOTICE` is generated from
      the lockfile and lists each production dependency once; `[unit]` no copyleft package ships
      without a written exception in the task; `[live]` the About row opens the same list the
      `NOTICE` holds.---

## Batch 19 — One unit: Work, backlog and design

The product model changed on 2026-10-28: chat became an editor with one target (D55), the work
is the unit and one backlog item (D44, D53), the schedule belongs to the repository (D56), the
backlog file is the list (D51), design lives in the repo (D52) and provider accounts fail over
in order (D54). This batch makes the code and the app match. Each task is cut so no two touch the
same path; the contracts task lands first because every other task reads its types.

- [x] **[Task-70]** Contracts and store for the work model. `workSchema`, `sessionSchema`,
  `backlogSchema`, `repoScheduleSchema`, `providerSchema`, `providerAccountSchema` and the new
  event names; migration `0006_works.sql` (`works`, `sessions`, `session_messages`, `schedules`
  with `repo_id` and `selection`, `schedule_fires`) and `0007_providers.sql` (`providers`,
  `provider_accounts`); `chats` becomes a read-only legacy table. *Paths:*
  `packages/contracts/src/**`, `packages/store/**`, `docs/api.md` (§5.6, §5.6.1, §5.10),
  `docs/architecture.md` (tables). *Dependencies:* none. *Acceptance:* `[unit]` a work row
  round-trips with `backlogRef` and `attempts`; `[unit]` a second schedule on one repository is
  refused; `[unit]` the migration is forward-only and idempotent.
  LANDED AS: migrations are **`0006_works.sql`** and **`0007_providers.sql`** — `0003`–`0005`
  already existed and are checksum-pinned — and `schedules` is altered additively, not rebuilt,
  because the legacy `/v1/schedules` accessors still read its `title`/`prompt` columns. The
  one-schedule-per-repository index is `WHERE repo_id IS NOT NULL AND title = ''`: a D56 row
  writes the empty-title sentinel, a legacy row keeps a real title until Task-76 removes its
  writer, and `getByRepo` binds the same sentinel. **Task-72:** `list()` and `listDue()` do not
  filter the sentinel, so a legacy row still surfaces as a `RepoSchedule` — filter it before
  firing. `SSE_EVENT_NAMES` holds **38** names (24 existing + 14 new; the batch note's 37
  miscounted the routine triple). `chats` read-only means the `schema_legacy` marker plus no new
  writer; the refusal triggers land with Task-76, whose own migration also drops the sentinel
  predicate. The OpenAPI document now matches `docs/api.md` at **62** paths (18 works, sessions,
  backlog and provider-account paths added; the 13 retired chat and routine paths removed) — the
  markdown tables stay the owner, so a route added there needs its operation in the same task.
- [x] **[Task-71]** Backlog package and selection. `parseBacklog(markdown)`,
  `applyTick(markdown, ref)` and `selectNextItem(items, works, schedule)` as pure functions with
  fixtures from this repository's real `TODO.md`; tolerant of unknown lines, refuses an ambiguous
  or missing ref, never reformats. *Paths:* `packages/backlog/**`, `docs/jobs.md` §16.
  *Dependencies:* Task-70. *Acceptance:* `[unit]` the real `TODO.md` parses to the expected
  section and item counts; `[unit]` a tick changes exactly one line; `[unit]` selection skips an
  item blocked by `needs_decision` and respects `maxAttempts`.
- [x] **[Task-72]** Daemon: works, backlog projection, sessions and the tick. `GET
  /v1/repos/{id}/backlog` joins the parsed file with works; `POST /v1/works` verifies the ref and
  seeds the prompt; sessions enforce the target boundary; the run's final commit rewrites the
  item; `POST /v1/repos/{id}/run-next` and the schedule fire share one selection. *Paths:*
  `apps/daemon/src/works/**`, `apps/daemon/src/backlog/**`, `apps/daemon/src/sessions/**`,
  `apps/daemon/src/chat/**` (removal), `docs/api.md` (§5.6, §5.6.1). *Dependencies:* Task-70,
  Task-71. *Acceptance:* `[unit]` a work created from an unchecked item carries its ref and
  prompt; `[unit]` a merged run ticks exactly one line; `[unit]` a session write outside its
  target is `target_violation`; `[live]` a nightly window opens two runs from two items.
  LANDED AS: `works`, `backlog` and `sessions` are the last three entries in `SUBSYSTEMS`; the
  legacy `chat` subsystem and `ScheduleFirePort.startChat` (a `repo_required` stub that
  `schedules/service.ts` still calls) stay until Task-76. The contract has no `session.message`
  event, so a turn streams `session.delta` and `GET /v1/sessions/{id}/messages` is the
  transcript, as `docs/api.md` §5.6.1 now says. The `[live]` nightly-window criterion is not
  measured: issue #74 carries the measurement.
- [x] **[Task-73]** Provider accounts and failover. Classify the provider error, set the
  account state and `resetAt`, retry only when no tool call was emitted, fail with
  `provider_exhausted` when none is active, and expose `GET /v1/providers` plus the account
  routes. *Paths:* `packages/opencode/**` (account selection), `apps/daemon/src/providers/**`,
  `docs/providers.md` §5.1. *Dependencies:* Task-70. *Acceptance:* `[unit]` a 429 marks the
  account exhausted and the next turn uses the next one; `[unit]` a second tool call is never
  replayed; `[live]` two `opencode-go` accounts, the first dry, the run finishes on the second.
      LANDED AS: the `providers` subsystem is the fourteenth entry in `SUBSYSTEMS`, so
      `apps/daemon/src/main.ts` did not move. `provider_exhausted` is a fire/run code, not a
      contract `ErrorCode`: `ScheduleFireErrorCode` in `apps/daemon/src/schedules/fire.ts` is a
      closed union and **Task-72 must extend it**. Two deviations are owed a follow-up and are
      recorded in issue #71: `cb doctor`'s `github` check still parses the retired `docs/api.md`
      §5.1 body and will fail now that `GET /v1/providers` answers, and
      `DELETE /v1/provider-accounts/{id}` keeps one prepared statement in
      `apps/daemon/src/providers/service.ts` because `ProviderAccountRepository` has no
      `delete`. The `[live]` clause (two accounts, the first dry) is **not** delivered: there is
      no per-account key handoff yet and `TurnHandle.model` is always `null`.
- [x] **[Task-74]** Design package and the gate step. `design/` parsing (DTCG tokens,
  `routes.json`, screen specs with states) and the deterministic checks: no colour outside
  tokens, every route with a component, every screen declaring its three states, snapshot hash
  matching. *Paths:* `packages/design/**`, `apps/daemon/src/gate/**` (one step), `docs/jobs.md`
  §5. *Dependencies:* Task-70. *Acceptance:* `[unit]` a hardcoded hex fails the gate with the
  file and line; `[unit]` a missing state fails; `[unit]` no pixel comparison exists anywhere.
  LANDED AS: `@codebox/design` is the only parser (`parseTokens`, `parseRoutes`,
  `parseScreenSpec`, `checkDocuments`, `checkPatch`, `snapshotHash`) and
  `apps/daemon/src/gate/design-check.ts` turns its findings into `<file>:<line> <rule>` tail
  lines, failing closed on a git error and skipping a repository with no `design/`. **The step
  is not yet called by the run engine** — `apps/daemon/src/run/engine.ts` was outside the cut,
  so a green gate is not re-decided by it until that one-line wiring lands; the issue owns it.
  Three files the cut did not name were forced by the workspace: `apps/daemon/package.json`
  (`prebuild` + dependency), `package-lock.json` and `vitest.config.ts` (one project). No
  `design/` artifact is created here: `routes.json` must be derived from the post-Task-75
  router by Task-79.
- [x] **[Task-75]** App: Repos, four repository tabs, run log and sessions. Three tabs
  (`Dashboard · Repos · Settings`), `/repos/:id` with the backlog as the list and `works`,
  `schedule`, `design` as its other tabs, `/works/:id` as a **run log without composer**,
  `/sessions/:id` with its proposal panel; delete the chat list, the filters, the scope chip, the
  promote action, the handoff divider and the work composer. *Paths:* `apps/app/src/app/**`,
  `docs/app.md` (§4, §8). *Dependencies:* Task-70, Task-72. *Acceptance:* `[unit]` the backlog
  row renders plan and state separately; `[unit]` no route reaches `/chat`; `[unit]` the work
  screen has no composer; `[live]` 320 px with a long `Task-NN` title.
  LANDED AS: the router is the 20 rows of the spec (`/repos/:id` backlog, `/repos/:id/works`,
  `/repos/:id/schedule`, `/repos/:id/design`, `/works/:id`, `/sessions/:id`, the legacy `/jobs`,
  `/runs` and `/approvals` left for Task-76), `SHELL_TABS` is `Dashboard · Repos · Settings`,
  and 30 chat UI files, `shared/chat-row.*` and `repos/repo.page.*` are gone. **`features/chat`
  keeps exactly `chat.api.ts` and `chat.api.spec.ts`**: `features/schedules/schedule-filter.store.ts`
  (outside this task) imports `ChatApi`, and the daemon still answers `/v1/chat/sessions` until
  Task-76 retires them. The `repoPicker.*` copy moved into `features/repos/i18n.ts` so the picker
  stopped importing the deleted chat dictionary. The `[live]` 320 px criterion is **not
  measured** (no browser on this runner, no `playwright.config.*`); an `agent-review` issue owns
  it. Two documented gaps the screen reports instead of inventing: the schedule tab renders the
  legacy `Schedule` because no route projects `repoScheduleSchema` (so `selection`, `refs` and
  `maxAttempts` are unreachable), and `/repos/:id/design` is an honest unavailable block until
  Task-79 ships the preview.
- [x] **[Task-76]** Retire chat, routines and reminders end to end. Remove the chat routes, the
  routine tool seam, `/v1/reminders`, the legacy job screens and the `mode: chat` branch; update
  the e2e, the fixtures and the guards. *Paths:* `apps/daemon/src/routes/**`,
  `apps/daemon/src/routines/**`, `packages/core/**` (permission matrix), `docs/security.md` §6,
  `docs/agent-runtime.md`. *Dependencies:* Task-72, Task-75. *Acceptance:* `[unit]` no route
  answers under `/v1/chat` or `/v1/reminders`; `[unit]` the matrix has one mode; `[live]` a fresh
  install has no chat screen and no orphan table write.
  LANDED AS: the retirement is complete on both halves. `SUBSYSTEMS` is **fifteen** names;
  `apps/daemon/src/chat/**` and `apps/daemon/src/routines/**` (20 files) are gone, `startChat` left
  `ScheduleFirePort`, the last `promote` route left `runs/routes.ts`, and the `^/v1/routines/:id/run$`
  entry left `auth/middleware.ts`. `apps/daemon/src/route-table.test.ts` pins the mounted table:
  none of `/v1/chat*`, `/v1/routines*`, `/v1/reminders*`, and still `/v1/jobs`, `/v1/runs`,
  `/v1/sessions` and `/v1/works`, with both chat tables empty after load. `PERMISSION_MATRIX` has
  one mode (`run`) and `routine.*` classifies as `other` → `deny`. The app deletes
  `features/{jobs,runs-list,run-detail,approvals,chat,schedules}` (42 files) and routes to
  **fifteen** entries; `features/jobs/time-format` moved to `core/util/time-format` for the two
  surviving screens. `packages/contracts` is deliberately untouched: `openapi.ts` already carried
  no chat or routine path, so the retired schemas are the read-only legacy projection of the
  tables Task-70 kept. **Two deviations:** the dashboard's `Needs you` card had a single source
  (`GET /v1/chat/sessions`), so it is removed and its run rows link to `/repos/{run.repoId}`; and
  Task-70's landing note said the chat write-refusal triggers would land here — they did not,
  because a refusal trigger breaks `packages/store`'s own fixtures and dropping the `title = ''`
  sentinel needs the legacy `/v1/schedules` writer retired first, so it is a `packages/store`
  task. The pre-existing `POST /v1/works/{id}/runs` rate-limit drift (`docs/api.md` §4 and
  `docs/security.md` promise 10/min, `WORK_ROUTES` does not list it) was left alone on purpose.
  The `[live]` criterion is not measured on a runner (no browser, no VM): issue #80 carries it.

---

## Batch 20 — Repo views (design recut, 2026-10-28)

The Figma file now draws the repository as two tabs over one site: `Backlog` with a dependency
rail and `Workers` as a factory with four role rooms. These four tasks land that cut in the app.
`design/README.md` §1 and §2 carry the frame numbers. **Wave 1 runs two devs in parallel:**
`77` (app-only — its spec explicitly releases `packages/contracts`) and `79` (which holds the
serial `packages/contracts` slice: `design.ts`, `index.ts`, `openapi.ts`). **Wave 2:** `78`
(after `79`, because it adds the required `needs` field to the same contract and edits
`apps/daemon/src/backlog/**`; it also needs `Task-71` and `Task-72`) and `80` (after `77`, same
`features/works` path). `apps/app/README.md` gets a single owner per wave.

- [x] **[Task-77]** Workers view: the repository's `Workers` tab. Replace the work-level run page
  with the repo-level factory: four role rooms (`ORQ`, `ARC`, `DEV`, `QA`), one face and one task
  chip per subagent, the road in and the belt out, and the four states `queued`, `running`,
  `needs you`, `asleep`. `needs you` is a badge over the worker whose task is blocked; the
  orchestrator holds the blocked card and the decision, and the worker takes another task. No
  per-agent button: a face opens that agent's log. *Paths:*
  `apps/app/src/app/features/works/**`, `apps/app/src/app/app.routes.ts`,
  `packages/contracts/src/**`, `docs/app.md` (§4, §8). *Dependencies:* Task-75.
  *Acceptance:* `[unit]` each of the four states renders from a fixture; `[unit]` a blocked task
  shows the dev on a different task; `[unit]` no per-agent button exists in the tree; `[live]`
  tapping a face opens the agent's log; `[live]` 320 px with four workers in `DEV`.
- [ ] **[Task-78]** Backlog with dependencies. The ordered list gains a dependency rail: the
  chain, the branch and the external prerequisite, with `needs` on the row and a detail panel on
  desktop. *Paths:* `apps/app/src/app/features/backlog/**`, `packages/backlog/**`,
  `packages/contracts/src/**`. *Dependencies:* Task-75. *Acceptance:* `[unit]` the rail draws one
  edge per dependency and none for a root; `[unit]` a blocked row carries every unmet id; `[live]`
  the rail stays legible with 8 rows at 320 px.
- [x] **[Task-79]** Design session: preview the repository's artifact. A `design` session opens
  with the prototype card (`design/` at a commit, its declared states, the tokens/routes/states
  check) above the chat; an edit updates the preview and states what is pending. The preview is
  the repository's spec, never a canvas (D52). *Paths:*
  `apps/app/src/app/features/sessions/**`, `packages/design/**`, `design/README.md`.
  *Dependencies:* Task-75. *Acceptance:* `[unit]` the card renders a commit and a state list from
  `design/`; `[unit]` a pending change is visible; `[live]` a chat edit moves the preview.
- [ ] **[Task-80]** Workers motion. The factory animates: the truck pulls in, the package runs the
  belt, a token crosses the doors on a hand-off and the faces blink on offset cycles. All of it
  honours `prefers-reduced-motion` and never blocks the tap targets. *Paths:*
  `apps/app/src/app/features/works/**`, `apps/app/src/theme/**`. *Dependencies:* Task-77.
  *Acceptance:* `[unit]` the loop is off under reduced motion; `[live]` the four faces blink out
  of phase; `[live]` a tap during the animation still opens the log.

---

## Local / human (never picked by the driver)

The driver only counts `- [ ] **[Task-NN]**`; these `L<n>` items are outside the queue by
construction. They need a local key, an external tool or a store account.

- [ ] **L1 — Release signing.** Keep the Android keystore and the Apple certificate off the
      repository and off Actions; Task-29 builds unsigned artifacts and checksums; the operator
      signs and distributes. *Dependencies:* Q1 (distribution) and Task-29.
- [ ] **L2 — Visual prototype.** A Figma file with the routed screens and the tokens in
      `docs/app.md` §9; export PNGs and a screen-to-route map in `design/`. **Superseded by
      D51-D54 (2026-10-28):** the file holds 40 frames drawn against the retired chat model, so
      the frames are renamed, retired and re-cut against `Repo · backlog` and `Work`, and
      `design/README.md` carries the new map. The export step stays manual. *Dependencies:* none.
- [ ] **L5 — Design completeness.** Close what the prototype still lacks, in this order: desktop
      for the eight routed screens that have none (only Chat and Dashboard exist), 320 for the
      seven that were never squeezed, **interaction states** (hover, focus-visible, pressed,
      disabled) in the Design System — `docs/app.md` §12 requires accessible targets and the
      file has no focus ring — and the empty/error state of every screen, not just first-run
      and offline. Then wire the prototype so the two flows are clickable:
      `⋯ → Connect a repository → 09 → 11 → 03` and
      `New chat → Schedule a task → 08b → 08c → 03b`. *Dependencies:* none.
      *Acceptance:* `[unit]` every row of `design/README.md` §1 has a desktop and a 320 frame;
      `[unit]` the Design System shows focus-visible, hover and disabled for a button and a row;
      `[live]` both flows run end to end in Figma's present mode.
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

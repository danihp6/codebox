# Changelog

All notable changes to Codebox. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer once the
first release exists.

## Unreleased

### Added — 2026-10-29 (Task-79, the design preview is the repository's own spec)

- **`GET /v1/repos/{id}/design?revision=<sha>` serves the repository's `design/` at a commit**
  (D52). The response carries the resolved sha, the tokens, the routes, each screen's three
  declared states and the `checkDocuments` findings, parsed by `@codebox/design`; an unknown
  revision is a `422 revision_unknown`, a repository with no `design/` answers `present: false`,
  and a workspace that cannot be read is `503 workspace_unavailable`. The route is the daemon's
  sixteenth subsystem (`apps/daemon/src/design/**`), and `packages/contracts/src/design.ts`
  types both the request and the response — the OpenAPI document is 63 paths.
- **The session screen shows the prototype card above the thread.** A `design` session renders
  the commit, the collections, one row per screen with its three states (declared or not), the
  clean result or each finding, and the pending line when the commit is not the branch head; a
  proposal re-reads the preview at the proposal's sha.
- **One deviation, recorded:** the repository's `design` tab still renders its honest
  unavailable block — the card landed in the session screen, and wiring the tab to the new route
  is a later cut. The `[live]` criterion (a chat edit moves the preview) is unmeasured on a
  headless runner; issue #82 carries its measurement.

### Added — 2026-10-29 (Task-77, the repository's workers floor)

- **The repository's second tab is a factory, not a list (D44).** `/repos/:id/workers` renders
  the four role rooms `ORQ · ARC · DEV · QA`, the road in and the belt out, one face and one
  `Task-NN` chip per work, and the four states `queued`, `running`, `needs you`, `asleep`. The
  projection is one pure module, `features/works/workers.model.ts`, total over the seven
  `WorkState` values: `queued` waits on the road, `running` sits in `DEV`, `review` in `QA`,
  `needs_decision` is the orchestrator's `needs you` badge, and `merged`/`failed`/`abandoned`
  leave on the belt. `ARC` is drawn and always empty — the contract has no work phase or agent
  role to attribute, so the room reports the gap instead of inventing one.
- **`/works/:id` survives unchanged** as the agent's log a face opens; the flat
  `repo-works.page.*` is deleted and `repo-tabs.ts` renames its second tab to `Workers` in both
  locales. The shell still has three tabs: `Dashboard · Repos · Settings`.
- **No per-agent button.** Every face is a link to its own log; the only handler on the floor is
  the retry.
- **Two deviations, recorded:** the `ARC` room is empty for want of a phase in `workSchema`, and
  the two `[live]` criteria (a face opens the log; 320 px with four builders) are unmeasured on a
  headless runner — issue #81 carries both measurements.

### Removed — 2026-10-29 (Task-76, chat, routines and reminders retire end to end)

- **The chat and routine surface is gone from the daemon.** `apps/daemon/src/chat/**` (routes,
  service, ids, errors, the loopback routine tool server) and `apps/daemon/src/routines/**`
  (routes, service, the fire engine, the tick) are deleted; `SUBSYSTEMS` drops `chat` and
  `routines` and is fifteen names, so `loadModules` imports neither.
- **`/v1/chat/sessions` and `/v1/routines` answer nothing.** The last `promote` route left
  `runs/routes.ts`, `RunsService.promote` is gone, and `apps/daemon/src/route-table.test.ts` pins
  the mounted table in both directions: none of `/v1/chat*`, `/v1/routines*`, `/v1/reminders*`,
  and still `/v1/jobs`, `/v1/runs`, `/v1/sessions` and `/v1/works`.
- **A repo-less schedule fails its fire closed.** `ScheduleFirePort.startChat` is gone and a
  legacy row without a repository settles as `failed` / `repo_required` / `chatId: null`; no chat
  turn replaces it.
- **The permission matrix has one mode.** `PermissionMode` is `'run'`, `routine.*` classifies as
  `other` and is denied in every context, and no decision returns `ask`.
- **The app loses its legacy screens.** 42 files under
  `features/{jobs,runs-list,run-detail,approvals,chat,schedules}` are deleted and `app.routes.ts`
  is fifteen entries: the jobs, runs, approvals and reminders screens and the chat client are
  gone. `time-format` moved to `core/util/time-format` for the two screens that still format a
  fire time.
- **The dashboard stops reading chat.** Its `Needs you` card had a single source
  (`GET /v1/chat/sessions`), so the card is removed and each run row links to `/repos/{repoId}`;
  the screen issues four reads and no chat read.
- **`packages/contracts` is untouched on purpose.** `openapi.ts` already carried no chat or
  routine path (62 paths), so the retired schemas stay as the read-only legacy projection of the
  `chats`/`routine*` tables; no migration, trigger or table drop lands here.
- **Two deviations, recorded instead of hidden:** the write-refusal triggers Task-70 promised for
  this task need a `packages/store` change (they break its own fixtures, and dropping the
  `title = ''` sentinel needs the legacy `/v1/schedules` writer retired first), and the
  pre-existing `POST /v1/works/{id}/runs` rate-limit drift between `docs/security.md` and
  `WORK_ROUTES` is left for its own task. The `[live]` fresh-install criterion is unmeasured on a
  runner (no browser, no VM) and issue #80 carries it.

### Added — 2026-10-29 (Task-75, the app goes to repositories, run logs and sessions)

- **The bottom bar is `Dashboard · Repos · Settings` (D47).** `SHELL_TABS` is frozen at three
  entries and the three tab roots stay derived from it; `/repos` is a tab again, `/chat` is not
  a route, and the dashboard's two links point at `/repos`.
- **A repository is a destination with four tabs.** `/repos/:id` renders the backlog as the
  list, `/repos/:id/works` the works, `/repos/:id/schedule` the repository's single schedule and
  `/repos/:id/design` an honest unavailable block until Task-79 ships the preview. The four tabs
  come from one `REPO_TABS` source, and every one of the four screens renders it.
- **The backlog row separates the plan from the state (D53).** `Task-NN`, the item's title, its
  work state (all seven `WorkState` values plus `none`, from a `Record`, never a string match),
  its run count and a `Run` action that creates one work and one attempt — a `409 live_work`
  links the existing work instead of opening a second one.
- **`/works/:id` is a run log without a composer.** The header carries state, context, cost and
  attempts; each run renders its branch, its gate card, its PR card and the backlog tick, all
  from the contract. A `needs_decision` work offers exactly one action (resolve the doubt), a
  merged work offers rework, and a running work offers none. No `textarea`, no send.
- **`/sessions/:id` is the editor (D55).** Thread, tool cards, a pending-proposal panel with the
  branch and the paths, one merge action, and a composer that a pending proposal blocks. A
  `target: 'repo'` session is read-only: no proposal panel, no merge.
- **The chat model leaves the app.** The chat list, its five filters, the scope chip, the
  promote action, the handoff divider and the chat composer are deleted with their stores,
  APIs, dictionaries and specs (30 files, plus `shared/chat-row.*` and `repos/repo.page.*`).
  `features/chat` keeps only `chat.api.ts` and its spec, because `features/schedules` still
  imports `ChatApi` until Task-76 retires the legacy routes; the `repoPicker.*` strings moved to
  `features/repos/i18n.ts`. `docs/app.md` §4 and §8 describe the router the app now has, and a
  test holds the two in agreement in both directions.
- **Documented gaps, not papered over:** the schedule tab renders the legacy `Schedule` because
  no route projects `repoScheduleSchema` yet, and the 320 px criterion is browser-only and
  therefore unmeasured on this runner (an `agent-review` issue owns it).

### Added — 2026-10-29 (Task-74, the design package and its gate step)

- **The repository's `design/` has one parser (D52).** `packages/design` is a new npm workspace
  exporting `parseTokens`, `parseRoutes` and `parseScreenSpec` (DTCG tokens with alias resolution,
  `design/routes.json`, `design/screens/<slug>.json`), plus the four pure checks —
  `checkDocuments`, `checkPatch`, `checkSnapshots` and `snapshotHash` — and a typed
  `DesignDocumentError` per boundary. No clock, no filesystem, no environment: tests pass
  documents in, fixtures are read by the test.
- **The gate gains a design step.** `apps/daemon/src/gate/design-check.ts` mirrors
  `scanWorktree`: one `git diff --unified=0` against the base sha, a 4 MiB cap, a
  `design/tokens.json`-absent skip, and `<file>:<line> <rule>` tail lines for a colour written
  outside the tokens, a route without a component, a screen missing one of its three states and
  a snapshot hash that does not match its export. A git failure or an unparsable token document
  fails closed. **It is not called yet:** the call site in `apps/daemon/src/run/engine.ts` was
  outside the task's cut and is an open work order. No pixel or image comparison exists.
- **The new workspace is wired without touching the root manifest.** `apps/daemon/package.json`
  builds it in `prebuild` and depends on it, `vitest.config.ts` carries exactly one project, and
  `package-lock.json` is an npm regeneration (12 added lines, 0 removed). `docs/jobs.md` §5
  documents the step and names the missing call site.

### Added — 2026-10-28 (Task-72, works, backlog projection, sessions and the tick)

- **The work is the unit (D44, D51, D53).** `apps/daemon/src/works/` serves `GET/POST
  /v1/works`, `GET/PATCH/DELETE /v1/works/{id}`, `/runs`, `/decision`, `/reviewed` and
  `/interrupt`, plus `POST /v1/repos/{id}/run-next`. A work is created from a `Task-NN` ref by
  `resolveItem`, which refuses `backlog_ref_missing`, `backlog_ref_ambiguous` and
  `backlog_ref_checked`; its title and prompt come from the file, `specSha` pins the revision,
  and one work in flight per ref is the store's index (`live_work`).
- **The backlog is projected, never invented.** `apps/daemon/src/backlog/` reads `TODO.md` from
  the repository's bare clone and joins the parsed sections with the works that came from them,
  so `GET /v1/repos/{id}/backlog` shows `checked` and `work` per item; a repository without the
  file answers an empty projection at the default-branch sha. `select` feeds `selectNextItem`
  from `@codebox/backlog`, and `tick` flips exactly one checkbox in the worktree.
- **A session's target is its write boundary (D55).** `apps/daemon/src/sessions/` enforces
  `TARGET_WRITE_SETS`: `backlog` and `work` write `TODO.md`, `design` writes `design/`,
  `schedule` writes `.codebox/schedule.yml`, `repo` writes nothing. A proposal whose diff leaves
  the target is `409 target_violation` with the offending path, before anything is pushed;
  `proposal_pending`, `proposal_none` and `read_only_session` cover the rest.
- **One selection, two entrances (D56).** The schedule fire and `run-next` call the same
  `select`; the fire drops its chat port, creates `origin: 'schedule'` works, and
  `ScheduleFireErrorCode` gains `provider_exhausted` for Task-73. An empty selection ends the
  row `nothing_pending`/`nothing_runnable`, never an error.
- **The run's commit ticks its own line.** `CommitInput.tick` applies `applyTick` to the
  worktree's `TODO.md` before the PR is opened: one line changes, the subject stays the work
  title, and an ambiguous or missing ref logs `backlog_tick_skipped` and leaves the file
  untouched. `runs.work_id` carries the link, and `RunFilter.workId` reads it back.
- Deviations recorded in `TODO.md`: the contract has no `session.message` event (a turn streams
  `session.delta`), and the legacy `chat` subsystem plus `ScheduleFirePort.startChat` stay until
  Task-76. The `[live]` nightly-window criterion is not measured; issue #74 owns it.

### Added — 2026-10-28 (Task-73, provider accounts and failover)

- **A provider error is classified, not retried blindly (D54).** `@codebox/opencode` gains
  `selectAccount`, `classifyProviderFailure` and `decideFailover` as pure functions with the
  clock injected: `401/403` writes `invalid`, `429` or a quota reason writes `exhausted` until
  the provider's own `resetAt` or `now + 900 s`, anything else is transient and retried once on
  the same account, and a turn that has already emitted a tool call is never replayed. Exhaustion
  surfaces as `503 provider_unavailable` with `details.reason = "provider_exhausted"` — a run and
  fire code, not a new contract `ErrorCode`.
- **A `providers` subsystem with the seven documented routes.** `GET /v1/providers` and the six
  account mutations of `docs/api.md` §5.9.1, mounted by name from `SUBSYSTEMS` (fourteen now) so
  `apps/daemon/src/main.ts` did not move. Every response carries at most the last four characters
  of an account's credential; the value lives only in the write-only store.
- **Accounts are sealed through the credentials store.** One `model_key` credential per account,
  removed with the account; OAuth accounts seal `{"v":1,"access","refresh","expiresAt"}`, the
  state is single use with a 600 s TTL, and no adapter is registered yet, so `/oauth/start`
  answers `422 provider_oauth_unsupported` instead of inventing an endpoint.
- **The phantom configuration goes.** `docs/providers.md` §5.1 stops promising
  `CB_ACCOUNT_COOLDOWN_SECONDS` and `CB_ACCOUNT_DAILY_USD`; the cooldown is the constant `900`
  and the per-account cap is the account's own `budgetUsd` until a contracts task parses a key.

### Added — 2026-10-28 (Task-71, the backlog package and selection)

- **The backlog file has an owner.** `@codebox/backlog` is a pure package:
  `parseBacklog(markdown)` turns the markdown into sections and ordered items
  (`ref`, `title`, `body`, `line`, state, `section`), `applyTick(markdown, ref)` rewrites exactly
  one checkbox character and leaves every other byte alone, and `selectNextItem(items, works,
  policy)` is the D56 selection — first pending item in file order, refusing `blocked`,
  `needs_decision`, `live_work` and `attempts_exhausted`, and answering `nothing_pending` /
  `nothing_runnable` with the two codes `docs/jobs.md` §16.3 already names. No I/O, no clock, no
  environment: the daemon reads and writes the file.
- **The live `TODO.md` is a test fixture, by invariants.** `live-todo.test.ts` parses this
  repository's backlog and asserts structure — one item per checkbox line, refs unique, every
  line resolves — never today's counts or titles, because this file changes every cycle. The
  exact parse and tick behaviour is pinned byte for byte on a small checked-in fixture instead.
- **Build order stops being luck.** The package's `prebuild` builds `@codebox/contracts` first,
  so `rm -rf packages/contracts/dist && npm run build` is green even though `packages/backlog`
  sorts before `packages/contracts` in the workspace walk.

### Added — 2026-10-28 (Task-70, contracts and store for the work model)

- **The work model is a contract and a schema, not a promise.** `@codebox/contracts` exports
  `workSchema`, `sessionSchema`, `backlogSchema`, `repoScheduleSchema`, `providerSchema` and
  `providerAccountSchema` with their `parse*` helpers and page schemas, plus fourteen SSE event
  names (`work.*`, `session.*`, `schedule.fired|skipped`, `provider.state`,
  `backlog.changed`, `design.changed`) — 38 names in total, chat and routines included until
  their writers go. `sessionSchema` enforces the D55 target boundary: only a work session names
  a work, and a repository session carries no branch and no proposal.
- **Migrations `0006_works.sql` and `0007_providers.sql`.** `works`, `sessions`,
  `session_messages`, `schema_legacy`, `providers` and `provider_accounts`; `runs.work_id` and
  the two new `run_events` scopes; `schedules` gains `selection`, `refs` and `max_attempts`
  additively and a one-D56-schedule-per-repository unique index. One work in flight per backlog
  item is a partial unique index, so a second run of the same item is refused by the database.
- **The store owns the new tables.** `store.works`, `store.sessions`, `store.repoSchedules`,
  `store.providers`, `store.providerAccounts` and `store.legacy`; no repository reads the clock
  or generates an id, and a constraint violation is a `StoreError` code the daemon maps to
  `409`/`404`. `store.legacy.list()` names `chat_sessions` and `chat_messages` read-only by D44;
  their refusal triggers land with Task-76, when the last writer goes.
- **The API document is the documented surface again.** `docs/api.md` is the owner and the
  generated OpenAPI document now matches it at 62 paths: the works, sessions, backlog and
  provider-account operations are in, and the retired chat and routine paths are out, pinned by
  `retires the chat and routine paths`. `docs/architecture.md` names the real migration files.
- Deviations recorded in `TODO.md`: the `0003`/`0004` numbers in the backlog were stale, and the
  repository-schedule index carries the empty-title sentinel so a legacy row stays insertable
  until Task-76; Task-72 must filter that sentinel in `listDue()` before firing.

### Changed — 2026-10-28 (sessions are editors; the schedule belongs to the repository)

- **A chat is an editor, not a unit (D55).** A session has one target — the backlog, the design,
  one work, or none — and the target is its write boundary; every targeted session ends in a
  proposal and a merge disposes. **No target is a read-only chat with the repository's context**,
  and the `+` on a backlog opens exactly that choice. The work screen loses its composer and
  becomes a run log; a run that needs a person ends in `needs_decision` instead of waiting.
  `docs/api.md` §5.6.1 owns the routes.
- **Four targets and a rework.** The chat button on a backlog offers **backlog**, **design**,
  **schedule** and **rework** — or none. `schedule` may only write `.codebox/schedule.yml`;
  `rework` opens on a merged work and proposes a new run with the notes, never an edit of a
  merged branch. The connect-repository picker, the cloning screen and the free-chat `⋯` menu
  are removed: connecting happens from the `+` on `/repos`, and the clone state lives in the row.
- **The schedule belongs to the repository (D56).** `RepoSchedule { repoId, mode, window,
  selection, caps }` fires the next eligible backlog item in file order; `once` is one fire and
  `POST /v1/repos/{id}/run-next` is the same selection without a schedule. Per-work schedules,
  routines and **repo-less reminders are retired** — there is no recurring object without a
  repository. `docs/jobs.md` §1, §15 and §16 own the rules.
- `docs/product.md` now counts six surfaces, `docs/app.md` adds `/sessions/:id` and the four
  repository tabs, `docs/architecture.md` trades `work_messages` for `sessions` +
  `session_messages`, and `docs/security.md` records the target-as-boundary control.

### Changed — 2026-10-28 (one unit: Work; D51-D54)

- **The unit is the work.** D43 is retired and D44/D47/D48 rewritten: there is no free chat, no
  scope conversion, no promote and no ten-turn handoff. A work belongs to one repository from
  creation, has one thread, at most one schedule and as many runs as attempts (D44, D53). The
  app moves to three tabs — Dashboard, Repos, Settings — and the repository becomes a
  destination instead of a filter (D47).
- **One owner per fact (D51).** The backlog file is the list and SQLite is the state: an item
  maps to a work by its stable ref, the runtime state is projected from events, and the tick
  lands in the run's branch so it merges with the code or not at all. `docs/product.md`,
  `docs/app.md`, `docs/api.md`, `docs/jobs.md`, `docs/architecture.md`, `docs/agent-runtime.md`,
  `docs/security.md`, `docs/roadmap.md`, `README.md` and `AGENTS.md` now say so.
- **Design lives in the repository (D52).** `design/` holds tokens, routes, screen specs with
  their states and snapshots; Figma, Penpot and OpenDesign are importers that open a PR. The
  gate validates tokens, routes and declared states, never pixels.
- **Provider accounts are plural (D54).** `opencode-go` is the first adapter with OAuth or
  token; accounts have a priority and a state, a classified provider error moves the turn to the
  next one, and a run with no active account fails as `provider_exhausted` instead of
  degrading. `docs/providers.md` §5.1 owns the model, `docs/api.md` §5.9.1 the routes.
- **Reminders are the only non-work recurrence.** The `prompt` routine is retired with chat;
  a reminder writes a push and nothing else, and no model-facing tool can create a schedule.
- `TODO.md` gains Batch 19 (Task-70…Task-76) to make the code and the app match, and L2 is
  re-cut against the new frames.

### Added — 2026-10-27 (Task-68, documentation catch-up for the runtime)

- `docs/api.md` gains §5.10, the only definition of the schedule object: its 23 fields, the
  three modes, the defaults, the refusals and the seven `/v1/schedules` routes — written as
  bullets, because the generated OpenAPI document does not carry them yet and the contracts
  guard pins the scanned path count at 57. §11 adds the screen → route table for all fifteen
  router paths, each backed by a shape §2–§5 already documents.
- `docs/api.md` §5.6 indexes the four chat lifecycle routes (`repo`, `compact`, `reviewed`,
  `promote`) in one table and stops claiming promote runs in the chat's worktree: it starts
  from the repository's default branch, as `runs/service.ts` does. §5.3 and §5.5 are marked
  legacy — retained and served, not the product path — and §5.5 records that nothing in the
  daemon creates an approval row (D45), while the reply route still resolves an existing one.
- `docs/jobs.md` is retitled `Schedules, runs and auto-merge`: §1 is the schedule as the one
  recurring object, §1.1 is the only place the legacy `jobs` table and `/v1/jobs` are
  described, and every other mention speaks of the schedule while the guardrail, gate, PR and
  merge sections keep their numbering.
- `docs/security.md` §6 names D45 and what the agent cannot read — `/etc/codebox/`, the secret
  bundles, `~/.ssh` — and §7 gains the D49/D50 credential and integration allowlist: the
  write-only sealed store under `CB_STATE_DIR`, no value and no prefix longer than four
  characters in any answer, `expose = env` only for the model key, and `integration.request`
  refusing a host outside `allowedHosts` before any DNS lookup.
- `docs/agent-runtime.md` §2.1 documents the ten-turn handoff by its real names —
  `buildChatHandoff`, `CHAT_HANDOFF_TURNS`, `CHAT_HANDOFF_VERSION`, both dividers, and the
  promise that no model call summarises anything — and the two stale approval-wait statements
  in §2 and §6 are removed.
- Nothing under `apps/`, `packages/` or `ops/` changed. No `[live]` criterion exists for this
  task: it is documentation only, and none was invented.

### Added — 2026-10-27 (Task-63, settings, devices and providers)

- `/settings` owns four rows that reach a real action: Devices and Credentials link to their
  routes, Notifications opens the panel it already had, and Providers opens a new inline panel
  built from `GET /v1/providers` (one row per provider, `configured`, `mode`, `lastOkAt`), with
  a `404`/`503` rendering the unavailable copy rather than an empty list.
- `/settings/devices` pins the promise: one scope line per device, the current-device marker, no
  revoke control on this device at all, one `DELETE` per confirmed revoke with the row disabled
  while it is in flight, and a refreshed list afterwards.
- The **model choice** is deliberately not built: `settingsSchema` has no `model` key,
  `PATCH /v1/settings` is a strict schema and no route lists models, so a selector here would
  invent a second source of truth. It needs a contract task first.
- `[live]` — a revoked device's next request being a 401 and `/settings` handing off to `/pair`
  with the reason — needs the box, a second device and a browser; it is recorded as `[?]`, never
  as passing (issue #52).

### Added — 2026-10-27 (Task-61, proposed schedules and the schedule filter)

- `ScheduleProposeCard` renders the assumption block for a proposed schedule — the cron summary
  or the window, the next fire in the schedule's own zone, the cost cap, the repository — and
  creates nothing until the single button is tapped. One tap is one `POST /v1/schedules` with
  exactly the mapped body; a double tap while in flight still sends one, and a `422` shows its
  code and re-enables the button.
- `ScheduleFilterPage` groups fires by schedule, puts a schedule whose window is running on top
  (`isWindowOpen`, half-open, wrap-around midnight, in the schedule's IANA zone) and marks a fire
  nobody reviewed, derived from `lastFiredAt` plus the chat session's `reviewedAt`, never from a
  local guess. Detail reads are capped at 20 schedules.
- `[live]` — a sentence in a chat producing the card, one tap creating the schedule and its first
  fire landing unreviewed — needs the box and a browser, and the pinned OpenCode client exposes
  no `schedule.propose` tool, so the card is fed by its host and the measurement is recorded as
  `[?]`, never as passing (issue #52).

### Added — 2026-10-27 (Task-60, new chat and repository picker)

- `NewChatPanel` is the empty state the design signs off: exactly two proposals (a repository or
  a schedule) and a composer that stays usable while they are shown. Sending creates the free
  session first and then posts the trimmed draft, so nothing is lost on a failed create.
- `RepoPicker` renders one row per repository as `connected`, `cloning` or `unavailable` — a
  disabled repository is never pickable — and the converting flow issues one
  `POST /v1/chat/sessions { repoId }`, disables the composer while the worktree is cut and hands
  the bound session back to the host for the ten-turn divider. A `409 chat_already_bound` comes
  back to the picker with its code and no handoff.
- `[live]` — picking a repository, seeing `cloning` and landing on the handoff divider at 320 px
  — needs a browser, a paired device and a daemon; the frozen router has no `/chat/new` or
  `/repos/pick`, so the panel is exported for the host screen and the measurement is recorded as
  `[?]`, never as passing (issue #52).

### Added — 2026-10-27 (Task-59, context sheet)

- `ChatContextSheet` and `ContextSheetStore` render a chat's own ledger: the usage bar with the
  four pinned states (`ok` under 75 %, `warn` from 150 000 of 200 000 tokens, `high` from 90 %,
  `full` from 95 %), the chat cost from `usage.usd`, the day cost from
  `GET /v1/telemetry?range=24h`, and the environment rows (repository, scope, context epoch).
- `Compact context` sends one `POST /v1/chat/sessions/{id}/compact` per tap, adopts the daemon's
  new epoch and draws the handoff divider above the reset numbers; a failed compact keeps the old
  epoch and shows the error code. `New chat in this repo` is offered only for a bound chat.
- `[live]` — a repo chat at 95 % blocking the composer and the divider landing at the new epoch
  in a browser — needs the box and a paired device, and the sheet still has no mounting screen in
  the frozen router; it is recorded as `[?]`, never as passing (issue #52).

### Added — 2026-10-27 (Task-67, About)

- `/about` is a real screen: version, commit, build time and Node from `GET /v1/version`, the
  server's health rows from `GET /v1/health`, and the licences the shipped `NOTICE` holds. No
  value is a literal in the template; the page renders what the parsed responses carry.
- `notice.ts` ships the repository `NOTICE` verbatim and parses it into one record per package,
  split at the last `@` so a scoped name keeps its scope, and a spec fails when the constant and
  the repository file drift apart.
- Every row has a data attribute for the value it shows, so the `[live]` measurement can compare
  the screen with `curl -s /v1/health` instead of reading pixels.
- `[live]` — the rendered health rows matching `GET /v1/health` on the box — needs the daemon and
  a browser; it is recorded as `[?]`, never as passing (issue #51). The app still has no
  compile-time build identity (that needs a define in `apps/app/angular.json`), so the screen
  reports the daemon's build identity.

### Added — 2026-10-27 (Task-65, dashboard and first run)

- `/dashboard` is the five blocks the design signs off: `Needs you`, working, ready for review,
  today's spend and health, each rendered from its own read (`/v1/health`, `/v1/telemetry`,
  `/v1/runs`, `/v1/repos`) and each from a zero fixture without a crash.
- `Needs you` sums the two sources the contracts actually carry — chats waiting for an answer and
  chats nobody has reviewed — and says so in one place. The other two the backlog names (runs
  failed since the last review, a schedule fire left unreviewed) have no contract field; adding
  them is a `packages/contracts` change and its own task, not a local guess.
- A fresh box shows the start card instead of a dashboard of zeros: it offers a repository or a
  chat and disappears as soon as `/v1/repos` reports one.
- `[live]` — a freshly paired box showing the start card in under 3 s — needs the box and a
  device; it is recorded as `[?]`, never as passing (issue #50).

### Added — 2026-10-27 (Task-64, notifications)

- Settings gains a notifications panel: the five toggleable events — run finished, run merged,
  run failed, schedule fired, approval created — plus the locked `Credential changed` row, which
  has no toggle in either locale.
- Quiet hours are written twice on purpose: the authoritative
  `PATCH /v1/notifications/preferences` first, then a `PATCH /v1/settings` mirror that reports
  `synced`, `failed` or `absent` and never fails the write (a daemon without the route answers
  `404`, and the value still saves). An out-of-range window is refused before any request.
- The panel's payload builder emits exactly `{ type, id, title }` — no prompt, diff or path — and
  a toggle flips back with the error code when the daemon answers `500`.
- There is no `/settings/notifications` route: the frozen router is untouched (Task-18/55 own it),
  so the panel renders inside `/settings` behind one row. A future router task can promote it to
  its own route without touching this code.
- `[live]` — quiet hours honoured by a real push on a paired device, and a run finish silenced
  inside the window — needs the box and a subscription; it is recorded as `[?]`, never as
  passing (issue #49).

### Added — 2026-10-27 (Task-57, chat thread)

- `/chat/:id` is a real thread: assistant deltas append once per `(messageId, seq)`, tool cards
  render from the normalised stream, and the composer gains a stop action that interrupts the
  session through `POST /v1/chat/sessions/{id}/interrupt`.
- Gate and PR are **system cards built from `Run`**, never read out of prose: `chat-stream.ts`
  derives them from `run.gate` and `run.pr`, `ChatRunLink` remembers the promoted run per session
  in session storage, and a live `run.gate` frame updates the card in place without a second
  fetch.
- Promote costs one tap: the confirmation card sends a single
  `POST /v1/chat/sessions/{id}/promote` with an idempotency key, remembers the returned run and
  navigates to `/runs/<id>`. `canPromote` stays false for a free chat, a chat with no repository
  and a turn that is still running.
- `[live]` — the cards surviving Back without a reload — needs a browser and a paired device; it
  is recorded as `[?]`, never as passing (issue #48). The same issue records that `ChatSession`
  carries no durable `runId`, so the cards do not survive a full reload.

### Added — 2026-10-27 (Task-56, chat list)

- `/chat` is one flat list: a search box, the five filters `All` / `Repo` / `Schedule` /
  `Unread` / `Archived`, one scope chip per row, and the two signals — an unread dot and an
  amber unreviewed edge — with cost and context as a wrapping flow, never at a fixed x.
- `shared/chat-row.ts` renders one row from `ChatRowView`; `ChatListStore` filters client-side
  and `ChatReadStore` is the only writer of the per-device read marker, kept in the secure store
  under `cb.chatRead` and capped at 200 sessions, so unread survives a reload.
- The list stays live while a stream arrives: a `chat.message` moves its row to the top and
  updates the preview, and every other event is ignored, so the list does not depend on the
  approval machinery Task-54 retired.
- `[live]` — the 320 px fit — needs a browser session; it is recorded as `[?]`, never as
  passing (issue #47).

### Changed — 2026-10-27 (Task-54, interactive approvals retired)

- The chat path no longer files an approval and waits for a human: a `permission.updated` is
  answered inline through `decidePermission` in chat mode (`allow` → `once`, `deny` and `ask` →
  `reject`), the reply ticker is gone, and no daemon source calls `store.approvals.create` any
  more. `apps/daemon/src/run/approvals-retired.test.ts` walks every non-test daemon file and
  fails if a row writer comes back; the run engine's `ask` branch now rejects in place instead
  of parking a pending row nobody can answer (D45).
- OpenCode runs as `codebox-agent`, in a `codebox-workspace` group, with its own
  `EnvironmentFile=/etc/codebox/agent.env` holding only the model keys — no `instance.env`, no
  secret bundle, no `~/.ssh`. `/srv/codebox` is `0750`, the checkouts `2770` setgid with
  `UMask=0007` so the daemon can still clean them, and `90-verify.sh` gained the `isolation`
  check that fails the bake when a mode drifts.
- The boundary is documented where it is enforced: `docs/security.md` §6, `docs/jobs.md`
  §13–14, `docs/providers.md` §3/§5/§14 and `docs/agent-runtime.md` §4/§6/§10 stop promising
  the approval prompt they used to describe.
- The cost of the decision, stated: a chat can no longer edit a file or run a shell, because
  the frozen matrix answers `ask` and `ask` now fails closed. Work becomes a run; widening the
  chat matrix is a `packages/core` change and its own decision.
- `[live]` — the `EACCES` proof on the box and a run still opening a PR — is not measured in
  CI; it is recorded as `[?]`, never as passing (issue #46).

### Added — 2026-10-27 (Task-69, licence and third-party notices)

- `LICENSE` is the MIT text with `Copyright (c) 2026 Codebox contributors`. The repository shipped
  no licence file while `docs/open-questions.md` Q14 said the licence is MIT and `docs/app.md`
  §4 already promised an About row that lists them.
- `NOTICE` is generated from `package-lock.json` by `node scripts/legal/notice.mjs`: the 29
  production packages, one `name@version — license` line each, a frozen header and a copyleft
  block that prints `(none)` today. `--check` exits non-zero when the committed file drifts, and
  `scripts/legal/notice.test.mjs` runs that check inside `npm test`, so a lockfile change that
  forgets to regenerate turns the gate red.
- The generator reads nothing but the lockfile: no `node_modules`, no network, no new dependency
  and no `package.json` script (that file is a hot file and not this task's). It is byte-for-byte
  reproducible — the test regenerates and `cmp`s, and QA re-ran it in a directory holding only
  the lockfile, `NOTICE` and the script.
- `[live]` — the About row opening the same list the `NOTICE` holds — needs a browser and the
  About screen, which is still Task-67's placeholder; it is recorded as `[?]`, never as passing
  (issue #45).

### Added — 2026-10-27 (Task-62, credentials screens)

- `/settings/credentials` ships the catalog (connected services and open credentials), the
  connect-a-service sheet and the add-credential sheet. Saving is two steps: the form, then a
  review that renders only the last four characters of the value; the input is `type="password"`
  and is cleared on save, so the sheet never holds the secret in its text.
- The three visibility modes are the contract's `daemon` / `tool` / `env`. `env` renders its
  warning, and `env` on anything but a `model_key` renders `credential-env-blocked` with the form
  frozen, so the daemon's `403` is not the only guard.
- `CredentialsApi` is the app's only door to the §5.9 surface: the eight calls and six parsers
  mirror `docs/api.md` key for key, because that wire shape still lives daemon-side in
  `apps/daemon/src/credentials/schemas.ts`. Lifting it into `packages/contracts` is a recorded
  follow-up, not a second source of truth invented here.
- The route joins the frozen router table after `settings/devices`, the app README maps the
  eleven new files, and `docs/app.md` §4 gains its row. The app suite runs 462 tests after the
  merge.
- `[live]` — a `tool` credential staying out of the agent's environment, and the GitHub App
  manifest flow completing against GitHub — needs the box; it is recorded as `[?]`, never as
  passing (issue #44).

### Added — 2026-10-27 (Task-52, chat lifecycle routes)

- `chatSessionSchema.repoId` is nullable and `createSessionSchema.repoId` is optional, so a chat
  can be born free and take a repository later. The five Task-51 accounting fields stay optional
  on the wire; requiring them is a Task-56/57 follow-up, recorded in the spec.
- Four lifecycle routes under `/v1/chat/sessions/{id}`: `repo` (clone, worktree, a new OpenCode
  session and the deterministic last-ten-turn handoff), `compact` (same worktree, new session,
  `chat.compacted`, `contextEpoch` + 1), `reviewed` (stamps `reviewedAt` once) and `promote`,
  which answers `409 chat_not_repo` unless the chat carries a repository.
- Migration `0005_chat_free.sql` rebuilds `chat_sessions` with a nullable `repo_id` and keeps
  every child row (`chat_messages`, `run_events`, `approvals`, `routines`, `schedules`,
  `schedule_fires`) and both indexes alive; the runner turns foreign-key enforcement off around
  the transaction and refuses the migration when `PRAGMA foreign_key_check` finds an orphan.
- `chat.compacted` is the 24th SSE event name, the OpenAPI document grows from 54 to 57 paths,
  and `docs/api.md` §5.6 and §6 carry the four routes and the new event.
- `packages/opencode` gains `CHAT_HANDOFF_VERSION = 1` and the handoff preamble builder — the
  last ten non-empty turns, `bind` and `compact` variants, exactly one trailing newline.
- The app ripple only: a create with no repository posts `{}`, and a `repoId: null` session
  renders in the chat list under the existing unknown-repo label. The app suite grows from 402
  to 410 tests; the workspace runs 1 475 green with one pre-existing skip.
- `[live]` — a bound chat answering from the pre-bind transcript on a real model — needs the box;
  it is recorded as `[?]`, never as passing (issue #43).

### Added — 2026-10-27 (Task-66, unpaired and offline)

- A 401 has one hand-off: `AuthStore.logout()`, the reason kept in one module signal
  (`unpaired` / `session_expired` / `revoked`) and a redirect to `/pair?reason=<code>`. The guard
  sends an unpaired session the same way, and the interceptor tells a failed refresh from a
  device revoked while its token was still fresh.
- `ConnectivityStore` and `<app-offline-banner>`: a status-0 failure marks the cached data stale,
  any successful response clears it, and the browser's `online`/`offline` events flip the
  signal. The banner renders inside `<ion-app>` with its own EN/ES copy and no retry button;
  nothing is queued or replayed, so a tap cannot pretend it worked.
- `apps/app/README.md` maps the eight new files and describes the three-tab shell; the app suite
  grows from 386 to 402 tests.
- `[live]` — the banner disappearing on the first successful refetch without a reload — needs a
  browser; it is recorded as `[?]`, never as passing.

### Added — 2026-10-27 (Task-58, generic credentials and integrations)

- `CB_SECRETS_KEY` (32 random bytes, standard base64, a secret and never echoed) and
  `CB_INTEGRATION_TIMEOUT_SECONDS` (default 15) join the configuration. Without the key the
  daemon boots with an unconfigured store whose writes answer `503 secrets_not_configured`
  instead of failing at boot.
- `packages/security` gains the AES-256-GCM credential vault (fresh 12-byte IV per seal,
  `lastFour` only, `VaultError` on a wrong key or a tampered tag) and the integration allowlist:
  `https` only, exact host match, refused before any DNS lookup or `fetch`.
- The daemon gains `apps/daemon/src/credentials` and `/v1/integrations`: a write-only file store
  under `CB_STATE_DIR/secrets` (`0700`/`0600`, `*.tmp` + rename), ten routes with
  `read`/`admin`/`runs` scopes, the server-side integration request with header injection and a
  64 KiB truncation, and the GitHub App manifest flow with a single-use 600-second state. No
  route returns a value, a prefix longer than four characters or the sealed form.
- `docs/api.md` §5.9 and `docs/providers.md` §1/§6.1 document the surface and both keys; the
  OpenAPI document is pinned at 54 paths.
- `[live]` — a GitHub App created by manifest minting its first installation token — needs the
  VM; it is recorded as `[?]`, never as passing.

### Changed — 2026-10-27 (Task-55, the three-tab shell and the router)

- D47's shell has exactly three tabs — Dashboard, Chat and Settings — from one `SHELL_TABS`
  list in `app.routes.ts`; `tabs.page.ts` renders from that list and a fourth tab cannot appear
  in one place without the other.
- The router's 16 paths are frozen and every one but `/pair` carries the single `authGuard`;
  `chat/:id` keeps the Chat tab highlighted, and a cold deep link restores the session through
  `provideAppInitializer(restoreSession)` before the first navigation.
- The shared dictionaries drop the dead `tabs.jobs`/`tabs.runs` keys with EN/ES parity, and the
  app suite grows from 380 to 386 tests.
- `[live]` — no screen scrolls horizontally at 320 px — needs a browser; it is recorded as
  `[?]`, never as passing.

### Added — 2026-10-27 (Task-53, one recurring object: the schedule)

- `@codebox/contracts` gains `Schedule` and `ScheduleDetail` — `mode` (`once`/`every`/`window`),
  the D46 `cooldownMinutes`, `maxFires`, `maxCostPerFireUsd`, `firePolicy`,
  `consecutiveFailures`, `firesCount` and `spendUsd` — plus the `/v1/schedules` shapes. The
  change is additive: every existing resource, route and app screen is unchanged.
- `0004_schedules.sql` adds `schedules` and `schedule_fires` with the forward-only checks;
  `packages/store` gains the two repositories and the transactional claim on
  `(schedule_id, scheduled_for)`, where 20 concurrent claims produce one winner and 19 refusals.
- `@codebox/scheduler` gains the pure D46 loop (`planNextFire`, `isInsideWindow`,
  `nextWindowOpen`): a finish-anchored relaunch (T+31 for a 20-minute fire that took 11), a
  spring-forward gap that fires zero times, a fall-back wall clock resolved to its first
  instant, three consecutive failures pausing the schedule, and the fire and cost caps stopping
  the loop.
- The daemon gains the `schedules` subsystem — seven routes under `/v1/schedules`, one
  non-overlapping tick, the D13 grace rule, and a claim that survives a restart — and lists
  `credentials` for Task-58. `jobs` keeps working untouched; `docs/jobs.md` §1 marks it
  deprecated.
- `[live]` — a window draining a repository overnight with one PR per fire — needs the VM; it is
  recorded as `[?]`, never as passing.

### Added — 2026-10-27 (Task-51, chat scope, context and review state)

- `chatSessionSchema` carries `kind` (`free`/`repo`/`schedule`), `usage` (the `costSchema`
  shape), `contextTokens`, `contextEpoch` and `reviewedAt`, additive and optional on the wire;
  a payload without them reads as `repo`, `{0,0,0}`, `0`, `1` and `null`.
- `0003_chat_scope.sql` adds the seven columns in one statement each, backfills
  `kind = 'repo'` for every pre-existing session, indexes `(kind, updated_at)` and keeps
  `repo_id` `NOT NULL`; `0001` and `0002` stay byte-identical, so the checksum pin holds.
- The chat repository reads the new columns into the resource, writes `reviewed_at` once
  (`COALESCE`), and the list projection keeps all five fields; `packages/store/README.md` maps
  the migration and `docs/api.md` §5.6 documents every key and its default.
- The nullable `repoId` flip and the optional `createSessionSchema.repoId` move to Task-52: both
  need the daemon chat paths and the table rebuild, and the contract stays additive until then.

### Added — 2026-10-27 (Task-50, the pairing screen)

- `/pair` is a real screen instead of the placeholder: pairing code and device name, a submit
  that trims both, a double-tap guard, and inline copy for a used or expired code (401), a rate
  limit, an offline failure and a generic failure. Success routes to `/dashboard` through
  `AuthStore.pair` and writes nothing to `localStorage`.
- The form uses the `--cb-*` tokens and native inputs with no fixed pixel width, so it holds the
  320 px floor; EN/ES copy lives in the feature dictionary and the spec enforces parity.
- `apps/app/README.md` maps the two new pairing files and the rewritten page.
- `[live]` — a real `cb pair` code pairing a browser at 320 px in under two minutes with no
  horizontal scroll — needs the box and a browser; an `agent-review` issue carries it and it is
  never reported as passing.

### Changed — 2026-10-27 (Task-49, the app unit suite joins the gate)

- Root `npm test` is now `test:guard && test:app && vitest run`: the 364 app specs and the
  Vitest projects run exactly once each, on a laptop and on every pull request, instead of the
  app suite sitting silently outside the gate.
- `test:guard` fails when an npm workspace declares a `test` script and the gate neither runs it
  as an `npm --workspace` target nor as a Vitest project — and when one is covered twice — so a
  new workspace cannot fall out of the gate again.
- `docs/agent-pipeline.md` §7 and `AGENTS.md` §Workflow say what `npm test` now includes.
- `.github/workflows/ci.yml` is untouched: the runner's GitHub App token cannot push
  `.github/workflows/**` (issue #11). CI already runs `npm test`, so the app suite arrives with
  the root script; the `timeout-minutes` bump is deferred to the token fix, and the `[live]`
  CI-log and wall-time check is carried by an `agent-review` issue.

### Added — 2026-10-27 (Task-48, one issue per work order)

- `scripts/agent/issue.mjs` — the handoff helper: it reads the open `agent-review` and
  `agent-blocked` issues, matches the title after trimming, collapsing whitespace and folding
  case, and either creates one issue or comments on the lowest matching number, so a retry or a
  second agent cannot open the pair #22/#23 again. One `gh` read, then create **or** comment,
  never both, and every result reports the duplicate numbers it saw.
- `scripts/agent/issue.test.mjs` covers create-once, comment-on-repeat with the frozen line, a
  distinct title creating a second issue, the title key, the ignored label and the numbered-pair
  report against an in-memory port; the CLI smoke block in the spec runs against a fake `gh`.
- `scripts/agent/vm/prompt.md`, `.agent_roles/orchestrator.md`, `docs/agent-ci.md` §7 and
  `scripts/README.md` point at the helper instead of a bare `gh issue create`.
- `[live]` — two cycles leaving two issues and a re-run leaving the count unchanged — needs a
  dispatched cycle and is carried by an `agent-review` issue, never reported as passing.

### Changed — 2026-10-27 (issue #19, the app file map and the feature-local dictionaries)

- `apps/app/README.md` maps every file under `src/app` again: the five shipped feature folders
  (dashboard, repos, chat, jobs, runs-list) replace their placeholder lines, and the
  `readme.spec.ts` guard fails when a file is missing from the map or the map names a file that
  no longer exists.
- `docs/app.md` §3 and §9 record the localisation convention: `src/assets/i18n/{en,es}.json`
  holds the shell keys, and each feature folder ships its own `i18n.ts` with both locales and a
  parity spec. The shared dictionaries stop being treated as debt.

### Changed — 2026-10-27 (issue #11, the cycle's git credential)

- `agent-cycle.yml` checks out with the fine-grained `CB_AGENT_TOKEN` PAT instead of
  `GITHUB_TOKEN`: the runner token cannot write a file under `.github/workflows/**` and
  `permissions: workflows: write` is not a `GITHUB_TOKEN` key. The PAT gains `Contents` and
  `Workflows` write for this repository only, so Task-26 and Task-29 can ship their workflow
  files once the operator has updated the token. `GH_TOKEN` stays `GITHUB_TOKEN`.
- `docs/agent-ci.md` §10 and §11 record the new scope, why the workflows permission is
  deliberate, and the rotation failure mode.

### Added — 2026-10-26 (Task-46, the measured AWS spot bring-up runbook)

- `infra/aws/terraform.tfvars.example` carries the twelve module variables with safe
  placeholders only (`203.0.113.7/32`, `operator@example.com`, an empty `ami_id`); the applied
  `terraform.tfvars` stays ignored and is never committed.
- `docs/operations.md` §14 is the end-to-end runbook: L3 preconditions, `terraform apply`, the
  four secret bundles delivered over SSM and never in user-data or a var-file, first boot, the
  tunnel hostname and pairing, the newest dump restored after a destroy, three repositories at
  once under `CB_MAX_CONCURRENCY=3` with Playwright, teardown and rebuild from zero, and the
  four measurements with their bounds.
- `docs/aws.md` §10.1 reserves the measured-cost row with `—` cells: no figure is written
  before the operator measures it.
- `[live]` — the boot time, the three concurrent runs, the restore across a rebuild and the
  spot cost — is not measured on CI (no AWS account, no `terraform`); an `agent-review` issue
  carries it.

### Changed — 2026-10-26 (Task-45, one image, two hosts: D42)

- The docs say what is true: the Packer image is provider-neutral Ubuntu 24.04 arm64, the
  builder (`oracle-oci` or `amazon-ebs`) and the secret source are per host, and both hosts are
  Terraform stacks under `infra/{oci,aws}` with OCI as the primary target and the AWS spot box
  while A1 capacity is pending.
- **D42** records the decision; D20 (secrets) and D21 (image builder) are amended in place
  without renumbering. The D40/D41 IDs stay with their own decisions.
- `docs/vm-image.md`, `docs/security.md`, `docs/architecture.md`, `docs/operations.md`,
  `docs/roadmap.md`, `AGENTS.md` and `README.md` drop the "OCI-only" claims, name the host on
  every remaining host-specific line, and point at `docs/oci.md` and `docs/aws.md` for the
  per-host detail. The roadmap stops claiming that a prompt routine spends the daily cap.

### Added — 2026-10-26 (Task-36, routines UI)

- `/jobs` gains an in-page **Routines** tab: kind and cost label, the cron summarised in the
  routine's own timezone, next and last fire, pause/resume (optimistic with rollback), run now,
  an editor sheet for title, schedule, timezone, notify and — for a prompt routine only — the
  prompt, and a delete that arms a confirmation before sending anything. No new route.
- The chat screen renders a confirmation card when the agent creates a routine through
  `routine.create`: kind, the cron's local time and the next fire, corroborated from
  `GET /v1/routines?limit=10` inside a 120 s window because the tool frame carries no result.
  A message a routine produced carries the `routine` badge and a link to the list, taken from
  the `routine.replied` frame.
- The routines tab refetches on activation and on every `routine.fired`, `routine.replied` or
  `routine.failed` frame; the jobs and chat dictionaries gain their new en/es strings.
- `[live]` — a routine created in a real chat on the VM appearing in the list without a reload
  and its push arriving on the phone — is not measured on CI; an `agent-review` issue carries
  it.

### Added — 2026-10-26 (Task-38, the routine tool, chat sessions only)

- A daemon-owned loopback MCP server (`apps/daemon/src/chat/tools`) serves `routine.create`,
  `routine.list` and `routine.pause` over JSON-RPC 2.0 on `127.0.0.1:<ephemeral>`, one random
  bearer token per chat session. The token — never the model's arguments — supplies the chat
  and its repository, so `repoId` and `chatSessionId` cannot be spoofed; a prompt routine
  created from a chat is bound to that chat. `routine.create` computes `nextFireAt` with the
  same cron arithmetic as a job and writes nothing on a bad cron or timezone.
- The `mcp` descriptor travels only in a **chat** session create body:
  `CreateSessionInput` gained an optional `mcp` map and the wrapper forwards it verbatim. The
  run engine is untouched and sends no descriptor.
- `packages/core` classifies `routine.create/list/pause` as the new `routine` tool class: D27
  allows it in chat and **denies it in run**, even if a descriptor ever leaked.
- D41 records the mechanism and the boundary; `docs/agent-runtime.md` §2/§3/§6 and
  `docs/security.md` §6 describe the server, the per-chat token and the chat-only mount.
- `[live]` — a routine created from a real chat appears in `GET /v1/routines` and fires — is
  measured on the VM; an `agent-review` issue carries it.

### Changed — 2026-10-26 (Task-44, concurrency three)

- `CB_MAX_CONCURRENCY` defaults to 3 (per repository stays 1) and both keys reject 0 with a
  `ContractParseError` at boot; the count of config keys is unchanged.
- `canAdmitRun` in `@codebox/core` is the pure admission rule (`repo_busy` before
  `slots_full`); `planAdmission` in `@codebox/scheduler` orders the waiting list by repository,
  then `created_at`, then run id. The run engine consults them on start and on every
  completion, so the fourth run stays `queued` (never `failed`), a freed slot goes to the
  first waiting run whose repository is free, and a waiting run is cancellable.
- D15, the `docs/jobs.md` concurrency bullet and the `docs/providers.md` rows carry the new
  numbers; the daemon now links `@codebox/scheduler`.
- `[live]` — three real repositories with Playwright at once and no out-of-memory kill — is
  measured on the spot box; an `agent-review` issue carries it.

### Added — 2026-10-26 (Task-43, durable backups off the host)

- `backup.sh --upload` PUTs the age-encrypted dump to any S3-compatible target named by
  `CB_BACKUP_S3_URI` — SigV4 with the instance profile or explicit credentials — writes and
  verifies `<archive>.sha256`, keeps the 30 newest daily objects and a `_latest` pointer;
  `restore.sh --latest` and `--remote` read the same target. A missing target exits 2 and
  keeps the local archive.
- `codebox-spot-notice.service` and `spot-notice.sh` poll the two-minute interruption notice
  and run exactly one final backup (flock plus a per-notice marker); `60-service.sh` and the
  Packer template install the pair, so the image ships eight units.
- `CB_BACKUP_BUCKET` retires in favour of `CB_BACKUP_S3_URI`, `CB_BACKUP_S3_ENDPOINT` and
  `CB_BACKUP_S3_REGION`, documented as host drop-in variables in `ops/vm/README.md`.
- `[live]` — a simulated interruption that leaves a restorable dump on a scratch host — is
  measured on the box; an `agent-review` issue carries it.

### Changed — 2026-10-26 (Task-47, `infra/oci` Terraform module)

- `infra/oci` owns the static OCI footprint: `cb-vcn`, the IGW, `cb-rt`, an SSH-only `/32`
  security list, `cb-subnet`, `cb-instance-dg`, `cb-ci-policy`, `cb-instance-policy`,
  `cb-vault` with its four secret placeholders and `cb-backups` with its 30-day lifecycle.
- The instance stays out on purpose: `ops/oci/launch.sh` keeps the capacity wait and reads the
  module's `subnet_id`. `provision.sh` and its shell test retire.
- State is remote in `cb-backups` over the S3-compatible endpoint with native locking; the
  `cb-ci` policy gains only the two object statements that state needs.
- `docs/oci.md` §2/§3/§7/§8/§9/§10 and `ops/oci/{README,policy}.md` describe Terraform;
  `AGENTS.md` layout names both `infra/` modules.
- `[live]` — a no-drift `plan`, a `destroy` that keeps the bucket and the image, and a rebuild
  — is measured on the tenancy; an `agent-review` issue carries it.

### Added — 2026-10-26 (Task-42, `infra/aws` Terraform stack)

- `infra/aws` creates the spot host: VPC, public subnet, IGW, a security group that admits SSH
  only from the admin `/32` and nothing on 80/443, a `c7g.2xlarge` spot instance with IMDSv2
  and a 100 GB gp3 volume, an instance profile granting SSM and the backup bucket only, the
  versioned and SSE-encrypted `cb-backups` bucket with a 30-day lifecycle, and a monthly
  budget alarm.
- State is S3 with native locking; `bootstrap/` creates the bucket first. `ami_id` defaults to
  the Canonical Ubuntu 24.04 arm64 lookup so the stack applies before the Codebox image.
- `terraform test` with a mocked `aws` provider proves the invariants offline; `docs/aws.md`
  documents the stack and joins the documentation index.
- `[live]` — one `apply`/`destroy` on the L3 account — is measured there only; an
  `agent-review` issue carries it.

### Added — 2026-10-26 (Task-41, browser in the image)

- `ops/image/scripts/45-browser.sh` installs Playwright's pinned Chromium (1.64.1) with its
  apt dependencies under `/opt/ms-playwright`, readable by `codebox`, with no run-time
  download and nothing left under `/root/.cache`.
- `90-verify.sh` gains a `browser` check — the installed revision, an `ldd`-clean binary and
  one bounded headless launch — so a broken browser fails the build, not the first run.
- `ops/vm/test/verify.test.mjs` covers the missing-browser, live-stub and failed-launch
  paths against a stub root.
- `[live]` — `90-verify.sh --only browser` plus an offline `npx playwright test` on the built
  image — is measured on the box; an `agent-review` issue carries it.

### Added — 2026-10-26 (Task-40, second builder: AWS)

- The Packer template gains an `amazon-ebs` source beside `oracle-oci` in one build block, so
  the eight shared provisioners bake the same Ubuntu 24.04 arm64 image on either host;
  `packer build -only` selects the host.
- Region, subnet, base AMI, build instance type and name/tag come from `aws_*` variables with
  dummies in `example.pkrvars.hcl`; the template carries no credential.
- Build steps are discovered lexicographically from `scripts/*.sh`, so a new numbered step
  needs no template edit.
- `[live]` — an AMI whose `/etc/codebox/image.json` matches the OCI image from the same commit
  — is measured on a built image only; an `agent-review` issue carries it.

### Added — 2026-10-26 (Task-35, routine fire engine and `/v1/routines`)

- The routine tick claims `(routine_id, scheduled_for)` transactionally and applies D13: a
  `reminder` pushes and stops, a `prompt` appends an `origin: routine` message to its chat
  (creating one when it has none or the old one was archived), streams the reply and pushes one
  summary at the end.
- `GET`, `PATCH`, `DELETE` and the pause/resume/run-now routes are mounted; `POST /v1/routines`
  stays with Task-38's chat tool, and a fire never creates a run, a gate or a PR.
- The store's SSE event names learn the three `routine.*` events, without which a fire cannot
  be read back.
- `[live]` — a seeded routine firing and answering in its session on the VM — is not measured
  on CI; an `agent-review` issue carries it.

### Added — 2026-10-26 (Task-28, security hardening)

- The gate scans the added lines of every diff for nine secret patterns before anything is
  pushed, fails closed when git cannot produce the diff, and never logs the match or the diff.
- Request security: the four security headers on every response, an origin allowlist for the
  app, a 1 MiB body cap rejected before parsing, and per-device rate limits (`POST /v1/runs`
  at 10/min, the rest at 120/min).
- The three systemd units gain the documented sandboxing without `MemoryDenyWriteExecute`; the
  redaction corpus pins 30 fixtures with no literal leaking; D40 records the origin allowlist.
- `[live]` — the `systemd-analyze security` score and the tunnel origin check — is measured on
  the VM only; an `agent-review` issue carries it.

### Added — 2026-10-26 (Task-27, observability and cost)

- `GET /v1/telemetry` serves `1h`/`24h`/`7d`/`30d` windows: spend from the usage ledger, run
  counts by state, disk and queue depth from the probes that already answer `/v1/health`.
- The retention pass deletes terminal runs, expired events, archived chats, resolved approvals
  and their log directories at the documented ages, in one report per pass.
- `packages/core` gains the pure usage window and daily aggregation; `packages/store` gains
  windowed run counts and forward-only pruning with no migration.
- `[live]` — today's spend matching the dashboard within 5 % — is measured on the VM only; an
  `agent-review` issue carries it.

### Added — 2026-10-26 (Task-23, settings, devices and notifications)

- `/settings` becomes the operator's own screen: account time zone, push preferences per event
  with optimistic toggles and rollback, provider status, the danger zone (brake, cache wipe)
  and an explicit `unavailable` block for every resource whose daemon route this build does not
  have.
- `/settings/devices` lists paired devices with their scopes, marks the current one and revokes
  a device; revoking the current device clears the secure store and logs out locally.
- `[live]` — a preference change visible in the next push — is not measured on CI; an
  `agent-review` issue carries the measurement.

### Added — 2026-10-26 (Task-39, provider-neutral first boot)

- `ops/vm/cloud-init.sh` reads the four secret bundles from `CB_SECRETS_FILE`
  (`/etc/codebox/secret-bundles.json`, `0600`, written by the operator) when it exists and from
  OCI Vault through the instance principal otherwise; a missing key is exit 2 with step
  `secrets` and no `instance.env` written, and the file source needs neither `oci` nor a Vault
  region.
- The hostname comes from `--instance-id`, `CB_INSTANCE_ID` or the metadata service — the OCI
  bearer probe first, then the AWS IMDSv2 handshake — so the same image names itself on a host
  with no OCI grant.
- The file source, the missing key, `CB_INSTANCE_ID` and the IMDSv2 probe have their own cases
  beside the Vault ones; the second-boot idempotency and no-echo assertions still hold.

### Changed — 2026-10-26 (roadmap, host track)

- `TODO.md` gains Batches 10–14 (Tasks 39–47): Terraform stacks under `infra/oci` and
  `infra/aws`, provider-neutral image, S3 backups, concurrency three, host-neutral docs and the
  measured bring-up. The host track is pulled ahead of Batches 7–9, because OCI capacity has no
  date and the box cannot be deployed until it lands; Terraform runs first so the OCI footprint
  can be created and destroyed while the wait is open.

### Added — 2026-10-25 (Task-37, instance liveness)

- `ops/vm/keepalive.sh` samples `/proc` twice a second apart, appends one JSON line to
  `/var/lib/codebox/logs/keepalive.jsonl` and then runs a bounded pass (`cb doctor`, `cb prune`,
  a loopback `GET /v1/health`) in which every step is optional and a missing CLI or a stopped
  daemon is `skipped`, never a failure; no synthetic load, per D39.
- `codebox-keepalive.service` and `.timer` run it every six hours with `Persistent=true`, and
  `60-service.sh` installs and enables both beside the backup pair; the Packer template uploads
  the new files.
- `[live]` — 28 lines after seven days and no reclamation warning in the OCI console — needs a
  human at the console; an `agent-review` issue carries the measurement and it is not reported
  as passing.

### Added — 2026-10-25 (Task-21, jobs and runs list)

- `/jobs` lists jobs with their next fire, pauses and resumes optimistically, runs one now and
  creates a job through a cron picker with a timezone; `/jobs/:id` edits the same job, previews
  the next five fires in its own timezone and shows its recent runs; `/runs` lists runs with
  status chips and cost and pages with the API cursor.
- The cron parser, the human summary and the timezone formatter are pure functions with pinned
  tables; a paused job still offers run-now because the pause switch only stops the scheduler.
- The `[live]` criterion — a created job appears with its next fire in the selected timezone —
  is not measured on CI; an `agent-review` issue carries the measurement.

### Added — 2026-10-25 (Task-20, chat)

- `/chat` is a real session list grouped by repository with a repo filter and a new-chat
  action; `/chat/:id` is a streaming transcript with markdown and code blocks, tool cards,
  permission cards that disable after a reply, a composer that stays usable while the agent
  works, a stop button and "promote to run".
- Deltas append in order and a replay is a no-op, so a reconnect never duplicates a message;
  the stream state is a pure reducer with its own tests.
- The `[live]` criterion — a 200-token stream renders without layout jump while the composer
  stays usable — is not measured on CI; an `agent-review` issue carries the measurement.

### Added — 2026-10-25 (Task-19, dashboard and repos)

- `/dashboard` renders the VM, queue and spend health cards and the five most recent runs from
  the existing `ApiClient`, each read independent so one failure never blanks the others.
- `/repos` lists repositories and adds one through a wizard that validates `owner/name` before
  it sends anything, then shows the verification result without a reload; `/repos/:id` edits
  the gate and the protected paths and flips the policy optimistically with a rollback on error.
- The repos and telemetry reads live in feature-local `ReposApi`/`DashboardApi` modules because
  `core/api/api-client.ts` has no such methods; they collapse into `ApiClient` when a later
  task owns it.
- The `[live]` criterion — adding a repo shows its gate result without a reload — is not
  measured on CI and is blocked until a task ships `/v1/repos`; an `agent-review` issue carries
  the measurement.

### Added — 2026-10-25 (Task-22, run detail)

- `/runs/:id` is a real screen: the timeline replayed from `GET /v1/runs/{id}/events` and
  extended by the SSE stream with a key per event, so a reconnect never duplicates a row;
  the gate result, the eight contract guardrails rendered from `guardrailSchema.state` (never
  a string match), the blockers, the diff stat, the PR link, the merge result and the cost.
- Cancel asks first and then reflects the returned `cancelled` run; revert is offered only on
  a `succeeded` run that carries a PR, sends one `Idempotency-Key` and navigates to the new
  run. A `409 diff_unavailable` is a normal state, not an error.
- `ApiClient` gains `getRun`, `runEvents`, `runDiff`, `cancelRun` and `revertRun`, all parsed
  with the contract schemas, and a malformed body is an `ApiError` with code `contract`.
- The `[live]` criterion — a live timeline and the revert deep link on the VM — is not
  measured on CI; an `agent-review` issue carries its measurement.

### Added — 2026-10-25 (Task-16, notifications)

- `apps/daemon/src/push` is a full daemon subsystem: the four `docs/api.md` §5.7 routes —
  notification preferences, subscribe and unsubscribe — stored under two `settings` keys
  (no migration), parsed with the contract schemas and behind the `read`/`write` scopes.
- One finished run becomes **one** push per subscribed device: `run.merged` and
  `run.finished` share the `run:<id>` delivery key, and a `404`/`410` from the push service
  prunes exactly that subscription.
- VAPID `ES256` JWTs and the RFC 8291 `aes128gcm` payload are built with `node:crypto` only,
  so no dependency was added; without a VAPID pair the subsystem stays configured-off and
  every delivery counts as skipped, which leaves the daemon boot unchanged.
- Per-event preferences and quiet hours gate delivery, and a push held by quiet hours drains
  when the window closes.
- The `[live]` criterion — a real browser subscription receives the push and deep-links to
  the run — is not measured on CI; an `agent-review` issue carries its measurement.

### Added — 2026-10-25 (Task-18, app shell)

- `apps/app` is an Angular 22.2.3 + Ionic 9.0.9 + Capacitor 8.5.3 standalone, zoneless app:
  a tab shell, the theme tokens, every documented route declared lazily as a placeholder for
  Tasks 19–23, an EN/ES i18n scaffold, the manifest and a service worker.
- `core/api` is a typed client over the contract parsers; `core/events` is a fetch-based SSE
  client with exponential backoff, `Last-Event-ID` resume and gap handling; `core/auth` keeps
  the access token in a signal and the refresh token in a `SecureStore` port — nothing in
  `localStorage`.
- The app unit suite runs headless through `@angular/build:unit-test` with a 30 s budget, and
  the root gate builds the app too.

### Added — 2026-10-25 (Task-17, CLI)

- `cb` ships as `apps/daemon/bin/cb.mjs`: `pair`, `status`, `doctor`, `run`, `jobs`, `logs`,
  `events`, `brake`, `update`, `backup` and `revert`, a thin HTTP client over `/v1` with an
  injected transport and no import of the daemon's internals.
- `cb doctor` runs eight checks, prints one `ok`/`warn`/`fail`/`skip` line each and exits
  non-zero on a failure; exit codes `0`–`5` are frozen and `CODEBOX_URL`/`CODEBOX_TOKEN` are
  the client variables.
- No token is ever printed: every rendered value passes the redaction helper, and an error
  envelope that echoes a token is still safe.

### Added — 2026-10-25 (Task-15, jobs and runs API)

- `docs/api.md` §5.3–§5.5 are served: job CRUD with `nextFireAt` and a next-fire preview,
  run-now that the pause switch ignores, pause/resume, the runs list with stable cursor
  pagination, run detail, cancel, revert, JSON event replay, diff stat, and the approval
  inbox with `allow`/`deny` replies and expiry.
- The merged run engine is wired behind `src/runs/**` from its ports: one shared engine, one
  in-flight map and one cost budget for jobs and runs; a manual run writes the queued row and
  `run.queued` before `engine.start` adopts it.
- `Idempotency-Key` returns the first run for 24 h per device and rejects a different body
  with `409 idempotency_mismatch`; the store is in memory and resets on restart.
- `POST /v1/chat/sessions/{id}/promote` starts a run from the last assistant message.

### Added — 2026-10-25 (Task-13, chat API and event bridge)

- The daemon serves `docs/api.md` §5.6: create, list, get and archive a chat session bound to
  a repository, post a message, page the transcript oldest-first and interrupt the agent,
  behind the `chat` or `read` scope and parsed with the contract schemas.
- A chat pump maps OpenCode events into `chat.message`, `chat.delta`, `chat.tool`,
  `chat.permission` and `chat.idle` rows with a monotonic per-chat `seq`, redacts the tool
  input before it is stored, turns a permission request into exactly one approval row and
  delivers an answered approval back to OpenCode.
- `GET /v1/events` is the one SSE stream: exact `Last-Event-ID` replay, one `gap` frame on a
  pruned range, a 15 s heartbeat, additive `types`/`runId`/`chatId` filters, a terminal close
  for a run stream and three connections per device.
- Archiving keeps the worktree; a restart re-binds the session to a new OpenCode session in
  the same worktree.

### Added — 2026-10-25 (Task-14, run engine)

- `apps/daemon/src/run` executes one run end to end behind injected ports: bare clone,
  worktree, OpenCode session with the versioned envelope, gate, one daemon commit when the
  agent did not commit, push, PR with a generated body, required checks, the eight D12
  guardrails and a merge that is retried once and then parked in `pr_open`.
- Every state change goes through `transitionRun`; every event is persisted with a monotonic
  per-run `seq` and then emitted. The walk is proven on fakes —
  `queued → preparing → running → gating → pr_open → merging → succeeded` with exactly
  `run.queued, run.started, run.gate, run.pr, run.merged, run.finished`.
- A red gate pushes nothing, opens no PR and ends `failed` with `gate_failed`; a protected
  path, a moved base or a red check parks the run in `pr_open` with the contract blocker; a
  cancel interrupts the session and removes the worktree, and `merging` refuses one.
- The gate runner uses `/bin/bash -lc` in its own process group with a
  `PATH`/`HOME`/`TMPDIR` + `CI`/`NO_COLOR`/`CB_RUN_ID` allowlist, logs to
  `logs/run-<id>/gate.log`, keeps the last 100 lines and kills the group on timeout (exit
  124); the run timeout, the daily cost cap and one transport retry are enforced.
- `apps/daemon/package.json` declares `@codebox/{core,opencode,workspaces,git-provider}` and
  the lockfile records them; `run` and `gate` stay absent as daemon modules, so boot is
  unchanged until the jobs API wires the engine.

### Added — 2026-10-25 (Task-12, auth and pairing)

- The daemon pairs a device: `POST /v1/pair/code` (loopback source or an `admin` bearer)
  mints a one-time 10-character code with a 300 s TTL, stored only as a scrypt hash in
  memory; `POST /v1/pair` exchanges it for a device row, a 900 s access token and a 30-day
  refresh token. A used, expired or unknown code never pairs twice, even under two concurrent
  exchanges, and the 11th pairing request per source in an hour is `429` with `Retry-After`.
- Refresh tokens rotate on every use; the previous hash is kept only to detect replay, and a
  replay revokes the device. A revoked device fails every scope, `admin` included.
- One `/v1/*` middleware guards every route except health, version, pairing and the refresh
  exchange; `GET /v1/me`, `GET /v1/devices` (`read`), `DELETE /v1/devices/{id}` (`admin`) and
  `POST /v1/auth/logout` answer the documented bodies with strict schemas and the documented
  `401`/`403`/`404`/`422`/`429` envelopes.
- `apps/daemon/src/app.ts` hands an API path to the modules registered after the SPA catch-all,
  so a module route is reachable while an unmatched `/v1` path still ends in `not_found` and
  the traversal guard and `app_not_built` fallback are unchanged.

### Added — 2026-10-25 (Task-34, routine store and scheduler)

- Migration `0002_routines.sql` adds `routines` and `routine_fires` with the D38 kind CHECKs
  and `UNIQUE (routine_id, scheduled_for)` as the idempotency key; it is forward-only and
  `0001_init.sql` is untouched.
- `RoutineRepository` and `RoutineFireRepository` create, patch, pause, delete and list, and
  the claim transaction returns one winner across 20 concurrent handles, with `skip` recording
  a fire that was deliberately not sent.
- `planRoutineTick` and `nextRoutineFire` reuse the job clock: the next fire is computed in the
  IANA zone under the D13 grace and misfire rule, so the `Europe/Madrid` DST rows land on the
  documented instants and a fire outside the grace is skipped once and never retried.

### Added — 2026-10-25 (Task-25, VM image)

- A Packer template builds the Ubuntu 24.04 arm64 OCI image with Node 24, git, gh, opencode,
  cloudflared and the build tools; no secret is baked, and `90-verify.sh` fails the build when
  a token pattern appears under `/etc` or `/opt`.
- cloud-init renders `/etc/codebox/instance.env` from OCI Vault as `0600 root:codebox`, writes
  the tunnel credentials, starts the units and appends one `first-boot.jsonl` line; a second
  boot rewrites the same bytes and appends exactly one more line.
- `ops/vm/{install,upgrade,backup,restore}.sh` install a release atomically after a checksum
  check, roll back to `previous`, write the encrypted backup archive and restore it after
  verifying its row counts; the units run the daemon, OpenCode, cloudflared and the nightly
  backup.
- The `[live]` criterion (an instance boots, the tunnel answers `/v1/health`) is not measured
  here; an `agent-review` issue carries its measurement, as does `packer validate` against a
  real tenancy.

### Added — 2026-10-25 (Task-11, daemon skeleton)

- `@codebox/daemon` boots: every `CB_*` key is parsed and validated at the edge (a missing or
  short secret fails fast with the key name and no value echoed), a structured JSON logger
  redacts by key, SQLite comes from `@codebox/store`, and Hono serves `/v1/health`,
  `/v1/version`, the built app and a request id on every answer.
- Boot reconciliation marks a run left `running` as `failed` with `orphaned` exactly once,
  removes stale locks, writes `daemon.json` and drains the server on `SIGTERM` with exit `0`.
- The `DaemonModule` seam and the subsystem flags let Tasks 12–17 add modules without
  rewriting `main.ts`; the daemon's vitest project resolves `@codebox/*` from source, so
  `npm test` runs before `npm run build`.
- `hono` 4.13.13 and `@hono/node-server` 2.1.5 are pinned, and the raw request target is
  checked for dot segments so a traversal attempt cannot reach the SPA fallback.

### Added — 2026-10-25 (Task-10, GitHub provider)

- `@codebox/git-provider` implements the `GitProvider` port for GitHub: an App JWT from the
  private key, installation tokens cached until shortly before expiry and refreshed once on a
  401, repository verification, branch push with the credential only in the git argument, one
  PR per branch (a second push updates it), the required-check summary the guardrails read,
  merge with the documented 405/409/422 mapping, close, branch delete and a PAT fallback.
- Every failure is a typed `GitProviderError` mapped one-to-one to the contract error
  vocabulary; no raw GitHub body, URL, header or token can reach a message or a log.
- `startFakeGitHub` is a scriptable in-process REST surface, so the whole provider is proven
  offline; section 6 of `docs/jobs.md` is reconciled.
- The `[live]` criterion (real `verifyRepo`/`getChecks` against a scratch repository with a
  fine-grained PAT) is **not measured** here; an `agent-review` issue carries its measurement.

### Added — 2026-10-25 (Task-09, scheduler)

- `@codebox/scheduler` is the one seam the daemon ticks: `planTick` turns the due rows into an
  ordered claim plan with the D13 grace decision, recomputes the next fire from `now` (never
  from the missed schedule, so no catch-up storm) and persists one update per selected fire.
- `validateSchedule` and `planFires` back job create/edit and the next-fire preview;
  `planResume`/`planPause` keep a paused job invisible and recompute on resume; tick delay is
  epoch-aligned at 15–30 s.
- The cron arithmetic stays in `@codebox/core` as an injected `CronEngine`; the package holds
  no clock, timer, environment or I/O, and its table-driven tests pin the Madrid DST rows, the
  grace boundary, the claim key and total ordering. Section 2 of `docs/jobs.md` is reconciled.

### Added — 2026-10-25 (Task-08, workspaces)

- `@codebox/workspaces` owns the on-disk side of a run: a bare clone cache cloned atomically
  and fetched thereafter, one worktree per run on a `cb/<runId>-<slug>` branch, its run
  marker, and retention cleanup that never touches the cache or a directory it did not create.
- `status` returns the frozen `RunDiff` plus the changed paths and the D26 protected-path
  hits, with the recorded base sha kept distinct from the base tip the guardrails compare.
- Git runs through an injectable `GitRunner` and the D26 globs through an injected matcher, so
  the package is proven headless — including real-git tests against a temporary bare origin —
  and no clone URL, stderr or command line can reach an error message.
- The `[live]` criterion (a 100 MB repository clones once and reuses the cache in under 5 s on
  the VM) is **not measured** here; an `agent-review` issue carries its measurement.

### Added — 2026-10-25 (Task-07, OpenCode wrapper)

- `@codebox/opencode` is the only package that knows the OpenCode wire: a `fetch`-based
  `AgentRuntime` over the pinned V2 HTTP surface, a normaliser that emits contract SSE events
  (`run.*`/`chat.*`) with caller-owned `seq` and timestamps, and the run prompt envelope.
- The supervisor is policy with injected spawn, port probe, clock and sleep: it adopts an
  already-healthy server, restarts a dead child inside a bounded window and refuses a second
  listener on the port.
- `FakeOpenCode` is an in-process HTTP server that scores the client itself; five recorded
  fixtures pin the success, permission, interrupt, dropped-stream and crash timelines.

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

# Spec: Task-75 — App: Repos, four repository tabs, run log and sessions

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (`apps/app`, Angular 22 + Ionic 9, standalone components, signals).
- **Role:** Dev.
- **Objective:** after this task the app carries the shape D44/D51/D55/D56 describe and no
  longer carries the chat model: the bottom bar is **Dashboard · Repos · Settings**, a
  repository is a destination with four tabs on four routes (`/repos/:id` backlog,
  `/repos/:id/works`, `/repos/:id/schedule`, `/repos/:id/design`), `/works/:id` is a **run log
  with no composer**, and `/sessions/:id` is an editor with its target, its thread and a
  pending-proposal panel. The chat list, its five filters, the scope chip, the promote action,
  the handoff divider and the chat composer are deleted, with their stores, APIs, dictionaries
  and specs.
- **Environment:** worktree `../wt-cb-75`, branch `task-75`, base `main` (merged at `b93e224`).
- **Dependencies:**
  - **Task-70** (merged) — `packages/contracts/src/works.ts` (`workSchema`, `workDetailSchema`,
    `sessionSchema`, `sessionMessageSchema`, `backlogSchema`, `repoScheduleSchema`) and their
    `parse*` helpers re-exported from `packages/contracts/src/index.ts`; the event data shapes in
    `packages/contracts/src/events.ts` (`session.created`, `session.delta`, `session.tool`,
    `session.proposal`, `session.closed`, `work.*`, `run.*`).
  - **Task-72** (merged) — `apps/daemon/src/works/**` and `apps/daemon/src/sessions/**` host the
    routes this task calls, documented in `docs/api.md` §5.6 and §5.6.1.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

Modified (13):

- `apps/app/src/app/app.routes.ts` — the router and `SHELL_TABS`.
- `apps/app/src/app/app.routes.spec.ts` — the path table, the guard walk and the `docs/app.md`
  §4 agreement test.
- `apps/app/src/app/features/dashboard/dashboard.page.ts` — **only** the two `routerLink="/chat"`
  targets (line ~134 `dashboard-start-chat`, line ~158 `dashboard-needs-you-chat`) become
  `routerLink="/repos"`. Nothing else in the file changes; the chat-session read it already
  performs is Task-76's to remove.
- `apps/app/src/app/features/dashboard/dashboard.page.spec.ts` — the two `href` assertions that
  pin those links to `/chat` become `/repos`.
- `apps/app/src/app/shell/tabs.page.ts`
- `apps/app/src/app/shell/tabs.page.spec.ts`
- `apps/app/src/assets/i18n/en.json` — `tabs.chat` becomes `tabs.repos`.
- `apps/app/src/assets/i18n/es.json` — same key, Spanish label.
- `apps/app/src/app/features/repos/i18n.ts` — receives the four `repoPicker.*` keys moved
  out of the deleted `features/chat/new-chat.i18n.ts`, EN and ES, same order, nothing else
  changes in the file.
- `apps/app/src/app/features/repos/repo-picker.ts` — one line: the `translate` import moves
  from `../chat/new-chat.i18n` to `./i18n`. No other change to this component; it is a
  repository component, not a chat one.
- `apps/app/src/app/features/repos/repo-picker.spec.ts` — the same import change (it imports
  `STRINGS` and `translate` from `../chat/new-chat.i18n` today).
- `apps/app/README.md` — one line per file, added and removed (`readme.spec.ts` fails otherwise).
- `docs/app.md` — §4 and §8 only.

Created — `features/repos/` (the repository chrome and the schedule/design tabs):

- `apps/app/src/app/features/repos/repo-tabs.ts`
- `apps/app/src/app/features/repos/repo-tabs.spec.ts`
- `apps/app/src/app/features/repos/repo-schedule.api.ts`
- `apps/app/src/app/features/repos/repo-schedule.api.spec.ts`
- `apps/app/src/app/features/repos/repo-schedule.store.ts`
- `apps/app/src/app/features/repos/repo-schedule.store.spec.ts`
- `apps/app/src/app/features/repos/repo-schedule.page.ts`
- `apps/app/src/app/features/repos/repo-schedule.page.spec.ts`
- `apps/app/src/app/features/repos/repo-design.page.ts`
- `apps/app/src/app/features/repos/repo-design.page.spec.ts`
- `apps/app/src/app/features/repos/repo-chrome.i18n.ts` — the two new pages' dictionary.

Created — `features/backlog/` (the repository's list, its run action and the new-session sheet):

- `apps/app/src/app/features/backlog/backlog.api.ts`
- `apps/app/src/app/features/backlog/backlog.api.spec.ts`
- `apps/app/src/app/features/backlog/backlog.store.ts`
- `apps/app/src/app/features/backlog/backlog.store.spec.ts`
- `apps/app/src/app/features/backlog/repo-backlog.page.ts`
- `apps/app/src/app/features/backlog/repo-backlog.page.spec.ts`
- `apps/app/src/app/features/backlog/new-session.sheet.ts`
- `apps/app/src/app/features/backlog/new-session.sheet.spec.ts`
- `apps/app/src/app/features/backlog/i18n.ts`

Created — `features/works/` (the works tab and the work run log):

- `apps/app/src/app/features/works/works.api.ts`
- `apps/app/src/app/features/works/works.api.spec.ts`
- `apps/app/src/app/features/works/work.store.ts`
- `apps/app/src/app/features/works/work.store.spec.ts`
- `apps/app/src/app/features/works/repo-works.page.ts`
- `apps/app/src/app/features/works/repo-works.page.spec.ts`
- `apps/app/src/app/features/works/work.page.ts`
- `apps/app/src/app/features/works/work.page.spec.ts`
- `apps/app/src/app/features/works/i18n.ts`

Created — `features/sessions/` (the editor, its stream state and the moved renderer):

- `apps/app/src/app/features/sessions/sessions.api.ts`
- `apps/app/src/app/features/sessions/sessions.api.spec.ts`
- `apps/app/src/app/features/sessions/session-stream.ts`
- `apps/app/src/app/features/sessions/session-stream.spec.ts`
- `apps/app/src/app/features/sessions/session.store.ts`
- `apps/app/src/app/features/sessions/session.store.spec.ts`
- `apps/app/src/app/features/sessions/session.page.ts`
- `apps/app/src/app/features/sessions/session.page.spec.ts`
- `apps/app/src/app/features/sessions/markdown.ts` (moved from `features/chat/markdown.ts`)
- `apps/app/src/app/features/sessions/markdown.spec.ts` (moved, unchanged in substance)
- `apps/app/src/app/features/sessions/i18n.ts`

Deleted:

- `apps/app/src/app/features/chat/**` — every chat **UI** file in the folder: `chat-list.page.*`,
  `chat-list.store.*`, `chat.page.*`, `chat.store.*`, `chat-store.*`, `chat-stream.*`,
  `i18n.ts`, `context-sheet.*`, `new-chat.*` (after the `repoPicker.*` keys moved to
  `features/repos/i18n.ts`), `schedule-propose.*` and their specs. The only survivors are
  `markdown.ts` and `markdown.spec.ts`, which move to `features/sessions/`, and **exactly two
  files that stay in place**: `features/chat/chat.api.ts` and `features/chat/chat.api.spec.ts`.
  That pair is the legacy `/v1/chat/sessions` client, and
  `apps/app/src/app/features/schedules/schedule-filter.store.ts` (outside this task's paths)
  imports `ChatApi` from it; the daemon still answers those routes until Task-76 retires them.
  Deleting it here would break a folder this task must not touch.
- `apps/app/src/app/shared/chat-row.ts` and `apps/app/src/app/shared/chat-row.spec.ts` — the
  scope chip and the unreviewed edge belong to the retired chat list.
- `apps/app/src/app/features/repos/repo.page.ts` and
  `apps/app/src/app/features/repos/repo.page.spec.ts` — the single `/repos/:id` detail page is
  replaced by the backlog tab. `repo.store.ts`, `repos.page.ts`, `repos.api.ts`,
  `repo-picker.*` and `repo-form.*` stay untouched, except the two import lines named above.

Do **not** touch `package.json`, `package-lock.json`, `apps/app/angular.json`,
`apps/app/src/main.ts`, `apps/app/src/theme/**`, `packages/contracts/**` or `apps/daemon/**`.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `apps/app/src/app/app.routes.ts`, `app.routes.spec.ts`, `app.config.ts`, `app.component.ts`,
  `apps/app/src/app/shell/tabs.page.ts`, `shell/tabs.page.spec.ts`, `apps/app/README.md`,
  `apps/app/src/app/readme.spec.ts`.
- `apps/app/src/app/core/api/{api-client.ts,http.ts}` — `ApiError` and the URL helpers to reuse;
  `core/events/{sse.service.ts,events.ts}` — the one last-event signal a store subscribes to;
  `core/i18n/i18n.service.ts` — `t` and the dictionary rule.
- `apps/app/src/app/features/repos/**` (existing) and `apps/app/src/app/features/chat/**` — read
  before deleting: the pure `markdown.ts` moves, nothing else is reused.
- `apps/app/src/app/features/settings/settings.page.ts` — the `unavailable` block pattern the
  design tab copies.
- `packages/contracts/src/index.ts`, `packages/contracts/src/works.ts`,
  `packages/contracts/src/resources.ts`, `packages/contracts/src/primitives.ts`,
  `packages/contracts/src/events.ts` — **read only**; no contract is edited here.
- `docs/app.md` (§4 and §8 in full, §5 for the state rules), `docs/api.md` (§5.6, §5.6.1,
  §5.10), `design/README.md` (§1, §2, §6).
- `TODO.md` — the Task-74/75/76/77/78/79/80 blocks, for what this task must leave for the next
  batch.

## 🔒 Contract

**No contract is invented.** Every shape below is a name that already exists in
`@codebox/contracts` at `b93e224`. If a field a screen needs is missing from those schemas, the
correct move is to stop and report it in the task report — never to add a local interface, a
`Pick<>` of a guessed payload, or a hand-written parser for a `/v1` body.

Imports this task is allowed to use, and only these:

```ts
import {
  parseBacklog, parseWork, parseWorkDetail, parseSession, parseSessionMessage,
  parsePage, parseRun, parseSchedule,
  workSchema, sessionMessageSchema, scheduleSchema,
} from '@codebox/contracts';
import type {
  Backlog, BacklogItem, BacklogSection, Work, WorkDetail, WorkState,
  Session, SessionMessage, SessionProposal, SessionTarget, Page, RepoDetail, Run, Schedule,
  SseStreamEvent,
} from '@codebox/contracts';
```

### Router — `apps/app/src/app/app.routes.ts`, frozen

```ts
export type ShellTabId = 'dashboard' | 'repos' | 'settings';

export interface ShellTab {
  readonly id: ShellTabId;
  readonly path: '/dashboard' | '/repos' | '/settings';
  readonly labelKey: 'tabs.dashboard' | 'tabs.repos' | 'tabs.settings';
}

/** Exactly three, in this order (D47). */
export const SHELL_TABS: readonly ShellTab[] = Object.freeze([
  { id: 'dashboard', path: '/dashboard', labelKey: 'tabs.dashboard' },
  { id: 'repos', path: '/repos', labelKey: 'tabs.repos' },
  { id: 'settings', path: '/settings', labelKey: 'tabs.settings' },
]);
```

The tab roots stay derived from `SHELL_TABS`. `routes` is, **in this exact order**:

| # | `path` | component (lazy) |
| --- | --- | --- |
| 1 | `''` (`pathMatch: 'full'`, `redirectTo: 'dashboard'`) | — |
| 2 | `pair` | `features/pairing/pairing.page` → `PairingPage` (**unguarded**) |
| 3–5 | `dashboard`, `repos`, `settings` | derived from `SHELL_TABS`; `repos` → `features/repos/repos.page` → `ReposPage` |
| 6 | `repos/:id/works` | `features/works/repo-works.page` → `RepoWorksPage` |
| 7 | `repos/:id/schedule` | `features/repos/repo-schedule.page` → `RepoSchedulePage` |
| 8 | `repos/:id/design` | `features/repos/repo-design.page` → `RepoDesignPage` |
| 9 | `repos/:id` | `features/backlog/repo-backlog.page` → `RepoBacklogPage` |
| 10 | `works/:id` | `features/works/work.page` → `WorkPage` |
| 11 | `sessions/:id` | `features/sessions/session.page` → `SessionPage` |
| 12 | `jobs` | `features/jobs/jobs.page` → `JobsPage` |
| 13 | `jobs/:id` | `features/jobs/job.page` → `JobPage` |
| 14 | `runs` | `features/runs-list/runs.page` → `RunsPage` |
| 15 | `runs/:id` | `features/run-detail/run.page` → `RunDetailPage` |
| 16 | `approvals` | `features/approvals/approvals.page` → `ApprovalsPage` |
| 17 | `settings/devices` | `features/settings/devices.page` → `DevicesPage` |
| 18 | `settings/credentials` | `features/credentials/credentials.page` → `CredentialsPage` |
| 19 | `about` | `features/about/about.page` → `AboutPage` |
| 20 | `**` | `features/about/about.page` → `AboutPage` |

Every route except `pair` carries `canActivate: [authGuard]`. Tab roots carry
`data: { tab: tab.id }`; `repos/:id*` routes are untabbed (`data.tab` undefined) because the
repository is a pushed destination, per `docs/app.md` §4. `chat` and `chat/:id` are gone; no
redirect from `/chat` is added (a redirect would keep the route reachable, and the acceptance
criterion forbids it).

### `features/repos/repo-tabs.ts` — the four tabs, one source of truth

```ts
export type RepoTabId = 'backlog' | 'works' | 'schedule' | 'design';

export interface RepoTab {
  readonly id: RepoTabId;
  readonly link: (repoId: string) => readonly string[]; // routerLinkCommands
  readonly labelKey: 'repoTabs.backlog' | 'repoTabs.works' | 'repoTabs.schedule' | 'repoTabs.design';
}

export const REPO_TABS: readonly RepoTab[];  // exactly these four, in this order
```

`RepoTabs` is a standalone component with `repoId` as a **required string input**; it renders one
`<a>` per tab with `data-testid="repo-tab-<id>"`, `routerLinkActive` and
`[attr.data-active]`. Every one of the four pages renders `<app-repo-tabs [repoId]="…" />` so a
tab can never exist on one screen and not another.

### API calls — exact, no other URL is called by this task

| Call | URL | Parser | Used by |
| --- | --- | --- | --- |
| backlog | `GET /v1/repos/{id}/backlog` | `parseBacklog` | `BacklogApi.get` |
| create work | `POST /v1/works`, body `{ repoId, backlogRef }` → 201 | `parseWork` | `BacklogApi.createWork` |
| start attempt | `POST /v1/works/{id}/runs`, body `{}` → 202 | `parseRun` | `BacklogApi.startRun` |
| create session | `POST /v1/sessions`, body `{ repoId, target }` → 201 | `parseSession` | `BacklogApi.createSession` |
| works of a repo | `GET /v1/works?repoId={id}` | `parsePage(workSchema)` | `WorksApi.list` |
| work detail | `GET /v1/works/{id}` | `parseWorkDetail` | `WorksApi.get` |
| decision session | `POST /v1/works/{id}/decision` → 201 | `parseSession` | `WorksApi.decision` |
| rework | `POST /v1/works/{id}/runs`, body `{}` → 202 | `parseRun` | `WorksApi.startRun` |
| session | `GET /v1/sessions/{id}` | `parseSession` | `SessionsApi.get` |
| transcript | `GET /v1/sessions/{id}/messages?limit=&cursor=` | `parsePage(sessionMessageSchema)` | `SessionsApi.messages` |
| send | `POST /v1/sessions/{id}/messages`, body `{ text }` → 202 | `parseSessionMessage` | `SessionsApi.send` |
| stop | `POST /v1/sessions/{id}/interrupt` → 200 | `parseSession` | `SessionsApi.interrupt` |
| proposal merge | `POST /v1/sessions/{id}/merge` → 200 | `parseSession` | `SessionsApi.merge` |
| repo schedule | `GET /v1/schedules?repoId={id}` | `parsePage(scheduleSchema)` | `RepoScheduleApi.list` |
| create schedule | `POST /v1/schedules` → 201 | `parseSchedule` | `RepoScheduleApi.create` |
| pause / resume | `POST /v1/schedules/{id}/pause`, `/resume` → 200 | `parseSchedule` | `RepoScheduleApi.pause` / `.resume` |
| run next | `POST /v1/repos/{id}/run-next` → 202 | `parseRun` | `RepoScheduleApi.runNext` |

All four API classes reuse `ApiError` and `toApiError` semantics from
`core/api/api-client.ts` (import `ApiError`; do not duplicate the envelope mapping — a small
local `toApiError` that imports `ApiError` and mirrors the existing one in
`features/repos/repos.api.ts` is acceptable only because that file's helper is module-private).

### Screens — routes, states, test hooks

`/repos/:id` — `RepoBacklogPage` (root `<section data-testid="page-repo-backlog">`):

- Header: the repository name from `RepoStore.load(id)` (`features/repos/repo.store.ts`,
  provided by this page), the gate state, and **one chat button** `data-testid="repo-chat-button"`
  — `design/README.md` §6: the header is a chat button, never a `+`.
- `<app-repo-tabs>` directly under the header.
- Body: `BacklogApi.get(id)` → `backlog.sections[].items[]`. Each item renders as one
  `<li data-testid="backlog-row" [attr.data-ref]="item.ref" [attr.data-checked]="item.checked"
  [attr.data-state]="item.work?.state ?? 'none'">` containing, **as separate elements**:
  - `data-testid="backlog-row-ref"` — `Task-NN` (monospace);
  - `data-testid="backlog-row-title"` — the **plan**: `item.title`, nothing else;
  - `data-testid="backlog-row-state"` — the **state**: `item.work?.state` rendered through a
    `Record<WorkState, string>` label map plus `'none'`, with `data-state` on the chip;
  - `data-testid="backlog-row-runs"` — `item.work?.runs ?? 0` runs;
  - `data-testid="backlog-run-<ref>"` — a `Run` button, rendered only when `item.checked` is
    `false` **and** `item.work` is `null` or its state is `failed`/`merged`.
- States: `backlog-loading`, `backlog-empty` (a repository with an empty `sections`),
  `backlog-error` with `data-code`, `backlog-retry`.
- `Run` flow, in one action handler: `createWork(repoId, ref)` → `startRun(work.id)` → navigate
  `['/works', work.id]`. A `409` whose `details.reason === 'live_work'` renders
  `data-testid="backlog-live-work"` with a link to the existing work and makes **no** second
  call. Any other `ApiError` renders `backlog-error` with its `code`.
- `app-new-session` (see below) opens from the chat button and emits `created(session)`, on
  which the page navigates to `['/sessions', session.id]`.
- Subscribe to the last `SseService.event()`: on `backlog.changed` for this `repoId`, refetch.

`new-session.sheet.ts` — `NewSessionSheet`:

- `data-testid="new-session-sheet"`, three target buttons
  `new-session-target-backlog|design|schedule` and one `new-session-target-repo` (**read-only**,
  `target: 'repo'`), `new-session-cancel`, `new-session-create`, `new-session-error` with
  `data-code`.
- `POST /v1/sessions` with `{ repoId, target }`. **No `workId` is ever sent**: the contract
  requires `workId` for `target: 'work'` and the repository screen has no work in hand. The
  design frame's fourth target (*Rework*) is therefore reached from `/works/:id`, not here —
  see 📣 Coordination.
- No request on render; exactly one `POST` per `Create` tap (busy guard on the button).

`/repos/:id/works` — `RepoWorksPage` (root `page-repo-works`):

- `WorksApi.list(repoId)` → a flat list, newest activity first exactly as the daemon returns it
  (no client-side sort): one `<li data-testid="repo-work-row" [attr.data-work-id]
  [attr.data-state]>` per work with its `backlogRef`, its title and its state, linking to
  `['/works', work.id]` (`repo-work-link-<id>`).
- States: `repo-works-loading`, `repo-works-empty`, `repo-works-error`, `repo-works-retry`.
- This page is a placeholder for the factory Task-77 replaces; it must not draw rooms or faces.

`/repos/:id/schedule` — `RepoSchedulePage` (root `page-repo-schedule`):

- `RepoScheduleApi.list(repoId)` → the single row for this repository, or none.
- With a row: `repo-schedule-row` with `data-schedule-id`, the mode
  (`repo-schedule-mode`), the cron **or** the window (`repo-schedule-window`), the timezone,
  `maxFires` / `maxCostPerFireUsd` (`null` renders as "no cap"), `firesCount`, `spendUsd`,
  `nextFireAt` and `lastFiredAt` in the row's timezone (`features/jobs/time-format.ts` may be
  imported read-only), `repo-schedule-pause` or `repo-schedule-resume` (optimistic with
  rollback), and `repo-schedule-run-next`.
- **Not rendered: `selection`, `refs`, `maxAttempts`.** `GET /v1/schedules` answers the legacy
  `Schedule` (`parseSchedule`), which does not carry them, and no route projects
  `repoScheduleSchema` yet. Do not add a local type and do not parse the row with
  `parseRepoSchedule` — report the gap instead.
- With no row: an empty state `repo-schedule-empty` and a create form
  (`repo-schedule-create`) with mode, timezone, and either cron or window start/end; the create
  body is `{ repoId, mode, timezone, cron? | windowStart?/windowEnd? }`. A `409` with
  `details.reason === 'schedule_exists'` refetches instead of showing an error.
- `Run next` success (`202 Run`) navigates to `['/works', run.workId]` **only if** the response
  carries a work id; the `Run` schema has no `workId`, so it navigates nowhere and instead
  renders `repo-schedule-next-run` with the run id and state. A `409` with
  `details.reason === 'nothing_pending'` or `'nothing_runnable'` renders that reason in
  `repo-schedule-notice`.

`/repos/:id/design` — `RepoDesignPage` (root `page-repo-design`):

- Renders `<app-repo-tabs>` and an honest **unavailable** block
  `data-testid="repo-design-unavailable"` (the `features/settings/settings.page.ts` pattern),
  plus `repo-design-new-session` which opens `app-new-session` with the `design` target chosen.
- It calls **no** API for design artifacts: no route on `main` returns `design/` yet. Task-79
  owns the preview.

`/works/:id` — `WorkPage` (root `page-work`):

- `WorksApi.get(id)` → `WorkDetail` (`work`, `repo`, `runs`).
- Header `work-header`: repository, `work-state` (`data-state` = `work.state`), `work-context`
  (`work.contextTokens`, the epoch) and `work-cost` (`work.usage.usd`), plus the backlog ref and
  `work-attempts` "n of maxAttempts".
- One segment per run, `work-run` with `data-run-id` and `data-state`: the branch
  (`work-run-branch`), the outcome, a gate card `work-run-gate` with `data-status` from
  `run.gate.status` (and `data-exit-code`), a PR card `work-run-pr` with `data-state` from
  `run.pr` (`'open'`/`'merged'`/`'none'` derived from `run.pr` and `run.state`), and, on a
  `merged` run, `work-run-backlog-tick` carrying the work's `backlogRef`. **Every card renders
  from the contract fields; no card is produced by matching a message string.**
- Exactly **one** action when blocked: `work-resolve-doubt` (`data-testid`) when
  `work.state === 'needs_decision'` → `WorksApi.decision(id)` → navigate
  `['/sessions', session.id]`.
- A `merged` work offers **Rework** (`work-rework`) → `WorksApi.startRun(id)` → navigate
  `['/works', run.id]` is wrong (the run belongs to the same work); it refetches the detail and
  renders the new run segment.
- **No composer:** no `<textarea>`, no `<ion-textarea>`, no `data-testid="composer"`, no send
  button anywhere in this page. A work that needs to talk is a work that ended in
  `needs_decision` (`docs/app.md` §8).
- States: `work-loading`, `work-error` with `data-code`, `work-retry`.

`/sessions/:id` — `SessionPage` (root `page-session`):

- `SessionsApi.get(id)` → `Session`, then `SessionsApi.messages(id)` for the thread, oldest
  first; `session-target` names the target (`TODO.md`, `design/`, `Task-68 · work`, or
  `Read-only` for `target: 'repo'`).
- Thread: `session-message` per message with `data-role` and `data-message-id`, rendered through
  `markdown.ts`.
- Live: `session.delta` for this `sessionId` appends to the last assistant message;
  `session.tool` adds a tool card; `session.proposal` sets the pending proposal;
  `session.closed` marks the session archived.
- Composer `session-composer` (textarea) + `session-send` + `session-stop`; **disabled while
  `session().pendingProposal !== null`**, with `session-composer-blocked` explaining why
  (`docs/app.md` §8: one change at a time). `session-stop` calls `interrupt`.
- Proposal panel `session-proposal`: `data-sha`, `session-proposal-branch`,
  `session-proposal-paths` (one list item per `paths` entry) and `session-merge` → `merge` once
  (busy guard). A refused merge (`409 proposal_none`, `409 target_violation` with
  `details.path`, `409 read_only_session`) renders `session-merge-error` with `data-code` and
  re-enables the button, because the pending proposal is cleared whatever the outcome.
- `target: 'repo'` renders **no** proposal panel and no merge button; the thread and composer
  remain.
- States: `session-loading`, `session-error` with `data-code`, `session-retry`.

### `session-stream.ts` — pure state, frozen

```ts
export interface SessionThread {
  readonly messages: readonly SessionMessage[];
  readonly tools: readonly SessionToolCard[];
  readonly proposal: SessionProposal | null;
  readonly working: boolean;
  readonly lastSeq: number;
}
export interface SessionToolCard {
  readonly key: string;            // `${sessionId}:${seq}`
  readonly tool: string;
  readonly status: 'start' | 'ok' | 'error';
  readonly detail: string | null;
  readonly seq: number;
}
export const EMPTY_THREAD: SessionThread;
export function mergeMessages(thread: SessionThread, page: Page<SessionMessage>): SessionThread;
export function appendMessage(thread: SessionThread, message: SessionMessage): SessionThread;
export function applySessionEvent(thread: SessionThread, target: string, event: SseStreamEvent): SessionThread;
```

`mergeMessages` and `appendMessage` key a message by `id`; a frame replayed twice must not
duplicate an entry. `applySessionEvent` ignores an event whose `data.sessionId` is not `target`.

### Dictionaries

- `src/assets/i18n/{en,es}.json`: the `tabs` block is exactly `dashboard`, `repos`, `settings`,
  same order, both locales (`tabs.repos` = `Repos` / `Repos`). `tabs.chat` is removed.
- Each new feature folder ships `i18n.ts` in the shape `features/repos/i18n.ts` already uses:
  `STRINGS: Readonly<Record<'en' | 'es', Readonly<Record<string, string>>>>`, both locales with
  the **same keys in the same order**, and the component reads through a local
  `t(key: string): string`.

## 🧩 Configuration

**None.** This task adds no `CB_*` key, reads no environment variable, adds no build flag and
needs no `docs/providers.md` line. The app keeps talking to the same `API_BASE_URL` it already
has; nothing in `apps/app/angular.json`, `apps/app/src/main.ts` or `src/theme/**` changes.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim.

- **Method:**
  - `cd ../wt-cb-75` (the QA integration worktree, `main` + `task-75` merged).
  - `npm ci --prefer-offline --no-audit --no-fund` — a fresh worktree has no `node_modules`.
  - `npm run lint` — must pass.
  - `npm test` — the guard, `ng test` (jsdom, headless) over the app suite and every Vitest
    project. The app suite is where this task's tests run.
  - `npm run build` — `tsc -b` per workspace and `ng build`; a template or signal error that an
    AOT build catches must fail here, not on the box.
  - `npx playwright test` — **not run.** The repository has no `playwright.config.*` and Task-26
    (the e2e suite) is `[!]` on issue #11; the 320 px criterion below is browser-only and is
    reported as `[?]`, never as a pass.
  - `git diff --name-only main...task-75` — audit against the exclusive paths above.
- **Headless test files this task adds or extends** (all run by `npm test`):
  - `features/repos/repo-tabs.spec.ts`, `repo-schedule.api.spec.ts`,
    `repo-schedule.store.spec.ts`, `repo-schedule.page.spec.ts`, `repo-design.page.spec.ts`
  - `features/backlog/backlog.api.spec.ts`, `backlog.store.spec.ts`,
    `repo-backlog.page.spec.ts`, `new-session.sheet.spec.ts`
  - `features/works/works.api.spec.ts`, `work.store.spec.ts`, `repo-works.page.spec.ts`,
    `work.page.spec.ts`
  - `features/sessions/sessions.api.spec.ts`, `session-stream.spec.ts`, `session.store.spec.ts`,
    `session.page.spec.ts`, `markdown.spec.ts`
  - `app.routes.spec.ts`, `shell/tabs.page.spec.ts` (extended), and `readme.spec.ts`
    (unchanged file, now green against the new map)

- **Acceptance criteria:**
  - [ ] `[unit]` `npm ci --prefer-offline --no-audit --no-fund`, `npm run lint`, `npm test` and
        `npm run build` all exit 0.
  - [ ] `[unit]` **The three tabs are Dashboard · Repos · Settings.** `npm test -w @codebox/app`
        passes the `app routes` suite, which asserts `SHELL_TABS` equals the three entries above
        (frozen array), that the three tab roots are the first three guarded routes, and that
        `SHELL_TABS[1].path === '/repos'` with `labelKey === 'tabs.repos'`.
  - [ ] `[unit]` **The route table is exactly the 20 rows of the Contract**, in order, every
        route but `/pair` guarded by `authGuard`, and every `loadComponent` resolving to a
        component (`app.routes.spec.ts` `EXPECTED_PATHS` and its `resolves every loadComponent`
        test).
  - [ ] `[unit]` **No route reaches `/chat` and nothing links to it.**
        `grep -n "path: 'chat" apps/app/src/app/app.routes.ts` prints nothing (exit 1),
        `ls apps/app/src/app/features/chat` prints exactly `chat.api.spec.ts` and `chat.api.ts`,
        and
        `grep -Rn '"/chat"\|'".*/chat"' apps/app/src/app --include=*.ts` finds no router link or
        route string, and `grep -Rn "routerLink=\"/chat\"" apps/app/src/app` prints nothing. The
        legacy chat **API** reads (`/v1/chat/sessions` in `features/dashboard/dashboard.api.ts`,
        `features/chat/chat.api.ts`) are not links and are Task-76's to remove; they are the only
        permitted occurrence of the word `chat` in `apps/app/src/app/features/dashboard/`.
  - [ ] `[unit]` **The folder this task must not touch still builds.** `git diff --name-only
        main...task-75 -- apps/app/src/app/features/schedules` is empty, and the app suite passes
        the untouched `features/schedules` specs, which import `ChatApi` from the retained
        `features/chat/chat.api.ts`.
  - [ ] `[unit]` **The repository picker keeps its copy after the chat dictionary is deleted.**
        `grep -n "chat/new-chat.i18n" apps/app/src/app/features/repos/repo-picker.ts
        apps/app/src/app/features/repos/repo-picker.spec.ts` prints nothing, the four
        `repoPicker.*` keys exist in **both** locales of `features/repos/i18n.ts` with the same
        order, and `npm test -w @codebox/app` passes `repo-picker.spec.ts` unchanged in what it
        asserts.
  - [ ] `[unit]` **The backlog row renders plan and state separately.**
        `npm test -w @codebox/app` passes the `repo-backlog` suite, which mounts the page with
        the fixture item `{ ref: 'Task-77', title: "Workers view: the repository's Workers tab",
        checked: false, line: 1, work: { id: 'wrk_01JABCDEFG', state: 'running', runs: 2 } }`
        and asserts: `[data-testid="backlog-row"]` exists with `data-ref="Task-77"` and
        `data-state="running"`; `[data-testid="backlog-row-title"]`'s text is
        `Workers view: the repository's Workers tab` and contains no state word;
        `[data-testid="backlog-row-state"]`'s text is the `running` label and
        `data-state="running"`; `[data-testid="backlog-run-Task-77"]` is absent while the work is
        running.
  - [ ] `[unit]` **Every work state renders from the contract enum.**
        `npm test -w @codebox/app` passes a table-driven assertion that the seven
        `WorkState` values plus `none` each produce a distinct `backlog-row-state` label, with no
        `default:` fallback text and no string match on a message.
  - [ ] `[unit]` **`Run` is one work and one attempt, not a second one on a live work.** The
        `backlog.store` suite asserts: a tap posts `POST /v1/works` with
        `{ repoId: 'repo_01JABCDEFG', backlogRef: 'Task-77' }` **once**, then
        `POST /v1/works/wrk_01JABCDEFG/runs` with `{}` once, in that order, and navigates to
        `/works/wrk_01JABCDEFG`; a `409` with `details.reason: 'live_work'` makes exactly the
        first call, renders `backlog-live-work` and navigates nowhere.
  - [ ] `[unit]` **The work screen has no composer.** `npm test -w @codebox/app` passes the
        `work.page` suite, which asserts `querySelector('textarea')` is `null`,
        `querySelector('[data-testid="composer"]')` is `null`, and no element has
        `data-testid` ending in `-send`; it also asserts a `needs_decision` fixture renders
        exactly one action (`work-resolve-doubt`), a `merged` fixture renders `work-rework`, and
        a `running` fixture renders none.
  - [ ] `[unit]` **The gate and PR cards come from run state.** The same suite asserts
        `work-run-gate[data-status="failed"]` and `work-run-pr[data-state="open"]` for a run with
        `gate.status: 'failed'` and a `pr`, and that changing only the run's `gate.status` to
        `passed` flips the card with no other change to the fixture text.
  - [ ] `[unit]` **A pending proposal blocks the composer; a read-only session has none.** The
        `session.page` suite asserts: with `pendingProposal` non-null, `session-composer` is
        disabled, `session-composer-blocked` is present, `session-proposal` shows the branch, the
        sha and one row per `paths` entry, and `session-merge` posts
        `/v1/sessions/sess_01JABCDEFG/merge` once; with `target: 'repo'`,
        `session-proposal` and `session-merge` are absent and the composer is enabled.
  - [ ] `[unit]` **A replayed frame never duplicates a message.** The `session-stream` suite
        asserts that `applySessionEvent` fed the same `session.delta` frame twice leaves
        `messages.length` unchanged, and that `mergeMessages` of the same page twice is
        idempotent (`(messageId, seq)` identity).
  - [ ] `[unit]` **The schedule tab ships no unexposed field.** The `repo-schedule.page` suite
        asserts from a legacy `Schedule` fixture that the rendered text contains the mode, the
        window and the next fire, and that the rendered row has **no** `data-testid` containing
        `selection`, `refs` or `attempts`; and that `run-next` maps `409 nothing_pending` to
        `repo-schedule-notice[data-reason="nothing_pending"]` with no navigation.
  - [ ] `[unit]` **The new-session sheet offers three targets and one read-only entry, and
        creates once.** The `new-session.sheet` suite asserts zero requests on render, four
        target buttons, one `POST /v1/sessions` with `{ repoId, target }` per `Create` tap, **no
        `workId` key in any request body**, and `new-session-error[data-code]` on a `409`.
  - [ ] `[unit]` **`docs/app.md` §4 and the router agree, both directions.** The
        `app.routes.spec.ts` suite has one test that reads `docs/app.md`, takes the table rows
        between `## 4. Screens` and `## 5. State and data`, collects every path written as a
        leading-code-span cell, and asserts: every collected path except the panel-only rows is
        a router path, and every router path is either in the table or in the §4 **legacy**
        bullet list (`/jobs`, `/jobs/:id`, `/runs`, `/runs/:id`, `/approvals`).
  - [ ] `[unit]` **The README map is complete.** `npm test -w @codebox/app` passes
        `readme.spec.ts`: every file under `src/app` appears in `apps/app/README.md` as
        `` `src/app/…` `` and every such entry exists.
  - [ ] `[unit]` **Nothing outside the exclusive paths was touched.** `git diff --name-only
        main...task-75` lists only paths from the exclusive list, and
        `git diff --name-only main...task-75 -- package.json package-lock.json
        apps/app/angular.json apps/app/src/main.ts packages/contracts apps/daemon` is empty.
  - [ ] `[live]` **320 px with a long `Task-NN` title.** On a signed-in build against a
        repository whose backlog carries
        `Task-77 — Workers view: the repository's Workers tab`, open `/repos/:id` in a browser at
        320 × 568 and read
        `document.scrollingElement.scrollWidth` (must be ≤ 320), the `backlog-row-title`
        element's `scrollWidth` (must be ≤ its `clientWidth`), and that `backlog-row-ref`,
        `backlog-row-title` and `backlog-row-state` are each fully visible without clipping.
        **Measurement:** a human or a browser-capable session; GitHub Actions has no browser, so
        QA reports this as `[?]` / `agent-review` and never as a pass.

## 📣 Coordination

- **For the Architect:** this task consumes the shapes Task-70/Task-72 merged and introduces no
  contract. Two documented gaps it must not paper over, both recorded here so the Orchestrator
  can file them as `agent-review` issues:
  1. **`RepoSchedule.selection` / `refs` / `maxAttempts` have no wire route.** `GET /v1/schedules`
     answers the legacy `Schedule` (`packages/contracts/src/resources.ts` `scheduleSchema`,
     parsed by `apps/daemon/src/schedules/routes.ts:104`). `docs/app.md` §4 asks the schedule tab
     for `selection` and caps; the tab renders the caps it has and names the gap in its report.
     A projection that answers `repoScheduleSchema` is a contracts + daemon task.
  2. **There is no design projection.** `/repos/:id/design` renders an `unavailable` block, not a
     preview. Task-79 (`features/sessions/**`, `packages/design/**`, `design/README.md`) owns it
     and will need a route or a design session read; if it needs a route, that is a Task-70
     amendment first.
- **For the next batch:**
  - Task-77 replaces `RepoWorksPage` and receives `/repos/:id/works` already routed. Its own
    design map calls that screen `/repos/:id/workers` (`design/README.md` §1): renaming the path
    is Task-77's edit to `app.routes.ts`, and it must keep `REPO_TABS` in step.
  - Task-78 extends `features/backlog/**` — the page, the store and the API named above are its
    base, and `backlog-row` already carries `data-ref` and `data-state`.
  - Task-79 replaces `RepoDesignPage` and owns `/sessions/:id`'s proposal panel's design
    variant; `session-stream.ts` and `session.store.ts` are its base.
  - Task-76 deletes the legacy `/jobs`, `/jobs/:id`, `/runs`, `/runs/:id`, `/approvals` routes
    and `features/approvals/**`; this task deliberately leaves them routed and listed as legacy
    in `docs/app.md` §4.
- **Empty dev slots (this batch is 2 of 4 by construction):** Task-76 depends on Task-75, which is
  in this batch; Tasks 77–80 each depend on Task-75 and/or would collide on
  `apps/app/src/app/features/works/**`; Task-30 depends on Task-29 and Task-31 on
  Task-26/28/30, whose roots (Task-02, Task-26, Task-29) are `[!]` on issue #11. No task was
  added.
- **Hot files:** **Task-75 holds `apps/app/src/app/app.routes.ts`.** **Task-74 holds
  `package-lock.json`** and `vitest.config.ts`. No task holds `package.json`,
  `tsconfig.base.json`, `apps/app/angular.json`, `apps/app/src/main.ts`,
  `apps/daemon/src/main.ts`, `packages/contracts/src/index.ts`, `opencode.json`, `TODO.md`,
  `CHANGELOG.md` or `docs/decisions.md`. Verified in the tree at `b93e224`.
- **Docs by section:** Task-75 holds `docs/app.md` §4 and §8 only. It may not touch §5, §9 or
  §12, which still describe the retired permission cards (Task-68's deviation, not this task's).
- **Two TODO/tree tensions this spec resolves, for the record:** the design frame offers four
  chat targets (*Backlog, Design, Schedule, Rework*) while the contract only allows a `work`
  session with a `workId`, so the repository screen offers three plus the read-only `repo` target
  and Rework lives on `/works/:id`; and `design/README.md` §1 draws the repository as two tabs
  (`Backlog`, `Workers`) while `docs/app.md` §4 and TODO-75 require four. This task follows
  `docs/app.md` §4 — the document it owns — and leaves `design/README.md` to Task-79, which must
  add the missing §1 rows in its own task.

## ⛔ Out of scope

- No change to `packages/contracts`, `apps/daemon`, `docs/api.md`, `docs/decisions.md`,
  `design/README.md`, `TODO.md` or `CHANGELOG.md`.
- No new dependency, no `package.json` edit, no `angular.json` edit, no PWA/theme change.
- No Playwright config, no e2e test, no screenshot or visual-regression tooling.
- No composer, chat box or free-form prompt anywhere on a work screen; no promote action, scope
  chip, handoff divider or filter chip anywhere in the app.
- No refactor of a feature folder this task does not replace: `features/jobs/**`,
  `features/runs-list/**`, `features/run-detail/**`, `features/schedules/**`,
  `features/settings/**`, `features/credentials/**`, `features/about/**`,
  `features/approvals/**` and `shared/offline-banner.*` stay exactly as they are (three of them
  still call retired chat endpoints until Task-76 removes those routes).
  `features/dashboard/**` changes by exactly the two `routerLink` targets and their two spec
  assertions listed above — its "Needs you" arithmetic, its chat-session read and its copy are
  Task-76's.
- No second design tab: `/repos/:id/design` is the unavailable block plus the design target of
  the new-session sheet, nothing more.
- No client-side sort, filter or pagination beyond what the contract returns; the server is the
  state (`docs/app.md` §5).

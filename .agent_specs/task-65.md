# Spec: Task-65 — Dashboard and first run

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (Angular 22 + Ionic 9, standalone components, signals, zoneless).
- **Role:** Dev.
- **Objective:** `/dashboard` stops being health cards plus a run list and becomes the five
  blocks of `docs/app.md` §4 — **Needs you**, **Working**, **Ready for review**, **Today's
  spend**, **Health** — each rendered from a real endpoint, with `Needs you` a computed sum over
  explicit sources; and a box with no repositories renders the start card (frame 12, "First
  run") instead of a dashboard of zeros. After this task every block has a zero state driven by
  a zero fixture, the start card replaces the blocks when `GET /v1/repos?limit=1` is empty, and
  `Needs you` is a pure function over the chat page with a pinned count.
- **Environment:** worktree `../wt-cb-65`, branch `task-65`, base `main` @ `459e75c`.
- **Dependencies (already merged):** Task-52 (`reviewedAt`, the chat list fields, chat frames),
  Task-53 (schedules/routines endpoints), Task-51 (`ChatSession`, `Run`, `Telemetry`, `Health`),
  Task-55 (`app.routes.ts` with `/dashboard`).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/app/features/dashboard/dashboard.page.ts` (modify)
- `apps/app/src/app/features/dashboard/dashboard.page.spec.ts` (modify)
- `apps/app/src/app/features/dashboard/dashboard.store.ts` (modify)
- `apps/app/src/app/features/dashboard/dashboard.store.spec.ts` (modify)
- `apps/app/src/app/features/dashboard/dashboard.api.ts` (modify)
- `apps/app/src/app/features/dashboard/dashboard.api.spec.ts` (**new** — the file does not exist
  today; the reads it adds are new and need their own URL/parse tests)
- `apps/app/src/app/features/dashboard/i18n.ts` (modify)
- `apps/app/README.md` — **shared file, section claim only.** This task may edit **only** the
  lines whose backticked path starts with `src/app/features/dashboard/`. It may **not** touch
  the `chat.*`, `settings.*`, `about.*`, `shared.*`, `core.*`, `shell.*` or `jobs.*` lines, and
  it must not reorder or reformat the rest of the file. Add exactly one line per new file in
  the existing style: ``- `path` — one sentence``.

**Forbidden to every task in this batch (do not open for writing, at all):**
`apps/app/src/app/app.routes.ts`, `apps/app/src/main.ts`, `apps/app/angular.json`,
`package.json`, `package-lock.json`, `tsconfig.base.json`, `packages/**`, `apps/daemon/**`,
`docs/**`, `TODO.md`, `CHANGELOG.md`, `docs/decisions.md`, `NOTICE`.

### Inputs (read-only)

Files this task may read, and only these beyond `AGENTS.md` and the exclusive paths above:

- `docs/app.md` §4 (`/dashboard`), §5 (state and data), §7 (live events), §9 (density, 320 px), §12 (testing)
- `design/README.md` §1 (Dashboard frame 05, light L5, desktop D2 · D4) and §2 (First run
  frame 12 / L18 — `/dashboard`, no repositories)
- `docs/api.md` §5.1 (health, version, telemetry), §5.2 (repos), §5.4 (runs and their query),
  §5.6 (chat sessions)
- `packages/contracts/src/resources.ts` — `healthSchema`, `telemetrySchema`, `repoSchema`,
  `runSchema`, `chatSessionSchema`
- `packages/contracts/src/primitives.ts` — `RUN_STATES`, `isTerminalRunState`
- `apps/app/src/app/core/api/api-client.ts` — `health()`; `core/events/sse.service.ts`;
  `core/i18n/i18n.service.ts`
- `apps/app/src/app/features/chat/chat-list.store.ts` — **read only**, to copy the
  `isUnreviewed` convention (`status !== 'archived'`, `kind !== 'free'`,
  `reviewedAt` null/undefined, `lastMessage.role === 'assistant'`). Do not import it and do not
  edit it (`docs/app.md` §5: no store reaches into another feature's store).
- `apps/app/src/app/features/dashboard/` current files (the page, store, api and i18n)

## 🔒 Contract

The public surface other tasks and QA are written against **right now**. Exact names.

### `dashboard.api.ts` (modify; `telemetry()` stays exactly as it is)

```ts
@Injectable({ providedIn: 'root' })
export class DashboardApi {
  telemetry(range: Telemetry['range'] = '24h'): Observable<Telemetry>; // unchanged
  /** GET /v1/chat/sessions?limit=50 */
  sessions(limit = 50): Observable<Page<ChatSession>>;
  /** GET /v1/runs?limit=50 */
  runs(limit = 50): Observable<Page<Run>>;
  /** GET /v1/repos?limit=1 — the first-run probe. */
  repos(limit = 1): Observable<Page<Repo>>;
}
```

Every response goes through the contract parsers (`parsePage` + the schema), and transport
failures become `ApiError` with the same mapping the file already uses.

### `dashboard.store.ts` (modify; pure helpers exported for the specs)

```ts
import type { ChatSession, Health, Run, RunState, SseStreamEvent, Telemetry } from '@codebox/contracts';

/** The states a live run can be in; `docs/api.md` §5.4 state machine, minus the terminals. */
export const WORKING_STATES: readonly RunState[] = Object.freeze([
  'queued',
  'preparing',
  'running',
  'gating',
  'merging',
]);

/** Delivered work waiting for the operator: an open pull request. */
export const REVIEW_STATE: RunState = 'pr_open';

export interface NeedsYouCounts {
  readonly awaitingAnswer: number;
  readonly unreviewedChats: number;
  readonly total: number;
}

export function isAwaitingAnswer(session: ChatSession): boolean;
export function isUnreviewedChat(session: ChatSession): boolean;
export function countNeedsYou(sessions: readonly ChatSession[]): NeedsYouCounts;

@Injectable()
export class DashboardStore {
  readonly health = signal<Health | null>(null);
  readonly telemetry = signal<Telemetry | null>(null);
  readonly needsYou = signal<NeedsYouCounts>({ awaitingAnswer: 0, unreviewedChats: 0, total: 0 });
  readonly working = signal<readonly Run[]>([]);
  readonly ready = signal<readonly Run[]>([]);
  readonly recentRuns = signal<readonly Run[]>([]); // keep: the latest five, already shipped
  readonly fresh = signal(false); // true when `GET /v1/repos?limit=1` is empty
  readonly loading = signal(true);
  readonly stale = signal(false);
  readonly error = signal<ApiError | null>(null);

  load(): void;
  reload(): void;
  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored';
}
```

Frozen behaviour:

- `isAwaitingAnswer(session)` — `session.status !== 'archived'` and
  `session.lastMessage?.role === 'user'`. The agent owes an answer.
- `isUnreviewedChat(session)` — the chat-list rule verbatim: not archived,
  `(session.kind ?? 'repo') !== 'free'`, `reviewedAt` is `null` or `undefined`,
  `lastMessage?.role === 'assistant'`.
- `countNeedsYou` — one pass over the page: `awaitingAnswer` counts `isAwaitingAnswer`,
  `unreviewedChats` counts `isUnreviewedChat`, `total = awaitingAnswer + unreviewedChats`.
  A session can count in both; the two numbers stay separate so the screen can explain itself.
- `load()` issues five reads: `ApiClient.health()`, `dashboardApi.telemetry('24h')`,
  `dashboardApi.sessions(50)`, `dashboardApi.runs(50)`, `dashboardApi.repos(1)`.
  `recentRuns` is the first five of the runs page. `working` filters that page by
  `WORKING_STATES`; `ready` filters it by `state === REVIEW_STATE`. `fresh` is
  `reposPage.data.length === 0` **and** the repos read succeeded.
- `applyStreamEvent` applies `run.queued|run.started|run.gate|run.pr|run.merged|run.finished|run.failed|run.cancelled`:
  a frame whose `runId` is in `working` or `ready` triggers a `reload()` (returns `'applied'`),
  anything else is `'ignored'`. No local mutation of a run object.
- A failed read sets `error`; a failed `reload()` with a payload already on screen sets `stale`.
  The existing behaviour and ids (`dashboard-stale`, `dashboard-retry`) are kept.

### `dashboard.page.ts` (modify; five blocks plus the start card)

`data-testid` values, frozen. **Keep** every existing hook: `page-dashboard`,
`dashboard-loading`, `dashboard-error`, `dashboard-retry`, `health-vm`, `health-db`,
`health-opencode`, `health-disk`, `health-queue`, `health-spend`, `dashboard-empty`,
`dashboard-stale`, `recent-run`.

| block | hook | attributes / content |
| --- | --- | --- |
| 1 · Needs you | `dashboard-needs-you` | `data-total`, `data-awaiting`, `data-unreviewed` from `store.needsYou()`; links `dashboard-needs-you-chat` → `/chat` |
| 2 · Working | `dashboard-working` | `data-count` = `store.working().length`; one `dashboard-working-run` per run with `data-run-id`, `data-state`, `routerLink="/runs/<id>"`; `dashboard-working-empty` when the count is 0 |
| 3 · Ready for review | `dashboard-ready` | `data-count` = `store.ready().length`; one `dashboard-ready-run` per run with `data-run-id`, `data-pr` = `run.pr?.number ?? ''`; `dashboard-ready-empty` when the count is 0 |
| 4 · Today's spend | `health-spend` (existing id) | `data-usd` = `telemetry.spendUsd`; also shows `telemetry.runs.total` |
| 5 · Health | `health-vm`, `health-queue` (existing ids) | keep their current attributes exactly |
| start card | `dashboard-start` | `data-repos="0"`; links `dashboard-start-repos` → `/repos` and `dashboard-start-chat` → `/chat` |

Frozen rules:

- When `store.fresh()` is true, **only** the start card renders: `dashboard-needs-you`,
  `dashboard-working`, `dashboard-ready`, `health-spend`, `health-vm` and `health-queue` are all
  absent from the DOM.
- When `store.fresh()` is false, the five blocks render — with zeros when the fixtures are zero.
- `Needs you` is never derived from prose, from a run count or from a guess: it reads
  `store.needsYou()` only.
- No new label text without a key in `dashboard/i18n.ts` (both locales).

### `i18n.ts` (modify; both locales, same key set)

New keys, frozen:

```
dashboard.section.needs-you      dashboard.needs-you.awaiting      dashboard.needs-you.unreviewed
dashboard.needs-you.unit         dashboard.needs-you.open-chat
dashboard.section.working        dashboard.working.empty
dashboard.section.ready          dashboard.ready.empty             dashboard.ready.pr
dashboard.start.title            dashboard.start.body              dashboard.start.repos
dashboard.start.chat
```

Keep every existing key (`dashboard.section.health`, `section.queue`, `section.spend`,
`section.recent`, `dashboard.state.*`, `dashboard.empty`, `dashboard.stale`,
`dashboard.action.retry`, `common.loading`, `common.error`).

### Data

No new wire key, no new event, no new route. The blocks read these existing shapes:
`Health`, `Telemetry`, `Page<Run>`, `Page<ChatSession>`, `Page<Repo>`.

## 🧩 Configuration

None — no new `CB_*` key, no new dependency, no `angular.json` change.

## 🧪 Test and Validation Plan (for QA)

- **Method** (run from the root of the worktree `../wt-cb-65`):
  - `npm ci --prefer-offline --no-audit --no-fund` — a fresh worktree has no `node_modules`.
  - `npm run lint` — must pass.
  - `npm test` — the root gate: `test:guard`, the full app unit suite through
    `npm test -w @codebox/app` (`ng test --watch=false`, Vitest + jsdom, headless), then the
    workspace Vitest projects. Every test below runs here.
  - `npm run build` — `tsc -b` plus the app production build.
  - `git diff --name-only main...task-65` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean (`npm run lint`, `npm run build`).
  - [ ] `[unit]` `dashboard.store.spec.ts` — *Needs you sums its sources*: for a fixture page of
        four sessions —
        (a) `repo`, `reviewedAt: null`, `lastMessage.role: 'assistant'`;
        (b) `repo`, `reviewedAt: null`, `lastMessage.role: 'user'`;
        (c) `free`, `reviewedAt: null`, `lastMessage.role: 'assistant'`;
        (d) `repo`, `reviewedAt: '2026-10-27T08:30:00Z'`, `lastMessage.role: 'assistant'` —
        `countNeedsYou` returns `{ awaitingAnswer: 1, unreviewedChats: 1, total: 2 }`.
        An archived session with an assistant last message adds nothing.
  - [ ] `[unit]` `dashboard.store.spec.ts` — *zero fixture*: every read resolved with an empty
        page / zeroed telemetry yields `needsYou.total === 0`, `working.length === 0`,
        `ready.length === 0`, `health !== null`, `telemetry?.spendUsd === 0`.
  - [ ] `[unit]` `dashboard.page.spec.ts` — *every block renders from a zero fixture*: mount with
        a health fixture, zeroed telemetry, empty runs page and a repos page with one row; the
        five hooks exist and read `data-total="0"`, `data-count="0"` twice, `data-usd="0"`,
        `data-status="ok"`; `dashboard-start` is `null`.
  - [ ] `[unit]` `dashboard.page.spec.ts` — *the start card replaces the zeros*: the same mount
        with an **empty** repos page renders `dashboard-start` with `data-repos="0"` and **no**
        `dashboard-needs-you`, `dashboard-working`, `dashboard-ready`, `health-spend` or
        `health-vm`.
  - [ ] `[unit]` `dashboard.page.spec.ts` — *blocks render their rows*: a runs page holding one
        `running`, one `pr_open`, one `failed` and one `succeeded` run renders
        `dashboard-working[data-count="1"]` with `dashboard-working-run[data-state="running"]`,
        `dashboard-ready[data-count="1"]` with `dashboard-ready-run[data-pr="42"]`, and the
        failed/succeeded runs appear only in `recent-run`.
  - [ ] `[unit]` `dashboard.page.spec.ts` — the needs-you block reads
        `data-total="2" data-awaiting="1" data-unreviewed="1"` from the same four-session
        fixture as above.
  - [ ] `[unit]` `dashboard.api.spec.ts` — the three new URLs
        (`/v1/chat/sessions?limit=50`, `/v1/runs?limit=50`, `/v1/repos?limit=1`) and a
        malformed page mapped to `ApiError { code: 'contract' }`.
  - [ ] `[unit]` `dashboard.page.spec.ts` — the i18n parity test still passes:
        `Object.keys(STRINGS.en).sort()` equals `Object.keys(STRINGS.es).sort()`, every value is
        non-empty, and every key in the new list resolves to something other than itself.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-65` prints only paths from the list, plus the
        `apps/app/README.md` lines claimed here.
  - [ ] `[live]` A fresh box shows the start card, not a dashboard of zeros.
        **Measurement:** on a freshly provisioned box with `sqlite3 <state>/cb.sqlite 'select count(*) from repos'`
        printing `0`, pair a device and open `/dashboard`; within 3 s
        `[data-testid="dashboard-start"]` exists, `[data-testid="dashboard-needs-you"]` does not,
        and after adding one repository through `dashboard-start-repos` a pull-to-refresh shows
        `dashboard-needs-you` with `data-total="0"`. This needs a live daemon and a browser: QA
        reports it **not run** in this environment and the Orchestrator files one `agent-review`
        issue.

## 📣 Coordination

- **Recorded deviation — two of the four `Needs you` sources are dropped.** The task brief lists
  four sources. The contracts carry fields for two of them and not for the others:
  - *Chats awaiting an answer* — kept (`lastMessage.role === 'user'`).
  - *Chats unreviewed* — kept (`reviewedAt` + `lastMessage`, the chat-list rule).
  - *Runs that failed since the last review* — **dropped**: `Run` has `state` and `finishedAt`
    but no review marker, and `GET /v1/runs` filters only by `repoId`, `jobId` and `state`, so
    "since the last review" cannot be computed without inventing a field. A run review stamp is
    an additive contracts change owned later.
  - *Schedules whose last fire is unreviewed* — **dropped**: `Schedule` has `lastFiredAt` but no
    per-fire review marker, and a fire is a chat message, not a reviewed entity.
  `Needs you` therefore sums two sources. Do not invent the missing fields and do not read them
  out of prose.
- **"Ready for review" is the `pr_open` stand-in** for `docs/app.md` §4's "what finished
  unreviewed": a run sitting at an open pull request is delivered and waiting on the operator.
  A `succeeded` run has no review marker either, so it is not counted.
- **`isUnreviewedChat` duplicates `features/chat/chat-list.store.ts::isUnreviewed` on purpose**
  (`docs/app.md` §5 forbids a store reaching into another feature's store). If that rule
  changes, both copies change in the same batch — record it in the plan.
- For the next batch: the dashboard now reads five endpoints through `dashboard.api.ts`; a
  sixth block should not add a sixth independent read without a budget note.
- No hot file is claimed by this task. No `packages/contracts`, `docs/api.md` or
  `docs/providers.md` change is owed.

## ⛔ Out of scope

- No change to `app.routes.ts`, another feature's files, `src/assets/i18n/*.json` or any file
  outside the exclusive paths.
- No persisted offline snapshot (`docs/app.md` §5 mentions one; it is not in this task).
- No telemetry range selector, no chart, no sparkline, no polling timer, no new dependency.
- No contract field for run review or schedule-fire review (that is a later contracts task).
- No change to `TODO.md`, `CHANGELOG.md` or `docs/decisions.md`.

## ✅ Finish

The dev finishes with the gate green — `npm ci && npm run lint && npm test && npm run build`
from the repository root — then creates an **empty** commit whose subject is exactly
`dev: done task-65` and pushes it to `origin/task-65`. This spec file at
`.agent_specs/task-65.md` is committed by the Orchestrator before the dev starts; the dev must
not create, edit or commit anything under `.agent_specs/`, must not tick `TODO.md` and must not
write `CHANGELOG.md`.

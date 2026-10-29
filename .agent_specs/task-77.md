# Spec: Task-77 — Workers view: the repository's `Workers` tab

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (Angular/Ionic UI plus one pure projection module).
- **Role:** Dev.
- **Objective:** after this task the repository's second tab is a **factory**, not a list. At
  `/repos/:id/workers` the screen draws four role rooms — `ORQ`, `ARC`, `DEV`, `QA` — with one
  face and exactly one task chip per work, the road in on top and the belt out at the bottom,
  and it renders the four states `queued`, `running`, `needs you` and `asleep` from the works
  the daemon already returns. The flat `Works` tab (`/repos/:id/works`, `repo-works.page.ts`)
  is deleted; `/works/:id` **survives unchanged** as the agent's log that a face opens. No
  contract package is touched: `Work` and `WorkState` already carry every field the board
  draws.
- **Environment:** worktree `../wt-cb-77`, branch `task-77`, base `main` (`0a17286`).
- **Dependencies:** Task-75 (merged). It produced the files this task edits or replaces:
  `apps/app/src/app/app.routes.ts` (the 15-row router), `apps/app/src/app/app.routes.spec.ts`
  (the frozen path table and the `docs/app.md` §4 agreement test),
  `apps/app/src/app/features/works/repo-works.page.ts` and its spec (the flat page deleted
  here), `apps/app/src/app/features/works/works.api.ts` (`WorksApi.list`, **read-only here**),
  `apps/app/src/app/features/repos/repo-tabs.ts` (`REPO_TABS`),
  `features/repos/repo-chrome.i18n.ts`, `docs/app.md` §4 and `apps/app/README.md`. Nothing else
  is in flight: Task-79 runs beside this task and shares only `apps/app/README.md`, by block.

### Exclusive paths (single writer)

Create or modify **only** these paths. Nothing outside this list — not one line, not a
formatting pass. If a change seems to require another file, stop and report it; do not
improvise.

- `apps/app/src/app/features/works/workers.model.ts` (new)
- `apps/app/src/app/features/works/workers.model.spec.ts` (new)
- `apps/app/src/app/features/works/repo-workers.page.ts` (new)
- `apps/app/src/app/features/works/repo-workers.page.spec.ts` (new)
- `apps/app/src/app/features/works/repo-works.page.ts` (delete)
- `apps/app/src/app/features/works/repo-works.page.spec.ts` (delete)
- `apps/app/src/app/features/works/i18n.ts`
- `apps/app/src/app/app.routes.ts` (hot file; you are its only holder in this batch)
- `apps/app/src/app/app.routes.spec.ts`
- `apps/app/src/app/features/repos/repo-tabs.ts`
- `apps/app/src/app/features/repos/repo-tabs.spec.ts`
- `apps/app/src/app/features/repos/repo-chrome.i18n.ts` (only the two `repoTabs.*` lines)
- `docs/app.md` (section: §4 Screens — and nothing else in the file)
- `apps/app/README.md` (line block: the `src/app/features/works/**` lines — and nothing else)

### Inputs (read-only)

Read these; do not modify them:

- `AGENTS.md`
- `docs/app.md` §4 (the row you rewrite), §8 (Work and session), §9 (design direction)
- `design/README.md` (the workers frames, the two chips, the "no per-agent button" rule)
- `packages/contracts/src/works.ts` (`workSchema`, `workDetailSchema`)
- `packages/contracts/src/primitives.ts` (`WORK_STATES`, `WorkState`)
- `apps/app/src/app/features/works/{works.api.ts, work.page.ts, work.store.ts, work.page.spec.ts, works.api.spec.ts}`
- `apps/app/src/app/features/repos/{repo-tabs.ts, repo-tabs.spec.ts, repo-chrome.i18n.ts, repo-backlog.page.ts}`
- `apps/app/src/app/features/backlog/{repo-backlog.page.ts, backlog.store.ts}` (they link to
  `/works/:id`; you must keep that route alive, not touch these files)
- `apps/app/src/app/app.routes.spec.ts`, `apps/app/src/app/readme.spec.ts`
- `apps/app/src/app/shared/offline-banner.ts` (component style reference)

## 🔒 Contract

### 1. `apps/app/src/app/features/works/workers.model.ts` — pure, no Angular, no I/O

The one projection from a `Work` to a place on the factory floor. It exports exactly:

```ts
import type { Work, WorkState } from '@codebox/contracts';

export type WorkerRoom = 'ORQ' | 'ARC' | 'DEV' | 'QA';

/** The four rooms, in drawing order. `ARC` is drawn and stays empty (see Coordination). */
export const WORKER_ROOMS: readonly WorkerRoom[] = Object.freeze(['ORQ', 'ARC', 'DEV', 'QA']);

export type WorkerState = 'queued' | 'running' | 'needs-you' | 'asleep';

/** The design's four states, in drawing order. `needs-you` is the attribute spelling of
 *  `needs you` so it survives in `data-state`. */
export const WORKER_STATES: readonly WorkerState[] = Object.freeze([
  'queued',
  'running',
  'needs-you',
  'asleep',
]);

/** Where a work sits. The road in and the belt out are outside the four rooms. */
export type WorkerLane = 'road-in' | WorkerRoom | 'belt-out';

export interface WorkerCard {
  readonly workId: string; // work.id
  readonly ref: string; // work.backlogRef, the task chip
  readonly title: string; // work.title
  readonly state: WorkerState;
  readonly lane: WorkerLane;
}

export interface WorkerRoomView {
  readonly room: WorkerRoom;
  readonly cards: readonly WorkerCard[];
}

export interface WorkersBoard {
  readonly roadIn: readonly WorkerCard[];
  readonly rooms: readonly WorkerRoomView[]; // always 4, always in WORKER_ROOMS order
  readonly beltOut: readonly WorkerCard[];
}

export function laneOf(state: WorkState): WorkerLane;
export function workerStateOf(state: WorkState): WorkerState;
export function projectWorkers(works: readonly Work[]): WorkersBoard;
```

Behaviour, frozen. `laneOf` and `workerStateOf` are total over the seven `WorkState` values:

| `work.state`     | `laneOf`    | `workerStateOf` |
| ---------------- | ----------- | --------------- |
| `queued`         | `road-in`   | `queued`        |
| `running`        | `DEV`       | `running`       |
| `review`         | `QA`        | `running`       |
| `needs_decision` | `ORQ`       | `needs-you`     |
| `merged`         | `belt-out`  | `asleep`        |
| `failed`         | `belt-out`  | `asleep`        |
| `abandoned`      | `belt-out`  | `asleep`        |

`ARC` is never returned by `laneOf`. `projectWorkers` keeps the **input order** inside every
lane — the daemon already answers newest activity first and the app never re-sorts. It returns
exactly four `rooms` in `WORKER_ROOMS` order; `ARC`'s `cards` is always `[]`. A `Work` the table
does not cover is impossible (`WorkState` is closed) and there is no default branch.

### 2. `apps/app/src/app/features/works/repo-workers.page.ts` — the screen

- `@Component({ selector: 'app-repo-workers-page', standalone: true, changeDetection: OnPush })`,
  importing `RouterLink` from `@angular/router`, `IonContent, IonHeader, IonTitle, IonToolbar`
  from `@ionic/angular`, and `RepoTabs` from `../repos/repo-tabs` — the same set the deleted page
  used.
- `export class RepoWorkersPage` with:
  - `readonly id = input.required<string>();`
  - `readonly works = signal<readonly Work[]>([]);`
  - `readonly loading = signal(true);`
  - `readonly error = signal<ApiError | null>(null);`
  - `readonly board = computed<WorkersBoard>(() => projectWorkers(this.works()));`
  - `reload(): void`
  - `readonly t: (key: string) => string` through `I18nService` + `translate` from `./i18n`
  - `stateLabel(state: WorkerState): string` → `translate(locale, 'workers.state.' + state)`
  - `roomLabel(room: WorkerRoom): string` → `translate(locale, 'workers.room.' + room)`
- Data: `inject(WorksApi).list(this.id())`, loaded from an `effect` on `id()` with
  `untracked`, exactly as the deleted page did. No other request, no polling, no SSE.
- The page renders, in this order inside `<ion-content class="ion-padding">`:
  1. `<app-repo-tabs [repoId]="id()" />`
  2. the loading / error+retry / empty blocks, with the hooks in the table below.
  3. `<section data-testid="workers-road-in" [attr.data-count]="board().roadIn.length">` with
     its heading `t('workers.roadIn')` and `@for (card of board().roadIn; track card.workId)`
     rendering the face below with `[attr.data-room]="'road-in'"`.
  4. `@for (room of board().rooms; track room.room)` →
     `<section data-testid="worker-room" [attr.data-room]="room.room">`; each with its heading
     `roomLabel(room.room)`, `@for (card of room.cards; track card.workId)` rendering the face
     with `[attr.data-room]="room.room"`, and — when `room.cards.length === 0` —
     `<p data-testid="worker-room-empty" [attr.data-room]="room.room">` with
     `t('workers.room.empty')`.
  5. `<section data-testid="workers-belt-out" [attr.data-count]="board().beltOut.length">` with
     its heading `t('workers.beltOut')` and `@for (card of board().beltOut; track card.workId)`
     rendering the face below with `[attr.data-room]="'belt-out'"`.

Hooks, exact — QA reads these attribute names, so do not rename one:

| `data-testid`             | element / when                                                    |
| ------------------------- | ----------------------------------------------------------------- |
| `page-repo-workers`       | the page root `<div>`, with `data-repo-id` = `id()`               |
| `repo-workers-loading`    | while `loading()`                                                 |
| `repo-workers-error`      | on `error()`, with `data-code` = the `ApiError.code`              |
| `repo-workers-retry`      | `<button type="button">` inside the error block, calls `reload()` |
| `repo-workers-empty`      | no card in any lane and no error                                  |
| `workers-road-in`         | the road-in `<section>`, with `data-count`                        |
| `worker-room`             | one per room, with `data-room` = `ORQ`/`ARC`/`DEV`/`QA`           |
| `worker-room-empty`       | inside a room with no card, with `data-room`                      |
| `worker-face`             | one per card, an `<a>`, with `data-work-id`, `data-room`, `data-state` |
| `worker-chip`             | inside a face, the `backlogRef` in `cb-mono`                       |
| `worker-face-title`       | inside a face, the work title                                     |
| `worker-face-state`       | inside a face, `stateLabel(card.state)`                           |
| `worker-badge-needs-you`  | inside a face whose `state` is `needs-you`                        |
| `workers-belt-out`        | the belt-out `<section>`, with `data-count`                       |

- A **face** is one anchor, never a button. It is the same markup in all three places, so write
  it once in the component's template and repeat it per section (`@for (card of …; track
  card.workId)`), with the section's lane bound as `data-room` — the room id inside a room, and
  `'road-in'` / `'belt-out'` in the two lanes:

```html
<a
  data-testid="worker-face"
  [attr.data-work-id]="card.workId"
  [attr.data-room]="room"
  [attr.data-state]="card.state"
  [routerLink]="['/works', card.workId]"
  [attr.aria-label]="t('workers.open') + ' ' + card.ref"
>
  <span data-testid="worker-chip" class="cb-mono">{{ card.ref }}</span>
  <span data-testid="worker-face-title">{{ card.title }}</span>
  <span data-testid="worker-face-state">{{ stateLabel(card.state) }}</span>
  @if (card.state === 'needs-you') {
    <span data-testid="worker-badge-needs-you">{{ t('workers.badge.needsYou') }}</span>
  }
</a>
```

- The two chips of the design source (`▤` waiting to enter, `🔔` delivered) are rendered as
  the two labelled sections above, not as modal sheets: same content, one less interaction, and
  nothing in this item's acceptance depends on a sheet.
- Styling: reuse the existing custom properties (`--cb-space`, `--cb-surface`, `--cb-muted`,
  `--cb-accent`, `--cb-warn`, `--cb-danger`, `--cb-radius`, `--cb-font-mono`). `needs-you`
  uses `--cb-warn`, `asleep` uses `--cb-muted`, `running` uses `--cb-text`. No colour literal:
  `apps/daemon/src/gate/design-check.ts` fails a run whose added lines carry a hex outside the
  token values, and `apps/app/src/theme/` is the tokens' mirror.
- No `button` and no `[role="button"]` on the factory floor, and no `(click)` binding on a face
  or a room. The only `(click)` in the file is the error-state retry (`repo-workers-retry`); the
  only interactive element on the floor is the face anchor.

### 3. `apps/app/src/app/features/works/i18n.ts`

Keep the file's shape (`STRINGS` keyed `en`/`es`, `translate`). **Remove** the six `works.*`
keys nothing reads any more — `works.title`, `works.loading`, `works.empty`, `works.error`,
`works.retry`, `works.runs` — in **both** locales. **Keep** `works.state.*` untouched: the
agent's log (`work.page.ts`) still reads them. **Add** these keys, in this order, in both
locales:

| key                       | en                 | es                                     |
| ------------------------- | ------------------ | -------------------------------------- |
| `workers.title`           | `Workers`          | `Trabajadores`                         |
| `workers.loading`         | `Loading the workers…` | `Cargando los trabajadores…`       |
| `workers.empty`           | `No work on the floor yet.` | `Todavía no hay trabajo en la planta.` |
| `workers.error`           | `The workers could not be loaded.` | `No se han podido cargar los trabajadores.` |
| `workers.retry`           | `Retry`            | `Reintentar`                           |
| `workers.roadIn`          | `Waiting to enter` | `Esperando entrar`                     |
| `workers.beltOut`         | `Delivered`        | `Entregado`                            |
| `workers.room.ORQ`        | `Orchestrator`     | `Orquestador`                          |
| `workers.room.ARC`        | `Architect`        | `Arquitecto`                           |
| `workers.room.DEV`        | `Builders`         | `Constructores`                        |
| `workers.room.QA`         | `Verification`     | `Verificación`                         |
| `workers.room.empty`      | `No work in this room.` | `Ningún trabajo en esta sala.`     |
| `workers.state.queued`    | `Queued`           | `En cola`                              |
| `workers.state.running`   | `Running`          | `En curso`                             |
| `workers.state.needs-you` | `Needs you`        | `Te necesita`                          |
| `workers.state.asleep`    | `Asleep`           | `Dormido`                              |
| `workers.badge.needsYou`  | `Needs you`        | `Te necesita`                          |
| `workers.open`            | `Open the agent log` | `Abrir el registro del agente`       |

### 4. `apps/app/src/app/app.routes.ts` (hot file — you are the only holder)

Replace the existing entry **in place**, keeping its array position:

```ts
{
  path: 'repos/:id/workers',
  canActivate: [authGuard],
  loadComponent: () =>
    import('./features/works/repo-workers.page').then((module) => module.RepoWorkersPage),
},
```

Every other route, `SHELL_TABS` and `TAB_COMPONENTS` stay byte-identical. `/works/:id` and its
`WorkPage` stay. `app.routes.spec.ts`: change `'repos/:id/works'` to `'repos/:id/workers'` in
`EXPECTED_PATHS` (same index) and nothing else; the 15-row table and the
`docs/app.md` §4 agreement test must pass unchanged.

### 5. `apps/app/src/app/features/repos/repo-tabs.ts` and `repo-chrome.i18n.ts`

`RepoTabId` becomes `'backlog' | 'workers' | 'schedule' | 'design'`; the second entry becomes
`{ id: 'workers', link: (repoId) => ['/repos', repoId, 'workers'], labelKey: 'repoTabs.workers' }`;
the `labelKey` union gains `'repoTabs.workers'` and loses `'repoTabs.works'`. In
`repo-chrome.i18n.ts` change **only** the two `'repoTabs.works'` lines to `'repoTabs.workers'`
with `Workers` / `Trabajadores`. Every `repoSchedule.*` and `repoDesign.*` line stays exactly as
it is — another task owns that copy. `repo-tabs.spec.ts`: the three expectations
(`['backlog','workers','schedule','design']`, the `labelKey` array, the link array) move with
it.

### 6. `docs/app.md` §4

Two edits, both inside §4 and nowhere else:

1. The repository-tabs sentence becomes ``A repository carries exactly four tabs — **Backlog ·
   Workers · Schedule · Design**`` (rest of the paragraph unchanged).
2. The row

   ```
   | `/repos/:id/works` | Repo · works | Every work of the repository, flat, newest activity first, including ad-hoc ones and orphans. |
   ```

   becomes

   ```
   | `/repos/:id/workers` | Repo · workers | The repository's factory: four role rooms (`ORQ`, `ARC`, `DEV`, `QA`), one face and one task chip per subagent, the road in and the belt out, and the four states `queued`, `running`, `needs you`, `asleep`. `needs you` is a badge on the worker whose task is blocked: the orchestrator holds the card and the decision, the builder takes another task. A face opens that agent's log (`/works/:id`); there is no per-agent button. |
   ```

   Keep the leading `| \`/path\` |` shape exactly: `app.routes.spec.ts` harvests documented
   paths with `^\| \`([^\`]+)\` \|`.

Do **not** touch §8: the work log survives unchanged, so its *Work* block stays true, and its
*Session* block belongs to Task-79.

### 7. `apps/app/README.md` — your line block only

Delete the two `src/app/features/works/repo-works.page.*` lines; add, in the same position:

```
- `src/app/features/works/repo-workers.page.ts` — the workers tab: the four role rooms, the road in, the belt out and the four states derived from `WorkState`.
- `src/app/features/works/repo-workers.page.spec.ts` — the four states from a fixture, the blocked task off the builder's floor, the face links and the absence of a per-agent button.
- `src/app/features/works/workers.model.ts` — the pure projection: `laneOf`, `workerStateOf` and `projectWorkers`.
- `src/app/features/works/workers.model.spec.ts` — every `WorkState`, the order of the four rooms and the daemon order inside a lane.
```

Update the `work.page.ts`, `work.page.spec.ts`, `works.api.ts`, `work.store.ts` and `i18n.ts`
lines only where the sentence is now false (the `i18n.ts` line must say it holds the workers,
work and run-state dictionary). **Do not touch any `features/sessions/**` line**: Task-79 owns
those in the same batch.

### Data

No new field, no new key, no new request. The board is a function of
`GET /v1/works?repoId=<id>` (`Page<Work>`, `docs/api.md` §5.6) and nothing else. The four
states map onto the daemon's seven `WorkState` values exactly as the table in §1 says; the
badge is drawn from the same `state`, never from a second field.

### Errors and empty states

- Loading: the `workers.loading` line, hooks `repo-workers-loading`.
- Error: `ApiError` from `WorksApi.list` — render `t('workers.error')`, the `code` in
  `data-code`, and a retry button `repo-workers-retry` calling `reload()` (button is fine: it
  is page chrome, not a per-agent action).
- Empty: `board()` with no card anywhere → `repo-workers-empty` with `t('workers.empty')`; the
  four rooms and the two lanes still render (so the factory keeps its shape on a fresh repo).

## 🧩 Configuration

None. This task reads no `CB_*` key, adds no dependency to any `package.json`, and touches no
lockfile. If you believe you need one, stop: the answer is no.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim, in the worktree `../wt-cb-77` (branch `task-77`, base `main`).

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — runs the workspace coverage guard, the app unit suite (`ng test`, jsdom) and
    the package/daemon Vitest projects. Do **not** run `npm run test:app` again beside it.
  - `npm run build` — `tsc -b` plus the app build.
  - `git diff --name-only main...task-77` — audit against the exclusive paths.
  - `git diff --stat main...task-77 -- apps/app/src/app/features/sessions apps/app/src/app/features/backlog apps/daemon packages` — must be empty.
- **Deliverable from the dev:** the work committed on `task-77` with an imperative subject of at
  most 72 characters, then one **empty** marker commit and a push:
  `git commit --allow-empty -m "dev: done task-77" && git push -u origin task-77`. The branch tip
  is the turnstile; QA merges the branch onto the batch base from it.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean (`npm run lint && npm run build`).
  - [ ] `[unit]` The declared tests exist and pass inside the one gate: `npm test`.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched: the `git diff --name-only`
        list is a subset of the 14 paths above, and the two `repo-works.page.*` paths appear
        as deletions.
  - [ ] `[unit]` **The four states render from a fixture.** `npm test` runs the app suite,
        whose `repo-workers.page.spec.ts` mounts the page with five works —
        `queued`, `running`, `review`, `needs_decision`, `merged` — flushes the
        `GET /v1/works?repoId=<id>` request, and asserts exactly one
        `[data-testid="worker-face"][data-state="queued"]`, one `[data-state="running"]` (from
        `running`), one `[data-state="needs-you"]` (from `needs_decision`) and one
        `[data-state="asleep"]` (from `merged`), and that
        `[data-testid="worker-room"][data-room="QA"]` holds the `review` work.
  - [ ] `[unit]` **A blocked task shows the dev on a different task.** In the same fixture
        (the `needs_decision` work `Task-77` and the `running` work `Task-78`), assert the
        `ORQ` room contains exactly one face with `data-work-id` = the blocked work's id and
        contains `[data-testid="worker-badge-needs-you"]`, and that
        `[data-testid="worker-room"][data-room="DEV"]` contains exactly one face, whose
        `data-work-id` is the running work's id, and **no** face whose id is the blocked one.
        `workers.model.spec.ts` pins the same rule with `projectWorkers` alone.
  - [ ] `[unit]` **No per-agent button exists in the tree.** `repo-workers.page.spec.ts`
        asserts `element.querySelectorAll('button, [role="button"]').length === 0` on the
        success and the empty mounts, and that every `[data-testid="worker-face"]` is an `<a>`
        with an `href`; `grep -n '(click)' apps/app/src/app/features/works/repo-workers.page.ts`
        prints exactly one line and that line contains `repo-workers-retry`.
  - [ ] `[unit]` **The router and the docs agree.** `npm test` passes `app.routes.spec.ts`,
        whose only change is the renamed path, including its
        `agrees with docs/app.md §4 in both directions` case, and
        `grep -rc 'repos/:id/works' apps/app/src | grep -v ':0$'` prints nothing.
  - [ ] `[unit]` **The tab strip has no dead link.** `repo-tabs.spec.ts` asserts
        `REPO_TABS.map((tab) => tab.link(REPO_ID))[1]` is `['/repos', REPO_ID, 'workers']` and
        every rendered `href` matches its route; `repo-chrome.i18n.ts` keeps EN and ES key
        sets equal (the spec asserts it).
  - [ ] `[unit]` **The README file map holds.** `npm test` passes `readme.spec.ts`: every file
        under `src/app` is listed and every listed path exists.
  - [ ] `[live]` **Tapping a face opens the agent's log.** Measurement, on the box, after the
        merge: open `/repos/<id>/workers`, tap the face of a running work, and assert the
        browser lands on `/works/<workId>` with `data-testid="page-work"` and the same
        `data-work-id`. **This runner has no browser and no display.** QA must report this
        criterion as **not-run** — never as passing — and open one issue:
        `node scripts/agent/issue.mjs --label agent-review --title "Task-77 [live]: a face opens the agent log" --body "<what was not measured, on which device, and the assertion above>"`.
  - [ ] `[live]` **320 px with four workers in `DEV`.** Measurement: the same screen at 320 ×
        568 with four `running` works, asserting no horizontal scroll
        (`document.scrollingElement.scrollWidth <= window.innerWidth`) and every face chip
        legible without truncation. **Not measurable on this runner**: report **not-run** and
        append the measurement to the same `agent-review` issue (or open a second one with the
        title `Task-77 [live]: 320 px with four builders`).

## 📣 Coordination

- **For the Architect:** the item's `packages/contracts/src/**` path is released — the board
  draws only `Work.state`, `Work.backlogRef` and `Work.title`, all present today. The gap is
  the room attribution: `workSchema` carries no phase and no agent role (`origin` is
  `manual | backlog | schedule`), so nothing can be attributed to `ARC`. It is drawn and stated
  empty (`worker-room-empty` with `data-room="ARC"`) rather than invented; a later contract task
  that adds a work phase would fill it by changing `laneOf` only.
- **For Task-79 (same batch):** this task owns `apps/app/README.md`'s `features/works/**` lines
  and nothing else in that file; Task-79 owns the `features/sessions/**` lines. `docs/app.md` is
  split the same way: §4 here, §8's *Session* block there. `/works/:id`, `work.page.ts`,
  `work.store.ts` and `works.api.ts` are untouched and remain the agent's log.
- **For Task-80 (after this task):** motion lands on the hooks frozen here — `worker-face`,
  `data-room`, `data-state`, `workers-road-in`, `workers-belt-out`. `workers.model.ts` stays the
  single projection; animation must not reorder a lane or add a control. The design source's
  rule stands: two chips of chrome, no per-agent button.
- **For a later task:** the design source draws the two chips (`▤`, `🔔`) as modal sheets and
  opens the decision session straight from the `needs you` card. Here they are two inline
  sections and the card opens the work log, which carries the one allowed action (*Resolve
  doubt*). Both are recorded so nobody reads the difference as a bug.

## ⛔ Out of scope

- No change to `packages/contracts/**`, `apps/daemon/**`, `packages/**` or any lockfile.
- No deletion of `/works/:id`, `work.page.ts` or `work.store.ts`, and no edit to
  `features/backlog/**` (its `/works/:id` links must keep resolving).
- No edit to `features/repos/repo-design.page.ts`, `repo-schedule.*`, `features/sessions/**`,
  `features/dashboard/**`.
- No new npm dependency, no new route, no SSE subscription, no polling.
- No motion: Task-80 owns it. No per-agent button, ever.
- No change to `docs/decisions.md`, `CHANGELOG.md` or any TODO box: the Orchestrator owns the
  tick at merge time.
- No refactor of a file this task did not have to touch, and no formatting sweep.

# Spec: Task-59 — Context sheet and compact

> The spec is your entire world. Anything not written here does not exist.

## 🎯 Scope

- **Task type:** app (`@codebox/app`).
- **Role:** Dev.
- **Objective:** ship the chat **context sheet** as a standalone, unit-tested Ionic
  component plus its store: a usage bar with the three documented states, the chat's cost and
  the day's cost, the environment rows, and the two actions — `Compact context`
  (`POST /v1/chat/sessions/{id}/compact`) and `New chat in this repo`. After this task the
  sheet exists, is exported, is reachable by a host screen, and its thresholds, its single
  POST per tap and its post-compact divider are pinned by tests.
- **Environment:** worktree `../wt-cb-59`, branch `task-59`, base `main` @ `e447dfe`.
- **Dependencies (already merged, do not re-implement):**
  - Task-52 — `POST /v1/chat/sessions/{id}/compact` and the chat fields `usage`,
    `contextTokens`, `contextEpoch` on `chatSessionSchema`.
  - Task-57 — the chat thread. `features/chat/chat.page.ts` is **read-only** for you: this
    batch gives the mounting of the sheet to a later task, and three batch-mates share that
    folder.

### Exclusive paths (single writer)

- `apps/app/src/app/features/chat/context-sheet.ts`
- `apps/app/src/app/features/chat/context-sheet.store.ts`
- `apps/app/src/app/features/chat/context-sheet.api.ts`
- `apps/app/src/app/features/chat/context-sheet.i18n.ts`
- `apps/app/src/app/features/chat/context-sheet.spec.ts`
- `apps/app/src/app/features/chat/context-sheet.store.spec.ts`
- `apps/app/README.md` — **section only:** insert one line per new file, next to the other
  `features/chat/` lines, in the existing alphabetical order. Do not reflow, reorder or edit
  any other line; `apps/app/src/app/readme.spec.ts` fails otherwise and three batch-mates
  write other sections of this file.

The spec file `.agent_specs/task-59.md` is committed on your branch by the Orchestrator. It is
the only file outside your paths and you never modify it.

### Inputs (read-only)

- `docs/app.md` §4 (the context sheet row), §8 (chat), §9 (design, tokens, 320 px).
- `design/README.md` §2 — frame `03c` (Context sheet), light `L11`.
- `packages/contracts/src/resources.ts` — `chatSessionSchema`, `costSchema`,
  `telemetrySchema`, `repoSchema`.
- `apps/app/src/app/features/chat/chat.api.ts` — the existing chat calls and the
  `ApiError` handling pattern (you add only your own module).
- `apps/app/src/app/features/settings/notifications.page.ts` and
  `notifications.i18n.ts` — the panel pattern this task follows.
- `apps/app/src/app/core/i18n/i18n.service.ts`.
- `apps/app/src/app/features/chat/chat.page.ts` — **read only**, to know the host.

## 🔒 Contract

Exact exported names. Another task will mount this component after the batch, so the names
are a promise.

```ts
// context-sheet.ts
export type ContextState = 'ok' | 'warn' | 'high' | 'full';

/** 200 000 tokens: the window every state is expressed against. */
export const CONTEXT_WINDOW_TOKENS = 200_000;

/** ok < 75 %, warn 75–89.99 %, high 90–94.99 %, full >= 95 %. Over 100 % is still full. */
export function contextState(contextTokens: number): ContextState;

// context-sheet.api.ts
export class ContextSheetApi {
  compact(chatId: string): Observable<ChatSession>;            // POST /v1/chat/sessions/{id}/compact, 200
  createInRepo(repoId: string): Observable<ChatSession>;       // POST /v1/chat/sessions { repoId }, 201
  repos(): Observable<Page<Repo>>;                             // GET /v1/repos, for the slug row
  daySpend(): Observable<Telemetry>;                           // GET /v1/telemetry?range=24h
}

// context-sheet.store.ts
export class ContextSheetStore {
  readonly session: Signal<ChatSession | null>;
  readonly daySpendUsd: Signal<number | null>;   // null when the read failed — never a fake 0
  readonly loading: Signal<boolean>;
  readonly error: Signal<ApiError | null>;
  load(session: ChatSession): void;              // adopts the session, reads repos + day spend
  compact(): void;                               // one POST per in-flight tap
  createInRepo(): void;                          // emits `created`, no navigation from the store
}

// context-sheet.ts
@Component({ selector: 'app-chat-context-sheet' })
export class ChatContextSheet {
  readonly session = input.required<ChatSession>();
  readonly closed = output<void>();
  readonly created = output<ChatSession>();
}
```

- **No HTTP in the component.** The template reads signals and calls store actions.
- **One POST per tap.** A second tap while the request is in flight issues nothing.
- **A failed compact keeps the previous session** (no epoch bump, no divider) and renders the
  error with its `code`.
- Status codes and error envelopes come from `ApiError`; do not invent a second error type.

### Data

- Chat cost: `session.usage.usd` (absent → `0`); tokens `usage.tokensIn` / `usage.tokensOut`.
- Context used: `session.contextTokens` (absent → `0`); the bar is
  `contextTokens / CONTEXT_WINDOW_TOKENS`, clamped at 100 % for the fill only.
- Day cost: `Telemetry.spendUsd` from `/v1/telemetry?range=24h`; a failed read renders the
  "unavailable" copy in that row and leaves the rest of the sheet usable.
- Environment rows, in this order: `Repository` (the repo `slug`, or the "no repository" copy
  when `repoId` is null), `Scope` (`free`/`repo`/`schedule`), `Context epoch`
  (`data-testid="context-epoch"`), `Chat cost`, `Day cost`. There is no `model` field on a
  chat session; do not invent one.
- After a successful compact the store replaces the session with the response, so
  `contextEpoch` is the daemon's value and `contextTokens` is `0`; the sheet renders
  `<div data-testid="context-divider" [attr.data-epoch]="session.contextEpoch()">` above the
  reset numbers. The sheet never computes the new epoch itself.

### Copy

The sheet owns its dictionary in `context-sheet.i18n.ts` with `en` and `es`, same key set.
Never edit `features/chat/i18n.ts` or `src/assets/i18n/*.json`: three batch-mates share those
folders and the shared dictionaries are a hot file.

## ⚙️ Configuration

None. No new `CB_*` key, no new dependency.

## 🧪 Test and Validation Plan (for QA)

- **Method** (run from the worktree root, in this order):
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `git diff --name-only main...task-59` — audit against the exclusive paths above; the only
    extras allowed are `.agent_specs/task-59.md` and lines of `apps/app/README.md`.
- **Acceptance criteria:**
  - [ ] `[unit]` `contextState` pins `0 → ok`, `149_999 → ok`, `150_000 → warn`,
        `179_999 → warn`, `180_000 → high`, `189_999 → high`, `190_000 → full`,
        `250_000 → full`.
  - [ ] `[unit]` at `full` the composer is disabled and the `Compact context` action is
        rendered; at `warn` and `high` the composer stays usable and the bar carries
        `data-state`.
  - [ ] `[unit]` one tap on `Compact context` issues exactly one `POST
        /v1/chat/sessions/{id}/compact`; a double tap while in flight still issues one; the
        response replaces the session and the divider renders with the new epoch.
  - [ ] `[unit]` a `409 chat_archived` and a `500` each render the error code, keep the old
        epoch and leave no divider.
  - [ ] `[unit]` `New chat in this repo` issues one `POST /v1/chat/sessions` with `{ repoId }`
        for a bound chat and is absent for `repoId: null`.
  - [ ] `[unit]` rendering the sheet issues no request; only `load` reads.
  - [ ] `[unit]` EN/ES parity of the sheet dictionary.
  - [ ] `[unit]` nothing outside the exclusive paths was touched.
  - [ ] `[live]` **Not runnable here (no browser in CI).** Measurement, for the review issue:
        on the VM, a repo chat at ≥ 95 % context blocks the composer and offers the action;
        tapping it renders the divider at `contextEpoch + 1` and the daemon answers `200`;
        measured with `npx playwright test` at 320×640 against a daemon on an ephemeral port.
        Report it as **not run**, never as pass.

## 📣 Coordination

- **For the next batch:** mount `<app-chat-context-sheet [session]="…" (closed)="…"
  (created)="…" />` from the chat screen's `⋯` menu; the sheet is exported from
  `features/chat/context-sheet.ts` and needs no route. `created` returns the new
  `ChatSession`; navigation stays with the host.
- **For the Architect:** the component is not mounted in this batch because the cut gives no
  task `features/chat/chat.page.ts`; reachability is a review item, not a silent gap.

## ⛔ Out of scope

- `app.routes.ts`, `chat.page.ts`, `chat.api.ts`, `features/chat/i18n.ts`, shared dictionaries,
  `core/**`, `packages/contracts/**`.
- Marking a chat reviewed (`reviewedAt`) — that is not this task.
- A visual language of your own: reuse `--cb-*` tokens, the `cb-*` classes and the dark
  default from `docs/app.md` §9.
- No new dependency. No refactor of files you were not given.

## ✅ Handover

Commit your work, `git push -u origin task-59`, then
`git commit --allow-empty -m "dev: done task-59" && git push`. Report per `.agent_roles/dev.md`:
task id, worktree, branch tip sha, commands with exit codes, checklist, files, deviations.

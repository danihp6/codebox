# Spec: Task-57 — Chat thread

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (Angular 22 + Ionic 9, standalone components, signals, zoneless).
- **Role:** Dev.
- **Objective:** the chat detail screen becomes the real thread: a message list where a
  streamed delta is appended exactly once per `(messageId, seq)` and a replayed frame never
  duplicates a message; one tool card per tool frame; gate and PR cards rendered as **system**
  items built from a `Run` object (`run.gate`, `run.pr`, `run.state`) and never parsed out of
  message prose; a composer that stays usable while the agent works, with a stop button and a
  promote flow that first confirms the repository, base branch and prompt. After this task a
  replayed event batch leaves the thread byte-identical, a `promote` remembers which run the
  chat produced, and returning to `/chat/:id` shows that run's gate and PR as machine-built
  cards.
- **Environment:** worktree `../wt-cb-57`, branch `task-57`, base `main` @ `459e75c`.
- **Dependencies (already merged):** Task-51 (`packages/contracts` — `ChatSession`,
  `ChatMessage`, `Run`, `SseStreamEvent`), Task-52 (chat routes and the chat SSE frames),
  Task-55 (`app.routes.ts` with `/chat/:id`), Task-56 (`shared/chat-row.ts`, the chat list).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/app/features/chat/chat.page.ts` (modify)
- `apps/app/src/app/features/chat/chat.page.spec.ts` (modify)
- `apps/app/src/app/features/chat/chat.store.ts` (modify)
- `apps/app/src/app/features/chat/chat.store.spec.ts` (modify)
- `apps/app/src/app/features/chat/chat-stream.ts` (modify)
- `apps/app/src/app/features/chat/chat-stream.spec.ts` (modify)
- `apps/app/src/app/features/chat/chat-store.ts` (**new**)
- `apps/app/src/app/features/chat/chat-store.spec.ts` (**new**)
- `apps/app/src/app/features/chat/i18n.ts` (modify)
- `apps/app/src/app/features/chat/chat.api.ts` (owned; **this spec requires no change** — leave
  it byte-identical unless the Contract below is impossible without it)
- `apps/app/src/app/features/chat/chat.api.spec.ts` (owned; **this spec requires no change**)
- `apps/app/README.md` — **shared file, section claim only.** This task may edit **only** the
  lines whose backticked path is one of: `src/app/features/chat/chat.page.ts`,
  `src/app/features/chat/chat.page.spec.ts`, `src/app/features/chat/chat.api.ts`,
  `src/app/features/chat/chat.api.spec.ts`, `src/app/features/chat/chat.store.ts`,
  `src/app/features/chat/chat.store.spec.ts`, `src/app/features/chat/chat-stream.ts`,
  `src/app/features/chat/chat-stream.spec.ts`, `src/app/features/chat/chat-store.ts`,
  `src/app/features/chat/chat-store.spec.ts`, `src/app/features/chat/i18n.ts`.
  It may **not** touch the `chat-list.page.ts`, `chat-list.page.spec.ts`,
  `chat-list.store.ts`, `chat-list.store.spec.ts`, `markdown.ts`, `markdown.spec.ts`,
  `context-sheet.*`, `new-chat.*` or `schedule-propose.*` lines, and it must not reorder or
  reformat the rest of the file. Add exactly one line per new file in the existing style:
  ``- `path` — one sentence``. Updating the sentence of a modified file listed above is
  allowed; everything else is untouchable.

**Forbidden to every task in this batch (do not open for writing, at all):**
`apps/app/src/app/app.routes.ts`, `apps/app/src/main.ts`, `apps/app/angular.json`,
`package.json`, `package-lock.json`, `tsconfig.base.json`, `packages/**`, `apps/daemon/**`,
`docs/**`, `TODO.md`, `CHANGELOG.md`, `docs/decisions.md`, `NOTICE`.

### Inputs (read-only)

Files this task may read, and only these beyond `AGENTS.md` and the exclusive paths above:

- `docs/app.md` §4 (`/chat/:id`), §7 (live events), §8 (chat), §9 (copy and localisation), §12 (testing)
- `docs/api.md` §5.4 (run object), §5.6 (chat routes and the promote rules)
- `packages/contracts/src/events.ts` (`chat.*`, `run.gate`, `run.pr`, `run.merged`)
- `packages/contracts/src/resources.ts` (`Run`, `prRefSchema`, `gateResultSchema`, `ChatSession`)
- `apps/app/src/app/features/chat/markdown.ts` (reuse; do not rewrite)
- `apps/app/src/app/features/chat/chat-list.store.ts` (read the `isUnreviewed` convention only)
- `apps/app/src/app/core/api/api-client.ts` (`ApiClient.getRun`), `core/events/sse.service.ts`,
  `core/i18n/i18n.service.ts`
- `apps/app/src/app/features/jobs/routines-format.ts` (already imported by `chat.page.ts`)
- `apps/app/README.md` (read the whole file; write only the lines claimed above)

## 🔒 Contract

The public surface other tasks and QA are written against **right now**. Exact names.

### `chat-stream.ts` (pure; no I/O, no clock, no environment)

```ts
export interface ChatSystemCard {
  readonly key: string; // `gate:${runId}` or `pr:${runId}`
  readonly kind: 'gate' | 'pr';
  readonly runId: string;
  readonly status: 'passed' | 'failed' | 'skipped' | 'open' | 'merged';
  readonly detail: string; // gate: `exit ${exitCode} · ${durationMs} ms`; pr: `#${number}`
  readonly href: string | null; // pr.url for a PR card, null for a gate card
}

export interface ChatStreamState {
  readonly messages: readonly ChatStreamItem[]; // unchanged
  readonly tools: readonly ChatToolCard[]; // unchanged
  readonly permissions: readonly ChatPermissionCard[]; // unchanged
  readonly routines: readonly ChatRoutineCard[]; // unchanged
  readonly routineMessageIds: readonly string[]; // unchanged
  readonly system: readonly ChatSystemCard[]; // new, frozen
  readonly working: boolean; // unchanged
  readonly lastSeq: number; // unchanged
}

export const EMPTY_CHAT: ChatStreamState; // gains `system: Object.freeze([])`

/** Cards are built only from the Run object. Never from message text. */
export function systemCardsOf(run: Run): readonly ChatSystemCard[];

/** Replace the cards of `run.id` with `systemCardsOf(run)`; return `state` itself when equal. */
export function withRunCards(state: ChatStreamState, run: Run): ChatStreamState;
```

Builder rules, frozen:

- No `run.gate` → no gate card. No `run.pr` → no PR card. A `Run` with neither returns `[]`.
- Gate card: `status = run.gate.status`, `detail = \`exit ${run.gate.exitCode} · ${run.gate.durationMs} ms\``,
  `href = null`.
- PR card: `status = run.state === 'succeeded' ? 'merged' : 'open'`, `detail = \`#${run.pr.number}\``,
  `href = run.pr.url`.
- Order is always gate then PR; `key` is `gate:<runId>` / `pr:<runId>`.

Replay rules, frozen (already true in the tree — keep them true and pin them with tests):

- `applyChatEvent` drops a `chat.delta` whose `seq <= state.lastSeq`; the first delta of a turn
  opens the buffer item keyed `stream:<chatId>`, later deltas append to it.
- `chat.message` replaces the item keyed `msg:<id>` when present and never appends a second
  copy; an assistant `chat.message` replaces the open `stream:<chatId>` buffer instead of
  appending beside it.
- `chat.tool` upserts one card keyed `tool:<seq>` (see the deviation in Coordination: the wire
  carries no tool-call id).
- `run.gate`, `run.pr`, `run.merged`, `run.finished`, `run.failed`, `run.cancelled` are **not**
  chat events and must not be routed through `applyChatEvent`; they reach the thread through
  `ChatStore.applyRunEvent`.

### `chat-store.ts` (new file; session-scoped registry, no persistence)

```ts
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ChatRunLink {
  remember(chatId: string, runId: string): void;
  runIdFor(chatId: string): string | null;
  forget(chatId: string): void;
  clear(): void;
}
```

In-memory `Map<string, string>`. No `localStorage`, no secure store, no key in `CB_*`. A full
page reload forgets the link; that is recorded as a deviation below.

### `chat.store.ts` (modify; keeps every existing signal and adds these)

```ts
export type ChatBusy = 'send' | 'interrupt' | 'promote'; // unchanged

export interface PromoteTarget {
  readonly repoSlug: string;
  readonly baseBranch: string;
  readonly prompt: string;
}

readonly run = signal<Run | null>(null);
readonly promoting = signal<boolean>(false);
readonly promoteTarget = computed<PromoteTarget | null>(null);

load(chatId: string): void; // also: read ChatRunLink.runIdFor(chatId); when set, GET /v1/runs/:id
openPromote(): void; // promoting.set(true); lazy GET /v1/repos?limit=200 when the repo list is empty
cancelPromote(): void; // promoting.set(false)
confirmPromote(): void; // POST /v1/chat/sessions/:id/promote, ChatRunLink.remember, then navigate
applyRunEvent(event: SseStreamEvent): 'applied' | 'ignored';
```

Frozen behaviour:

- `canPromote` is `true` only when: a session is loaded, `session.repoId !== null`,
  `(session.kind ?? 'repo') === 'repo'`, `stream().working === false`, and the last stream item
  is an `assistant` message.
- `applyRunEvent` accepts only `run.gate`, `run.pr`, `run.merged`, `run.finished`, `run.failed`,
  `run.cancelled`; it ignores the frame when `run() === null` or `event.data.runId !== run().id`
  and returns `'ignored'`. It never calls `applyChatEvent`.
- `run.gate` merges `{ ...run(), gate: event.data.gate }`; `run.pr` merges `{ ...run(), pr: event.data.pr }`;
  `run.merged` merges `{ ...run(), pr: event.data.pr, state: 'succeeded' }`; `run.finished` sets
  `state: 'succeeded'`; `run.failed` sets `state: 'failed'`; `run.cancelled` sets
  `state: 'cancelled'`. After every applied frame the store calls
  `stream.update((state) => withRunCards(state, run))`.
- `confirmPromote` sends the `Idempotency-Key` header exactly as today
  (`` `promote-${chatId}-${counter}` ``), remembers the returned run id, and then navigates to
  `/runs/<run.id>` (`docs/app.md` §8).
- A failed promote leaves `promoting()` true so the confirmation stays on screen with the error.
- `promoteTarget` is `null` while the repo list is missing or `session.repoId` is not in it; it
  is `{ repoSlug: repo.slug, baseBranch: repo.defaultBranch, prompt: lastAssistantText }` otherwise.

### `chat.page.ts` (modify; adds these hooks, keeps every existing one)

`data-testid` values, frozen:

| hook | element | attributes |
| --- | --- | --- |
| `chat-system` | one `<li>` in the same `<ol class="cb-chat-messages">`, after the message items | `data-role="system"`, `data-kind="gate"\|"pr"`, `data-run-id`, `data-status` |
| `chat-system-link` | the PR `<a>` inside a PR card (absent on a gate card) | `href` = `run.pr.url` |
| `chat-promote-confirm` | the confirmation block, rendered when `store.promoting()` | — |
| `promote-repo` | `<span>` | text = repo slug |
| `promote-base` | `<span>` | text = base branch |
| `promote-prompt` | `<p>` | text = the prompt that will be sent |
| `promote-confirm` | `<button>` | disabled while `store.busy() !== null` |
| `promote-cancel` | `<button>` | — |

Unchanged hooks that must keep working: `page-chat-detail`, `chat-loading`, `chat-error`,
`chat-retry`, `chat-message-empty`, `chat-message`, `chat-code`, `chat-list-block`,
`chat-tool`, `chat-permission`, `permission-allow-once`, `permission-allow-session`,
`permission-deny`, `chat-routine-card`, `chat-routine-badge`, `chat-idle`, `composer-input`,
`composer-send`, `composer-stop`, `chat-promote`.

The existing `chat-promote` button now calls `store.openPromote()` instead of `store.promote()`.
Keep the composer editable while `store.stream().working` (no `[disabled]` on
`composer-input`), and keep `composer-stop` bound to `store.interrupt()`.

`data-status` on `page-chat-detail` keeps its current meaning (`working` / `archived` / `idle`).

### `i18n.ts` (modify; both locales, same key set)

New keys, frozen (add to both `en` and `es`, never to `src/assets/i18n/*.json`):

```
chat.system.label        chat.system.gate          chat.system.pr
chat.system.gate.passed  chat.system.gate.failed   chat.system.gate.skipped
chat.system.pr.open      chat.system.pr.merged
chat.promote.title       chat.promote.repo         chat.promote.base
chat.promote.prompt      chat.promote.confirm      chat.promote.cancel
chat.promote.loading
```

### Data

No new JSON key on the wire, no new event, no new route parameter. `ChatSystemCard` is a view
type; its fields are projections of `gateResultSchema`, `prRefSchema` and `runStateSchema`.

## 🧩 Configuration

None — no new `CB_*` key, no new environment variable, no new dependency, no `angular.json`
change.

## 🧪 Test and Validation Plan (for QA)

- **Method** (run from the root of the worktree `../wt-cb-57`):
  - `npm ci --prefer-offline --no-audit --no-fund` — a fresh worktree has no `node_modules`.
  - `npm run lint` — must pass.
  - `npm test` — the root gate: `test:guard`, then the full app unit suite through
    `npm test -w @codebox/app` (`ng test --watch=false`, Vitest + jsdom, headless), then the
    workspace Vitest projects. Every test below runs here; no browser, no daemon, no `EventSource`.
  - `npm run build` — `tsc -b` for every workspace plus the app production build.
  - `git diff --name-only main...task-57` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean (`npm run lint`, `npm run build`).
  - [ ] `[unit]` `chat-stream.spec.ts` — *replayed frame batch*: apply the same four frames
        (`chat.delta` seq 1, `chat.delta` seq 2, `chat.message` seq 3, `chat.tool` seq 3) to the
        state twice; the second pass returns the input state object unchanged, `messages` has
        exactly one assistant item with the concatenated text, `tools` has exactly one card.
        The test fails if `applyChatEvent` appends on replay.
  - [ ] `[unit]` `chat-stream.spec.ts` — *cards from run state*: `systemCardsOf` on a fixture
        `Run` with `gate: { status: 'failed', exitCode: 2, durationMs: 1400 }` and
        `pr: { number: 42, url: 'https://github.com/o/r/pull/42', mergeable: true }`,
        `state: 'pr_open'` returns exactly
        `[{ key: 'gate:<id>', kind: 'gate', status: 'failed', detail: 'exit 2 · 1400 ms', href: null },
          { key: 'pr:<id>', kind: 'pr', status: 'open', detail: '#42', href: 'https://github.com/o/r/pull/42' }]`;
        the same fixture with `state: 'succeeded'` gives `status: 'merged'`; a `Run` with
        `gate: null, pr: null` gives `[]`.
  - [ ] `[unit]` `chat-stream.spec.ts` — *idempotent merge*: `withRunCards(withRunCards(s, run), run)`
        returns the second call's input reference (`toBe`).
  - [ ] `[unit]` `chat.page.spec.ts` — *prose never draws a card*: mount with one assistant
        message whose text is `Gate passed. Pull request #99 opened.` and no run; after
        `whenStable()` there are zero `[data-testid="chat-system"]` elements.
  - [ ] `[unit]` `chat.page.spec.ts` — *run state draws both cards*: `ChatRunLink.remember(CHAT, RUN_ID)`
        before mounting, flush `GET /v1/runs/<RUN_ID>` with a fixture `Run`, and assert two
        `chat-system` items in order gate (no `chat-system-link`) then PR (`chat-system-link`
        `href` equals `run.pr.url`), with `data-role="system"` and `data-run-id` equal to the
        fixture id.
  - [ ] `[unit]` `chat.page.spec.ts` — *a live gate frame updates the card*: after the mount
        above, push a `run.gate` frame with a new `gate.status` through `SseService.event`;
        the gate card's `data-status` changes without a second `GET /v1/runs/...`.
  - [ ] `[unit]` `chat.store.spec.ts` — `confirmPromote()` POSTs
        `/v1/chat/sessions/<id>/promote` once with an `Idempotency-Key` header, stores the
        returned run id in `ChatRunLink`, and calls `Router.navigate(['/runs', id])` once.
  - [ ] `[unit]` `chat.store.spec.ts` — `canPromote()` is `false` for a session with
        `kind: 'free'`, for one with `repoId: null`, and while `stream().working`; `true` for a
        repo session whose last item is an assistant message.
  - [ ] `[unit]` `chat.page.spec.ts` — *stop calls interrupt*: click `composer-stop` while
        `stream().working` and assert exactly one `POST /v1/chat/sessions/<id>/interrupt`.
  - [ ] `[unit]` `chat.page.spec.ts` — the promote confirmation renders `promote-repo`,
        `promote-base` and `promote-prompt` from `GET /v1/repos?limit=200` plus the last
        assistant message, and `promote-cancel` closes it without a POST.
  - [ ] `[unit]` `i18n.ts` parity: `Object.keys(STRINGS.en).sort()` equals
        `Object.keys(STRINGS.es).sort()`, every value is non-empty, and every key in the
        `chat.system.*` / `chat.promote.*` list above resolves to something other than itself.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-57` prints only paths from the list, plus the
        `apps/app/README.md` lines claimed here.
  - [ ] `[live]` A streamed run ends with the PR card without a reload. **Measurement:** on the
        box, open a repo chat (`kind: 'repo'`, a repository bound) at `/chat/<id>`, tap
        `chat-promote` → `promote-confirm`, wait for the navigation to `/runs/<runId>`, then
        press browser Back to `/chat/<id>`. Within 5 s a
        `[data-testid="chat-system"][data-kind="pr"]` element exists in the thread, its
        `data-run-id` equals `<runId>`, and its `chat-system-link` `href` ends with
        `/pull/<run.pr.number>`; the chat document was never reloaded (`performance.getEntriesByType('navigation').length`
        is still `1`). This needs a browser and a live daemon: QA reports it **not run** in this
        environment and the Orchestrator files one `agent-review` issue.

## 📣 Coordination

- **Recorded deviation — no durable chat→run link.** `ChatSession` (Task-51) carries no
  `runId`, so after a full page reload the chat cannot re-derive which run it promoted. This
  task therefore renders the gate and PR cards from the in-memory `ChatRunLink` plus
  `GET /v1/runs/:id`, which survives in-app navigation (promote → run detail → back) but not a
  browser reload. Making it durable needs an additive `runId` on `ChatSession` — a contract
  change owned later, not here.
- **Recorded deviation — tool-call id.** `docs/app.md` §7 says tool events insert a card "keyed
  by tool call id"; `chatToolDataSchema` carries no tool-call id, only `seq`. The card key stays
  `tool:<seq>`. There is also no payload on the wire (the daemon redacts), so the "expandable
  redacted payload" of `docs/app.md` §8 is satisfied by the `detail` line only.
- **Recorded deviation — no rAF flush.** `docs/app.md` §8 asks for one
  `requestAnimationFrame` flush per frame and stick-to-bottom. The stream already batches
  through one signal update per frame; no scroll work is added here (unmeasurable in jsdom).
- For the next batch: `features/chat/chat-store.ts` is now the place to put a session-scoped
  chat concern; `ChatStore.run` is the single source of gate/PR card data on this screen.
- For Task-59 (context sheet): `ChatStore` keeps `session()`, `stream()` and `busy()` as they
  are; add the context sheet without rewriting these files.
- For Task-61: `isRoutineMessage` and `ChatStreamState.routineMessageIds` are unchanged.
- The hot files (`app.routes.ts`, `main.ts`, `angular.json`) and `docs/**` are untouched; no
  contract, event or config key changes, so no `docs/api.md` or `docs/providers.md` edit is owed.

## ⛔ Out of scope

- No change to `app.routes.ts`, `markdown.ts`, `chat-list.*`, `context-sheet.*`, `new-chat.*`,
  `schedule-propose.*` or any file outside the exclusive paths.
- No new dependency, no syntax highlighter, no virtual scroll, no sticky-bottom scroll
  behaviour, no persistence of the chat→run link.
- No `ChatSession` field, no daemon route, no new SSE event, no `packages/contracts` change.
- No refactor of `chat.api.ts`, `chat.api.spec.ts`, `settings.*` or `dashboard.*`.
- No change to `TODO.md`, `CHANGELOG.md` or `docs/decisions.md`.

## ✅ Finish

The dev finishes with the gate green — `npm ci && npm run lint && npm test && npm run build`
from the repository root — then creates an **empty** commit whose subject is exactly
`dev: done task-57` and pushes it to `origin/task-57`. This spec file at
`.agent_specs/task-57.md` is committed by the Orchestrator before the dev starts; the dev must
not create, edit or commit anything under `.agent_specs/`, must not tick `TODO.md` and must not
write `CHANGELOG.md`.

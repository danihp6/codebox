# Spec: Task-60 — New chat, connect a repository, converting

> The spec is your entire world. Anything not written here does not exist.

## 🎯 Scope

- **Task type:** app (`@codebox/app`).
- **Role:** Dev.
- **Objective:** ship the new-chat surface and the repository picker as standalone,
  unit-tested components plus one store: an empty state with exactly two proposals, a composer
  that is **never blocked while the proposals are shown**, a picker that renders
  `connected` / `cloning` / `unavailable` and never offers an unavailable repository, and the
  converting flow (`POST /v1/chat/sessions { repoId }`) whose progress disables the composer
  and ends by emitting the bound session so the host can render the handoff divider.
- **Environment:** worktree `../wt-cb-60`, branch `task-60`, base `main` @ `e447dfe`.
- **Dependencies (already merged):**
  - Task-52 — `POST /v1/chat/sessions` with an optional `repoId` and
    `POST /v1/chat/sessions/{id}/repo` for a free chat.
  - Task-18/19 — `core/api`, `features/repos/repos.api.ts` and the `Repo` contract.
  - Task-57 — the chat thread. `features/chat/chat.page.ts` and `features/chat/chat-list.page.ts`
    are **read-only**: the cut gives the mounting to a later task and three batch-mates share
    this folder.

### Exclusive paths (single writer)

- `apps/app/src/app/features/chat/new-chat.ts`
- `apps/app/src/app/features/chat/new-chat.store.ts`
- `apps/app/src/app/features/chat/new-chat.api.ts`
- `apps/app/src/app/features/chat/new-chat.i18n.ts`
- `apps/app/src/app/features/chat/new-chat.spec.ts`
- `apps/app/src/app/features/chat/new-chat.store.spec.ts`
- `apps/app/src/app/features/repos/repo-picker.ts`
- `apps/app/src/app/features/repos/repo-picker.spec.ts`
- `apps/app/README.md` — **section only:** one line per new file, inside the existing
  `features/chat/` and `features/repos/` blocks, in alphabetical order. Do not edit any other
  line. Three batch-mates write other sections of this file.

The spec file `.agent_specs/task-60.md` is committed on your branch by the Orchestrator. It is
the only file outside your paths and you never modify it.

### Inputs (read-only)

- `docs/app.md` §4 (`/chat/new`, `/repos/pick`, converting), §5 (state and data), §8 (chat),
  §9 (design, 320 px).
- `design/README.md` §2 — frames `03a` (New chat, empty), `09` (Connect repository), `11`
  (Converting to repo chat), light `L9`, `L15`, `L17`.
- `packages/contracts/src/resources.ts` — `repoSchema`, `chatSessionSchema`.
- `apps/app/src/app/features/chat/chat.api.ts` — `createSession` and the `ApiError` pattern.
- `apps/app/src/app/features/repos/repos.api.ts` and `repos.store.ts` — the repo reads.
- `apps/app/src/app/features/settings/notifications.page.ts` — the panel pattern.
- `apps/app/src/app/features/chat/chat-list.store.ts` — the current `startChat()` behaviour.

## 🔒 Contract

```ts
// repo-picker.ts
export type RepoPickerState = 'connected' | 'cloning' | 'unavailable';

/** `busyRepoId` is the repository a create/bind request is in flight for. */
export function pickerState(repo: Repo, busyRepoId: string | null): RepoPickerState;

@Component({ selector: 'app-repo-picker' })
export class RepoPicker {
  readonly repos = input.required<readonly Repo[]>();
  readonly busyRepoId = input<string | null>(null);
  readonly picked = output<string>();   // emits a repo id, only for `connected` / `cloning`
}

// new-chat.api.ts
export class NewChatApi {
  createSession(body: { repoId?: string; title?: string }): Observable<ChatSession>;
  bindRepo(chatId: string, repoId: string): Observable<ChatSession>;  // POST …/{id}/repo
  send(chatId: string, text: string): Observable<ChatMessage>;
  listRepos(): Observable<Page<Repo>>;
}

// new-chat.store.ts
export type NewChatProposal = 'repository' | 'schedule';

export class NewChatStore {
  readonly proposals: Signal<readonly NewChatProposal[]>;  // exactly ['repository', 'schedule']
  readonly repos / reposLoading / reposUnavailable / busy / error;
  readonly draft: Signal<string>;
  setDraft(text: string): void;
  loadRepos(): void;
  createFree(): void;                 // POST sessions {} then POST messages when draft is not empty
  connect(repoId: string): void;      // POST sessions { repoId }; progress while in flight
  bind(chatId: string, repoId: string): void;  // POST …/{id}/repo
}

// new-chat.ts
@Component({ selector: 'app-new-chat' })
export class NewChatPanel {
  readonly chatId = input<string | null>(null);   // a free chat that may be converted
  readonly created = output<ChatSession>();
  readonly handoff = output<ChatSession>();       // a session with kind 'repo': the host draws the divider
}
```

- **No HTTP in a component.** Signals in, store actions out.
- `pickerState`: `cloning` when `repo.id === busyRepoId`; `unavailable` when
  `repo.enabled === false`; `connected` otherwise. There is no `archived` field on a `Repo`
  and no `status` field — do not invent one, and do not treat `enabled: false` as pickable.
- `connect` sets `busyRepoId` and disables the composer while in flight; on `201` it emits
  `handoff` with the parsed session and clears `busy`; on `409 chat_already_bound` it emits
  nothing and renders the error.
- `createFree` is the only path that posts a message: it creates the session first and then
  sends the draft (trimmed). A failed create never loses the draft.

### Data

- Proposals are exactly two: `repository` and `schedule`. A third proposal is a bug.
- Composer rule: the textarea and the send button are enabled **whenever the panel is not
  converting** — showing the proposals never disables them. Sending with an empty draft is
  refused client-side (button disabled), nothing else blocks.
- The convert progress is per row: one `data-testid="repo-picker-row"` per repository with
  `[attr.data-state]`, and the picker stays visible while `cloning`.
- Copy lives in `new-chat.i18n.ts` and `repo-picker.ts`'s own dictionary file **inside its own
  path set** — if you keep the picker copy in `new-chat.i18n.ts`, that is allowed; never edit
  `features/chat/i18n.ts`, `features/repos/i18n.ts` or `src/assets/i18n/*.json`.

## ⚙️ Configuration

None. No new `CB_*` key, no new dependency.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `git diff --name-only main...task-60` — audit against the exclusive paths; extras allowed:
    `.agent_specs/task-60.md` and lines of `apps/app/README.md`.
- **Acceptance criteria:**
  - [ ] `[unit]` the empty state renders exactly the two proposals and nothing else.
  - [ ] `[unit]` with the proposals visible the composer is enabled; typing enables send; a
        send creates the session (`POST /v1/chat/sessions`, empty body) and then posts the
        trimmed draft once to `/messages`.
  - [ ] `[unit]` a disabled repository renders `unavailable` and its row cannot emit `picked`;
        a `connected` and a `cloning` row can.
  - [ ] `[unit]` `connect` issues one `POST /v1/chat/sessions` with `{ repoId }`, disables the
        composer while the response is pending, and emits `handoff` with `kind === 'repo'`;
        the picker comes back on a `404`/`409` with the error code shown.
  - [ ] `[unit]` `bind` on a free chat issues one `POST /v1/chat/sessions/{id}/repo`.
  - [ ] `[unit]` rendering the panel issues no request; `loadRepos` is explicit.
  - [ ] `[unit]` EN/ES parity of every dictionary this task ships.
  - [ ] `[unit]` nothing outside the exclusive paths was touched.
  - [ ] `[live]` **Not runnable here (no browser in CI).** Measurement, for the review issue:
        on the VM with a daemon on an ephemeral port, picking a connected repository shows the
        `cloning` row, disables the composer, then shows the handoff divider on the chat
        screen; measured with `npx playwright test` at 320×640. Report it as **not run**.

## 📣 Coordination

- **For the next batch:** mount `<app-new-chat [chatId]="…" (created)="…" (handoff)="…" />`
  from `/chat/new` (frame `03a`) or over an existing free chat for the converting flow; the
  component is exported from `features/chat/new-chat.ts` and the picker from
  `features/repos/repo-picker.ts`.
- **For the Architect:** the cut gives no task `apps/app/src/app/app.routes.ts`, and the frozen
  router has no `/chat/new` or `/repos/pick`, so reachability and the route rows are a review
  item; the components are not silently assumed wired.
- `chat-list.store.startChat()` already creates a free chat without the empty state. Do not
  change it; the next batch decides whether the button opens this panel.

## ⛔ Out of scope

- Any router change, `chat-list.page.ts`, `chat.page.ts`, `chat.api.ts`, the shared
  dictionaries, `core/**`, `packages/contracts/**`.
- Clone progress from the daemon: there is no clone event in the contracts. Progress is the
  request's own in-flight state.
- A repository's policy editor or its gate result — that is `features/repos/**` outside the
  picker.
- No new dependency. No refactor of files you were not given.

## ✅ Handover

Commit your work, `git push -u origin task-60`, then
`git commit --allow-empty -m "dev: done task-60" && git push`. Report per `.agent_roles/dev.md`:
task id, worktree, branch tip sha, commands with exit codes, checklist, files, deviations.

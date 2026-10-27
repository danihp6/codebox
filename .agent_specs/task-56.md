# Spec: Task-56 — Chat list

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app.
- **Role:** Dev.
- **Objective:** `/chat` becomes the list of `docs/app.md` §4 and §9: one flat list ordered by
  last activity, a search box, the five filters `All` / `Repo` / `Schedule` / `Unread` /
  `Archived`, and one row per session rendered by a new presentational component that shows a
  scope chip, **both signals** (green unread dot **and** amber unreviewed edge), and the
  `cost`/`context` micro-text as one wrapping flow. Everything is driven by the Batch-16
  contract (`ChatSession.kind`, `usage`, `contextTokens`, `reviewedAt`, `status`); no local
  field is invented. After this task the repo-grouped list, the repository `<select>` and
  `ChatListStore.repoFilter` no longer exist.
- **Environment:** worktree `../wt-cb-56`, branch `task-56`, base `main` (base commit
  `32035b1`). Work only inside the worktree.
- **Dependencies (both merged on `main`):**
  - **Task-51** — produced `chatSessionSchema.kind | usage | contextTokens | contextEpoch |
    reviewedAt` in `packages/contracts/src/resources.ts` (all optional on the wire) and the
    `docs/api.md` §5.6 key descriptions you must honour.
  - **Task-52** — produced the nullable `chatSessionSchema.repoId`, the four lifecycle routes
    (`/repo`, `/compact`, `/reviewed`, `/promote`) and the daemon behaviour that sets
    `reviewedAt` once.

### Current state to replace (verify before writing)

`apps/app/src/app/features/chat/chat-list.store.ts` today exposes `sessions`, `repos`,
`repoFilter`, `loading`, `error`, `creating`, re-queries the server with `?repoId=` on every
filter change, and `startChat()` refuses to create a session while no repository exists.
`apps/app/src/app/features/chat/chat-list.page.ts` renders a `<select>` of repositories, groups
the sessions by `repoId` into `<section class="cb-chat-group">` blocks, and shows a single
status line per row. The group header, the `<select>`, `repoFilter` and the
`chat-group` markup are **deleted** by this task. The store no longer sends `repoId`: one page
of sessions is fetched once and every filter and the search run in memory over it.

### Decisions taken from the repository (do not re-derive, do not "improve")

1. **`kind` absent reads as `repo`.** `docs/api.md` §5.6 line 454 and `CHANGELOG.md` §Task-51
   pin it: "a payload without it is read as `repo`". Implement `sessionKind(session)` as
   `session.kind ?? 'repo'`.
2. **Archived is `status === 'archived'`.** `chatSessionSchema` has **no `archivedAt`** field, so
   the contract is the only source: archived is a `status` value, never a timestamp. Do not add
   one and do not read one.
3. **`reviewedAt` absent reads as `null`** (`docs/api.md` §5.6 line 463, `CHANGELOG.md`
   §Task-51). `usage` absent reads as "not spent"; `contextTokens` absent reads as `0`
   (`docs/api.md` §5.6 lines 458-460).
4. **The context micro-text is absolute tokens, never a percentage.** The wire carries
   `contextTokens` (the measured window size) but no window denominator, and the 75/90/95
   thresholds of D48 belong to the context sheet (Task-59). The row prints
   `formatContextTokens(tokens)` — e.g. `12.4K` — plus the `chat.row.context` label.
5. **Unread is a per-device last-read marker, not a contract field.** Nothing in
   `packages/contracts` and nothing in `apps/daemon` carries an unread flag or a last-read
   stamp, and `SseService` exposes a single latest-event signal with no history
   (`apps/app/src/app/core/events/sse.service.ts`), so the marker cannot be reconstructed from
   events alone. The mechanism is frozen in 🔒 Contract: a `ChatReadStore` that persists
   `{ [chatId]: iso }` under the secure-store key `cb.chatRead`, exactly the way
   `core/settings/settings.store.ts` persists `cb.settings`.
6. **The five filters are client-side.** `GET /v1/chat/sessions` accepts only `repoId`, `limit`
   and `cursor` (`docs/api.md` §5.6 line 440); `ChatApi.listSessions` is read-only to this task
   and keeps that shape. `All`/`Repo`/`Schedule`/`Unread`/`Archived` therefore filter the page
   already in the store, and **no filter or search change issues an HTTP request**. `Repo` means
   "the chat whose scope is a repository", not a repository picker: `/chat?filter=repo` and
   `/chat?filter=schedule` are separate screens owned by Task-60 and Task-61. The chips do not
   navigate.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/app/features/chat/chat-list.page.ts` (rewrite)
- `apps/app/src/app/features/chat/chat-list.page.spec.ts` (rewrite)
- `apps/app/src/app/features/chat/chat-list.store.ts` (rewrite)
- `apps/app/src/app/features/chat/chat-list.store.spec.ts` (rewrite)
- `apps/app/src/app/features/chat/i18n.ts` (the chat dictionary; **add/rename keys here**, do not
  create a second dictionary)
- `apps/app/src/app/shared/chat-row.ts` (new)
- `apps/app/src/app/shared/chat-row.spec.ts` (new)
- `apps/app/README.md` (the file map; `src/app/readme.spec.ts` fails without it)

Hot files: **none.** This task claims no path on the hot-file list, and
`apps/app/src/app/app.routes.ts`, `app.config.ts`, `packages/contracts/**`,
`docs/decisions.md` and `CHANGELOG.md` stay untouched (the Orchestrator writes the changelog
entry at merge).

### Inputs (read-only)

- `AGENTS.md`
- `docs/app.md` §4 (Screens), §5 (State and data), §7 (Live events), §8 (Chat), §9 (Design
  direction: density, two signals, 320 px, localisation)
- `docs/decisions.md` D43-D48
- `design/README.md` §1 (frames `02`, `L2`, `D1 · D3`, `S1`) and §3 (widths)
- `packages/contracts/src/resources.ts` (`chatSessionSchema`, `costSchema`, `ChatSession`)
- `packages/contracts/src/events.ts` (`SseStreamEvent`, `chatMessageDataSchema`)
- `apps/app/src/app/features/chat/chat.api.ts` — **read-only**: call `listSessions`, `listRepos`,
  `createSession`; never edit it (Task-57 owns the file)
- `apps/app/src/app/core/events/sse.service.ts`, `apps/app/src/app/core/auth/secure-store.ts`
  (`SECURE_STORE`, `SecureStore`), `apps/app/src/app/core/settings/settings.store.ts` (the
  persistence pattern), `apps/app/src/app/core/i18n/i18n.service.ts` (`Locale`, `locale()`)
- `apps/app/src/app/core/api/api-client.ts` (`ApiError` shape; do not edit)

## 🔒 Contract

Frozen the moment this task merges. Task-57 and Task-59 are written against it.

### `apps/app/src/app/shared/chat-row.ts` (new)

```ts
export type ChatScope = 'free' | 'repo' | 'schedule';

/** Everything the row renders. All copy is already translated: the row imports no dictionary. */
export interface ChatRowView {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly scope: ChatScope;
  readonly scopeLabel: string;
  readonly costLabel: string | null;
  readonly contextLabel: string | null;
  readonly status: 'idle' | 'working' | 'archived';
  readonly statusLabel: string;
  readonly unread: boolean;
  readonly unreviewed: boolean;
  readonly unreadLabel: string;
  readonly unreviewedLabel: string;
}

@Component({
  selector: 'app-chat-row',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatRow {
  readonly view = input.required<ChatRowView>();
  readonly open = output<string>();
}
```

- Host is `<app-chat-row>`; `:host { display: block; min-inline-size: 0; }`. The component
  renders **one** `<button type="button" class="cb-chat-row">`.
- The button carries, verbatim:
  `data-testid="chat-row"`, `[attr.data-chat-id]="view().id"`,
  `[attr.data-scope]="view().scope"`, `[attr.data-status]="view().status"` (the raw
  `idle`/`working`/`archived`, never the translated label — the label is a visible span),
  `[attr.data-unread]="view().unread ? 'true' : 'false'"`,
  `[attr.data-unreviewed]="view().unreviewed ? 'true' : 'false'"`,
  `[class.cb-chat-row-unreviewed]="view().unreviewed"`, `(click)="open.emit(view().id)"`.
  The visible copy is `view().title` in a `<span data-testid="chat-row-title">` and
  `view().preview` in a `<span data-testid="chat-row-preview">`.
- The third line is exactly one `<span class="cb-chat-row-flow" data-testid="chat-row-flow">`
  whose **only direct children are spans**, in this order:
  1. `@if (view().unread)` → `<span class="cb-chat-row-dot" data-testid="chat-row-unread"
     role="img" [attr.aria-label]="view().unreadLabel"></span>` (absent when read).
  2. `<span class="cb-chat-row-scope" data-testid="chat-row-scope">{{ view().scopeLabel }}</span>`
     (always present).
  3. `@if (view().costLabel; as cost)` → `<span class="cb-chat-row-cost cb-mono"
     data-testid="chat-row-cost">{{ cost }}</span>` (absent when null).
  4. `@if (view().contextLabel; as context)` → `<span class="cb-chat-row-context cb-mono"
     data-testid="chat-row-context">{{ context }}</span>` (absent when null).
  5. `<span class="cb-chat-row-status" data-testid="chat-row-status">{{ view().statusLabel }}</span>`
     (always present).
  6. `@if (view().unreviewed)` → `<span class="cb-visually-hidden" data-testid="chat-row-unreviewed"
     role="img" [attr.aria-label]="view().unreviewedLabel"></span>` (absent when reviewed).
- **Layout rules, non-negotiable:**
  - `.cb-chat-row` is `display: grid; gap: calc(var(--cb-space) / 2); inline-size: 100%;
    min-inline-size: 0; overflow-wrap: anywhere; text-align: start;` with the existing
    `padding`, `border`, `border-radius` and `background: var(--cb-surface)`.
  - `.cb-chat-row-flow` is `display: flex; flex-wrap: wrap; gap: var(--cb-space);
    align-items: baseline; min-inline-size: 0;`.
  - `.cb-chat-row-unreviewed` adds `border-inline-start: 2px solid var(--cb-warn);`
    (light-theme ink variant is a theme task; `--cb-warn` is the only token that exists).
  - `.cb-chat-row-dot` is `inline-size: 8px; block-size: 8px; border-radius: 50%;
    background: var(--cb-accent);`.
  - `.cb-chat-row-preview` and `.cb-chat-row-flow` use `color: var(--cb-muted)`; the status and
    the numbers use `.cb-mono`.
  - `.cb-visually-hidden` is the standard clip rule (`position: absolute; inline-size: 1px;
    block-size: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%);
    white-space: nowrap; border: 0;`) declared **inside this component** — `src/styles.css` is
    not ours.
  - The component declares **no** `position`, `left`, `top`, `inset-inline-start` outside
    `.cb-visually-hidden`, and **no** `inline-size`/`block-size`/`width`/`height` in `px`
    outside the dot and the clip rule. Every element sizes to its content and wraps.

### `apps/app/src/app/features/chat/chat-list.store.ts` (rewrite)

```ts
import type { ChatSession, Repo, SseStreamEvent } from '@codebox/contracts';
import type { ApiError } from '../../core/api/api-client';
import type { Locale } from '../../core/i18n/i18n.service';
import type { ChatRowView, ChatScope } from '../../shared/chat-row';

export type ChatFilter = 'all' | 'repo' | 'schedule' | 'unread' | 'archived';

/** Order is the render order of the chips. */
export const CHAT_FILTERS: readonly ChatFilter[] = Object.freeze([
  'all',
  'repo',
  'schedule',
  'unread',
  'archived',
]);

/** Secure-store key for the per-device read markers. Shape: `Record<chatId, iso8601>`. */
export const CHAT_READ_KEY = 'cb.chatRead';

export interface ChatRowOptions {
  readonly repoSlug: string | null;
  readonly unread: boolean;
  readonly unreviewed: boolean;
  readonly locale: Locale;
}

export function sessionKind(session: ChatSession): ChatScope;
export function isUnread(session: ChatSession, readAt: string | null): boolean;
export function isUnreviewed(session: ChatSession): boolean;
export function chatFilterMatches(
  filter: ChatFilter,
  session: ChatSession,
  unread: boolean,
): boolean;
export function buildChatRow(session: ChatSession, options: ChatRowOptions): ChatRowView;
export function formatCost(usd: number): string;
export function formatContextTokens(tokens: number): string;

@Injectable({ providedIn: 'root' })
export class ChatReadStore {
  readonly loaded: Signal<boolean>;
  load(): Promise<void>;
  readAt(chatId: string): string | null;
  markRead(chatId: string, at: string): void;
  snapshot(): Readonly<Record<string, string>>;
}

@Injectable()
export class ChatListStore {
  readonly sessions: Signal<readonly ChatSession[]>;
  readonly repos: Signal<readonly Repo[]>;
  readonly filter: Signal<ChatFilter>;
  readonly search: Signal<string>;
  readonly rows: Signal<readonly ChatRowView[]>;
  readonly total: Signal<number>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<ApiError | null>;
  readonly creating: Signal<boolean>;

  load(): void;
  setFilter(next: ChatFilter): void;
  setSearch(text: string): void;
  markRead(chatId: string): void;
  startChat(): void;
  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored';
}
```

`Signal` and the `input`/`output` helpers come from `@angular/core`. The `Signal<T>` types above
are what a consumer reads: declare the store fields with `signal<T>(...)` exactly as the current
`ChatListStore` does, so the store can write them and every consumer sees a read-only signal.

Exact semantics — implement these, nothing softer:

- `sessionKind` → `session.kind ?? 'repo'`.
- `isUnread(session, readAt)`:
  - `false` when `session.lastMessage === null` or `session.lastMessage.role !== 'assistant'`
    (the operator's own message is never unread);
  - `true` when `readAt === null` (this device has never opened the chat and the agent spoke
    last);
  - otherwise `Date.parse(lastMessage.createdAt) > Date.parse(readAt)`;
  - a `NaN` from either `Date.parse` → `true` (show the dot rather than swallow a message).
- `isUnreviewed(session)` — all four must hold:
  `session.status !== 'archived'`, `sessionKind(session) !== 'free'`,
  `session.reviewedAt === null || session.reviewedAt === undefined`,
  `session.lastMessage?.role === 'assistant'`.
  A free chat never carries the edge (it owns no worktree and delivers no work); a chat the
  operator already reviewed never carries it.
- `chatFilterMatches`:
  - `all` → `session.status !== 'archived'`
  - `repo` → `status !== 'archived' && sessionKind(session) === 'repo'`
  - `schedule` → `status !== 'archived' && sessionKind(session) === 'schedule'`
  - `unread` → `status !== 'archived' && unread`
  - `archived` → `session.status === 'archived'` (the only filter that shows archived rows)
- `buildChatRow(session, options)`:
  - `title` = `session.title`; `preview` = `session.lastMessage?.text` when non-empty, else
    `translate(locale, 'chat.row.noMessage')`;
  - `scope` = `sessionKind(session)`; `scopeLabel`:
    `free` → `translate(locale, 'chat.scope.free')`,
    `schedule` → `translate(locale, 'chat.scope.schedule')`,
    `repo` → `options.repoSlug ?? translate(locale, 'chat.scope.repo')` (the repository slug
    when `repos()` knows the id, the generic label otherwise);
  - `costLabel` = `session.usage !== undefined && session.usage.usd > 0` ? `formatCost(usd)` :
    `null`;
  - `contextLabel` = `(session.contextTokens ?? 0) > 0`
    ? `` `${formatContextTokens(tokens)} ${translate(locale, 'chat.row.context')}` `` : `null`;
  - `status` = `session.status`; `statusLabel` =
    `translate(locale, `chat.status.${session.status}`)` — the three keys already exist;
  - `unread`/`unreviewed` = `options.unread`/`options.unreviewed`;
  - `unreadLabel` = `translate(locale, 'chat.row.unread')`,
    `unreviewedLabel` = `translate(locale, 'chat.row.unreviewed')`.
- `formatCost(usd)` → `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd)`
  (`0.42` → `$0.42`), the same call the dashboard, runs list and run detail already use.
- `formatContextTokens(tokens)` →
  `Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(tokens)`
  (`12400` → `12.4K`, `95000` → `95K`).
- `ChatReadStore`:
  - `load()` is idempotent (caches its promise), never throws, and resolves even when the
    secure store fails. `JSON.parse` failure or a non-object → an empty map. Keep only entries
    whose key is a string and whose value is a string `Date.parse` accepts.
  - `readAt(chatId)` → the stored ISO string or `null`.
  - `markRead(chatId, at)` → set the entry, then persist fire-and-forget
    (`void secure.set(CHAT_READ_KEY, JSON.stringify(map))`, errors swallowed). Keep at most
    **200** entries: drop the lowest timestamps first.
  - `snapshot()` → a frozen copy of the map (tests and Task-57 read it).
  - `loaded` is `true` once `load()` resolved.
- `ChatListStore.load()` → `loadRepos()`, then `void read.load().then(() => loadSessions())`.
  One `GET /v1/repos?limit=200` and one `GET /v1/chat/sessions?limit=50` per `load()`
  (`SESSIONS_LIMIT = 50`); the sessions request carries **no `repoId`**.
- `setFilter` / `setSearch` only set their signal, recompute `rows` and issue **no request**.
  `setSearch` stores the raw string; the matcher trims it and lowercases it.
- Search matches when the trimmed, lowercased term is a substring of `session.title` or of
  `session.lastMessage?.text`, both lowercased. No accent folding, no fuzzy matching.
- `rows` = `sessions`, filtered by `chatFilterMatches` with the unread computed **once** per
  session and reused by the row, then by the search term, in the order the server returned
  them, each mapped through `buildChatRow` with the slug from `repos()` and `locale()`.
  `rows` is a `computed`, so a locale, filter, search, read-marker or session change re-renders.
  `total` is `sessions().length` — the whole fetched page **before** filtering; the page uses it
  to tell "nothing exists" from "nothing matches".
- `markRead(chatId)` → `read.markRead(chatId, session.lastMessage?.createdAt ?? session.updatedAt)`;
  unknown id → no-op.
- `startChat()` → `createSession({})` (a **free** chat, D43: no repository required), `creating`
  true until the response, then `router.navigate(['/chat', session.id])`; an error lands in
  `error`. It must not consult `repos()` at all.
- `applyStreamEvent(event)`:
  - `chat.message` for a known chat → replace `lastMessage`, set `updatedAt` to
    `message.createdAt`, **re-sort the sessions by `updatedAt` descending with `id` descending
    as the tie-break** (the server's `ORDER BY updated_at DESC, id DESC`), return `'applied'`.
    The row therefore moves to the top and its dot appears on the next `rows` read because the
    marker is older than the new message.
  - `chat.message` for an unknown chat, or any other event, → `'ignored'` (no mutation).
- Errors: a failed sessions read sets `sessions` to `[]` and `error` to the `ApiError`
  (unchanged behaviour); a failed repos read only empties `repos`.
- Purity: the exported free functions (`sessionKind`, `isUnread`, `isUnreviewed`,
  `chatFilterMatches`, `buildChatRow`, `formatCost`, `formatContextTokens`) read no clock, no
  network, no filesystem and no environment; `buildChatRow` takes everything, including the
  locale, as an argument.

### `apps/app/src/app/features/chat/chat-list.page.ts` (rewrite)

Keeps `selector: 'app-chat-list-page'`, `standalone: true`, `OnPush`,
`providers: [ChatListStore]` and `data-testid="page-chat"`. Imports `ChatRow` plus the Ionic
shell components it needs.

- **Search:** `<input id="cb-chat-search" type="search" data-testid="chat-search"
  [value]="store.search()" [placeholder]="t('chat.search.placeholder')"
  (input)="onSearch($event)" />` behind a `<label class="cb-visually-hidden"
  for="cb-chat-search">{{ t('chat.search.label') }}</label>`. No fixed width. Component styles
  are scoped, so the page declares its **own** `.cb-visually-hidden` clip rule (same declaration
  as the row's, §above); `src/styles.css` is not ours.
- **Filters:** `<nav data-testid="chat-filters">` containing, for each
  `filter of filters` (= `CHAT_FILTERS`), a
  `<button type="button" data-testid="chat-filter" [attr.data-filter]="filter"
  [attr.aria-pressed]="store.filter() === filter" (click)="store.setFilter(filter)">`.
  The label comes from `filterLabel(filter)`, a `switch` that calls `t()` with the five
  **literal** keys (`chat.filter.all`, `chat.filter.repo`, `chat.filter.schedule`,
  `chat.filter.unread`, `chat.filter.archived`) — a computed key would escape the existing
  key-resolution test in `chat.page.spec.ts`.
- **New chat:** one `<button type="button" data-testid="chat-new" [disabled]="store.creating()"
  (click)="store.startChat()">{{ t('chat.action.new') }}</button>`. It is **not** disabled by an
  empty repository list any more.
- **States, in this order:** `data-testid="chat-list-loading"` while loading;
  `data-testid="chat-list-error" [attr.data-code]="failure.code"` plus
  `data-testid="chat-list-retry"` → `store.load()`; `data-testid="chat-empty"` rendering
  `t('chat.empty.list')` when `!loading && error === null && total === 0`;
  `data-testid="chat-list-no-match"` rendering `t('chat.empty.filter')` when
  `!loading && error === null && total > 0 && rows.length === 0`.
- **Rows:** `<ul>` of `<li><app-chat-row [view]="row" (open)="open($event)" /></li>` over
  `store.rows()`; `open(id)` calls `store.markRead(id)` and then
  `void this.router.navigate(['/chat', id])`.
- The page keeps the `SseService` effect it has today: every non-null `sse.event()` is passed
  to `store.applyStreamEvent(event)` inside `untracked`, and the constructor calls
  `this.store.load()` once so the first render issues the two `GET`s.
- The page has **no** repository `<select>`, **no** `groups` computed, **no**
  `statusLabel`/`onRepoFilter`/`onRepoOption`, and no `.cb-chat-group` markup.
- Its own styles keep `flex-wrap: wrap` on the head and filters, and no fixed pixel widths, so
  the header survives 320 px.

### `apps/app/src/app/features/chat/i18n.ts`

Add both locales with identical key sets. **Remove** `chat.filter.label` and
`chat.group.unknown` (only the deleted `<select>` and grouping used them). **Change the value**
of `chat.filter.all` to the chip label. Exact new/changed values:

| key | en | es |
| --- | --- | --- |
| `chat.filter.all` (changed) | `All` | `Todos` |
| `chat.filter.repo` | `Repo` | `Repo` |
| `chat.filter.schedule` | `Schedule` | `Programados` |
| `chat.filter.unread` | `Unread` | `Sin leer` |
| `chat.filter.archived` | `Archived` | `Archivados` |
| `chat.search.label` | `Search chats` | `Buscar chats` |
| `chat.search.placeholder` | `Search chats` | `Buscar chats` |
| `chat.empty.filter` | `Nothing matches this filter.` | `Nada coincide con este filtro.` |
| `chat.scope.free` | `Free` | `Libre` |
| `chat.scope.repo` | `Repo` | `Repo` |
| `chat.scope.schedule` | `Schedule` | `Programado` |
| `chat.row.unread` | `Unread` | `Sin leer` |
| `chat.row.unreviewed` | `Not reviewed` | `Sin revisar` |
| `chat.row.context` | `ctx` | `ctx` |

Every other key stays byte-identical: `chat.status.*`, `chat.role.*`, `chat.error.*`,
`chat.empty.list`, `chat.row.noMessage`, `chat.action.*`, `chat.title`, `chat.loading`,
`chat.detail.*`, `chat.state.*`, `chat.composer.*`, `chat.message.*`, `chat.tool.*`,
`chat.routine.*`, `chat.permission.*` are read by `chat.page.ts` (Task-57) today.

### Data (frozen shapes)

- `ChatRowView` — the interface above; another task may pass it around but may not add fields
  without amending this spec.
- `cb.chatRead` — the secure-store key for `Record<string, string>` where the value is the
  last-read timestamp of that chat on this device (ISO-8601, `timestampSchema` format). Absent
  key or absent entry = "never read on this device". At most 200 entries.
- `CHAT_FILTERS` — `['all', 'repo', 'schedule', 'unread', 'archived']`, the render order.
- DOM hooks: `page-chat`, `chat-search`, `chat-filters`, `chat-filter` (+ `data-filter`),
  `chat-new`, `chat-list-loading`, `chat-list-error` (+ `data-code`), `chat-list-retry`,
  `chat-empty`, `chat-list-no-match`, `chat-row` (+ `data-chat-id`, `data-scope`,
  `data-status`, `data-unread`, `data-unreviewed`), `chat-row-title`, `chat-row-preview`,
  `chat-row-flow`, `chat-row-scope`, `chat-row-cost`, `chat-row-context`, `chat-row-status`,
  `chat-row-unread`, `chat-row-unreviewed`.

## 🧩 Configuration

None. This task adds no `CB_*` key, no environment variable and no new dependency. It reads one
existing client-side persistence key (`cb.chatRead` through `SECURE_STORE`) and no daemon
configuration.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim, from `../wt-cb-56`, after merging `task-56` onto `main` in a fresh
integration worktree.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — the root gate: `test:guard`, then the whole app suite through the Angular unit
    builder (Vitest + jsdom, headless) including the two rewritten specs and the new row spec,
    then the workspace Vitest run.
  - `npm run build` — `tsc -b` plus the app production build.
  - `git diff --name-only main...task-56` — audit against the exclusive paths.
  - Do **not** run `npx playwright test`: this task ships no browser flow.

- **Spec harness rules** (both page and store specs; copy these, do not invent another way):
  - Provide `{ provide: SECURE_STORE, useValue: memoryStore() }` (the helper already used by
    `chat-list.page.spec.ts`), `provideHttpClient()`, `provideHttpClientTesting()`,
    `provideRouter([])`, `provideIonicAngular()` for the page spec, and
    `{ provide: SseService, useValue: { event: sse } }` with a `WritableSignal<SseStreamEvent | null>`.
  - `ChatReadStore` is root-provided and caches its load promise: call
    `await TestBed.inject(ChatReadStore).load()` (and `markRead(...)` for a seeded fixture)
    **before** `TestBed.createComponent(...)` / before `store.load()`, so the marker is in place
    before the request is issued and no microtask race exists.
  - Flush HTTP with `TestBed.inject(HttpTestingController)`; `afterEach` calls `http.verify()`,
    `TestBed.resetTestingModule()` and `vi.restoreAllMocks()`.
  - The row spec uses `fixture.componentRef.setInput('view', view)` and listens with
    `fixture.componentInstance.open.subscribe(...)`; it needs no HTTP, no router and no Ionic.

- **Fixtures every spec starts from** (build them exactly; timestamps are ISO with `Z`):

  | id | title | status | kind | repoId | lastMessage (role @ createdAt) | usage.usd | contextTokens | reviewedAt |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | `chat_a` | `Free first` | `idle` | `free` | `null` | assistant @ `2026-10-27T09:00:00Z` | `0` | `0` | `null` |
  | `chat_b` | `Alpha refactor` | `idle` | `repo` | `repo_1` | assistant @ `2026-10-27T10:00:00Z` | `0.42` | `12400` | `null` |
  | `chat_c` | `Reviewed chat` | `idle` | `repo` | `repo_1` | assistant @ `2026-10-27T08:00:00Z` | `1.5` | `95000` | `2026-10-27T08:30:00Z` |
  | `chat_d` | `Nightly schedule` | `working` | `schedule` | `repo_1` | assistant @ `2026-10-27T07:00:00Z` | `0.1` | `3000` | `null` |
  | `chat_e` | `Old chat` | `archived` | `repo` | `repo_1` | assistant @ `2026-10-26T07:00:00Z` | `0.2` | `1000` | `null` |
  | `chat_f` | `Legacy chat` | `idle` | *(absent)* | `repo_1` | **user** @ `2026-10-27T06:00:00Z` | *(absent)* | *(absent)* | *(absent)* |

  `repo_1` = `{ id: 'repo_1', slug: 'owner/alpha', ... }` from the existing `Repo` fixture.
  The sessions payload arrives in the table order (`chat_a` first, `chat_f` last) and the store
  preserves that order on load. Unless a test says otherwise, seed `ChatReadStore` with
  `{ chat_c: '2026-10-27T08:00:00Z' }`
  — `chat_c` was read at the exact time of its last message. Then `isUnread` is `true` for
  `chat_a`, `chat_b` and `chat_d`, and `false` for `chat_c` (marker equals the message time),
  `chat_e` (archived, and never listed outside `Archived`) and `chat_f` (its last message is
  the operator's). With no markers at all, `chat_c` joins the unread set. `isUnreviewed` is
  `true` for `chat_b` and `chat_d` only.

- **Acceptance criteria:**
  - [ ] `[unit]` `npm ci --prefer-offline --no-audit --no-fund && npm run lint && npm test &&
        npm run build` all exit `0` from the merged tree.
  - [ ] `[unit]` The five filters render in order: `chat-list.page.spec.ts` asserts
        `[...element.querySelectorAll('[data-testid="chat-filter"]')].map((b) =>
        b.getAttribute('data-filter'))` equals `['all','repo','schedule','unread','archived']`
        and that the selected chip has `aria-pressed="true"` and the others `"false"`.
  - [ ] `[unit]` `All` lists `chat_a, chat_b, chat_c, chat_d, chat_f` in that order (the server
        order) and **never** `chat_e`; `Archived` lists exactly `chat_e`; `Repo` lists
        `chat_b, chat_c, chat_f`; `Schedule` lists exactly `chat_d`.
  - [ ] `[unit]` `Unread` lists exactly `chat_a, chat_b, chat_d` with the default marker
        (`ChatReadStore.markRead('chat_c', '2026-10-27T08:00:00Z')` applied before the render),
        and exactly `chat_a, chat_b, chat_c, chat_d` with an empty marker map. Then
        `store.markRead('chat_a')` removes `chat_a` from the filter and drops its dot, and
        `ChatReadStore.readAt('chat_a')` equals `2026-10-27T09:00:00Z`; a reload with the same
        `SECURE_STORE` keeps it read (the marker is persisted under `cb.chatRead`).
  - [ ] `[unit]` Both signals render on the same row: for `chat_b`,
        `[data-testid="chat-row"][data-chat-id="chat_b"]` has `data-unread="true"` and
        `data-unreviewed="true"`, contains a `[data-testid="chat-row-unread"]` and a
        `[data-testid="chat-row-unreviewed"]`, and carries the class
        `cb-chat-row-unreviewed`. For `chat_c` (reviewed) both `data-*` are `"false"` and both
        marker elements are absent. On the `Archived` filter `chat_e` has neither signal.
  - [ ] `[unit]` A free chat never carries the edge: `chat_a` has `data-unreviewed="false"` and
        no `chat-row-unreviewed` element, while still showing its dot.
  - [ ] `[unit]` The cost and context micro-text: `chat_b` renders
        `[data-testid="chat-row-cost"]` with the text `$0.42` and
        `[data-testid="chat-row-context"]` containing `12.4` and `ctx`; `chat_a`
        (`usd: 0`, `contextTokens: 0`) renders neither element; `chat_f` (both keys absent)
        renders neither element and does not throw; `chat_f`'s scope chip text is
        `owner/alpha` (absent `kind` reads as `repo` and the slug wins).
  - [ ] `[unit]` The micro-text is a flow, not three fixed positions:
        `element.querySelectorAll('[data-testid="chat-row-flow"]')` has length `1` per row and
        every direct child of it is a `SPAN`. A source assertion in `chat-row.spec.ts`
        (`readFileSync` of `src/app/shared/chat-row.ts`) proves the component styles contain
        `flex-wrap: wrap`, and — after removing the `.cb-visually-hidden` rule from the text
        before asserting — contain no `position:`, no `left:`/`inset-inline-start:` and no `px`
        length other than the dot's `8px`.
  - [ ] `[unit]` A `chat.message` frame for `chat_d` makes it the first row of `All` (order
        `chat_d, chat_a, chat_b, chat_c, chat_f`), updates its preview to the frame text and
        leaves `data-unread="true"`; the same frame for `chat_unknown` returns `'ignored'` and
        mutates nothing; a `chat.delta` frame returns `'ignored'`.
  - [ ] `[unit]` Search is case-insensitive, spans the title and the last message, and composes
        with the filter: `setSearch('ALPHA')` on `All` leaves `chat_b` only; `setSearch('alpha')`
        on `Schedule` leaves nothing and shows `chat-list-no-match` (not `chat-empty`); clearing
        the search restores the previous filter's rows.
  - [ ] `[unit]` Filter and search changes are client-side: after `load()`, `store.setFilter('archived')`
        and `store.setSearch('x')` leave `HttpTestingController.expectNone` clean for
        `/v1/chat/sessions` and `/v1/repos`.
  - [ ] `[unit]` The error path is unchanged: a `500` on `/v1/chat/sessions` renders
        `chat-list-error` with `data-code="internal"`, `chat-list-retry` refetches and the
        block disappears on success; a `total === 0` fixture renders `chat-empty`.
  - [ ] `[unit]` New chat posts an empty body: with zero repositories the `chat-new` button is
        **enabled**, a click issues `POST /v1/chat/sessions` with `{}`, `creating()` stays true
        until the `201`, and the store then navigates to `['/chat', session.id]` exactly once.
  - [ ] `[unit]` The dictionary: `STRINGS.en` and `STRINGS.es` have identical sorted key sets,
        no empty value, the fourteen keys in the table above resolve in both locales, and
        `chat.page.spec.ts`'s "resolves every key the chat templates use" test still passes
        with all five `chat.filter.*` literals present in `chat-list.page.ts`.
  - [ ] `[unit]` `apps/app/README.md` lists `src/app/shared/chat-row.ts` and
        `src/app/shared/chat-row.spec.ts` exactly once each, sorted with their neighbours, and
        `src/app/readme.spec.ts` passes both of its assertions (nothing under `src/app` missing,
        no stale entry).
  - [ ] `[unit]` `git diff --name-only main...task-56` lists only the eight exclusive paths
        above (a `git status --porcelain` with untracked files included must show nothing else).
  - [ ] `[live]` **The longest row fits at 320 px with no clip.** Measurement, handed to a human
        through an `agent-review` issue and never reported as passing here: on the running box,
        open `https://<tunnel>/chat` in Chromium with the device toolbar at **320 × 568** (the
        `S1` frame), dark theme, at least one session of each scope and one archived session;
        record in the issue (a) `document.documentElement.scrollWidth` — must be exactly `320`,
        (b) for every `[data-testid="chat-row"]`, `getBoundingClientRect().right` — must be
        `<= 320`, and (c) `scrollWidth - clientWidth` per row — must be `<= 0`; paste the three
        numbers and one screenshot of `S1`.

## 📣 Coordination

- **For the Orchestrator:** this task is app-only and claims **no hot file**. It rewrites four
  `features/chat/chat-list.*` files, adds `shared/chat-row.ts` and `shared/chat-row.spec.ts`,
  and edits `features/chat/i18n.ts` plus `apps/app/README.md` — eight paths, no more;
  `CHANGELOG.md` and `TODO.md` are yours at merge. Task-54's paths (`apps/daemon/**`, `ops/**`,
  `docs/security.md`, `docs/jobs.md`, `docs/providers.md`) do not intersect this list.
- **For Task-57 (the Chat thread):** consume, do not redefine.
  - `<app-chat-row [view]="row" (open)="…" />` from `shared/chat-row.ts` with a `ChatRowView`.
  - `ChatReadStore` (`providedIn: 'root'`) is the **only** place a read marker is written: call
    `markRead(chatId, message.createdAt)` when the thread is opened and when the thread is on
    screen at the moment an assistant message arrives. Do not build a second marker map and do
    not add a field to `ChatSession`.
  - `buildChatRow(session, { repoSlug, unread, unreviewed, locale })` builds a `ChatRowView`
    outside the list if you need one.
  - `apps/app/src/app/features/chat/i18n.ts` is a single dictionary: add your keys for both
    locales in your own diff; do not re-add `chat.filter.label` or `chat.group.unknown`, which
    this task retires, and do not rename `chat.filter.all` back.
  - `chat.api.ts`, `chat.store.ts`, `chat.page.ts`, `markdown.ts`, `chat-stream.ts` are
    untouched by this task and are yours.
- **For Task-59 / Task-60 / Task-61:** the list's `Repo` and `Schedule` chips are **in-list
  filters** over the page already fetched; they do not navigate. `/chat?filter=repo`
  (`design/README.md` §1, `features/repos`) and `/chat?filter=schedule`
  (`design/README.md` §2, `features/schedules`) stay separate screens; the list's "New chat"
  button creates a **free** chat through `POST /v1/chat/sessions` with `{}` and pushes
  `/chat/:id` — it does not route to `/chat/new`, which is Task-60's and is not in
  `app.routes.ts`.
- **For a later theme task:** the amber edge uses `--cb-warn`. `docs/app.md` §9 asks for the
  ink `#b45309` on light backgrounds; adding a `--cb-warn-ink` token belongs to
  `apps/app/src/theme/variables.css`, which this task does not own. The row keeps the token
  reference so the fix is one line there plus one here.
- **Assumptions the human should confirm** (recorded, not blocking):
  1. "Unread" is a per-device last-read marker; a chat the agent spoke last in is unread until
     this device opens it. There is no server-side read state, so two devices can disagree.
  2. The amber edge needs "work was delivered"; the only evidence in `ChatSession` is an
     assistant-last message on a non-`free` chat with `reviewedAt === null`.

## ⛔ Out of scope

- No new dependency, no new `CB_*` key, no daemon change, no contract change, no migration.
- No route change, no `app.routes.ts`, `app.config.ts`, `main.ts` or `angular.json` edit.
- No edit to `apps/app/src/styles.css`, `src/theme/variables.css` or `src/assets/i18n/*.json`.
- No edit to `features/chat/chat.api.ts`, `chat.store.ts`, `chat.page.ts`,
  `chat.page.spec.ts`, `markdown.ts`, `chat-stream.ts` or their specs (Task-57).
- No `features/repos/**`, `features/schedules/**`, `features/chat/new-chat.*`,
  `features/chat/context-sheet.*`, `features/chat/schedule-propose.*` (Tasks 59-61).
- No `/chat/new` route, no repository picker, no schedule filter screen, no context sheet, no
  `Compact`, no `Promote`, no archived/unarchive action, no infinite scroll or cursor
  pagination (one page of 50).
- No percentage or threshold rendering for context (that is the context sheet, D48).
- No refactor of a file this task did not have to touch; no comment that restates the code.

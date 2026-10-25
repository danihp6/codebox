# Spec: Task-20 — Chat

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (Angular 22 + Ionic 9, standalone components, signals, zoneless). UI only:
  no daemon, no contract change, no new dependency.
- **Role:** Dev.
- **Objective:** `/chat` becomes a real session list (sessions grouped by repository, a repo filter,
  a "new chat" action) and `/chat/:id` becomes the product's front door: a streaming message list
  with markdown and code blocks, tool cards, permission cards that disable after a reply, a composer
  that stays usable while the agent works, a stop button, and "promote to run" that opens the new
  run. Deltas append in order and a reconnect never duplicates a message.
- **Environment:** worktree `../wt-cb-20`, branch `task-20`, base `main`.
- **Dependencies:** Task-18 (merged). Files it produced that this task reads and must not modify:
  `apps/app/src/app/app.routes.ts` (already lazy-loads `ChatListPage` and `ChatPage`),
  `core/api/api-client.ts` (`ApiClient`, `ApiError`), `core/api/http.ts` (`API_BASE_URL`,
  `API_PREFIX`), `core/events/sse.service.ts` (`SseService.event`), `core/events/events.ts`,
  `core/i18n/i18n.service.ts`, `core/auth/secure-store.ts` (`SECURE_STORE`),
  `src/theme/variables.css`, `src/styles.css`, `features/run-detail/*` (store + page + spec
  reference).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/app/features/chat/**`

`apps/app/src/app/app.routes.ts` is a hot file owned by Task-18: this task never edits it.
`apps/app/README.md`, `src/assets/i18n/*.json` and `apps/app/package.json` are outside this task
(see Coordination).

### Inputs (read-only)

- `apps/app/src/app/app.routes.ts`, `app.config.ts`, `app.routes.spec.ts`
- `apps/app/src/app/core/api/api-client.ts`, `core/api/api-client.spec.ts`, `core/api/http.ts`
- `apps/app/src/app/core/events/sse.service.ts`, `sse-client.ts`, `events.ts`
- `apps/app/src/app/core/i18n/i18n.service.ts`, `core/settings/settings.store.ts`,
  `core/auth/secure-store.ts`
- `apps/app/src/app/features/run-detail/run-detail.store.ts`, `run-detail.store.spec.ts`,
  `run.page.ts`, `run.page.spec.ts`, `timeline.ts`
- `apps/app/src/theme/variables.css`, `apps/app/src/styles.css`
- `packages/contracts/src/index.ts`, `resources.ts`, `events.ts`, `primitives.ts`, `pagination.ts`
- `docs/app.md` §4, §5, §7, §8, §9, §12; `docs/api.md` §5.5, §5.6, §6

## 🔒 Contract

### Placeholders become real, in place

Rewrite the **content** of the two existing files. Keep the file path, the exported class name and
the selector, because `app.routes.ts` imports them by name and `app.routes.spec.ts` resolves every
lazy loader:

| File | Exported class | Selector | Root `data-testid` |
| --- | --- | --- | --- |
| `features/chat/chat-list.page.ts` | `ChatListPage` | `app-chat-list-page` | `page-chat` |
| `features/chat/chat.page.ts` | `ChatPage` | `app-chat-page` | `page-chat-detail` |

`ChatPage` reads its id like `RunDetailPage`: `readonly id = input.required<string>();`.

### Existing surface this task consumes — do not re-declare, do not extend

```ts
// core/api/api-client.ts
class ApiClient { /* this task calls none of its members; see below */ }
class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | null;
}
// core/events/sse.service.ts
class SseService { readonly event: Signal<SseStreamEvent | null>; }
// core/i18n/i18n.service.ts
class I18nService { readonly locale: Signal<'en' | 'es'>; }
// core/api/http.ts
const API_BASE_URL: string; // ''
const API_PREFIX: string;   // '/v1'
```

`ApiClient` has no chat method, so this task does **not** inject it: every `/v1/chat` call goes
through `ChatApi` below, built on `HttpClient`. The bearer token is attached by
`authInterceptor` — never read `AuthStore` here.

### New surface this task creates

**`features/chat/chat.api.ts`**

```ts
import type {
  Approval, ChatMessage, ChatSession, Page, Repo, Run,
} from '@codebox/contracts';

export interface ApprovalReply {
  readonly decision: 'allow' | 'deny';
  readonly scope: 'once' | 'session';
}

@Injectable({ providedIn: 'root' })
export class ChatApi {
  constructor(http: HttpClient);
  listSessions(query?: { repoId?: string; limit?: number; cursor?: string }): Observable<Page<ChatSession>>;
  getSession(id: string): Observable<ChatSession>;
  createSession(body: { repoId: string; title?: string }): Observable<ChatSession>;   // 201
  listMessages(id: string, query?: { limit?: number; cursor?: string }): Observable<Page<ChatMessage>>;
  send(id: string, text: string): Observable<ChatMessage>;                            // 202, the user message
  interrupt(id: string): Observable<ChatSession>;
  promote(id: string, idempotencyKey: string, body?: { title?: string }): Observable<Run>; // 202
  listRepos(): Observable<Page<Repo>>;                                                // GET /v1/repos
  replyApproval(approvalId: string, body: ApprovalReply): Observable<Approval>;       // POST /v1/approvals/{id}/reply
}
```

Exact routes and parsing:

| Method | Route | Parser |
| --- | --- | --- |
| `listSessions` | `GET /v1/chat/sessions?repoId=&limit=&cursor=` | `parsePage(chatSessionSchema, body, 'chat.sessions')` |
| `getSession` | `GET /v1/chat/sessions/{id}` | `parseChatSession` |
| `createSession` | `POST /v1/chat/sessions` | `parseChatSession` |
| `listMessages` | `GET /v1/chat/sessions/{id}/messages?limit=&cursor=` | `parsePage(chatMessageSchema, body, 'chat.messages')` |
| `send` | `POST /v1/chat/sessions/{id}/messages` `{ text }` | `parseChatMessage` |
| `interrupt` | `POST /v1/chat/sessions/{id}/interrupt` (no body) | `parseChatSession` |
| `promote` | `POST /v1/chat/sessions/{id}/promote` `{ title? }` + header `Idempotency-Key` | `parseRun` |
| `listRepos` | `GET /v1/repos?limit=200` | `parsePage(repoSchema, body, 'repos')` |
| `replyApproval` | `POST /v1/approvals/{id}/reply` `{ decision, scope }` | `parseApproval` |

Never import `zod` (not a dependency of `@codebox/app`). Optional properties are omitted, never set
to `undefined` (`exactOptionalPropertyTypes`). Every failure maps to `ApiError` through one
non-exported `toApiError(error)` in this file: pass an `ApiError` through; for an
`HttpErrorResponse` parse `errorEnvelopeSchema` into `{ code, message, requestId, details }`,
falling back to `code: 'internal'` (`'unauthorized'` for 401) and the `x-request-id` header; for
anything else `code: 'network'`, `status: 0`. Do not import the helper from another feature folder.

**`features/chat/chat-stream.ts`** (pure — no Angular, no clock, no network)

```ts
import type { ChatMessage, Page, SseStreamEvent } from '@codebox/contracts';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatStreamItem {
  readonly key: string;              // 'msg:<id>' for a server message, 'stream:<chatId>' for the open buffer
  readonly role: ChatRole;
  readonly text: string;
  readonly messageId: string | null;
  readonly createdAt: string | null; // null for the open buffer
}

export interface ChatToolCard {
  readonly key: string;              // 'tool:<seq>'
  readonly tool: string;
  readonly status: 'start' | 'ok' | 'error';
  readonly detail: string;
  readonly seq: number;
}

export interface ChatPermissionCard {
  readonly key: string;              // 'permission:<approvalId>'
  readonly approvalId: string;
  readonly tool: string;
  readonly title: string;
  readonly answered: boolean;
}

export interface ChatStreamState {
  readonly messages: readonly ChatStreamItem[];
  readonly tools: readonly ChatToolCard[];
  readonly permissions: readonly ChatPermissionCard[];
  readonly working: boolean;
  readonly lastSeq: number;
}

export const EMPTY_CHAT: ChatStreamState;

export function applyChatEvent(state: ChatStreamState, chatId: string, event: SseStreamEvent): ChatStreamState;
export function mergeMessages(state: ChatStreamState, page: Page<ChatMessage>): ChatStreamState;
export function appendMessage(state: ChatStreamState, message: ChatMessage): ChatStreamState;
export function markPermissionAnswered(state: ChatStreamState, approvalId: string): ChatStreamState;
```

Reducer rules, in this order:

| Event | Effect |
| --- | --- |
| anything whose `data.chatId !== chatId` | return the state unchanged |
| `gap` | return the state unchanged (the store refetches; never stitch) |
| `chat.delta` with `data.seq <= state.lastSeq` | return the state unchanged (the reconnect guard) |
| `chat.delta` | append `delta` to the item keyed `stream:<chatId>` (create it with `role: 'assistant'` if absent), set `working: true`, `lastSeq = seq` |
| `chat.message` | upsert by `data.message.id`: replace the open buffer when `role === 'assistant'` (drop `stream:<chatId>`), otherwise insert; `lastSeq = max(lastSeq, seq)` |
| `chat.tool` | upsert by `key = 'tool:' + seq` |
| `chat.permission` | upsert by `approvalId`, `answered: false` |
| `chat.idle` | `working: false`, `lastSeq = max(lastSeq, seq)` |
| `approval.resolved` with a `approvalId` already in `permissions` | `answered: true` |
| any other event | unchanged |

`mergeMessages` inserts every message whose id is not already present, then keeps `messages` ordered
by `createdAt` (string compare, tie-break by `id`). Merging the same page twice changes nothing.
`appendMessage` is `mergeMessages` for one message. `markPermissionAnswered` flips one card and is
idempotent.

**`features/chat/markdown.ts`** (pure)

```ts
export type MarkdownBlock =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'code'; readonly language: string; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] };

export function parseMarkdown(text: string): readonly MarkdownBlock[];
```

Rules: a fenced block ```` ```lang ... ``` ```` becomes `{ kind: 'code', language, text }` with the
fence lines removed and the inner text verbatim; consecutive lines starting with `- ` or `* `
become one `list` block with the markers stripped; blank lines separate `paragraph` blocks; every
other line joins the current paragraph with `\n`. **No HTML is produced or interpreted** — markup
in model output stays text, and the template binds it with `{{ }}`. Links and inline emphasis are
out of scope.

**`features/chat/chat-list.store.ts`**

```ts
@Injectable()
export class ChatListStore {
  readonly sessions: Signal<readonly ChatSession[]>;
  readonly repos: Signal<readonly Repo[]>;
  readonly repoFilter: Signal<string | null>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<ApiError | null>;
  readonly creating: Signal<boolean>;
  load(): void;                              // listRepos() + listSessions()
  setRepoFilter(repoId: string | null): void; // reload sessions with ?repoId=
  startChat(): void;                          // createSession({repoId: repoFilter() ?? repos()[0].id}) then navigate /chat/:id
  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored'; // chat.message updates a row's lastMessage
}
```

`startChat()` does nothing when `repos()` is empty (the button is disabled) and never creates a
session optimistically: it navigates only after the `201` returns the id.

**`features/chat/chat.store.ts`**

```ts
@Injectable()
export class ChatStore {
  readonly chatId: Signal<string | null>;
  readonly session: Signal<ChatSession | null>;
  readonly stream: Signal<ChatStreamState>;
  readonly draft: Signal<string>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<ApiError | null>;
  readonly busy: Signal<'send' | 'interrupt' | 'promote' | null>;
  readonly canPromote: Signal<boolean>;     // last message is an assistant message and working() === false
  readonly canInterrupt: Signal<boolean>;   // stream().working === true
  load(chatId: string): void;               // getSession + listMessages({limit: 100})
  reload(): void;
  setDraft(text: string): void;
  send(): void;                             // no-op on an empty draft or a busy store
  interrupt(): void;
  promote(): void;                          // Idempotency-Key `promote-<chatId>-<counter>`, then navigate /runs/:id
  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored' | 'refetch';
  resolvePermission(approvalId: string, reply: ApprovalReply): void; // POST, then markPermissionAnswered on success
}
```

`send()` keeps the draft until the `202` returns the persisted user message, then clears it and
appends that message (never an optimistic copy). `applyStreamEvent` returns `'refetch'` on `gap`.
`resolvePermission` does not touch `busy` (the three values are for send, interrupt and promote) and
never optimistically marks the card: the card disables on the response, and on error it stays live
with `error()` set.

**`features/chat/i18n.ts`** — the batch convention, identical in shape to Task-19's:

```ts
export type Locale = 'en' | 'es';
export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>>;
export function translate(locale: Locale, key: string): string; // returns `key` when missing
```

Flat keys prefixed `chat.`. In a page:

```ts
private readonly i18n = inject(I18nService);           // declared BEFORE `t`
readonly t = (key: string): string => translate(this.i18n.locale(), key);
```

The dictionaries live here, not in `src/assets/i18n/*.json`: those files are outside this task's
paths and shared with two other tasks in this batch.

### Rendered hooks (exact `data-testid` names QA asserts)

`/chat`: `page-chat` (root), `chat-list-loading`, `chat-list-error` (`data-code`), `repo-filter`
(one `repo-option` per repo with `data-repo-id`), `chat-new` (button), `chat-row` (one per session,
`data-chat-id`, `data-status`), `chat-row-last` (the last-message preview), `chat-empty`,
`chat-list-retry`.

`/chat/:id`: `page-chat-detail` (root, `data-status`), `chat-loading`, `chat-error` (`data-code`),
`chat-message` (one per item, `data-key`, `data-role`), `chat-code` (a code block, `data-language`),
`chat-list-block`, `chat-tool` (`data-tool`, `data-status`), `chat-permission`
(`data-approval-id`), `permission-allow-once`, `permission-allow-session`, `permission-deny`,
`composer-input` (a `<textarea>`), `composer-send`, `composer-stop`, `chat-promote`, `chat-idle`
(present when `working()` is false), `chat-message-empty`.

## 🧩 Configuration

None. No `CB_*` key, no change to `apps/app/package.json`.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`.
  - `npm run lint` — must pass.
  - `npm test` — the root Vitest projects (packages, daemon, ops); must stay green.
  - `npm test -w @codebox/app` — `ng test --watch=false` (Vitest + jsdom) over
    `apps/app/src/**/*.spec.ts`, including the specs this task adds. The root `npm test` does not
    include `apps/app`.
  - `npm run build` — the root build (`@codebox/contracts` prebuild + `ng build`).
  - `git diff --name-only main...task-20` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` Lint, both test suites and the build are green.
  - [ ] `[unit]` `chat-stream.spec.ts`: three `chat.delta` frames with `seq` 1, 2, 3 append in order
    into one `stream:chat_x` item whose text is the concatenation; replaying `seq` 2 changes nothing;
    a `chat.delta` for `chat_other` is ignored; `chat.message` replaces the buffer with the server
    message (`key === 'msg:<id>'`, buffer gone); `mergeMessages` with the same page twice keeps the
    length constant; `gap` returns the identical state object; `chat.idle` clears `working`;
    `approval.resolved` marks only the matching card.
  - [ ] `[unit]` `markdown.spec.ts`: `"```ts\nconst a = 1;\n```"` is one `code` block with
    `language === 'ts'` and the inner text verbatim; `"- a\n- b"` is one `list` with `['a','b']`;
    two paragraphs separated by a blank line are two `paragraph` blocks; `"<b>hi</b>"` is a
    `paragraph` whose text is exactly `"<b>hi</b>"` (nothing is interpreted).
  - [ ] `[unit]` `chat.api.spec.ts` (HttpTestingController): `send` posts `{ text: 'hi' }` to
    `/v1/chat/sessions/chat_1/messages` and returns the parsed `ChatMessage`; `promote` posts to
    `/v1/chat/sessions/chat_1/promote` **with** an `Idempotency-Key` header and parses a `Run`;
    `replyApproval` posts `{ decision: 'allow', scope: 'session' }` to
    `/v1/approvals/apv_1/reply`; a 409 envelope becomes an `ApiError` with `details.reason ===
    'approval_already_answered'`; `listSessions({repoId:'repo_1'})` requests
    `/v1/chat/sessions?repoId=repo_1`.
  - [ ] `[unit]` `chat.store.spec.ts`: `send()` on a draft issues one POST and does not clear the
    draft before the flush; after the `202` the message is appended and the draft is empty;
    `canInterrupt()` is false until a delta sets `working`; `promote()` sends once, with an
    `Idempotency-Key`, and navigates to `['/runs', <new id>]` only after the response;
    `resolvePermission` on an error leaves the card un-answered and sets `error()`.
  - [ ] `[unit]` `chat.page.spec.ts` (fake `SseService` = a `signal`, `provideIonicAngular()`, a
    memory `SECURE_STORE`): a permission frame renders `chat-permission` with three enabled buttons;
    clicking `permission-allow-session` sends `{decision:'allow',scope:'session'}`, and after the
    response all three buttons are `disabled`; clicking again sends nothing. With
    `stream().working === true` the `composer-input` is **not** disabled and `composer-stop` is
    present; `chat-idle` is absent. A code block renders `chat-code` with `data-language`.
  - [ ] `[unit]` `chat-list.page.spec.ts`: renders one `chat-row` per session with `data-status`;
    `chat-empty` for an empty page; choosing a `repo-option` requests
    `/v1/chat/sessions?repoId=<id>`; `chat-new` with no repos is `disabled`.
  - [ ] `[unit]` Dictionary parity for `chat/i18n.ts`: `STRINGS.en` and `STRINGS.es` share one key
    set, no empty value, and every key the templates use resolves
    (`translate(locale, key) !== key`).
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
    `git diff --name-only main...task-20` lists only files under
    `apps/app/src/app/features/chat/`. In particular `apps/app/src/app/app.routes.ts`,
    `apps/app/src/assets/i18n/en.json`, `apps/app/src/assets/i18n/es.json`,
    `apps/app/package.json` and `apps/app/README.md` must not appear.
  - [ ] `[live]` **Reported as `[?]`, never as passing in CI.** No browser and no daemon on a
    GitHub Actions runner. Measurement on the box with the app served by the daemon and a real
    session: send a prompt whose answer is about 200 tokens and, with the message list's
    `scrollHeight` sampled every animation frame, the composer's
    `getBoundingClientRect().top` moves by **less than 1 px** for the whole stream and the textarea
    accepts input while `data-status="working"`. Paste the Playwright trace (or a screen recording
    with the composer visible) and the maximum measured delta into the QA report. This one is
    measurable today: `/v1/chat/sessions/**` is implemented in `apps/daemon/src/chat/routes.ts`.

## 📣 Coordination

- **For the Architect:** `ApiClient` has no chat or approval method, and this task may not edit
  `core/api/api-client.ts`; `ChatApi` therefore lives in the feature folder and is the only HTTP
  surface here. It also carries `listRepos()` because the repo switcher needs `GET /v1/repos` and
  this task must not depend on Task-19's `ReposApi` (same batch, parallel). When a later task owns
  `core/api/**`, these collapse into `ApiClient` — do not keep two copies.
- **For the Architect:** `GET /v1/repos` is documented (`docs/api.md` §5.2) but **not implemented**
  in `apps/daemon/src/app.ts`. The repo filter and "new chat" degrade to an empty `repos()` and a
  disabled button; the `[live]` criterion above does not depend on it (the session can be opened by
  URL). No unit test may assume that route exists on a real daemon.
- **For Task-36 (routines UI, Batch 9):** the chat screen is where a routine confirmation card will
  land; keep `chat-message` items keyed by `data-key` so a card can be added without re-keying the
  list. A routine badge is not in this task.
- **For the batch owner, once, after the merge:** `apps/app/README.md` needs one line per new file
  (`chat.api.ts`, `chat.api.spec.ts`, `chat-list.page.spec.ts`, `chat-list.store.ts`,
  `chat-list.store.spec.ts`, `chat.page.spec.ts`, `chat.store.ts`, `chat.store.spec.ts`,
  `chat-stream.ts`, `chat-stream.spec.ts`, `i18n.ts`, `markdown.ts`, `markdown.spec.ts`), replacing
  the two placeholder lines. This task must not touch that file (three tasks in this batch add
  files to the same map).
- **For QA:** mount pages with `provideIonicAngular()`, a memory `SECURE_STORE` stub and a fake
  `SseService` (`{ event: signal(...) }`). The pages own the **real** stores, so also provide
  `provideHttpClient()` + `provideHttpClientTesting()` and flush every request with
  `HttpTestingController` (the pattern in `features/run-detail/run-detail.store.spec.ts`); do not
  hand-write a fake `ChatApi`. No test may open a real `EventSource` or a real `fetch`.

## ⛔ Out of scope

- No syntax highlighter and no new dependency: code blocks are `<pre><code class="cb-mono">` with
  the language as a label. `docs/app.md` §8's "lazy-loaded highlighter" is deferred; say so in the
  report rather than adding a package.
- No inline markdown (emphasis, links, images) and no `innerHTML` anywhere: model output is data,
  never markup.
- No chat history persistence on the device (D36) and no offline queue.
- No message pagination UI beyond the first page of 100; no "load older".
- No archive/delete session UI; no unread counter.
- No change to `app.routes.ts`, `main.ts`, `app.config.ts`, `angular.json`, `package.json`,
  `package-lock.json`, `packages/contracts/**`, `src/assets/i18n/*.json`.
- No approvals inbox screen (`features/approvals/**` belongs to no task in this batch).
- No edit to `CHANGELOG.md` or `TODO.md` (the Orchestrator owns both).

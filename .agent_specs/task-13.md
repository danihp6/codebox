# Spec: Task-13 — Chat API and event bridge

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** daemon.
- **Role:** Dev.
- **Objective:** after this task the daemon serves `docs/api.md` §5.6 (every chat session and
  message route except `promote`) and §6 (`GET /v1/events`, the one SSE stream), backed by the
  merged `store.chats` / `store.events` repositories and a chat pump that maps OpenCode events
  into `chat.*` rows. A chat session is durable: it is bound to a repo, owns one worktree and one
  OpenCode session, accepts messages while the agent works, can be interrupted, and turns a
  permission request into exactly one approval row. Two devices reading the same stream see the
  same delta, and a reconnect replays exactly the events it missed.
- **Environment:** worktree `../wt-cb-13`, branch `task-13`, base `main`.
- **Dependencies (all merged):**
  - Task-03 `@codebox/contracts` — `chatSessionSchema`, `chatMessageSchema`, the `chat.*` and
    `gap` event schemas, `SSE_RETRY_MS`, `SSE_HEARTBEAT_SECONDS`, the error envelope.
  - Task-04 `@codebox/store` — `Store`, `EventRecord`, `ChatRepository`, `ApprovalRepository`.
  - Task-05 `@codebox/core` — `decidePermission`, `classifyTool`.
  - Task-06 `@codebox/security` — `hasScope`.
  - Task-07 `@codebox/opencode` — `AgentRuntime`, `RawAgentEvent`, `createAgentRuntime`.
  - Task-08 `@codebox/workspaces` — `WorkspaceManager`, `createWorkspaceManager`.
  - Task-11 `apps/daemon/src/modules.ts` (the `createModule` seam), `logger.ts`, `app.ts`.
  - Task-12 `apps/daemon/src/auth/index.ts` — `authenticatedDevice`, the one `/v1/*` bearer
    middleware.

### Exclusive paths (single writer)

Only these paths. Nothing else. `src/chat/**` and `src/events/**` are yours alone in this batch;
no other task may create, import or modify a file in them.

- `apps/daemon/src/chat/index.ts` — the subsystem module (`createModule`).
- `apps/daemon/src/chat/service.ts` — the chat service: session lifecycle, message append,
  prompt, interrupt, the pump, approval delivery.
- `apps/daemon/src/chat/routes.ts` — the §5.6 handlers and their request/query schemas.
- `apps/daemon/src/chat/ids.ts` — the only `chat_` / `msg_` id generators.
- `apps/daemon/src/chat/errors.ts` — `ChatError` and its envelope mapping.
- `apps/daemon/src/chat/README.md` — the file map.
- `apps/daemon/src/chat/service.test.ts`, `apps/daemon/src/chat/routes.test.ts`,
  `apps/daemon/src/chat/ids.test.ts`.
- `apps/daemon/src/events/index.ts` — the SSE subsystem module.
- `apps/daemon/src/events/bridge.ts` — `SseBridge`: read-after-id, gap detection, heartbeat,
  filters, terminal close.
- `apps/daemon/src/events/frames.ts` — pure frame formatting (`retry`, `id`, `event`, `data`,
  heartbeat comment).
- `apps/daemon/src/events/notifier.ts` — the in-process wake-up shared by chat and the bridge.
- `apps/daemon/src/events/limits.ts` — the per-device connection limiter.
- `apps/daemon/src/events/routes.ts` — the `GET /v1/events` handler.
- `apps/daemon/src/events/README.md` — the file map.
- `apps/daemon/src/events/bridge.test.ts`, `apps/daemon/src/events/frames.test.ts`,
  `apps/daemon/src/events/routes.test.ts`, `apps/daemon/src/events/limits.test.ts`.
- `apps/daemon/README.md` — **hot file, you alone**: additive lines only, inserted immediately
  after the `src/app.ts` line of the `## Files` list, in the same style. Do not reorder, delete
  or edit any other line, and do not touch `## Notes`.
- `docs/api.md` — **section 5.6 Chat only**. §6 belongs to nobody in this batch: it needs **no**
  change. If you believe §6 must change, stop and report a block instead of editing it.

Explicitly not yours: `apps/daemon/src/main.ts`, `modules.ts`, `app.ts`, `run/**`, `gate/**`,
`auth/**`, `jobs/**`, `runs/**`, `cli/**`, `apps/app/**`, `packages/**`, `TODO.md`,
`CHANGELOG.md`, `docs/decisions.md`, `docs/providers.md`, `package.json`,
`package-lock.json`, `tsconfig.base.json`, `opencode.json`.

### Inputs (read-only)

Beyond `AGENTS.md` and this spec:

- `docs/api.md` §1–§4, §5.6, §6, §7, §9.
- `docs/agent-runtime.md` §2, §4, §6, §8.
- `docs/security.md` — the scope table and the redaction rule.
- `packages/contracts/src/{index,resources,events,primitives,pagination,errors,parse}.ts`.
- `packages/store/src/{index,store,chats,events,approvals,mappers,cursor,errors}.ts`.
- `packages/opencode/src/{index,types,normalise}.ts`.
- `packages/workspaces/src/{index,types,paths}.ts`.
- `packages/core/src/{index,permissions}.ts`.
- `apps/daemon/src/{modules,app,logger,auth/index,auth/errors,auth/routes.test,run/events}.ts`.
- `apps/daemon/src/run/modules.test.ts` — the seam this task must keep green (see Contract).

## 🔒 Contract

The module seam is fixed by `apps/daemon/src/modules.ts`: `src/chat/index.ts` and
`src/events/index.ts` must each export `createModule(context)` and nothing else is imported by
the loader.

```ts
// apps/daemon/src/chat/index.ts
import type { DaemonContext, DaemonModule } from '../modules.js';
export function createModule(context: DaemonContext): DaemonModule;
```

```ts
// apps/daemon/src/events/index.ts
export function createModule(context: DaemonContext): DaemonModule;
```

**Register must not do I/O and must not throw.** `apps/daemon/src/run/modules.test.ts:63`
boots the real tree with the default test env (no GitHub credentials, no OpenCode listener,
`appDir` absent) and asserts `report.failed` is empty. So: build the OpenCode client, the
workspace manager, the poll timers and every claim lazily, on first use, and `unref()` every
timer. `createModule(context)` returning a module whose `register` only mounts routes is the
required shape.

```ts
// apps/daemon/src/chat/service.ts
import type { AgentRuntime, RawAgentEvent } from '@codebox/opencode';
import type { WorkspaceManager } from '@codebox/workspaces';
import type { ChatMessage, ChatSession } from '@codebox/contracts';

export type ChatAgent = Pick<
  AgentRuntime,
  'createSession' | 'prompt' | 'subscribe' | 'interrupt' | 'replyPermission' | 'closeSession'
>;
export type ChatWorkspaces = Pick<
  WorkspaceManager,
  'ensureClone' | 'createWorktree' | 'removeWorktree'
>;

export interface CreateChatServiceOptions {
  readonly context: DaemonContext;
  readonly agent?: ChatAgent;             // default: lazily createAgentRuntime(...)
  readonly workspaces?: ChatWorkspaces;   // default: lazily createWorkspaceManager(...)
}

export interface SendMessageInput {
  readonly chatId: string;
  readonly text: string;
}

export interface ChatService {
  /** Appends the user message and queues the prompt; returns the stored message. */
  send(input: SendMessageInput): Promise<ChatMessage>;
  /** Joins the pump for one chat; resolves when the agent reports idle. Never throws. */
  pump(chatId: string): Promise<void>;
  /** One pump step: reads pending approvals and delivers a reply. Public for tests. */
  tick(): Promise<void>;
  /** Interrupts the agent, marks the session idle, appends `chat.idle`. */
  interrupt(chatId: string): Promise<ChatSession>;
  /** Creates the worktree and the OpenCode session for a stored chat row. */
  prepare(chatId: string): Promise<ChatSession>;
  /** Clears timers and stops every pump; idempotent. */
  stop(): void;
}

export function createChatService(options: CreateChatServiceOptions): ChatService;
```

```ts
// apps/daemon/src/chat/routes.ts
export function registerChatRoutes(app: DaemonApp, service: ChatService): void;
```

Routes (all under the auth middleware registered by the `auth` module; `docs/api.md` §5.6):

| Method | Path | Scope | Success | Body out |
| --- | --- | --- | --- | --- |
| `GET` | `/v1/chat/sessions?repoId=&limit=&cursor=` | `read` | 200 | `Page<ChatSession>` |
| `POST` | `/v1/chat/sessions` | `chat` | 201 | `ChatSession` |
| `GET` | `/v1/chat/sessions/{id}` | `read` | 200 | `ChatSession` |
| `DELETE` | `/v1/chat/sessions/{id}` | `chat` | 200 | `ChatSession` (`status: "archived"`) |
| `GET` | `/v1/chat/sessions/{id}/messages?limit=&cursor=` | `read` | 200 | `Page<ChatMessage>` |
| `POST` | `/v1/chat/sessions/{id}/messages` | `chat` | 202 | `ChatMessage` (the stored user message) |
| `POST` | `/v1/chat/sessions/{id}/interrupt` | `chat` | 200 | `ChatSession` (`status: "idle"`) |

`POST /v1/chat/sessions/{id}/promote` is **not this task**: the routes module of Task-15 owns it
because only the run engine may start a run, and a task may not import a file a batch-mate
produces. Do not register the path, do not edit its §5.6 row, do not implement it.

The auth middleware enforces `read` on every `GET` and nothing else; the `chat` scope on the
four mutating chat routes is **your** job, using the same rejection shape as
`apps/daemon/src/auth/middleware.ts`: `403 forbidden`, `details.reason = "insufficient_scope"`.

Request bodies, frozen (strict objects, unknown field ⇒ 422 `validation_failed` with
`details.path`):

```ts
// boundary strings are exactly these
createSession: { repoId: RepoId, title?: string }          // boundary 'chat.session'
sendMessage:   { text: string }                            // 1..32000 chars, boundary 'chat.message'
listSessions:  { repoId?: RepoId, limit: number, cursor?: string }  // boundary 'chat.sessions'
listMessages:  { limit: number, cursor?: string }          // boundary 'chat.messages'
```

- `title` defaults to `"New chat"`; the contract rejects an empty title.
- `text` is trimmed for the emptiness check but stored verbatim; the limit is 32 000 characters.
- Errors, exactly:
  - unknown session id on any `{id}` route → `404 not_found`, `details.path = "chat.id"`.
  - unknown `repoId` on create → `404 not_found`, `details.path = "chat.repoId"`.
  - message or interrupt on an archived session → `409 conflict`,
    `details.reason = "chat_archived"`.
  - interrupt when the stored status is not `working` → `409 conflict`,
    `details.reason = "chat_not_working"`.
  - OpenCode unreachable on create or on the first prompt → `502 agent_unavailable`,
    `details.reason = "agent_unavailable"`; the session row is kept with
    `opencodeSessionId = null` and status `idle`.
  - bad cursor (`decodeCursor` throws `StoreError('invalid_row')`) → `422 validation_failed`,
    `details.path = "chat.cursor"`.
  - missing/foreign device → the auth middleware's `401`; never a second 401 from your code.

Ordering, frozen. For one chat, every event you append takes `seq = store.events.nextSeq({ chatId })`
and `ts = context.clock().toISOString()`. A message round is:

1. `chat.message` — `{ chatId, seq, ts, message }`, `message.role = "user"`.
2. zero or more `chat.delta` — `{ chatId, seq, ts, delta }`, one per OpenCode text chunk.
3. zero or more `chat.tool` — `{ chatId, seq, ts, tool, status, detail? }`.
4. zero or more `chat.permission` — `{ chatId, seq, ts, approvalId, tool, title }`; the
   corresponding `approval.created` follows immediately, in the same transaction.
5. `chat.message` — the assembled assistant message, `role = "assistant"`, written only when
   the assembled text is non-empty.
6. `chat.idle` — `{ chatId, seq, ts }`, last.

`seq` is strictly increasing per chat with no gaps for a single event type; the assertion in
the plan is "strictly increasing across the whole chat stream".

```ts
// apps/daemon/src/events/bridge.ts
import type { SseEventName } from '@codebox/contracts';
import type { Store } from '@codebox/store';

export interface SseFilter {
  readonly types?: readonly SseEventName[];
  readonly runId?: string;
  readonly chatId?: string;
}

export type SseFrame =
  | { readonly kind: 'event'; readonly id: number; readonly event: SseEventName;
      readonly data: Readonly<Record<string, unknown>> }
  | { readonly kind: 'gap'; readonly afterId: number; readonly latestId: number;
      readonly ts: string }
  | { readonly kind: 'heartbeat' };

export interface SseBridgeOptions {
  readonly store: Store;
  readonly clock: () => Date;
  readonly notifier?: EventNotifier;   // default: eventNotifier(context)
  readonly pollMs?: number;            // default 1000
  readonly batchSize?: number;         // default 200
  readonly heartbeatSeconds?: number;  // default SSE_HEARTBEAT_SECONDS (15)
  readonly hardCloseSeconds?: number;  // default 90
  readonly wait?: (ms: number) => Promise<void>; // tests inject a no-op
}

export interface SseSession {
  /** Frames already available after `afterId`, in global id order, filter applied. */
  readonly next: () => readonly SseFrame[];
  /** True once the stream must end (terminal run event on a `runId` filter, hard close). */
  readonly done: () => boolean;
}

export function createSseBridge(options: SseBridgeOptions): {
  session(input: { afterId: number; filter: SseFilter }): SseSession;
  /** Async frame source used by the HTTP handler; ends when `done()` is true. */
  frames(input: { afterId: number; filter: SseFilter }): AsyncIterable<SseFrame>;
};
```

`next()` semantics, frozen:

- Reads `store.events.readAfterId(afterId, batchSize)`; advances an internal cursor to the last
  returned `id`; filters on `type`, `data.runId`, `data.chatId` **after** reading, so a filtered
  stream never skips an id it needed for cursor arithmetic.
- If `afterId > 0` and the first row's `id > afterId + 1`, the range was pruned: yield exactly
  one `gap` frame `{ afterId, latestId: store.events.latestId(), ts: clock() }` before the rows,
  then continue from the first row. `afterId === 0` never produces a `gap`.
- When no row is readable and `now - lastFrameAt >= heartbeatSeconds * 1000`, yield one
  `heartbeat` frame and reset `lastFrameAt`.
- `done()` becomes true when the filter has a `runId` and a delivered event of type
  `run.finished`, `run.failed` or `run.cancelled` carries that `runId`, or when
  `now - lastEventAt >= hardCloseSeconds * 1000` (docs/api.md §9).

`frames()` awaits `notifier.wait(pollMs)` between `next()` calls (or `wait(pollMs)` when no
notifier was supplied) so a chat append wakes every open stream immediately and the 1 s poll
covers rows written by the run engine. **No real timer may be awaited longer than 5 ms in a
test**: the plan injects `wait` and `clock`.

```ts
// apps/daemon/src/events/frames.ts — pure, no clock, no store
export function retryFrame(retryMs: number): string;        // `retry: 3000\n\n`
export function heartbeatFrame(): string;                   // `: ping\n\n`
export function eventFrame(input: {
  readonly id: number;
  readonly event: string;
  readonly data: unknown;
}): string;                                                 // `id:…\nevent:…\ndata:…\n\n`
export function gapFrame(input: { readonly afterId: number; readonly latestId: number;
  readonly ts: string }): string;                           // id omitted, event: gap
```

`data` is `JSON.stringify`, one line, no trailing spaces. The handler writes
`retryFrame(SSE_RETRY_MS)` first, then one frame per `SseFrame`, and sets
`Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache`,
`Connection: keep-alive`, `X-Accel-Buffering: no`.

```ts
// apps/daemon/src/events/notifier.ts
export interface EventNotifier {
  notify(): void;
  wait(ms: number): Promise<void>;
}
export function eventNotifier(context: DaemonContext): EventNotifier; // one per context
```

`eventNotifier` is a `WeakMap<DaemonContext, EventNotifier>` keyed by the context object, the
pattern `apps/daemon/src/auth/middleware.ts:124` already uses. The chat service calls
`notify()` after each committed append batch.

```ts
// apps/daemon/src/events/limits.ts
export const SSE_CONNECTIONS_PER_DEVICE = 3;      // docs/api.md §7
export interface ConnectionLimiter {
  open(deviceId: string): () => void;             // returns the release function
  count(deviceId: string): number;
}
export function createConnectionLimiter(limit?: number): ConnectionLimiter;
```

Over the limit the route answers `429 rate_limited` with `Retry-After: 60` and
`details.reason = "sse_limit"`; the release function must be called in a `finally`, so a closed
stream frees its slot (tested).

### Data

- Rows: `chat_sessions` (`id, repo_id, title, status, opencode_session_id, worktree, created_at,
  updated_at`) and `chat_messages` (`id, chat_id, role, text, origin, created_at`) as the merged
  migration defines them. `origin` is `'user'` or `'assistant'`; `'routine'` is Task-35's.
- The worktree: `createWorktree({ repo, runId: chatId, baseRef: repo.defaultBranch, title })` —
  the chat id occupies the `runId` slot of the workspace manager (its only naming input), so the
  branch is `cb/<chatId>-<slug>` and the directory is that branch's worktree. A chat worktree is
  never removed on archive; retention prunes it.
- Events: one `run_events` row per chat event with `run_id = NULL`, `chat_id` set, `seq` set.
- Ids: `chat_` plus 20 Crockford base32 characters for `ChatId`; `msg_` plus 20 for
  `MessageId` (the `idSchema` regex is `^prefix[0-9A-Za-z]{6,40}$`). One generator each, in
  `src/chat/ids.ts`, with an injectable `random` for tests, mirroring
  `apps/daemon/src/auth/ids.ts:12`.
- Approval from a chat permission: `state: "pending"`, `runId: null`, `chatId`, `tool`,
  `title`, `input` = the raw tool input **redacted with `redact` from `@codebox/security`**,
  `createdAt = clock()`, `expiresAt = clock() + CB_APPROVAL_TTL_SECONDS`,
  `resolvedAt: null`, id from `mintApprovalId()` imported from `../run/events.js`.
- `expiresAt` uses `CB_APPROVAL_TTL_SECONDS` (default 600). You add **no** `CB_*` key.

## 🧩 Configuration

No new `CB_*` key. Keys read, with their merged defaults:

| Key | Default | Use |
| --- | --- | --- |
| `CB_OPENCODE_URL` | `http://127.0.0.1:4096` | `createAgentRuntime` base URL. |
| `CB_OPENCODE_TOKEN` | `null` | Bearer for the agent runtime. |
| `CB_OPENCODE_HEALTH_PATH` | `/api/info` | Agent runtime health path. |
| `CB_DEFAULT_AGENT` | `build` | Agent of a chat session. |
| `CB_DEFAULT_MODEL` | `null` | Model of a chat session. |
| `CB_GIT_HTTP_TIMEOUT_SECONDS` | `120` | Git runner timeout. |
| `CB_REPO_ROOT` / `CB_WORKSPACE_ROOT` | `/srv/codebox/repos`, `/srv/codebox/worktrees` | Workspace roots. |
| `CB_CLONE_DEPTH` | `0` | Clone depth. |
| `CB_APPROVAL_TTL_SECONDS` | `600` | Approval `expiresAt`. |

The clone URL for chat is `https://github.com/${repo.slug}.git` (no credential in this task; see
Coordination). Constants, not env: `CHAT_POLL_MS = 500`, `SSE_POLL_MS = 1000`,
`MAX_TEXT_CHARS = 32000`, `SSE_CONNECTIONS_PER_DEVICE = 3`.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; includes the tests this task adds.
  - `npx vitest run --project apps/daemon src/chat` — the chat suite alone.
  - `npx vitest run --project apps/daemon src/events` — the bridge suite alone.
  - `npx vitest run --project apps/daemon src/run/modules` — proves the seam still boots.
  - `npm run build` — `tsc -b` for every workspace.
  - `git diff --name-only main...task-13` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean (`npm run lint`, `npm run build`).
  - [ ] `[unit]` A fixture conversation replays in order with monotonic `seq`:
    `npx vitest run --project apps/daemon src/chat -t 'replays a fixture conversation'`. The
    test drives a fake agent with the script `text("Hel"), text("lo"), tool("edit","ok"),
    idle`; it asserts the stored rows in `store.events.readAfterId(0, 100)` are, for that chat,
    `chat.message` (user) → `chat.delta` ×2 → `chat.tool` → `chat.message` (assistant,
    `text === "Hello"`) → `chat.idle`, and that `seq` is strictly increasing.
  - [ ] `[unit]` An interrupt ends the stream and marks the session idle:
    `npx vitest run --project apps/daemon src/chat -t 'interrupt'`. After
    `POST /v1/chat/sessions/{id}/interrupt` the fake agent recorded `interrupt(sessionId)` once,
    `store.chats.getSession(id).status === 'idle'` and the last event is `chat.idle`.
  - [ ] `[unit]` A permission request becomes exactly one approval and a reply reaches OpenCode:
    `npx vitest run --project apps/daemon src/chat -t 'permission'`. One `permission.updated`
    yields exactly one `approvals` row with `chatId` set and one `chat.permission` event; the
    test then calls `store.approvals.resolve({ state: 'allowed' })`, runs `service.tick()`, and
    asserts the fake agent got `replyPermission(sessionId, permissionId, 'once')`; a second
    `tick()` sends nothing.
  - [ ] `[unit]` Replay is exact: `npx vitest run --project apps/daemon src/events -t 'replay'`.
    With ids 1..5 stored, `afterId: 2` yields exactly ids 3,4,5 and never 1,2; `afterId: 5`
    yields nothing then one `heartbeat` at the injected 15 s boundary.
  - [ ] `[unit]` A pruned range produces one `gap`:
    `npx vitest run --project apps/daemon src/events -t 'gap'`. With rows 1,2 pruned and rows
    3..5 present, `afterId: 1` yields exactly one `gap` frame with
    `afterId: 1, latestId: 5` and then ids 3,4,5.
  - [ ] `[unit]` The per-device limit is 3 and a release frees a slot:
    `npx vitest run --project apps/daemon src/events -t 'connection limit'`. The fourth
    `GET /v1/events` for one device is `429` with `details.reason === "sse_limit"` and
    `Retry-After: 60`.
  - [ ] `[unit]` Filters are honoured: `npx vitest run --project apps/daemon src/events -t 'filter'`
    — `?types=chat.delta&chatId=<id>` returns only that chat's deltas, and a `runId` filter ends
    the stream after the terminal run event.
  - [ ] `[unit]` The §5.6 routes match the contract:
    `npx vitest run --project apps/daemon src/chat -t 'routes'`. Every response body parses with
    `parseChatSession` / `parseChatMessage` / `pageOfChatSession` / `pageOfChatMessage`; unknown
    session `404`; archived session message `409` with reason `chat_archived`; a device without
    the `chat` scope gets `403` with reason `insufficient_scope` on all four mutating routes.
  - [ ] `[unit]` The chat prompt text never reaches the log:
    `npx vitest run --project apps/daemon src/chat -t 'never logs the prompt'`. The logger sink
    captured during a `POST /v1/chat/sessions/{id}/messages` contains none of the message text
    and no `Authorization` value.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched: the `git diff --name-only`
    output lists only `apps/daemon/src/chat/**`, `apps/daemon/src/events/**`,
    `apps/daemon/README.md` and `docs/api.md`.
  - [ ] `[live]` Two devices see the same chat delta within 1.5 s. Measurement: a real daemon on
    the VM, two paired devices (a browser tab and the app), one `POST .../messages`; read
    `performance.now()` in each client at the `chat.delta` with the same `seq`; the spread across
    the two clients is ≤ 1500 ms and both received every `seq` from 1 to N with no duplicate.
    Not run on CI.

## 📣 Coordination

- For the Architect: `promote` moved to the runs routes (Task-15) — the chat module cannot own a
  route that starts a run engine it may not import. The §5.6 row is unchanged.
- For Task-15 (same batch, no shared file): the reply to a chat approval arrives by the store,
  not by an import. `POST /v1/approvals/{id}/reply` must only `store.approvals.resolve(...)` and
  append `approval.resolved`; this module observes the resolved row in `tick()` and calls
  `replyPermission` (`allowed` → `'once'`, `denied` → `'reject'`, `expired` → `'reject'`). The
  chat pump must not read `approval.resolved` events.
- For Task-15: `POST /v1/chat/sessions/{id}/promote` reads `store.chats.getSession(id)`; the
  frozen behaviour to document verbatim in `docs/api.md` §5.6 is: *"Promote starts a new run with
  `trigger: "promote"` from the repository's default branch. The prompt is the text of the last
  `assistant` message of the session; a session with no assistant message is `422` with
  `details.path: "chat.messages"`. The response is `202` with the new `Run`."* Task-13 writes that
  sentence into §5.6; Task-15 implements it.
- For the next batch (Task-20 chat screen): the message list is forward-paginated
  (`created_at ASC`) with `nextCursor` on the last page, not newest-first.
- For Task-16 (notifications): chat approvals are `approval.created` events like run approvals;
  no second event type is introduced.
- No `repos` API exists in this tree; tests seed `store.repos.create(...)` directly.

## ⛔ Out of scope

- No `promote`, no run engine, no worktree cleanup on archive (kept per `CB_RETENTION_CHAT_DAYS`).
- No presence, typing indicator, unread counts or message editing.
- No provider/model switching per message; the session uses `CB_DEFAULT_AGENT` /
  `CB_DEFAULT_MODEL`.
- No new dependency, no new `CB_*` key, no migration, no change to `packages/**`.
- No edit to `docs/api.md` §6, no new `| METHOD | /v1/... |` table row anywhere in
  `docs/api.md` — `packages/contracts/src/openapi.test.ts:99` compares the documented route
  table with the OpenAPI document and fails on any new row.
- No refactor of `app.ts`, `modules.ts`, `auth/**` or `run/**`.

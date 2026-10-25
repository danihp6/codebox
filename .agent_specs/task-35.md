# Spec: Task-35 — Routine engine and the `/v1/routines` surface

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** daemon (a timer, I/O, HTTP routes) + package-level reuse, plus three narrow
  edits in `chat/` and `push/`.
- **Role:** Dev.
- **Objective:** `apps/daemon/src/routines` is a real subsystem: every tick claims the routines
  that are due under the D13 grace rule, a `reminder` becomes exactly one push and nothing else,
  and a `prompt` appends an `origin: routine` message to its chat session (creating the session
  when it has none or the old one is archived), streams the agent's reply through the existing
  chat turn, and pushes one summary at the end. `/v1/routines` lists, reads, patches, pauses,
  resumes, fires once by hand and deletes, all backed by the Task-34 store. A routine never
  creates a `runs` row, a gate or a PR.
- **Environment:** worktree `../wt-cb-35`, branch `task-35`, base `main`.
- **Dependencies:** Task-13 (`apps/daemon/src/chat/service.ts` — the chat turn, the pump and the
  transcript this task reuses and extends), Task-16 (`apps/daemon/src/push/**` — the
  event-driven pump whose mapping this task extends), Task-34 (`routines` and `routine_fires`
  plus the transactional claim). All are merged. No new dependency: the cron arithmetic comes
  from `@codebox/core` and `../jobs/service.js`, not from `@codebox/scheduler`.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims any of them: Task-23 owns `apps/app/src/app/features/settings/**` + `apps/app/README.md`,
Task-27 owns `packages/core`, `packages/store` and `apps/daemon/src/telemetry/**`, Task-28 owns
`packages/security`, `apps/daemon/src/{app,auth,gate,run}`, `ops/vm/systemd/**` and `docs/security.md`,
`docs/api.md` §7, `docs/jobs.md` §5, `docs/decisions.md`.

- `apps/daemon/src/routines/README.md` (new)
- `apps/daemon/src/routines/index.ts` (new)
- `apps/daemon/src/routines/service.ts` (new)
- `apps/daemon/src/routines/tick.ts` (new)
- `apps/daemon/src/routines/fire.ts` (new)
- `apps/daemon/src/routines/routes.ts` (new)
- `apps/daemon/src/routines/tick.test.ts` (new)
- `apps/daemon/src/routines/fire.test.ts` (new)
- `apps/daemon/src/routines/service.test.ts` (new)
- `apps/daemon/src/routines/routes.test.ts` (new)
- `apps/daemon/src/routines/index.test.ts` (new)
- `apps/daemon/src/chat/service.ts` (add `sendRoutine` and the `origin` parameter)
- `apps/daemon/src/chat/service.test.ts`
- `apps/daemon/src/chat/index.ts` (add the `chatServiceFor` accessor)
- `apps/daemon/src/chat/index.test.ts` (new)
- `apps/daemon/src/push/mapping.ts`
- `apps/daemon/src/push/mapping.test.ts`
- `apps/daemon/src/push/service.ts`
- `apps/daemon/src/push/service.test.ts`
- `docs/jobs.md` (§15 prose as amended below, and a new `### 15.2`; **§15.1 is Task-34's and is
  not touched**)

**Do not touch** `apps/daemon/src/main.ts` or `apps/daemon/src/modules.ts` (`routines` is
already in `SubsystemName`, `SUBSYSTEMS` and `DEFAULT_SUBSYSTEM_FLAGS`, and `loadModules`
imports `./routines/index.js` by convention), `packages/store/**` (Task-34 shipped every
repository method this task uses and Task-27 is editing three other store files in the same
batch), `packages/contracts/**` (every `Routine` shape, event and tool schema already exists),
`packages/core/**` (the D27 permission matrix is **not** changed — that is Task-38),
`packages/scheduler/**`, `apps/daemon/src/jobs/service.ts` (reused, not edited),
`apps/daemon/src/runs/**`, `apps/app/**`, `docs/api.md`, `docs/agent-runtime.md`,
`docs/security.md`, `docs/decisions.md`.

> **Deferred, deliberately:** the `routine.create` / `list` / `pause` **chat tool** is not in
> this task. `packages/opencode` has no tool surface and `decidePermission` denies
> `routine.create` in chat mode, so mounting it is a security change with its own seam. It is
> backlog item **Task-38**; this spec ships everything a tool would call and nothing that
> pretends the tool exists. Do not edit `apps/daemon/src/chat/routes.ts` to fake one.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/jobs.md` §13 (one push per outcome), §15 (routines, the section this task extends)
- `docs/api.md` §3 (error envelope), §5.6 (chat), §5.8 (the `/v1/routines` contract), §6 (SSE)
- `docs/agent-runtime.md` §2, §3, §6 (session model, the client surface, permissions — read to
  confirm the tool is out of scope, never edited)
- `docs/security.md` §6 (why the tool stays out)
- `packages/contracts/src/routines.ts`, `src/events.ts` (`routineFiredDataSchema`,
  `routineRepliedDataSchema`, `routineFailedDataSchema`, `parseSseEvent`), `src/primitives.ts`
  (`routineKindSchema`, `cronSchema`, `timezoneSchema`), `src/pagination.ts`
  (`pageOfRoutine`, `parsePage`, `PAGINATION_*`), `src/resources.ts` (`chatMessageSchema`)
- `packages/core/src/misfire.ts` (`resolveMisfire`), `src/cron.ts`
- `packages/store/src/routines.ts`, `src/routine-fires.ts`, `src/chats.ts`, `src/events.ts`,
  `src/store.ts`, `src/errors.ts`
- `apps/daemon/src/modules.ts`, `src/config.ts`, `src/logger.ts`
- `apps/daemon/src/jobs/service.ts` (`nextFireAt`, `formatInstant` — reuse, do not edit)
- `apps/daemon/src/runs/errors.ts` (`handle`, `json`, `queryInput`, `requireScope`,
  `RunApiError`), `src/jobs/routes.ts` (the route style this task follows)
- `apps/daemon/src/chat/service.ts` (`send`, `appendUserMessage`, `pump`, `prepare`,
  `chatRuntimeOf`), `src/chat/index.ts`, `src/chat/service.test.ts` (the `FakeAgent` harness)
- `apps/daemon/src/push/mapping.ts`, `src/push/service.ts`, `src/push/mapping.test.ts`,
  `src/push/service.test.ts`
- `apps/daemon/src/events/notifier.ts`

## 🔒 Contract

### `apps/daemon/src/routines/index.ts`

```ts
export function createModule(context: DaemonContext): DaemonModule;

export { createRoutineService } from './service.js';
export type { CreateRoutineServiceOptions, RoutineService, RoutineTickReport } from './service.js';
```

`createModule` builds the service once with the default inputs, registers the routes, calls
`start()` in `register` and registers `stop()` as the module's `shutdown` hook. Building the
module does no I/O: no query, no directory read, no timer until `register`.

### `apps/daemon/src/routines/tick.ts` (pure)

```ts
export interface RoutineTickPlanItem {
  readonly routine: Routine;
  readonly scheduledFor: string;
  readonly nextFireAt: string | null;
  readonly decision: 'fire' | 'skip';
  readonly reason: 'on_time' | 'outside_grace' | 'no_next_fire';
}

export function planRoutineTick(input: {
  readonly now: Date;
  readonly graceSeconds: number;
  readonly due: readonly Routine[];
}): readonly RoutineTickPlanItem[];
```

- Iterate `due` in the given order (the store already returns the oldest `next_fire_at` first).
- `nextFireAt` comes from `nextFireAt({ cron, timezone }, now)` in `../jobs/service.js` — second
  precision, the jobs convention. `ok: false` (bad cron, bad zone or no fire) → the item is
  `skip` with reason `no_next_fire` and `nextFireAt: null`, so the routine stops instead of
  retrying forever.
- Otherwise `resolveMisfire({ scheduledFor, now: now.toISOString(), graceSeconds })` from
  `@codebox/core`: `run: true` → `fire` / `on_time`; `run: false` → `skip` / `outside_grace`;
  a `not_due` decision (impossible after `listDue`, defensive) yields no item at all.
- A routine whose `nextFireAt` is `null` yields no item.

### `apps/daemon/src/routines/service.ts`

```ts
export const ROUTINE_TICK_MIN_MS = 15_000;
export const ROUTINE_TICK_BATCH = 20;
export const ROUTINE_MAX_PROMPT_FIRES = 1;

export interface RoutineTickReport {
  readonly due: number;
  readonly fired: number;
  readonly skipped: number;
  readonly lost: number;
  readonly deferred: number;
}

export interface CreateRoutineServiceOptions {
  readonly context: DaemonContext;
  readonly now?: () => Date;
  /** Defaults to `Math.max(15, CB_SCHEDULER_TICK_SECONDS) * 1000`. */
  readonly tickMs?: number;
  /** Defaults to `chatServiceFor(context)`; a test injects a `ChatService` or `null`. */
  readonly chat?: () => ChatService | null;
}

export interface RoutineService {
  tick(at?: Date): Promise<RoutineTickReport>;
  /** Records the fire, starts the work and returns the row unchanged. No schedule write. */
  runNow(routine: Routine, at?: Date): Routine;
  /** The background prompt fires started by `tick`/`runNow`; a test awaits this set. */
  pending(): readonly Promise<void>[];
  start(): void;
  stop(): void;
}

export function createRoutineService(options: CreateRoutineServiceOptions): RoutineService;
```

`tick(at = now())`, one pass, guarded so two ticks never overlap (`running` flag; a second call
while one runs returns an all-zero report):

1. `const boundIso = formatInstant(at)` (`../jobs/service.js`, second precision) and
   `const timestamp = at.toISOString()`. Every schedule string — the `listDue` bound,
   `fired_at`, `next_fire_at` and the `scheduledFor` of a `routine.fired` — uses `boundIso`;
   every event `ts` uses `timestamp`. This keeps the TEXT comparison in `listDue` and the
   claim's `next_fire_at === scheduled_for` exact.
2. `const due = context.store.routines.listDue(boundIso, ROUTINE_TICK_BATCH)`.
3. `const plan = planRoutineTick({ now: at, graceSeconds: context.config.CB_MISFIRE_GRACE_SECONDS, due })`.
4. For each item, in order:
   - `skip` → `store.routineFires.skip({ routineId, scheduledFor, firedAt: boundIso, nextFireAt, detail: reason })`.
     A non-null row counts as `skipped` and logs
     `logger.info({ msg: 'routine_skipped', routineId, reason })`.
   - `fire` on a `reminder` → `const fire = store.routineFires.claim({...})`; `null` counts as
     `lost` (the winner is another tick or process — log nothing); else persist
     `routine.fired`, `store.routineFires.finish(fire.id, 'sent', null)`, count `fired`, log
     `logger.info({ msg: 'routine_fired', routineId, kind: 'reminder', scheduledFor })`.
   - `fire` on a `prompt` while `inFlight.size >= ROUTINE_MAX_PROMPT_FIRES` → count `deferred`
     and leave the row untouched (it is still due next tick, inside the grace).
   - `fire` on a `prompt` → `claim`; `null` → `lost`; else persist `routine.fired`, count
     `fired`, log the same line with `kind: 'prompt'`, add the routine id to `inFlight`, and run
     `startPromptFire` **without awaiting it** (store the promise in a set that `pending()`
     exposes for the tests; `stop()` does not wait for it).
5. Return the five counts.

`start()` sets one `setInterval` at `tickMs`, `unref()`ed, whose callback catches and logs
`logger.error({ msg: 'routine_tick_failed', err })`; a second `start()` is a no-op. `stop()`
clears the timer and marks the service stopped, so a later `start()` does nothing; it is
idempotent and it does not await an in-flight prompt fire. `stop()` is registered through
`DaemonModule.shutdown`.

`runNow(routine, at = now())`:
- `const scheduledFor = formatInstant(at)`; persist `routine.fired` with
  `{ routineId, kind, scheduledFor, ts: at.toISOString() }`.
- `reminder` → done (the push pump delivers it).
- `prompt` → `void startPromptFire(routine, null, scheduledFor)` where `fireId: null` means
  "there is no `routine_fires` row to finish". The routine row is **not** updated:
  `next_fire_at`, `last_fired_at` and `enabled` are untouched, so a manual fire never consumes
  the schedule.
- Return the routine unchanged.

`startPromptFire(routine, fireId, scheduledFor)`:
1. `const result = await firePrompt(routine, { context, chat, now })` (below).
2. `replied` → persist `routine.replied` with `{ routineId, chatId, messageId, ts: nowIso }`;
   if `fireId !== null`, `store.routineFires.finish(fireId, 'replied', result.messageId)`;
   log `logger.info({ msg: 'routine_replied', routineId, chatId })`.
3. `failed` → persist `routine.failed` with `{ routineId, code, message: failureMessage(code), ts: nowIso }`;
   if `fireId !== null`, `store.routineFires.finish(fireId, 'failed', code)`; log
   `logger.error({ msg: 'routine_fire_failed', routineId, code })`.
4. Remove the routine id from `inFlight`. Every `finish` call is wrapped so a closed store
   during shutdown logs `routine_finish_failed` instead of throwing.

Event persistence uses one helper, exactly like `chat/service.ts` (with the same local
`toRecord(value)` loop the chat service already has):

```ts
function persistEvent(type: SseEventName, data: Record<string, unknown>, ts: string): void {
  const parsed = parseSseEvent({ event: type, data });
  context.store.events.append({
    runId: null, chatId: null, seq: null, type: parsed.event, data: toRecord(parsed.data), ts,
  });
  eventNotifier(context).notify();
}
```

Ordering per fire, pinned by tests: `routine.fired` first, then the chat events of the turn
(`chat.message`, `chat.delta`…, `chat.idle`), then `routine.replied`; on failure `routine.fired`
then `routine.failed`. A reminder emits `routine.fired` and nothing else.

**Logging rule:** a routine id, a kind, a scheduled instant and a failure code. Never the
prompt, never the reply text, never a token.

### `apps/daemon/src/routines/fire.ts`

```ts
export interface PromptFireResult {
  readonly outcome: 'replied' | 'failed';
  readonly chatId: string | null;
  readonly messageId: string | null;
  readonly code: string | null;
}

export interface FirePromptDeps {
  readonly context: DaemonContext;
  readonly chat: () => ChatService | null;
  readonly now: () => Date;
}

export function firePrompt(
  routine: PromptRoutine,
  deps: FirePromptDeps,
): Promise<PromptFireResult>;
```

Algorithm, in this order:

1. `const chatService = deps.chat()`; `null` → `{ outcome: 'failed', code: 'chat_unavailable' }`.
2. `store.repos.get(routine.repoId)`; `null` → `code: 'repo_missing'`.
3. Resolve the target chat:
   - `routine.chatSessionId` is not null **and** `store.chats.getSession(id)` exists with
     `status !== 'archived'` → use it.
   - otherwise create one: `id = chatRuntimeOf(chatService).newChatId()`;
     `store.chats.createSession({ id, repoId: routine.repoId, title: routine.title, status:
     'idle', createdAt, updatedAt: at, lastMessage: null }, { opencodeSessionId: null,
     worktree: null })`; `store.routines.update(routine.id, { chatSessionId: id })`; then
     `await chatService.prepare(id)` (the chat's worktree and OpenCode session).
4. `const message = await chatService.sendRoutine({ chatId, text: routine.prompt })`.
5. `await chatService.pump(chatId)` — the existing pump resolves when the turn ends and never
   throws.
6. `const last = store.chats.lastMessage(chatId)`; `replied` only when `last !== null &&
   last.role === 'assistant' && last.id !== message.id && last.createdAt >= message.createdAt`.
   Otherwise `{ outcome: 'failed', code: 'no_reply' }`.
7. Any throw → `{ outcome: 'failed', chatId, code }` where `code` is `error.reason` for a
   `ChatError` and `'internal'` otherwise. The exception message is never stored or logged.

`failureMessage(code)` (in `service.ts`, exported for the tests) is a frozen record returning
one fixed English sentence per code — `chat_unavailable`, `repo_missing`, `no_reply`,
`agent_unavailable`, `workspace_unavailable`, `internal` — and
`'The routine fire failed.'` for anything else. It never contains the thrown message.

### `apps/daemon/src/chat/service.ts` — the origin variant

```ts
export interface SendRoutineInput {
  readonly chatId: string;
  readonly text: string;
}

export interface ChatService {
  send(input: SendMessageInput): Promise<ChatMessage>;
  /** `send`, but the stored message carries `origin: 'routine'` (docs/jobs.md §15). */
  sendRoutine(input: SendRoutineInput): Promise<ChatMessage>;
  // every existing member unchanged
}
```

- Extract the body of the current `send` into
  `writeAndQueue(chatId, text, origin: 'user' | 'routine')`; `send` calls it with `'user'`,
  `sendRoutine` with `'routine'`. The text validation (`MAX_TEXT_CHARS`, non-empty) and the
  archived refusal are shared, so `sendRoutine` can throw exactly the same `ChatError`s.
- `appendUserMessage` becomes `appendMessage(chatId, text, origin)` and passes
  `{ origin }` to `store.chats.appendMessage`. The message `role` stays `'user'`: a routine
  message is a daemon-authored user turn; only the store's `origin` column distinguishes it.
- `chatRuntimeOf(service)` keeps working unchanged, so the routines module gets the same clock,
  store and `newChatId` source as the routes.

### `apps/daemon/src/chat/index.ts` — the cross-module accessor

```ts
const SERVICES = new WeakMap<DaemonContext, ChatService>();

/** The chat service the `chat` module built for this daemon, or `null` when it is disabled. */
export function chatServiceFor(context: DaemonContext): ChatService | null;
```

Same pattern as `eventNotifier` in `apps/daemon/src/events/notifier.ts`: one instance per
daemon context, no global state and no second `createChatService` call. `createModule` stores
the instance before returning. The routines module looks it up **lazily at fire time**, so a
`chat` subsystem that is disabled or absent degrades to `chat_unavailable` for prompt fires
while reminders keep working.

### `apps/daemon/src/push/mapping.ts` — the summary push

```ts
export const NOTIFICATION_TYPES = [
  'run.merged', 'run.finished', 'run.failed', 'run.cancelled', 'approval.created',
  'routine.fired', 'routine.replied',
] as const;

export interface PushMessageForInput {
  readonly type: NotificationType;
  readonly data: Readonly<Record<string, unknown>>;
  readonly routineTitle?: string | null;
  readonly summary?: string | null;
}
```

- `PREFERENCE_NAMES['routine.replied'] = Object.freeze(['routine.fired', 'routine.replied'])`:
  the operator's existing "routine" preference covers the reply.
- `deliveryKeyOf` for `routine.replied` is `routine:<routineId>:<messageId>` (that event carries
  no `scheduledFor`); a missing id yields `null`.
- `messageFor` for `routine.replied`: `type: 'routine.replied'`,
  `title: routineTitle ?? 'Routine'`, `body: summary ?? 'Your routine answered in chat.'`,
  `url: '/chat/<chatId>'`, `tag` from the delivery key, plus `routineId` and `chatId` when
  present. `finish()` still clamps title to 120 and body to 240 characters.

### `apps/daemon/src/push/service.ts` — three guards in `pump()`

`pump()` already computes `tag`, maps the event type and gates on preferences. Add two guards
after the type check and before the preference gate, and one extra input to `messageFor`:

1. **A prompt's fire is not its push.** When `record.type === 'routine.fired'` and
   `record.data['kind'] === 'prompt'`, count `skipped`, log
   `logger.debug({ msg: 'push_skipped', reason: 'routine_prompt', type, tag })` and `continue`.
   The reminder keeps its `routine.fired` push; the prompt pushes once, at the reply
   (`docs/jobs.md` §13: one push per outcome).
2. **The per-routine switch.** `routineOf(data)` replaces `routineTitleOf` and returns
   `{ title, notify } | null` from `store.routines.get(routineId)`; when the row exists and
   `notify === false`, skip with `reason: 'routine_muted'`.
3. **The summary text**, at the `messageFor` call: `replySummaryOf(record)` returns the text of
   the chat message when the event is `routine.replied` and
   `store.chats.lastMessage(chatId)` has the same id; otherwise `null`. Pass it as `summary`
   alongside the routine title from step 2.

`isCritical`, quiet hours and the dedupe `tagSet` are unchanged: a quiet-hours window still
holds a reminder or a summary until the window closes.

### `apps/daemon/src/routines/routes.ts`

```ts
export function registerRoutineRoutes(app: DaemonApp, service: RoutineService): void;
```

Seven handlers, all through `handle(c, 'routine', ...)`, `json`, `queryInput` and
`requireScope` from `../runs/errors.js`, so the envelope and the error codes are the ones
`docs/api.md` §3 already publishes:

| Method | Path | Scope | Body / query | Success |
| --- | --- | --- | --- | --- |
| `GET` | `/v1/routines` | `read` (middleware) | `limit`, `cursor`, `kind`, `enabled` | `200` `pageOfRoutine` |
| `GET` | `/v1/routines/{id}` | `read` | — | `200` `Routine` |
| `PATCH` | `/v1/routines/{id}` | `write` | `{ title?, cron?, timezone?, prompt?, notify?, enabled? }` | `200` `Routine` |
| `POST` | `/v1/routines/{id}/pause` | `write` | none | `200` `Routine` |
| `POST` | `/v1/routines/{id}/resume` | `write` | none | `200` `Routine` |
| `POST` | `/v1/routines/{id}/run` | `runs` | none | `202` `Routine` (unchanged) |
| `DELETE` | `/v1/routines/{id}` | `write` | — | `204`, empty body |

Schemas, exactly:

```ts
const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
  kind: routineKindSchema.optional(),
  enabled: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});

const patchBody = z.strictObject({
  title: z.string().min(1).max(120).optional(),
  cron: cronSchema.optional(),
  timezone: timezoneSchema.optional(),
  prompt: z.string().min(1).optional(),
  notify: z.boolean().optional(),
  enabled: z.boolean().optional(),
});
```

Rules:

- Missing routine → `404 not_found` with `details.path: 'routine.id'`: read the row first and
  throw `new RunApiError('not_found', 404, { path: 'routine.id' })`; `DELETE` may instead let
  `StoreError('not_found')` travel through `handle(c, 'routine', ...)`, which produces the same
  body and status.
- A repeated or unknown query key, an unknown body key, or a body value outside its schema →
  `422 validation_failed` with the path from the parse error (the `jobs` route style: `handle`
  already does this).
- `PATCH`:
  - `prompt` on a `reminder` → `422` with `details.path: 'routine.prompt'`.
  - `cron` or `timezone` present → recompute the next fire from `now()` with `nextFireAt`;
    `ok: false` → `422` with `details.path: 'routine.cron'` when `field === 'cron'`, else
    `'routine.timezone'`.
  - `enabled: false` → `nextFireAt: null`; `enabled: true` → recompute from `now()` with the
    resulting `cron`/`timezone` (same `422` on a bad schedule).
  - Write only the keys present, plus the computed `nextFireAt`; return `parseRoutine(updated)`.
- `pause` → `update(id, { enabled: false, nextFireAt: null })`; `resume` →
  recompute from `now()` (a bad schedule is the same `422`) and
  `update(id, { enabled: true, nextFireAt })`. Both are idempotent.
- `run` → `service.runNow(routine)` and `202` with `parseRoutine(routine)`; allowed while the
  routine is paused, and the schedule is never written.
- `delete` → `204` with an empty body (`c.body(null, 204)`).
- `POST /v1/routines` (create) is **not mounted**: creation is the chat tool's job (Task-38).
  Leave `docs/api.md` §5.8 untouched; say so in the task report.

### Data

- Events are the frozen contract shapes: `routine.fired` `{ routineId, kind, scheduledFor, ts }`,
  `routine.replied` `{ routineId, chatId, messageId, ts }`,
  `routine.failed` `{ routineId, code, message, ts }`. No field is added.
- A fire row's `outcome` is `sent` for a reminder, `replied` for a prompt whose answer was
  stored, `failed` with the code as `detail` otherwise. `skipped` rows carry the plan reason.
- `PushMessage` for a reply: `{ type: 'routine.replied', title, body, url: '/chat/<chatId>',
  tag: 'routine:<routineId>:<messageId>', routineId, chatId }`.
- A prompt routine's chat message has `role: 'user'` and store `origin: 'routine'`; the
  `ChatMessage` API shape is unchanged (`packages/contracts` does not expose `origin`).
- No new id prefix: chat ids come from `chatRuntimeOf(service).newChatId()`.
- Schedule strings (`next_fire_at`, `fired_at`, `scheduledFor`) are written second-precision
  with `formatInstant`; event `ts` values use `at.toISOString()` with milliseconds. The claim's
  exact `next_fire_at === scheduled_for` equality depends on that convention, so any later
  writer of `next_fire_at` (Task-38's tool) must use the same helper.

## 🧩 Configuration

No new `CB_*` key. This task reads:

| Key | Default | Used for |
| --- | --- | --- |
| `CB_SCHEDULER_TICK_SECONDS` | `15` | the routine timer, clamped to `>= 15`; above 30 is allowed by the schema and honoured |
| `CB_MISFIRE_GRACE_SECONDS` | `900` | the D13 grace decision |
| `CB_TIMEZONE` | `Europe/Madrid` | not used directly: each routine carries its own IANA zone |
| `CB_DAILY_COST_USD` | `10` | **not enforced here** — see the doc amendment below |

`docs/providers.md` is unchanged.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; includes the tests this task adds.
  - `npm run build` — `tsc -b`; the app build must stay green.
  - `npx vitest run --project apps/daemon` — the task's own suite.
  - `git diff --name-only main...task-35` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean.
  - [ ] `[unit]` `tick.test.ts`: `planRoutineTick` fires an on-time row, skips one 901 s old
        with `graceSeconds: 900`, skips an invalid cron as `no_next_fire`, ignores a row whose
        `nextFireAt` is null, and returns the Madrid DST rows of `2026-03-29T01:00:00Z` with
        the next fire the cron engine gives (pin the exact instant).
  - [ ] `[unit]` `service.test.ts`: a due reminder writes exactly one `routine.fired` event, one
        `routine_fires` row with `outcome: 'sent'`, **no** chat session and **no** chat message;
        two calls awaited together (`Promise.all([tick(), tick()])`) process the row once and
        emit one `routine.fired` (the overlap guard makes the second report all zeros), and a
        row pre-claimed directly through `store.routineFires.claim` lands in `lost`; a row 901 s
        old writes a `skipped` row and moves `next_fire_at`, and `last_fired_at` is unchanged.
  - [ ] `[unit]` `service.test.ts` (a `createChatService` with the existing `FakeAgent` and a
        fake `ChatWorkspaces`, injected as `chat: () => chatService`; await
        `service.pending()`): a due prompt with `chatSessionId: null` creates one chat session
        named after the routine, writes the routine's `chatSessionId`, appends one message whose
        store `origin` is `'routine'`
        (`store.db.prepare('SELECT origin FROM chat_messages WHERE id = ?').get(id)`), and ends
        with `routine.replied` carrying that chat id and the assistant message id; the fire row
        is `replied`; `store.runs.list({ limit: 10, cursor: null }).data` is empty (no run, no
        gate, no PR).
  - [ ] `[unit]` `service.test.ts`: an **archived** `chatSessionId` gets a new session and the
        routine row is re-pointed; an `AgentError` from the fake agent (a) still leaves the
        `routine.fired` event, (b) writes `routine.failed` with the mapped code and a fixed
        message, (c) finishes the row as `failed`, and (d) logs no prompt or reply text.
  - [ ] `[unit]` `runNow` fires without writing `routine_fires`, leaves `next_fire_at`,
        `last_fired_at` and `enabled` byte-identical, and answers `202` from the route.
  - [ ] `[unit]` `routes.test.ts`: the seven handlers answer the documented status, list
        paginates with `nextCursor`, `GET`/`DELETE` of an unknown id are `404`, a `PATCH` with
        an unknown key is `422`, `prompt` on a reminder is `422` `routine.prompt`, a bad cron is
        `422 routine.cron`, `pause` clears `nextFireAt` and `resume` recomputes it, and every
        mutation without `write` (or `runs` for `run`) is `403`.
  - [ ] `[unit]` `chat/service.test.ts`: `sendRoutine` stores `origin: 'routine'`, `send` still
        stores `origin: 'user'`, and an empty or over-long text throws the same `ChatError` as
        `send`.
  - [ ] `[unit]` `chat/index.test.ts`: `chatServiceFor(context)` is `null` before the module is
        created and returns the module's own instance afterwards (the identity `===` check).
  - [ ] `[unit]` `push/mapping.test.ts`: `NOTIFICATION_TYPES` has 7 entries; a `routine.replied`
        event keys as `routine:<id>:<messageId>`; `messageFor` with a summary uses it as the
        body and `/chat/<chatId>` as the url, and without one uses the fallback body.
  - [ ] `[unit]` `push/service.test.ts`: a `routine.fired` with `kind: 'prompt'` is skipped (no
        send), a `routine.fired` with `kind: 'reminder'` sends one, a `routine.replied` sends
        one with the chat message's text as the body, and a routine with `notify: false` sends
        nothing for either kind.
  - [ ] `[unit]` `index.test.ts`: `loadModules` with `DEFAULT_SUBSYSTEM_FLAGS` reports
        `routines` in `loaded`; `createModule` performs no query (a store stub that throws on any
        call still constructs); `stop()` twice does not throw.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched.
  - [ ] `[live]` On the reference VM: insert one reminder and one prompt routine into
        `/var/lib/codebox/state.db` with `next_fire_at` 90 s ahead (creation is Task-38, so a
        direct `sqlite3` INSERT is the probe), stream `GET /v1/events` and observe exactly one
        `routine.fired` and one `routine.replied` per routine, exactly one push for the
        reminder and exactly one summary push for the prompt, and the prompt's answer visible in
        `GET /v1/chat/sessions/{id}/messages`. Report the event ids, the two push ids and the
        message ids.

## 📣 Coordination

- For the Architect: this task is the **descoped** Task-35 — the fire engine and the HTTP
  surface. The `routine.create` / `list` / `pause` chat tool, the tool-mounting seam and the D27
  reclassification are **Task-38**; `docs/agent-runtime.md` is therefore not edited (its §2/§6
  tool paragraphs stay the product intent, and the missing seam is recorded in `TODO.md`, not
  contradicted in the doc).
- For Task-38: the service is the seam, not HTTP — Task-38 adds a `create` path to
  `createRoutineService` (and mounts it on the HTTP surface in the same task) and the tool calls
  that. The route is deliberately **not mounted** here, so the tool task owns the create body,
  its validation and its permission story together.
- For Task-36: `GET /v1/routines`, `pause`/`resume`, `run` and `DELETE` are live; `POST
  /v1/routines` is not, and `docs/api.md` §5.8's create row stays aspirational until Task-38.
- For Task-27: this task reads `packages/store/src/{routines,routine-fires,chats,events}.ts`
  and never edits them; Task-27's `chats.pruneArchivedBefore` is additive and does not change
  `getSession`/`createSession`/`updateSession`/`appendMessage`/`lastMessage`.
- For Task-28: the new routes are covered by the auth middleware's per-device rate limit
  automatically; `POST /v1/routines/{id}/run` is one of the three `isWorkRoute` paths, so it is
  capped at 10/min with no extra code here.
- Doc amendment this task **must** make in `docs/jobs.md` §15: replace "A `reminder` costs
  nothing; a `prompt` counts against `CB_DAILY_COST_USD`" with "A `reminder` costs nothing; a
  `prompt` is a chat turn, and the chat path does not yet write a usage row, so a routine prompt
  is not capped in this release — the cap and the ledger are a follow-up on the chat path."
  Add the `### 15.2 The fire` subsection with the tick, the two kinds, the single-push rule,
  the manual run and the endpoints table.

## ⛔ Out of scope

- **No chat tool and no tool-mounting seam** — no MCP server, no plugin, no custom-tool file, no
  `opencode.json` edit, no `PromptOptions` change, no `AgentRuntime` method. That is Task-38.
- No change to `packages/core/src/permissions.ts`, `PERMISSION_MATRIX` or
  `decidePermission`; `routine.*` stays denied in chat until Task-38's ADR says otherwise.
- No `POST /v1/routines` (create), no `routine_fires` listing route and no websocket.
- No new dependency, no `@codebox/scheduler` import in the daemon, no `package.json` or
  `package-lock.json` change.
- No worktree, gate, branch, PR or merge for a routine: no `runs` row is ever created, and the
  run engine is not called.
- No enforcement of `CB_DAILY_COST_USD` for a prompt fire (see the doc amendment) and no usage
  row: the chat path does not record one yet.
- No contract change: no new event, field, error code or id prefix; no `docs/api.md`,
  `docs/agent-runtime.md`, `docs/security.md` or `docs/decisions.md` edit.
- No change to the chat pump's behaviour for user messages, no new chat route and no
  `chat/routes.ts` edit.

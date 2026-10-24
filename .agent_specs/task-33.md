# Spec: Task-33 — Routine contracts

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (`packages/contracts`).
- **Role:** Dev.
- **Objective:** D38 becomes executable. `@codebox/contracts` gains the `Routine` resource
  (`prompt` / `reminder`), the `routine.create` / `routine.list` / `routine.pause` chat-tool
  schemas, the `routine.fired` / `routine.replied` / `routine.failed` SSE events and the five
  `/v1/routines` paths in the OpenAPI document. `docs/api.md` §5.8 stops saying "planned" and
  carries the route table, §6 carries the three event names, and the frozen event list in
  `docs/decisions.md` grows by three. After this task Task-34, Task-35 and Task-36 have a
  vocabulary; none of them has to invent a shape.
- **Environment:** worktree `../wt-cb-33`, branch `task-33`, base `main` (`611a788`, which
  already contains the merged Task-03).
- **Dependencies:** Task-03 — merged; it produced `packages/contracts/src/index.ts` (the
  re-export surface), `primitives.ts` (ids, `SSE_EVENT_NAMES`, `cronSchema`, `timezoneSchema`),
  `resources.ts`, `events.ts`, `pagination.ts`, `openapi.ts` and the tests this task extends.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path. Removing a stray `.gitkeep` from a directory this task populates is
allowed.

- `packages/contracts/src/index.ts` — **the `packages/contracts/src/index.ts` hot file holder
  for this batch; no other task in the batch claims it.**
- `packages/contracts/src/primitives.ts`
- `packages/contracts/src/routines.ts` (new)
- `packages/contracts/src/events.ts`
- `packages/contracts/src/pagination.ts`
- `packages/contracts/src/openapi.ts`
- `packages/contracts/src/routines.test.ts` (new)
- `packages/contracts/src/primitives.test.ts`
- `packages/contracts/src/events.test.ts`
- `packages/contracts/src/openapi.test.ts`
- `packages/contracts/src/index.test.ts`
- `packages/contracts/README.md`
- `docs/api.md` — four named blocks, nothing else in the file:
  1. **§1 `Rules` → the `id` prefixes bullet** (the line that lists `repo_`, `job_`, `run_`,
     `apv_`, `chat_`, `msg_`, `dev_`, `sub_`): add `rtn_`.
  2. **§5.8 `Routines`** — the whole subsection: replace the "Planned by D38…" paragraph with
     the route table, the two kind rules and one example object.
  3. **§6 `SSE` → the final sentence of the "Event types are the D14/D16 list" paragraph**:
     replace "The `routine.*` events join this list with the contracts in Task-33." with the
     three event names.
  4. **§10 `Contract package` → the module table**: one added row for `src/routines.ts`.
- `docs/decisions.md` — **section: `## Frozen values` → `### Event types` only** (the three
  added names). `docs/decisions.md` is a hot file and this task is its **only** holder in the
  batch.

`packages/contracts/package.json` and `packages/contracts/tsconfig.json` are **not** in the
list. `zod@4.6.7` is already declared; no dependency is added and `package-lock.json` is not
touched.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/api.md` (§1 rules, §4 pagination, §5 resources, §6 SSE, §8 versioning, §10 contract
  package)
- `docs/jobs.md` (§15 routines)
- `docs/decisions.md` (D14, D16, D36, D38)
- `docs/security.md` (§4 scopes, for the route auth column)
- `packages/contracts/src/index.ts`, `primitives.ts`, `resources.ts`, `events.ts`,
  `pagination.ts`, `openapi.ts`, `parse.ts`, `errors.ts`, `config.ts`
- `packages/contracts/src/primitives.test.ts`, `events.test.ts`, `openapi.test.ts`,
  `resources.test.ts`, `index.test.ts`
- `packages/contracts/README.md`, `packages/contracts/package.json`,
  `packages/contracts/tsconfig.json`
- `TODO.md` (the Task-33 and Task-34/35/36 entries), `vitest.config.ts`, `eslint.config.js`

## 🔒 Contract

The public surface other tasks are written against **right now**. It is a promise, not a
suggestion. Exact exported names, signatures and types.

Everything exported goes through `packages/contracts/src/index.ts`. The file re-exports every
name exactly once, grouped by module with a comment header, and keeps the existing shape: value
exports first, then `export type { … }`. `zod` is imported with `import { z } from 'zod';` and
every schema is a `z.strictObject` unless it is a union, so an unknown field is a failure.

### `primitives.ts` — additions

```ts
// inside ID_PREFIXES, after pushSubscription:
routine: 'rtn_',

export const RoutineId = idSchema('routine');
export type RoutineId = z.infer<typeof RoutineId>;

export const ROUTINE_KINDS = ['prompt', 'reminder'] as const;
export const routineKindSchema = z.enum(ROUTINE_KINDS);
export type RoutineKind = z.infer<typeof routineKindSchema>;

export const ROUTINE_EVENT_NAMES = [
  'routine.fired',
  'routine.replied',
  'routine.failed',
] as const;
```

`SSE_EVENT_NAMES` grows from 20 to **23** entries, the three routine names **appended after
`'telemetry'`** in exactly the `ROUTINE_EVENT_NAMES` order. `SSE_CONTROL_EVENT_NAMES` stays
`['gap']`. `sseEventNameSchema`, `SseEventName` and `SseEventData` follow automatically and
must not be hand-edited.

### `routines.ts` — new module, the routine resource

```ts
import { z } from 'zod';
import { parseOrThrow } from './parse.js';
import {
  ChatId,
  RepoId,
  RoutineId,
  cronSchema,
  routineKindSchema,
  timestampSchema,
  timezoneSchema,
} from './primitives.js';

const routineBase = z.strictObject({
  id: RoutineId,
  title: z.string().min(1).max(120),
  cron: cronSchema,
  timezone: timezoneSchema,
  enabled: z.boolean(),
  notify: z.boolean(),
  createdAt: timestampSchema,
  nextFireAt: timestampSchema.nullable(),
  lastFiredAt: timestampSchema.nullable(),
});

export const promptRoutineSchema = routineBase.extend({
  kind: z.literal('prompt'),
  repoId: RepoId,
  prompt: z.string().min(1),
  chatSessionId: ChatId.nullable(),
});

export const reminderRoutineSchema = routineBase.extend({
  kind: z.literal('reminder'),
});

export const routineSchema = z.discriminatedUnion('kind', [
  promptRoutineSchema,
  reminderRoutineSchema,
]);

export type Routine = z.infer<typeof routineSchema>;
export type PromptRoutine = z.infer<typeof promptRoutineSchema>;
export type ReminderRoutine = z.infer<typeof reminderRoutineSchema>;

export function parseRoutine(input: unknown): Routine {
  return parseOrThrow(routineSchema, input, 'routine');
}
```

Rules the union encodes, and that `docs/api.md` §5.8 now states:

- A `prompt` routine **requires** `repoId` and a non-empty `prompt`; `chatSessionId` is
  `ChatId | null` (`null` means "create a chat on the fire", `docs/jobs.md` §15).
- A `reminder` routine carries **no** `repoId`, `prompt` or `chatSessionId`: a reminder costs
  no tokens and has no session (D38). Rejecting them is what makes the two kinds honest.
- `title` is the human label and the text a reminder pushes; it is not nullable and is capped
  at 120 characters.
- `notify` is the per-routine push switch; `enabled` is the pause switch; `nextFireAt` and
  `lastFiredAt` are computed by the scheduler, never by a client.
- `parseRoutine` names the boundary `routine`, so a failure reports `routine.cron`,
  `routine.unexpected`, `routine.prompt` — never a bare field.

### `routines.ts` — the chat tool

```ts
export const ROUTINE_TOOL_NAMES = ['routine.create', 'routine.list', 'routine.pause'] as const;

export const routineCreateToolInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('prompt'),
    title: z.string().min(1).max(120),
    cron: cronSchema,
    timezone: timezoneSchema,
    prompt: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('reminder'),
    title: z.string().min(1).max(120),
    cron: cronSchema,
    timezone: timezoneSchema,
  }),
]);

export const routineCreateToolOutputSchema = z.strictObject({ routine: routineSchema });

export const routineListToolInputSchema = z.strictObject({
  kind: routineKindSchema.optional(),
});
export const routineListToolOutputSchema = z.strictObject({
  routines: z.array(routineSchema),
});

export const routinePauseToolInputSchema = z.strictObject({
  routineId: RoutineId,
  enabled: z.boolean(),
});
export const routinePauseToolOutputSchema = z.strictObject({ routine: routineSchema });

export type RoutineCreateToolInput = z.infer<typeof routineCreateToolInputSchema>;
export type RoutineCreateToolOutput = z.infer<typeof routineCreateToolOutputSchema>;
export type RoutineListToolInput = z.infer<typeof routineListToolInputSchema>;
export type RoutineListToolOutput = z.infer<typeof routineListToolOutputSchema>;
export type RoutinePauseToolInput = z.infer<typeof routinePauseToolInputSchema>;
export type RoutinePauseToolOutput = z.infer<typeof routinePauseToolOutputSchema>;
```

- `timezone` is **required** in both create variants: the agent must say which zone it meant,
  and a missing zone is a rejected call, not a silent `Europe/Madrid`.
- `repoId` is **not** in the tool input: the tool only exists inside a chat session, which is
  already bound to one repository, so the daemon fills it in. This is why the *resource* schema
  requires `repoId` while the *tool* schema does not.
- `parsed := routineCreateToolInputSchema` is what the daemon turns into a `Routine` with
  `enabled: true`, `notify: true`, `lastFiredAt: null`, a generated `id`, `createdAt` and a
  `nextFireAt` from the scheduler.
- The daemon parses the tool call and the tool result with these schemas — they are the tool's
  wire contract, nothing else.

### `events.ts` — additions

```ts
export const routineEventBase = z.strictObject({
  routineId: RoutineId,
  ts: timestampSchema,
});

export const routineFiredDataSchema = routineEventBase.extend({
  kind: routineKindSchema,
  scheduledFor: timestampSchema,
});

export const routineRepliedDataSchema = routineEventBase.extend({
  chatId: ChatId,
  messageId: MessageId,
});

export const routineFailedDataSchema = routineEventBase.extend({
  code: z.string().min(1),
  message: z.string().min(1),
});
```

`routineEventBase` has **no `seq`**: a routine is not a run and not a chat stream
(`docs/jobs.md` §15), so the three events are global, like `job.changed`. The three entries are
appended to the `sseEventSchema` union after `telemetry`:

```ts
z.strictObject({ event: z.literal('routine.fired'), data: routineFiredDataSchema }),
z.strictObject({ event: z.literal('routine.replied'), data: routineRepliedDataSchema }),
z.strictObject({ event: z.literal('routine.failed'), data: routineFailedDataSchema }),
```

`SseEvent` and `SseEventData` then cover them, so `parseSseEvent` accepts a `routine.fired`
frame and `notificationPreferencesSchema.events` accepts the three names (it is built from
`sseEventNameSchema`; do not change it).

### `pagination.ts` — addition

```ts
export const pageOfRoutine: z.ZodType<Page<Routine>> = pageSchema(routineSchema);
```

### `openapi.ts` — additions

- `componentSchemas` gains `Routine: routineSchema` and `SseEvent: sseEventSchema` (the §6
  union, imported from `./events.js`). The `SseEvent` component is how the document lists the
  event vocabulary: `z.toJSONSchema` renders the discriminated union as `oneOf`, and each
  branch carries its `event` literal, so the three names appear in the document.
- Five new paths, eight operations, all with `tag: 'routines'`:

  | Method | Path | operationId | status | `response` | summary |
  | --- | --- | --- | --- | --- | --- |
  | `get` | `/v1/routines` | `listRoutines` | 200 | `Page` | Chat schedules, newest first. |
  | `post` | `/v1/routines` | `createRoutine` | 201 | `Routine` | Create a routine; the chat tool is the normal path. |
  | `get` | `/v1/routines/{id}` | `getRoutine` | 200 | `Routine` | One routine with its next and last fire. |
  | `patch` | `/v1/routines/{id}` | `updateRoutine` | 200 | `Routine` | Title, cron, timezone, prompt, notify or enabled. |
  | `delete` | `/v1/routines/{id}` | `deleteRoutine` | 204 | `null` | Delete a routine and stop its schedule. |
  | `post` | `/v1/routines/{id}/pause` | `pauseRoutine` | 200 | `Routine` | The scheduler stops selecting it. |
  | `post` | `/v1/routines/{id}/resume` | `resumeRoutine` | 200 | `Routine` | Recompute the next fire from now. |
  | `post` | `/v1/routines/{id}/run` | `runRoutine` | 202 | `Routine` | Fire it once now, outside the schedule. |

- The tags list gains `{ name: 'routines', description: 'Chat schedules: reminders and prompts.' }`,
  in alphabetical position (after `repos`, before `runs`; the existing list is alphabetical).
- In `docs/api.md` §5.8 the `Auth` column is `read` for the two `GET` rows, `write` for create,
  update, delete, pause and resume, and `runs` for `POST /v1/routines/{id}/run` — the five
  scopes of `docs/api.md` §2, with no new scope.
- The path set of the document becomes **46** unique paths (41 + 5) and the `openapi.test.ts`
  count must follow.

### `index.ts` — additions

```ts
// Primitives: (existing block) add ROUTINE_KINDS, routineKindSchema, ROUTINE_EVENT_NAMES,
// RoutineId to the value list, and RoutineKind to the type list.

// Routines: docs/api.md §5.8, D38.
export {
  ROUTINE_TOOL_NAMES,
  promptRoutineSchema,
  reminderRoutineSchema,
  routineSchema,
  parseRoutine,
  routineCreateToolInputSchema,
  routineCreateToolOutputSchema,
  routineListToolInputSchema,
  routineListToolOutputSchema,
  routinePauseToolInputSchema,
  routinePauseToolOutputSchema,
} from './routines.js';
export type {
  Routine,
  PromptRoutine,
  ReminderRoutine,
  RoutineCreateToolInput,
  RoutineCreateToolOutput,
  RoutineListToolInput,
  RoutineListToolOutput,
  RoutinePauseToolInput,
  RoutinePauseToolOutput,
} from './routines.js';

// Pagination: add pageOfRoutine to the existing export list.
// Events: add routineEventBase, routineFiredDataSchema, routineRepliedDataSchema,
// routineFailedDataSchema to the existing export list.
```

No existing export is removed or renamed: `SSE_EVENT_NAMES` gains members, nothing else
changes shape.

### Data

The keys this task introduces or freezes:

| Key | Shape, unit, default |
| --- | --- |
| `rtn_` | the `RoutineId` prefix, added to `ID_PREFIXES` (6–40 alphanumeric characters after it) |
| `ROUTINE_KINDS` | `['prompt', 'reminder']` |
| `Routine.title` | 1–120 characters; the reminder's push text |
| `Routine.cron` | five-field expression (`cronSchema`) |
| `Routine.timezone` | IANA zone (`timezoneSchema`); never defaulted by a schema |
| `Routine.notify` | boolean, `true` for every routine the tool creates |
| `Routine.enabled` | boolean, `true` for every routine the tool creates |
| `Routine.chatSessionId` | `ChatId \| null`, `null` means "create a chat on the fire" |
| `SSE_EVENT_NAMES` | 23 names; the three routine names appended after `telemetry` |
| `ROUTINE_EVENT_NAMES` | `['routine.fired', 'routine.replied', 'routine.failed']` |
| `/v1/routines` paths | 5 paths, 8 operations; the document grows from 41 to 46 paths |

## 🧩 Configuration

No new `CB_*` key, no key removed, and `packages/contracts/src/config.ts` is not in this
task's paths. `config.test.ts` (which asserts the exact `CB_*` key list) must stay green
untouched: if it fails, the change is wrong. Routines cost nothing to define; the cost of a
`prompt` fire counts against `CB_DAILY_COST_USD` (`docs/jobs.md` §15), which is a scheduler
concern, not a schema one.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; includes the tests this task adds.
  - `npx vitest run --project packages/contracts` — this package alone.
  - `npm run build` — `tsc -b` and the app build when this task touches it.
  - `git diff --name-only main...task-33` — audit against the exclusive paths.
  - No test needs the network, a clock or the daemon: fixtures are literals.
- **Acceptance criteria:** every one tagged **`[unit]`** (a headless command, a decoded value,
  a pinned number) or **`[live]`** (only exists in the running system: a stream, a push, a
  tunnel, a UI state). A `[live]` criterion states its **measurement** — what to read, on which
  surface, against which bound.
  - [ ] `[unit]` It typechecks, lints and builds clean: `npm run lint && npm run build`.
  - [ ] `[unit]` The declared tests exist and pass: `npx vitest run --project packages/contracts`
        reports `routines.test.ts` plus the five updated test files and zero failures.
  - [ ] `[unit]` A fixture per kind parses:
        `npx vitest run --project packages/contracts -t 'a fixture per routine kind parses'`
        passes; it parses one `prompt` fixture (with `chatSessionId: null` and with a real
        `chatSessionId`) and one `reminder` fixture, asserts the parsed value equals the
        fixture, and asserts an unknown field is rejected with the path `routine.unexpected`.
  - [ ] `[unit]` A prompt routine without repo/prompt is rejected and a reminder without
        prompt is accepted:
        `npx vitest run --project packages/contracts -t 'a prompt routine without a repo or a prompt is rejected and a reminder without a prompt is accepted'`
        passes; the prompt case reports `routine.repoId` (or `routine.prompt` when only the
        prompt is missing), and the reminder fixture with no `prompt`, `repoId` or
        `chatSessionId` parses.
  - [ ] `[unit]` The tool schema rejects a missing timezone:
        `npx vitest run --project packages/contracts -t 'the routine tool schema rejects a missing timezone'`
        passes; it asserts `routineCreateToolInputSchema.safeParse` fails with a path
        containing `timezone` for both kinds, that a `reminder` input with no `prompt` is
        accepted, and that an unknown tool field is rejected.
  - [ ] `[unit]` The OpenAPI document lists the three events:
        `npx vitest run --project packages/contracts -t 'the OpenAPI document lists the three routine events'`
        passes; it asserts that `JSON.stringify(buildOpenApiDocument().components.schemas)`
        contains `routine.fired`, `routine.replied` and `routine.failed`, that the document
        still validates with `parseOpenApiDocument`, and that `Routine` is a component.
  - [ ] `[unit]` The document and the OpenAPI paths still agree, now at 46:
        `npx vitest run --project packages/contracts -t 'docs/api.md routes match the OpenAPI paths'`
        passes and asserts `toHaveLength(46)`.
  - [ ] `[unit]` The event vocabulary is 23 and cannot drift:
        `npx vitest run --project packages/contracts -t 'the event name list is the D14 list'`
        passes with `SSE_EVENT_NAMES` length 23, the three names appended after `telemetry`,
        and one fixture per name in `events.test.ts`.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-33` lists only files from the list above, and
        `git diff --name-only main...task-33 | grep -c '^package-lock.json$'` prints `0`.
  - [ ] `[unit]` The documents were amended with the code:
        `grep -n "routine.fired" docs/api.md docs/decisions.md packages/contracts/src/events.ts`
        finds all three files, and `grep -n "rtn_" docs/api.md packages/contracts/src/primitives.ts`
        finds both.

## 📣 Coordination

- For the Architect: three document blocks outside "the routine section" were claimed and used,
  because the contract change is incoherent without them: the `rtn_` prefix in `docs/api.md` §1,
  the module row in §10, and the frozen event list in `docs/decisions.md`. `docs/api.md` and
  `docs/decisions.md` have no other holder in this batch.
- Hot files: this task is the sole holder of `packages/contracts/src/index.ts` and
  `docs/decisions.md` for Batch 2.
- For Task-34 (Batch 8): the store tables are `routines` and `routine_fires` with
  `(routine_id, scheduled_for)` as the idempotency key, and a `routine` row maps 1:1 onto
  `routineSchema`; `routine_fires` needs `routine_id`, `scheduled_for`, `fired_at`, `state`
  (`fired` / `replied` / `failed`) and `chat_id` for a `prompt`.
- For Task-35 (Batch 9): the tool names are `routine.create`, `routine.list`, `routine.pause`;
  the tool is chat-only and the daemon builds the `Routine` from
  `routineCreateToolInputSchema` plus the session's `repoId`, `enabled: true`, `notify: true`,
  `lastFiredAt: null`; the three events are emitted with `parseSseEvent`-valid payloads, and a
  `prompt` fire appends the message with origin `routine`. `Routine.chatSessionId` is
  `null`-able by design, so "no session yet" is not a schema change.
- For Task-36 (Batch 9): the routes are the eight operations above; the list response is
  `Page<Routine>`; `pause`/`resume`/`run` return the updated `Routine`. There is **no**
  `notificationPreference` group called `routine` in the contract: the preference is per event
  name, and the three names are already selectable in `notificationPreferencesSchema.events`.
  If Batch 9 wants one toggle, that is a new contract task, not a free edit.
- Known gap, deliberately not fixed here: `chatMessageSchema` has no `origin` field, so a
  `routine` message cannot be told apart by the app yet (Task-36's badge). The store column
  exists (Task-04) but the API shape does not; Batch 9 needs a contract task for it. Adding it
  now would change docs/api.md §5.6, which is not this task's section.
- For QA: `docs/api.md` is compared against the OpenAPI document by parsing every markdown
  table row between `## 2.` and `## 8.`; the §5.8 table must therefore use the same four-column
  shape (`Method | Path | Auth | Purpose`) and no other table row may be added elsewhere.

## ⛔ Out of scope

- No new dependency outside the spec (`zod@4.6.7` is already there), and no change to
  `packages/contracts/package.json` or `package-lock.json`.
- No refactor of a file this task did not have to touch.
- No change to `docs/decisions.md` outside `### Event types`.
- No routine store, repository, scheduler, engine, tool executor or UI (Tasks 34–36).
- No `routine` notification-preference group, no `origin` on `ChatMessage`, no
  `POST /v1/routines/{id}/skip`, no `routine.updated` event.
- No new `CB_*` key and no edit to `config.ts`.
- No version bump of the API prefix: adding optional fields and event types is additive inside
  `/v1` (`docs/api.md` §8).

# Spec: Task-70 — Contracts and store for the work model

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.
>
> Base: `origin/main` @ `c5fd969`. Task type: **package** (pure schemas + SQL + store
> repositories + docs). No daemon, no app, no ops, no new dependency.

## 🎯 Scope

- **Task type:** package (`packages/contracts`, `packages/store`) plus its sections of
  `docs/api.md` and `docs/architecture.md`.
- **Role:** Dev.
- **Objective:** after this task the tree can *describe and persist* the D44/D51–D56 model.
  `@codebox/contracts` exports `workSchema`, `sessionSchema`, `backlogSchema`,
  `repoScheduleSchema`, `providerSchema` and `providerAccountSchema` (with their inferred
  types, `parse*` helpers and page schemas) and the fourteen new SSE event names with their
  payload schemas; `@codebox/store` applies migrations `0006_works.sql` and
  `0007_providers.sql`, exposes `works`, `sessions`, `repoSchedules`, `providers`,
  `providerAccounts` and `legacy` on the `Store` handle, and records `chat_sessions` /
  `chat_messages` as read-only legacy tables; the OpenAPI document and `docs/api.md` agree
  again; `docs/architecture.md` names the real migration files and every table.
- **Environment:** worktree `../wt-cb-70`, branch `task-70`, base `main`.
- **Dependencies:** none. Task-70 is the first task of Batch 19; every other task in the batch
  reads the names frozen here.

### Migration numbers — read this before writing SQL

`packages/store/migrations/` already holds, on `main`:

```
0001_init.sql  0002_routines.sql  0003_chat_scope.sql  0004_schedules.sql  0005_chat_free.sql
```

`TODO.md` says `0003_works.sql` and `0004_providers.sql`; **those numbers are stale** — they
were written before `0003_chat_scope`/`0004_schedules`/`0005_chat_free` landed. The runner
(`packages/store/src/migrate.ts`) requires versions to be contiguous from 1 and checksum-pins
every applied file, so:

- this task creates **`0006_works.sql`** and **`0007_providers.sql`**;
- `0001`–`0005` are **never edited, renamed or renumbered**;
- the next free number after this task is `0008`.

Also: `schedules` and `schedule_fires` already exist (`0004_schedules.sql`). `0006_works.sql`
does **not** create them; it alters `schedules` additively. `chats` in `TODO.md` means the
existing `chat_sessions` / `chat_messages` tables (`0001_init.sql`, rebuilt by `0005`); no
table named `chats` exists.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

Contracts (hot file holder: `packages/contracts/src/index.ts` — Task-70 is the only task in
Batch 19 that claims it):

- `packages/contracts/src/index.ts`
- `packages/contracts/src/primitives.ts`
- `packages/contracts/src/works.ts` (new)
- `packages/contracts/src/providers.ts` (new)
- `packages/contracts/src/resources.ts`
- `packages/contracts/src/events.ts`
- `packages/contracts/src/pagination.ts`
- `packages/contracts/src/openapi.ts`
- `packages/contracts/src/works.test.ts` (new)
- `packages/contracts/src/providers.test.ts` (new)
- `packages/contracts/src/primitives.test.ts`
- `packages/contracts/src/events.test.ts`
- `packages/contracts/src/openapi.test.ts`
- `packages/contracts/src/index.test.ts`
- `packages/contracts/README.md`

Store:

- `packages/store/migrations/0006_works.sql` (new)
- `packages/store/migrations/0007_providers.sql` (new)
- `packages/store/src/works.ts` (new)
- `packages/store/src/sessions.ts` (new)
- `packages/store/src/repo-schedules.ts` (new)
- `packages/store/src/providers.ts` (new)
- `packages/store/src/legacy.ts` (new)
- `packages/store/src/mappers.ts`
- `packages/store/src/events.ts`
- `packages/store/src/store.ts`
- `packages/store/src/index.ts`
- `packages/store/src/works.test.ts` (new)
- `packages/store/src/sessions.test.ts` (new)
- `packages/store/src/repo-schedules.test.ts` (new)
- `packages/store/src/providers.test.ts` (new)
- `packages/store/src/migrate.test.ts`
- `packages/store/src/events.test.ts`
- `packages/store/src/store.test.ts`
- `packages/store/src/schedules.test.ts`
- `packages/store/README.md`

Docs (claimed by section; Task-70 is the only task in this batch that touches either file):

- `docs/api.md` — **§5.6, §5.6.1 and §5.10 only.** Do not touch any other heading.
- `docs/architecture.md` — **only** the one sentence above the table in §2 (`### packages/store`)
  and the table itself (its rows and its `Migration` column). Do not touch §1, §3–§8.

Explicitly **not** in the exclusive paths, so untouchable even if a gate seems to want it:
`package.json`, `package-lock.json`, `tsconfig.base.json`, `TODO.md`, `CHANGELOG.md`,
`docs/decisions.md`, `docs/jobs.md`, `docs/providers.md`, `docs/security.md`, anything under
`apps/`, `.agent_specs/`, `opencode.json`, `packages/store/src/schedules.ts`,
`packages/store/src/chats.ts`, `packages/store/src/schedule-fires.ts`,
`packages/store/src/mappers.ts`'s existing entries (only additive changes there),
`packages/contracts/src/errors.ts`, `packages/contracts/src/config.ts`,
`packages/contracts/src/parse.ts`, `packages/contracts/src/routines.ts`.

### Inputs (read-only)

Read these and only these (plus `AGENTS.md`):

- `docs/decisions.md` (D44, D51, D52, D53, D54, D55, D56)
- `docs/api.md` (§3, §4, §5.6, §5.6.1, §5.10, §6)
- `docs/jobs.md` (§16 field table and selection rule — read only, never edit)
- `docs/providers.md` (§5.1)
- `docs/architecture.md` (§2)
- `packages/contracts/src/{index,primitives,resources,events,pagination,openapi,parse,errors,config}.ts`
- `packages/store/src/{index,store,db,errors,cursor,mappers,migrate,chats,schedules,events}.ts`
- `packages/store/src/{migrate,store,runs,events,schedules}.test.ts`
- `packages/store/migrations/0001_init.sql` … `0005_chat_free.sql`

## 🔒 Contract

Everything below is frozen. Later tasks are written against these exact names, signatures and
column names; a rename here breaks Task-71…Task-76.

### 1. `packages/contracts/src/primitives.ts` — additive only

Add to `ID_PREFIXES` (keep every existing key and its order):

```ts
work: 'wrk_',
session: 'sess_',
providerAccount: 'acct_',
```

Add, next to the existing id schemas:

```ts
export const WorkId = idSchema('work');
export type WorkId = z.infer<typeof WorkId>;

export const SessionId = idSchema('session');
export type SessionId = z.infer<typeof SessionId>;

export const ProviderAccountId = idSchema('providerAccount');
export type ProviderAccountId = z.infer<typeof ProviderAccountId>;

/** D53: the backlog item's key, `Task-<digits>`. One definition, used by Work and Backlog. */
export const backlogRefSchema: z.ZodString = z.string().regex(/^Task-\d+$/);
export type BacklogRef = z.infer<typeof backlogRefSchema>;

export const WORK_STATES = [
  'queued', 'running', 'review', 'merged', 'failed', 'needs_decision', 'abandoned',
] as const;
export const workStateSchema = z.enum(WORK_STATES);
export type WorkState = z.infer<typeof workStateSchema>;

/** A work in one of these states blocks its backlog item (docs/jobs.md §16 selection). */
export const WORK_STATE_IN_FLIGHT: readonly WorkState[] = Object.freeze([
  'queued', 'running', 'needs_decision',
]);

export const WORK_ORIGINS = ['manual', 'backlog', 'schedule'] as const;
export const workOriginSchema = z.enum(WORK_ORIGINS);
export type WorkOrigin = z.infer<typeof workOriginSchema>;

export const SESSION_TARGETS = ['backlog', 'design', 'schedule', 'work', 'repo'] as const;
export const sessionTargetSchema = z.enum(SESSION_TARGETS);
export type SessionTarget = z.infer<typeof sessionTargetSchema>;

export const SESSION_STATUSES = ['idle', 'working', 'archived'] as const;
export const sessionStatusSchema = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const SELECTIONS = ['nextPending', 'refs'] as const;
export const selectionSchema = z.enum(SELECTIONS);
export type Selection = z.infer<typeof selectionSchema>;
```

Append these fourteen names to `SSE_EVENT_NAMES`, **in this order, after `telemetry`** (the
list is the D14/D16 list of `docs/api.md` §6; the existing 23 names keep their positions):

```ts
'work.created', 'work.updated', 'work.needs_decision', 'work.closed',
'session.created', 'session.delta', 'session.tool', 'session.proposal', 'session.closed',
'schedule.fired', 'schedule.skipped', 'provider.state',
'backlog.changed', 'design.changed',
```

`SSE_EVENT_NAMES` therefore holds 37 names. `chat.*`, `job.changed` and `routine.*` stay until
Task-76 retires their writers — do not remove them.

### 2. `packages/contracts/src/works.ts` (new)

```ts
import { z } from 'zod';
import { parseOrThrow } from './parse.js';
import {
  MessageId, RepoId, ScheduleId, SessionId, WorkId, backlogRefSchema, branchSchema,
  commitShaSchema, cronSchema, selectionSchema, sessionStatusSchema, sessionTargetSchema,
  timestampSchema, timezoneSchema, workOriginSchema, workStateSchema,
} from './primitives.js';
import {
  chatRoleSchema, costSchema, repoSchema, runSchema, scheduleModeSchema,
  scheduleWindowTimeSchema,
} from './resources.js';

// docs/api.md §5.6 — the parsed backlog, joined with works (D51).
export const backlogWorkRefSchema = z.strictObject({
  id: WorkId,
  state: workStateSchema,
  runs: z.number().int().nonnegative(),
});
export type BacklogWorkRef = z.infer<typeof backlogWorkRefSchema>;

export const backlogItemSchema = z.strictObject({
  ref: backlogRefSchema,
  title: z.string().min(1),
  checked: z.boolean(),
  line: z.number().int().positive(),
  work: backlogWorkRefSchema.nullable(),
});
export type BacklogItem = z.infer<typeof backlogItemSchema>;

export const backlogSectionSchema = z.strictObject({
  title: z.string().min(1),
  items: z.array(backlogItemSchema),
});
export type BacklogSection = z.infer<typeof backlogSectionSchema>;

export const backlogSchema = z.strictObject({
  repoId: RepoId,
  revision: commitShaSchema,
  path: z.string().min(1),
  sections: z.array(backlogSectionSchema),
});
export type Backlog = z.infer<typeof backlogSchema>;

// docs/api.md §5.6 / D44 / D51 — one work, one backlog item, no conversation.
export const workSchema = z.strictObject({
  id: WorkId,
  repoId: RepoId,
  backlogRef: backlogRefSchema,
  title: z.string().min(1),
  prompt: z.string().min(1),
  specSha: commitShaSchema,
  state: workStateSchema,
  origin: workOriginSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().min(1),
  usage: costSchema,
  contextTokens: z.number().int().nonnegative(),
  contextEpoch: z.number().int().min(1),
  reviewedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Work = z.infer<typeof workSchema>;

export const workDetailSchema = z.strictObject({
  work: workSchema,
  repo: repoSchema,
  runs: z.array(runSchema),
});
export type WorkDetail = z.infer<typeof workDetailSchema>;

// docs/api.md §5.6.1 / D55 — a chat with one target; the target is the write boundary.
export const sessionProposalSchema = z.strictObject({
  branch: branchSchema,
  sha: commitShaSchema,
  paths: z.array(z.string().min(1)).min(1),
  createdAt: timestampSchema,
});
export type SessionProposal = z.infer<typeof sessionProposalSchema>;

export const sessionMessageSchema = z.strictObject({
  id: MessageId,
  sessionId: SessionId,
  role: chatRoleSchema,
  text: z.string(),
  createdAt: timestampSchema,
});
export type SessionMessage = z.infer<typeof sessionMessageSchema>;

export const sessionSchema = z
  .strictObject({
    id: SessionId,
    repoId: RepoId,
    target: sessionTargetSchema,
    workId: WorkId.nullable(),
    title: z.string().min(1),
    status: sessionStatusSchema,
    branch: branchSchema.nullable(),
    pendingProposal: sessionProposalSchema.nullable(),
    usage: costSchema,
    contextTokens: z.number().int().nonnegative(),
    contextEpoch: z.number().int().min(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    lastMessage: sessionMessageSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if ((value.target === 'work') !== (value.workId !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['workId'],
        message: 'only a work session names a work, and a work session must name one',
      });
    }
    if (value.target === 'repo' && (value.branch !== null || value.pendingProposal !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'a repo session is read-only: no branch and no proposal',
      });
    }
  });
export type Session = z.infer<typeof sessionSchema>;

// docs/api.md §5.10 / D56 — the repository's recurrence. No title, no prompt, no chat.
export const repoScheduleSchema = z
  .strictObject({
    id: ScheduleId,
    repoId: RepoId,
    mode: scheduleModeSchema,
    cron: cronSchema.nullable(),
    timezone: timezoneSchema,
    windowStart: scheduleWindowTimeSchema.nullable(),
    windowEnd: scheduleWindowTimeSchema.nullable(),
    cooldownMinutes: z.number().int().nonnegative(),
    selection: selectionSchema,
    refs: z.array(backlogRefSchema),
    maxAttempts: z.number().int().min(1),
    maxFires: z.number().int().min(1).nullable(),
    maxCostPerFireUsd: z.number().nonnegative().nullable(),
    consecutiveFailures: z.number().int().nonnegative(),
    firesCount: z.number().int().nonnegative(),
    spendUsd: z.number().nonnegative(),
    enabled: z.boolean(),
    nextFireAt: timestampSchema.nullable(),
    lastFiredAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'window') {
      if (
        value.cron !== null ||
        value.windowStart === null ||
        value.windowEnd === null ||
        value.windowStart === value.windowEnd
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['mode'],
          message: 'a window schedule needs windowStart and windowEnd, distinct, and no cron',
        });
      }
    } else if (
      value.cron === null ||
      value.windowStart !== null ||
      value.windowEnd !== null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'a schedule without a window needs a cron and no window bounds',
      });
    }
    if (value.selection === 'nextPending' && value.refs.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['refs'], message: 'nextPending carries no refs' });
    }
    if (value.selection === 'refs' && value.refs.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['refs'], message: 'refs selection needs one ref' });
    }
  });
export type RepoSchedule = z.infer<typeof repoScheduleSchema>;

export function parseBacklog(input: unknown): Backlog;
export function parseWork(input: unknown): Work;
export function parseWorkDetail(input: unknown): WorkDetail;
export function parseSession(input: unknown): Session;
export function parseSessionMessage(input: unknown): SessionMessage;
export function parseRepoSchedule(input: unknown): RepoSchedule;
```

Implement each `parse*` as `parseOrThrow(<schema>, input, '<boundary>')` with boundaries
`'backlog'`, `'work'`, `'workDetail'`, `'session'`, `'sessionMessage'`, `'repoSchedule'`.

Imports of `scheduleModeSchema`, `scheduleWindowTimeSchema`, `cronSchema`, `timezoneSchema`
and `ScheduleId` come from `./resources.js` / `./primitives.js` exactly as listed above.
**The legacy `scheduleSchema` in `resources.ts` is not renamed, not changed and not removed**:
the current daemon and app still use it (see Coordination). `repoScheduleSchema` lives in
`works.ts` on purpose — it is the schedule *of a work's repository*, and `resources.ts` is
frozen.

### 3. `packages/contracts/src/providers.ts` (new)

```ts
import { z } from 'zod';
import { parseOrThrow } from './parse.js';
import { ProviderAccountId, timestampSchema } from './primitives.js';

export const providerIdSchema: z.ZodString = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const PROVIDER_AUTH_KINDS = ['oauth', 'token'] as const;
export const providerAuthKindSchema = z.enum(PROVIDER_AUTH_KINDS);
export type ProviderAuthKind = z.infer<typeof providerAuthKindSchema>;

export const providerSchema = z.strictObject({
  id: providerIdSchema,
  label: z.string().min(1).max(80),
  authKind: providerAuthKindSchema,
  baseUrl: z.url({ protocol: /^https$/ }).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Provider = z.infer<typeof providerSchema>;

export const PROVIDER_ACCOUNT_STATES = ['active', 'exhausted', 'invalid', 'disabled'] as const;
export const providerAccountStateSchema = z.enum(PROVIDER_ACCOUNT_STATES);
export type ProviderAccountState = z.infer<typeof providerAccountStateSchema>;

/** `usedToday` is the account's own daily rollup; `day` is UTC, `YYYY-MM-DD` (D54 budget). */
export const accountDaySchema: z.ZodString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const providerAccountSchema = z
  .strictObject({
    id: ProviderAccountId,
    providerId: providerIdSchema,
    label: z.string().min(1).max(80),
    credentialId: z.string().min(1),
    priority: z.number().int().min(0),
    state: providerAccountStateSchema,
    resetAt: timestampSchema.nullable(),
    budgetUsd: z.number().nonnegative().nullable(),
    usedToday: z.strictObject({
      day: accountDaySchema,
      usd: z.number().nonnegative(),
    }),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((value, ctx) => {
    if (value.state === 'exhausted' && value.resetAt === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['resetAt'],
        message: 'an exhausted account carries the instant it may be used again',
      });
    }
  });
export type ProviderAccount = z.infer<typeof providerAccountSchema>;

export function parseProvider(input: unknown): Provider;
export function parseProviderAccount(input: unknown): ProviderAccount;
```

No `z.ZodString` cast, no `any`: `providerIdSchema` is used directly as a field schema.

### 4. `packages/contracts/src/resources.ts` — no change required

Nothing is added to or removed from `resources.ts`: the legacy `scheduleSchema`, `Schedule`,
`parseSchedule`, `parseScheduleDetail`, `chatSessionSchema` and every other export keep their
exact shape (the daemon and the app import them). If a shared sub-schema is needed
(`costSchema`, `runSchema`, `repoSchema`, `chatRoleSchema`, `scheduleModeSchema`,
`scheduleWindowTimeSchema`), it is imported into `works.ts`, not copied. The file may only be
touched if the build forces it; a change there must stay additive and must be named in the
task's final report.

### 5. `packages/contracts/src/events.ts` — the fourteen payloads

New bases and payloads (each `strictObject`):

```ts
export const workEventBase = z.strictObject({
  workId: WorkId, seq: z.number().int().min(1), ts: timestampSchema,
});
export const workCreatedDataSchema = workEventBase.extend({
  repoId: RepoId, backlogRef: backlogRefSchema, origin: workOriginSchema,
});
export const workUpdatedDataSchema = workEventBase.extend({
  state: workStateSchema, attempts: z.number().int().nonnegative(),
});
export const workNeedsDecisionDataSchema = workEventBase.extend({
  reason: z.string().min(1),
});
export const workClosedDataSchema = workEventBase.extend({
  state: z.enum(['merged', 'failed', 'abandoned']),
});

export const sessionEventBase = z.strictObject({
  sessionId: SessionId, seq: z.number().int().min(1), ts: timestampSchema,
});
export const sessionCreatedDataSchema = sessionEventBase.extend({
  repoId: RepoId, target: sessionTargetSchema, workId: WorkId.nullable(),
});
export const sessionDeltaDataSchema = sessionEventBase.extend({ delta: z.string() });
export const sessionToolDataSchema = sessionEventBase.extend({
  tool: z.string().min(1), status: toolStatusSchema, detail: z.string().optional(),
});
export const sessionProposalDataSchema = sessionEventBase.extend({
  proposal: sessionProposalSchema,
});
export const sessionClosedDataSchema = sessionEventBase.extend({
  status: z.literal('archived'),
});

export const scheduleFiredDataSchema = z.strictObject({
  scheduleId: ScheduleId,
  scheduledFor: timestampSchema,
  workId: WorkId.nullable(),
  runId: RunId.nullable(),
  ts: timestampSchema,
});
export const scheduleSkippedDataSchema = z.strictObject({
  scheduleId: ScheduleId,
  scheduledFor: timestampSchema,
  reason: z.enum(['nothing_pending', 'nothing_runnable', 'misfire_grace']),
  ts: timestampSchema,
});

export const providerStateDataSchema = z.strictObject({
  providerId: providerIdSchema,
  accountId: ProviderAccountId,
  state: providerAccountStateSchema,
  resetAt: timestampSchema.nullable(),
  ts: timestampSchema,
});

export const backlogChangedDataSchema = z.strictObject({
  repoId: RepoId, revision: commitShaSchema, ts: timestampSchema,
});
export const designChangedDataSchema = z.strictObject({
  repoId: RepoId, revision: commitShaSchema, ts: timestampSchema,
});
```

Add one `z.strictObject({ event: z.literal('<name>'), data: <payload> })` member per new name to
`sseEventSchema`, in the same order as the `SSE_EVENT_NAMES` append above. `SseEvent`,
`SseEventData`, `parseSseEvent`, `parseSseStreamEvent`, `sseGap*`, `SSE_RETRY_MS` and
`SSE_HEARTBEAT_SECONDS` do not change. `chat.*`, `job.changed` and `routine.*` members stay.

### 6. `packages/contracts/src/pagination.ts` — additive only

```ts
export const pageOfWork: z.ZodType<Page<Work>> = pageSchema(workSchema);
export const pageOfSession: z.ZodType<Page<Session>> = pageSchema(sessionSchema);
export const pageOfSessionMessage: z.ZodType<Page<SessionMessage>> = pageSchema(sessionMessageSchema);
export const pageOfRepoSchedule: z.ZodType<Page<RepoSchedule>> = pageSchema(repoScheduleSchema);
```

Existing `pageOf*`, `IDEMPOTENT_ROUTES` and the limits are unchanged.

### 7. `packages/contracts/src/openapi.ts` — the document follows `docs/api.md`, 57 → 62

**Measured state on `main` @ `c5fd969`.** `npx vitest run`: 157 test files pass and **one fails**,
`packages/contracts/src/openapi.test.ts` (2 failed / 8 passed). `Object.keys(buildOpenApiDocument().paths)`
has **57** entries; `docsPaths()` — every route-table row between `## 2.` and `## 8.` of
`docs/api.md`, plus the implicit `/v1/events` — returns **62**. The two failures are:

- `docs/api.md routes match the OpenAPI paths` (line 101, `toEqual(docsPaths())`; line 102 pins
  `toHaveLength(57)`): the document and the docs disagree by 31 paths in both directions.
- `documents the three chat lifecycle routes` (line 141, `expect(docsPaths()).toContain(path)`):
  `docs/api.md` no longer documents `/v1/chat/**` — §5.6/§5.6.1 rewrote those tables for D44/D55 —
  so the test pins a surface the docs retired.

**Frozen rule: `docs/api.md` owns the documented surface and is already correct; the OpenAPI
document follows it.** D44 removed chat and D55 removed the chat session model, D56 removed
routines; Task-76 deletes their code. The document must therefore stop advertising them.
Nothing consumes the document at runtime (`grep -rn buildOpenApiDocument` matches only
`packages/contracts/src/index.ts`, `packages/contracts/src/openapi.ts` and
`packages/contracts/src/openapi.test.ts`), so removing operations breaks no caller.

#### 7a. Add 18 paths / 25 operations

Add these `RouteSpec` entries to `ROUTES`. `tag: 'works'` for the work paths, `tag: 'sessions'`
for the session paths, `tag: 'providers'` for the provider paths. Each `operationId` is unique
in the document.

| Path | Method | `operationId` | Status | Response |
| --- | --- | --- | --- | --- |
| `/v1/repos/{id}/backlog` | get | `getRepoBacklog` | 200 | `Backlog` |
| `/v1/works` | get | `listWorks` | 200 | `WorkPage` |
| `/v1/works` | post | `createWork` | 201 | `Work` |
| `/v1/works/{id}` | get | `getWork` | 200 | `WorkDetail` |
| `/v1/works/{id}` | patch | `updateWork` | 200 | `Work` |
| `/v1/works/{id}` | delete | `archiveWork` | 204 | `null` |
| `/v1/works/{id}/runs` | post | `startWorkRun` | 202 | `Run` |
| `/v1/works/{id}/decision` | post | `openWorkDecision` | 201 | `Session` |
| `/v1/works/{id}/reviewed` | post | `reviewWork` | 200 | `Work` |
| `/v1/works/{id}/interrupt` | post | `interruptWork` | 202 | `Work` |
| `/v1/sessions` | get | `listSessions` | 200 | `SessionPage` |
| `/v1/sessions` | post | `createSession` | 201 | `Session` |
| `/v1/sessions/{id}` | get | `getSession` | 200 | `Session` |
| `/v1/sessions/{id}` | delete | `archiveSession` | 204 | `null` |
| `/v1/sessions/{id}/messages` | get | `listSessionMessages` | 200 | `SessionMessagePage` |
| `/v1/sessions/{id}/messages` | post | `appendSessionMessage` | 202 | `SessionMessage` |
| `/v1/sessions/{id}/compact` | post | `compactSession` | 200 | `Session` |
| `/v1/sessions/{id}/merge` | post | `mergeSession` | 200 | `Session` |
| `/v1/sessions/{id}/interrupt` | post | `interruptSession` | 202 | `Session` |
| `/v1/providers/{id}/accounts` | post | `addProviderAccount` | 201 | `ProviderAccount` |
| `/v1/providers/{id}/oauth/start` | post | `startProviderOauth` | 200 | `ProviderOauthStart` |
| `/v1/providers/{id}/oauth/complete` | post | `completeProviderOauth` | 201 | `ProviderAccount` |
| `/v1/provider-accounts/{id}` | patch | `updateProviderAccount` | 200 | `ProviderAccount` |
| `/v1/provider-accounts/{id}` | delete | `deleteProviderAccount` | 204 | `null` |
| `/v1/provider-accounts/{id}/test` | post | `testProviderAccount` | 200 | `ProviderAccountTest` |

`/v1/providers` itself is already in `ROUTES` (unchanged).

#### 7b. Remove 13 paths / 20 operations

Delete these `RouteSpec` entries from `ROUTES` (D44/D55/D56 retired the surface; the code is
removed by Task-76):

- `/v1/chat/sessions` — `GET`, `POST`
- `/v1/chat/sessions/{id}` — `GET`, `PATCH`, `DELETE`
- `/v1/chat/sessions/{id}/compact` — `POST`
- `/v1/chat/sessions/{id}/interrupt` — `POST`
- `/v1/chat/sessions/{id}/messages` — `GET`, `POST`
- `/v1/chat/sessions/{id}/promote` — `POST`
- `/v1/chat/sessions/{id}/repo` — `POST`
- `/v1/chat/sessions/{id}/reviewed` — `POST`
- `/v1/routines` — `GET`, `POST`
- `/v1/routines/{id}` — `GET`, `PATCH`, `DELETE`
- `/v1/routines/{id}/pause` — `POST`
- `/v1/routines/{id}/resume` — `POST`
- `/v1/routines/{id}/run` — `POST`

`OPENAPI_PATHS` is derived from `ROUTES`, so the removals need no other edit. **Keep** the
`Routine`, `ChatSession` and `ChatMessage` schemas in `componentSchemas` and the chat/routine
members of `sseEventSchema` in `events.ts`: they are still exported types, `requiredComponents`
still lists `Routine`, and the test `the OpenAPI document lists the three routine events` still
passes. Keep the `chat` and `routines` document tags as well (no test compares tags; Task-76
removes them with the code).

#### 7c. Components, pin and the retirement test

- Add to `componentSchemas`: `Work: workSchema`, `WorkDetail: workDetailSchema`,
  `Backlog: backlogSchema`, `Session: sessionSchema`, `SessionMessage: sessionMessageSchema`,
  `WorkPage: pageOfWork`, `SessionPage: pageOfSession`,
  `SessionMessagePage: pageOfSessionMessage`, `ProviderAccount: providerAccountSchema`, and two
  protocol components declared **in `openapi.ts`** (they are transport shapes, not resources):

  ```ts
  const providerOauthStartSchema = z.strictObject({
    authorizeUrl: z.url({ protocol: /^https$/ }),
    state: z.string().min(1),
  });
  const providerAccountTestSchema = z.strictObject({
    ok: z.boolean(),
    state: providerAccountStateSchema,
    lastError: z.string().min(1).nullable(),
  });
  ```

  registered as `ProviderOauthStart` and `ProviderAccountTest`. Import `providerAccountSchema`
  and `providerAccountStateSchema` from `./providers.js`.
- Add the document tag `{ name: 'providers', description: 'Provider adapters and their failover
  accounts (D54).' }`, plus the `works` and `sessions` tags from the earlier plan:
  `{ name: 'works', description: 'Backlog items bound to a repository, and their runs.' }` and
  `{ name: 'sessions', description: 'Editor sessions with one target.' }`.
- In `openapi.test.ts`: set the pin to **62**
  (`expect(Object.keys(document.paths)).toHaveLength(62)`), keep
  `expect(Object.keys(document.paths).sort()).toEqual(docsPaths())` untouched, and add the new
  names to `requiredComponents`: `Work`, `WorkDetail`, `Backlog`, `Session`, `SessionMessage`,
  `WorkPage`, `SessionPage`, `SessionMessagePage`, `ProviderAccount`, `ProviderOauthStart`,
  `ProviderAccountTest`.
- **Replace** the test `documents the three chat lifecycle routes` with one named
  `retires the chat and routine paths`, whose body loops over the document's own paths and
  asserts the retirement:

  ```ts
  it('retires the chat and routine paths', () => {
    const document = buildOpenApiDocument();
    const paths = Object.keys(document.paths);
    for (const path of paths) {
      expect(path.startsWith('/v1/chat/'), path).toBe(false);
      expect(path === '/v1/routines' || path.startsWith('/v1/routines/'), path).toBe(false);
    }
    expect(paths).toContain('/v1/works');
    expect(paths).toContain('/v1/sessions');
  });
  ```

- **Do not** add `/v1/schedules*`, `/v1/repos/{id}/run-next` or `/v1/reminders`: §5.10 lists its
  routes as bullets (not table rows), so they are not part of `docsPaths()` and adding them
  would make the document's path set differ from the documented one and fail the same guard.
  They land with the task that turns §5.10 into a route table.

Arithmetic: 57 + 18 − 13 = **62** paths, which is exactly what `docsPaths()` returns; the guard
compares sets, not counts, so the pin is a second, independent assertion of the same number.


### 8. `packages/contracts/src/index.ts` (hot file — Task-70 is the only holder)

Re-export every new name once, grouped like the file already does:

- from `./primitives.js`: values `WorkId`, `SessionId`, `ProviderAccountId`,
  `backlogRefSchema`, `WORK_STATES`, `workStateSchema`, `WORK_STATE_IN_FLIGHT`,
  `WORK_ORIGINS`, `workOriginSchema`, `SESSION_TARGETS`, `sessionTargetSchema`,
  `SESSION_STATUSES`, `sessionStatusSchema`, `SELECTIONS`, `selectionSchema`; types `WorkState`,
  `WorkOrigin`, `SessionTarget`, `SessionStatus`, `Selection`, `BacklogRef`.
- from `./works.js`: values `backlogWorkRefSchema`, `backlogItemSchema`, `backlogSectionSchema`,
  `backlogSchema`, `workSchema`, `workDetailSchema`, `sessionProposalSchema`,
  `sessionMessageSchema`, `sessionSchema`, `repoScheduleSchema`, `parseBacklog`, `parseWork`,
  `parseWorkDetail`, `parseSession`, `parseSessionMessage`, `parseRepoSchedule`; types
  `BacklogWorkRef`, `BacklogItem`, `BacklogSection`, `Backlog`, `Work`, `WorkDetail`,
  `SessionProposal`, `SessionMessage`, `Session`, `RepoSchedule`.
- from `./providers.js`: values `providerIdSchema`, `PROVIDER_AUTH_KINDS`,
  `providerAuthKindSchema`, `providerSchema`, `PROVIDER_ACCOUNT_STATES`,
  `providerAccountStateSchema`, `accountDaySchema`, `providerAccountSchema`, `parseProvider`,
  `parseProviderAccount`; types `ProviderId`, `ProviderAuthKind`, `Provider`,
  `ProviderAccountState`, `ProviderAccount`.
- from `./pagination.js`: values `pageOfWork`, `pageOfSession`, `pageOfSessionMessage`,
  `pageOfRepoSchedule`.
- from `./events.js`: values `workEventBase`, `workCreatedDataSchema`, `workUpdatedDataSchema`,
  `workNeedsDecisionDataSchema`, `workClosedDataSchema`, `sessionEventBase`,
  `sessionCreatedDataSchema`, `sessionDeltaDataSchema`, `sessionToolDataSchema`,
  `sessionProposalDataSchema`, `sessionClosedDataSchema`, `scheduleFiredDataSchema`,
  `scheduleSkippedDataSchema`, `providerStateDataSchema`, `backlogChangedDataSchema`,
  `designChangedDataSchema`.

`events.ts` gains these imports: from `./primitives.js` — `WorkId`, `SessionId`, `ScheduleId`,
`RunId`, `ProviderAccountId`, `backlogRefSchema`, `commitShaSchema`, `workOriginSchema`,
`workStateSchema`, `sessionTargetSchema`; from `./works.js` — `sessionProposalSchema`; from
`./providers.js` — `providerIdSchema`, `providerAccountStateSchema`. There is no import cycle:
`providers.ts` imports only `parse.js` and `primitives.js`; `works.ts` imports `primitives.js`
and `resources.js`; `resources.ts` imports only `primitives.js` and `parse.js`; nothing imports
`openapi.ts` except the entry point and its test.

### 8b. `docs/api.md` §5.6, §5.6.1, §5.10 — reconcile with the frozen schemas

The three sections already describe the D44–D56 model; this task makes them name the exact
keys of the schemas above. **The route tables in `docs/api.md` are not edited at all** — they
are the owner of the documented surface and already match (`docsPaths()` returns 62, the same
62 the document will carry after §7). A dev who finds a docs route table that disagrees with
the document stops and reports it; the document is the side that changes. The only
`docs/api.md` edits are the JSON blocks and paragraphs below, in §5.6, §5.6.1 and §5.10.

- §5.6, after the bullet list that ends with "`usage`, `contextTokens`, `contextEpoch`,
  `reviewedAt` — as before (D48)".: add one `Work` JSON block with exactly these keys, in this
  order, and the same `wrk_01J…` id style the section already uses:
  `id`, `repoId`, `backlogRef`, `title`, `prompt`, `specSha`, `state`, `origin`, `attempts`,
  `maxAttempts`, `usage` (`{ usd, tokensIn, tokensOut }`), `contextTokens`, `contextEpoch`,
  `reviewedAt`, `createdAt`, `updatedAt`. Add one sentence: `specSha` is the default-branch
  commit the item's title and body were read at (D51) — the file stays the owner, the row is
  the cache.
- §5.6.1, after the existing bullet list ("A session never starts a run and never ticks a
  backlog item."): add one `Session` JSON block with exactly these keys:
  `id`, `repoId`, `target`, `workId`, `title`, `status`, `branch`, `pendingProposal`,
  `usage`, `contextTokens`, `contextEpoch`, `createdAt`, `updatedAt`, `lastMessage`; and one
  `pendingProposal` fragment `{ "branch": "cb/design-edit", "sha": "9f1c2ab", "paths":
  ["design/tokens/core.json"], "createdAt": "2026-10-28T09:12:00Z" }`. State that `workId` is
  non-null exactly when `target = "work"`, and that `target = "repo"` carries a null `branch`
  and a null `pendingProposal`.
- §5.10: add one paragraph after the JSON block: `refs` is stored as a JSON array (`[]` for
  `nextPending`) and `maxAttempts` defaults to `2`; the table also keeps the legacy `title`,
  `prompt`, `chat_session_id`, `fire_policy` and `policy` columns that D56 no longer reads, and
  a repository schedule stores them as `''`/`NULL`/`'new_chat'`/`'auto'` until they are
  dropped. No route bullet changes.

### 8c. `docs/architecture.md` §2 — the tables

- Replace the sentence "`0001_init.sql` creates the ten v1 tables below, and the works/schedules
  migration adds their tables." with one that names `0006_works.sql` and `0007_providers.sql`.
- In the table: change the `Migration` cell of `works`, `sessions`, `session_messages` from
  `0003_works.sql` to `0006_works.sql`; of `providers`, `provider_accounts` from
  `0004_providers.sql` to `0007_providers.sql`; of `schedules` and `schedule_fires` to
  `0004_schedules.sql (altered by 0006_works.sql)`.
- Add three rows: `chat_sessions` — "Legacy chat thread, read-only by D44; no new writer."
  (`0001_init.sql`), `chat_messages` — "Legacy chat messages, read-only by D44."
  (`0001_init.sql`), and `schema_legacy` — "The tables D44 retired, with their read-only
  marker." (`0006_works.sql`).
- Nothing else in the file changes.

### 9. Data — `packages/store/migrations/0006_works.sql` (new)

Header comment (two lines minimum): forward only, checksum-pinned, additively alters
`runs`/`schedules`/`run_events`, and `schema_legacy` marks the chat tables read-only by D44.
Ids and timestamps are caller-supplied TEXT; booleans INTEGER (0,1); money REAL USD; objects
JSON TEXT.

```sql
CREATE TABLE works (
  id               TEXT PRIMARY KEY,
  repo_id          TEXT NOT NULL REFERENCES repos(id) ON DELETE RESTRICT,
  backlog_ref      TEXT NOT NULL,
  title            TEXT NOT NULL,
  prompt           TEXT NOT NULL,
  spec_sha         TEXT NOT NULL,
  state            TEXT NOT NULL CHECK (state IN ('queued', 'running', 'review', 'merged', 'failed', 'needs_decision', 'abandoned')),
  origin           TEXT NOT NULL CHECK (origin IN ('manual', 'backlog', 'schedule')),
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts     INTEGER NOT NULL DEFAULT 2 CHECK (max_attempts >= 1),
  usage_usd        REAL NOT NULL DEFAULT 0 CHECK (usage_usd >= 0),
  usage_tokens_in  INTEGER NOT NULL DEFAULT 0 CHECK (usage_tokens_in >= 0),
  usage_tokens_out INTEGER NOT NULL DEFAULT 0 CHECK (usage_tokens_out >= 0),
  context_tokens   INTEGER NOT NULL DEFAULT 0 CHECK (context_tokens >= 0),
  context_epoch    INTEGER NOT NULL DEFAULT 1 CHECK (context_epoch >= 1),
  reviewed_at      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX works_repo_state   ON works (repo_id, state, updated_at DESC);
CREATE INDEX works_repo_backlog ON works (repo_id, backlog_ref, created_at DESC);
-- One work in flight per backlog item: the D56 selection must never open a second run of it.
CREATE UNIQUE INDEX works_live_item ON works (repo_id, backlog_ref)
  WHERE state IN ('queued', 'running', 'needs_decision');

CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY,
  repo_id             TEXT NOT NULL REFERENCES repos(id) ON DELETE RESTRICT,
  target              TEXT NOT NULL CHECK (target IN ('backlog', 'design', 'schedule', 'work', 'repo')),
  work_id             TEXT REFERENCES works(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('idle', 'working', 'archived')),
  opencode_session_id TEXT,
  worktree            TEXT,
  branch              TEXT,
  pending_proposal    TEXT,
  usage_usd           REAL NOT NULL DEFAULT 0 CHECK (usage_usd >= 0),
  usage_tokens_in     INTEGER NOT NULL DEFAULT 0 CHECK (usage_tokens_in >= 0),
  usage_tokens_out    INTEGER NOT NULL DEFAULT 0 CHECK (usage_tokens_out >= 0),
  context_tokens      INTEGER NOT NULL DEFAULT 0 CHECK (context_tokens >= 0),
  context_epoch       INTEGER NOT NULL DEFAULT 1 CHECK (context_epoch >= 1),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK ((target = 'work') = (work_id IS NOT NULL))
);

CREATE INDEX sessions_repo   ON sessions (repo_id, updated_at DESC);
CREATE INDEX sessions_target ON sessions (repo_id, target, updated_at DESC);
CREATE INDEX sessions_work   ON sessions (work_id) WHERE work_id IS NOT NULL;

CREATE TABLE session_messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX session_messages_session ON session_messages (session_id, created_at);

-- D44: the chat tables are retired. They stay readable and their rows are never rewritten by
-- new code; the refusal triggers land with the removal of their last writer (Task-76).
CREATE TABLE schema_legacy (
  table_name TEXT PRIMARY KEY,
  retired_by TEXT NOT NULL,
  read_only  INTEGER NOT NULL CHECK (read_only = 1)
);

INSERT INTO schema_legacy (table_name, retired_by, read_only) VALUES
  ('chat_sessions', 'D44', 1),
  ('chat_messages', 'D44', 1);

ALTER TABLE runs ADD COLUMN work_id TEXT REFERENCES works(id) ON DELETE SET NULL;
CREATE INDEX runs_work_created ON runs (work_id, created_at DESC);

ALTER TABLE run_events ADD COLUMN work_id TEXT REFERENCES works(id) ON DELETE CASCADE;
ALTER TABLE run_events ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX run_events_work_seq ON run_events (work_id, seq) WHERE work_id IS NOT NULL;
CREATE UNIQUE INDEX run_events_session_seq ON run_events (session_id, seq) WHERE session_id IS NOT NULL;

-- D56: the schedule becomes the repository's. Additive on purpose: the legacy `/v1/schedules`
-- accessors still read title, prompt, chat_session_id, fire_policy and policy, and they are
-- retired by a later task; a rebuild that made repo_id NOT NULL would break them here.
ALTER TABLE schedules ADD COLUMN selection TEXT NOT NULL DEFAULT 'nextPending'
  CHECK (selection IN ('nextPending', 'refs'));
ALTER TABLE schedules ADD COLUMN refs TEXT NOT NULL DEFAULT '[]';
ALTER TABLE schedules ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 2
  CHECK (max_attempts >= 1);
CREATE UNIQUE INDEX schedules_one_per_repo ON schedules (repo_id)
  WHERE repo_id IS NOT NULL;
```

The unique index fails loudly if two existing rows already share a repository: that is a
deliberate failure, not a silent delete. Do not add `IF NOT EXISTS` anywhere — the runner's
`(version, checksum)` bookkeeping already guarantees single application.

### 10. Data — `packages/store/migrations/0007_providers.sql` (new)

```sql
CREATE TABLE providers (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  auth_kind  TEXT NOT NULL CHECK (auth_kind IN ('oauth', 'token')),
  base_url   TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE provider_accounts (
  id             TEXT PRIMARY KEY,
  provider_id    TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  credential_id  TEXT NOT NULL,
  priority       INTEGER NOT NULL DEFAULT 0 CHECK (priority >= 0),
  state          TEXT NOT NULL CHECK (state IN ('active', 'exhausted', 'invalid', 'disabled')),
  reset_at       TEXT,
  budget_usd     REAL CHECK (budget_usd IS NULL OR budget_usd >= 0),
  used_today_usd REAL NOT NULL DEFAULT 0 CHECK (used_today_usd >= 0),
  used_today_day TEXT NOT NULL DEFAULT '1970-01-01',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (provider_id, label),
  CHECK (state <> 'exhausted' OR reset_at IS NOT NULL)
);

CREATE UNIQUE INDEX provider_accounts_credential ON provider_accounts (credential_id);
CREATE INDEX provider_accounts_selection ON provider_accounts (provider_id, state, priority, id);
CREATE INDEX provider_accounts_reset ON provider_accounts (state, reset_at);
```

`credential_id` is a D49 credential id (a file under `CB_STATE_DIR/secrets`), so it carries no
foreign key. One account per credential is enforced by the unique index.

### 11. `packages/store/src/mappers.ts` — additive only

- Extend the local `SSE_EVENT_NAMES` constant with the same fourteen names (the daemon's and
  the app's writers must be readable; `eventFromRow` refuses an unknown `type`).
- Add `WORK_STATES`, `WORK_ORIGINS`, `SESSION_TARGETS`, `SESSION_STATUSES`, `SELECTIONS`,
  `PROVIDER_STATES`, `PROVIDER_AUTH_KINDS` local constants next to the existing ones (the module
  re-declares contract enums because it imports `@codebox/contracts` type-only).
- Add mappers, each returning the contract type:
  - `workFromRow(rowValue: Row): Work`
  - `sessionFromRow(rowValue: Row, lastMessage: SessionMessage | null): Session`
  - `sessionMessageFromRow(rowValue: Row): SessionMessage`
  - `repoScheduleFromRow(rowValue: Row): RepoSchedule`
  - `providerFromRow(rowValue: Row): Provider`
  - `providerAccountFromRow(rowValue: Row): ProviderAccount` (assembles
    `usedToday: { day: textColumn(row,'used_today_day'), usd: realColumn(row,'used_today_usd') }`)
- `scheduleFromRow`, `chatSessionFromRow` and every existing mapper keep their behaviour.

### 12. `packages/store/src/works.ts` (new)

```ts
export interface WorkFilter {
  readonly repoId?: string;
  readonly state?: WorkState;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface WorkPatch {
  readonly title?: string;
  readonly prompt?: string;
  readonly specSha?: string;
  readonly state?: WorkState;
  readonly attempts?: number;
  readonly maxAttempts?: number;
  readonly usage?: { readonly usd: number; readonly tokensIn: number; readonly tokensOut: number };
  readonly contextTokens?: number;
  readonly contextEpoch?: number;
  readonly reviewedAt?: string | null;
  readonly updatedAt: string;
}

export interface WorkRepository {
  get(id: string): Work | null;
  list(filter: WorkFilter): PageResult<Work>;
  create(work: Work): Work;
  update(id: string, patch: WorkPatch): Work;
  /** The newest work of that item, in any state; `null` when the item has none. */
  findByBacklogRef(repoId: string, backlogRef: string): Work | null;
}

export function createWorkRepository(db: DatabaseSync): WorkRepository;
```

`create` maps a unique violation to
`new StoreError('unique_violation', 'work already in flight for this backlog item')`, a foreign
key violation to `foreign_key_violation` (`'work repository is missing'`). `update` on an
unknown id is `not_found` (`'work not found'`), and `update` maps a check violation to
`check_violation` (`'work violates a state constraint'`). `list` is newest-first by
`(updated_at DESC, id DESC)` with the same opaque `(createdAt, id)` cursor shape as
`schedules.ts` (use the `updated_at` value as the cursor timestamp). `update` stamps
`updated_at` from `patch.updatedAt` — no repository reads the clock.

### 13. `packages/store/src/sessions.ts` (new)

```ts
export interface SessionFilter {
  readonly repoId?: string;
  readonly target?: SessionTarget;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface SessionPatch {
  readonly title?: string;
  readonly status?: SessionStatus;
  readonly branch?: string | null;
  readonly pendingProposal?: SessionProposal | null;
  readonly opencodeSessionId?: string | null;
  readonly worktree?: string | null;
  readonly usage?: { readonly usd: number; readonly tokensIn: number; readonly tokensOut: number };
  readonly contextTokens?: number;
  readonly contextEpoch?: number;
  readonly updatedAt: string;
}

export interface SessionRepository {
  getSession(id: string): Session | null;
  listSessions(filter: SessionFilter): PageResult<Session>;
  /** `lastMessage` must be `null`; the row is inserted with it absent. */
  createSession(session: Session): Session;
  updateSession(id: string, patch: SessionPatch): Session;
  appendMessage(message: SessionMessage): SessionMessage;
  listMessages(sessionId: string, query: PageQuery): PageResult<SessionMessage>;
}

export function createSessionRepository(db: DatabaseSync): SessionRepository;
```

`pending_proposal` is `JSON.stringify` / `JSON.parse`; `null` clears it. `getSession` and
`listSessions` fill `lastMessage` with the newest message (`ORDER BY created_at DESC, id DESC
LIMIT 1`). `appendMessage` maps a foreign key violation to `foreign_key_violation`
(`'session is missing'`). `createSession` maps a check violation to `check_violation`
(`'session target and work disagree'`). Messages are paged oldest-first on
`(created_at ASC, id ASC)`.

### 14. `packages/store/src/repo-schedules.ts` (new)

```ts
export interface RepoScheduleFilter {
  readonly repoId?: string;
  readonly enabled?: boolean;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface RepoSchedulePatch {
  readonly mode?: RepoScheduleMode;          // 'once' | 'every' | 'window'
  readonly cron?: string | null;
  readonly timezone?: string;
  readonly windowStart?: string | null;
  readonly windowEnd?: string | null;
  readonly cooldownMinutes?: number;
  readonly selection?: Selection;
  readonly refs?: readonly string[];
  readonly maxAttempts?: number;
  readonly maxFires?: number | null;
  readonly maxCostPerFireUsd?: number | null;
  readonly consecutiveFailures?: number;
  readonly firesCount?: number;
  readonly spendUsd?: number;
  readonly enabled?: boolean;
  readonly nextFireAt?: string | null;
  readonly lastFiredAt?: string | null;
  readonly updatedAt: string;
}

export interface RepoScheduleRepository {
  get(id: string): RepoSchedule | null;
  /** At most one per repository; `null` when the repository has none. */
  getByRepo(repoId: string): RepoSchedule | null;
  list(filter: RepoScheduleFilter): PageResult<RepoSchedule>;
  create(schedule: RepoSchedule): RepoSchedule;
  update(id: string, patch: RepoSchedulePatch): RepoSchedule;
  delete(id: string): void;
  listDue(at: string, limit: number): RepoSchedule[];
}

export function createRepoScheduleRepository(db: DatabaseSync): RepoScheduleRepository;
```

The table is the existing `schedules`. `create` writes the D56 columns plus the legacy NOT NULL
columns with the frozen sentinels, declared once in this module:

```ts
// A D56 schedule has no title, prompt, chat or policy. The legacy columns of 0004_schedules
// stay NOT NULL until the legacy /v1/schedules accessors are removed; the sentinels keep them
// readable instead of throwing in the legacy mapper.
const LEGACY_DEFAULTS = { title: '', prompt: '', firePolicy: 'new_chat', policy: 'auto' };
```

`create` maps a unique violation to
`new StoreError('unique_violation', 'schedule already exists for this repository')`; that is
the mechanical answer to "a second schedule on one repository is refused". `update` on a
claim violation maps to `check_violation` (`'schedule violates a mode constraint'`), matching
`schedules.ts`. `list` is newest-first by `(created_at DESC, id DESC)`; `listDue` is
`enabled = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= ? ORDER BY next_fire_at ASC,
created_at ASC, id ASC LIMIT ?`.

### 15. `packages/store/src/providers.ts` (new)

```ts
export interface ProviderRepository {
  get(id: string): Provider | null;
  list(): Provider[];
  create(provider: Provider): Provider;
}

export interface ProviderAccountFilter {
  readonly providerId?: string;
  readonly state?: ProviderAccountState;
}

export interface ProviderAccountPatch {
  readonly label?: string;
  readonly credentialId?: string;
  readonly priority?: number;
  readonly state?: ProviderAccountState;
  readonly resetAt?: string | null;
  readonly budgetUsd?: number | null;
  readonly usedToday?: { readonly day: string; readonly usd: number };
  readonly updatedAt: string;
}

export interface ProviderAccountRepository {
  get(id: string): ProviderAccount | null;
  list(filter: ProviderAccountFilter): ProviderAccount[];
  create(account: ProviderAccount): ProviderAccount;
  update(id: string, patch: ProviderAccountPatch): ProviderAccount;
  /** D54: the lowest `priority` whose state is `active`, else `null`. */
  selectActive(providerId: string): ProviderAccount | null;
  /** `exhausted` accounts whose `reset_at <= at`, for the daemon's reset sweep. */
  listDueResets(at: string): ProviderAccount[];
}

export function createProviderRepository(db: DatabaseSync): ProviderRepository;
export function createProviderAccountRepository(db: DatabaseSync): ProviderAccountRepository;
```

`create` maps `UNIQUE (provider_id, label)` and the credential index to
`new StoreError('unique_violation', 'provider account already exists')`; an unknown provider
to `foreign_key_violation` (`'provider is missing'`); the exhausted-without-reset CHECK to
`check_violation` (`'provider account state is inconsistent'`).

### 16. `packages/store/src/legacy.ts` (new)

```ts
export interface LegacyTable {
  readonly tableName: string;
  readonly retiredBy: string;
  readonly readOnly: true;
}

export interface LegacyRepository {
  list(): LegacyTable[];
}

export function createLegacyRepository(db: DatabaseSync): LegacyRepository;
```

`list()` reads `schema_legacy` ordered by `table_name`, mapping `read_only = 1` to the literal
`true` and refusing any other value with `StoreError('invalid_row', 'invalid column read_only')`.

### 17. `packages/store/src/events.ts` — the timeline gains two scopes

```ts
export interface EventRecord {
  readonly id: number;
  readonly runId: string | null;
  readonly chatId: string | null;
  readonly workId?: string | null;     // optional so existing literals keep compiling
  readonly sessionId?: string | null;
  readonly seq: number | null;
  readonly type: SseEventName;
  readonly data: Record<string, unknown>;
  readonly ts: string;
}

export interface NewEventRecord {
  readonly runId: string | null;
  readonly chatId: string | null;
  readonly workId?: string | null;
  readonly sessionId?: string | null;
  readonly seq: number | null;
  readonly type: SseEventName;
  readonly data: Record<string, unknown>;
  readonly ts: string;
}

export interface EventRepository {
  nextSeq(
    scope: { runId: string } | { chatId: string } | { workId: string } | { sessionId: string },
  ): number;
  append(record: NewEventRecord): EventRecord;
  readAfterId(afterId: number, limit: number): EventRecord[];
  readRunAfterSeq(runId: string, afterSeq: number, limit: number): EventRecord[];
  latestId(): number;
  pruneBefore(ts: string): number;
}
```

`COLUMNS` becomes `'id, run_id, chat_id, work_id, session_id, seq, type, payload, ts'`;
`append` writes `record.workId ?? null` and `record.sessionId ?? null` and returns them on the
record; `nextSeq` adds `nextWorkSeq` and `nextSessionSeq` prepared statements over the same
partial unique indexes. The optional keys are deliberate: `apps/daemon` builds
`NewEventRecord` literals without them and this task may not edit `apps/`.

### 18. `packages/store/src/store.ts` — the handle

```ts
export interface Store {
  readonly db: DatabaseSync;
  readonly schemaVersion: number;
  readonly repos: RepoRepository;
  readonly jobs: JobRepository;
  readonly runs: RunRepository;
  readonly events: EventRepository;
  readonly approvals: ApprovalRepository;
  readonly chats: ChatRepository;
  readonly devices: DeviceRepository;
  readonly settings: SettingsRepository;
  readonly usage: UsageRepository;
  readonly routines: RoutineRepository;
  readonly routineFires: RoutineFireRepository;
  readonly schedules: ScheduleRepository;
  readonly scheduleFires: ScheduleFireRepository;
  readonly works: WorkRepository;
  readonly sessions: SessionRepository;
  readonly repoSchedules: RepoScheduleRepository;
  readonly providers: ProviderRepository;
  readonly providerAccounts: ProviderAccountRepository;
  readonly legacy: LegacyRepository;
  close(): void;
}
```

`openStore` builds each new repository with its `create*Repository(db)` factory. `chats` stays
on the handle (its writers are removed by Task-76).

### 19. `packages/store/src/index.ts` — additive exports

```ts
export { createWorkRepository } from './works.js';
export type { WorkFilter, WorkPatch, WorkRepository } from './works.js';
export { createSessionRepository } from './sessions.js';
export type { SessionFilter, SessionPatch, SessionRepository } from './sessions.js';
export { createRepoScheduleRepository } from './repo-schedules.js';
export type {
  RepoScheduleFilter, RepoSchedulePatch, RepoScheduleRepository,
} from './repo-schedules.js';
export { createProviderRepository, createProviderAccountRepository } from './providers.js';
export type {
  ProviderRepository, ProviderAccountFilter, ProviderAccountPatch, ProviderAccountRepository,
} from './providers.js';
export { createLegacyRepository } from './legacy.js';
export type { LegacyTable, LegacyRepository } from './legacy.js';
```

Every existing export keeps its name and shape.

### Errors, purity and ordering

- Store error codes are the existing ones only: `unique_violation`, `foreign_key_violation`,
  `check_violation`, `not_found`, `invalid_row`. Do not extend `StoreErrorCode`.
- No repository reads the clock, generates an id, reads the environment or touches the
  filesystem. Every timestamp in a patch is a caller argument; the only SQLite clock is the
  existing migration `applied_at`.
- HTTP mapping is not this task: a daemon route turns `unique_violation` from
  `repoSchedules.create` into `409 conflict` with `details.reason = 'schedule_exists'`
  (`docs/api.md` §5.10). No event is emitted by the store.

## 🧩 Configuration

No `CB_*` key is added or read. `docs/providers.md` is not touched. `CB_ACCOUNT_DAILY_USD` and
`CB_MODEL_PROVIDER_KEYS` keep their current meaning (`docs/providers.md` §5.1, §2).

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim, from a clean worktree of `task-70`.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npx vitest run --project packages/contracts` — must pass.
  - `npx vitest run --project packages/store` — must pass.
  - `npm test` — the whole gate (app unit suite plus the workspace coverage guard, then
    `vitest run`); must pass.
  - `npm run build` — `tsc -b` across the workspaces; must pass.
  - `git diff --name-only main...task-70` — the audit below.
- **Acceptance criteria:** all tagged `[unit]`. **There is no `[live]` criterion in this task**:
  it ships schemas, SQL, repositories and docs, and nothing it does is observable only in a
  running system. Do not invent one.

  - [ ] `[unit]` **A work row round-trips with `backlogRef` and `attempts`**
    (`packages/store/src/works.test.ts`, on `openInMemoryStore()`):
    `create` a `Work` fixture (`backlogRef: 'Task-35'`, `attempts: 0`, `maxAttempts: 2`,
    `state: 'queued'`, `origin: 'backlog'`, `specSha: '9f1c2ab'`), then `get(id)` equals the
    fixture; `update(id, { attempts: 1, updatedAt })` returns `attempts === 1`;
    `findByBacklogRef(repoId, 'Task-35')` returns it; `list({ repoId, state: 'queued', limit,
    cursor: null })` returns one page with `nextCursor === null`; inserting a second live work
    with the same `(repoId, 'Task-35')` throws `StoreError` with code `unique_violation`.
    Command: `npx vitest run --project packages/store -t 'work'`.
  - [ ] `[unit]` **A second schedule on one repository is refused**
    (`packages/store/src/repo-schedules.test.ts`): the first `repoSchedules.create` round-trips
    through `getByRepo`; the second on the same `repoId` throws `StoreError` whose `code` is
    `unique_violation` and whose `message` is `schedule already exists for this repository`;
    a second schedule on a *different* repository succeeds; `listDue(at, 10)` returns only
    enabled rows with `nextFireAt <= at`. Command:
    `npx vitest run --project packages/store -t 'schedule'`.
  - [ ] `[unit]` **The migration is forward-only and idempotent**
    (`packages/store/src/migrate.test.ts`): `loadMigrationsFromDisk(MIGRATIONS_DIRECTORY)` maps
    to versions `[1, 2, 3, 4, 5, 6, 7]` with names ending `0006_works.sql`, `0007_providers.sql`;
    the first `runMigrations` reports `applied` `[1..7]` and `currentVersion === 7`;
    `PRAGMA user_version` is `7`; a second `runMigrations` returns `applied: []` and
    `currentVersion === 7`; a tampered checksum on version 2 is still `migration_checksum`;
    `works`, `sessions`, `session_messages`, `schema_legacy`, `providers`,
    `provider_accounts` are in `sqlite_master`; the new indexes (`works_repo_state`,
    `works_repo_backlog`, `works_live_item`, `sessions_repo`, `sessions_target`, `sessions_work`,
    `session_messages_session`, `schedules_one_per_repo`, `runs_work_created`,
    `run_events_work_seq`, `run_events_session_seq`, `provider_accounts_credential`,
    `provider_accounts_selection`, `provider_accounts_reset`) exist;
    `PRAGMA foreign_key_check` is empty; `schema_legacy` holds exactly
    `chat_sessions`/`chat_messages` with `read_only = 1`. Command:
    `npx vitest run --project packages/store -t 'migration'`.
  - [ ] `[unit]` **The contracts guard is green at 62 paths and the retired surface stays out**
    (`packages/contracts/src/openapi.test.ts`): `docs/api.md routes match the OpenAPI paths`
    passes with its pin at `62` and `toEqual(docsPaths())` unchanged; the new test
    `retires the chat and routine paths` passes (no path starts with `/v1/chat/` and none is
    `/v1/routines`); `documents the three chat lifecycle routes` no longer exists;
    `the OpenAPI document lists the three routine events` still passes; `requiredComponents`
    includes `Work`, `WorkDetail`, `Backlog`, `Session`, `SessionMessage`, `WorkPage`,
    `SessionPage`, `SessionMessagePage`, `ProviderAccount`, `ProviderOauthStart`,
    `ProviderAccountTest`. Commands:
    `npx vitest run --project packages/contracts -t 'docs/api.md routes match the OpenAPI paths'`
    and `npx vitest run --project packages/contracts -t 'retires the chat and routine paths'`.
  - [ ] `[unit]` **The new schemas round-trip and refuse the illegal shapes**
    (`packages/contracts/src/works.test.ts`, `packages/contracts/src/providers.test.ts`): one
    accepted fixture per schema, and `safeParse` rejects (a) a `workSchema` whose `attempts` is
    negative, (b) a `sessionSchema` with `target: 'work'` and `workId: null`, (c) a
    `sessionSchema` with `target: 'repo'` and a proposal, (d) a `repoScheduleSchema` with
    `selection: 'refs'` and `refs: []`, (e) a `repoScheduleSchema` with `mode: 'window'` and a
    `cron`, (f) a `providerAccountSchema` with `state: 'exhausted'` and `resetAt: null`.
  - [ ] `[unit]` **One fixture per new event**
    (`packages/contracts/src/events.test.ts`): each of the fourteen new names parses through
    `parseSseEvent`, `SSE_EVENT_NAMES` has 37 entries, and
    `packages/contracts/src/primitives.test.ts` asserts the appended name list in order.
  - [ ] `[unit]` **The schema version is 7 wherever it is asserted**
    (`packages/store/src/store.test.ts`, six pins; `packages/store/src/schedules.test.ts`,
    one pin): every `expect(... .schemaVersion).toBe(...)` reads `7`, and
    `expect(Number(applied?.['total'])).toBe(7)`. These are edits of the pinned numbers only;
    no other assertion in either file changes.
  - [ ] `[unit]` **The event timeline carries the two new scopes**
    (`packages/store/src/events.test.ts`): `nextSeq({ workId })` and `nextSeq({ sessionId })`
    start at 1 and increment per id; `append` with `workId`/`sessionId` round-trips them through
    `readAfterId`, and a `session.delta` row reads back with `type: 'session.delta'`.
  - [ ] `[unit]` `packages/store/src/sessions.test.ts` and `packages/store/src/providers.test.ts`
    cover: a session round-trip with `pendingProposal` set then cleared; `session_messages`
    oldest-first paging; `selectActive` returning the lowest `priority` `active` account and
    skipping `exhausted`/`invalid`/`disabled`; `listDueResets` honouring `reset_at`.
  - [ ] `[unit]` It lints, typechecks and builds clean: `npm run lint`, `npm run build` and
    `npm test` exit 0.
  - [ ] `[unit]` **Nothing outside the exclusive paths was touched.**
    ```sh
    git diff --name-only main...task-70 | sort > /tmp/t70-changed.txt
    printf '%s\n' \
      packages/contracts/src/index.ts packages/contracts/src/primitives.ts \
      packages/contracts/src/works.ts packages/contracts/src/providers.ts \
      packages/contracts/src/resources.ts packages/contracts/src/events.ts \
      packages/contracts/src/pagination.ts packages/contracts/src/openapi.ts \
      packages/contracts/src/works.test.ts packages/contracts/src/providers.test.ts \
      packages/contracts/src/primitives.test.ts packages/contracts/src/events.test.ts \
      packages/contracts/src/openapi.test.ts packages/contracts/src/index.test.ts \
      packages/contracts/README.md \
      packages/store/migrations/0006_works.sql packages/store/migrations/0007_providers.sql \
      packages/store/src/works.ts packages/store/src/sessions.ts \
      packages/store/src/repo-schedules.ts packages/store/src/providers.ts \
      packages/store/src/legacy.ts packages/store/src/mappers.ts packages/store/src/events.ts \
      packages/store/src/store.ts packages/store/src/index.ts \
      packages/store/src/works.test.ts packages/store/src/sessions.test.ts \
      packages/store/src/repo-schedules.test.ts packages/store/src/providers.test.ts \
      packages/store/src/migrate.test.ts packages/store/src/events.test.ts \
      packages/store/src/store.test.ts packages/store/src/schedules.test.ts \
      packages/store/README.md docs/api.md docs/architecture.md \
      | sort > /tmp/t70-allowed.txt
    comm -23 /tmp/t70-changed.txt /tmp/t70-allowed.txt   # must print nothing
    ```
    `packages/store/migrations/0001_init.sql` … `0005_chat_free.sql` must not appear in the
    diff, and `packages/store/src/chats.ts`, `packages/store/src/schedules.ts` and
    `packages/store/src/schedule-fires.ts` must not appear either. In
    `packages/store/src/schedules.test.ts` and `packages/store/src/store.test.ts` the only
    permitted change is the pinned schema version `5` → `7`.

## 📣 Coordination

- **For the Architect / Orchestrator — the only red suite on `main` is this guard.** Measured
  on `main` @ `c5fd969`: `npx vitest run` is green for 157 test files and 1503 tests; the single
  failure is `packages/contracts/src/openapi.test.ts` (2 failed / 8 passed).
  `Object.keys(document.paths)` = **57**, `docsPaths()` = **62**. The set difference is
  symmetric: 18 paths documented in `docs/api.md` and missing from the document
  (`/v1/repos/{id}/backlog`; the nine `/v1/works**` operations; the nine `/v1/sessions**`
  operations; `/v1/providers/{id}/accounts`, `/v1/providers/{id}/oauth/start`,
  `/v1/providers/{id}/oauth/complete`, `/v1/provider-accounts/{id}` and
  `/v1/provider-accounts/{id}/test`), and 13 paths in the document that `docs/api.md` no longer
  documents (8 `/v1/chat/**`, 5 `/v1/routines**`). The frozen decision is that **`docs/api.md`
  owns the documented surface**: Task-70 adds 18 paths / 25 operations, removes the 13 retired
  ones and pins **62** (57 + 18 − 13). Because the guard compares sets, the count is only a
  second assertion; the real target is `toEqual(docsPaths())`. If the dev's first run reports
  different numbers, the dev stops with an `agent-blocked` issue and the literal test output
  rather than editing the pin to match.
- **Deviation from the old test.** `documents the three chat lifecycle routes` was deleted
  because the paths it pinned (`/v1/chat/sessions/{id}/repo`, `/compact`, `/reviewed`,
  `/promote`) are retired by D44/D55 and `docs/api.md` no longer documents them. Its replacement
  pins the retirement instead (`retires the chat and routine paths`). Task-76 removes the
  daemon routes themselves; until it merges, the daemon still serves undocumented
  `/v1/chat/**` and `/v1/routines**` routes. The document describes the *product surface*, the
  same way it will carry `/v1/works/**` and `/v1/sessions/**` before Task-72 implements them.
  This is deliberate, not an omission: do not re-add the chat/routine operations to make the
  old test pass, and do not reintroduce it.
- **For the Architect — migration numbering.** `TODO.md` says `0003_works.sql` /
  `0004_providers.sql`; the real next free numbers are **`0006_works.sql`** and
  **`0007_providers.sql`** because `0003_chat_scope`, `0004_schedules` and `0005_chat_free`
  already exist and are checksum-pinned. `TODO.md` is not editable by this task; the
  Orchestrator corrects the two file names when it ticks Task-70.
- **For Task-71 (backlog package):** import `Page`/`PageResult` as today; read
  `backlogSchema`/`BacklogItem`/`BacklogSection` from `@codebox/contracts` for the projection
  type only. `WORK_STATE_IN_FLIGHT` and `maxAttempts` are the selection inputs it needs for
  `selectNextItem`; do not redefine them.
- **For Task-72 (daemon works, backlog, sessions):** `store.works`, `store.sessions`,
  `store.repoSchedules`, `store.events` (now with `workId`/`sessionId` scopes) and
  `store.legacy` exist. Import the schemas from `@codebox/contracts`:
  `workSchema`/`parseWork`, `workDetailSchema`, `sessionSchema`/`parseSession`,
  `sessionMessageSchema`, `backlogSchema`, `repoScheduleSchema`/`parseRepoSchedule`,
  `pageOfWork`, `pageOfSession`, `pageOfSessionMessage`. The OpenAPI document already carries
  every route and `operationId` §5.6/§5.6.1 lists. `runs.work_id` is the work→run key (nullable,
  `ON DELETE SET NULL`); a work's state is written through `store.works.update`. Creating a
  second live work for one item is refused by the store (`unique_violation`).
  **`docs/api.md` §5.6 and §5.6.1 are yours after this task**; the tables' path lists are
  parsed by the contracts guard, so a path added to them must be added to
  `packages/contracts/src/openapi.ts` in that same task or the guard fails.
- **For Task-73 (provider accounts):** `store.providers` and `store.providerAccounts` exist,
  `selectActive(providerId)` implements D54's "lowest priority with `state = 'active'`", and
  `listDueResets(at)` feeds the reset sweep. `providerAccountSchema.usedToday` is a stored
  rollup (`used_today_day` + `used_today_usd`), not a projection over `usage`: Task-73 owns
  `docs/providers.md` §5.1 and must reconcile that sentence there.
- **For Task-75 (app):** the event names it listens for are exactly the fourteen appended to
  `SSE_EVENT_NAMES`; `sessionSchema.pendingProposal` is `{ branch, sha, paths, createdAt }`.
- **For Task-72 — the `works` scope string.** `docs/api.md` §5.6/§5.6.1 name a `works` scope;
  `SCOPES` in `packages/contracts/src/primitives.ts` still has the five values
  (`read`, `chat`, `runs`, `write`, `admin`) and this task does **not** add a sixth: adding one
  changes the default scope set in `apps/daemon/src/auth/service.ts` and breaks
  `apps/daemon/src/auth/routes.test.ts`'s literal `ALL_SCOPES`, both outside Task-70's paths.
  Until a task owns `packages/contracts` **and** `apps/daemon/src/auth/**` together, a route
  documented as `works` is enforced with the existing `write` scope. Do not invent a
  `works` string in a route until the enum has it.
- **For Task-76 (retire chat):** `store.legacy.list()` must return `chat_sessions` and
  `chat_messages` with `readOnly: true`. **Deviation, deliberate:** the refusal triggers on
  `chat_sessions`/`chat_messages` are *not* in `0006_works.sql`. A migration that refuses
  INSERT/UPDATE/DELETE on those tables today would break `apps/daemon/src/chat/**`,
  `packages/store/src/chats.ts` and their tests, none of which Task-70 may edit — the tree
  would go red. Task-76 owns the removal of the last writer and lands the triggers in its own
  migration (`0008_*.sql` or later), reading the `schema_legacy` rows to decide what to freeze.
  Until then "read-only legacy" means: the marker row, no new writer, and the docs.
- **Deviation from `TODO.md` for `schedules`:** `0006_works.sql` alters `schedules`
  (`selection`, `refs`, `max_attempts`, one-per-repo unique index) instead of rebuilding it.
  A rebuild that made `repo_id NOT NULL` and dropped `title`/`prompt` would break
  `apps/daemon/src/schedules/**` and `packages/store/src/schedules.ts`, which this task may not
  touch. The legacy columns stay; a D56 row writes the sentinels
  `title = ''`, `prompt = ''`, `fire_policy = 'new_chat'`, `policy = 'auto'`,
  `chat_session_id = NULL`. The legacy `scheduleSchema` and `ScheduleRepository` are untouched
  and stay until a later task retires `apps/daemon/src/schedules/**`.

## ⛔ Out of scope

- No daemon route, handler, scheduler loop or event emitter. No `apps/**` change at all.
- No app change, no `apps/app/src/**`, no Playwright.
- No new npm dependency and no change to `package.json`, `package-lock.json` or
  `tsconfig.base.json`.
- No edit to `docs/decisions.md`, `docs/jobs.md`, `docs/providers.md`, `docs/security.md`,
  `docs/app.md`, `AGENTS.md`, `TODO.md` or `CHANGELOG.md`.
- No renumbering, editing or deletion of `0001_init.sql` … `0005_chat_free.sql`.
- No `INSERT`, `UPDATE` or `DELETE` against `chat_sessions`, `chat_messages`, `routines`,
  `routine_fires`, `jobs` or their data; the legacy rows are read, never migrated or deleted.
- No rename or removal of `scheduleSchema`, `Schedule`, `ScheduleRepository`,
  `scheduleFromRow`, `chatSessionSchema` or `ChatRepository`.
- No refactor of a file this task did not have to touch, and no tightening of an existing
  schema that the daemon or the app already sends.

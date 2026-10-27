# Spec: Task-51 — Chat scope, context and review state

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (`packages/contracts` schema, `packages/store` migration and repository)
  plus one documentation section.
- **Role:** Dev.
- **Objective:** After this task the chat session resource carries its **scope** and its
  **context accounting**: `chatSessionSchema` accepts `kind` (`free`/`repo`/`schedule`), `usage`
  (`{ usd, tokensIn, tokensOut }`, the shape `costSchema` already freezes), `contextTokens`,
  `contextEpoch` and `reviewedAt`; the SQLite `chat_sessions` table stores them through one new
  numbered migration that backfills `kind = 'repo'` for every pre-existing row; and the chat
  repository reads those columns into the resource and lets the daemon set `reviewedAt` **once**.
  Every existing consumer keeps compiling: the fields are additive and optional on the wire, and
  nothing outside the exclusive paths changes.
- **Environment:** worktree `../wt-cb-51`, branch `task-51`, base `main`.
- **Dependencies:** none. `packages/contracts/src/resources.ts` (`chatSessionSchema`, `costSchema`),
  `packages/store/migrations/{0001_init,0002_routines}.sql`, `packages/store/src/chats.ts`,
  `packages/store/src/mappers.ts` and `apps/daemon/src/chat/**` are on `main`.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path. Touching anything outside this list is a failure of the task.

- `packages/contracts/src/resources.ts`
- `packages/store/migrations/0003_chat_scope.sql` (new — see the path note below)
- `packages/store/README.md` (one row for the new migration under `## Files`)
- `packages/store/src/chats.ts`
- `docs/api.md` (section: `### 5.6 Chat` only)
- `packages/store/src/migrate.test.ts` (only the version expectations — see the amendment below)
- `packages/store/src/store.test.ts` (only the `schemaVersion` expectations — see the amendment
  below)

**Path note, and the least invasive reading taken.** The backlog writes
`packages/store/src/migrations/`; that directory does not exist. The migration directory of this
tree is `packages/store/migrations/` — `MIGRATIONS_DIRECTORY` in `packages/store/src/migrate.ts`
is `new URL('../migrations/', import.meta.url)` and `0001_init.sql` / `0002_routines.sql` live
there. This task therefore creates **exactly one** file, `packages/store/migrations/0003_chat_scope.sql`,
and edits none of the applied migrations (they are checksum-pinned; an edit is refused by
`runMigrations`).

**Declared amendment to the batch's path cut, and why it is not optional.** A new numbered
migration changes `PRAGMA user_version` from 2 to 3, and two existing test files assert the old
number in eight places:

- `packages/store/src/migrate.test.ts` — `expect(files.map((file) => file.version)).toEqual([1, 2])`,
  the applied-versions and applied-names arrays, `first.currentVersion`, `PRAGMA user_version`,
  `second.currentVersion`;
- `packages/store/src/store.test.ts` — five `expect(store.schemaVersion).toBe(2)`, plus
  `toHaveLength(2)` and `COUNT(*) … toBe(2)` on `schema_migrations`.

Those assertions fail the moment 0003 exists, so **they are part of this task** and the change to
them is mechanical: `2` → `3`, `[1, 2]` → `[1, 2, 3]`, the names array gains
`'0003_chat_scope.sql'`, and `toHaveLength(2)` → `toHaveLength(3)`. No other assertion in either
file changes, no test is added, and no other test file is touched. Those two paths are claimed by
no other task in this batch. If the Orchestrator rejects the amendment, the alternative is a red
`npm test` — say so rather than merging it.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `packages/contracts/src/resources.ts`, `packages/contracts/src/index.ts`,
  `packages/contracts/src/resources.test.ts`, `packages/contracts/src/openapi.ts`,
  `packages/contracts/src/pagination.ts`, `packages/contracts/src/primitives.ts`
- `packages/store/migrations/0001_init.sql`, `packages/store/migrations/0002_routines.sql`
- `packages/store/src/chats.ts`, `packages/store/src/mappers.ts`, `packages/store/src/store.ts`,
  `packages/store/src/migrate.ts`, `packages/store/src/db.ts`,
  `packages/store/src/repositories.test.ts`, `packages/store/src/index.ts`
- `apps/daemon/src/chat/routes.ts`, `apps/daemon/src/chat/service.ts`,
  `apps/daemon/src/chat/routes.test.ts`, `apps/daemon/src/chat/service.test.ts`
- `docs/api.md`, `docs/decisions.md` (D36, D43, D44, D48), `docs/architecture.md` (§ table
  section, read only)
- `TODO.md` (Task-51 and Task-52 items)

## 🔒 Contract

### `packages/contracts/src/resources.ts`

Replace `chatSessionSchema` with exactly this (the six additions are the whole change; the
existing keys keep their order and their schemas):

```ts
export const chatSessionSchema = z.strictObject({
  id: ChatId,
  repoId: RepoId,
  kind: z.enum(['free', 'repo', 'schedule']).optional(),
  title: z.string().min(1),
  status: chatStatusSchema,
  usage: costSchema.optional(),
  contextTokens: z.number().int().nonnegative().optional(),
  contextEpoch: z.number().int().min(1).optional(),
  reviewedAt: timestampSchema.nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastMessage: chatMessageSchema.nullable(),
});
export type ChatSession = z.infer<typeof chatSessionSchema>;
```

- **No new exported name, and `packages/contracts/src/index.ts` is not touched.** Every name this
  task uses is already exported: `chatSessionSchema`, `ChatSession`, `costSchema`. Adding a name
  here would need an `index.ts` edit, and that file is a hot file held by no task in this batch.
- **Defaults, frozen and documented in `docs/api.md`** — applied by every reader, never by the
  schema:
  | Field | Unit | Default when absent |
  | --- | --- | --- |
  | `kind` | `free` \| `repo` \| `schedule` | `repo` |
  | `usage` | `{ usd: number, tokensIn: int ≥ 0, tokensOut: int ≥ 0 }` (the `costSchema` shape) | `{ usd: 0, tokensIn: 0, tokensOut: 0 }` |
  | `contextTokens` | integer ≥ 0 | `0` |
  | `contextEpoch` | integer ≥ 1 | `1` |
  | `reviewedAt` | RFC 3339 timestamp \| `null` | `null` |
- **Why optional, not `.default()`/required:** `ChatSession` is a required-field type. Three
  consumers build the object literally today — `apps/daemon/src/chat/routes.ts` (the create
  handler) and `packages/store/src/mappers.ts` (`chatSessionFromRow`) — and both are **outside**
  this task's paths. Optional fields keep `npm run build` green with no outside edit, which is
  the constraint this task is written to. A later task that owns the daemon makes them required
  once it always sets them.

### `packages/store/migrations/0003_chat_scope.sql` (exact content)

```sql
-- 0003_chat_scope.sql — the chat's scope, usage and context epoch (D43, D48).
-- Forward only: once applied this file is checksum-pinned, so a change needs a new migration.
-- `kind` defaults to 'repo' because every session that predates this migration was bound to a
-- repository (D36); the UPDATE states the backfill instead of relying on the column default.
-- `repo_id` stays NOT NULL here: dropping that constraint needs the twelve-step table rebuild,
-- and a rebuild inside the migration transaction would cascade-delete chat_messages and
-- run_events, whose foreign keys point at chat_sessions with ON DELETE CASCADE.

ALTER TABLE chat_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'repo'
  CHECK (kind IN ('free', 'repo', 'schedule'));
ALTER TABLE chat_sessions ADD COLUMN usage_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN usage_tokens_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN usage_tokens_out INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN context_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN context_epoch INTEGER NOT NULL DEFAULT 1
  CHECK (context_epoch >= 1);
ALTER TABLE chat_sessions ADD COLUMN reviewed_at TEXT;

UPDATE chat_sessions SET kind = 'repo' WHERE kind <> 'repo';

CREATE INDEX chat_sessions_kind ON chat_sessions (kind, updated_at DESC);
```

- One statement per column so a failure names the migration, not a half table. No `PRAGMA`, no
  rebuild, no `DROP`, no edit to `0001`/`0002`.

### `packages/store/src/chats.ts`

```ts
export interface ChatSessionPatch {
  readonly title?: string;
  readonly status?: 'idle' | 'working' | 'archived';
  readonly opencodeSessionId?: string | null;
  readonly worktree?: string | null;
  readonly kind?: 'free' | 'repo' | 'schedule';
  readonly usage?: {
    readonly usd: number;
    readonly tokensIn: number;
    readonly tokensOut: number;
  };
  readonly contextTokens?: number;
  readonly contextEpoch?: number;
  readonly reviewedAt?: string | null;
  readonly updatedAt: string;
}

export function toChatSession(session: ChatSession, lastMessage: ChatMessage | null): ChatSession {
  return { ...session, lastMessage };
}
```

- `SESSION_COLUMNS` gains
  `kind, usage_usd, usage_tokens_in, usage_tokens_out, context_tokens, context_epoch, reviewed_at`.
- `createSession(session, extra)` writes `kind` explicitly as `session.kind ?? 'repo'`, so a
  caller that asks for a free chat is stored as one and a caller that says nothing gets the
  backfilled default. Its signature and `ChatSessionExtra` do not change.
- `findSession` and the `listSessions` row mapping both return the full resource: the row is read
  through `chatSessionFromRow` and the seven new columns are merged in by one local helper
  `sessionScope(rowValue)` that returns
  `{ kind, usage: { usd, tokensIn, tokensOut }, contextTokens, contextEpoch, reviewedAt }`.
  `kind` is validated against `'free' | 'repo' | 'schedule'` and an unknown value throws
  `new StoreError('invalid_row', 'invalid column kind')`, like every other enum column.
- `updateSession` writes `kind`, the three `usage_*` columns, `context_tokens`,
  `context_epoch`, and `reviewed_at` as **`reviewed_at = COALESCE(reviewed_at, ?)`** — a second
  `reviewedAt` patch is a no-op and the first timestamp survives. A patch whose `reviewedAt` is
  `null` writes nothing (the column is write-once, never cleared). `updatedAt` is still written
  on every patch.
- `toChatSession` spreads instead of listing keys, so the list endpoint returns the new fields
  too and the existing store test
  `expect(toChatSession({ ...updated, lastMessage: null }, updated.lastMessage)).toEqual(updated)`
  keeps passing.
- **Nothing else in the package changes.** `packages/store/src/mappers.ts`,
  `packages/store/src/index.ts` and the store tests are outside this task's paths: do not add a
  `ChatSessionExtra` field, do not re-export a new type, do not edit a test.

### `docs/api.md` §5.6 Chat (after the route table, before the `Promote starts…` paragraph)

Add one paragraph and one list, naming every key exactly:

> A session carries its scope and its context accounting (D43, D48):
>
> - `kind` — `free`, `repo` or `schedule`. A payload without it is read as `repo`, which is what
>   every session created before this field existed is.
> - `repoId` — the repository the chat is bound to. Still required in this version; it becomes
>   nullable when the daemon can create a free chat.
> - `usage` — `{ usd, tokensIn, tokensOut }`, the chat's own ledger; `{ 0, 0, 0 }` when it has
>   not spent anything.
> - `contextTokens` — the last measured window size in tokens; `0` before the first turn.
> - `contextEpoch` — which OpenCode session the numbers belong to; `1` until a compact starts a
>   new one (D48).
> - `reviewedAt` — when the operator last reviewed the chat, or `null`. It is written once: the
>   first timestamp wins and a later write is ignored.

### Data

- SQLite columns and their contract fields:
  `kind`→`kind`, `usage_usd`→`usage.usd`, `usage_tokens_in`→`usage.tokensIn`,
  `usage_tokens_out`→`usage.tokensOut`, `context_tokens`→`contextTokens`,
  `context_epoch`→`contextEpoch`, `reviewed_at`→`reviewedAt`.
- Units: `usd` in US dollars (REAL), the rest integers; `contextEpoch` is a 1-based counter.
- `kind` is **not** derived from `repoId`: the column is the truth and the migration states it.

## 🧩 Configuration

No `CB_*` key is added or read. No environment variable, no clock: every timestamp in this task
is a caller argument, as the store's README requires.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm test` — Vitest, headless. The existing contract, store and daemon suites must stay
    green; they are the regression evidence for the additive change.
  - `npm run lint` — must pass.
  - `npm run build` — `tsc -b` for every package **and** the daemon **and** the app. This is the
    criterion that proves no consumer broke.
  - `npx playwright test` — **not** run: this task adds no web flow.
  - `git diff --name-only main...task-51` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `npm test`, `npm run lint` and `npm run build` are green.
  - [ ] `[unit]` **The session parses with and without the new fields** (run after
        `npm run build`, so `@codebox/contracts` resolves to `dist`):

        ```bash
        node --input-type=module -e '
        import { parseChatSession } from "@codebox/contracts";
        const base = { id: "chat_01JABCDEFGHJKMNPQRSV", repoId: "repo_01JABCDEFGHJKMNPQRSV",
          title: "Scratch", status: "idle", createdAt: "2026-10-24T18:03:11Z",
          updatedAt: "2026-10-24T18:03:11Z", lastMessage: null };
        const scoped = { ...base, kind: "schedule", usage: { usd: 0.42, tokensIn: 1200, tokensOut: 340 },
          contextTokens: 41000, contextEpoch: 2, reviewedAt: null };
        const legacy = parseChatSession(base);
        const full = parseChatSession(scoped);
        const bad = (() => { try { parseChatSession({ ...base, kind: "run" }); return "accepted"; }
          catch { return "rejected"; } })();
        console.log(JSON.stringify({ legacyKind: legacy.kind ?? null, kind: full.kind,
          usage: full.usage, contextTokens: full.contextTokens, contextEpoch: full.contextEpoch,
          reviewedAt: full.reviewedAt, unknownKind: bad }));
        '
        ```

        Expect exactly
        `{"legacyKind":null,"kind":"schedule","usage":{"usd":0.42,"tokensIn":1200,"tokensOut":340},"contextTokens":41000,"contextEpoch":2,"reviewedAt":null,"unknownKind":"rejected"}`.
  - [ ] `[unit]` **The migration backfills pre-existing rows**:

        ```bash
        node --input-type=module -e '
        import { openDatabase, loadMigrationsFromDisk, runMigrations, MIGRATIONS_DIRECTORY } from "@codebox/store";
        const db = openDatabase({ path: ":memory:" });
        const clock = () => "2026-10-27T00:00:00.000Z";
        const all = loadMigrationsFromDisk(MIGRATIONS_DIRECTORY);
        runMigrations(db, all.filter((file) => file.version <= 2), clock);
        db.prepare("INSERT INTO repos (id, slug, default_branch, gate, policy, protected_paths, enabled, created_at) VALUES (?,?,?,?,?,?,?,?)")
          .run("repo_01JABCDEFGHJKMNPQRSV", "o/n", "main", "npm test", "auto", "[]", 1, "2026-10-27T00:00:00Z");
        for (const id of ["chat_01JABCDEFGHJKMNPQRSV", "chat_01JABCDEFGHJKMNPQRTW"]) {
          db.prepare("INSERT INTO chat_sessions (id, repo_id, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?)")
            .run(id, "repo_01JABCDEFGHJKMNPQRSV", "Old", "idle", "2026-10-27T00:00:00Z", "2026-10-27T00:00:00Z");
        }
        runMigrations(db, all, clock);
        console.log(JSON.stringify({ rows: db.prepare("SELECT kind, usage_usd, context_tokens, context_epoch, reviewed_at FROM chat_sessions ORDER BY id").all(),
          version: db.prepare("PRAGMA user_version").get() }));
        '
        ```

        Expect two rows, each `{"kind":"repo","usage_usd":0,"context_tokens":0,"context_epoch":1,"reviewed_at":null}`,
        and `version` = `3`.
  - [ ] `[unit]` **`reviewedAt` is null on create and written once**:

        ```bash
        node --input-type=module -e '
        import { openInMemoryStore } from "@codebox/store";
        const store = openInMemoryStore();
        store.repos.create({ id: "repo_01JABCDEFGHJKMNPQRSV", slug: "o/n", defaultBranch: "main",
          gate: "npm test", policy: "auto", protectedPaths: [], enabled: true,
          createdAt: "2026-10-27T00:00:00Z" });
        const created = store.chats.createSession({ id: "chat_01JABCDEFGHJKMNPQRSV",
          repoId: "repo_01JABCDEFGHJKMNPQRSV", title: "Scratch", status: "idle",
          createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z", lastMessage: null },
          { opencodeSessionId: null, worktree: null });
        const first = store.chats.updateSession(created.id, { reviewedAt: "2026-10-27T10:00:00Z", updatedAt: "2026-10-27T10:00:00Z" });
        const second = store.chats.updateSession(created.id, { reviewedAt: "2026-10-27T11:00:00Z", updatedAt: "2026-10-27T11:00:00Z" });
        const usage = store.chats.updateSession(created.id, { usage: { usd: 1.5, tokensIn: 10, tokensOut: 20 }, contextTokens: 31000, contextEpoch: 2, updatedAt: "2026-10-27T12:00:00Z" });
        console.log(JSON.stringify({ created: { kind: created.kind, reviewedAt: created.reviewedAt, usage: created.usage, contextEpoch: created.contextEpoch }, first: first.reviewedAt, second: second.reviewedAt, usage: usage.usage, contextTokens: usage.contextTokens, contextEpoch: usage.contextEpoch, listed: store.chats.listSessions({ limit: 5, cursor: null }).data[0] }));
        store.close();
        '
        ```

        Expect: `created` = `{"kind":"repo","reviewedAt":null,"usage":{"usd":0,"tokensIn":0,"tokensOut":0},"contextEpoch":1}`;
        `first` and `second` both `null`-free and **equal** to `2026-10-27T10:00:00Z`; `usage` =
        `{"usd":1.5,"tokensIn":10,"tokensOut":20}`; `contextTokens` 31000; `contextEpoch` 2; and
        `listed` carrying the same `kind`, `usage`, `contextTokens`, `contextEpoch`, `reviewedAt`
        (the list projection must not drop them).
  - [ ] `[unit]` **The daemon and the app still compile against the schema**: `npm run build`
        exits `0` and `git diff --name-only main...task-51` contains no file under
        `apps/daemon/` or `apps/app/`.
  - [ ] `[unit]` The generated OpenAPI document still validates: `npx vitest run --project packages/contracts`
        is green (`openapi.test.ts` includes `ChatSession`).
  - [ ] `[unit]` `git diff --name-only main...task-51` lists exactly
        `packages/contracts/src/resources.ts`, `packages/store/migrations/0003_chat_scope.sql`,
        `packages/store/README.md`, `packages/store/src/chats.ts`, `docs/api.md`,
        `packages/store/src/migrate.test.ts`, `packages/store/src/store.test.ts`.
  - [ ] `[unit]` The two amended test files changed only version numbers:
        `git diff main...task-51 -- packages/store/src/migrate.test.ts packages/store/src/store.test.ts`
        contains no added or removed `it(`/`describe(` line, and every changed line is one of
        `toEqual([1, 2])` → `toEqual([1, 2, 3])`, `toBe(2)` → `toBe(3)`,
        `toHaveLength(2)` → `toHaveLength(3)`, or the added `'0003_chat_scope.sql'` name.
  - [ ] `[unit]` The migration is forward-only and unique: `ls packages/store/migrations/`
        shows `0001_init.sql`, `0002_routines.sql`, `0003_chat_scope.sql` and nothing else, and
        `git diff main...task-51 -- packages/store/migrations/0001_init.sql packages/store/migrations/0002_routines.sql`
        is empty.
  - [ ] `[live]` **None.** The backlog gives this task no `[live]` criterion, and none is
        invented: the resource is observable only through the daemon routes that Task-52 builds.

## 📣 Coordination

- **Orchestrator decision (already taken), so the dev does not reopen it:** the spec is accepted
  as written. The nullable `repoId` flip and the optional `createSessionSchema.repoId` are
  **deferred to Task-52**, which owns `apps/daemon/src/chat/**` and the table rebuild; the backlog
  note in `TODO.md` is amended at merge time. Land the scope columns and the accounting only.
- **For the Orchestrator (read this before the merge):** the backlog says
  `chatSessionSchema` gains "a nullable `repoId`" and "`createSessionSchema.repoId` becomes
  optional". **Neither lands in this task**, for a reason found in the tree, not a preference:
  1. `ChatSession.repoId` is typed `string`. Making it `string | null` breaks
     `apps/daemon/src/chat/service.ts` at two call sites — `routineMcp(chatId, session.repoId)`
     (line ~630) and `store.repos.get(session.repoId)` (line ~649) — and the correct fix there is
     not a cast: a free chat has no worktree, so `prepare()` needs the behaviour that Task-52
     builds. `apps/daemon/src/chat/**` is outside this task's exclusive paths.
  2. `createSessionSchema` is not in `packages/contracts` at all: it is a local `z.strictObject`
     in `apps/daemon/src/chat/routes.ts` (line 32). Same path, same reason.
  3. Making `chat_sessions.repo_id` nullable in SQL needs the twelve-step table rebuild, and the
     runner applies each migration inside a transaction with `foreign_keys` ON, so the `DROP
     TABLE` would cascade-delete `chat_messages` and `run_events`.

  **Least invasive reading taken:** this task lands the scope and the accounting (which is what
  makes a repo-less chat expressible) and leaves `repoId` required and `repo_id` NOT NULL.
  Task-52 owns `apps/daemon/src/chat/` and is the right holder for the nullable flip, the
  optional request body and the free-chat `prepare()`. If the Orchestrator would rather do the
  flip here, the batch must give this task `apps/daemon/src/chat/{routes,service}.ts` as well —
  and that is a plan change, not a dev decision.
- **For the Architect (coverage debt, needs a decision):** the batch's cut allows two *amended*
  test files (the version numbers above) but no *new* test file. The durable tests still owed
  are: two cases in `packages/contracts/src/resources.test.ts` (a legacy payload parses, an
  unknown `kind` is rejected), a `packages/store/src/chats.test.ts` (migration backfill, the
  write-once `reviewedAt`, the list projection), and a `docs/architecture.md` table row for the
  seven columns. The QA plan below is executable and is this cycle's evidence; assign the tests
  to the next task that owns those paths.
- **For Task-52:** the fields are optional on the wire today. When the daemon always sets them,
  flip `kind`, `usage`, `contextTokens`, `contextEpoch` and `reviewedAt` to required in
  `chatSessionSchema`, make `repoId` nullable, and replace the local `createSessionSchema` with
  the contract's shape — all three in one task, because they break the same two files.
- **For the app tasks (56, 57, 59):** read `kind` as `session.kind ?? 'repo'` until Task-52
  makes it required. Do not invent a local type for the session.
- **For QA:** the daemon's `chat/routes.test.ts` and `service.test.ts` are the regression net for
  "the routes keep compiling and keep answering the same shapes"; a change there is a red flag,
  not a fix.

## ⛔ Out of scope

- No new dependency, no new exported name in `packages/contracts`, no edit to
  `packages/contracts/src/index.ts`, `openapi.ts`, `pagination.ts`, `primitives.ts` or
  `packages/contracts/src/resources.test.ts`.
- No change to `packages/store/src/mappers.ts`, `store.ts`, `migrate.ts`, `index.ts` or any other
  repository, and no new test file: the only test edits are the eight version expectations named
  in the amendment. `packages/store/README.md` changes by exactly one row, for the new migration.
- No change to `apps/daemon/**` or `apps/app/**`, even a "one-line" guard: if the build needs
  one, that is the Coordination note above and a plan change.
- No new route, no `POST .../reviewed`, no `compact`, no repo binding (all Task-52).
- No `docs/architecture.md`, `docs/decisions.md`, `TODO.md`, `CHANGELOG.md` or `README.md` edit.

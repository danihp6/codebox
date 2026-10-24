# Spec: Task-04 — Store

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (`packages/store`).
- **Role:** Dev.
- **Objective:** `@codebox/store` becomes the only place that knows SQL: one numbered,
  forward-only migration set for the ten tables of `docs/architecture.md` §2 (the routines
  tables stay out — they are migration `0002`, Task-34), a checksum-pinned migration runner on
  `node:sqlite`, and typed repositories for repos, jobs, runs, events, approvals, chats,
  devices, settings and usage, including the transactional claim the scheduler will use. After
  this task a daemon can persist a run, its events and its approvals without writing a single
  line of SQL of its own.
- **Environment:** worktree `../wt-cb-04`, branch `task-04`, base `main` (`611a788`, which
  already contains the merged Task-03).
- **Dependencies:** Task-03 — merged; it produced `packages/contracts/src/resources.ts`
  (`Repo`, `Job`, `Run`, `Approval`, `ChatSession`, `ChatMessage`, `Device`) and
  `packages/contracts/src/primitives.ts` (`RunState`, `SseEventName`). Task-01 — merged; it
  produced the workspace skeleton, `packages/store/tsconfig.json` and the Vitest project
  `packages/store`.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path. Removing a stray `.gitkeep` from a directory this task populates is
allowed.

- `packages/store/README.md`
- `packages/store/src/index.ts`
- `packages/store/src/store.ts`
- `packages/store/src/db.ts`
- `packages/store/src/errors.ts`
- `packages/store/src/migrate.ts`
- `packages/store/src/mappers.ts`
- `packages/store/src/cursor.ts`
- `packages/store/src/repos.ts`
- `packages/store/src/jobs.ts`
- `packages/store/src/runs.ts`
- `packages/store/src/events.ts`
- `packages/store/src/approvals.ts`
- `packages/store/src/chats.ts`
- `packages/store/src/devices.ts`
- `packages/store/src/settings.ts`
- `packages/store/src/usage.ts`
- `packages/store/src/migrate.test.ts`
- `packages/store/src/store.test.ts`
- `packages/store/src/runs.test.ts`
- `packages/store/src/events.test.ts`
- `packages/store/src/repositories.test.ts`
- `packages/store/migrations/0001_init.sql`
- `docs/architecture.md` — **section: `## 2. Components` → the `### packages/store`
  subsection only** (the paragraph and the table that list the tables; no other heading, no
  other table in that file).

`packages/store/package.json` and `packages/store/tsconfig.json` are **not** in the list: they
already work (`tsc -p tsconfig.json`, `rootDir: src`, `include: src/**/*.ts`). Do not add a
dependency, a script or a path mapping.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/architecture.md` (§2 `packages/store`, §5 package boundaries)
- `docs/decisions.md` (D8, D13, D14, D26, D28, D38)
- `docs/api.md` (§4 pagination, §5.4 runs, §6 SSE ids)
- `docs/jobs.md` (§2 claiming, §3 lifecycle)
- `docs/providers.md` (§3 paths, §8 runs and scheduler, §9 retention)
- `packages/contracts/src/index.ts`, `packages/contracts/src/resources.ts`,
  `packages/contracts/src/primitives.ts`, `packages/contracts/src/pagination.ts`
- `packages/contracts/README.md`
- `packages/store/package.json`, `packages/store/tsconfig.json`, `packages/store/README.md`
- `vitest.config.ts`, `tsconfig.base.json`, `eslint.config.js`

## 🔒 Contract

The public surface other tasks are written against **right now**. It is a promise, not a
suggestion. Exact exported names, signatures and types.

Everything exported from the package goes through `packages/store/src/index.ts`, which
re-exports every name exactly once, grouped by module, with `export type { … }` for types.

### Imports and purity

- `@codebox/contracts` is imported **type-only**, always as
  `import type { Run } from '@codebox/contracts';`. Never a value import: `npm test` runs
  before `npm run build` in CI and `packages/contracts/dist` does not exist at that point; a
  type-only import is erased by esbuild, a value import is not.
- Allowed built-ins: `node:sqlite`, `node:fs`, `node:crypto`, `node:path`.
- Forbidden in `packages/store/src/**` outside `*.test.ts`: `node:http`, `node:child_process`,
  `fetch(`, `process.env`, `Date.now()`, `new Date()` without an argument. The store never
  generates an id and never reads the clock: every timestamp and every id is a caller
  argument. This is what makes the tests deterministic.
- No dependency is added to `packages/store/package.json`.

### `db.ts`

```ts
import type { DatabaseSync } from 'node:sqlite';

export interface OpenDatabaseOptions {
  readonly path: string;
  readonly busyTimeoutMs?: number;
}

export function openDatabase(options: OpenDatabaseOptions): DatabaseSync;
export function withTransaction<T>(db: DatabaseSync, run: () => T): T;
export function isUniqueViolation(error: unknown): boolean;
export function isForeignKeyViolation(error: unknown): boolean;
```

- `openDatabase` opens with `{ enableForeignKeyConstraints: true }`, then executes
  `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`,
  `PRAGMA busy_timeout = <busyTimeoutMs ?? 5000>` and `PRAGMA foreign_keys = ON`.
- `withTransaction` runs `BEGIN IMMEDIATE`, then `run()`, then `COMMIT`; any throw triggers
  `ROLLBACK` and rethrows the original error unchanged. Nested calls are not supported and
  throw `StoreError('nested_transaction')`.
- `isUniqueViolation` / `isForeignKeyViolation` match the SQLite message
  (`UNIQUE constraint failed`, `FOREIGN KEY constraint failed`) and never throw.

### `errors.ts`

```ts
export type StoreErrorCode =
  | 'not_found'
  | 'unique_violation'
  | 'foreign_key_violation'
  | 'repo_has_live_run'
  | 'nested_transaction'
  | 'invalid_row'
  | 'migration_invalid'
  | 'migration_checksum'
  | 'migration_failed';

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string);
}
```

The store throws no HTTP status: the daemon maps `repo_has_live_run` to `409 conflict` with
`details.reason = "repo_has_live_run"` (`docs/api.md` §3) and everything else to `500
internal`. No message ever contains a token, a SQL statement with parameters, or a file's
contents.

### `migrate.ts`

```ts
export interface MigrationFile {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string; // sha256 hex of the file bytes
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

export interface MigrationReport {
  readonly applied: readonly AppliedMigration[];
  readonly currentVersion: number;
}

export function loadMigrationsFromDisk(directory: string): readonly MigrationFile[];
export function runMigrations(
  db: DatabaseSync,
  files: readonly MigrationFile[],
  now: () => string,
): MigrationReport;
export const MIGRATIONS_DIRECTORY: string; // absolute path of packages/store/migrations
```

- File name rule: `^(\d{4})_[a-z0-9_]+\.sql$`. The version is the four-digit prefix as an
  integer. A name that does not match, a duplicate version, or a version sequence that is not
  contiguous from 1 throws `StoreError('migration_invalid')` before any SQL runs.
- Bookkeeping table, created by the runner itself when absent:

  ```sql
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
  ```

- One transaction per file (`BEGIN IMMEDIATE` … `COMMIT`). A migration that throws rolls back,
  throws `StoreError('migration_failed')` with the version in the message, and leaves
  `schema_migrations` untouched.
- An already-applied version whose stored checksum differs from the file is refused with
  `StoreError('migration_checksum')`: an applied migration is never edited.
- After applying, `PRAGMA user_version = <highest version>`.
- Re-running on a migrated database is a no-op: `applied` is `[]` and `currentVersion` is the
  highest applied version.
- `MIGRATIONS_DIRECTORY` is `new URL('../migrations/', import.meta.url)` converted with
  `fileURLToPath`, so it resolves correctly from both `src/` (Vitest) and `dist/` (build).
  `loadMigrationsFromDisk` reads the directory with `node:fs`, sorts by version and is the only
  place in the package that touches a `.sql` file.

### `store.ts`

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
  close(): void;
}

export interface OpenStoreOptions {
  readonly path: string;
  readonly applyMigrations?: boolean; // default true
  readonly busyTimeoutMs?: number;    // default 5000
}

export function openStore(options: OpenStoreOptions): Store;
export function openInMemoryStore(): Store;
```

`openInMemoryStore()` is the in-memory fake the task asks for: `openStore({ path: ':memory:' })`
with migrations applied. Tests use it for everything except WAL and file-format assertions.
`close()` is idempotent.

### `cursor.ts`

```ts
export interface PageQuery {
  readonly limit: number;        // 1..200, the caller clamps
  readonly cursor: string | null;
}

export interface PageResult<T> {
  readonly data: T[];
  readonly nextCursor: string | null;
}

export function encodeCursor(createdAt: string, id: string): string;
export function decodeCursor(cursor: string): { createdAt: string; id: string };
```

The cursor is opaque to clients: base64url of `${createdAt}\u0000${id}`, ordered by
`(createdAt DESC, id DESC)`; a malformed cursor throws `StoreError('invalid_row')` with the
message `invalid cursor`. (The contract types `cursor` as a free-form non-empty string, so no
`c_` prefix is required.)

### Repositories

Every method is synchronous (one writer, `node:sqlite` is synchronous). Every returned resource
is a **contract shape** built by `mappers.ts`; every input is a contract shape plus the extra
fields named below. `null` means "not found"; nothing is thrown for a missing row.

```ts
// repos.ts
export interface RepoPatch {
  readonly slug?: string;
  readonly defaultBranch?: string;
  readonly gate?: string;
  readonly policy?: 'auto' | 'manual';
  readonly protectedPaths?: readonly string[];
  readonly enabled?: boolean;
}

export interface RepoRepository {
  get(id: string): Repo | null;
  getBySlug(slug: string): Repo | null;
  list(): Repo[];
  create(repo: Repo): Repo;
  update(id: string, patch: RepoPatch): Repo;
  delete(id: string): void;
}
```

`delete` throws `StoreError('repo_has_live_run')` when a run of that repo is in a non-terminal
state (`queued`, `preparing`, `running`, `gating`, `pr_open`, `merging`), `not_found` when the
row is absent, and `foreign_key_violation` when finished runs still reference it (the FK is
`ON DELETE RESTRICT`, so history is never orphaned). `update` with an unknown id throws
`not_found`.

```ts
// jobs.ts
export interface JobFilter {
  readonly repoId?: string;
  readonly enabled?: boolean;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface JobPatch {
  readonly title?: string;
  readonly prompt?: string;
  readonly agent?: string;
  readonly model?: string | null;
  readonly cron?: string;
  readonly timezone?: string;
  readonly enabled?: boolean;
  readonly policy?: 'auto' | 'manual';
  readonly maxCostUsd?: number | null;
  readonly nextFireAt?: string | null;
}

export interface JobRepository {
  get(id: string): Job | null;
  list(filter: JobFilter): PageResult<Job>;
  create(job: Job): Job;
  update(id: string, patch: JobPatch): Job;
  delete(id: string): void;
  setNextFire(id: string, nextFireAt: string | null): void;
  listDue(at: string, limit: number): Job[];
}
```

`list` is ordered `created_at DESC, id DESC` and filters with `enabled = 1/0` when given.
`delete` keeps the runs (`runs.job_id` is `ON DELETE SET NULL`). `listDue` returns the enabled
jobs whose `next_fire_at <= at`, ordered by `next_fire_at`, then `created_at`, then `id`.
`maxCostUsd` is not a contract field (the contract `Job` has none): it is stored, accepted by
`JobPatch`, and never returned.

```ts
// runs.ts
export interface RunRecord extends Run {
  readonly baseSha: string | null;
  readonly worktree: string | null;
  readonly sessionId: string | null;
  readonly prompt: string;
  readonly promptHash: string | null;
  readonly agent: string;
  readonly model: string | null;
  readonly gateCommand: string | null;
  readonly scheduledFor: string | null;
  readonly attempt: number;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly startedAt: string | null;
}

export interface RunFilter {
  readonly repoId?: string;
  readonly jobId?: string;
  readonly state?: RunState;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface RunPatch {
  readonly state?: RunState;
  readonly pr?: Run['pr'];
  readonly gate?: Run['gate'];
  readonly guardrails?: Run['guardrails'];
  readonly blockers?: Run['blockers'];
  readonly diff?: Run['diff'];
  readonly cost?: Run['cost'];
  readonly baseSha?: string | null;
  readonly worktree?: string | null;
  readonly sessionId?: string | null;
  readonly gateCommand?: string | null;
  readonly promptHash?: string | null;
  readonly attempt?: number;
  readonly failureCode?: string | null;
  readonly failureMessage?: string | null;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
}

export interface ClaimScheduledRunInput {
  readonly jobId: string;
  readonly scheduledFor: string;
  readonly runId: string;
  readonly now: string;
  readonly branch: string;
  readonly baseRef: string;
  readonly agent: string;
  readonly model: string | null;
  readonly prompt: string;
}

export interface RunRepository {
  get(id: string): Run | null;
  getRecord(id: string): RunRecord | null;
  list(filter: RunFilter): PageResult<Run>;
  create(record: RunRecord): RunRecord;
  update(id: string, patch: RunPatch): RunRecord;
  claimScheduledRun(input: ClaimScheduledRunInput): RunRecord | null;
  countLive(repoId?: string): number;
  listByJob(jobId: string, limit: number): Run[];
}

export function toRun(record: RunRecord): Run;
```

- `toRun` drops the extra fields and returns exactly the contract `Run` (so `parseRun` accepts
  it: `runSchema` is strict).
- `claimScheduledRun` is **the** claim. In one `BEGIN IMMEDIATE` transaction it (1) reads the
  job; a missing or `enabled = 0` job returns `null`; (2) inserts a `queued` run with
  `trigger = 'schedule'`, `scheduled_for = input.scheduledFor`, `attempt = 1`,
  `guardrails = []`, `blockers = []`, `cost = { usd: 0, tokensIn: 0, tokensOut: 0 }`,
  `finishedAt = null`, `createdAt = input.now`; (3) on `UNIQUE (job_id, scheduled_for)` returns
  `null` instead of throwing. Two claims of the same `(jobId, scheduledFor)` therefore produce
  exactly one run.
- `countLive` counts runs in a non-terminal state, per repo when `repoId` is given.
- `list` is ordered `created_at DESC, id DESC`; `listByJob` is the same order, capped.

```ts
// events.ts
export interface EventRecord {
  readonly id: number;            // global SSE id, monotonically increasing
  readonly runId: string | null;
  readonly chatId: string | null;
  readonly seq: number | null;    // per-run or per-chat sequence; null for global events
  readonly type: SseEventName;
  readonly data: Record<string, unknown>;
  readonly ts: string;
}

export interface NewEventRecord {
  readonly runId: string | null;
  readonly chatId: string | null;
  readonly seq: number | null;
  readonly type: SseEventName;
  readonly data: Record<string, unknown>;
  readonly ts: string;
}

export interface EventRepository {
  nextSeq(scope: { runId: string } | { chatId: string }): number;
  append(record: NewEventRecord): EventRecord;
  readAfterId(afterId: number, limit: number): EventRecord[];
  readRunAfterSeq(runId: string, afterSeq: number, limit: number): EventRecord[];
  latestId(): number;
  pruneBefore(ts: string): number;
}
```

- `nextSeq` returns `COALESCE(MAX(seq), 0) + 1` for the given stream. The caller calls it and
  passes the same number to `append` **and** into `data.seq`; `append` does not rewrite `data`
  (the SSE contract in `docs/api.md` §6 carries `seq` inside `data`). Call both inside
  `withTransaction` — that is what makes a transition and its event atomic.
- `append` returns the stored row. A duplicate `(runId, seq)` or `(chatId, seq)` throws
  `unique_violation`; that is the second line of defence against a double-published event.
- `readAfterId` is the `Last-Event-ID` replay: `WHERE id > ? ORDER BY id ASC LIMIT ?`.
- `readRunAfterSeq` is the per-run replay: `WHERE run_id = ? AND seq > ? ORDER BY seq ASC`.
- `pruneBefore` deletes events older than `ts` and returns the number of rows removed.

```ts
// approvals.ts
export interface ApprovalRepository {
  get(id: string): Approval | null;
  listPending(limit: number): Approval[];
  list(state: Approval['state'], query: PageQuery): PageResult<Approval>;
  create(approval: Approval): Approval;
  resolve(input: {
    id: string;
    state: 'allowed' | 'denied' | 'expired';
    resolvedAt: string;
  }): Approval;
}
```

`resolve` throws `StoreError('not_found')` when the row is absent, and returns the current row
unchanged when `state` is no longer `pending` (the daemon turns that into
`409 approval_already_answered`). `listPending` is ordered `created_at ASC, id ASC`.

```ts
// chats.ts
export type ChatMessageOrigin = 'user' | 'assistant' | 'routine';

export interface ChatSessionExtra {
  readonly opencodeSessionId: string | null;
  readonly worktree: string | null;
}

export interface ChatSessionPatch {
  readonly title?: string;
  readonly status?: 'idle' | 'working' | 'archived';
  readonly opencodeSessionId?: string | null;
  readonly worktree?: string | null;
  readonly updatedAt: string;
}

export interface ChatRepository {
  getSession(id: string): ChatSession | null;
  listSessions(filter: {
    repoId?: string;
    limit: number;
    cursor: string | null;
  }): PageResult<ChatSession>;
  createSession(session: ChatSession, extra: ChatSessionExtra): ChatSession;
  updateSession(id: string, patch: ChatSessionPatch): ChatSession;
  appendMessage(message: ChatMessage, extra: { origin: ChatMessageOrigin }): ChatMessage;
  listMessages(chatId: string, query: PageQuery): PageResult<ChatMessage>;
  lastMessage(chatId: string): ChatMessage | null;
}

export function toChatSession(
  session: ChatSession,
  lastMessage: ChatMessage | null,
): ChatSession;
```

- `ChatSession.lastMessage` is the newest message, `null` when there is none.
- `listSessions` is ordered `updated_at DESC, id DESC`; `listMessages` is **oldest first**
  (`created_at ASC, id ASC`) as `docs/api.md` §5.6 requires, and its `nextCursor` walks
  forward.
- `appendMessage` stores `origin` (`'routine'` marks the D38 message) but never returns it:
  the contract `ChatMessage` has no `origin`.

```ts
// devices.ts
export interface DeviceRecord extends Device {
  readonly publicKey: string | null;
  readonly fingerprint: string | null;
  readonly refreshTokenHash: string;
  readonly refreshPreviousHash: string | null;
  readonly refreshExpiresAt: string;
  readonly revokedAt: string | null;
}

export interface DeviceRepository {
  get(id: string): Device | null;
  getRecord(id: string): DeviceRecord | null;
  getByRefreshHash(hash: string): DeviceRecord | null;
  list(query: PageQuery): PageResult<Device>;
  create(record: DeviceRecord): DeviceRecord;
  rotateRefresh(
    id: string,
    input: {
      readonly refreshTokenHash: string;
      readonly refreshPreviousHash: string;
      readonly refreshExpiresAt: string;
    },
  ): DeviceRecord;
  revoke(id: string, at: string): void;
  touch(id: string, at: string): void;
}
```

`getByRefreshHash` matches the current **or the previous** hash, so the daemon can detect the
reuse signal of `docs/security.md` §4; `revoke` is idempotent and never deletes the row.

```ts
// settings.ts
export interface SettingsRepository {
  getAll(): Record<string, unknown>;
  get(key: string): unknown;
  set(key: string, value: unknown, at: string): void;
  delete(key: string): void;
}
```

Values are stored as JSON text; `get` returns `undefined` for a missing key.

```ts
// usage.ts
export interface UsageRecord {
  readonly id: number;
  readonly runId: string | null;
  readonly repoId: string | null;
  readonly day: string;      // YYYY-MM-DD, UTC
  readonly model: string | null;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
  readonly createdAt: string;
}

export interface UsageAggregate {
  readonly day: string;
  readonly repoId: string | null;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
  readonly runs: number;
}

export interface UsageRepository {
  record(input: Omit<UsageRecord, 'id'>): UsageRecord;
  spendOnDay(day: string): number;
  listByDay(day: string): UsageRecord[];
  aggregate(fromDay: string, toDay: string): readonly UsageAggregate[];
}
```

`aggregate` groups by `(day, repo_id)` over an inclusive day range, ordered by `day ASC,
repo_id ASC`; `runs` is `COUNT(DISTINCT run_id)`.

### Data

`packages/store/migrations/0001_init.sql` creates exactly these tables, in this order (the
routines tables of `docs/architecture.md` §2 belong to migration `0002`, Task-34; do not create
them). All ids are `TEXT` supplied by the caller; all timestamps are RFC 3339 UTC `TEXT`; all
booleans are `INTEGER` constrained to `(0,1)`; all object/array columns are JSON `TEXT`.

| Table | Columns (name: type, constraints) |
| --- | --- |
| `repos` | `id` TEXT PK · `slug` TEXT NOT NULL UNIQUE · `default_branch` TEXT NOT NULL · `gate` TEXT NOT NULL · `policy` TEXT NOT NULL CHECK IN ('auto','manual') · `protected_paths` TEXT NOT NULL (JSON array) · `enabled` INTEGER NOT NULL CHECK IN (0,1) · `created_at` TEXT NOT NULL |
| `jobs` | `id` TEXT PK · `repo_id` TEXT NOT NULL REFERENCES repos(id) ON DELETE RESTRICT · `title` TEXT NOT NULL · `prompt` TEXT NOT NULL · `mode` TEXT NOT NULL CHECK IN ('work') · `agent` TEXT NOT NULL · `model` TEXT · `cron` TEXT NOT NULL · `timezone` TEXT NOT NULL · `enabled` INTEGER NOT NULL CHECK IN (0,1) · `policy` TEXT NOT NULL CHECK IN ('auto','manual') · `max_cost_usd` REAL · `next_fire_at` TEXT · `created_at` TEXT NOT NULL · `updated_at` TEXT NOT NULL |
| `chat_sessions` | `id` TEXT PK · `repo_id` TEXT NOT NULL REFERENCES repos(id) ON DELETE RESTRICT · `title` TEXT NOT NULL · `status` TEXT NOT NULL CHECK IN ('idle','working','archived') · `opencode_session_id` TEXT · `worktree` TEXT · `created_at` TEXT NOT NULL · `updated_at` TEXT NOT NULL |
| `chat_messages` | `id` TEXT PK · `chat_id` TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE · `role` TEXT NOT NULL CHECK IN ('user','assistant','system') · `text` TEXT NOT NULL · `origin` TEXT NOT NULL CHECK IN ('user','assistant','routine') · `created_at` TEXT NOT NULL |
| `runs` | `id` TEXT PK · `repo_id` TEXT NOT NULL REFERENCES repos(id) ON DELETE RESTRICT · `job_id` TEXT REFERENCES jobs(id) ON DELETE SET NULL · `state` TEXT NOT NULL CHECK IN ('queued','preparing','running','gating','pr_open','merging','succeeded','failed','cancelled') · `trigger` TEXT NOT NULL CHECK IN ('schedule','manual','promote','revert','retry') · `branch` TEXT NOT NULL · `base_ref` TEXT NOT NULL · `base_sha` TEXT · `worktree` TEXT · `session_id` TEXT · `prompt` TEXT NOT NULL · `prompt_hash` TEXT · `agent` TEXT NOT NULL · `model` TEXT · `gate_command` TEXT · `scheduled_for` TEXT · `attempt` INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1) · `pr_number` INTEGER · `pr_url` TEXT · `pr_mergeable` INTEGER · `gate_status` TEXT · `gate_exit_code` INTEGER · `gate_duration_ms` INTEGER · `guardrails` TEXT NOT NULL DEFAULT '[]' · `blockers` TEXT NOT NULL DEFAULT '[]' · `diff_files` INTEGER · `diff_added` INTEGER · `diff_removed` INTEGER · `cost_usd` REAL NOT NULL DEFAULT 0 · `tokens_in` INTEGER NOT NULL DEFAULT 0 · `tokens_out` INTEGER NOT NULL DEFAULT 0 · `failure_code` TEXT · `failure_message` TEXT · `created_at` TEXT NOT NULL · `started_at` TEXT · `finished_at` TEXT · `UNIQUE (job_id, scheduled_for)` |
| `run_events` | `id` INTEGER PK AUTOINCREMENT · `run_id` TEXT REFERENCES runs(id) ON DELETE CASCADE · `chat_id` TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE · `seq` INTEGER · `type` TEXT NOT NULL · `payload` TEXT NOT NULL (JSON object) · `ts` TEXT NOT NULL |
| `approvals` | `id` TEXT PK · `state` TEXT NOT NULL CHECK IN ('pending','allowed','denied','expired') · `tool` TEXT NOT NULL · `title` TEXT NOT NULL · `run_id` TEXT REFERENCES runs(id) ON DELETE CASCADE · `chat_id` TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE · `input` TEXT NOT NULL (JSON object) · `created_at` TEXT NOT NULL · `expires_at` TEXT NOT NULL · `resolved_at` TEXT · `CHECK (run_id IS NOT NULL OR chat_id IS NOT NULL)` |
| `devices` | `id` TEXT PK · `name` TEXT NOT NULL · `platform` TEXT NOT NULL CHECK IN ('ios','android','web','cli') · `public_key` TEXT · `fingerprint` TEXT · `scopes` TEXT NOT NULL (JSON array) · `refresh_token_hash` TEXT NOT NULL UNIQUE · `refresh_previous_hash` TEXT · `refresh_expires_at` TEXT NOT NULL · `created_at` TEXT NOT NULL · `last_seen_at` TEXT · `revoked_at` TEXT |
| `settings` | `key` TEXT PK · `value` TEXT NOT NULL (JSON) · `updated_at` TEXT NOT NULL |
| `usage` | `id` INTEGER PK AUTOINCREMENT · `run_id` TEXT REFERENCES runs(id) ON DELETE SET NULL · `repo_id` TEXT · `day` TEXT NOT NULL · `model` TEXT · `tokens_in` INTEGER NOT NULL · `tokens_out` INTEGER NOT NULL · `cost_usd` REAL NOT NULL · `created_at` TEXT NOT NULL |

Indexes that must exist, with the same names:

```sql
CREATE INDEX jobs_due              ON jobs (enabled, next_fire_at);
CREATE INDEX runs_repo_created     ON runs (repo_id, created_at DESC);
CREATE INDEX runs_state            ON runs (state);
CREATE INDEX runs_job_created      ON runs (job_id, created_at DESC);
CREATE UNIQUE INDEX run_events_run_seq  ON run_events (run_id, seq)  WHERE run_id IS NOT NULL;
CREATE UNIQUE INDEX run_events_chat_seq ON run_events (chat_id, seq) WHERE chat_id IS NOT NULL;
CREATE INDEX run_events_ts         ON run_events (ts);
CREATE INDEX approvals_state       ON approvals (state, created_at);
CREATE INDEX chat_messages_chat    ON chat_messages (chat_id, created_at);
CREATE INDEX chat_sessions_repo    ON chat_sessions (repo_id, updated_at DESC);
CREATE INDEX devices_revoked       ON devices (revoked_at);
CREATE INDEX usage_day_repo        ON usage (day, repo_id);
CREATE INDEX usage_run             ON usage (run_id);
```

Mapping rules (`mappers.ts`, internal but invariant):

- `enabled`, `pr_mergeable` → `boolean` with `=== 1`; writing a boolean writes `0`/`1`.
- `protected_paths`, `scopes`, `guardrails`, `blockers`, `input`, `payload`, `value` are
  `JSON.stringify`ed on write and `JSON.parse`d on read; a parse failure throws
  `StoreError('invalid_row')` naming the column, never the value.
- `runs.pr` is `null` unless `pr_number` and `pr_url` are both set; `runs.gate` is `null` unless
  `gate_status` is set; `runs.diff` is `null` unless all three diff columns are set;
  `runs.cost` is always present.
- `Run.finishedAt`, `Run.createdAt`, `Run.state` come straight from the row.

## 🧩 Configuration

No new `CB_*` key. `packages/store` reads no environment variable at all; the daemon passes
the database path (`CB_STATE_DIR/state.db`, `docs/providers.md` §3). The defaults this task
must honour come from `packages/contracts/src/config.ts` `CONFIG_DEFAULTS` as **numbers the
caller passes**, never as literals read here: `CB_MAX_CONCURRENCY` 2,
`CB_MAX_CONCURRENCY_PER_REPO` 1, `CB_MISFIRE_GRACE_SECONDS` 900, `CB_RETENTION_EVENTS_DAYS`
14. Disabling `enabled` is `0`, not `NULL`.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing
else is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; includes the tests this task adds.
  - `npx vitest run --project packages/store` — this package alone.
  - `npm run build` — `tsc -b` and the app build when this task touches it.
  - `git diff --name-only main...task-04` — audit against the exclusive paths.
  - The tests create their databases under `node:os.tmpdir()` with `mkdtemp` and close every
    `DatabaseSync`; no test uses a fixed path, the network or a real clock.
- **Acceptance criteria:** every one tagged **`[unit]`** (a headless command, a decoded value,
  a pinned number) or **`[live]`** (only exists in the running system: a stream, a push, a
  tunnel, a UI state). A `[live]` criterion states its **measurement** — what to read, on which
  surface, against which bound.
  - [ ] `[unit]` It typechecks, lints and builds clean: `npm run lint && npm run build`.
  - [ ] `[unit]` The declared tests exist and pass: `npx vitest run --project packages/store`
        reports at least the five test files above and zero failures.
  - [ ] `[unit]` Migrations apply to an empty database and are idempotent:
        `npx vitest run --project packages/store -t 'migrations apply to an empty database and are idempotent'`
        passes; it asserts `PRAGMA user_version = 1`, the ten named tables plus
        `schema_migrations` exist, a second `runMigrations` returns `applied: []`, and an edited
        checksum throws `StoreError` with code `migration_checksum`.
  - [ ] `[unit]` The claim transaction returns one winner under 20 concurrent attempts:
        `npx vitest run --project packages/store -t 'the claim transaction returns one winner under 20 attempts'`
        passes; it calls `claimScheduledRun` twenty times with the same `(jobId, scheduledFor)`
        — and once more from a second `DatabaseSync` on the same file — and asserts exactly one
        non-null result and `store.runs.countLive(repoId) === 1`.
  - [ ] `[unit]` Event replay by `seq` and by `Last-Event-ID` is exact:
        `npx vitest run --project packages/store -t 'event replay by seq and by Last-Event-ID is exact'`
        passes; it appends ten events, then asserts `readRunAfterSeq(runId, 4, 100)` returns
        seqs `5..10` in order and `readAfterId(3, 100)` returns the same rows with global ids
        `4..10`, and that a repeated `append` with the same seq throws `unique_violation`.
  - [ ] `[unit]` Foreign keys are enforced and a deleted repo refuses to orphan a live run:
        `npx vitest run --project packages/store -t 'a deleted repo refuses to orphan a live run'`
        passes; it asserts `delete` throws `StoreError` code `repo_has_live_run` while a run is
        `running`, that a `runs` insert with an unknown `repo_id` throws, that deleting a repo
        with only finished runs throws `foreign_key_violation`, and that deleting a repo with no
        runs succeeds.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-04` lists only files from the list above.
  - [ ] `[unit]` Determinism and layering: `grep -rnE "process\.env|Date\.now\(\)|new Date\(\)|node:http|node:child_process" packages/store/src --include=*.ts | grep -v '\.test\.ts'`
        prints nothing, and `grep -rn "from '@codebox/contracts'" packages/store/src` matches only
        lines beginning `import type`.
  - [ ] `[unit]` The document matches the schema: `grep -n "0001_init.sql" docs/architecture.md`
        finds the migration column entry for the ten shipped tables and the `routine_fires` row
        still says `0002`, planned (Task-34).

## 📣 Coordination

- For the Architect: the routines tables of `docs/architecture.md` §2 are **not** created here;
  Task-34 adds `0002_routines.sql`. The table section of `docs/architecture.md` now carries a
  `Migration` column, so Task-34 edits a column value, not the table shape.
- For the next batch: Task-11 opens `openStore({ path: join(CB_STATE_DIR, 'state.db') })` and
  must not run `loadMigrationsFromDisk` itself — `openStore` migrates by default. Task-09 stays
  pure (it computes due fires and the next fire); the **daemon** (Task-14/Task-15 wiring) calls
  `withTransaction(db, () => jobs.listDue(now, n).map(… claimScheduledRun …))` and
  `setNextFire`. Task-14 writes one transition per `withTransaction` with
  `events.nextSeq` + `events.append` in the same block; Task-15 pages with `PageQuery` and
  serialises `PageResult` straight into the `Page` contract shape (`data`, `nextCursor`).
- For Task-12: the refresh-token rotation columns exist (`refresh_token_hash`,
  `refresh_previous_hash`, `refresh_expires_at`); reuse detection is
  `getByRefreshHash(presented) !== null && presented !== current` → `revoke`.
- Two known gaps that this task must **not** fix: (1) `runs` has no idempotency-key table — a
  task that needs one declares a new numbered migration; (2) the contract `Job.cron` is
  non-nullable while `docs/jobs.md` §1 writes it as optional — the contract wins here, and the
  doc is not in this task's paths.
- For QA: the `[unit]` greps use `grep`, not `rg`, so they run on any runner.

## ⛔ Out of scope

- No new dependency outside the spec.
- No refactor of a file this task did not have to touch.
- No change to `docs/decisions.md` unless the task is the decision owner.
- No `routines` / `routine_fires` table, no routine repository (Task-34).
- No idempotency-key table, no telemetry aggregation table, no retention job (Task-27 owns the
  daemon side; the store only exposes `pruneBefore`).
- No id generation, no clock, no logger, no config parsing, no HTTP, no zod.
- No repository method that the Contract above does not list, even if a later task "will
  obviously need it" — that task declares its own migration.

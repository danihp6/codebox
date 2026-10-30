# Spec: Task-88 — The repositories surface the app already calls

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** daemon + contract (+ one store read query).
- **Role:** Dev.
- **Objective:** `GET /v1/repos` answers `200` with a page of registered repositories instead
  of falling through to the SPA `404`, and `POST`/`GET`/`PATCH`/`DELETE /v1/repos[/{id}]` and
  `POST /v1/repos/{id}/verify` answer the shapes `docs/api.md` §5.2 already documents. Every
  repository object the daemon emits carries `counts: { pending, running, merged }`, computed
  from the repository's works in the same SQL query that loads the row, so no client ever counts
  works itself (D59). The surface lives in a new `repos` subsystem appended last to `SUBSYSTEMS`,
  behind the same `DaemonContext` flags every other subsystem uses. After this task the app's
  `/repos`, `/repos/:id` and `/dashboard` open on their real data against a local daemon.
- **Environment:** worktree `../wt-cb-88`, branch `task-88`, base `main`.
- **Dependencies:** none. Everything this task reads is already merged: `repoSchema`,
  `repoVerifySchema`, `repoDetailSchema`, `pageOfRepo`, `errorEnvelopeSchema` in
  `packages/contracts/src/resources.ts` + `pagination.ts` + `errors.ts`; `RepoRepository` in
  `packages/store/src/repos.ts`; the `repos` and `works` tables in
  `packages/store/migrations/0001_init.sql` and `0006_works.sql`; the module seam in
  `apps/daemon/src/modules.ts`; the auth middleware, `handle()`/`requireScope()` error envelope
  and `GitProvider.verifyRepo` in the files listed under Inputs.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/daemon/src/repos/index.ts` (new)
- `apps/daemon/src/repos/service.ts` (new)
- `apps/daemon/src/repos/routes.ts` (new)
- `apps/daemon/src/repos/ids.ts` (new)
- `apps/daemon/src/repos/README.md` (new)
- `apps/daemon/src/repos/service.test.ts` (new)
- `apps/daemon/src/repos/routes.test.ts` (new)
- `apps/daemon/src/modules.ts`
- `apps/daemon/src/modules.test.ts`
- `apps/daemon/README.md`
- `packages/contracts/src/resources.ts`
- `packages/contracts/src/resources.test.ts`
- `packages/store/src/repos.ts` (justified addition — see Deviations)
- `packages/store/src/repositories.test.ts` (justified addition — see Deviations)
- `docs/api.md` (section: §5.2 Repositories only — no other section, and **no new route table
  row**; see the Test and Validation Plan for why)

**Deviations from the item's `*Paths:*` line, and why they are forced by the code**

1. `packages/store/src/repos.ts` + `packages/store/src/repositories.test.ts` are **added**. The
   item says the counts are "computed in the list query", and SQL belongs to `packages/store`
   only (`AGENTS.md`, and `.agent_roles/dev.md` rule 4 forbids SQL in a route or a daemon
   service). `RepoRepository` today has no method that returns counts, so the one SQL change this
   task needs is a correlated-subquery aggregate in `repos.ts`. Nothing else in the store moves:
   the interface keeps its five methods, `mappers.ts` is untouched, `index.ts` is untouched.
2. `counts` is **optional in `repoSchema`** (`counts: repoCountsSchema.optional()`), not
   required. Reason: roughly twenty existing fixtures in `apps/daemon/src/**`, `packages/store/src/**`
   and `apps/app/**` build a `Repo` literal and several of them push that literal through
   `parseRepo`/`parsePage`/`parseRepoDetail`/`workDetailSchema` at test time. A required key
   would force edits in `apps/app/**`, which the item forbids, and in daemon tests this task does
   not own. The guarantee is unchanged and is tested: **the daemon and the store always set
   `counts`** on every row they emit; the optionality exists only so old fixtures keep compiling
   and parsing. Consumers read `repo.counts ?? { pending: 0, running: 0, merged: 0 }` (a
   fallback, never a recount) — this is recorded for Task-91/92/95 under Coordination.

No other path may be widened. In particular `packages/contracts/src/index.ts`,
`apps/daemon/src/main.ts`, `apps/daemon/src/app.ts`, `apps/daemon/src/auth/middleware.ts`,
`apps/daemon/src/runs/engine.ts`, `packages/store/src/mappers.ts`,
`packages/store/src/index.ts`, `packages/contracts/src/openapi.ts`,
`packages/contracts/src/openapi.test.ts`, `apps/app/**`, `design/**`, `package.json`,
`package-lock.json`, `opencode.json`, `TODO.md`, `CHANGELOG.md` and `docs/decisions.md` are
**read-only**. If the code seems to force one of them, stop and report a spec bug in your
report — do not widen the list silently.

### Inputs (read-only)

- `packages/contracts/src/resources.ts` — `repoSchema`, `repoVerifySchema`, `repoDetailSchema`,
  `parseRepo`, `parseRepoDetail`, `parseRepoVerify`, `parseOrThrow` usage.
- `packages/contracts/src/primitives.ts` — `RepoId`, `slugSchema`, `branchSchema`, `globSchema`,
  `repoPolicySchema`, `REPO_POLICIES`, `ID_PREFIXES.repo`.
- `packages/contracts/src/errors.ts` — `ERROR_CODES`, `ERROR_STATUS` (`conflict` 409,
  `not_found` 404, `validation_failed` 422, `provider_unavailable` 503).
- `packages/contracts/src/pagination.ts` — `PAGINATION_DEFAULT_LIMIT`,
  `PAGINATION_MAX_LIMIT`, `parsePage`, `Page`.
- `packages/contracts/src/works.ts` — `workSchema` (the fixture the counts tests insert).
- `packages/contracts/src/openapi.ts` — read-only: `/v1/repos` already has six operations with
  `listRepos` answering `'Page'`. Do not edit it; there is nothing to add there.
- `packages/store/src/repos.ts` — `RepoRepository`, `RepoPatch`, `LIVE_RUN_STATES_SQL` usage.
- `packages/store/src/mappers.ts` — `row`, `repoFromRow`, `integerColumn`, `booleanToInteger`,
  `jsonText`.
- `packages/store/src/cursor.ts` — `encodeCursor(createdAt, id)`, `decodeCursor(cursor)`,
  `PageResult`.
- `packages/store/src/runs.ts` — `RunRepository.list({ repoId, limit, cursor })`, newest first.
- `packages/store/src/index.ts` — the exports you may import (`StoreError`, `withTransaction`,
  `encodeCursor`, `decodeCursor`, `openInMemoryStore`, types).
- `apps/daemon/src/modules.ts` — `SubsystemName`, `SUBSYSTEMS`, `DEFAULT_SUBSYSTEM_FLAGS`,
  `DaemonContext`, `DaemonModule`, `DaemonApp`.
- `apps/daemon/src/app.ts` — `API_PREFIX`, `createApp`, `errorBody`.
- `apps/daemon/src/runs/errors.ts` — `RunApiError`, `handle`, `json`, `readJson`,
  `readJsonOrEmpty`, `queryInput`, `requireScope`.
- `apps/daemon/src/auth/middleware.ts` — `requiredScope` (GET ⇒ `read`), `WORK_ROUTES` (this
  task's routes are **not** work routes).
- `apps/daemon/src/backlog/{index,routes,service,routes.test}.ts` — the subsystem shape, the
  `RunApiError` refusal helper and the in-process HTTP harness.
- `apps/daemon/src/works/service.ts` — the memoised-per-context service factory and the
  `requireRepo` 404 idiom.
- `apps/daemon/src/design/routes.ts` — the pattern for a `503` refusal with a structured
  `logger.warn` line.
- `apps/daemon/src/runs/engine.ts` — `providerAuth(context)` (exported) for the default verify
  port.
- `apps/daemon/src/repos/README.md` (you create it) and `apps/daemon/README.md` — the folder map
  style (`works/README.md`, `backlog/README.md`).
- `packages/git-provider/src/types.ts` and `packages/git-provider/src/github.ts` —
  `GitProvider.verifyRepo(slug)` returning `{ ok, defaultBranch, canPush, checks }`.
- `docs/api.md` §3, §4 and §5.2.

## 🔒 Contract

### 1. `packages/contracts/src/resources.ts`

```ts
const repoCountsSchema = z.strictObject({
  pending: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
});

export const repoSchema = z.strictObject({
  // ...the seven keys that exist today, unchanged...
  counts: repoCountsSchema.optional(),
});
```

- `repoCountsSchema` is a module-local `const`: **not exported**. `packages/contracts/src/index.ts`
  is not edited; the public surface is `Repo['counts']`, reached through `repoSchema` and the
  already-exported `Repo` type.
- `repoDetailSchema` inherits `counts` through `.extend({ lastRun })`; do not restate it.
- Values, unit and default:

  | key | shape | meaning |
  | --- | --- | --- |
  | `counts.pending` | integer ≥ 0 | the repository's works whose `state` is `queued` |
  | `counts.running` | integer ≥ 0 | the repository's works whose `state` is `running` |
  | `counts.merged` | integer ≥ 0 | the repository's works whose `state` is `merged` |

  `review`, `needs_decision`, `failed` and `abandoned` are **deliberately outside the three**:
  the frame's row has three numbers (`docs/app.md` §9) and a fourth would be a new fact. A
  repository with no works answers `{ pending: 0, running: 0, merged: 0 }`.
- Unknown keys keep being rejected (`strictObject`); a `counts` object with an unknown key is a
  parse failure.

### 2. `packages/store/src/repos.ts` — the one SQL change

- Add a `COUNTS_SQL` fragment to the selected columns of **all three** prepared statements
  (`selectById`, `selectBySlug`, `selectAll`), so every path that returns a `Repo` agrees:

  ```sql
  (SELECT COUNT(*) FROM works w WHERE w.repo_id = repos.id AND w.state = 'queued')  AS pending_count,
  (SELECT COUNT(*) FROM works w WHERE w.repo_id = repos.id AND w.state = 'running') AS running_count,
  (SELECT COUNT(*) FROM works w WHERE w.repo_id = repos.id AND w.state = 'merged')  AS merged_count
  ```

  `works_repo_state` (`0006_works.sql`) indexes `(repo_id, state, updated_at)`; no migration and
  no new index is needed.
- Add a local `repoOf(value)` that calls `row(value)` once and returns
  `{ ...repoFromRow(record), counts: { pending: integerColumn(record, 'pending_count'), running: …, merged: … } }`,
  and return it from `get`, `getBySlug`, `list`, `update` and (through `findById`) `create`.
  Import `integerColumn` from `./mappers.js`.
- The `RepoRepository` interface, `RepoPatch`, the unique/FK/`repo_has_live_run` behaviour and
  `packages/store/src/index.ts` stay exactly as they are. No new exported name.
- `update` still throws `StoreError('unique_violation')` for a taken slug and
  `StoreError('not_found')` for an unknown id; `delete` still throws `repo_has_live_run` while a
  run is live and `foreign_key_violation` when run history references the row. Do not change
  them.

### 3. `apps/daemon/src/repos/ids.ts`

```ts
export const REPO_ID_RANDOM_CHARS = 20;
export function newRepoId(random: (size: number) => Buffer = randomBytes): string;
```

`repo_` plus 20 Crockford base32 characters (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`), byte-and-mask
like `apps/daemon/src/works/ids.ts`; the result must satisfy `RepoId`. The random source is
injectable so the test can use a deterministic buffer.

### 4. `apps/daemon/src/repos/service.ts`

```ts
export const REPO_DEFAULTS = Object.freeze({
  defaultBranch: 'main',
  gate: 'npm ci && npm test && npm run build',
  policy: 'auto' as const,
  protectedPaths: [] as readonly string[],
  enabled: true,
});

export interface RepoListQuery {
  readonly limit: number;
  readonly cursor: string | null;
}

export interface CreateRepoInput {
  readonly slug: string;
  readonly defaultBranch?: string;
  readonly gate?: string;
  readonly policy?: RepoPolicy;
  readonly protectedPaths?: readonly string[];
}

export interface RepoPatchInput {
  readonly gate?: string;
  readonly policy?: RepoPolicy;
  readonly protectedPaths?: readonly string[];
  readonly enabled?: boolean;
}

/** The minimum the daemon needs from git; the default implementation wraps GitProvider.verifyRepo. */
export interface RepoVerifyPort {
  verify(slug: string): Promise<{ readonly defaultBranch: string; readonly canPush: boolean }>;
}

export interface CreateReposServiceOptions {
  readonly context: DaemonContext;
  readonly verify?: RepoVerifyPort;
}

export interface ReposService {
  list(query: RepoListQuery): PageResult<Repo>;
  detail(id: string): RepoDetail;
  create(input: CreateRepoInput): Repo;
  patch(id: string, input: RepoPatchInput): Repo;
  remove(id: string): void;
  verify(id: string): Promise<RepoVerify>;
}

export function createReposService(options: CreateReposServiceOptions): ReposService;
export function reposService(context: DaemonContext): ReposService;
```

Behaviour, frozen:

- `list` reads `store.repos.list()` (already `created_at DESC, id DESC`), applies the cursor with
  `decodeCursor` (predicate `createdAt < c.createdAt || (createdAt === c.createdAt && id < c.id)`),
  returns at most `limit` rows and `nextCursor = encodeCursor(last.createdAt, last.id)` when more
  rows remain, `null` otherwise. `decodeCursor` throws `StoreError('invalid_row')`, which
  `handle(c, 'repos', …)` already turns into `422 { path: 'repos.cursor' }` — let it travel.
- `detail` returns `{ ...repo, lastRun }` where
  `lastRun = store.runs.list({ repoId: id, limit: 1, cursor: null }).data[0] ?? null`. An unknown
  id is `RunApiError('not_found', 404, { path: 'repo.id' })`.
- `create` fills the defaults from `REPO_DEFAULTS` for the omitted keys, mints
  `newRepoId()`, sets `createdAt = context.clock().toISOString()` and `enabled: true`, and calls
  `store.repos.create(...)`. A taken slug surfaces as `StoreError('unique_violation')` and
  `handle` maps it to `409 { reason: 'unique_violation' }` — do not catch it. A malformed body
  is caught by the route's zod schema, never here.
- `patch` passes only the four keys to `store.repos.update(id, …)`; `slug` and `defaultBranch`
  are **not** patchable through HTTP. Unknown id ⇒ `404 { path: 'repo.id' }`; taken slug is
  impossible here.
- `remove` calls `store.repos.delete(id)` and maps its two refusals itself:
  `StoreError` with code `repo_has_live_run` ⇒ `RunApiError('conflict', 409, { reason: 'repo_has_live_run' })`;
  code `foreign_key_violation` ⇒ `RunApiError('conflict', 409, { reason: 'repo_has_history' })`;
  `not_found` travels and `handle` maps it to `404`.
- `verify` loads the repository (unknown id ⇒ `404 { path: 'repo.id' }`), calls
  `port.verify(repo.slug)` and composes exactly four checks, in this order:

  | index | `name` | `state` |
  | --- | --- | --- |
  | 0 | `repo` | `ok` |
  | 1 | `branch` | `ok` when the provider's `defaultBranch` equals `repo.defaultBranch`, else `mismatch` |
  | 2 | `push` | `ok` when `canPush`, else `forbidden` |
  | 3 | `gate` | `ok` when `repo.gate` is non-empty, else `missing` |

  The body is `{ ok, defaultBranch, canPush, checks }` where `ok` is true **only** when all four
  checks are `ok`, `defaultBranch` is the provider's answer (the observation; the registered
  value is already on the repo), and `canPush` is the provider's answer. A port failure is
  `RunApiError('provider_unavailable', 503, { reason: 'provider_unreachable' })` **after**
  `context.logger.warn({ msg: 'repo_verify_failed', repoId: repo.id, slug: repo.slug })`. Never
  log a token, a header or a response body.
- The default `verify` port (only when `options.verify` is absent) is built lazily on the first
  call, the way `apps/daemon/src/sessions/service.ts` builds its provider: `createGitHubProvider`
  with `auth: providerAuth(context)`, `apiBase: config.CB_GITHUB_API_URL`,
  `gitHost: 'github.com'`, `fetch: (url, init) => fetch(url, init)`, `git: createGitRunner()`,
  `now: () => context.clock().getTime()`,
  `requestTimeoutMs: config.CB_GIT_HTTP_TIMEOUT_SECONDS * 1000`,
  `userAgent: \`codebox/${context.build.version}\``, and a debug-only `log` sink; it returns
  `{ defaultBranch, canPush }` from `GitProvider.verifyRepo`. Constructing the service performs
  no I/O.
- `reposService(context)` memoises one service per `DaemonContext` in a module-level `WeakMap`
  (the `worksService`/`backlogService` idiom).
- **Emits no SSE event** and writes nothing to the event log: there is no `repo.*` event name in
  `SSE_EVENT_NAMES`, the app refetches the list, and inventing an event would need a decision
  record this task does not own. A 4xx refusal writes no log line; only the verify `503` logs.

### 5. `apps/daemon/src/repos/routes.ts`

```ts
export function registerReposRoutes(app: DaemonApp, repos: ReposService): void;
```

Mounted under `API_PREFIX` (`/v1`). Bodies and queries are `z.strictObject`; every failure goes
through `handle(c, <area>, …)`; every mutating route calls `requireScope(c, 'write')`.

| Method | Path | Scope | Success | Body / query |
| --- | --- | --- | --- | --- |
| `GET` | `/v1/repos` | `read` (middleware) | `200` `Page<Repo>` with `counts` on every row | query `{ limit?: 1..200 (default 50), cursor?: string }` |
| `POST` | `/v1/repos` | `write` | `201` `Repo` (`counts` all zero) | `{ slug, defaultBranch?, gate?, policy?, protectedPaths? }` |
| `GET` | `/v1/repos/{id}` | `read` (middleware) | `200` `RepoDetail` (`repo.counts` + `lastRun`) | — |
| `PATCH` | `/v1/repos/{id}` | `write` | `200` `Repo` | `{ gate?, policy?, protectedPaths?, enabled? }` — an empty body is allowed |
| `DELETE` | `/v1/repos/{id}` | `write` | `204`, empty body | — |
| `POST` | `/v1/repos/{id}/verify` | `write` | `200` `RepoVerify` | no body schema: the route never reads or validates a body (the app sends `null`) |

Frozen error envelope (`docs/api.md` §3, `errorEnvelopeSchema`):

| Case | Status | `error.code` | `error.details` |
| --- | --- | --- | --- |
| no / bad bearer | `401` | `unauthorized` | `{ reason: 'unauthorized' }` |
| token without the scope | `403` | `forbidden` | `{ reason: 'insufficient_scope' }` |
| malformed `{id}` | `422` | `validation_failed` | `{ path: 'repo.id' }` |
| unknown `{id}` | `404` | `not_found` | `{ path: 'repo.id' }` |
| bad body field | `422` | `validation_failed` | `{ path: 'repo.<field>' }` |
| repeated query key / bad cursor | `422` | `validation_failed` | `{ path: 'repos.cursor' }` |
| duplicate slug on `POST` | `409` | `conflict` | `{ reason: 'unique_violation' }` |
| `DELETE` while a run is live | `409` | `conflict` | `{ reason: 'repo_has_live_run' }` |
| `DELETE` with run history | `409` | `conflict` | `{ reason: 'repo_has_history' }` |
| `verify` with an unreachable provider | `503` | `provider_unavailable` | `{ reason: 'provider_unreachable' }` |

Route body schemas, exactly:

```ts
const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});
const createBody = z.strictObject({
  slug: slugSchema,
  defaultBranch: branchSchema.optional(),
  gate: z.string().min(1).optional(),
  policy: repoPolicySchema.optional(),
  protectedPaths: z.array(globSchema).optional(),
});
const patchBody = z.strictObject({
  gate: z.string().min(1).optional(),
  policy: repoPolicySchema.optional(),
  protectedPaths: z.array(globSchema).optional(),
  enabled: z.boolean().optional(),
});
```

### 6. `apps/daemon/src/repos/index.ts`

```ts
export function createModule(context: DaemonContext): DaemonModule; // name: 'repos'
export { createReposService, reposService, REPO_DEFAULTS } from './service.js';
export { newRepoId } from './ids.js';
export type { /* CreateRepoInput, CreateReposServiceOptions, RepoListQuery, RepoPatchInput,
  RepoVerifyPort, ReposService */ } from './service.js';
```

`createModule` builds `reposService(context)` and `register` mounts only
`registerReposRoutes(app, service)`: no timer, no row read, no shutdown hook.

### 7. `apps/daemon/src/modules.ts`

`SubsystemName` gains `'repos'` and `SUBSYSTEMS` gains it **appended last**, after `'design'`
(seventeenth entry), with `repos: true` in `DEFAULT_SUBSYSTEM_FLAGS`. Nothing is reordered: the
first sixteen names and their indices stay put (`cli` stays at index 11, `works` at 12), so
`apps/daemon/src/main.ts` does not move and stays untouched.

### 8. `docs/api.md` §5.2

Edit **only** §5.2, and **add no route row to its table** (the table already carries the six
routes plus the design route). Add:

- the `counts` key to the JSON example object, e.g.
  `"counts": { "pending": 2, "running": 1, "merged": 8 }`;
- one paragraph freezing the meaning: three integers computed by the daemon in the row's own
  query from `works` (`queued`, `running`, `merged`), the other four work states deliberately
  outside them, a repository with no works answering three zeros, and the client never counting
  (D59);
- one paragraph on `POST /v1/repos/{id}/verify`: the four checks `repo`/`branch`/`push`/`gate`,
  what makes each one `ok`, `ok` true only when all four are, `defaultBranch` and `canPush` as
  the provider's answer, `404` for an unknown id, `503 provider_unavailable` with
  `details.reason = "provider_unreachable"` when the provider could not answer, and that the
  route writes nothing and emits no event;
- one paragraph on the two `DELETE` refusals (`repo_has_live_run`, `repo_has_history`) and the
  duplicate slug (`unique_violation`), all `409 conflict`.

`docs/api.md` §2–§8 is parsed by `packages/contracts/src/openapi.test.ts` (`docsPaths()`): it
collects every table row that starts with `GET`/`POST`/`PATCH`/`DELETE` and compares the set with
the 63 OpenAPI paths. A new route row would fail that test, and `openapi.ts` is out of scope — so
a paragraph is prose, a row is a red gate.

## 🧩 Configuration

No new `CB_*` key. This task reads `CB_GITHUB_API_URL`, `CB_GIT_HTTP_TIMEOUT_SECONDS` and the
`CB_GITHUB_*` credential keys that `providerAuth(context)` already validates; it adds no line to
`docs/providers.md`.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; includes the app unit suite and the tests this task adds.
    A daemon test starts nothing: it builds `createApp({ context })` in-process with
    `openInMemoryStore()` and a temporary `CB_STATE_DIR` (`mkdtempSync(join(tmpdir(), 'cb-88-repos-'))`),
    a fixed `clock: () => new Date('2026-10-25T00:00:00.000Z')`, a `logger` whose sink discards,
    and a **stub** `RepoVerifyPort`. No network, no real model provider, no GitHub token, no
    port, no `codebox.service`.
  - `npm run build` — `tsc -b` plus the app build; must pass with the app unchanged.
  - `git diff --name-only main...task-88` — audit against the exclusive paths.
- **Tests this task must add**
  - `packages/contracts/src/resources.test.ts`: `counts` on the `Repo` fixture (and therefore
    `RepoDetail`), `counts` accepted and rejected (a negative count and an unknown key are parse
    failures naming `repo.counts…`), a repo without `counts` still parsing.
  - `packages/store/src/repositories.test.ts`: `list()`/`get()` return three zeros for a
    repository with no works; after inserting works in `queued`, `running`, `merged`,
    `needs_decision` and `failed`, the counts are `{ pending: 1, running: 1, merged: 1 }` and do
    not leak across repositories.
  - `apps/daemon/src/repos/service.test.ts`: the `REPO_DEFAULTS` create, the id shape
    (`parseOrThrow(RepoId, newRepoId())` passes), the `404` for an unknown id on
    `detail`/`patch`/`remove`/`verify`, the two `409` delete refusals, paging
    (`limit: 1` twice, no repeated row, `nextCursor: null` on the last page), and the verify
    composition for all four checks including `mismatch`, `forbidden`, `missing` and a thrown
    port becoming `RunApiError('provider_unavailable', 503, { reason: 'provider_unreachable' })`.
  - `apps/daemon/src/repos/routes.test.ts`: the in-process harness of
    `apps/daemon/src/backlog/routes.test.ts` (`createApp` + `createAuthModule(context)` +
    `registerReposRoutes`, devices minted with `mintAccessToken`, `app.request(path, init)`), the
    six routes and their statuses, the `read`-scope device refused `403` on every mutation, the
    missing bearer `401`, the error envelopes of the table above, and that the list's `counts`
    equal the works the store holds for that repository (seeded with `store.works.create`,
    including one repository with no works answering three zeros).
  - `apps/daemon/src/modules.test.ts`: seventeen subsystems with `repos` last, `cli` still at
    index 11, `works` still at 12, and `DEFAULT_SUBSYSTEM_FLAGS` in the same key order.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean (`npm run lint`, `npm run build`).
  - [ ] `[unit]` The declared tests exist and pass (`npm test`).
  - [ ] `[unit]` Nothing outside the exclusive paths was touched
        (`git diff --name-only main...task-88`); `packages/contracts/src/index.ts` and
        `apps/daemon/src/main.ts` are not in the diff.
  - [ ] `[unit]` `GET /v1/repos` answers `200` with a `Page` whose rows parse against
        `pageOfRepo`, and `POST`/`GET`/`PATCH`/`DELETE`/`verify` answer `201`/`200`/`200`/`204`/
        `200` with bodies that parse against `repoSchema`/`repoDetailSchema`/`repoSchema`/
        (empty)/`repoVerifySchema`; each route's scope is the one in the table, proven by a
        `403 insufficient_scope` from a device holding only `read` on all four mutations and by a
        `401 unauthorized` with no bearer.
  - [ ] `[unit]` The list's `counts` match the works the store holds for that repository
        (one `queued`, one `running` and one `merged` work ⇒ `{ pending: 1, running: 1, merged: 1 }`;
        `needs_decision` and `failed` are not counted) and a repository with no works answers
        three zeros.
  - [ ] `[unit]` An unknown id is `404 not_found` with `details.path = 'repo.id'` on `GET`,
        `PATCH`, `DELETE` and `verify`; a `DELETE` while a run is `queued` is
        `409 conflict` with `details.reason = "repo_has_live_run"`; a `POST` with an existing
        slug is `409 conflict` with `details.reason = "unique_violation"` and never a `500`.
  - [ ] `[unit]` `POST /v1/repos/{id}/verify` answers exactly four checks named
        `repo`, `branch`, `push`, `gate` in that order, `ok` is false when any of them is not
        `ok`, and a failing port is `503 provider_unavailable` with
        `details.reason = "provider_unreachable"` plus one `repo_verify_failed` warn line that
        carries `repoId` and `slug` and no token.
  - [ ] `[unit]` `repos` is the seventeenth `SUBSYSTEMS` entry (appended last) and
        `apps/daemon/src/main.ts` is unchanged; `route-table.test.ts` and
        `packages/contracts/src/openapi.test.ts` stay green with the path set still 63.
  - [ ] `[live]` Against the local daemon (`CB_BIND=127.0.0.1:0`, a temporary `CB_STATE_DIR`,
    a paired device token): `POST /v1/repos` with `{"slug":"acme/example"}` answers `201` with
    `counts` all zero, `GET /v1/repos` lists it, and `POST /v1/repos/{id}/verify` answers the four
    checks; the app's `/repos` screen renders the row instead of its error state. **Measurement:**
    the two `curl -s -H "authorization: Bearer $TOKEN"` bodies (status code and the four check
    names) and a screenshot/`data-testid` read of `/repos` on the running app. Not runnable on
    this CI runner: **there is no browser and no VM here, so QA reports every `[live]` criterion
    `not run`, never pass.**

## 📣 Coordination

- **For Task-91 (Repo list), Task-92 (Repo · backlog) and Task-95 (Dashboard):**
  - `Repo` now carries `counts: { pending, running, merged }` — three integers, non-negative, the
    repository's works in `queued`/`running`/`merged`, written by the daemon in the row's query
    (D59). The type marks it optional because old fixtures predate it; the daemon and the store
    always set it, so a page reads `repo.counts?.pending ?? 0` (a fallback, never a recount).
    `review`, `needs_decision`, `failed` and `abandoned` are **not** in the three: the amber dot
    of `docs/app.md` §9 ("an unreviewed PR or a red run") cannot be derived from `counts` and
    must come from the page's own run data.
  - `GET /v1/repos` answers `Page<Repo>` with `limit` (1–200, default 50) and `cursor`;
    `GET /v1/repos/{id}` answers `RepoDetail` = `Repo` + `lastRun: Run | null`. The client never
    counts.
  - `POST /v1/repos/{id}/verify` is real now: four checks (`repo`, `branch`, `push`, `gate`),
    `ok` true only when all four are, `503 provider_unavailable` when GitHub cannot answer.
  - `DELETE /v1/repos/{id}` is `409` while a run is live (`repo_has_live_run`) or when run
    history exists (`repo_has_history`).
- **For the Orchestrator:** `SUBSYSTEMS` grew to seventeen, `repos` appended last, so
  `apps/daemon/src/main.ts` did not move. `packages/contracts/src/index.ts` was not edited (the
  `Repo` type already carries the key through `repoSchema`), and `openapi.ts`/`openapi.test.ts`
  were not edited — the 63-path set is unchanged.
- **For the next batch:** the one store query that owns `counts` is
  `createRepoRepository` in `packages/store/src/repos.ts`; a later task that needs a fourth
  number adds it there and in `docs/api.md` §5.2 in one change.

## ⛔ Out of scope

- No `GET /v1/integrations/github/repos` and no GitHub picker: the frame retired it.
- No change under `design/`, no frame, no screen: this task draws nothing.
- No change to `apps/app/**`: the app already calls every route; only the daemon and the contract
  move. Do not touch the app's fixtures to make a required key compile.
- No new migration, no new table, no `packages/store/src/mappers.ts` edit, no
  `packages/store/src/index.ts` edit.
- No SSE event for a repository change, no `docs/decisions.md` entry, no `CHANGELOG.md` or
  `TODO.md` edit (the Orchestrator owns those at merge time).
- No repo membership allowlist, no per-repository lock, no clone-on-create: registering a row is
  not cloning it; the run flow clones on demand.
- No new dependency.

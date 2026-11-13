# Spec: Task-123 — The store keeps a repository that has no remote

> The spec is the subagent's entire world. Anything not written here does not exist.

## 🎯 Scope

- **Task type:** package (`packages/store`): one numbered migration plus the repos repository and
  its row mapper. No daemon, no HTTP, no app, no screen.
- **Role:** Dev.
- **Objective:** a `repos` row can describe a repository that has no GitHub remote. A new
  migration adds `source` (`'local' | 'github'`) and `name`, makes `slug` nullable while keeping
  it unique, refuses a `github` row without a slug, and backfills `name` from the slug for every
  row that predates D62. `store.repos` reads and writes both shapes, refuses two local
  repositories with the same name, and a null slug never collides with another null.
- **Environment:** worktree `../wt-cb-123`, branch `task-123`, base `main` at `61ebc8b`
  **plus Task-122 merged** (wave 1).
- **Dependencies:** Task-122 (merged) — it froze `Repo.source`, `Repo.name`, `nameSchema` and
  the nullable `slug` this migration implements. Nothing else in the batch produces a file this
  task reads; Task-124 and Task-125 are cut after this task merges.

### Batch position (Batch 34)

- **Wave 2 of 4, in parallel with Task-124.** Both branch from the merged `task-122`; this task
  produces the row shape Task-125 writes, and Task-124 produces `initLocal`, which Task-125
  calls. The two never touch the same path (this task owns `packages/store/**`, Task-124 owns
  `packages/workspaces/**`).
- Hot-file holder in this batch: **the new migration file** — this task is its only writer, and
  no other task creates a `packages/store/migrations/*.sql`.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `packages/store/migrations/0008_repo_source.sql` (new — the batch's one new migration)
- `packages/store/src/repos.ts`
- `packages/store/src/mappers.ts` — **forced addition**: `repoFromRow` is the mapper for
  `repos` and the new columns are unreadable without it. One function changes.
- `packages/store/src/repositories.test.ts`
- `packages/store/src/migrate.test.ts` — the version, the file list and the index list are
  pinned there; `store.test.ts`'s `schemaVersion` too.
- `packages/store/src/store.test.ts` — the two `schemaVersion` pins and the
  `schema_migrations` row count only
- `packages/store/README.md` — one line under `migrations/`; no `src/` line moves

The item names `packages/store/src/migrations/<next>.sql` and `packages/store/src/schema.ts`.
Neither exists: this package keeps its SQL in `packages/store/migrations/` (`0001`–`0007` are
there) and has no `schema.ts` — the schema **is** the numbered files. The paths above are the
same intent at the real locations.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/decisions.md` — D8 (numbered SQL, no ORM) and D62 (Task-122 wrote it)
- `docs/api.md` §5.2 (the `Repo` object this row materialises; Task-125 owns the section)
- `packages/store/migrations/0001_init.sql` and `packages/store/migrations/0005_chat_free.sql`
  (the table and the twelve-step rebuild this one copies)
- `packages/store/src/{migrate.ts,db.ts,errors.ts,mappers.ts,repos.ts,store.ts,index.ts}`
- `packages/store/src/{migrate.test.ts,store.test.ts,repositories.test.ts}`
- `packages/contracts/src/resources.ts` (the `Repo` type this row must satisfy)
- `packages/store/README.md`

## 🔒 Contract

The public surface Task-125 is written against **right now**.

```ts
// packages/store/src/repos.ts
export interface RepoRepository {
  get(id: string): Repo | null;
  /** A github repository's remote coordinate. Unchanged. */
  getBySlug(slug: string): Repo | null;
  /** D62: a local repository's identity. Only ever matches `source = 'local'`. */
  getLocalByName(name: string): Repo | null;
  list(): Repo[];
  create(repo: Repo): Repo;
  update(id: string, patch: RepoPatch): Repo;
  delete(id: string): void;
}
```

- **`create` normalises, it never guesses.** `source` defaults to `'github'`; `name` defaults
  to `nameFromSlug(repo.slug)`; a `source: 'local'` row with no `name`, or a row with neither a
  name nor a slug, is `StoreError('invalid_row', 'a repository needs a name')`; a
  `source: 'github'` row with `slug: null` is `StoreError('invalid_row', 'a github repository
  needs a slug')` — the store refuses it **before** the statement runs, so the table `CHECK` is
  never the mapper of a domain error. This keeps every fixture written before D62 working without
  an edit (the `counts` precedent, D59).
- **`nameFromSlug(slug)`** — module-local, pure, not re-exported from `index.ts`: the part after
  the first `/` (the whole slug when there is none), lowercased, truncated to 64 characters. The
  migration's `INSERT … SELECT` applies the identical rule; a test pins the two together.
- **Errors:** a duplicate slug **or** a duplicate local name is `StoreError('unique_violation',
  'a repository with that slug or name already exists')`. The code is what the daemon maps
  (`handle()` → `409 conflict`, `details.reason = "unique_violation"`); the message changes from
  `'repo slug already exists'` because it is no longer only a slug. `RepoPatch` is unchanged:
  `slug` stays patchable (Task-128 writes the remote onto an existing local row).
- **Purity:** no repository reads the clock, generates an id or parses configuration; every
  timestamp remains a caller argument.

### The migration — `0008_repo_source.sql`

Twelve-step rebuild, exactly `0005_chat_free.sql`'s shape, because SQLite cannot drop `NOT NULL`
in place. Children that name `repos` (`jobs`, `runs`, `works`, `chat_sessions`, `schedules`,
`repo_schedules`) keep pointing at the name `repos`, so the old table is dropped first and the
new one takes its name; the runner disables foreign keys and checks
`PRAGMA foreign_key_check` before the commit.

```sql
CREATE TABLE repos_new (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL DEFAULT 'github' CHECK (source IN ('local', 'github')),
  name            TEXT NOT NULL,
  slug            TEXT,
  default_branch  TEXT NOT NULL,
  gate            TEXT NOT NULL,
  policy          TEXT NOT NULL CHECK (policy IN ('auto', 'manual')),
  protected_paths TEXT NOT NULL,
  enabled         INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at      TEXT NOT NULL,
  CHECK (source <> 'github' OR slug IS NOT NULL)
);

INSERT INTO repos_new (id, source, name, slug, default_branch, gate, policy,
                       protected_paths, enabled, created_at)
SELECT
  id,
  'github',
  substr(lower(CASE WHEN instr(slug, '/') > 0 THEN substr(slug, instr(slug, '/') + 1)
                    ELSE slug END), 1, 64),
  slug, default_branch, gate, policy, protected_paths, enabled, created_at
FROM repos;

DROP TABLE repos;
ALTER TABLE repos_new RENAME TO repos;

CREATE UNIQUE INDEX repos_slug ON repos (slug);
CREATE UNIQUE INDEX repos_local_name ON repos (name) WHERE source = 'local';
```

- `repos_slug` replaces the inline `UNIQUE` of `slug`. SQLite allows many `NULL`s in a unique
  index, so two local repositories with no remote never collide, and two github rows with the
  same slug still do.
- `repos_local_name` is **partial** (`WHERE source = 'local'`) on purpose: a local repository
  named `example` and a github repository `dani/example` coexist, because they are two rows about
  two different things.
- The `CHECK` is the owner of the D62 invariant at the storage layer; the contract's refinement
  (Task-122) is the second line of defence.
- The header comment states the D62 rule, the rebuild reason and that the file is checksum-pinned
  and forward-only, like `0001`–`0007`.

### `repos.ts` — the queries

- `COLUMNS` gains `source, name` (before `slug`); `repoOf` keeps reading the three counts in the
  same statement (D59).
- `insert` names all ten columns; no statement uses `SELECT *`.
- `getLocalByName` is `SELECT … FROM repos WHERE source = 'local' AND name = ?`; a github row
  whose derived name matches answers `null`.
- `update` is unchanged except that its unique-violation message matches `create`'s.

### `mappers.ts` — `repoFromRow`

Adds exactly two keys to the object it returns: `source: enumColumn(rowValue, 'source',
REPO_SOURCES)` and `name: textColumn(rowValue, 'name')`. `REPO_SOURCES` is re-declared at the
top of `mappers.ts` next to `REPO_POLICIES` (the file imports `@codebox/contracts` type-only, so
a value import would need `contracts/dist`). `slug` becomes `nullableTextColumn(rowValue,
'slug')`. No other mapper changes.

### Data

- `repos.source`: `TEXT NOT NULL DEFAULT 'github'`, `CHECK (source IN ('local','github'))`.
- `repos.name`: `TEXT NOT NULL`; the folder-safe identity; unique **among local rows**.
- `repos.slug`: `TEXT` (nullable); unique across the table; `NULL` never collides.
- `StoreError('unique_violation')` covers both uniquenesses; its message is
  `'a repository with that slug or name already exists'`.

## 🧩 Configuration

None. No `CB_*` key, no dependency, no lockfile change. The migration is discovered by
`loadMigrationsFromDisk` — no registry to edit.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Runner note (this batch, verbatim).** This batch runs on the operator's Windows host; the
  `packages/store` project is fully headless (temporary file databases under `os.tmpdir()`), so
  **every** test named below must be green here — the pre-existing POSIX red lives in
  `apps/daemon` and `scripts`, not in this project. Never use `npx` on this host; call
  `node node_modules/vitest/vitest.mjs run --project packages/store`.
- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`.
  - `node node_modules/vitest/vitest.mjs run --project packages/store`
  - `node node_modules/vitest/vitest.mjs run --project packages/contracts` (the `Repo` type this
    migration materialises; must stay green)
  - `npm run lint` and `npm run build` — both must pass.
  - `git diff --name-only main...task-123` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `migrate.test.ts` proves a fresh database reaches version **8** with the file
        list `0001…0008_repo_source.sql`, `PRAGMA user_version = 8`, `PRAGMA foreign_key_check`
        empty, and that `repos_slug` and `repos_local_name` exist; the existing partial-database
        case (`currentVersion` 4 → 8) still reaches 8.
  - [ ] `[unit]` `migrate.test.ts` proves a **legacy database with rows**: migrate to 7, insert
        two `repos` rows (`dani/example`, `Acme/Widget.Kit`) plus one `runs` row referencing the
        first, then apply 0008 — both rows survive, the run keeps its `repo_id`, every row
        answers `source = 'github'`, and `name` is `example` and `widget.kit`.
  - [ ] `[unit]` `repositories.test.ts` proves: a local repo round-trips with `slug: null`,
        `source: 'local'` and its `name`; **two local repos with the same name** are refused with
        `StoreError.code === 'unique_violation'`; **two github repos with the same slug** are
        refused with the same code; a local `widgets` **and** a github `acme/widgets` both store
        and both read back; two local repos with different names and `slug: null` never collide
        (the null-slug rule).
  - [ ] `[unit]` `repositories.test.ts` proves the legacy path: `create({ …fixture })` with no
        `source` and no `name` answers `source: 'github'` and `name` derived from the slug by the
        same rule the migration applies (`dani/example` → `example`); `create` of a
        `source: 'local'` row with no `name` throws `StoreError` with code `invalid_row`; a
        `source: 'github'` row with `slug: null` throws `StoreError` with code `invalid_row`
        **before** any statement runs (the table `CHECK` is the backstop, not the answer).
  - [ ] `[unit]` `repositories.test.ts` proves `getLocalByName`: it finds a local row, answers
        `null` for a github row whose derived name matches, and answers `null` for an unknown
        name; `getBySlug` still finds the github row and answers `null` for a null slug.
  - [ ] `[unit]` `store.test.ts` pins `schemaVersion === 8` on both opens and 8 rows in
        `schema_migrations`.
  - [ ] `[unit]` `grep -rn "repo.slug\|slug already exists" packages/store/src/repos.ts` shows
        no remaining string interpolation of a slug into a message other than the new one.
  - [ ] `[unit]` `git diff --name-only main...task-123` lists only the exclusive paths and
        `packages/store/migrations/0008_repo_source.sql` is the only new file.
  - [ ] `[unit]` lint, the two named Vitest projects and the build pass.
  - [ ] `[live]` none. Nothing in this task is observable outside a database file.

## 📣 Coordination

- **For Task-125:** write the row through `store.repos.create` and let it normalise `name` for a
  github row; pass `name` explicitly for a local one. A duplicate name arrives as
  `StoreError('unique_violation')` and `handle()` already answers `409 conflict` with
  `details.reason = "unique_violation"` — do not add a second duplicate check.
- **For Task-128 (next batch):** `update(id, { slug })` is how a local repository gains its
  remote; the partial name index keeps the row's identity intact when that happens.
- **For QA:** every fixture in the repository that builds a `Repo` without `source`/`name` must
  keep passing — that is the reason `create` derives instead of requiring. If one of them fails,
  the fallback is wrong, not the fixture.
- **For the Architect:** the item's `packages/store/src/{schema.ts,repositories/repos.ts}` paths
  do not exist; this spec uses `packages/store/src/repos.ts`, `packages/store/src/mappers.ts`
  (forced, one function) and the three pinned test files. The new file is
  `packages/store/migrations/0008_repo_source.sql`, not under `src/`.
- **Measured, not this task:** the `runs`, `jobs` and `works` tables are untouched; only the
  `repos` table is rebuilt, and `PRAGMA foreign_key_check` is the proof that no child row was
  orphaned.

## ⛔ Out of scope

- No daemon, HTTP, app or screen change; no `docs/api.md` edit (Task-125); no decision record
  (Task-122 wrote D62).
- No second migration, no index on `created_at`, no new table, no `schema_migrations` change.
- No change to any other repository (`runs`, `works`, `schedules`, `providers`, …) and no change
  to `RepoPatch`'s members.
- No new dependency, no lockfile edit, no reformatting of `repos.ts` or `mappers.ts` beyond the
  lines named.

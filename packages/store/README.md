# `@codebox/store`

SQLite schema, numbered migrations and repositories. The only place in the repository that
knows SQL: the daemon opens one connection and calls typed methods, never a statement.

One writer, WAL, foreign keys on. Migrations are numbered SQL files applied forward only and
pinned by checksum, so an edited file is refused instead of silently diverging. Every
timestamp and every id is a caller argument; no repository reads the clock, generates an id,
or parses configuration. `@codebox/contracts` is imported **type-only**, so `npm test` runs
before `npm run build`.

## Files

- `package.json` — workspace manifest.
- `tsconfig.json` — build and typecheck configuration.
- `README.md` — this file map.
- `migrations/0001_init.sql` — the ten v1 tables and their indexes.
- `migrations/0002_routines.sql` — the two routine tables, their kind CHECKs and the three indexes.
- `migrations/0003_chat_scope.sql` — the chat scope, its usage ledger, the context epoch and `reviewed_at`.
- `migrations/0004_schedules.sql` — the schedule object, its fires and the three indexes, additively.
- `migrations/0005_chat_free.sql` — the twelve-step rebuild that makes `chat_sessions.repo_id` nullable.

## `src/`

- `index.ts` — public entry point; re-exports every name once, grouped by module.
- `errors.ts` — `StoreError` and the codes the daemon maps to HTTP.
- `db.ts` — `openDatabase` (WAL, foreign keys, busy timeout), `withTransaction` and SQLite error classification.
- `migrate.ts` — the checksum-pinned runner, `loadMigrationsFromDisk` and `MIGRATIONS_DIRECTORY`.
- `cursor.ts` — the opaque `(createdAt, id)` cursor and the `PageQuery`/`PageResult` envelope.
- `mappers.ts` — row accessors and the contract-shape mappers; internal, not re-exported.
- `store.ts` — `openStore`, `openInMemoryStore` and the `Store` handle.
- `repos.ts` — repositories and per-repo policy.
- `jobs.ts` — job definitions, due selection and the next fire.
- `runs.ts` — run records, patches and the scheduled-run claim.
- `events.ts` — the append-only timeline, `seq` allocation, replay and pruning.
- `approvals.ts` — permission requests and their single resolution.
- `chats.ts` — chat sessions, their messages, the last message projection and the newest turns.
- `devices.ts` — paired devices, refresh-token rotation and revocation.
- `settings.ts` — non-secret key/value settings stored as JSON.
- `usage.ts` — the token/cost ledger and its per-day aggregate.
- `routines.ts` — chat schedules: the discriminated union, the newest-first page and the due queue.
- `routine-fires.ts` — the transactional claim on `(routine_id, scheduled_for)`, skip and outcome.
- `schedules.ts` — the schedule object: the newest-first page, the patch and the due queue; a patch stamps `updated_at` from SQLite because the frozen patch carries no timestamp.
- `schedule-fires.ts` — the transactional claim on `(schedule_id, scheduled_for)`, skip, outcome and the cost ledger.
- `migrate.test.ts` — migration application, idempotency, checksum, failure rollback and the
  `chat_sessions` rebuild with every child row.
- `store.test.ts` — open/close, WAL, file format, the in-memory fake and the cursor.
- `runs.test.ts` — the claim race, run round-trip, paging and live-state counting.
- `events.test.ts` — replay by `seq` and by `Last-Event-ID`, stream sequences and pruning.
- `repositories.test.ts` — repos, jobs, approvals, chats, devices, settings, usage and the deleted-repo rules.
- `routines.test.ts` — the routine round-trip, the list filters, the patches and the two delete rules.
- `routine-fires.test.ts` — the claim race, the claim guards, skip, finish and the reads.
- `schedules.test.ts` — the round-trip, the SQL CHECKs, the page, the patch, the due queue and the reopen.
- `schedule-fires.test.ts` — the claim race, the guards, skip, finish, the spend and the failure streak.

## Checks

- `npm run lint`, `npm test` and `npm run build` from the repository root.
- `npx vitest run --project packages/store` runs only this package's tests.
- The tests create file databases under `os.tmpdir()` with `mkdtemp` and close every
  `DatabaseSync`; there is no fixed path, no network and no real clock.

`openStore` migrates by default, so a caller never runs `loadMigrationsFromDisk` itself. The
repository objects are built by `create*Repository` factories internal to the package; `Store`
exposes them already bound to the connection.

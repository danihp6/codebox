# `apps/daemon/src/repos`

The repository registry of `docs/api.md` §5.2: registering a row is not cloning it, and every
row carries the three work counts (`queued`, `running`, `merged`) read in the statement that
loads it, so no client ever counts works (D59).

## Files

- `index.ts` — the `repos` subsystem module: one shared service, the routes, no timer.
- `service.ts` — list with the `(createdAt, id)` cursor, the detail with its last run, the
  create defaults, the four-key patch, the two delete refusals and the verify composition, plus
  the lazily built GitHub port.
- `routes.ts` — the six §5.2 handlers, their body and query schemas and their scopes.
- `ids.ts` — the only `repo_` id generator.
- `service.test.ts` — the defaults, the id shape, the 404s, the two 409 delete refusals, the
  paging, the verify composition and the redacted 503 warning.
- `routes.test.ts` — the §5.2 HTTP contract: statuses, counts from the store, paging, scopes,
  the error envelopes and the verify checks.

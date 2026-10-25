# `src/telemetry`

The observability subsystem: `GET /v1/telemetry` (the `Telemetry` resource of `docs/api.md`
§5.1) and the retention pass of `docs/security.md` §8. The route sums the `usage` ledger over
the requested window, counts the runs created inside it and reports the disk and queue probes
that already serve `/v1/health`; the pass deletes the expired rows and the `logs/run-run_*/`
directories on a six-hour timer.

## Files

- `index.ts` — the `createModule` seam: one service, the route and the shutdown hook that
  clears the timer; the service factory is re-exported for tests.
- `service.ts` — the telemetry report, the retention pass and its first-delay-plus-interval
  timer, with injectable probes, clock and log directory.
- `routes.ts` — the §5.1 handler, its strict `range` query schema and the `telemetry.` paths of
  a validation failure.
- `retention.ts` — the five cutoffs derived from the `CB_RETENTION_*_DAYS` values and the
  removal of the stale `run-run_<runId>/` directories.
- `service.test.ts` — the range parity with the contract, the report, the retention fixture,
  the timer and the module seam.
- `routes.test.ts` — the HTTP contract: ranges, default, validation paths, scopes and the 500.
- `retention.test.ts` — the cutoff table, the mtime comparison, a missing directory and a
  symlink that must not be followed.

## Notes

- `USAGE_RANGES` in `@codebox/core` duplicates `TELEMETRY_RANGES` from `@codebox/contracts`
  because `packages/core` has no dependency: the daemon test asserts the two lists are equal
  element by element, so the duplication cannot drift.
- `runs.total` counts every state created inside the window, so a live run is in `total` and in
  none of `succeeded` / `failed` / `cancelled`; the three do not add up to the total.
- Retention runs events, then approvals, then runs, then archived chats, then log directories.
  The short windows go first because deleting a 90-day-old run cascades its events and
  approvals and would keep a 30-day-old event alive until its run aged out.
- A `usage` row is never deleted: the ledger is the record of spend. Deleting a run nulls
  `usage.run_id` and leaves the row.
- The pass logs one `retention_done` line with the five counts; a thrown error becomes
  `retention_failed` from the timer wrapper and the next tick still runs.

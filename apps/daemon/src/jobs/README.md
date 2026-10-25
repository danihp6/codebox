# `jobs`

The jobs subsystem: docs/api.md §5.3 (list, create, detail, patch, delete, run now, pause,
resume and the fire preview). It reads and writes the `jobs` table and starts runs through the
`runs` subsystem's service, never through a second engine.

## Files

- `index.ts` — the `jobs` subsystem module: builds the service and registers the routes.
- `service.ts` — the job lifecycle, `nextFireAt` over `@codebox/core` and the `job.changed` events.
- `routes.ts` — the §5.3 handlers with their strict body and query schemas.
- `service.test.ts` — schedule arithmetic, defaults, patch, pause/resume, run now, events, lists.
- `routes.test.ts` — the HTTP contract, filters, cursor, errors and scope.
- `README.md` — this map.

## Notes

- `@codebox/scheduler` is not a dependency of the daemon, so `nextFireAt` wraps `parseCron`,
  `isValidTimezone` and `nextFire` from `@codebox/core` and formats like
  `packages/scheduler/src/validate.ts`: the values are byte-identical to the scheduler's.
- A job never carries a client-supplied `nextFireAt`: create, resume and a `cron`/`timezone`
  patch compute it from `now`, and pause stores `null`.
- Every mutation appends one `job.changed` row (`runId: null`, `chatId: null`, `seq: null`) in
  the write's transaction; delivery is the SSE bridge's poll, never a callback.
- `runNow` ignores the pause switch and asks the shared runs service for the run, so the
  daemon keeps one `inflight` map and one cost budget.

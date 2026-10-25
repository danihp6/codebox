# `runs`

The runs subsystem: docs/api.md §5.4 (runs, cancel, revert, JSON event replay, diff), §5.5
(approvals inbox and reply) and `POST /v1/chat/sessions/{id}/promote`. It owns the one run
engine instance and the in-memory idempotency store of §4.

## Files

- `index.ts` — the `runs` subsystem module: registers runs, approvals and promote routes.
- `service.ts` — the runs service, the queued row the engine adopts, the shared instance.
- `engine.ts` — `RunPorts` for the merged packages plus the `RunSettings` of `CodeboxConfig`.
- `routes.ts` — the §5.4 handlers and the promote handler with their strict schemas.
- `approvals.ts` — the §5.5 inbox, one approval and the reply handler.
- `idempotency.ts` — the in-memory `Idempotency-Key` store, canonical JSON and its hash.
- `ids.ts` — the only `run_` and `job_` id generators.
- `errors.ts` — `RunApiError`, the §3 envelope, `handle()` and the shared route plumbing.
- `ids.test.ts` — id shape, uniqueness and the injectable random source.
- `idempotency.test.ts` — canonical JSON, replay, mismatch, retention and the entry cap.
- `engine.test.ts` — the port wiring, the settings mapping and the auth selection.
- `service.test.ts` — create, cancel, revert, diff, event replay, approvals and promote.
- `approvals.test.ts` — the approvals routes: default state, filters, reply and expiry.
- `routes.test.ts` — the HTTP contract, idempotency, pagination, cancel, replay, promote, scope.
- `README.md` — this map.

## Notes

- `createModule().register` does no I/O: `runsService(context)` caches one service per daemon
  context and the engine is built on the first run request, so a tree with no GitHub
  credential and no OpenCode listener still boots with `report.failed` empty.
- `run/index.ts` and `gate/index.ts` must stay absent: the loader imports `./<name>/index.js`
  and a file there without `createModule` fails the boot.
- `src/run/**` and `src/gate/**` are read-only here; this subsystem configures the engine, it
  does not change the flow.
- The approval reply only resolves the row and appends `approval.resolved`. It never calls
  OpenCode: the chat subsystem polls the resolved row and delivers the answer.
- `docs/api.md` §4 promises 24 h idempotency retention; `packages/store` has no table for it,
  so the store lives for the process lifetime and a restart forgets a replay.
- The 60 s approval sweep is started by the first `/v1/approvals` request and `unref()`ed;
  both modules call `stop()` on shutdown, which is idempotent.

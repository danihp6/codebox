# `@codebox/daemon`

`cbd`, the daemon: HTTP API, SSE, scheduler, OpenCode supervisor and git provider. Task-11
wires every subsystem behind feature flags; later tasks add modules, not imports.

## Files

- `package.json` — workspace manifest; `prebuild` builds the `@codebox/*` packages the daemon
  value-imports, because the root `build` runs `apps/*` before `packages/*`.
- `tsconfig.json` — build and typecheck configuration.
- `src/main.ts` — process entry point: boot order, `startDaemon`, `runMain`, `daemon.json`.
- `src/config.ts` — `CB_*` loading, bind parsing, state paths, build info.
- `src/logger.ts` — structured JSON logger with key redaction and level filtering.
- `src/modules.ts` — `DaemonContext`, subsystem flags, module loading and shutdown hooks.
- `src/health.ts` — db, OpenCode, disk and queue probes behind `/v1/health`.
- `src/boot.ts` — boot reconciliation of orphaned runs and stale lock files.
- `src/static.ts` — static file resolution and SPA fallback for the built app.
- `src/app.ts` — Hono app: request id, request log, `/v1/health`, `/v1/version`, errors.
- `src/auth/index.ts` — the auth subsystem module: builds the service and the rate limiter,
  registers the routes.
- `src/auth/service.ts` — in-memory pairing codes, exchange, refresh rotation, authenticate,
  logout.
- `src/auth/routes.ts` — `/v1/pair*`, `/v1/auth/*`, `/v1/me` and `/v1/devices` handlers with
  their body and query schemas.
- `src/auth/middleware.ts` — the one `/v1/*` bearer middleware, scope table, loopback test and
  pairing rate limiter.
- `src/auth/errors.ts` — `AuthError` and the failure-to-envelope mapping.
- `src/auth/ids.ts` — the only `dev_` device id generator.
- `src/config.test.ts` — config loading, failure naming, bind parsing, paths, build info.
- `src/logger.test.ts` — level thresholds, redaction, error serialisation, log shape.
- `src/modules.test.ts` — subsystem list, shutdown order, module loading report.
- `src/health.test.ts` — status aggregation, disk thresholds, probes, parsed health body.
- `src/boot.test.ts` — orphaned run failure, event append, stale and malformed locks.
- `src/static.test.ts` — path resolution, traversal rejection, content types, SPA fallback.
- `src/app.test.ts` — the two public routes, request id, error envelope, static hosting.
- `src/auth/ids.test.ts` — device id shape, uniqueness and injectable randomness.
- `src/auth/service.test.ts` — pairing, exchange races, refresh rotation, replay, revoke.
- `src/auth/routes.test.ts` — the HTTP contract: guarded routes, issuer gate, rate limit,
  validation, the module route seam.
- `src/start.test.ts` — config fail-fast, ephemeral bind, `daemon.json`, clean shutdown.

## Notes

- `createProbes` counts at most `PAGINATION_MAX_LIMIT` (200) queued runs for
  `health.queue.pending`, the contract's page limit; a larger queue reads as 200.
- `auth` is the first subsystem module on disk; an absent module is still a supported boot
  state.
- The `GET *` catch-all in `app.ts` hands a `/v1` path to the modules registered after it, so a
  module route is reachable and an unmatched API path still ends in `not_found`, never in
  `index.html`.
- Pairing codes and the pairing rate counter live in memory by design: a daemon restart
  invalidates an unused code and resets the counters. No table, no migration.
- The static route rejects a raw request target that carries a `..` segment, plain or
  percent-encoded, before node-server normalisation collapses it, so the SPA fallback never
  answers a traversal attempt with `index.html`. Only a real listener exposes that target; the
  Fetch API normalises before a `Request` exists.

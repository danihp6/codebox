# `@codebox/daemon`

`cbd`, the daemon: HTTP API, SSE, scheduler, OpenCode supervisor and git provider. Task-11
wires every subsystem behind feature flags; later tasks add modules, not imports.

## Files

- `package.json` — workspace manifest; `prebuild` builds the three `@codebox/*` packages the
  daemon value-imports, because the root `build` runs `apps/*` before `packages/*`.
- `tsconfig.json` — build and typecheck configuration.
- `src/main.ts` — process entry point: boot order, `startDaemon`, `runMain`, `daemon.json`.
- `src/config.ts` — `CB_*` loading, bind parsing, state paths, build info.
- `src/logger.ts` — structured JSON logger with key redaction and level filtering.
- `src/modules.ts` — `DaemonContext`, subsystem flags, module loading and shutdown hooks.
- `src/health.ts` — db, OpenCode, disk and queue probes behind `/v1/health`.
- `src/boot.ts` — boot reconciliation of orphaned runs and stale lock files.
- `src/static.ts` — static file resolution and SPA fallback for the built app.
- `src/app.ts` — Hono app: request id, request log, `/v1/health`, `/v1/version`, errors.
- `src/config.test.ts` — config loading, failure naming, bind parsing, paths, build info.
- `src/logger.test.ts` — level thresholds, redaction, error serialisation, log shape.
- `src/modules.test.ts` — subsystem list, shutdown order, module loading report.
- `src/health.test.ts` — status aggregation, disk thresholds, probes, parsed health body.
- `src/boot.test.ts` — orphaned run failure, event append, stale and malformed locks.
- `src/static.test.ts` — path resolution, traversal rejection, content types, SPA fallback.
- `src/app.test.ts` — the two public routes, request id, error envelope, static hosting.
- `src/start.test.ts` — config fail-fast, ephemeral bind, `daemon.json`, clean shutdown.

## Notes

- `createProbes` counts at most `PAGINATION_MAX_LIMIT` (200) queued runs for
  `health.queue.pending`, the contract's page limit; a larger queue reads as 200.
- No subsystem directory exists yet: an absent module is a supported boot state.
- The static route rejects a raw request target that carries a `..` segment, plain or
  percent-encoded, before node-server normalisation collapses it, so the SPA fallback never
  answers a traversal attempt with `index.html`. Only a real listener exposes that target; the
  Fetch API normalises before a `Request` exists.

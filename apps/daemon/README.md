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
- `src/push/index.ts` — the push subsystem module: one service, the four §5.7 routes and the
  pump.
- `src/push/service.ts` — the event-log pump, delivery, the preference and subscription APIs
  and the injected transports.
- `src/push/routes.ts` — the §5.7 notification handlers, their body schema and the `write`
  check.
- `src/push/ids.ts` — the only `sub_` subscription id generator.
- `src/push/errors.ts` — `PushError` and its reason-to-envelope mapping.
- `src/push/storage.ts` — the `notifications.preferences` and `push.subscriptions` settings
  rows.
- `src/push/mapping.ts` — the frozen event-to-notification table, the delivery key and the
  message text.
- `src/push/quiet-hours.ts` — the quiet-hours window in the configured time zone.
- `src/push/vapid.ts` — the ES256 VAPID JWT and the authorization header.
- `src/push/rfc8291.ts` — the `aes128gcm` payload encryption.
- `src/push/transport.ts` — the transport port and the `web` implementation over `fetch`.
- `src/push/ids.test.ts` — id shapes, uniqueness and pinned bytes.
- `src/push/storage.test.ts` — defaults, round-trips, malformed rows and removal.
- `src/push/mapping.test.ts` — the mapping table, the preference gate and the message text.
- `src/push/quiet-hours.test.ts` — wrapping and same-day windows, zones and unusable input.
- `src/push/vapid.test.ts` — JWT claims, ES256 verification and key refusal.
- `src/push/rfc8291.test.ts` — header layout and an independent decrypt of the body.
- `src/push/transport.test.ts` — request headers, encryption round-trip and status mapping.
- `src/push/service.test.ts` — dedupe, pruning, preferences, quiet hours and unconfigured mode.
- `src/push/routes.test.ts` — the §5.7 HTTP contract: bodies, scopes, envelopes, silent logs.
- `src/push/index.test.ts` — the module seam and the pump timer.
- `src/events/index.ts` — the SSE subsystem module: one bridge and one connection limiter.
- `src/events/bridge.ts` — read-after-id replay, gap detection, filters, heartbeat, hard close.
- `src/events/frames.ts` — the `text/event-stream` framing, pure and clock-free.
- `src/events/notifier.ts` — the in-process wake-up shared by event appends and open streams.
- `src/events/limits.ts` — the per-device connection limiter.
- `src/events/routes.ts` — the `GET /v1/events` handler and its query schema.
- `src/events/bridge.test.ts` — replay, gaps, filters, heartbeat and the terminal close.
- `src/events/frames.test.ts` — frame format and one-line payloads.
- `src/events/limits.test.ts` — the three-connection limit and slot release.
- `src/events/routes.test.ts` — the stream over HTTP: headers, filters, 429 and validation.
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
- `src/schedules/index.ts` — the schedules subsystem module: the service, the routes and the
  tick.
- `src/schedules/service.ts` — list, create, patch and pause, and the one-pass tick.
- `src/schedules/routes.ts` — the `/v1/schedules` handlers and their body schemas.
- `src/schedules/fire.ts` — the default port: a run for a repo schedule, a chat turn otherwise.
- `src/schedules/service.test.ts` — the service and its one-pass tick.
- `src/schedules/routes.test.ts` — the `/v1/schedules` handlers.
- `src/schedules/fire.test.ts` — the default fire port.
- `src/credentials/index.ts` — the credentials subsystem module: builds the vault, mounts the
  credential and integration routes, warns once when the store has no master key.
- `src/credentials/ids.ts` — the only `cred_` and `int_` id generators.
- `src/credentials/schemas.ts` — the zod boundary for credentials, integrations and the
  GitHub manifest code exchange.
- `src/credentials/storage.ts` — the write-only credential store: 0700/0600, `*.tmp` + rename,
  metadata only.
- `src/credentials/service.ts` — sealing, rotation, last-four reporting and the integration
  service seam.
- `src/credentials/manifest.ts` — the single-use, 600 s GitHub manifest state store.
- `src/credentials/routes.ts` — the four `/v1/credentials` handlers and their scopes.
- `src/credentials/ids.test.ts` — id shapes, uniqueness and injectable randomness.
- `src/credentials/storage.test.ts` — file modes, atomic writes, traversal refusal and
  malformed documents.
- `src/credentials/service.test.ts` — sealing, rotation, env exposure, unconfigured mode and a
  metadata-only list that opens no seal.
- `src/credentials/manifest.test.ts` — single use and the 600 s expiry.
- `src/credentials/routes.test.ts` — the ten-route contract: bodies, scopes, refusals and the
  no-value walk.
- `src/credentials/index.test.ts` — the module seam and the unconfigured warning.
- `src/providers/index.ts` — the providers subsystem module: seeds the catalog, builds one
  service per context, mounts the seven §5.9.1 routes.
- `src/providers/service.ts` — account CRUD, the turn handle, the failure recording, the reset
  sweep and the OAuth state machine.
- `src/providers/routes.ts` — the `docs/api.md` §5.9.1 handlers, their `admin` checks and bodies.
- `src/providers/schemas.ts` — the zod boundary for the account, patch and OAuth bodies.
- `src/providers/errors.ts` — `PROVIDER_EXHAUSTED`, `ProviderExhaustedError` and its one 503
  mapping.
- `src/providers/oauth.ts` — the OAuth adapter port, the empty default set and the sealed token
  envelope.
- `src/providers/credentials.ts` — the write-only credential port: one `model_key` credential
  per account, never its value.
- `src/providers/catalog.ts` — the three known adapters and the idempotent seed.
- `src/providers/ids.ts` — the only `acct_` account id and OAuth state generators.
- `src/providers/service.test.ts` — sealing, selection, failure recording, the reset sweep and
  `testAccount` against an in-memory store and an injected clock.
- `src/providers/routes.test.ts` — the §5.9.1 HTTP contract: bodies, refusals, scopes and
  redacted logs.
- `src/providers/errors.test.ts` — the exhaustion error and its 503 mapping.
- `src/providers/oauth.test.ts` — the token envelope, the single-use state, its 600 s expiry and
  the exchange.
- `src/providers/credentials.test.ts` — the `model_key` credential, the last four and removal.
- `src/providers/catalog.test.ts` — the three seeded rows, idempotence and catalog order.
- `src/providers/ids.test.ts` — id shapes, uniqueness and injectable randomness.
- `src/providers/index.test.ts` — the module seam and the one service per context.
- `src/integrations/service.ts` — the allowlist-first outbound request and the GitHub manifest
  exchange.
- `src/integrations/routes.ts` — the six integration handlers.
- `src/integrations/storage.ts` — the integration file store beside the sealed credentials.
- `src/design/index.ts` — the design subsystem module: one service, the `GET /v1/repos/{id}/design` route and no timer.
- `src/design/service.ts` — the bare-clone read: the revision resolution, the three document kinds and the absent-path rule.
- `src/design/preview.ts` — the pure projection: tokens, routes, each screen's declared states and `checkDocuments`' findings.
- `src/design/routes.ts` — the §5.2 handler, its query schema and its 422/503 mapping.
- `src/design/preview.test.ts` — `present: false`, the three sortings, the findings order and each document that does not parse.
- `src/design/service.test.ts` — the revision resolution, the absent rule for `show` and `ls-tree` and the two error classes.
- `src/design/routes.test.ts` — the §5.2 HTTP contract: the projection, the refusals, the missing token and the redacted warnings.
- `src/repos/index.ts` — the `repos` subsystem module: one shared service, the six §5.2 routes and no timer.
- `src/repos/service.ts` — the cursor list, the detail with its last run, the create defaults, the four-key patch, the two delete refusals and the verify composition.
- `src/repos/routes.ts` — the §5.2 repository handlers, their body and query schemas and their scopes.
- `src/repos/ids.ts` — the only `repo_` id generator.
- `src/repos/service.test.ts` — the defaults, the id shape, the 404s, the delete refusals, the paging and the verify checks.
- `src/repos/routes.test.ts` — the §5.2 HTTP contract: statuses, counts, scopes, envelopes and the verify 503.
- `src/works/index.ts` — the `works` subsystem module: one shared service, the routes, no timer.
- `src/works/service.ts` — list, create from a ref, detail with its repository and runs, the refusals, the attempt that opens a run, the decision session, the review stamp, the interrupt and the manual *Run next* selection.
- `src/works/routes.ts` — the `docs/api.md` §5.6 handlers, their body and query schemas and their scopes.
- `src/works/ids.ts` — the only `wrk_` id generator.
- `src/works/routes.test.ts` — creating from the file, the ref refusals, `spec_in_git`, `live_work`, the run link, `already_reviewed`, `no_live_run`, the decision session and the empty backlog.
- `src/backlog/index.ts` — the `backlog` subsystem module: one shared service, the route, no timer.
- `src/backlog/service.ts` — the bare-clone read, the projection joined with works and `needs`, the ref resolution, the selection feed and the worktree tick.
- `src/backlog/select.ts` — the `BacklogWorkState[]` feed: the repository's works, paged until exhausted.
- `src/backlog/routes.ts` — `GET /v1/repos/{id}/backlog`, its `read` scope and the unknown-repository 404.
- `src/backlog/service.test.ts` — projection counts against the package fixture, the projected `needs`, ref refusals, run counts and the byte-exact tick.
- `src/backlog/routes.test.ts` — the HTTP object, the empty projection and the 404 envelope.
- `src/sessions/index.ts` — the `sessions` subsystem module: one shared service, the routes, no timer.
- `src/sessions/service.ts` — the create/prepare, the awaited agent turn, the proposal diff and its merge, compact, interrupt and archive, plus `TARGET_WRITE_SETS` and `outsideTarget`.
- `src/sessions/routes.ts` — the `docs/api.md` §5.6.1 handlers, their body and query schemas and their scopes.
- `src/sessions/ids.ts` — the only `sess_` and `msg_` id generators.
- `src/sessions/errors.ts` — the session refusals mapped onto the §3 envelope and its reason tokens.
- `src/sessions/sessions.test.ts` — the four `outsideTarget` cases, the `workId` invariant, `read_only_session`, `target_violation` without a push, `proposal_pending`, `proposal_none`, a merge and one turn.
- `src/admin/index.ts` — the `admin` subsystem module: one settings service, the four routes, no timer.
- `src/admin/service.ts` — the effective settings, the one writable key, the brake row and the cache wipe over `WorkspaceManager.listWorktrees`/`removeWorktree`.
- `src/admin/routes.ts` — `GET`/`PATCH /v1/settings` and the two `/v1/admin` handlers with their scopes and the one-key patch schema.
- `src/admin/service.test.ts` — the defaults, the stored overrides, the live `automerge` getter and the terminal/live/orphan wipe cases.
- `src/admin/routes.test.ts` — the four statuses, the `write`/`admin` split, the unknown-key `422` and the `202` with no body.
- `src/settings/effective.ts` — `effectiveSettings` and `effectiveAutomerge`: the stored rows over the `CB_*` defaults and the quiet-hours read.
- `src/settings/effective.test.ts` — the config defaults, the stored overrides and the two malformed-row fallbacks.
- `src/integrations/service.test.ts` — allowlist refusal before `fetch`, header injection,
  truncation and the manifest flow.
- `src/config.test.ts` — config loading, failure naming, bind parsing, paths, build info.
- `src/logger.test.ts` — level thresholds, redaction, error serialisation, log shape.
- `src/modules.test.ts` — subsystem list, shutdown order, module loading report.
- `src/health.test.ts` — status aggregation, disk thresholds, probes, parsed health body.
- `src/boot.test.ts` — orphaned run failure, event append, stale and malformed locks.
- `src/static.test.ts` — path resolution, traversal rejection, content types, SPA fallback.
- `src/app.test.ts` — the two public routes, request id, error envelope, static hosting.
- `src/route-table.test.ts` — the mounted `/v1` table: no chat, routine or reminder route, and
  the retired tables are never written.
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

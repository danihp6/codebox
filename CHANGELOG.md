# Changelog

All notable changes to Codebox. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer once the
first release exists.

## Unreleased

### Changed — 2026-10-27 (issue #19, the app file map and the feature-local dictionaries)

- `apps/app/README.md` maps every file under `src/app` again: the five shipped feature folders
  (dashboard, repos, chat, jobs, runs-list) replace their placeholder lines, and the
  `readme.spec.ts` guard fails when a file is missing from the map or the map names a file that
  no longer exists.
- `docs/app.md` §3 and §9 record the localisation convention: `src/assets/i18n/{en,es}.json`
  holds the shell keys, and each feature folder ships its own `i18n.ts` with both locales and a
  parity spec. The shared dictionaries stop being treated as debt.

### Added — 2026-10-26 (Task-46, the measured AWS spot bring-up runbook)

- `infra/aws/terraform.tfvars.example` carries the twelve module variables with safe
  placeholders only (`203.0.113.7/32`, `operator@example.com`, an empty `ami_id`); the applied
  `terraform.tfvars` stays ignored and is never committed.
- `docs/operations.md` §14 is the end-to-end runbook: L3 preconditions, `terraform apply`, the
  four secret bundles delivered over SSM and never in user-data or a var-file, first boot, the
  tunnel hostname and pairing, the newest dump restored after a destroy, three repositories at
  once under `CB_MAX_CONCURRENCY=3` with Playwright, teardown and rebuild from zero, and the
  four measurements with their bounds.
- `docs/aws.md` §10.1 reserves the measured-cost row with `—` cells: no figure is written
  before the operator measures it.
- `[live]` — the boot time, the three concurrent runs, the restore across a rebuild and the
  spot cost — is not measured on CI (no AWS account, no `terraform`); an `agent-review` issue
  carries it.

### Changed — 2026-10-26 (Task-45, one image, two hosts: D42)

- The docs say what is true: the Packer image is provider-neutral Ubuntu 24.04 arm64, the
  builder (`oracle-oci` or `amazon-ebs`) and the secret source are per host, and both hosts are
  Terraform stacks under `infra/{oci,aws}` with OCI as the primary target and the AWS spot box
  while A1 capacity is pending.
- **D42** records the decision; D20 (secrets) and D21 (image builder) are amended in place
  without renumbering. The D40/D41 IDs stay with their own decisions.
- `docs/vm-image.md`, `docs/security.md`, `docs/architecture.md`, `docs/operations.md`,
  `docs/roadmap.md`, `AGENTS.md` and `README.md` drop the "OCI-only" claims, name the host on
  every remaining host-specific line, and point at `docs/oci.md` and `docs/aws.md` for the
  per-host detail. The roadmap stops claiming that a prompt routine spends the daily cap.

### Added — 2026-10-26 (Task-36, routines UI)

- `/jobs` gains an in-page **Routines** tab: kind and cost label, the cron summarised in the
  routine's own timezone, next and last fire, pause/resume (optimistic with rollback), run now,
  an editor sheet for title, schedule, timezone, notify and — for a prompt routine only — the
  prompt, and a delete that arms a confirmation before sending anything. No new route.
- The chat screen renders a confirmation card when the agent creates a routine through
  `routine.create`: kind, the cron's local time and the next fire, corroborated from
  `GET /v1/routines?limit=10` inside a 120 s window because the tool frame carries no result.
  A message a routine produced carries the `routine` badge and a link to the list, taken from
  the `routine.replied` frame.
- The routines tab refetches on activation and on every `routine.fired`, `routine.replied` or
  `routine.failed` frame; the jobs and chat dictionaries gain their new en/es strings.
- `[live]` — a routine created in a real chat on the VM appearing in the list without a reload
  and its push arriving on the phone — is not measured on CI; an `agent-review` issue carries
  it.

### Added — 2026-10-26 (Task-38, the routine tool, chat sessions only)

- A daemon-owned loopback MCP server (`apps/daemon/src/chat/tools`) serves `routine.create`,
  `routine.list` and `routine.pause` over JSON-RPC 2.0 on `127.0.0.1:<ephemeral>`, one random
  bearer token per chat session. The token — never the model's arguments — supplies the chat
  and its repository, so `repoId` and `chatSessionId` cannot be spoofed; a prompt routine
  created from a chat is bound to that chat. `routine.create` computes `nextFireAt` with the
  same cron arithmetic as a job and writes nothing on a bad cron or timezone.
- The `mcp` descriptor travels only in a **chat** session create body:
  `CreateSessionInput` gained an optional `mcp` map and the wrapper forwards it verbatim. The
  run engine is untouched and sends no descriptor.
- `packages/core` classifies `routine.create/list/pause` as the new `routine` tool class: D27
  allows it in chat and **denies it in run**, even if a descriptor ever leaked.
- D41 records the mechanism and the boundary; `docs/agent-runtime.md` §2/§3/§6 and
  `docs/security.md` §6 describe the server, the per-chat token and the chat-only mount.
- `[live]` — a routine created from a real chat appears in `GET /v1/routines` and fires — is
  measured on the VM; an `agent-review` issue carries it.

### Changed — 2026-10-26 (Task-44, concurrency three)

- `CB_MAX_CONCURRENCY` defaults to 3 (per repository stays 1) and both keys reject 0 with a
  `ContractParseError` at boot; the count of config keys is unchanged.
- `canAdmitRun` in `@codebox/core` is the pure admission rule (`repo_busy` before
  `slots_full`); `planAdmission` in `@codebox/scheduler` orders the waiting list by repository,
  then `created_at`, then run id. The run engine consults them on start and on every
  completion, so the fourth run stays `queued` (never `failed`), a freed slot goes to the
  first waiting run whose repository is free, and a waiting run is cancellable.
- D15, the `docs/jobs.md` concurrency bullet and the `docs/providers.md` rows carry the new
  numbers; the daemon now links `@codebox/scheduler`.
- `[live]` — three real repositories with Playwright at once and no out-of-memory kill — is
  measured on the spot box; an `agent-review` issue carries it.

### Added — 2026-10-26 (Task-43, durable backups off the host)

- `backup.sh --upload` PUTs the age-encrypted dump to any S3-compatible target named by
  `CB_BACKUP_S3_URI` — SigV4 with the instance profile or explicit credentials — writes and
  verifies `<archive>.sha256`, keeps the 30 newest daily objects and a `_latest` pointer;
  `restore.sh --latest` and `--remote` read the same target. A missing target exits 2 and
  keeps the local archive.
- `codebox-spot-notice.service` and `spot-notice.sh` poll the two-minute interruption notice
  and run exactly one final backup (flock plus a per-notice marker); `60-service.sh` and the
  Packer template install the pair, so the image ships eight units.
- `CB_BACKUP_BUCKET` retires in favour of `CB_BACKUP_S3_URI`, `CB_BACKUP_S3_ENDPOINT` and
  `CB_BACKUP_S3_REGION`, documented as host drop-in variables in `ops/vm/README.md`.
- `[live]` — a simulated interruption that leaves a restorable dump on a scratch host — is
  measured on the box; an `agent-review` issue carries it.

### Changed — 2026-10-26 (Task-47, `infra/oci` Terraform module)

- `infra/oci` owns the static OCI footprint: `cb-vcn`, the IGW, `cb-rt`, an SSH-only `/32`
  security list, `cb-subnet`, `cb-instance-dg`, `cb-ci-policy`, `cb-instance-policy`,
  `cb-vault` with its four secret placeholders and `cb-backups` with its 30-day lifecycle.
- The instance stays out on purpose: `ops/oci/launch.sh` keeps the capacity wait and reads the
  module's `subnet_id`. `provision.sh` and its shell test retire.
- State is remote in `cb-backups` over the S3-compatible endpoint with native locking; the
  `cb-ci` policy gains only the two object statements that state needs.
- `docs/oci.md` §2/§3/§7/§8/§9/§10 and `ops/oci/{README,policy}.md` describe Terraform;
  `AGENTS.md` layout names both `infra/` modules.
- `[live]` — a no-drift `plan`, a `destroy` that keeps the bucket and the image, and a rebuild
  — is measured on the tenancy; an `agent-review` issue carries it.

### Added — 2026-10-26 (Task-42, `infra/aws` Terraform stack)

- `infra/aws` creates the spot host: VPC, public subnet, IGW, a security group that admits SSH
  only from the admin `/32` and nothing on 80/443, a `c7g.2xlarge` spot instance with IMDSv2
  and a 100 GB gp3 volume, an instance profile granting SSM and the backup bucket only, the
  versioned and SSE-encrypted `cb-backups` bucket with a 30-day lifecycle, and a monthly
  budget alarm.
- State is S3 with native locking; `bootstrap/` creates the bucket first. `ami_id` defaults to
  the Canonical Ubuntu 24.04 arm64 lookup so the stack applies before the Codebox image.
- `terraform test` with a mocked `aws` provider proves the invariants offline; `docs/aws.md`
  documents the stack and joins the documentation index.
- `[live]` — one `apply`/`destroy` on the L3 account — is measured there only; an
  `agent-review` issue carries it.

### Added — 2026-10-26 (Task-41, browser in the image)

- `ops/image/scripts/45-browser.sh` installs Playwright's pinned Chromium (1.64.1) with its
  apt dependencies under `/opt/ms-playwright`, readable by `codebox`, with no run-time
  download and nothing left under `/root/.cache`.
- `90-verify.sh` gains a `browser` check — the installed revision, an `ldd`-clean binary and
  one bounded headless launch — so a broken browser fails the build, not the first run.
- `ops/vm/test/verify.test.mjs` covers the missing-browser, live-stub and failed-launch
  paths against a stub root.
- `[live]` — `90-verify.sh --only browser` plus an offline `npx playwright test` on the built
  image — is measured on the box; an `agent-review` issue carries it.

### Added — 2026-10-26 (Task-40, second builder: AWS)

- The Packer template gains an `amazon-ebs` source beside `oracle-oci` in one build block, so
  the eight shared provisioners bake the same Ubuntu 24.04 arm64 image on either host;
  `packer build -only` selects the host.
- Region, subnet, base AMI, build instance type and name/tag come from `aws_*` variables with
  dummies in `example.pkrvars.hcl`; the template carries no credential.
- Build steps are discovered lexicographically from `scripts/*.sh`, so a new numbered step
  needs no template edit.
- `[live]` — an AMI whose `/etc/codebox/image.json` matches the OCI image from the same commit
  — is measured on a built image only; an `agent-review` issue carries it.

### Added — 2026-10-26 (Task-35, routine fire engine and `/v1/routines`)

- The routine tick claims `(routine_id, scheduled_for)` transactionally and applies D13: a
  `reminder` pushes and stops, a `prompt` appends an `origin: routine` message to its chat
  (creating one when it has none or the old one was archived), streams the reply and pushes one
  summary at the end.
- `GET`, `PATCH`, `DELETE` and the pause/resume/run-now routes are mounted; `POST /v1/routines`
  stays with Task-38's chat tool, and a fire never creates a run, a gate or a PR.
- The store's SSE event names learn the three `routine.*` events, without which a fire cannot
  be read back.
- `[live]` — a seeded routine firing and answering in its session on the VM — is not measured
  on CI; an `agent-review` issue carries it.

### Added — 2026-10-26 (Task-28, security hardening)

- The gate scans the added lines of every diff for nine secret patterns before anything is
  pushed, fails closed when git cannot produce the diff, and never logs the match or the diff.
- Request security: the four security headers on every response, an origin allowlist for the
  app, a 1 MiB body cap rejected before parsing, and per-device rate limits (`POST /v1/runs`
  at 10/min, the rest at 120/min).
- The three systemd units gain the documented sandboxing without `MemoryDenyWriteExecute`; the
  redaction corpus pins 30 fixtures with no literal leaking; D40 records the origin allowlist.
- `[live]` — the `systemd-analyze security` score and the tunnel origin check — is measured on
  the VM only; an `agent-review` issue carries it.

### Added — 2026-10-26 (Task-27, observability and cost)

- `GET /v1/telemetry` serves `1h`/`24h`/`7d`/`30d` windows: spend from the usage ledger, run
  counts by state, disk and queue depth from the probes that already answer `/v1/health`.
- The retention pass deletes terminal runs, expired events, archived chats, resolved approvals
  and their log directories at the documented ages, in one report per pass.
- `packages/core` gains the pure usage window and daily aggregation; `packages/store` gains
  windowed run counts and forward-only pruning with no migration.
- `[live]` — today's spend matching the dashboard within 5 % — is measured on the VM only; an
  `agent-review` issue carries it.

### Added — 2026-10-26 (Task-23, settings, devices and notifications)

- `/settings` becomes the operator's own screen: account time zone, push preferences per event
  with optimistic toggles and rollback, provider status, the danger zone (brake, cache wipe)
  and an explicit `unavailable` block for every resource whose daemon route this build does not
  have.
- `/settings/devices` lists paired devices with their scopes, marks the current one and revokes
  a device; revoking the current device clears the secure store and logs out locally.
- `[live]` — a preference change visible in the next push — is not measured on CI; an
  `agent-review` issue carries the measurement.

### Added — 2026-10-26 (Task-39, provider-neutral first boot)

- `ops/vm/cloud-init.sh` reads the four secret bundles from `CB_SECRETS_FILE`
  (`/etc/codebox/secret-bundles.json`, `0600`, written by the operator) when it exists and from
  OCI Vault through the instance principal otherwise; a missing key is exit 2 with step
  `secrets` and no `instance.env` written, and the file source needs neither `oci` nor a Vault
  region.
- The hostname comes from `--instance-id`, `CB_INSTANCE_ID` or the metadata service — the OCI
  bearer probe first, then the AWS IMDSv2 handshake — so the same image names itself on a host
  with no OCI grant.
- The file source, the missing key, `CB_INSTANCE_ID` and the IMDSv2 probe have their own cases
  beside the Vault ones; the second-boot idempotency and no-echo assertions still hold.

### Changed — 2026-10-26 (roadmap, host track)

- `TODO.md` gains Batches 10–14 (Tasks 39–47): Terraform stacks under `infra/oci` and
  `infra/aws`, provider-neutral image, S3 backups, concurrency three, host-neutral docs and the
  measured bring-up. The host track is pulled ahead of Batches 7–9, because OCI capacity has no
  date and the box cannot be deployed until it lands; Terraform runs first so the OCI footprint
  can be created and destroyed while the wait is open.

### Added — 2026-10-25 (Task-37, instance liveness)

- `ops/vm/keepalive.sh` samples `/proc` twice a second apart, appends one JSON line to
  `/var/lib/codebox/logs/keepalive.jsonl` and then runs a bounded pass (`cb doctor`, `cb prune`,
  a loopback `GET /v1/health`) in which every step is optional and a missing CLI or a stopped
  daemon is `skipped`, never a failure; no synthetic load, per D39.
- `codebox-keepalive.service` and `.timer` run it every six hours with `Persistent=true`, and
  `60-service.sh` installs and enables both beside the backup pair; the Packer template uploads
  the new files.
- `[live]` — 28 lines after seven days and no reclamation warning in the OCI console — needs a
  human at the console; an `agent-review` issue carries the measurement and it is not reported
  as passing.

### Added — 2026-10-25 (Task-21, jobs and runs list)

- `/jobs` lists jobs with their next fire, pauses and resumes optimistically, runs one now and
  creates a job through a cron picker with a timezone; `/jobs/:id` edits the same job, previews
  the next five fires in its own timezone and shows its recent runs; `/runs` lists runs with
  status chips and cost and pages with the API cursor.
- The cron parser, the human summary and the timezone formatter are pure functions with pinned
  tables; a paused job still offers run-now because the pause switch only stops the scheduler.
- The `[live]` criterion — a created job appears with its next fire in the selected timezone —
  is not measured on CI; an `agent-review` issue carries the measurement.

### Added — 2026-10-25 (Task-20, chat)

- `/chat` is a real session list grouped by repository with a repo filter and a new-chat
  action; `/chat/:id` is a streaming transcript with markdown and code blocks, tool cards,
  permission cards that disable after a reply, a composer that stays usable while the agent
  works, a stop button and "promote to run".
- Deltas append in order and a replay is a no-op, so a reconnect never duplicates a message;
  the stream state is a pure reducer with its own tests.
- The `[live]` criterion — a 200-token stream renders without layout jump while the composer
  stays usable — is not measured on CI; an `agent-review` issue carries the measurement.

### Added — 2026-10-25 (Task-19, dashboard and repos)

- `/dashboard` renders the VM, queue and spend health cards and the five most recent runs from
  the existing `ApiClient`, each read independent so one failure never blanks the others.
- `/repos` lists repositories and adds one through a wizard that validates `owner/name` before
  it sends anything, then shows the verification result without a reload; `/repos/:id` edits
  the gate and the protected paths and flips the policy optimistically with a rollback on error.
- The repos and telemetry reads live in feature-local `ReposApi`/`DashboardApi` modules because
  `core/api/api-client.ts` has no such methods; they collapse into `ApiClient` when a later
  task owns it.
- The `[live]` criterion — adding a repo shows its gate result without a reload — is not
  measured on CI and is blocked until a task ships `/v1/repos`; an `agent-review` issue carries
  the measurement.

### Added — 2026-10-25 (Task-22, run detail)

- `/runs/:id` is a real screen: the timeline replayed from `GET /v1/runs/{id}/events` and
  extended by the SSE stream with a key per event, so a reconnect never duplicates a row;
  the gate result, the eight contract guardrails rendered from `guardrailSchema.state` (never
  a string match), the blockers, the diff stat, the PR link, the merge result and the cost.
- Cancel asks first and then reflects the returned `cancelled` run; revert is offered only on
  a `succeeded` run that carries a PR, sends one `Idempotency-Key` and navigates to the new
  run. A `409 diff_unavailable` is a normal state, not an error.
- `ApiClient` gains `getRun`, `runEvents`, `runDiff`, `cancelRun` and `revertRun`, all parsed
  with the contract schemas, and a malformed body is an `ApiError` with code `contract`.
- The `[live]` criterion — a live timeline and the revert deep link on the VM — is not
  measured on CI; an `agent-review` issue carries its measurement.

### Added — 2026-10-25 (Task-16, notifications)

- `apps/daemon/src/push` is a full daemon subsystem: the four `docs/api.md` §5.7 routes —
  notification preferences, subscribe and unsubscribe — stored under two `settings` keys
  (no migration), parsed with the contract schemas and behind the `read`/`write` scopes.
- One finished run becomes **one** push per subscribed device: `run.merged` and
  `run.finished` share the `run:<id>` delivery key, and a `404`/`410` from the push service
  prunes exactly that subscription.
- VAPID `ES256` JWTs and the RFC 8291 `aes128gcm` payload are built with `node:crypto` only,
  so no dependency was added; without a VAPID pair the subsystem stays configured-off and
  every delivery counts as skipped, which leaves the daemon boot unchanged.
- Per-event preferences and quiet hours gate delivery, and a push held by quiet hours drains
  when the window closes.
- The `[live]` criterion — a real browser subscription receives the push and deep-links to
  the run — is not measured on CI; an `agent-review` issue carries its measurement.

### Added — 2026-10-25 (Task-18, app shell)

- `apps/app` is an Angular 22.2.3 + Ionic 9.0.9 + Capacitor 8.5.3 standalone, zoneless app:
  a tab shell, the theme tokens, every documented route declared lazily as a placeholder for
  Tasks 19–23, an EN/ES i18n scaffold, the manifest and a service worker.
- `core/api` is a typed client over the contract parsers; `core/events` is a fetch-based SSE
  client with exponential backoff, `Last-Event-ID` resume and gap handling; `core/auth` keeps
  the access token in a signal and the refresh token in a `SecureStore` port — nothing in
  `localStorage`.
- The app unit suite runs headless through `@angular/build:unit-test` with a 30 s budget, and
  the root gate builds the app too.

### Added — 2026-10-25 (Task-17, CLI)

- `cb` ships as `apps/daemon/bin/cb.mjs`: `pair`, `status`, `doctor`, `run`, `jobs`, `logs`,
  `events`, `brake`, `update`, `backup` and `revert`, a thin HTTP client over `/v1` with an
  injected transport and no import of the daemon's internals.
- `cb doctor` runs eight checks, prints one `ok`/`warn`/`fail`/`skip` line each and exits
  non-zero on a failure; exit codes `0`–`5` are frozen and `CODEBOX_URL`/`CODEBOX_TOKEN` are
  the client variables.
- No token is ever printed: every rendered value passes the redaction helper, and an error
  envelope that echoes a token is still safe.

### Added — 2026-10-25 (Task-15, jobs and runs API)

- `docs/api.md` §5.3–§5.5 are served: job CRUD with `nextFireAt` and a next-fire preview,
  run-now that the pause switch ignores, pause/resume, the runs list with stable cursor
  pagination, run detail, cancel, revert, JSON event replay, diff stat, and the approval
  inbox with `allow`/`deny` replies and expiry.
- The merged run engine is wired behind `src/runs/**` from its ports: one shared engine, one
  in-flight map and one cost budget for jobs and runs; a manual run writes the queued row and
  `run.queued` before `engine.start` adopts it.
- `Idempotency-Key` returns the first run for 24 h per device and rejects a different body
  with `409 idempotency_mismatch`; the store is in memory and resets on restart.
- `POST /v1/chat/sessions/{id}/promote` starts a run from the last assistant message.

### Added — 2026-10-25 (Task-13, chat API and event bridge)

- The daemon serves `docs/api.md` §5.6: create, list, get and archive a chat session bound to
  a repository, post a message, page the transcript oldest-first and interrupt the agent,
  behind the `chat` or `read` scope and parsed with the contract schemas.
- A chat pump maps OpenCode events into `chat.message`, `chat.delta`, `chat.tool`,
  `chat.permission` and `chat.idle` rows with a monotonic per-chat `seq`, redacts the tool
  input before it is stored, turns a permission request into exactly one approval row and
  delivers an answered approval back to OpenCode.
- `GET /v1/events` is the one SSE stream: exact `Last-Event-ID` replay, one `gap` frame on a
  pruned range, a 15 s heartbeat, additive `types`/`runId`/`chatId` filters, a terminal close
  for a run stream and three connections per device.
- Archiving keeps the worktree; a restart re-binds the session to a new OpenCode session in
  the same worktree.

### Added — 2026-10-25 (Task-14, run engine)

- `apps/daemon/src/run` executes one run end to end behind injected ports: bare clone,
  worktree, OpenCode session with the versioned envelope, gate, one daemon commit when the
  agent did not commit, push, PR with a generated body, required checks, the eight D12
  guardrails and a merge that is retried once and then parked in `pr_open`.
- Every state change goes through `transitionRun`; every event is persisted with a monotonic
  per-run `seq` and then emitted. The walk is proven on fakes —
  `queued → preparing → running → gating → pr_open → merging → succeeded` with exactly
  `run.queued, run.started, run.gate, run.pr, run.merged, run.finished`.
- A red gate pushes nothing, opens no PR and ends `failed` with `gate_failed`; a protected
  path, a moved base or a red check parks the run in `pr_open` with the contract blocker; a
  cancel interrupts the session and removes the worktree, and `merging` refuses one.
- The gate runner uses `/bin/bash -lc` in its own process group with a
  `PATH`/`HOME`/`TMPDIR` + `CI`/`NO_COLOR`/`CB_RUN_ID` allowlist, logs to
  `logs/run-<id>/gate.log`, keeps the last 100 lines and kills the group on timeout (exit
  124); the run timeout, the daily cost cap and one transport retry are enforced.
- `apps/daemon/package.json` declares `@codebox/{core,opencode,workspaces,git-provider}` and
  the lockfile records them; `run` and `gate` stay absent as daemon modules, so boot is
  unchanged until the jobs API wires the engine.

### Added — 2026-10-25 (Task-12, auth and pairing)

- The daemon pairs a device: `POST /v1/pair/code` (loopback source or an `admin` bearer)
  mints a one-time 10-character code with a 300 s TTL, stored only as a scrypt hash in
  memory; `POST /v1/pair` exchanges it for a device row, a 900 s access token and a 30-day
  refresh token. A used, expired or unknown code never pairs twice, even under two concurrent
  exchanges, and the 11th pairing request per source in an hour is `429` with `Retry-After`.
- Refresh tokens rotate on every use; the previous hash is kept only to detect replay, and a
  replay revokes the device. A revoked device fails every scope, `admin` included.
- One `/v1/*` middleware guards every route except health, version, pairing and the refresh
  exchange; `GET /v1/me`, `GET /v1/devices` (`read`), `DELETE /v1/devices/{id}` (`admin`) and
  `POST /v1/auth/logout` answer the documented bodies with strict schemas and the documented
  `401`/`403`/`404`/`422`/`429` envelopes.
- `apps/daemon/src/app.ts` hands an API path to the modules registered after the SPA catch-all,
  so a module route is reachable while an unmatched `/v1` path still ends in `not_found` and
  the traversal guard and `app_not_built` fallback are unchanged.

### Added — 2026-10-25 (Task-34, routine store and scheduler)

- Migration `0002_routines.sql` adds `routines` and `routine_fires` with the D38 kind CHECKs
  and `UNIQUE (routine_id, scheduled_for)` as the idempotency key; it is forward-only and
  `0001_init.sql` is untouched.
- `RoutineRepository` and `RoutineFireRepository` create, patch, pause, delete and list, and
  the claim transaction returns one winner across 20 concurrent handles, with `skip` recording
  a fire that was deliberately not sent.
- `planRoutineTick` and `nextRoutineFire` reuse the job clock: the next fire is computed in the
  IANA zone under the D13 grace and misfire rule, so the `Europe/Madrid` DST rows land on the
  documented instants and a fire outside the grace is skipped once and never retried.

### Added — 2026-10-25 (Task-25, VM image)

- A Packer template builds the Ubuntu 24.04 arm64 OCI image with Node 24, git, gh, opencode,
  cloudflared and the build tools; no secret is baked, and `90-verify.sh` fails the build when
  a token pattern appears under `/etc` or `/opt`.
- cloud-init renders `/etc/codebox/instance.env` from OCI Vault as `0600 root:codebox`, writes
  the tunnel credentials, starts the units and appends one `first-boot.jsonl` line; a second
  boot rewrites the same bytes and appends exactly one more line.
- `ops/vm/{install,upgrade,backup,restore}.sh` install a release atomically after a checksum
  check, roll back to `previous`, write the encrypted backup archive and restore it after
  verifying its row counts; the units run the daemon, OpenCode, cloudflared and the nightly
  backup.
- The `[live]` criterion (an instance boots, the tunnel answers `/v1/health`) is not measured
  here; an `agent-review` issue carries its measurement, as does `packer validate` against a
  real tenancy.

### Added — 2026-10-25 (Task-11, daemon skeleton)

- `@codebox/daemon` boots: every `CB_*` key is parsed and validated at the edge (a missing or
  short secret fails fast with the key name and no value echoed), a structured JSON logger
  redacts by key, SQLite comes from `@codebox/store`, and Hono serves `/v1/health`,
  `/v1/version`, the built app and a request id on every answer.
- Boot reconciliation marks a run left `running` as `failed` with `orphaned` exactly once,
  removes stale locks, writes `daemon.json` and drains the server on `SIGTERM` with exit `0`.
- The `DaemonModule` seam and the subsystem flags let Tasks 12–17 add modules without
  rewriting `main.ts`; the daemon's vitest project resolves `@codebox/*` from source, so
  `npm test` runs before `npm run build`.
- `hono` 4.13.13 and `@hono/node-server` 2.1.5 are pinned, and the raw request target is
  checked for dot segments so a traversal attempt cannot reach the SPA fallback.

### Added — 2026-10-25 (Task-10, GitHub provider)

- `@codebox/git-provider` implements the `GitProvider` port for GitHub: an App JWT from the
  private key, installation tokens cached until shortly before expiry and refreshed once on a
  401, repository verification, branch push with the credential only in the git argument, one
  PR per branch (a second push updates it), the required-check summary the guardrails read,
  merge with the documented 405/409/422 mapping, close, branch delete and a PAT fallback.
- Every failure is a typed `GitProviderError` mapped one-to-one to the contract error
  vocabulary; no raw GitHub body, URL, header or token can reach a message or a log.
- `startFakeGitHub` is a scriptable in-process REST surface, so the whole provider is proven
  offline; section 6 of `docs/jobs.md` is reconciled.
- The `[live]` criterion (real `verifyRepo`/`getChecks` against a scratch repository with a
  fine-grained PAT) is **not measured** here; an `agent-review` issue carries its measurement.

### Added — 2026-10-25 (Task-09, scheduler)

- `@codebox/scheduler` is the one seam the daemon ticks: `planTick` turns the due rows into an
  ordered claim plan with the D13 grace decision, recomputes the next fire from `now` (never
  from the missed schedule, so no catch-up storm) and persists one update per selected fire.
- `validateSchedule` and `planFires` back job create/edit and the next-fire preview;
  `planResume`/`planPause` keep a paused job invisible and recompute on resume; tick delay is
  epoch-aligned at 15–30 s.
- The cron arithmetic stays in `@codebox/core` as an injected `CronEngine`; the package holds
  no clock, timer, environment or I/O, and its table-driven tests pin the Madrid DST rows, the
  grace boundary, the claim key and total ordering. Section 2 of `docs/jobs.md` is reconciled.

### Added — 2026-10-25 (Task-08, workspaces)

- `@codebox/workspaces` owns the on-disk side of a run: a bare clone cache cloned atomically
  and fetched thereafter, one worktree per run on a `cb/<runId>-<slug>` branch, its run
  marker, and retention cleanup that never touches the cache or a directory it did not create.
- `status` returns the frozen `RunDiff` plus the changed paths and the D26 protected-path
  hits, with the recorded base sha kept distinct from the base tip the guardrails compare.
- Git runs through an injectable `GitRunner` and the D26 globs through an injected matcher, so
  the package is proven headless — including real-git tests against a temporary bare origin —
  and no clone URL, stderr or command line can reach an error message.
- The `[live]` criterion (a 100 MB repository clones once and reuses the cache in under 5 s on
  the VM) is **not measured** here; an `agent-review` issue carries its measurement.

### Added — 2026-10-25 (Task-07, OpenCode wrapper)

- `@codebox/opencode` is the only package that knows the OpenCode wire: a `fetch`-based
  `AgentRuntime` over the pinned V2 HTTP surface, a normaliser that emits contract SSE events
  (`run.*`/`chat.*`) with caller-owned `seq` and timestamps, and the run prompt envelope.
- The supervisor is policy with injected spawn, port probe, clock and sleep: it adopts an
  already-healthy server, restarts a dead child inside a bounded window and refuses a second
  listener on the port.
- `FakeOpenCode` is an in-process HTTP server that scores the client itself; five recorded
  fixtures pin the success, permission, interrupt, dropped-stream and crash timelines.

### Added — 2026-10-24 (Task-33, routine contracts)

- `Routine` is now a contract: a discriminated union on `kind` where a `prompt` requires a
  repo and a prompt while a `reminder` carries neither, with `rtn_` ids, the chat-tool input
  and output schemas, and the `/v1/routines` shapes.
- The `routine.fired`, `routine.replied` and `routine.failed` events join the frozen list
  (23 names), the OpenAPI document grows from 41 to 46 paths and both are checked against
  `docs/api.md` and `docs/decisions.md`.

### Added — 2026-10-24 (Task-06, security primitives)

- `@codebox/security` ships the pairing code (ten Crockford characters, single use, TTL,
  constant-time compare), scrypt hashing and device fingerprints, HMAC access tokens with
  scopes and a deterministic refresh-token hash for device lookup.
- `redact` walks a nested object on a new graph and never mutates its input, matching the
  documented key patterns; Cloudflare Access JWT verification returns a typed reason
  (`wrong_aud`, `expired`, `bad_signature`, `unsupported_alg`, `unknown_kid`, …).
- Argon2id is not a Node built-in and no dependency was added: the doc's "Argon2id or scrypt"
  is now scrypt for compared values and a keyed hash for looked-up values, written into
  `docs/security.md` §4.

### Added — 2026-10-24 (Task-05, core rules)

- `@codebox/core` holds the domain as pure functions: the run state machine with its legal
  transitions and cancellable states, and `evaluateAutoMerge` over the eight D12 guardrails in
  a fixed order with a typed blocker per red case.
- Cron parsing and next-fire in an IANA zone with the two DST rules, the D13 misfire decision,
  the D26 protected-path globs and the 41-file / 2 001-line diff budget.
- The D27 permission matrix (`allow`/`ask`/`deny`, fails closed outside the worktree) and the
  D29 cost/timeout checks; the clock is always an argument, so every rule is table-tested.

### Added — 2026-10-24 (Task-04, store)

- `@codebox/store` is the only SQL owner: `0001_init.sql` creates the ten tables and their
  named indexes in WAL mode with foreign keys enforced, and the runner is checksum-pinned,
  forward-only and one transaction per file.
- Repositories for repos, jobs, runs, events, approvals, chats, devices, settings and usage,
  an in-memory store for tests, stable cursor pagination and a `claimScheduledRun`
  transaction that returns one winner under concurrent attempts.
- Event replay is exact both by per-run `seq` and by the global `Last-Event-ID`, and a repo
  with a live run cannot be deleted.

### Added — 2026-10-24 (Task-24, reproducible OCI network)

- `ops/oci/provision.sh`: `--plan` prints every `cb-*` name, CIDR and ingress rule with no
  OCI call, `--apply` creates what is missing by name and `--destroy` tears the network down
  in reverse order while keeping `cb-boot` and the image; the tenancy is the only state.
- `ops/oci/policy.md`: the `cb-ci` / `cb-instance` grants verbatim from `docs/oci.md`, with
  the D20 rule that the instance holds no OCI API key.
- Nine fixture-driven shell tests (five `launch.sh` outcomes, four `provision.sh` contracts)
  under a new `ops` Vitest project, so `npm test` covers the retry loop.
- The `[live]` criterion (one dispatched `oci-retry` run finding the existing `cb-instance`)
  is **not measured** here; an `agent-review` issue carries its measurement.

### Added — 2026-10-24 (Task-03, contracts)

- `@codebox/contracts` is now the executable form of the API: zod schemas and inferred types
  for every resource (`Repo`, `Job`, `Run`, `Approval`, `ChatSession`, `Device`, `Telemetry`,
  health, settings, push), the error envelope with the documented status per code, pagination
  and idempotency, and one `parse*` helper per boundary that throws a path-carrying typed
  error.
- The 20 D14/D16 SSE event names and their strict `data` shapes, the two run/chat bases and
  the `gap` control frame; the event list cannot drift from the schema.
- The `CB_*` config schema for `docs/providers.md` §2–§11 with every documented default, the
  secret redaction list, and validation that never echoes a secret value.
- A generated OpenAPI 3.1 document (`buildOpenApiDocument`) whose 41 paths are checked against
  `docs/api.md`; `zod@4.6.7` is the only new dependency.

### Added — 2026-10-24 (OCI migration, pulled forward)

- `ops/oci/launch.sh`: the retry loop extracted from `pkm-randomlike`, with `CB_OCI_*`
  knobs, `cb-instance` as the idempotency key and a `--dry-run` check.
- `.github/workflows/oci-retry.yml`: the chained wait, the `CB_OCI_RETRY=off` brake, the
  `oci-ready` announcement and a 10-minute cron as the safety net.
- The `cb-*` network (`cb-vcn`, `cb-igw`, `cb-rt`, `cb-sl`, `cb-subnet`), the `cb-ci`
  identity and its API key in OCI; `danihp6/codebox` is public so the wait spends no
  Actions minutes.

### Added — 2026-10-24 (Task-02, agent pipeline)

- The deterministic core (`recon`, `gate`, `verdict`) with its unit tests, `opencode.json`
  wired to the four roles, the Actions host (`agent-cycle`, `agent-autopilot`, the timed
  window) and the VM host (`run-cycle`, `run-driver`, `brake`, `install.sh`,
  `cb-agent.service`).
- The smoke workflow is removed and `docs/agent-ci.md` no longer describes it.
- **Blocked:** the `[live]` criterion (one real cycle that moves `main` or opens an issue)
  needs `CB_AGENT_MODEL` and a provider key. Task-02 stays `[!]` until it is measured.

### Added — 2026-10-24 (Task-01, monorepo bootstrap)

- npm workspaces for `apps/daemon`, `apps/app` and the eight `packages/*` stubs, so every
  later batch has a home and one lockfile.
- Root scripts (`lint`, `test`, `build`, `typecheck`, `format`), `tsconfig.base.json`,
  ESLint + Prettier, the Vitest workspace, `.editorconfig` and `.gitignore`.
- Node 24 pinned in `engines`; the CI gate runs `npm ci && npm run lint && npm test &&
  npm run build` on every push to `main` and every pull request
  (`.github/workflows/ci.yml`).

### Added — 2026-10-24 (design batch)

The first delivery is documentation only. It fixes the name, the product, the architecture,
the contracts and the delivery plan before any code exists.

- Product definition, personas, flows, MVP scope, non-goals and success criteria
  (`docs/product.md`).
- Architecture: components, trust boundaries, data model, flows, deployment topology,
  failure modes and the deliberate non-goals (`docs/architecture.md`).
- Frozen decisions D1–D36 (`docs/decisions.md`).
- The hybrid app plan: Angular 22 + Ionic Angular 9 + Capacitor, screens, templates,
  offline, push, auth and release (`docs/app.md`).
- The versioned HTTP + SSE contract (`docs/api.md`).
- OpenCode V2 runtime integration, session model, permission policy and event normalisation
  (`docs/agent-runtime.md`).
- Job scheduling, run lifecycle, gate, PR and auto-merge guardrails (`docs/jobs.md`).
- The complete `CB_*` configuration and provider matrix (`docs/providers.md`).
- Threat model, controls and accepted risks (`docs/security.md`).
- The extracted OCI inventory, renamed resources and the reusable retry action
  (`docs/oci.md`).
- The Packer-based VM image, first boot, update and rollback (`docs/vm-image.md`).
- The operations runbook, backup/restore drill and incident playbooks
  (`docs/operations.md`).
- The adapted multi-agent batch pipeline, spec template and four role prompts
  (`docs/agent-pipeline.md`, `docs/agent-spec-template.md`, `.agent_roles/`).
- The GitHub Actions and VM hosts of the autopilot (`docs/agent-ci.md`,
  `docs/agent-vm.md`).
- Roadmap, open questions and the execution backlog (`docs/roadmap.md`,
  `docs/open-questions.md`, `TODO.md`).

### Changed

- D38: **two schedules, one clock.** Jobs stay repo transactions; **routines** are chat
  schedules (`prompt`/`reminder`) created by the chat agent through a daemon tool, fired by the
  same scheduler. A prompt routine with no session — or an archived one — gets a new chat on
  fire. Tasks 33–36 and the local L1/L2 items are in the backlog.
- D37: the source repository is **public**, so the OCI wait and the agent loop spend no
  Actions minutes. `docs/agent-ci.md` §8 and §11 now treat the private-plan allowance as a
  fallback for the day it goes private.
- `AGENTS.md` and `README.md` moved from *design only* to *bootstrap* after Task-01 merged.
- Task-24 and Task-32 re-scoped to what is actually left: Task-24 keeps the reproducible OCI
  part (`provision.sh`, `policy.md`, shell tests), Task-32 only deletes pkm's duplicate
  workflow and stale variables.
- D34 amended: the OCI retry moved out of `pkm-randomlike` before parity. That repository
  is braked (`OCI_RETRY=off`), its `pkm-vcn`/`pkm-subnet` are deleted, and its remaining OCI
  variables are stale by design; Task-32 is now only the cleanup.
- The project was renamed from the working title *Groundstation* to **Codebox** before the
  first commit: binary `codebox` with alias `cb`, daemon `cbd`, environment prefix `CB_`,
  OCI resources `cb-*`, branch prefix `cb/`. *Groundstation* was dropped because
  **AWS Ground Station** already owns the name.

### Fixed

- Nothing yet.

### Security

- No code, no running service, no credential in this repository. The security section
  describes the future controls; it does not claim they exist.

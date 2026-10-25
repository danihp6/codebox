# API

The daemon exposes one versioned HTTP + SSE contract under `/v1` (D16). The hybrid app and
the `cb` CLI are its only consumers; OpenCode and GitHub are never reached from the client.
`packages/contracts` is the executable form of this document — a payload that is not in the
schemas does not exist.

## 1. Rules

- **JSON only**, `Content-Type: application/json`, UTF-8. Timestamps are RFC 3339 in UTC
  (`2026-10-24T18:03:11Z`); durations are seconds unless the name says otherwise.
- **camelCase** fields; `id` prefixes are stable: `repo_`, `job_`, `run_`, `apv_`, `chat_`,
  `msg_`, `dev_`, `sub_`, `rtn_`.
- **Authentication** is a bearer access token on every route except `/v1/health`,
  `/v1/version` and `POST /v1/pair`.
- **No secret is ever returned.** Provider status is `configured` plus a last-four
  fingerprint, never a value.
- **A mutation that starts work is idempotent** by `Idempotency-Key` (D16), retained 24 h.
- **Unknown fields are rejected**, not ignored: a typo is a 422, not a silent default.
- **Breaking changes** bump the prefix (`/v2`); additive fields are allowed inside `/v1` and
  the app must ignore what it does not know.

## 2. Authentication and pairing

Device pairing (D17): `cb pair` on the VM prints a one-time code; the app exchanges it for a
device identity.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/pair/code` | loopback source, or an `admin` bearer | Issue a one-time code → `201`. |
| `POST` | `/v1/pair` | none, rate-limited | Exchange `{ code, deviceName, platform, devicePublicKey }`. |
| `POST` | `/v1/auth/refresh` | refresh token | Rotate: returns a new access **and** refresh token. |
| `POST` | `/v1/auth/logout` | bearer | Revokes the calling device's refresh token; `204`. |
| `GET` | `/v1/me` | bearer | `{ device, scopes, serverTime }`. |
| `GET` | `/v1/devices?limit=50&cursor=` | `read` | Paired devices, last seen, scopes. |
| `DELETE` | `/v1/devices/{id}` | `admin` | Revoke one device; its next request is a 401. |

`POST /v1/pair/code` serves a loopback source (`127.0.0.1`, `::1` or `::ffff:127.0.0.1`) and
any source that presents a bearer carrying `admin`; anything else is `403 forbidden` with
`details.reason = "loopback_required"`. The body is `{ "name", "ttlSeconds"?, "scopes"? }`:
`name` is 1–64 characters, `ttlSeconds` is an integer from 30 to 3600 and defaults to
`CB_PAIRING_TTL_SECONDS`, and `scopes` defaults to all five. It answers `201`:

```json
{
  "code": "7K3M9QXB2F",
  "expiresAt": "2026-10-25T00:05:00Z",
  "scopes": ["read", "chat", "runs", "write", "admin"],
  "name": "Dani iPhone"
}
```

The plaintext code is returned once; only its hash is kept, in memory, so a code is single use
and a daemon restart invalidates an unused one.

`POST /v1/pair` takes:

```json
{
  "code": "7K3M9QXB2F",
  "deviceName": "Dani iPhone",
  "platform": "ios",
  "devicePublicKey": "…"
}
```

`platform` is `ios`, `android`, `web` or `cli`. A used, expired or unknown code is
`401 unauthorized` with `details.reason` of `"used_code"`, `"expired_code"` or `"unknown_code"`,
and it never creates a device. A successful exchange returns:

```json
{
  "device": {
    "id": "dev_01JABCDEFGHJKMNPQRSV",
    "name": "Dani iPhone",
    "platform": "ios",
    "scopes": ["read", "chat", "runs", "write", "admin"],
    "createdAt": "2026-10-24T18:03:11Z",
    "lastSeenAt": null
  },
  "accessToken": "…",
  "refreshToken": "…",
  "expiresIn": 900,
  "scopes": ["read", "chat", "runs", "write", "admin"]
}
```

`POST /v1/auth/refresh` takes `{ "refreshToken": "…" }` and answers `200` with
`{ accessToken, refreshToken, expiresIn, scopes }`. The refresh token rotates on every use; the
previous one is kept only to detect replay, and presenting it revokes the device and answers
`401`.

Scopes: `read` (all GETs), `chat` (messages, interrupt), `runs` (create, cancel, revert, run
now), `write` (repos, jobs, settings, approval replies), `admin` (pairing codes, revoke other
devices, brake, cache wipe). The first device gets all of them; a narrower device is a
deliberate choice, not a default.

Access tokens live 900 s (`CB_ACCESS_TOKEN_TTL_SECONDS`); refresh tokens 30 days and rotate
on every use. A used refresh token is dead — replay is treated as theft and revokes the
device.

Pairing is rate limited: `POST /v1/pair` and `POST /v1/pair/code` share **10 requests per
rolling hour per source**. Over the limit the answer is `429 rate_limited` with
`Retry-After: <seconds>` and `details.retryAfter`.

## 3. Errors

Every non-2xx body is one shape:

```json
{
  "error": {
    "code": "protected_path",
    "message": "The diff touches ops/vm/install.sh.",
    "details": { "paths": ["ops/vm/install.sh"] },
    "requestId": "req_01J..."
  }
}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Malformed JSON or missing header. |
| 401 | `unauthorized` | Missing, expired or revoked token. |
| 403 | `forbidden` | Scope or loopback requirement not met. |
| 404 | `not_found` | Unknown id, or a resource outside the allowlist. |
| 409 | `conflict` | Illegal state transition (`run_not_cancellable`). |
| 409 | `idempotency_mismatch` | Same key, different body. |
| 422 | `validation_failed` | Schema failure; `details.path` names the field. |
| 422 | `repo_not_allowed` | Slug outside `CB_REPO_ALLOWLIST`. |
| 429 | `rate_limited` | `Retry-After` in seconds. |
| 502 | `agent_unavailable` | OpenCode is down or the stream cannot be re-established. |
| 503 | `provider_unavailable` | GitHub, push or tunnel dependency failed. |
| 500 | `internal` | A bug; `requestId` is the log key. |

A machine token that is not an HTTP class travels in `details.reason` — `run_not_cancellable`,
`approval_already_answered`, `repo_has_live_run` — while `code` stays one of the twelve values
above, so a client switch never grows with a domain refusal.

Domain refusals from the gate or the guardrails are **not** HTTP errors: a run that cannot
merge is a `200` with `run.state = "pr_open"` and `run.blockers[]`.

## 4. Pagination and idempotency

List routes take `?limit=50&cursor=<opaque>` (`limit` 1–200). The response is:

```json
{ "data": [ ], "nextCursor": "c_01J..." }
```

`nextCursor` is `null` on the last page. Cursors are stable under inserts: they encode
`(createdAt, id)`, not an offset.

`Idempotency-Key` is required on `POST /v1/runs`, `POST /v1/jobs/{id}/run` and
`POST /v1/chat/sessions/{id}/promote`. A replay returns the original `202` and the same
resource; the same key with a different body is `409 idempotency_mismatch`.

`limit` defaults to `50` and is an integer from `1` to `200`; the cursor is opaque, may be
absent and is returned as `null` on the last page. `Idempotency-Key` is 1–255 characters and is
retained for 24 h.

## 5. Resources

### 5.1 Health, version, telemetry

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| `GET` | `/v1/health` | none | `{ status, db, opencode, disk, queue, version }` — no secrets, no paths. |
| `GET` | `/v1/version` | none | `{ version, commit, builtAt, node }`. |
| `GET` | `/v1/telemetry?range=24h` | `read` | Spend, runs, failures, disk, queue depth. |
| `GET` | `/v1/providers` | `read` | Per provider: `configured`, `mode`, `lastOkAt`, `fingerprint`. |
| `POST` | `/v1/admin/brake` | `admin` | `{ enabled }` — the global auto-merge brake. |
| `POST` | `/v1/admin/cache/wipe` | `admin` | Removes finished worktrees; keeps the bare clones. |

`health.status` is `ok`, `degraded` or `down`. `degraded` means one dependency is missing
(for example no GitHub credential: chat works, git writes are disabled).

### 5.2 Repositories

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/repos` | `read` | Registered repositories. |
| `POST` | `/v1/repos` | `write` | `{ slug, defaultBranch?, gate?, policy?, protectedPaths? }`. |
| `GET` | `/v1/repos/{id}` | `read` | Repo, policy, last run, gate summary. |
| `PATCH` | `/v1/repos/{id}` | `write` | Gate, policy (`auto`/`manual`), protected paths, enabled. |
| `DELETE` | `/v1/repos/{id}` | `write` | 409 while a run is live. |
| `POST` | `/v1/repos/{id}/verify` | `write` | `{ ok, defaultBranch, canPush, checks }`. |

```json
{
  "id": "repo_01J...",
  "slug": "dani/example",
  "defaultBranch": "main",
  "gate": "npm ci && npm test && npm run build",
  "policy": "auto",
  "protectedPaths": [".github/**", "ops/**", "infra/**", "**/*.env"],
  "enabled": true,
  "createdAt": "2026-10-24T18:03:11Z"
}
```

### 5.3 Jobs

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/jobs?repoId=&enabled=` | `read` | List with `nextFireAt`. |
| `POST` | `/v1/jobs` | `write` | Create. |
| `GET` | `/v1/jobs/{id}` | `read` | Job, last runs, next fires. |
| `PATCH` | `/v1/jobs/{id}` | `write` | Partial update; a cron change recomputes the next fire. |
| `DELETE` | `/v1/jobs/{id}` | `write` | Keeps its runs. |
| `POST` | `/v1/jobs/{id}/run` | `runs` | Run now, ignored by the pause switch. |
| `POST` | `/v1/jobs/{id}/pause` | `write` | The scheduler stops selecting it. |
| `POST` | `/v1/jobs/{id}/resume` | `write` | Recomputes the next fire from now. |
| `GET` | `/v1/jobs/{id}/next?count=5` | `read` | Preview in the job's timezone. |

```json
{
  "id": "job_01J...",
  "repoId": "repo_01J...",
  "title": "Nightly lockfile",
  "prompt": "Update the lockfile, run the gate, fix what breaks.",
  "mode": "work",
  "agent": "build",
  "model": null,
  "cron": "0 3 * * *",
  "timezone": "Europe/Madrid",
  "enabled": true,
  "policy": "auto",
  "createdAt": "2026-10-24T18:03:11Z",
  "nextFireAt": "2026-10-25T01:00:00Z"
}
```

### 5.4 Runs

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/runs?repoId=&jobId=&state=&cursor=` | `read` | Newest first. |
| `POST` | `/v1/runs` | `runs` | `{ repoId, prompt, mode, agent?, model?, baseRef? }` → 202. |
| `GET` | `/v1/runs/{id}` | `read` | Full run: state, gate, PR, guardrails, cost. |
| `POST` | `/v1/runs/{id}/cancel` | `runs` | Kills the session, removes the worktree. |
| `POST` | `/v1/runs/{id}/revert` | `runs` | Opens a revert PR for the merge; returns a new run. |
| `GET` | `/v1/runs/{id}/events?after=&limit=` | `read` | Event replay (JSON, not SSE). |
| `GET` | `/v1/runs/{id}/diff` | `read` | Stat and changed files; the patch lives on GitHub. |

The run object is the contract every screen renders:

```json
{
  "id": "run_01J...",
  "repoId": "repo_01J...",
  "jobId": "job_01J...",
  "state": "pr_open",
  "trigger": "schedule",
  "branch": "cb/run_01J-nightly-lockfile",
  "baseRef": "main",
  "pr": { "number": 42, "url": "https://github.com/…", "mergeable": true },
  "gate": { "status": "passed", "exitCode": 0, "durationMs": 184000 },
  "guardrails": [
    { "id": "gate", "state": "pass" },
    { "id": "checks", "state": "pass" },
    { "id": "base", "state": "fail", "reason": "base_moved" }
  ],
  "blockers": [{ "code": "base_moved", "message": "main moved during the run." }],
  "diff": { "files": 6, "added": 184, "removed": 22 },
  "cost": { "usd": 0.42, "tokensIn": 18200, "tokensOut": 3100 },
  "createdAt": "2026-10-24T18:03:11Z",
  "finishedAt": null
}
```

`state` is exactly D14: `queued`, `preparing`, `running`, `gating`, `pr_open`, `merging`,
`succeeded`, `failed`, `cancelled`.

`cancel` is legal in `queued`, `preparing`, `running` and `gating`; in `merging` it is a 409
(the merge is atomic) and the recovering action is `revert`.

### 5.5 Approvals

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/approvals?state=pending` | `read` | The inbox. |
| `GET` | `/v1/approvals/{id}` | `read` | One request with its redacted tool input. |
| `POST` | `/v1/approvals/{id}/reply` | `write` | `{ decision: "allow" \| "deny", scope: "once" \| "session" }`. |

An approval not answered within `CB_APPROVAL_TTL_SECONDS` is rejected and marked `expired`.
Replying twice is a 409; the second reply never reaches OpenCode.

### 5.6 Chat

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/chat/sessions?repoId=` | `read` | Sessions, newest activity first. |
| `POST` | `/v1/chat/sessions` | `chat` | `{ repoId, title? }` — creates the worktree and the OpenCode session. |
| `GET` | `/v1/chat/sessions/{id}` | `read` | Session, repo, status (`idle`/`working`), last message. |
| `DELETE` | `/v1/chat/sessions/{id}` | `chat` | Archives it; the worktree is kept per retention. |
| `GET` | `/v1/chat/sessions/{id}/messages?cursor=` | `read` | Oldest first, paginated. |
| `POST` | `/v1/chat/sessions/{id}/messages` | `chat` | `{ text }` → 202; the reply arrives as events. |
| `POST` | `/v1/chat/sessions/{id}/interrupt` | `chat` | Stops the agent; the session returns to `idle`. |
| `POST` | `/v1/chat/sessions/{id}/promote` | `runs` | `{ title? }` → a run in the same worktree. |

### 5.7 Settings and push

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/settings` | `read` | Non-secret settings and their defaults. |
| `PATCH` | `/v1/settings` | `write` | Only keys listed in the schema. |
| `GET` | `/v1/notifications/preferences` | `read` | Per-event subscriptions and quiet hours. |
| `PATCH` | `/v1/notifications/preferences` | `write` | Same shape. |
| `POST` | `/v1/push/subscriptions` | `write` | `{ kind: "web" \| "fcm" \| "apns", endpoint, keys }`. |
| `DELETE` | `/v1/push/subscriptions/{id}` | `write` | Unsubscribe. |

### 5.8 Routines

A routine is a chat schedule (D38), not a run: it never opens a worktree, a PR or a merge. The
chat agent creates one through the `routine.create` tool; the routes below list, edit, pause,
run now and delete. `reminder` pushes its `title` without a model; `prompt` sends its prompt to
the chat and streams the answer (D36, [`docs/jobs.md`](jobs.md) §15).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/routines` | `read` | Chat schedules, newest first. |
| `POST` | `/v1/routines` | `write` | Create a routine; the chat tool is the normal path. |
| `GET` | `/v1/routines/{id}` | `read` | One routine with its next and last fire. |
| `PATCH` | `/v1/routines/{id}` | `write` | Title, cron, timezone, prompt, notify or enabled. |
| `DELETE` | `/v1/routines/{id}` | `write` | Delete a routine and stop its schedule. |
| `POST` | `/v1/routines/{id}/pause` | `write` | The scheduler stops selecting it. |
| `POST` | `/v1/routines/{id}/resume` | `write` | Recompute the next fire from now. |
| `POST` | `/v1/routines/{id}/run` | `runs` | Fire it once now, outside the schedule. |

- A `prompt` routine **requires** `repoId` and a non-empty `prompt`; `chatSessionId` is a
  `chat_` id or `null`, and `null` means the daemon creates a chat session on the fire.
- A `reminder` routine carries **no** `repoId`, `prompt` or `chatSessionId`: it costs no tokens
  and has no session, and a kind-mismatched field is a 422 like any unknown field.
- `title` (1–120 chars) is the label and the text a reminder pushes. `notify` is the per-routine
  push switch and `enabled` the pause switch; `nextFireAt` and `lastFiredAt` are computed by the
  scheduler, never written by a client.

```json
{
  "id": "rtn_01J...",
  "kind": "prompt",
  "title": "Morning summary",
  "cron": "0 8 * * *",
  "timezone": "Europe/Madrid",
  "enabled": true,
  "notify": true,
  "repoId": "repo_01J...",
  "prompt": "Summarise the repository in five bullets.",
  "chatSessionId": null,
  "createdAt": "2026-10-24T18:03:11Z",
  "nextFireAt": "2026-10-25T07:00:00Z",
  "lastFiredAt": null
}
```

## 6. SSE

`GET /v1/events` is the only stream. Query filters (`types`, `runId`, `chatId`) are additive;
the default is everything the device may read.

```
GET /v1/events?types=run.output,run.gate,chat.delta
Accept: text/event-stream
Last-Event-ID: 1841
```

```
id: 1842
event: run.output
data: {"runId":"run_01J...","seq":17,"delta":"…","ts":"2026-10-24T18:04:02Z"}
```

- The SSE `id` is the **global** event sequence; `data.seq` is the per-run sequence. Replay
  from `Last-Event-ID` uses the global id and is exact within the retention window (D28).
- A heartbeat comment (`: ping`) is sent every 15 s; Cloudflare and mobile networks drop
  idle streams.
- `retry: 3000` is advisory; the client uses exponential backoff with jitter and resumes from
  the last id it processed, not from the last one it received.
- If the gap is larger than the retained window, the server sends `event: gap` once and the
  client refetches the resource instead of stitching a partial timeline.

Event types are the D14/D16 list: `run.queued`, `run.started`, `run.output`, `run.tool`,
`run.permission`, `run.gate`, `run.pr`, `run.merged`, `run.finished`, `run.failed`,
`run.cancelled`, `chat.delta`, `chat.message`, `chat.tool`, `chat.permission`, `chat.idle`,
`job.changed`, `approval.created`, `approval.resolved`, `telemetry`, `routine.fired`,
`routine.replied`, `routine.failed`.

## 7. Rate limits

| Surface | Limit |
| --- | --- |
| Any `/v1` route per device | 120 requests / minute |
| `POST /v1/pair` per source address | 10 attempts / hour |
| `POST /v1/runs` and `run` | 10 / minute |
| SSE connections per device | 3 |

Limits are enforced in memory per process; a restart resets them. `429` always carries
`Retry-After`.

## 8. Versioning and compatibility

- `packages/contracts` generates the OpenAPI 3.1 document and the app's client. CI fails if
  the checked-in `docs/api.md` schema section and the schemas disagree.
- Removing a field, changing a type or tightening a validator is a breaking change and waits
  for `/v2`; adding an optional field or a new event type is not.
- The daemon keeps answering a request whose body includes unknown optional fields with a
  422. Clients are generated, so this is a bug in the client, not a compatibility strategy.

## 9. Timeouts and limits

| Surface | Limit |
| --- | --- |
| Request body | 1 MB (`4 MB` for markdown attachments) |
| SSE idle | 15 s heartbeat, 90 s hard close |
| Run | `CB_RUN_TIMEOUT_SECONDS` (5 400) |
| Gate | `CB_GATE_TIMEOUT_SECONDS` (1 800) |
| Approval | `CB_APPROVAL_TTL_SECONDS` (600) |
| Pairing code | `CB_PAIRING_TTL_SECONDS` (300) |

An SSE stream that outlives its run closes after `run.finished`, `run.failed` or
`run.cancelled`; the client reconnects with `Last-Event-ID` and receives the terminal event
once.

## 10. Contract package

`@codebox/contracts` turns this document into code: one zod schema per resource, one per event,
and one parse helper per boundary. Every schema is strict (an unknown field is a failure), every
timestamp is RFC 3339 UTC with a `Z`, and every id is its prefix plus 6–40 alphanumeric
characters.

| Boundary | Module | Export | Parse helper |
| --- | --- | --- | --- |
| Ids, timestamps, enums, event names | `src/primitives.ts` | `RepoId` … `RequestId`, `RUN_STATES`, `SSE_EVENT_NAMES` | — |
| Errors (§3) | `src/errors.ts` | `errorEnvelopeSchema`, `ERROR_STATUS` | `parseErrorEnvelope` |
| Pagination and idempotency (§4) | `src/pagination.ts` | `paginationQuerySchema`, `pageSchema`, `IDEMPOTENT_ROUTES` | `parsePage` |
| Resources (§5) | `src/resources.ts` | `repoSchema`, `jobSchema`, `runSchema`, … | `parseRepo`, `parseJob`, `parseRun`, … |
| Routines (§5.8) | `src/routines.ts` | `routineSchema`, `ROUTINE_TOOL_NAMES`, the tool schemas | `parseRoutine` |
| Events (§6) | `src/events.ts` | `sseEventSchema`, `sseStreamEventSchema` | `parseSseEvent`, `parseSseStreamEvent` |
| Configuration | `src/config.ts` | `configSchema`, `CONFIG_DEFAULTS` | `parseConfig` |
| OpenAPI 3.1 | `src/openapi.ts` | `openApiDocumentSchema` | `parseOpenApiDocument` |

`parseOrThrow` is the only place a zod failure becomes a typed error: it throws a
`ContractParseError` whose `first.path` is the failing field prefixed with the boundary
(`job.cron`, `events.3.data.delta`, `config.CB_BIND`). The daemon maps that error to
`422 validation_failed` with `details.path = error.first.path`.

`buildOpenApiDocument()` returns the 3.1 document generated from those schemas, and a test
proves this file and the document name the same routes:

```
npx vitest run --project packages/contracts -t 'docs/api.md routes match the OpenAPI paths'
```

A new route or field is a contract change: edit this document, the schema and the document
builder in the same task.

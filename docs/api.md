# API

The daemon exposes one versioned HTTP + SSE contract under `/v1` (D16). The hybrid app and
the `cb` CLI are its only consumers; OpenCode and GitHub are never reached from the client.
`packages/contracts` is the executable form of this document — a payload that is not in the
schemas does not exist.

## 1. Rules

- **JSON only**, `Content-Type: application/json`, UTF-8. Timestamps are RFC 3339 in UTC
  (`2026-10-24T18:03:11Z`); durations are seconds unless the name says otherwise.
- **camelCase** fields; `id` prefixes are stable: `repo_`, `wrk_`, `run_`, `apv_`, `msg_`,
  `dev_`, `sub_`, `rmd_`, `sch_`, `prv_`, `acc_`.
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
  "scopes": ["read", "works", "runs", "write", "admin"],
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
    "scopes": ["read", "works", "runs", "write", "admin"],
    "createdAt": "2026-10-24T18:03:11Z",
    "lastSeenAt": null
  },
  "accessToken": "…",
  "refreshToken": "…",
  "expiresIn": 900,
  "scopes": ["read", "works", "runs", "write", "admin"]
}
```

`POST /v1/auth/refresh` takes `{ "refreshToken": "…" }` and answers `200` with
`{ accessToken, refreshToken, expiresIn, scopes }`. The refresh token rotates on every use; the
previous one is kept only to detect replay, and presenting it revokes the device and answers
`401`.

Scopes: `read` (all GETs), `works` (messages, runs, interrupt, compact, reviewed), `runs`
(cancel, revert, run now), `write` (repos, schedules, settings), `admin` (pairing
codes, revoke other devices, brake, cache wipe, provider accounts). The first device gets all of
them; a narrower device is a deliberate choice, not a default.

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

`Idempotency-Key` is required on `POST /v1/runs` and `POST /v1/works/{id}/runs`. A replay
returns the original `202` and the same resource; the same key with a different body is
`409 idempotency_mismatch`.

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
(for example no GitHub credential: the backlog and works are readable, git writes are
disabled; or no active provider account: nothing runs).

### 5.2 Repositories

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/repos` | `read` | Registered repositories. |
| `POST` | `/v1/repos` | `write` | `{ slug, defaultBranch?, gate?, policy?, protectedPaths? }`. |
| `GET` | `/v1/repos/{id}` | `read` | Repo, policy, last run, gate summary. |
| `PATCH` | `/v1/repos/{id}` | `write` | Gate, policy (`auto`/`manual`), protected paths, enabled. |
| `DELETE` | `/v1/repos/{id}` | `write` | 409 while a run is live. |
| `POST` | `/v1/repos/{id}/verify` | `write` | `{ ok, defaultBranch, canPush, checks }`. |
| `GET` | `/v1/repos/{id}/design?revision=` | `read` | `design/` at a commit: tokens, routes, declared states and the check's findings (D52). |

```json
{
  "id": "repo_01J...",
  "slug": "dani/example",
  "defaultBranch": "main",
  "gate": "npm ci && npm test && npm run build",
  "policy": "auto",
  "protectedPaths": [".github/**", "ops/**", "infra/**", "**/*.env"],
  "enabled": true,
  "createdAt": "2026-10-24T18:03:11Z",
  "counts": { "pending": 2, "running": 1, "merged": 8 }
}
```

`counts` is the repository's backlog in three integers — `pending`, `running` and `merged` — and
the daemon computes it inside the statement that loads the row, from `works` rows whose `state`
is `queued`, `running` or `merged`. `review`, `needs_decision`, `failed` and `abandoned` are
deliberately outside the three: the row shows three numbers and a fourth would be a new fact. A
repository with no works answers `{ "pending": 0, "running": 0, "merged": 0 }`, and the client
never counts works itself (D59). `GET /v1/repos` answers a §4 `Page<Repo>` — `limit` 1–200,
default 50, plus `cursor` — and `GET /v1/repos/{id}` answers `RepoDetail`: the same object plus
`lastRun`, the repository's newest run or `null`.

`POST /v1/repos/{id}/verify` asks the git provider and answers four checks in this order: `repo`
is `ok` once the provider answered; `branch` is `ok` when the provider's default branch equals
the registered one and `mismatch` otherwise; `push` is `ok` when the installation may push and
`forbidden` otherwise; `gate` is `ok` when the repository carries a gate command and `missing`
otherwise. `ok` is true only when all four are `ok`; `defaultBranch` and `canPush` are the
provider's answer, not the stored values. An unknown id is `404` with
`details.path = "repo.id"`, and a provider that cannot answer is `503 provider_unavailable` with
`details.reason = "provider_unreachable"`. The route writes nothing and emits no event.

`DELETE /v1/repos/{id}` answers `204` and removes the row; it refuses with `409 conflict` while
the repository has a live run (`details.reason = "repo_has_live_run"`) or when run history still
references it (`details.reason = "repo_has_history"`). A duplicate slug on `POST /v1/repos` is
also `409 conflict`, with `details.reason = "unique_violation"`.

`GET /v1/repos/{id}/design` reads the repository's `design/` at `revision`, or at the default
branch head when the query is absent. `present` is false when `design/tokens.json` is not at
that commit, and then the four collections are empty — a repository without a design says so
instead of guessing. `tokens` are the flat DTCG paths with their resolved value, `routes` and
`screens` are the documents' own rows, and each screen carries the three states it declares
(`loading`, `empty`, `error`, `null` when it declines one). `findings` are `@codebox/design`'s
`checkDocuments` answers — a colour outside the tokens, a route without a component, a screen
state missing — and never a pixel comparison: `snapshot_hash_mismatch` needs the exported PNG
and stays the gate's rule (`docs/jobs.md` §5), so a declared `snapshotSha256` is echoed as data
and not as a verdict. A commit the clone does not know is `422` with
`details.reason = "revision_unknown"`; a repository with no usable clone is `503`
`agent_unavailable` with `details.reason = "workspace_unavailable"`. The route writes nothing
and emits no event.

```json
{
  "repoId": "repo_01J...",
  "revision": "9f1c2ab",
  "present": true,
  "tokens": [
    { "name": "color.brand.bright", "type": "color", "value": "#22c55e" },
    { "name": "space.gap", "type": "dimension", "value": "8" }
  ],
  "routes": [
    { "path": "/repos/:id", "screen": "Repo · backlog", "component": "RepoBacklogPage" }
  ],
  "screens": [
    {
      "screen": "Repo · backlog",
      "route": "/repos/:id",
      "states": {
        "loading": "Rows grey until the file parses",
        "empty": "Empty file, one chat button",
        "error": "Envelope over the list"
      },
      "snapshotSha256": null
    }
  ],
  "findings": [],
  "checkedAt": "2026-10-29T10:00:00Z"
}
```

### 5.3 Legacy jobs (retained, not the product path)

A `jobs` row is **retired** by D44 and kept only for the migration history; nothing creates or
serves one as a product path. The recurring object is the repository schedule (§5.10), and every
run it creates carries `jobId: null`.

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

`repoId` and `enabled` (`true` or `false`) narrow the list; `limit` is 1–200 (default 50) and
`cursor` is the opaque cursor of §4. Jobs come newest first.

A job is created with a strict body — an unknown field is a 422, never a silent default:

```json
{
  "repoId": "repo_01J...",
  "title": "Nightly lockfile",
  "prompt": "Update the lockfile, run the gate, fix what breaks.",
  "mode": "work",
  "agent": "build",
  "model": null,
  "cron": "0 3 * * *",
  "timezone": "Europe/Madrid",
  "policy": "auto"
}
```

`repoId`, `title` (1–120 characters), `prompt` (1–8000), `cron` and `timezone` are required.
`mode` is `work`, `agent` defaults to `CB_DEFAULT_AGENT`, `model` to `CB_DEFAULT_MODEL`,
`policy` to the repository's policy, and a created job is `enabled`. `nextFireAt` is computed
by the daemon from `now`, never sent by a client: an unknown `repoId` is a 422 with
`details.path = "job.repoId"`, and a cron or zone the scheduler cannot resolve is a 422 with
`details.path = "job.cron"` or `"job.timezone"` and `details.reason` of `field_count`,
`range`, `step`, `syntax`, `no_fire` or `timezone`.

The job object:

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
  "nextFireAt": "2026-10-25T02:00:00Z"
}
```

`PATCH /v1/jobs/{id}` takes any of `title`, `prompt`, `cron`, `timezone`, `agent`, `model`,
`policy` and `enabled`. A `cron` or `timezone` change recomputes `nextFireAt` from `now`, and
`enabled: false` stores `nextFireAt: null`. `pause` is `enabled: false` plus that `null`;
`resume` recomputes the next fire from `now`. `DELETE` removes the job and keeps its runs,
whose `jobId` becomes `null`. `POST /v1/jobs/{id}/run` creates a `queued` run immediately,
ignored by the pause switch, and requires `Idempotency-Key` (§4).

`GET /v1/jobs/{id}` answers the job, its five most recent runs and its next five fires:

```json
{
  "job": { "id": "job_01J...", "…": "…" },
  "lastRuns": [],
  "nextFires": ["2026-10-25T02:00:00Z"]
}
```

`GET /v1/jobs/{id}/next` takes `count` (1–20, default 5) and previews the same fires in the
job's own timezone:

```json
{ "fires": ["2026-10-25T02:00:00Z", "2026-10-26T02:00:00Z"] }
```

Fire timestamps are RFC 3339 UTC with a `Z`. Every mutation appends one `job.changed` event
with `{ jobId, change, ts }` — `change` is `created`, `updated`, `deleted`, `paused` or
`resumed` — in the same transaction as the write.

### 5.4 Runs

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/runs?repoId=&workId=&state=&cursor=` | `read` | Newest first. |
| `POST` | `/v1/works/{id}/runs` | `runs` | `{ prompt? }` → 202; a run always belongs to a work (§5.6). The bare `POST /v1/runs` is retired. |
| `GET` | `/v1/runs/{id}` | `read` | Full run: state, gate, PR, guardrails, cost. |
| `POST` | `/v1/runs/{id}/cancel` | `runs` | Kills the session, removes the worktree. |
| `POST` | `/v1/runs/{id}/revert` | `runs` | Opens a revert PR for the merge; returns a new run. |
| `GET` | `/v1/runs/{id}/events?after=&limit=` | `read` | Event replay (JSON, not SSE). |
| `GET` | `/v1/runs/{id}/diff` | `read` | Stat and changed files; the patch lives on GitHub. |

`repoId`, `workId` and `state` narrow the list; `limit` is 1–200 and `cursor` is the §4 cursor.
Runs come newest first.

`POST /v1/runs` starts a manual run and answers `202` with a `queued` run:

```json
{
  "repoId": "repo_01J...",
  "prompt": "Fix the failing job.",
  "mode": "work",
  "agent": "build",
  "model": null,
  "baseRef": "main"
}
```

Only those fields are accepted. `mode` defaults to `work`, `agent` to `CB_DEFAULT_AGENT`,
`model` to `CB_DEFAULT_MODEL`, and `baseRef` to the repository's default branch. The
`Idempotency-Key` header is **required**; a replay answers `202` with the run the first call
created and never starts a second one, the same key with a different body is `409
idempotency_mismatch` (`details.key`), and a missing header is `400` with
`details.reason = "idempotency_key_required"`. Keys are per device and retained 24 h; the store
is in memory for the process lifetime, so a daemon restart forgets a replay and the persistent
table is a later store task.

The run object is the contract every screen renders:

```json
{
  "id": "run_01J...",
  "repoId": "repo_01J...",
  "jobId": null,
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
(the merge is atomic) and the recovering action is `revert`. A run outside those four states,
or one the daemon holds no live task for, is `409 conflict` with
`details.reason = "run_not_cancellable"`.

`POST /v1/runs/{id}/revert` is legal only for a `succeeded` run that carries a pull request;
anything else is `409 conflict` with `details.reason = "run_not_revertible"`. It answers `202`
with the **new** run — `trigger: "revert"`, `jobId: null`, the repository's default branch as
`baseRef` — whose prompt reverts the merge commit of the original. An `Idempotency-Key` is
honoured when present.

`GET /v1/runs/{id}/events` is JSON replay, never SSE. `after` is the last event the client
processed (default 0) and `limit` is 1–200 (default 200); `nextCursor` is the id of the last
item when the page is full, `null` otherwise. An unknown run is a 404 before any read:

```json
{
  "data": [
    {
      "id": 1842,
      "seq": 17,
      "type": "run.output",
      "data": { "runId": "run_01J...", "seq": 17, "ts": "2026-10-24T18:04:02Z", "delta": "…" },
      "ts": "2026-10-24T18:04:02Z"
    }
  ],
  "nextCursor": "1842"
}
```

`GET /v1/runs/{id}/diff` answers the stat and the changed files the daemon last measured; the
patch itself lives on GitHub. A run without a worktree — still queued, or already cleaned up —
is `409 conflict` with `details.reason = "diff_unavailable"`:

```json
{
  "files": 6,
  "added": 184,
  "removed": 22,
  "changedFiles": [{ "path": "src/a.ts", "status": "modified", "added": 12, "removed": 3 }]
}
```

`POST /v1/works/{id}/runs` (§5.6) is served by this subsystem because only it may start a run:
it takes the optional body prompt, or the work's own prompt when absent, and starts a run on
the repository's default branch with `trigger: "manual"`. It answers `202`, requires
`Idempotency-Key`, and refuses an archived work with `409 conflict` and
`details.reason = "work_archived"`.

### 5.5 Legacy approvals (retained, no writer)

No daemon code creates an approval row, so the inbox is empty on a fresh install and the run
path answers every permission inline (D45). The reply route still resolves a row that exists
and appends `approval.resolved`.

Nothing in the daemon creates an approval row: a fresh install's inbox is empty, and the run path answers every permission inline (D45).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/approvals?state=pending` | `read` | The inbox. |
| `GET` | `/v1/approvals/{id}` | `read` | One request with its redacted tool input. |
| `POST` | `/v1/approvals/{id}/reply` | `write` | `{ decision: "allow" \| "deny", scope: "once" \| "session" }`. |

`state` defaults to `pending` and accepts any of `pending`, `allowed`, `denied` and `expired`;
the inbox is oldest first and paginated with the §4 `limit` and `cursor`.

The reply body is a strict object:

```json
{ "decision": "allow", "scope": "once" }
```

The answer is `200` with the resolved approval — `state` becomes `allowed` or `denied` and
`resolvedAt` is set. Replying to a row that is no longer `pending` is `409 conflict` with
`details.reason = "approval_already_answered"`, and the second reply never reaches OpenCode.
The row is resolved and `approval.resolved` with `{ approvalId, decision, ts }` is appended in
one transaction; the answer reaches no agent, because no agent path calls this route. `scope`
is validated against this contract but is not stored — the approvals table has no column for
it — so a `session` reply is delivered as a one-shot answer.

An approval not answered within `CB_APPROVAL_TTL_SECONDS` is rejected and marked `expired`.
Every `/v1/approvals` request sweeps first: a row past its `expiresAt` becomes `expired` with
`resolvedAt` set and one `approval.resolved` whose `decision` is `"expired"`.

### 5.6 Works and backlog

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/repos/{id}/backlog` | `read` | The parsed `TODO.md` at the default branch, joined with works. |
| `GET` | `/v1/works?repoId=&state=` | `read` | Works, newest activity first. |
| `POST` | `/v1/works` | `write` | `{ repoId, backlogRef }` → `201`; the ref is required. |
| `GET` | `/v1/works/{id}` | `read` | Work, repository, state, usage, context epoch, its runs. |
| `PATCH` | `/v1/works/{id}` | `write` | `{ title?, prompt? }`; refused when the backlog owns the field. |
| `DELETE` | `/v1/works/{id}` | `write` | Archives it; the worktree is kept per retention. |
| `POST` | `/v1/works/{id}/runs` | `runs` | `{ prompt? }` → `202` · `Run`; a new attempt in a new worktree. |
| `POST` | `/v1/works/{id}/decision` | `write` | Opens the decision session bound to this work (D55). |
| `POST` | `/v1/works/{id}/reviewed` | `write` | Marks the work reviewed, once. |
| `POST` | `/v1/works/{id}/interrupt` | `write` | Stops the run; it ends `cancelled` and the work is `failed`. |

A work carries no `kind`, no nullable repository and **no conversation** (D44, D55):

- `repoId` — always a real repository. There is no free work.
- `state` — `queued`, `running`, `review`, `merged`, `failed`, `needs_decision`,
  `abandoned`. `review` means a run delivered a PR and no one has looked; `needs_decision`
  means the run **ended** asking for a person.
- `origin` — `manual`, `backlog` or `schedule`.
- `backlogRef` — the item's stable key (`Task-35`); every work has one.
- `attempts` / `maxAttempts` — the retry budget the schedule respects (default 2).
- `usage`, `contextTokens`, `contextEpoch`, `reviewedAt` — as before (D48).

```json
{
  "id": "wrk_01JABCDEFG",
  "repoId": "repo_01JABCDEFG",
  "backlogRef": "Task-35",
  "title": "Routine engine",
  "prompt": "Build the routine engine and its tests.",
  "specSha": "9f1c2ab",
  "state": "queued",
  "origin": "backlog",
  "attempts": 0,
  "maxAttempts": 2,
  "usage": { "usd": 0.25, "tokensIn": 1200, "tokensOut": 300 },
  "contextTokens": 1500,
  "contextEpoch": 1,
  "reviewedAt": null,
  "createdAt": "2026-10-28T09:12:00Z",
  "updatedAt": "2026-10-28T09:12:00Z"
}
```

`specSha` is the default-branch commit the item's title and body were read at (D51) — the file
stays the owner, the row is the cache.

`POST /v1/works` with `backlogRef` verifies the item against the cached default branch: an
unknown or duplicated ref is `422` (`backlog_ref_missing` / `backlog_ref_ambiguous`), an
already ticked item is `409` (`backlog_ref_checked`), and the item's title and body seed the
prompt. `PATCH` on `title` or `prompt` answers `409` with `details.reason = "spec_in_git"`
because the file owns those fields (D51). `POST /v1/works/{id}/runs` is the only way to spend
tokens on a work, and each run has its own worktree, branch and PR.

The backlog object:

```json
{
  "repoId": "repo_01J...",
  "revision": "9f1c2ab",
  "path": "TODO.md",
  "sections": [
    {
      "title": "Batch 15 — Agent pipeline hygiene",
      "items": [
        {
          "ref": "Task-35",
          "title": "Routine engine",
          "checked": true,
          "line": 512,
          "needs": ["Task-34"],
          "work": { "id": "wrk_01J...", "state": "merged", "runs": 2 }
        }
      ]
    }
  ]
}
```

- `needs` — the `Task-NN` refs named by the item's `*Dependencies:*` sentence, in file order,
  deduplicated and with the item's own ref removed; `[]` when the sentence says `none`, is
  absent, or names no task. A `Task-A to Task-B` range expands inclusively. The daemon derives
  it from the file on every read (D51) and never stores it. A ref is **unmet** when the same
  payload has no item for it or that item is `checked: false`.

The daemon never writes the file here: the tick happens in the run's branch (§6 of
[`docs/jobs.md`](jobs.md)) and reaches `main` through the merge.

Four things about this surface are worth stating once:

- The `Auth` column names the scope `packages/contracts` carries (`read`, `chat`, `runs`,
  `write`, `admin`). There is no `works` scope: every works mutation is a `write`, and only a
  route that opens a run asks for `runs`.
- A second `POST /v1/works` for a ref that already has a `queued`, `running` or
  `needs_decision` work is `409` with `details.reason = "live_work"`, the row-level
  `works_live_item` index refusing it.
- `POST /v1/repos/{id}/run-next` runs the same §16 selection as a schedule fire with
  `selection = "nextPending"` and the repository schedule's `maxAttempts` (default `2`). It
  works for a repository with no schedule at all, opens one `manual` work and one run, and
  answers `409` with `details.reason = "nothing_pending"` or `"nothing_runnable"` when the file
  has nothing to give. It is not in the table above because the OpenAPI document is built from
  `packages/contracts` and does not carry that path yet.
- A schedule fire that selects nothing is **not** a failure, but `schedule_fires.outcome` has no
  `nothing_pending` value: the fire row ends `fired` with `run_id` null and a `schedule.skipped`
  event carries the reason. A row that names the refusal needs the `skipped` outcome the
  schedules service writes, which is a follow-up to this surface.

#### 5.6.1 Sessions (D55)

A session is a chat with **one target**, and the target is its write boundary.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/sessions?repoId=&target=` | `read` | Sessions, newest activity first. |
| `POST` | `/v1/sessions` | `write` | `{ repoId, target: "backlog" \| "design" \| "schedule" \| "work" \| "repo", workId? }` → `201`. |
| `GET` | `/v1/sessions/{id}` | `read` | Session, target, state, pending proposal. |
| `GET` | `/v1/sessions/{id}/messages?cursor=` | `read` | Oldest first, paginated. |
| `POST` | `/v1/sessions/{id}/messages` | `write` | `{ text }` → `202`; the reply arrives as events. |
| `POST` | `/v1/sessions/{id}/compact` | `write` | New agent session in the same directory; bumps the epoch. |
| `POST` | `/v1/sessions/{id}/merge` | `write` | Proposes the worktree diff and merges it once; the refusals are below. |
| `POST` | `/v1/sessions/{id}/interrupt` | `write` | Stops the agent; the session returns to `idle`. |
| `DELETE` | `/v1/sessions/{id}` | `write` | Archives it; the branch is kept per retention. |

- `target = backlog` may only write `TODO.md`; `design` only `design/**`; `schedule` only
  `.codebox/schedule.yml`; `work` writes no code and produces notes plus an optional backlog
  proposal. `repo` is **read-only**: the session
  gets the repository's worktree and context but no branch and no proposal, and `POST /merge` on
  it answers `409` with `details.reason = "read_only_session"`. A write outside the target is
  refused by the daemon **and** by the gate, whichever happens first.
- A `work` session opened on a **merged** work is a *rework* session: its proposal is a new run
  with the notes as the prompt (`POST /v1/works/{id}/runs`), never an edit of a merged branch.
- At most one pending proposal per session: a second one while one is open is `409` with
  `details.reason = "proposal_pending"`.
- `POST /merge` pushes a docs-only PR and merges it through the normal guardrails; a proposal
  that touches anything outside its target fails the gate as `target_violation`.
- A session never starts a run and never ticks a backlog item.

```json
{
  "id": "sess_01JABCDEFG",
  "repoId": "repo_01JABCDEFG",
  "target": "design",
  "workId": null,
  "title": "Edit the design tokens",
  "status": "idle",
  "branch": "cb/design-edit",
  "pendingProposal": null,
  "usage": { "usd": 0, "tokensIn": 0, "tokensOut": 0 },
  "contextTokens": 0,
  "contextEpoch": 1,
  "createdAt": "2026-10-28T09:12:00Z",
  "updatedAt": "2026-10-28T09:12:00Z",
  "lastMessage": null
}
```

The pending proposal is one object and nothing else:

```json
{ "branch": "cb/design-edit", "sha": "9f1c2ab",
  "paths": ["design/tokens/core.json"], "createdAt": "2026-10-28T09:12:00Z" }
```

`workId` is non-null exactly when `target = "work"`; every other target carries a null
`workId`. A `target = "repo"` session carries a null `branch` and a null `pendingProposal`: it
has the repository's context and writes nothing.

`POST /v1/sessions/{id}/merge` is the proposal gate and the merge in one call:

1. a `repo` session is `409 read_only_session` — it has no branch to propose;
2. a session that already carries a `pendingProposal` is `409 proposal_pending`, because one
   change lands at a time;
3. the worktree diff against the default branch is checked against the target, and the first
   path outside it is `409 target_violation` with `details.path` — nothing is pushed;
4. an empty diff is `409 proposal_none`;
5. otherwise the proposal is recorded (and `session.proposal` emitted), the branch is pushed as
   a docs-only PR and merged; the pending proposal is cleared whatever the outcome, so a
   refused merge can simply be retried.

A session's thread is **not** an SSE channel: `packages/contracts` defines `session.created`,
`session.delta`, `session.tool`, `session.proposal` and `session.closed`, and no message event,
so `GET /v1/sessions/{id}/messages` is how a client reads the transcript and `session.delta` is
how it streams the turn that is running. A turn is awaited by the request that asked for it: the
`202` is answered once the agent has finished, and an unavailable runtime is `502
agent_unavailable` after the user message is stored. An archived session refuses a new turn with
`409` and `details.reason = "session_archived"`.

### 5.7 Settings and push

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/settings` | `read` | Non-secret settings and their defaults. |
| `PATCH` | `/v1/settings` | `write` | Only keys listed in the schema. |
| `GET` | `/v1/notifications/preferences` | `read` | Per-event subscriptions and quiet hours. |
| `PATCH` | `/v1/notifications/preferences` | `write` | Same shape. |
| `POST` | `/v1/push/subscriptions` | `write` | `{ kind: "web" \| "fcm" \| "apns", endpoint, keys }`. |
| `DELETE` | `/v1/push/subscriptions/{id}` | `write` | Unsubscribe. |

### 5.8 Reminders (retired)

Retired by D56. A recurring object without a repository no longer exists: every schedule belongs
to a repository and consumes its backlog, so there is no `/v1/reminders` surface and no
`reminder` kind. A notification that has to fire on a timer is a calendar, not this product.

### 5.9 Credentials and integrations

A credential is a value the daemon holds for the operator: sealed with AES-256-GCM under
`CB_SECRETS_KEY`, stored as one file under `CB_STATE_DIR/secrets/credentials`, and reported
only as `configured`, `lastFour` and `lastUsedAt` (D49). An integration is the outbound call
that uses one: a base URL, an auth kind and the exact hosts it may reach (D50). Neither surface
ever returns a value, a prefix longer than four characters or the sealed envelope.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/credentials` | `read` | Credentials, metadata only, newest first. |
| `POST` | `/v1/credentials` | `admin` | Seal `{ name, kind, expose, value }`; `201`. |
| `DELETE` | `/v1/credentials/{id}` | `admin` | Forget the credential and its seal; `204`. |
| `POST` | `/v1/credentials/{id}/rotate` | `admin` | Replace `{ value }` and keep the identity. |
| `GET` | `/v1/integrations` | `read` | Saved integrations. |
| `POST` | `/v1/integrations` | `admin` | Record base URL, auth kind, credential and hosts; `201`. |
| `DELETE` | `/v1/integrations/{id}` | `admin` | Forget the integration; the credential stays; `204`. |
| `POST` | `/v1/integrations/{id}/request` | `runs` | Execute the call server-side. |
| `POST` | `/v1/integrations/github/manifest` | `admin` | Start the GitHub App manifest flow. |
| `POST` | `/v1/integrations/github/complete` | `admin` | Exchange GitHub's code for the app PEM. |

```json
{ "id": "cred_01JABCDEFG", "name": "OpenAI", "kind": "model_key", "expose": "env",
  "configured": true, "lastFour": "abcd", "createdAt": "2026-10-27T10:00:00Z",
  "updatedAt": "2026-10-27T10:00:00Z", "lastUsedAt": null }
```

- `kind` is `api_key`, `bearer`, `basic`, `github_app` or `model_key`. `expose` is `daemon`,
  `tool` or `env`; `env` is allowed only with `kind: "model_key"`, and anything else is a `422`
  with `details.reason = "env_not_allowed"`.
- `POST /v1/credentials` and `POST /v1/credentials/{id}/rotate` are a `503` with
  `details.reason = "secrets_not_configured"` when `CB_SECRETS_KEY` is absent. An unknown body
  key is a `422` whose `details.path` is `credential.<key>`. A missing credential is a `404`
  with `details.path = "credential.id"`. A device without the `admin` scope is a `403` with
  `details.reason = "insufficient_scope"`.

```json
{ "id": "int_01JABCDEFG", "name": "Linear", "baseUrl": "https://api.linear.app",
  "auth": "bearer", "headerName": null, "credentialId": "cred_01JABCDEFG",
  "allowedHosts": ["api.linear.app"], "createdAt": "2026-10-27T10:00:00Z",
  "updatedAt": "2026-10-27T10:00:00Z" }
```

- `auth` is `none`, `bearer`, `header` or `basic`. `header` requires `headerName`; every kind
  other than `none` requires a `credentialId` that exists, otherwise `404` with
  `details.path = "integration.credentialId"`. Unknown body keys are a `422` with
  `details.path = "integration.<key>"`.
- `POST /v1/integrations/{id}/request` takes
  `{ method, path, query?, headers?, body? }`: `method` is one of `GET`, `POST`, `PUT`, `PATCH`
  or `DELETE`, `path` starts with `/`, `headers` keeps only `accept` and `content-type`, and
  `body` is at most 65 536 bytes. It answers `{ status, contentType, body, truncated }`, where
  `body` is truncated to 65 536 characters. The daemon checks `https` and the full host against
  `allowedHosts` **before** any DNS lookup and before the outbound call: a refused URL is a
  `422` with `details.reason = "host_not_allowed"`. A transport error or a timeout is a `503`
  with `details.reason = "integration_unreachable"`.
- `POST /v1/integrations/github/manifest` returns `{ action, manifest, state }` for a browser
  form; GitHub posts to `action` and redirects to the app, never to the daemon.
  `state` is single use and expires after 600 s. `POST /v1/integrations/github/complete` takes
  `{ code, state }` and answers `{ configured: true, appId, credentialId }`; a replayed or
  expired `state` is a `422` with `details.reason = "state_invalid"`, GitHub refusing the
  exchange is a `503` with `details.reason = "provider_unavailable"`, and an absent
  `CB_SECRETS_KEY` is a `503` with `details.reason = "secrets_not_configured"`. The PEM becomes
  a `github_app` credential with `expose: "daemon"` and appears in no response byte.

#### 5.9.1 Provider accounts (D54)

A provider is an adapter (`opencode-go`, `anthropic`, …); an account is a credential plus a
position in the failover order. Neither surface ever returns a value, a prefix longer than four
characters or the sealed envelope.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/providers` | `read` | Providers with their accounts, states, priorities and spend today. |
| `POST` | `/v1/providers/{id}/accounts` | `admin` | `{ label, priority, auth: "token", value }` → `201`; the token is sealed. |
| `POST` | `/v1/providers/{id}/oauth/start` | `admin` | `{ label, priority }` → `{ authorizeUrl, state }`; `state` is single use, 600 s. |
| `POST` | `/v1/providers/{id}/oauth/complete` | `admin` | `{ code, state }` → `201` with the account; a replay is `422 state_invalid`. |
| `PATCH` | `/v1/provider-accounts/{id}` | `admin` | `{ label?, priority?, enabled?, budgetUsd? }`. |
| `POST` | `/v1/provider-accounts/{id}/test` | `admin` | One cheap call; answers `{ ok, state, lastError }`. |
| `DELETE` | `/v1/provider-accounts/{id}` | `admin` | Removes the account and its credential. |

```json
{
  "id": "prv_01JABCDEFG",
  "name": "opencode-go",
  "authKinds": ["oauth", "token"],
  "accounts": [
    { "id": "acc_01J...", "label": "go · dani", "priority": 1, "state": "active",
      "lastFour": "a91f", "spentTodayUsd": 2.4, "resetAt": null, "lastUsedAt": "2026-10-28T07:12:00Z" },
    { "id": "acc_01J...", "label": "go · spare", "priority": 2, "state": "exhausted",
      "lastFour": null, "spentTodayUsd": 0, "resetAt": "2026-10-28T15:00:00Z", "lastUsedAt": null }
  ]
}
```

`state` is `active`, `exhausted`, `invalid` or `disabled`; it is written by the daemon from
classified provider errors (D54), never by a client — a client can only `enabled` an account
or reorder it. Removing the last `active` account of the only provider that serves the
default model is a `409` with `details.reason = "no_active_account"`, so the box cannot be
left unable to run.

### 5.10 Schedules (D56, D46)

A schedule is the **repository's** recurrence: `{ repoId, mode, cron|window, selection, caps }`.
It has no work and no prompt of its own — each fire takes the next eligible backlog item and
opens a run of it. This subsection is the API object; [`docs/jobs.md`](jobs.md) §16 owns the
field table, the selection rule, the three modes, the claim and the tick.

- `GET /v1/schedules` (`read`) — the §4 page, newest first, narrowed by `repoId` and `enabled`;
  `{ data, nextCursor }` with a cursor stable under inserts.
- `POST /v1/schedules` (`write`) — creates the schedule and answers `201` with the stored
  `Schedule`.
- `GET /v1/schedules/{id}` (`read`) — answers `{ schedule, nextFires }` (`ScheduleDetail`, up
  to five preview instants).
- `PATCH /v1/schedules/{id}` (`write`) — the editable fields; answers `200` with the
  `Schedule`.
- `DELETE /v1/schedules/{id}` (`write`) — deletes the schedule and its fire rows; `204`.
- `POST /v1/schedules/{id}/pause` (`write`) — `enabled: false` and `nextFireAt: null`; answers
  `200` with the `Schedule`.
- `POST /v1/schedules/{id}/resume` (`write`) — `enabled: true` and the next fire recomputed
  from now; answers `200` with the `Schedule`.
- `POST /v1/repos/{id}/run-next` (`runs`) — the same selection, once, outside any schedule:
  answers `202` with the created `Run`, or `409 nothing_pending`.

```json
{
  "id": "sch_01JABCDEFG",
  "repoId": "repo_01J...",
  "mode": "window",
  "cron": null,
  "timezone": "Europe/Madrid",
  "windowStart": "22:00",
  "windowEnd": "06:00",
  "cooldownMinutes": 20,
  "selection": "nextPending",
  "refs": [],
  "maxAttempts": 2,
  "maxFires": 6,
  "maxCostPerFireUsd": 0.75,
  "consecutiveFailures": 0,
  "firesCount": 3,
  "spendUsd": 1.25,
  "enabled": true,
  "nextFireAt": "2026-10-27T21:40:00Z",
  "lastFiredAt": "2026-10-27T21:20:00Z",
  "createdAt": "2026-10-26T18:03:11Z",
  "updatedAt": "2026-10-26T18:03:11Z"
}
```

`refs` is stored as a JSON array (`[]` for `nextPending`) and `maxAttempts` defaults to `2`.
The table also keeps the legacy `title`, `prompt`, `chat_session_id`, `fire_policy` and
`policy` columns that D56 no longer reads; a repository schedule stores them as
`''`/`NULL`/`'new_chat'`/`'auto'` until they are dropped.

- `mode` is `once`, `every` or `window`. A `window` schedule has `cron: null`, non-null
  `windowStart`/`windowEnd` of the form `HH:MM` and `windowStart !== windowEnd`; every other
  mode has a 5-field `cron` and null window bounds.
- `repoId` is required and a repository has **at most one** schedule: a second create is `409`
  with `details.reason = "schedule_exists"`. There is no schedule without a repository and no
  schedule tied to a work (D56).
- `selection` is `nextPending` (the default) or `refs`; with `refs`, `refs` is a non-empty list
  of backlog refs and only those are considered.
- Defaults on create: `cooldownMinutes` `0`; `selection` `nextPending`; `maxAttempts` `2`;
  `maxFires` and `maxCostPerFireUsd` `null`; `enabled` `true`.
- `consecutiveFailures`, `firesCount`, `spendUsd`, `nextFireAt` and `lastFiredAt` are written
  by the daemon, never by a client.
- Refusals: `422 validation_failed` with `details.path = "schedule.<key>"` and `details.reason`
  one of `field_count`, `range`, `step`, `syntax`, `no_fire`, `timezone`, `window`,
  `repo_missing`, `selection_empty`. An unknown id is `404 not_found` with
  `details.path = "schedule.id"`; a write without the `write` scope is `403 forbidden` with
  `details.reason = "insufficient_scope"`.

## 6. SSE

`GET /v1/events` is the only stream. Query filters (`types`, `runId`, `workId`) are additive;
the default is everything the device may read.

```
GET /v1/events?types=run.output,run.gate,session.delta
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
`run.cancelled`, `work.created`, `work.updated`, `work.needs_decision`, `work.closed`,
`session.created`, `session.delta`,
`session.tool`, `session.proposal`, `session.closed`, `schedule.fired`, `schedule.skipped`, `provider.state`,
`backlog.changed`, `design.changed`, `approval.created`, `approval.resolved`, `telemetry`.

## 7. Rate limits

| Surface | Limit |
| --- | --- |
| Any `/v1` route per device | 120 requests / minute |
| `POST /v1/pair` per source address | 10 attempts / hour |
| `POST /v1/runs` and `run` | 10 / minute |
| SSE connections per device | 3 |

Limits are enforced in memory per process; a restart resets them. `429` always carries
`Retry-After`.

The two device budgets are taken in the auth middleware, after the token and the scope check and
before the handler: the key is `device:<id>`, `POST /v1/runs`, `POST /v1/works/{id}/runs` and
`POST /v1/repos/{id}/run-next` count against the 10/minute budget **only**, and every other
authenticated `/v1` request counts against the 120/minute one. The pairing budget is per source
address and separate. A refusal is the ordinary error envelope — `code: "rate_limited"`,
`details.retryAfter`, `Retry-After` — so a client renders it like any other `ApiError`. Health,
version and pairing are not counted against a device: they either carry no device or are
rate-limited by source.

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
| Resources (§5) | `src/resources.ts` | `repoSchema`, `workSchema`, `runSchema`, … | `parseRepo`, `parseWork`, `parseRun`, … |
| Backlog (§5.6) | `src/backlog.ts` | `backlogSchema`, `backlogItemSchema` | `parseBacklog` |
| Provider accounts (§5.9.1) | `src/providers.ts` | `providerSchema`, `providerAccountSchema`, `PROVIDER_STATES` | `parseProvider` |
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

## 11. Screens → routes

Every screen in `apps/app/src/app/app.routes.ts` calls the `/v1` routes below, and each of them
has a request and a response shape in §2–§5. A screen whose API is marked legacy in §5.3 or §5.5
still renders, and the routes it calls are retained.

| Route | API |
| --- | --- |
| `/pair` | `POST /v1/pair`, `POST /v1/auth/refresh` |
| `/dashboard` | `GET /v1/health`, `GET /v1/telemetry`, `GET /v1/runs`, `GET /v1/repos` |
| `/repos` | `GET /v1/repos`, `POST /v1/repos`, `POST /v1/repos/{id}/verify` |
| `/repos/:id` | `GET /v1/repos/{id}`, `GET /v1/repos/{id}/backlog`, `POST /v1/works`, `POST /v1/works/{id}/runs`, `POST /v1/sessions` |
| `/repos/:id/workers` | `GET /v1/works?repoId=` |
| `/repos/:id/schedule` | `GET /v1/schedules?repoId=`, `POST /v1/schedules`, `POST /v1/schedules/{id}/pause`, `POST /v1/schedules/{id}/resume`, `POST /v1/repos/{id}/run-next` |
| `/repos/:id/design` | `POST /v1/sessions` |
| `/works/:id` | `GET /v1/works/{id}`, `POST /v1/works/{id}/decision`, `POST /v1/works/{id}/runs` |
| `/sessions/:id` | `GET /v1/sessions/{id}`, `GET /v1/sessions/{id}/messages`, `POST /v1/sessions/{id}/messages`, `POST /v1/sessions/{id}/interrupt`, `POST /v1/sessions/{id}/merge`, `GET /v1/repos/{id}/design` |
| `/settings` | `GET /v1/me`, `GET /v1/version`, `GET /v1/settings`, `PATCH /v1/settings`, `GET /v1/providers`, `GET /v1/notifications/preferences`, `PATCH /v1/notifications/preferences`, `POST /v1/admin/brake`, `POST /v1/admin/cache/wipe` |
| `/settings/schedules` | Retired: the schedule belongs to a repository (D56). |
| `/settings/devices` | `GET /v1/me`, `GET /v1/devices`, `DELETE /v1/devices/{id}` |
| `/settings/credentials` | `GET /v1/credentials`, `POST /v1/credentials`, `DELETE /v1/credentials/{id}`, `GET /v1/integrations`, `POST /v1/integrations`, `POST /v1/integrations/github/manifest`, `POST /v1/integrations/github/complete` |
| `/settings/notifications` | `GET /v1/notifications/preferences`, `PATCH /v1/notifications/preferences`, `PATCH /v1/settings` |
| `/about` | `GET /v1/version`, `GET /v1/health` |

# Spec: Task-15 — Jobs/runs API

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** daemon.
- **Role:** Dev.
- **Objective:** after this task the daemon serves `docs/api.md` §5.3 (jobs), §5.4 (runs,
  including cancel, revert, JSON event replay and diff) and §5.5 (approvals inbox and reply),
  plus `POST /v1/chat/sessions/{id}/promote`, over the merged run engine and store repositories.
  It wires the engine the run subsystem deliberately left absent (`run/README.md`: "Both stay
  absent until the API task wires them"), owns the two jobs/runs subsystems, and makes every
  mutating route idempotent where §4 says so.
- **Environment:** worktree `../wt-cb-15`, branch `task-15`, base `main`.
- **Dependencies (all merged):**
  - Task-03 `@codebox/contracts` — `jobSchema`, `runSchema`, `approvalSchema`, the page helpers,
    `idempotencyKeySchema`, `IDEMPOTENCY_RETENTION_HOURS`, `runStateSchema`, the `job.changed` /
    `approval.*` events.
  - Task-04 `@codebox/store` — `Store`, `jobs`, `runs`, `events`, `approvals`, `chats`,
    `repos`, `usage` repositories.
  - Task-05 `@codebox/core` — `canCancel`, `parseCron`, `nextFire`, `nextFires`,
    `isValidTimezone` (the cron arithmetic; see Coordination for why `@codebox/scheduler` is not
    imported in this task).
  - Task-11 `apps/daemon/src/{modules,app,config,logger}.ts`.
  - Task-12 `apps/daemon/src/auth/index.ts` — `authenticatedDevice`.
  - Task-14 `apps/daemon/src/run/{ports,engine,events}.ts` and `src/gate/run-gate.ts` —
    `createRunEngine`, `RunPorts`, `RunSettings`, `RunStartInput`, `createRunEventWriter`.

### Exclusive paths (single writer)

Only these paths. `src/jobs/**` and `src/runs/**` are yours alone in this batch.

- `apps/daemon/src/jobs/index.ts` — the `jobs` subsystem module (`createModule`).
- `apps/daemon/src/jobs/service.ts` — job list/create/get/patch/delete/run-now/pause/resume/next.
- `apps/daemon/src/jobs/routes.ts` — the §5.3 handlers and their schemas.
- `apps/daemon/src/jobs/README.md` — the file map.
- `apps/daemon/src/jobs/service.test.ts`, `apps/daemon/src/jobs/routes.test.ts`.
- `apps/daemon/src/runs/index.ts` — the `runs` subsystem module (`createModule`).
- `apps/daemon/src/runs/service.ts` — the runs service and the one shared instance.
- `apps/daemon/src/runs/engine.ts` — `createDaemonEngine(context)`: `RunPorts` from the merged
  packages and `CodeboxConfig`.
- `apps/daemon/src/runs/routes.ts` — the §5.4 handlers **and** `POST
  /v1/chat/sessions/{id}/promote`.
- `apps/daemon/src/runs/approvals.ts` — the §5.5 handlers and the expiry sweep.
- `apps/daemon/src/runs/idempotency.ts` — the in-memory `Idempotency-Key` store.
- `apps/daemon/src/runs/ids.ts` — the only `run_` / `job_` id generators.
- `apps/daemon/src/runs/errors.ts` — `RunApiError` and its envelope mapping.
- `apps/daemon/src/runs/README.md` — the file map.
- `apps/daemon/src/runs/service.test.ts`, `routes.test.ts`, `approvals.test.ts`,
  `idempotency.test.ts`, `engine.test.ts`, `ids.test.ts`.
- `docs/api.md` — **sections 5.3 Jobs, 5.4 Runs, 5.5 Approvals only**.

Explicitly not yours: `apps/daemon/README.md` (Task-13 holds it this batch),
`apps/daemon/src/{main,modules,app}.ts`, `src/run/**`, `src/gate/**`, `src/auth/**`,
`src/chat/**`, `src/events/**`, `src/cli/**`, `apps/daemon/package.json`, `apps/app/**`,
`packages/**`, `package-lock.json`, `TODO.md`, `CHANGELOG.md`, `docs/decisions.md`,
`docs/providers.md`, `docs/app.md`, `docs/operations.md`, `tsconfig.base.json`,
`opencode.json`.

**You may not create `src/run/index.ts` or `src/gate/index.ts`.** `src/run/README.md` records
that the loader must keep reporting both as absent; creating them changes the boot report and
`src/run/modules.test.ts` fails.

### Inputs (read-only)

Beyond `AGENTS.md` and this spec:

- `docs/api.md` §1–§4, §5.3, §5.4, §5.5, §5.6 (promote row), §6, §7, §9.
- `docs/jobs.md` — the guardrail and lifecycle sections (read the run states, never edit).
- `docs/agent-runtime.md` §2, §8.
- `packages/contracts/src/{index,resources,pagination,primitives,events,errors,parse}.ts`.
- `packages/store/src/{index,store,jobs,runs,events,approvals,chats,repos,usage,cursor,errors}.ts`.
- `packages/core/src/{index,run-state,cron,misfire}.ts`.
- `packages/scheduler/src/{index,types,validate,resume}.ts` — read for the semantics, never
  imported (it is not a dependency of `apps/daemon/package.json` and that file is Task-17's this
  batch; see Coordination).
- `packages/opencode/src/{index,types}.ts`, `packages/workspaces/src/{index,types}.ts`,
  `packages/git-provider/src/{index,types,tokens}.ts`.
- `apps/daemon/src/{modules,app,config,logger}.ts`, `src/run/{ports,engine,events,README}.ts`,
  `src/gate/run-gate.ts`, `src/auth/{index,routes.test}.ts`, `src/run/modules.test.ts`.

## 🔒 Contract

Both module files export the fixed seam and nothing else is imported by the loader:

```ts
// apps/daemon/src/jobs/index.ts and apps/daemon/src/runs/index.ts
import type { DaemonContext, DaemonModule } from '../modules.js';
export function createModule(context: DaemonContext): DaemonModule;
```

**Register must not do I/O and must not throw.** `src/run/modules.test.ts:63` boots the real
tree with no GitHub credentials and no OpenCode listener and asserts `report.failed` is empty.
So `createDaemonEngine` is called lazily on the first run request, never at register time, and
every timer is `unref()`ed and cleared by the module's `shutdown()`.

```ts
// apps/daemon/src/runs/errors.ts
import type { ErrorCode } from '@codebox/contracts';
export class RunApiError extends Error {
  readonly code: ErrorCode;               // one of the twelve of docs/api.md §3
  readonly status: 400 | 404 | 409 | 422 | 502 | 503;
  readonly details?: Record<string, unknown>;
  constructor(code: ErrorCode, status: RunApiError['status'], details?: Record<string, unknown>);
}
export function runApiErrorResponse(c: Context<{ Variables: AppVariables }>, error: RunApiError): Response;
```

`runApiErrorResponse` builds the body with `errorBody` from `../app.js` and the headers
`application/json; charset=utf-8`; every route wraps its handler in a `handle()` that maps
`RunApiError`, `ContractParseError` (→ 422 with `details.path`) and `StoreError` (`not_found` →
404, `unique_violation` → 409 `conflict`, `invalid_row` → 422 with `details.path`) and rethrows
anything else to `app.onError`.

```ts
// apps/daemon/src/runs/service.ts
import type { Approval, Run, RunDiff } from '@codebox/contracts';
import type { EventRecord } from '@codebox/store';
import type { RunEngine } from '../run/ports.js';
import type { WorkspaceManager } from '@codebox/workspaces';

export interface EventPageItem {
  readonly id: number;
  readonly seq: number | null;
  readonly type: EventRecord['type'];
  readonly data: Readonly<Record<string, unknown>>;
  readonly ts: string;
}
export interface EventPage {
  readonly data: EventPageItem[];
  readonly nextCursor: string | null;
}

export interface CreateRunsServiceOptions {
  readonly context: DaemonContext;
  readonly engine?: RunEngine;                                   // tests
  readonly workspaces?: Pick<WorkspaceManager, 'status'>;        // tests
  readonly idempotency?: IdempotencyStore;                       // tests
  readonly now?: () => Date;                                     // tests, default context.clock
}

export interface RunsService {
  /** The engine, built on first call and cached for the process. */
  engine(): RunEngine;
  createRun(input: {
    readonly repoId: string; readonly prompt: string; readonly mode: 'work';
    readonly agent?: string; readonly model?: string | null; readonly baseRef?: string;
    readonly deviceId: string; readonly idempotencyKey: string;
  }): Run;
  promote(input: {
    readonly chatId: string; readonly title?: string;
    readonly deviceId: string; readonly idempotencyKey: string;
  }): Run;
  cancel(runId: string, reason?: 'operator'): Promise<Run>;
  revert(input: {
    readonly runId: string; readonly deviceId: string; readonly idempotencyKey: string;
  }): Run;
  diff(runId: string): Promise<RunDiff>;
  events(runId: string, after: number, limit: number): EventPage;
  replyApproval(input: {
    readonly id: string; readonly decision: 'allow' | 'deny';
    readonly scope: 'once' | 'session';
  }): Approval;
  /** Resolves every pending approval whose `expiresAt <= now`; returns how many. */
  sweepApprovals(): number;
  stop(): void;
}

export function createRunsService(options: CreateRunsServiceOptions): RunsService;
/** One instance per daemon context; `jobs` and `runs` share it. */
export function runsService(context: DaemonContext): RunsService;

// apps/daemon/src/jobs/service.ts
export interface JobsService {
  list(query: { repoId?: string; enabled?: boolean; limit: number; cursor: string | null }):
    PageResult<Job>;
  create(input: {
    readonly repoId: string; readonly title: string; readonly prompt: string;
    readonly mode?: 'work'; readonly agent?: string; readonly model?: string | null;
    readonly cron: string; readonly timezone: string; readonly policy?: 'auto' | 'manual';
  }): Job;
  get(id: string): { job: Job; lastRuns: Run[]; nextFires: string[] };
  patch(id: string, patch: {
    readonly title?: string; readonly prompt?: string; readonly cron?: string;
    readonly timezone?: string; readonly agent?: string; readonly model?: string | null;
    readonly policy?: 'auto' | 'manual'; readonly enabled?: boolean;
  }): Job;
  remove(id: string): void;
  runNow(id: string, input: { deviceId: string; idempotencyKey: string }): Run;
  pause(id: string): Job;
  resume(id: string): Job;
  next(id: string, count: number): string[];
}
export function createJobsService(input: {
  readonly context: DaemonContext;
  readonly runs: RunsService;
  readonly now?: () => Date;
}): JobsService;

// apps/daemon/src/jobs/routes.ts and apps/daemon/src/runs/routes.ts
export function registerJobsRoutes(app: DaemonApp, jobs: JobsService): void;
export function registerRunsRoutes(app: DaemonApp, runs: RunsService): void;
// apps/daemon/src/runs/approvals.ts
export function registerApprovalRoutes(app: DaemonApp, runs: RunsService): void;
```

`runs/index.ts` registers `runs` + approvals + promote; `jobs/index.ts` registers jobs. Both call
`runsService(context)` so the process has exactly one engine (one `inflight` map, one cost
budget) even though the loader builds two modules.

### Routes, frozen

Every `GET` is covered by the auth middleware's `read` scope. Every other scope below is
**your** job, using `authenticatedDevice(c)` and `hasScope` from `@codebox/security`; a missing
scope is `403 forbidden` with `details.reason = "insufficient_scope"`.

| Method | Path | Scope | Success | Body |
| --- | --- | --- | --- | --- |
| `GET` | `/v1/jobs?repoId=&enabled=&limit=&cursor=` | `read` | 200 | `Page<Job>` |
| `POST` | `/v1/jobs` | `write` | 201 | `Job` |
| `GET` | `/v1/jobs/{id}` | `read` | 200 | `{ job, lastRuns, nextFires }` |
| `PATCH` | `/v1/jobs/{id}` | `write` | 200 | `Job` |
| `DELETE` | `/v1/jobs/{id}` | `write` | 204 | — |
| `POST` | `/v1/jobs/{id}/run` | `runs` | 202 | `Run` (state `queued`) |
| `POST` | `/v1/jobs/{id}/pause` | `write` | 200 | `Job` (`enabled: false`, `nextFireAt: null`) |
| `POST` | `/v1/jobs/{id}/resume` | `write` | 200 | `Job` (`enabled: true`, recomputed `nextFireAt`) |
| `GET` | `/v1/jobs/{id}/next?count=` | `read` | 200 | `{ fires: string[] }` |
| `GET` | `/v1/runs?repoId=&jobId=&state=&limit=&cursor=` | `read` | 200 | `Page<Run>` |
| `POST` | `/v1/runs` | `runs` | 202 | `Run` (state `queued`) |
| `GET` | `/v1/runs/{id}` | `read` | 200 | `Run` |
| `POST` | `/v1/runs/{id}/cancel` | `runs` | 202 | `Run` |
| `POST` | `/v1/runs/{id}/revert` | `runs` | 202 | `Run` (the new run) |
| `GET` | `/v1/runs/{id}/events?after=&limit=` | `read` | 200 | `EventPage` |
| `GET` | `/v1/runs/{id}/diff` | `read` | 200 | `RunDiff` |
| `GET` | `/v1/approvals?state=pending&limit=&cursor=` | `read` | 200 | `Page<Approval>` |
| `GET` | `/v1/approvals/{id}` | `read` | 200 | `Approval` |
| `POST` | `/v1/approvals/{id}/reply` | `write` | 200 | `Approval` |
| `POST` | `/v1/chat/sessions/{id}/promote` | `runs` | 202 | `Run` |

Do **not** add or renumber a route. Every path above already exists in
`packages/contracts/src/openapi.ts`; adding a `| GET | /v1/… |` row to `docs/api.md` breaks
`packages/contracts/src/openapi.test.ts:99`, which compares the documented table with the
OpenAPI document. Document the bodies as fenced blocks and prose, never as new route rows.

Request bodies and queries, strict, frozen (boundary string in the `ContractParseError` path):

```ts
createJob:  { repoId: RepoId, title: 1..120 chars, prompt: 1..8000 chars,
              mode?: 'work', agent?: string, model?: string | null,
              cron: cronSchema, timezone: timezoneSchema,
              policy?: 'auto' | 'manual' }                          // boundary 'job'
patchJob:   { title?, prompt?, cron?, timezone?, agent?, model?,
              policy?, enabled?: boolean }                          // boundary 'job.patch'
listJobs:   { repoId?: RepoId, enabled?: 'true'|'false', limit, cursor? } // 'jobs'
jobNext:    { count: int 1..20, default 5 }                         // 'job.next'
createRun:  { repoId: RepoId, prompt: 1..8000, mode?: 'work',
              agent?: string, model?: string | null, baseRef?: branchSchema } // 'run'
listRuns:   { repoId?, jobId?, state?: runStateSchema, limit, cursor? }  // 'runs'
runEvents:  { after: int >= 0, default 0, limit: int 1..200, default 200 } // 'run.events'
replyBody:  { decision: 'allow'|'deny', scope: 'once'|'session' }   // 'approval.reply'
promote:    { title?: string }                                      // 'chat.promote'
```

Defaults: `mode: "work"`; `agent: CB_DEFAULT_AGENT`; `model: CB_DEFAULT_MODEL`; a created job's
`policy` defaults to its repo's `policy`; `enabled: true`. A created job's `nextFireAt` is
`nextFireAt({ cron, timezone }, clock())`, a pure helper in `src/jobs/service.ts`:

```ts
export type NextFireResult =
  | { readonly ok: true; readonly nextFireAt: string }
  | { readonly ok: false; readonly field: 'cron' | 'timezone';
      readonly code: 'field_count' | 'range' | 'step' | 'syntax' | 'no_fire' | 'timezone';
      readonly message: string };
export function nextFireAt(fields: { cron: string; timezone: string }, now: Date): NextFireResult;
```

It wraps `parseCron` (its `code` is `field_count | range | step | syntax`), `isValidTimezone`
(→ `code: 'timezone'`) and `nextFire` (→ `code: 'no_fire'` when it returns `null`), and formats
with `toISOString().replace(/\.\d{3}Z$/, 'Z')` — the same format
`packages/scheduler/src/validate.ts:3` uses, so the values are byte-identical to the scheduler's.
An `!ok` result is `422 validation_failed` with `details.path = "job.<field>"` and
`details.reason = <code>`. Resume and a `cron`/`timezone` patch both call the same helper from
`now`; pause stores `nextFireAt: null`. `GET /next?count=` is
`nextFires(parseCron(cron) as ParsedCron, timezone, now, count)` mapped with the same format
(`count` 1–20, default 5).

Errors, exactly:

| Situation | Status | `code` | `details` |
| --- | --- | --- | --- |
| schema failure | 422 | `validation_failed` | `{ path }` from `ContractParseError.first.path` |
| unknown id (`job`, `run`, `approval`, `chat`) | 404 | `not_found` | `{ path: "<area>.id" }` |
| unknown `repoId` | 422 | `validation_failed` | `{ path: "job.repoId" }` |
| missing `Idempotency-Key` on an §4 route | 400 | `bad_request` | `{ reason: "idempotency_key_required" }` |
| same key, different body hash | 409 | `idempotency_mismatch` | `{ key }` |
| `cancel` in `merging` or a terminal state, or no live run | 409 | `conflict` | `{ reason: "run_not_cancellable" }` |
| `revert` on a run that is not `succeeded` or has no PR | 409 | `conflict` | `{ reason: "run_not_revertible" }` |
| `GET /v1/runs/{id}/diff` with no worktree | 409 | `conflict` | `{ reason: "diff_unavailable" }` |
| approval not `pending` | 409 | `conflict` | `{ reason: "approval_already_answered" }` |
| promote on an archived session, or `chatId` unknown | 409 / 404 | `conflict` / `not_found` | `{ reason: "chat_archived" }` / `{ path: "chat.id" }` |
| bad cursor | 422 | `validation_failed` | `{ path: "<area>.cursor" }` |
| engine or provider failure while starting a run | 502 | `agent_unavailable` | `{ reason }` |

`GET`/`PATCH`/`DELETE` on an unknown job and `GET` on an unknown run use the same 404 shape.

Idempotency (§4), frozen: keys are per device, `key = `${deviceId}\u0000${header}``; the value is
`{ hash, run }` where `hash = sha256Hex(canonicalJson(body))` (`sha256Hex` from
`@codebox/security`; canonical JSON = sorted keys, no whitespace). Retention is
`IDEMPOTENCY_RETENTION_HOURS` (24) measured on `now`, capped at 1 000 entries (oldest evicted
first). A replay returns the **stored run** with `202` and never starts a second run; a
different hash returns `409 idempotency_mismatch`. The store is in memory for the process
lifetime — `packages/store` has no table for it and `packages/store/**` is out of this task;
say so in the doc bullet (see below) and in the completion report.

`GET /v1/runs/{id}/events` is JSON replay, never SSE. It reads
`store.events.readRunAfterSeq(id, after, limit)`, maps to `EventPageItem` and sets
`nextCursor = String(last.id)` when `data.length === limit`, otherwise `null`. `after` is the
last id the client processed. An unknown run is 404 before any read.

`POST /v1/chat/sessions/{id}/promote` (owned here because only this module may start a run):
read `store.chats.getSession(id)`; `null` → 404; `status === 'archived'` → 409
`chat_archived`; take the session's **last `assistant` message** (`store.chats.lastMessage` and
`role === 'assistant'`) as the prompt, and when there is none answer `422` with
`details.path = "chat.messages"`. The new run uses `trigger: 'promote'`, `jobId: null`, the
repo's default branch as `baseRef`, and `title` from the body or the session title. Response
`202` with the `Run`.

`POST /v1/runs/{id}/revert`: only for `state === 'succeeded' && pr !== null`; the new run uses
`trigger: 'revert'`, `jobId: null`, `baseRef = repo.defaultBranch` and exactly this prompt:
`Revert run <runId>. Open a pull request that reverts merge commit <mergeCommit> and leave the gate and guardrails unchanged.`
(`mergeCommit` is read from the `run.merged` event, `data.mergeCommit`; when the event is gone,
use the PR number instead of the sha). Response `202` with the new run.

Approvals (§5.5): `GET /v1/approvals` defaults `state` to `pending`; any of the four
`APPROVAL_STATES` is accepted, `store.approvals.list(state, { limit, cursor })` is
oldest-first. `reply` requires `state === 'pending'`; it calls
`store.approvals.resolve({ id, state: decision === 'allow' ? 'allowed' : 'denied', resolvedAt: now })`
and appends `approval.resolved` with `{ approvalId, decision, ts }` in one transaction. It
**never** calls OpenCode: the chat module observes the resolved row and delivers the reply
(see Coordination). `scope` is validated and accepted but cannot be stored — `approvals` has no
column for it; document that in §5.5 as one sentence, do not invent a column.

Every `/v1/approvals*` request first calls `sweepApprovals()`, and a 60 s `unref()`ed interval
started on the first approvals request calls it too; the module's `shutdown()` clears it. The
sweep marks `pending` rows with `expiresAt <= now` as `expired` with
`resolvedAt = now` and appends `approval.resolved` with `decision: "expired"`.

`job.changed` events: append one row (`runId: null`, `chatId: null`, `seq: null`) with
`{ jobId, change, ts }` after a successful create (`created`), patch (`updated`), delete
(`deleted`), pause (`paused`) and resume (`resumed`), inside the same transaction as the write.

```ts
// apps/daemon/src/runs/engine.ts — the wiring this task exists to provide
export function createDaemonEngine(context: DaemonContext): RunEngine;
```

It builds `RunPorts` exactly as the merged code expects: `store`, `clock`, `logger`,
`emit: (record) => logger.debug({ msg: 'run_event', event: record.type, eventId: record.id })`
(delivery is the SSE bridge's poll, never a callback), `spentTodayUsd: () =>
store.usage.spendOnDay(clock().toISOString().slice(0, 10))`, `workspaces:
createWorkspaceManager({ repoRoot: CB_REPO_ROOT, workspaceRoot: CB_WORKSPACE_ROOT, git:
createGitRunner(), matchesGlob, cloneDepth: CB_CLONE_DEPTH, httpTimeoutSeconds:
CB_GIT_HTTP_TIMEOUT_SECONDS, now: clock })`, `agent: createAgentRuntime({ baseUrl:
CB_OPENCODE_URL, token: CB_OPENCODE_TOKEN, healthPath: CB_OPENCODE_HEALTH_PATH, fetch, requestTimeoutMs: 30_000, reconnectDelayMs: 1_000, sleep })`,
`git: createGitHubProvider({ auth, apiBase: CB_GITHUB_API_URL, gitHost: 'github.com', fetch, git:
createGitRunner(), now: () => clock().getTime(), requestTimeoutMs: CB_GIT_HTTP_TIMEOUT_SECONDS *
1000, log, userAgent: 'codebox/' + build.version })` where `auth` is `{ kind: 'app',
installationId, privateKeyPem: decodePrivateKey(CB_GITHUB_APP_PRIVATE_KEY_BASE64) }` when the App
keys exist, `{ kind: 'pat', token: CB_GITHUB_TOKEN }` when only the PAT exists, otherwise
`{ kind: 'none' }`; `gate: runGate`, `gitRunner: createGitRunner()`, and
`settings: RunSettings` = `{ gateDefault: CB_GATE_DEFAULT, gateShell: CB_GATE_SHELL,
gateTimeoutSeconds: CB_GATE_TIMEOUT_SECONDS, runTimeoutSeconds: CB_RUN_TIMEOUT_SECONDS,
dailyCostUsd: CB_DAILY_COST_USD, automerge: CB_AUTOMERGE, mergeMethod: CB_MERGE_METHOD,
protectedPaths: CB_PROTECTED_PATHS, diffMaxFiles: CB_DIFF_MAX_FILES, diffMaxLines:
CB_DIFF_MAX_LINES, probationRuns: CB_PROBATION_RUNS, consecutiveGreenRuns: 0,
approvalTtlSeconds: CB_APPROVAL_TTL_SECONDS, logsDir: join(CB_STATE_DIR, 'logs'), author: { name:
CB_GIT_AUTHOR_NAME, email: CB_GIT_AUTHOR_EMAIL }, gitTimeoutMs: CB_GIT_HTTP_TIMEOUT_SECONDS *
1000 }`.

`RunStartInput.repo` comes from the `repos` row: `{ id, slug, defaultBranch, gate, policy,
protectedPaths, cloneUrl: `https://github.com/${slug}.git` }`; `jobId`, `trigger`, `title`,
`prompt`, `agent`, `model`, `baseRef?` from the caller.

`createRun` and `runNow` and `revert` and `promote` **create the queued row themselves** and let
the engine adopt it (`engine.ts:310` adopts an existing `queued` row): build the `RunRecord` with
`state: 'queued'`, `trigger`, `branch: branchName(runId, title)` from `@codebox/workspaces`,
`attempt: 1`, `cost: { usd: 0, tokensIn: 0, tokensOut: 0 }`, empty `guardrails`/`blockers`,
write it with `store.runs.create`, append `run.queued` with `createRunEventWriter`, then call
`void engine().start(input)` and return `toRun(stored)`. Doing it in this order is what lets the
route answer `202` with a row that already exists; never rely on the engine having inserted it.

### Data

- Ids: `run_` / `job_` plus 20 Crockford base32 characters, one generator each in
  `src/runs/ids.ts`, injectable `random` for tests (mirror `apps/daemon/src/auth/ids.ts:12`).
- No migration, no new table, no new column. `approvals.scope` does not exist; §5.5 says so.
- Job list order is store-defined (newest first); run list is newest first; approvals are
  oldest first; job `lastRuns` is `store.runs.listByJob(id, 5)`; `nextFires` is
  `nextFires(cron, timezone, now, 5)` formatted as `Z`-suffixed ISO seconds.

## 🧩 Configuration

No new `CB_*` key; `docs/providers.md` is out of scope. Keys read (defaults are the merged
ones): `CB_DEFAULT_AGENT`, `CB_DEFAULT_MODEL`, `CB_REPO_ROOT`, `CB_WORKSPACE_ROOT`,
`CB_CLONE_DEPTH`, `CB_GIT_HTTP_TIMEOUT_SECONDS`, `CB_OPENCODE_URL`, `CB_OPENCODE_TOKEN`,
`CB_OPENCODE_HEALTH_PATH`, `CB_GITHUB_API_URL`, `CB_GITHUB_APP_ID`,
`CB_GITHUB_APP_PRIVATE_KEY_BASE64`, `CB_GITHUB_INSTALLATION_ID`, `CB_GITHUB_TOKEN`,
`CB_GATE_DEFAULT`, `CB_GATE_SHELL`, `CB_GATE_TIMEOUT_SECONDS`, `CB_RUN_TIMEOUT_SECONDS`,
`CB_DAILY_COST_USD`, `CB_AUTOMERGE`, `CB_MERGE_METHOD`, `CB_PROTECTED_PATHS`,
`CB_DIFF_MAX_FILES`, `CB_DIFF_MAX_LINES`, `CB_PROBATION_RUNS`, `CB_APPROVAL_TTL_SECONDS`,
`CB_GIT_AUTHOR_NAME`, `CB_GIT_AUTHOR_EMAIL`, `CB_STATE_DIR`.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`.
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; includes the tests this task adds.
  - `npx vitest run --project apps/daemon src/runs` — the runs/approvals suite alone.
  - `npx vitest run --project apps/daemon src/jobs` — the jobs suite alone.
  - `npx vitest run --project apps/daemon src/run/modules` — the seam still boots and `run` /
    `gate` are still absent.
  - `npm run build`.
  - `git diff --name-only main...task-15` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean.
  - [ ] `[unit]` Every route matches its contract schema:
    `npx vitest run --project apps/daemon src/jobs -t 'contract'` and
    `npx vitest run --project apps/daemon src/runs -t 'contract'`. Each response body in the
    table above parses with the matching `parseJob` / `parseRun` / `parseApproval` /
    `pageOf*` / `jobNextSchema` / `runDiffSchema` helper.
  - [ ] `[unit]` A duplicate `Idempotency-Key` returns the first run:
    `npx vitest run --project apps/daemon src/runs -t 'idempotency'`. Two identical
    `POST /v1/runs` calls with one key produce one `runs` row, one `run.queued` event and two
    `202` bodies with the same `id`; the same key with `{ prompt: "different" }` is `409` with
    code `idempotency_mismatch`; a missing header is `400` with reason
    `idempotency_key_required`.
  - [ ] `[unit]` Cursor pagination is stable while new runs arrive:
    `npx vitest run --project apps/daemon src/runs -t 'stable pagination'`. With 5 runs, page 1
    (`limit: 2`) then 3 new runs inserted, page 2 returns the next 2 of the *original* 5 and
    never repeats an id; `nextCursor` is `null` on the last page.
  - [ ] `[unit]` Jobs: `npx vitest run --project apps/daemon src/jobs -t 'jobs'`. Create with
    `cron: "0 3 * * *"`, `timezone: "Europe/Madrid"` yields `nextFireAt ===
    "2026-10-25T01:00:00Z"` for a clock at `2026-10-25T00:00:00Z`; an invalid cron is `422`
    with `details.path === "job.cron"`; `pause` sets `enabled: false` and `nextFireAt: null`;
    `resume` recomputes from `now`; `GET /next?count=3` returns 3 `Z` timestamps; each mutation
    appends one `job.changed` row with the documented `change`.
  - [ ] `[unit]` Cancel state machine: `npx vitest run --project apps/daemon src/runs -t 'cancel'`.
    A `queued`/`running` run is `202` and the fake engine recorded `cancel(id, 'operator')`; a
    `merging` and a `succeeded` run are `409` with reason `run_not_cancellable` and the engine
    was not called.
  - [ ] `[unit]` Event replay is JSON: `npx vitest run --project apps/daemon src/runs -t 'replay'`.
    With 3 events and `?after=1&limit=2`, the body is `{ data: [ids 2,3], nextCursor: "3" }` with
    the item keys `id, seq, type, data, ts`; `after=3` yields `{ data: [], nextCursor: null }`.
  - [ ] `[unit]` Approvals: `npx vitest run --project apps/daemon src/runs -t 'approvals'`.
    Reply `allow` sets `state: "allowed"` and appends one `approval.resolved` with
    `decision: "allow"`; the second reply is `409 approval_already_answered`; a pending row with
    `expiresAt` in the past becomes `expired` after `sweepApprovals()` and one
    `approval.resolved` with `decision: "expired"` is appended; the route never calls
    `replyPermission` (the fake agent is untouched).
  - [ ] `[unit]` Promote: `npx vitest run --project apps/daemon src/runs -t 'promote'`. A session
    with an assistant message produces a run with `trigger: "promote"` and the message text as
    the prompt; a session with no assistant message is `422` with `details.path ===
    "chat.messages"`; an archived session is `409 chat_archived`.
  - [ ] `[unit]` Scopes: `npx vitest run --project apps/daemon src/runs -t 'scope'`. A device
    with only `read` gets `403` with `details.reason === "insufficient_scope"` on
    `POST /v1/runs`, `POST /v1/jobs`, `POST /v1/approvals/{id}/reply` and `POST
    /v1/chat/sessions/{id}/promote`, and `200/202` never.
  - [ ] `[unit]` The module seam boots: `npx vitest run --project apps/daemon src/run/modules`
    passes with `report.failed` empty and `src/run/index.ts` / `src/gate/index.ts` still absent.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched: the `git diff --name-only`
    output lists only `apps/daemon/src/jobs/**`, `apps/daemon/src/runs/**` and `docs/api.md`.
  - [ ] `[live]` The app can create a job and see it fire without a page reload. Measurement: on
    the VM with a real daemon and Stepper/Task-21 app build, create a job whose cron fires within
    two minutes, keep the jobs screen open; the row appears without a reload and its state moves
    `queued → running` off the `job.changed` and `run.queued` events. Not run on CI.

## 📣 Coordination

- For the Architect: `POST /v1/chat/sessions/{id}/promote` is served by this task's
  `src/runs/routes.ts`, not by `src/chat/**`, because only this module may own the engine. The
  §5.6 row stays where it is; the behaviour sentence is written by Task-13.
- For the Architect, two contract gaps this task documents instead of hiding: `packages/contracts`
  has no `JobDetail` (`{ job, lastRuns, nextFires }`) and no event-page schema for
  `GET /v1/runs/{id}/events`; both are strict local schemas in this task's
  `src/jobs/routes.ts` / `src/runs/routes.ts`, and `docs/api.md` §5.3/§5.4 describe them. A later
  contracts task should promote them into `packages/contracts` and add parse helpers.
- For the Architect, idempotency: `docs/api.md` §4 promises 24 h retention, but
  `packages/store/migrations/0001_init.sql` has no table for it and `packages/store/**` is out of
  this task. The store is in memory per process; §5.4 says so in one sentence, and the persistent
  table is a follow-up store task.
- For Task-13 (same batch, no shared file): the approval reply crosses by the store. This task's
  `POST /v1/approvals/{id}/reply` only resolves the row and appends `approval.resolved`; the chat
  module polls `store.approvals.get(id)` and calls `replyPermission`. Do not import
  `src/chat/**` or `src/events/**`, and do not add a reply hook.
- For Task-16 (notifications): `approval.created` is written by the chat module for chat
  approvals and by the run engine for run approvals; this task writes only `approval.resolved`.
- For Task-17 (CLI, same batch, no shared file): the routes it calls are the ones in the table
  above. `cb run` → `POST /v1/jobs/{id}/run`, `cb logs`/`cb events` →
  `GET /v1/runs/{id}/events`, `cb brake` → `/v1/admin/brake` + `GET /v1/settings` (not this
  task), `cb revert` → `POST /v1/runs/{id}/revert`.
- For the next scheduler task: call `runsService(context)` instead of building a second engine;
  `claimScheduledRun` + `engine.start` is the documented seam (`engine.ts:310`). That task also
  owns adding `@codebox/scheduler` to `apps/daemon/package.json` (dependency + lockfile, i.e. a
  hot-file owner of its own batch) and may then replace `nextFireAt` with
  `validateSchedule`/`planResume` — the values are already byte-identical.
- `apps/daemon/README.md` does not list `src/jobs/**` or `src/runs/**` this batch because
  Task-13 holds that file; the folder READMEs carry the map, and a later docs pass adds the two
  lines.
- No `/v1/repos` implementation exists in this tree; tests seed `store.repos.create(...)`.

## ⛔ Out of scope

- No scheduler tick, no cron claim loop, no notification, no telemetry aggregation.
- No persistence of idempotency keys (no table, no migration), and no column for
  `scope` on approvals.
- No new dependency, no new `CB_*` key, no change to `packages/**`, `app.ts`, `modules.ts`,
  `src/run/**` or `src/gate/**`.
- No new route and no new row in any `docs/api.md` route table.
- No retry/attempt UI, no reverts of reverts, no bulk job operations.

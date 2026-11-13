# Spec: Task-125 — The daemon creates a local repository

> The spec is the subagent's entire world. Anything not written here does not exist.

## 🎯 Scope

- **Task type:** daemon (`apps/daemon/src/repos`) + docs (`docs/api.md` §5.2). HTTP, filesystem
  and the store on one route pair; no app, no screen, no migration, no new route path.
- **Role:** Dev.
- **Objective:** `POST /v1/repos` creates a repository from a name alone: it validates the
  name, initialises the folder with Task-124's `initLocal`, writes the row with
  `source: 'local'` and `slug: null`, and answers `201` with the created repository. Today's
  GitHub body keeps answering exactly what it answers today, and an explicit connect is refused
  with `409` until the App has an installation. `POST /v1/repos/{id}/verify` answers a local
  repository's four checks **from the box** — `push` is `not_applicable` — and never calls the
  git provider. `docs/api.md` §5.2 documents one object with two sources and one body with two
  modes.
- **Environment:** worktree `../wt-cb-125`, branch `task-125`, base `main` at `61ebc8b`
  **plus Tasks 122, 123 and 124 merged** (waves 1–2).
- **Dependencies:** Task-122 (merged) — `createRepoBodySchema`, `nameSchema`, `Repo.source`,
  `Repo.name`, nullable `slug`, `repoRefOf`; Task-123 (merged) — the `repos` row and
  `store.repos.create`/`getLocalByName`; Task-124 (merged) — `initLocal` and `localRepoPath`.
  Merged and read-only here: the `repos` routes, `handle()`'s `StoreError` mapping and the
  `repo_not_allowed` mapping. Task-126 is cut after this task merges and reads nothing but the
  frozen answer below.

### Batch position (Batch 34)

- **Wave 3 of 4.** Branches from the merged 122–124 and is the only task in its wave: it is the
  daemon half of the split the batch cut made ("the Repos UI is split from the daemon because
  both would own `features/repos/**`").
- Hot-file holders in this batch: `apps/daemon/src/repos/{service,routes}.ts` **and**
  `docs/api.md` §5.2 — this task holds both alone. No other task in the batch writes either.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/daemon/src/repos/service.ts`
- `apps/daemon/src/repos/routes.ts`
- `apps/daemon/src/repos/service.test.ts`
- `apps/daemon/src/repos/routes.test.ts`
- `docs/api.md` — **§5.2 *Repositories* only**, from its `### 5.2` heading to the line before
  `### 5.3`; no other section changes by one byte

Not touched, with the reason: `apps/daemon/README.md` — it maps **files**, and this task adds,
renames and deletes none. `apps/daemon/src/repos/ids.ts` and `index.ts` are untouched.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/api.md` §3, §4 and §5.2 (the envelope, the page, the section being rewritten)
- `docs/decisions.md` D49, D51, D59, D62
- `packages/contracts/src/{resources.ts,primitives.ts,index.ts}` (the frozen body and object)
- `packages/store/src/{repos.ts,errors.ts}` (the accessors and the `StoreError` codes)
- `packages/workspaces/src/local.ts`, `packages/workspaces/src/index.ts` (`initLocal`,
  `localRepoPath`, `WorkspaceError`)
- `apps/daemon/src/repos/{service.ts,routes.ts,service.test.ts,routes.test.ts}` (before editing)
- `apps/daemon/src/runs/errors.ts` (`handle`, `RunApiError`, `requireScope`, `readJson`)
- `apps/daemon/src/{runs/engine.ts,modules.ts}` (`repoRefOf`, `createGitRunner`, `DaemonContext`)
- `apps/daemon/src/design/routes.ts` (the `503 agent_unavailable` /
  `details.reason = "workspace_unavailable"` precedent this task copies)

## 🔒 Contract

The public surface Task-126 and Batch 35 are written against **right now**.

### `POST /v1/repos` — one body, two modes

```ts
// packages/contracts, frozen by Task-122; imported, never re-declared here
createRepoBodySchema: z.ZodType<CreateRepoBody>;
```

The route deletes its local `createBody` const and becomes:

```ts
const body = parseOrThrow(createRepoBodySchema, await readJson(c), 'repo');
return json(c, parseRepo(repos.create(body)), 201);
```

| Body | Status | Answer / refusal |
| --- | --- | --- |
| `{ "mode": "local", "name": "widgets" }` (+ optional `defaultBranch`, `gate`, `policy`, `protectedPaths`) | `201` | the repository: `source: "local"`, `name: "widgets"`, `slug: null`, `defaultBranch: "main"` (`REPO_DEFAULTS`), `gate: REPO_DEFAULTS.gate`, `policy: "auto"`, `protectedPaths: []`, `enabled: true`, `createdAt` from the daemon clock |
| `{ "mode": "local", "name": "../x" }` or any name that fails `^[a-z0-9][a-z0-9._-]{0,63}$` | `422` | `validation_failed`, `details.path = "repo.name"` |
| `{ "mode": "local" }` | `422` | `details.path = "repo.name"` |
| `{ "mode": "local", "name": "widgets", "slug": "acme/widgets" }` | `422` | `details.path = "repo.slug"` |
| a name already used by a local repository | `409` | `conflict`, `details.reason = "unique_violation"` (the store's code, `handle()`'s existing mapping) |
| `initLocal` throws (git or disk) | `503` | `agent_unavailable`, `details.reason = "workspace_unavailable"`; the row is deleted before the answer and `{ msg: 'repo_create_failed', name, code }` is logged at `warn` with the `WorkspaceError` **code**, never its message |
| `{ "mode": "connect", "slug": "acme/widgets" }` | `409` | `conflict`, `details.reason = "github_app_installed_required"`; no row is written, no provider is called (Batch 35/Task-127 adds the installation) |
| `{ "mode": "connect" }` | `422` | `details.path = "repo.slug"` |
| `{ "slug": "acme/widgets" }` (today's body, `mode` absent) | `201` | **exactly today's answer and today's row**: `source: "github"`, `name` derived from the slug by the store, `slug` as posted |

- **Why `mode` absent is not `connect`.** The shipped app posts `{ slug }` until Task-126 lands;
  the acceptance "the GitHub create path answers exactly what it answers today" is only true if
  the legacy body keeps the legacy behaviour, and Batch 35's connect needs a body it can
  distinguish. `CreateRepoBody['mode']` is therefore optional and never defaulted (Task-122's
  schema says so).
- **Create order is fixed:** `store.repos.create(...)` **first** — the unique index is the
  duplicate gate and it must refuse before a folder exists — then `initLocal`, and a failed init
  deletes the row it just wrote (ignoring a secondary store failure, logging
  `repo_create_failed`) before answering `503`. There is never an orphan folder and never a row
  without its repository.
- **`ReposService.create` takes the contract body**, not a daemon-local input: `create(input:
  CreateRepoBody): Repo`. `CreateRepoInput` is deleted. The `github` arm builds the same `Repo`
  object it builds today; the `local` arm sets `source: 'local'`, `name`, `slug: null`.

### `POST /v1/repos/{id}/verify` — two answers, one shape

```ts
export interface RepoVerifyPort {
  verify(slug: string): Promise<{ readonly defaultBranch: string; readonly canPush: boolean }>;
}
/** New: the box's own answer for a repository with no remote. */
export interface RepoLocalVerifyPort {
  checks(input: { readonly name: string; readonly defaultBranch: string }): Promise<{
    readonly repo: string;
    readonly branch: string;
  }>;
}
export interface RepoLocalInitPort {
  init(input: { readonly name: string; readonly defaultBranch: string }): Promise<{
    readonly path: string;
  }>;
}
export interface CreateReposServiceOptions {
  readonly context: DaemonContext;
  readonly verify?: RepoVerifyPort;
  readonly localInit?: RepoLocalInitPort;
  readonly localVerify?: RepoLocalVerifyPort;
}
```

- A **local** repository answers the same four checks in the same order, from the box:

  ```json
  {
    "ok": true,
    "defaultBranch": "main",
    "canPush": false,
    "checks": [
      { "name": "repo", "state": "ok" },
      { "name": "branch", "state": "ok" },
      { "name": "push", "state": "not_applicable" },
      { "name": "gate", "state": "ok" }
    ]
  }
  ```

  `repo` and `branch` are whatever `localVerify.checks` answered (`"ok"` or `"missing"`); `push`
  is the literal `"not_applicable"`; `gate` is `"ok"` when `repo.gate` is non-empty and
  `"missing"` otherwise (today's rule). `ok` is `true` only when `repo`, `branch` **and** `gate`
  are `ok` — `not_applicable` is neither a pass nor a failure. `canPush` is `false`. The
  provider is never constructed and never called; the answer is `200`, not `503`, because a
  missing folder is an answer the operator can act on.
- A **github** repository keeps today's path byte for byte, including `503` with
  `details.reason = "provider_unreachable"` when the provider cannot answer.
- Unknown id: `404 not_found`, `details.path = "repo.id"`, unchanged.
- **Default ports** (built lazily, once, like `verifyPort`): `localInit` wraps
  `initLocal({ repoRoot: config.CB_REPO_ROOT, name, defaultBranch, git: createGitRunner() })`
  and answers `{ path }`; `localVerify` runs, in `join(config.CB_REPO_ROOT, name)`,
  `git rev-parse --is-inside-work-tree` and then `git rev-parse refs/heads/<defaultBranch>`,
  answering `ok`/`missing` for each and never throwing. A git failure is `missing`.
- **Errors/logs:** `repo_create_failed` at `warn` on a failed local create (fields: `name`,
  `code`); `repo_verify_failed` stays as it is for github and is **not** emitted for a local
  repository. No log line carries a path, a token or a prompt.

### `docs/api.md` §5.2 — the frozen facts

Rewrite §5.2 (nothing before `### 5.2`, nothing from `### 5.3` on). Every fact below must be
present; the prose around them is the dev's, in the section's existing voice.

1. The route table's `POST /v1/repos` row: `{ mode?, name?, slug?, defaultBranch?, gate?,
   policy?, protectedPaths? }`.
2. One sentence naming D62: a repository is local first; `source` is `local` or `github`; `name`
   is the folder-safe identity and is unique among local repositories; `slug` is the remote
   coordinate and is `null` until a remote exists.
3. The `Repo` JSON sample gains `"source": "github"` and `"name": "example"` beside
   `"slug": "dani/example"`, and a **second, compact sample** shows the local shape
   (`"source": "local"`, `"name": "widgets"`, `"slug": null`).
4. A create paragraph: `mode: "local"` takes `name` and no `slug`; `mode: "connect"` takes
   `slug`; a body with neither is today's connect and is unchanged; a duplicate name or slug is
   `409 conflict` with `details.reason = "unique_violation"`; an explicit connect without an
   installation is `409 conflict` with
   `details.reason = "github_app_installed_required"`; a bad name is `422` at `repo.name`; a
   failed `git init` is `503 agent_unavailable` with `details.reason = "workspace_unavailable"`.
5. The verify paragraph gains exactly: for a repository with `source: "local"` the four checks
   are `repo` (`ok`/`missing` from the box), `branch` (`ok`/`missing`),
   `push: "not_applicable"` and `gate`, `canPush` is `false`, `ok` requires `repo`, `branch` and
   `gate`, and **the route calls no provider**.
6. The existing sentences about `counts`, `DELETE`, the design route and the `404` stay; the
   `unique_violation` sentence is extended with "or a duplicate local `name`".

### Data

- Request keys: `mode` (`local` | `connect` | absent), `name`, `slug`, `defaultBranch`, `gate`,
  `policy`, `protectedPaths`.
- Response keys: the frozen `Repo` — `source`, `name`, `slug` (nullable), `defaultBranch`,
  `gate`, `policy`, `protectedPaths`, `enabled`, `createdAt`, `counts`.
- Verify check states: `ok`, `missing`, `not_applicable` (local) and today's `mismatch`,
  `forbidden` (github). `checks[].state` is a string in the contract, so no schema change.

## 🧩 Configuration

None. No `CB_*` key is added or renamed; `CB_REPO_ROOT` is read through the existing
`DaemonContext`. No migration, no dependency, no lockfile change.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Runner note (this batch, verbatim).** This batch runs on the operator's Windows host, where
  part of the `apps/daemon` project is red for reasons outside these tasks (POSIX modes, Unix
  tools). The cases below are all headless: the two local ports are injected fakes, so **no test
  in this task spawns git**. The full gate's authority is the Linux CI workflow
  (`.github/workflows/ci.yml`, `gh workflow run ci.yml --ref task-125`). Never use `npx` here;
  call `node node_modules/vitest/vitest.mjs run --project apps/daemon src/repos/`.
- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`.
  - `node node_modules/vitest/vitest.mjs run --project apps/daemon src/repos/`
  - `node node_modules/vitest/vitest.mjs run --project apps/daemon src/backlog/ src/design/
    src/sessions/ src/runs/` (the read paths Task-122 threaded; must stay green)
  - `npm run lint` and `npm run build` — both must pass.
  - `git diff --name-only main...task-125` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `service.test.ts`: a local create answers a `Repo` with `source: 'local'`,
    `slug === null`, `name === 'widgets'`, `defaultBranch === 'main'`, `gate ===
    REPO_DEFAULTS.gate`, `policy === 'auto'`, `protectedPaths === []`, `enabled === true`; the
    injected `localInit` was called **once** with `{ name: 'widgets', defaultBranch: 'main' }`;
    the injected local verify and the provider fake were **never** called.
  - [ ] `[unit]` `service.test.ts`: the row exists — `test.store.repos.getLocalByName('widgets')`
    is not null — and a second create with the same name throws the store's
    `unique_violation`, surfaces as `409` at the route, and the second `localInit` is never
    called.
  - [ ] `[unit]` `service.test.ts`: `localInit` rejecting with
    `new WorkspaceError('git_failed', 'commit exited with code 1', 'commit', 1)` makes the create
    throw a `503 agent_unavailable` with `details.reason === 'workspace_unavailable'`, leaves
    **no row** (`test.store.repos.list()` unchanged), and logs `repo_create_failed` with the
    name and `code: 'git_failed'` and **no path**.
  - [ ] `[unit]` `service.test.ts`: `{ mode: 'connect', slug: 'acme/x' }` throws `409` with
    `details.reason === 'github_app_installed_required'`, writes no row and calls no port;
    `{ slug: 'acme/x' }` (no mode) still creates the github row it creates today and calls no
    port.
  - [ ] `[unit]` `service.test.ts`: verify on a local repo answers the four checks **in the
    order** `repo, branch, push, gate` with `push === 'not_applicable'`, `canPush === false`,
    `ok === true`; with `localVerify` answering `{ repo: 'missing', branch: 'missing' }` the
    answer is `ok: false` with the same order and still `200`; the provider fake's call count is
    **0** in both cases.
  - [ ] `[unit]` `service.test.ts`: verify on a github repo makes exactly today's single
    `verify` call and answers today's body (the existing case keeps passing verbatim).
  - [ ] `[unit]` `routes.test.ts`: `POST /v1/repos { mode:'local', name:'widgets' }` answers
    `201`, `Content-Type: application/json; charset=utf-8`, a body that `parseRepo` accepts, and
    no `slug` key with a value; `{ mode:'local', name:'../x' }` answers `422` with
    `details.path === 'repo.name'`; a duplicate answers `409` with
    `details.reason === 'unique_violation'`; `{ mode:'connect', slug:'acme/x' }` answers `409`
    with `details.reason === 'github_app_installed_required'`;
    `POST /v1/repos/{id}/verify` on a local row answers `200` with the four checks, and the
    injected provider fake's call count is `0`.
  - [ ] `[unit]` `grep -n "github.com" apps/daemon/src/repos/service.ts` prints only the
    `GIT_HOST` constant, and `grep -n "https://github.com/" apps/daemon/src/repos/service.ts`
    prints nothing.
  - [ ] `[unit]` `grep -n "createBody" apps/daemon/src/repos/routes.ts` prints nothing (the local
    const is gone), and `grep -n "createRepoBodySchema" apps/daemon/src/repos/routes.ts` prints
    the import and the one call.
  - [ ] `[unit]` `docs/api.md` §5.2 carries the six frozen facts above, and
    `git diff main...task-125 -- docs/api.md` changes nothing outside `### 5.2 … ### 5.3`
    (the spec's QA check: slice both versions between `### 5.2` and `### 5.3` and require every
    other section to be byte-identical).
  - [ ] `[unit]` lint, the two named Vitest targets and the build pass.
  - [ ] `[live]` **unmeasured on this host, handed to an `agent-review` issue:** on the box,
    `curl -sS -X POST $CB/v1/repos -H "authorization: Bearer $TOKEN" -d '{"mode":"local",
    "name":"smoke"}'` answers `201` with `"source":"local"` and `"slug":null`, and
    `ls -d /srv/codebox/repos/smoke/.git` exists; a second identical `curl` answers `409` with
    `"reason":"unique_violation"` and `ls` still shows one directory. Measurement: the two
    bodies, the two statuses and the one directory.

## 📣 Coordination

- **For Task-126:** the create answer is `Repo` with `source: 'local'`, `name`, `slug: null`;
  the body is `{ mode: 'local', name }`; a duplicate is `409` with
  `details.reason = "unique_violation"` and a bad name is `422` with `details.path =
  "repo.name"`. The row's verify has no push affordance to offer — `canPush` is `false` and
  `push` is `not_applicable`.
- **For Batch 35 / Task-128:** `mode: 'connect'` is already routed and already refuses with
  `github_app_installed_required`; Task-128 replaces that refusal with the installation check
  and the `source: 'github'` row. `store.repos.getLocalByName` is the duplicate accessor if a
  friendly message is needed; the unique index is the gate.
- **For Batch 35 / Task-129:** the local row's default branch is the one `initLocal` created, so
  a fast-forward merge has a branch to move.
- **For the Architect:** `apps/daemon/README.md` is *not* in this task's paths because no file is
  added, renamed or deleted under `apps/daemon/src`; the item's `README.md` line is satisfied by
  that fact rather than by an edit. Wave 1 (Task-122) left a two-line `slug === null` guard at
  the top of `verify()` so the tree compiled before this task existed; this task replaces that
  guard with the local branch above.
- **Measured, not this task:** a **run** of a work on a local repository still fails in
  `preparing` (`workspace_error`): `ensureClone` clones from `CB_REPO_ROOT/<name>` into a cache
  path derived from a slug, and this batch ships no local run path. Recorded here so nobody
  reads it as a regression of this task.

## ⛔ Out of scope

- No new route, no `/remote`, no `/github/repositories`, no merge change (Batch 35).
- No app change (`features/repos/**` is Task-126), no `docs/app.md`, no `docs/jobs.md`, no
  `docs/security.md`, no decision record.
- No migration and no store change: the row shape is Task-123's.
- No `packages/workspaces` change: `initLocal` is Task-124's, called as it is.
- No change to `REPO_DEFAULTS`, to the list cursor, to `PATCH`/`DELETE`, or to the design and
  backlog routes.
- No new dependency, no lockfile edit, no reformatting of `service.ts`/`routes.ts` beyond the
  lines named.

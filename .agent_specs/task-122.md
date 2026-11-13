# Spec: Task-122 — The contract admits a repository with no remote

> The spec is the subagent's entire world. Anything not written here does not exist.

## 🎯 Scope

- **Task type:** package (`packages/contracts`) + daemon (`apps/daemon/src`) + docs
  (`docs/decisions.md`). A contract cut: no new route, no new page, no new screen, no frame, no
  migration, no new dependency.
- **Role:** Dev.
- **Objective:** a repository can be described, parsed and addressed without a GitHub remote.
  `repoSchema` carries `source` (`local` | `github`), `name` (the folder-safe identity) and a
  **nullable** `slug`; `createRepoBodySchema` exists in the contract and accepts both a local
  create (`{ mode: 'local', name }`) and today's connect body; one daemon function,
  `repoRefOf(repo, repoRoot)`, is the only place a repository becomes a workspace coordinate,
  and the five read paths that used to build `https://github.com/<slug>.git` ask it instead, so
  a local repository can never build a `github.com` URL. `docs/decisions.md` gains **D62**.
  Nothing a client can see changes for a GitHub repository.
- **Environment:** worktree `../wt-cb-122`, branch `task-122`, base `main` at `61ebc8b`.
- **Dependencies:** none. `repoSchema` and `slugSchema` are merged (Task-03), the five daemon
  read paths are merged, and Task-118 froze `parseRunEventPage` in the same package. No
  batch-mate produces any file this task reads: Task-123 (the migration), Task-124
  (`packages/workspaces/src/local.ts`), Task-125 (`apps/daemon/src/repos/**`) and Task-126
  (`apps/app/src/app/features/repos/**`) are all cut **after** this task merges.

### Batch position (Batch 34)

- **Wave 1 of 4 — the only task in it.** Task-123 and Task-124 branch from the merged
  `task-122`; Task-125 branches from the merged 122–124; Task-126 from the merged 125. Every
  later task types against the names frozen below, so a rename here is a whole-batch cost.
- Hot-file holder in this batch: `packages/contracts/src/index.ts`. **This task does not hold
  `docs/api.md`** — that section has exactly one writer in the batch (Task-125), and this spec
  resolves the item's `§5.2` line accordingly (see Coordination).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No task in the same
wave claims any of them, and the two paths marked *forced addition* are the only ones a later
wave also writes (it replaces exactly the lines named here).

- `packages/contracts/src/primitives.ts` — `nameSchema` and its `RepoName` type only
- `packages/contracts/src/resources.ts` — `REPO_SOURCES`, `repoSourceSchema`,
  `repoObjectSchema`, `repoSchema`, `repoDetailSchema`, `createRepoBodySchema`, `CreateRepoBody`
- `packages/contracts/src/resources.test.ts`
- `packages/contracts/src/openapi.ts`
- `packages/contracts/src/openapi.test.ts`
- `packages/contracts/src/index.ts` — **hot file, this task is the only holder in the batch**
- `apps/daemon/src/run/engine.ts` — `repoRefOf` and its two types, nothing else
- `apps/daemon/src/run/engine.test.ts`
- `apps/daemon/src/runs/service.ts` and `apps/daemon/src/runs/service.test.ts`
- `apps/daemon/src/sessions/service.ts` and `apps/daemon/src/sessions/sessions.test.ts`
- `apps/daemon/src/backlog/service.ts` and `apps/daemon/src/backlog/service.test.ts`
- `apps/daemon/src/design/service.ts` and `apps/daemon/src/design/service.test.ts`
- `docs/decisions.md` — **the D62 row and nothing else**; no other row, no other section
- `apps/daemon/src/repos/service.ts` — **forced addition, two lines** (see Coordination): the
  nullable `slug` makes `verifyPort().verify(repo.slug)` a type error and no other task in the
  batch can fix it in time. Task-125 replaces these two lines with the local path.
- `apps/app/src/app/features/repos/repos.page.ts` — **forced addition, one expression**
  (`repo.slug.toLowerCase()` at `:593`): the app build is part of `npm run build` on this host
  and a nullable `slug` breaks it. Task-126 rewrites the file.

Not touched, with the reason: `packages/contracts/README.md` and `apps/daemon/README.md` — both
map **files**, and this task adds, renames and deletes none.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/api.md` §5.2 (the documented `Repo`, the create body and the verify answer this task
  types against; Task-125 rewrites that section)
- `docs/decisions.md` (the table's shape, D47, D51, D59, D61)
- `packages/contracts/src/{pagination.ts,parse.ts,credentials.ts,routines.ts,works.ts}` (the
  house pattern for a resource module and a `z.ZodType<T>` export)
- `apps/daemon/src/{runs/errors.ts,sessions/errors.ts,run/ports.ts,modules.ts}` (the error
  envelope, the status set, `RunStartInput`)
- `apps/daemon/src/repos/service.ts`, `apps/daemon/src/repos/routes.ts` (read only except the
  two forced lines above)
- `apps/daemon/src/backlog/service.ts`, `apps/daemon/src/design/service.ts`,
  `apps/daemon/src/sessions/service.ts`, `apps/daemon/src/runs/service.ts`,
  `apps/daemon/src/run/engine.ts`
- `packages/workspaces/src/{index.ts,paths.ts,types.ts}`
- the directory listing of `apps/app/src/app/features/repos`

## 🔒 Contract

The public surface every later task in Batch 34 is written against **right now**. Exact names,
signatures and types.

### `packages/contracts/src/primitives.ts`

```ts
/** D62: the folder-safe identity of a repository. No separator, no traversal, 1–64 chars. */
export const nameSchema: z.ZodString = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
export type RepoName = z.infer<typeof nameSchema>;
```

### `packages/contracts/src/resources.ts`

```ts
export const REPO_SOURCES = ['local', 'github'] as const;
export const repoSourceSchema = z.enum(REPO_SOURCES);
export type RepoSource = z.infer<typeof repoSourceSchema>;

/**
 * The repository object without the cross-field rule: `openapi.ts` compiles it with
 * `z.toJSONSchema`, and the D62 rule (`a github repository has a slug`) is a refinement.
 */
export const repoObjectSchema = z.strictObject({
  id: RepoId,
  // Optional only so fixtures that predate D62 keep parsing; the daemon always sets both.
  source: repoSourceSchema.optional(),
  name: nameSchema.optional(),
  slug: slugSchema.nullable(),
  defaultBranch: branchSchema,
  gate: z.string().min(1),
  policy: repoPolicySchema,
  protectedPaths: z.array(globSchema),
  enabled: z.boolean(),
  createdAt: timestampSchema,
  counts: repoCountsSchema.optional(),
});
export type Repo = z.infer<typeof repoObjectSchema>;

/** `docs/api.md` §5.2. A `github` repository without a slug is refused. */
export const repoSchema: z.ZodType<Repo>;
export type RepoDetail = Repo & { readonly lastRun: Run | null };
export const repoDetailSchema: z.ZodType<RepoDetail>;

export type CreateRepoBody = {
  readonly mode?: 'local' | 'connect' | undefined;
  readonly name?: string | undefined;
  readonly slug?: string | undefined;
  readonly defaultBranch?: string | undefined;
  readonly gate?: string | undefined;
  readonly policy?: RepoPolicy | undefined;
  readonly protectedPaths?: readonly string[] | undefined;
};
/** `docs/api.md` §5.2. One strict body whose `mode` decides which of `name`/`slug` is required. */
export const createRepoBodySchema: z.ZodType<CreateRepoBody>;
```

- **The D62 refinement, exactly.** `repoSchema` and `repoDetailSchema` are
  `repoObjectSchema` (resp. `repoObjectSchema.extend({ lastRun: runSchema.nullable() })`) with
  one `superRefine` that reports `path: ['slug'], message: 'a github repository needs a slug'`
  when `source !== 'local'` and `slug === null`. A repository with `source` absent is a legacy
  github row and is subject to the same rule. `repoObjectSchema` stays refinement-free because
  `z.toJSONSchema` cannot express a cross-field rule; the OpenAPI `Repo` component is
  `repoObjectSchema` and the `RepoPage` component is `pageSchema(repoObjectSchema)`.
- **The create-body rule, exactly.** `createRepoBodySchema` is one `z.strictObject` with a
  `superRefine`, **not** a `z.union`: a union reports `invalid_union` at the empty path and
  Task-125 owes `422` with `details.path = "repo.name"`. The report is flat:
  - `mode === 'local'`: `name` is required (`path: ['name']`) and `slug` is forbidden
    (`path: ['slug']`, message `'a local repository has no remote'`).
  - `mode === 'connect'`: `slug` is required (`path: ['slug']`) and `name` is forbidden.
  - `mode` absent (the shipped app's body): `slug` is required, `name` is forbidden.
  - `mode` is **never defaulted**: the service must be able to tell an explicit `connect` (the
    new, installation-gated path) from a legacy `{ slug }` (today's path). That is why
    `CreateRepoBody['mode']` is optional rather than defaulted, and it is the one place this
    schema differs from the item's word "union".
- **Exports from `packages/contracts/src/index.ts`** (the primitives block gains `nameSchema`;
  the resources block gains `REPO_SOURCES`, `repoSourceSchema`, `repoObjectSchema`,
  `createRepoBodySchema`; the resources *type* block gains `RepoSource`, `RepoName`,
  `CreateRepoBody`). No existing name is removed or renamed. `repoSchema`, `repoDetailSchema`,
  `pageOfRepo`, `parseRepo`, `parseRepoDetail`, `parseRepoVerify` keep their names.
- **Errors:** every failure is a `ContractParseError` from `parseOrThrow`; the boundary is the
  caller's (`'repo'` in the daemon). `createRepoBodySchema` fails at
  `repo.name`, `repo.slug` or `repo.<extraKey>`; `repoSchema` fails at `repo.slug`.
- **Purity:** `primitives.ts` and `resources.ts` read no clock, filesystem, network or
  environment, and import no `node:` builtin. `repoRefOf` (below) is the daemon's, not theirs.

### `apps/daemon/src/run/engine.ts` — the one coordinate builder

```ts
export type DaemonRepoRef =
  | {
      readonly source: 'local';
      readonly name: string;
      readonly defaultBranch: string;
      /** `join(repoRoot, name)`: the folder the box owns. Never a URL. */
      readonly path: string;
    }
  | {
      readonly source: 'github';
      readonly slug: string;
      readonly defaultBranch: string;
      /** `https://github.com/<slug>.git`, byte for byte today's value. */
      readonly cloneUrl: string;
    };

/** D62. The only place in apps/daemon that knows how a repository is addressed. */
export function repoRefOf(repo: Repo, repoRoot: string): DaemonRepoRef;
```

- **Why it lives here.** The value is a daemon fact: the local arm needs `CB_REPO_ROOT`, which
  `packages/contracts` may not read (it ships to the browser), and `run/engine.ts` is the only
  module the five call sites already reach — four of them import `../runs/engine.js`, which
  re-exports from this file. It creates no new file, so no `apps/daemon/README.md` line moves.
  The second argument is explicit rather than read from the environment so the function stays
  testable without `process.env`.
- **Behaviour:** `source === 'local'` → `{ source: 'local', name, defaultBranch, path }`.
  `source === 'github'` (or absent) → `{ source: 'github', slug, defaultBranch, cloneUrl }`.
  A `local` repo with no `name`, or a github repo with `slug === null`, throws
  `WorkspaceError('invalid_root', …)` from `@codebox/workspaces` — the code the workspace
  package already uses for an unusable coordinate. The message never carries a path.
- **The URL literal exists exactly once in the five files named below**, inside `repoRefOf`.
  (`GIT_HOST = 'github.com'` in `sessions/service.ts` and `repos/service.ts` is a host, not a
  URL; `apps/daemon/src/app.ts`'s `form-action https://github.com` is the manifest flow's CSP
  and is untouched.)

### The five call sites (exact behaviour)

Each is the same edit: ask `repoRefOf(repo, repoRoot)` once, then branch on `source`.

- `apps/daemon/src/backlog/service.ts` — `createBacklogRuntime`'s `readSnapshot` computes the
  ref; `github` keeps today's two steps (`ensureClone(...)`, then `clonePath(repoRoot, slug)`);
  `local` skips `ensureClone` and runs the **same two git commands with `cwd = ref.path`**
  (`rev-parse refs/heads/<defaultBranch>`, then `show refs/heads/<defaultBranch>:TODO.md`). The
  `ensureClone` callback in `createBacklogService` builds its argument from `repoRefOf` and is
  only called for `github`.
- `apps/daemon/src/design/service.ts` — identical shape over `design/`.
- `apps/daemon/src/sessions/service.ts` — `repoRef(repo)` returns the workspaces `RepoRef`
  unchanged for `github`; for `local` `ensureWorktree` answers the existing
  `503 agent_unavailable` with `details.reason = "workspace_unavailable"` and logs
  `{ msg: 'session_workspace_unavailable', sessionId, reason: 'local_repo' }` at `warn`,
  before it touches a workspace. A local session worktree needs Task-124's
  `createLocalWorktree` wired by a later cut. `createProviderMergePort.merge` refuses a
  `slug === null` with the existing `502 provider_unavailable` (`details.reason =
  "provider_unavailable"`).
- `apps/daemon/src/runs/service.ts` — the `RunStartInput.repo` is built from the ref: `github`
  answers byte for byte what it answers today; `local` fills `slug` with the repository's
  `name` and `cloneUrl` with the box `path` (`run/ports.ts` is not this task's to widen, and a
  local run cannot reach `preparing` until a later cut, where it fails as `workspace_error`).
  The diff route's `Worktree.repoSlug` uses `ref.source === 'github' ? ref.slug : ref.name`.
- `apps/daemon/src/run/engine.ts` — only `repoRefOf` itself. `prepare()` already takes
  `cloneUrl` from its input and must not grow a second URL builder.

### Data

- `source`: `'local' | 'github'`; absent on a fixture that predates D62 and means `'github'`.
- `name`: 1–64 chars, `^[a-z0-9][a-z0-9._-]{0,63}$`; unique among `source: 'local'` rows
  (Task-123 owns the index) and derived from the slug for a github row.
- `slug`: `string | null`; `null` for a local repository with no remote; required when
  `source` is not `local`.
- `mode`: `'local' | 'connect' | undefined` in a create body; `undefined` is today's body.

## 🧩 Configuration

None. No `CB_*` key is added, read or renamed. `repoRefOf` receives `CB_REPO_ROOT` as an
argument from its caller; nothing parses the environment in a new place. No migration, no
dependency, no lockfile change.

### `docs/decisions.md` — write D62 exactly

Append below D61 as one table row, in the file's own column order (`| ID | Decision | Why /
consequence |`). The text is frozen; wrap it inside the row without changing a word:

```
| **D62** | **A repository is local first (2026-11-13).** A repository is a folder on the box,
created from a name alone — `CB_REPO_ROOT/<name>`, `git init -b <defaultBranch>` and one initial
commit that carries `TODO.md` — with no owner, no remote and no network. `Repo.source` is
`local` or `github`; `Repo.name` is the folder-safe identity (`^[a-z0-9][a-z0-9._-]{0,63}$`,
unique among local repositories); `Repo.slug` is the **remote coordinate**, nullable and `null`
until a remote exists. A remote is added later and never required: either an existing repository
of the installed GitHub App is connected, or the local repository is pushed into an **empty**
remote the operator created. A GitHub App installation token cannot create repositories, so
"push to GitHub" always starts from an operator-created empty repository (`[?] L9`, not
scheduled). | The box is the durable unit and the VM is disposable, so requiring a GitHub account
before the first backlog item inverted the product: the operator had to create a remote to get a
`TODO.md` the box then cloned back. One contract with an optional remote also collapses "create"
and "connect" into one flow with two sources, and it is the only shape that works before the App
has an installation. Consequences: `slug` is nullable in the contract and in the `repos` table,
`source` and `name` are new columns (Task-123), `packages/workspaces` can initialise a repository
offline (Task-124), one `repoRefOf` is the only place a repository becomes a path or a URL, and
`POST /v1/repos/{id}/verify` answers `push: not_applicable` for a repository with no remote. |
```

- The row is the only change to the file. Do not renumber, do not touch D50/D51/D59, do not add
  a heading, do not reformat the table.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing
else is not a criterion.

- **Runner note (this batch, verbatim).** This batch runs on the operator's Windows host, where
  the full `npm test` is not green for reasons outside these tasks: part of the `apps/daemon`
  project asserts POSIX modes or spawns Unix tools, and the `ops` project hangs (>300 s). The
  full gate's authority is the Linux CI workflow (`.github/workflows/ci.yml`, run with
  `gh workflow run ci.yml --ref task-122`); the local commands below are the targeted Vitest
  projects plus `npm run lint`, `npm run test:app` and `npm run build`. Never use `npx` on this
  host (it hangs); call `node node_modules/vitest/vitest.mjs run --project <name> [filters]`.
- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `node node_modules/vitest/vitest.mjs run --project packages/contracts`
  - `node node_modules/vitest/vitest.mjs run --project apps/daemon src/backlog/ src/design/
    src/sessions/ src/runs/ src/run/`
  - `npm run test:app` — must be green apart from the pre-existing daemon/POSIX red that does
    not live in this project.
  - `npm run lint` and `npm run build` — both must pass (the build includes the app).
  - `git diff --name-only main...task-122` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `resources.test.ts` proves, with the existing `repo` fixture extended:
        `parseRepo({ ...repo, source: 'local', name: 'widgets', slug: null })` succeeds and
        answers `slug === null`; the same local repo **with** a slug also parses;
        `parseRepo({ ...repo, source: 'github', name: 'example' })` succeeds (the fixture's
        `slug: 'dani/example'`) and the same object with `slug: null` throws
        `ContractParseError` whose `first.path === 'repo.slug'`; `parseRepo` of a fixture with
        no `source` key still succeeds (a legacy row); `nameSchema` rejects `'../x'`, `'A/B'`,
        `''`, a 65-character string and `'-lead'`, and accepts `'widgets'`, `'a'`,
        `'my.repo_2-x'`.
  - [ ] `[unit]` `resources.test.ts` proves `createRepoBodySchema`: accepts
        `{ mode: 'local', name: 'widgets' }`; rejects `{ mode: 'local', slug: 'a/b' }` with
        `first.path === 'repo.slug'`; rejects `{ mode: 'local' }` at `repo.name`; accepts
        `{ mode: 'connect', slug: 'acme/widgets' }`; accepts a legacy `{ slug: 'acme/widgets' }`
        **with `mode` still `undefined` in the parsed output**; rejects `{ mode: 'connect' }` at
        `repo.slug`; rejects `{ slug: 'acme/widgets', name: 'widgets' }`; rejects an unknown key
        and names it.
  - [ ] `[unit]` `openapi.test.ts` proves: `Object.keys(buildOpenApiDocument().paths)` is still
        **67**; `components.schemas.Repo` carries `source` (`enum: ['local','github']`), `name`
        and `slug`, its `required` array does **not** contain `source` or `name`, and
        `JSON.stringify(components.schemas.Repo.properties.slug)` contains `null`; every `$ref`
        in the document resolves (the existing walker); `RepoPage` still resolves.
  - [ ] `[unit]` `engine.test.ts` proves `repoRefOf`: a github repo answers
        `{ source: 'github', slug, defaultBranch, cloneUrl: 'https://github.com/<slug>.git' }`;
        a local repo answers `path === join(repoRoot, 'widgets')` and **no** `cloneUrl` key; a
        github repo with `slug: null` throws `WorkspaceError` with code `invalid_root`; a local
        repo with no `name` throws the same.
  - [ ] `[unit]` `backlog/service.test.ts` proves a **local fixture reads its own file**: a
        `Repo` literal with `source: 'local'`, `name: 'widgets'`, `slug: null` served through an
        injected `GitRunner` fake answers a backlog parsed from that fake's `show` output, and
        both calls were issued with `cwd === join(CB_REPO_ROOT, 'widgets')` — the two commands in
        today's order (`rev-parse refs/heads/main`, `show refs/heads/main:TODO.md`). The
        `ensureClone` spy is **never** called. A github fixture still calls it once and runs both
        commands in the bare-cache path.
  - [ ] `[unit]` `design/service.test.ts` proves the same branch over `design/` with the same
        fake: a local repo's commands run in its own path and `ensureClone` is not called.
  - [ ] `[unit]` `sessions/sessions.test.ts` proves a `create` on a local repo answers `503`
        with `details.reason === 'workspace_unavailable'`, calls neither `ensureClone` nor
        `createWorktree`, and logs `session_workspace_unavailable` with `reason: 'local_repo'`.
  - [ ] `[unit]` `runs/service.test.ts` proves the start input: a github repo yields exactly
        today's `slug` and `cloneUrl`; a local repo yields `slug: 'widgets'` and
        `cloneUrl` equal to the box path, and no string in the input contains `github.com`.
  - [ ] `[unit]` `grep -rn "https://github.com/" apps/daemon/src/run/engine.ts
        apps/daemon/src/runs/service.ts apps/daemon/src/sessions/service.ts
        apps/daemon/src/backlog/service.ts apps/daemon/src/design/service.ts` prints **one**
        line, inside `repoRefOf`.
  - [ ] `[unit]` `grep -n "D62" docs/decisions.md` prints one line, and
        `git diff main...task-122 -- docs/decisions.md` shows exactly one added row and no
        other change.
  - [ ] `[unit]` `git diff --name-only main...task-122` lists only the exclusive paths above,
        and `docs/api.md` and `docs/jobs.md` are not among them.
  - [ ] `[unit]` lint, the two named Vitest targets, `npm run test:app` and the build pass.
  - [ ] `[live]` **unmeasured on this host, handed to an `agent-review` issue:** on the box, a
        repository whose row carries `source: 'local'` reads its backlog over
        `GET /v1/repos/{id}/backlog` with no outbound request — measured as: no `github.com`
        entry in `journalctl -u cbd -o cat` for the request's `requestId`, and the revision in
        the answer equal to `git rev-parse main` in `CB_REPO_ROOT/<name>`. Not reproducible
        until Task-125 creates such a row.

## 📣 Coordination

- **For the Architect / Orchestrator — two forced additions and one moved document.** The item
  gives this task `docs/api.md` §5.2, but the batch's hot-file paragraph gives that section
  exactly one writer (Task-125). This spec follows the batch rule: **Task-125 writes all of
  §5.2** and this task writes none of it. The nullable `slug` forces two out-of-item lines
  anyway, both owned by a later wave and both replaced there:
  `apps/daemon/src/repos/service.ts` (a two-line `slug === null` guard before the provider
  call — without it wave 1 does not compile) and
  `apps/app/src/app/features/repos/repos.page.ts` (`:593`, `(repo.slug ?? repo.name ??
  '').toLowerCase()`). Task-126 rewrites the second, Task-125 the first.
- **For QA:** no red is allowed in the suites named above. The `apps/daemon` project has
  pre-existing POSIX-only failures outside the five filters; do not fail this task on them and
  do not "fix" them here.
- **For Task-123:** `store.repos.create` receives a `Repo` that may omit `source` and `name`;
  derive `source = 'github'` and `name` from the slug (the part after `/`, lowercased,
  truncated to 64 chars) so every existing fixture keeps working, and refuse
  `source: 'local'` with no `name`.
- **For Task-124:** `repoRefOf` already computes `join(repoRoot, name)`. `localRepoPath` may
  re-implement it; the rule must be identical (schema-validated name, no traversal) and both
  are tested.
- **For Task-125:** import `createRepoBodySchema`, `CreateRepoBody`, `repoObjectSchema` and
  `nameSchema` from `@codebox/contracts`; do not re-declare a create body in `routes.ts`.
  A `mode` that is `undefined` is the legacy body and keeps today's behaviour; an explicit
  `mode: 'connect'` is the installation-gated path.
- **For Task-126:** `Repo.slug` is `string | null` and `Repo.source`/`Repo.name` are optional
  on the type (the daemon always sets them). Parse with `parseRepo`/`parsePage(repoSchema, …)`
  as today; do not hand-roll a second repository shape.
- **For the next batch:** `repoRefOf(repo, repoRoot)` is the only coordinate builder. Task-128's
  connect/push and Task-129's local merge must call it rather than interpolate a URL.
- **Measured, not this task:** `repoVerifySchema` is untouched; `push: 'not_applicable'` already
  parses because `checks[].state` is `z.string().min(1)`. Task-125 owns the value.

## ⛔ Out of scope

- No migration, no store change, no SQL (Task-123), no `packages/workspaces` change (Task-124),
  no `apps/daemon/src/repos/**` feature change beyond the two guarded lines (Task-125), no
  `apps/app/src/app/features/repos/**` change beyond the one expression (Task-126).
- No new route, no new OpenAPI path (the pin stays 67), no request body registered in the
  document for `createRepo`.
- No change to `docs/api.md`, `docs/jobs.md`, `docs/security.md`, `design/` or `TODO.md`.
- No behaviour change for a GitHub repository: same CLI answer, same store rows, same log lines.
- No new `CB_*` key, no dependency, no lockfile edit, no README map edit (no file is added,
  renamed or deleted).

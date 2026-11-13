# Spec: Task-124 — A local repository is born offline

> The spec is the subagent's entire world. Anything not written here does not exist.

## 🎯 Scope

- **Task type:** package (`packages/workspaces`). Filesystem and git, no network, no clock of its
  own, no daemon, no HTTP.
- **Role:** Dev.
- **Objective:** `packages/workspaces` can create a repository from a name alone. `initLocal`
  makes `CB_REPO_ROOT/<name>` a normal (non-bare) git repository on the requested default branch,
  with one initial commit that carries a minimal `TODO.md` (the backlog root, D51) and nothing
  else — no remote, no credential, no network — and `createLocalWorktree` cuts a worktree from
  that repository's default branch exactly as `createWorktree` cuts one from a clone. A name that
  could escape `CB_REPO_ROOT` is refused before a single process starts, and a second
  `initLocal` for the same name fails without touching the tree.
- **Environment:** worktree `../wt-cb-124`, branch `task-124`, base `main` at `61ebc8b`
  **plus Task-122 merged** (wave 1).
- **Dependencies:** Task-122 (merged) — it froze the shape of `Repo.name`
  (`^[a-z0-9][a-z0-9._-]{0,63}$`, 1–64 chars) that `localRepoPath` mirrors. Merged and read-only
  here: `createGitRunner`, `GIT_ENV`, `runGit`, `createWorkspaceContext`, `writeMarkerAt`,
  `pathExists`, `isDirectory`, `removePath`, `branchName`, `worktreePath`, `WorkspaceError` and
  `gitFailure` from this same package. Task-123 is cut in parallel and touches only
  `packages/store/**`; Task-125 (which calls `initLocal`) is cut after this task merges.

### Batch position (Batch 34)

- **Wave 2 of 4, in parallel with Task-123.** Both branch from the merged `task-122`; the two
  path sets are disjoint (`packages/workspaces/**` here, `packages/store/**` there) and neither
  reads a file the other produces. Task-125 consumes `initLocal` from the merged wave 2.
- No hot file is claimed by this task: it touches no root manifest, no routes file, no
  `apps/daemon/src/main.ts`, no `contracts/src/index.ts`, no migration.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `packages/workspaces/src/local.ts` (new)
- `packages/workspaces/src/local.test.ts` (new)
- `packages/workspaces/src/index.ts` — **one export block and its types only**; the existing
  re-exports do not move
- `packages/workspaces/README.md` — two lines under `src/` (the two new files)

The item says "one export line": a block of four functions and three types is written here
because `index.ts` groups one exported block per module — the units are the same.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `packages/workspaces/src/{git.ts,worktree.ts,paths.ts,types.ts,errors.ts,clone.ts}`
- `packages/workspaces/src/{worktree.test.ts,git-real.test.ts,clone.test.ts,paths.test.ts}` (the
  house test style, the real-git pattern and the temporary-directory rule)
- `packages/workspaces/README.md`
- `packages/contracts/src/primitives.ts` — `nameSchema` (read for the rule; see the note below on
  why the pattern is re-declared instead of imported)
- `docs/decisions.md` D9, D51, D62
- `docs/jobs.md` §4 (the run marker) and §7 (the cache/worktree layout)

## 🔒 Contract

The public surface Task-125 and the later local-run task are written against **right now**.

```ts
// packages/workspaces/src/local.ts
import type { GitRunner, Worktree } from './types.js';

/** The backlog root a local repository is born with (`TODO.md`), byte for byte. */
export const INITIAL_BACKLOG: string;

export interface InitLocalOptions {
  readonly repoRoot: string;
  /** D62 identity: `^[a-z0-9][a-z0-9._-]{0,63}$`. Anything else is refused. */
  readonly name: string;
  readonly defaultBranch: string;
  /** Defaults to `createGitRunner()`. */
  readonly git?: GitRunner;
  /** Defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

export interface LocalRepo {
  readonly name: string;
  /** `join(repoRoot, name)`; the working tree the box owns. Never a URL. */
  readonly path: string;
  readonly defaultBranch: string;
  /** The initial commit: `git rev-parse HEAD` after the one commit. */
  readonly headSha: string;
}

/** Pure. Refuses a name that could escape the root before any process starts. */
export function localRepoPath(repoRoot: string, name: string): string;

export function initLocal(options: InitLocalOptions): Promise<LocalRepo>;

export interface CreateLocalWorktreeOptions {
  readonly workspaceRoot: string;
  readonly repo: Pick<LocalRepo, 'name' | 'path' | 'defaultBranch'>;
  readonly runId: string;
  readonly title: string;
  /** Defaults to `repo.defaultBranch`. */
  readonly baseRef?: string;
  readonly git?: GitRunner;
  readonly now?: () => Date;
  readonly httpTimeoutSeconds?: number;
}

export function createLocalWorktree(options: CreateLocalWorktreeOptions): Promise<Worktree>;
```

- **`INITIAL_BACKLOG` is exactly** (25 + the trailing newline, no CRLF, no BOM):

  ```
  # Backlog

  One item per line, in the order the repository works through them.
  ```

  `parseBacklog(INITIAL_BACKLOG)` answers `{ sections: [], items: [], duplicateRefs: [] }`: the
  repository opens on an empty backlog, not on a broken one. The file is the backlog root D51
  names, and it is the **only** tracked file after `initLocal`.
- **`localRepoPath`** validates `repoRoot` is absolute and `name` against
  `^[a-z0-9][a-z0-9._-]{0,63}$`, then returns `join(repoRoot, name)`; otherwise
  `WorkspaceError('invalid_root', 'invalid repository name', null, null)` (or `'repository root
  must be absolute'`). `'../x'`, `'a/b'`, `'a\\b'`, `'.'`, `'..'`, `''` and `'C:x'` are refused
  with that code. **The pattern is re-declared in `local.ts`, not imported from
  `@codebox/contracts`**: this package imports contracts type-only (`contracts/dist` does not
  exist when `npm test` runs) and the README's purity check enforces it. The comment on the
  constant says it mirrors `nameSchema` in `packages/contracts/src/primitives.ts`.
- **`initLocal` command sequence**, in this order, every call through `runGit` (so `GIT_ENV`
  applies and no invocation can carry a URL, a token or a shell):
  1. `localRepoPath(repoRoot, name)` — before anything else.
  2. `pathExists(path)` → `WorkspaceError('worktree_exists', 'repository directory already
     exists', null, null)`. It never reuses, repairs or overwrites a directory.
  3. `mkdir(repoRoot, { recursive: true })`; a failure is
     `diskFailure('repository root could not be created')`.
  4. `mkdir(path)`; a failure is `diskFailure('repository directory could not be created')`.
  5. `git init -b <defaultBranch>` in `cwd = path`; a non-zero exit is
     `gitFailure('init', code, 'git_failed')`.
  6. write `INITIAL_BACKLOG` to `join(path, 'TODO.md')` as UTF-8; a failure is
     `diskFailure('initial backlog could not be written')`.
  7. `git add -- TODO.md` in `cwd = path`; non-zero → `gitFailure('add', code, 'git_failed')`.
  8. `git -c user.name=codebox[bot] -c user.email=codebox@users.noreply.github.com commit
     --no-verify -m 'Initial commit'` in `cwd = path` — the identity travels as `-c` arguments
     because `GIT_ENV` is fixed and carries no global git identity (`run/commit.ts` does the
     same). Non-zero → `gitFailure('commit', code, 'git_failed')`.
  9. `git rev-parse HEAD` → `headSha`; non-zero or empty → `gitFailure('rev-parse', code,
     'git_failed')`.
  10. Answer `{ name, path, defaultBranch, headSha }`.
- **`createLocalWorktree` mirrors `createWorktree`** (`packages/workspaces/src/worktree.ts`)
  step for step, with the local repository playing the part of the bare cache:
  1. `isDirectory(workspaceRoot)` → else `diskFailure('workspace root is missing')`.
  2. `branch = branchName(runId, title)`; `target = worktreePath(workspaceRoot, runId)`.
  3. `pathExists(target)` → `WorkspaceError('worktree_exists', 'worktree already exists', null,
     null)`.
  4. `baseRef = options.baseRef ?? repo.defaultBranch`; `git rev-parse <baseRef>` in
     `cwd = repo.path` → `baseSha`; non-zero → `gitFailure('rev-parse', code,
     'worktree_failed')`.
  5. `git worktree add -b <branch> <target> <baseSha>` in `cwd = repo.path`; non-zero →
     `removePath(target)` then `gitFailure('worktree', code, 'worktree_failed')`.
  6. `writeMarkerAt(...)` the run marker into the new worktree with
     `{ runId, repoSlug: repo.name, branch, baseRef, baseSha, promptHash: '', createdAt:
     now().toISOString() }` — the same content `createWorktree` writes, at the same
     `git rev-parse --git-path` location.
  7. Answer `{ runId, repoSlug: repo.name, path: target, branch, baseRef, baseSha }`.
- **`writeMarkerAt` needs a `WorkspaceContext`.** Build one with `createWorkspaceContext({
  repoRoot: repo.path, workspaceRoot, git, matchesGlob: () => false, cloneDepth: 0,
  httpTimeoutSeconds, now })` and say why in a comment: `writeMarkerAt` reads only
  `options.now` and the timeout, and `matchesGlob`/`cloneDepth` belong to `status`/`cleanup`,
  which this module never calls. `httpTimeoutSeconds` defaults to `120`.
- **Purity and safety:** no `process.env` read, no clock of its own (`now` is a parameter), no
  network, no credential, no `shell: true`. No error message carries a path, an argument list or
  git's `stderr` (`WorkspaceError`'s contract already says so).
- **Ordering:** a refusal (`invalid_root`, `worktree_exists`) leaves the disk exactly as it was;
  a git failure leaves at most an empty directory the caller can inspect — `initLocal` never
  removes what it did not fully create, because a partially created repository is a fact the
  operator must see, not a silent retry.

### Data

- `TODO.md`: `INITIAL_BACKLOG` (frozen above) at `<path>/TODO.md`, the only tracked file.
- Commit: one, subject `Initial commit`, author `codebox[bot]`
  `<codebox@users.noreply.github.com>`, on the requested default branch.
- Run marker (`codebox-run.json`): `{ runId, repoSlug: name, branch, baseRef, baseSha,
  promptHash: '', createdAt }` — the same seven fields `createWorktree` writes.

## 🧩 Configuration

None. This task adds and reads no `CB_*` key: `repoRoot` and `workspaceRoot` arrive as arguments
from the daemon, which owns `CB_REPO_ROOT`/`CB_WORKSPACE_ROOT`. No dependency, no lockfile
change.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Runner note (this batch, verbatim).** This batch runs on the operator's Windows host.
  `GIT_ENV.PATH` in `packages/workspaces/src/git.ts` is a POSIX path list, so a case that spawns
  **real** git is red here for a reason outside this task; write those cases with
  `it.skipIf(process.platform === 'win32')` and a comment naming `GIT_ENV.PATH`, and measure
  them in the Linux CI run (`.github/workflows/ci.yml`, `gh workflow run ci.yml --ref
  task-124`), which is the authority for the full gate. Everything asserted through an injected
  `GitRunner` must be green on both hosts. Never use `npx` here; call
  `node node_modules/vitest/vitest.mjs run --project packages/workspaces`.
- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`.
  - `node node_modules/vitest/vitest.mjs run --project packages/workspaces`
  - `npm run lint` and `npm run build` — both must pass.
  - `git diff --name-only main...task-124` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `localRepoPath` is pure and refuses `'../x'`, `'a/b'`, `'a\\b'`, `'.'`, `'..'`,
        `''` and `'C:x'` with `WorkspaceError.code === 'invalid_root'`, and answers
        `join(repoRoot, 'widgets')` for `'widgets'`; a relative `repoRoot` is refused with the
        same code.
  - [ ] `[unit]` through a recording fake `GitRunner` whose answers are fixed, `initLocal`
        issues exactly this sequence of argument lists, in this order:
        `['init','-b','main']`, `['add','--','TODO.md']`,
        `['-c','user.name=codebox[bot]','-c','user.email=codebox@users.noreply.github.com',
        'commit','--no-verify','-m','Initial commit']`, `['rev-parse','HEAD']` — every call with
        `cwd === join(repoRoot, name)`, and **no** argument anywhere contains `://`, `github`,
        `@` or a token-shaped string.
  - [ ] `[unit]` `initLocal` returns `headSha` equal to the fake's `rev-parse HEAD` stdout,
        `path === join(repoRoot, name)` and the requested `defaultBranch`; a `git init` that
        exits non-zero throws `WorkspaceError.code === 'git_failed'` with `command === 'init'`;
        the same for `add` and `commit`.
  - [ ] `[unit]` a second `initLocal` with the same name (a directory already present) throws
        `WorkspaceError.code === 'worktree_exists'` and the recording runner receives **no
        call**: the tree is never touched.
  - [ ] `[unit]` the seeded file is `INITIAL_BACKLOG` byte for byte: a fake-runner case writes
        the file and asserts `readFile(join(root, 'widgets', 'TODO.md'), 'utf8') ===
        INITIAL_BACKLOG`, and `INITIAL_BACKLOG` ends with exactly one `\n` and contains no `\r`.
  - [ ] `[unit]` `createLocalWorktree` with a recording runner issues
        `['rev-parse','main']` then `['worktree','add','-b','cb/<runId>-<slug>',<target>,
        <sha>]` with `cwd === repo.path`, answers
        `{ runId, repoSlug: name, path: target, branch, baseRef, baseSha }`, and throws
        `WorkspaceError.code === 'worktree_exists'` when the target already exists (again with
        no runner call).
  - [ ] `[unit]` **against a real git** (`it.skipIf(process.platform === 'win32')`, measured in
        the Linux CI run): `initLocal` on `main` yields a repository where `git rev-list --count
        HEAD` is `1`, `git symbolic-ref --short HEAD` is `main`, `git ls-files` prints exactly
        `TODO.md`, `git remote` prints nothing, and `createLocalWorktree` yields a directory
        whose `git rev-parse HEAD` equals the `headSha` `initLocal` answered.
  - [ ] `[unit]` `git grep -nE "process\\.env" -- packages/workspaces/src` prints nothing and
        `git grep -nE "from '@codebox/(contracts|core)'" -- packages/workspaces/src` shows only
        `import type` lines — the two README purity checks still hold.
  - [ ] `[unit]` `packages/workspaces/README.md` names `local.ts` and `local.test.ts`, and no
        other line of the README moves.
  - [ ] `[unit]` `git diff --name-only main...task-124` lists only the four exclusive paths.
  - [ ] `[unit]` lint, the `packages/workspaces` project and the build pass.
  - [ ] `[live]` **unmeasured on this host, handed to an `agent-review` issue:** on the box,
        `initLocal` creates `/srv/codebox/repos/<name>` with one commit and no remote —
        measured as `git -C /srv/codebox/repos/<name> log --oneline | wc -l` = 1,
        `git -C … remote` empty, and no outbound connection during the call. Not reproducible
        until Task-125 exposes it.

## 📣 Coordination

- **For Task-125:** call
  `initLocal({ repoRoot: config.CB_REPO_ROOT, name: body.name, defaultBranch: body.defaultBranch
  ?? 'main', git: createGitRunner() })` and answer the row afterwards; treat
  `WorkspaceError.code === 'worktree_exists'` and `'invalid_root'` as the same
  `503 agent_unavailable` / `details.reason = "workspace_unavailable"` the design route already
  uses. Do not re-implement the path or the seeded file.
- **For the later local-run task (not in this batch):** `createLocalWorktree` is the local
  counterpart of `createWorktree` and already writes the run marker, so the run engine's
  `prepare()` needs a `source: 'local'` branch, not a new marker format. Nothing wires it in
  Batch 34: Task-129 merges a local session and the next cut runs a work from a local repo.
- **For Task-129 / the next cut:** a local repository is a **normal** repository, so
  `git worktree add`, `git merge --ff-only` and `git push` are the operations available; there is
  no bare cache to refresh and no `origin` until Task-128 adds one.
- **For the Architect:** this task ships one export (`createLocalWorktree`) with no caller in the
  batch — the item asks for it, its acceptance tests it, and the wiring is a later cut. Recorded
  so the review does not read it as dead code.
- **Measured, not this task:** `ensureClone` is untouched; a local repository is never cloned,
  because it already is the working tree the box owns.

## ⛔ Out of scope

- No change to `clone.ts`, `worktree.ts`, `status.ts`, `cleanup.ts`, `paths.ts`, `git.ts` or
  `types.ts` — this module composes them, it does not edit them.
- No new `WorkspaceErrorCode`, no change to `GIT_ENV`, no `shell`, no remote, no credential, no
  `git push`, no fetch.
- No daemon, HTTP, store, app or docs change; no README map line outside the two new files.
- No new dependency, no lockfile edit, no migration.

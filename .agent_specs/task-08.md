# Spec: Task-08 — Workspaces

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (I/O: `node:child_process` for git through an injected runner,
  `node:fs` for directories and disk).
- **Role:** Dev.
- **Objective:** after this task, `@codebox/workspaces` owns the on-disk side of a run: the
  bare clone cache under `CB_REPO_ROOT` (cloned atomically, fetched not re-cloned), one
  worktree per run under `CB_WORKSPACE_ROOT` on a `cb/<runId>-<slug>` branch, its run marker,
  an exact `git diff` stat and changed-file list that the gate and the guardrails consume, the
  D26 protected-path hits, and retention cleanup that never touches the cache or a directory
  this package did not create. Every git call goes through an injectable `GitRunner`, so the
  package is provable headless.
- **Environment:** worktree `../wt-cb-08`, branch `task-08`, base `main`.
- **Dependencies (merged on `main`; read these, do not re-implement them):**
  - Task-03 — `packages/contracts/src/resources.ts` (`diffStatSchema`, `changedFileSchema`,
    `runDiffSchema`, types `RunDiff`), `packages/contracts/src/primitives.ts`
    (`branchSchema`, `commitShaSchema`).
  - Task-05 — `packages/core/src/protected-paths.ts` (`scanProtectedPaths`, `matchesGlob`,
    `normaliseRepoPath`, `ProtectedPathHit`, `DEFAULT_PROTECTED_PATHS`) and
    `packages/core/src/diff-budget.ts` (`DiffSize`) — consumed **by the daemon and the tests**,
    injected here as a matcher (see "Workspace imports" below).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `packages/workspaces/src/index.ts`
- `packages/workspaces/src/types.ts`
- `packages/workspaces/src/errors.ts`
- `packages/workspaces/src/git.ts`
- `packages/workspaces/src/paths.ts`
- `packages/workspaces/src/diff.ts`
- `packages/workspaces/src/clone.ts`
- `packages/workspaces/src/worktree.ts`
- `packages/workspaces/src/status.ts`
- `packages/workspaces/src/cleanup.ts`
- `packages/workspaces/src/index.test.ts`
- `packages/workspaces/src/paths.test.ts`
- `packages/workspaces/src/diff.test.ts`
- `packages/workspaces/src/clone.test.ts`
- `packages/workspaces/src/worktree.test.ts`
- `packages/workspaces/src/status.test.ts`
- `packages/workspaces/src/cleanup.test.ts`
- `packages/workspaces/src/git-real.test.ts`
- `packages/workspaces/README.md`
- `docs/architecture.md` (§ "Components" → the `packages/workspaces` subsection **only**)

### Inputs (read-only)

Beyond `AGENTS.md`:

- `docs/architecture.md` §2 (workspace manager bullets) and §5, `docs/jobs.md` §4 and §6,
  `docs/decisions.md` (D9, D25, D26), `docs/providers.md` §3 and §7.
- `packages/contracts/src/{resources,primitives,index}.ts`
- `packages/core/src/{protected-paths,diff-budget,index}.ts`
- `packages/store/src/{runs,migrations/0001_init.sql}` (read-only, for the run/branch column
  names you must not disagree with)
- `packages/workspaces/{package.json,tsconfig.json,README.md}`
- `vitest.config.ts`, `tsconfig.base.json`, `eslint.config.js`

## 🔒 Contract

Frozen public surface, re-exported exactly once from `src/index.ts`, grouped by module, in
this order.

**Three constraints before you write a line:**

1. **No new npm dependency, no `package.json` / `tsconfig` edit.** `node:child_process`,
   `node:fs`, `node:path`, `node:crypto`, `node:os` only.
2. **Workspace imports are type-only** (`import type … from '@codebox/contracts'`,
   `import type … from '@codebox/core'`). The root gate runs `npm test` **before**
   `npm run build`, so a sibling package's `dist/` does not exist during tests; a runtime
   workspace import in `src/**` breaks the fresh-clone gate. The glob semantics of D26 are
   **injected** as `GlobMatcher`, and only `src/*.test.ts` may import them from
   `../../core/src/protected-paths.js` (test files are excluded from `tsc`).
3. **Secrets never leave this package.** A clone URL carries an installation token; no git
   `stdout`/`stderr`, no command line and no URL ever reaches an error message, an error
   detail or a log. Only the git *subcommand* (`clone`, `fetch`, `worktree`, `diff`, …) and
   the numeric exit code may be reported.

```ts
// ---------- src/types.ts ----------
import type { RunDiff } from '@codebox/contracts';
import type { ProtectedPathHit } from '@codebox/core';

export interface RepoRef {
  readonly slug: string; // 'owner/name'
  readonly defaultBranch: string; // 'main'
  readonly cloneUrl: string; // https URL **with** the credential; never logged
}

export interface GitCommandInput {
  readonly args: readonly string[]; // without the leading 'git'
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly env: Readonly<Record<string, string>>;
}

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitRunner {
  run(input: GitCommandInput): Promise<GitResult>;
}

/** The D26 glob semantics, injected from `@codebox/core` (`matchesGlob`). */
export type GlobMatcher = (pattern: string, path: string) => boolean;

export interface WorkspaceManagerOptions {
  readonly repoRoot: string; // CB_REPO_ROOT, absolute
  readonly workspaceRoot: string; // CB_WORKSPACE_ROOT, absolute
  readonly git: GitRunner;
  readonly matchesGlob: GlobMatcher;
  readonly cloneDepth: number; // CB_CLONE_DEPTH, 0 = full
  readonly httpTimeoutSeconds: number; // CB_GIT_HTTP_TIMEOUT_SECONDS
  readonly now: () => Date; // retention clock, caller-owned
}

export interface CloneResult {
  readonly path: string;
  readonly created: boolean; // true only when this call cloned
  readonly headSha: string;
}

export interface CreateWorktreeInput {
  readonly repo: RepoRef;
  readonly runId: string; // 'run_01J…'
  readonly baseRef: string; // 'main'
  readonly title: string; // job title, only used for the branch slug
}

export interface Worktree {
  readonly runId: string;
  readonly repoSlug: string;
  readonly path: string; // absolute
  readonly branch: string; // 'cb/<runId>-<slug>'
  readonly baseRef: string;
  readonly baseSha: string;
}

export interface WorktreeInfo {
  readonly path: string;
  readonly runId: string | null; // null when the directory carries no run marker
  readonly repoSlug: string | null;
  readonly branch: string | null;
  readonly modifiedAt: string; // ISO 8601, from the directory mtime
  readonly bytes: number;
}

export interface RunMarker {
  readonly runId: string;
  readonly repoSlug: string;
  readonly branch: string;
  readonly baseRef: string;
  readonly baseSha: string;
  readonly promptHash: string;
  readonly createdAt: string; // from now()
}

export interface WorkspaceStatus {
  readonly branch: string;
  readonly baseSha: string; // = worktree.baseSha, the recorded base, never re-resolved
  readonly headSha: string;
  readonly commitsAhead: number;
  readonly dirty: boolean;
  readonly diff: RunDiff; // files/added/removed + changedFiles, contract shape
  readonly changedPaths: readonly string[]; // every path of the diff, normalised
  readonly protectedHits: readonly ProtectedPathHit[];
}

export interface CleanupOptions {
  readonly ttlHours: number; // CB_WORKSPACE_TTL_HOURS
}

export interface CleanupReport {
  readonly removed: readonly string[];
  readonly kept: number;
  readonly orphans: number; // directories without a run marker: never removed
  readonly bytesFreed: number;
}

export interface DiskUsage {
  readonly freeBytes: number;
  readonly totalBytes: number;
  readonly usedPercent: number; // (total - free) / total * 100, two decimals
}

export interface WorkspaceManager {
  ensureClone(repo: RepoRef): Promise<CloneResult>;
  createWorktree(input: CreateWorktreeInput): Promise<Worktree>;
  removeWorktree(worktree: Worktree): Promise<void>;
  listWorktrees(): Promise<readonly WorktreeInfo[]>;
  status(worktree: Worktree, protectedPaths: readonly string[]): Promise<WorkspaceStatus>;
  readRunMarker(worktree: Worktree): Promise<RunMarker | null>;
  writeRunMarker(worktree: Worktree, marker: RunMarker): Promise<void>;
  cleanup(options: CleanupOptions): Promise<CleanupReport>;
  diskUsage(): Promise<DiskUsage>;
}

export function createWorkspaceManager(options: WorkspaceManagerOptions): WorkspaceManager;

// ---------- src/errors.ts ----------
export type WorkspaceErrorCode =
  | 'invalid_root' // repoRoot/workspaceRoot not absolute, or nested inside each other
  | 'clone_failed'
  | 'fetch_failed'
  | 'worktree_failed'
  | 'worktree_exists'
  | 'worktree_missing'
  | 'not_a_worktree' // no run marker
  | 'git_failed' // any other non-zero git exit
  | 'disk_error'; // fs/statfs failure

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  readonly command: string | null; // git subcommand, never the argument list
  readonly exitCode: number | null;
  constructor(code: WorkspaceErrorCode, message: string, command: string | null, exitCode: number | null);
}

// ---------- src/git.ts ----------
export const GIT_ENV: Readonly<Record<string, string>>; // { PATH, HOME, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
export function createGitRunner(): GitRunner; // node:child_process, no shell, killSignal SIGKILL

// ---------- src/paths.ts (pure, no I/O) ----------
export const BRANCH_PREFIX = 'cb/';
export const RUN_MARKER_FILENAME = 'codebox-run.json';
export const SLUG_MAX_LENGTH = 40;

export function slugifyTitle(title: string, maxLength?: number): string;
export function branchName(runId: string, title: string): string;
export function clonePath(repoRoot: string, slug: string): string;
export function worktreePath(workspaceRoot: string, runId: string): string;

// ---------- src/diff.ts (pure, no I/O) ----------
export interface NumstatEntry {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}
export interface NameStatusEntry {
  readonly path: string;
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export function parseNumstat(stdout: string): readonly NumstatEntry[];
export function parseNameStatus(stdout: string): readonly NameStatusEntry[];
export function buildRunDiff(
  numstat: readonly NumstatEntry[],
  nameStatus: readonly NameStatusEntry[],
): RunDiff;
```

### Rules the implementation must obey

- **Paths (frozen naming, D9 and `docs/architecture.md` §2):**
  - cache: `<repoRoot>/<owner>__<name>.git` — `clonePath('srv/repos', 'acme/web')` →
    `srv/repos/acme__web.git`. A slug that is not exactly one `owner/name` is
    `WorkspaceError('invalid_root')`.
  - worktree: `<workspaceRoot>/<runId>` — one directory per run, never reused, never nested.
  - branch: `cb/<runId>-<slug>`. `slugifyTitle` lowercases, replaces every run of
    non-`[a-z0-9]` with `-`, trims leading/trailing `-`, truncates to `maxLength` (40) without
    ending in `-`, and returns `'run'` for an empty result. The branch must satisfy
    `branchSchema` (no whitespace, no `..`) — assert it in a test for a hostile title
    (`'Fix: ../etc/passwd  '` → `cb/run_x-fix-etc-passwd`).
  - run marker: the path git reports for `codebox-run.json` inside the worktree, i.e.
    `git -C <worktree> rev-parse --git-path codebox-run.json`; JSON, 2-space indent, one
    trailing newline. (A linked worktree's `.git` is a file, so the literal
    `<worktree>/.git/codebox-run.json` of `docs/jobs.md` §4 is written at its resolved git
    path. Say so in the `docs/architecture.md` subsection you own; do **not** edit
    `docs/jobs.md`.)
- **`ensureClone`:** create `repoRoot` recursively. If the cache directory exists → one
  `git -C <cache> fetch --prune origin` (plus `--depth <n>` when `cloneDepth > 0`), then
  `git -C <cache> rev-parse refs/heads/<defaultBranch>`; `created: false`. Otherwise clone
  into `<repoRoot>/.clone-<random>` with `git clone --bare [--depth <n>] <cloneUrl> <tmp>`,
  then `rename(tmp, cache)`. On a non-zero exit: `rm -rf <tmp>` and throw
  `WorkspaceError('clone_failed', …, 'clone', code)` — **no half directory may remain**, no
  `cache` directory may be created, and no other cache entry may be touched. If the rename
  loses a race (`EEXIST`/`ENOTEMPTY`), delete the temp directory and return the winner with
  `created: false` after a `fetch`. A failed `fetch` is `WorkspaceError('fetch_failed')` and
  leaves the cache as it was.
- **`createWorktree`:** `workspaceRoot` must exist. Refuse an existing target with
  `WorkspaceError('worktree_exists')`. Resolve `baseSha` with
  `git -C <cache> rev-parse <baseRef>`, then
  `git -C <cache> worktree add -b <branch> <path> <baseSha>`, then write the run marker. Two
  worktrees of one cache always have different `path` values and different branches. Any git
  failure is `worktree_failed`; a failed creation removes the target directory if git left one
  behind.
- **`removeWorktree`:** `git -C <cache> worktree remove --force <path>`, then
  `git -C <cache> worktree prune`. The cache directory and everything outside `path` stay
  untouched. A missing path is not an error (prune, return). Never `rm -rf` a path that is not
  exactly `worktreePath(workspaceRoot, runId)`.
- **`status(worktree, protectedPaths)`:** `baseSha` is the **recorded** `worktree.baseSha`
  (the commit the branch was cut from), never re-resolved: guardrail G4 compares it with the
  base tip GitHub reports, so this package must not blur the two. Run, in this order and
  nothing else: `rev-parse HEAD`, `rev-list --count <baseSha>..HEAD`,
  `status --porcelain`, `diff --numstat -M <baseSha> --`, `diff --name-status -M <baseSha> --`.
  `dirty` is `status --porcelain` non-empty. `changedPaths` is the numstat path list, in git
  order, deduplicated. `protectedHits` is `protectedPaths` × `changedPaths` filtered through
  the injected `matchesGlob`, in pattern-then-path order, deduplicated by
  `pattern + '\u0000' + path`, and each `path` is normalised with leading `./` and duplicate
  `/` removed (same rule as `@codebox/core`; do not import it at runtime). A renamed file
  appears **once**, under its new path, with its real line delta.
- **`parseNumstat`:** each non-empty line is `<added>\t<removed>\t<path>`. `-` means binary →
  `0`. A rename is either `old => new` or `a{b => c}d`; the reported path is the **new** one
  (`old => new` → `new`; `a{b => c}d` → `acd`; `a{x => y}/f` → `ay/f`). `parseNameStatus`: each
  line is `<LETTER>\t<path>` or `R<score>\t<old>\t<new>`; `A→added`, `M→modified`, `D→deleted`,
  `R*→renamed` with the new path. `buildRunDiff` sums `added`/`removed` (binary 0), sets
  `files` to the number of distinct paths, joins the name-status by new path (a numstat path
  with no name-status entry is `modified`), and returns entries `{path, status, added,
  removed}` sorted by path for determinism.
- **`cleanup({ttlHours})`:** list direct children of `workspaceRoot` whose name does not start
  with `.`. For each: read its marker. No marker → count as an orphan and **never touch it**.
  Marker present and `now() - mtime > ttlHours` → `removeWorktree`, add the path to `removed`
  and the measured directory size to `bytesFreed`; otherwise `kept += 1`. The cache directory
  is never visited and never removed. `ttlHours = 0` removes every marked worktree.
- **`diskUsage`:** `statfs(workspaceRoot)`; `freeBytes = bavail * bsize`,
  `totalBytes = blocks * bsize`, `usedPercent = Number((((total - free) / total) * 100).toFixed(2))`.
- **Errors:** every non-zero git exit becomes a `WorkspaceError`; `message` is at most
  `'<command> exited with code <code>'` — never git's `stderr`, never the arguments. `command`
  is the first argument (`'clone'`, `'fetch'`, `'worktree'`, `'diff'`, `'rev-parse'`, …).
- **`createGitRunner`:** `spawn('git', args, { cwd, env, shell: false, timeout, killSignal:
  'SIGKILL' })`, collects stdout/stderr as UTF-8, resolves with the exit code (`code ?? 1`),
  and never rejects for a non-zero exit. It may reject only for a spawn error (ENOENT → let
  the caller see `WorkspaceError` via `git_failed` with `exitCode: null`).

### Data

- `WorkspaceStatus.diff` is exactly `runDiffSchema`'s shape, so the gate can pass
  `{ files, added, removed }` to `evaluateDiffBudget` (`@codebox/core`) and `changedPaths` to
  `scanProtectedPaths` without translation.
- `RunMarker` is the only file this package writes inside a worktree, at the git path of
  `codebox-run.json`. It carries no prompt text, no token and no absolute cache path
  (only `repoSlug`).
- No state is kept in memory across calls: the filesystem is the record, so a reboot loses
  nothing.

## 🧩 Configuration

**This package adds no `CB_*` key and reads `process.env` never.** The daemon maps existing
keys to `WorkspaceManagerOptions`:

| Key (`docs/providers.md`) | Option | Default |
| --- | --- | --- |
| `CB_REPO_ROOT` | `repoRoot` | `/srv/codebox/repos` |
| `CB_WORKSPACE_ROOT` | `workspaceRoot` | `/srv/codebox/worktrees` |
| `CB_CLONE_DEPTH` | `cloneDepth` | `0` |
| `CB_GIT_HTTP_TIMEOUT_SECONDS` | `httpTimeoutSeconds` | `120` |
| `CB_WORKSPACE_TTL_HOURS` | `CleanupOptions.ttlHours` | `168` |

`createGitRunner` supplies `GIT_TERMINAL_PROMPT=0` so a missing credential fails instead of
hanging. The commit identity (`CB_GIT_AUTHOR_NAME` / `CB_GIT_AUTHOR_EMAIL`) is **not** set
here — the run engine commits (Task-14).

No line is added to `docs/providers.md`.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim from the task worktree `../wt-cb-08`. `git` is on `PATH` (the checkout
itself proves it).

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless.
  - `npm run build`.
  - `npx vitest run --project packages/workspaces` — this package alone.
  - `git diff --name-only main...task-08` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `npm ci --prefer-offline --no-audit --no-fund && npm run lint && npm test && npm run build` exits 0.
  - [ ] `[unit]` `npx vitest run --project packages/workspaces` reports `0 failed` and at least
        40 passing tests across the eight `*.test.ts` files named above. Every test that
        touches the filesystem uses `await mkdtemp(join(tmpdir(), 'cb-ws-'))` and removes it in
        `afterEach`; no test writes under the repository.
  - [ ] `[unit]` Two worktrees from one bare clone do not share a path:
        `npx vitest run --project packages/workspaces -t 'two worktrees'` passes. The
        fake-runner case asserts two distinct `worktree add` argument lists; the real-git case
        (`git-real.test.ts`) creates a local `--bare` origin with
        `git init --bare --initial-branch=main`, one commit, then two worktrees, and asserts
        both directories exist, their paths differ, and `git -C <cache> worktree list` names
        three entries.
  - [ ] `[unit]` Removal leaves the cache intact: the real-git case creates a worktree, runs
        `removeWorktree`, then asserts the worktree directory is gone, the cache directory
        still exists and `git -C <cache> rev-parse refs/heads/main` still exits 0.
  - [ ] `[unit]` A failed clone does not leave a half directory:
        `npx vitest run --project packages/workspaces -t 'failed clone'` passes; the fake
        runner returns `{ code: 128 }` for `clone`, and the test asserts `WorkspaceError.code
        === 'clone_failed'`, that `readdir(repoRoot)` is empty, and that
        `access(<repoRoot>/acme__web.git)` rejects.
  - [ ] `[unit]` The protected-path scan finds both pinned paths:
        `npx vitest run --project packages/workspaces -t 'protected'` passes with
        `protectedPaths = ['.github/**', 'ops/**']` and changed paths
        `['.github/workflows/x.yml', 'ops/vm/install.sh', 'src/index.ts']`, asserting exactly
        `[{path: '.github/workflows/x.yml', pattern: '.github/**'}, {path:
        'ops/vm/install.sh', pattern: 'ops/**'}]`. The matcher is
        `import { matchesGlob } from '../../core/src/protected-paths.js'` (a test-only relative
        import).
  - [ ] `[unit]` Diff parsing is pinned: `npx vitest run --project packages/workspaces -t 'diff'`
        passes for a rename in both git forms (`old => new`, `a{b => c}d`), a binary line
        (`-\t-\tlogo.png` → 0/0), an added and a deleted file, and unsorted numstat input
        producing path-sorted output.
  - [ ] `[unit]` A leak test: a fake runner whose `stderr` contains
        `https://x-access-token:sekret@github.com/acme/web.git` produces a `WorkspaceError`
        whose `message`, `command` and `exitCode` contain no `sekret` and no `github.com`.
  - [ ] `[unit]` No runtime workspace import and no ambient config:
        `git grep -nE "from '@codebox/(contracts|core)'" -- packages/workspaces/src | grep -v 'import type'`
        prints nothing; `git grep -nE 'process\.env' -- packages/workspaces/src` prints nothing.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-08` lists only the 20 paths above, and
        `docs/architecture.md` shows changes inside the `packages/workspaces` subsection only
        (`git diff main...task-08 -- docs/architecture.md` must not touch §1, §3–§8, the table
        or another package's bullets).
  - [ ] `[unit]` `packages/workspaces/README.md` maps every file added, one line per file.
  - [ ] `[live]` On the reference VM (`cb-instance`), a ~100 MB repository clones **once** and
        a second call reuses the cache in under 5 s. Measurement: on the VM, with the package
        built, run
        `node --input-type=module -e "const m=await import('/opt/codebox/packages/workspaces/dist/index.js');const g=m.createGitRunner();const w=m.createWorkspaceManager({repoRoot:'/srv/codebox/repos',workspaceRoot:'/srv/codebox/worktrees',git:g,matchesGlob:()=>false,cloneDepth:0,httpTimeoutSeconds:120,now:()=>new Date()});const repo={slug:'<owner>/<100MB-repo>',defaultBranch:'main',cloneUrl:'<authenticated https url>'};let t=Date.now();const a=await w.ensureClone(repo);console.log('first',a.created,Date.now()-t);t=Date.now();const b=await w.ensureClone(repo);console.log('second',b.created,Date.now()-t)"`
        — bound: the first call prints `first true` (a full clone), the second prints
        `second false` and a duration `≤ 5000`. A second `created: true`, or a second
        duration above 5 s, fails the criterion. Operator-run, never in CI.

## 📣 Coordination

- **For the Architect:** the package imports `node:fs` in addition to `node:child_process`;
  `docs/architecture.md` §5's package line omits it and this task must **not** edit §5 — the
  workspace subsection it does own records the fact. No contract change.
- **For Task-14 (run engine):** wire it as
  `createWorkspaceManager({ …, git: createGitRunner(), matchesGlob: matchesGlob, … })` with
  `matchesGlob` from `@codebox/core`. Then: `ensureClone(repo)` →
  `createWorktree({repo, runId, baseRef, title})` → run the gate in `worktree.path` →
  `status(worktree, settings.protectedPaths)` → `status.diff` into `MergeFacts.diff` and
  `evaluateDiffBudget`, `status.changedPaths` into `MergeFacts.changedPaths`. `ensureClone`
  must run **after** `status` of the previous run has been read; nothing here caches.
- **For Task-10 (git provider):** `RepoRef.cloneUrl` is yours to build (installation token or
  PAT inside the URL); this package never asks for a credential and never logs a URL.
- **For Task-15 (`/v1/runs/{id}` diff):** `status().diff` is already `runDiffSchema`-shaped;
  do not re-run git in the daemon.
- **For QA of later batches:** every suite here is headless; the only `[live]` item is the VM
  cache timing above.

## ⛔ Out of scope

- No new dependency; no `package.json`, `package-lock.json` or `tsconfig` edit.
- No gate execution, no commit, no push, no PR, no HTTP, no SQLite, no logger.
- No OpenCode session and no worker/run state: `status` reports facts, the engine decides.
- No `git worktree repair`, no cache garbage collection (`git gc`), no pruning of the cache.
- No change to `packages/contracts`, `packages/core`, `docs/jobs.md`,
  `docs/providers.md` or `docs/decisions.md`.

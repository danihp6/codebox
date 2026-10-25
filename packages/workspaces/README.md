# `@codebox/workspaces`

The on-disk side of a run: one bare clone per repository under `CB_REPO_ROOT`, one worktree per
run under `CB_WORKSPACE_ROOT` on a `cb/<runId>-<slug>` branch, its run marker, an exact diff of
the worktree against the commit the branch was cut from, the D26 protected-path hits, and
retention cleanup that never touches the cache or a directory this package did not create.

Every git call goes through the injected `GitRunner`; `createGitRunner` is the real one
(`node:child_process`, no shell). The filesystem is the record — nothing is held in memory
across calls — so a reboot loses nothing. `@codebox/contracts` and `@codebox/core` are imported
**type-only** (the root gate runs `npm test` before `npm run build`, so a sibling `dist/` may
not exist); the D26 glob semantics arrive as `matchesGlob` and the retention clock as `now`.
Errors carry a code, the git subcommand and the exit code — never git's `stderr`, an argument
list or a clone URL, because the URL carries the installation token.

## Files

- `package.json` — workspace manifest.
- `tsconfig.json` — build and typecheck configuration.
- `README.md` — this file map.

## `src/`

- `index.ts` — public entry point: the frozen re-exports and `createWorkspaceManager`, which validates the two roots.
- `types.ts` — the contract's types: `RepoRef`, `GitRunner`, `WorkspaceManager`, `Worktree`, `RunMarker`, `WorkspaceStatus`, `CleanupReport`, `DiskUsage`.
- `errors.ts` — `WorkspaceError`, its codes and the messages that never carry git's output.
- `git.ts` — `GIT_ENV`, `createGitRunner` and the internal `runGit` every module calls.
- `paths.ts` — the branch prefix, the marker filename, the slug rules and the cache/worktree path builders; pure.
- `diff.ts` — `parseNumstat`, `parseNameStatus` and `buildRunDiff`; pure.
- `clone.ts` — `ensureClone`: clone into a temporary directory, rename into place, fetch instead of re-cloning.
- `worktree.ts` — the shared fs helpers plus worktree create/remove/list and the run marker at the git path.
- `status.ts` — the five status commands, the normalised diff and the protected-path scan.
- `cleanup.ts` — retention cleanup and `diskUsage`.
- `index.test.ts` — the exported surface, the manager handle and the root validation.
- `paths.test.ts` — slugification, branch names, cache and worktree paths, the hostile title.
- `diff.test.ts` — numstat and name-status parsing, both rename forms, binary lines and the sorted diff.
- `clone.test.ts` — the cache lifecycle, `--depth`, the failed clone, the rename race and the leak guard.
- `worktree.test.ts` — creation, the two-worktree rule, removal, listing and the marker round-trip.
- `status.test.ts` — command order, the recorded base, the rename, normalisation and the protected hits.
- `cleanup.test.ts` — TTL removal, orphans, dot directories, the untouched cache and disk usage.
- `git-real.test.ts` — the same lifecycle against a real local bare origin and real worktrees.

## Checks

- `npm run lint`, `npm test` and `npm run build` from the repository root.
- `npx vitest run --project packages/workspaces` runs only this package's tests.
- Every test that touches the filesystem uses `mkdtemp(join(tmpdir(), 'cb-ws-'))` and removes it
  in `afterEach`; nothing is written under the repository.
- Purity of the boundary: `git grep -nE "from '@codebox/(contracts|core)'" -- packages/workspaces/src`
  shows only `import type`, and `git grep -nE 'process\.env' -- packages/workspaces/src` is empty.

## Choices

- The run marker lives at `git rev-parse --git-path codebox-run.json`. A linked worktree's
  `.git` is a file, so the literal `<worktree>/.git/codebox-run.json` of `docs/jobs.md` §4
  cannot be written; the content is unchanged.
- `createWorktree` writes the marker with an empty `promptHash`: the run engine knows the prompt
  and overwrites the marker with `writeRunMarker` once the hash exists.
- `status().baseSha` is the recorded commit the branch was cut from, never re-resolved: G4
  compares it with the base tip the git provider reports.
- A directory without a marker, with an unreadable marker, or whose marker names another run id
  is an orphan: counted, never removed. Cleanup measures the directory size before `git worktree
  remove --force` and the cache is never a candidate.

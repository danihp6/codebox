# Spec: Task-119 — The root gate runs on Windows

> The spec is the subagent's entire world. Anything not written here does not exist.

## 🎯 Scope

- **Task type:** ops/tooling (`scripts/`) + the root manifest. Pure local tooling: no daemon
  behaviour, no package boundary, no screen, no frame.
- **Role:** Dev.
- **Objective:** `npm test` stops dying before any suite on a Windows host. The guard's
  twenty-line program moves out of `package.json`'s single-quoted `node -e` into
  `scripts/test-guard.mjs`, the checks and the printed output stay byte-identical, the
  decision becomes a pure exported function with unit tests, and `"test:guard"` becomes
  `node scripts/test-guard.mjs`.
- **Environment:** worktree `../wt-cb-119`, branch `task-119`, base `main` at `32eb17b`.
- **Dependencies:** none. The guard and the projects it reads are merged: the root `package.json`
  (`test`, `test:app`, `test:guard`, `workspaces`) and `vitest.config.ts` came with the
  repository bootstrap, and `scripts/dev-local.test.mjs` is the merged house style for a `.mjs`
  unit test picked up by the `scripts` project. No batch-mate produces any file this task reads.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in
Batch 33 claims the same path.

- `scripts/test-guard.mjs` (new)
- `scripts/test-guard.test.mjs` (new)
- `package.json` — **hot file, this task is the only holder in the batch**; one line
  (`scripts["test:guard"]`) changes
- `scripts/README.md` — the new `## scripts` block only; no existing row moves or is reordered

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `package.json` (its `scripts` and `workspaces` are the guard's input; the current
  `test:guard` program is the behaviour to preserve)
- `vitest.config.ts` (the project list the guard matches against)
- `scripts/dev-local.mjs`, `scripts/dev-local.test.mjs` (house style)
- `scripts/README.md`
- every workspace `package.json` under `apps/` and `packages/` (the guard reads them; this task
  does not modify them)
- `eslint.config.js` (the lint rules `scripts/*.mjs` are held to)

## 🔒 Contract

`scripts/test-guard.mjs` exports exactly these names. Everything else in the module is local.

```js
/**
 * @typedef {object} GuardWorkspace
 * @property {string} dir   // repository-relative, e.g. 'apps/app'
 * @property {string} name  // that workspace's package.json name, e.g. '@codebox/app'
 * @property {string | null} test // its scripts.test, or null when it declares none
 */

/**
 * The whole decision, pure: no filesystem, no process, no clock.
 * @param {{ gate: string, vitest: string, workspaces: readonly GuardWorkspace[] }} input
 * @returns {{ covered: string[], problems: string[] }}
 */
export function auditWorkspaces(input);

/**
 * Reads the workspace list from disk for the patterns in the root `workspaces` array.
 * @param {readonly string[]} patterns
 * @returns {GuardWorkspace[]} sorted by `dir`
 */
export function listWorkspaces(patterns);
```

- **`auditWorkspaces` decisions, byte-identical to today's program:**
  - skip any workspace whose `test` is `null`;
  - `` byNpm = new RegExp(`(?:-w|--workspace)[= ]${name}(?![\\w@/.-])`).test(gate) `` — the
    lookahead is required: `-w @codebox/app` must not match `@codebox/application`;
  - `` byVitest = vitest.includes(`./${dir}`) || vitest.includes(dir) ``;
  - `byNpm && byVitest` → problem
    `` `${dir}: the gate runs its test script twice (vitest project and npm --workspace)` ``;
  - `!byNpm && !byVitest` → problem `` `${dir}: has a test script but the gate does not run it` ``;
  - otherwise covered entry `` `${dir} (${byNpm ? 'npm --workspace' : 'vitest project'})` ``;
  - `covered` and `problems` follow the input order.
- **`listWorkspaces` must equal today's enumeration:** for each pattern, an entry with no `/*`
  is kept as-is; otherwise the prefix before `/*` is read, its directory entries are mapped to
  `` `${prefix}/${entry.name}` `` and kept only when `` `${dir}/package.json` `` exists; then
  each kept dir is read for `name` and `scripts.test` (a non-string `test` becomes `null`).
  **One deliberate addition:** the result is sorted by `dir`, so the printed line and the
  problem order no longer depend on the filesystem's `readdir` order.
- **The module has no side effects on import.** Everything above is declarations; the file ends
  with the house idiom `scripts/dev-local.mjs:291` already uses —
  ```js
  if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
  }
  ```
  — so `scripts/test-guard.test.mjs` can import `auditWorkspaces` without running the guard.
- **The CLI (`node scripts/test-guard.mjs`) keeps today's exit contract byte-for-byte:**
  - reads `package.json` and `vitest.config.ts` from `process.cwd()` (npm always runs a script
    from the package root; do not change this to `import.meta.url`);
  - `gate = [root.scripts?.test, root.scripts?.['test:app']].filter(Boolean).join(' ')`;
  - on any problem: one stderr line per problem, `test:guard: <problem>` plus a newline, then
    `process.exit(1)`, and **nothing** on stdout;
  - otherwise one stdout line, byte-for-byte
    `test:guard: ${covered.length} workspace(s) covered — ${covered.join(', ')}` plus a
    trailing newline — ASCII prefix, the em dash `—` (U+2014) between `covered` and the list,
    entries joined by `, `;
  - on today's tree it prints exactly:
    ```
    test:guard: 2 workspace(s) covered — apps/app (npm --workspace), apps/daemon (vitest project)
    ```
    and exits 0 (`apps/app` matches `-w @codebox/app` in `test:app`; `apps/daemon` matches
    `root: './apps/daemon'` in `vitest.config.ts`; no other workspace declares a `test`
    script).
- **Errors:** the module throws nothing of its own; a malformed `package.json` or
  `vitest.config.ts` surfaces Node's own error and a non-zero exit, as today.
- **Purity:** `auditWorkspaces` reads nothing (it is the tested half). Only `listWorkspaces`
  and the CLI touch `node:fs`.

## 🧩 Configuration

None. No `CB_*` key, no dependency, no `package-lock.json` change.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing
else is not a criterion.

- **Runner note (this batch, verbatim).** This batch runs on the operator's Windows host,
  where the full `npm test` cannot be green for reasons outside these tasks: `test:guard`'s
  quoting (Task-119 fixes it), 14 `scripts` tests that shell to bash/tar, 23 daemon tests that
  assert POSIX modes or spawn Unix tools, and the `ops` project that hangs (>300 s). The full
  gate's authority for this batch is the Linux CI workflow (`.github/workflows/ci.yml`, run
  with `gh workflow run ci.yml --ref task-119`), and the local commands are the targeted
  Vitest projects named per task plus `npm run lint` and `npm run build`. Never use `npx` on
  this host (it hangs); call `node node_modules/vitest/vitest.mjs run --project <name>`.
- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `node scripts/test-guard.mjs` — from the repository root; must exit 0.
  - `node node_modules/vitest/vitest.mjs run --project scripts test-guard` — the file filter
    matters: the other `scripts` tests shell to bash/tar and are not this task's authority.
  - `npm run lint` and `npm run build` — both must pass.
  - `git diff --name-only main...task-119` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `node scripts/test-guard.mjs` exits 0, writes nothing to stderr, and prints
        exactly one line:
        `test:guard: 2 workspace(s) covered — apps/app (npm --workspace), apps/daemon (vitest project)`
        (compare the whole line, em dash included).
  - [ ] `[unit]` `scripts/test-guard.test.mjs` passes with these six cases, over an injected
        workspace list and injected `gate`/`vitest` strings (no real tree):
        1. a workspace matched by the gate and absent from the vitest config is covered as
           `apps/app (npm --workspace)`;
        2. a workspace absent from the gate and present in the vitest config is covered as
           `packages/core (vitest project)`;
        3. a workspace in neither is the problem
           `apps/orphan: has a test script but the gate does not run it`;
        4. a workspace in both is the problem
           `packages/core: the gate runs its test script twice (vitest project and npm --workspace)`;
        5. a workspace whose `test` is `null` appears in neither list;
        6. `-w @codebox/application` does **not** cover `@codebox/app` (the lookahead), and a
           mixed fixture returns `covered` and `problems` in input order.
  - [ ] `[unit]` `git diff -U0 main...task-119 -- package.json` shows exactly one removed line
        (`"test:guard": "node --input-type=module -e '…'"`) and one added line
        (`"test:guard": "node scripts/test-guard.mjs"`); every other line of the file,
        `"test"`, `"test:app"` and `"test:watch"` included, is unchanged.
  - [ ] `[unit]` `git diff --name-only main...task-119` lists exactly `package.json`,
        `scripts/README.md`, `scripts/test-guard.mjs`, `scripts/test-guard.test.mjs`;
        `package-lock.json` is not in the list.
  - [ ] `[unit]` `scripts/README.md` has a `## scripts` heading before `## Local development`
        with the table below, and no existing row is reordered:
        ```
        | File | What it is |
        | --- | --- |
        | `test-guard.mjs` | The root gate's coverage check: every workspace that declares a `test` script is run exactly once by `npm test`, and the line it prints names each one. |
        | `test-guard.test.mjs` | Unit tests for the pure decision: covered by the npm gate, covered by the vitest project, covered by neither, and counted twice. |
        ```
  - [ ] `[unit]` lint, the filtered `scripts` run and the build pass.

## 📣 Coordination

- **For the Architect:** the workspace list is sorted by `dir`, a deliberate addition to the
  frozen behaviour (today's order is whatever the filesystem's `readdir` returns). On this
  host the printed line is unchanged; the sort is what lets the line be pinned exactly. The
  cut paragraph records it.
- **For the next batch:** `auditWorkspaces({ gate, vitest, workspaces })` is the seam. A later
  task that adds a workspace, or moves a suite from `npm --workspace` to a vitest project,
  extends the gate or `vitest.config.ts` and the guard reports it — nothing in the guard needs
  editing.
- **For QA:** do not run the unfiltered `scripts` project on this host; the bash/tar tests are
  not this task's authority.
- **For the Orchestrator:** `package.json` is this task's only hot file and `package-lock.json`
  does not move.

## ⛔ Out of scope

- No change to `"test"`, `"test:app"` or `"test:watch"`, and no new npm script.
- No change to `vitest.config.ts` (including the failing `apps` project or the `ops` timeout).
- No new dependency, no `package-lock.json` change, no CI workflow change.
- No rewrite of the other `scripts/*.mjs` files, and no reformatting of `scripts/README.md`
  outside the new block.
- No change to what the guard checks: it still counts only workspaces that declare a `test`
  script, and it does not start validating the `packages/*` projects.

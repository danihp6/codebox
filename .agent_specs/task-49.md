# Spec: Task-49 — The app unit suite is outside the gate

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** pipeline (the root gate and the CI job; no application code).
- **Role:** Dev.
- **Objective:** After this task, `npm test` at the repository root means the same thing on a
  laptop and in CI, and it runs **both** unit suites exactly once: the Vitest projects of
  `vitest.config.ts` **and** the Angular app suite (`ng test --watch=false`, 364 specs today).
  The root `test` script becomes `test:guard && test:app && vitest run`; `test:guard` is a
  self-contained `node` check that fails the gate when any npm workspace that declares a `test`
  script is not covered by it (and also when one is covered twice). The gate table and the
  Workflow rule say so in one line each. The one-line `timeout-minutes` bump in `ci.yml` is
  **not** in scope this cycle: the runner's GitHub App token has no `workflows` permission, so a
  push that touches `.github/workflows/**` is rejected (see the block note below).
- **Environment:** worktree `../wt-cb-49`, branch `task-49`, base `main`.
- **Dependencies:** none. The root `package.json` (script `test` = `vitest run`),
  `vitest.config.ts`, `apps/app/angular.json` (`test` architect target,
  `@angular/build:unit-test`, `runnerConfig: vitest.config.mts`), `apps/app/package.json`
  (`"test": "ng test --watch=false"`), `apps/daemon/package.json`
  (`"test": "cd ../.. && vitest run --project apps/daemon"`) and `ci.yml` are on `main`.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path (this task is the batch's holder of `package.json`). Touching
anything outside this list is a failure of the task.

- `package.json` (the `test` script and the scripts it must add; nothing else in the file)
- `docs/agent-pipeline.md` (section: `## 7. Gates`, the table and the paragraph under it)
- `AGENTS.md` (section: `## Workflow` only)

**Not in scope: `.github/workflows/ci.yml`.** The branch cannot carry it: the GitHub App
installation token of this runner has no `workflows` permission, and the push is rejected with
`refusing to allow a GitHub App to create or update workflow '.github/workflows/ci.yml' without
'workflows' permission` (the same external block as issue #11). The CI job already runs
`npm test`, so the app suite enters CI through the root script with no workflow edit; the
`timeout-minutes: 15 → 25` bump is deferred and is recorded as an `agent-review` issue. Touching
any workflow file is a failure of this task.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `package.json`, `package-lock.json`, `vitest.config.ts`, `eslint.config.js`
- `apps/app/package.json`, `apps/app/angular.json`, `apps/app/tsconfig.json`,
  `apps/app/tsconfig.spec.json`, `apps/app/vitest.config.mts`
- `apps/daemon/package.json`, `packages/*/package.json`
- `.github/workflows/ci.yml`, `.github/workflows/agent-cycle.yml`
- `docs/agent-pipeline.md`, `docs/agent-ci.md`

## 🔒 Contract

`package.json` scripts, frozen after this task:

```json
"test": "npm run test:guard && npm run test:app && vitest run",
"test:watch": "vitest",
"test:app": "npm test -w @codebox/app",
"test:guard": "node --input-type=module -e '<the program below, in single quotes>'"
```

- `build`, `typecheck`, `lint`, `format` and `format:check` keep their exact current values.
- **No dependency is added or removed.** `package-lock.json` must be byte-identical (it is a
  hot file held by no task in this batch).

### The guard (`test:guard`), frozen behaviour

It runs from the repository root, imports only `node:fs`, and exits `0` on a covered set, `1`
otherwise.

**Quoting rule, and it is load-bearing.** The whole program is the single argument of
`node --input-type=module -e`, wrapped in **single quotes** in the `package.json` value, so the
shell performs no expansion on it. The program therefore must contain **no single quote**
(apostrophe); every JS string uses double quotes, which JSON escapes as `\"`. Backticks and `$`
are safe inside the shell's single quotes. A program that needs an apostrophe is a spec bug.

Reference implementation, frozen behaviour (paste it into the `-e` argument):

```js
import { readFileSync, readdirSync, existsSync } from "node:fs";
const root = JSON.parse(readFileSync("package.json", "utf8"));
const gate = [root.scripts?.test, root.scripts?.["test:app"]].filter(Boolean).join(" ");
const vitest = readFileSync("vitest.config.ts", "utf8");
const dirs = (root.workspaces ?? []).flatMap((pattern) => {
  const at = pattern.indexOf("/*");
  if (at === -1) return [pattern];
  const prefix = pattern.slice(0, at);
  return readdirSync(prefix, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${prefix}/${entry.name}`)
    .filter((dir) => existsSync(`${dir}/package.json`));
});
const covered = [];
const problems = [];
for (const dir of dirs) {
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  if (typeof pkg.scripts?.test !== "string") continue;
  const byNpm = new RegExp(`(?:-w|--workspace)[= ]${pkg.name}(?![\\w@/.-])`).test(gate);
  const byVitest = vitest.indexOf(`./${dir}`) !== -1 || vitest.indexOf(dir) !== -1;
  if (byNpm && byVitest) problems.push(`${dir}: the gate runs its test script twice (vitest project and npm --workspace)`);
  else if (!byNpm && !byVitest) problems.push(`${dir}: has a test script but the gate does not run it`);
  else covered.push(`${dir} (${byNpm ? "npm --workspace" : "vitest project"})`);
}
if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`test:guard: ${problem}\n`);
  process.exit(1);
}
process.stdout.write(`test:guard: ${covered.length} workspace(s) covered — ${covered.join(", ")}\n`);
```

- Exit `0` and the single stdout line above; exit `1` with one stderr line per offending
  workspace and nothing on stdout.
- **Coverage means exactly one of:** the workspace's `name` appears in the gate's script text as
  an `npm --workspace`/`-w` target, **or** the workspace's relative directory appears as a
  quoted string in `vitest.config.ts`.
- Today the guard must report exactly two covered workspaces — `apps/daemon` (vitest project)
  and `apps/app` (npm `--workspace`) — and exit `0`.
- The message strings above are frozen: QA greps for them.

### `.github/workflows/ci.yml` — not edited

- The job already runs `npm test`, so it inherits the app suite and the guard with no workflow
  change. Do not open the file for a write, do not bump `timeout-minutes`, and do not touch any
  other workflow: the App token cannot push `.github/workflows/**`.
- The 15-minute budget stays; the QA plan watches it through the deferred `[live]` measurement.

### `docs/agent-pipeline.md` §7 and `AGENTS.md` §Workflow, frozen

- The gate table keeps its five rows and its command strings; it gains one row
  `| App unit suite | included in `npm test` (guard → `ng test --watch=false` → `vitest run`) | Every gate run. |`
  and one sentence under the table: `npm test` means the same suite on a laptop and in CI, and a
  workspace that declares a `test` script but is not covered fails the gate.
- `AGENTS.md` §Workflow: the bullet that lists
  `npm ci && npm run lint && npm test && npm run build` gains one clause, in the same sentence,
  naming the app suite and the coverage guard. No other line of `AGENTS.md` changes.

### Data

- `npm test` runs the app suite **once**: `apps/app` is not a project in `vitest.config.ts` and
  must not become one.
- `vitest run` still runs every project in `vitest.config.ts`, including `scripts` and `ops`.
- The guard's only inputs are `package.json`, `vitest.config.ts` and the workspaces'
  `package.json` files. It reads no lockfile, imports no package, spawns no process.

## 🧩 Configuration

No `CB_*` key is added or read. No secret, no environment variable, no network call is
introduced by this task.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — now the guard, the app suite and Vitest, in that order.
  - `npm run build` — `tsc -b` plus the Angular production build.
  - `npx playwright test` — **not** run: this task adds no web flow.
  - `git diff --name-only main...task-49` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `npm run lint`, `npm test` and `npm run build` are green.
  - [ ] `[unit]` `npm test` runs the app suite: its log contains the Angular unit-runner banner
        and a non-zero spec total, and the substring
        `src/app/features/dashboard/dashboard.page.spec.ts` appears in it. Evidence:
        `npm test 2>&1 | tee /tmp/test.log; grep -c "features/pairing\\|dashboard.page.spec" /tmp/test.log`
        is ≥ 1.
  - [ ] `[unit]` The suite is not run twice, using the `/tmp/test.log` captured in the criterion
        above: `grep -c "@codebox/app@0.0.0 test" /tmp/test.log`
        prints exactly `1` (npm prints that banner once per invocation of the workspace's `test`
        script), and `grep -c "apps/app" vitest.config.ts` prints `0` (the app is not, and must
        not become, a Vitest project).
  - [ ] `[unit]` A deliberately broken app spec fails the gate. Append
        `expect(true).toBe(false);` inside the last `it(...)` of
        `apps/app/src/app/features/dashboard/dashboard.page.spec.ts`, run `npm test`, observe a
        **non-zero** exit and the failing spec named in the output, then
        `git checkout -- apps/app/src/app/features/dashboard/dashboard.page.spec.ts` and confirm
        `git status --short` is empty.
  - [ ] `[unit]` The guard catches an uncovered workspace.
        `mkdir -p packages/qa-guard-probe` and write
        `{"name":"@codebox/qa-guard-probe","version":"0.0.0","private":true,"scripts":{"test":"exit 0"}}`
        to its `package.json`; `npm run test:guard` must exit **1** and print
        `packages/qa-guard-probe: has a test script but the gate does not run it`. Then
        `rm -rf packages/qa-guard-probe` and confirm `git status --short` is empty.
  - [ ] `[unit]` The guard passes the real tree: `npm run test:guard; echo $?` prints `0` and
        one line naming `apps/app (npm --workspace)` and `apps/daemon (vitest project)`.
  - [ ] `[unit]` `git diff --name-only main...task-49` lists exactly `package.json`,
        `docs/agent-pipeline.md`, `AGENTS.md`, and
        `git diff --stat main...task-49 -- package-lock.json` is empty. No
        `.github/workflows/**` file appears in the diff.
  - [ ] `[unit]` `git diff main...task-49 -- package.json` touches only the `scripts` block; no
        `dependencies`, `devDependencies`, `engines` or `workspaces` line moves.
  - [ ] `[live]` **Not measurable here.** The backlog asks that "a PR's CI log shows the app
        suite and the job stays under the documented time budget". The cycle runs the gate
        locally; it cannot read the Actions log of the PR that will exist only after this branch
        merges, and QA has no runner. **Measurement, when a human reads it:** on the next pull
        request, open the `gate` job, confirm the `Test` step log contains the app suite and the
        `test:guard:` line, and confirm the job's wall time stays under 25 minutes. Report it as
        an `agent-review` issue titled
        `Task-49: confirm the app suite in a PR's CI log and the job's wall time` — **never** as
        passing.

## 📣 Coordination

- **For the Architect:** this task is the batch's sole holder of `package.json`. No other task
  in the batch may touch it, and none does.
- **For the Orchestrator:** every later gate invocation (`agent-cycle.yml`'s post-merge gate,
  the VM driver) inherits the app suite and the guard by running `npm test`. Nothing else has to
  change, and no workflow file is touched — the `ci.yml` timeout bump is blocked by the App's
  missing `workflows` permission and is deferred to a human or a token fix (issue #11 family).
- **For QA and the next batches:** the guard is the mechanism that keeps a future workspace from
  falling out of the gate silently. A new workspace with a `test` script must either be added as
  a project in `vitest.config.ts` or be listed as an `npm --workspace` target in the root
  scripts — otherwise `npm test` fails by design. That is intended: a red gate is cheaper than
  364 unrun specs.
- **For the next batch:** `docs/agent-pipeline.md` §7 and `AGENTS.md` §Workflow now say `npm
  test` includes the app suite. A spec that writes `ng test` as a separate gate command is
  wrong; it must name `npm test`.

## ⛔ Out of scope

- No new dependency, no `npm install` of anything, no change to `package-lock.json`.
- No change to `vitest.config.ts`; `apps/app` must not become a Vitest project.
- No change to `apps/app/**` (its `test` script already exists and is correct), to
  `apps/daemon/**`, or to any `packages/**` source.
- No second CI job, no matrix, no coverage upload, no cache change.
- No guard for `lint` or `build`: the guard covers `test` scripts only.
- No change to `TODO.md`, `CHANGELOG.md`, `docs/decisions.md` or any document outside the named
  section of `docs/agent-pipeline.md`.

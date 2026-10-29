# Spec: Task-74 — Design package and the gate step

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (`packages/design`) plus exactly one gate step in `apps/daemon/src/gate/`.
- **Role:** Dev.
- **Objective:** after this task `@codebox/design` exists as a new npm workspace and is the only
  authority on what the repository's `design/` directory means: it parses DTCG tokens,
  `design/routes.json` and the per-screen specs, and it answers four deterministic questions —
  *is any colour written outside the tokens*, *does every route name a component*, *does every
  screen declare its three states*, *does every declared snapshot hash match the exported
  bytes*. The daemon gate gains one step, `scanDesign`, that turns those answers into gate tail
  lines of the form `<file>:<line> <rule>`, exactly as `scanWorktree` turns secret findings into
  gate tail lines. No pixel comparison is added anywhere.
- **Environment:** worktree `../wt-cb-74`, branch `task-74`, base `main` (merged at `b93e224`).
- **Dependencies:**
  - **Task-70** (merged) — declared dependency; this task consumes **no** contract from it. It
    invents no API type and imports nothing from `@codebox/contracts`.
  - **Task-71** (merged) — produced `packages/backlog/{package.json,tsconfig.json,README.md,
    src/index.ts}`; that workspace is the template for this one.
  - **Task-14** (merged) — produced `apps/daemon/src/gate/{run-gate.ts,secret-scan.ts}`; the new
    step mirrors `secret-scan.ts` and does not restructure either file.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

New workspace (all of it is new):

- `packages/design/package.json`
- `packages/design/tsconfig.json`
- `packages/design/README.md`
- `packages/design/src/index.ts`
- `packages/design/src/types.ts`
- `packages/design/src/tokens.ts`
- `packages/design/src/routes.ts`
- `packages/design/src/screens.ts`
- `packages/design/src/check.ts`
- `packages/design/src/snapshot.ts`
- `packages/design/src/tokens.test.ts`
- `packages/design/src/routes.test.ts`
- `packages/design/src/screens.test.ts`
- `packages/design/src/check.test.ts`
- `packages/design/src/snapshot.test.ts`
- `packages/design/src/fixtures/tokens.json`
- `packages/design/src/fixtures/routes.json`
- `packages/design/src/fixtures/screens/dashboard.json`
- `packages/design/src/fixtures/screens/repo-backlog.json`
- `packages/design/src/fixtures/patch/colour-outside.patch`
- `packages/design/src/fixtures/patch/clean.patch`

The gate step (folder exists; `run-gate.ts`, `run-gate.test.ts`, `secret-scan.ts` and
`secret-scan.test.ts` are **not touched** — this task adds a sibling file and a README line):

- `apps/daemon/src/gate/design-check.ts`
- `apps/daemon/src/gate/design-check.test.ts`
- `apps/daemon/src/gate/README.md`

Gate-forced configuration (this is the only reason they are here; see 📣 Coordination):

- `apps/daemon/package.json` — two lines only: `prebuild` gains `-w @codebox/design`, and
  `dependencies` gains `"@codebox/design": "0.0.0"` in alphabetical position.
- `package-lock.json` — regenerated, never hand-edited.
- `vitest.config.ts` — exactly one new entry: `project('packages/design'),` immediately after
  `project('packages/backlog'),`.

Documentation (one section, no more):

- `docs/jobs.md` — §5 "The gate" only, one appended block at the end of the section.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `packages/backlog/package.json`, `packages/backlog/tsconfig.json`,
  `packages/backlog/README.md`, `packages/backlog/src/index.ts` — the workspace template.
- `apps/daemon/src/gate/run-gate.ts`, `apps/daemon/src/gate/run-gate.test.ts`,
  `apps/daemon/src/gate/secret-scan.ts`, `apps/daemon/src/gate/secret-scan.test.ts`,
  `apps/daemon/src/gate/README.md` — the step contract to mirror.
- `apps/daemon/src/run/engine.ts` — **read only**, to see where the sibling step is called
  (`secretScanStep`, around line 766). Do not edit it.
- `apps/daemon/package.json`, `package.json`, `tsconfig.base.json`, `vitest.config.ts`,
  `eslint.config.js`.
- `packages/contracts/package.json` — the `zod` pin (`4.6.7`).
- `packages/workspaces/src/index.ts` — the `GitRunner` type the step takes.
- `docs/jobs.md` — the whole file for §5's voice; only §5 may change.
- `design/README.md` — §5 (tokens) and §6 (rules) tell you what the artifacts mean.

## 🔒 Contract

Public surface, frozen. Other tasks are written against it.

### `@codebox/design`

```ts
// packages/design/src/types.ts
export const DESIGN_DIR = 'design';
export const TOKENS_PATH = 'design/tokens.json';
export const ROUTES_PATH = 'design/routes.json';
export const SCREENS_DIR = 'design/screens';

/** The three states every screen must declare. `loading` and `empty` are docs/app.md §5/§12;
 *  `error` is the typed envelope. A screen with no state of one kind declares it as null. */
export const SCREEN_STATES = ['loading', 'empty', 'error'] as const;
export type ScreenState = (typeof SCREEN_STATES)[number];

export type DesignRule =
  | 'colour_outside_tokens'
  | 'route_without_component'
  | 'screen_state_missing'
  | 'snapshot_hash_mismatch';

export interface DesignFinding {
  /** Repo-relative, forward slashes. */
  readonly file: string;
  /** 1-based. A document-level finding reports line 1; a patch finding reports the new-file line. */
  readonly line: number;
  readonly rule: DesignRule;
  readonly message: string;
}

export interface DesignIssue {
  readonly path: string;
  readonly message: string;
}

export type DesignBoundary = 'tokens' | 'routes' | 'screen';

export class DesignDocumentError extends Error {
  readonly boundary: DesignBoundary;
  readonly issues: readonly DesignIssue[];
  constructor(boundary: DesignBoundary, issues: readonly DesignIssue[]);
}

export interface DesignToken {
  readonly $value: string | number;
  readonly $type: string;
  readonly $description?: string;
}

/** Flat map, keyed by dot path (`color.brand.green`), aliases already resolved. */
export type DesignTokens = Readonly<Record<string, DesignToken>>;

export interface DesignRoute {
  readonly path: string;      // e.g. "/repos/:id/works"
  readonly screen: string;    // e.g. "Repo · works"
  readonly component: string; // e.g. "RepoWorksPage" — a non-empty TS identifier
}

export interface ScreenSpec {
  readonly screen: string;
  readonly route: string;
  readonly states: Readonly<Record<ScreenState, string | null>>; // a frame caption or null
  readonly snapshotSha256: string | null;
}

export interface DesignDocuments {
  readonly tokens: DesignTokens;
  readonly routes: readonly DesignRoute[];
  readonly screens: readonly ScreenSpec[];
}
```

```ts
// packages/design/src/index.ts — the only entry point; re-export the surface once.
export function parseTokens(input: unknown): DesignTokens;
export function parseRoutes(input: unknown): readonly DesignRoute[];
export function parseScreenSpec(input: unknown): ScreenSpec;

/** Every resolved token value, lowercased and trimmed, deduplicated, sorted. */
export function tokenValues(tokens: DesignTokens): readonly string[];

/** The four document checks. Pure. */
export function checkDocuments(input: DesignDocuments): readonly DesignFinding[];

export interface DesignPatchInput {
  readonly patch: string;                     // the `git diff` text
  readonly tokenValues: readonly string[];    // from tokenValues()
}
/** The colour rule over added lines. Pure. */
export function checkPatch(input: DesignPatchInput): readonly DesignFinding[];

/** sha256 of the bytes, lowercase hex. Pure: no file is read here. */
export function snapshotHash(bytes: Uint8Array): string;

export interface SnapshotInput {
  readonly file: string;            // design/screens/<name>.json
  readonly spec: ScreenSpec;
  readonly bytes: Uint8Array | null; // null when the declared export is missing
}
export function checkSnapshots(input: readonly SnapshotInput[]): readonly DesignFinding[];
```

Rules, pinned:

- **`parseTokens`** accepts DTCG: nested groups, leaves with `$value` (`string | number`) and
  `$type` (`color`, `dimension`, `fontFamily`, `fontWeight`, `duration`, `cubicBezier`, `number`),
  optional `$description`, and aliases of the form `{group.token}`. Returns the flat map with
  aliases resolved and `$value` kept exactly as written (no normalisation). Throws
  `DesignDocumentError('tokens', issues)` for: a leaf without `$value`, an unknown `$type`, an
  unresolved alias, an alias cycle, a non-object group. An empty object is valid and yields `{}`.
- **`parseRoutes`** accepts `{ "routes": [ { "path", "screen", "component" } ] }`. Throws
  `DesignDocumentError('routes', …)` when `routes` is not an array, an entry is not an object, or
  `path`/`screen` is empty. `component` is **not** validated here — its emptiness is a
  *finding*, not a parse error, because that is the check §5 documents.
- **`parseScreenSpec`** accepts `{ "screen", "route", "states": { "loading", "empty", "error" },
  "snapshotSha256" }`; `states` may be partial (a missing key becomes `null`), `snapshotSha256`
  is `null` or 64 lowercase hex characters.
- **`checkDocuments`** returns, in this order and sorted by `file` then `line`, with `line: 1`:
  1. `route_without_component` at `design/routes.json`, message
     `route <path> has no component` — for every route whose `component` is empty or is not
     `/^[A-Z][A-Za-z0-9]*$/`.
  2. `screen_state_missing` at `design/screens/<slug>.json`, message
     `screen <screen> has no <state> state` — for every spec whose `states[state]` is `null` for
     any of `SCREEN_STATES`, and for every route whose `screen` has no spec at all, reported at
     `design/routes.json` with message `route <path> has no spec`.
  3. `colour_outside_tokens` at `design/screens/<slug>.json`, message
     `snapshot declares a colour outside the tokens` — when a spec's `states` captions contain a
     colour literal that is not one of `tokenValues`. Captions are data, not frames: a caption
     that writes `#22c55e` instead of a token name fails.
  The `<slug>` is the spec's `screen` kebab-cased and lowercased (`Repo · backlog` →
  `repo-backlog`) — the same rule `design/README.md` §4 uses for export names, spaces around a
  `·` dropped. This is the file the finding names even though the caller holds the parsed object.
- **`checkPatch`** walks the unified diff, tracks the new-file line number from each
  `@@ -a,b +c,d @@` hunk header, and inspects **added** lines only. A colour literal
  — `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(…)`, `rgba(…)`, `hsl(…)`, `hsla(…)` — is a
  finding unless (a) the file is `design/tokens.json`, (b) the same literal is present in
  `tokenValues` (case-insensitive), or (c) the line ends with the comment
  `codebox-design: allow`. Files without a diff header, removed lines, and `+++ b/…` are not
  inspected. Message: `colour <literal> is not a token`.
- **`snapshotHash`** is `createHash('sha256').update(bytes).digest('hex')` from `node:crypto`:
  hashing is a pure computation, no file is opened in this package.
- **`checkSnapshots`** emits `snapshot_hash_mismatch` at the given `file`, message
  `snapshot hash does not match the export` (or `snapshot <hash> is missing` when `bytes` is
  `null` and a hash is declared), and nothing when `snapshotSha256` is `null`.

Purity: every export above is pure. No clock, no filesystem, no network, no environment, no
`process.cwd()`. Tests pass documents as literals or fixtures read by the test, never by the
package.

### `apps/daemon/src/gate/design-check.ts`

```ts
export const DESIGN_CHECK_MAX_BYTES = 4_194_304;

export interface DesignScanIo {
  readonly readFile: (path: string) => Promise<string>;
  readonly readDir: (path: string) => Promise<readonly string[]>;
}

export interface DesignScanInput {
  readonly cwd: string;
  readonly baseSha: string;
  readonly timeoutMs: number;
  /** Defaults to node:fs/promises readFile/readdir. Tests inject a stub and touch no disk. */
  readonly io?: DesignScanIo;
}

export interface DesignScanOutcome {
  readonly findings: readonly DesignFinding[];
  readonly skipped: boolean;   // design/tokens.json is absent: the repository has no design/
  readonly oversized: boolean; // the patch exceeded DESIGN_CHECK_MAX_BYTES
}

export type DesignScanFailureCode = 'git_failed';

export class DesignScanError extends Error {
  readonly code: DesignScanFailureCode;
  constructor(code: DesignScanFailureCode);
}

export function formatDesignFinding(finding: DesignFinding): string; // "<file>:<line> <rule>"

export async function scanDesign(
  git: GitRunner, // from @codebox/workspaces, imported type-only
  input: DesignScanInput,
): Promise<DesignScanOutcome>;
```

Behaviour, pinned — it mirrors `scanWorktree` in the same folder:

1. `git.run({ args: ['diff', '--no-color', '--unified=0', '--no-ext-diff', input.baseSha, '--'],
   cwd: input.cwd, timeoutMs: input.timeoutMs, env: GIT_ENV })` — the identical call, identical
   `GIT_ENV`.
2. A non-zero code throws `DesignScanError('git_failed')`. The step fails closed; it never
   returns an empty finding list on a git error.
3. `Buffer.byteLength(stdout, 'utf8') > DESIGN_CHECK_MAX_BYTES` returns
   `{ findings: [], skipped: false, oversized: true }`.
4. `design/tokens.json` absent (`readFile` rejects) returns
   `{ findings: [], skipped: true, oversized: false }` — a repository without `design/` is not
   a failure, exactly as a repository without tests is not a gate failure.
5. Otherwise it parses `design/tokens.json`, `design/routes.json` and every
   `design/screens/*.json` (sorted), runs `checkDocuments` + `checkPatch`, and **appends** the
   snapshot checks by reading `design/exports/<slug>.png` when the file exists.
   A `DesignDocumentError` is decided by its boundary, and only two rules exist for it: a
   `screen` boundary becomes one `screen_state_missing` finding per issue on the boundary file,
   a `routes` boundary becomes one `route_without_component` finding per issue on
   `design/routes.json`, and a `tokens` boundary **throws** `DesignScanError('git_failed')` —
   a token document that does not parse is the same class of failure as a diff that cannot be
   read, so the gate fails closed instead of guessing which colours were legal.
6. Findings are returned sorted by `file` then `line`.

Log and stream contract: this step writes nothing to a log and emits no event. Its caller (the
run engine, **not** this task) appends `formatDesignFinding` lines to the gate tail and log, the
way `secretScanStep` does with `formatSecretFinding`.

### Data

The three document shapes are frozen by this task, because `@codebox/design` owns them
(`AGENTS.md`, repository layout):

- `design/tokens.json` — DTCG. `$value` of a colour is the literal the app may also write in
  `src/theme/` only if it is a token.
- `design/routes.json` — `{ "routes": [{ "path": "/repos/:id", "screen": "Repo · backlog",
  "component": "RepoBacklogPage" }] }`. One entry per route in `apps/app/src/app/app.routes.ts`.
- `design/screens/<slug>.json` — `{ "screen": "Repo · backlog", "route": "/repos/:id",
  "states": { "loading": "…", "empty": "…", "error": "…" }, "snapshotSha256": null }`.
- `design/exports/<slug>.png` — the export the hash refers to (`design/README.md` §4).

Do **not** create any of them in this task (see ⛔ Out of scope). They are created by the design
export (L2/L5) or by Task-79, which must derive `routes.json` from the post-Task-75 router.

## 🧩 Configuration

**None.** This task adds no `CB_*` key, reads no environment variable and needs no
`docs/providers.md` line. The only tunable is the exported constant
`DESIGN_CHECK_MAX_BYTES = 4_194_304`, pinned to the same 4 MiB cap `scanWorktree` uses, so the
gate never reads a patch twice the size it already refuses.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim.

- **Method:**
  - `cd ../wt-cb-74` (the QA integration worktree, `main` + `task-74` merged).
  - `npm ci --prefer-offline --no-audit --no-fund` — a fresh worktree has no `node_modules`, and
    this is the step that proves the new workspace is in the lockfile.
  - `npm run lint` — must pass; `packages/design` is linted by the root config automatically.
  - `npm test` — the guard, the app suite and every Vitest project, including the two this task
    extends.
  - `npm run build` — `tsc -b` per workspace plus the app build; proves the daemon's `prebuild`
    orders `@codebox/design` before the daemon.
  - `npx playwright test` — **not run**: this task has no web flow and the repository has no
    `playwright.config.*`.
  - `git diff --name-only main...task-74` — audit against the exclusive paths above.
- **Headless test files this task adds or extends:**
  - `packages/design/src/tokens.test.ts`
  - `packages/design/src/routes.test.ts`
  - `packages/design/src/screens.test.ts`
  - `packages/design/src/check.test.ts`
  - `packages/design/src/snapshot.test.ts`
  - `apps/daemon/src/gate/design-check.test.ts`

- **Acceptance criteria:**
  - [ ] `[unit]` `npm ci --prefer-offline --no-audit --no-fund` succeeds from the fresh
        worktree, and `git diff --numstat main...task-74 -- package-lock.json` reports at most
        60 added lines and **0** removed lines (a pure insertion of `packages/design` and its
        `node_modules/@codebox/design` link). A non-zero removal is a finding to report, not to
        hand-fix.
  - [ ] `[unit]` `npm run lint`, `npm test` and `npm run build` all exit 0.
  - [ ] `[unit]` `npx vitest run --project packages/design` reports 5 test files and 0 failures.
  - [ ] `[unit]` `npx vitest run --project apps/daemon -- design-check` reports 1 test file and 0
        failures.
  - [ ] `[unit]` **A hardcoded hex fails with the file and line.** `npx vitest run --project
        apps/daemon -- design-check -t "colour outside tokens"` passes, and the assertion it
        makes is exactly: given the added line `  color: #ff00ff;` at new-file line 3 of
        `apps/app/src/theme/extra.css` in the patch (`colour-outside.patch` in the package
        fixtures, same literal), `scanDesign` resolves to
        `findings[0]` with `{ file: 'apps/app/src/theme/extra.css', line: 3,
        rule: 'colour_outside_tokens' }` and `formatDesignFinding(findings[0]) ===
        'apps/app/src/theme/extra.css:3 colour_outside_tokens'`.
  - [ ] `[unit]` **A token literal and a `codebox-design: allow` line do not fail.** The same
        line written as `color: #15803d;` where `#15803d` is in `tokenValues`, and
        `color: #ff00ff; /* codebox-design: allow */`, both yield `[]`.
  - [ ] `[unit]` **A missing state fails.** `npx vitest run --project packages/design -t "screen
        state"` passes, and the assertion it makes is that a spec for `Repo · backlog` with
        `states.error === null` yields one finding
        `{ file: 'design/screens/repo-backlog.json', line: 1, rule: 'screen_state_missing' }`
        with message `screen Repo · backlog has no error state`, while the complete fixture
        yields `[]`.
  - [ ] `[unit]` **A route without a component fails.** `npx vitest run --project packages/design
        -t "route without component"` passes and asserts
        `{ file: 'design/routes.json', line: 1, rule: 'route_without_component' }` for
        `{ path: '/works/:id', screen: 'Work · run log', component: '' }`, and that
        `Component` / `9Page` are also rejected.
  - [ ] `[unit]` **A snapshot hash mismatch fails and a match does not.** `-t "snapshot hash"`
        passes: `snapshotHash(new TextEncoder().encode('x'))` equals the pinned
        `2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881`, a declared hash that
        differs yields `{ file: 'design/screens/dashboard.json', line: 1, rule:
        'snapshot_hash_mismatch' }`, a matching hash yields `[]`, and `bytes: null` with a
        declared hash yields the `snapshot <hash> is missing` message.
  - [ ] `[unit]` **`design/` absent is skipped, a git failure is not.**
        `npx vitest run --project apps/daemon -- design-check -t "skipped"` asserts
        `scanDesign` resolves `{ findings: [], skipped: true, oversized: false }` when
        `readFile('design/tokens.json')` rejects, and rejects with `DesignScanError` whose
        `code === 'git_failed'` when the stub `GitRunner` returns `code: 1`.
  - [ ] `[unit]` **The step calls the same git command as the secret scan.** The test asserts
        the stub `GitRunner` received
        `['diff', '--no-color', '--unified=0', '--no-ext-diff', <baseSha>, '--']`, the same
        `cwd` and the same `env` object identity as `GIT_ENV`, and that `readFile` was never
        called when the patch is oversized.
  - [ ] `[unit]` **No pixel comparison exists anywhere.**
        `grep -rIn -E "pixelmatch|pngjs|ssim|toHaveScreenshot|compareScreenshots" packages apps
        scripts ops` prints nothing (exit 1), and
        `node -e "const p=require('./packages/design/package.json');console.log(JSON.stringify(p.dependencies))"`
        prints exactly `{"zod":"4.6.7"}`.
  - [ ] `[unit]` **`test:guard` stays green and counts the new workspace once.**
        `npm run test:guard` prints `packages/design (vitest project)` and no line about
        `packages/design` twice: this is why `packages/design/package.json` carries **no**
        `test` script (a workspace with a `test` script that is also a Vitest project fails the
        guard).
  - [ ] `[unit]` **The new workspace is wired like its template.**
        `node -e "const p=require('./packages/backlog/package.json'),d=require('./packages/design/package.json');console.log([p.name,d.name,d.type,d.exports['.'].default,d.scripts.build,d.scripts.typecheck].join('|'))"`
        prints `@codebox/backlog|@codebox/design|module|./dist/index.js|tsc -p tsconfig.json|tsc
        -p tsconfig.json --noEmit`, and `grep -c "codebox/design" apps/daemon/package.json` is 2.
  - [ ] `[unit]` **`docs/jobs.md` changed in §5 and nowhere else.** `git diff -U0 main...task-74
        -- docs/jobs.md | grep '^@@'` prints exactly one hunk header, and both of its line ranges
        fall inside §5 (after `## 5. The gate`, before `## 6. Commit, push and PR`); the appended
        block names `scanDesign`, the four rules, the `<file>:<line> <rule>` format, the 4 MiB
        cap and the `design/`-absent skip.
  - [ ] `[unit]` **Nothing outside the exclusive paths was touched.** `git diff --name-only
        main...task-74` lists only paths from the exclusive list above.

- **`[live]` criteria: none.** The step is not called by the run engine in this task (see
  📣 Coordination), so any criterion phrased "a run stops on a hardcoded hex" would be false on
  the running box. The run-time half is an `agent-review` measurement issued by the
  Orchestrator, not a QA pass.

## 📣 Coordination

- **For the Architect / Orchestrator:**
  - `apps/daemon/package.json` is in the exclusive list although the batch cut named only
    `apps/daemon/src/gate/**`. It is forced by the gate: the daemon value-imports
    `@codebox/design`, and root `npm run build` builds `apps/*` before `packages/*`, so without
    `-w @codebox/design` in the daemon's `prebuild` the daemon's `tsc` resolves a `dist` that
    does not exist yet. No other task in this batch touches it.
  - **The run-engine call site is missing and is deliberately not in this task.** `scanDesign`
    is a step module, exactly like `secret-scan.ts`: the call belongs in
    `apps/daemon/src/run/engine.ts` beside `secretScanStep`, and that path is outside this
    task's exclusive list. Consequence: on `main` after this batch a green gate is **not** yet
    re-decided by the design check. The Orchestrator must file an `agent-review`/`agent-blocked`
    issue naming this one-line wiring (the same handling Task-72's unmeasured `[live]` clause
    got, issue #74), and `docs/jobs.md` §5 says so in one sentence so no reader believes
    otherwise.
  - The `design/` artifacts (`tokens.json`, `routes.json`, `screens/*.json`, `exports/`) are
    **not** created here. Two reasons, both from this batch: `design/routes.json` enumerates the
    router, and Task-75 removes `/chat` from that router in the same batch — a hand-written map
    would be stale the moment the batch merges; and `design/README.md` belongs to Task-79.
    Task-79 is the owner that derives `routes.json` from the post-Task-75 router and adds the
    tokens file, using the shapes frozen above.
- **For the next batch:** the document formats above are frozen. `@codebox/design` is the only
  parser: Task-79 must import `parseTokens`, `parseRoutes`, `parseScreenSpec`,
  `checkDocuments` and `snapshotHash` rather than re-implementing a preview reader, and must not
  add a second design format beside this one (D52: every fact has one owner).
- **Empty dev slots (this batch is 2 of 4 by construction):** Task-76 depends on Task-75, which
  is in this batch; Tasks 77–80 each depend on Task-75 and/or would collide on
  `apps/app/src/app/features/works/**`; Task-30 depends on Task-29 and Task-31 on
  Task-26/28/30, and those roots (Task-02, Task-26, Task-29) are `[!]` on issue #11 (the App
  token has no `workflows` permission). No task was added.
- **Hot files:** **Task-74 holds `package-lock.json`** and `vitest.config.ts`. **Task-75 holds
  `apps/app/src/app/app.routes.ts`.** No task holds `package.json` (the root `workspaces` glob
  is `["apps/*", "packages/*"]`, so a new package needs no root edit), `tsconfig.base.json`,
  `apps/app/angular.json`, `apps/app/src/main.ts`, `apps/daemon/src/main.ts`,
  `packages/contracts/src/index.ts`, `opencode.json`, `TODO.md`, `CHANGELOG.md` or
  `docs/decisions.md`. Verified in the tree at `b93e224`.
- **Docs by section:** Task-74 holds `docs/jobs.md` §5 only, and may append one block there, not
  a new numbered section (the section numbers are cited from `docs/api.md` and Task-68).

## ⛔ Out of scope

- No `design/` artifact is created, and `design/README.md` is not touched (Task-79 owns it).
- No edit to `apps/daemon/src/run/**`, `apps/daemon/src/main.ts` or any other daemon file: the
  wiring is owed elsewhere, and silencing the gap by deleting the step is not an option.
- No restart of `run-gate.ts` or `secret-scan.ts`, and no move of a secret pattern into this
  package.
- No new dependency beyond `zod@4.6.7` (already in the lockfile through `@codebox/contracts`).
- No pixel or image comparison, no screenshot diffing, no PNG decoding: the only image
  operation allowed is hashing bytes.
- No `packages/design` import of `@codebox/contracts`, `@codebox/core` or any other workspace.
- No change to `docs/decisions.md`, `CHANGELOG.md`, `TODO.md` or `docs/providers.md` (there is no
  new configuration key).
- No refactor of a file this task does not have to touch; `apps/daemon/src/gate/README.md`
  changes by one bullet per new file and nothing else.

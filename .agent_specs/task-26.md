# Spec: Task-26 — End-to-end happy path

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** pipeline (web end-to-end plus a headless API half).
- **Role:** Dev.
- **Objective:** after this task, one command boots the real daemon on an ephemeral loopback
  port with a temporary `CB_STATE_DIR`, a fake OpenCode that edits the worktree, a fake GitHub
  and a local git remote, and drives the whole product flow — pair → add repo → run → gate →
  PR → merge → push — twice in a row; a Playwright suite drives the same flow through the
  built Angular app, and a headless suite proves the flow's determinism without a browser.
  The flow contacts no host outside `127.0.0.1` and touches no real credential.
- **Environment:** worktree `../wt-cb-26`, branch `task-26`, base `main`.
- **Dependencies:** four merged tasks whose files this one reads:
  - Task-14 (`apps/daemon/src/run/engine.ts`, `apps/daemon/src/gate/run-gate.ts`) — the run
    state machine and the gate.
  - Task-15 (`apps/daemon/src/runs/**`) — `POST /v1/works/{id}/runs`, `GET /v1/runs/{id}`,
    `GET /v1/runs/{id}/events`.
  - Task-20 (`apps/daemon/src/chat/**`, the app's SSE shell) — the daemon's SSE surface.
  - Task-22 (`apps/app/src/app/features/works/work.page.ts`) — the run detail the browser
    asserts against.
  - Also merged and read: Task-88's `apps/daemon/src/repos/**` (`/v1/repos`), `packages/opencode/src/wire.ts`,
    `packages/opencode/src/fake.ts`, `packages/git-provider/src/fake.ts`,
    `packages/workspaces/src/{clone,git,paths}.ts`, `apps/daemon/src/main.ts`,
    `apps/daemon/src/config.ts`, `scripts/dev-local.mjs`, `apps/app/src/app/core/auth/**`,
    `apps/app/src/app/features/pairing/pairing.page.ts`,
    `apps/app/src/app/features/repos/repos.page.ts`,
    `apps/app/src/app/features/backlog/repo-backlog.page.ts`.

### Exclusive paths (single writer)

Every path this task creates or modifies. Nothing outside this list. The `e2e/` tree is the
task's; the files named are the planned set and any additional file under `e2e/` is also this
task's, because no other task in the batch claims that directory.

- `e2e/README.md`
- `e2e/playwright.config.mjs`
- `e2e/tests/happy-path.spec.mjs`
- `e2e/tests/fixtures.mjs`
- `e2e/harness/environment.mjs`
- `e2e/harness/flow.mjs`
- `e2e/harness/git-fixture.mjs`
- `e2e/harness/clock.mjs`
- `e2e/fakes/opencode.mjs`
- `e2e/fakes/github.mjs`
- `e2e/unit/flow.test.mjs`
- `e2e/unit/opencode-fake.test.mjs`
- `e2e/unit/github-fake.test.mjs`
- `e2e/unit/git-fixture.test.mjs`
- `.github/workflows/e2e.yml`
- `package.json` — **only** the `@playwright/test` line in `devDependencies` and the `e2e` and
  `e2e:unit` lines in `scripts`. No other line changes.
- `package-lock.json` — the lock entries for `@playwright/test` and its transitive packages.

### Inputs (read-only)

Beyond `AGENTS.md`, and only these:

- `docs/agent-ci.md` §7 (the `[live]` measurement table) and §10 (permissions).
- `docs/api.md` §2 (pairing), §5.2 (repositories), §5.5 (works and runs), §6 (events).
- `docs/app.md` §2–§4 (routes and the shell).
- `.github/workflows/ci.yml` — the shape and concurrency of an existing workflow.
- `scripts/dev-local.mjs` — how a daemon is started, pointed at the app build and polled for
  health. This task does not edit it.
- `apps/daemon/src/main.ts` (`startDaemon`, `DaemonHandle`), `apps/daemon/src/config.ts`,
  `apps/daemon/src/repos/routes.ts`, `apps/daemon/src/works/service.ts`,
  `apps/daemon/src/runs/routes.ts`, `apps/daemon/src/app.ts`.
- `apps/daemon/src/run/engine.ts` (steps and event names), `apps/daemon/src/run/commit.ts`.
- `packages/opencode/src/{wire,fake,types}.ts` — the wire shapes the fake must emit.
- `packages/git-provider/src/fake.ts` — `startFakeGitHub` and its options.
- `packages/workspaces/src/{clone,git,paths,worktree}.ts` — `clonePath`, `GIT_ENV`,
  `createWorkspaceManager`.
- `packages/contracts/src/config.ts` — the `CB_*` keys and defaults the harness sets.
- `packages/contracts/src/{events,works,repos}.ts` — the JSON shapes the harness parses.
- `ops/image/scripts/45-browser.sh` — the pinned `playwright_version='1.64.1'` that decides
  `@playwright/test`'s version.
- `apps/app/src/app/features/pairing/pairing.page.ts`,
  `apps/app/src/app/features/repos/repos.page.ts`,
  `apps/app/src/app/features/backlog/repo-backlog.page.ts`,
  `apps/app/src/app/features/works/work.page.ts` — the `data-testid` attributes the browser
  asserts on. Do not add a test id: every selector below already exists.
- `apps/app/src/app/core/auth/auth.store.ts` and `pairing.ts` — the browser generates its own
  key pair; the harness pairs a separate device and never borrows the browser's tokens.
- `package.json`, `vitest.config.ts`, `eslint.config.js` — read to avoid joining the root gate.

## 🔒 Contract

The public surface the two suites and the workflow are written against. Nothing outside `e2e/`
imports these names; they are frozen so the dev, QA and the workflow agree.

```js
// e2e/harness/clock.mjs
export const FIXED_NOW = '2026-01-01T00:00:00.000Z';
export const FIXED_SEED = 0xc0de;
export function seededRandom(seed = FIXED_SEED): () => number; // mulberry32, [0, 1)

// e2e/harness/environment.mjs
/**
 * @typedef {object} Environment
 * @property {string} baseUrl        http://127.0.0.1:<ephemeral>
 * @property {string} stateDir       the temporary CB_STATE_DIR
 * @property {E2eGitHub} github      the loopback REST fake and its base-sha proxy
 * @property {E2eOpenCode} opencode  the loopback agent fake
 * @property {string} seedRemote     absolute path of the bare git remote
 * @property {string} token          the harness device's access token (see below)
 * @property {(name?: string) => Promise<string>} mintCode   POST /v1/pair/code (loopback)
 * @property {() => Promise<string>} latestRepoId            GET /v1/repos, the only row's id
 * @property {() => Promise<{ runId: string; branch: string; state: string }>}
 *           waitForSucceeded   newest run reaches a terminal state; rejects on failure
 * @property {() => Promise<void>} close                     stops daemon and fakes, removes temp
 */
export async function startEnvironment(options?: {
  /** Overrides merged over the frozen defaults; tests pass none. */
  env?: Record<string, string>;
}): Promise<Environment>;

// e2e/harness/flow.mjs
/**
 * @typedef {object} FlowResult
 * @property {string} repoId
 * @property {string} workId
 * @property {string} runId
 * @property {string} branch
 * @property {string[]} eventTypes       run event types in order, e.g. ['run.queued', ...]
 * @property {string} pushedBranchSha    the sha of `branch` in the seed remote
 * @property {string} pushedFileBody     `git show <branch>:e2e-change.txt` from the seed remote
 */
/** Drives the API half: create repo, create work, start run, wait for `succeeded`. */
export async function runApiFlow(env: Environment): Promise<FlowResult>;

// e2e/harness/git-fixture.mjs
export async function createSeedRepo(input: {
  root: string;
  slug: string;            // 'acme/widgets'
  defaultBranch: string;   // 'main'
}): Promise<{ remote: string; commit: string }>;   // bare remote at <root>/remote/acme/widgets.git
export async function seedCloneCache(input: {
  repoRoot: string;
  slug: string;
  remote: string;
  pushUrl: string;         // https://x-access-token:e2e-token@github.com/acme/widgets.git
}): Promise<string>;       // the bare cache path, with url.<base>.insteadOf pairs (see below)

// e2e/fakes/opencode.mjs
/**
 * @typedef {object} E2eOpenCode
 * @property {string} url
 * @property {readonly string[]} requests
 * @property {() => Promise<void>} close
 */
export function startE2eOpenCode(input: {
  /** Absolute directory the worktree lives in; the fake writes here on every prompt. */
  changeFile?: string;     // default 'e2e-change.txt'
  content?: string;        // default 'written by the e2e agent\n'
}): Promise<E2eOpenCode>;

// e2e/fakes/github.mjs
/**
 * `startFakeGitHub` plus one correction: every pull-request payload reports `base.sha` as the
 * real seed commit, because the shipped fake answers a constant `fakeSha(0)` and that would
 * make `evaluateAutoMerge` park every run with `base_moved`.
 * @typedef {object} E2eGitHub
 * @property {string} url            the proxy the daemon points at
 * @property {readonly FakeGitHubRequest[]} requests  the upstream fake's log
 * @property {() => Promise<void>} close
 */
export function startE2eGitHub(input: {
  token: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  baseSha: string;   // the seed commit, 40 hex
}): Promise<E2eGitHub>;
```

**Behaviour that is contract, not suggestion:**

- `startEnvironment` runs in this exact order: (1) `mkdtempSync` root; (2) `createSeedRepo`;
  (3) `startE2eGitHub` with the seed commit as `baseSha`; (4) `startE2eOpenCode`;
  (5) `seedCloneCache`; (6) `startDaemon({ env, appDir })` imported from `@codebox/daemon`
  (the built `dist/main.js`); (7) pair the harness device with `mintCode('e2e harness')` and
  `POST /v1/pair` (P-256 JWK) and expose its `accessToken` as `env.token`. The daemon starts with
  `CB_BIND=127.0.0.1:0`, the temporary `CB_STATE_DIR`, `CB_TMP_DIR`, `CB_REPO_ROOT` and
  `CB_WORKSPACE_ROOT` (all four created with `mkdirSync(..., { recursive: true })`; the
  workspace root must exist before `createWorktree`), and
  `appDir = <repo>/apps/app/dist/browser`. It returns `baseUrl` from
  `handle.port`, never a fixed port. It never starts `codebox.service`, never binds 4096 and
  never reads `/var/lib/codebox`.
- The frozen environment (exact keys and values; anything else is inherited and irrelevant):

  | Key | Value |
  | --- | --- |
  | `CB_ENV` | `test` |
  | `CB_SESSION_SECRET` | `e2e-session-secret-0123456789abcdef` (32+ chars) |
  | `CB_BIND` | `127.0.0.1:0` |
  | `CB_LOG_LEVEL` | `warn` |
  | `CB_STATE_DIR`, `CB_TMP_DIR`, `CB_REPO_ROOT`, `CB_WORKSPACE_ROOT` | absolute paths under the temp root |
  | `CB_INSTALL_DIR` | `<temp root>/install` (unused; `appDir` is passed explicitly) |
  | `CB_OPENCODE_URL` | the fake's `url` |
  | `CB_OPENCODE_HEALTH_PATH` | `/api/info` |
  | `CB_GITHUB_API_URL` | the `startE2eGitHub` proxy `url` |
  | `CB_GITHUB_TOKEN` | `e2e-token` |
  | `CB_GATE_DEFAULT` | `test -f e2e-change.txt` |
  | `CB_GATE_SHELL` | `/bin/bash` |
  | `CB_AUTOMERGE` | `on` |
  | `CB_MERGE_METHOD` | `squash` |
  | `CB_PROBATION_RUNS` | `0` |
  | `CB_MAX_CONCURRENCY` | `1` |
  | `CB_DIFF_MAX_FILES` | `40` |
  | `CB_DIFF_MAX_LINES` | `2000` |

  No `CB_ALLOWED_ORIGINS` and no `CB_PUBLIC_URL`: an empty allowlist accepts any origin
  (`apps/daemon/src/app.ts`, `originAllowed(..., []) === true`), and the browser's origin is
  unknown until the daemon listens.
- `startEnvironment` builds the seed remote and the clone cache **before** the run:
  1. `createSeedRepo` writes `TODO.md` with exactly one section and one open item:

     ```md
     # TODO

     ## Batch 0 — fixture

     - [ ] **[Task-01]** Add the e2e change marker. *Paths:* `e2e-change.txt`.
           *Dependencies:* none.
     ```

     and commits it on `main` with author `e2e <e2e@example.invalid>` and committer date
     `2026-01-01T00:00:00Z` (`GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`), then
     `git clone --bare <work> <root>/remote/acme/widgets.git`.
  2. `seedCloneCache` creates the bare cache at `clonePath(repoRoot, 'acme/widgets')` by
     calling `createWorkspaceManager(...).ensureClone({ slug: 'acme/widgets',
     defaultBranch: 'main', cloneUrl: 'file://<absolute seed remote>' })`, then adds two
     `url.<base>.insteadOf` pairs to that cache's config with `<base>` = `file://` + the
     absolute seed-remote path: one with value `https://github.com/acme/widgets.git` and one
     with value `https://x-access-token:e2e-token@github.com/acme/widgets.git`.
     This is why the push is hermetic: `pushBranch` runs
     `git -C <worktree> push https://x-access-token:e2e-token@github.com/acme/widgets.git ...`
     with an empty environment, but git reads the shared repository config and rewrites the
     URL to the local seed remote.
- `startEnvironment` starts `startE2eGitHub` **after** the seed commit exists, with
  `baseSha = <seed commit>`. The shipped `startFakeGitHub` answers every pull-request payload
  with `base.sha = '0'.repeat(40)`; `evaluateAutoMerge` compares that with
  `worktree.baseSha` and would park every run with `base_moved`, so `e2e/fakes/github.mjs`
  runs `startFakeGitHub` on a loopback port and puts a loopback proxy in front of it whose
  only rewrite is `base.sha = baseSha` in every 2xx JSON response that has `base.sha`.
  Everything else is forwarded unchanged, including the `Authorization` header and the body,
  and `requests` is the upstream fake's log. This is the one fact the shipped fake cannot
  express; it is not a second GitHub implementation.
- `runApiFlow` performs, in order:
  1. Uses `env.token`, the access token of the **harness device** that `startEnvironment`
     paired during setup (one `mintCode('e2e harness')` exchanged through `POST /v1/pair`
     with a P-256 JWK generated from `node:crypto.webcrypto`:
     `subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign','verify'])`
     then `subtle.exportKey('jwk', publicKey)`). The browser still pairs its own device
     through the UI with a second code; the two devices never share a token. Every later
     harness request carries `Authorization: Bearer <env.token>`.
  2. `POST /v1/repos` with `{ "slug": "acme/widgets", "defaultBranch": "main",
     "gate": "test -f e2e-change.txt" }` → `201`; keep `id`.
  3. `POST /v1/works` with `{ "repoId": <id>, "backlogRef": "Task-01" }` → `201`; keep `id`.
  4. `POST /v1/works/<workId>/runs` with `Idempotency-Key: e2e-<runAttempt>` and
     `{}` → `202`; keep `id`.
  5. Poll `GET /v1/runs/<runId>` every 100 ms until `state` is `succeeded` (fail after 60 s
     with the last state, gate and blockers in the message). The gate status must be
     `passed` and `blockers` empty.
  6. Read `GET /v1/runs/<runId>/events` and keep the ordered `event` values.
  7. Read `branch` from the run and assert the seed remote has it:
     `git --git-dir=<seed remote> show-ref --verify refs/heads/<branch>` exits 0 and
     `git --git-dir=<seed remote> show <branch>:e2e-change.txt` is exactly
     `written by the e2e agent\n`.
- The fake OpenCode (`e2e/fakes/opencode.mjs`) speaks the wire in
  `packages/opencode/src/wire.ts`; it does **not** reuse `startFakeOpenCode`, because that fake
  cannot edit the worktree. It implements:
  - `GET /api/info` → `200 {"version":"e2e-1.0.0"}`.
  - `GET /api/model` → `200 {"data":[{"id":"claude-sonnet-4","providerID":"anthropic","name":"Claude Sonnet 4"}]}`
    and `GET /api/agent` → `200 {"data":[{"name":"build","mode":"primary"},{"name":"plan","mode":"primary"}]}`,
    the same answers the shipped fake gives; a boot-time probe must not 404.
  - `POST /api/session` → `200 {"id":"ses_e2e<N>","title":<title>,"directory":<directory>}`,
    remembers `directory` per session (`N` counts from 1).
  - `GET /api/event[?sessionID=]` → `200 text/event-stream`, keeps the response open and
    registers it as the subscriber for the whole stream (the daemon subscribes before it
    prompts).
  - `POST /api/session/:id/prompt` → `202` immediately; then, in `setImmediate` order:
    1. write `<directory>/e2e-change.txt` with `written by the e2e agent\n`;
    2. send the frames below to the open subscriber, each as
       `data: <encodeEvent(event) JSON>\n\n`.
    Frames, in this order (ids fixed; `msg_e2e1`):
    ```json
    {"type":"session.updated","properties":{"sessionId":"<id>","status":"busy"}}
    {"type":"message.part.tool","properties":{"sessionId":"<id>","messageId":"msg_e2e1","tool":"edit","status":"start"}}
    {"type":"message.part.text","properties":{"sessionId":"<id>","messageId":"msg_e2e1","delta":"wrote e2e-change.txt"}}
    {"type":"message.part.tool","properties":{"sessionId":"<id>","messageId":"msg_e2e1","tool":"edit","status":"ok"}}
    {"type":"session.usage","properties":{"sessionId":"<id>","model":"anthropic/claude-sonnet-4","tokensIn":12,"tokensOut":8,"costUsd":0.001}}
    {"type":"session.updated","properties":{"sessionId":"<id>","status":"idle"}}
    ```
  - `POST /api/session/:id/interrupt` → `204`; `POST /api/session/:id/permissions/:pid` →
    `204`; `DELETE /api/session/:id` → `204`; anything else → `404`.
  - The frame bodies are built locally as `{ type, properties }`; the unit test decodes every
    frame with `decodeEvent` from `@codebox/opencode` and expects a non-null event.
- The Playwright spec (`e2e/tests/happy-path.spec.mjs`) uses the same environment and drives
  the browser only:
  1. `page.goto(baseUrl + '/pair')`; fill `[data-testid="pair-code"]` with `await env.mintCode()`,
     `[data-testid="pair-device-name"]` with `e2e browser`; click `[data-testid="pair-submit"]`.
     Wait for the dashboard (`url` no longer ends `/pair`) — the app's own key pair is generated
     by `AuthStore.pair`.
  2. `page.goto(baseUrl + '/repos')`; fill `[data-testid="repo-slug"]` with `acme/widgets`,
     `[data-testid="repo-default-branch"]` with `main`, `[data-testid="repo-gate"]` with
     `test -f e2e-change.txt`; click `[data-testid="repo-submit"]`; wait for
     `[data-testid="repo-row"]`; `const repoId = await env.latestRepoId()`; wait for
     `[data-testid="repo-row"][data-repo-id="<repoId>"]`.
  3. Click the row's link `[data-testid="repo-link-<repoId>"]`; wait for
     `[data-testid="backlog-row"][data-ref="Task-01"]`.
  4. Click `[data-testid="backlog-run-Task-01"]`; the app navigates to `/works/<workId>`.
  5. `await env.waitForSucceeded()` (the harness polls `GET /v1/runs`), then `page.reload()`.
     Assert `[data-testid="work-run"][data-state="succeeded"]` exists,
     `[data-testid="work-run-gate"][data-status="passed"]` exists,
     `[data-testid="work-run-pr"][data-state="merged"]` contains a `#<number>` link, and
     `[data-testid="work-run-backlog-tick"]` contains `Task-01`.
- `e2e/playwright.config.mjs` freezes `testDir: './tests'`, `testMatch: '**/*.spec.mjs'`,
  `workers: 1`, `retries: 0`, `forbidOnly: true`, `reporter: [['list']]`, and `outputDir`
  under `node:os` `tmpdir()` (never inside the repository, so `npm run lint` never lints a
  report).
- `.github/workflows/e2e.yml` freezes `name: E2E`; `on: pull_request`, `push` to `main` and
  `workflow_dispatch`; `permissions: contents: read`; the same `concurrency` shape as
  `ci.yml` (`group: e2e-${{ github.ref }}`, `cancel-in-progress: true`); one job `e2e` on
  `ubuntu-24.04`, `timeout-minutes: 30`, with steps: checkout, `actions/setup-node@v4` Node 24
  with `cache: npm`, `npm ci`, `npm run build`, `npx playwright install --with-deps chromium`,
  a `no-network guard` step that runs the next one under `unshare -rn`, the Playwright step
  `npm run e2e -- --repeat-each=2`, then `npm run e2e:unit`. A job that fails to install
  Chromium fails the workflow; it never falls back to a browser-less pass.
- The root `package.json` gains exactly:
  `"e2e": "playwright test --config e2e/playwright.config.mjs"` and
  `"e2e:unit": "node --test e2e/unit/"`, and `"@playwright/test": "1.64.1"` in
  `devDependencies`. `1.64.1` is the version the image bakes
  (`ops/image/scripts/45-browser.sh`), so the CI browser and the app's Chromium are the same
  revision. `@playwright/test` runs no install script and downloads no browser during
  `npm ci`.
- `e2e/README.md` maps every file in the folder, one line per file and no exported names
  (`AGENTS.md`'s folder-map rule), and states in three lines: `npm run e2e:unit` is the
  headless half, `npm run e2e` needs Chromium, and the two `[live]` measurements live in
  `.github/workflows/e2e.yml`.
- **The `e2e` suites do not join `npm test`.** `npm test` stays
  `test:guard && test:app && vitest run`; the root gate must not need a browser or a built
  daemon. `npm run e2e:unit` is the headless half and is run by the e2e workflow, not by
  `npm test`.

### Data

No persisted key, no API payload, no event type and no `CB_*` key is added or changed. The
fixture's `TODO.md` uses the existing `backlogRefSchema` grammar (`/^Task-\d+$/`).

## 🧩 Configuration

- No new `CB_*` key. The `CB_*` table in `packages/contracts/src/config.ts` is unchanged and
  `docs/providers.md` is not edited.
- The two npm scripts and the one devDependency above are the only configuration.

## 🧪 Test and Validation Plan (for QA)

**This runner has no browser and no VM.** QA runs the `[unit]` half verbatim. The Playwright
half is written and reviewed here but executed only by `.github/workflows/e2e.yml`; the two
`[live]` criteria are therefore **not run** by this QA, which must say so in its report and
hand each one to the Orchestrator for an `agent-review` issue. Do not substitute a headless
run for the Playwright half and do not drop a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`);
    must be green with the updated lockfile and must not download a browser.
  - `npm run lint` — must pass (it lints `e2e/**/*.mjs`).
  - `npm test` — must pass and must **not** run anything under `e2e/` (check with
    `npm test -- --reporter=verbose` or by grepping the output for `e2e`).
  - `npm run build` — `tsc -b` and the Angular build; `apps/app/dist/browser/index.html` must
    exist afterwards.
  - `npm run e2e:unit` — the headless half; it boots the daemon, the fakes and the local git
    remote, runs the API flow twice, and passes.
  - `npm run e2e` — only where Chromium is available (the workflow runs
    `npx playwright install --with-deps chromium` before it). QA records `not-run` on this
    runner if the browser cannot be installed; it does not fake it.
  - `git diff --name-only main...task-26` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks through lint, `npm test` and `npm run build` clean.
  - [ ] `[unit]` `npm ci` from a fresh checkout is green and installs no browser (`npx
        playwright --version` answers `Version 1.64.1`; no directory appears under
        `~/.cache/ms-playwright` before an explicit `npx playwright install`).
  - [ ] `[unit]` `npm run e2e:unit` passes; its output names two iterations and both end
        `succeeded` with gate `passed` and the pushed file body `written by the e2e agent`.
        The test asserts the two iterations' `eventTypes` arrays are equal after normalising
        `run_*`/`job_*`/`ses_*` ids and every `ts`, that `FIXED_NOW` and
        `seededRandom(FIXED_SEED)` drive every harness-side value, and that the second
        iteration starts from an empty temp root. This is the fixed clock and fixed seed.
  - [ ] `[unit]` `e2e/unit/opencode-fake.test.mjs` decodes every frame with
        `decodeEvent(...)` and gets a non-null event; `e2e/unit/github-fake.test.mjs` creates
        a pull request through the proxy and asserts `GET /repos/acme/widgets/pulls/1` answers
        `base.sha` equal to the `baseSha` it was started with; and
        `e2e/unit/git-fixture.test.mjs` proves that `git push <pushUrl>` from a worktree of
        the cache lands the branch in the seed remote (run it against a temp root).
  - [ ] `[unit]` Nothing outside the exclusive paths was touched (`package.json` diff is the
        two scripts and the one devDependency; `package-lock.json` changes only for
        `@playwright/test`).
  - [ ] `[unit]` `.github/workflows/e2e.yml` parses (`node -e "const y=require('fs').readFileSync('.github/workflows/e2e.yml','utf8'); if(!y.includes('name: E2E')) process.exit(1)"`)
        and its test step is wrapped by the no-network guard below; `npm test` does not call
        it.
  - [ ] `[live]` **The full flow passes twice in a row on CI with no network access.**
        Measurement: the `e2e` job of `.github/workflows/e2e.yml` runs
        `unshare -rn sh -c 'ip link set lo up && npm run e2e -- --repeat-each=2'` as its test
        step, with the browser pre-installed and `PLAYWRIGHT_BROWSERS_PATH` pointing at it;
        a socket to any address other than `127.0.0.1` fails with `ENETUNREACH` inside that
        namespace. The criterion passes only when both repetitions are green and the job's
        `Playwright` step reports two passed tests. Not measurable on this runner (no
        browser; `unshare` is not exercised here); the Orchestrator files
        `node scripts/agent/issue.mjs --label agent-review --title "Task-26: the e2e flow twice on CI with no network" --body-file -`.
  - [ ] `[live]` **A forwarded push is observed by a service worker.** Measurement: in the
        same job, after the merged run, the Playwright test registers a web-push subscription
        against the daemon (loopback endpoint) and uses CDP
        `ServiceWorker.deliverPushMessage` on the built app's `ngsw-worker.js` with the
        payload the daemon emits for `run.merged`; the bound is one `push` event handled by
        the service worker and one `showNotification` call whose `data.runId` equals the
        run's id. **This tree has no `push` handler in `ngsw-worker.js`** (`apps/app/src` has
        none, and this task may not add app code), so the criterion is not measurable until
        an app task adds it. The Orchestrator files
        `node scripts/agent/issue.mjs --label agent-review --title "Task-26: service-worker push observation" --body-file -`
        with the measurement above; QA marks it `not-run`, never `pass`.

## 📣 Coordination

- For the Orchestrator: this task is the batch's **only hot-file holder** — `package.json` and
  `package-lock.json`. Do not let the Task-29 dev touch either.
- For the Orchestrator: the two `[live]` criteria are unmeasured on this runner (no browser, no
  VM). Open one `agent-review` issue for each, with the exact title and measurement above; both
  are prerequisites of Task-31 and neither blocks this merge while the `[unit]` criteria are
  green.
- For Task-30 (docs pass): `docs/agent-ci.md` §7 still says an app measurement is
  `npx playwright test` "against the built app and a daemon wired to `FakeOpenCode`"; this
  task adds `e2e/README.md` with the actual command (`npm run e2e:unit` and `npm run e2e`) and
  the fixture it uses. Task-30 reconciles the doc; this task does not edit it.
- For the next batch: the e2e harness is the place a future `[live]` criterion for the app
  should hook (a `startEnvironment()` plus a browser), not a second daemon bootstrap.
- Known coupling, recorded on purpose: the hermetic push relies on `packages/workspaces`
  reading the shared repository config for `url.*.insteadOf` (git behaviour, not a project
  contract) and on `clonePath(repoRoot, slug)` being `<owner>__<name>.git`. If either changes,
  `seedCloneCache` is the single place to update and `git-fixture.test.mjs` fails first.

## ⛔ Out of scope

- No change to `apps/daemon`, `packages/*`, `apps/app` or any production code: the daemon has
  no test seam to add and this task does not invent one. If the flow needs one, that is a new
  task, not this one.
- No `[unit]` test under `e2e/` is added to `vitest.config.ts` or to `npm test`.
- No real GitHub token, no real model provider, no tunnel, no FCM/APNs send, no port 4096, no
  `/var/lib/codebox`, no `codebox.service`.
- No screenshot or visual-regression baseline: the app's layout is Batch 23's, not this
  task's.
- No change to `docs/decisions.md`, `TODO.md`, `CHANGELOG.md` or any hot file other than the
  two named.
- No new dependency outside `@playwright/test@1.64.1`.

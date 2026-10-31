# Spec: Task-30 — Docs and ADR pass

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** docs.
- **Role:** Dev.
- **Objective:** the documentation set describes the tree that exists. Every doc claim that
  names a file, route, configuration key, command, systemd unit or decision is true of the
  shipped code, or carries one dated line naming the open task that will make it true. The
  five incident runbooks in `docs/operations.md` §10 are complete and executable, the doc
  index lists every doc, and the two stale "design-only until Batch 1" statements are gone.
  After this task a new operator can follow the docs on the box without meeting a dead path,
  an unknown `CB_*` key or a route the app does not serve.
- **Environment:** worktree `../wt-cb-30`, branch `task-30`, base `main`.
- **Dependencies:** Task-29 (merged; it shipped `.github/workflows/release.yml`,
  `scripts/release/**` and `docs/operations.md` §4 and §13, which this task reads and must
  stay true). Everything else this task reads is merged: Tasks 01–29 and 68–89.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `docs/**` — every file under `docs/`, including `docs/decisions.md` (this task is the
  decision owner for the amendment described below), `docs/README.md` and
  `docs/operations.md`.
- `README.md`
- `AGENTS.md`

`TODO.md` and `CHANGELOG.md` belong to the Orchestrator: **do not touch them.** No file under
`apps/`, `packages/`, `scripts/`, `ops/`, `infra/`, `design/`, `.github/`, `.agent_roles/` or
`e2e/` is written by this task.

### Inputs (read-only)

Read any file in the repository; this is a reconciliation task and the tree is the source of
truth. The files that carry the facts being checked, in order of importance:

- `packages/contracts/src/config.ts` — the configuration schema `parseConfig` validates: the
  authoritative `CB_*` list, its defaults and its required keys.
- `apps/daemon/src/**` (non-test) — the routes each subsystem mounts, the CLI, the push and
  run paths.
- `apps/app/src/app/app.routes.ts`, `apps/app/src/app/app.routes.spec.ts` — the routes the app
  serves and the frozen tests that pin them.
- `packages/contracts/src/openapi.ts`, `openapi.test.ts` — the 63 documented `/v1` paths and
  the test that keeps `docs/api.md` equal to them.
- `scripts/agent/**`, `scripts/release/**`, `scripts/design/**`, `.github/workflows/*.yml` —
  the pipeline keys, the release names and the commands the docs quote.
- `ops/vm/**`, `ops/image/**`, `infra/**` — the systemd units, install/upgrade scripts and
  Terraform variables the docs quote.
- `design/README.md`, `design/routes.json` (absent until L6) — the screen map.

## 🔒 Contract

The docs are prose; the contract is what a doc may assert.

1. **Shipped, not planned.** A doc describes the tree as it is on `main`. When a frozen
   decision has already moved and the task that implements it is open in `TODO.md`, the doc
   states the shipped behaviour and carries **one** dated line naming the decision and the
   open task, in the shape `Amended 2026-10-31: <decision> moves this to <target>; <task
   name> ships it.` Never invent a state the tree does not have.
2. **No dead reference.** Every path, route, `CB_*` key, command, unit name, script and
   decision ID a doc names exists in the tree (a command may be quoted from a script that
   exists). Every relative markdown link resolves.
3. **One owner per fact.** A fact lives in one doc and the others link to it: the config
   surface in `docs/providers.md`, the `/v1` surface in `docs/api.md`, the screens in
   `docs/app.md` §4, the incidents in `docs/operations.md` §10, the decisions in
   `docs/decisions.md`. Do not copy a table into a second doc.
4. **Decisions are frozen.** `docs/decisions.md` may receive **one** amendment, to **D2**
   ("this delivery is documentation only"), because the tree has shipped code since Batch 1:
   keep the ID and the original rule text, and append the dated clause in the same cell in
   the style the file already uses (`Retired by D44`, `Amends D52`). Do not renumber, delete
   or rewrite any other decision, and do not add a new `D##` — a new decision is its own
   task.
5. **The diff is drift-sized.** Touch a doc because a claim in it is false or missing, never
   because its prose could be nicer. A doc whose every claim is true is left byte-identical;
   a rewrite of a true doc is a failure, not a bonus.

### Data — the drift this task must resolve (verified on `main` at `7b24e00`)

These are known and must be fixed or explicitly justified in the report. The systematic pass
below is expected to find more.

- **`docs/providers.md` §9 names a key the code does not read.** It documents
  `CB_RETENTION_WORK_MESSAGES_DAYS`; `packages/contracts/src/config.ts` reads
  `CB_RETENTION_CHAT_DAYS`. Rename the row and give it the schema's real default.
- **`docs/providers.md` omits ten keys the tree reads** (the `[unit]` check below prints
  them): `CB_RETENTION_CHAT_DAYS`; the four pipeline keys `CB_AGENT_ENV`, `CB_AGENT_REPO`,
  `CB_AGENT_AUTOPILOT_STATE`, `CB_AGENT_MERGE` (they belong in §13, read by
  `scripts/agent/vm/*.sh`); and the five OCI CLI keys `CB_OCI_CLI_TENANCY`,
  `CB_OCI_CLI_USER`, `CB_OCI_CLI_FINGERPRINT`, `CB_OCI_CLI_REGION`,
  `CB_OCI_CLI_KEY_CONTENT` (they belong in §12, read by the OCI workflow/ops scripts). Each
  row states default, owner and failure, like its neighbours.
- **`docs/api.md` §11 "Screens → routes" lists routes the app does not serve** —
  `/settings/providers`, `/runs`, `/runs/:id`, `/approvals` — and omits three it does serve:
  `/repos/:id/workers`, `/repos/:id/design`, `/settings/notifications`. The table must list
  exactly the routes `apps/app/src/app/app.routes.ts` serves (the `**` wildcard excepted),
  each with the `/v1` calls its page actually makes (read the page's `.api.ts`/store), and
  the retired `/settings/schedules` row may stay only with its "Retired" note.
- **`docs/app.md` §4** lists `/settings/providers` as a route and states a repository carries
  four tabs. The operator ruled on 2026-10-30 that a repository keeps **two** tabs
  (`Backlog · Workers`) and the schedule becomes a sheet over the backlog, which Task-99
  ships; the shipped app still mounts four. State the shipped behaviour and add the one dated
  line (contract rule 1) naming the ruling and the task. Same treatment for
  `/repos/:id/design`, if the table still lists it as a tab target.
- **`README.md` §Next and `docs/README.md` §Conventions** still say the repository is
  design-only until Batch 1 / "design-only until Batch 1". Both are false since Batch 1
  shipped: replace with the shipped state (the status block at the top of `README.md` is
  correct — keep it and make the tail agree with it).
- **`docs/README.md`** must index every file under `docs/` (check with `ls docs/`); a doc
  added by a later batch and not indexed is drift.
- **`docs/operations.md` §10** already carries five incidents (10.1 app cannot connect, 10.2
  every run fails at `preparing`, 10.3 a run stuck in `running`, 10.4 a bad merge landed,
  10.5 the instance vanished). Verify each step against the shipped commands (`cb doctor`,
  `cb revert`, `cb brake`, the unit names in `ops/vm/systemd/`, the log paths), complete what
  is missing (the exact command, the expected output, the next step if it does not hold) and
  say in the report whether anything was added or only verified.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest plus the app suite; includes `packages/contracts/src/openapi.test.ts`
    (`docs/api.md` routes == the 63 OpenAPI paths) and
    `apps/app/src/app/app.routes.spec.ts` (the frozen route table). Both must stay green.
  - `npm run build` — `tsc -b` and the app build.
  - `git diff --name-only main...task-30` — audit against the exclusive paths.
  - The three doc checks below, run from the repository root of the worktree.
- **Acceptance criteria:**
  - [ ] `[unit]` Lint, test and build are green, and `docs/api.md`'s route table still equals
        the 63 OpenAPI paths (`openapi.test.ts` passes unchanged).
  - [ ] `[unit]` **Every relative markdown link resolves.** Run:

        ```bash
        node --input-type=module - <<'EOF'
        import { existsSync, readFileSync, readdirSync } from 'node:fs';
        import { dirname, resolve } from 'node:path';
        const files = ['README.md', 'AGENTS.md',
          ...readdirSync('docs').filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];
        const broken = [];
        for (const file of files) {
          for (const match of readFileSync(file, 'utf8').matchAll(/\]\(([^)\s]+)\)/g)) {
            const target = match[1];
            if (/^(https?:|mailto:|#)/.test(target)) continue;
            const path = target.split('#')[0];
            if (path && !existsSync(resolve(dirname(file), path))) broken.push(`${file} -> ${target}`);
          }
        }
        if (broken.length > 0) { console.error(broken.join('\n')); process.exit(1); }
        console.log(`links: ${files.length} file(s), 0 broken`);
        EOF
        ```

        Expected: `links: <n> file(s), 0 broken`, exit 0.
  - [ ] `[unit]` **The configuration surface is documented both ways.** Run:

        ```bash
        node --input-type=module - <<'EOF'
        import { readFileSync, readdirSync } from 'node:fs';
        import { join } from 'node:path';
        const skip = /(\.test\.|\.spec\.)/;
        const files = ['packages/contracts/src/config.ts'];
        const walk = (dir) => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) { if (!['node_modules', 'dist', 'coverage'].includes(entry.name)) walk(path); }
            else if (!skip.test(path)) files.push(path);
          }
        };
        walk('scripts/agent');
        for (const entry of readdirSync('.github/workflows')) files.push(join('.github/workflows', entry));
        const keys = (text) => [...text.matchAll(/\bCB_[A-Z0-9_]+\b/g)].map((m) => m[0]).filter((k) => !k.endsWith('_'));
        const code = new Set(files.flatMap((file) => keys(readFileSync(file, 'utf8'))));
        const docs = new Set(keys(readFileSync('docs/providers.md', 'utf8')));
        const missing = [...code].filter((k) => !docs.has(k)).sort();
        const stale = [...docs].filter((k) => !code.has(k)).sort();
        if (missing.length > 0 || stale.length > 0) {
          console.error(`read but undocumented: ${missing.join(' ') || 'none'}`);
          console.error(`documented but unread: ${stale.join(' ') || 'none'}`);
          process.exit(1);
        }
        console.log(`config: ${code.size} key(s), documented both ways`);
        EOF
        ```

        Expected: `config: <n> key(s), documented both ways`, exit 0.
  - [ ] `[unit]` **`docs/api.md` §11 lists exactly the routes the app serves.** Run:

        ```bash
        node --input-type=module - <<'EOF'
        import { readFileSync } from 'node:fs';
        const norm = (p) => p.replace(/^\//, '');
        const md = readFileSync('docs/api.md', 'utf8');
        const start = md.indexOf('## 11. Screens');
        if (start === -1) { console.error('docs/api.md §11 not found'); process.exit(1); }
        // §11 is the last section of docs/api.md; it runs to the end of the file.
        const documented = [...md.slice(start).matchAll(/^\|\s*`([^`]+)`\s*\|([^|]*)\|/gm)]
          .filter((m) => !m[2].trim().startsWith('Retired'))
          .map((m) => norm(m[1]));
        const router = readFileSync('apps/app/src/app/app.routes.ts', 'utf8');
        const served = [...new Set([
          ...[...router.matchAll(/path:\s*'([^']*)'/g)].map((m) => norm(m[1])).filter((p) => p && p !== '**'),
          'dashboard', 'repos', 'settings',
        ])];
        const undocumented = served.filter((p) => !documented.includes(p));
        const dead = documented.filter((p) => !served.includes(p));
        if (undocumented.length > 0 || dead.length > 0) {
          console.error(`served but undocumented: ${undocumented.join(' ') || 'none'}`);
          console.error(`documented but unserved: ${dead.join(' ') || 'none'}`);
          process.exit(1);
        }
        console.log(`routes: ${served.length} served, all documented`);
        EOF
        ```

        Expected: `routes: <n> served, all documented`, exit 0.
  - [ ] `[unit]` **Nothing outside the exclusive paths was touched.**
        `git diff --name-only main...task-30` lists only `docs/**`, `README.md`, `AGENTS.md`.
  - [ ] `[unit]` **The two "design-only" statements are gone and `docs/README.md` indexes
        every doc.** Run:

        ```bash
        ! grep -rn "design-only" README.md docs/
        ! grep -n "bootstraps the repository" README.md
        node --input-type=module - <<'EOF'
        import { readFileSync, readdirSync } from 'node:fs';
        const index = readFileSync('docs/README.md', 'utf8');
        const missing = readdirSync('docs')
          .filter((f) => f.endsWith('.md') && f !== 'README.md')
          .filter((f) => !index.includes(`(${f})`))
          .sort();
        if (missing.length > 0) { console.error(`not indexed: ${missing.join(' ')}`); process.exit(1); }
        console.log('index: every doc linked');
        EOF
        ```

        Expected: both `grep`s find nothing (exit 1, inverted by `!`) and the last command
        prints `index: every doc linked`.
  - [ ] `[unit]` **D2 carries one dated amendment and no decision ID moved:**
        `git diff main...task-30 -- docs/decisions.md` shows exactly one changed table row
        (D2) and no added `D##`; `grep -c '^| \*\*D' docs/decisions.md` is unchanged from
        `main`.
  - [ ] `[live]` **A new operator follows the runbook and restores a backup in a scratch VM.**
        Measurement: on a scratch Ubuntu 24.04 arm64 VM built from `ops/image`, follow
        `docs/operations.md` §5 and §10.5 end to end — `cb backup` on the source box, restore
        the newest dump on the scratch box, `cb doctor` exits 0 and `/v1/health` answers with
        the restored row count. **Not measurable on this runner** (no VM, no box): report it
        as not run; the Orchestrator hands it to an `agent-review` issue.

## 📣 Coordination

- For the Architect: the drift list above is the measured gap between the docs and `main` at
  `7b24e00`. Anything the pass finds beyond it is new information; name it in the report so
  the next cut can weigh it.
- For the next batch: `docs/api.md` §11 and `docs/app.md` §4 are the two tables a screen task
  reads. After Task-30 they match the router on the merge commit; Task-99 changes both when it
  retires `/repos/:id/schedule` and `/repos/:id/design`, so it must re-read §11 rather than
  copy this task's table.
- For QA: the three `[unit]` checks are the task's own definition of done; a green `npm test`
  alone does not prove any of them.

## ⛔ Out of scope

- No code, test, workflow, script, unit file, Terraform or `design/` change. A doc that is
  false because the code is wrong is reported, not fixed here.
- No new dependency, no new tool, no link-checker package: the checks above are inline Node.
- No rewrite of a doc whose claims are true, and no reflow of a table that did not change.
- No new decision (`D##`), no renumbering, no deletion in `docs/decisions.md`; the single D2
  amendment is the only edit there.
- No `TODO.md` or `CHANGELOG.md` edit — the Orchestrator ticks the box and writes the entry.
- No change to `docs/agent-spec-template.md`'s rules and no change to `.agent_roles/**`.

# Spec: Task-48 — Issue dedupe

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** pipeline (deterministic helper in `scripts/agent`, plus the documents that tell
  a role how to open an issue).
- **Role:** Dev.
- **Objective:** After this task, opening a work order is a **deterministic, idempotent
  command** instead of a hand-written `gh issue create`. A new module `scripts/agent/issue.mjs`
  lists the open issues, matches the requested title against the open `agent-review` and
  `agent-blocked` issues, and either creates **at most one** issue or comments on the existing
  one and returns its number. Its unit tests prove create-once, comment-on-repeat and
  create-on-different-title with an injected fake `gh` port — no network, no token. The
  canonical prompt, the role file and `docs/agent-ci.md` name the helper instead of a bare
  `gh issue create`, so a retried step or a second agent cannot double the measurement backlog
  the way #22 and #23 did on 2026-10-26.
- **Environment:** worktree `../wt-cb-48`, branch `task-48`, base `main`.
- **Dependencies:** none. `scripts/agent/{recon,gate,verdict}.mjs`, their tests,
  `scripts/agent/vm/prompt.md`, `.agent_roles/orchestrator.md` and `docs/agent-ci.md` are on
  `main` today.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path. Touching anything outside this list is a failure of the task.

- `scripts/agent/issue.mjs` (new)
- `scripts/agent/issue.test.mjs` (new)
- `scripts/agent/vm/prompt.md`
- `.agent_roles/orchestrator.md`
- `docs/agent-ci.md` (section: the new subsection **`### The issue handoff`** appended to
  `## 7. [live] criteria`, immediately before `## 8. The loop's guards`; no other section)
- `scripts/README.md`

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `scripts/agent/recon.mjs`, `scripts/agent/recon.test.mjs`
- `scripts/agent/gate.mjs`, `scripts/agent/gate.test.mjs`
- `scripts/agent/verdict.mjs`, `scripts/agent/verdict.test.mjs`
- `scripts/agent/vm/prompt.md`, `scripts/agent/vm/README.md`
- `.agent_roles/orchestrator.md`, `.agent_roles/qa.md`
- `docs/agent-ci.md`, `docs/agent-pipeline.md`
- `.github/workflows/agent-cycle.yml`, `.github/workflows/agent-autopilot.yml`
- `vitest.config.ts` (the `scripts` project: `root: './scripts'`, `include: ['**/*.test.mjs']`)
- `eslint.config.js`

## 🔒 Contract

`scripts/agent/issue.mjs` is an ESM module with a default-less named export surface, Node
built-ins only (`node:child_process`, `node:fs`), and a CLI entry guarded exactly the way
`recon.mjs` guards its own (`if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();`).
No new dependency.

```js
/** The two labels a work order may carry. Frozen. */
export const HANDOFF_LABELS = ['agent-review', 'agent-blocked'];

/** @typedef {{ number: number, title: string, labels: string[] }} OpenIssue */

/**
 * Trim, collapse runs of whitespace to one space and lowercase. The comparison key of a
 * title. Exported so the test can pin it.
 * @param {string} title
 * @returns {string}
 */
export function titleKey(title);

/**
 * Every open issue whose `titleKey` equals `titleKey(title)` and whose labels include one of
 * HANDOFF_LABELS, ascending by `number`.
 * @param {OpenIssue[]} issues
 * @param {string} title
 * @returns {{ number: number, title: string }[]}
 */
export function findDuplicates(issues, title);

/**
 * The decision, as a pure function.
 * @param {{ issues: OpenIssue[], title: string, label: string }} input
 * @returns {{ action: 'create', title: string, label: string, duplicates: number[] }
 *         | { action: 'comment', number: number, title: string, label: string, duplicates: number[] }}
 */
export function decideHandoff({ issues, title, label });

/**
 * The effect. Lists once, decides, then creates or comments — never both.
 * @param {{
 *   gh: GhPort,
 *   title: string,
 *   label: string,
 *   body: string,
 * }} input
 * @returns {Promise<{ action: 'created' | 'commented', number: number, url: string, duplicates: number[] }>}
 */
export async function handoff({ gh, title, label, body });

/**
 * The real `gh` adapter. The only place in this module that spawns a process.
 * @returns {GhPort}
 */
export function createGhPort();

/**
 * @typedef {object} GhPort
 * @property {() => Promise<OpenIssue[]>} listOpen
 *   `gh issue list --state open --limit 200 --json number,title,labels`, normalised to
 *   `{ number, title, labels: string[] }`.
 * @property {(input: { title: string, label: string, body: string }) => Promise<{ number: number, url: string }>} create
 *   `gh issue create --label <label> --title <title> --body-file -`.
 * @property {(input: { number: number, body: string }) => Promise<{ url: string }>} comment
 *   `gh issue comment <number> --body-file -`.
 */
```

- **`decideHandoff` rules, frozen:**
  - `duplicates` is `findDuplicates(issues, title).map((issue) => issue.number)`, ascending.
  - `duplicates.length > 0` → `{ action: 'comment', number: duplicates[0], ... }`. It comments on
    the **lowest** number; it never closes or edits an issue.
  - otherwise → `{ action: 'create', ... }` with `title` normalised to
    `title.trim().replace(/\s+/g, ' ')` (original case kept) and `label` as given.
  - `label` must be one of `HANDOFF_LABELS`; anything else throws
    `new Error(\`unknown handoff label: ${label}\`)`. Validate **before** listing.
- **`handoff` body of a comment, frozen:** the literal first line
  `Reported again by a second attempt; the original report stands.`, then one blank line, then
  the body passed in. A create uses the body unchanged.
- **Errors:** the CLI writes one JSON line to **stderr** — `{"error":"<message>"}` — and exits
  **1** when `gh` fails or the label is unknown, exits **2** on a usage error (missing
  `--title` or missing both `--body` and `--body-file`). A success prints one JSON line to
  **stdout** and exits **0**.
- **CLI, frozen:**
  `node scripts/agent/issue.mjs --label <label> --title <text> (--body <text> | --body-file <path>|-)`.
  `--body-file -` reads stdin. Unknown arguments are a usage error (exit 2).
- **Success output, frozen shape and key order:**
  `{"action":"created"|"commented","number":<n>,"url":"<url>","duplicates":[<n>,...]}`.
- **Purity:** `titleKey`, `findDuplicates` and `decideHandoff` are pure — no clock, no process,
  no filesystem, no environment. Only `createGhPort` and the CLI touch the outside world.
- **Ordering:** exactly one `gh` read (`listOpen`) before the single write. `handoff` never
  creates and comments in the same call.

### Data

- Comparison key: `title.trim().replace(/\s+/g, ' ').toLowerCase()`.
- Search scope: open issues only, carrying `agent-review` or `agent-blocked`. An issue with a
  different label and the same title is **not** a duplicate.
- `listOpen` reads at most 200 open issues (`gh issue list --limit 200`). Document in the
  module's header comment that this is a bound, not a pagination.
- **Residual race, stated on purpose:** GitHub has no unique constraint on an issue title, so
  two processes that both list before either creates can still both create. This helper shrinks
  the window from "a model checks by hand" to "one list and one create", and reports
  `duplicates` so the cycle sees a pair when it happens. It does not claim atomicity; do not
  write a comment that claims it.

## 🧩 Configuration

No `CB_*` key is added or read. `GH_TOKEN` is read by the `gh` binary, not by this module; the
module never reads `process.env` itself.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass. `scripts/**` is linted by the root config.
  - `npm test` — Vitest, headless; includes `scripts/agent/issue.test.mjs` through the
    `scripts` project.
  - `npm run build` — `tsc -b` for the packages and the app.
  - `npx vitest run --project scripts` — the targeted run, for the evidence line.
  - `git diff --name-only main...task-48` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `npm run lint`, `npm test` and `npm run build` are green.
  - [ ] `[unit]` `scripts/agent/issue.test.mjs` exists and covers, with an in-memory fake
        `GhPort` and no network:
        (a) an empty list → `handoff()` calls `create` once and returns
        `{ action: 'created', duplicates: [] }`;
        (b) calling `handoff()` twice with the same title on the same fake list → exactly one
        `create` and exactly one `comment`, the comment carrying the frozen first line and the
        second body, and the second result is `{ action: 'commented', number: <first> }`;
        (c) a different title → a second `create`;
        (d) `titleKey` collapses whitespace and case (`'  Task-48:  v3 '` equals `'task-48: v3'`);
        (e) an issue with the same title but a label outside `HANDOFF_LABELS` is not a
        duplicate;
        (f) `decideHandoff` on `[{number: 23, ...}, {number: 22, ...}]` both matching returns
        `number: 22` and `duplicates: [22, 23]`;
        (g) `decideHandoff` throws on `label: 'bug'`.
        Verify with:
        `npx vitest run --project scripts --reporter=verbose` and read the case names.
  - [ ] `[unit]` The CLI is idempotent against a fake `gh`. Run this block verbatim from the
        worktree root:

        ```bash
        mkdir -p .qa-bin
        cat > .qa-bin/gh <<'STUB'
        #!/usr/bin/env bash
        set -euo pipefail
        echo "$*" >> /tmp/qa-calls.log
        state=/tmp/qa-issues.json
        [ -f "$state" ] || printf '[]\n' > "$state"
        case "$1 $2" in
          "issue list")
            cat "$state" ;;
          "issue create")
            title=""; prev=""
            for arg in "$@"; do
              [ "$prev" = "--title" ] && title="$arg"
              prev="$arg"
            done
            body=$(cat)
            number=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/qa-issues.json','utf8')).length + 22)")
            node -e "const fs=require('fs');const p='/tmp/qa-issues.json';const s=JSON.parse(fs.readFileSync(p,'utf8'));s.push({number:Number(process.argv[1]),title:process.argv[2],labels:[{name:'agent-review'}]});fs.writeFileSync(p,JSON.stringify(s))" "$number" "$title"
            echo "https://example.invalid/issues/$number" ;;
          "issue comment")
            cat > /dev/null
            echo "https://example.invalid/issues/$3" ;;
          *)
            echo "unexpected gh call: $*" >&2; exit 1 ;;
        esac
        STUB
        chmod +x .qa-bin/gh
        : > /tmp/qa-calls.log
        PATH="$PWD/.qa-bin:$PATH" node scripts/agent/issue.mjs --label agent-review \
          --title "Task-99: probe" --body "first"
        PATH="$PWD/.qa-bin:$PATH" node scripts/agent/issue.mjs --label agent-review \
          --title "task-99: PROBE" --body "second"
        PATH="$PWD/.qa-bin:$PATH" node scripts/agent/issue.mjs --label agent-review \
          --title "Task-98: other" --body "third"
        node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/qa-issues.json','utf8')).map((i) => i.number).join(','))"
        grep -c "issue create" /tmp/qa-calls.log
        rm -rf .qa-bin /tmp/qa-issues.json /tmp/qa-calls.log
        git status --short
        ```

        Expect: the first command prints `"action":"created"` with `"number":22`; the second
        prints `"action":"commented"` with `"number":22` (the title matched after whitespace and
        case normalisation) and **no** `create` line appears in `/tmp/qa-calls.log` for it; the
        third prints `"action":"created"` with `"number":23`; the `node -e` line prints
        `22,23`; `grep -c` prints `2`; `git status --short` is empty.
  - [ ] `[unit]` `grep -n "gh issue create" scripts/agent/vm/prompt.md .agent_roles/orchestrator.md docs/agent-ci.md`
        prints **no** line that tells a role to open an issue that way; every match is inside a
        sentence that names `scripts/agent/issue.mjs` as the path (or is an example of what not
        to do, quoted as such).
  - [ ] `[unit]` `grep -c "scripts/agent/issue.mjs" scripts/agent/vm/prompt.md .agent_roles/orchestrator.md docs/agent-ci.md scripts/README.md`
        reports a non-zero count for each of the four files.
  - [ ] `[unit]` `scripts/README.md` has one table row for `issue.mjs` and one for
        `issue.test.mjs`, each one line, no exported names.
  - [ ] `[unit]` `git diff --name-only main...task-48` lists exactly: `scripts/agent/issue.mjs`,
        `scripts/agent/issue.test.mjs`, `scripts/agent/vm/prompt.md`,
        `.agent_roles/orchestrator.md`, `docs/agent-ci.md`, `scripts/README.md`.
  - [ ] `[live]` **Not measurable here.** The backlog asks that "a cycle that finishes two
        batches leaves two issues, and re-running the same batch leaves the count unchanged".
        That needs a dispatched `agent-cycle` run with a real model, a real `GH_TOKEN` and two
        real batches, which GitHub Actions in this cycle cannot do (no provider key, no second
        batch, no issue API write from a sandboxed QA). **Measurement, when a human runs it:**
        dispatch `agent-cycle` twice against the same batch; read
        `gh issue list --state all --label agent-review,agent-blocked --search "Task-"`,
        and require the count after the second run to equal the count after the first. Report
        this as an `agent-review` issue titled
        `Task-48: measure that two cycles leave two issues, not four` — **never** as passing.

## 📣 Coordination

- **For the Architect:** the batch has one hot file in Task-49 (`package.json`) and none here.
  This task adds two files under `scripts/agent/**`, which the backlog already assigns to it.
- **For the Architect (path debt, needs a decision):** `.github/workflows/agent-autopilot.yml`
  still opens its parked-loop issue with an inline `gh issue create` (the `red()` shell
  function, lines 75 and 121–126) and `.github/workflows/agent-cycle.yml` opens none. Those
  workflows are **not** in this task's paths, so the duplicate that the autopilot can produce
  on a retried cron is **not** closed by this task. It is a one-line swap to
  `node scripts/agent/issue.mjs ...` in a later task that owns `.github/workflows/agent-*.yml`.
  Record it; do not widen this task.
- **For the Orchestrator:** the helper is the only sanctioned way to open a work order from now
  on. The prompt is the canonical text for both hosts (`agent-cycle.yml` pipes it in and the VM
  runs it), so editing it once covers Actions and the box.
- **For QA:** the helper must be importable by Vitest with no `node_modules` beyond the root —
  Node built-ins only. A test that shells out to a real `gh` is a spec failure.
- **For the next batch:** `docs/agent-ci.md` §7 now documents the handoff. A task that opens an
  issue anywhere else (a workflow, a new script) cites that subsection.

## ⛔ Out of scope

- No change to `.github/workflows/**`, `scripts/agent/{recon,gate,verdict}.mjs`, their tests, or
  `scripts/agent/vm/*.sh`.
- No closing, labelling or editing of an existing issue: the helper comments, it never resolves
  the duplicate pair #22/#23.
- No pagination beyond `--limit 200`, no search API, no GraphQL, no new dependency.
- No retry/back-off around `gh`: a failure is reported, not retried.
- No change to `TODO.md`, `CHANGELOG.md`, `docs/decisions.md` or any other document outside the
  named section of `docs/agent-ci.md`.

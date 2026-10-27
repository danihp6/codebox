# Spec: Task-69 — Licence and third-party notices

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** legal / ops scripts (no application code).
- **Role:** Dev.
- **Objective:** The repository stops claiming MIT without a licence: `LICENSE` holds the MIT
  text, and `NOTICE` lists every production dependency from `package-lock.json` exactly once.
  A deterministic generator writes `NOTICE` from the lockfile and a test fails the gate when
  the committed file drifts or when a copyleft-only package ships without a written exception.
- **Environment:** worktree `../wt-cb-69`, branch `task-69`, base `main` (`1ff4d80`).
- **Dependencies:** none.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `LICENSE` (new)
- `NOTICE` (new, generated)
- `scripts/legal/notice.mjs` (new)
- `scripts/legal/notice.test.mjs` (new)

Task-62 owns `docs/app.md` §4 (the screens table). The About row lives **inside** §4, so this
task edits **no part of `docs/app.md`** — see Coordination. Task-52 owns `docs/api.md`;
nothing here touches it.

### Inputs (read-only)

- `AGENTS.md`, `docs/agent-spec-template.md`
- `package.json`, `package-lock.json` (read only — never modify either)
- `docs/open-questions.md` Q14 (the MIT claim this task makes true)
- `docs/app.md` §4 (the About row), `docs/product.md`
- `scripts/README.md`, `scripts/agent/*.mjs` (the ESM/Node-built-ins style)
- `apps/app/src/app/features/about/about.page.ts` (a placeholder owned by Task-67)

## 🔒 Contract

### 1. `LICENSE`

Verbatim MIT, 21 lines, LF, one trailing newline, ASCII:

```
MIT License

Copyright (c) 2026 Codebox contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The owner line is `Copyright (c) 2026 Codebox contributors`: no owner name is written in
`docs/product.md`, `design/README.md`, `README.md`, `package.json` or the git config (only the
bot identity), so this is the fallback the batch prescribes. Do not invent a person's name.

### 2. `scripts/legal/notice.mjs`

Plain Node ESM, `node:` built-ins only (`node:fs`, `node:path`, `node:url`, `node:process`).
**No new dependency, no `package.json` change** (it is a hot file and not yours).

Exports:

```js
export const NOTICE_HEADER;      // the exact header below
export const COPYLEFT_EXCEPTIONS; // Readonly<Record<string, string>>, package name -> reason
export const LICENSE_OVERRIDES;   // Readonly<Record<string, string>>, package name -> licence id

export function collectProductionPackages(lockfile); // -> readonly { name, version, license }[]
export function renderNotice(packages);              // -> string
export function isCopyleftOnly(license);             // -> boolean
export function checkNotice(packages, bytes);        // -> boolean
export async function main(argv);                    // -> Promise<number> (exit code)
```

**Production scan rule (state it in a comment in the file):** walk `lockfile.packages`; include
an entry when all hold:

1. its key contains `node_modules/` (so `""`, `apps/app`, `packages/contracts` and every
   workspace entry are excluded);
2. `entry.link !== true` (workspace symlinks are excluded);
3. `entry.dev !== true` (this is npm's `--omit=dev` tree; `devOptional` entries are **kept**,
   because npm still installs an optional dependency of a production package when only dev
   dependencies are omitted);
4. `entry.version` is a string.

The package name is the substring after the **last** `node_modules/` (so
`node_modules/@scope/name` → `@scope/name` and a nested copy keeps its own name). Dedupe by
`name@version`. The licence is `entry.license` when it is a string, `entry.license.type` when
it is an object, else `LICENSE_OVERRIDES[name]`, else `UNKNOWN`. Sort by `name` then `version`
with a plain locale-independent comparison (`a < b ? -1 : a > b ? 1 : 0`).

**Copyleft-only rule (state it too):** normalise to upper case, strip surrounding parentheses,
split a `WITH …` suffix off (keep the left side), split an `OR` expression into alternatives;
a package is copyleft-only when **every** alternative matches
`/^(A?GPL|LGPL|SSPL)(-[0-9][0-9A-Za-z.+-]*)?(-ONLY|-OR-LATER)?$/`. This covers GPL, LGPL,
AGPL and SSPL and their `-only`/`-or-later` forms. Weak or file-level licences — `MPL-2.0`,
`EPL-2.0`, `CDDL-1.0`, `CC-BY-4.0`, `BlueOak-1.0.0`, `Unlicense`, `ISC`, `Apache-2.0`, `MIT` —
are **not** copyleft-only under this rule and are recorded with their identifier, not treated
as exceptions.

**`NOTICE` bytes** — exact header, then one line per package, then the exception block:

```
Codebox
Third-party notices for the production dependency tree.

Generated by scripts/legal/notice.mjs from package-lock.json. Do not edit by hand.

This distribution includes the following third-party packages:

- @angular/common@22.2.3 — MIT
- ...

Copyleft exceptions
-------------------
(none)
```

- Each package line is `- <name>@<version> — <license>` (em dash U+2014, one space either
  side). A package with an entry in `COPYLEFT_EXCEPTIONS` appends ` — exception: <reason>`.
- The exception block lists `(none)` when `COPYLEFT_EXCEPTIONS` is empty, otherwise one
  `- <name>@<version> — <license> — <reason>` line per matching package, sorted.
- LF only, UTF-8, exactly one trailing newline, no timestamp, no host, no absolute path.
- Same lockfile in, same bytes out.

CLI, run from the repository root and also from `scripts/`:

- `node scripts/legal/notice.mjs` → writes `<repo>/NOTICE`, prints `wrote NOTICE (<n> packages)`,
  exit `0`.
- `node scripts/legal/notice.mjs --check` → exit `0` when the committed `NOTICE` equals
  `renderNotice(collectProductionPackages(lock))`; on a mismatch prints
  `NOTICE is stale: run node scripts/legal/notice.mjs` to `stderr` and exits `1`.
- any other argument → prints `usage: node scripts/legal/notice.mjs [--check]` and exits `2`.
- The repo root is resolved from `import.meta.url` (`new URL('../../package-lock.json',
  import.meta.url)`), never from `process.cwd()`.

### 3. `scripts/legal/notice.test.mjs`

Runs under the `scripts` Vitest project (`include: ['**/*.test.mjs']`, root `./scripts`), so
`process.cwd()` is `scripts`; resolve the repo root with
`new URL('../../', import.meta.url)`.

Required tests (names are QA anchors):

1. **`NOTICE matches the lockfile`** — `readFileSync(NOTICE) === renderNotice(collectProductionPackages(lock))`.
2. **`every production package appears exactly once`** — for every collected package, count the
   occurrences of `` `- ${name}@${version} — ` `` **inside the package block** (between the line
   `This distribution includes the following third-party packages:` and the blank line before
   `Copyleft exceptions`) and expect exactly `1`; also expect the number of `- ` lines in that
   block to equal the package count.
3. **`the production tree carries the shipped roots`** — the set contains
   `@angular/core@22.2.3`, `@ionic/angular@9.0.9`, `@capacitor/core@8.5.3`,
   `@hono/node-server@2.1.5`, `hono@4.13.13`, `zod@4.6.7`, `rxjs@7.8.2`, `tslib@2.8.1` and
   `ionicons@8.1.0`.
4. **`no production package has an unknown licence`** — every `license` is a non-empty string
   and not `UNKNOWN`.
5. **`no copyleft-only package ships without a written exception`** — for every package with
   `isCopyleftOnly(license)`, `COPYLEFT_EXCEPTIONS[name]` is a non-empty trimmed string and its
   `NOTICE` line contains ` — exception: ${reason}`; every key of `COPYLEFT_EXCEPTIONS` names a
   package that is in the production set (no dead exceptions).
6. **`the generator is deterministic`** — two calls to `collectProductionPackages` are
   deep-equal and two calls to `renderNotice` are byte-identical.
7. **`--check detects drift`** — `checkNotice(packages, renderNotice(packages)) === true`;
   `checkNotice(packages, renderNotice(packages) + '\n') === false`; and spawning
   `execFileSync(process.execPath, ['scripts/legal/notice.mjs', '--check'], { cwd: rootPath })`
   (where `rootPath = fileURLToPath(new URL('../../', import.meta.url))`) does not throw.

Do not rewrite `NOTICE` from the test; the test only reads.

## 🧩 Configuration

No `CB_*` key, no environment variable, no dependency. The generator runs before
`node_modules` exists (it reads the lockfile only), so it works in a fresh worktree.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim in `../wt-cb-69` (no `node_modules` in a fresh worktree).

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint`
  - `npm test` (runs the `scripts` project, which includes `notice.test.mjs`)
  - `npm run build`
  - `git diff --name-only main...task-69`
- **Acceptance criteria:**
  - [ ] `[unit]` Gate green: `npm ci --prefer-offline --no-audit --no-fund && npm run lint && npm test && npm run build`.
  - [ ] `[unit]` `node scripts/legal/notice.mjs --check` exits `0` **without** `node_modules`.
  - [ ] `[unit]` `npx vitest run --project scripts` passes and includes the seven tests above by name.
  - [ ] `[unit]` `LICENSE` is the exact 21-line MIT text: `grep -qx 'MIT License' LICENSE` and `grep -qx 'Copyright (c) 2026 Codebox contributors' LICENSE` both succeed, and `LICENSE` ends with exactly one newline.
  - [ ] `[unit]` `NOTICE` starts with the frozen header (`grep -qx 'Codebox' NOTICE` and `grep -qx 'Third-party notices for the production dependency tree.' NOTICE`), contains one `- <name>@<version> — <license>` line per production package, and its last line is not blank beyond the single trailing newline.
  - [ ] `[unit]` `grep -q 'Copyleft exceptions' NOTICE` and the block is either `(none)` or lists every exception that `COPYLEFT_EXCEPTIONS` declares.
  - [ ] `[unit]` `git diff --name-only main...task-69` is exactly `LICENSE`, `NOTICE`, `scripts/legal/notice.mjs`, `scripts/legal/notice.test.mjs` — zero others.
  - [ ] `[live]` The About screen's "Open source licences" row opens a list identical to `NOTICE`. **Not measurable from a worktree: report `[?]` / not run, never `passing`; the Orchestrator opens the `agent-review` issue.** Measurement on a box: tap the row on `/about` and diff the rendered list against `NOTICE` package by package.

## 📣 Coordination

- **Owner name:** none exists in the repository or its docs. `LICENSE` uses
  `Codebox contributors` and `2026`, the prescribed fallback; a human who owns the copyright
  can change that one line later without touching the generator.
- **`docs/app.md` is untouched.** The binding allocation said “About section only”, but
  `docs/app.md` has no About section: the only About content is the `/about` row **inside §4**,
  which Task-62 owns in this batch, and it already promises “Version, commit, server health,
  licences”. `apps/app/src/app/features/about/about.page.ts` is a placeholder owned by
  Task-67, so no copy claims a licence list that does not exist. Editing §4 here would collide
  with Task-62 for no gain.
- **No `package.json` script** is added for regeneration: it is a hot file and not this task's.
  The test in `npm test` is the drift guard: a lockfile change that forgets to regenerate
  `NOTICE` turns the gate red with `NOTICE is stale: run node scripts/legal/notice.mjs`.
- `scripts/README.md` documents `scripts/agent` only, so it stays untouched; a map for
  `scripts/legal` is not required by `AGENTS.md` (it applies to packages and apps).
- For the next batch: `NOTICE` is a generated artifact — never hand-edit it; run
  `node scripts/legal/notice.mjs` after any dependency change.

## ⛔ Out of scope

- No `docs/app.md`, `docs/open-questions.md`, `README.md`, `docs/product.md` edit; no About
  screen work (Task-67).
- No `package.json`/`package-lock.json` change, no dependency, no CI workflow change, no
  `TODO.md`/`CHANGELOG.md`/`docs/decisions.md`/`opencode.json`/`tsconfig.base.json`/
  `.agent_specs/**`.
- No per-dependency licence text bodies in `NOTICE`, no SBOM, no `LICENSE` headers in source
  files.

## 🚩 Handover (binding)

1. Work on branch `task-69` in `../wt-cb-69`. Never touch `main`.
2. When — and only when — `npm run lint`, `npm test` and `npm run build` are green on your
   own worktree, commit your work and push it:
   `git push -u origin task-69`.
3. Then leave the turnstile as an **empty** commit on the tip and push it again:
   `git commit --allow-empty -m "dev: done task-69" && git push origin task-69`.
   A tip that does not read `dev: done task-69` is a dead dev and the task is redone from
   scratch, so never skip the marker and never put code in it.
4. Never `git merge`, never open or merge a PR, never edit `TODO.md`, `CHANGELOG.md`,
   `docs/decisions.md` or `.agent_specs/` (the spec travels in the branch and is dropped at the
   merge by the Orchestrator).
5. Report, in this order: the worktree path; the `task-69` tip sha; every command you ran with
   its exit code; the acceptance checklist with `pass` / `fail` / `not run` per item (a
   `[live]` item is `not run`, never `passing`); the files you created or modified; and any
   contract deviation or assumption. Never report a green you did not measure.

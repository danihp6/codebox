# Spec: Task-121 — `docs/app.md` §1 and §3 describe what ships

> The spec is the subagent's entire world. Anything not written here does not exist.

## 🎯 Scope

- **Task type:** docs. Two sections of one file; no code, no screen, no frame, no route.
- **Role:** Dev.
- **Objective:** `docs/app.md` §1 (stack) and §3 (project layout) stop describing software the
  repository does not contain. §1's "Native shell" and "UI" rows describe the shipped Capacitor
  and Ionic setup, §3's tree is the real `apps/app/src` tree, and every number, heading and
  byte of §2 and §4–§14 stays exactly as it is on `main`.
- **Environment:** worktree `../wt-cb-121`, branch `task-121`, base `main` at `32eb17b`.
- **Dependencies:** none. `docs/app.md` §11–§12 were rewritten by Task-115 (merged) and are
  read-only here; the tree being described is the shipped `apps/app/src/app` (Task-18 and the
  feature tasks). No batch-mate produces any file this task reads.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in
Batch 33 claims the same path.

- `docs/app.md` — **exactly two rows in §1 and the fenced tree block in §3**; the heading
  numbers, §1's other rows, §3's two closing paragraphs and §2, §4–§14 do not change by one
  byte

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/app.md` (all of it — §11 especially: it is the section that already records that the
  client makes no push subscription)
- `apps/app/package.json` (the dependency list; there is no Capacitor plugin beyond
  `@capacitor/core`, `@capacitor/android`, `@capacitor/ios` and `@capacitor/cli`)
- `apps/app/capacitor.config.ts`
- `apps/app/src/app/app.config.ts`, `apps/app/src/app/app.component.ts`
- `apps/app/src/app/core/auth/secure-store.ts`
- `apps/app/src/theme/tokens.ts`, `apps/app/src/theme/variables.css`
- the directory listing of `apps/app/src` (the tree being frozen)
- `apps/app/src/app/readme.spec.ts` (proves the README map moves only when a file does)

## 🔒 Contract

The file's public surface is the text itself. The two §1 rows and the §3 block below are frozen
verbatim: QA checks them byte-for-byte, and nothing else in §1 or §3 may move.

### §1 — replace the `UI` row and the `Native shell` row with exactly these two lines

```
| UI | Ionic Angular 9 (standalone components and `provideIonicAngular`, imported from `@ionic/angular`) | Native-feeling navigation, safe areas, hardware back. |
| Native shell | Capacitor (iOS + Android) | One codebase and one web build (`capacitor.config.ts`); no native plugin ships, so push delivery stays the daemon's (§11). |
```

Why these are the two false rows:

- `@ionic/angular/standalone` is imported by no file under `src/app`; every Ionic import —
  components and `provideIonicAngular` — is from `@ionic/angular` (`app.config.ts:7`,
  `app.component.ts:4`, `shell/tabs.page.ts:3`, and each page).
- "native push" and "Keychain/Keystore": `apps/app/package.json` carries no push or storage
  plugin, §11 records that the client makes no `PushManager` subscription, and
  `core/auth/secure-store.ts` is an IndexedDB store whose records are wrapped with AES-GCM —
  there is no Keychain/Keystore call in the tree. "deep links" is the same kind of claim: no
  `@capacitor/app` listener exists.

### §3 — replace the content of the fenced tree block with exactly these lines

```
apps/app/src/
  main.ts                     # bootstrapApplication, providers
  index.html
  styles.css
  manifest.webmanifest
  app/
    app.routes.ts             # every route, lazy
    app.config.ts             # router, http, i18n, sw, error handler
    app.component.ts          # IonApp and the router outlet
    core/
      api/                    # the typed client over /v1
      auth/                   # pairing, tokens, secure storage, guards
      events/                 # SSE client, reconnect, event bus
      i18n/                   # dictionary loading and the locale signal
      settings/               # local preferences (theme, locale)
      util/                   # time and formatting
    features/
      about/
      backlog/
      credentials/
      dashboard/
      pairing/
      repos/
      sessions/
      settings/
      works/
    shared/
      offline-banner.ts       # the stale-data banner
    shell/
      tabs.page.ts            # the bottom tab bar
      shell-tabs.ts           # the route to tab map
  theme/
    tokens.ts                 # THEME_TOKENS, mirrors design/tokens.json
    variables.css             # the --cb-* variables
  assets/i18n/
    en.json
    es.json
```

Facts this tree freezes and the old one denied: `theme/` is `src/theme/`, not `app/theme/`;
`shared/` holds one component (`offline-banner.ts` plus its spec and copy), not cards, chips,
empty states, a log viewer or a diff stat; there is no `core/push/` and no `features/providers/`
— the providers panel renders inside `features/settings`; `features/backlog`, `credentials`,
`pairing` and `sessions` exist; `shell/` holds the tab bar. The two paragraphs after the block
("One feature folder owns its routes…" and "A feature's copy lives beside it…") are true and
stay byte-identical.

## 🧩 Configuration

None. No `CB_*` key, no dependency, no code, no build-config change.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing
else is not a criterion.

- **Runner note (this batch, verbatim).** This batch runs on the operator's Windows host,
  where the full `npm test` cannot be green for reasons outside these tasks: `test:guard`'s
  quoting (Task-119 fixes it), 14 `scripts` tests that shell to bash/tar, 23 daemon tests that
  assert POSIX modes or spawn Unix tools, and the `ops` project that hangs (>300 s). The full
  gate's authority for this batch is the Linux CI workflow (`.github/workflows/ci.yml`, run
  with `gh workflow run ci.yml --ref task-121`), and the local commands are the targeted
  Vitest projects named per task plus `npm run lint` and `npm run build`. Never use `npx` on
  this host (it hangs); call `node node_modules/vitest/vitest.mjs run --project <name>`.
  *(This task adds no test; the three `node` programs below are its proof.)*
- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - Check A, from the repository root — every path the §3 tree prints exists, and every
    directory at depth 1 and depth 2 under `apps/app/src/app` is named by it:
    ```
    node --input-type=module -e "import { existsSync, readdirSync, readFileSync } from 'node:fs'; const fence = String.fromCharCode(96).repeat(3); const doc = readFileSync('docs/app.md', 'utf8'); const from = doc.indexOf('## 3.'); const to = doc.indexOf('## 4.'); if (from < 0 || to < 0) throw new Error('section 3 or 4 missing'); const stack = []; const paths = []; let fenced = false; for (const line of doc.slice(from, to).split('\n')) { if (line.trimStart().startsWith(fence)) { fenced = !fenced; continue; } if (!fenced || line.trim() === '') continue; const indent = line.length - line.trimStart().length; const text = line.slice(indent).split('#')[0].trim(); if (text === '') continue; while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop(); const parent = stack.length === 0 ? '' : stack[stack.length - 1].path; const path = parent === '' ? text : parent + '/' + text; stack.push({ indent, path }); paths.push(path.replace(/\/$/, '')); } const missing = paths.filter((path) => !existsSync(path)); if (missing.length > 0) throw new Error('tree paths that do not exist: ' + missing.join(', ')); const base = 'apps/app/src/app'; const dirs = []; for (const a of readdirSync(base, { withFileTypes: true })) { if (!a.isDirectory()) continue; dirs.push(base + '/' + a.name); for (const b of readdirSync(base + '/' + a.name, { withFileTypes: true })) { if (b.isDirectory()) dirs.push(base + '/' + a.name + '/' + b.name); } } const unnamed = dirs.filter((dir) => !paths.includes(dir)); if (unnamed.length > 0) throw new Error('directories the tree does not name: ' + unnamed.join(', ')); console.log('ok: ' + paths.length + ' tree paths, ' + dirs.length + ' directories');"
    ```
  - Check B, from the repository root — §2 and §4–§14 are byte-identical to `main` and §1
    differs in exactly two lines:
    ```
    node --input-type=module -e "import { execFileSync } from 'node:child_process'; import { readFileSync } from 'node:fs'; const before = execFileSync('git', ['show', 'main:docs/app.md'], { encoding: 'utf8' }); const after = readFileSync('docs/app.md', 'utf8'); const slice = (text, start, end) => { const i = text.indexOf(start); const j = end === null ? text.length : text.indexOf(end); if (i < 0 || j < i) throw new Error('marker not found: ' + start); return text.slice(i, j); }; if (slice(before, '## 2.', '## 3.') !== slice(after, '## 2.', '## 3.')) throw new Error('section 2 changed'); if (slice(before, '## 4.', null) !== slice(after, '## 4.', null)) throw new Error('sections 4-14 changed'); const a1 = slice(before, '## 1.', '## 2.').split('\n'); const b1 = slice(after, '## 1.', '## 2.').split('\n'); if (a1.length !== b1.length) throw new Error('section 1 changed shape'); let changed = 0; for (let i = 0; i < a1.length; i += 1) { if (a1[i] !== b1[i]) changed += 1; } if (changed !== 2) throw new Error('section 1 changed lines: ' + changed); console.log('ok: ' + changed + ' changed lines in section 1, sections 2-14 byte-identical');"
    ```
  - Check C — the frozen text is present and the false claims are gone:
    ```
    grep -n "one web build" docs/app.md; grep -n "the route to tab map" docs/app.md; grep -n "the stale-data banner" docs/app.md
    grep -nE "native push|@ionic/angular/standalone|core/push/|features/providers/" docs/app.md
    ```
    The first `grep` prints three lines; the second prints nothing.
  - `npm run lint` and `npm run build` — both must pass.
  - `git diff --name-only main...task-121` — must print only `docs/app.md`.
- **Acceptance criteria:**
  - [ ] `[unit]` Check A prints `ok: <n> tree paths, <m> directories` and throws nothing:
        every path the §3 block prints exists on disk and every depth-1 and depth-2 directory
        under `apps/app/src/app` is named by the block.
  - [ ] `[unit]` Check B prints `ok: 2 changed lines in section 1, sections 2-14
        byte-identical`.
  - [ ] `[unit]` Check C: the three frozen substrings are present and
        `native push`, `@ionic/angular/standalone`, `core/push/` and `features/providers/`
        appear nowhere in `docs/app.md`.
  - [ ] `[unit]` §1's two frozen rows are in the file byte-for-byte (a `grep -nF` of each row
        matches one line), and every other §1 row is unchanged.
  - [ ] `[unit]` §3's fenced block contains the frozen tree lines above, in that order and
        with that indentation (Check A is the structural proof; a line count is not).
  - [ ] `[unit]` `git diff --name-only main...task-121` prints only `docs/app.md`, so no file
        under `src/app` was added, renamed or deleted and `apps/app/src/app/readme.spec.ts`
        with `apps/app/README.md` are untouched (both are read-only inputs here).
  - [ ] `[unit]` `npm run lint` and `npm run build` pass.

## 📣 Coordination

- **For QA:** run Checks A–C from the repository root of the task worktree, where `main`
  exists (Check B reads `main:docs/app.md`). The `grep`/`git` binaries are the house tools;
  do not use `npx`.
- **For the next batch:** §3 is now the authoritative tree of `apps/app/src`. A task that adds
  a feature folder, a `core/` module or a `shared/` component updates §3 in the same task —
  Check A is the reason (it fails the moment a directory is unnamed).
- **For the Orchestrator:** this is the docs pass the Batch 32 cut recorded (`§1` at `:13`,
  `:12`, `§3` at `:54/:62/:65`). It is the last open debt of the Batch 32 record except the
  `docs/api.md` §5.5 duplicate sentence, `POST /v1/repos/{id}/run-next` in `openapi.ts`, the
  dead `/v1/providers` branch in `doctor.test.ts` and `readBuildInfo`'s `builtAt`.
- **Measured, not this task:** `docs/app.md` §6 (`:135`) still sends the refresh token to
  "Keychain (iOS) or Keystore (Android)" while `core/auth/secure-store.ts` is IndexedDB plus
  AES-GCM; §4 (`:99`) still promises `codebox://` deep-link handling while no Capacitor `appUrl`
  listener exists. Both sit in §4–§14, which this task must keep byte-identical, and are
  recorded for a later docs cut.

## ⛔ Out of scope

- No edit to `docs/app.md` §2, §4–§14 — not a comma, not a line ending.
- No renumbering or renaming of any heading; no new section.
- No code change under `apps/app` or `packages/`, no file added or deleted, so no README map
  moves.
- No rewrite of §1's other rows (Framework, Web, State, HTTP, Stream, i18n, Tests) and no edit
  to the two paragraphs that follow the §3 block.
- No change to `docs/api.md`, `design/` or `TODO.md`.

# Spec: Task-86 — Inter

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (theme + manifests) and docs.
- **Role:** Dev.
- **Objective:** after this task the app draws in the typeface the prototype draws. Inter
  400/500/600 is bundled from `@fontsource-variable/inter` as a dependency of `@codebox/app`,
  imported once from the app theme, served from the build instead of a CDN, and named by
  `--ion-font-family` and by the new `font.sans` token; `design/tokens.json` gains the
  typography group so the choice is a document and not a stylesheet line, and keeps its twelve
  colour leaves byte for byte.
- **Environment:** worktree `../wt-cb-86`, branch `task-86`, base `main` at
  `2375565dc8158ee6d23d8e92cde643558d5e60dd`.
- **Dependencies:** none. Nothing in this batch produces a file you read. Task-85 (the Figma
  import) and Task-87 (the notifications route) run beside you and touch disjoint paths.
- **Batch shape (frozen):** **you are the only task in Batch 22 allowed to change
  `package.json` and `package-lock.json`, and the only task allowed to run `npm install`.** No
  other task may add a dependency. Do not touch `apps/app/src/app/app.routes.ts` (Task-87),
  `design/import.json` (Task-87), `design/README.md` (Task-87 §1–§2, Task-85 §4),
  `docs/app.md` §4 (Task-87) or `packages/design/**` (Task-85).
- **The one new dependency is justified** because a variable font is the one thing a few lines
  cannot reproduce. It runs no install script and ships no runtime code: CSS and `woff2` files
  only. No CDN, no Google Fonts link, no network at first paint.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/package.json`
- `package.json` (root — held by you as the batch's hot-file holder; it is expected **not** to
  change, and if it does not, that is correct)
- `package-lock.json`
- `apps/app/src/theme/variables.css`
- `apps/app/src/theme/tokens.ts`
- `apps/app/src/theme/tokens.spec.ts` (new)
- `apps/app/README.md` (the `src/theme/` block of the file map only)
- `design/tokens.json`
- `docs/app.md` (**§9 "Design direction"** only, its prose bullet and its Design-tokens table)

`package.json` and `package-lock.json` are hot files and you are their only holder in this
batch: nobody else may write them, and a `git diff` that shows either file under another task
is a batch bug.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/agent-spec-template.md`
- `design/tokens.json` (you extend it), `design/README.md` §5 (the token rule; read only)
- `apps/app/src/theme/variables.css`, `apps/app/src/theme/tokens.ts` (you extend them)
- `apps/app/angular.json` (to see which stylesheets the build compiles — read only, you may
  not edit it), `apps/app/capacitor.config.ts` (the `webDir` the build writes to)
- `apps/app/src/main.ts` (read only — you may not edit it)
- `apps/app/package.json`, root `package.json`, `package-lock.json`
- `apps/app/vitest.config.mts`, `vitest.config.ts` (how the app suite runs)
- `docs/app.md` §9 (you edit it), `docs/app.md` §5 for the state rules the theme serves
- `apps/app/src/app/readme.spec.ts` (the README rule; read only)

**No screen task:** `design/screens/*.json` and `design/exports/*.png` do not exist in this
tree and are not inputs. The frame the `[live]` criterion names is
`01 · Pairing — mobile dark` (`design/README.md` §1, 390 × 844), and its spec lands at L6,
after this batch.

## 🔒 Contract

### `apps/app/package.json`

```json
"dependencies": {
  "@fontsource-variable/inter": "<exact version, no range>"
}
```

- Add it with `npm install -w @codebox/app --save-exact @fontsource-variable/inter`, so the
  manifest and `package-lock.json` agree on one exact `5.x.y` string. Every dependency in this
  repository is pinned exactly; a `^` or `~` is a defect.
- Nothing else in the manifest moves: no script, no other dependency, no `devDependency`.

### The font family and its one import

- The family the package declares is **`Inter Variable`**.
- The import is exactly one CSS import, the **first statement** of
  `apps/app/src/theme/variables.css` (CSS requires `@import` before any rule, and this file is
  already in `apps/app/angular.json`'s `styles` array, which this task may not edit):

  ```css
  @import '@fontsource-variable/inter';
  ```

  No `@font-face` block is hand-written, no second `@import`, no per-weight file
  (`/400.css`, `/500.css`, `/600.css`), no `wght.css` variant: the package's default entry
  ships the variable `wght` axis, which covers 400, 500 and 600 from 11 px to 30 px.
- `variables.css` gains `--cb-font-sans: 'Inter Variable', -apple-system, BlinkMacSystemFont,
  'Segoe UI', roboto, sans-serif;` and points the Ionic face at it:

  ```css
  --ion-font-family: 'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', roboto, sans-serif;
  ```

  `--cb-font-mono` keeps its value and `--cb-font-mono` is the mirror of `font.mono` below.
- `apps/app/src/theme/tokens.ts` gains one key, in this order and with this exact name:

  ```ts
  export const THEME_TOKENS = Object.freeze({
    // …the ten existing keys, unchanged and in place…
    fontSans: "'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', roboto, sans-serif",
  });
  ```

  `ThemeToken` follows automatically. No other key is renamed, reordered or removed.

### `design/tokens.json`

- The twelve colour leaves stay **exactly** as they are: same keys, same values, same
  `$type: "color"`, same nesting under `color.surface.*`, `color.ink.*`, `color.brand.*`,
  `color.waiting.*`, `color.danger.*`.
- The document gains one sibling group and nothing else:

  ```json
  "font": {
    "sans": { "$value": "Inter Variable", "$type": "fontFamily" },
    "mono": {
      "$value": "ui-monospace, sfmono-regular, menlo, consolas, 'Liberation Mono', monospace",
      "$type": "fontFamily"
    }
  }
  ```

  `font.mono`'s value is byte-identical to today's `--cb-font-mono` and to
  `THEME_TOKENS.fontMono`; `font.sans`'s value is the bare family name, not the fallback stack
  (the `sans-serif` fallback is a stylesheet concern, and the token names the face).
- The document therefore has **fourteen leaves: twelve `color` and two `fontFamily`**. Two
  consequences, both frozen and neither a bug:
  - `tokenValues()` returns fourteen strings. The design gate uses that list as the set of
    allowed *literals*; the two new strings are not colours, so no colour found in a patch or
    a caption can ever match them. The **colour-typed leaf count stays twelve** and the twelve
    values are unchanged.
  - `packages/design/src/tokens.ts` is **not** yours and must not change: do not teach
    `tokenValues` to filter by `$type`. The invariant is checked by type, below.

### `apps/app/src/theme/tokens.spec.ts`

A Vitest spec (`ng test` includes `src/**/*.spec.ts`; the app runner is Vitest), reading the
committed documents with `node:fs` the way `apps/app/src/app/readme.spec.ts` does
(`process.cwd()` is `apps/app`, so the repository root is `../..`):

- `design/tokens.json` parses as JSON and flattens to **fourteen** leaves.
- Exactly **twelve** leaves have `$type === 'color'`, and their `$value`s, lowercased and
  sorted, equal exactly:
  `['#0b0f14','#121821','#15803d','#22c55e','#5b6772','#8b98a5','#b45309','#e6edf3','#ef4444','#f59e0b','#f7f9fb','#ffffff']`.
- Exactly **two** leaves have `$type === 'fontFamily'`, at the keys `font.sans` and `font.mono`,
  with the two values above.
- No other leaf exists, and no `fontFamily` value matches a colour literal
  (`/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i`) — that is why the two leaves cannot be
  picked up by a colour check.
- `THEME_TOKENS.fontSans` contains `Inter Variable`, `THEME_TOKENS.fontMono` equals
  `design/tokens.json`'s `font.mono` value, and the seven colour keys of `THEME_TOKENS`
  (`bg`, `surface`, `text`, `muted`, `accent`, `warn`, `danger`) are all values of the twelve
  colour leaves.
- `apps/app/src/theme/variables.css` contains the single line
  `@import '@fontsource-variable/inter';` exactly once and no other `@import`, and its
  `--ion-font-family` value starts with `'Inter Variable'`.

### `docs/app.md` §9

- Replace the sentence that calls the UI face "the platform default" in the **Monospace**
  bullet with one that names Inter: the UI face is Inter, bundled through
  `@fontsource-variable/inter` (400/500/600, 11–30 px, no CDN, no network at first paint), and
  monospace stays the system stack for logs, diffs, branch names and ids.
- Add two rows to the §9 "Design tokens" table, after the twelve colour rows and in the same
  three-column shape: `font.sans` → `Inter Variable`, role "the bundled UI face; the origin of
  `--ion-font-family`"; `font.mono` → the mono stack, role "logs, diffs, branch names, ids".
- Nothing else in §9 changes: the twelve colour rows, their values and their roles stay
  verbatim, and the paragraph that calls `design/tokens.json` the source and the app the mirror
  stays true.
- **§4 is Task-87's sentence and §1–§8, §10–§14 are not yours.** Do not edit them.

## 🧩 Configuration

None. No `CB_*` key, no environment variable, no runtime setting. The font ships inside the
build; there is no font URL to configure.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`; it
    must install `@fontsource-variable/inter` from the lockfile without changing it).
  - `git diff --exit-code package-lock.json` **after** the `npm ci` — proves the lockfile the
    dev committed is the one `npm ci` accepts.
  - `npm run lint` — must pass.
  - `npm test` — the app suite (`npx ng test --watch=false`, which includes
    `apps/app/src/theme/tokens.spec.ts`) plus the workspace suites.
  - `npm run build` — `tsc -b` and the Angular build; the built app must contain the font.
  - `node -e "const{readdirSync}=require('node:fs');const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(d+'/'+e.name):[d+'/'+e.name]);const f=walk('apps/app/dist/browser').filter(p=>p.endsWith('.woff2'));if(f.length===0)throw new Error('no woff2 in apps/app/dist/browser');console.log(f.length+' woff2: '+f.slice(0,3).join(', '))"`
    — must print a count `>= 1`.
  - `git diff --name-only origin/main...task-86` — audit against the exclusive paths above.
  - `git diff --name-only origin/main...task-86 -- apps/app/src/app docs/decisions.md
    packages design/README.md design/import.json` — **must print nothing** (Task-85/87 paths).
- **Acceptance criteria:**
  - [ ] `[unit]` `apps/app/package.json` declares `@fontsource-variable/inter` as a
        `dependencies` entry pinned to an exact version (no `^`, no `~`), and `package-lock.json`
        resolves that package to that same version — `node -e` reading both files, or the
        `npm ci` + `git diff --exit-code package-lock.json` pair above.
  - [ ] `[unit]` `ng build` emits at least one `woff2` under `apps/app/dist/browser/` — the
        `node -e` walker above exits 0.
  - [ ] `[unit]` The theme names the family the package declares: `variables.css` has exactly one
        `@import '@fontsource-variable/inter';` and `--ion-font-family` begins
        `'Inter Variable'`; `THEME_TOKENS.fontSans` contains `Inter Variable` (asserted by
        `tokens.spec.ts`).
  - [ ] `[unit]` `design/tokens.json` keeps the twelve colour leaves and adds exactly
        `font.sans` and `font.mono`: fourteen leaves, twelve `$type: color`, two
        `$type: fontFamily` (asserted by `tokens.spec.ts`), and the twelve values are unchanged.
  - [ ] `[unit]` Every hex literal under `apps/app/src/**` is still one of the twelve token
        values: `grep -rhoE '#[0-9a-fA-F]{3,8}\b' apps/app/src | tr 'A-F' 'a-f' | sort -u`
        lists only members of the twelve (the `tokens.spec.ts` colour set is the bound).
  - [ ] `[unit]` `docs/app.md` §9 names the two new keys and the twelve colour keys, and no
        section of `docs/app.md` outside §9 changed.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched.
  - [ ] `[live]` A capture of `/pair` at 390 px matches the metrics of
        `01 · Pairing — mobile dark`. **Measurement:** serve the built app
        (`node scripts/dev-local.mjs --no-build` or `npx ng serve` in `apps/app`), open `/pair`
        at viewport 390 × 844 in a browser, screenshot it, and compare the type — family, the
        400/500/600 weights actually rendered, and the 11–30 px sizes — against the frame's
        caption and `design/README.md` §1. **This runner has no browser and no VM:** QA reports
        this line as **not measured**, never as a pass, and opens exactly one issue through the
        helper:
        `node scripts/agent/issue.mjs --label agent-review --title "Task-86: /pair at 390 px against 01 · Pairing — mobile dark" --body "<what must be measured, and why it was not>"`.
        The issue does not block the merge while the `[unit]` lines are green
        (`docs/agent-ci.md` §The issue handoff).

## 📣 Coordination

- **For the Architect:** this is the only task in the batch that writes `package.json`,
  `package-lock.json` and the lockfile's new resolution; `apps/app/package.json` is a second
  manifest it holds. `docs/app.md` is shared by section — this task holds §9, Task-87 holds the
  single sentence of §4 — and `apps/app/README.md` is held by this task alone (one new line in
  the `src/theme/` block for `tokens.spec.ts`; Task-87 adds no file under `apps/app/src/app`).
- **For Task-85 (same batch):** `design/tokens.json` now has fourteen leaves. `tokenValues()`
  returns fourteen strings; the twelve colours are unchanged and every `layout` token key you
  validate is unaffected. Nothing in `packages/design` changes here — do not "fix"
  `tokenValues`.
- **For Task-87 (same batch):** nothing to read. Do not touch the theme, the manifests or
  `design/tokens.json`; if you need a font in your page, use `--cb-font-sans`, which exists
  after this task inside the same batch — so do not name it, and do not require it.
- **For the gate:** the design gate's allowed-literal set grows by two non-colour strings.
  `checkPatch` normalises and compares found colours against it, so the two entries are inert;
  the colour-typed leaf count is the invariant that stays at twelve.
- **For the next batch:** a durable guard on the font import is the spec test in
  `apps/app/src/theme/tokens.spec.ts`. Subsetting (latin only) and a preload link are **not**
  done: the package's default entry carries every subset, and `angular.json` — which would own
  a preload — is not this task's path.

## ⛔ Out of scope

- No CDN, no `<link>` in `index.html`, no `@font-face` written by hand, no font file committed
  to the repository.
- No subsetting, no `wght.css`/`opsz.css` variant, no `font-display` override: the package's
  default entry is the whole point of the dependency.
- No `apps/app/angular.json`, `apps/app/src/main.ts`, `apps/app/src/styles.css` or
  `packages/design/**` change.
- No typography token beyond `font.sans` and `font.mono`: no size, weight or line-height scale
  in `design/tokens.json` — that is Task-85's measured layout, from Figma.
- No hex literal added under `apps/app/src/**`; no colour token renamed, reordered or
  re-valued.
- No test for a rendered pixel, no Playwright config invented, no browser installed.
- No refactor of a file this task did not have to touch, and no `docs/decisions.md` entry (the
  typeface is a document, not a decision).

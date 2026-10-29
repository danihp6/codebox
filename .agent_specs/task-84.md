# Spec: Task-84 — The colour token document

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** data + docs (the repository's design source).
- **Role:** Dev.
- **Objective:** `design/tokens.json` exists — a DTCG colour document with exactly twelve leaves
  and exactly twelve distinct values, drawn from the palette the app already uses plus the two
  light accents `design/README.md` §5 promises — and `docs/app.md` §9 names the same twelve keys.
  This is the document the design check reads: once it lands, `scanDesign` stops skipping in this
  repository and `checkPatch` enforces the colour rule on every diff (Task-83 wires that call in
  the same wave), so the set must cover every hex literal under `apps/app/src/**` **exactly**.
- **Environment:** worktree `../wt-cb-84`, branch `task-84`, base `main` @ `47c1cce`. A fresh
  worktree has no `node_modules`: start with `npm ci --prefer-offline --no-audit --no-fund`.
  **Unattended run:** commit on `task-84`; when the gate is green, publish with an empty commit `dev: done task-84` followed by `git push origin task-84`; never commit to `main`; never use the
  question tool. A real block is an issue:
  `node scripts/agent/issue.mjs --label agent-blocked --title "Task-84: <what>" --body "<the literal error and the decision needed>"` (`docs/agent-ci.md` §7).
- **Dependencies:** none. Task-83 (the gate call) and Task-82 (the import command) are in the same
  batch; neither file is yours and neither is read by this task.

### Exclusive paths (single writer)

- `design/tokens.json` (new)
- `docs/app.md` (section: **§9 Design direction**, only)

Nothing else. `design/README.md` belongs to Task-82 (the whole file, wave 2); `design/import.json`,
`design/routes.json`, `design/screens/**`, `design/exports/**`, `apps/app/**`,
`packages/design/**`, `apps/daemon/**` and every other `docs/*.md` are out of bounds.

### Inputs (read-only)

- `apps/app/src/theme/tokens.ts` — `THEME_TOKENS` (`bg`, `surface`, `text`, `muted`, `accent`,
  `warn`, `danger`).
- `apps/app/src/theme/variables.css` — the `:root` block and the `prefers-color-scheme: light`
  block; the light values are the source of `#f7f9fb`, `#ffffff`, `#5b6772`
  (`--cb-text: #0b0f14` in light is the same literal as the dark background).
- `apps/app/src/index.html` (`theme-color`), `apps/app/src/manifest.webmanifest`
  (`background_color`, `theme_color`).
- `apps/app/src/app/**` — every remaining hex literal in the tree (three feature specs hold
  `#22c55e`).
- `packages/design/src/tokens.ts` — `parseTokens` (the rules the document must satisfy) and
  `tokenValues` (trim, lowercase, deduplicate, sort).
- `packages/design/src/fixtures/tokens.json` — the house naming for `color.brand.green`,
  `color.brand.bright`, `color.waiting.amber`.
- `design/README.md` §5 (read the file, do not edit it) — the two light accents and "the Design
  System repeats the values for reading, never as the source".
- `docs/app.md` §9 (the text you extend), `docs/decisions.md` D52.

## 🔒 Contract

`design/tokens.json` is exactly this document (2-space indent, a trailing newline, the group and
leaf order below, no `$description`):

```json
{
  "color": {
    "surface": {
      "bg": { "$value": "#0b0f14", "$type": "color" },
      "raised": { "$value": "#121821", "$type": "color" },
      "bg-light": { "$value": "#f7f9fb", "$type": "color" },
      "raised-light": { "$value": "#ffffff", "$type": "color" }
    },
    "ink": {
      "text": { "$value": "#e6edf3", "$type": "color" },
      "muted": { "$value": "#8b98a5", "$type": "color" },
      "muted-light": { "$value": "#5b6772", "$type": "color" }
    },
    "brand": {
      "green": { "$value": "#15803d", "$type": "color" },
      "bright": { "$value": "#22c55e", "$type": "color" }
    },
    "waiting": {
      "amber": { "$value": "#b45309", "$type": "color" },
      "bright": { "$value": "#f59e0b", "$type": "color" }
    },
    "danger": {
      "red": { "$value": "#ef4444", "$type": "color" }
    }
  }
}
```

- **Twelve leaves, twelve distinct values** — a bijection, because `tokenValues` deduplicates: two
  leaves sharing a value would return eleven values and fail the acceptance below. That is why the
  light theme's text (`#0b0f14`) is one leaf (`color.surface.bg`) and not a second `color.ink.*`
  entry.
- **Only leaves carry `$` keys.** `parseTokens` treats any node with a `$` key and no `$value` as
  a token missing its value (`tokens.ts`, `collectLeaves`), so there is **no** top-level
  `$schema`, no `$description` on a group and no `$extensions`. Every leaf is exactly
  `{ "$value": "#…", "$type": "color" }`, value lowercase 6-digit hex.
- **No alias** (`{color.surface.bg}`) anywhere: an alias resolves to its target and would
  collapse the twelve values below its leaf count.
- `tokenValues(parseTokens(document))` returns, sorted:
  `['#0b0f14', '#121821', '#15803d', '#22c55e', '#5b6772', '#8b98a5', '#b45309', '#e6edf3', '#ef4444', '#f59e0b', '#f7f9fb', '#ffffff']`.
- `checkPatch`'s `ALLOW_MARKER` (`codebox-design: allow`) and its exemption of `TOKENS_PATH` are
  untouched: this document is the one file where a literal is allowed to be born.

### Data

| Token | Value | Role |
| --- | --- | --- |
| `color.surface.bg` | `#0b0f14` | Dark background; also the light theme's text. |
| `color.surface.raised` | `#121821` | Dark card and row surface. |
| `color.surface.bg-light` | `#f7f9fb` | Light background. |
| `color.surface.raised-light` | `#ffffff` | Light card and row surface. |
| `color.ink.text` | `#e6edf3` | Dark theme text. |
| `color.ink.muted` | `#8b98a5` | Dark theme muted text. |
| `color.ink.muted-light` | `#5b6772` | Light theme muted text. |
| `color.brand.green` | `#15803d` | Brand green for text and strokes in light. |
| `color.brand.bright` | `#22c55e` | Signal green; fills and dots only (2.1:1 on white). |
| `color.waiting.amber` | `#b45309` | Waiting amber for text and strokes in light. |
| `color.waiting.bright` | `#f59e0b` | Waiting; the fill and the dot in dark. |
| `color.danger.red` | `#ef4444` | Failure only. |

### `docs/app.md` §9

Add a "Design tokens" paragraph and a table of the twelve rows above (token in code span, value,
role) inside §9, and make the existing ink-variant sentence name `color.brand.green` and
`color.waiting.amber`. The paragraph says that `design/tokens.json` is the source and the gate
enforces it, and that `apps/app/src/theme/` mirrors it for the stylesheet. Existing bullets stay;
only §9 changes, and nothing above `## 9.` or below `## 10.` is touched.

## 🧩 Configuration

None. This task adds no `CB_*` key, no setting and no code; it reads no environment.

## 🧪 Test and Validation Plan (for QA)

Run inside `../wt-cb-84` (branch `task-84`), from the worktree root.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint` — must pass (eslint does not cover JSON; this document is validated by the
    parse command below).
  - `npm test` — the whole gate, headless; the suite must stay green (this task adds no test file:
    the document is data and the commands below are its test).
  - `npm run build` — `tsc -b` across the workspaces. Run it **before** the `node` commands
    below: they import `packages/design/dist/index.js`, which the build emits.
  - `git diff --name-only 47c1cce...HEAD` — audit against the two exclusive paths.
  - **No `[live]` criterion:** the document is data and every property is decodable headlessly.
- **Acceptance criteria.**
  - [ ] `[unit]` It lints and builds clean, and `npm test` is green.
  - [ ] `[unit]` *Re-parses and returns twelve values*:
        ```bash
        node --input-type=module -e '
        import { readFileSync } from "node:fs";
        import { parseTokens, tokenValues } from "./packages/design/dist/index.js";
        const tokens = parseTokens(JSON.parse(readFileSync("design/tokens.json", "utf8")));
        const values = tokenValues(tokens);
        console.log(JSON.stringify({ leaves: Object.keys(tokens).length, values: values.length, sorted: values }));
        '
        ```
        prints one JSON object whose `leaves` is `12`, whose `values` is `12` and whose `sorted`
        array equals the twelve-value list in the Contract.
  - [ ] `[unit]` *Every hex literal under `apps/app/src/**` is a token value* — this is the
        pinned measurement of the current tree: **24 occurrences across 7 files, 10 distinct
        values**.
        ```bash
        grep -rEoh '#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b' apps/app/src | tr 'A-F' 'a-f' | sort -u
        ```
        prints exactly, in this order:
        `#0b0f14`, `#121821`, `#22c55e`, `#5b6772`, `#8b98a5`, `#e6edf3`, `#ef4444`, `#f59e0b`,
        `#f7f9fb`, `#ffffff` — ten lines, each one present in the twelve token values.
        The same pattern without `sort -u` piped to `wc -l` prints `24`, and
        `grep -rEol '#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b' apps/app/src | wc -l`
        prints `7`
        (`src/index.html`, `src/manifest.webmanifest`, `src/theme/tokens.ts`,
        `src/theme/variables.css`, `src/app/features/sessions/design-preview.card.spec.ts`,
        `src/app/features/sessions/session.page.spec.ts`,
        `src/app/features/sessions/sessions.api.spec.ts`). If the counts have moved, the dev
        reconciles by naming the literal that is not covered in the PR body and in Coordination —
        the set may not silently miss a literal.
  - [ ] `[unit]` *No functional colour syntax in the tree*:
        `grep -rEn '(rgb|rgba|hsl|hsla)\(' apps/app/src` prints nothing (exit code 1), so the
        twelve hex values are the whole colour surface the rule sees.
  - [ ] `[unit]` *No group metadata*: `grep -c '\$description\|\$schema\|\$extensions' design/tokens.json`
        is `0`, and the parse command above would throw `DesignDocumentError` if a group carried a
        `$` key.
  - [ ] `[unit]` *§9 names the same twelve keys*:
        ```bash
        for key in color.surface.bg color.surface.raised color.surface.bg-light color.surface.raised-light color.ink.text color.ink.muted color.ink.muted-light color.brand.green color.brand.bright color.waiting.amber color.waiting.bright color.danger.red; do awk '/^## 9\. Design direction/,/^## 10\./' docs/app.md | grep -qF -- "$key" || { echo "missing $key"; exit 1; }; done; echo ok
        ```
        prints `ok`, and
        `awk '/^## 9\. Design direction/,/^## 10\./' docs/app.md | grep -c '^| .color\.'`
        prints `12`.
  - [ ] `[unit]` *Only §9 of `docs/app.md` changed*:
        `git diff 47c1cce...HEAD -- docs/app.md | grep -E '^[+-]## '` prints nothing (no section
        heading added, removed or renamed; a `###` sub-heading inside §9 is allowed), and
        `git diff --stat 47c1cce...HEAD -- docs/app.md` names one file. Read
        `git diff --unified=0 47c1cce...HEAD -- docs/app.md` and confirm every hunk sits between
        the `## 9.` and `## 10.` headings.
  - [ ] `[unit]` Nothing outside the two exclusive paths was touched; in particular
        `git diff --stat 47c1cce...HEAD -- apps/app packages/design design/README.md
        design/import.json docs/jobs.md docs/decisions.md` is empty.
  - [ ] `[unit]` *Integration, on the combined tree once Task-83 is merged* (not a blocker for
        this task's own QA): the design step now reads this document instead of skipping. With the
        merged tree, `npx vitest run --project apps/daemon` is green and the `#0b0f14` / `#0b1120`
        pair of Task-83's integration command returns `[0,1]`.

## 📣 Coordination

- **For Task-83:** the twelve values are the whitelist. `#0b0f14` passes the colour rule,
  `#0b1120` does not, and `#ffffff` is legal (so a screen that declares it is **not** a colour
  finding — only its null states are, report-only).
- **For Task-82 (wave 2):** `design/README.md` is Task-82's whole file; the row that lists
  `design/tokens.json` among the artifacts, and the sentence in §5 that still says "the DTCG source
  lands in `design/tokens.json`, Task-74", are Task-82's edit, not this task's.
- **Bijection, not style:** twelve leaves / twelve values is forced by `tokenValues`'s
  deduplication and the acceptance "returns exactly those twelve values". Do not add a thirteenth
  leaf, an alias, or a duplicate value.
- **Why `color.surface.bg` is `#0b0f14` and not `color.ink.text-light`:** the light theme's text
  is the dark theme's background literal; one value, one leaf (D52: one owner per fact).
- **No app change:** `apps/app/src/theme/tokens.ts` and `variables.css` still hold the literals and
  keep passing `checkPatch` because every one of them is a token value; moving the app to
  `var()`-only is not this task.

## ⛔ Out of scope

- No change to `apps/app/**`, `packages/design/**`, `apps/daemon/**` or `design/README.md`.
- No DTCG token for radius, space, font family, duration or weight — the item says colour only.
- No test file, no new script, no `scripts/design/` command (that is Task-82), no new dependency.
- No `$description`, no `$schema`, no `$extensions`, no alias, no 3- or 8-digit hex.
- No change to `docs/decisions.md`, `docs/jobs.md`, `TODO.md` or `CHANGELOG.md`.

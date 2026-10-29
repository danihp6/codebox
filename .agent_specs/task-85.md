# Spec: Task-85 — Measured layout

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (`@codebox/design`) plus its command in `scripts/design`.
- **Role:** Dev.
- **Objective:** after this task, a screen spec can carry a **measured layout** — the frame's
  box, its layout mode, padding and item spacing, its regions with their boxes, radius, stroke
  and fill token key, and its type scale with real Inter metrics — and the Figma import
  projects that layout from the page instead of leaving a dev to read the picture. The
  projection survives the file's real shape: `FRAME`, `COMPONENT` and `SECTION` page children
  are all accepted, a `SECTION` is traversed, a frame with autolayout projects its padding and
  gap, a frame without autolayout falls back to its children's boxes in reading order and says
  so with `inferred: true`, and every colour the layout names is a `design/tokens.json` key,
  never a literal.
- **Environment:** worktree `../wt-cb-85`, branch `task-85`, base `main` at
  `2375565dc8158ee6d23d8e92cde643558d5e60dd`.
- **Dependencies:** **Task-81** and **Task-82**, both merged: Task-81 produced
  `packages/design/src/import.ts` (`parseImportMap`, `importDesign`, `FigmaFrame`,
  `DesignImportError`) and Task-82 produced `scripts/design/import.mjs`
  (`projectPage`, `main`, the `--check` flag). Both are on `main`; read them, do not re-create
  them. Nothing else in the batch is a dependency: Task-86 and Task-87 write disjoint paths
  and you must not read or wait for their work.
- **Batch shape (frozen):** Batch 22 runs Task-85, Task-86 and Task-87 **in parallel** on base
  `2375565`. This task owns the Figma import surface. `package.json` and `package-lock.json`
  are held by **Task-86**: **do not run `npm install`, `npm ci`-with-changes or any command
  that writes the lockfile.** Add no dependency. `apps/app/src/app/app.routes.ts` is held by
  Task-87; `design/import.json` and `design/README.md` §1–§2 are Task-87's. `design/tokens.json`
  is Task-86's: you **read** it in a test, you never edit it.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `packages/design/src/types.ts`
- `packages/design/src/screens.ts`
- `packages/design/src/import.ts`
- `packages/design/src/index.ts`
- `packages/design/src/screens.test.ts`
- `packages/design/src/layout.test.ts` (new)
- `packages/design/src/fixtures/figma/layout.json` (new)
- `packages/design/README.md` (whole file)
- `scripts/design/import.mjs`
- `scripts/design/layout.test.mjs` (new)
- `scripts/design/fixtures/file-layout.json` (new)
- `scripts/design/fixtures/import-layout.json` (new)
- `scripts/README.md` (the `## scripts/design` table only)
- `design/README.md` (section **§4 "Import and export"** only — no other section of that file)

**Do not touch** (they belong to a batch-mate, and the merge order makes both branches green
only if you leave them alone):

- `packages/design/src/fixtures/figma/import.json`, `packages/design/src/fixtures/figma/file.json`,
  `packages/design/src/fixtures/figma/file-missing.json`,
  `packages/design/src/fixtures/figma/export-dashboard.png`
- `packages/design/src/import.test.ts`
- `scripts/design/import.test.mjs`, `scripts/design/fixtures/import.json`,
  `scripts/design/fixtures/file.json`, `scripts/design/fixtures/images.json`,
  `scripts/design/fixtures/export-frame.png`
- `packages/design/src/tokens.ts`, `check.ts`, `routes.ts`, `snapshot.ts`
- `design/import.json`, `design/tokens.json`, `docs/**`, `apps/**`, `package*.json`

Task-87 adds an eleventh entry to `design/import.json` in the same batch and updates the
fixture copies and count assertions listed above. Your branch must be green **without** those
changes: your new fixtures are new files, and the existing suites
(`packages/design/src/import.test.ts`, `scripts/design/import.test.mjs`) must pass unmodified
on your branch. That is the single hardest constraint of this task — see the projection rule
"a layout exists only when it can be measured" in the Contract.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/agent-spec-template.md`
- `packages/design/src/types.ts`, `screens.ts`, `import.ts`, `index.ts`, `tokens.ts`, `check.ts`,
  `routes.ts`, `snapshot.ts` and every `*.test.ts` in `packages/design/src/`
- `packages/design/src/fixtures/**` (read; the two `import.json` / `file.json` copies are
  read-only for you)
- `scripts/design/import.mjs`, `scripts/design/import.test.mjs`, `scripts/design/fixtures/**`
- `design/tokens.json` (the twelve colour keys; you validate against it and never edit it)
- `design/README.md`, `design/import.json`
- `packages/design/README.md`, `scripts/README.md`, `packages/design/package.json`,
  `packages/design/tsconfig.json`, `vitest.config.ts`
- `docs/app.md` §4 (the routes the map is written against) — read only, no edit

**No screen task:** `design/screens/*.json` and `design/exports/*.png` do not exist in this
tree (they land at L6, the operator's run of the importer, which runs **after** this task).
Do not create either family, do not invent a spec, and do not name them as inputs.

## 🔒 Contract

The public surface other tasks and L6 are written against **right now**. Exact names,
signatures and types. Re-export every new type from `packages/design/src/index.ts`.

### `packages/design/src/types.ts`

```ts
export type ScreenLayoutMode = 'none' | 'horizontal' | 'vertical';

export interface ScreenBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ScreenRegion {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** A `design/tokens.json` key (e.g. `color.surface.raised`), or null. */
  readonly fill: string | null;
  /** `cornerRadius` in px; 0 when absent. */
  readonly radius: number;
  /** `strokeWeight` in px when the node has a visible stroke; 0 otherwise. */
  readonly stroke: number;
}

export interface ScreenTypeRow {
  readonly role: string;
  readonly family: string;
  readonly weight: number;
  readonly size: number;
  readonly lineHeight: number;
  /** A `design/tokens.json` key, or null. */
  readonly colour: string | null;
}

export interface ScreenLayout {
  /** The frame's own `absoluteBoundingBox`, absolute. */
  readonly box: ScreenBox;
  readonly layoutMode: ScreenLayoutMode;
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  readonly itemSpacing: number;
  readonly cornerRadius: number;
  /** Stroke width in px when the frame has a visible stroke paint; 0 otherwise. */
  readonly strokes: number;
  /** True when the frame declared no autolayout and the regions are boxes in reading order. */
  readonly inferred: boolean;
  readonly regions: readonly ScreenRegion[];
  readonly type: readonly ScreenTypeRow[];
}

export interface ScreenSpec {
  readonly screen: string;
  readonly route: string;
  readonly states: Readonly<Record<ScreenState, string | null>>;
  readonly snapshotSha256: string | null;
  /** Absent on a spec whose frame is not measurable, and on every spec written before this task. */
  readonly layout?: ScreenLayout;
}
```

`ScreenSpec` keeps `states` **optional in the document** and `snapshotSha256`
**optional/nullable in the document**: both are unchanged behaviour. `layout` is **optional in
the document**. A committed fixture or an L6 spec without `layout` must keep parsing exactly
as it does today, and `parseScreenSpec` must not emit a `layout: undefined` key — the key is
absent or present, never undefined.

### `packages/design/src/screens.ts`

```ts
/** Validates a screen spec. When `tokens` is given, every non-null layout token key must exist in it. */
export function parseScreenSpec(input: unknown, tokens?: DesignTokens): ScreenSpec;
```

- The document remains a `z.strictObject`: an unknown field is still rejected. `layout` is an
  optional strict object with exactly the keys above; `box` has exactly `x`,`y`,`width`,
  `height`; a region exactly `name`,`x`,`y`,`width`,`height`,`fill`,`radius`,`stroke`; a type
  row exactly `role`,`family`,`weight`,`size`,`lineHeight`,`colour`.
- Every number is finite. `weight`, `size`, `lineHeight`, `radius`, `stroke`, `padding*`,
  `itemSpacing`, `cornerRadius`, `strokes`, `width`, `height` are `>= 0`; `x`/`y` may be
  negative. `family` and `role` are non-empty after trim.
- A non-null `fill` or `colour` must match the token-key shape
  `/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/` (at least one dot, lowercase, hyphens
  allowed). A literal (`#0b0f14`, `Inter`) fails.
- **When `tokens` is given**, every non-null `layout.regions[i].fill` and
  `layout.type[i].colour` must be a key of that map (`Object.hasOwn`). Failure throws
  `DesignDocumentError('screen', issues)` with the offending issue path
  (`layout.regions.2.fill`, `layout.type.0.colour`) and the message
  `unknown token key <key>` — the key itself is in the message.
- Failure shape is unchanged: `DesignDocumentError` whose `boundary` is `'screen'`; issues are
  `{ path, message }` with a dotted path.

### `packages/design/src/import.ts`

```ts
export interface FigmaRegion {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The fill exactly as the file writes it (`#121821`, `rgba(…, 0.25)`), or null. */
  readonly fill: string | null;
  readonly radius: number;
  readonly stroke: number;
}

export interface FigmaTypeRow {
  readonly role: string;
  readonly family: string;
  readonly weight: number;
  readonly size: number;
  readonly lineHeight: number;
  readonly colour: string | null;
}

export interface FigmaFrameLayout {
  readonly box: ScreenBox;
  readonly layoutMode: ScreenLayoutMode;
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  readonly itemSpacing: number;
  readonly cornerRadius: number;
  readonly strokes: number;
  readonly inferred: boolean;
  readonly regions: readonly FigmaRegion[];
  readonly type: readonly FigmaTypeRow[];
}

export interface FigmaFrame {
  readonly id: string;
  readonly caption: string;
  readonly width: number;
  readonly height: number;
  readonly fills: readonly string[];
  /** Absent when the frame is not measurable (no direct child with a box). */
  readonly layout?: FigmaFrameLayout;
}

export interface DesignImportInput {
  readonly snapshot: FigmaFileSnapshot;
  readonly map: ImportMap;
  readonly exports?: Readonly<Record<string, Uint8Array>>;
  /** When given, every projected layout colour is resolved to one of its keys. */
  readonly tokens?: DesignTokens;
}

export function importDesign(input: DesignImportInput): DesignImportResult;
```

- `importDesign` copies `frame.layout` into `spec.layout`, resolving each `fill`/`colour`
  string to a token key with the same case-insensitive map `tokenValues()` implies. A colour
  that is not an exact `design/tokens.json` value (an `rgba(…)`, a hex outside the twelve, a
  frame with no visible fill) projects `null`; the importer never invents a key and never
  throws for it — the frame's colour already shows up in `DesignImportResult.colours` and in
  the command's `coloursOutsideTokens` line.
- Without `input.tokens`, every `fill`/`colour` projects `null` and the rest of the layout is
  copied. When two token keys hold the same value, the first in `Object.keys(tokens)` order
  wins.
- Key order in a produced spec is `screen`, `route`, `states`, `snapshotSha256`, then `layout`
  when present — the command's byte output and its `--check` depend on it.
- `DesignImportError` keeps its two codes (`'frame_missing' | 'map_invalid'`); the projection
  adds none.
- `DesignImportResult` is unchanged: `{ routes, screens, colours }`.

### `scripts/design/import.mjs`

`projectPage(body, page, fileKey)` keeps its signature and its `page_missing` /
`file_invalid` errors, and changes in three ways:

1. **Page children:** accept a top-level child whose `type` is `'FRAME'`, `'COMPONENT'` or
   `'SECTION'`. A `SECTION` is **traversed**: each of its children that is itself a
   `FRAME`/`COMPONENT`/`SECTION` is projected in document order, recursively; the `SECTION`
   never becomes a frame of its own. Any other type is skipped as today (`TEXT` annotations
   included).
2. **Layout projection:** a frame node produces `layout` **iff at least one direct child has an
   `absoluteBoundingBox` with finite `x`, `y`, `width` and `height`**. When it produces one:
   - `box` = the frame's `absoluteBoundingBox` (absolute `x`/`y`).
   - `layoutMode` = `'horizontal'` or `'vertical'` when the node says so, `'none'` for every
     other value including absent.
   - `inferred` = `layoutMode === 'none'`.
   - `paddingTop`/`paddingRight`/`paddingBottom`/`paddingLeft`/`itemSpacing` = the node's
     `paddingTop`/`paddingRight`/`paddingBottom`/`paddingLeft`/`itemSpacing` when finite, else 0.
   - `cornerRadius` = `cornerRadius` when finite, else the maximum of a finite
     `rectangleCornerRadii` array, else 0.
   - `strokes` = `strokeWeight` when the node has at least one `strokes` paint whose
     `visible !== false` and `strokeWeight` is finite, else 0.
   - `regions` = the frame's **direct** children that have a measurable box; each region's
     `x`/`y` are relative to the frame's box origin (`child.x − frame.x`). `name` = the child's
     `name` trimmed (empty → `'region'`). `fill` = the colour of the first visible `SOLID` paint
     (the same `#rrggbb`/`rgba(…)` string `paintColour` already produces), else `null` — a
     gradient or an invisible paint is `null`. `radius`/`stroke` follow the same rule as the
     frame's `cornerRadius`/`strokes`, per child.
   - Order: document order when `inferred` is false; when `inferred` is true, sort by `y`, then
     `x`, then document order (stable). A child without a box is **skipped, never an error**.
   - `type` = every `TEXT` node in the frame's subtree, in document order, one row per distinct
     `role|family|weight|size|lineHeight|colour` (first kept). `role` = the node's `name`
     trimmed (empty → `'text'`). `family` = `style.fontFamily`; `weight` = `style.fontWeight`
     (absent → 400); `size` = `style.fontSize`; `lineHeight` = `style.lineHeightPx` when
     finite, else `size`; `colour` = the first visible `SOLID` fill's colour, else `null`. A
     `TEXT` node with no `style` object, or with a non-finite `style.fontSize`, is
     `file_invalid` with the node id in the message (`text node '1:102' has no style`).
3. **Tokens:** parse `design/tokens.json` (when the root has one) once, **before** the real
   `importDesign` call, and pass `tokens` into it so the written specs carry token keys. Keep
   the existing `tokens_unavailable: design/tokens.json` stderr line and the
   `coloursOutsideTokens` measurement exactly as they are; do not change the summary keys, the
   stdout lines or the exit codes.

The command keeps its flags, its error codes, its stdout lines and its one-line summary; the
`--help` text does not change. **No new flag.**

### Data

- Token key shape everywhere: `color.brand.green`, `font.sans` — dotted, lowercase,
  `[a-z0-9-]` segments.
- `inferred` semantics: `false` = the frame declared `layoutMode` `horizontal`/`vertical` and
  its regions are its autolayout order; `true` = no autolayout, padding and item spacing are 0
  and the regions are boxes in reading order (`y`, then `x`).
- A spec written by the command today (four keys) is still valid; a spec written after this
  task adds `layout` only for a measurable frame.

## 🧩 Configuration

None. No `CB_*` key is added or read; no environment variable changes; no dependency is added.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; includes `packages/design/src/layout.test.ts`,
    `scripts/design/layout.test.mjs` and every suite that already existed.
  - `npm run build` — `tsc -b` across the workspaces; the design package must compile with the
    new types and the existing `import.mjs` must still be importable before a build.
  - `npx vitest run --project packages/design` — the package suite alone, to show the older
    fixtures still parse.
  - `npx vitest run --project scripts` — the command suite alone, including `--check`.
  - `git diff --name-only origin/main...task-85` — audit against the exclusive paths above.
  - `git diff --name-only origin/main...task-85 -- design/import.json design/tokens.json
    packages/design/src/import.test.ts scripts/design/import.test.mjs` — **must print
    nothing**: those four belong to a batch-mate.
- **Acceptance criteria:**
  - [ ] `[unit]` `npm run lint`, `npm test` and `npm run build` are green and the whole existing
         suite (100+ tests in `packages/design`, the `scripts` project) passes **unmodified**.
  - [ ] `[unit]` A frame with autolayout projects its padding and gap:
        `projectPage(file-layout.json, 'Page 1', key)` yields, for the autolayout frame,
        `layoutMode: 'vertical'`, `paddingTop: 16`, `paddingLeft: 16`, `itemSpacing: 8`,
        `inferred: false`; the frame beside it, with no `layoutMode`, yields `inferred: true`,
        `paddingTop: 0`, `itemSpacing: 0` and its regions ordered by `y` then `x`.
  - [ ] `[unit]` A `COMPONENT` page child and a `SECTION` containing a `FRAME` both project as
        frames: `projectPage(file-layout.json, …)` returns both captions, and the `SECTION`
        itself is not a frame. (`file-layout.json` is the raw `/v1/files` body; its two-entry
        map is `parseImportMap`ped inline in the test, so no extra fixture file is created.)
  - [ ] `[unit]` A spec whose `layout` names a colour outside `design/tokens.json` throws with
        the key: `parseScreenSpec(spec, parseTokens(JSON.parse(readFileSync('design/tokens.json'))))`
        rejects `fill: 'color.brand.purple'` with an issue whose `message` contains
        `color.brand.purple` and whose `path` is `layout.regions.<i>.fill`.
  - [ ] `[unit]` `--check` on a written root still writes nothing and exits 0: the
        `layout.test.mjs` case runs the command twice (write, then `--check`), asserts exit 0,
        no `drift:` line and a byte-identical tree.
  - [ ] `[unit]` A spec **without** `layout` parses and the returned object has no `layout` key;
        `packages/design/src/fixtures/screens/*.json` round-trip unchanged.
  - [ ] `[unit]` `importDesign` copies a frame's `layout` into the spec and resolves its colours:
        the `packages/design/src/fixtures/figma/layout.json` snapshot (a projected
        `FigmaFrame[]` carrying one frame with `layout`) plus an inline `parseImportMap` map
        produces a spec whose `layout` equals the frame's, whose `fill`/`colour` are the token
        keys for `#121821` (`color.surface.raised`) and `#e6edf3` (`color.ink.text`), and whose
        `rgba(51, 102, 153, 0.25)` fill is `null`.
  - [ ] `[unit]` Without `input.tokens`, every projected `fill` and `colour` is `null` and every
        other layout field is still copied.
  - [ ] `[unit]` The projection is pure: `packages/design` still imports no `node:fs`,
        `node:process`, clock or network (`npm run lint` plus a read of the new code).
  - [ ] `[unit]` Nothing outside the exclusive paths was touched, and the four batch-mate files
        above are untouched.
  - No `[live]` criterion: this task ships no UI, no daemon route and no stream. Do not invent
        one.

## 📣 Coordination

- **For the Architect:** the batch cut is unchanged for this task; the Figma geometry lives
  here and L6 (`node scripts/design/import.mjs`) is the only writer of `design/screens/**` and
  `design/routes.json`, which still do not exist. Task-87 appends an eleventh entry to
  `design/import.json` in the same batch and owns the fixture copies and the count pins in
  `packages/design/src/import.test.ts` and `scripts/design/import.test.mjs`; this task ships
  new fixture files instead, so both branches are green on their own and the combined tree is
  green after the merge.
- **For Task-86 (same batch):** `design/tokens.json` gains `font.sans` and `font.mono` and is
  read by your acceptance test. A token **key** is what `layout` stores, so adding font keys
  never invalidates a layout; your two new leaves are not colours and cannot match a colour
  literal.
- **For Task-87 (same batch):** the map parser is unchanged (`parseImportMap`); only
  `parseScreenSpec` and `importDesign` gained an optional argument, so a call written today
  keeps compiling.
- **For L6 (the operator's run, after this task):** the specs the command writes now carry
  `layout` when the frame is measurable. `--check` is byte-stable: rerunning it must report no
  drift.
- **For the next batch:** `apps/daemon/src/gate/design-check.ts` calls `parseScreenSpec` with
  one argument, so the gate checks a layout's key **shape**, not its membership in the token
  document. Wiring the gate's `loadTokens` into `loadScreens` is a later task, not this one.
- **README duty:** you add four files under `packages/design` and `scripts`, so
  `packages/design/README.md` and the `## scripts/design` table in `scripts/README.md` gain one
  line per file, no exported names. Reword the `fixtures/figma/file.json` bullet in
  `packages/design/README.md` so it carries **no counts** (Task-87 turns it into thirteen
  frames with eleven mapped captions in the same batch; a number there would be wrong on one
  of the two branches): "the page snapshot the import suite projects: every mapped caption and
  the frames outside the map."

## ⛔ Out of scope

- No new dependency, no `npm install`, no lockfile write.
- No screen spec and no export: `design/screens/**`, `design/exports/**` and
  `design/routes.json` are L6's output and stay absent.
- No change to `parseTokens`, `tokenValues`, `check.ts`, `routes.ts` or `snapshot.ts`.
- No `colour_outside_tokens` finding for a layout: the four rules of `checkDocuments` stay
  four.
- No change to the command's flags, stdout lines, summary keys, exit codes or `--help` text.
- No daemon or app change; no `docs/app.md` edit; no `docs/decisions.md` edit.
- No refactor of a file this task did not have to touch, and no "while I am here" cleanup of
  the fixtures you may not edit.

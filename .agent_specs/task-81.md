# Spec: Task-81 — Design importer core

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (`packages/design`).
- **Role:** Dev.
- **Objective:** `packages/design` gains one pure module that turns a projected Figma page and
  the committed import map into the three artifact families the repository's `design/` directory
  is made of — `DesignRoute[]`, `ScreenSpec[]` and the distinct `colours` of the mapped frames —
  plus the fixture set that proves it. After this task the Batch 21 wave 2 command (Task-82) can
  project a page and call one function; it never derives a route, a slug or a hash itself.
- **Environment:** worktree `../wt-cb-81`, branch `task-81`, base `main` @ `47c1cce`. A fresh
  worktree has no `node_modules`: start with `npm ci --prefer-offline --no-audit --no-fund`.
  **Unattended run:** commit on `task-81`; when the gate is green, publish with an empty commit `dev: done task-81` followed by `git push origin task-81`; never commit to `main`; never use the
  question tool. A real block is an issue:
  `node scripts/agent/issue.mjs --label agent-blocked --title "Task-81: <what>" --body "<the literal error and the decision needed>"` (`docs/agent-ci.md` §7).
- **Dependencies:** none. `design/import.json` is committed and is a **read-only input**, never a
  deliverable. Task-82 (wave 2) depends on every export frozen below.

### Exclusive paths (single writer)

Nothing outside this list, and no path in this list is shared with another task in the batch.

- `packages/design/src/import.ts` (new)
- `packages/design/src/import.test.ts` (new)
- `packages/design/src/fixtures/figma/file.json` (new)
- `packages/design/src/fixtures/figma/file-missing.json` (new)
- `packages/design/src/fixtures/figma/import.json` (new)
- `packages/design/src/fixtures/figma/export-dashboard.png` (new, binary)
- `packages/design/src/index.ts` (the re-export block)
- `packages/design/README.md` (the file map only)

`types.ts`, `tokens.ts`, `routes.ts`, `screens.ts`, `check.ts`, `snapshot.ts` and their tests are
**not** yours and are expected to stay byte-identical. `package.json`, `tsconfig*.json`,
`design/README.md`, `design/import.json`, `design/tokens.json` and every `docs/*.md` are out of
bounds.

### Inputs (read-only)

- `design/import.json` — the shipped map: `fileKey`, `page`, ten frames.
- `design/README.md` §1 (routed screens, captions), §4 (`screenSlug`, export names), §5
  (palette) — read the file, do not edit it; Task-82 owns it in wave 2.
- `packages/design/src/types.ts` — `DesignRoute`, `ScreenSpec`, `ScreenState`, `SCREEN_STATES`.
- `packages/design/src/routes.ts`, `screens.ts`, `snapshot.ts` — the parsers your output must
  survive, and `snapshotHash`.
- `packages/design/src/check.ts` — `COMPONENT_PATTERN` (`/^[A-Z][A-Za-z0-9]*$/`), the rule your
  output must not trip.
- `packages/design/src/fixtures/tokens.json`, `routes.json`, `screens/*.json` — house style.
- `packages/design/src/check.test.ts`, `routes.test.ts` — the fixture-reading idiom.

## 🔒 Contract

Everything below is exported from `packages/design/src/index.ts` and is frozen for Task-82.

```ts
export interface FigmaFrame {
  /** The Figma node id, e.g. `12:34`. Opaque to this package. */
  readonly id: string;
  /** The frame's name exactly as drawn; the map and this field are the join key. */
  readonly caption: string;
  readonly width: number;
  readonly height: number;
  /** The frame's distinct fills, as written in the file (`#0b0f14`, `rgba(…, 0.5)`). */
  readonly fills: readonly string[];
}

export interface FigmaFileSnapshot {
  readonly fileKey: string;
  readonly page: string;
  readonly frames: readonly FigmaFrame[];
}

export interface ImportMapFrame {
  readonly caption: string;
  readonly screen: string;
  readonly route: string;
  readonly component: string;
  readonly states: Readonly<Record<ScreenState, string | null>>;
  readonly snapshot: boolean;
}

export interface ImportMap {
  readonly fileKey: string;
  readonly page: string;
  readonly frames: readonly ImportMapFrame[];
}

export interface DesignImportInput {
  readonly snapshot: FigmaFileSnapshot;
  readonly map: ImportMap;
  /** PNG bytes keyed by the map's `caption`. Absent when the caller did not download one. */
  readonly exports?: Readonly<Record<string, Uint8Array>>;
}

export interface DesignImportResult {
  readonly routes: readonly DesignRoute[];
  readonly screens: readonly ScreenSpec[];
  /** Distinct, lowercased, trimmed and sorted fills across the mapped frames only. */
  readonly colours: readonly string[];
}

export type DesignImportErrorCode = 'frame_missing' | 'map_invalid';

export class DesignImportError extends Error {
  readonly code: DesignImportErrorCode;
  /** `frames.<index>.caption` for `frame_missing`; the first issue's path for `map_invalid`. */
  readonly path: string;
  /** The missing caption for `frame_missing`, otherwise null. */
  readonly caption: string | null;
  readonly issues: readonly DesignIssue[];
}

// `error.name` is `'DesignImportError'`; `message` is `'frame_missing: <caption>'` for that code
// and `'invalid import map'` for `map_invalid`.

export function parseImportMap(input: unknown): ImportMap;
export function importDesign(input: DesignImportInput): DesignImportResult;
/** Lowercase sha256 of the bytes: delegates to `snapshotHash`, named for the field it fills. */
export function snapshotSha256(bytes: Uint8Array): string;
```

- **`parseImportMap`** — one zod `strictObject` document, no new dependency (zod 4.6.7 is already
  the package's). Rejects, as one `DesignImportError` with `code: 'map_invalid'` and one issue per
  failure (`issues[0].path` is also `path`):
  - not an object, a missing/empty `fileKey` or `page`, an unknown top-level key;
  - `frames` not an array; an entry that is not an object; an unknown entry key;
  - `caption`, `screen`, `route`, `component` missing, not a string or empty after `trim()`;
  - `component` not matching `/^[A-Z][A-Za-z0-9]*$/` — the same rule `check.ts` applies, so the
    importer can never emit `route_without_component`;
  - `states` missing or not an object, an unknown state key, or one of `loading` / `empty` /
    `error` **omitted** (`empty: null` is valid and imports; a missing `empty` is not); a state
    value that is neither `null` nor a non-empty string after `trim()`;
  - `snapshot` missing or not a boolean;
  - a `caption`, `screen` or `route` that repeats an earlier entry's value.
  Every issue path is the JSON path of the failure (`frames.3.states.empty`,
  `frames.7.component`). The message text is the dev's; the path is contract. `parseImportMap`
  accepts `frames: []`.
- **`importDesign`** — for each entry of `input.map.frames` **in map order**:
  - find the frame whose `caption` is exactly the entry's caption (the first one, if the snapshot
    repeats a caption);
  - if none exists, throw `DesignImportError` with `code: 'frame_missing'`, `caption` set to the
    entry's caption, `path` = `frames.<index>.caption` for the **map** index, one issue with that
    path, and `message === 'frame_missing: ' + caption` (the caption is visible in the message);
  - `routes` gets `{ path: entry.route, screen: entry.screen, component: entry.component }`;
  - `screens` gets `{ screen: entry.screen, route: entry.route, states: entry.states,
    snapshotSha256 }`, where the hash is `entry.snapshot === true` **and** the caller supplied
    `exports[entry.caption]` → `snapshotSha256(thoseBytes)`; in every other case (the map says
    `snapshot: false`, or no bytes were supplied for that caption) it is `null`;
  - `colours` collects every fill of every **matched** frame, normalised with `trim()` +
    `toLowerCase()`, deduplicated, sorted ascending (the order `tokenValues()` uses). A frame
    outside the map contributes nothing, and no per-frame diagnostic is produced for it: the
    unmapped count is the caller's arithmetic (`snapshot.frames.length - map.frames.length`).
- **`snapshotSha256`** returns `snapshotHash(bytes)` unchanged. `import.ts` imports it from
  `./snapshot.js`; it does not import `node:fs` or `node:crypto` itself.
- **Purity:** no `fetch`, no filesystem, no clock, no environment, no randomness, no image
  decoding — a PNG is only ever hashed as bytes. `importDesign` does not re-parse its typed input;
  the projection from the Figma REST payload into `FigmaFileSnapshot` is Task-82's edge, and the
  JSON parse of the map is `parseImportMap`'s.
- **Ordering:** `routes[i]` and `screens[i]` describe `map.frames[i]`. `colours` is sorted.
- **Errors:** `DesignImportError` only. It is not a `DesignDocumentError` (that type's `boundary`
  union has no import member and `types.ts` is not yours) and it never escapes `@codebox/design`
  as a generic `Error`.

### Data

- `snapshotSha256` in a spec is 64 lowercase hex, exactly what `parseScreenSpec` accepts.
- The output must survive `parseRoutes({ routes: result.routes })` and
  `parseScreenSpec(result.screens[i])` and yield `[]` from
  `checkDocuments({ tokens, routes, screens })` for `route_without_component` — the states and
  the capture may still be `null`, which is the report-only `screen_state_missing`.

### Fixtures

- `fixtures/figma/import.json` is a **verbatim byte copy** of `design/import.json`
  (`cp design/import.json packages/design/src/fixtures/figma/import.json`, no reformat).
- `fixtures/figma/file.json` is a `FigmaFileSnapshot` with **twelve** frames: the ten captions of
  `design/import.json` (same strings, `·` and `—` included) plus two unmapped frames captioned
  `Design System` and `01b · Sheets — dark`. The two unmapped frames carry a fill the palette
  does not hold (`#ff00ff` and `#abcdef`). The union of the mapped frames' fills is exactly
  `#0b0f14`, `#121821`, `#e6edf3`, `#8b98a5`, `#22c55e`, `#f59e0b` (six values). Give at least
  one mapped frame an uppercase fill (`#E6EDF3`) and one a repeated fill,
  so normalisation and deduplication are exercised. Widths/heights: `390 × 844`, except the two
  desktop-shaped unmapped frames, which are `1280 × 800`.
- `fixtures/figma/file-missing.json` is `file.json` with the Dashboard frame's caption changed to
  `05 · Dashboard — renamed`; everything else is identical.
- `fixtures/figma/export-dashboard.png` is a small real PNG (a 1 × 1 image is enough; ≤ 400 kB,
  `design/README.md` §4). Its first eight bytes are the PNG signature
  `89 50 4e 47 0d 0a 1a 0a`. Content beyond the signature is the test's input, not an asset.

## 🧩 Configuration

None. This task adds no `CB_*` key, no setting and no default; it reads no environment.

## 🧪 Test and Validation Plan (for QA)

Run inside `../wt-cb-81` (branch `task-81`), from the worktree root.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint` — must pass.
  - `npm test` — the whole gate, headless: the app suite, the coverage guard and every Vitest
    project.
  - `npm run build` — `tsc -b` across the workspaces; `@codebox/design` must emit `dist`.
  - `npx vitest run --project packages/design` — this package alone.
  - `git diff --name-only 47c1cce...HEAD` (equivalently `main...HEAD`) — audit against the
    exclusive paths.
- **Acceptance criteria.** Every one is `[unit]`: this task is a pure package and nothing it adds
  exists only in a running system, so there is **no `[live]` criterion**. Each names the test that
  proves it in `packages/design/src/import.test.ts`.
  - [ ] `[unit]` It typechecks, lints and builds clean (`npm run lint`, `npm run build`).
  - [ ] `[unit]` `npx vitest run --project packages/design` is green and the new suite exists:
        `import.test.ts` has at least the cases below.
  - [ ] `[unit]` *Page with frames outside the map*: `importDesign({ snapshot: file.json, map:
        parseImportMap(import.json) })` returns `screens.length === 10`, `routes.length === 10`,
        and `colours` deep-equals
        `['#0b0f14', '#121821', '#22c55e', '#8b98a5', '#e6edf3', '#f59e0b']` — no `#ff00ff`, no
        `#abcdef`, no duplicate, all lowercase.
  - [ ] `[unit]` *Missing frame*: the same call with `file-missing.json` throws
        `DesignImportError` with `code === 'frame_missing'`, `caption === '05 · Dashboard — mobile
        dark'`, `issues[0].path === 'frames.5.caption'` (the Dashboard is the sixth entry of
        `design/import.json`; recompute if the map order differs) and `message` containing the
        caption.
  - [ ] `[unit]` *Map states*: `parseImportMap` given the shipped map with `frames[0].states.empty`
        deleted throws with `code === 'map_invalid'` and an issue whose path is exactly
        `frames.0.states.empty`; with `empty: null` it imports and
        `importDesign(...).screens[0].states.empty === null`.
  - [ ] `[unit]` *Hash*:
        `snapshotSha256(bytes)` over `src/fixtures/figma/export-dashboard.png` (resolved with
        `readFileSync(fileURLToPath(new URL('./fixtures/figma/export-dashboard.png', import.meta.url)))`)
        equals `snapshotHash(sameBytes)`, is 64 lowercase hex (`/^[0-9a-f]{64}$/`), and
        `importDesign` with `exports: { '05 · Dashboard — mobile dark': bytes }` puts that exact
        string in the Dashboard spec while every other spec carries `null` (all ten map entries
        say `snapshot: true`).
  - [ ] `[unit]` *Shipped map*: the test reads the committed map through
        `fileURLToPath(new URL('../../../design/import.json', import.meta.url))` and asserts
        `parseImportMap(...)` yields `frames.length === 10` with `frames.every((frame) =>
        frame.snapshot)`, and that the package fixture's bytes equal the shipped map's bytes:
        `readFileSync(new URL('./fixtures/figma/import.json', import.meta.url)).equals(shipped)`
        is `true`. Three `../` from `packages/design/src/` is the repository root, the level
        `check.test.ts` already crosses.
  - [ ] `[unit]` *Round trip*: every output re-parses —
        `parseRoutes({ routes: result.routes })` returns ten routes, `parseScreenSpec` returns
        each `screens[i]`, and
        `checkDocuments({ tokens: parseTokens(tokensFixture), routes, screens }).filter((f) => f.rule === 'route_without_component')`
        is `[]`.
  - [ ] `[unit]` *Component rule*: `parseImportMap` rejects `component: ''`, `component:
        'dashboardPage'` and `component: '9Page'` with `map_invalid`.
  - [ ] `[unit]` *Duplicates*: a second entry repeating the first caption, screen or route is
        rejected with `map_invalid`.
  - [ ] `[unit]` *Fixture PNG*: the PNG-signature assertion above (eight bytes) and size
        ≤ 409 600 bytes.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched: the diff list is a subset of the
        eight paths, and `git diff --stat 47c1cce...HEAD -- packages/design/src/types.ts
        packages/design/src/tokens.ts packages/design/src/routes.ts
        packages/design/src/screens.ts packages/design/src/check.ts
        packages/design/src/snapshot.ts` is empty.
  - [ ] `[unit]` `packages/design/README.md` maps every new file with exactly one line each
        (`import.ts`, `import.test.ts`, `fixtures/figma/file.json`, `file-missing.json`,
        `import.json`, `export-dashboard.png`).

## 📣 Coordination

- **For Task-82 (wave 2), the contract it builds against:** `parseImportMap`, `importDesign`,
  `snapshotSha256`, `DesignImportError` (`code` / `path` / `caption` / `issues`), and the types
  `FigmaFileSnapshot`, `FigmaFrame`, `ImportMap`, `ImportMapFrame`, `DesignImportInput`,
  `DesignImportResult`, `DesignImportErrorCode`. Exports are keyed by the map's `caption`, not by
  the Figma node id, and the result's `colours` is already deduplicated, lowercased and sorted, so
  `coloursOutsideTokens` is a set difference against `tokenValues(parseTokens(...))`.
- **For the Architect:** nothing in `design/import.json` is changed. `fixtures/figma/import.json`
  is a byte copy and a package test asserts it equals the shipped map, so a later edit of the map
  must refresh the copy in the same commit.
- **Why the component regex is duplicated:** `COMPONENT_PATTERN` is private to `check.ts`, and
  `check.ts` is not in this task's paths. Keep the two definitions textually identical and say so
  in one comment.
- **Not changed, on purpose:** `types.ts` (no `import` member for `DesignBoundary`, so the map
  and the frame error use their own class), `routes.ts`, `screens.ts`, `tokens.ts`, `check.ts`,
  `snapshot.ts`, `package.json` (zod is already there).

## ⛔ Out of scope

- No `fetch`, no Figma REST call, no `scripts/` command — that is Task-82.
- No `design/tokens.json`, no `design/routes.json`, no `design/screens/*.json`, no
  `design/exports/*.png`; this task writes fixtures under `packages/design/src/fixtures/figma/`
  only.
- No change to `design/README.md` (Task-82 owns the whole file), `design/import.json` or any doc
  outside `packages/design/README.md`.
- No new dependency, no new `CB_*` key, no generated type from Figma's OpenAPI.
- No image decoding, no dimension validation, no colour-syntax validation: a fill is a string.

# Spec: Task-82 — The Figma import command

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** ops (repository script + docs). It is I/O by construction — filesystem and
  network — so it lives under `scripts/` and imports the pure package; it is **not** a
  `packages/*` task and adds no I/O to `@codebox/design`.
- **Role:** Dev.
- **Objective:** after this task `node scripts/design/import.mjs --file <key>` reads the committed
  `design/import.json`, fetches one Figma page over the REST API with `fetch`, projects it into
  `@codebox/design`'s `FigmaFileSnapshot`, runs `parseImportMap` + `importDesign`, and writes
  `design/routes.json`, `design/screens/<slug>.json` and `design/exports/<slug>.png` with one
  status line per artifact and one frozen summary line. `--check` regenerates in memory and exits
  1 on any byte of drift without writing. The command is offline in tests (injected `fetch` +
  fixtures) and is the operator's L6 tool, never a driver task.
- **Environment:** worktree `../wt-cb-82`, branch `task-82`, base `main` at `31d3a23`.
  Run `npm ci --prefer-offline --no-audit --no-fund` first. Commit the work on `task-82`, then
  publish with an **empty** `dev: done task-82` commit on the tip and `git push origin task-82`.
  Never commit or push to `main`. A real block (contradiction, missing tool, red gate you cannot
  fix) becomes one `agent-blocked` issue:
  `node scripts/agent/issue.mjs --label agent-blocked --title "Task-82: <what is blocked>" --body "<literal error and the decision needed>"`.
- **Dependencies:** Task-81 (merged) — `packages/design/src/import.ts` exports `parseImportMap`,
  `importDesign`, `snapshotSha256`, `DesignImportError` and the `FigmaFrame` /
  `FigmaFileSnapshot` / `ImportMap` types; `packages/design/src/index.ts` re-exports them.
  Task-84 (merged) — `design/tokens.json` is the document `coloursOutsideTokens` measures
  against. Task-83 (merged) — nothing is read from it, only the gate it wired must stay green.
  `design/import.json` is committed before the batch and is a **read-only input**, never a
  deliverable.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `scripts/design/import.mjs` (new)
- `scripts/design/import.test.mjs` (new)
- `scripts/design/fixtures/file.json` (new)
- `scripts/design/fixtures/import.json` (new)
- `scripts/design/fixtures/images.json` (new)
- `scripts/design/fixtures/export-frame.png` (new)
- `design/README.md` (the whole file)
- `docs/providers.md` (section: **§13.1 only** — a new subsection under §13; §13's table, intro
  and every other section stay byte-identical)
- `scripts/README.md` (section: **`## scripts/design` only** — one new heading plus the two-row
  table; the rest of the file stays byte-identical)

`scripts/README.md` is a **forced addition to the item's `*Paths:*` line**: `AGENTS.md`
("Every package and app carries a `README.md` that maps its files") requires the folder map, and
the two new files would otherwise be unmapped. Only the `## scripts/design` block is added.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/agent-spec-template.md`, `docs/agent-ci.md` §7, `docs/decisions.md` (D52, D57)
- `TODO.md` — Batch 21, the Task-81, Task-82 and Task-84 items and the batch cut note
- `packages/design/src/index.ts`, `import.ts`, `import.test.ts`, `routes.ts`, `screens.ts`,
  `tokens.ts`, `snapshot.ts`, `types.ts`, `check.ts` (the private `screenSlug` this task copies),
  `packages/design/README.md`, `packages/design/package.json`
- `packages/design/src/fixtures/figma/{file.json,file-missing.json,import.json,export-dashboard.png}`
- `design/import.json`, `design/tokens.json`
- `docs/providers.md` §13
- `docs/app.md` §9 (the token names, to keep `design/README.md` §5 truthful)
- `scripts/dev-local.mjs`, `scripts/dev-local.test.mjs`, `scripts/legal/notice.mjs`,
  `scripts/legal/notice.test.mjs`, `scripts/agent/issue.mjs`
- `scripts/README.md`, `vitest.config.ts`, `eslint.config.*`, `tsconfig.base.json`, `package.json`
- `scripts/agent/gate.test.mjs` (house style of a `.mjs` test)

## 🔒 Contract

### Module surface — `scripts/design/import.mjs` (ESM, Node built-ins only at module scope)

The file must be importable **before** `@codebox/design` is built, so `@codebox/design` is
imported **lazily, inside `main`**, never as a top-level import. Everything else is a static
`node:*` import.

```js
/** Thrown for every failure the command reports itself. `code` is the frozen string below. */
export class ImportCommandError extends Error {
  /** @param {string} code @param {string} message @param {number} exitCode */
  constructor(code, message, exitCode);
  code;      // e.g. 'map_missing'
  exitCode;  // 1 or 2
}

/**
 * Flags only. Accepts `--flag value` and `--flag=value`.
 * @param {string[]} argv
 * @returns {{ file: string | null, map: string | null, root: string | null,
 *             check: boolean, help: boolean }}
 * @throws {ImportCommandError} code 'usage', exitCode 2
 */
export function parseArgs(argv);

/**
 * `Repo · backlog` → `repo-backlog`. The rule is `packages/design/src/check.ts`'s private
 * `screenSlug`, copied verbatim: `·` and its surrounding spaces become `-`, every run of
 * non-alphanumerics becomes `-`, the ends are trimmed, then lowercased.
 * @param {string} screen @returns {string}
 */
export function screenSlug(screen);

/**
 * One page of the `/v1/files/:key?depth=6` body, projected. Walks only what the response
 * contains; the command never assumes a deeper tree than `depth=6` returned.
 * @param {unknown} body        the parsed JSON body
 * @param {string} page         the page caption to select, from the map
 * @param {string} fileKey      the key the command asked for; becomes `snapshot.fileKey`
 * @returns {{ fileKey: string, page: string, frames: Array<{
 *   id: string, caption: string, width: number, height: number, fills: string[] }> }}
 * @throws {ImportCommandError} 'page_missing' (exit 1) or 'file_invalid' (exit 1)
 */
export function projectPage(body, page, fileKey);

/**
 * The whole command. Never throws for a failure it knows: writes `<code>: <message>` to
 * `io.stderr` and resolves with the exit code. An unexpected exception is not caught.
 * @param {string[]} argv
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   cwd?: string,
 *   fetch?: typeof globalThis.fetch,
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 *   design?: Record<string, unknown> | null,
 * }} [io]
 * @returns {Promise<number>} the process exit code
 */
export async function main(argv, io = {});
```

`io` defaults, frozen: `env = process.env`, `cwd = process.cwd()`,
`fetch = globalThis.fetch`, `stdout = (line) => process.stdout.write(line)`,
`stderr = (line) => process.stderr.write(line)`, `design = null`. `stdout`/`stderr` receive the
**full line including its trailing `\n`**. `design` is the `@codebox/design` namespace; when it
is `null`, `main` loads it with
`createRequire(import.meta.url).resolve('@codebox/design')` and `import(pathToFileURL(resolved).href)`,
and maps a resolution failure to `design_package_missing` (exit 2, message
`build @codebox/design first (npm run build -w @codebox/design)`). The test always passes the
real namespace; there is no stub.

CLI guard, same shape as `scripts/legal/notice.mjs`:

```js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
```

### CLI flags — frozen

```
node scripts/design/import.mjs --file <key> [--check] [--map <path>] [--root <dir>]
```

| Flag | Meaning | Default |
| --- | --- | --- |
| `--file <key>` | The Figma file key for the two API calls. | `FIGMA_FILE_KEY` |
| `--map <path>` | The import map. A relative path is resolved against `io.cwd`. | `<root>/design/import.json` |
| `--root <dir>` | The repository root read and written. Relative to `io.cwd`. | `io.cwd` |
| `--check` | Regenerate in memory, compare, write nothing. | off |
| `--help`, `-h` | Print the usage block, exit 0. | — |

Frozen usage block (printed verbatim, on stdout for `--help`, on stderr after a `usage` error):

```
usage: node scripts/design/import.mjs --file <key> [--check] [--map <path>] [--root <dir>]

  --file <key>    the Figma file key (default: FIGMA_FILE_KEY)
  --map <path>    the import map (default: <root>/design/import.json)
  --root <dir>    the repository root to read and write (default: the working directory)
  --check         write nothing; exit 1 when any artifact differs
  --help          this text
```

An unknown option, a missing flag value or an empty `--file` is `usage`, exit 2, message
`unknown option '<arg>'` / `'<flag>' needs a value`.

### Order of operations — frozen

Every step below runs before the next; a failure stops the command and writes nothing.

1. `parseArgs` → `usage` (exit 2).
2. `--help` → usage on stdout, exit 0 (no request, no write, no package load).
3. `FIGMA_TOKEN` missing or empty → `token_missing`, exit 2:
   `FIGMA_TOKEN is not set (export it; the command does not read .env)`.
4. The file key: `--file`, else `FIGMA_FILE_KEY`; neither → `file_missing`, exit 2:
   `FIGMA_FILE_KEY is not set and --file was not given`.
5. Load the design package (`design_package_missing`, exit 2).
6. Read the map at the resolved path; `ENOENT` → `map_missing`, exit 2, message
   `<resolved path> is missing`. Then `parseImportMap`; a `DesignImportError('map_invalid')` →
   `map_invalid`, exit 1, print `map_invalid: invalid import map` followed by one line per issue,
   `  <path>: <message>`.
7. The map's `fileKey` differs from the key → `file_mismatch`, exit 2:
   `the map is for '<map.fileKey>' but the command was given '<key>'`.
8. `GET https://api.figma.com/v1/files/<encodeURIComponent(key)>?depth=6` with
   `X-Figma-Token: <token>`.
9. `projectPage(body, map.page, key)` → `page_missing` / `file_invalid`, exit 1.
10. `importDesign({ snapshot, map })` — validates every caption, yields `routes` and the mapped
    `colours`. A `DesignImportError('frame_missing')` → `frame_missing`, exit 1, message
    `no frame captioned '<caption>' (frames.<index>.caption)`.
11. Snapshot targets: the map entries with `snapshot === true`, in map order, each resolved to
    the node id of the first frame with that caption (guaranteed present after step 10).
12. `GET https://api.figma.com/v1/images/<key>?ids=<ids>&format=png&scale=2` with
    `X-Figma-Token: <token>`, `ids` the node ids in step-11 order joined by `,`. An entry with
    `snapshot: false` is not a target: it is absent from `ids`, gets no PNG request and writes no
    file.
13. For each target, `fetch(<pre-signed URL>)` with **one argument only** — no init, no headers,
    no `X-Figma-Token` — and keep the bytes.
14. `importDesign({ snapshot, map, exports })` — the authoritative `screens`, with hashes.
15. Read `<root>/design/tokens.json` and `parseTokens` + `tokenValues`; a missing or unparsable
    document is **not** an error: `coloursOutsideTokens` is `null` and stderr gets
    `tokens_unavailable: design/tokens.json`.
16. Serialise every artifact in memory.
17. `--check`: compare each artifact to disk byte for byte (a missing file is drift). Equal →
    no `drift` line and exit 0 (the `colour outside tokens` lines still print). Different → one
    `drift: <path>` line per drifting artifact on stderr, nothing written, exit 1.
18. Write mode: `mkdirSync` the two directories (recursive), write every artifact, one status
    line each, in this order: `design/routes.json`, then the screens in map order, then the
    exports in map order.
19. The summary line is the **last stdout line** in both modes.

### HTTP — frozen

| Call | URL | Header |
| --- | --- | --- |
| file | `https://api.figma.com/v1/files/<key>?depth=6` | `X-Figma-Token: <token>` |
| images | `https://api.figma.com/v1/images/<key>?ids=<ids>&format=png&scale=2` | `X-Figma-Token: <token>` |
| PNG | the URL the images response returned for that id | **none** — `fetch(url)`, no second argument |

- No `/v1/styles` call, ever. No other Figma endpoint. No retry, no timeout wrapper.
- Both API requests are `fetch(url, { headers: { 'X-Figma-Token': token } })` — exactly that
  header object, no `Accept`, no `User-Agent`.
- Non-`ok` response → `http_error`, exit 1: `GET <url> answered <status>`.
- A `fetch` rejection (network) → `http_error`, exit 1: `<url> failed: <message>`.
- A body that is not JSON → `http_error`, exit 1: `GET <url> did not return JSON`.
- Images body `err` non-null → `export_missing`, exit 1: `<err>`.
- No URL for an id, or `null` → `export_missing`, exit 1: `no export for '<caption>'`.
- PNG response non-`ok` → `export_missing`, exit 1: `<caption> export answered <status>`.
- The token is never printed, never stored, never in a filename. No `.env` is read.

### Exit codes — frozen

| Exit | Codes |
| --- | --- |
| 0 | success; `--check` with no drift; `--help` |
| 1 | `map_invalid`, `http_error`, `page_missing`, `file_invalid`, `frame_missing`, `export_missing`, `drift` |
| 2 | `usage`, `token_missing`, `file_missing`, `map_missing`, `file_mismatch`, `design_package_missing` |

Every reported failure is one line `<code>: <message>` on stderr. An unexpected exception is not
caught; Node exits 1. The split is deliberate: 2 means the invocation or the environment cannot
start the work (`usage`, `token_missing`, `file_missing`, `map_missing`, `file_mismatch`,
`design_package_missing`); 1 means the work failed (`map_invalid`, `http_error`, `page_missing`,
`file_invalid`, `frame_missing`, `export_missing`, `drift`).

### The projection — frozen

- **Page:** `body.document.children` filtered to `type === 'CANVAS'`, matched by `name === page`,
  exact and case-sensitive, first match. No match → `page_missing`, exit 1, message
  `page '<page>' is absent; the file has: <name>, <name>` in document order, `(none)` when the
  file has no canvas. The pages list is every canvas name in the file, including the selected one.
- **Frames:** only the selected canvas' **top-level** children with `type === 'FRAME'`, in
  document order. A nested frame is not a frame; a `TEXT`, `GROUP`, `SECTION`, `COMPONENT` or
  `ELLIPSE` child of the canvas is not a frame.
- **`id`:** the node's `id` string, verbatim. **`caption`:** the node's `name`, verbatim, no
  trimming, no re-casing. **`width` / `height`:** `absoluteBoundingBox.width|height`; a frame
  without two finite numbers → `file_invalid`, exit 1, `frame '<id>' has no size`.
- **`fileKey`:** the key used in the request. **`page`:** the page that was selected.
- **`fills`:** distinct strings, first-seen order, from the frame node and **every descendant**
  present in the response (`children` walked recursively, whatever the node type):
  - for each node, for each paint in its `fills` array (when it has one): include the paint only
    when `paint.type === 'SOLID'` and `paint.visible !== false`;
  - `#rrggbb` when `paint.opacity` is absent or exactly `1`, with each channel
    `Math.round(clamp01(paint.color.r|g|b) * 255)` rendered as two lowercase hex digits;
  - `rgba(<r>, <g>, <b>, <a>)` otherwise, same integer channels and
    `a = String(Math.round(opacity * 1000) / 1000)` (so `0.25` → `0.25`, `0.5` → `0.5`);
  - a gradient, image, video or `SOLID` with `visible: false` paint contributes nothing; a
    duplicate string inside one frame is kept once.

### Artifacts — frozen

Paths come from `@codebox/design` (`ROUTES_PATH`, `SCREENS_DIR`, `EXPORTS_DIR`,
`TOKENS_PATH`), joined under `<root>`; the **displayed** path is always repository-relative
(`design/...`), whatever `--root` is.

| Artifact | File | Shape |
| --- | --- | --- |
| routes | `design/routes.json` | `{"routes":[…]}` — the array `importDesign` returned; each `{"path","screen","component"}` |
| screen | `design/screens/<slug>.json` | the `ScreenSpec` object itself: `{"screen","route","states":{"loading","empty","error"},"snapshotSha256"}` |
| export | `design/exports/<slug>.png` | the pre-signed PNG bytes, untouched |

- `<slug>` is `screenSlug(spec.screen)` (the **screen**, not the caption). The ten slugs of the
  shipped map are `pairing`, `repo-list`, `repo-backlog`, `repo-workers`, `design-session`,
  `dashboard`, `settings`, `devices`, `credentials`, `about`.
- JSON serialisation is exactly `JSON.stringify(value, null, 2) + '\n'` — two-space indent, one
  trailing newline, key order as built by `importDesign`. `design/screens/dashboard.json` starts:
  `{\n  "screen": "Dashboard",\n  "route": "/dashboard",\n  "states": {\n    "loading": null,`.
- `snapshotSha256` is `snapshotSha256(bytes)` for an entry with `snapshot: true`, `null`
  otherwise. No other transformation of the bytes: no resize, no re-encode, no budget check.
- Nothing is deleted. A slug that disappears from the map leaves its old files on disk; the
  operator reviews the diff at L6.
- The command writes **only** under `<root>/design`. It creates `screens/` and `exports/` when
  absent; in `--check` it creates nothing.

### Status lines and summary — frozen

One line per artifact, in step-18 order, on stdout:

```
wrote design/routes.json (10 routes)
wrote design/screens/pairing.json
wrote design/exports/pairing.png (231 bytes)
```

The summary is **one JSON line, no spaces, this key order**, the last stdout line in both modes:

```json
{"frames":12,"mapped":10,"unmapped":2,"colours":8,"coloursOutsideTokens":1,"routes":10,"screens":10,"exports":10}
```

| Key | Value |
| --- | --- |
| `frames` | `snapshot.frames.length` |
| `mapped` | `map.frames.length` |
| `unmapped` | frames whose `caption` matches no map entry (set-based: `frames.length` minus distinct matched captions) |
| `colours` | `importDesign(...).colours.length` |
| `coloursOutsideTokens` | count of those colours absent from `tokenValues(tokens)`, or `null` when the token document is unavailable |
| `routes` | routes written |
| `screens` | screens written |
| `exports` | PNGs written = entries with `snapshot: true` |

`coloursOutsideTokens` is a **measurement, never a failure**: it does not change the exit code,
it is printed in both modes, and each colour outside the tokens gets its own stderr line
`colour outside tokens: <colour>` in the sorted `colours` order. The factory illustration keeps
its own palette; only the mapped frames are measured.

### Data — the four fixtures (all new, all offline)

`fixtures/file.json` — a raw `GET /v1/files/:key?depth=6` body (not a projected snapshot). Shape:
`{"name":"codebox","key":"3HMV2UN6QviuNXe2T3Htsr","document":{"id":"0:0","name":"Document","type":"DOCUMENT","children":[…canvases…]}}`.
Two canvases, in this order: `Cover` (id `0:1`) holding one 390×844 FRAME `0:2` named
`Cover frame` with one SOLID `#0b0f14` fill, then `Page 1` (id `0:3`) holding the thirteen
top-level nodes below in this order. A frame node is:

```json
{ "id": "1:100", "name": "01 · Pairing — mobile dark", "type": "FRAME",
  "absoluteBoundingBox": { "x": 0, "y": 0, "width": 390, "height": 844 },
  "fills": [ { "type": "SOLID", "color": { "r": 0.043, "g": 0.059, "b": 0.078 } } ],
  "children": [ … ] }
```

Every colour channel in the fixture is written as `Math.round(byte / 255 * 1000) / 1000` (three
decimals), which `Math.round(v * 255)` returns to the original byte.

| # | `id` | `name` (caption) | size | subtree | expected `fills` |
| --- | --- | --- | --- | --- | --- |
| 1 | `1:100` | `01 · Pairing — mobile dark` | 390×844 | own `#0b0f14`; child `1:101` RECTANGLE `#121821`; child `1:102` TEXT `#e6edf3`; child `1:103` RECTANGLE `{type:SOLID, visible:false, color:#336699}` | `["#0b0f14","#121821","#e6edf3"]` |
| 2 | `2:110` | `02 · Repo list — mobile dark` | 390×844 | own `#0b0f14`; child `2:111` RECTANGLE `#8b98a5` | `["#0b0f14","#8b98a5"]` |
| 3 | `3:120` | `22 · Repo · backlog — deps (dark)` | 390×844 | own `#0b0f14`; child `3:121` RECTANGLE `#121821` | `["#0b0f14","#121821"]` |
| 4 | `4:130` | `20c · Crew · aerial — dark` | 390×844 | own `#0b0f14`; child `4:131` RECTANGLE `#22c55e` | `["#0b0f14","#22c55e"]` |
| 5 | `5:140` | `26 · Design · preview + chat — dark` | 390×844 | own `#0b0f14`; child `5:141` RECTANGLE `#f59e0b`; child `5:142` ELLIPSE SOLID `#336699` with `"opacity": 0.25` | `["#0b0f14","#f59e0b","rgba(51, 102, 153, 0.25)"]` |
| 6 | `6:150` | `05 · Dashboard — mobile dark` | 390×844 | own `#0b0f14`; child `6:151` RECTANGLE `#121821`; child `6:152` TEXT `#e6edf3`; child `6:153` RECTANGLE whose only paint is `{type:"GRADIENT_LINEAR", gradientStops:[{position:0,color:{r:1,g:0,b:1}}]}` | `["#0b0f14","#121821","#e6edf3"]` |
| 7 | `7:160` | `06 · Settings — mobile dark` | 390×844 | own `#0b0f14`; child `7:161` RECTANGLE `#8b98a5` | `["#0b0f14","#8b98a5"]` |
| 8 | `8:170` | `15 · Settings / Devices` | 390×844 | own `#0b0f14` | `["#0b0f14"]` |
| 9 | `9:180` | `16 · Settings / Credentials` | 390×844 | own `#0b0f14` | `["#0b0f14"]` |
| 10 | `10:190` | `07 · About — mobile dark` | 390×844 | own `#0b0f14`; child `10:191` RECTANGLE `#5b6772` | `["#0b0f14","#5b6772"]` |
| 11 | `11:900` | `Design System` | 1280×800 | own `#0b0f14`; child `11:901` RECTANGLE `#ff00ff` | `["#0b0f14","#ff00ff"]` |
| 12 | `12:910` | `01b · Sheets — dark` | 1280×800 | own `#121821`; child `12:911` RECTANGLE `#abcdef` | `["#121821","#abcdef"]` |
| 13 | `13:950` | `Annotation` | 390×40 | `type: "TEXT"`, one SOLID `#123456` paint, no children | not a frame |

`fixtures/import.json` — a **byte-identical copy** of `design/import.json` (10 entries, all
`snapshot: true`), asserted equal by the test.

`fixtures/images.json` — `{"err":null,"images":{…}}` with exactly the ten mapped ids
`1:100`, `2:110`, `3:120`, `4:130`, `5:140`, `6:150`, `7:160`, `8:170`, `9:180`, `10:190`, each
mapped in map order to `https://figma-images.example/<id with ':' replaced by '-' >.png`.

`fixtures/export-frame.png` — a real 1 × 1 PNG (8-bit RGBA), under 400 bytes, identical bytes for
every image URL. The test asserts the PNG signature, `readUInt32BE(16) === 1` and
`readUInt32BE(20) === 1`, then hashes those bytes with `snapshotHash` and requires the same hash
in all ten written screen specs.

With those fixtures and a temp root whose `design/tokens.json` is a **copy of the committed
`design/tokens.json`**, the frozen run is: `frames` 12, `mapped` 10, `unmapped` 2, `colours` 8,
`coloursOutsideTokens` 1 (only `rgba(51, 102, 153, 0.25)`), `routes` 10, `screens` 10,
`exports` 10; 12 HTTP calls (file, images, ten PNGs). The mapped `colours`, sorted, are
`["#0b0f14","#121821","#22c55e","#5b6772","#8b98a5","#e6edf3","#f59e0b","rgba(51, 102, 153, 0.25)"]`.

## 🧩 Configuration

No `CB_*` key. Two operator-only environment variables, documented in `docs/providers.md`
**§13.1** in this task:

| Key | Read by | Default | Failure |
| --- | --- | --- | --- |
| `FIGMA_TOKEN` | `scripts/design/import.mjs` only — never `cbd`, never a workflow, never the driver | none | `token_missing`, exit 2, before the first request |
| `FIGMA_FILE_KEY` | same | `--file` when given | `file_missing`, exit 2, before the first request |

`design/tokens.json` is read as data, not as a key. `design/import.json`'s `page` and `fileKey`
are the map's facts; the key the command was given must equal the map's `fileKey`.

The doc obligations, frozen:

- `docs/providers.md` gains exactly one new subsection under §13, headed
  `### 13.1 Figma import (operator only)`, and no other line of that file changes. It states: the
  two keys of the table above and that they are read by `scripts/design/import.mjs` alone —
  never by `cbd`, `apps/daemon`, a workflow or the driver; the operator runs the command at L6
  (`TODO.md` L6) with the real token; a missing token exits 2 before any request; the token is
  sent as `X-Figma-Token` on `GET /v1/files/:key` and `GET /v1/images/:key` and **not** on the
  pre-signed PNG URLs; the command never calls `/v1/styles`; the token never enters the
  repository, a log line or a filename.
- `scripts/README.md` gains exactly one new block, **appended at the end of the file** — no other
  line changes:

```md
## scripts/design

| File | What it is |
| --- | --- |
| `import.mjs` | The Figma import command: fetches the mapped page, projects its frames and writes `design/routes.json`, `design/screens/<slug>.json` and `design/exports/<slug>.png` (`--file`, `--map`, `--root`, `--check`). |
| `import.test.mjs` | Unit tests over fixture responses and an injected `fetch`: the projection, the three artifact families, `--check` drift and every exit code. |
```

`design/README.md` is rewritten around this outline, and every fact below must be present:

- The file map lists `README.md`, `import.json` (the map), `tokens.json` (the DTCG source) and the
  three generated families `routes.json`, `screens/<slug>.json`, `exports/<slug>.png`, saying the
  generated ones are written by the command in §4 and land at L6.
- §1 Routed screens, §2 States and sheets, §3 Widths and themes: the existing tables and notes,
  unchanged in substance (eleven routed rows, the workers-states note, the missing-and-known note,
  the width/theme table).
- §4 Import and export: the command `node scripts/design/import.mjs --file <key>`, the flags
  (`--file`, `--map`, `--root`, `--check`), the three artifact families and their slug rule
  (the sentence "the slug is the one `screenSlug` derives from the screen name in §1"), the
  summary keys, `--check` regenerating from Figma and exiting 1 on drift, scale 2, the 400 kB
  review bound, and that the operator runs it at L6 while the driver never gets this task.
- §5 Tokens: `design/tokens.json` is the source of truth (DTCG, Task-84's twelve values, all
  colours for the app and the design check), the app mirrors it, and the light accents
  `#15803d` / `#b45309` keep their note.
- §6 Rules: the existing bullets plus "the generated artifacts are never hand-edited; a change
  goes through the map and a re-import", and "a screen's spec and its export share one slug".
- A new §7 The import map: `fileKey`, `page`, and one entry per routed screen with `caption`
  (the frame name exactly), `screen`, `route`, `component`, the three `states` (each a caption or
  `null`) and `snapshot`; the map drives the output; a caption that is no longer on the page is
  fatal.

## 🧪 Test and Validation Plan (for QA)

Run from the worktree root. **No criterion below may touch the network**: the token is absent in
CI and the command stops before the first request; every HTTP path is exercised through the
injected `fetch` in `scripts/design/import.test.mjs`.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass (ESLint covers `scripts/**`).
  - `npm test` — Vitest, headless; the `scripts` project runs `scripts/**/*.test.mjs`, so the new
    suite is in the gate with no config change.
  - `npx vitest run --project scripts` — the task's suite alone.
  - `npm run build` — `tsc -b` and the app build.
  - `git diff --name-only main...task-82` — audit against the exclusive paths.
  - `git status --porcelain` — must be empty after the gate: the tests write only inside
    `os.tmpdir()`, never into `design/`.
  - The suite's `io` for a run is `{ env: { FIGMA_TOKEN: 'test-token', FIGMA_FILE_KEY: '3HMV2UN6QviuNXe2T3Htsr' }, fetch: <the recording stub>, stdout, stderr, design: <the real namespace> }`;
    no test reads the ambient environment, and no test calls the real `fetch`.

- **Acceptance criteria:**
  - [ ] `[unit]` `npm run lint && npm test && npm run build` green.
  - [ ] `[unit]` `npx vitest run --project scripts` passes these six suites and their cases:
        `parseArgs` (defaults; both value forms; unknown option / missing value / empty
        `--file` are `usage` exit 2; `--help` succeeds), `screenSlug` (`Repo · backlog` →
        `repo-backlog`, `Design · session` → `design-session`; and the slug agrees with the file
        name `checkDocuments` derives from a screen with a null state), `projectPage` (page
        selected by name with `Cover` first; 12 frames and the `TEXT` sibling excluded; caption,
        id, size and fills; hidden paint `#336699` and the gradient excluded; the translucent
        paint `rgba(51, 102, 153, 0.25)` kept; `page_missing` names the page and both pages),
        `main — write`, `main — check`, `main — failures`.
  - [ ] `[unit]` Write mode over the fixture responses and a `mkdtempSync` root prints exactly
        21 status lines and then
        `{"frames":12,"mapped":10,"unmapped":2,"colours":8,"coloursOutsideTokens":1,"routes":10,"screens":10,"exports":10}`;
        the first stdout line is `wrote design/routes.json (10 routes)`, the next ten are the
        screens in map order and the ten after them are the exports in map order.
  - [ ] `[unit]` Under that temp root `design/routes.json` re-parses through `parseRoutes` to the
        ten mapped routes, every `design/screens/<slug>.json` re-parses through `parseScreenSpec`,
        the ten file names are exactly the slugs above, `checkDocuments` reports no
        `route_without_component`, and every `design/exports/<slug>.png` is byte-identical to
        `scripts/design/fixtures/export-frame.png` with `snapshotSha256` equal to
        `snapshotHash` of those bytes in all ten screens.
  - [ ] `[unit]` `coloursOutsideTokens` never fails: the fixture run exits 0 with the value 1 and
        one stderr line `colour outside tokens: rgba(51, 102, 153, 0.25)`; with the same temp
        root's `design/tokens.json` rewritten without `color.ink.muted-light` the run still exits
        0, reports 2 and adds `colour outside tokens: #5b6772`; with no tokens file the value is
        `null`, stderr says `tokens_unavailable: design/tokens.json`, and the artifacts still
        land.
  - [ ] `[unit]` The two API requests carry `headers['X-Figma-Token'] === 'test-token'`; the ten
        PNG requests are called with the URL only (`second argument === undefined`); no requested
        URL contains `/styles`; the images request's `ids` parameter is
        `1:100,2:110,3:120,4:130,5:140,6:150,7:160,8:170,9:180,10:190`.
  - [ ] `[unit]` `--check` on a current root exits 0, prints the summary as its only stdout line
        (the `colour outside tokens` line still goes to stderr in both modes) and leaves every
        file byte-identical. After appending one space to `design/routes.json` it exits 1, stderr
        contains `drift: design/routes.json`, and the file still holds the appended space.
  - [ ] `[unit]` `main` with only `FIGMA_FILE_KEY` set exits 2, stderr names `FIGMA_TOKEN` and
        `token_missing`, and the injected `fetch` was called 0 times.
  - [ ] `[unit]` A temp root with no `design/import.json` and both keys set exits 2 with
        `map_missing` naming `<root>/design/import.json` (the default path).
  - [ ] `[unit]` A map whose `page` is `Page 2` exits 1 with `page_missing` naming `Page 2`,
        `Cover` and `Page 1`, and `<root>/design` afterwards holds only `tokens.json` and
        `import.json` — no `routes.json`, no `screens/`, no `exports/`.
  - [ ] `[unit]` Renaming the `05 · Dashboard — mobile dark` frame in the fixture file exits 1
        with `frame_missing` and the caption; a map carrying another `fileKey` exits 2 with
        `file_mismatch` naming both keys.
  - [ ] `[unit]` `node scripts/design/import.mjs --help` exits 0 and prints the frozen usage
        block, run **before** `npm run build` in a tree without `packages/design/dist` — the
        module must not load the package at import time.
  - [ ] `[unit]` `node scripts/design/import.mjs` with `FIGMA_TOKEN` unset exits 2 and stderr
        matches `token_missing: .*FIGMA_TOKEN`; no request is made.
  - [ ] `[unit]` `git diff --name-only main...task-82` lists only the nine exclusive paths, and
        `docs/providers.md` §13.1 is the only added block there while `scripts/README.md` gains
        only `## scripts/design` with the two rows (`import.mjs`, `import.test.mjs`).
  - [ ] `[unit]` `design/README.md` keeps §1, §2 and §3 intact (the eleven routed rows, the
        state rows and the width/theme table), lists `import.json`, `tokens.json`,
        `routes.json`, `screens/<slug>.json` and `exports/<slug>.png` in its file map, gives
        `node scripts/design/import.mjs --file <key>` in §4 with `--check`, states that
        `design/tokens.json` is the DTCG source (Task-84's twelve values) in §5, forbids
        hand-editing the generated artifacts in §6, and documents the map's keys in a new §7.
  - [ ] `[unit]` `design/routes.json`, `design/screens/**`, `design/exports/**` and
        `design/import.json` are **unmodified** in the task diff: the command was never given a
        real token and the artifacts stay L6's.

## 📣 Coordination

- **The unbuilt-package seam (the one thing that forced a design decision).** `@codebox/design`
  resolves to `dist/`, which does not exist at `npm test` time (CI order is `npm ci` → lint →
  test → build) and the `scripts` Vitest project has no `@codebox/*` alias. Therefore:
  (a) `import.mjs` imports the package **lazily inside `main`** via
  `createRequire(...).resolve('@codebox/design')` + `import(pathToFileURL(...).href)`, with
  `design_package_missing` (exit 2, "build `@codebox/design` first") when it cannot resolve — so
  `--help` and the missing-token path work in an unbuilt tree; and (b) `main` accepts the
  namespace as `io.design`, and the test passes the **real** one imported from
  `../../packages/design/src/index.ts`, never a stub. Do not add a Vitest alias: `vitest.config.ts`
  is not this task's path.
- **`screenSlug` is copied, not exported.** `check.ts` keeps it private and `packages/design` is
  read-only here. The copy lives in `import.mjs` next to a test that proves it agrees with the
  file name `checkDocuments` derives. A later task may export it from the package and delete the
  copy; nothing else should depend on the copy.
- **`design/README.md` §4 changes its file names** from the old kebab caption names
  (`01-pairing-dark.png`) to `design/exports/<slug>.png` — the item and D52/`AGENTS.md` name the
  slug, so the README follows the artifact, not the other way round.
- For the Architect: `scripts/README.md` is the only path added to the item's list; no hot file
  is touched, no `package.json` script entry exists (the command is invoked by path), and the
  batch's wave 2 is still a single task.
- For the next batch (the ten per-screen tasks): they read `design/screens/<slug>.json` and
  `design/exports/<slug>.png`, which land at L6; until then those files do not exist and the
  tasks stay uncut. `design/README.md` §1 keeps the captions they cite.

## ⛔ Out of scope

- No new dependency; no `npm` script entry; no change to `package.json`, `package-lock.json`,
  `.gitignore`, `vitest.config.ts`, `tsconfig.base.json`, `opencode.json`.
- No `/v1/styles` call and no token derivation: `design/tokens.json` is Task-84's, never imported.
- No change to `packages/**`, `apps/**`, `docs/decisions.md`, `docs/jobs.md`, `TODO.md`,
  `CHANGELOG.md`, `design/import.json`, `design/tokens.json`, or any generated artifact
  (`design/routes.json`, `design/screens/**`, `design/exports/**` stay absent).
- No `.env` loading, no retry, no timeout wrapper, no concurrency, no progress output, no
  deletion of stale artifacts, no PNG re-encode or size enforcement, no diff review, no commit,
  push or PR.
- No `[live]` criterion: this run has no browser, VM, Figma token or network, so every criterion
  is a headless command or a value the tests decode.

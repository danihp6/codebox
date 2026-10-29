# Spec: Task-78 — Backlog with dependencies

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package + daemon + app (a contract change that crosses all three).
- **Role:** Dev.
- **Objective:** Every backlog row on `GET /v1/repos/{id}/backlog` carries the `Task-NN` refs
  named by its `*Dependencies:*` sentence as `needs`, the daemon projects that field from the
  parsed `TODO.md` it already reads, and the repository's backlog screen draws a dependency rail
  with one edge per declared dependency (a chain, a branch or an external prerequisite), shows
  every unmet id on the row, and opens a detail panel for the selected row. The real `TODO.md`
  still parses and the OpenAPI path set does not move.
- **Environment:** worktree `../wt-cb-78`, branch `task-78`, base `main` @ `38bd0f3`.
- **Dependencies:** Task-71 (merged; `packages/backlog/src/parse.ts` and its fixture), Task-72
  (merged; `apps/daemon/src/backlog/service.ts`), Task-75 (merged;
  `apps/app/src/app/features/backlog/repo-backlog.page.ts`), Task-79 (merged; it held
  `packages/contracts/src/index.ts`, `design.ts`, `openapi.ts` and `openapi.test.ts`, so this
  task edits the same contract package only now). Task-77 is merged and rewrote
  `features/works/**`; it does not touch this task's paths.
- **Turnstile:** when the work is complete, leave an empty commit with the exact subject
  `dev: done task-78` on the branch tip and push it. QA writes the verdict; the Dev does not
  merge.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path.

- `packages/contracts/src/works.ts`
- `packages/contracts/src/works.test.ts`
- `packages/contracts/src/index.ts` — **hot file, claimed by this task; leave it unchanged.**
  `BacklogItem` is already exported, so this task adds no export here and no other task may edit
  it in this batch.
- `packages/backlog/src/types.ts`
- `packages/backlog/src/parse.ts`
- `packages/backlog/src/dependencies.ts` (new)
- `packages/backlog/src/dependencies.test.ts` (new)
- `packages/backlog/src/index.ts`
- `packages/backlog/src/parse.test.ts`
- `packages/backlog/src/select.test.ts`
- `packages/backlog/src/live-todo.test.ts`
- `packages/backlog/README.md`
- `apps/daemon/src/backlog/service.ts`
- `apps/daemon/src/backlog/service.test.ts`
- `apps/daemon/src/backlog/routes.test.ts`
- `apps/daemon/src/backlog/README.md`
- `apps/app/src/app/features/backlog/dependency-rail.ts` (new)
- `apps/app/src/app/features/backlog/dependency-rail.spec.ts` (new)
- `apps/app/src/app/features/backlog/repo-backlog.page.ts`
- `apps/app/src/app/features/backlog/repo-backlog.page.spec.ts`
- `apps/app/src/app/features/backlog/backlog.api.spec.ts` — its `BACKLOG` fixture gains `needs`
- `apps/app/src/app/features/backlog/backlog.store.spec.ts` — its `BACKLOG` fixture gains `needs`
- `apps/app/src/app/features/backlog/i18n.ts`
- `apps/app/README.md` — **shared path, split by line block.** This task owns only the
  `src/app/features/backlog/**` lines (the block that currently runs from
  `src/app/features/backlog/backlog.api.ts` through
  `src/app/features/backlog/repo-backlog.page.ts`/`.spec.ts`). It must not edit the
  `src/app/features/works/**` lines or the `src/theme/**` lines; Task-80 owns those.
- `docs/api.md` — **section §5.6 only** (the `Works and backlog` object and its prose). Do not
  touch §5.6.1 or any other section; the task table and the 63 OpenAPI paths stay as they are.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md` and the files it owns:

- `TODO.md` — the real `*Dependencies:*` grammar and the fixture the live test reads.
- `packages/contracts/src/primitives.ts` — `backlogRefSchema`, `BacklogRef`.
- `packages/contracts/src/openapi.ts` — proves the `Backlog` component is built from
  `backlogSchema`; **read only, do not edit**.
- `packages/contracts/src/openapi.test.ts` — the pinned path count; **read only, do not edit**.
- `packages/backlog/src/fixtures/todo.md` — the shared parser fixture.
- `packages/backlog/src/tick.ts` — unchanged, read to avoid reformatting.
- `apps/daemon/src/backlog/routes.ts` — the existing route and its statuses.
- `apps/app/src/app/features/backlog/backlog.api.ts` — the response parser.
- `apps/app/src/app/features/backlog/backlog.store.ts` — the load/reload state.
- `apps/app/src/app/features/backlog/new-session.sheet.ts` — not changed.
- `apps/app/src/app/app.routes.ts` — confirms no route is added.
- `docs/app.md` §4 — the screen's route and the repository tab contract; **read only**.

## 🔒 Contract

The public surface other tasks and QA are written against. Exact names and signatures.

### `packages/contracts/src/works.ts`

Add one key to `backlogItemSchema`, after `line` and before `work`:

```ts
export const backlogItemSchema = z.strictObject({
  ref: backlogRefSchema,
  title: z.string().min(1),
  checked: z.boolean(),
  line: z.number().int().positive(),
  needs: z.array(backlogRefSchema).default([]),
  work: backlogWorkRefSchema.nullable(),
});
export type BacklogItem = z.infer<typeof backlogItemSchema>;
```

- `needs` is a non-null array of `BacklogRef` (`Task-<digits>`), default `[]`.
- The default is the compatibility contract: a daemon payload produced before this key existed
  (the key absent) parses to `needs: []`. An explicit `null`, a string or an array with a bad
  ref is a contract failure.
- `backlogWorkRefSchema`, `backlogSectionSchema`, `backlogSchema`, `parseBacklog` and every
  other work-model schema are unchanged.
- No new export is added to `packages/contracts/src/index.ts`; `BacklogItem` already carries the
  new field through its inferred type.
- `packages/contracts/src/resources.ts` is **not** touched: `BacklogItem` and
  `backlogWorkRefSchema` live in `works.ts`, and `backlogRefSchema` in `primitives.ts`. The
  contract slice this task needs is exactly `works.ts` + `works.test.ts`.

### `packages/backlog/src/dependencies.ts` (new)

```ts
import type { BacklogRef } from '@codebox/contracts';

/**
 * The refs named by the first `*Dependencies:*` sentence in an item body, in file order,
 * deduplicated, with `self` removed. Never null.
 */
export function needsOf(body: string, self: BacklogRef): readonly BacklogRef[];
```

The grammar is frozen:

- The marker is the first exact `*Dependencies:*` in `body`. No marker → `[]`.
- The value is the rest of the marker's line, cut at the first newline or at the next
  `*<metadata>:*` marker (for example `*Acceptance:*`), whichever comes first.
- If the trimmed value starts with the word `none` (case-insensitive), the result is `[]`.
  Any parenthetical after `none` is prose and contributes nothing.
- Otherwise every `Task-<digits>` token in the value is a dependency, in first-appearance
  order.
- A `Task-<a> to Task-<b>` range expands inclusively when `a < b`; the expanded refs keep the
  start token's digit width (`Task-01 to Task-03` → `Task-01`, `Task-02`, `Task-03`;
  `Task-7 to Task-9` → `Task-7`, `Task-8`, `Task-9`). When `a >= b` the range contributes the
  two written endpoints only (`a === b` contributes one).
- Duplicates collapse to the first appearance; an exact `self` string is removed.
- Pure: no clock, network, filesystem, environment or Markdown parser.

### `packages/backlog/src/types.ts` and `parse.ts`

`BacklogEntry` gains one field, after `body`:

```ts
/** The refs on this item's `*Dependencies:*` sentence, in file order, self excluded. */
readonly needs: readonly BacklogRef[];
```

`parseBacklog` sets `needs: needsOf(body, item.ref)` after it has built `body`. Every other
field, the section grouping and the duplicate-ref report are unchanged.

`packages/backlog/src/index.ts` re-exports `needsOf` once:

```ts
export { needsOf } from './dependencies.js';
```

### `apps/daemon/src/backlog/service.ts`

`project()` maps the parsed field onto the wire object, in the same object literal as
`ref`/`title`/`checked`/`line`/`work`:

```ts
needs: [...item.needs],
```

No other service method changes. The route still answers `200` with `Backlog`, `401` without a
device token and `404 not_found` with `details.path = "repo.id"` for an unknown repository. A
projection that fails `parseBacklog` keeps the existing `handle` error path; this task adds no
HTTP status, no error code, no SSE event and no log line.

### `apps/app/src/app/features/backlog/dependency-rail.ts` (new)

The app does not depend on `@codebox/backlog`; the drawing rule is a pure feature module over
the wire object.

```ts
import type { BacklogItem, BacklogRef } from '@codebox/contracts';

export type RailEdgeKind = 'chain' | 'branch' | 'external';

export interface RailEdge {
  readonly from: BacklogRef;
  readonly to: BacklogRef;
  readonly kind: RailEdgeKind;
}

/** One edge per `needs` entry, in row order and then need order; a root contributes none. */
export function railEdges(items: readonly BacklogItem[]): readonly RailEdge[];

/** Every need whose target is missing from `items` or is not checked, in need order. */
export function unmetNeeds(
  item: BacklogItem,
  items: readonly BacklogItem[],
): readonly BacklogRef[];
```

`railEdges` classifies an edge with this precedence:

1. `external` — `to` is not the `ref` of any item in `items`.
2. `branch` — the source item declares more than one need.
3. `chain` — otherwise.

`unmetNeeds` returns every unmet id, never the first one: a need whose target is absent **and** a
need whose target is `checked: false` are both included, in the source item's `needs` order.

- **Purity:** `needsOf`, `railEdges` and `unmetNeeds` read only their arguments: no clock,
  network, filesystem, environment or DOM. The parser remains pure; the daemon's git read is
  the existing `readSnapshot` and is unchanged.
- **Errors:** none of the new functions throws for a well-typed input; `needsOf` tolerates any
  string. The route keeps its existing codes and statuses (`200`, `401`, `404 not_found`); this
  task adds no HTTP code, no SSE event and no log line.

### `apps/app/src/app/features/backlog/repo-backlog.page.ts`

The component keeps every current public member and adds:

```ts
readonly rows = computed<readonly BacklogItem[]>(...);
readonly selectedRef = signal<BacklogRef | null>(null);
readonly selected = computed<BacklogItem | null>(...); // resolved from selectedRef against rows()
readonly rail = computed<readonly RailEdge[]>(...);

select(item: BacklogItem): void;        // sets selectedRef to item.ref
unmetOf(item: BacklogItem): readonly BacklogRef[]; // unmetNeeds(item, this.rows())
```

DOM hooks that QA asserts (exact `data-testid` / attributes; do not rename them):

- `backlog-row` — the existing `<li>`, now also carries
  `[attr.data-needs]="item.needs.join(' ')"` and
  `[attr.data-unmet-needs]="unmetOf(item).join(' ')"`. Both attributes are present on every
  row and are `''` when the list is empty.
- `backlog-row-select` — a `button[type="button"]` inside the row, wrapping the existing
  `backlog-row-ref` and `backlog-row-title` spans, `(click)="select(item)"`,
  `[attr.aria-pressed]="selectedRef() === item.ref"`. It is not a per-agent control and does
  not replace the existing Run button.
- `backlog-row-needs` — visible only when `item.needs.length > 0`; text is
  `t('backlog.needs') + ': ' + item.needs.join(', ')`.
- `backlog-row-unmet-needs` — visible only when `unmetOf(item).length > 0`; text is
  `t('backlog.unmet') + ': ' + unmetOf(item).join(', ')` and contains every unmet id.
- `backlog-rail` — the rail `<section>`; `[attr.data-edges]="rail().length"`.
- `backlog-rail-empty` — shown when `rail().length === 0`.
- `backlog-rail-edge` — one `<li>` per edge, with `[attr.data-from]="edge.from"`,
  `[attr.data-to]="edge.to"`, `[attr.data-kind]="edge.kind"`, and the visible text
  `from → to` plus `t('backlog.rail.' + edge.kind)`.
- `backlog-detail` — the detail panel, always rendered; before a selection it contains
  `backlog-detail-empty`.
- After a selection: `backlog-detail-ref`, `backlog-detail-title`, `backlog-detail-needs`
  (comma-separated needs or `t('backlog.detail.none')`), `backlog-detail-unmet`
  (comma-separated unmet needs or `t('backlog.detail.none')`), and
  `backlog-detail-work` (a `routerLink` to `/works/{item.work.id}`) only when `item.work` is
  not null.

Layout: the rail and the detail panel are one column at 320 px and stack after the list; at
`@media (min-width: 900px)` the page body is a two-column grid with the list first and the rail
second. The rail is a semantic list of text edges, never an SVG, canvas or absolutely
positioned drawing that can push the page wider than the viewport.

### `i18n.ts`

Add these keys to **both** `STRINGS.en` and `STRINGS.es` (English / Spanish copy is the dev's
choice, but every key must exist in both):

`backlog.rail`, `backlog.rail.empty`, `backlog.rail.chain`, `backlog.rail.branch`,
`backlog.rail.external`, `backlog.detail`, `backlog.detail.empty`, `backlog.detail.none`,
`backlog.detail.open`, `backlog.needs`, `backlog.unmet`.

### `docs/api.md` §5.6

Add `"needs": ["Task-34"]` to the backlog item in the JSON example (between `line` and `work`)
and one bullet to the prose:

- `needs` — the `Task-NN` refs named by the item's `*Dependencies:*` sentence, in file order,
  deduplicated and with the item's own ref removed; `[]` when the sentence says `none`, is
  absent, or names no task. A `Task-A to Task-B` range expands inclusively. The daemon derives
  it from the file on every read (D51) and never stores it. A ref is **unmet** when the same
  payload has no item for it or that item is `checked: false`.

The route table, the `POST /v1/works` rules and §5.6.1 are unchanged.

### Data

- `needs` — `BacklogRef[]`, default `[]`, never null, first-appearance order, self excluded,
  ranges expanded. One owner: the file's `*Dependencies:*` sentence; the row is a projection.
- `data-needs` / `data-unmet-needs` — space-separated refs; `''` when none; a space is the
  only separator, so a ref never contains one.
- `data-kind` — exactly `chain`, `branch` or `external`, with the precedence above.
- `data-edges` — the number of edges, equal to the sum of every item's `needs.length`.

## 🧩 Configuration

None. This task adds or reads no `CB_*` key and does not touch `docs/providers.md`.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. The full gate for the Dev and QA is exactly:

```
npm ci --prefer-offline --no-audit --no-fund
npm run lint
npm test
npm run build
```

No Playwright run exists for this task: the repository has no `playwright.config.*` and this
runner has no browser. The `[live]` criterion below is measured on a browser and reported
through `scripts/agent/issue.mjs`, never claimed as passing here.

Targeted commands while implementing:

- `npx vitest run --project packages/backlog`
- `npx vitest run --project packages/contracts`
- `npx vitest run --project apps/daemon`
- `npm test -w @codebox/app`
- `git diff --name-only main...task-78` — audit against the exclusive paths.

**Acceptance criteria:**

- [ ] **`[unit]`** `npx vitest run --project packages/backlog` passes. `dependencies.test.ts`
  pins: `Task-75.` → `['Task-75']`; `none` (including `none (Task-40 supplies the AMI later)`)
  → `[]`; a missing marker → `[]`; a self-ref is removed; duplicates collapse in first-appearance
  order; `*Acceptance:* Task-99` after the dependency sentence contributes nothing;
  `Task-51 to Task-53` → `Task-51`, `Task-52`, `Task-53`; `Task-01 to Task-03` keeps the
  two-digit padding. `parse.test.ts` proves `parseBacklog` attaches `needs` to the entry, and
  `live-todo.test.ts` proves the real `TODO.md` parses, every item has a `needs` array, no item
  needs itself, and at least one item has a non-empty list.
- [ ] **`[unit]`** `npx vitest run --project packages/contracts` passes. `works.test.ts` proves
  the backlog round-trip includes `needs`, a payload without the key parses to `[]`, a valid
  `Task-NN` is accepted, and a bad ref, `null`, a string or an unknown key is refused.
  `openapi.test.ts` is unmodified and still pins exactly **63** paths; `openapi.ts` is
  unmodified and the `Backlog` component schema changes only through `backlogSchema`.
- [ ] **`[unit]`** `npx vitest run --project apps/daemon` passes. `service.test.ts` projects an
  inline two-item markdown, asserts the dependent item's `needs` is `['Task-01']` and the root's
  is `[]`. `routes.test.ts` gets a dependency line in its `MARKDOWN` and asserts the HTTP
  `Backlog` body carries the same `needs` on the item.
- [ ] **`[unit]`** `npm test -w @codebox/app` passes. `dependency-rail.spec.ts` proves one edge
  per need and none for a root: a four-item fixture yields exactly
  `Task-02→Task-01` (`chain`), `Task-03→Task-01` (`branch`), `Task-03→Task-02` (`branch`) and
  `Task-04→Task-99` (`external`), and no edge has `from = Task-01`. `repo-backlog.page.spec.ts`
  mounts the same fixture, asserts four `backlog-rail-edge` elements, a root row with no edge,
  a blocked row whose `data-unmet-needs` is exactly `"Task-01 Task-99"` and whose
  `backlog-row-unmet-needs` text contains both ids, and that selecting the row fills
  `backlog-detail-ref`/`-title`/`-needs`/`-unmet`. The same spec asserts `STRINGS.en` and
  `STRINGS.es` have the same keys and the eleven new keys exist. `backlog.api.spec.ts` and
  `backlog.store.spec.ts` keep their `BACKLOG` fixtures type-correct with `needs: []` and still
  pass their existing assertions.
- [ ] **`[unit]`** `npm run lint`, `npm test` and `npm run build` pass.
- [ ] **`[unit]`** `git diff --name-only main...task-78` lists only the exclusive paths above;
  `packages/contracts/src/openapi.ts`, `packages/contracts/src/openapi.test.ts`,
  `packages/contracts/src/index.ts`, `TODO.md` and `CHANGELOG.md` are untouched.
- [ ] **`[live]`** At **320 px** in Chromium, a backlog of **8 rows** with one dependency each
  stays legible with no horizontal scroll: `document.documentElement.scrollWidth <= 320`, every
  `[data-testid="backlog-rail-edge"]` has `getBoundingClientRect().right <= 320`, and every
  `[data-testid="backlog-row-select"]` is at least 44 × 44 CSS px. **Measurement:** a browser at
  320 px, no screenshot comparison; report **not run** on this runner (no browser, no
  `playwright.config.*`) and hand it to `scripts/agent/issue.mjs` as
  `--label agent-review --title 'Task-78 [live] 320 px dependency rail' --body-file -`.

## 📣 Coordination

- **For the Orchestrator:** this task holds the hot file `packages/contracts/src/index.ts` and
  leaves it unchanged. It also owns `docs/api.md` §5.6 and the `features/backlog/**` block of
  `apps/app/README.md`. It adds no route, so the pinned OpenAPI path count stays 63.
- **For Task-80 (same batch):** do not touch `packages/contracts/**`, `packages/backlog/**`,
  `apps/daemon/**`, `apps/app/src/app/features/backlog/**`, `docs/api.md` or the
  `features/backlog/**` lines of `apps/app/README.md`. Task-80 owns the `features/works/**` and
  `src/theme/**` lines of that README; neither task edits the other's block.
- **For the next batch:** `BacklogItem.needs` is on the wire, defaults to `[]` for an older
  daemon payload, and is derived from `TODO.md`; the app draws edges locally and adds no
  dependency on `@codebox/backlog`. Any future consumer may read `needs` without a new route.
- **Assumption frozen here:** the wire has `checked`, not the `[!]` mark, so “a blocked row”
  means a row with at least one unmet need; the task does not add a backlog `state` key.

## ⛔ Out of scope

- No new dependency. The app must not import `@codebox/backlog`; that workspace is not an app
  dependency and adding it would touch `package.json`/`package-lock.json`.
- No edit to `packages/contracts/src/openapi.ts` or `openapi.test.ts`, no new route, no OpenAPI
  path-count change, no hand-edited generated file.
- No edit to `packages/contracts/src/index.ts` beyond the hold described above.
- No change to `workSchema`, `backlogWorkRefSchema`, the selection rule, `applyTick`, sessions,
  schedules or events.
- No new `CB_*` key, no `docs/providers.md`, `docs/decisions.md`, `opencode.json`,
  `.agent_roles/**`, `scripts/agent/**` or `CHANGELOG.md` change.
- No mutation of `TODO.md`; the Orchestrator ticks the item at merge time.
- No graph library, SVG, canvas or absolute-positioned rail that can overflow; no redesign of
  the existing backlog row beyond the select button, the needs chips, the rail and the detail
  panel.

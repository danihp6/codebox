# Spec: Task-71 — Backlog package and selection

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (pure logic). No I/O, no clock, no environment, no network.
- **Role:** Dev.
- **Objective:** a new npm workspace `@codebox/backlog` exists and owns the repository's backlog
  file as data: it turns `TODO.md` markdown into ordered items with a stable ref, a line number,
  a checkbox state and their raw text (`parseBacklog`); it rewrites exactly one checkbox and
  nothing else (`applyTick`); and it picks the next item a schedule may work on
  (`selectNextItem`, D56/§16). After this task the daemon can list, tick and select without a
  second parser, and Task-72 is written against these three names.
- **Environment:** worktree `../wt-cb-71`, branch `task-71`, base `main`.
- **Dependencies:** **Task-70 (merged, `c58d8be`)**. It produced the types this package imports
  type-only — `BacklogRef`, `WorkState` and `Selection` in
  `packages/contracts/src/primitives.ts` (exported from `packages/contracts/src/index.ts`) — and
  the `works` table whose `attempts`/`state` columns the selection reads
  (`packages/store/migrations/0006_works.sql`).

**Ownership note for the batch:** this task is the **hot-file holder for
`package-lock.json`**. No other task in this batch writes it. `vitest.config.ts` is also this
task's alone even though it is not on the hot-file list.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `packages/backlog/package.json` (new)
- `packages/backlog/tsconfig.json` (new)
- `packages/backlog/README.md` (new)
- `packages/backlog/src/index.ts` (new)
- `packages/backlog/src/types.ts` (new)
- `packages/backlog/src/parse.ts` (new)
- `packages/backlog/src/parse.test.ts` (new)
- `packages/backlog/src/tick.ts` (new)
- `packages/backlog/src/tick.test.ts` (new)
- `packages/backlog/src/select.ts` (new)
- `packages/backlog/src/select.test.ts` (new)
- `packages/backlog/src/live-todo.test.ts` (new)
- `packages/backlog/src/fixtures/todo.md` (new)
- `vitest.config.ts` — add the `packages/backlog` project, nothing else.
- `package-lock.json` — **hot file, this task is the holder**: the minimum
  `npm install --package-lock-only` produces for the new workspace.
- `docs/jobs.md` — **§16 only** (the parent section, before `### 16.1`). No other section.
- `docs/architecture.md` — **§5 only**, one row of the package-boundary block.

`docs/jobs.md` §16 is held by this task only; `docs/providers.md` §5.1 belongs to Task-73 and is
**not** yours. Do not touch `packages/contracts/**`, `package.json`, `tsconfig.base.json`,
`apps/daemon/**`, `apps/app/**`, `TODO.md`, `CHANGELOG.md`, `docs/decisions.md`, or any generated
API file.

### Inputs (read-only)

- `AGENTS.md`
- `docs/jobs.md` (§16 — the selection rule you implement)
- `docs/architecture.md` (§5 — the package-boundary table you add a row to)
- `TODO.md` (the live file; read by `src/live-todo.test.ts`)
- `packages/contracts/src/primitives.ts` (`backlogRefSchema`, `WORK_STATES`, `SELECTIONS`)
- `packages/contracts/src/works.ts` (`backlogItemSchema`, `backlogSectionSchema`, `backlogSchema`)
- `packages/store/migrations/0006_works.sql` (`works.attempts`, `works.state`, the partial unique
  index `works_live_item`)
- `packages/scheduler/package.json`, `packages/scheduler/tsconfig.json`,
  `packages/scheduler/README.md` (the shape a package in this repo has)
- `apps/daemon/package.json` (the `prebuild` precedent this package copies)
- `vitest.config.ts`

## 🔒 Contract

The public surface other tasks are written against **right now**. Exact exported names,
signatures and types. Task-72 imports exactly these and nothing else from this package.

```ts
// packages/backlog/src/types.ts
import type { BacklogRef, Selection, WorkState } from '@codebox/contracts';

/** The four checkbox marks `TODO.md` uses: `[ ]`, `[~]`, `[!]`, `[x]`. */
export type BacklogEntryState = 'open' | 'doing' | 'blocked' | 'done';

export interface BacklogEntry {
  /** The item key, `Task-<digits>`, the same grammar as `backlogRefSchema`. */
  readonly ref: BacklogRef;
  /** The text after `**[Task-NN]**` on the item line, trimmed; falls back to the ref. */
  readonly title: string;
  /** `title` followed by the item's continuation lines, trimmed, joined with `"\n"`. */
  readonly body: string;
  readonly state: BacklogEntryState;
  /** `state === 'done'`. Convenience for `backlogItemSchema.checked`. */
  readonly checked: boolean;
  /** 1-based line number of the item line in the markdown that produced it. */
  readonly line: number;
  /** The nearest preceding `## ` heading, trimmed; `''` before the first one. */
  readonly section: string;
}

export interface BacklogSection {
  readonly title: string;
  readonly items: readonly BacklogEntry[];
}

export interface ParsedBacklog {
  /** Every `## ` heading in document order, including ones with no items. */
  readonly sections: readonly BacklogSection[];
  /** Every item line in file order, flat. This is the order the selection walks. */
  readonly items: readonly BacklogEntry[];
  /** Refs that appear on more than one item line, first-appearance order, no repeats. */
  readonly duplicateRefs: readonly BacklogRef[];
}

export type TickOutcome =
  | { readonly kind: 'ticked'; readonly markdown: string; readonly line: number }
  | { readonly kind: 'already_done'; readonly markdown: string; readonly line: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous'; readonly lines: readonly number[] };

/** One row of the `works` table, as much of it as the selection needs. */
export interface BacklogWorkState {
  readonly ref: BacklogRef;
  readonly state: WorkState;
  readonly attempts: number;
}

export interface SelectionPolicy {
  /** `nextPending` takes any eligible item; `refs` restricts to `refs` and still walks file order. */
  readonly selection: Selection;
  readonly refs: readonly BacklogRef[];
  /** The schedule's `maxAttempts`, D56. */
  readonly maxAttempts: number;
}

export type SelectionRefusal =
  | 'blocked'
  | 'needs_decision'
  | 'live_work'
  | 'attempts_exhausted'
  | 'ambiguous_ref';

export interface RefusedItem {
  readonly ref: BacklogRef;
  readonly line: number;
  readonly reason: SelectionRefusal;
}

export type SelectionResult =
  | { readonly kind: 'selected'; readonly item: BacklogEntry }
  | { readonly kind: 'nothing_pending' }
  | { readonly kind: 'nothing_runnable'; readonly refused: readonly RefusedItem[] };
```

```ts
// packages/backlog/src/parse.ts
/** The ref grammar, byte-identical to `backlogRefSchema` in `@codebox/contracts`. */
export const BACKLOG_REF_PATTERN: RegExp;

export function parseBacklog(markdown: string): ParsedBacklog;
```

```ts
// packages/backlog/src/tick.ts
export function applyTick(markdown: string, ref: BacklogRef): TickOutcome;
```

```ts
// packages/backlog/src/select.ts
export function selectNextItem(
  items: readonly BacklogEntry[],
  works: readonly BacklogWorkState[],
  policy: SelectionPolicy,
): SelectionResult;
```

```ts
// packages/backlog/src/index.ts — the only entry point
export { parseBacklog, BACKLOG_REF_PATTERN } from './parse.js';
export { applyTick } from './tick.js';
export { selectNextItem } from './select.js';
export type {
  BacklogEntry,
  BacklogEntryState,
  BacklogSection,
  BacklogWorkState,
  ParsedBacklog,
  RefusedItem,
  SelectionPolicy,
  SelectionRefusal,
  SelectionResult,
  TickOutcome,
} from './types.js';
```

- **Errors:** none of the three functions throws for any input string. A malformed, empty or
  truncated markdown argument yields an empty or partial `ParsedBacklog`; it never throws and
  never panics on an index.
- **Purity:** no `node:fs`, `node:process`, `Date`, timers, network or `random` in `src/`
  **except** the one `node:fs` read in `src/live-todo.test.ts` (a test file is not part of the
  package's exported behaviour). No `Date.now()` anywhere in `src/`: the selection is a pure
  function of its three arguments.
- **Ordering:** `parseBacklog` guarantees document order for both `sections` and `items`;
  `selectNextItem` walks `items` in the order it is given and selects the first eligible one.
- **Imports:** from `@codebox/contracts` **type-only** (`import type`). Do not value-import the
  package: `npm test` runs before `npm run build`, so `@codebox/contracts` has no `dist/` at test
  time, and `packages/backlog` sorts before `packages/contracts` in the workspace build. This is
  the same rule `packages/scheduler/README.md` documents. Consequently the ref grammar is a local
  `RegExp` whose accepted and rejected refs are pinned in `parse.test.ts`.
- **Package scripts:** `"prebuild": "npm run build -w @codebox/contracts"` (then `"build":
  "tsc -p tsconfig.json"` and `"typecheck": "tsc -p tsconfig.json --noEmit"`, and **no** `test`
  script). The `prebuild` is what makes `npm run build` order-independent: the root build walks
  the workspaces and, if it reaches `packages/backlog` before `packages/contracts`, the type-only
  import still needs `contracts/dist/index.d.ts`. `apps/daemon/package.json` uses the same hook
  for the same reason. `tsconfig.json` copies `packages/scheduler/tsconfig.json` verbatim except
  for nothing — it is identical (`extends ../../tsconfig.base.json`, `rootDir: "src"`,
  `outDir: "dist"`, `include: ["src/**/*.ts"]`, `exclude: ["src/**/*.test.ts", "dist"]`).

### Frozen behaviour

**`parseBacklog(markdown)`**

1. Split the input on `"\n"`. A line's *match text* is the line with one trailing `"\r"`
   removed; the original bytes are what `applyTick` preserves.
2. A **section heading** is a line matching `/^## (?!#)(.*)$/`; its title is the capture
   trimmed. Every heading opens a new section, in order, even if it holds no items. Items that
   appear before the first heading keep `section: ''` and belong to `items` only — no synthetic
   section is created for them.
3. An **item line** matches `/^- \[([ x~!])\] \*\*(Task-\d+)\*\*[ \t]*(.*)$/` against the match
   text. The checkbox character maps to `state`: `' '` → `open`, `'~'` → `doing`, `'!'` →
   `blocked`, `'x'` → `done`.
4. An item's **block** is its item line plus every following line that is blank or starts with
   two or more spaces, until the first line that is a new item line, a `## ` heading, or a
   non-blank line with less than two leading spaces.
5. `title` is the text after `**[Task-NN]**` on the item line, trimmed. If it is empty the title
   falls back to the ref itself (`"Task-90"`), so no item line is ever dropped.
6. `body` is `title` followed by each non-blank continuation line with its leading whitespace
   removed, trimmed at the end, joined with `"\n"`. A single-line item therefore has
   `body === title`.
7. `line` is the 1-based line number of the item line in the argument.
8. `duplicateRefs` lists, in first-appearance order and without repeats, every ref that appears
   on two or more item lines.
9. Every other line — prose, a bullet without a ref, a table, `---`, `- [ ] **[Task-XX]` with a
   non-numeric suffix, `**Design-01**`, `L1` — is ignored silently.

**`applyTick(markdown, ref)`**

1. Find the item lines with the same pattern as above. No match → `{ kind: 'missing' }`.
2. More than one match → `{ kind: 'ambiguous', lines }` with the 1-based line numbers **in
   ascending order**.
3. One match already `done` → `{ kind: 'already_done', markdown, line }` with the argument
   returned unchanged (same string).
4. Otherwise rewrite **only the checkbox character** of that one line to `x` (`[ ]`→`[x]`,
   `[~]`→`[x]`, `[!]`→`[x]`) and return `{ kind: 'ticked', markdown, line }`. The rest of the
   file is byte-identical: same line count, same line endings (a `"\r"` stays), same trailing
   whitespace, no reindent, no reflow, no trailing newline added or removed.

**`selectNextItem(items, works, policy)`**

1. **Candidates** are the entries whose `state` is `open` or `blocked` and, when
   `policy.selection === 'refs'`, whose `ref` is in `policy.refs`. `done` and `doing` items are
   never candidates.
2. No candidate → `{ kind: 'nothing_pending' }`.
3. Walk the candidates in the order given and refuse each one for the **first** applicable
   reason, in this order:
   - `ambiguous_ref` — the ref appears on more than one entry in `items`;
   - `blocked` — the entry's `state` is `blocked` (`[!]`);
   - `needs_decision` — the ref has a work whose `state` is `needs_decision`;
   - `live_work` — the ref has a work whose `state` is `queued` or `running`;
   - `attempts_exhausted` — the highest `attempts` among the ref's works is
     `>= policy.maxAttempts`.
   A ref with no work row is never refused by the last three rules.
4. The first candidate that is not refused is `{ kind: 'selected', item }`.
5. If every candidate was refused → `{ kind: 'nothing_runnable', refused }` with the refusals in
   file order, one entry per refused candidate.

`policy.maxAttempts` is the schedule's cap and the only cap consulted; a work row's own
`maxAttempts` is seeded from it at creation and is deliberately not read here.

### Data

Keys, shapes, units and defaults this task introduces:

| Name | Shape | Default | Note |
| --- | --- | --- | --- |
| `BacklogEntry.state` | `'open' \| 'doing' \| 'blocked' \| 'done'` | — | from the checkbox mark |
| `BacklogEntry.line` | positive integer, 1-based | — | of the item line |
| `BacklogEntry.section` | string, `''` when before the first `## ` | `''` | heading text, trimmed |
| `BacklogEntry.body` | string | equals `title` for a single-line item | the prompt seed for Task-72 |
| `ParsedBacklog.duplicateRefs` | `BacklogRef[]`, no repeats | `[]` | |
| `SelectionPolicy.maxAttempts` | integer ≥ 1 | none — the caller passes it | `repoScheduleSchema.maxAttempts` |
| `SelectionRefusal` | the five literals above | — | one per refused candidate |

The item shape deliberately does **not** carry the joined `work`: `backlogItemSchema` in
`packages/contracts` already owns `{ref, title, checked, line, work}` and the join happens where
the works are known (Task-72). `backlogSchema` (with `repoId`, `revision`, `path`) is likewise a
projection Task-72 builds; this package never invents it.

**The `docs/jobs.md` §16 edit, exactly — one paragraph, appended after the paragraph that ends
"…and opens a run of that item with the item as the prompt." and before `### 16.1`.** It says, in
prose, only these facts:

- `@codebox/backlog` owns the file: `parseBacklog` reads it, `applyTick` rewrites one checkbox,
  `selectNextItem` decides what a fire takes. The daemon never re-implements either.
- An item is `{ ref, title, body, line, state, section }`; `body` is the title plus the item's
  continuation lines and it is the only prompt seed a fire has.
- Only `[ ]` is selectable. `[x]` and `[~]` are not pending; `[!]` is *reported* as a refusal
  (`blocked`), never silently skipped.
- The refusals are `ambiguous_ref`, `blocked`, `needs_decision`, `live_work` and
  `attempts_exhausted`; the result is `nothing_pending` when there is no pending candidate at all
  and `nothing_runnable` when every candidate was refused — the two codes §16.3 already names.
- The attempts cap is the schedule's `maxAttempts`, measured against the highest `attempts` among
  the ref's works; a work row's own `maxAttempts` is not consulted.
- A tick changes exactly one checkbox character and leaves every other byte of the file alone, so
  the merge carries one line.

## 🧩 Configuration

None. This task adds no `CB_*` key, reads no environment and touches no config schema.

## 🧪 Test and Validation Plan (for QA)

Run from the task worktree, in this order.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` — must exit 0. On the base commit this same
    command fails with `EUSAGE ... Missing: @codebox/backlog@0.0.0 from lock file`, so a green
    run proves the lockfile change is complete.
  - `npm run lint` — must pass.
  - `npm test` — the whole gate: `test:guard`, the app suite and every Vitest project, including
    `packages/backlog`.
  - `npx vitest run --project packages/backlog` — this package alone.
  - `npm run build` — `tsc -b`-style workspace build; must produce `packages/backlog/dist/index.js`
    and `packages/backlog/dist/index.d.ts`.
  - `git diff --name-only main...task-71 | sort` — the scope audit.

- **Acceptance criteria:**
  - [ ] `[unit]` `npm ci && npm run lint && npm test && npm run build` all exit 0, and
    `npm run test:guard` exits 0 with no line mentioning `packages/backlog`. The guard inspects
    only workspaces that declare a `test` script; this one must not, because the gate does not
    invoke it with `-w @codebox/backlog` and the guard would then report
    `has a test script but the gate does not run it`.
  - [ ] `[unit]` `npx vitest run --project packages/backlog` reports four test files
    (`parse`, `tick`, `select`, `live-todo`) and zero failures, and the project is listed in
    `vitest.config.ts` as `project('packages/backlog')`.
  - [ ] `[unit]` `parse.test.ts` loads `src/fixtures/todo.md` — which QA compares to the block
    below, byte for byte, trailing newline included — and asserts, for it: 7 items in file order
    with refs
    `Task-90, Task-01, Task-02, Task-03, Task-04, Task-05, Task-05`; lines `5, 9, 11, 14, 15,
    20, 21`; states `open, done, open, doing, blocked, open, open`; three sections titled
    `Batch 0 — Alpha` (4 items), `Batch 1 — Beta` (2 items), `Empty section` (0 items);
    `duplicateRefs === ['Task-05']`; `Task-90` has `section === ''` and `body === 'Task-90'`;
    `Task-02.body === 'Open item.\nBody line one.\nBody line two.'`;
    `Task-01.body === 'Done item. *Paths:* \`a.ts\`.\n*Dependencies:* none.'`;
    `Design-01`, the plain bullet, the prose line and the `# Fixture backlog` title produce no
    item.
  - [ ] `[unit]` `tick.test.ts` asserts against that fixture: `applyTick(md, 'Task-02')` is
    `kind: 'ticked'`, `line: 11`, and splitting the result and the input on `"\n"` differs at
    exactly the index `10` (line 11) with only that element changed; `applyTick(md, 'Task-01')`
    is `kind: 'already_done'` with `markdown === md`; `applyTick(md, 'Task-99')` is
    `kind: 'missing'`; `applyTick(md, 'Task-05')` is `kind: 'ambiguous'` with
    `lines: [20, 21]`; ticking a file whose item line ends in `"\r\n"` keeps the `"\r"`.
  - [ ] `[unit]` `select.test.ts` asserts, with the fixture items and `maxAttempts: 2`:
    `works: []` + `selection: 'nextPending'` → `selected` `Task-90`;
    `refs: ['Task-02', 'Task-04']` → `selected` `Task-02`;
    `refs: ['Task-04']` → `nothing_runnable` with `[{ref: 'Task-04', reason: 'blocked'}]`;
    `refs: ['Task-02']` + `{ref: 'Task-02', state: 'needs_decision', attempts: 1}` →
    `nothing_runnable` reason `needs_decision`;
    `refs: ['Task-02']` + `{state: 'running', attempts: 0}` → `live_work`;
    `refs: ['Task-02']` + `{state: 'queued', attempts: 0}` → `live_work`;
    `refs: ['Task-02']` + `{state: 'failed', attempts: 2}` → `attempts_exhausted`;
    `refs: ['Task-02']` + `{state: 'failed', attempts: 1}` → `selected` `Task-02`;
    `refs: ['Task-05']` → `nothing_runnable` with two `ambiguous_ref` refusals (both `Task-05`
    entries), in file order;
    `refs: ['Task-99']` → `nothing_pending`;
    `refs: ['Task-05', 'Task-02']` → `selected` `Task-02`, proving `refs` restricts but never
    reorders.
  - [ ] `[unit]` `live-todo.test.ts` reads the repository's real `TODO.md` through
    `readFileSync(fileURLToPath(new URL('../../../TODO.md', import.meta.url)), 'utf8')` and
    asserts structural invariants only — **no counts, no line numbers, no titles**:
    (a) the number of items equals the number of lines matching
    `/^- \[([ x~!])\] \*\*Task-\d+\*\*/`; (b) `duplicateRefs` is empty; (c) every item's
    `section` is a non-empty string; (d) every item's `body` starts with its `title`;
    (e) every item's `line` points at a line of the file that matches the item pattern for that
    same ref; (f) `applyTick(live, firstOpen.ref)` — the first item whose `state` is not `done` —
    returns a markdown whose only differing line is that item's line, and
    `applyTick(live, 'Task-9999')` is `missing`.
  - [ ] `[unit]` build order is independent of the workspace walk:
    `rm -rf packages/contracts/dist && npm run build` exits 0 and leaves both
    `packages/contracts/dist/index.d.ts` and `packages/backlog/dist/index.d.ts` on disk (the
    `prebuild` hook, not luck, is what makes this pass).
  - [ ] `[unit]` `git diff --name-only main...task-71 | sort` prints exactly this list and
    nothing else:
    `docs/architecture.md`, `docs/jobs.md`, `package-lock.json`, `packages/backlog/README.md`,
    `packages/backlog/package.json`, `packages/backlog/src/fixtures/todo.md`,
    `packages/backlog/src/index.ts`, `packages/backlog/src/live-todo.test.ts`,
    `packages/backlog/src/parse.test.ts`, `packages/backlog/src/parse.ts`,
    `packages/backlog/src/select.test.ts`, `packages/backlog/src/select.ts`,
    `packages/backlog/src/tick.test.ts`, `packages/backlog/src/tick.ts`,
    `packages/backlog/src/types.ts`, `packages/backlog/tsconfig.json`, `vitest.config.ts`.
  - [ ] `[unit]` the lockfile diff is minimal:
    `git diff main...task-71 -- package-lock.json | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -v backlog`
    prints nothing, and `git diff main...task-71 -- package-lock.json | grep -c '^+'` is small
    (the `node_modules/@codebox/backlog` link plus the workspace's own entry) — no dependency
    version anywhere changed.
  - [ ] `[unit]` `git diff main...task-71 -- docs/jobs.md` touches only §16 (every hunk lies
    between the `## 16. Schedules (D56, D46)` heading and the `### 16.1` heading) and
    `git diff main...task-71 -- docs/architecture.md` changes exactly one line inside the §5
    package-boundary block: a new row whose left column is `packages/backlog` and whose right
    column is `contracts only; pure; no I/O`, aligned with its neighbours.
  - [ ] `[unit]` `packages/backlog/package.json` has no `test` script and no `dependencies`
    block (the neighbours `packages/scheduler` and `packages/store` declare neither), its
    `exports` map is `{".": {"types": "./dist/index.d.ts", "default": "./dist/index.js"}}`, and
    its `prebuild` is `npm run build -w @codebox/contracts`; `packages/backlog/tsconfig.json` is
    identical to `packages/scheduler/tsconfig.json`.
  - [ ] `[live]` **none.** This task has no runtime surface: nothing it ships can be observed on
    a running box that the `[unit]` criteria above do not already prove. QA reports no
    measurement issue for this task.

The fixture to check in, `packages/backlog/src/fixtures/todo.md`, byte for byte (the note in
parentheses is **not** part of the file; the file starts at `# Fixture backlog` and ends with a
single trailing newline after `## Empty section`):

```markdown
# Fixture backlog

Prose that is not an item.
- a plain bullet with no ref
- [ ] **[Task-90]**

## Batch 0 — Alpha

- [x] **[Task-01]** Done item. *Paths:* `a.ts`.
      *Dependencies:* none.
- [ ] **[Task-02]** Open item.
      Body line one.
      Body line two.
- [~] **[Task-03]** In progress.
- [!] **[Task-04]** Blocked item.

## Batch 1 — Beta

- [ ] **Design-01** A design bullet without a task ref.
- [ ] **[Task-05]** Another open item.
- [ ] **[Task-05]** A duplicate ref.

## Empty section
```

## 📣 Coordination

- **For Task-72 (next batch):** import `parseBacklog`, `applyTick` and `selectNextItem` from
  `@codebox/backlog`. **`parseBacklog` collides by name** with `@codebox/contracts`'s
  `parseBacklog(input: unknown): Backlog`; a file that needs both must alias one of them
  (`import { parseBacklog as parseBacklogDocument } from '@codebox/contracts'`).
- **For Task-72:** the package returns entries, not the API object. Build
  `backlogSchema`/`backlogItemSchema` from `ParsedBacklog.sections` plus
  `store.works.list({repoId})`; `checked` comes from `BacklogEntry.checked`, `line` from
  `BacklogEntry.line`, and `work` is the join.
- **For Task-72:** `selectNextItem` has already decided everything §16 decides. Do not re-filter
  the items in the daemon: map `nothing_pending`/`nothing_runnable` straight onto the fire row's
  outcome of the same name (`docs/jobs.md` §16.3).
- **For Task-72:** a tick is `applyTick(markdown, ref)` on the markdown read from
  `origin/main`, written back into the run's branch; `already_done` is a no-op success, `missing`
  and `ambiguous` are a `backlog_unavailable` fire failure.
- **For the Architect / next docs pass:** `docs/architecture.md` §5 gains one row here; the
  longer per-package prose sections in `docs/architecture.md` still have no `packages/backlog`
  entry — that is deliberate and belongs to the docs task, not to this one.
- **For QA:** `packages/backlog` deliberately has **no `test` script**, exactly like
  `packages/scheduler` and `packages/store`; its tests run through the Vitest project. A `test`
  script would make the root `test:guard` demand a second wiring for it.

## ⛔ Out of scope

- No file reads, no git, no globbing, no `TODO.md` writing in `src/`: the markdown arrives as a
  string. The one `readFileSync` lives in `src/live-todo.test.ts`.
- No parse of `*Paths:*`, `*Dependencies:*`, `BLOCKED:` prose, `L<n>` items, tables or fenced
  blocks: only the item line, its continuation block and `## ` headings are structure.
- No projection to `backlogSchema`, no `work` join, no `receipt`/`revision`/`path` fields.
- No HTTP, no store, no daemon code, no app code.
- No change to `docs/jobs.md` outside §16, and none at all to `docs/providers.md`,
  `docs/api.md`, `docs/decisions.md` or `AGENTS.md`.
- No new npm dependency, no change to any other workspace's `package.json`, no edit to
  `tsconfig.base.json` or the root `package.json`.
- No reformatting of `TODO.md`, and no "improvement" of its prose.

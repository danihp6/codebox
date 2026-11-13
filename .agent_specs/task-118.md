# Spec: Task-118 — The run-event page gets a contract owner

> The spec is the subagent's entire world. Anything not written here does not exist.

## 🎯 Scope

- **Task type:** package (`packages/contracts`) + daemon (`apps/daemon/src/runs`) + app
  (`apps/app/src/app/core/api`) + docs. A seam refactor: no new route, no new page, no new
  frame, no new dependency, no migration.
- **Role:** Dev.
- **Objective:** `GET /v1/runs/{id}/events` has exactly one owner. `packages/contracts`
  declares the record and its page (`runEventRecordSchema`, `runEventPageSchema`,
  `RunEventRecord`, `RunEventPage`, `parseRunEventPage`, boundary `run.events`); the daemon's
  route and service consume them and delete their local shapes; the app's `ApiClient` deletes
  its local copy and parses with the contract; `openapi.ts` registers both components and
  points `listRunEvents` at the event page instead of `Page`; `docs/api.md` §5.4 names the
  owner. After this task no file under `packages/contracts/src`, `apps/daemon/src` or
  `apps/app/src` declares the run-event record a second time.
- **Environment:** worktree `../wt-cb-118`, branch `task-118`, base `main` at `32eb17b`.
- **Dependencies:** none. Every file this task reads is merged: `packages/contracts`
  (`pageSchema`, `parseOrThrow`, `sseEventNameSchema`, `timestampSchema`) from Task-03;
  `apps/daemon/src/runs/**` and `docs/api.md` §5.4 from Task-15;
  `apps/app/src/app/core/api/api-client.ts` from Task-18; `packages/contracts/src/openapi.ts`
  last held by Task-114. No batch-mate produces any of them.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in
Batch 33 claims the same path.

- `packages/contracts/src/run-events.ts` (new)
- `packages/contracts/src/run-events.test.ts` (new)
- `packages/contracts/src/index.ts` — **hot file, this task is the only holder in the batch**
- `packages/contracts/README.md` — its own two new `src/` lines only
- `packages/contracts/src/openapi.ts`
- `packages/contracts/src/openapi.test.ts`
- `apps/daemon/src/runs/routes.ts`
- `apps/daemon/src/runs/service.ts`
- `apps/daemon/src/runs/routes.test.ts`
- `apps/app/src/app/core/api/api-client.ts`
- `docs/api.md` — **section §5.4 *Runs* only**; no other section changes by one byte

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/api.md` §4 and §5.4 (the page envelope and the documented event page)
- `packages/contracts/src/pagination.ts`, `packages/contracts/src/parse.ts`,
  `packages/contracts/src/primitives.ts`, `packages/contracts/src/events.ts`,
  `packages/contracts/src/credentials.ts` (the house pattern for a resource module)
- `packages/contracts/src/openapi.ts`, `packages/contracts/src/openapi.test.ts`
- `packages/store/src/events.ts` (`EventRecord`, `readRunAfterSeq`)
- `apps/daemon/src/runs/routes.ts`, `apps/daemon/src/runs/service.ts`,
  `apps/daemon/src/runs/routes.test.ts`, `apps/daemon/src/runs/errors.ts`
- `apps/app/src/app/core/api/api-client.ts`, `apps/app/src/app/core/api/api-client.spec.ts`
- `apps/app/tsconfig.spec.json` (the suite resolves contract **sources**, so no build is
  needed before `npm run test:app`)

## 🔒 Contract

The public surface other tasks are written against **right now**. Exact names, signatures and
types. This is what `packages/contracts/src/run-events.ts` must export:

```ts
import { z } from 'zod';
import { pageSchema } from './pagination.js';
import type { Page } from './pagination.js';
import { parseOrThrow } from './parse.js';
import { sseEventNameSchema, timestampSchema } from './primitives.js';

export const runEventRecordSchema = z.strictObject({
  id: z.number().int().positive(),
  seq: z.number().int().min(1).nullable(),
  type: sseEventNameSchema,
  data: z.record(z.string(), z.unknown()),
  ts: timestampSchema,
});
export type RunEventRecord = z.infer<typeof runEventRecordSchema>;

export const runEventPageSchema: z.ZodType<Page<RunEventRecord>> = pageSchema(runEventRecordSchema);
export type RunEventPage = Page<RunEventRecord>;

/** docs/api.md §5.4. `run.events` is the boundary the daemon already reports. */
export function parseRunEventPage(input: unknown): RunEventPage;
```

- **Why these names.** `RunEventRecord` is the stored row as the replay serves it, not an SSE
  event: the SSE `run.*` payloads are `SseEvent`/`SseEventData` in `events.ts` and keep their
  names. `RunEventPage` is the §4 envelope (`Page<T>`), built with the frozen `pageSchema` —
  do not hand-roll a second envelope. `run-events.ts` is a new module because the fact is
  neither a generic page (no record in `pagination.ts`) nor an SSE payload (`events.ts`).
- **Exports from `packages/contracts/src/index.ts`** (its own group, after the `// Events:`
  block, with the comment `// Run events: docs/api.md §5.4.`):
  `runEventRecordSchema`, `runEventPageSchema`, `parseRunEventPage`, and the types
  `RunEventRecord`, `RunEventPage`. No other name is added or removed.
- **Strictness:** all five record keys are required, `seq` may be `null`, an unknown key is a
  failure, `type` is one of the 38 `SSE_EVENT_NAMES`, `ts` is an RFC 3339 UTC timestamp.
- **Errors:** `parseRunEventPage` throws `ContractParseError` (from `parse.ts`, via
  `parseOrThrow`) with `boundary === 'run.events'` and `first.path` =
  `run.events.nextCursor`, `run.events.data.0.type`, `run.events.data.0.<extraKey>`, ….
- **Purity:** `run-events.ts` reads no clock, filesystem, network or environment.
- **Daemon behaviour is unchanged.** The route parses the page it just built, so a row the
  contract refuses is a `ContractParseError` that `handle()` (`apps/daemon/src/runs/errors.ts`)
  maps to **`422 validation_failed`** with `details.path = run.events.<field>`; the success
  answer stays `200`, `Content-Type: application/json; charset=utf-8`, and
  `404 not_found` with `details.path = run.id` for an unknown run (thrown by `requireRun`
  before any read). No log line is added and none changes.
- **Ordering / wire shape:** `{ data: [{ id, seq, type, data, ts }], nextCursor: string | null }`
  in that key order; `nextCursor` is `String(last.id)` when the page is full and `null`
  otherwise — unchanged from today.

### Data

- `id`: positive integer, the event row's id (also the cursor value).
- `seq`: positive integer or `null` (approval and work events carry no run sequence).
- `type`: one of `SSE_EVENT_NAMES` (38 names).
- `data`: a JSON object, opaque to the contract.
- `ts`: RFC 3339 UTC string.
- `nextCursor`: string or `null`.

### OpenAPI

In `packages/contracts/src/openapi.ts`:

- import `runEventRecordSchema` and `runEventPageSchema` from `./run-events.js`;
- the `listRunEvents` `RouteSpec` (`/v1/runs/{id}/events`, `GET`) changes `response: 'Page'`
  to `response: 'RunEventPage'` and nothing else;
- `componentSchemas` gains `RunEventRecord: runEventRecordSchema` and
  `RunEventPage: runEventPageSchema`; **`Page: pageOfRun` stays** because `listRuns` still
  `$ref`s it;
- the path pin in `openapi.test.ts` stays **67** — no path is added.

### The four edited consumers (exact edits)

- `apps/daemon/src/runs/routes.ts`: delete the `eventPageSchema` const and its doc comment
  (`:51-63`); import `parseRunEventPage` from `@codebox/contracts` and drop `sseEventNameSchema`
  and `timestampSchema` from the import list; the handler becomes
  `json(c, parseRunEventPage(runs.events(c.req.param('id'), query.after, query.limit)), 200)`
  and the `EventPage` type import from `./service.js` goes away. `z`, `parseOrThrow`,
  `queryInput` and `runEventsQuerySchema` stay (other routes use them).
- `apps/daemon/src/runs/service.ts`: delete `EventPageItem` and `EventPage` (`:22-33`); import
  `type { RunEventPage, RunEventRecord }` from `@codebox/contracts`; `events(...)` and the
  `RunsService` member return `RunEventPage`, and the mapped array is typed `RunEventRecord[]`;
  remove `EventRecord` from the `@codebox/store` type import once nothing else uses it.
- `apps/app/src/app/core/api/api-client.ts`: delete the `RunEventItem` and `RunEventPage`
  interfaces (`:54-65`), `parseRunEventPage` (`:260-279`), `parseRunEventItem` (`:281-315`) and
  `runEventIssue` (`:317-319`); import `parseRunEventPage` and `type RunEventPage` from
  `@codebox/contracts`; `runEvents(id, query)` keeps its signature and passes
  `parseRunEventPage` to `this.send`. Remove the imports that become unused
  (`sseEventNameSchema`, `timestampSchema`, `SseEventName`) — `npm run lint` is the check.
- `apps/daemon/src/runs/routes.test.ts`: import `parseRunEventPage` from `@codebox/contracts`
  and, in the replay test, add `expect(parseRunEventPage(pageBody)).toEqual(pageBody);` after
  the existing key-order assertion. No other case changes.

## 🧩 Configuration

None. No `CB_*` key is added, read or changed. No migration, no dependency, no lockfile change.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing
else is not a criterion.

- **Runner note (this batch, verbatim).** This batch runs on the operator's Windows host,
  where the full `npm test` cannot be green for reasons outside these tasks: `test:guard`'s
  quoting (Task-119 fixes it), 14 `scripts` tests that shell to bash/tar, 23 daemon tests that
  assert POSIX modes or spawn Unix tools, and the `ops` project that hangs (>300 s). The full
  gate's authority for this batch is the Linux CI workflow (`.github/workflows/ci.yml`, run
  with `gh workflow run ci.yml --ref task-118`), and the local commands are the targeted
  Vitest projects named per task plus `npm run lint` and `npm run build`. Never use `npx` on
  this host (it hangs); call `node node_modules/vitest/vitest.mjs run --project <name>`.
- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `node node_modules/vitest/vitest.mjs run --project packages/contracts`
  - `node node_modules/vitest/vitest.mjs run --project apps/daemon src/runs/`
  - `npm run test:app` — **one failure is allowed and expected**: the pre-existing
    `src/app/features/about/notice.spec.ts` CRLF red that Task-120 owns in this batch.
    `src/app/core/api/api-client.spec.ts` must pass entirely.
  - `npm run lint` and `npm run build` — both must pass.
  - `git diff --name-only main...task-118` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `run-events.test.ts` proves: a valid page with a non-null `seq` parses; a
        record with `seq: null` parses; `{ data: [], nextCursor: null }` parses; an unknown
        `type` (`run.unknown`) fails with `boundary === 'run.events'` and
        `first.path === 'run.events.data.0.type'`; an extra record key fails and its path names
        that key; `nextCursor: 1842` fails at `run.events.nextCursor`; an unknown page key
        fails.
  - [ ] `[unit]` `openapi.test.ts` proves: `Object.keys(buildOpenApiDocument().paths)` is still
        67; `GET /v1/runs/{id}/events` answers
        `#/components/schemas/RunEventPage` and **not** `#/components/schemas/Page`;
        `GET /v1/runs` still answers `#/components/schemas/Page`; `RunEventRecord` and
        `RunEventPage` are registered; every `$ref` resolves;
        `components.schemas.RunEventPage.properties.data.items.required` is exactly
        `['id', 'seq', 'type', 'data', 'ts']`; `JSON.stringify(...RunEventPage)` contains
        `run.output` (the record's event enum is inlined, not dropped).
  - [ ] `[unit]` `grep -rnE "eventPageSchema|EventPageItem|\bEventPage\b" apps/daemon/src`
        prints nothing.
  - [ ] `[unit]` `grep -rnE "RunEventItem|parseRunEventItem|runEventIssue" apps/app/src`
        prints nothing, and `grep -rn "parseRunEventPage" apps/app/src` shows one import and
        one call site.
  - [ ] `[unit]` `grep -n "runEventPageSchema\|runEventRecordSchema\|parseRunEventPage"
        packages/contracts/src/index.ts` shows all three exports.
  - [ ] `[unit]` the daemon replay test (`apps/daemon/src/runs/routes.test.ts`, "serves JSON
        replay, not SSE, with the last id as the cursor") still asserts `nextCursor: '3'`,
        the item ids `[2, 3]` and the item key order `['id','seq','type','data','ts']`, and
        additionally asserts `parseRunEventPage(pageBody)` deep-equals the body.
  - [ ] `[unit]` `docs/api.md` §5.4 contains this paragraph immediately after the event-page
        JSON sample and nothing else in §5.4 changes:
        `The page and its record are `runEventPageSchema` and `runEventRecordSchema`
        (`packages/contracts/src/run-events.ts`, parsed by `parseRunEventPage`); the OpenAPI
        `RunEventPage` component is that page.`
        (`git diff main...task-118 -- docs/api.md` shows exactly one added paragraph.)
  - [ ] `[unit]` `git diff --name-only main...task-118` lists only the eleven exclusive paths.
  - [ ] `[unit]` lint, the two named Vitest projects, the app suite above and the build pass.

## 📣 Coordination

- **For the Architect:** this task took `apps/app/src/app/core/api/api-client.ts`, which the
  brief for this cut believed had no consumer. It does: `ApiClient.runEvents` exists and
  `parseRunEventPage`/`RunEventItem` were its second definition — recorded in the Batch 33 cut
  paragraph.
- **For QA:** the app suite's single allowed red is Task-120's; do not fail this task on it,
  and do not "fix" it here.
- **For the next batch:** `RunEventRecord`/`RunEventPage`/`parseRunEventPage` are frozen. A
  later task that reads the replay (a run-log screen, a CLI replay) imports them from
  `@codebox/contracts`; it does not declare them again. `Page` remains `pageOfRun` and stays
  registered for `listRuns`.
- **For the Orchestrator:** `packages/contracts/README.md` gained two lines and no existing row
  moved; `apps/app/README.md` does not change because no file under `src/app` is added,
  renamed or deleted.

## ⛔ Out of scope

- No new route, no new path in the OpenAPI document (the pin stays 67), no `[live]` criterion.
- No change to `service.events`' timing, cursor rule, store read or query defaults
  (`after` default 0, `limit` 1–200 default 200).
- No change to `pages/`, stores or templates in `apps/app` — the app change is one file, the
  `ApiClient`.
- No reformatting of `openapi.ts`, `docs/api.md` or `api-client.ts` beyond the lines named.
- No new dependency, no migration, no `docs/decisions.md` entry.
- `docs/api.md` §10's contract table is **not** touched (it lists selected modules and already
  omits `credentials.ts`, `works.ts`, `design.ts`).

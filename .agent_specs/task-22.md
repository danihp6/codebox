# Spec: Task-22 — Run detail

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app.
- **Role:** Dev.
- **Objective:** `/runs/:id` stops being a placeholder. After this task the screen renders a
  live timeline (replayed from `GET /v1/runs/{id}/events`, then extended by the SSE stream
  while the run is live), the gate result, the guardrail checklist driven by the contract's
  `guardrailSchema` fields, blockers, the diff stat, the PR link, the merge result and the
  cost, and it owns the two run actions: cancel (with an explicit confirmation) and revert
  (only for a succeeded run with a PR). The typed client grows the five run-detail methods
  those reads need.
- **Environment:** worktree `../wt-cb-22`, branch `task-22`, base `main`.
- **Dependencies:** Task-18, already merged on `main`. It produced
  `apps/app/src/app/core/api/api-client.ts` (`send`, `parseBody`, `ApiError`),
  `apps/app/src/app/core/events/sse.service.ts` (`SseService.event`),
  `apps/app/src/app/core/i18n/i18n.service.ts`, `apps/app/src/assets/i18n/{en,es}.json`,
  `apps/app/src/app/app.routes.ts` (already points at `RunDetailPage`),
  `apps/app/src/app/app.config.ts` (`withComponentInputBinding()`), the Ionic provider set in
  `apps/app/src/app/shell/tabs.page.spec.ts`, and `docs/app.md` §4/§5/§7/§9. Task-15 produced
  the routes and the event-page shape this screen consumes.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/app/features/run-detail/run.page.ts`
- `apps/app/src/app/features/run-detail/run-detail.store.ts`
- `apps/app/src/app/features/run-detail/timeline.ts`
- `apps/app/src/app/features/run-detail/run.page.spec.ts`
- `apps/app/src/app/features/run-detail/run-detail.store.spec.ts`
- `apps/app/src/app/features/run-detail/timeline.spec.ts`
- `apps/app/src/app/core/api/api-client.ts`
- `apps/app/src/app/core/api/api-client.spec.ts`
- `apps/app/src/assets/i18n/en.json`
- `apps/app/src/assets/i18n/es.json`
- `apps/app/README.md` (section: **Files** — the `src/app/core/api/api-client.ts`,
  `src/app/core/api/api-client.spec.ts` and `src/app/features/run-detail/*` bullets only)

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/app.md` (§4 screens, §5 state, §7 live events, §9 design direction)
- `docs/api.md` (§3 errors, §4 pagination, §5.4 runs — including `/events` and `/diff` — §6 SSE)
- `packages/contracts/src/resources.ts` (`runSchema`, `guardrailSchema`, `blockerSchema`,
  `prRefSchema`, `gateResultSchema`, `runDiffSchema`, `costSchema`)
- `packages/contracts/src/primitives.ts` (`RUN_STATES`, `GUARDRAIL_IDS`,
  `sseEventNameSchema`, `timestampSchema` — re-exported from `@codebox/contracts`)
- `packages/contracts/src/events.ts` (`sseStreamEventSchema`, `SseStreamEvent`,
  `SseEventData`)
- `packages/contracts/src/index.ts` (the export list only)
- `apps/app/src/app/core/api/api-client.ts`, `apps/app/src/app/core/api/api-client.spec.ts`,
  `apps/app/src/app/core/api/http.ts`
- `apps/app/src/app/core/events/sse.service.ts`, `apps/app/src/app/core/events/events.ts`,
  `apps/app/src/app/core/events/sse-client.ts`
- `apps/app/src/app/core/i18n/i18n.service.ts`, `apps/app/src/app/core/i18n/i18n.spec.ts`
- `apps/app/src/app/core/auth/secure-store.ts` (`SECURE_STORE` — the page spec needs it)
- `apps/app/src/app/features/run-detail/run.page.ts` (the placeholder being replaced)
- `apps/app/src/app/app.routes.ts`, `apps/app/src/app/app.config.ts`,
  `apps/app/src/app/shell/tabs.page.spec.ts`, `apps/app/src/styles.css`,
  `apps/app/src/theme/variables.css`
- `apps/app/src/assets/i18n/en.json`, `apps/app/src/assets/i18n/es.json`
- `apps/daemon/src/runs/routes.ts` (only to confirm the frozen event-page shape and the cancel
  and revert statuses — do not import from `apps/daemon`)

## 🔒 Contract

`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on in
`apps/app/tsconfig.json`: an absent optional property is **omitted**, and `noPropertyAccessFromIndexSignature`
forbids `record.key` on an index signature — use `record['key']`.

### Client additions — `apps/app/src/app/core/api/api-client.ts`

The daemon's event page has no contracts schema (`docs/api.md` §5.4, and
`apps/daemon/src/runs/routes.ts` builds the shape locally). Parse it locally, in this file,
with `sseEventNameSchema` and `timestampSchema`; do not add a schema to
`packages/contracts`.

```ts
export interface RunEventItem {
  readonly id: number;                              // positive integer, the global event id
  readonly seq: number | null;                      // per-run sequence; null for approval events
  readonly type: SseEventName;
  readonly data: Readonly<Record<string, unknown>>;
  readonly ts: string;                              // RFC 3339
}

export interface RunEventPage {
  readonly data: readonly RunEventItem[];
  readonly nextCursor: string | null;               // the daemon returns a decimal string or null
}

export function parseRunEventPage(input: unknown): RunEventPage;

getRun(id: string): Observable<Run>;
runEvents(id: string, query?: { after?: number; limit?: number }): Observable<RunEventPage>;
runDiff(id: string): Observable<RunDiff>;
cancelRun(id: string): Observable<Run>;
revertRun(id: string, idempotencyKey: string): Observable<Run>;
```

| Method | HTTP | Parse | Notes |
| --- | --- | --- | --- |
| `getRun` | `GET /v1/runs/{id}` | `parseRun` | |
| `runEvents` | `GET /v1/runs/{id}/events?after=&limit=` | `parseRunEventPage` | `after` and `limit` are sent only when defined |
| `runDiff` | `GET /v1/runs/{id}/diff` | `parseRunDiff` | a `409` is a normal refusal, see below |
| `cancelRun` | `POST /v1/runs/{id}/cancel` | `parseRun` | body `null`; the daemon answers `202` with the run |
| `revertRun` | `POST /v1/runs/{id}/revert` | `parseRun` | header `Idempotency-Key: <idempotencyKey>`; the daemon answers `202` with the **new** run |

- All five go through the existing `send()` / `parseBody()` / `toApiError()` machinery, so a
  malformed body becomes `ApiError { status: 200, code: 'contract', requestId: null,
  details: { boundary, issues } }` and an error envelope keeps its `code`, `details` and
  `requestId`.
- `parseRunEventPage` is strict: an object; `data` an array; each item an object with
  `id` a positive integer, `seq` a positive integer or `null`, `type` accepted by
  `sseEventNameSchema`, `data` a plain object, `ts` accepted by `timestampSchema`;
  `nextCursor` a string or `null`. A failure throws
  `ContractParseError('run.events', issues)` so `send()` maps it to the contract `ApiError`.
- Do not change the existing methods, `ApiError`, `parsePairResult`, `parseTokenPair`,
  `toApiError` or `SYSTEM_ERROR_CODES`.

### Timeline helpers — `apps/app/src/app/features/run-detail/timeline.ts`

```ts
export const TIMELINE_DETAIL_MAX = 160;

export interface RunTimelineItem {
  readonly key: string;          // dedupe key, see below
  readonly seq: number | null;
  readonly type: SseEventName;
  readonly ts: string;
  readonly detail: string;       // one line, '' when the event has none
}

export function timelineKey(item: {
  readonly id?: number;
  readonly seq: number | null;
  readonly type: SseEventName;
  readonly data: Readonly<Record<string, unknown>>;
}): string | null;

export function toTimelineItem(item: RunEventItem): RunTimelineItem;
export function fromStreamEvent(event: SseStreamEvent): RunTimelineItem | null;
export function appendTimeline(
  current: readonly RunTimelineItem[],
  next: RunTimelineItem,
): readonly RunTimelineItem[];
export function mergePage(
  current: readonly RunTimelineItem[],
  page: RunEventPage,
): readonly RunTimelineItem[];
```

`timelineKey` (frozen, first rule that matches wins):
- `seq` is a number → `seq:<seq>` (every run-scoped event).
- `seq` is `null` and `data['approvalId']` is a string → `approval:<approvalId>` (the replay page
  and the SSE stream produce the same key for the same approval).
- `id` is a number → `id:<id>`.
- otherwise → `null`. `fromStreamEvent` returns `null` when `timelineKey` does, so a frameless
  event with neither a `seq` nor an `approvalId` is dropped, never appended twice.

`detail` (pure, whitespace collapsed, truncated to `TIMELINE_DETAIL_MAX` with a single `…`):

| event | detail |
| --- | --- |
| `run.queued` | `trigger` |
| `run.started` | `branch` |
| `run.output` | `delta` |
| `run.tool` | `` `${tool} ${status}` `` (+ `` `: ${detail}` `` when present) |
| `run.permission` | `` `${tool}: ${title}` `` |
| `run.gate` | `` `${gate.status} (exit ${gate.exitCode})` `` |
| `run.pr` | `pr.url` |
| `run.merged` | `mergeCommit` |
| `run.finished` | `''` |
| `run.failed` | `` `${code}: ${message}` `` |
| `run.cancelled` | `reason` when present, else `''` |
| `approval.created` | `` `${tool}: ${title}` `` |
| anything else | `''` |

`appendTimeline` returns `current` unchanged when `next.key` is already present, otherwise
`[...current, next]`. `mergePage` appends, in `data` order, every item whose key is absent.

### Store — `apps/app/src/app/features/run-detail/run-detail.store.ts`

```ts
export type RunAction = 'cancel' | 'revert';

/** Mirrors `CANCELLABLE_STATES` in `packages/core/src/run-state.ts`, re-declared because
 *  `@codebox/app` does not depend on `@codebox/core` and this task may not add the
 *  dependency. The four states the daemon accepts a cancel for. */
export const CANCELLABLE_RUN_STATES: readonly RunState[] = Object.freeze([
  'queued',
  'preparing',
  'running',
  'gating',
]);

@Injectable()
export class RunDetailStore {
  readonly runId = signal<string | null>(null);
  readonly run = signal<Run | null>(null);
  readonly timeline = signal<readonly RunTimelineItem[]>([]);
  readonly diff = signal<RunDiff | null>(null);
  readonly diffUnavailable = signal(false);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly confirmingCancel = signal(false);
  readonly busy = signal<RunAction | null>(null);
  readonly canCancel = computed<boolean>(() => {
    const state = this.run()?.state;
    return state !== undefined && CANCELLABLE_RUN_STATES.includes(state);
  });
  readonly canRevert = computed<boolean>(
    () => this.run()?.state === 'succeeded' && this.run()?.pr !== null,
  );

  constructor(api: ApiClient, router: Router, destroy: DestroyRef);

  load(runId: string): void;      // a new id resets run/timeline/diff/error/loading, then fetches all three
  reload(): void;                 // same id: run, events(after: 0, limit: 200) merged over the current timeline, diff
  askCancel(): void;              // confirmingCancel.set(true); no request
  dismissCancel(): void;          // confirmingCancel.set(false); no request
  cancel(): void;                 // one POST; on success run.set(returned), confirmingCancel false
  revert(): void;                 // one POST; on success navigates to /runs/<returned id>
  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored' | 'refetch';
}
```

Frozen behaviour:

- `load` issues `getRun`, `runEvents({ after: 0, limit: 200 })` and `runDiff` as three
  independent subscriptions, all `takeUntilDestroyed(destroy)`. `loading` is false once the
  `getRun` subscription settles (success or error). A `getRun` or `runEvents` failure sets
  `error`; a `runDiff` failure does **not** set `error` — a `409` whose
  `details['reason'] === 'diff_unavailable'` sets `diffUnavailable`, and any other diff
  failure leaves `diff` null so the page falls back to `run.diff`.
- `cancel` sets `busy` to `'cancel'`, clears it in `finalize`, and never fires a second
  request while `busy` is set.
- `revert` sets `busy` to `'revert'`, builds the key `` `revert-${runId}-${Date.now()}` `` at
  click time, calls `revertRun` once, and on success calls
  `router.navigate(['/runs', next.id])`. A refusal sets `error` and leaves the page in place.
- `applyStreamEvent`:
  - `event.event === 'gap'` → `'refetch'` (the page calls `reload()`).
  - the event's `data['runId']` is not the open run id → `'ignored'` (for `approval.created`,
    compare `data['runId']`, which may be `null`).
  - otherwise append the item when `fromStreamEvent` returns one; if the name is
    `run.finished`, `run.failed` or `run.cancelled`, also re-fetch `getRun` so the state chip
    and the actions reflect the terminal state. Returns `'applied'`.
  - other names → `'ignored'`.
- The store never reads `localStorage`, never merges a guess and never writes the run
  optimistically: the server response is the state (`docs/app.md` §5).

### Page — `apps/app/src/app/features/run-detail/run.page.ts`

Standalone, `ChangeDetectionStrategy.OnPush`, signals only, `providers: [RunDetailStore]`,
the Ionic components already used by the shell, no NgModule, no Bootstrap, no Material. The
class stays `RunDetailPage` and the selector stays `app-run-page` (the router imports the
class by name).

```ts
export class RunDetailPage {
  readonly id = input.required<string>();   // withComponentInputBinding() supplies :id
}
```

The page reads `this.store` and wires the stream with one `effect` in the injection context:
`const event = this.sse.event(); if (event !== null && this.store.applyStreamEvent(event) === 'refetch') this.store.reload();`
(`SseService` is injected by the page, not by the store.) An `effect` also calls
`this.store.load(candidate)` when the `id` input first arrives.

Harness for the page spec (mirror `apps/app/src/app/shell/tabs.page.spec.ts`, which is the
only working component-test example in the repository):

```ts
TestBed.configureTestingModule({
  providers: [
    provideRouter([]),
    provideIonicAngular(),
    { provide: SECURE_STORE, useValue: memoryStore() },          // I18nService → SettingsStore
    { provide: ApiClient, useValue: fakeApi },                   // no HttpClient in a component test
    { provide: SseService, useValue: { event: sseSignal } },     // a plain `signal<SseStreamEvent | null>(null)`
  ],
});
const fixture = TestBed.createComponent(RunDetailPage);
fixture.componentRef.setInput('id', 'run_x');
await fixture.whenStable();
```

Add `provideZonelessChangeDetection()` only if the fixture does not re-render after a signal
write. Assert on `data-*` attributes and element presence — never on translated text, and do
not stub `fetch`: `I18nService` degrades to `missing:<key>` on its own.

Test hooks — **these attributes are the contract with QA and with Task-26**, and no other
element may carry them:

| `data-testid` | Element | Frozen attributes / content |
| --- | --- | --- |
| `run-detail` | the page root | `data-run-id`; `data-state` (the `RunState`) only once `run()` is non-null |
| `run-loading` | spinner block | present only while `loading()` |
| `run-error` | error block | `data-code` = `ApiError.code`; contains `run.action.retry` |
| `run-retry` | button | calls `reload()` |
| `run-state` | state chip | text `run.state.<state>` |
| `timeline-item` | one per item | `data-key`, `data-type`, `data-ts`; the count equals `timeline().length` |
| `timeline-empty` | block | present only when the timeline is empty and not loading |
| `gate-status` | gate result | `data-status` = `run.gate.status` |
| `gate-exit` / `gate-duration` | gate result | `data-value` = `exitCode` / `durationMs` |
| `gate-none` | block | present only when `run.gate` is null |
| `guardrail-<id>` | one per `run.guardrails[]` entry | `data-state` = `pass` \| `fail` \| `skip`, `data-reason` when the contract carries one, `class` includes `cb-guardrail--<state>` |
| `blocker` | one per `run.blockers[]` entry | `data-code` = `BlockerCode`; text = the contract `message` |
| `blockers-empty` | block | present only with no blockers |
| `diff-files` / `diff-added` / `diff-removed` | diff stat | `data-value` = the number |
| `diff-unavailable` | block | present when not loading and (`diffUnavailable()` or both `diff` and `run.diff` are null) |
| `pr-link` | `<a>` | `href` = `run.pr.url`, `target="_blank"`, `rel="noopener noreferrer"`; absent when `run.pr` is null |
| `merge-result` | block | `data-merged="true"`, `data-detail` = the `run.merged` item's detail; `merge-none` when the run has no merged event |
| `cost` | block | text from `formatUsd(run.cost.usd)` |
| `cancel` | button | present only while `canCancel()`; sets `confirmingCancel` |
| `cancel-confirm` / `cancel-dismiss` | buttons | present only while `confirmingCancel()`; confirm calls `cancel()` |
| `revert` | button | present only while `canRevert()`; disabled while `busy() !== null`; one click → one request |

`formatUsd(usd: number): string` is a pure helper exported from `run.page.ts`:
`new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd)`.
Assertions never depend on translated text: assert `data-*` attributes and element presence.

### i18n — `apps/app/src/assets/i18n/en.json` and `es.json`

Add one `run` block to **both** files with **identical key sets** (`i18n.spec.ts` compares
them) and Spanish as the default locale. Keys, exactly:

```
run.title
run.state.{queued,preparing,running,gating,pr_open,merging,succeeded,failed,cancelled}
run.guardrail.{gate,checks,base,diff,protected_paths,labels,policy,automerger}
run.section.{timeline,gate,guardrails,blockers,diff,cost,pullRequest,merge}
run.action.{cancel,confirmCancel,dismissCancel,revert,retry}
run.empty.{timeline,blockers}
run.error.diffUnavailable
run.event.other
```

`run.guardrail.*` must cover all eight `GUARDRAIL_IDS` and `run.state.*` all nine
`RUN_STATES`; `run.event.other` is the fallback label for an event type without its own key.
Do not add interpolation syntax: `I18nService.t` has none. `run.page.spec.ts` enforces the
completeness by reading both files against the contract arrays (see the plan below).

### Data

No new persisted key, no store, no cache: the screen is a projection of `/v1` plus the SSE
signal (`docs/app.md` §5). `sessionStorage`/`localStorage` are untouched; tokens stay in the
secure store.

## 🧩 Configuration

None. This task reads no `CB_*` key and adds none.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — root Vitest (daemon and packages). It does **not** include the app; this is
    the repository's CI gate, so run it to prove nothing else broke.
  - `npm test -w @codebox/app` — `ng test --watch=false`, the app suite that contains this
    task's three spec files and the updated `api-client.spec.ts`. This is the command that
    proves the unit criteria below.
  - `npm run build` — `npm run build --workspaces --if-present`; it runs
    `ng build` for the app after `prebuild` builds `@codebox/contracts`.
  - `git diff --name-only main...task-22` — audit against the exclusive paths; every path must
    start with `apps/app/src/app/features/run-detail/`, be one of the two
    `apps/app/src/app/core/api/api-client.*` files, be one of the two
    `apps/app/src/assets/i18n/*.json` files, or be exactly `apps/app/README.md`.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean (`npm run lint`, `npm run build`).
  - [ ] `[unit]` The declared tests exist and pass (`npm test -w @codebox/app`).
  - [ ] `[unit]` Nothing outside the exclusive paths was touched (`git diff --name-only
        main...task-22`).
  - [ ] `[unit]` Each guardrail renders red/green from the contract field, not from a string
        match: `run.page.spec.ts` renders a run whose `guardrails` are
        `[{ id: 'gate', state: 'pass' }, { id: 'diff', state: 'fail', reason: '41 files' }, { id: 'checks', state: 'skip' }]`
        and asserts `guardrail-gate` has `data-state="pass"`, `guardrail-diff` has
        `data-state="fail"` and `data-reason="41 files"`, `guardrail-checks` has
        `data-state="skip"`, and that each element's class list contains
        `cb-guardrail--<state>`. A second case rewrites only the `reason` string (to the
        literal words `pass`, `fail`) and asserts no `data-state` changed; a third case flips
        the three `state` values and asserts every `data-state` and class followed. The state
        is read from `guardrailSchema`'s field and from nothing else.
  - [ ] `[unit]` Cancel asks for confirmation and, on success, reflects the returned
        `cancelled` run: `run-detail.store.spec.ts` asserts that `cancel()` before
        `askCancel()` performs **no** HTTP request; `askCancel()` sets `confirmingCancel()` and
        performs no request; `cancel()` performs exactly one `POST /v1/runs/run_x/cancel` and
        sets `run()` to the returned run (`state: 'cancelled'`, `finishedAt` set), clearing
        `confirmingCancel()` and `busy()`. `canCancel()` is true for `queued`, `preparing`,
        `running` and `gating` and false for `succeeded`, `failed` and `cancelled`.
        `run.page.spec.ts` asserts `cancel-confirm` exists only after `cancel` is clicked and
        that the `cancel` button is absent on a `succeeded` run. A third case feeds a
        `run.cancelled` stream event and asserts one re-fetch of `getRun` and
        `data-state="cancelled"` on `run-detail`.
  - [ ] `[unit]` Revert is offered only for a succeeded run with a PR and calls the endpoint
        once: with `{ state: 'succeeded', pr: { number: 7, url: 'https://github.com/o/r/pull/7', mergeable: true } }`
        the `revert` button exists and a click produces exactly one
        `POST /v1/runs/run_x/revert` carrying a non-empty `Idempotency-Key`, followed by
        `Router.navigate(['/runs', '<returned id>'])`; with `state: 'pr_open'`, with
        `pr: null`, and with `state: 'failed'` the button is absent and no request is made.
  - [ ] `[unit]` Both dictionaries are complete: `run.page.spec.ts` reads `en.json` and
        `es.json` with `readFileSync` (the pattern of `src/app/core/i18n/i18n.spec.ts`) and
        asserts a non-empty string at `run.guardrail.<id>` for every `GUARDRAIL_IDS` entry and
        at `run.state.<state>` for every `RUN_STATES` entry, in **both** locales, with no
        `missing:`-able gap. `npm test -w @codebox/app` also keeps the untouched
        `i18n.spec.ts` key-parity test green.
  - [ ] `[unit]` The client rejects a malformed run payload with `ApiError` code `contract`:
        `api-client.spec.ts` flushes `{ id: 'run_x' }` to `GET /v1/runs/run_x` and asserts the
        rejection is an `ApiError` with `{ status: 200, code: 'contract', requestId: null }`;
        it also asserts `runEvents` sends `after`/`limit`, parses a page whose `seq` is `null`,
        rejects a page with an unknown `type` or a non-numeric `nextCursor` with
        `code: 'contract'`, that `revertRun('run_x', 'k1')` sends `Idempotency-Key: k1`, that
        `cancelRun` maps a `409` envelope to `ApiError` with `code: 'conflict'` and
        `details.reason`, and that `runDiff` maps `409 diff_unavailable` to the same code.
  - [ ] `[unit]` `ng build` and `ng test` pass: `npm run build` and
        `npm test -w @codebox/app` both exit 0.
  - [ ] `[live]` **Not measured by QA on CI: report it `not-run`.** A run's timeline updates
        live and the revert action opens the generated PR, measured on the VM: the built PWA
        served by the daemon against a `FakeOpenCode` agent, one run opened at
        `/runs/<runId>`; the measurement is (a) for each of three consecutive `run.output`
        events, the wall-clock delta between the event's `ts` and the appearance of a
        `data-testid="timeline-item"` with that `data-ts`/`data-key` in the DOM is ≤ 1500 ms,
        with the item count equal to the replayed page plus the new events and no duplicate
        key; and (b) tapping `revert` on a `succeeded` run navigates to the new run, and once
        that run reaches `pr_open` its `pr-link` opens the GitHub pull request in a new tab.
        On CI the plan stops at the `[unit]` criteria and reports this line `not-run`.

## 📣 Coordination

- For the Architect: `RunDetailPage` is no longer a placeholder; `app.routes.ts`,
  `app.config.ts` and `angular.json` are untouched, and so is every other feature folder.
  `apps/app` now has a per-feature store, which `docs/app.md` §5 already sanctions.
- For Task-19/20/21/23 (the sibling app tasks): `ApiClient` gained `getRun`, `runEvents`,
  `runDiff`, `cancelRun` and `revertRun`, and the exported `RunEventItem`/`RunEventPage`
  types. They are additive: no existing signature changed. The `run` i18n block belongs to
  this task; a sibling that needs a run label reuses `run.*` instead of adding a second block.
- For Task-26 (e2e): the timeline, guardrail, PR and action hooks in the table above are the
  selectors to assert on. `data-testid="run-detail"` carries `data-state`, so a flow can wait
  on a state without reading translated text.
- For Task-23 (settings/notifications): the `I18nService` has no interpolation; format values
  in TypeScript (`formatUsd` is the example), not in the dictionary.

## ⛔ Out of scope

- No new npm dependency, no chart library, no markdown renderer, no diff viewer: the diff is
  the stat and the changed-file count, the patch lives on GitHub (`docs/api.md` §5.4).
- No change to `package.json`, `package-lock.json`, `tsconfig*`, `apps/app/angular.json`,
  `apps/app/src/main.ts`, `apps/app/src/app/app.routes.ts`, `apps/app/src/app/app.config.ts`,
  `apps/app/src/styles.css`, `apps/app/src/theme/**`, `packages/contracts/**`,
  `apps/daemon/**`, `TODO.md`, `CHANGELOG.md`, `docs/**`.
- No new contracts schema for the event page: it is parsed locally in the client.
- No optimistic run mutation, no offline write queue, no polling loop: the stream plus an
  explicit retry is the whole refresh story.
- No refactor of `api-client.ts` beyond adding the five methods, the two types and the
  parser; do not reshape `send`, `parseBody`, `ApiError` or `toApiError`.
- No `AlertController`/modal for the cancel confirmation: the inline confirmation pair is the
  frozen, headless-testable design.

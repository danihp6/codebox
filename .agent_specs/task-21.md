# Spec: Task-21 — Jobs and runs list

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (Angular 22 + Ionic 9, standalone components, signals, zoneless). UI only:
  no daemon, no contract change, no new dependency.
- **Role:** Dev.
- **Objective:** `/jobs` lists jobs with their next fire, pauses and resumes them optimistically,
  runs one now, and creates a new job with a cron picker and a timezone; `/jobs/:id` edits the same
  job, previews its next five fires in its own timezone and shows its recent runs; `/runs` lists runs
  with status chips and cost, paginating with the cursor the API already returns.
- **Environment:** worktree `../wt-cb-21`, branch `task-21`, base `main`.
- **Dependencies:** Task-18 (merged). Files it produced that this task reads and must not modify:
  `apps/app/src/app/app.routes.ts` (already lazy-loads `JobsPage`, `JobPage` and `RunsPage`),
  `core/api/api-client.ts` (`ApiClient.listRuns`, `ApiClient.listJobs`, `ApiError`),
  `core/api/http.ts`, `core/events/sse.service.ts`, `core/i18n/i18n.service.ts`,
  `core/auth/secure-store.ts`, `src/theme/variables.css`, `src/styles.css`,
  `features/run-detail/*` (store + page + spec reference).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/app/features/jobs/**`
- `apps/app/src/app/features/runs-list/**`

`apps/app/src/app/app.routes.ts` is a hot file owned by Task-18: this task never edits it.
`apps/app/README.md`, `src/assets/i18n/*.json` and `apps/app/package.json` are outside this task
(see Coordination).

### Inputs (read-only)

- `apps/app/src/app/app.routes.ts`, `app.config.ts`, `app.routes.spec.ts`
- `apps/app/src/app/core/api/api-client.ts`, `core/api/api-client.spec.ts`, `core/api/http.ts`
- `apps/app/src/app/core/events/sse.service.ts`, `core/events/events.ts`
- `apps/app/src/app/core/i18n/i18n.service.ts`, `core/settings/settings.store.ts`,
  `core/auth/secure-store.ts`
- `apps/app/src/app/features/run-detail/run-detail.store.ts`, `run-detail.store.spec.ts`,
  `run.page.ts`, `run.page.spec.ts`
- `apps/app/src/theme/variables.css`, `apps/app/src/styles.css`
- `packages/contracts/src/index.ts`, `resources.ts`, `primitives.ts`, `pagination.ts`
- `apps/daemon/src/jobs/routes.ts` (the exact request and response shapes of `/v1/jobs`)
- `docs/app.md` §4, §5, §9, §10, §12; `docs/api.md` §4, §5.3, §5.4; `docs/jobs.md` §2 (5-field
  cron, IANA zone, misfire grace, the next-fire preview)

## 🔒 Contract

### Placeholders become real, in place

Rewrite the **content** of the three existing files. Keep the file path, the exported class name and
the selector, because `app.routes.ts` imports them by name and `app.routes.spec.ts` resolves every
lazy loader:

| File | Exported class | Selector | Root `data-testid` |
| --- | --- | --- | --- |
| `features/jobs/jobs.page.ts` | `JobsPage` | `app-jobs-page` | `page-jobs` |
| `features/jobs/job.page.ts` | `JobPage` | `app-job-page` | `page-job` |
| `features/runs-list/runs.page.ts` | `RunsPage` | `app-runs-page` | `page-runs` |

`JobPage` reads its id like `RunDetailPage`: `readonly id = input.required<string>();`.

### Existing surface this task consumes — do not re-declare, do not extend

```ts
// core/api/api-client.ts — the only ApiClient members this task calls
class ApiClient {
  listJobs(query?: { limit?: number; cursor?: string }): Observable<Page<Job>>;
  listRuns(query?: { state?: RunState; limit?: number; cursor?: string }): Observable<Page<Run>>;
}
class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | null;
}
// core/events/sse.service.ts
class SseService { readonly event: Signal<SseStreamEvent | null>; }
// core/i18n/i18n.service.ts
class I18nService { readonly locale: Signal<'en' | 'es'>; }
// core/api/http.ts
const API_BASE_URL: string; // ''
const API_PREFIX: string;   // '/v1'
```

The list reads use `ApiClient`; everything the client lacks (job detail, create, patch, delete,
pause, resume, run-now, next-fire preview, repos) goes through `JobsApi` below.

### New surface this task creates

**`features/jobs/jobs.api.ts`**

```ts
import type { Job, Page, Repo, RepoPolicy, Run } from '@codebox/contracts';

export interface JobDetail {
  readonly job: Job;
  readonly lastRuns: readonly Run[];
  readonly nextFires: readonly string[];
}

export interface JobCreateBody {
  readonly repoId: string;
  readonly title: string;
  readonly prompt: string;
  readonly cron: string;
  readonly timezone: string;
  readonly mode?: 'work';
  readonly agent?: string;
  readonly model?: string | null;
  readonly policy?: RepoPolicy;
}

export interface JobPatchBody {
  readonly title?: string;
  readonly prompt?: string;
  readonly cron?: string;
  readonly timezone?: string;
  readonly agent?: string;
  readonly model?: string | null;
  readonly policy?: RepoPolicy;
  readonly enabled?: boolean;
}

export function parseJobDetail(input: unknown): JobDetail;      // throws ContractParseError('jobDetail', …)
export function parseNextFires(input: unknown): readonly string[]; // { fires: string[] }

@Injectable({ providedIn: 'root' })
export class JobsApi {
  constructor(http: HttpClient);
  get(id: string): Observable<JobDetail>;                                  // GET   /v1/jobs/{id}
  create(body: JobCreateBody): Observable<Job>;                            // POST  /v1/jobs            (201)
  patch(id: string, body: JobPatchBody): Observable<Job>;                  // PATCH /v1/jobs/{id}
  remove(id: string): Observable<void>;                                    // DELETE (204, no body)
  pause(id: string): Observable<Job>;                                      // POST  /v1/jobs/{id}/pause
  resume(id: string): Observable<Job>;                                     // POST  /v1/jobs/{id}/resume
  runNow(id: string, idempotencyKey: string): Observable<Run>;             // POST  /v1/jobs/{id}/run   (202)
  next(id: string, count?: number): Observable<readonly string[]>;         // GET   /v1/jobs/{id}/next?count=
  listRepos(): Observable<Page<Repo>>;                                     // GET   /v1/repos?limit=200
}
```

`GET /v1/jobs/{id}` answers `{ job, lastRuns, nextFires }` (see `apps/daemon/src/jobs/routes.ts`
lines 63–68) and **has no contract schema**, so `parseJobDetail` validates it by hand:
the input is a non-array object with exactly the keys `job`, `lastRuns`, `nextFires`; `job` goes
through `parseJob`, each `lastRuns` entry through `parseRun`, each `nextFires` entry through
`timestampSchema.safeParse`; any failure throws
`new ContractParseError('jobDetail', [{ path, message, code: 'custom' }])`. `parseNextFires` does
the same for `{ fires: string[] }`. `parsePage(repoSchema, body, 'repos')` covers `listRepos`; `Job`
responses use `parseJob`, and `runNow` uses `parseRun`.

Never import `zod` (not a dependency of `@codebox/app`). Optional properties are omitted, never set
to `undefined` (`exactOptionalPropertyTypes`). Every failure maps to `ApiError` through one
non-exported `toApiError(error)` in this file: pass an `ApiError` through; for an
`HttpErrorResponse` parse `errorEnvelopeSchema` into `{ code, message, requestId, details }`,
falling back to `code: 'internal'` (`'unauthorized'` for 401) and the `x-request-id` header; for
anything else `code: 'network'`, `status: 0`. Do not import the helper from another feature folder.

**`features/jobs/cron.ts`** (pure — no Angular, no clock, no network)

```ts
export const CRON_FIELDS = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'] as const;
export type CronField = (typeof CRON_FIELDS)[number];

export interface CronParts {
  readonly minute: string;
  readonly hour: string;
  readonly dayOfMonth: string;
  readonly month: string;
  readonly dayOfWeek: string;
}

export type CronProblem = 'field_count' | 'syntax' | 'range';

export interface CronValidation {
  readonly ok: boolean;
  readonly problems: readonly CronProblem[];
}

export function validateCron(expression: string): CronValidation;
export function toExpression(parts: CronParts): string;
export function summarise(expression: string, locale: 'en' | 'es'): string;
```

`validateCron`: split on whitespace after `trim()`; not five fields → `['field_count']`. Each field
must be `*`, `*/N`, `N`, `N-M`, `N-M/S` or a comma list of those → otherwise `['syntax']`. Numeric
ranges: minute 0–59, hour 0–23, day-of-month 1–31, month 1–12, day-of-week 0–7 → outside is
`['range']`. `problems` is de-duplicated and in the order `field_count`, `syntax`, `range`.
`no_fire` and `timezone` are the daemon's (`docs/api.md` §5.3); this function never claims them.

`toExpression` joins the five fields with single spaces after trimming each.

`summarise` — pinned strings, both locales (anything else returns the trimmed expression):

| Expression | `en` | `es` |
| --- | --- | --- |
| `0 3 * * *` | `Every day at 03:00` | `Cada día a las 03:00` |
| `*/15 * * * *` | `Every 15 minutes` | `Cada 15 minutos` |
| `30 */6 * * *` | `Every 6 hours at minute 30` | `Cada 6 horas en el minuto 30` |
| `0 8 * * 1` | `Every Monday at 08:00` | `Cada lunes a las 08:00` |
| `15 4 * * 1-5` | `Every weekday at 04:15` | `Cada día laborable a las 04:15` |
| `7 7 7 7 7` | `7 7 7 7 7` | `7 7 7 7 7` |

**`features/jobs/time-format.ts`** (pure)

```ts
export interface FireParts {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export function fireParts(iso: string, timeZone: string): FireParts;      // 24-hour clock
export function formatFire(iso: string, timeZone: string, locale: 'en' | 'es'): string;
```

`fireParts` uses `Intl.DateTimeFormat('en-GB', { timeZone, hour12: false, hour: '2-digit',
minute: '2-digit', day: '2-digit' })` and `formatToParts`; `day` is the day of the month.
`formatFire` is the display string (`dateStyle: 'short', timeStyle: 'short'`) and is only rendered.

**`features/jobs/cron-picker.ts`** (standalone component)

```ts
@Component({ selector: 'app-cron-picker', standalone: true })
export class CronPickerComponent {
  readonly expression = input.required<string>();
  readonly locale = input<'en' | 'es'>('en');
  readonly changed = output<string>();
  readonly summary = computed<string>(() => summarise(this.expression(), this.locale()));
  readonly valid = computed<CronValidation>(() => validateCron(this.expression()));
}
```

Renders a text input (`data-testid="cron-input"`), the summary (`cron-summary`,
`[attr.data-ok]="valid().ok"`) and five preset buttons (`cron-preset-0` … `cron-preset-4`) for
`0 3 * * *`, `*/15 * * * *`, `30 */6 * * *`, `0 8 * * 1`, `15 4 * * 1-5`. Typing or clicking emits
the expression through `changed`; the component never owns the value.

**`features/jobs/jobs.store.ts`**

```ts
@Injectable()
export class JobsStore {
  readonly jobs: Signal<readonly Job[]>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<ApiError | null>;
  readonly busy: Signal<string | null>;      // job id of the in-flight action
  readonly running: Signal<string | null>;   // job id whose run-now is in flight
  load(): void;                              // ApiClient.listJobs({ limit: 100 })
  pause(job: Job): void;                     // optimistic enabled:false, nextFireAt:null, rollback
  resume(job: Job): void;                    // optimistic enabled:true, server's nextFireAt wins
  runNow(job: Job): void;                    // JobsApi.runNow with `runnow-<jobId>-<n>`
  create(body: JobCreateBody): Observable<Job>;  // passthrough so the page can navigate
  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored'; // job.changed → reload()
}
```

Pause and resume are the **only** optimistic actions (docs/app.md §5): mutate the row, send the
request, and on error restore the previous row and set `error`. `runNow` is never optimistic (it
needs a server run id) and its idempotency counter starts at 1 per store instance, so the first key
is exactly `runnow-job_01JABCDEFGHJKMNPQRSV-1`.

**`features/jobs/job.store.ts`**

```ts
@Injectable()
export class JobStore {
  readonly jobId: Signal<string | null>;
  readonly detail: Signal<JobDetail | null>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<ApiError | null>;
  readonly saving: Signal<boolean>;
  readonly validation: Signal<CronValidation>;
  readonly timezoneError: Signal<boolean>;
  load(id: string): void;                       // JobsApi.get
  saveCron(cron: string, timezone: string): void;  // validates first; PATCH; then next()
  setEnabled(enabled: boolean): void;           // PATCH { enabled } (no optimism here)
  runNow(): void;
  refreshNext(): void;                          // JobsApi.next(id, 5)
}
```

`saveCron` sends nothing when `validateCron(cron).ok === false`: it sets `validation` and stops. A
timezone that `Intl.DateTimeFormat` rejects (`RangeError`) sets `timezoneError` and stops. After a
successful `PATCH` it calls `refreshNext()` so the preview is the server's answer, not a local guess.

**`features/runs-list/runs.store.ts`**

```ts
@Injectable()
export class RunsStore {
  readonly runs: Signal<readonly Run[]>;
  readonly state: Signal<RunState | null>;    // null = all
  readonly nextCursor: Signal<string | null>;
  readonly loading: Signal<boolean>;
  readonly loadingMore: Signal<boolean>;
  readonly error: Signal<ApiError | null>;
  load(): void;                                // ApiClient.listRuns({ state, limit: 50 })
  setState(state: RunState | null): void;      // resets the list, then load()
  more(): void;                                // appends the next page
  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored';
}
```

`applyStreamEvent` patches the `state` of the row whose `id` matches `data.runId` for `run.queued`
(→ `queued`), `run.finished` (→ `succeeded`), `run.failed` (→ `failed`) and `run.cancelled`
(→ `cancelled`); every other event is `'ignored'`. It never inserts a row it has not loaded.

**`features/<folder>/i18n.ts`** — one per folder (`jobs/i18n.ts`, `runs-list/i18n.ts`), identical
shape in both:

```ts
export type Locale = 'en' | 'es';
export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>>;
export function translate(locale: Locale, key: string): string; // returns `key` when missing
```

Flat keys prefixed `jobs.` or `runs.`. In a page:

```ts
private readonly i18n = inject(I18nService);           // declared BEFORE `t`
readonly t = (key: string): string => translate(this.i18n.locale(), key);
```

The dictionaries live here, not in `src/assets/i18n/*.json`: those files are outside this task's
paths and shared with two other tasks in this batch.

### Rendered hooks (exact `data-testid` names QA asserts)

`/jobs`: `page-jobs` (root), `jobs-loading`, `jobs-error` (`data-code`), `jobs-retry`, `job-row`
(`data-job-id`, `data-enabled`, `data-cron`), `job-next` (`data-at`, the ISO string, and the rendered
`formatFire` in the job's timezone), `job-pause`, `job-resume`, `job-run-now`, `jobs-empty`,
`job-create` (opens the form), `job-form`, `job-form-title`, `job-form-prompt`, `job-form-repo`
(one `job-form-repo-option` per repo with `data-repo-id`), `job-form-timezone`, `job-form-submit`,
`job-form-error` (`data-code`), and the picker's hooks inside it.

`/jobs/:id`: `page-job` (root, `data-enabled`), `job-detail-loading`, `job-detail-error`
(`data-code`), `job-cron` (the picker), `job-timezone`, `job-save`, `job-validation`
(`data-problems`), `job-next-fire` (one per previewed fire, `data-at`), `job-run-now`,
`job-history-run` (`data-run-id`, `data-state`), `job-history-empty`.

`/runs`: `page-runs` (root), `runs-loading`, `runs-error` (`data-code`), `runs-retry`, `run-chip`
(one per state with `data-state`), `run-chip-all`, `run-row` (`data-run-id`, `data-state`,
`data-usd`), `runs-empty`, `runs-more` (present only when `nextCursor() !== null`).

A paused job keeps `job-run-now` **enabled**: `POST /v1/jobs/{id}/run` ignores the pause switch
(`docs/api.md` §5.3). Only the scheduler is paused, never the manual action.

## 🧩 Configuration

None. No `CB_*` key, no change to `apps/app/package.json`.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`.
  - `npm run lint` — must pass.
  - `npm test` — the root Vitest projects (packages, daemon, ops); must stay green.
  - `npm test -w @codebox/app` — `ng test --watch=false` (Vitest + jsdom) over
    `apps/app/src/**/*.spec.ts`, including the specs this task adds. The root `npm test` does not
    include `apps/app`.
  - `npm run build` — the root build (`@codebox/contracts` prebuild + `ng build`).
  - `git diff --name-only main...task-21` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` Lint, both test suites and the build are green.
  - [ ] `[unit]` `cron.spec.ts`: `toExpression({minute:'0',hour:'3',dayOfMonth:'*',month:'*',dayOfWeek:'*'})`
    is exactly `'0 3 * * *'`; `validateCron` rejects `'0 3 * *'` with `['field_count']`, `'61 3 * * *'`
    with `['range']`, `'0 3 * * 8'` with `['range']`, `'0 3 * * x'` with `['syntax']`, and accepts
    `'0 0/6 * * *'`, `'0 3 1-5 * 1'`, `'0 3 * * 1,3,5'`; and the six `summarise` rows above match
    **exactly**, in both locales.
  - [ ] `[unit]` `time-format.spec.ts`: `fireParts('2026-10-25T02:00:00Z', 'Europe/Madrid')` is
    `{ day: 25, hour: 3, minute: 0 }`; `fireParts('2026-10-25T02:00:00Z', 'America/New_York')` is
    `{ day: 24, hour: 22, minute: 0 }`.
  - [ ] `[unit]` `jobs.api.spec.ts` (HttpTestingController): `get` requests `/v1/jobs/job_1` and
    parses `{ job, lastRuns: [], nextFires: ['2026-10-25T02:00:00Z'] }`; a body missing `nextFires`
    throws `ContractParseError` with `boundary === 'jobDetail'`; `patch` sends only the keys given
    (never `undefined`); `pause` posts to `/v1/jobs/job_1/pause`; `runNow` posts to
    `/v1/jobs/job_1/run` **with** the `Idempotency-Key` header it was given and parses a `Run`;
    `next` requests `/v1/jobs/job_1/next?count=5` and returns `['…']`; a 422 envelope with
    `details.path === 'job.cron'` becomes an `ApiError` carrying that path.
  - [ ] `[unit]` `jobs.store.spec.ts`: `pause(job)` flips `enabled` to `false` **before** the request
    is flushed, and a flushed error restores `true` and sets `error()`; `resume` mirrors it;
    `runNow` sends `Idempotency-Key: runnow-<jobId>-1` and then `-2` for a second call and never
    inserts a row optimistically; a `job.changed` frame triggers exactly one reload.
  - [ ] `[unit]` `job.store.spec.ts`: `saveCron('0 3 * *', 'Europe/Madrid')` sends **no** request and
    sets `validation().problems` to `['field_count']`; `saveCron('0 3 * * *', 'Mars/Olympus')` sends
    no request and sets `timezoneError()`; a valid save PATCHes `{ cron, timezone }` and then calls
    `/v1/jobs/job_1/next?count=5`, and the preview holds the server's fires.
  - [ ] `[unit]` `runs.store.spec.ts`: `load()` requests `/v1/runs?limit=50`; `setState('failed')`
    requests `/v1/runs?state=failed&limit=50`; `more()` appends the second page and updates
    `nextCursor`; a `run.finished` frame for a loaded row changes its state to `succeeded` and a
    frame for an unknown id changes nothing.
  - [ ] `[unit]` `jobs.page.spec.ts` (fake `SseService` = a `signal`, `provideIonicAngular()`, a
    memory `SECURE_STORE`): renders one `job-row` per job with `data-enabled` and a `job-next` whose
    `data-at` is the job's `nextFireAt`; a paused job (`enabled: false`) still renders `job-run-now`
    enabled and renders `job-resume` instead of `job-pause`; clicking `job-run-now` on a paused job
    issues the POST.
  - [ ] `[unit]` `job.page.spec.ts`: typing `0 3 * *` into `cron-input` and pressing `job-save`
    renders `job-validation` with `data-problems="field_count"` and sends nothing; with
    `0 3 * * *` it sends the PATCH and renders one `job-next-fire` per previewed fire.
  - [ ] `[unit]` `runs.page.spec.ts`: renders one `run-row` per run with `data-state` and `data-usd`;
    clicking `run-chip` for `failed` requests the filtered list and re-renders; `runs-empty` shows
    for an empty page and `runs-more` only when `nextCursor` is non-null.
  - [ ] `[unit]` Dictionary parity for both `i18n.ts` modules: `STRINGS.en` and `STRINGS.es` share
    one key set, no empty value, and every key the templates use resolves
    (`translate(locale, key) !== key`).
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
    `git diff --name-only main...task-21` lists only files under
    `apps/app/src/app/features/jobs/` and `apps/app/src/app/features/runs-list/`. In particular
    `apps/app/src/app/app.routes.ts`, `apps/app/src/assets/i18n/en.json`,
    `apps/app/src/assets/i18n/es.json`, `apps/app/package.json` and `apps/app/README.md` must not
    appear.
  - [ ] `[live]` **Reported as `[?]`, never as passing in CI.** No browser and no daemon on a GitHub
    Actions runner. Measurement on the box with the app served by the daemon: create a job with
    `cron = "0 3 * * *"` and `timezone = "Europe/Madrid"`, and within 2 s of the `201` — with no
    reload — the row appears in `/jobs` with `data-at` equal to the `nextFireAt` that
    `curl -s -H "authorization: Bearer $TOKEN" http://127.0.0.1:8787/v1/jobs` reports for that id,
    and the rendered local time reads `03:00`. Paste the `curl` body, the row's `data-at` and a
    screenshot into the QA report. Partially blocked today: the create form's repo selector reads
    `GET /v1/repos`, which is documented (`docs/api.md` §5.2) but **not implemented** in
    `apps/daemon/src/app.ts`; if it is still missing, create the job with `curl` and state that the
    selector part of this criterion is `[?]` for that reason.

## 📣 Coordination

- **For the Architect:** `ApiClient` has no `getJob`, `createJob`, `patchJob`, `pauseJob`,
  `resumeJob`, `runNow` or job-next method, and this task may not edit `core/api/api-client.ts`;
  `JobsApi` therefore lives in the feature folder. It also carries `listRepos()` because the create
  form needs `GET /v1/repos` and this task must not depend on Task-19's `ReposApi` (same batch,
  parallel). When a later task owns `core/api/**`, these collapse into `ApiClient` — do not keep
  two copies.
- **For the Architect:** the next-fire preview for an **unsaved** job is impossible without the
  scheduler (`@codebox/scheduler` is not a dependency of `@codebox/app`) and there is no preview
  endpoint for a body. The create form shows `summarise()` only; the five fires come from
  `GET /v1/jobs/{id}/next` after the job exists. Do not add a client-side cron evaluator.
- **For Task-36 (routines tab, Batch 9):** `features/jobs/**` is shared with that task in a later
  batch. Keep `jobs.page.ts` a thin list plus a `<section>` per concern so a routines tab can be
  added without touching `jobs.store.ts`.
- **For the batch owner, once, after the merge:** `apps/app/README.md` needs one line per new file
  under `jobs/` (`cron.ts`, `cron.spec.ts`, `cron-picker.ts`, `i18n.ts`, `job.page.spec.ts`,
  `job.store.ts`, `job.store.spec.ts`, `jobs.api.ts`, `jobs.api.spec.ts`, `jobs.page.spec.ts`,
  `jobs.store.ts`, `jobs.store.spec.ts`, `time-format.ts`, `time-format.spec.ts`) and under
  `runs-list/` (`i18n.ts`, `runs.page.spec.ts`, `runs.store.ts`, `runs.store.spec.ts`), replacing
  the three placeholder lines. This task must not touch that file (three tasks in this batch add
  files to the same map).
- **For QA:** mount pages with `provideIonicAngular()`, a memory `SECURE_STORE` stub and a fake
  `SseService` (`{ event: signal(...) }`). The pages own the **real** stores, so also provide
  `provideHttpClient()` + `provideHttpClientTesting()` and flush every request with
  `HttpTestingController` (the pattern in `features/run-detail/run-detail.store.spec.ts`); do not
  hand-write a fake `ApiClient` or `JobsApi`. No test may open a real `EventSource` or a real
  `fetch`.

## ⛔ Out of scope

- No client-side cron evaluator and no next-fire computation for an unsaved job (the scheduler is a
  daemon package and the app may not depend on it).
- No filter by `repoId` or `jobId` on `/runs`: `ApiClient.listRuns` exposes `state`, `limit` and
  `cursor` only, and extending it is not this task's path. The chips are the filter.
- No job deletion UI, no clone/duplicate, no agent/model picker beyond what the create form needs
  (omit `agent` and `model`: the daemon defaults them).
- No routine UI, no "routines" tab (Task-36).
- No new dependency; no `@angular/forms` form group — signals and template bindings are enough.
- No change to `app.routes.ts`, `main.ts`, `app.config.ts`, `angular.json`, `package.json`,
  `package-lock.json`, `packages/contracts/**`, `src/assets/i18n/*.json`.
- No edit to `CHANGELOG.md` or `TODO.md` (the Orchestrator owns both).

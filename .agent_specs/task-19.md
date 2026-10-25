# Spec: Task-19 — Dashboard and repos

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (Angular 22 + Ionic 9, standalone components, signals, zoneless). UI only:
  no daemon, no contract change, no new dependency.
- **Role:** Dev.
- **Objective:** The dashboard and the two repository screens stop being placeholders. `/dashboard`
  renders three health cards (daemon/VM, queue, today's spend) and the five most recent runs from
  the existing `ApiClient`; `/repos` lists repositories, adds one through a wizard that validates
  `owner/name`, and shows the verification result it gets back without a reload; `/repos/:id` edits
  the gate, flips the policy optimistically with a rollback on error, edits the protected paths and
  previews exactly what the `PATCH` will send.
- **Environment:** worktree `../wt-cb-19`, branch `task-19`, base `main`.
- **Dependencies:** Task-18 (merged). Files it produced that this task reads and must not modify:
  `apps/app/src/app/app.routes.ts` (the frozen route table — it already lazy-loads
  `DashboardPage`, `ReposPage` and `RepoPage`), `core/api/api-client.ts` (`ApiClient`, `ApiError`,
  `parsePage` usage, `Page<T>`), `core/api/http.ts` (`API_BASE_URL`, `API_PREFIX`),
  `core/events/sse.service.ts`, `core/i18n/i18n.service.ts`, `core/auth/secure-store.ts`
  (`SECURE_STORE`), `src/theme/variables.css`, `src/styles.css`, `features/run-detail/*` (the
  reference implementation of a store + page + spec).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/app/features/dashboard/**`
- `apps/app/src/app/features/repos/**`

`apps/app/src/app/app.routes.ts` is a hot file and **belongs to Task-18**: this task never edits
it. `apps/app/README.md`, `src/assets/i18n/*.json` and `apps/app/package.json` are also outside
this task (see Coordination).

### Inputs (read-only)

- `apps/app/src/app/app.routes.ts`, `app.config.ts`, `app.routes.spec.ts`
- `apps/app/src/app/core/api/api-client.ts`, `core/api/api-client.spec.ts`, `core/api/http.ts`
- `apps/app/src/app/core/events/sse.service.ts`, `core/events/events.ts`
- `apps/app/src/app/core/i18n/i18n.service.ts`, `core/settings/settings.store.ts`,
  `core/auth/secure-store.ts`
- `apps/app/src/app/features/run-detail/run-detail.store.ts`, `run-detail.store.spec.ts`,
  `run.page.ts`, `run.page.spec.ts`
- `apps/app/src/theme/variables.css`, `apps/app/src/styles.css`, `apps/app/src/app/shell/tabs.page.ts`
- `packages/contracts/src/index.ts`, `resources.ts`, `primitives.ts`, `pagination.ts` (types and
  parse helpers only)
- `docs/app.md` §4, §5, §9, §10, §12; `docs/api.md` §4, §5.1, §5.2

## 🔒 Contract

### Placeholders become real, in place

Rewrite the **content** of the three existing files. Keep the file path, the exported class name
and the selector, because `app.routes.ts` imports them by name and `app.routes.spec.ts` resolves
every lazy loader:

| File | Exported class | Selector |
| --- | --- | --- |
| `features/dashboard/dashboard.page.ts` | `DashboardPage` | `app-dashboard-page` |
| `features/repos/repos.page.ts` | `ReposPage` | `app-repos-page` |
| `features/repos/repo.page.ts` | `RepoPage` | `app-repo-page` |

Each root element keeps its current `data-testid` (`page-dashboard`, `page-repos`, `page-repo`).

`RepoPage` reads its id the way `RunDetailPage` does: `readonly id = input.required<string>();`
(the router runs `withComponentInputBinding()`).

### Existing surface this task consumes — do not re-declare, do not extend

From `core/api/api-client.ts` (only these two members may be called):

```ts
class ApiClient {
  health(): Observable<Health>;
  listRuns(query?: { state?: RunState; limit?: number; cursor?: string }): Observable<Page<Run>>;
}
class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | null;
}
```

From `core/events/sse.service.ts`: `SseService.event: Signal<SseStreamEvent | null>` — subscribe in
an `effect()` exactly as `RunDetailPage` does. From `core/i18n/i18n.service.ts`:
`I18nService.locale: Signal<'en' | 'es'>`. From `core/api/http.ts`: `API_BASE_URL` (`''`) and
`API_PREFIX` (`'/v1'`).

### New surface this task creates

**`features/dashboard/dashboard.api.ts`**

```ts
import type { Telemetry } from '@codebox/contracts';

@Injectable({ providedIn: 'root' })
export class DashboardApi {
  constructor(http: HttpClient);
  telemetry(range?: Telemetry['range']): Observable<Telemetry>; // default '24h'
}
```

`GET ${API_BASE_URL}${API_PREFIX}/telemetry?range=<range>`, parsed with `parseTelemetry` from
`@codebox/contracts`. Any non-2xx or parse failure becomes an `ApiError` (see below).

**`features/dashboard/dashboard.store.ts`**

```ts
@Injectable()
export class DashboardStore {
  readonly health: Signal<Health | null>;
  readonly telemetry: Signal<Telemetry | null>;
  readonly recentRuns: Signal<readonly Run[]>;
  readonly loading: Signal<boolean>;      // true until the first of the three reads settles
  readonly stale: Signal<boolean>;        // a refetch failed while a payload is on screen
  readonly error: Signal<ApiError | null>;
  load(): void;                            // health + telemetry + listRuns({limit: 5})
  reload(): void;                          // same, without clearing what is rendered
  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored';
}
```

Rules: the three reads are independent — one failing read sets `error` but never blanks the other
two signals. `recentRuns` is the `data` array of `listRuns({ limit: 5 })` (already newest first).
`applyStreamEvent` returns `'ignored'` for everything in this task; it exists so the page has one
call site when the dashboard grows live counters. `stale` is set by `reload()`'s error handler when
the corresponding signal is already non-null.

**`features/dashboard/dashboard.page.ts`** renders, in this order:

| Hook (`data-testid`) | Content |
| --- | --- |
| `page-dashboard` | The root element (kept from the placeholder). |
| `dashboard-loading` | `t('common.loading')` while `loading()`; absent afterwards. |
| `dashboard-error` | Present when `error() !== null`; `[attr.data-code]="error().code"`, plus a `dashboard-retry` button calling `reload()`. |
| `health-vm` | `[attr.data-status]="health().status"` and the three component states `db`, `opencode`, `disk.usedPercent`. |
| `health-queue` | `[attr.data-pending]`, `[attr.data-running]`, `[attr.data-max]` from `health().queue`. |
| `health-spend` | `[attr.data-usd]` = `telemetry().spendUsd`, rendered with a local `formatUsd` (the same `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })` shape run detail uses — declare it in this folder, do not import across feature folders). |
| `recent-run` | One per run: `[attr.data-run-id]`, `[attr.data-state]`, a `routerLink` to `/runs/:id`, and the creation time. |
| `dashboard-empty` | `t('dashboard.empty')` when `recentRuns()` is empty and not loading. |
| `dashboard-stale` | Present only when `stale()`. |

**`features/repos/repos.api.ts`**

```ts
import type { Page, Repo, RepoDetail, RepoPolicy, RepoVerify } from '@codebox/contracts';

export interface RepoCreateBody {
  readonly slug: string;
  readonly defaultBranch?: string;
  readonly gate?: string;
  readonly policy?: RepoPolicy;
  readonly protectedPaths?: readonly string[];
}

export interface RepoPatchBody {
  readonly gate?: string;
  readonly policy?: RepoPolicy;
  readonly protectedPaths?: readonly string[];
  readonly enabled?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ReposApi {
  constructor(http: HttpClient);
  list(query?: { limit?: number; cursor?: string }): Observable<Page<Repo>>;   // GET  /v1/repos
  get(id: string): Observable<RepoDetail>;                                     // GET  /v1/repos/{id}
  create(body: RepoCreateBody): Observable<Repo>;                              // POST /v1/repos   (201)
  patch(id: string, body: RepoPatchBody): Observable<Repo>;                    // PATCH /v1/repos/{id}
  remove(id: string): Observable<void>;                                        // DELETE (204, no body)
  verify(id: string): Observable<RepoVerify>;                                  // POST /v1/repos/{id}/verify
}
```

Parsing: `parsePage(repoSchema, body, 'repos')` for the list, `parseRepoDetail`, `parseRepo`,
`parseRepoVerify` — all exported from `@codebox/contracts`. Never import `zod`: it is not a
dependency of `@codebox/app`.

**`features/repos/repo-form.ts`** (pure, no Angular, no I/O)

```ts
import type { RepoCreateBody } from './repos.api';

export interface RepoFormValues {
  readonly slug: string;
  readonly defaultBranch: string;
  readonly gate: string;
  readonly protectedPaths: string; // textarea, one glob per line
}

export type RepoFormProblem = 'slug' | 'defaultBranch' | 'gate';

export function validateRepoForm(values: RepoFormValues): readonly RepoFormProblem[];
export function toCreateBody(values: RepoFormValues): RepoCreateBody;
```

- `slug` must satisfy `slugSchema` from `@codebox/contracts` — `owner/name`, exactly one slash.
- `defaultBranch` must satisfy `branchSchema`.
- `gate` must be non-empty after trim.
- `protectedPaths`: split on `\n`, trim, drop empty lines; the result may be empty (the contract
  allows it). Omit the property from the body when the list is empty (`exactOptionalPropertyTypes`:
  optional means omitted, never `undefined`).

**`features/repos/repos.store.ts`**

```ts
@Injectable()
export class ReposStore {
  readonly repos: Signal<readonly Repo[]>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<ApiError | null>;
  readonly creating: Signal<boolean>;
  readonly verifyFor: Signal<string | null>;      // repo id whose verify is in flight
  readonly verification: Signal<RepoVerify | null>;
  readonly verifyError: Signal<ApiError | null>;
  load(): void;
  create(body: RepoCreateBody): void;             // POST, then append, then verify(created.id)
  verify(id: string): void;
}
```

`create()` never navigates and never optimistically inserts: the row appears only after the `201`
returns the server id (`docs/app.md` §5), then `verify()` runs immediately so the gate result is on
screen without a reload. A failed `verify` sets `verifyError` and leaves the row in place.

**`features/repos/repo.store.ts`**

```ts
@Injectable()
export class RepoStore {
  readonly repoId: Signal<string | null>;
  readonly repo: Signal<RepoDetail | null>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<ApiError | null>;
  readonly saving: Signal<boolean>;
  readonly effectiveProtectedPaths: Signal<readonly string[]>;
  load(id: string): void;
  setPolicy(policy: RepoPolicy): void;                 // optimistic, rolls back on error
  saveGate(gate: string): void;                        // PATCH { gate }
  saveProtectedPaths(paths: readonly string[]): void;   // PATCH { protectedPaths }
  verify(): void;                                       // POST verify, into verification/verifyError
  readonly verification: Signal<RepoVerify | null>;
  readonly verifyError: Signal<ApiError | null>;
}
```

`setPolicy` is the **only** optimistic action (docs/app.md §5): set the new policy on `repo()`,
send `PATCH { policy }`, and on error restore the previous `RepoDetail` **and** set `error`. On
success replace `repo()` with the server's `Repo` merged into the previous detail (the endpoint
returns a `Repo`, not a `RepoDetail`; keep `lastRun` from the old value).

**`features/<folder>/i18n.ts`** — one per folder (`dashboard/i18n.ts`, `repos/i18n.ts`), identical
shape in both:

```ts
export type Locale = 'en' | 'es';
export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>>;
export function translate(locale: Locale, key: string): string; // returns `key` when missing
```

Flat keys, prefixed `dashboard.` or `repos.`. The dictionaries live here, not in
`src/assets/i18n/*.json`, because those two files are outside this task's exclusive paths and are
shared with two other tasks in this batch. In a page:

```ts
private readonly i18n = inject(I18nService);           // declared BEFORE `t`
readonly t = (key: string): string => translate(this.i18n.locale(), key);
```

### Errors, purity, ordering

- Every HTTP failure reaches the UI as `ApiError`, mapped by one non-exported `toApiError(error)`
  in each api file: pass an `ApiError` through; for an `HttpErrorResponse` parse
  `errorEnvelopeSchema` (from `@codebox/contracts`) into `{ code, message, requestId, details }`,
  falling back to `code: 'internal'` (`'unauthorized'` for 401) and the `x-request-id` header; for
  anything else `code: 'network'`, `status: 0`. Duplicate those ~20 lines in both api files; do not
  import across feature folders and do not edit `core/api/api-client.ts`.
- `repo-form.ts`, `i18n.ts` are pure: no clock, no `fetch`, no Angular. The api and store files
  are the only ones allowed to touch the network.
- No `innerHTML` anywhere; no `localStorage`; the access token is never read by this task.
- `repo-form.ts` and the stores hold no `Date.now()` in a rendered value: timestamps come from the
  payload.

## 🧩 Configuration

None. No `CB_*` key is read by the app, and `apps/app/package.json` is not modified.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`.
  - `npm run lint` — must pass.
  - `npm test` — the root Vitest projects (packages, daemon, ops); must stay green.
  - `npm test -w @codebox/app` — runs `ng test --watch=false` (Vitest + jsdom) over
    `apps/app/src/**/*.spec.ts`, including the specs this task adds. This is the app suite; the
    root `npm test` does not include `apps/app`.
  - `npm run build` — the root build, which runs `@codebox/contracts`' prebuild and then
    `ng build` for the app.
  - `git diff --name-only main...task-19` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` Lint, both test suites and the build are green.
  - [ ] `[unit]` `features/repos/repo-form.spec.ts`: `validateRepoForm` rejects `'widgets'`,
    `'a/b/c'` and `' / '` with `['slug']`, accepts `'acme/widgets'`, rejects an empty gate and a
    branch with a space, and `toCreateBody` omits `protectedPaths` for an empty textarea and splits
    `'.github/**\nops/**'` into `['.github/**', 'ops/**']`.
  - [ ] `[unit]` `features/repos/repos.api.spec.ts` (HttpTestingController): `create` posts to
    `/v1/repos` with exactly the body built by `toCreateBody` and returns a parsed `Repo`; a 422
    envelope (`{"error":{"code":"validation_failed","message":"x","requestId":"req_1","details":{"path":"repo.slug"}}}`)
    becomes an `ApiError` with `code: 'validation_failed'` and `details.path === 'repo.slug'`;
    `list` parses `{data:[...],nextCursor:null}`; `verify` posts to `/v1/repos/repo_1/verify`.
  - [ ] `[unit]` `features/repos/repo.store.spec.ts`: `setPolicy('manual')` changes `repo().policy`
    **before** the request is flushed; flushing an error restores `'auto'` and sets `error()`; a
    second call while `saving()` is true sends nothing.
  - [ ] `[unit]` `features/repos/repos.store.spec.ts`: `create()` sends `POST /v1/repos`, then
    `POST /v1/repos/<new id>/verify`; `verification()` holds the parsed `RepoVerify` and the list
    contains the new repo — no reload, no navigation.
  - [ ] `[unit]` `features/dashboard/dashboard.store.spec.ts`: `load()` issues `GET /v1/health`,
    `GET /v1/telemetry?range=24h` and `GET /v1/runs?limit=5`; a failing telemetry read leaves
    `health()` populated and sets `error()`.
  - [ ] `[unit]` `features/repos/repos.page.spec.ts`: the wizard's submit with slug `widgets`
    renders `data-testid="repo-slug-error"` and sends **no** request; with `acme/widgets` it sends
    the POST and, after the `201`, renders `data-testid="repo-verify"` with
    `[attr.data-ok="true"]` and one `repo-check` row per `checks` entry.
  - [ ] `[unit]` `features/dashboard/dashboard.page.spec.ts`: renders `health-vm`, `health-queue`
    and `health-spend` from a fixture, five `recent-run` rows, and `dashboard-empty` for an empty
    page; an error fixture renders `dashboard-error` with its `data-code` and a working retry.
  - [ ] `[unit]` Each page spec asserts the **dictionary parity** of its own module: `STRINGS.en`
    and `STRINGS.es` have identical key sets, no empty value, and every key used by the template
    resolves (`translate(locale, key) !== key`).
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
    `git diff --name-only main...task-19` lists only files under
    `apps/app/src/app/features/dashboard/` and `apps/app/src/app/features/repos/`. In particular
    `apps/app/src/app/app.routes.ts`, `apps/app/src/assets/i18n/en.json`,
    `apps/app/src/assets/i18n/es.json`, `apps/app/package.json` and `apps/app/README.md` must not
    appear.
  - [ ] `[live]` **Reported as `[?]`, never as passing in CI.** No browser and no daemon on a
    GitHub Actions runner. Measurement on the box, with the app served by the daemon at
    `https://<tunnel>/repos`: add `acme/widgets`, and within 5 s of the `201` the verification card
    shows `ok`/`canPush` and one check row per check, **without a page reload** (a Playwright trace
    of the add flow, or a screen recording with the network panel open, pasted into the QA report).
    Blocked today: `apps/daemon/src/app.ts` registers no `/v1/repos` route and no
    `POST /v1/repos/{id}/verify`, so this criterion cannot be measured until a repos-API task
    ships. File it as `[?]` and say exactly that.

## 📣 Coordination

- **For the Architect:** the `ApiClient` in `core/api/api-client.ts` has **no** repository methods
  (`listRepos`, `getRepo`, `createRepo`, `patchRepo`, `verifyRepo`) and **no** telemetry method,
  and this task may not edit that file. Hence `ReposApi` and `DashboardApi` live in the feature
  folders. When a later task owns `core/api/**`, both collapse into `ApiClient` — do not add a
  second copy there without deleting these.
- **For the Architect:** the daemon implements `/v1/chat`, `/v1/jobs`, `/v1/runs` and
  `/v1/approvals` but **not** `/v1/repos` (`docs/api.md` §5.2 is documented and unimplemented, and
  no open task owns it). The `[live]` criterion is `[?]` until that route exists.
- **For the batch owner, once, after the merge:** `apps/app/README.md` needs these lines (this task
  must not touch it — three tasks in this batch add files to the same map):
  `src/app/features/dashboard/dashboard.api.ts`, `dashboard.page.spec.ts`,
  `dashboard.store.ts`, `dashboard.store.spec.ts`, `i18n.ts`; and for repos:
  `repo-form.ts`, `repo-form.spec.ts`, `repo.page.spec.ts`, `repo.store.ts`, `repo.store.spec.ts`,
  `repos.api.ts`, `repos.api.spec.ts`, `repos.page.spec.ts`, `repos.store.ts`,
  `repos.store.spec.ts`, `i18n.ts` — one line each, replacing the three placeholder lines.
- **For Task-23 (settings, next cycle):** the same `i18n.ts` shape and the same local-api pattern
  are the batch convention; reuse them rather than editing the shared dictionaries.
- **For QA:** `provideIonicAngular()` and a memory `SECURE_STORE` stub are required to mount a page
  (the i18n service injects the settings store, which injects the secure store). The page specs
  mount the **real** stores, so also provide `provideHttpClient()` +
  `provideHttpClientTesting()` and flush every read and write with `HttpTestingController`, exactly
  as `features/run-detail/run-detail.store.spec.ts` does; do not hand-write a fake `ApiClient`.

## ⛔ Out of scope

- No change to `app.routes.ts`, `main.ts`, `app.config.ts`, `angular.json`, `package.json`,
  `package-lock.json`, `packages/contracts/**`, `src/assets/i18n/*.json`.
- No new dependency (no form library: `@angular/forms` is already a dependency, but plain signals
  and template bindings are enough — prefer them).
- No glob matcher and no re-implementation of the protected-paths guardrail: the "preview" is the
  exact JSON array the `PATCH` will send (`data-testid="protected-paths-preview"`), because the
  authoritative matcher lives in `packages/workspaces` and a second one in the app would let the UI
  disagree with the gate.
- No approvals badge on the dashboard: `features/approvals/**` belongs to no task in this batch.
- No offline snapshot, no service-worker cache change, no push.
- No repository deletion UI (the API route exists; the screen does not ask for it).
- No edit to `CHANGELOG.md` or `TODO.md` (the Orchestrator owns both).

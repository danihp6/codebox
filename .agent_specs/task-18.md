# Spec: Task-18 — App shell

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app.
- **Role:** Dev.
- **Objective:** after this task `apps/app` is a real Angular 22 + Ionic 9 + Capacitor hybrid
  shell: it builds with `ng build`, its unit tests run headless with `ng test --watch=false`,
  and it predeclares every route of `docs/app.md` §4 behind lazy standalone placeholders, so
  Tasks 19–23 only fill feature folders. It ships the theme tokens, the tab bar, the generated-
  types API client, the pairing/auth flow with a secure-store port (nothing in `localStorage`),
  the SSE service (backoff, `Last-Event-ID`, `gap`), the EN/ES i18n scaffold, the PWA manifest
  and service worker. The root gate keeps passing with the app present.
- **Environment:** worktree `../wt-cb-18`, branch `task-18`, base `main`.
- **Dependencies (all merged):**
  - Task-03 `packages/contracts` — `healthSchema`, `versionSchema`, `meSchema`, `deviceSchema`,
    the `chat.*`/`run.*` event schemas, `sseStreamEventSchema`, `sseGapEventSchema`,
    `errorEnvelopeSchema`, the parse helpers, `PAGINATION_DEFAULT_LIMIT`.
  - Task-12 `apps/daemon/src/auth/**` + `docs/api.md` §2 — the pairing, refresh and `me` shapes.

### Exclusive paths (single writer)

`apps/app/**` is yours entirely; no other task in this batch touches it. The files below are the
ones this task must create or change — nothing outside them:

- `apps/app/angular.json`, `apps/app/tsconfig.json`, `apps/app/tsconfig.app.json`,
  `apps/app/tsconfig.spec.json`, `apps/app/package.json`, `apps/app/capacitor.config.ts`,
  `apps/app/ngsw-config.json`, `apps/app/README.md`.
- `apps/app/src/index.html`, `apps/app/src/main.ts`, `apps/app/src/styles.css`,
  `apps/app/src/manifest.webmanifest`, `apps/app/public/icons/*` (two PNG icons),
  `apps/app/src/assets/i18n/en.json`, `apps/app/src/assets/i18n/es.json`.
- `apps/app/src/app/app.component.ts`, `app.config.ts`, `app.routes.ts`, `app.routes.spec.ts`.
- `apps/app/src/app/shell/tabs.page.ts` (+ `tabs.page.spec.ts`).
- `apps/app/src/app/core/api/{api-client.ts,api-client.spec.ts,http.ts}`.
- `apps/app/src/app/core/auth/{auth.store.ts,auth.store.spec.ts,pairing.ts,secure-store.ts,
  secure-store.spec.ts,auth.interceptor.ts,auth.guard.ts}`.
- `apps/app/src/app/core/events/{sse-client.ts,sse-client.spec.ts,sse.service.ts,events.ts}`.
- `apps/app/src/app/core/i18n/{i18n.service.ts,i18n.spec.ts}`.
- `apps/app/src/app/core/settings/{settings.store.ts}`.
- `apps/app/src/app/features/{dashboard,repos,chat,jobs,runs-list,run-detail,approvals,settings,
  pairing,about}/*.page.ts` — one placeholder page per feature, no logic.
- `apps/app/src/theme/{variables.css,tokens.ts}`.
- `docs/app.md` — **section 1, `## 1. Stack`, only** (two rows: `HTTP` and `Stream`, plus the
  `i18n` row — see Coordination).
- `package-lock.json` — **hot file, you alone**: the lockfile for the new dependencies. Nobody
  else in this batch touches it.
- `eslint.config.js` — additive only: one config block giving browser globals to
  `apps/app/**/*.ts`. Do not edit the existing blocks, the ignore list or the imports.
- root `package.json` — **avoid**. Change it only if the app cannot be built/tested otherwise,
  and if you do, the only allowed change is a `prebuild`/`pretest` hook that already exists in
  spirit; prefer zero edits and say so in the report.

Explicitly not yours: `apps/daemon/**`, `packages/**`, `tsconfig.base.json`, `opencode.json`,
`TODO.md`, `CHANGELOG.md`, `docs/decisions.md`, `docs/providers.md`, `docs/api.md`,
`.github/**`, `ops/**`.

### Inputs (read-only)

- `docs/app.md` (all), `docs/web.md` if present, `docs/api.md` §2, §4, §5.1, §6, §7,
  `docs/security.md` (device pairing, token lifetime), `docs/providers.md` §2 (`CB_PUBLIC_URL`).
- `packages/contracts/src/{index,resources,events,primitives,errors,parse,pagination}.ts` and
  `packages/contracts/dist/**` (what the browser bundle actually imports).
- `packages/contracts/README.md`, `apps/app/README.md`, `apps/app/package.json`,
  `eslint.config.js`, `package.json`, `vitest.config.ts`, `tsconfig.base.json`.
- `apps/daemon/src/app.ts` (the endpoints the client speaks to), `apps/daemon/README.md`.

## 🔒 Contract

### Package and scripts (frozen)

```jsonc
// apps/app/package.json — exact versions, no ^ or ~ anywhere
{
  "name": "@codebox/app",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "prebuild": "npm run build -w @codebox/contracts",
    "build": "ng build",
    "test": "ng test --watch=false",
    "start": "ng serve"
  }
}
```

Dependencies (exact): `@angular/common`, `@angular/compiler`, `@angular/core`,
`@angular/forms`, `@angular/platform-browser`, `@angular/router`, `@angular/service-worker`
at `22.2.3`; `@ionic/angular` at `9.0.9`; `@capacitor/core`, `@capacitor/android`,
`@capacitor/ios` at `8.5.3`; `@codebox/contracts` at `0.0.0`; `rxjs`, `tslib` and `ionicons` at
the exact versions `npm view <pkg> version` resolves today and that satisfy
`@angular/core@22.2.3` / `@ionic/angular@9.0.9` peers. DevDependencies: `@angular/build`,
`@angular/cli`, `@angular/compiler-cli` at `22.2.3`; `@capacitor/cli` at `8.5.3`; `jsdom` at the
exact version `@angular/build@22.2.3` expects; `typescript` at the version the Angular 22.2
compiler requires; `vitest` at `4.1.12` (the same version the root already pins, so npm hoists one
copy — if `@angular/build@22.2.3` demands a different major, declare that exact version in the app
and leave the root copy and the root `package.json` alone; two copies are acceptable). No `sass`,
no `@ngx-translate`, no state library, no `@capacitor/preferences`.

**Unit runner decision (pinned):** Angular 22's built-in test target,
`@angular/build:unit-test`, with Vitest in a Node process and `jsdom` as the DOM emulation.
`ng test --watch=false` is the whole command: no Karma, no Jasmine, no `browsers` array, no
browser download, no interactive watch. `angular.json` carries:

```jsonc
"test": {
  "builder": "@angular/build:unit-test",
  "options": { "tsConfig": "tsconfig.spec.json", "include": ["src/**/*.spec.ts"] }
}
```

If the installed `@angular/build@22.2.3` rejects that option set, report the literal error and
stop; do not switch runners.

Build target: `outputPath: "dist"`, `index: "src/index.html"`, `browser: "src/main.ts"`,
`polyfills: []` (zoneless), `serviceWorker: "ngsw-config.json"`, `assets` =
`src/assets` → `assets`, `public` → `.`, plus `src/manifest.webmanifest`, `styles` =
`node_modules/@ionic/angular/css/core.css`, `normalize.css`, `structure.css`, `typography.css`,
`display.css` (from the same package) plus `src/theme/variables.css` and `src/styles.css`. No
budgets block in this task. `defaultConfiguration: "production"`; the production configuration
sets `outputHashing: "all"` and nothing that would need a server. Every `*.spec.ts` imports
`describe/it/expect` from `'vitest'` explicitly (no globals), and `tsconfig.spec.json` includes
`src/**/*.spec.ts` and `src/**/*.d.ts`.

`apps/app/tsconfig.json` does **not** extend `tsconfig.base.json` (that file is a hot file owned
by nobody in this batch): it is the Angular CLI v22 standalone tsconfig plus the strict flags
`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`. `main.ts` uses `bootstrapApplication(AppComponent, appConfig)`.

`eslint.config.js` gains exactly one appended config object, after the existing ones, and
`globals` is already imported at the top of the file:

```js
{
  files: ['apps/app/**/*.ts'],
  languageOptions: { globals: globals.browser },
}
```

Nothing else in `eslint.config.js` changes: not the `ignores`, not the node block, not the
imports.

### Composition (frozen names)

```ts
// apps/app/src/app/app.config.ts
export const appConfig: ApplicationConfig; // providers below, in this order
// provideZonelessChangeDetection()
// provideIonicAngular({ mode: 'md' })
// provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }))
// provideHttpClient(withFetch(), withInterceptors([authInterceptor]))
// provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registerWhenStable: 30000 })
// { provide: I18N_DICTIONARIES, useValue: ... } is NOT used: dictionaries load from assets.
```

```ts
// apps/app/src/app/app.routes.ts — every route, lazy, declared here and never by a feature task
export const routes: Routes;
```

| Path | Lazy loader | Tab |
| --- | --- | --- |
| `''` | redirect to `dashboard` | — |
| `pair` | `features/pairing/pairing.page` | no |
| `dashboard` | `features/dashboard/dashboard.page` | 1 |
| `repos` | `features/repos/repos.page` | no |
| `repos/:id` | `features/repos/repo.page` | no |
| `chat` | `features/chat/chat-list.page` | 2 |
| `chat/:id` | `features/chat/chat.page` | no |
| `jobs` | `features/jobs/jobs.page` | 3 |
| `jobs/:id` | `features/jobs/job.page` | no |
| `runs` | `features/runs-list/runs.page` | 4 |
| `runs/:id` | `features/run-detail/run.page` | no |
| `approvals` | `features/approvals/approvals.page` | no |
| `settings` | `features/settings/settings.page` | 5 |
| `settings/devices` | `features/settings/devices.page` | no |
| `about` | `features/about/about.page` | no |
| `**` | `features/about/about.page` (404 state) | — |

Every feature page is a standalone component with `ChangeDetectionStrategy.OnPush`, an
`ion-header`/`ion-content` and one `data-testid` (`page-dashboard`, `page-chat`, …). Placeholders
render the page title and the words `tasks 19-23`; they hold no state and no HTTP call.

```ts
// apps/app/src/app/core/api/api-client.ts
export interface ApiConfig { readonly baseUrl: string; }
export class ApiError extends Error {
  readonly status: number; readonly code: string; readonly requestId: string | null;
  readonly details: Record<string, unknown> | null;
}
export class ApiClient {
  constructor(http: HttpClient, config: ApiConfig);
  health(): Observable<Health>;
  version(): Observable<Version>;
  issuePairingCode(body: { name: string; ttlSeconds?: number }): Observable<unknown>;
  pair(body: { code: string; deviceName: string; platform: 'web' | 'ios' | 'android';
    devicePublicKey: string }): Observable<PairResult>;
  refresh(refreshToken: string): Observable<TokenPair>;
  me(): Observable<Me>;
  logout(): Observable<void>;
  listRuns(query?: { state?: RunState; limit?: number; cursor?: string }): Observable<Page<Run>>;
  listJobs(query?: { limit?: number; cursor?: string }): Observable<Page<Job>>;
}
export interface PairResult {
  readonly device: Device; readonly accessToken: string; readonly refreshToken: string;
  readonly expiresIn: number; readonly scopes: readonly Scope[];
}
export interface TokenPair {
  readonly accessToken: string; readonly refreshToken: string;
  readonly expiresIn: number; readonly scopes: readonly Scope[];
}
```

Every method parses its body with the matching `@codebox/contracts` helper (`parseHealth`,
`parseVersion`, `parseMe`, `parseRun`, `parseJob`, `parsePage`) and throws `ApiError` on a
`ContractParseError` (`code: "contract"`, `status: 200`) or on an error envelope (the envelope's
`code`, `requestId`, `details`). The client never logs a body.

```ts
// apps/app/src/app/core/auth/secure-store.ts
export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}
export const REFRESH_TOKEN_KEY = 'cb.refreshToken';
export function createSecureStore(options?: {
  readonly indexedDb?: IDBFactory | null; readonly crypto?: Crypto;
}): SecureStore;
```

`createSecureStore` returns an IndexedDB-backed store when `globalThis.indexedDB` exists: the
refresh token is AES-GCM encrypted with a non-extractable `CryptoKey` generated on first use and
stored in the same database (`codebox-secure`, store `keys`, record `wrap`). When IndexedDB is
absent (unit tests, SSR) it returns an in-memory store. `localStorage` and `sessionStorage` are
never touched — `grep -rn "localStorage\|sessionStorage" apps/app/src` must print nothing.

```ts
// apps/app/src/app/core/auth/auth.store.ts
@Injectable({ providedIn: 'root' })
export class AuthStore {
  readonly scopes: Signal<readonly Scope[]>;
  readonly device: Signal<Device | null>;
  readonly signedIn: Signal<boolean>;
  readonly accessToken: Signal<string | null>;   // memory only, never persisted
  pair(input: { code: string; deviceName: string; platform: 'web' | 'ios' | 'android' }):
    Promise<void>;                               // POST /v1/pair, persists the refresh token
  restore(): Promise<boolean>;                   // refresh from the secure store; true when signed in
  refresh(): Promise<boolean>;                   // single flight; rotates both tokens
  logout(): Promise<void>;                       // POST /v1/auth/logout, clears the secure store
}
export function authInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>>;
export const authGuard: CanActivateFn;           // /pair is the only public route
```

The device public key is generated per install with `crypto.subtle.generateKey({ name: 'ECDSA',
namedCurve: 'P-256' }, false, ['sign'])`; the exported public key is sent as a JWK string. The
interceptor attaches `Authorization: Bearer <accessToken>` to every relative `/v1/` request,
retries once through `AuthStore.refresh()` on a `401` (one shared in-flight refresh), and on a
second `401` logs out and routes to `/pair`.

```ts
// apps/app/src/app/core/events/sse-client.ts
export interface SseFrame {
  readonly id: string | null;
  readonly event: string;                  // 'message' when the frame had no event line
  readonly data: string;
}
export interface SseClientOptions {
  readonly url: string;
  readonly token: () => string | null;
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
  readonly onFrame: (frame: SseFrame) => void;
  readonly onGap: (data: { afterId: number; latestId: number }) => void;
  readonly onState: (state: 'connecting' | 'open' | 'closed') => void;
}
export interface SseClient {
  start(afterId: number): void;      // opens the stream, resuming from `afterId`
  markProcessed(id: number): void;   // the resume point, never the last id received
  stop(): void;
  readonly backoffMs: () => number;
}
export function createSseClient(options: SseClientOptions): SseClient;
export function parseSseChunk(buffer: string): { frames: SseFrame[]; rest: string };
```

`EventSource` cannot send the bearer, so the client uses `fetch` with
`headers: { accept: 'text/event-stream', 'last-event-id': String(afterId) }` and reads
`response.body.getReader()` with a `TextDecoder`. Backoff: `1000 * 2^attempt`, capped at `30000`,
multiplied by `0.8 + 0.4 * random()`; reset to `1000` after the first frame; `retry:` in the
stream is ignored (the server's `retry: 3000` is advisory, docs/api.md §6). A `gap` frame calls
`onGap` and reopens from `latestId`. Docs/app.md §7's `document.hidden` pause belongs to Task-20;
this task only exposes `stop()`/`start()`.

```ts
// apps/app/src/app/core/i18n/i18n.service.ts
export type Locale = 'en' | 'es';
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly locale: Signal<Locale>;
  readonly t: (key: string) => string;      // 'missing:<key>' when absent, never an exception
  set(locale: Locale): Promise<void>;        // loads /assets/i18n/<locale>.json once, persists the choice
  readonly available: readonly Locale[];     // ['en', 'es']
}
```

`assets/i18n/en.json` and `es.json` define the same key set (nested objects with string leaves):
`app.title`, `tabs.{dashboard,chat,jobs,runs,settings}`, `pair.{title,code,deviceName,submit,
error}`, `common.{retry,cancel,loading,error,empty}`. Spanish is the default (`D24`), English is
the switch.

### Data and styling

- Theme tokens in `src/theme/variables.css` as CSS custom properties on `:root`:
  `--cb-bg`, `--cb-surface`, `--cb-text`, `--cb-muted`, `--cb-accent` (`#22c55e`), `--cb-warn`
  (`#f59e0b`), `--cb-danger` (`#ef4444`), `--cb-radius` (`12px`), `--cb-space` (`4px` scale),
  `--cb-font-mono`. Dark is the default; `prefers-color-scheme: light` overrides the four colour
  tokens. No gradient, no glass.
- `manifest.webmanifest`: `name: "Codebox"`, `short_name: "Codebox"`, `start_url: "/"`,
  `display: "standalone"`, `background_color: "#0b0f14"`, `theme_color: "#0b0f14"`, two
  `icons` (192/512, `purpose: "any maskable"`).
- `ngsw-config.json` caches the app shell only (`/index.html`, `/manifest.webmanifest`,
  `/*.js`, `/*.css`, `/assets/**`, `/icons/**`); **no `/v1/**` route is cached**.
- Capacitor: `capacitor.config.ts` with `appId: "com.codebox.app"`, `appName: "Codebox"`,
  `webDir: "dist/browser"`, `server.androidScheme: "https"`. No `ios/` or `android/` folder is
  generated in this task (`npx cap add` is Task-29's job).

### Docs (§1 Stack, Task-18's section)

Two rows change and one is added, and nothing else in `docs/app.md` moves:

- `HTTP` → "`HttpClient` + `withFetch()` behind a typed `ApiClient` written against
  `packages/contracts` parse helpers; one source of truth for payloads." (No generator exists in
  the tree; drop the word "generated" until one does.)
- `Stream` → "`fetch` + `ReadableStream` SSE reader with `Last-Event-ID` and backoff
  (`EventSource` cannot send the bearer header)."
- `i18n` → "Signal-based `I18nService` with `assets/i18n/{en,es}.json`; no third-party i18n
  runtime (bundle budget, no extra dependency)."
- `Tests` → add "(Vitest via `ng test`, headless, jsdom)".

## 🧩 Configuration

The app reads no `CB_*` variable at runtime. Build-time configuration is one token in
`src/app/core/api/http.ts`: `export const API_BASE_URL = '';` (same origin; the daemon serves the
build) and `export const API_PREFIX = '/v1';`. Do not add an environment file, a `.env`, or a
runtime config fetch.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (the new lockfile must install cleanly).
  - `npm run lint` — must pass, including `apps/app/**/*.ts` under the browser globals entry.
  - `npm test` — the root Vitest run; it must still pass and must not pick up `apps/app`.
  - `npm run test -w @codebox/app` — `ng test --watch=false`, headless, jsdom, no browser.
  - `npm run build` — the root build; it now runs the app build too.
  - `test -f apps/app/dist/browser/index.html && echo present` — prints `present`.
  - `grep -rn "localStorage\|sessionStorage" apps/app/src` — must print nothing (exit 1).
  - `git diff --name-only main...task-18` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `ng build` and `ng test` pass:
    `npm run build -w @codebox/app` then `npm run test -w @codebox/app` both exit `0`, and
    `apps/app/dist/browser/index.html` exists.
  - [ ] `[unit]` A mocked API pairing succeeds and stores nothing in `localStorage`:
    `npm run test -w @codebox/app` (the `auth.store.spec.ts` case named
    "pairs against a mocked API and persists nothing in localStorage"). The test installs a recording
    `globalThis.localStorage` stub, pairs against an `HttpTestingController`/fetch stub, asserts
    `AuthStore.signedIn()` is true, the access token is only in the signal, and the stub recorded
    zero `setItem` calls; the refresh token went through the injected `SecureStore`.
  - [ ] `[unit]` The SSE client reconnects with backoff and resumes from `Last-Event-ID`:
    `npm run test -w @codebox/app` (the `sse-client.spec.ts` case named "reconnects with
    backoff and resumes from Last-Event-ID"). With a fetch stub that closes
    the stream after one frame and a fixed `random = () => 0.5`, the delays are `1000`, `2000`,
    `4000` ms, the third request carries `last-event-id` equal to the id passed to
    `markProcessed`, and a `gap` frame calls `onGap` with the decoded `{ afterId, latestId }`.
  - [ ] `[unit]` Every route exists and every lazy loader resolves:
    `npm run test -w @codebox/app` (the `app.routes.spec.ts` case named "predeclares every
    route and resolves every lazy loader"). The test walks the table
    above, asserts each `path`, and awaits each `loadComponent()` so a typo fails the suite.
  - [ ] `[unit]` i18n parity: `npm run test -w @codebox/app` (the `i18n.spec.ts` case named
    "en and es share one key set") — the flattened key sets of `en.json` and `es.json` are
    identical and `t('missing.key')` returns `missing:missing.key`.
  - [ ] `[unit]` The root gate is unchanged: `npm run lint`, `npm test` and `npm run build` at the
    root all pass with the app present.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched: the `git diff --name-only`
    output lists only `apps/app/**`, `docs/app.md`, `package-lock.json` and `eslint.config.js`
    (plus root `package.json` only if you had to, justified in the report).
  - [ ] `[live]` The built PWA runs in a mobile viewport with no horizontal scroll and the pairing
    screen is usable at 320 px. Measurement: serve `apps/app/dist/browser` (or the daemon at
    `CB_INSTALL_DIR/app`), open `/pair` at 320×640 and 390×844 in Chromium device emulation; read
    `document.documentElement.scrollWidth <= window.innerWidth` (true at both sizes), the submit
    button's `getBoundingClientRect().width >= 44` and `height >= 44`, and tap through a pairing
    against the real daemon. Not run on CI.

## 📣 Coordination

- For the Architect: the stack doc said "generated client" and "`EventSource`"; neither is
  possible in this tree (no generator, and `EventSource` cannot send a bearer). §1 is this task's
  section and is amended above; `docs/decisions.md` is untouched.
- For Tasks 19–23: the router is frozen. A feature task fills
  `apps/app/src/app/features/<folder>/` and replaces the placeholder page in place; it never
  edits `app.routes.ts`, `app.config.ts`, `main.ts` or `angular.json`. Shared components appear
  in `apps/app/src/app/shared/` only when a second feature needs them, and that folder is created
  by the first task that needs it.
- For Task-16 (push) and Task-23 (settings): `SecureStore` is the only place a secret is kept;
  the service worker must never cache `/v1/**`.
- For Task-26 (e2e): the stable hooks are the `data-testid` values `page-<name>`, `pair-code`,
  `pair-submit`, `tab-<name>` and `sse-connection` (`data-state` = `open|connecting|closed`).
- `@codebox/contracts` is imported by value; its `dist` must exist before `ng build`, hence the
  `prebuild` script. If a root build order ever changes, that script is the reason.

## ⛔ Out of scope

- No native `ios/`/`android/` folders, no signing, no store listing, no `npx cap sync` in CI.
- No feature logic: no dashboards, no chat, no cron picker, no run timeline, no push
  subscription, no deep-link handler.
- No new runtime dependency beyond the table above; no state library; no CSS framework; no
  `sass`; no `@capacitor/preferences`.
- No budgets block, no Lighthouse gate, no Playwright suite (Task-26).
- No change to `docs/app.md` outside §1, no change to `packages/**`, `apps/daemon/**` or
  `tsconfig.base.json`.

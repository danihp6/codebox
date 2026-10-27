# Spec: Task-66 — Unpaired and offline (D45's client half)

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (auth hand-off + one shared component). No daemon, no package.
- **Role:** Dev.
- **Objective:** after this task a 401 has **one** hand-off — the session is cleared, the
  reason is kept, and the browser lands on `/pair?reason=<code>` — and the app tells the
  operator when it is showing cached data instead of pretending a tap worked: one banner,
  driven by a connectivity signal, that clears on the first successful response and never
  queues a write.
- **Environment:** worktree `../wt-cb-66`, branch `task-66`, base `main` (`origin/main` @
  `c72dd61`).
- **Dependencies (merged):** Task-51 (contract only, nothing you consume changed); Task-18
  (`AuthStore`, `authGuard`, `authInterceptor`, `I18nService`, `AppComponent`); Task-50 (the
  real pairing screen, which is the redirect target — you do **not** edit it); Task-49 (the
  root `npm test` runs the app suite).

### Exclusive paths (single writer)

Nothing outside this list. No other task in this batch claims any of these.

- `apps/app/src/app/core/auth/auth.guard.ts`
- `apps/app/src/app/core/auth/auth.guard.spec.ts` (new)
- `apps/app/src/app/core/auth/auth.interceptor.ts`
- `apps/app/src/app/core/auth/auth.interceptor.spec.ts` (new)
- `apps/app/src/app/core/auth/signed-out.ts` (new)
- `apps/app/src/app/core/auth/signed-out.spec.ts` (new)
- `apps/app/src/app/shared/offline-banner.ts` (new — create the `shared/` folder)
- `apps/app/src/app/shared/offline-banner.i18n.ts` (new)
- `apps/app/src/app/shared/offline-banner.spec.ts` (new)
- `apps/app/src/app/app.component.ts`
- `apps/app/src/app/app.component.spec.ts` (new)
- `apps/app/README.md` — every new file above needs its line, or `readme.spec.ts` fails.

Explicitly **not** yours: `apps/app/src/app/features/pairing/**` (Task-50, merged — the
screen reads its own copy), `apps/app/src/app/app.routes.ts` and `app.config.ts` (Task-55 owns
them in this batch), `apps/app/src/app/shell/**` (Task-55), `apps/app/src/app/core/auth/
auth.store.ts`, `secure-store.ts`, `pairing.ts`, `core/api/**`, `core/events/**`,
`core/i18n/**`, `apps/app/src/assets/i18n/{en,es}.json` (the shared dictionaries are a hot
file; your copy lives in your own module, per `docs/app.md` §9), `docs/app.md`, `TODO.md`,
`CHANGELOG.md`, `docs/decisions.md`.

### Inputs (read-only)

Beyond `AGENTS.md`:

- `apps/app/src/app/core/auth/auth.store.ts` (`signedIn`, `restore`, `refresh`, `logout`),
  `auth.guard.ts`, `auth.interceptor.ts`, `secure-store.ts`
- `apps/app/src/app/core/api/api-client.ts`, `core/api/http.ts` (`API_PREFIX`),
  `core/i18n/i18n.service.ts`, `core/events/sse.service.ts`
- `apps/app/src/app/app.component.ts`, `app.routes.ts`, `app.config.ts`
- `apps/app/src/app/features/pairing/i18n.ts` and `pairing.page.ts` (the copy pattern; **read
  only** — do not add keys to it)
- `apps/app/src/app/shell/tabs.page.spec.ts` (the `TestBed` + `SECURE_STORE` pattern)
- `docs/app.md` §9 (dictionary rule) and §10 (offline and failure table), `design/README.md`
  §2 (frames `13` and `L19`, the Offline banner)

## 🔒 Contract

### `core/auth/signed-out.ts` (new) — the reason, in one place

```ts
export const SIGNED_OUT_REASONS = ['unpaired', 'session_expired', 'revoked'] as const;
export type SignedOutReason = (typeof SIGNED_OUT_REASONS)[number];

/** `/pair?reason=…` uses this query key. */
export const SIGNED_OUT_PARAM = 'reason';

/** The reason of the last automatic sign-out, or null after a successful pair. */
export const signedOutReason: Signal<SignedOutReason | null>;

export function setSignedOutReason(reason: SignedOutReason | null): void;
export function pairUrlFor(reason: SignedOutReason): string; // `/pair?reason=<reason>`
export function reasonFromPairUrl(url: string): SignedOutReason | null;
```

A module-level `signal` (no service, no DI) so the guard and the interceptor read the same value
without a provider. `reasonFromPairUrl` parses a full URL or a router URL
(`/pair?reason=revoked`) and returns `null` for a missing or unknown value. `pairUrlFor` returns
`'/pair?reason=unpaired'` for `'unpaired'`, and so on — the three codes are the only values.

### `core/auth/auth.guard.ts`

```ts
export const authGuard: CanActivateFn; // name, type and behaviour preserved
```

Behaviour, in order: `auth.signedIn()` → `true`; `await auth.restore()` → `true`;
otherwise `setSignedOutReason('unpaired')` and return
`router.createUrlTree(['/pair'], { queryParams: { [SIGNED_OUT_PARAM]: 'unpaired' } })`.
The exported symbol stays `authGuard: CanActivateFn` — Task-55's router imports it by that
name.

### `core/auth/auth.interceptor.ts`

```ts
export function authInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn):
  Observable<HttpEvent<unknown>>; // signature unchanged
```

- Unchanged: the two header/retry rules, the `x-cb-retried` guard, the `isAuthFree` list.
- The session hand-off is now:

  ```ts
  async function leaveSession(auth: AuthStore, router: Router, reason: SignedOutReason) {
    await auth.logout();            // clears the access token and the secure store
    setSignedOutReason(reason);
    await router.navigateByUrl(pairUrlFor(reason));
  }
  ```

  `session_expired` when the refresh itself fails; `revoked` when the **retried** request is
  still a 401 (the device was revoked while the token was fresh).
- Connectivity: every successful response calls `ConnectivityStore.markFresh()`; an
  `HttpErrorResponse` with `status === 0` (no response at all) calls
  `ConnectivityStore.markStale()`. Both through `inject(ConnectivityStore)` — no new
  constructor argument.
- Nothing is queued, buffered or replayed on failure.

### `shared/offline-banner.ts` (new)

```ts
@Injectable({ providedIn: 'root' })
export class ConnectivityStore {
  readonly online: Signal<boolean>;     // navigator.onLine + 'online'/'offline' events
  readonly stale: Signal<boolean>;      // set by a status-0 failure, cleared by any success
  readonly readOnly: Signal<boolean>;   // !online() || stale()
  readonly bannerVisible: Signal<boolean>; // readOnly()
  connect(): void;    // idempotent; attaches the listeners once
  disconnect(): void; // removes them
  markStale(): void;
  markFresh(): void;
}

@Component({ selector: 'app-offline-banner', standalone: true, changeDetection: OnPush })
export class OfflineBanner {
  readonly i18n: I18nService;
  readonly store: ConnectivityStore;
  readonly text: Signal<string>;      // offline.banner
  readonly detail: Signal<string>;    // offline.readOnly
}
```

Template, exactly: when `store.bannerVisible()` is true, one element
`<aside data-testid="offline-banner" role="status">` holding `{{ text() }}` and a second line
`{{ detail() }}`; when false, nothing is rendered (no hidden node). No `px` literal: size with
`var(--cb-space)` and the existing theme tokens. It is read-only copy — no button, no retry
handler (the SSE client already retries; a manual retry is Task-57's composer work, not this).

`shared/offline-banner.i18n.ts` (new) follows `features/pairing/i18n.ts` exactly:

```ts
export type Locale = 'en' | 'es';
export function translate(locale: Locale, key: string): string;
```

with these four entries, EN and ES complete:

| key | en | es |
| --- | --- | --- |
| `offline.banner` | `Offline — showing the last synced data.` | `Sin conexión: mostrando los últimos datos sincronizados.` |
| `offline.readOnly` | `Changes are disabled until the box answers.` | `Los cambios están desactivados hasta que la caja responda.` |

The component resolves copy through `translate(i18n.locale(), key)` and falls back to the EN
string when the locale is unknown; `I18nService.t` is **not** used (the shared dictionary is not
edited).

### `app.component.ts`

- Imports `OfflineBanner` and renders `<app-offline-banner />` inside `<ion-app>`, after
  `<ion-router-outlet>` and before the closing tag (so it sits above the tab bar visually via
  `position: sticky` inside the banner's own styles).
- `showTabs` keeps hiding the tab bar **only** on `/pair`; the banner renders on `/pair` too
  (an unpaired device can also be offline). Nothing else in this file changes — no new
  injected service, no new signal.

## 🧩 Configuration

No `CB_*` key. No environment change.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint`
  - `npm test` — the root gate: `test:guard`, then `npm test -w @codebox/app`
    (`ng test --watch=false`, your specs included), then every Vitest project.
  - `npm run build` — `ng build` clean.
  - Fast loop if needed: from `apps/app`, `npx ng test --watch=false
    --include='src/app/**/*.spec.ts'`; the root `npm test` is the authority.
  - `git diff --name-only main...task-66` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `npm run lint && npm test && npm run build` pass.
  - [ ] `[unit]` `auth.guard.spec.ts`: signed out plus `restore()` resolving `false` returns a
        `UrlTree` whose `toString()` is `/pair?reason=unpaired` and `signedOutReason()` is
        `'unpaired'`; `signedIn()` true returns `true` without calling `restore`; `restore()`
        resolving `true` returns `true`.
  - [ ] `[unit]` `auth.interceptor.spec.ts`: a 401 whose refresh fails calls `AuthStore.logout`
        once and navigates to `/pair?reason=session_expired`; a 401 on the retried request
        navigates to `/pair?reason=revoked`; a non-401 error navigates nowhere.
  - [ ] `[unit]` `signed-out.spec.ts`: `pairUrlFor` maps all three codes;
        `reasonFromPairUrl('/pair?reason=revoked')` is `'revoked'`, an unknown value and a
        missing value are both `null`.
  - [ ] `[unit]` `offline-banner.spec.ts`: `markStale()` flips `bannerVisible()` to true and
        renders exactly one `[data-testid="offline-banner"]`; `markFresh()` hides it (the
        element is absent, not merely hidden); a dispatched `offline`/`online` event flips
        `online()`; `readOnly()` is true while either is set; `connect()` twice attaches the
        listeners once.
  - [ ] `[unit]` `offline-banner.i18n.ts` has EN/ES parity: the two dictionaries have the same
        keys, all four values non-empty, and `translate('es', 'offline.banner')` matches the
        table above.
  - [ ] `[unit]` `app.component.spec.ts` mounts `AppComponent` in a `TestBed` (the
        `tabs.page.spec.ts` provider recipe: `provideRouter([])`, `provideIonicAngular()`,
        `{ provide: SECURE_STORE, useValue: memoryStore() }`, plus stubs for `SseService` and
        `I18nService`) and asserts `querySelector('app-offline-banner')` exists when the
        connectivity store is stale. If mounting proves impossible headless, fall back to
        reading `app.component.ts` and asserting its template contains `<app-offline-banner`
        — and say which form you used in the report.
  - [ ] `[unit]` `apps/app/README.md` lists every new file (`shared/offline-banner.ts`,
        `shared/offline-banner.i18n.ts`, `shared/offline-banner.spec.ts`,
        `core/auth/signed-out.ts`, `core/auth/signed-out.spec.ts`,
        `core/auth/auth.guard.spec.ts`, `core/auth/auth.interceptor.spec.ts`,
        `app.component.spec.ts`), so `readme.spec.ts` stays green.
  - [ ] `[unit]` the diff names only the twelve exclusive paths; no `features/**`, no
        `app.routes.ts`, no `app.config.ts`, no `core/auth/auth.store.ts`, no
        `assets/i18n/*.json`.
  - [ ] `[live]` the banner disappears on the first successful refetch — **measured later by a
        human** in a browser: `npm start -w @codebox/app`, block the API path in DevTools (or
        stop the daemon), read the banner, restore it, and watch the banner vanish on the next
        successful request without a reload. Recorded as `[?]` until measured; there is no
        browser on GitHub Actions.

## 📣 Coordination

- For the Architect: the `401` hand-off lives in the interceptor, not the guard, so this task
  owns both plus one small signal module. The pairing screen keeps its own copy — it does not
  read `?reason=` yet; the URL carries the code so a later screen task can render it without
  touching this code, and `docs/app.md` §10's row is satisfied by the redirect, the cleared
  store and the recorded reason.
- For Task-55 (same batch): `authGuard` keeps its name and its `CanActivateFn` type;
  `app.component.ts` keeps `showTabs` exactly as it is. `app.routes.ts` and `app.config.ts` are
  yours — this task touches neither.
- For the next batch (Task-56/57/59/60/61/63/64/65): a screen that wants the offline copy in
  its own template imports `ConnectivityStore` and reads `readOnly()`; it must not re-implement
  `navigator.onLine`, and it must not add keys to `assets/i18n/*.json` (see `docs/app.md` §9).
  Rendering `?reason=` on `/pair` is a `features/pairing/**` change and belongs to the task that
  owns that folder.
- For QA: a diff under `features/pairing/**` or `app.routes.ts` is a fail.

## ⛔ Out of scope

- No offline write queue, no service-worker change, no SSE reconnect change: a queued write
  nobody performed is worse than a disabled control (`docs/app.md` §10).
- No retry button, no toast, no snackbar.
- No change to `AuthStore`, `SECURE_STORE`, the pairing screen, the router, the dictionaries.
- No new dependency, no `angular.json` or `main.ts` change.
- No `docs/app.md`, `TODO.md`, `CHANGELOG.md` or `docs/decisions.md` edit.

## Turnstile (read this before you stop)

Work only inside `../wt-cb-66`. Never touch `main`. Commit everything. Run the gate
(`npm ci`, `npm run lint`, `npm test`, `npm run build`). Then leave an empty commit on the
branch tip with the exact subject `dev: done task-66` and `git push origin task-66`. The branch
is the durable unit.

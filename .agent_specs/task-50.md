# Spec: Task-50 — Pairing screen

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (Angular + Ionic feature folder; no daemon, no contract).
- **Role:** Dev.
- **Objective:** Replace the Task-18 placeholder at `/pair` — measured on 2026-10-27 in
  Chromium at 320×640 with **0 inputs and 0 buttons** — with the screen the design signs off:
  a pairing-code field, a device-name field, a submit button, an inline message when the code is
  used, expired or unknown, a submit that is disabled while the exchange is in flight and
  re-enabled when it fails, EN/ES copy from a feature dictionary, no horizontal scroll at
  320 px, nothing written to `localStorage`, and a redirect to `/dashboard` through the existing
  `AuthStore.pair` seam when the exchange succeeds.
- **Environment:** worktree `../wt-cb-50`, branch `task-50`, base `main`.
- **Dependencies:** **Task-18** (merged) supplies `AuthStore.pair({ code, deviceName, platform })`
  in `apps/app/src/app/core/auth/auth.store.ts`, the `/pair` route in
  `apps/app/src/app/app.routes.ts` (`canActivate` absent, the only public route), the
  `I18nService` (`apps/app/src/app/core/i18n/i18n.service.ts`), the theme tokens
  (`apps/app/src/theme/variables.css`) and `ApiError` (`apps/app/src/app/core/api/api-client.ts`).
  **L2** (the signed-off screens) supplies the frame map: `design/README.md` §1 row `Pairing`
  (frames `01` dark, `L1` light) and §2 row `Unpaired` (`14`, `L20`). This task reads both; it
  does not edit `design/`.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path. Touching anything outside this list is a failure of the task.

- `apps/app/src/app/features/pairing/pairing.page.ts` (rewritten)
- `apps/app/src/app/features/pairing/pairing.page.spec.ts` (new)
- `apps/app/src/app/features/pairing/i18n.ts` (new)
- `apps/app/README.md` (the `features/pairing/` rows only — the three rows named below)
- `docs/app.md` (sections: `## 4. Screens` — the `Pairing` row of the table; `## 9. Design
  direction` — the **Copy and localisation** bullet. No other section, no other row.)

**Why `apps/app/README.md` is here and not deferred:** `apps/app/src/app/readme.spec.ts` walks
`src/app` and fails when any file is absent from the map, so the two new files make `npm test`
red unless the map gains their rows in the same commit. This is the folder map that `AGENTS.md`
requires, not a widening of scope: update the `pairing.page.ts` row and add one row for
`pairing.page.spec.ts` and one for `i18n.ts`. No other line of that file changes.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `apps/app/src/app/features/pairing/pairing.page.ts`
- `apps/app/src/app/core/auth/auth.store.ts`, `apps/app/src/app/core/auth/auth.store.spec.ts`
- `apps/app/src/app/core/api/api-client.ts`
- `apps/app/src/app/core/i18n/i18n.service.ts`
- `apps/app/src/app/app.routes.ts`, `apps/app/src/app/app.routes.spec.ts`
- `apps/app/src/app/features/dashboard/dashboard.page.ts`,
  `apps/app/src/app/features/dashboard/dashboard.page.spec.ts`,
  `apps/app/src/app/features/dashboard/i18n.ts` (the pattern to follow)
- `apps/app/src/app/features/jobs/jobs.page.ts` (form markup pattern)
- `apps/app/src/theme/variables.css`, `apps/app/src/assets/i18n/en.json`,
  `apps/app/src/assets/i18n/es.json`
- `apps/app/angular.json`, `apps/app/package.json`, `apps/app/README.md`
- `docs/app.md`, `design/README.md`, `docs/decisions.md` (D17, D24, D43)

## 🔒 Contract

`apps/app/src/app/features/pairing/pairing.page.ts` — exported names, frozen:

```ts
import type { PairPlatform } from '../../core/auth/auth.store';

export type PairingProblem = 'code' | 'deviceName';

export type PairingFailure =
  | 'codeRejected'
  | 'rateLimited'
  | 'offline'
  | 'failed';

/** The first invalid field, or null. Trims before it measures. */
export function pairingProblem(input: { code: string; deviceName: string }): PairingProblem | null;

/** The failure to render for a rejected `AuthStore.pair`. Pure. */
export function pairingFailureOf(error: unknown): PairingFailure;

/** `Capacitor.getPlatform()` to the pair platform, unknown values as 'web'. Pure. */
export function platformFor(platform: string): PairPlatform;

@Component({
  selector: 'app-pairing-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PairingPage {
  readonly code: Signal<string>;
  readonly deviceName: Signal<string>;
  readonly submitting: Signal<boolean>;
  readonly failure: Signal<PairingFailure | PairingProblem | null>;
  submit(event?: Event): Promise<void>;
}
```

- **`pairingProblem`, frozen:** `code.trim().length === 0` → `'code'`;
  `code.trim().length > 64` → `'code'`; `deviceName.trim().length === 0` → `'deviceName'`;
  `deviceName.trim().length > 64` → `'deviceName'`; otherwise `null`. The 64 bounds mirror the
  daemon's `pairSchema` (`apps/daemon/src/auth/routes.ts`: `CODE_MAX_LENGTH = 64`,
  `PAIRING_NAME_MAX_LENGTH = 64`) so a rejected pair is never a `422` the client could have
  caught.
- **`pairingFailureOf`, frozen:** not an `ApiError` → `'failed'`; `status === 0` →
  `'offline'`; `status === 429` → `'rateLimited'`; `status === 401` → `'codeRejected'` regardless
  of `details.reason` (`used_code`, `expired_code`, `unknown_code` all read the same to the
  operator); anything else (`400`, `403`, `422`, `5xx`) → `'failed'`.
- **`submit`, frozen order:** clear `failure`; `pairingProblem` on the current values → set the
  failure and return without calling the store; if `submitting()` is already true, return
  (a double tap calls `pair` once); set `submitting` true; `await authStore.pair({ code:
  code().trim(), deviceName: deviceName().trim(), platform: platformFor(Capacitor.getPlatform())
  })`; on resolve `void this.router.navigate(['/dashboard'])`; on reject set
  `pairingFailureOf(error)`; `finally` set `submitting` false. `inject(AuthStore)` — never
  construct it, never call `ApiClient.pair` directly.
- **Storage:** nothing is read from or written to `localStorage`, `sessionStorage`, a cookie or
  `document.cookie` in the feature. The method is to call `AuthStore.pair` and let it use the
  secure store (D17). The spec file must not reference those APIs as literals (the existing
  suite assembles `'local' + 'Storage'` for that reason); the QA plan greps the built file.
- **Invalidation:** `failure` is cleared only at the start of a `submit`. A successful `pair`
  leaves `submitting` false before the navigation completes.

### Template, frozen hooks

Every hook below must exist with that exact `data-testid`; QA and Playwright read them.

| Hook | Element | Binds |
| --- | --- | --- |
| `page-pair` | the root `<div>` inside `<ion-content>` | — |
| `pair-form` | `<form (submit)="submit($event)">` | — |
| `pair-code` | `<input type="text">` | `[value]="code()"` |
| `pair-device-name` | `<input type="text">` | `[value]="deviceName()"` |
| `pair-submit` | `<button type="submit">` | `[disabled]="submitting()"` |
| `pair-error` | `<p role="alert">` | `[attr.data-failure]="failure()"`, text `t('pair.error.' + failure())` |

- `pair-error` is absent from the DOM when `failure()` is `null`.
- Both inputs bind `(input)` to the same `valueOf(event)` helper the other feature pages use
  (`jobs.page.ts`), and `submit(event?)` calls `event?.preventDefault()` first so the browser
  never navigates the form.
- The code input carries `autocomplete="one-time-code"`, `autocapitalize="characters"`,
  `spellcheck="false"` and `inputmode="text"`; the device-name input carries
  `autocomplete="off"`.
- `pair-submit`'s label is `t('pair.submit')` and, while `submitting()`, `t('pair.submitting')`.
- Both `<input>` elements have a `<label for="...">` with their own text; the form is a real
  `<form>` so Enter submits once.
- The screen is wrapped in `<ion-header><ion-toolbar><ion-title>` + `<ion-content class="ion-padding">`
  exactly like `dashboard.page.ts`. Controls are native `<input>`/`<button>`, the pattern every
  other feature folder in this app uses (`jobs.page.ts`); do **not** introduce
  `ion-input`/`ion-button` in this screen.
- **320 px floor, frozen CSS rules** on the component's `styles` block: the form has
  `display: grid`, `gap: calc(var(--cb-space) * 2)`, `max-width: 420px`, `width: 100%`,
  `box-sizing: border-box`; inputs have `width: 100%`, `box-sizing: border-box`,
  `min-width: 0`; the error has `overflow-wrap: anywhere`; no `px` width, no `min-width` above
  `0`, no `white-space: nowrap` anywhere in the file. Colours come only from the existing
  `--cb-*` tokens (`--cb-surface`, `--cb-text`, `--cb-danger`, `--cb-radius`, `--cb-space`); no
  new hex colour, no new font family, no gradient, no illustration.

### `i18n.ts`, frozen

`apps/app/src/app/features/pairing/i18n.ts` mirrors `features/dashboard/i18n.ts` exactly in
shape:

```ts
export type Locale = 'en' | 'es';
export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>>;
export function translate(locale: Locale, key: string): string;
```

Keys, frozen (all of them, in both locales, non-empty):

| Key | EN | ES |
| --- | --- | --- |
| `pair.title` | `Pair this device` | `Empareja este dispositivo` |
| `pair.code` | `Pairing code` | `Código de emparejamiento` |
| `pair.code.hint` | `Ten characters from cb pair.` | `Diez caracteres de cb pair.` |
| `pair.deviceName` | `Device name` | `Nombre del dispositivo` |
| `pair.deviceName.hint` | `How this device appears in Settings.` | `Cómo aparece este dispositivo en Ajustes.` |
| `pair.submit` | `Pair` | `Emparejar` |
| `pair.submitting` | `Pairing…` | `Emparejando…` |
| `pair.error.code` | `The code is invalid or has expired.` | `El código no es válido o ha caducado.` |
| `pair.error.deviceName` | `Give this device a name.` | `Ponle un nombre a este dispositivo.` |
| `pair.error.codeRejected` | `The code is invalid or has expired.` | `El código no es válido o ha caducado.` |
| `pair.error.rateLimited` | `Too many attempts. Wait a minute.` | `Demasiados intentos. Espera un minuto.` |
| `pair.error.offline` | `No connection to the box.` | `Sin conexión con la caja.` |
| `pair.error.failed` | `Pairing failed. Try again.` | `El emparejamiento ha fallado. Inténtalo de nuevo.` |

- The shared `pair.*` keys in `src/assets/i18n/*.json` (`title`, `code`, `deviceName`, `submit`,
  `error`) are **not** edited; this file duplicates them so the feature renders without the
  shared dictionary, exactly as `dashboard/i18n.ts` duplicates `common.*`. Say so in a one-line
  comment at the top of the file.
- `translate(locale, key)` returns the key itself when it is missing, like the dashboard's.

### Data

- No new contract type, no new `CB_*` key, no API call beyond `AuthStore.pair`.
- The redirect target is the literal `['/dashboard']`.
- The platform is `platformFor(Capacitor.getPlatform())`; in jsdom that is `'web'`.

## 🧩 Configuration

No `CB_*` key is added or read. No build configuration changes: `apps/app/angular.json` and
`apps/app/package.json` are not touched.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest for the packages **and** the Angular app unit suite (Task-49 made the
    root `test` script run `ng test --watch=false`). If the branch predates that merge, run
    `npm test -w @codebox/app` for the app half and say so.
  - `npm run build` — the app build must stay green (`ng build`, production configuration).
  - `npx playwright test` — **not** run: this repository has no Playwright suite yet
    (Task-26 is blocked on the `workflows` permission); the `[live]` criterion below says why.
  - `git diff --name-only main...task-50` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `npm run lint`, `npm test` and `npm run build` are green.
  - [ ] `[unit]` `pairing.page.spec.ts` mounts `PairingPage` with
        `provideRouter([])`, `provideIonicAngular()`, `provideHttpClient()`,
        `provideHttpClientTesting()` and a fake `AuthStore` provided as
        `{ provide: AuthStore, useValue: { pair } }`, and covers, by name:
        (a) **empty fields** — submitting with both fields empty sets
        `[data-failure="code"]` on `pair-error` and `pair` is **not** called;
        (b) **empty device name** — a code and an empty name sets
        `[data-failure="deviceName"]` and `pair` is **not** called;
        (c) **trimmed values, called once** — `'  7K3M9QXB2F  '` / `'  Dani iPhone  '` calls
        `pair` exactly once with `{ code: '7K3M9QXB2F', deviceName: 'Dani iPhone', platform:
        'web' }`; a second click while the promise is pending still leaves exactly one call;
        (d) **used and expired code** — for each of `used_code` and `expired_code`, a rejected
        `pair` (an `ApiError` with `status: 401`, `code: 'unauthorized'`,
        `details: { reason }`) renders `[data-failure="codeRejected"]`, the EN string
        `The code is invalid or has expired.`, and leaves `pair-submit` **enabled**;
        (e) **rate limited and offline** — `status: 429` → `rateLimited`, `status: 0` →
        `offline`, and submit is enabled after each;
        (f) **success** — a resolved `pair` calls `Router.navigate` once with
        `['/dashboard']`;
        (g) **dictionary parity** — `Object.keys(STRINGS.en).sort()` equals
        `Object.keys(STRINGS.es).sort()`, no value is empty, and every key in the table above
        resolves in both locales.
        Verify with `npm test -w @codebox/app 2>&1 | tee /tmp/app.log` and read the case names.
  - [ ] `[unit]` `grep -nE "page-pair|pair-form|pair-code|pair-device-name|pair-submit|pair-error" apps/app/src/app/features/pairing/pairing.page.ts`
        finds all six hooks.
  - [ ] `[unit]` No forbidden storage API in the feature:
        `grep -rInE "localStorage|sessionStorage|document\\.cookie" apps/app/src/app/features/pairing/`
        prints nothing.
  - [ ] `[unit]` No fixed pixel width in the screen:
        `grep -nE "\\bwidth:\\s*[0-9]+px|min-width:\\s*[1-9][0-9]*px|white-space:\\s*nowrap" apps/app/src/app/features/pairing/pairing.page.ts`
        prints nothing, and `grep -c "var(--cb-" apps/app/src/app/features/pairing/pairing.page.ts`
        is > 0.
  - [ ] `[unit]` The build ships the screen, not the placeholder:
        `grep -r "Pairing — tasks 19-23" apps/app/dist/` prints nothing after `npm run build`.
  - [ ] `[unit]` `git diff --name-only main...task-50` lists exactly
        `apps/app/src/app/features/pairing/pairing.page.ts`,
        `apps/app/src/app/features/pairing/pairing.page.spec.ts`,
        `apps/app/src/app/features/pairing/i18n.ts`, `apps/app/README.md`, `docs/app.md`; and
        `git diff main...task-50 -- apps/app/src/app/app.routes.ts apps/app/src/assets/i18n/`
        is empty.
  - [ ] `[unit]` The folder map is complete: `npm test -w @codebox/app` is green (it runs
        `src/app/readme.spec.ts`, which fails when a file under `src/app` is unmapped), and
        `git diff main...task-50 -- apps/app/README.md` changes only the `features/pairing/`
        rows.
  - [ ] `[live]` **Not measurable here.** The backlog asks that "a real code from `cb pair`
        pairs the browser at 320 px in under two minutes and lands on the dashboard with no
        horizontal scroll". That needs the built app, a daemon on a real box, a real pairing code
        and a browser viewport: GitHub Actions in this cycle has no VM, no `cb pair` and no
        Playwright suite (Task-26 is `[!]` on the `workflows` permission), and jsdom cannot
        measure layout. **Measurement, when a human runs it:** on the box, `cb pair --name
        "QA 320"`; open the built app in Chromium at 320×640; enter the code and the name; press
        Pair; require `location.pathname === '/dashboard'` within 120 s and
        `document.documentElement.scrollWidth <= 320`. Report it as an `agent-review` issue
        titled `Task-50: measure pairing at 320 px on the box`, quoting the two values — **never**
        as passing.

## 📣 Coordination

- **For the Architect:** Task-50 depends on Task-18 only, which is merged; it shares no path with
  Tasks 48, 49 or 51. `docs/app.md` is held by this task alone in this batch.
- **For the Architect (resolved in this spec):** `apps/app/README.md` line 104 maps
  `features/pairing/pairing.page.ts — pairing placeholder`. It is now an exclusive path of this
  task, because `apps/app/src/app/readme.spec.ts` fails while the two new files are unmapped; the
  dev updates the placeholder row to describe the real screen and adds the two rows.
- **For Task-66 (`Unpaired and offline`):** this screen is the target of its 401 hand-off;
  frames `14`/`L20` are the same route after a session loss. Task-66 owns
  `core/auth/auth.guard.ts` and `shared/offline-banner.ts` and must not edit
  `features/pairing/**`. If it needs the screen to render a *reason* (for example
  `?reason=session_expired`), that is a Task-50 amendment, not a local change.
- **For the app tasks after this one:** `features/pairing/i18n.ts` is the copy source for this
  screen only; the shared `src/assets/i18n/*.json` stays untouched, and a new key goes in the
  feature dictionary in both locales in the same change.
- **For QA:** the fake `AuthStore` is the seam. A test that mounts the page without providing it
  will hit the real store, generate a key pair and call the network — that is a spec failure, not
  a flaky test.

## ⛔ Out of scope

- No new dependency, no `@ionic/angular` form component introduced, no new theme token, no new
  CSS file.
- No change to `apps/app/src/app/app.routes.ts`, `apps/app/src/main.ts`,
  `apps/app/angular.json`, `apps/app/src/assets/i18n/*.json`, any line of `apps/app/README.md`
  other than the three `features/pairing/` rows, `design/**` or any `core/**` file.
- No QR scanning, no camera, no deep-link parsing, no "remember this device", no biometric
  unlock, no offline queue.
- No `AuthStore` change: if the seam lacks something, the task is blocked, not widened.
- No change to `TODO.md`, `CHANGELOG.md`, `docs/decisions.md` or any section of `docs/app.md`
  other than the two named.

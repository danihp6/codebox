# Spec: Task-55 — Shell, three tabs and the router (D47)

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (UI shell + router configuration). No daemon, no package.
- **Role:** Dev.
- **Objective:** after this task the hybrid app has **one shell with exactly three tabs —
  Dashboard, Chat, Settings** (D47) and a router whose tab roots are *derived from that same
  list*, so a fourth tab cannot appear by accident in one place and not the other. Every route
  except `/pair` is guarded, the wildcard is guarded too, a cold deep link restores the session
  **before** the first navigation instead of flashing the pairing screen, and the two dead shell
  keys disappear from the shared dictionaries with EN/ES parity intact.
- **Environment:** worktree `../wt-cb-55`, branch `task-55`, base `main` (`origin/main` @
  `c72dd61`).
- **Dependencies (merged):** Task-51 (`chatSessionSchema` gained `kind`; nothing you consume
  changed shape); Task-18 (the shell, `authGuard`, `I18nService`, the route table);
  Task-50 (the real `PairingPage` at `/pair`); Task-49 (the root `npm test` runs the app
  suite, so your specs run in the gate). You **read** `apps/app/src/app/core/auth/auth.guard.ts`
  and must not edit it: Task-66 owns it in this batch.

### Exclusive paths (single writer)

Nothing outside this list. No other task in this batch claims any of these.

- `apps/app/src/app/app.routes.ts` — **hot file; this task is its only holder in the batch.**
- `apps/app/src/app/app.routes.spec.ts`
- `apps/app/src/app/app.config.ts`
- `apps/app/src/app/shell/tabs.page.ts`
- `apps/app/src/app/shell/tabs.page.spec.ts`
- `apps/app/src/assets/i18n/en.json`
- `apps/app/src/assets/i18n/es.json`

You create **no new file** — the `restoreSession` test below goes into the spec file you already
own (`app.routes.spec.ts`), because every file under `src/app` must appear in
`apps/app/README.md` and that file is Task-66's in this batch.

Explicitly **not** yours: any `apps/app/src/app/features/**` file (Task-56, 57, 59–67 own
them one screen at a time), `apps/app/src/app/core/auth/**` (Task-66),
`apps/app/src/app/app.component.ts` and `apps/app/src/app/shared/**` (Task-66),
`apps/app/README.md` (Task-66 writes it — you create no new file under `src/app`),
`apps/app/angular.json`, `apps/app/src/main.ts`, `docs/app.md`, `docs/api.md`, `TODO.md`,
`CHANGELOG.md`, `docs/decisions.md`.

### Inputs (read-only)

Beyond `AGENTS.md`:

- `apps/app/src/app/app.routes.ts`, `app.config.ts`, `app.component.ts`
- `apps/app/src/app/shell/tabs.page.ts`, `tabs.page.spec.ts`
- `apps/app/src/app/core/auth/auth.guard.ts`, `auth.store.ts` (`restore()`),
  `core/i18n/i18n.service.ts`, `core/api/api-client.ts`
- `apps/app/src/assets/i18n/en.json`, `es.json`
- `apps/app/src/app/features/{dashboard/dashboard.page,chat/chat-list.page,chat/chat.page,
  repos/repos.page,repos/repo.page,jobs/jobs.page,jobs/job.page,runs-list/runs.page,
  run-detail/run.page,approvals/approvals.page,settings/settings.page,
  settings/devices.page,about/about.page,pairing/pairing.page}.ts` (names only — you never
  edit them)
- `docs/app.md` §4 (the screen table and the three-tab rule) and §9 (the shared dictionary
  rule), `docs/decisions.md` (D47), `design/README.md` §1

## 🔒 Contract

### `apps/app/src/app/app.routes.ts`

```ts
export type ShellTabId = 'dashboard' | 'chat' | 'settings';

export interface ShellTab {
  readonly id: ShellTabId;
  readonly path: '/dashboard' | '/chat' | '/settings';
  readonly labelKey: 'tabs.dashboard' | 'tabs.chat' | 'tabs.settings';
}

/** The single source of truth for the bottom tab bar (D47). Exactly three, in this order. */
export const SHELL_TABS: readonly ShellTab[];

export const routes: Routes;
```

- `SHELL_TABS` is a frozen array of exactly three entries, in the order `dashboard`, `chat`,
  `settings`, with the paths above and the label keys above. Nothing else reads a tab list.
- `routes` is built so that those three tab roots come from `SHELL_TABS` (mapping `path` to
  `path.slice(1)` and setting `data: { tab: tab.id }`), and the pushed screens come after them.
  The exact, ordered path list is **frozen**:

  ```
  ''                       redirect → 'dashboard', pathMatch: 'full'
  'pair'                   public, no guard
  'dashboard'              guard, data.tab 'dashboard'
  'chat'                   guard, data.tab 'chat'
  'settings'               guard, data.tab 'settings'
  'repos'                  guard
  'repos/:id'              guard
  'chat/:id'               guard, data.tab 'chat'
  'jobs'                   guard
  'jobs/:id'               guard
  'runs'                   guard
  'runs/:id'               guard
  'approvals'              guard
  'settings/devices'       guard
  'about'                  guard
  '**'                     guard
  ```

  Every entry except `''` and `'pair'` carries `canActivate: [authGuard]` with the **existing**
  imported `authGuard` (one entry, not a wrapper, not a copy). Every entry except `''` and
  `'pair'` carries a `loadComponent` that resolves to a component class; the `**` entry keeps
  resolving to `AboutPage`. Keep the current component for each path — do **not** repoint a
  route at a screen that does not exist yet (`/settings/credentials` and
  `/settings/notifications` arrive with their screens, not now).
- `data.tab` marks which tab stays highlighted for a pushed screen: `chat/:id` carries
  `'chat'`; the tab roots carry their own id; every other route carries no `tab` key.

### `apps/app/src/app/app.config.ts`

```ts
export function restoreSession(): Promise<boolean>; // inject(AuthStore).restore()
export const appConfig: ApplicationConfig;
```

- The router keeps `provideRouter(routes, withComponentInputBinding(),
  withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }))`; the service worker and the
  HTTP interceptor providers are unchanged.
- **Added:** `provideAppInitializer(restoreSession)` from `@angular/core`, so the refresh token
  is exchanged before the first navigation and a guarded deep link does not bounce through
  `/pair`. `restoreSession` is a named export precisely so it can be unit-tested in an
  injection context; it must not catch or swallow — `AuthStore.restore()` already returns
  `false` instead of throwing.
- Nothing else changes: no new provider, no `isDevMode` change, no service-worker change.

### `apps/app/src/app/shell/tabs.page.ts`

- Imports `SHELL_TABS` from `../app.routes` and renders from it — **no local tab array, no
  re-export, no copy**. `export const SHELL_TABS` is removed from this file; its only export
  becomes `TabsPage`.
- Exactly three `<ion-tab-button>`, each with `[routerLink]="tab.path"`,
  `routerLinkActive="cb-tab-active"` and `[attr.data-testid]="'tab-' + tab.id"`, the label from
  `i18n.t(tab.labelKey)`. Selector `app-tabs`, standalone, `OnPush`: unchanged.
- `app.component.ts` keeps mounting `<app-tabs />` and deciding when; you do not touch it.

### `apps/app/src/assets/i18n/{en,es}.json`

- `tabs` holds exactly `dashboard`, `chat`, `settings`. `tabs.jobs` and `tabs.runs` are removed
  (the tab they labelled no longer exists; the jobs screen keeps its own copy in
  `features/jobs/i18n.ts`).
- EN and ES stay key-for-key identical, same order, valid JSON, no trailing comma. No other key
  changes.

## 🧩 Configuration

No `CB_*` key. No environment change.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint`
  - `npm test` — the root gate; it runs `test:guard`, then `npm test -w @codebox/app`
    (`ng test --watch=false`, your specs included), then every Vitest project.
  - `npm run build` — must run `ng build` clean.
  - Targeted (optional, a fast loop): from `apps/app`, `npx ng test --watch=false
    --include='src/app/**/*.spec.ts'`; the root `npm test` is the authority.
  - `git diff --name-only main...task-55` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `npm run lint && npm test && npm run build` pass, and the app suite count is
        not lower than before (the old specs are rewritten, never deleted).
  - [ ] `[unit]` `app.routes.spec.ts` asserts the frozen 16-path order above, that every path
        except `''` and `'pair'` has exactly one `canActivate` equal to the imported
        `authGuard`, and that every `loadComponent` resolves to a function.
  - [ ] `[unit]` `app.routes.spec.ts` asserts the single source of truth: for each
        `SHELL_TABS` entry, the route whose `path === tab.path.slice(1)` has
        `data?.tab === tab.id`; and `SHELL_TABS` has length 3 with ids
        `['dashboard', 'chat', 'settings']`.
  - [ ] `[unit]` `tabs.page.spec.ts` renders **three** `[data-testid^="tab-"]` elements in
        order (`tab-dashboard`, `tab-chat`, `tab-settings`), labels resolved through
        `I18nService.t`, and no fourth button.
  - [ ] `[unit]` `app.routes.spec.ts` (a second `describe`) runs `restoreSession()` in a
        `TestBed` injection context with a stub `AuthStore` and asserts it calls `restore` once
        and resolves its value.
  - [ ] `[unit]` `apps/app/src/assets/i18n/en.json` and `es.json` have identical key sets
        (a small test in `app.routes.spec.ts` or `tabs.page.spec.ts` is enough) and neither
        contains `tabs.jobs` or `tabs.runs`.
  - [ ] `[unit]` the diff names only the seven exclusive paths; in particular no file under
        `apps/app/src/app/features/**`, `core/auth/**`, `app.component.ts` or
        `apps/app/README.md`.
  - [ ] `[live]` no screen scrolls horizontally at 320 px — **measured later by a human** in a
        browser at 320×640 over `npm start -w @codebox/app` (or the built PWA): the tab bar
        shows three items, all reachable, and `document.documentElement.scrollWidth <= 320`.
        Recorded as `[?]` until measured; there is no browser on GitHub Actions.

## 📣 Coordination

- For the Architect: the shell is **flat**, because `app.component.ts` already hosts the tab bar
  for every non-`/pair` URL. A nested `children` route would need that file, which Task-66
  owns this batch. The three tab roots are therefore expressed as the first three guarded
  routes, derived from `SHELL_TABS`, with `data.tab` for highlighting.
- For Task-56/57/61/63/64/65 (next batch): the routes exist; the screens replace the component
  the route already points at, and the router is not edited again. `/chat?filter=repo` and
  `/chat?filter=schedule` are query params on the existing `/chat` route — no new route.
  `/settings/credentials`, `/settings/notifications` and `/chat/new` are **not** declared yet;
  the task that ships the screen adds the one row to `app.routes.ts` and updates
  `app.routes.spec.ts` in the same change.
- For Task-66 (same batch): `authGuard` is imported by the router as-is; changing its signature
  would break this spec — keep `export const authGuard: CanActivateFn`. `app.component.ts` is
  yours; the `showTabs` computation must keep hiding the tab bar only on `/pair`.
- For QA: `apps/app/README.md` is untouched by design (no new `src/app` file), so the
  `readme.spec.ts` map stays green.

## ⛔ Out of scope

- No new screen, no new feature folder, no visual redesign, no Ionic theme change.
- No change to `app.component.ts`, the guard, the interceptor, the auth store, the SSE client.
- No new dependency, no `angular.json` or `main.ts` change, no i18n library.
- No `docs/app.md` edit (it already states the three tabs and the dictionary rule), no
  `TODO.md`, `CHANGELOG.md` or `docs/decisions.md`.

## Turnstile (read this before you stop)

Work only inside `../wt-cb-55`. Never touch `main`. Commit everything. Run the gate
(`npm ci`, `npm run lint`, `npm test`, `npm run build`). Then leave an empty commit on the
branch tip with the exact subject `dev: done task-55` and `git push origin task-55`. The branch
is the durable unit.

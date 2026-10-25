# Spec: Task-23 — Settings, devices and notifications

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (Angular 22 + Ionic 9 standalone, signals, feature-local store and API).
- **Role:** Dev.
- **Objective:** `/settings` and `/settings/devices` stop being placeholders and become the
  screen the operator uses to see the paired device and its scopes, revoke a device, edit the
  account time zone, choose which events push, and reach the danger zone. Every resource whose
  daemon route does not exist in this build (settings, providers, brake, cache wipe) renders an
  explicit `unavailable` block instead of an error banner or a dead control — the same
  `missing_route` convention `cb doctor` already uses for a 404.
- **Environment:** worktree `../wt-cb-23`, branch `task-23`, base `main`.
- **Dependencies:** Task-18 (the router, the guards, `AuthStore`, `SECURE_STORE`, the theme
  tokens and the feature pattern), Task-12 (`GET /v1/me`, `GET /v1/devices`,
  `DELETE /v1/devices/{id}`), Task-16 (`GET`/`PATCH /v1/notifications/preferences`). All are
  merged. The router already declares `settings` and `settings/devices`; **do not edit
  `app.routes.ts`**.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/app/features/settings/settings.page.ts`
- `apps/app/src/app/features/settings/settings.page.spec.ts` (new)
- `apps/app/src/app/features/settings/devices.page.ts`
- `apps/app/src/app/features/settings/devices.page.spec.ts` (new)
- `apps/app/src/app/features/settings/settings.api.ts` (new)
- `apps/app/src/app/features/settings/settings.api.spec.ts` (new)
- `apps/app/src/app/features/settings/settings.store.ts` (new)
- `apps/app/src/app/features/settings/settings.store.spec.ts` (new)
- `apps/app/src/app/features/settings/devices.store.ts` (new)
- `apps/app/src/app/features/settings/devices.store.spec.ts` (new)
- `apps/app/src/app/features/settings/i18n.ts` (new)
- `apps/app/README.md`

**Do not touch** `apps/app/src/app/core/**` (in particular `core/api/api-client.ts`,
`core/auth/**` and `core/settings/settings.store.ts` — the theme/locale store is a different
thing), `apps/app/src/app/app.routes.ts`, `apps/app/src/app/features/about/**` (the `/about`
route stays the 404 page), `apps/app/angular.json`, `apps/app/src/main.ts`, `packages/**`. Do
not add a dependency.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/api.md` §2, §3, §4, §5.1 (`/v1/version`, `/v1/providers`, `/v1/admin/*`), §5.7
  (`/v1/settings`, notification preferences), §5.9 (devices), §7
- `docs/app.md` §4, §5 (states and optimistic toggles), §9 (design tokens), §10, §11
- `docs/security.md` §4 (what a device row means)
- `packages/contracts/src/resources.ts`, `src/pagination.ts`, `src/primitives.ts`
  (`notificationPreferencesSchema`, `settingsSchema`, `deviceSchema`, `meSchema`,
  `providersSchema`, `brakeSchema`, `versionSchema`, `timezoneSchema`, `sseEventNameSchema`)
- `packages/contracts/src/index.ts` (the exported names and parsers)
- `apps/app/src/app/core/api/api-client.ts`, `core/api/http.ts`, `core/auth/auth.store.ts`,
  `core/auth/secure-store.ts`, `core/auth/auth.guard.ts`, `core/i18n/i18n.service.ts`
- `apps/app/src/app/features/repos/*` (`repos.api.ts`, `repos.store.ts`, `i18n.ts`,
  `repos.page.spec.ts` — the pattern this task follows: feature-local API, signals, per-feature
  dictionary, `data-testid` on every asserted node)
- `apps/app/src/app/features/dashboard/dashboard.page.spec.ts` (the TestBed + HTTP-testing
  harness)
- `apps/app/src/styles.scss` and the theme tokens (read only)

## 🔒 Contract

### `settings.api.ts`

```ts
export interface SettingsPatch {
  readonly timezone?: string;
}

/**
 * A read whose daemon route does not exist in this build resolves `null` (HTTP 404) and never
 * throws. Everything else keeps throwing `ApiError`.
 */
@Injectable({ providedIn: 'root' })
export class SettingsApi {
  constructor(private readonly http: HttpClient) {}

  me(): Observable<Me>;                                          // GET  /v1/me
  version(): Observable<Version>;                                // GET  /v1/version
  settings(): Observable<Settings | null>;                        // GET  /v1/settings
  patchSettings(body: SettingsPatch): Observable<Settings>;       // PATCH /v1/settings
  providers(): Observable<Providers | null>;                      // GET  /v1/providers
  brake(enabled: boolean): Observable<boolean>;                   // POST /v1/admin/brake
  wipeCache(): Observable<boolean>;                               // POST /v1/admin/cache/wipe
  devices(query?: { limit?: number; cursor?: string }): Observable<Page<Device>>;
  revokeDevice(id: string): Observable<void>;                     // DELETE /v1/devices/{id}
  preferences(): Observable<NotificationPreferences>;             // GET  /v1/notifications/preferences
  patchPreferences(body: NotificationPreferences): Observable<NotificationPreferences>;
}
```

Rules:

- URLs are `${API_BASE_URL}${API_PREFIX}/...` with both imported from `core/api/http.ts`, exactly
  like `repos.api.ts`.
- Every body is parsed at the boundary: `parseMe`, `parseVersion`, `parseSettings`,
  `parseProviders`, `parseBrake`, `parsePage(deviceSchema, body, 'devices')`,
  `parseNotificationPreferences`. A malformed body becomes
  `new ApiError({ message, status: 200, code: 'contract', requestId: null, details: null })`.
- A 404 on `settings()`, `providers()`, `brake()` and `wipeCache()` is **not** an error:
  - `settings()` / `providers()` emit `null`;
  - `brake()` / `wipeCache()` emit `false` (meaning "route absent").
  A 403 (missing `admin` scope) is a real error and keeps throwing.
- `brake()` sends `{ enabled }`; `wipeCache()` sends no body. Both use
  `Content-Type: application/json`.
- An `HttpErrorResponse` becomes `ApiError` with the envelope's `code`, `message`, `requestId`
  and `details` (copy the `toApiError` shape of `repos.api.ts`, including the
  `errorCodeSchema`-only fallback for an envelope whose `requestId` is malformed).

### `settings.store.ts`

```ts
export const PREFERENCE_EVENTS = [
  'run.finished',
  'run.failed',
  'run.merged',
  'run.cancelled',
  'approval.created',
  'routine.fired',
] as const;
export type PreferenceEvent = (typeof PREFERENCE_EVENTS)[number];

@Injectable()
export class SettingsStore {
  readonly me = signal<Me | null>(null);
  readonly version = signal<Version | null>(null);
  readonly settings = signal<Settings | null>(null);
  readonly settingsUnavailable = signal(false);
  readonly providers = signal<Providers | null>(null);
  readonly providersUnavailable = signal(false);
  readonly preferences = signal<NotificationPreferences | null>(null);
  readonly brakeAvailable = signal(true);
  readonly cacheWipeAvailable = signal(true);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly saving = signal<string | null>(null);

  load(): void;
  saveTimezone(timezone: string): void;
  setBrake(brakeOn: boolean): void;
  wipeCache(): void;
  togglePreference(event: PreferenceEvent, enabled: boolean): void;
  setQuietHours(value: string | null): void;
}
```

- `load()` starts all five reads; `me`, `version` and `preferences` are required (a failure
  sets `error` and keeps the previous value), while `settings` and `providers` set their
  `unavailable` flag on `null`. It clears `loading` in `finalize`. Each read is independent:
  one failure never blanks another surface.
- `saveTimezone` validates the value with `timezoneSchema.safeParse`; a failure sets
  `error` to an `ApiError` with `code: 'contract'`, `status: 0` and sends nothing. On success
  it PATCHes and replaces `settings`.
- `setBrake(brakeOn)` is optimistic. The brake is the inverse of `settings().automerge`:
  `data-enabled` on the control is `settings().automerge === false`. Calling
  `setBrake(true)` sends `brake(true)` and optimistically sets `settings.automerge = false`;
  `setBrake(false)` sends `brake(false)` and sets it back to `true`. On an error **or** a
  `false` result, restore the previous value; the `false` result additionally sets
  `brakeAvailable(false)`. It sets `saving` to `'brake'` while in flight.
- `wipeCache()` sets `cacheWipeAvailable(false)` on `false`; on `true` it sets `saving` to
  `'cache'` and clears it after.
- `togglePreference(event, enabled)` is optimistic with rollback (docs/app.md §5): compute the
  next `{ events, quietHours }`, run `notificationPreferencesSchema.safeParse` on it, and on a
  failure set `error` and do not send. On success set the signal, PATCH, and on error restore
  the previous object.
- `setQuietHours(value)` follows the same validate-then-PATCH path (`quietHoursSchema` accepts
  `null` or `HH:MM-HH:MM`).

All subscriptions use `takeUntilDestroyed(this.destroy)` with `DestroyRef`, like
`repos.store.ts`.

### `devices.store.ts`

```ts
@Injectable()
export class DevicesStore {
  readonly devices = signal<readonly Device[]>([]);
  readonly currentDeviceId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly revoking = signal<string | null>(null);

  load(): void;
  revoke(id: string): void;
}
```

- `load()` reads `me()` (for `currentDeviceId`) and `devices()`; a failure sets `error`.
- `revoke(id)`: `DELETE`, then remove the row from the signal; when `id === currentDeviceId()`
  it awaits `AuthStore.logout()`, which clears the secure store and routes the guard to
  `/pair` on the next navigation. A failure sets `error` and leaves the row in place.

### `i18n.ts`

The per-feature dictionary pattern of `features/repos/i18n.ts`:

```ts
export type Locale = 'en' | 'es';
export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>>;
export function translate(locale: Locale, key: string): string;
```

Required keys (both locales, same set): `settings.title`, `settings.section.profile`,
`settings.section.devices`, `settings.section.notifications`, `settings.section.providers`,
`settings.section.danger`, `settings.section.about`, `settings.device.name`,
`settings.device.platform`, `settings.device.scopes`, `settings.device.none`,
`settings.timezone`, `settings.timezone.save`, `settings.preference.run.finished`,
`settings.preference.run.failed`, `settings.preference.run.merged`,
`settings.preference.run.cancelled`, `settings.preference.approval.created`,
`settings.preference.routine.fired`, `settings.quiet.hours`, `settings.quiet.none`,
`settings.provider.configured`, `settings.provider.missing`, `settings.provider.mode`,
`settings.brake.on`, `settings.brake.off`, `settings.brake.confirm`, `settings.cache.wipe`,
`settings.cache.confirm`, `settings.unavailable`, `settings.about.version`,
`settings.about.commit`, `settings.about.node`, `devices.title`, `devices.empty`,
`devices.current`, `devices.revoke`, `devices.revoke.confirm`, `devices.lastSeen`,
`devices.never`, `common.loading`, `common.error`, `common.retry`.

### Data

No API payload changes: every shape is the existing contract schema. The keys this task freezes
are the six `PREFERENCE_EVENTS` above and the `data-testid` names in the Pages section; a later
task renders against those names rather than inventing new ones.

### Pages

`settings.page.ts` (`selector: app-settings-page`, `providers: [SettingsStore]`, OnPush):

- Calls `store.load()` in the constructor; renders `data-testid="settings-loading"` while
  `loading()`, and `data-testid="settings-error"` + `data-testid="settings-retry"` on `error()`.
- Profile: `data-testid="settings-profile"` with `data-device-id` and `data-scopes`; time zone
  field `data-testid="settings-timezone"` + `data-testid="settings-save-timezone"`.
- Providers: one `data-testid="settings-provider-github|opencode|push|tunnel"` per provider with
  `data-configured` and `data-mode`; when `providersUnavailable()` render
  `data-testid="settings-unavailable-providers"` and no provider rows.
- Settings-backed controls (time zone save): when `settingsUnavailable()` render
  `data-testid="settings-unavailable-settings"` and disable the save button.
- Notifications: one `data-testid="settings-preference-run.finished"` (and the other five
  events, dot kept in the attribute) with `data-enabled`; a quiet-hours field
  `data-testid="settings-quiet-hours"`.
- Danger zone: `data-testid="settings-brake"` with `data-enabled` and
  `data-testid="settings-wipe-cache"`; when `brakeAvailable()` is false **or**
  `settingsUnavailable()` is true (the brake state lives in the settings resource) render
  `data-testid="settings-unavailable-brake"` with no active control, and render
  `data-testid="settings-unavailable-cache"` when `cacheWipeAvailable()` is false.
- About: `data-testid="settings-version"`, `settings-commit`, `settings-node` from `version()`.
- Use `I18nService.locale()` and this feature's `translate`.

`devices.page.ts` (`selector: app-devices-page`, `providers: [DevicesStore]`, OnPush):

- `data-testid="devices-loading"`, `devices-error`, `devices-empty` when the list is empty,
  one `data-testid="device-row"` per device with `data-device-id` and `data-current`, a
  `data-testid="device-revoke"` button per row, and a confirm step
  (`data-testid="device-revoke-confirm"`) before the DELETE.

## 🧩 Configuration

No `CB_*` key and no environment variable: the app reads the daemon's base URL exactly as
`core/api/http.ts` already resolves it. `docs/providers.md` is unchanged.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — the root Vitest projects; must stay green.
  - `npm test -w @codebox/app` — the Angular unit runner; includes the tests this task adds.
  - `npm run build` — `tsc -b` plus the app build (`ng build`), which must stay under the
    existing budgets.
  - `git diff --name-only main...task-23` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean; `npm test -w @codebox/app` passes.
  - [ ] `[unit]` `settings.api.spec.ts` (HttpTestingController) asserts every URL, that
        `settings()`/`providers()` emit `null` on 404 and do not throw, that `brake()` emits
        `false` on 404, and that a 403 emits an `ApiError` with `code: 'forbidden'` and
        `details.reason === 'insufficient_scope'`.
  - [ ] `[unit]` `devices.store.spec.ts`: revoking the **current** device removes the row, calls
        `AuthStore.logout()`, and leaves the injected secure store with no `cb.refreshToken`
        (seed it first, then assert `await secure.get(REFRESH_TOKEN_KEY) === null`).
  - [ ] `[unit]` `settings.store.spec.ts`: a preference toggle sets the signal before the
        response arrives and restores it when the PATCH fails; a body that fails
        `notificationPreferencesSchema` (e.g. `events: ['nope']`) is never sent (the
        `HttpTestingController` sees no request) and sets `error`.
  - [ ] `[unit]` `settings.page.spec.ts`: a 404 on `/v1/settings` renders
        `settings-unavailable-settings` and **not** `settings-error`; a 404 on `/v1/providers`
        renders `settings-unavailable-providers`; every key used by the template exists in both
        locales (collect the template's `settings.*`/`common.*` keys and assert
        `translate('en', key) !== key` and `translate('es', key) !== key`).
  - [ ] `[unit]` `devices.page.spec.ts`: the empty state renders `devices-empty`; a row for the
        current device carries `data-current="true"`; revoke asks once and then calls the store.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched.
  - [ ] `[live]` On the reference VM with the real daemon and one paired phone: toggle
        `run.finished` off, trigger a run to completion, and observe **no** push on that device
        within 60 s; toggle it on, trigger one more, and observe **exactly one** push. State
        the two observation windows and the push ids (or `none`).

## 📣 Coordination

- For the Architect: `/v1/settings` (GET/PATCH), `/v1/providers`, `/v1/admin/brake` and
  `/v1/admin/cache/wipe` are documented in `docs/api.md` §5.1/§5.7 and **not implemented in
  the daemon**. This task ships their screens as explicit `unavailable` blocks, following the
  `missing_route` convention of `apps/daemon/src/cli/doctor.ts` and Task-19's recorded gap for
  `/v1/repos`. If the screens are wanted live, the API is a separate daemon task — record it,
  do not fold it into Task-23.
- For the next batch: `SettingsApi` is feature-local by the same reasoning as `ReposApi` and
  `DashboardApi`; it collapses into `core/api/api-client.ts` only when a task owns that file.
  The six `PREFERENCE_EVENTS` are exactly the names `apps/daemon/src/push/mapping.ts` maps to a
  `NotificationType`, so a new event there needs a matching key here.
- For Task-36 (routines UI): the notification preference the routines screen must toggle is
  `routine.fired` on this same page; do not add a second preferences control.

## ⛔ Out of scope

- No new dependency outside the spec.
- No refactor of a file this task did not have to touch.
- No change to `docs/decisions.md`.
- No edit to `app.routes.ts`, `app.config.ts`, the shell, the theme tokens or `core/**`.
- No settings screen for repositories, jobs or runs.
- No editing of `protectedPaths`, `diffMaxFiles`, `diffMaxLines`, `dailyCostUsd` or
  `maxConcurrency` — those stay read-only fields (or absent) until a task owns the policy UI.
- No native push permission flow, no subscription management UI and no QR pairing.
- No biometric unlock, no theme editor (the theme/locale store already exists).
- No retry loop on `429`; render the `ApiError` and stop.

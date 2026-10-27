# Spec: Task-64 — Notifications

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (Angular 22 + Ionic 9, standalone components, signals, zoneless).
- **Role:** Dev.
- **Objective:** the notifications experience moves out of the Settings page body into a real
  panel — five toggleable events, the non-toggleable `Credential changed` row, and quiet hours
  that can be read and edited — and the panel exposes a payload builder that turns an SSE frame
  into exactly `{ type, id, title }` and can carry no prompt, diff or path. After this task the
  panel fetches `GET /v1/notifications/preferences`, writes toggles and quiet hours through
  `PATCH /v1/notifications/preferences`, mirrors the quiet-hours value to `PATCH /v1/settings`
  when that route exists, and the Settings screen reaches it through one small additive row.
- **Environment:** worktree `../wt-cb-64`, branch `task-64`, base `main` @ `459e75c`.
- **Dependencies (already merged):** Task-55 (`app.routes.ts`, the Settings screen route),
  Task-51 (`notificationPreferencesSchema`, `quietHoursSchema`, `Settings`), plus the daemon
  push work already merged (`apps/daemon/src/push/**`).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/app/features/settings/notifications.page.ts` (**new**)
- `apps/app/src/app/features/settings/notifications.page.spec.ts` (**new**)
- `apps/app/src/app/features/settings/notifications.store.ts` (**new**)
- `apps/app/src/app/features/settings/notifications.store.spec.ts` (**new**)
- `apps/app/src/app/features/settings/notifications.api.ts` (**new**)
- `apps/app/src/app/features/settings/notifications.api.spec.ts` (**new**)
- `apps/app/src/app/features/settings/notifications.i18n.ts` (**new**)
- `apps/app/src/app/features/settings/settings.page.ts` (modify — **additive and small**)
- `apps/app/src/app/features/settings/settings.page.spec.ts` (modify)
- `apps/app/src/app/features/settings/i18n.ts` (modify)
- `apps/app/README.md` — **shared file, section claim only.** This task may edit **only**:
  the lines whose backticked path starts with `src/app/features/settings/notifications`, plus
  the single line `src/app/features/settings/settings.page.ts`. It may **not** touch the
  `settings.page.spec.ts`, `settings.api.*`, `settings.store.*`, `devices.*`, `i18n.ts` lines,
  nor anything under `features/credentials/`, and it must not reorder or reformat the rest of
  the file. Add exactly one line per new file in the existing style:
  ``- `path` — one sentence``.
  The existing `settings.page.spec.ts` sentence ("the unavailable blocks, every section, the
  preference toggle and dictionary completeness") must stay true: keep a test in that spec that
  opens the panel and a test for the unavailable blocks.

**Forbidden to every task in this batch (do not open for writing, at all):**
`apps/app/src/app/app.routes.ts`, `apps/app/src/main.ts`, `apps/app/angular.json`,
`package.json`, `package-lock.json`, `tsconfig.base.json`, `packages/**`, `apps/daemon/**`,
`docs/**`, `TODO.md`, `CHANGELOG.md`, `docs/decisions.md`, `NOTICE`.

### Inputs (read-only)

Files this task may read, and only these beyond `AGENTS.md` and the exclusive paths above:

- `docs/app.md` §4 (`/settings`, `/settings/notifications`), §11 (push), §12 (testing)
- `docs/api.md` §5.7 (settings and push routes), §3 (error envelope)
- `packages/contracts/src/resources.ts` — `notificationPreferencesSchema`, `quietHoursSchema`,
  `settingsSchema`, `SseEventName`, `parseNotificationPreferences`, `parseSettings`
- `packages/contracts/src/primitives.ts` — `SSE_EVENT_NAMES`
- `apps/daemon/src/push/mapping.ts` — the real `NotificationType` list and
  `PREFERENCE_NAMES` (routine.replied rides on routine.fired)
- `apps/daemon/src/push/routes.ts` — `PATCH /v1/notifications/preferences` parses the **full**
  `notificationPreferencesSchema`, so every write carries both `events` and `quietHours`
- `apps/daemon/src/push/quiet-hours.ts` — the `HH:MM-HH:MM` window and its half-open bounds
- `apps/app/src/app/features/settings/settings.page.ts` (current notifications markup)
- `apps/app/src/app/features/settings/settings.store.ts`, `settings.api.ts` (read only — **do
  not modify**; `SettingsStore.preferences/togglePreference/setQuietHours` stay exported and
  unused by the page, which is allowed)
- `apps/app/src/app/features/settings/i18n.ts`, `apps/app/src/app/core/i18n/i18n.service.ts`

## 🔒 Contract

The public surface other tasks and QA are written against **right now**. Exact names.

### `notifications.api.ts` (new)

```ts
import { Injectable } from '@angular/core';
import type { NotificationPreferences, Settings } from '@codebox/contracts';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NotificationsApi {
  /** GET /v1/notifications/preferences */
  preferences(): Observable<NotificationPreferences>;
  /** PATCH /v1/notifications/preferences — body is the full `NotificationPreferences`. */
  patchPreferences(next: NotificationPreferences): Observable<NotificationPreferences>;
  /** PATCH /v1/settings with `{ quietHours }` only — the settings route's partial write. */
  patchQuietHours(value: string | null): Observable<Settings>;
}
```

Parse every response with `parseNotificationPreferences` / `parseSettings` from
`@codebox/contracts`; map transport failures to `ApiError` exactly like `settings.api.ts` does
(an `HttpErrorResponse` envelope becomes `ApiError`, malformed JSON becomes
`ApiError { code: 'contract', status: 200 }`). `patchQuietHours` does **not** swallow a 404;
the store decides what an absent settings route means.

### `notifications.store.ts` (new)

```ts
import type { Locale } from '../../core/i18n/i18n.service';

export const NOTIFICATION_EVENTS = [
  'run.finished',
  'run.failed',
  'run.merged',
  'approval.created',
  'routine.fired',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** The one row that has no toggle and is never written to `events`. */
export const LOCKED_NOTIFICATION = 'credential.changed' as const;

export interface NotificationPayload {
  readonly type: NotificationEvent;
  readonly id: string;
  readonly title: string;
}

/**
 * The SSE frame -> display projection. Reads `type` and one id field, writes exactly three
 * keys. Anything else on `data` (prompt, diff, path, payload) is dropped, never spread.
 */
export function buildNotificationPayload(
  frame: { readonly type: string; readonly data: Readonly<Record<string, unknown>> },
  locale: Locale,
): NotificationPayload | null;

@Injectable()
export class NotificationsStore {
  readonly preferences = signal<NotificationPreferences | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  /** `event name` while a toggle is in flight, `'quiet'` while quiet hours are saved. */
  readonly saving = signal<string | null>(null);
  /** Result of mirroring the window to `PATCH /v1/settings`. */
  readonly mirror = signal<'absent' | 'synced' | 'failed' | null>(null);

  load(): void;
  reload(): void;
  toggle(event: NotificationEvent, enabled: boolean): void;
  saveQuietHours(value: string | null): void;
}
```

Frozen behaviour:

- `buildNotificationPayload` returns `null` for an unknown `type` and for a known type whose id
  field is missing or not a non-empty string. Id field per type:
  `run.finished|run.failed|run.merged` → `data.runId`; `approval.created` → `data.approvalId`;
  `routine.fired` → `data.routineId`. `title` is
  `translate(locale, 'notifications.title.' + type)` from `notifications.i18n.ts`.
- `toggle` is optimistic: it writes the new full `NotificationPreferences` into `preferences()`
  first, then `PATCH /v1/notifications/preferences`; on error it restores the previous object and
  sets `error`. The `events` array keeps `NOTIFICATION_EVENTS` order, contains no duplicates and
  **never** contains `LOCKED_NOTIFICATION`.
- `saveQuietHours` validates with `quietHoursSchema.safeParse` (empty string is normalised to
  `null`); an invalid value sets `error` to an `ApiError` with `code: 'contract'` and issues no
  request. A valid value goes through `patchPreferences({ events, quietHours })` and, on
  success, **then** `patchQuietHours(value)`: a 404 on the settings call sets
  `mirror('absent')` and is not an error; any other failure sets `mirror('failed')` and `error`
  while keeping the saved preferences. Success sets `mirror('synced')`.
- Only one write may be in flight: `saving() !== null` blocks a second `toggle`/`saveQuietHours`.

### `notifications.page.ts` (new; the panel, no route)

```ts
@Component({
  selector: 'app-notifications-panel',
  standalone: true,
  providers: [NotificationsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsPanel {
  readonly closed = output<void>();
  readonly events = NOTIFICATION_EVENTS; // render order, exactly this order
  readonly t: (key: string) => string;
  isEnabled(event: NotificationEvent): boolean;
  onToggle(event: NotificationEvent, change: Event): void;
  onQuietInput(event: Event): void;
  saveQuietHours(): void;
  close(): void; // emits `closed`
}
```

`data-testid` values, frozen:

| hook | element | attributes |
| --- | --- | --- |
| `notifications-panel` | root `<div>` | `data-events="5"`, `data-locked="credential.changed"` |
| `notifications-loading` | loading line | — |
| `notifications-error` | error block | `data-code` = `ApiError.code` |
| `notifications-retry` | `<button>` | calls `store.reload()` |
| `notifications-toggle-<event>` | one `<input type="checkbox">` per event, e.g. `notifications-toggle-run.finished` | `data-enabled` = `'true'\|'false'`, `checked` bound to `isEnabled` |
| `notifications-locked-credential` | the `Credential changed` row | `data-locked="true"`; **contains no `input` element** |
| `notifications-quiet-hours` | `<input type="text">`, `placeholder="22:00-07:00"` | `data-quiet-hours` = the saved value or `''` |
| `notifications-quiet-save` | `<button>` | disabled while `saving() === 'quiet'` |
| `notifications-quiet-current` | `<p>` | `data-quiet-hours` = the saved value or `''`, `data-mirror` = `mirror() ?? ''` |
| `notifications-close` | `<button>` | calls `close()` |

The panel renders the five toggles, then the locked row, then the quiet-hours field. The locked
row is explanatory only: no toggle, no input, never part of a PATCH body.

### `settings.page.ts` (modify — additive and small)

Two additions only. Do **not** restructure the page, do not touch the profile, time zone,
devices, providers, danger or about sections.

1. Replace the current notifications section body (the `cb-toggles` list, the quiet-hours field
   and the `preferenceEvents` / `isEnabled` / `togglePreference` / `setQuietHours` /
   `saveQuietHours` / `quietHours` members and their now-unused imports) with one row:
   `<button type="button" data-testid="settings-notifications-open">` labelled with
   `t('settings.notifications.open')`.
2. Below that row: `@if (notificationsOpen()) { <app-notifications-panel (closed)="notificationsOpen.set(false)" /> }`
   with `readonly notificationsOpen = signal(false);` and `import { NotificationsPanel } from './notifications.page';`
   added to the component's `imports`.

The subscription values are now owned by the panel; `SettingsStore` and `SettingsApi` are not
modified, even though their preference members become unused by this page.

### `i18n.ts` (modify)

One new key in `apps/app/src/app/features/settings/i18n.ts`, both locales:
`settings.notifications.open` — `Notifications` / `Notificaciones` (configurable copy, but the
key is frozen). Keep every existing key; do not remove `settings.preference.*` or
`settings.quiet.*` (other tasks and the old spec still reference the concept, and removing keys
is a diff nobody needs).

### `notifications.i18n.ts` (new)

```ts
export type Locale = 'en' | 'es';
export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>>;
export function translate(locale: Locale, key: string): string;
```

Keys, frozen, both locales, same set:

```
notifications.title                 notifications.locked.title      notifications.locked.hint
notifications.quiet.title           notifications.quiet.hint        notifications.quiet.none
notifications.quiet.save            notifications.quiet.saved       notifications.quiet.absent
notifications.quiet.failed          notifications.close             notifications.retry
notifications.title.run.finished    notifications.title.run.failed  notifications.title.run.merged
notifications.title.approval.created  notifications.title.routine.fired
```

`notifications.locked.title` is `Credential changed` (EN) / `Credencial cambiada` (ES).
`notifications.quiet.none` is the text shown when `quietHours === null`.

### Data

| key | shape | default |
| --- | --- | --- |
| `GET /v1/notifications/preferences` | `{ events: SseEventName[], quietHours: 'HH:MM-HH:MM' \| null }` | server-owned |
| `PATCH /v1/notifications/preferences` | the same full object | — |
| `PATCH /v1/settings` | `{ quietHours }` only | — |
| `NotificationPayload` | `{ type, id, title }` — exactly three keys | — |

## 🧩 Configuration

None — no new `CB_*` key, no new dependency, no `angular.json` change, no push-subscription
change (`POST /v1/push/subscriptions` is out of scope).

## 🧪 Test and Validation Plan (for QA)

- **Method** (run from the root of the worktree `../wt-cb-64`):
  - `npm ci --prefer-offline --no-audit --no-fund` — a fresh worktree has no `node_modules`.
  - `npm run lint` — must pass.
  - `npm test` — the root gate: `test:guard`, the full app unit suite through
    `npm test -w @codebox/app` (`ng test --watch=false`, Vitest + jsdom, headless), then the
    workspace Vitest projects. Every test below runs here.
  - `npm run build` — `tsc -b` plus the app production build.
  - `git diff --name-only main...task-64` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean (`npm run lint`, `npm run build`).
  - [ ] `[unit]` `notifications.store.spec.ts` — *payload builder*: for a frame
        `{ type: 'run.failed', data: { runId: 'run_01JABCDEFGHJKMNPQRSV', prompt: 'secret', diff: '--- a', path: '/etc/passwd' } }`
        the result deep-equals `{ type: 'run.failed', id: 'run_01JABCDEFGHJKMNPQRSV', title: 'A run failed' }`,
        `Object.keys(result)` is exactly `['type', 'id', 'title']`, and
        `JSON.stringify(result)` contains neither `secret`, `--- a` nor `/etc/passwd`.
        The same assertion for `approval.created` (id from `data.approvalId`) and
        `routine.fired` (id from `data.routineId`); `null` for `run.queued`, for a missing id
        and for `id: ''`.
  - [ ] `[unit]` `notifications.page.spec.ts` — *five toggles, exact order*: after flushing
        preferences with `events: ['run.finished']`, the panel renders exactly five
        `[data-testid^="notifications-toggle-"]` inputs in the order of `NOTIFICATION_EVENTS`,
        `notifications-toggle-run.finished` has `data-enabled="true"` and the other four
        `data-enabled="false"`.
  - [ ] `[unit]` `notifications.page.spec.ts` — *Credential changed has no toggle*:
        `notifications-locked-credential` exists, has `data-locked="true"`,
        `querySelector('input')` is `null`, its text contains `Credential changed` in `en` and
        `Credencial cambiada` in `es`.
  - [ ] `[unit]` `notifications.page.spec.ts` — *a toggle posts the full object*: clicking
        `notifications-toggle-run.merged` sends exactly one
        `PATCH /v1/notifications/preferences` whose body deep-equals
        `{ events: ['run.finished', 'run.merged'], quietHours: <unchanged> }`; on a flushed
        `500` the checkbox returns to `data-enabled="false"` and `notifications-error` shows
        `data-code="internal"`.
  - [ ] `[unit]` `notifications.store.spec.ts` — *quiet hours write both routes in order*:
        `saveQuietHours('22:00-07:00')` issues `PATCH /v1/notifications/preferences` with the
        full object and then `PATCH /v1/settings` with exactly `{ quietHours: '22:00-07:00' }`;
        `mirror()` is `'synced'` after both succeed. With the settings call flushed as `404`,
        `mirror()` is `'absent'`, `error()` stays `null`, and `preferences().quietHours` is
        still `'22:00-07:00'`. `saveQuietHours('25:00-08:00')` issues **no** request and sets
        `error().code === 'contract'`. `saveQuietHours('')` sends `quietHours: null`.
  - [ ] `[unit]` `notifications.api.spec.ts` — the three URLs and methods
        (`GET /v1/notifications/preferences`, `PATCH /v1/notifications/preferences`,
        `PATCH /v1/settings`) and a malformed response mapped to `ApiError { code: 'contract' }`.
  - [ ] `[unit]` `settings.page.spec.ts` — `settings-notifications-open` exists on the Settings
        screen, and clicking it renders `notifications-panel`; the panel's `notifications-close`
        hides it again. The panel's own `load()` issues `GET /v1/notifications/preferences`
        (`SettingsStore.load()` may already have requested the same URL for the old section —
        match by URL with `http.match(...)`, never `expectOne`, and flush every match). The
        existing unavailable-blocks tests still pass.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-64` prints only paths from the list, plus the
        `apps/app/README.md` lines claimed here.
  - [ ] `[live]` A question interrupts quiet hours and a finished run does not.
        **Measurement:** on the box, set `22:00-07:00` in the panel, then
        `curl -s -H "Authorization: Bearer $CB_TOKEN" https://<host>/v1/notifications/preferences`
        returns `"quietHours":"22:00-07:00"`; inside that window, trigger an `approval.created`
        (a chat permission) and observe one push on the paired device within 60 s, then let a
        non-merged run finish and observe **no** push (`journalctl -u cbd -o cat` shows no
        `push_sent` line for that `run:<id>` tag inside the window). This needs a live daemon,
        a tunnel and a real device: QA reports it **not run** in this environment and the
        Orchestrator files one `agent-review` issue.

## 📣 Coordination

- **Recorded deviation — no `/settings/notifications` route.** The frozen router
  (`apps/app/src/app/app.routes.ts`, untouchable here) has no notifications route, so the panel
  is a component rendered by `settings.page.ts` behind the
  `settings-notifications-open` row. `docs/app.md` §4 and `design/README.md` §1 still describe
  the screen as a route; that mismatch is recorded for the next docs pass, not fixed here.
- **Task-63 touches the same file.** `settings.page.ts` is also edited by Task-63 (Settings,
  Devices and Providers). This task's change must stay additive and small — one row plus one
  `@if` block — so the later merge rebases cleanly. Do not renumber sections or move the
  notifications section.
- **The locked alert has no event name.** `SSE_EVENT_NAMES` carries no credential event, so
  `Credential changed` is display-only and is never written to `events`; a real event is a
  contracts change owned elsewhere.
- **Two quiet-hours stores, one owner.** The daemon reads `quietHours` from the notification
  preferences (`apps/daemon/src/push/service.ts`), so `PATCH /v1/notifications/preferences` is
  authoritative and `PATCH /v1/settings` is a mirror written best-effort. `GET/PATCH /v1/settings`
  does not exist in the current daemon; a 404 there is `mirror('absent')`, not a failure.
- **`docs/app.md` §11 payload vs this builder.** §11 describes the daemon's push body
  (`{ type, …, title, body }`). The builder frozen here is the app-side frame→display
  projection, deliberately narrower: `{ type, id, title }`. The daemon body is unchanged.
- `SettingsStore` / `SettingsApi` keep their preference members; only the page stops using them.
  No hot file, no `packages/contracts` and no `apps/daemon` change is owed.

## ⛔ Out of scope

- No change to `app.routes.ts`, `settings.api.ts`, `settings.store.ts`, `devices.*`,
  `features/credentials/**`, `src/assets/i18n/*.json` or any file outside the exclusive paths.
- No push-subscription registration (`PushManager`/VAPID), no notification permission prompt,
  no service-worker change.
- No new dependency, no `angular.json` change, no new `CB_*` key.
- No removal of the now-unused `SettingsStore` preference members.
- No change to `TODO.md`, `CHANGELOG.md`, `docs/decisions.md` or `docs/app.md`.

## ✅ Finish

The dev finishes with the gate green — `npm ci && npm run lint && npm test && npm run build`
from the repository root — then creates an **empty** commit whose subject is exactly
`dev: done task-64` and pushes it to `origin/task-64`. This spec file at
`.agent_specs/task-64.md` is committed by the Orchestrator before the dev starts; the dev must
not create, edit or commit anything under `.agent_specs/`, must not tick `TODO.md` and must not
write `CHANGELOG.md`.

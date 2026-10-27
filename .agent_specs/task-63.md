# Spec: Task-63 — Settings, Devices and Providers

> The spec is your entire world. Anything not written here does not exist.

## 🎯 Scope

- **Task type:** app (`@codebox/app`).
- **Role:** Dev.
- **Objective:** finish the settings surface: the rows that reach a real action (Devices,
  Notifications, Credentials, Providers), a Providers panel that renders each provider's
  status without a second source of truth, and the Devices screen's remaining promise — one
  scope list per device, revoke, and this device cannot revoke itself. After this task every
  row on `/settings` does something, and every one of those behaviours has a spec.
- **Environment:** worktree `../wt-cb-63`, branch `task-63`, base `main` @ `e447dfe`.
- **Dependencies (already merged):**
  - Task-23 / Task-55 — `features/settings/**` exists and `/settings/devices` is routed.
  - Task-64 — the notifications panel (`features/settings/notifications.*`); you mount it
    from the row, you do not edit it.
  - Task-62 — `/settings/credentials` is routed; you add the row.
  - Task-58 — `GET /v1/providers` with `provider`, `configured`, `mode`, `lastOkAt`,
    `fingerprint`.

### Exclusive paths (single writer)

- `apps/app/src/app/features/settings/settings.page.ts`
- `apps/app/src/app/features/settings/settings.page.spec.ts`
- `apps/app/src/app/features/settings/devices.page.ts`
- `apps/app/src/app/features/settings/devices.page.spec.ts`
- `apps/app/src/app/features/settings/devices.store.ts`
- `apps/app/src/app/features/settings/devices.store.spec.ts`
- `apps/app/src/app/features/settings/devices.api.ts` (only if you must add a read)
- `apps/app/src/app/features/settings/providers.page.ts`
- `apps/app/src/app/features/settings/providers.page.spec.ts`
- `apps/app/src/app/features/settings/providers.store.ts`
- `apps/app/src/app/features/settings/providers.store.spec.ts`
- `apps/app/src/app/features/settings/i18n.ts` — append keys; keep both locales in parity.
- `apps/app/README.md` — **section only:** one line per new file, inside the
  `features/settings/` block, alphabetical. Do not edit any other line. Three batch-mates
  write other sections of this file.

The spec file `.agent_specs/task-63.md` is committed on your branch by the Orchestrator. It is
the only file outside your paths and you never modify it.

### Inputs (read-only)

- `docs/app.md` §4 (`/settings`, `/settings/devices`, `/settings/credentials`), §5, §9 (320 px).
- `design/README.md` §1 — frames `06` (Settings), `15` (Devices), `16` (Credentials), `17`
  (Notifications), light `L6`, `L21`, `L8`, `L22`.
- `packages/contracts/src/resources.ts` — `deviceSchema`, `providersSchema`,
  `providerStatusSchema`, `meSchema`.
- `apps/app/src/app/features/settings/settings.api.ts` — `me`, `providers`, `devices`,
  `revokeDevice` already exist; reuse them.
- `apps/app/src/app/features/settings/notifications.page.ts` — the panel you mount.
- `apps/app/src/app/features/credentials/credentials.page.ts` — the routed screen you link.
- `apps/app/src/app/core/auth/auth.store.ts` — `logout`, used when the current device goes.

## 🔒 Contract

```ts
// settings.page.ts — four rows, each with a stable test id
//   settings-devices-link      -> routerLink="/settings/devices"
//   settings-notifications-open-> opens <app-notifications-panel> inline (existing pattern)
//   settings-credentials-link  -> routerLink="/settings/credentials"   (new)
//   settings-providers-open    -> opens the providers panel inline      (new)
// Keep the existing profile, danger-zone and about sections working.

// providers.page.ts
@Component({ selector: 'app-providers-panel' })
export class ProvidersPanel {
  readonly closed = output<void>();
}
// providers.store.ts
export class ProvidersStore {
  readonly providers: Signal<readonly ProviderStatus[]>;
  readonly unavailable: Signal<boolean>;
  load(): void;
}

// devices.store.ts — one addition, no behaviour change to what exists
readonly revokingId: Signal<string | null>;   // the row in flight, so one revoke at a time
```

- One read path per screen: the store calls `SettingsApi`; a component never calls
  `HttpClient` and never calls OpenCode or GitHub.
- A provider row carries `[attr.data-configured]` and `[attr.data-mode]`; `lastOkAt` renders
  through the existing time formatting, never raw.
- A `503`/`404` from `/v1/providers` renders the "unavailable" copy, not an empty list.
- **This device cannot revoke itself**: the current device's revoke control is absent (not
  merely disabled) and the row carries the "current" marker; when any *other* device is
  revoked the store reflects the new list, and a revoke of the current device — impossible
  from the UI — still logs out locally, as it does today.

### Data

- Providers are rendered from `Providers.providers` only: no hard-coded provider list, no
  invented `model` field.
- `fingerprint` is shown only when present; never a prefix longer than four characters and
  never a secret.
- Devices: `scopes` joined with a space inside a `<span class="cb-mono">`, `lastSeenAt` or the
  "never" copy.

### The model choice is not in this task

`settingsSchema` has no `model` key, `PATCH /v1/settings` is a strict schema, no route lists
models, and this task's paths are app-only. A model selector here would invent a second source
of truth. Do **not** build one, and do not store a choice in the device's secure store. State
the gap in `providers.page.ts` as a comment-free fact of the plan (Coordination below), not as
dead UI.

## ⚙️ Configuration

None. No new `CB_*` key, no new dependency.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `git diff --name-only main...task-63` — audit against the exclusive paths; extras allowed:
    `.agent_specs/task-63.md` and lines of `apps/app/README.md`.
- **Acceptance criteria:**
  - [ ] `[unit]` `/settings` renders the four action rows and each one does its thing: the two
        links carry the right `routerLink`, the two buttons open their panels, and a second
        click closes them.
  - [ ] `[unit]` the providers panel renders one row per provider from the response, with
        `configured` and `mode` attributes; an unavailable read renders the "unavailable" copy
        and no rows.
  - [ ] `[unit]` the devices page renders one scope line per device, the current-device marker,
        and no revoke control on the current device.
  - [ ] `[unit]` revoking another device issues one `DELETE` and refreshes the list; a second
        tap while in flight issues nothing.
  - [ ] `[unit]` EN/ES parity of `features/settings/i18n.ts`.
  - [ ] `[unit]` nothing outside the exclusive paths was touched.
  - [ ] `[live]` **Not runnable here (no browser in CI).** Measurement, for the review issue:
        on the VM, a revoked device's next request is a 401 and `/settings` routes it to
        `/pair` with the reason; measured with `npx playwright test` at 320×640 against a
        daemon on an ephemeral port. Report it as **not run**.

## 📣 Coordination

- **For the Architect:** the model choice of this task has no server-side home
  (`settingsSchema` has no `model`, `PATCH /v1/settings` is strict, no models route), so it is
  deliberately not built; a contract task must add the key before a selector can be honest.
- **For the next batch:** the providers panel is inline, like notifications, because the
  frozen router has no `/settings/providers`. If the route is added later, the panel is
  already a standalone component.

## ⛔ Out of scope

- `app.routes.ts`, `core/**`, `packages/contracts/**`, `features/settings/notifications.*`,
  `features/credentials/**`, the shared dictionaries.
- Changing the settings schema, the provider contract or the daemon.
- Danger zone and about: they already work; do not rewrite them.
- No new dependency. No refactor of files you were not given.

## ✅ Handover

Commit your work, `git push -u origin task-63`, then
`git commit --allow-empty -m "dev: done task-63" && git push`. Report per `.agent_roles/dev.md`:
task id, worktree, branch tip sha, commands with exit codes, checklist, files, deviations.

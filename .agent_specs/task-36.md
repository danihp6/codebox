# Spec: Task-36 — Routines UI

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (Angular 22 + Ionic Angular 9, standalone components, signals).
- **Role:** Dev.
- **Objective:** a `/jobs` screen with two in-page tabs — **Jobs** (unchanged) and **Routines** —
  where the operator lists the chat schedules, sees each routine's kind, cost label, schedule in
  its own timezone, next and last fire, and can pause, resume, run now, edit (title, cron,
  timezone, prompt, notify) and delete one; plus a chat confirmation card when the agent creates
  a routine through the `routine.create` tool and a `routine` badge on the message a routine
  produced. No new route, no new route file, no new dependency.
- **Environment:** worktree `../wt-cb-36`, branch `task-36`, base `main`.
- **Dependencies (already merged, read them, do not edit them):**
  - Task-18 — the routed app shell (`apps/app/src/app/app.routes.ts` already serves `/jobs`
    and `/chat/:id`; it is a hot file and **out of scope** here).
  - Task-21 — the jobs list, the cron picker, the timezone editor and the jobs dictionary this
    task extends.
  - Task-20 — the chat screen, its store and its stream reducer this task extends, and
    `apps/app/src/app/core/events/sse.service.ts`, the one SSE signal both features subscribe to.
  - Task-35 — `apps/daemon/src/routines/routes.ts` (the `/v1/routines` routes) and
    `docs/api.md` §5.8 (their contract).
  - Task-38 — `apps/daemon/src/chat/tools/routine-tools.ts` (the `routine.create` tool) and
    `packages/contracts/src/routines.ts` (the `Routine` shape and the tool schemas).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/app/features/jobs/jobs.page.ts`
- `apps/app/src/app/features/jobs/jobs.page.spec.ts`
- `apps/app/src/app/features/jobs/i18n.ts`
- `apps/app/src/app/features/jobs/routines.api.ts` *(new)*
- `apps/app/src/app/features/jobs/routines.api.spec.ts` *(new)*
- `apps/app/src/app/features/jobs/routines.store.ts` *(new)*
- `apps/app/src/app/features/jobs/routines.store.spec.ts` *(new)*
- `apps/app/src/app/features/jobs/routines-format.ts` *(new)*
- `apps/app/src/app/features/jobs/routines-format.spec.ts` *(new)*
- `apps/app/src/app/features/jobs/routines-panel.ts` *(new)*
- `apps/app/src/app/features/jobs/routines-panel.spec.ts` *(new)*
- `apps/app/src/app/features/chat/chat-stream.ts`
- `apps/app/src/app/features/chat/chat-stream.spec.ts`
- `apps/app/src/app/features/chat/chat.store.ts`
- `apps/app/src/app/features/chat/chat.store.spec.ts`
- `apps/app/src/app/features/chat/chat.page.ts`
- `apps/app/src/app/features/chat/chat.page.spec.ts`
- `apps/app/src/app/features/chat/i18n.ts`
- `docs/app.md` (sections: §4 the `/jobs` row; §5 one new routines bullet; §8 the chat
  routines bullet — **these sections only**)
- `apps/app/README.md` (feature-file rows only: one line per new `features/jobs/*` and
  `features/chat/*` file, and the corrected descriptor of the two feature folders; nothing else
  in that file)

**Hot files this task must not touch:** `apps/app/src/app/app.routes.ts`, `apps/app/angular.json`,
`apps/app/src/main.ts`, `package.json`, `package-lock.json`, `packages/contracts/**`,
`apps/app/src/app/core/**` (including `core/api/**`), `TODO.md`, `CHANGELOG.md`,
`docs/decisions.md`. There is **no** new route and no query-param routing in this task.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `packages/contracts/src/routines.ts`, `packages/contracts/src/primitives.ts`,
  `packages/contracts/src/events.ts`, `packages/contracts/src/index.ts`
- `docs/api.md` §5.8 and §6; `docs/jobs.md` §15; `docs/app.md` §4, §5, §8
- `apps/daemon/src/routines/routes.ts`, `apps/daemon/src/routines/fire.ts`,
  `apps/daemon/src/chat/tools/routine-tools.ts` (read only — **do not edit daemon code**)
- `apps/app/src/app/features/jobs/*` (existing `jobs.page.ts`, `jobs.api.ts`, `jobs.store.ts`,
  `cron.ts`, `cron-picker.ts`, `time-format.ts`, `i18n.ts` and their specs)
- `apps/app/src/app/features/chat/*` (all existing files)
- `apps/app/src/app/core/events/sse.service.ts`, `apps/app/src/app/core/api/api-client.ts`,
  `apps/app/src/app/core/i18n/i18n.service.ts`
- `apps/app/src/app/features/settings/devices.page.ts` and `devices.page.spec.ts` (the
  confirm-then-act pattern to imitate)

## 🔒 Contract

The public surface QA writes against **right now**. Exact names, signatures and behaviour.

### `apps/app/src/app/features/jobs/routines.api.ts`

```ts
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { Page, Routine } from '@codebox/contracts';

export type RoutineKind = Routine['kind']; // 'prompt' | 'reminder'

export interface RoutinesQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly kind?: RoutineKind;
  readonly enabled?: boolean;
}

export interface RoutinePatchBody {
  readonly title?: string;
  readonly cron?: string;
  readonly timezone?: string;
  readonly prompt?: string;
  readonly notify?: boolean;
}

@Injectable({ providedIn: 'root' })
export class RoutinesApi {
  list(query?: RoutinesQuery): Observable<Page<Routine>>;
  get(id: string): Observable<Routine>;
  patch(id: string, body: RoutinePatchBody): Observable<Routine>;
  pause(id: string): Observable<Routine>;
  resume(id: string): Observable<Routine>;
  runNow(id: string): Observable<Routine>;
  remove(id: string): Observable<void>;
}
```

- Every response is parsed at the boundary with `parsePage(routineSchema, body, 'routines')`,
  `parseRoutine`, or `(): void => undefined` for the 204. Never cast; never `any`.
- `enabled` in the query is serialised as `'true'` / `'false'`; `kind` verbatim.
- URLs are exactly `${API_BASE_URL}${API_PREFIX}/routines` (and `/routines/{id}`,
  `/routines/{id}/pause`, `/resume`, `/run`). `pause`, `resume` and `runNow` are `POST` with a
  `null` body. `remove` is `DELETE`. `patch` is `PATCH` with the body minus undefined keys.
- Failures become `ApiError` (same `toApiError` shape as `jobs.api.ts`); a contract parse
  failure keeps its `ContractParseError` type.
- **There is no `create` method.** Creation is conversational (docs/jobs.md §15); the daemon
  route exists but the app does not call it.

### `apps/app/src/app/features/jobs/routines.store.ts`

```ts
@Injectable()
export class RoutinesStore {
  readonly routines: Signal<readonly Routine[]>;
  readonly loading: Signal<boolean>;      // starts true
  readonly error: Signal<ApiError | null>;
  readonly busy: Signal<string | null>;   // routine id with a pause/resume/delete in flight
  readonly running: Signal<string | null>; // routine id with a run-now in flight

  load(): void;                            // GET /v1/routines?limit=100
  pause(routine: Routine): void;           // optimistic enabled:false, nextFireAt:null
  resume(routine: Routine): void;          // optimistic enabled:true, server replaces on success
  runNow(routine: Routine): void;          // POST /run, 202, merges the returned routine
  remove(routine: Routine): void;          // DELETE, 204, drops the row
  replace(routine: Routine): void;         // merge one routine into the list (editor save)
  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored';
}
```

- `pause` and `resume` are optimistic with rollback on error — they are toggles, the only
  optimistic case docs/app.md §5 allows. `runNow` and `remove` are not optimistic.
- `applyStreamEvent` returns `'applied'` and calls `load()` exactly once for `routine.fired`,
  `routine.replied` and `routine.failed`; every other event returns `'ignored'` and changes
  nothing (in particular `job.changed` belongs to `JobsStore`).
- A `409`/`422`/`404` on any action sets `error` and leaves/restores the list; it never
  throws out of the store.

### `apps/app/src/app/features/jobs/routines-format.ts`

```ts
import type { Routine } from '@codebox/contracts';

export function routineSchedule(routine: Routine, locale: 'en' | 'es'): string;
// `${summarise(routine.cron, locale)} · ${routine.timezone}`
// e.g. "Every day at 07:00 · Europe/Madrid" / "Cada día a las 07:00 · Europe/Madrid"

export function routineNextFire(routine: Routine, locale: 'en' | 'es'): string | null;
// null when routine.nextFireAt === null; else formatFire(nextFireAt, routine.timezone, locale)

export function routineLastFire(routine: Routine, locale: 'en' | 'es'): string | null;
// the same over routine.lastFiredAt
```

`summarise` comes from `./cron`, `formatFire` from `./time-format` — do not reimplement cron
arithmetic or date formatting.

### `apps/app/src/app/features/jobs/routines-panel.ts`

A standalone component, `selector: 'app-routines-panel'`, `providers: [RoutinesStore]`,
`imports: [CronPickerComponent]` (plain HTML inside; **no `ion-segment`, no `ion-modal`** so the
jsdom tests need no extra provider). It creates its own `SseService` subscription:

- on construction: `store.load()`;
- every `sse.event()` that is non-null is passed to `store.applyStreamEvent(event)` inside
  `untracked`.

Template contract (QA selects these `data-testid` values verbatim):

| Hook | Meaning |
| --- | --- |
| `routines-panel` | Root element; `[attr.data-loading]` = `store.loading()` |
| `routines-loading` | Shown while `store.loading()` |
| `routines-error` | Error block; `[attr.data-code]="failure.code"` |
| `routines-retry` | Button → `store.load()` |
| `routines-empty` | Shown when not loading, no error and `store.routines().length === 0` |
| `routine-row` | One per routine; `[attr.data-routine-id]`, `[attr.data-kind]`, `[attr.data-enabled]` |
| `routine-kind` | `t('routines.kind.prompt')` or `t('routines.kind.reminder')` |
| `routine-cost` | `t('routines.cost.prompt')` or `t('routines.cost.reminder')` |
| `routine-schedule` | `routineSchedule(routine, locale())` |
| `routine-next` | Present only when `nextFireAt !== null`; `[attr.data-at]="routine.nextFireAt"` and `routineNextFire(...)` |
| `routine-last` | `routineLastFire(...)` or `t('routines.never')` |
| `routine-state` | `t('routines.state.enabled')` / `t('routines.state.paused')` |
| `routine-pause` / `routine-resume` | One of the two, by `routine.enabled`; disabled while `store.busy() === routine.id` |
| `routine-run-now` | Disabled while `store.running() === routine.id` |
| `routine-edit` | Opens the editor |
| `routine-delete` | Arms the confirmation |
| `routine-delete-confirm` | Confirm: calls `store.remove(routine)` |
| `routine-delete-cancel` | Disarms |
| `routine-sheet` | Editor block; `role="dialog"`, `aria-modal="true"`, only while editing |
| `routine-form-title`, `routine-form-timezone`, `routine-form-notify` | Inputs |
| `routine-form-prompt` | Textarea, rendered **only** for `kind === 'prompt'` |
| `routine-form-cron` | The existing `<app-cron-picker>` wrapped in an element with this test id (do not invent a second cron input) |
| `routine-form-save`, `routine-form-cancel`, `routine-form-error` | Editor actions and error |

Editor rules:

- `routine-delete` only arms a confirmation; **no request leaves the app before
  `routine-delete-confirm` is clicked**. The armed row is `[attr.data-armed="true"]`.
- `routine-form-save` validates locally: non-empty title, `validateCron(cron).ok`, non-empty
  timezone. A failure renders `routine-form-error` with `[attr.data-code]="'validation_failed'"`
  and `details.path` `routine.title` / `routine.cron` / `routine.timezone`, and sends nothing.
- On success it sends exactly
  `{ title, cron, timezone, notify }` for a `reminder` and
  `{ title, cron, timezone, notify, prompt }` for a `prompt` — never `prompt` for a reminder
  (the daemon answers 422), never `enabled` (pause/resume own that), never `kind` or `repoId`.
- The save merges the PATCH response with `store.replace(updated)` and closes the editor.
  A failed PATCH leaves the editor open, shows `routine-form-error` with the `ApiError` code and
  `details.path`, and does not mutate the list.

### `apps/app/src/app/features/jobs/jobs.page.ts`

- `readonly tab = signal<'jobs' | 'routines'>('jobs')` — **in-page tabs, not routes**.
- `data-testid="page-jobs"` gains `[attr.data-tab]="tab()"`.
- `data-testid="jobs-tabs"` holds two `<button type="button">`: `jobs-tab-jobs` and
  `jobs-tab-routines`, each with `[attr.data-active]="tab() === 'jobs'"` /
  `[attr.data-active]="tab() === 'routines'"` and `[attr.aria-selected]`.
- `@if (tab() === 'jobs')` wraps the existing jobs section verbatim; `@if (tab() === 'routines')`
  renders `<app-routines-panel />`. Switching tabs does not navigate.
- The existing `JobsStore` load, form, SSE handler and tests keep working unchanged.

### `apps/app/src/app/features/chat/chat-stream.ts`

```ts
import type { Routine } from '@codebox/contracts';

export const ROUTINE_CREATE_WINDOW_SECONDS = 120;

export interface ChatRoutineCard {
  readonly key: string;   // `routine:${routine.id}`
  readonly routine: Routine;
}

export interface ChatStreamState {
  readonly messages: readonly ChatStreamItem[];
  readonly tools: readonly ChatToolCard[];
  readonly permissions: readonly ChatPermissionCard[];
  readonly routines: readonly ChatRoutineCard[];      // new
  readonly routineMessageIds: readonly string[];      // new — message ids from routine.replied
  readonly working: boolean;
  readonly lastSeq: number;
}

export function pickCreatedRoutine(
  routines: readonly Routine[],
  chatId: string,
  toolTs: string,
): Routine | null;

export function withRoutineCard(state: ChatStreamState, routine: Routine): ChatStreamState;

export function isRoutineMessage(state: ChatStreamState, messageId: string | null): boolean;
```

Rules, exact:

- `EMPTY_CHAT` gains `routines: Object.freeze([])` and `routineMessageIds: Object.freeze([])`.
- `applyChatEvent(state, chatId, event)` handles `routine.replied` (`data` is
  `{ routineId, chatId, messageId, ts }`, **no `seq`**): when `data.chatId === chatId`, append
  `data.messageId` to `routineMessageIds` unless present, and leave `lastSeq` untouched; return
  the identical state for another chat or a duplicate id.
- `pickCreatedRoutine` keeps the list order the API returned (newest first). It keeps only
  routines whose `Date.parse(createdAt) >= Date.parse(toolTs) - 120_000` **and** that are
  attributable to this chat: `kind === 'prompt'` with `chatSessionId === chatId`, or
  `kind === 'reminder'`. It returns the first survivor, or `null`. An unparsable `toolTs`
  returns `null`.
- `withRoutineCard` returns the identical state when a card for `routine.id` exists; otherwise
  appends `{ key: 'routine:' + routine.id, routine }`.
- `isRoutineMessage(state, null)` is `false`; otherwise membership in `routineMessageIds`.

### `apps/app/src/app/features/chat/chat.store.ts`

- Inject `RoutinesApi` (from `../jobs/routines.api`) in addition to `ChatApi`.
- A module constant `const ROUTINE_LOOKUP_LIMIT = 10;` in `chat.store.ts` (not a class property).
- `applyStreamEvent` keeps its `'applied' | 'ignored' | 'refetch'` return type. After it applies
  a frame whose state actually changed, if the frame is `chat.tool` with
  `data.tool === 'routine.create'`, `data.status === 'ok'` and `data.chatId === chatId()`, it
  calls `RoutinesApi.list({ limit: 10 })` exactly once, then
  `stream.update(s => withRoutineCard(s, routine))` when `pickCreatedRoutine(page.data, chatId, event.data.ts)`
  returns a routine. A failed lookup sets `error` and renders the normal error block; it never
  removes messages.
- A `chat.tool` `routine.create` with `status: 'error'` does **not** fetch.
- `load(chatId)` already resets the stream to `EMPTY_CHAT`, which clears the cards and the
  badge ids; keep that.

### `apps/app/src/app/features/chat/chat.page.ts`

- Add `RouterLink` to `imports`.
- Render the cards **before** the tool cards:
  `data-testid="chat-routine-card"` with `[attr.data-routine-id]`, `[attr.data-kind]`,
  a `chat-routine-kind` line (`t('chat.routine.kind.prompt')` /
  `t('chat.routine.kind.reminder')` chosen with `@if`, so both keys stay literal),
  `chat-routine-local` = `routineSchedule(routine, locale())`,
  `chat-routine-next` present only when `nextFireAt !== null`, carrying
  `[attr.data-at]="routine.nextFireAt"` and `routineNextFire(routine, locale())`, and
  `<a routerLink="/jobs" data-testid="chat-routine-open">` with `t('chat.routine.open')`.
- Inside the message loop, when `isRoutine(item.messageId)`, render
  `data-testid="chat-routine-badge"` with `t('chat.routine.badge')` and
  `<a routerLink="/jobs" data-testid="chat-routine-link">` with `t('chat.routine.list')`.
- Expose `schedule(routine)`, `nextFire(routine)` and `isRoutine(messageId)` as component
  methods over the store signals; `isRoutine` delegates to the pure
  `isRoutineMessage(this.store.stream(), messageId)`. No new store.

### Data

Frozen constants and shapes.

| Name | Value | Where |
| --- | --- | --- |
| `ROUTINES_PAGE_SIZE` | `100` | `routines.store.ts`; the list request is `/v1/routines?limit=100` |
| `ROUTINE_LOOKUP_LIMIT` | `10` | `chat.store.ts`; the lookup request is `/v1/routines?limit=10` |
| `ROUTINE_CREATE_WINDOW_SECONDS` | `120` | `chat-stream.ts` |
| `DEFAULT_CRON` (editor seed) | `'0 7 * * *'` | `routines-panel.ts` |
| default editor timezone | `Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'` | `routines-panel.ts` |

`Routine` is the `packages/contracts` discriminated union — **read it, do not restate it**:
`id` (`rtn_…`), `kind` (`prompt` | `reminder`), `title`, `cron`, `timezone`, `enabled`,
`notify`, `createdAt`, `nextFireAt | null`, `lastFiredAt | null`, and only on `prompt`:
`repoId`, `prompt`, `chatSessionId | null`. A `reminder` has no `prompt` field **at all**;
narrow with `routine.kind === 'prompt'` before reading it.

`chat.tool` data on the wire is `{ chatId, seq, tool, status, detail?, ts }`. The daemon does
**not** put the tool result in `detail` (`apps/daemon/src/chat/service.ts` persists
`{ tool, status }` only; `packages/opencode/src/normalise.ts` emits the same), so the card is
**corroborated** from `GET /v1/routines`, never parsed out of the tool event. `chat.message`
has no `origin` field, so the badge comes from `routine.replied`, never from the message.

### Docs to write (`docs/app.md`, these sections only)

- §4, the `/jobs` row: keep the promise and make it exact —
  "List, next fire, pause/resume, create; a **Routines** tab lists the chat schedules with their
  kind, the cron's local time and the next fire, and opens the editor as a sheet."
- §5, **one** new bullet: "**Routines refetch on activation.** The routines tab loads on every
  activation and on every `routine.fired`, `routine.replied` or `routine.failed` frame; pause and
  resume are optimistic with rollback, like a job toggle. Creation is not optimistic: the card
  corroborates the new routine from `GET /v1/routines`."
- §8, replace the routine bullet with: "a routine created in chat renders a confirmation card
  with its kind (`reminder` or `prompt`), the cron's local time in the routine's own timezone and
  the next fire, corroborated from `GET /v1/routines`; an answer a routine produced carries a
  `routine` badge and a link to the list, taken from the `routine.replied` frame, so it is not
  redrawn after a full reload."
- Touch no other section of `docs/app.md` (in particular §1's description of the i18n loader is
  another task's).

### i18n (exact keys and values)

Add to `apps/app/src/app/features/jobs/i18n.ts` (both locales, no empty value):

| Key | en | es |
| --- | --- | --- |
| `jobs.tab.jobs` | Jobs | Tareas |
| `jobs.tab.routines` | Routines | Rutinas |
| `routines.loading` | Loading routines | Cargando rutinas |
| `routines.error` | The routines could not be loaded. | No se han podido cargar las rutinas. |
| `routines.retry` | Retry | Reintentar |
| `routines.empty` | No routines yet. Ask the agent in chat to create one. | Todavía no hay rutinas. Pídele al agente en el chat que cree una. |
| `routines.kind.prompt` | Prompt | Instrucción |
| `routines.kind.reminder` | Reminder | Recordatorio |
| `routines.cost.prompt` | Uses the chat model | Usa el modelo del chat |
| `routines.cost.reminder` | No model, no tokens | Sin modelo, sin tokens |
| `routines.next` | Next fire | Próximo disparo |
| `routines.last` | Last fire | Último disparo |
| `routines.never` | Never | Nunca |
| `routines.state.enabled` | Enabled | Activa |
| `routines.state.paused` | Paused | Pausada |
| `routines.action.pause` | Pause | Pausar |
| `routines.action.resume` | Resume | Reanudar |
| `routines.action.runNow` | Run now | Ejecutar ahora |
| `routines.action.edit` | Edit | Editar |
| `routines.action.delete` | Delete | Eliminar |
| `routines.action.deleteConfirm` | Confirm delete | Confirmar borrado |
| `routines.action.deleteCancel` | Cancel | Cancelar |
| `routines.action.save` | Save | Guardar |
| `routines.form.title` | Title | Título |
| `routines.form.cron` | Schedule | Programación |
| `routines.form.timezone` | Timezone | Zona horaria |
| `routines.form.prompt` | Prompt | Instrucción |
| `routines.form.notify` | Notify on fire | Notificar al dispararse |
| `routines.form.invalid` | Fill the title and pick a valid schedule. | Rellena el título y elige una programación válida. |

Reuse the existing `jobs.detail.validation` for a bad cron in the editor; do not add a second
validation string and do not add a duplicate `jobs.title`/`jobs.retry`.

Add to `apps/app/src/app/features/chat/i18n.ts` (both locales):

| Key | en | es |
| --- | --- | --- |
| `chat.routine.title` | Routine created | Rutina creada |
| `chat.routine.kind.prompt` | Prompt | Instrucción |
| `chat.routine.kind.reminder` | Reminder | Recordatorio |
| `chat.routine.local` | Local time | Hora local |
| `chat.routine.next` | Next fire | Próximo disparo |
| `chat.routine.open` | Open the routines list | Abrir la lista de rutinas |
| `chat.routine.badge` | Routine | Rutina |
| `chat.routine.list` | All routines | Todas las rutinas |

Every key used in a template must be a literal `t('…')` call: the existing dictionary tests
scan the template source for `t('…')` and fail on an unresolved key, and they do not see
dynamically composed keys.

## 🧩 Configuration

- **No `CB_*` key** is added or read by this task.
- **No new dependency** and no change to `package.json` / `package-lock.json`.
- No change to `apps/app/angular.json`, no new asset, no new environment flag.

## 🧪 Test and Validation Plan (for QA)

**Method** — run from the repository root in the worktree, in this order:

```bash
npm ci --prefer-offline --no-audit --no-fund
npm run build -w @codebox/contracts      # the app resolves @codebox/contracts from dist/
npm run lint
npm test                                 # root Vitest projects: daemon, packages, scripts, ops
npm test -w @codebox/app                 # the Angular unit runner; THIS is where the app specs run
npm run build                            # tsc -b + ng build
git diff --name-only main...task-36      # audit against the exclusive paths
```

The root `npm test` does **not** include `apps/app` (the root Vitest config lists daemon,
packages, scripts and ops only), so a green `npm test` alone does not prove this task. Always
run `npm test -w @codebox/app`.

**Acceptance criteria** — `[unit]` is headless and must be green on GitHub Actions; `[live]`
exists only on the VM with a real phone and is reported **not run** there.

- [ ] `[unit]` The six method commands above exit 0.
- [ ] `[unit]` `routines.api.spec.ts` asserts, with `HttpTestingController`, every documented
  URL and method: `GET /v1/routines?limit=100`; `GET /v1/routines/{id}`;
  `PATCH /v1/routines/{id}` (body keys exactly those sent, no `kind`); `POST
  /v1/routines/{id}/pause`; `POST …/resume`; `POST …/run`; `DELETE …/{id}` flushed 204; and a
  malformed `routine` body surfaces `ContractParseError`, not a cast.
- [ ] `[unit]` `routines.store.spec.ts` proves: load fills `routines`; `pause` flips the row
  before the response and rolls back on a 409; `resume` flips it and the response replaces it;
  `runNow` merges the 202 routine and clears `running`; `remove` drops the row on 204 and sets
  `error` + reloads on a 404; `applyStreamEvent` returns `'applied'` and reloads exactly once
  for each of `routine.fired`, `routine.replied`, `routine.failed`, and `'ignored'` for
  `job.changed` without a request.
- [ ] `[unit]` `routines-panel.spec.ts` proves: a reminder row renders kind `Reminder`,
  `routine-cost` = `No model, no tokens`, its `routine-schedule` (cron summary **and**
  `Europe/Madrid`) and no `routine-form-prompt` in the editor; a prompt row renders kind
  `Prompt`, `routine-cost` = `Uses the chat model` and the prompt in the editor; clicking
  `routine-pause` sends `POST /v1/routines/{id}/pause`, `routine-resume` sends `/resume`,
  `routine-run-now` sends `/run`; clicking `routine-delete` sends **no** request
  (`http.expectNone`) until `routine-delete-confirm` is clicked, which sends
  `DELETE /v1/routines/{id}`; the editor save of a reminder sends exactly
  `{"title","cron","timezone","notify"}` and of a prompt adds `"prompt"`; an invalid cron sends
  nothing and shows `routine-form-error[data-code="validation_failed"]`; the empty, loading and
  `routines-error[data-code]` + retry states render.
- [ ] `[unit]` `jobs.page.spec.ts` proves `/jobs` renders `jobs-tab-jobs` and
  `jobs-tab-routines`, starts with `page-jobs[data-tab="jobs"]` and no routines request,
  switches to `data-tab="routines"` on the second button and then sees exactly one
  `GET /v1/routines?limit=100`, and switches back; the dictionary test also scans
  `routines-panel.ts` so every `t('…')` in it resolves in `en` and `es`.
- [ ] `[unit]` `routines-format.spec.ts` pins `routineSchedule` for `0 7 * * *` +
  `Europe/Madrid` to `Every day at 07:00 · Europe/Madrid` (en) and
  `Cada día a las 07:00 · Europe/Madrid` (es), and `routineNextFire` / `routineLastFire` to
  `null` on a null timestamp.
- [ ] `[unit]` `chat-stream.spec.ts` proves: `routine.replied` adds exactly its `messageId`
  (twice is idempotent, another chat is ignored, `lastSeq` unchanged); `pickCreatedRoutine`
  picks the newest attributable `prompt` routine (`chatSessionId === chatId`) inside the window,
  falls back to the newest `reminder`, returns `null` outside 120 s, for another chat's prompt
  routine, and for an unparsable `toolTs`; `withRoutineCard` never duplicates a routine id.
- [ ] `[unit]` `chat.store.spec.ts` proves: one `chat.tool` `routine.create` `ok` frame issues
  exactly one `GET /v1/routines?limit=10` and attaches one card; the same frame replayed at the
  same `seq` issues none; `status: 'error'` issues none; a 500 on the lookup sets `error` and
  keeps the messages.
- [ ] `[unit]` `chat.page.spec.ts` proves: a stored card renders `chat-routine-card` with
  `data-kind`, `chat-routine-local` containing `07:00` and `Europe/Madrid`, and
  `chat-routine-next[data-at]`; a message flagged by `routine.replied` renders
  `chat-routine-badge` and an anchor whose `getAttribute('href')` is `/jobs`; the chat
  dictionary has identical keys in both locales with the eight new keys.
- [ ] `[unit]` `git diff --name-only main...task-36` lists only the exclusive paths, and
  `git diff --name-only main...task-36 -- apps/app/src/app/app.routes.ts apps/app/angular.json
  packages/contracts apps/app/src/app/core` is empty; the `docs/app.md` diff touches only §4's
  `/jobs` row, §5 and §8.
- [ ] `[unit]` Every path listed in `apps/app/README.md` for `features/jobs/` and
  `features/chat/` exists on disk, and every file this task **added** under those two folders has
  a line in that file:

  ```bash
  grep -oE 'src/app/features/(jobs|chat)/[A-Za-z0-9._-]+' apps/app/README.md | sort -u \
    | while read -r f; do test -f "apps/app/$f" || echo "MISSING $f"; done   # no output
  git diff --name-only --diff-filter=A main...task-36 -- apps/app/src/app/features \
    | while read -r f; do grep -q "${f#apps/app/}" apps/app/README.md || echo "UNLISTED $f"; done   # no output
  ```
- [ ] `[live]` **On the VM, with the real daemon and a paired phone** (not on Actions): create a
  reminder from a chat session with the real agent, see `chat-routine-card` show kind
  `Reminder`, the cron's local time and a next fire; tap `chat-routine-open`; the routines tab
  lists that routine **without a manual page reload**; `POST /v1/routines/{id}/run` (or the next
  scheduled fire) produces exactly one `routine.fired` frame in `GET /v1/events` and one push
  notification in the phone's tray carrying that `routineId`; a `prompt` routine's answer
  arrives in the chat with the `routine` badge. Measurement: the rendered `data-at`/`data-kind`
  values, the one SSE frame id, and the tray entry. **QA reports this criterion `not run` in
  the GitHub Actions job — there is no daemon, no VM and no phone there.**

## 📣 Coordination

- **For the Architect:** the chat confirmation card cannot read the created routine from the
  tool event — `chat.tool.detail` is never populated by the daemon and the routine tool's
  `structuredContent` never reaches the app. This spec corroborates the card with
  `GET /v1/routines?limit=10` and a 120 s window. A first-class signal (a `routine.created`
  event, or `detail` carrying the routine) is a `packages/contracts` + daemon change and must
  be its own task; until then the window stays.
- **For the next batch:**
  - Creation emits **no** SSE event today. The routines list is correct on tab activation and
    after any `routine.fired|replied|failed`; a routine created on another device while the tab
    is open appears only on the next activation or a `routine.*` frame.
  - `GET /v1/routines` exposes `lastFiredAt`, not the fire's outcome, so the list shows the last
    fire **time**; "last result" from the backlog needs a route/contract addition.
  - The `routine` badge is live for the open session (it comes from `routine.replied`), not
    re-derived after a full reload: `chat.message` carries no `origin`.
  - The chat link targets `/jobs` (the Jobs tab). Preselecting the Routines tab needs a router
    or query-param change in a hot file and is deliberately out of scope.
  - The chat feature imports three things from `features/jobs/`: `RoutinesApi`, the pure
    `routines-format` helpers and `cron.summarise`/`time-format.formatFire` (via them). It must
    **not** import `RoutinesStore`; no store reaches into another feature's store.
- **For QA:** run `npm test -w @codebox/app`; the root `npm test` does not cover the app. The
  `[live]` criterion is `not run` on Actions — record it as `not run`, never as passed.

## ⛔ Out of scope

- No new route, no change to `apps/app/src/app/app.routes.ts`, no tab query parameter.
- No daemon, contract, store, scheduler or OpenCode change. No change to `packages/contracts`.
- No routine **creation** from the app (chat is the creation path), no `POST /v1/routines` call.
- No notification-preference change: `routine.fired` already exists in
  `apps/app/src/app/features/settings/{i18n.ts,settings.store.ts}`; do not touch `features/settings`.
- No new dependency, no `ion-segment`, no `ion-modal`, no third-party date/cron library.
- No refactor of `jobs.api.ts`, `jobs.store.ts`, `cron.ts`, `cron-picker.ts`, `time-format.ts`
  beyond what the contract above requires (it requires nothing).
- No change to `docs/decisions.md`, `docs/api.md`, `TODO.md`, `CHANGELOG.md`.

## 📋 Report shape (return exactly this)

```
tip: <git rev-parse HEAD>
commands:
  npm ci --prefer-offline --no-audit --no-fund   exit <n>
  npm run build -w @codebox/contracts           exit <n>
  npm run lint                                  exit <n>
  npm test                                      exit <n>
  npm test -w @codebox/app                      exit <n>
  npm run build                                 exit <n>
criteria:
  [unit] <criterion> — pass/fail (<test file or command evidence>)
  ...
  [live] <criterion> — not run (needs the VM, a real daemon and a paired phone)
files: <git diff --name-only main...task-36, one per line>
deviations: <none, or each one with the reason and who must confirm>
```

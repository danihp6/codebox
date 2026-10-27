# Spec: Task-61 — Schedule created by chat, and the Schedule filter

> The spec is your entire world. Anything not written here does not exist.

## 🎯 Scope

- **Task type:** app (`@codebox/app`).
- **Role:** Dev.
- **Objective:** ship the two schedule surfaces as standalone, unit-tested components plus
  stores: (1) the **proposed-schedule card** a chat shows when the agent proposes a schedule —
  it renders the assumption block (what will fire, in whose timezone, with which caps) and
  creates **only on a tap**, exactly one `POST /v1/schedules`; (2) the **Schedule filter**
  that groups fires by schedule, puts a schedule whose window is running on top, and marks a
  fire that was delivered but not reviewed.
- **Environment:** worktree `../wt-cb-61`, branch `task-61`, base `main` @ `e447dfe`.
- **Dependencies (already merged):**
  - Task-53 — `GET /v1/schedules`, `GET /v1/schedules/{id}`, `POST /v1/schedules` and the
    `Schedule` contract (`mode`, `windowStart`, `windowEnd`, `firesCount`, `spendUsd`,
    `lastFiredAt`, `nextFireAt`, `consecutiveFailures`).
  - Task-55 — the shell and the router; the router is frozen for this task.
  - Task-57 — the chat thread and `features/chat/chat.page.ts` (**read-only** here).

### Exclusive paths (single writer)

- `apps/app/src/app/features/schedules/schedules.api.ts`
- `apps/app/src/app/features/schedules/schedule-filter.ts`
- `apps/app/src/app/features/schedules/schedule-filter.store.ts`
- `apps/app/src/app/features/schedules/schedules.i18n.ts`
- `apps/app/src/app/features/schedules/schedule-filter.spec.ts`
- `apps/app/src/app/features/schedules/schedule-filter.store.spec.ts`
- `apps/app/src/app/features/chat/schedule-propose.ts`
- `apps/app/src/app/features/chat/schedule-propose.i18n.ts`
- `apps/app/src/app/features/chat/schedule-propose.spec.ts`
- `apps/app/README.md` — **section only:** one line per new file, inside the existing
  `features/chat/` and (new) `features/schedules/` blocks, alphabetical. Do not edit any other
  line. Three batch-mates write other sections of this file.

The spec file `.agent_specs/task-61.md` is committed on your branch by the Orchestrator. It is
the only file outside your paths and you never modify it.

### Inputs (read-only)

- `docs/app.md` §4 (`/chat?filter=schedule`, the propose card rows), §5 (state and data), §8
  (a routine created in chat), §9 (design, 320 px).
- `design/README.md` §2 — frames `04b` (Schedule filter), `08b` (Schedule asked in chat),
  `08c` (Proposed schedule card), light `L12`, `L13`, `L14`.
- `packages/contracts/src/resources.ts` — `scheduleSchema`, `scheduleDetailSchema`,
  `chatSessionSchema`, `parseSchedule`, `parseScheduleDetail`, `parsePage`.
- `apps/app/src/app/features/jobs/cron.ts` — reuse `summarise(expression, locale)`.
- `apps/app/src/app/features/jobs/time-format.ts` — reuse `formatFire(iso, timeZone, locale)`.
- `apps/app/src/app/features/jobs/routines.api.ts` and `routines-panel.ts` — the API/panel
  pattern (routines are **not** schedules: do not read them here).
- `apps/app/src/app/features/settings/notifications.page.ts` — the panel pattern.

## 🔒 Contract

```ts
// schedules.api.ts
export class SchedulesApi {
  list(query?: { repoId?: string; enabled?: boolean; limit?: number; cursor?: string }):
    Observable<Page<Schedule>>;
  get(id: string): Observable<ScheduleDetail>;   // { schedule, nextFires }
  create(body: ScheduleCreateBody): Observable<Schedule>;
}
export interface ScheduleCreateBody {
  title: string;
  prompt: string;
  mode: Schedule['mode'];
  cron?: string | null;
  timezone: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  cooldownMinutes?: number;
  maxFires?: number | null;
  maxCostPerFireUsd?: number | null;
  firePolicy?: Schedule['firePolicy'];
  repoId?: string | null;
  chatSessionId?: string | null;
}

// schedule-filter.ts
export interface ScheduleProposal {
  title: string;
  mode: Schedule['mode'];
  cron: string | null;
  timezone: string;
  windowStart: string | null;
  windowEnd: string | null;
  prompt: string;
  repoId: string | null;
  cooldownMinutes?: number;
  maxCostPerFireUsd?: number | null;
}

/** Half-open [start, end) in the schedule's own IANA zone; a window may wrap midnight. */
export function isWindowOpen(
  window: { start: string; end: string; timezone: string },
  nowMs: number,
): boolean;

export interface ScheduleGroup {
  readonly schedule: Schedule;
  readonly nextFires: readonly string[];
  readonly unreviewed: boolean;
}
/** Open windows first, then by `nextFireAt` ascending (null last), then by title. */
export function groupSchedules(
  groups: readonly ScheduleGroup[],
  nowMs: number,
): readonly ScheduleGroup[];

@Component({ selector: 'app-schedule-propose' })
export class ScheduleProposeCard {
  readonly proposal = input.required<ScheduleProposal>();
  readonly created = output<Schedule>();
  readonly dismissed = output<void>();
}

@Component({ selector: 'app-schedule-filter' })
export class ScheduleFilterPage { /* own store, list + details */ }
```

- **Tap-only creation.** Rendering the card issues **no** request. The store's `create` is
  called only from the card's single button handler; one tap → one
  `POST /v1/schedules`; a second tap while in flight → still one.
- The POST body is exactly the proposal's fields mapped to `ScheduleCreateBody`; no extra
  key, and `cron`/`windowStart`/`windowEnd` are `null`-shaped exactly as `scheduleSchema`
  demands (`mode: 'window'` carries the window and `cron: null`; every other mode carries
  `cron` and null bounds). A `422` renders the error code and re-enables the button.
- **The unreviewed mark is real data**: `schedule.lastFiredAt !== null`,
  `schedule.chatSessionId !== null`, and `GET /v1/chat/sessions/{chatSessionId}` answers with
  `reviewedAt === null`. No local heuristics, no remembered state.
- The detail read is bounded: at most **20** visible schedules ask for
  `GET /v1/schedules/{id}`; the rest render without `nextFires`.

### Data

- Group ordering is the only client-side maths beyond the window: compute, do not persist.
- `isWindowOpen` pins the timezone contract without a new dependency (`Intl.DateTimeFormat`
  with `timeZone`); a malformed window is closed and never throws.
- The assumption block shows: the title, the human cron summary or the window, the local next
  fire via `formatFire(..., schedule.timezone, locale)`, the cost cap when set, and the
  repository slug when bound. It says plainly that nothing exists until the button is tapped.
- Copy lives in `schedules.i18n.ts` and `schedule-propose.i18n.ts` with `en` and `es`, same
  key set. Never edit `features/chat/i18n.ts` or `src/assets/i18n/*.json`.

## ⚙️ Configuration

None. No new `CB_*` key, no new dependency.

## 🧪 Test and Validation Plan (for QA)

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `git diff --name-only main...task-61` — audit against the exclusive paths; extras allowed:
    `.agent_specs/task-61.md` and lines of `apps/app/README.md`.
- **Acceptance criteria:**
  - [ ] `[unit]` rendering `ScheduleProposeCard` with a fixture issues zero HTTP requests.
  - [ ] `[unit]` one tap issues exactly one `POST /v1/schedules` with the mapped body (no
        extra field, `cron: null` for a window proposal, bounds `null` for a cron proposal),
        emits the parsed `Schedule` once; a double tap while in flight still issues one.
  - [ ] `[unit]` `isWindowOpen` pins `22:00–06:00 Europe/Madrid` open at `23:30` and `05:59`
        local, closed at `06:00`, `21:59` and a malformed window; `09:00–17:00` open at
        `09:00` and closed at `17:00` (half-open).
  - [ ] `[unit]` `groupSchedules` puts an open window before a closed one, orders by
        `nextFireAt` ascending with nulls last, and is stable on equal keys.
  - [ ] `[unit]` the filter renders a zero fixture (no schedules) without inventing a row, and
        one row per schedule with its mode, `firesCount` and `spendUsd`.
  - [ ] `[unit]` the unreviewed mark appears only when both the schedule and the session
        agree; a schedule with no `chatSessionId` never asks for a session.
  - [ ] `[unit]` the detail read is capped at 20 schedules.
  - [ ] `[unit]` EN/ES parity of both dictionaries.
  - [ ] `[unit]` nothing outside the exclusive paths was touched.
  - [ ] `[live]` **Not runnable here (no browser in CI).** Measurement, for the review issue:
        on the VM, a sentence in a chat produces the proposed card, one tap creates the
        schedule and its first fire lands marked unreviewed in `?filter=schedule`, measured
        with `npx playwright test` at 320×640 against a daemon on an ephemeral port. Report it
        as **not run**.

## 📣 Coordination

- **For the next batch:** the proposal card takes a `ScheduleProposal`. The daemon today has
  **no** `schedule.propose` tool, message shape or event: the pinned OpenCode client exposes
  `routine.create` only, and `routineCreateToolOutputSchema` carries a `Routine`, not a
  proposal. The card is therefore fed by its host; producing that proposal server-side is a
  contract task, not this one. Mount it from `chat.page.ts` (or `/chat/new`) when that seam
  exists.
- **For the next batch:** the filter is exported as `ScheduleFilterPage` from
  `features/schedules/schedule-filter.ts`; the frozen router has no `/chat?filter=schedule`
  target of its own (the chat list's `schedule` filter lists schedule-kind chats, which is a
  different thing), so the route row is a review item.
- **For the Architect:** both reachability gaps (no proposal source, no route) are deliberate
  and reported, not hidden.

## ⛔ Out of scope

- `app.routes.ts`, `chat.page.ts`, `chat-list.page.ts`, `features/chat/i18n.ts`,
  `features/jobs/**`, `core/**`, `packages/contracts/**`.
- Editing or pausing a schedule, run-now, delete — the list is read-only in this task.
- Duplicating cron parsing or time formatting: reuse `features/jobs/cron.ts` and
  `time-format.ts`.
- No new dependency. No refactor of files you were not given.

## ✅ Handover

Commit your work, `git push -u origin task-61`, then
`git commit --allow-empty -m "dev: done task-61" && git push`. Report per `.agent_roles/dev.md`:
task id, worktree, branch tip sha, commands with exit codes, checklist, files, deviations.

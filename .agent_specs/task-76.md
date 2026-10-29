# Spec: Task-76 — Retire chat, routines and reminders end to end

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** daemon + app + docs. The daemon route deletion and its app consumers must land
  in one commit, so the two halves are one task; the paths below are the whole of it.
- **Role:** Dev.
- **Objective:** after this task the tree carries **no chat, routine or reminder surface at
  all**. The daemon mounts neither `/v1/chat/*` (including the `promote` route the `runs`
  subsystem still owns) nor `/v1/routines/*`; the `chat` and `routines` subsystems, their
  routine tool server and the repo-less chat fire are gone from `SUBSYSTEMS`; the permission
  matrix has exactly one mode, `run`; the app has no `/jobs`, `/jobs/:id`, `/runs`, `/runs/:id`
  or `/approvals` route, no chat client, no routines panel and no reminders filter screen; and
  no surviving screen reads a retired endpoint or links to a retired route. The public contract
  in `packages/contracts` is **not** touched: the retired schemas stay as the read-only legacy
  projection of the `chats`/`routine*` tables Task-70 kept, and `openapi.test.ts` already pins
  that the document exposes no chat or routine path.
- **Environment:** worktree `../wt-cb-76`, branch `task-76`, base `main` at `11f11af`.
  Commit marker exactly `dev: done task-76`; push the branch before you stop.
- **Dependencies:** both merged on `main`.
  - **Task-72** — `apps/daemon/src/works/**`, `apps/daemon/src/backlog/**`,
    `apps/daemon/src/sessions/**`, the last three entries of `SUBSYSTEMS`, and the note that
    `ScheduleFirePort.startChat` "stays until Task-76".
  - **Task-75** — the 15 live app routes plus the three legacy ones this task removes, in
    `apps/app/src/app/app.routes.ts`; `features/{repos,works,sessions,backlog}`;
    `features/chat/` reduced to `chat.api.ts` and `chat.api.spec.ts`.

### Exclusive paths (single writer)

Every path this task creates, modifies or deletes. **Nothing outside this list.** This is the
only task in the batch, so nothing is shared.

**Delete — daemon (26 files).** `apps/daemon/src/chat/` and `apps/daemon/src/routines/` must not
exist afterwards; each file is named because QA audits the diff:

- `apps/daemon/src/chat/index.ts`, `index.test.ts`, `routes.ts`, `routes.test.ts`, `service.ts`,
  `service.test.ts`, `errors.ts`, `ids.ts`, `ids.test.ts`, `README.md`
- `apps/daemon/src/chat/tools/index.ts`, `server.ts`, `routine-tools.ts`, `ids.ts`,
  `server.test.ts`, `README.md`
- `apps/daemon/src/routines/index.ts`, `index.test.ts`, `routes.ts`, `routes.test.ts`,
  `service.ts`, `service.test.ts`, `fire.ts`, `fire.test.ts`, `tick.ts`, `tick.test.ts`,
  `README.md`

**Move — app (2 files).** Recreate verbatim under `apps/app/src/app/core/util/`, then delete the
originals:

- `apps/app/src/app/features/jobs/time-format.ts` → `apps/app/src/app/core/util/time-format.ts`
- `apps/app/src/app/features/jobs/time-format.spec.ts` →
  `apps/app/src/app/core/util/time-format.spec.ts` (the relative import `./time-format` is
  unchanged)

**Delete — app (42 files).**

- `apps/app/src/app/features/jobs/`: `cron-picker.ts`, `cron.ts`, `cron.spec.ts`, `i18n.ts`,
  `job.page.ts`, `job.page.spec.ts`, `job.store.ts`, `job.store.spec.ts`, `jobs.api.ts`,
  `jobs.api.spec.ts`, `jobs.page.ts`, `jobs.page.spec.ts`, `jobs.store.ts`, `jobs.store.spec.ts`,
  `routines.api.ts`, `routines.api.spec.ts`, `routines-format.ts`, `routines-format.spec.ts`,
  `routines-panel.ts`, `routines-panel.spec.ts`, `routines.store.ts`, `routines.store.spec.ts`
  (the two `time-format` files are moved, not deleted, and this leaves the folder empty)
- `apps/app/src/app/features/runs-list/`: `i18n.ts`, `runs.page.ts`, `runs.page.spec.ts`,
  `runs.store.ts`, `runs.store.spec.ts`
- `apps/app/src/app/features/run-detail/`: `run.page.ts`, `run.page.spec.ts`,
  `run-detail.store.ts`, `run-detail.store.spec.ts`, `timeline.ts`, `timeline.spec.ts`
- `apps/app/src/app/features/approvals/approvals.page.ts`
- `apps/app/src/app/features/chat/chat.api.ts`, `apps/app/src/app/features/chat/chat.api.spec.ts`
- `apps/app/src/app/features/schedules/`: `schedules.api.ts`, `schedules.i18n.ts`,
  `schedule-filter.ts`, `schedule-filter.spec.ts`, `schedule-filter.store.ts`,
  `schedule-filter.store.spec.ts`

**Create (2 files).**

- `apps/daemon/src/route-table.test.ts`
- `apps/app/src/app/core/util/time-format.ts` and `.spec.ts` (the move above; listed here so the
  create side is explicit)

**Modify — daemon (22 files).**

- `apps/daemon/src/modules.ts` — drop `'chat'` and `'routines'` from `SubsystemName`,
  `SUBSYSTEMS` and `DEFAULT_SUBSYSTEM_FLAGS`
- `apps/daemon/src/modules.test.ts`
- `apps/daemon/src/app.test.ts` — `flags:` fixture only
- `apps/daemon/src/auth/routes.test.ts` — `flags:` fixture only
- `apps/daemon/src/events/routes.test.ts` — `flags:` fixture only
- `apps/daemon/src/health.test.ts` — `flags:` fixture only
- `apps/daemon/src/run/approvals-retired.test.ts`
- `apps/daemon/src/runs/routes.ts`
- `apps/daemon/src/runs/service.ts`
- `apps/daemon/src/runs/service.test.ts`
- `apps/daemon/src/runs/routes.test.ts`
- `apps/daemon/src/schedules/fire.ts`
- `apps/daemon/src/schedules/fire.test.ts`
- `apps/daemon/src/schedules/service.ts`
- `apps/daemon/src/schedules/service.test.ts`
- `apps/daemon/src/schedules/routes.test.ts`
- `apps/daemon/src/sessions/service.ts`
- `apps/daemon/README.md`
- `apps/daemon/src/events/README.md` — the one sentence in the header
- `apps/daemon/src/run/README.md` — the `approvals-retired.test.ts` line
- `apps/daemon/src/runs/README.md`
- `apps/daemon/src/runs/idempotency.ts` — the one docstring line that names `promote`

**Modify — packages (2 files).**

- `packages/core/src/permissions.ts`
- `packages/core/src/permissions.test.ts`

**Modify — app (11 files).**

- `apps/app/src/app/app.routes.ts` (**hot file, this task is the holder**)
- `apps/app/src/app/app.routes.spec.ts`
- `apps/app/src/app/features/settings/providers.page.ts` — one import path
- `apps/app/src/app/features/repos/repo-schedule.page.ts` — one import path
- `apps/app/src/app/features/dashboard/dashboard.api.ts`
- `apps/app/src/app/features/dashboard/dashboard.store.ts`
- `apps/app/src/app/features/dashboard/dashboard.page.ts`
- `apps/app/src/app/features/dashboard/i18n.ts`
- `apps/app/src/app/features/dashboard/dashboard.store.spec.ts`
- `apps/app/src/app/features/dashboard/dashboard.page.spec.ts`
- `apps/app/README.md`

**Modify — docs (3 files, by section).**

- `docs/app.md` (§3 project layout tree; §4 the dashboard row and the `**Legacy…**` paragraph)
- `docs/security.md` (§6, the `Permissions` and `Session targets` rows)
- `docs/agent-runtime.md` (§2, the `Session` table row and the paragraph that follows)

### Inputs (read-only)

Beyond `AGENTS.md`, and the files above:

- `docs/api.md` (§4, §5.4, §5.5, §5.6, §5.6.1, §5.10 — read to confirm what stays mounted)
- `docs/jobs.md` (§1.1, §15, §16 — read only; the legacy `jobs` table and `/v1/schedules` stay)
- `docs/app.md` §8
- `docs/decisions.md` (D38, D41, D44, D45, D55, D56)
- `docs/agent-spec-template.md`
- `packages/contracts/src/{index,resources,routines,events,openapi,pagination}.ts` and
  `packages/contracts/src/openapi.test.ts` — **read only; do not edit**
- `packages/store/src/chats.ts`, `packages/store/migrations/0006_works.sql` — read only
- `apps/daemon/src/runs/errors.ts`, `apps/daemon/src/runs/approvals.ts`,
  `apps/daemon/src/jobs/**`, `apps/daemon/src/push/**`, `apps/daemon/src/telemetry/**`
- `apps/app/src/app/core/api/{api-client.ts,http.ts}`, `apps/app/src/app/core/i18n/i18n.service.ts`
- `apps/app/src/app/features/repos/repo-works.page.ts`,
  `apps/app/src/app/features/repos/repo-schedule.page.ts`,
  `apps/app/src/app/features/settings/providers.page.ts`

## 🔒 Contract

The public surface the rest of the tree is written against **after** this task. Names are exact.

```ts
// apps/daemon/src/modules.ts — fifteen names, in this order, no 'chat', no 'routines'
export type SubsystemName =
  | 'auth'
  | 'events'
  | 'run'
  | 'gate'
  | 'jobs'
  | 'runs'
  | 'push'
  | 'schedules'
  | 'credentials'
  | 'providers'
  | 'telemetry'
  | 'cli'
  | 'works'
  | 'backlog'
  | 'sessions';

export const SUBSYSTEMS: readonly SubsystemName[]; // exactly the fifteen above, same order
export type SubsystemFlags = Readonly<Record<SubsystemName, boolean>>;
export const DEFAULT_SUBSYSTEM_FLAGS: SubsystemFlags; // every key true
export function subsystemPath(name: SubsystemName): string; // `./${name}/index.js`
```

A caller that names `'chat'` or `'routines'` is now a type error, and `loadModules` cannot
import `./chat/index.js` or `./routines/index.js` because the loop iterates `SUBSYSTEMS`.

```ts
// apps/daemon/src/schedules/fire.ts — startChat is gone; startRun is unchanged
export interface ScheduleFirePort {
  startRun(input: {
    readonly schedule: Schedule;
    readonly scheduledFor: string;
    readonly costCapUsd?: number | null;
  }): Promise<{ readonly runId: string }>;
}

export type ScheduleFireErrorCode =
  'repo_required' | 'repo_missing' | 'backlog_unavailable' | 'provider_exhausted' | 'internal';
```

```ts
// packages/core/src/permissions.ts — one mode, five tool classes, routine.* is `other`
export type PermissionMode = 'run';
export type PermissionTool = 'read' | 'edit' | 'bash' | 'webfetch' | 'other';
export type PermissionDecision = 'allow' | 'ask' | 'deny';

export const PERMISSION_MATRIX: Readonly<
  Record<PermissionMode, Readonly<Record<PermissionTool, PermissionDecision>>>
>;
// runtime value, frozen:
// { run: { read: 'allow', edit: 'allow', bash: 'allow', webfetch: 'deny', other: 'deny' } }

export function classifyTool(tool: string): PermissionTool; // 'routine.create' → 'other'
export function decidePermission(request: PermissionRequest): PermissionDecision;
```

`PermissionRequest`, `isInsideWorktree` and the decision body keep their current shape and
semantics. The matrix may not contain an `ask` value; `decidePermission` never returns `ask`
after this task, and the daemon still answers a non-`allow` decision with `reject`
(`apps/daemon/src/sessions/service.ts`, `apps/daemon/src/run/engine.ts`).

**App route table** — exactly these 15 `routes` entries, in this order (`docs/app.md` §4 is the
owner of the table, `app.routes.spec.ts` is the guard):

```
'',pair,dashboard,repos,settings,repos/:id/works,repos/:id/schedule,repos/:id/design,
repos/:id,works/:id,sessions/:id,settings/devices,settings/credentials,about,**
```

`/jobs`, `/jobs/:id`, `/runs`, `/runs/:id` and `/approvals` are gone; `SHELL_TABS` stays
`Dashboard · Repos · Settings`; every remaining route keeps `canActivate: [authGuard]` except
`''` and `pair`; `''` keeps `redirectTo: 'dashboard'`; `**` keeps rendering `AboutPage`.

**Dashboard** (`apps/app/src/app/features/dashboard/dashboard.store.ts`) — the chat-derived
surface is gone, the run-derived one stays:

```ts
export const WORKING_STATES: readonly RunState[]; // unchanged
export const REVIEW_STATE: RunState;              // unchanged, 'pr_open'
export class DashboardStore {
  readonly health: Signal<Health | null>;
  readonly telemetry: Signal<Telemetry | null>;
  readonly working: Signal<readonly Run[]>;
  readonly ready: Signal<readonly Run[]>;
  readonly recentRuns: Signal<readonly Run[]>;
  readonly fresh: Signal<boolean>;
  readonly loading: Signal<boolean>;
  readonly stale: Signal<boolean>;
  readonly error: Signal<ApiError | null>;
  load(): void;
  reload(): void;
  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored';
}
```

Removed: `NeedsYouCounts`, `countNeedsYou`, `isAwaitingAnswer`, `isUnreviewedChat`, the
`needsYou` signal and `DashboardApi.sessions()`. `DashboardApi` keeps `telemetry`, `runs` and
`repos` only. The dashboard issues **four** reads per pass (`/v1/health`, `/v1/telemetry`,
`/v1/runs`, `/v1/repos`), never `/v1/chat/sessions`, and its run rows link to
`/repos/{run.repoId}` (the one destination a `Run` carries: it has `repoId`, not `workId`).

- **Errors:** the retired daemon prefixes have no handler, so a request falls through to the one
  not_found envelope (`docs/api.md` §3) when it reaches the router, and to the auth middleware's
  `401 unauthorized` before it when auth is mounted — that is what `start.test.ts` already shows
  for `/v1/nope`. The task adds no new error code and no new status.
- **Logs:** no new line. A repo-less schedule still reaches `settle` with
  `code: 'repo_required'` and logs `{ msg: 'schedule_fire_failed', scheduleId, code }`; the fire
  row keeps `outcome: 'failed'`, `detail: 'repo_required'`, `chatId: null`.
- **Purity:** `packages/core` stays pure. `permissions.ts` is a frozen table and two pure
  functions; no clock, network, filesystem or environment. The daemon keeps every side effect.
- **Ordering:** unchanged everywhere. This task deletes branches, it does not reorder a flow.

### The seams this task rewrites (exact shapes)

**0. Why `features/schedules/**` is deleted instead of patched.** That folder is the retired
reminders filter screen. It is unreachable (no `app.routes.ts` entry and no other importer), it
renders an "unreviewed" mark by reading `ChatApi.getSession` (`schedule-filter.store.ts`), and
its component imports `formatFire` from `features/jobs/time-format`. Retiring chat means its
`ChatApi` import has no replacement, so the only two honest options are to keep an unreachable
screen alive or to delete it; `design/README.md` §1 already says "the schedule screen is
retired". It goes. The two survivors that still need `formatFire`
(`features/settings/providers.page.ts` and `features/repos/repo-schedule.page.ts`) import it
from the moved module: `import { formatFire } from '../../core/util/time-format';`.

**1. `apps/daemon/src/schedules/fire.ts`** — delete `startChat` from `ScheduleFirePort` and the
stub from the returned object. Nothing else moves.

**2. `apps/daemon/src/schedules/service.ts`** — `runFire` becomes exactly:

```ts
async function runFire(schedule: Schedule, scheduledFor: string): Promise<FireOutcome> {
  // D56: a schedule without a repository no longer exists; a legacy row fails its fire closed.
  if (schedule.repoId === null) throw new ScheduleFireError('repo_required');
  const started = await fire.startRun({
    schedule,
    scheduledFor,
    costCapUsd: schedule.maxCostPerFireUsd,
  });
  const run = store.runs.getRecord(started.runId);
  return { runId: started.runId, chatId: null, costUsd: run?.cost.usd ?? 0, code: null };
}
```

Keep `FireOutcome.chatId` (it feeds `store.scheduleFires.finish({ chatId: outcome.chatId })`)
and `requireTarget` unchanged: the legacy `/v1/schedules` create/patch contract still reads
`chatSessionId` and still refuses a repo-less row with `422 repo_required`.

**3. `apps/daemon/src/schedules/service.test.ts`** — the `FakePort` loses `chats`, `startChat`
and their initialisers; keep `runs` and `failure`. Replace the test at
`fires a chat schedule through the chat port` with
`fails a repo-less schedule with repo_required`: seed the same `repoId: null,
chatSessionId: 'chat_000001', firePolicy: 'continue', mode: 'every', cron: '0 10 * * *',
nextFireAt: '2026-10-25T10:00:00Z'` row through `h.store.schedules.create(...)`, then
`expect(await h.service.tick()).toEqual({ due: 1, fired: 1, skipped: 0, lost: 0 })`,
`await h.drain()`, `expect(h.port.runs).toEqual([])`, and
`fires[0]` matches `{ outcome: 'failed', detail: 'repo_required', chatId: null }`.

**4. `apps/daemon/src/schedules/fire.test.ts`** — delete `describe('startChat')` only; the
`startRun` `repo_required` tests stay. **`schedules/routes.test.ts`** — drop `startChat` from the
`record: ScheduleFirePort` literal.

**5. `apps/daemon/src/runs/routes.ts`** — delete the `POST ${API_PREFIX}/chat/sessions/:id/promote`
handler (and the comment above it), delete `const promoteSchema`, and drop `readJsonOrEmpty`
from the `./errors.js` import list (promote was its only user here; `readJson` stays).

**6. `apps/daemon/src/runs/service.ts`** — delete the `promote(input: { chatId; title?;
deviceId; idempotencyKey }): Run` member from `RunsService` and its implementation. Nothing
else in the file moves (`trigger: 'promote'` stays in the type only where it already is).

**7. `apps/daemon/src/runs/service.test.ts`** — delete `describe('promote')`, `seedChat`,
`appendMessage` and the `ChatSession` import. Keep `seedApproval` (its `chatId` column stays).
**`apps/daemon/src/runs/routes.test.ts`** — in the contract-walk test drop the
`seedChat`/`promote` block; delete `describe('the runs promote route')`; in
`describe('the runs route scope')` drop the `chatId` seed and the
`['POST', \`/v1/chat/sessions/${chatId}/promote\`, {}]` attempt. Delete the local `seedChat`
helper if the remaining tests do not use it (`eslint` fails on an unused helper, so the gate
tells you).

**8. `apps/daemon/src/run/approvals-retired.test.ts`** — keep the first test verbatim; replace
the second with the retirement guard:

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
// ...
it('leaves no chat subsystem to carry an approval table', () => {
  expect(existsSync(path.join(sourceDir, 'chat'))).toBe(false);
  expect(existsSync(path.join(sourceDir, 'routines'))).toBe(false);
});
```

**9. `apps/daemon/src/route-table.test.ts`** — new file, exactly this shape:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openInMemoryStore } from '@codebox/store';
import { createApp } from './app.js';
import { loadConfig, readBuildInfo, resolvePaths } from './config.js';
import { createLogger } from './logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry, loadModules } from './modules.js';
import type { DaemonApp, DaemonContext } from './modules.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const RETIRED = ['/v1/chat', '/v1/routines', '/v1/reminders'] as const;
const SURVIVING = ['/v1/jobs', '/v1/runs', '/v1/sessions', '/v1/works'] as const;

const contexts: DaemonContext[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.shutdown.run();
    context.store.close();
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Mounted {
  readonly app: DaemonApp;
  readonly context: DaemonContext;
  readonly loaded: readonly string[];
  readonly failed: readonly { readonly name: string; readonly error: string }[];
}

async function mountAll(): Promise<Mounted> {
  const root = mkdtempSync(join(tmpdir(), 'cb-76-routes-'));
  roots.push(root);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(root, 'state'),
    CB_INSTALL_DIR: join(root, 'install'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
  });
  const context: DaemonContext = {
    config,
    store: openInMemoryStore(),
    logger: createLogger({ level: 'error', sink: () => undefined }),
    clock: () => new Date('2026-10-28T10:00:00.000Z'),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(root, 'install', 'app'),
    shutdown: createShutdownRegistry(createLogger({ level: 'error', sink: () => undefined })),
  };
  contexts.push(context);
  const app = createApp({ context });
  const report = await loadModules({ app, context });
  return { app, context, loaded: report.loaded, failed: report.failed };
}

function count(context: DaemonContext, table: string): number {
  const row = context.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

describe('the mounted /v1 table', () => {
  it('mounts nothing under a retired prefix', async () => {
    const { app } = await mountAll();
    const paths = app.routes.map((route) => route.path);
    for (const prefix of RETIRED) {
      expect(
        paths.filter((path) => path === prefix || path.startsWith(`${prefix}/`)),
        prefix,
      ).toEqual([]);
    }
  });

  it('keeps the jobs, runs, sessions and works routes', async () => {
    const { app } = await mountAll();
    const paths = app.routes.map((route) => route.path);
    for (const path of SURVIVING) expect(paths, path).toContain(path);
  });

  it('loads no chat or routines subsystem', async () => {
    const { loaded, failed } = await mountAll();
    expect(failed).toEqual([]);
    expect(loaded).not.toContain('chat');
    expect(loaded).not.toContain('routines');
  });

  it('never writes a retired table', async () => {
    const { context } = await mountAll();
    expect(count(context, 'chat_sessions')).toBe(0);
    expect(count(context, 'chat_messages')).toBe(0);
  });
});
```

Do **not** assert a 404 over HTTP: the auth middleware answers `401` for every `/v1` path
before routing (`apps/daemon/src/start.test.ts` pins that for `/v1/nope`), so the route table is
the only honest surface. `loadModules` with no `importModule` is the real seam; it imports every
present subsystem, so a re-added `src/chat/index.ts` would fail the first test.

**10. `apps/daemon/src/modules.test.ts`** — the list test expects the fifteen names in the
Contract order; keep the index test but restate it as `SUBSYSTEMS[0] === 'auth'`,
`SUBSYSTEMS.indexOf('cli') === 11`, `SUBSYSTEMS.slice(12) === ['works', 'backlog', 'sessions']`;
`only()` and the all-off fixture lose `chat`/`routines`; the "throwing register" test uses
`events` instead of `chat` (`{ ...only('auth'), events: true }` and `loaded: ['events']`); the
`isMissingSubsystem` "rejects a different subsystem" case passes `'events'`.

**11. `apps/daemon/src/{app,auth/routes,events/routes,health}.test.ts`** — replace the literal
`flags: { ... }` object with `flags: DEFAULT_SUBSYSTEM_FLAGS` (import it from `./modules.js` or
`../modules.js` as the file already imports `createShutdownRegistry`). `modules.ts` is the only
reader of `context.flags`.

**12. `packages/core/src/permissions.test.ts`** — rewrite to: the exact `PERMISSION_MATRIX`
value and `Object.keys(...) === ['run']`; a `classifyTool` table that keeps the read/edit/bash/
web cases, moves `routine.create`, `routine.list`, `routine.pause` and `' Routine.Pause '` to
`'other'`, and keeps `'routine'` → `'other'`; `decidePermission` cases for in-worktree edit and
bash → `allow`, `webfetch` → `deny`, an out-of-worktree edit → `deny`, `routine.create` →
`deny`. No `'chat'` literal and no `ask` expectation survives.

**13. `apps/app/src/app/features/dashboard/`** — exact deltas:

- `dashboard.api.ts`: delete `sessions()`, the `chatSessionSchema` import and the `ChatSession`
  and `Page` type imports if they go unused.
- `dashboard.store.ts`: delete `NeedsYouCounts`, `countNeedsYou`, `isAwaitingAnswer`,
  `isUnreviewedChat`, the `needsYou` signal, `fetchSessions` and its call inside `readAll`;
  delete the `ChatSession` import.
- `dashboard.page.ts`: delete the whole `<article data-testid="dashboard-needs-you">` block,
  delete the `<a data-testid="dashboard-start-chat">` link, and change the three run rows
  (`dashboard-working-run`, `dashboard-ready-run`, `recent-run`) from
  `[routerLink]="['/runs', run.id]"` to `[routerLink]="['/repos', run.repoId]"`. `RouterLink`
  stays imported for the start card.
- `i18n.ts`: delete `dashboard.section.needs-you`, `dashboard.needs-you.awaiting`,
  `dashboard.needs-you.unreviewed`, `dashboard.needs-you.unit`, `dashboard.needs-you.open-chat`
  and `dashboard.start.chat` in **both** locales; change `dashboard.start.body` in both to
  "Connect a repository and Codebox will run its backlog." /
  "Conecta un repositorio y Codebox ejecutará su backlog."
- `dashboard.store.spec.ts`: delete the `needs-you helpers` describe except
  `pins the working states and the review state` (move it to a `dashboard state sets` describe),
  delete `messageAt`, `SessionOptions`, `sessionAt`, `NEEDS_YOU_SESSIONS`, `SESSIONS_URL`,
  `Reads.sessions` and every `needsYou` assertion; `flushAll` flushes four reads; rename
  `issues five reads…` to `issues four reads…`; delete the `chat.idle` case from the
  "ignores a frame" test.
- `dashboard.page.spec.ts`: same fixture deletions; `USED_KEYS` loses the six keys above;
  `flushAll` flushes four reads; the zero-fixture test loses the three
  `dashboard-needs-you` assertions; the start-card test loses the `dashboard-start-chat` line;
  the working/ready rows assert `href === \`/repos/${REPO_ID}\``; delete
  `reads the needs-you counts from the chat page`.

**14. `apps/app/src/app/app.routes.spec.ts`** — `EXPECTED_PATHS` becomes the 15-path array of
the Contract; delete `legacyPaths()` and its use, so the `docs/app.md` §4 agreement test asserts
only that every documented non-panel path has a route and every router path is documented
(`''` and `'**'` exempt); add:

```ts
it('retires the chat, jobs, runs and approvals routes', () => {
  const retired = ['chat', 'schedules', 'jobs', 'jobs/:id', 'runs', 'runs/:id', 'approvals'];
  const paths = routes.map((route) => route.path);
  for (const path of retired) expect(paths, path).not.toContain(path);
  expect(SHELL_TABS).toHaveLength(3);
});
```

**15. Docs wording (only these lines change).**

- `docs/app.md` §3: delete the `runs-list/`, `run-detail/` and `approvals/` lines from the
  `features/` tree. §4: delete the whole `**Legacy, retired by Task-76:**` paragraph, and in the
  `/dashboard` row replace "*Needs you*, running, unreviewed," with
  "**Running** and **ready** (an open PR),".
- `docs/security.md` §6 `Permissions` row: keep the `decidePermission` sentence, and state that
  the matrix has a **single** mode, `run`, that `routine.*` is classified `other` and denied, and
  that a non-`allow` decision is answered `reject` in place. The `Session targets` row: "A
  **session** is an editor with one target…".
- `docs/agent-runtime.md` §2: the `Session` row becomes "A session with one target (backlog,
  design, schedule, `work:<id>` or `repo`); archived (D55).", and the paragraph after the
  `cb-run-`/`cb-session-` paragraph opens "A session is not a run: it gets its own worktree and
  the **target is its write boundary** (D55)." Everything else in §2 stays.

**16. Folder maps.** `apps/daemon/README.md`: delete every `src/chat/**` line, add
"`src/route-table.test.ts` — the mounted `/v1` table: no chat, routine or reminder route, and
the retired tables are never written.", and change the `src/events/notifier.ts` line to say the
wake-up is shared by event appends and open streams. `apps/daemon/src/events/README.md`: the
header sentence "as soon as a chat append commits" becomes "as soon as an event append
commits". `apps/daemon/src/run/README.md`: the `approvals-retired.test.ts` line describes the
directory guard, not the chat service. `apps/daemon/src/runs/README.md`: drop `promote` from the
header, the `index.ts`, `routes.ts`, `service.test.ts` and `routes.test.ts` lines, and rewrite
the note that says the chat subsystem polls a resolved approval to say no agent path polls it.
`apps/app/README.md`: rewrite the intro (no chat, jobs/runs or run-detail screens), delete every
line of the 42 deleted files, add `src/app/core/util/time-format.ts` and
`src/app/core/util/time-format.spec.ts` (one line each, matching the file map's voice), and
change "the frozen 20-row path table" to "the frozen 15-row path table".

### Data

- **No schema change and no migration.** `chat_sessions`, `chat_messages`, `routines`,
  `routine_fires`, `runs.job_id`, `runs.work_id` and `schedule_fires.chat_id` stay exactly as
  `0001`–`0007` wrote them; the `chats` repository stays readable. This task removes the last
  writer of `chat_sessions`/`chat_messages` and writes nothing new.
- **`Schedule` keeps `chatSessionId`, `firePolicy` and `title`**; `Run` keeps
  `trigger: 'promote'` in its enum. They are the legacy projection of rows and of the legacy
  `/v1/schedules` and `/v1/jobs` accessors, which stay mounted. A type is not a route.
- The `session_legacy`-style bookkeeping is untouched; `schema_legacy` already lists the two
  chat tables.

## 🧩 Configuration

- No `CB_*` key is added or removed. `docs/providers.md` is not touched.
- `CB_SUBSYSTEM_*`-style overrides do not exist; the flags are the frozen
  `DEFAULT_SUBSYSTEM_FLAGS`, so removing two names removes two phantom "absent" modules from
  every boot report. `apps/daemon/src/main.ts` is **not** touched.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim from the repository root of the worktree `../wt-cb-76`
(`git rev-parse --abbrev-ref HEAD` must print `task-76`).

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` — a fresh worktree has no `node_modules`.
    Expected exit code `0`.
  - `npm run lint` — expected exit code `0`, no error and no warning.
  - `npm test` — expected exit code `0`. This runs `test:guard`, the app unit suite and the
    workspace Vitest projects.
  - `npm run build` — expected exit code `0` (`tsc` for every package and the daemon, `ng build`
    for the app).
  - `npx vitest run --project packages/core src/permissions.test.ts` — expected exit code `0`.
  - `npx vitest run --project apps/daemon src/route-table.test.ts src/modules.test.ts src/run/approvals-retired.test.ts src/schedules/fire.test.ts src/schedules/service.test.ts src/schedules/routes.test.ts` — expected exit code `0`.
  - `(cd apps/app && npx ng test --watch=false)` — expected exit code `0` (the app suite the
    root gate runs; use it to watch `app.routes.spec.ts`, `readme.spec.ts` and the dashboard
    specs). The parentheses keep the working directory at the repository root for the checks
    below.
  - The four structural checks below must print **nothing**; `git grep` exits `1` when it finds
    no match, so `1` with empty output is the pass:
    - `git grep -n "v1/chat" -- apps packages/core packages/store packages/opencode packages/scheduler packages/security scripts ops`
    - `git grep -n "v1/routines" -- apps`
    - `git grep -n "needsYou\|countNeedsYou\|isUnreviewedChat\|isAwaitingAnswer" -- apps/app`
    - `git grep -n "features/chat\|features/jobs\|features/runs-list\|features/run-detail\|features/approvals\|features/schedules" -- apps`
  - `test ! -d apps/daemon/src/chat && test ! -d apps/daemon/src/routines && test ! -d apps/app/src/app/features/jobs && test ! -d apps/app/src/app/features/runs-list && test ! -d apps/app/src/app/features/run-detail && test ! -d apps/app/src/app/features/approvals && test ! -d apps/app/src/app/features/chat && test ! -d apps/app/src/app/features/schedules` — expected exit code `0`.
  - `test -f apps/app/src/app/core/util/time-format.ts && test -f apps/app/src/app/core/util/time-format.spec.ts` — expected exit code `0`.
  - `git diff --name-only main...task-76` — every path must be in the exclusive list above;
    `packages/contracts/**`, `apps/daemon/src/main.ts`, `package.json`, `package-lock.json`,
    `vitest.config.ts`, `TODO.md`, `CHANGELOG.md` and `docs/decisions.md` must **not** appear.

- **Acceptance criteria:**
  - [ ] `[unit]` `npm run lint`, `npm test` and `npm run build` exit `0` (method above).
  - [ ] `[unit]` **The daemon mounts no retired route.** `apps/daemon/src/route-table.test.ts`
        passes and pins four assertions:
        (a) with `loadModules` on a real context, no path in `app.routes` equals `/v1/chat`,
        starts with `/v1/chat/`, equals `/v1/routines`, starts with `/v1/routines/`, equals
        `/v1/reminders` or starts with `/v1/reminders/`;
        (b) `app.routes` still contains `/v1/jobs`, `/v1/runs`, `/v1/sessions` and `/v1/works`;
        (c) `report.loaded` does not contain `'chat'` or `'routines'` and `report.failed` is
        `[]`;
        (d) after the modules load, `SELECT COUNT(*) FROM chat_sessions` and
        `SELECT COUNT(*) FROM chat_messages` are both `0`.
        Run: `npx vitest run --project apps/daemon src/route-table.test.ts` → exit `0`.
  - [ ] `[unit]` **The subsystem list is fifteen names.** `apps/daemon/src/modules.test.ts`
        passes its `lists the fifteen subsystems in order` test (the exact array in the
        Contract), `DEFAULT_SUBSYSTEM_FLAGS` has exactly those keys, and no fixture in
        `app.test.ts`, `auth/routes.test.ts`, `events/routes.test.ts` or `health.test.ts`
        spells a retired name (`git grep -n "routines: \|chat: true" -- apps/daemon` prints
        nothing).
  - [ ] `[unit]` **One permission mode.** `packages/core/src/permissions.test.ts` passes and
        asserts `Object.keys(PERMISSION_MATRIX)` is `['run']`, the exact five-key matrix in the
        Contract, `classifyTool('routine.create') === 'other'`,
        `classifyTool(' Routine.Pause ') === 'other'` and
        `decidePermission({ tool: 'routine.create', mode: 'run', path: null, worktree }) === 'deny'`.
        `git grep -n "mode: 'chat'" -- packages apps` prints nothing.
  - [ ] `[unit]` **The promote seam is gone.** `apps/daemon/src/runs/routes.test.ts` and
        `apps/daemon/src/runs/service.test.ts` pass without a `promote` describe block and
        `git grep -n "promote(" -- apps/daemon/src` finds no `runs.promote` caller or
        declaration.
  - [ ] `[unit]` **The repo-less fire still fails closed.** `apps/daemon/src/schedules/` passes;
        the former "fires a chat schedule through the chat port" test now asserts a repo-less
        schedule is claimed (`{ due: 1, fired: 1, skipped: 0, lost: 0 }`), starts no run
        (`port.runs` is `[]`) and ends with a `failed` fire row whose `detail` is
        `'repo_required'` and whose `chatId` is `null`.
  - [ ] `[unit]` **The approval guard no longer reads a deleted file.**
        `apps/daemon/src/run/approvals-retired.test.ts` passes; its second test asserts
        `existsSync(join(sourceDir, 'chat'))` is `false` (it may keep the first test, which walks
        the sources for `approvals.create(`).
  - [ ] `[unit]` **The app has no retired route.** `apps/app/src/app/app.routes.spec.ts` passes:
        `routes.map(r => r.path)` equals the 15-path array in the Contract in order, every
        `loadComponent` resolves to a component, every guarded route keeps `authGuard`, and a
        test asserts none of `chat`, `schedules`, `jobs`, `jobs/:id`, `runs`, `runs/:id` or
        `approvals` is a route path.
  - [ ] `[unit]` **The app compiles against no deleted file.** `apps/app/src/app/readme.spec.ts`
        passes both tests (every `src/app` file is in `apps/app/README.md` and every
        `src/app/...` path in the README exists); `git grep -n "features/chat\|features/jobs\|features/runs-list\|features/run-detail\|features/approvals\|features/schedules" -- apps` prints nothing.
  - [ ] `[unit]` **The dashboard reads no chat.** `dashboard.store.spec.ts` and
        `dashboard.page.spec.ts` pass with exactly four `HttpTestingController` reads per load
        (`/v1/health`, `/v1/telemetry?range=24h`, `/v1/runs?limit=50`, `/v1/repos?limit=1`),
        no `dashboard-needs-you` hook in the DOM, no `dashboard-start-chat` hook, and every
        run row carrying `href === /repos/${run.repoId}`.
  - [ ] `[unit]` **The folder maps are true.** `git grep -n "src/chat\|src/routines" -- apps/daemon/README.md` prints nothing;
        `apps/daemon/README.md` lists `src/route-table.test.ts`; `docs/app.md` §3 no longer lists
        `runs-list/`, `run-detail/` or `approvals/`, and §4 has no `**Legacy` line.
  - [ ] `[live]` **A fresh install has no chat screen and no orphan table write.** Measurement on
        the box, not on a runner: boot `cbd` against an empty `CB_STATE_DIR`, pair one device,
        then (1) `curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer <token>" http://127.0.0.1:8080/v1/chat/sessions`
        prints `404`, the same for `/v1/routines` and `/v1/reminders`; (2) the app at 320 px shows
        the three shell tabs and none of `/chat`, `/jobs`, `/runs`, `/approvals` resolves to a
        screen (each falls to the `**` About fallback); (3) after one full session turn,
        `sqlite3 "$CB_STATE_DIR/codebox.db" "select (select count(*) from chat_sessions), (select count(*) from chat_messages);"`
        prints `0|0`. This runner has no browser and no VM: report it **`not run`** and open an
        `agent-review` issue with the command and the bound above.

## 📣 Coordination

- **For the Architect:**
  - `packages/contracts` is deliberately untouched. `Routine`, `ChatSession`, `ChatMessage`,
    `ROUTINE_TOOL_NAMES`, the `routine.*` event names and the `chat`/`routines` OpenAPI tags stay;
    `openapi.ts` already exposes 62 paths with none under `/v1/chat` or `/v1/routines`, and
    `openapi.test.ts` (`retires the chat and routine paths`) is the guard. Nothing routes them,
    so a type is not a second source of truth. Two pre-existing drifts stay out of scope and are
    worth their own task: `IDEMPOTENT_ROUTES` in `packages/contracts/src/pagination.ts` still
    names `POST /v1/chat/sessions/{id}/promote` while `docs/api.md` §4 names
    `POST /v1/works/{id}/runs`, and the `chat`/`routines`/`approvals` OpenAPI tags have no path.
  - **Task-70's landing note assigns work this cut does not carry.** It says "the refusal
    triggers land with Task-76, whose own migration also drops the sentinel predicate". Neither
    fits: a `chat_sessions`/`chat_messages` refusal trigger breaks
    `packages/store/src/repositories.test.ts` (which seeds chat rows) and dropping the
    `title = ''` predicate requires retiring the legacy `/v1/schedules` create/patch writer,
    which this task keeps. Both need a `packages/store` + `docs/api.md` task and were left alone
    on purpose. Record the deviation; do not treat it as a missed criterion.
  - **The dashboard was not in the cut and had to be added.** `features/dashboard` read
    `GET /v1/chat/sessions?limit=50` (its `Needs you` card) and linked every run row to
    `/runs/{id}`. Without the six-file edit above, deleting the route turns the landing screen
    into an error block and every run row into the About fallback. The replacement is forced by
    what exists: the card loses its only source and is removed; the rows point at
    `/repos/{run.repoId}`, the only destination a `Run` carries and one that survives Task-77
    (`/repos/:id/workers` replaces `/repos/:id/works`, not `/repos/:id`). If the human wants the
    card re-sourced from works, that is a new task, not this one.
- **For the next batch (Task-77):** the run detail screen and `/runs/:id` are gone; a run is no
  longer a screen. `features/works/work.page.ts` (`/works/:id`) is the only run log left, and
  the dashboard no longer links to it (it has no `workId` on a `Run`). `/repos/:id/works`
  survives and is still the works list you replace. `apps/app/README.md` and
  `apps/app/src/app/app.routes.ts` are free again.
- **For Task-78/79:** unchanged; `packages/contracts` was not touched, so the `design` slice is
  still yours.
- **Hot files:** `apps/app/src/app/app.routes.ts` is held by this task and by no other.

## ⛔ Out of scope

- **No dependency** is added, removed or bumped; `package.json`, `package-lock.json`,
  `vitest.config.ts`, `tsconfig*.json` and `apps/app/angular.json` do not move.
- **No change to `packages/contracts`**, `packages/store` (schema, migrations, repositories),
  `packages/opencode`, `packages/scheduler`, `packages/security`, `packages/backlog` or
  `packages/design`.
- **No new migration, no trigger, no `DROP TABLE`** (see the Task-70 deviation above).
- **The legacy daemon endpoints stay mounted:** `/v1/jobs`, `/v1/approvals`,
  `/v1/schedules`, `GET /v1/runs` and their tests. They have no screen after this task; retiring
  the endpoints is a contract change with its own `docs/api.md` edit.
- **The `chat` scope in `packages/security` and the `tabs.chat`/`tabs.jobs` keys in
  `src/assets/i18n/*.json` stay**: no route requires the scope and the shared dictionaries have
  an en/es parity test but no "only used keys" test. Do not prune them here.
- **`ApiClient`'s `jobs()`, `run()`, `events()`, `diff()`, `cancel()` and `revert()` methods
  stay** (with `api-client.spec.ts`); they are dead callers, not a chat surface.
- **`apps/daemon/src/push/**` and `packages/store`'s `routines`/`routineFires` repositories
  stay**: the `routine.fired`/`routine.replied` event names and their push mapping are contract
  data, and the push tests seed them directly.
- **`docs/decisions.md` is not edited.** D38, D41, D44 and D56 already record this retirement;
  no guardrail, auto-merge list, protected path or diff budget changes.
- **`TODO.md` and `CHANGELOG.md` are not edited by the dev.** The Orchestrator ticks and logs at
  merge time.
- No refactor of a file this task does not have to touch, no reformat, no `prettier --write .`.

# Spec: Task-87 — The notifications route, and the map against the router

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (router + the settings feature) and docs, plus the import map and the two
  fixtures that are byte copies of it.
- **Role:** Dev.
- **Objective:** after this task `/settings/notifications` is a real route that loads the page
  the tree already has, behind the one `authGuard`; `design/import.json` names the
  `17 · Settings / Notifications` frame so the map and the router agree on eleven screens;
  `design/README.md` §1 carries its row; and a headless test proves that a screen documented in
  the import map and not served by `apps/app/src/app/app.routes.ts` fails the suite — the gap
  that let a mapped, unreachable screen ship.
- **Environment:** worktree `../wt-cb-87`, branch `task-87`, base `main` at
  `2375565dc8158ee6d23d8e92cde643558d5e60dd`.
- **Dependencies:** none. Nothing in this batch produces a file you read. Task-85 (the Figma
  import projection) and Task-86 (the bundled typeface) run beside you on disjoint paths.
- **Batch shape (frozen):** `apps/app/src/app/app.routes.ts` is a hot file and **you are its
  only holder in this batch**. `package.json` and `package-lock.json` are Task-86's: **do not
  run `npm install`, do not edit a manifest and do not write the lockfile.** Task-86 also owns
  `apps/app/src/theme/**`, `design/tokens.json` and `docs/app.md` §9; Task-85 owns
  `packages/design/src/{types,screens,import,index}.ts`, `scripts/design/import.mjs` and
  `design/README.md` §4. None of those is yours.
- **`design/routes.json` and `design/screens/**` do not exist in this tree.** They are the
  output of L6 — the operator running `node scripts/design/import.mjs` — and L6 runs **after**
  Task-85. Never create them, never write them from a test, and never require one to exist.
- **The map and its fixture copies are one fact.** `design/import.json` is asserted
  **byte-identical** to `packages/design/src/fixtures/figma/import.json` and to
  `scripts/design/fixtures/import.json`, and both the design package's suite and the command's
  suite pin its entry count and its projected frame counts. That is why this task holds them:
  the entry, the two byte copies, the two frame fixtures, the image stub and the count
  assertions move together, in this task, in one diff. Splitting them across two branches
  makes both branches red.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/app/app.routes.ts`
- `apps/app/src/app/app.routes.spec.ts`
- `apps/app/src/app/features/settings/notifications.page.ts` (add the routed page; keep the panel)
- `apps/app/src/app/features/settings/notifications.page.spec.ts`
- `design/import.json`
- `design/README.md` (**§1 "Routed screens"** and **§2 "States and sheets"** only)
- `docs/app.md` (**§4 "Screens"**, the single sentence of the `/settings` row only)
- `packages/design/src/fixtures/figma/import.json` (byte copy of `design/import.json`)
- `packages/design/src/fixtures/figma/file.json` (one frame appended)
- `packages/design/src/import.test.ts` (the three count assertions only)
- `scripts/design/fixtures/import.json` (byte copy of `design/import.json`)
- `scripts/design/fixtures/file.json` (one frame appended)
- `scripts/design/fixtures/images.json` (one id added)
- `scripts/design/import.test.mjs` (the fixture constants, the counts and the summary only)

**Do not touch** `apps/app/src/app/features/settings/settings.page.ts` (it keeps importing
`NotificationsPanel`), `notifications.store.ts`, `notifications.api.ts`, `notifications.i18n.ts`,
`apps/app/src/theme/**`, `apps/app/package.json`, either `package.json` or `package-lock.json`,
`design/tokens.json`, `packages/design/src/{types,screens,import,index,tokens,check}.ts`,
`scripts/design/import.mjs`, `design/README.md` §3–§7, `docs/app.md` §9, `TODO.md`,
`CHANGELOG.md`, `docs/decisions.md`.

`apps/app/README.md` needs no change: you add **no file** under `apps/app/src`, so its file map
stays correct (`apps/app/src/app/readme.spec.ts` walks that tree). Adding a file there is
forbidden for that reason.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/agent-spec-template.md`
- `apps/app/src/app/app.routes.ts`, `apps/app/src/app/app.routes.spec.ts`
- `apps/app/src/app/core/auth/auth.guard.ts`
- `apps/app/src/app/features/settings/settings.page.ts`,
  `settings.page.spec.ts`, `notifications.page.ts`, `notifications.page.spec.ts`,
  `notifications.store.ts`, `notifications.i18n.ts`
- `apps/app/package.json` (scripts only), `apps/app/vitest.config.mts`, `apps/app/README.md`
- `docs/app.md` §4 (you edit one sentence of it) and §1–§3 for context
- `design/import.json`, `design/README.md` §1, §2, §6, §7
- `packages/design/src/fixtures/figma/file.json`, `…/import.json`,
  `packages/design/src/import.test.ts`, `packages/design/README.md`
- `scripts/design/fixtures/file.json`, `…/import.json`, `…/images.json`,
  `scripts/design/import.test.mjs`
- `docs/agent-ci.md` §The issue handoff (only if you must open one, and you should not)

**No screen task:** `design/screens/*.json` and `design/exports/*.png` do not exist and are not
inputs. The frame this task maps is named only by its caption,
`17 · Settings / Notifications` (`design/README.md` §1, dark column `17`).

## 🔒 Contract

### 1. The route — `apps/app/src/app/app.routes.ts`

Insert exactly one route **between `settings/credentials` and `about`**, in the existing
shape:

```ts
{
  path: 'settings/notifications',
  canActivate: [authGuard],
  loadComponent: () =>
    import('./features/settings/notifications.page').then((module) => module.NotificationsPage),
},
```

- It carries `canActivate: [authGuard]` and **no `data.tab`** (it is not a tab root), exactly
  like `settings/devices` and `settings/credentials`.
- The declared order of `routes` becomes, verbatim:
  `''`, `pair`, `dashboard`, `repos`, `settings`, `repos/:id/workers`, `repos/:id/schedule`,
  `repos/:id/design`, `repos/:id`, `works/:id`, `sessions/:id`, `settings/devices`,
  `settings/credentials`, `settings/notifications`, `about`, `**`.
- Add one exported pure helper, used by the spec and by nothing else:

  ```ts
  export interface DocumentedRoute {
    readonly path: string;
    readonly screen?: string;
    readonly component?: string;
  }

  /**
   * The documented paths no route serves. A path compares exactly after one leading `/` is
   * stripped; the result keeps the documented order, without duplicates.
   */
  export function missingDocumentedRoutes(
    table: readonly Route[],
    documented: readonly DocumentedRoute[],
  ): readonly string[];
  ```

  A documented path is missing when no route in `table` has `route.path === path.replace(/^\//, '')`.
  `/settings/nowhere` is returned as `/settings/nowhere`; `/settings/notifications` is not
  returned once the route above exists.
- `SHELL_TABS`, `ShellTabId`, `ShellTab` and the three tab roots are untouched.

### 2. The page — `apps/app/src/app/features/settings/notifications.page.ts`

The file keeps `NotificationsPanel` **exactly as it is** (same selector
`app-notifications-panel`, same store, same template, same `closed` output — `settings.page.ts`
imports it and is not yours) and gains one standalone component **in the same file**:

```ts
@Component({
  selector: 'app-notifications-page',
  standalone: true,
  imports: [NotificationsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-notifications-panel />`,
})
export class NotificationsPage {}
```

It adds no provider, no store, no HTTP call and no new file: the panel's own
`providers: [NotificationsStore]` and its constructor's `store.load()` do the work.

### 3. The map — `design/import.json`

Append one entry **after `16 · Settings / Credentials` and before `07 · About — mobile dark`**
(the array's index 9), byte for byte in the file's existing style (two-space indent, keys in
the same order):

```json
{
  "caption": "17 · Settings / Notifications",
  "screen": "Notifications",
  "route": "/settings/notifications",
  "component": "NotificationsPage",
  "states": {
    "loading": null,
    "empty": null,
    "error": null
  },
  "snapshot": true
}
```

`design/import.json` therefore has **eleven** `frames`, and the eleventh's `screen` is the
string `Notifications` — the same string `design/README.md` §1's row carries.

### 4. The two byte copies and the two page fixtures

- `packages/design/src/fixtures/figma/import.json` and `scripts/design/fixtures/import.json`
  are **byte-identical** to `design/import.json` after your change (the suites assert it with
  `Buffer.equals`). Copy, do not re-serialise.
- `packages/design/src/fixtures/figma/file.json`: append one frame **at the end of `frames`**
  (after the `12:901` entry, so the Dashboard stays at index 5 and `frames[11]` stays the
  1280 × 800 frame):

  ```json
  {
    "id": "9:190",
    "caption": "17 · Settings / Notifications",
    "width": 390,
    "height": 844,
    "fills": ["#0b0f14"]
  }
  ```

- `scripts/design/fixtures/file.json`: append one raw Figma node **at the end of `Page 1`'s
  `children`** (after the `13:950` Annotation node, so the two 1280 × 800 frames keep their
  indexes — `frames[11]` is still `12:910`, which the existing projection case asserts — and the
  Annotation is still not a frame):

  ```json
  {
    "id": "9:190",
    "name": "17 · Settings / Notifications",
    "type": "FRAME",
    "absoluteBoundingBox": { "x": 0, "y": 0, "width": 390, "height": 844 },
    "fills": [
      { "type": "SOLID", "color": { "r": 0.043, "g": 0.059, "b": 0.078 } }
    ]
  }
  ```

  Its colour is `#0b0f14`, which the page already contains: the projected colour set does not
  grow. Give it **no** children: Task-85's projection must see no measurable child and leave
  `layout` off this frame on the combined tree.
- `scripts/design/fixtures/images.json`: add `"9:190": "https://figma-images.example/9-190.png"`
  after the `9:180` entry.

### 5. The count pins

- `packages/design/src/import.test.ts`: `fileSnapshot('file.json').frames` 12 → **13**;
  `result.routes` and `result.screens` 10 → **11**; `parseImportMap(shipped).frames` 10 →
  **11**; the round-trip `routes` 10 → **11**. Nothing else in that file moves: the colour
  array, `DASHBOARD_INDEX = 5`, the missing-caption case and the export hash are unchanged.
- `scripts/design/import.test.mjs`: `SLUGS` becomes
  `['pairing','repo-list','repo-backlog','repo-workers','design-session','dashboard','settings','devices','credentials','notifications','about']`;
  `IDS` becomes
  `['1:100','2:110','3:120','4:130','5:140','6:150','7:160','8:170','9:180','9:190','10:190']`;
  `SUMMARY` becomes
  `'{"frames":13,"mapped":11,"unmapped":2,"colours":8,"coloursOutsideTokens":1,"routes":11,"screens":11,"exports":11}'`;
  the write case asserts **23** status lines plus the summary (**24** `lines`), `lines[0]` is
  `'wrote design/routes.json (11 routes)'`, the screen slice is `lines.slice(1, 12)`, the export
  slice is `lines.slice(12, 23)` and the summary is `lines[23]`; the routes family is
  `toHaveLength(11)`; the API case expects **13** calls (`2 + 11`); every remaining literal
  copy of the old summary is updated to the new one.

### 6. `apps/app/src/app/app.routes.spec.ts`

- `EXPECTED_PATHS` gains `'settings/notifications'` between `'settings/credentials'` and
  `'about'`.
- `PANEL_ONLY_PATHS` becomes `['/settings/providers']` — notifications is a route now, and
  only the providers panel still renders inside `/settings` with no route of its own.
- New case: **the notifications route loads the page behind the guard** —
  `routeFor('settings/notifications').canActivate` has length 1 and its `[0]` **is**
  `authGuard`; `await routeFor('settings/notifications').loadComponent?.()` **is**
  `NotificationsPage` (imported from `./features/settings/notifications.page`); the route has no
  `data.tab`.
- New case: **every route in the map is served by the router** — parse
  `resolve(process.cwd(), '../../design/import.json')` (always, it is committed), assert
  `frames.length === 11`, then
  `expect(missingDocumentedRoutes(routes, frames.map((f) => ({ path: f.route })))).toEqual([])`.
  Then, **only when `existsSync(resolve(process.cwd(), '../../design/routes.json'))`**, parse
  `{ routes: [{ path }] }` from it and run the same assertion — L6 writes that file later; it is
  absent today, and the test must not require it, must not create it and must not write it.
- New case: **the check fails when a documented route is missing** — proven by fixture, never
  by deleting a real route at run time:
  `const withoutNotifications = routes.filter((route) => route.path !== 'settings/notifications');`
  then
  `expect(missingDocumentedRoutes(withoutNotifications, [{ path: '/settings/notifications' }])).toEqual(['/settings/notifications'])`
  and `expect(missingDocumentedRoutes(routes, [{ path: '/settings/nowhere' }])).toEqual(['/settings/nowhere'])`.
- The retired-route case adds `routines` and `routines/:id` to its list (`chat` is already
  there), so **no `/chat` and no `/routines` route can reappear**.
- Every existing case keeps passing unmodified: the frozen order, `loadComponent` resolving
  for every path, the guard on every route but `/pair`, the three tab roots, the
  `docs/app.md` §4 round trip in both directions, and `restoreSession`.

### 7. The page spec — `apps/app/src/app/features/settings/notifications.page.spec.ts`

Add one case beside the existing panel cases, reusing the file's `mount` providers
(`provideHttpClient`, `provideHttpClientTesting`, a stubbed `I18nService`): mount
`NotificationsPage`, flush one `GET /v1/notifications/preferences`, and assert the element
contains `[data-testid="notifications-panel"]` with five `[data-testid^="notifications-toggle-"]`
inputs. The panel's own cases stay as they are.

### 8. The docs and the map

- `docs/app.md` §4, the `/settings` row: replace its last sentence ("The providers and
  notifications panels render inside this route; they have no route of their own.") with
  "The providers panel renders inside this route and has no route of its own; the notifications
  panel renders here and at `/settings/notifications`, which mounts the same page." Nothing
  else in §4 changes: the `/settings/notifications` row already exists and stays verbatim.
- `design/README.md` §1 must carry, untouched or restored, exactly this row:

  ```text
  | Notifications | `/settings/notifications` | `features/settings` | 17 | L22 | — | — |
  ```

  It is correct on the base commit: if your diff does not need to change it, **leave the file
  alone** and say so in your report. §2 gains **no** row: notifications is a route, not a sheet.

## 🧩 Configuration

None. No `CB_*` key, no environment variable, no new dependency and no lockfile write.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing else
is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`; it
    must not change `package-lock.json`).
  - `npm run lint` — must pass.
  - `npm test` — the app suite (`npx ng test --watch=false`, which runs `app.routes.spec.ts`,
    `readme.spec.ts` and the notifications specs) plus `packages/design` and `scripts`.
  - `npm run build` — `tsc -b` and the Angular build.
  - `npx vitest run --project packages/design` and `npx vitest run --project scripts` — the two
    suites whose fixtures this task moves, on their own.
  - `node --input-type=module -e "import {readFileSync} from 'node:fs'; const m=JSON.parse(readFileSync('design/import.json','utf8')); if (m.frames.length!==11) throw new Error('frames: '+m.frames.length); const n=m.frames.find((f)=>f.screen==='Notifications'); if (!n || n.route!=='/settings/notifications' || n.component!=='NotificationsPage' || n.caption!=='17 · Settings / Notifications') throw new Error('entry: '+JSON.stringify(n)); console.log('map ok: 11 entries, 17 -> /settings/notifications NotificationsPage')"`
  - `node --input-type=module -e "import {readFileSync} from 'node:fs'; const a=readFileSync('design/import.json'); for (const p of ['packages/design/src/fixtures/figma/import.json','scripts/design/fixtures/import.json']) if (!a.equals(readFileSync(p))) throw new Error('copy differs: '+p); console.log('copies byte-identical')"`
  - `git diff --name-only origin/main...task-87` — audit against the exclusive paths above.
  - `git diff --name-only origin/main...task-87 -- apps/app/src/theme package.json package-lock.json design/tokens.json packages/design/src/types.ts packages/design/src/screens.ts packages/design/src/import.ts scripts/design/import.mjs design/README.md` — **must print nothing** (Task-85/86 paths).
- **Acceptance criteria:**
  - [ ] `[unit]` The route loads the page behind `authGuard`: `settings/notifications` exists in
        `routes` exactly once, `canActivate` is `[authGuard]`, `loadComponent()` resolves to
        `NotificationsPage`, and it has no `data.tab`.
  - [ ] `[unit]` The map parses to **eleven** entries and the notifications frame resolves to
        `/settings/notifications` and `NotificationsPage` (the `node -e` check above and the
        spec case).
  - [ ] `[unit]` The router test **fails when a documented route is missing**, proven by
        fixture: a route table without `settings/notifications` plus the documented path
        `/settings/notifications` yields `['/settings/notifications']`, and the real table plus
        `/settings/nowhere` yields `['/settings/nowhere']`. No real route is deleted at run time.
  - [ ] `[unit]` No `/chat` and no `/routines` route reappears: the retired list in the spec
        contains `chat`, `schedules`, `jobs`, `jobs/:id`, `runs`, `runs/:id`, `approvals`,
        `routines`, `routines/:id`, and `routes` contains none of them.
  - [ ] `[unit]` `design/routes.json` is not required: the spec parses it only under
        `existsSync`, and `git status --porcelain design` shows no `routes.json`, no `screens/`
        and no `exports/`.
  - [ ] `[unit]` The two map fixtures are byte-identical to `design/import.json`, and the two
        page fixtures project to thirteen frames with eleven mapped captions
        (`packages/design` and `scripts` suites green).
  - [ ] `[unit]` `docs/app.md` §4 documents `settings/notifications` as a route and the spec's
        both-directions case passes; §9 and every section outside §4 is unchanged.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched, `apps/app/README.md` is
        unchanged, and no file was added under `apps/app/src`.
  - No `[live]` criterion: the item declares none, and nothing in it needs a running browser,
        a daemon, a stream or a tunnel. Do not invent one.

## 📣 Coordination

- **For the Architect:** this task holds the whole map fact — `design/import.json`, its two
  byte-copy fixtures, the two page fixtures, the image stub and the count pins in
  `packages/design/src/import.test.ts` and `scripts/design/import.test.mjs`. It also holds
  `apps/app/src/app/app.routes.ts` (the batch's router hot file) and the one sentence of
  `docs/app.md` §4 that says notifications has no route. Task-86 holds `docs/app.md` §9 of the
  same file — disjoint sections, named here.
- **For Task-85 (same batch):** your `projectPage` gains `SECTION`/`COMPONENT` traversal and an
  optional `layout`; the notifications frame this task appends has **no children with a box**,
  so it must project with no `layout` key and the command's summary must stay
  `{"frames":13,"mapped":11,"unmapped":2,"colours":8,"coloursOutsideTokens":1,"routes":11,"screens":11,"exports":11}`.
  Do not edit the fixtures or the counts above.
- **For Task-86 (same batch):** nothing to read. The new page renders `.cb-muted` and
  `--cb-font-mono`, both of which already exist at the base commit; do not depend on
  `--cb-font-sans` landing.
- **For L6 (the operator's run, after this batch):** the map now has eleven entries, so the
  import writes eleven specs, eleven exports and an eleven-route `design/routes.json`; the
  router test reads that file automatically once it exists, with no further change.
- **For the next batch:** `docs/app.md` §4's `/settings` row and `design/README.md` §1 now
  agree with the router for every mapped screen. A second mapped screen with no route would be
  caught by `missingDocumentedRoutes`, not by a reviewer.

## ⛔ Out of scope

- No second route, no `/chat`, no `/routines`, no `/settings/providers` route: the providers
  panel keeps rendering inside `/settings`.
- No change to `NotificationsPanel`, `NotificationsStore`, `notifications.api.ts` or
  `notifications.i18n.ts`; no i18n key added; no visual change to the panel.
- No `settings.page.ts` change: it keeps mounting the panel.
- No new file under `apps/app/src`, and no `apps/app/README.md` edit.
- No `design/routes.json`, no `design/screens/**`, no `design/exports/**`: L6 owns them, and a
  task that creates one hand-edits a generated artifact.
- No dependency, no manifest, no lockfile, no `npm install`.
- No `[live]` criterion invented, no Playwright, no browser.
- No refactor of a file this task did not have to touch, and no `docs/decisions.md` entry.

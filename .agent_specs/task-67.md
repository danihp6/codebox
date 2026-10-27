# Spec: Task-67 — About

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (Angular 22 + Ionic 9, standalone components, signals, zoneless).
- **Role:** Dev.
- **Objective:** `/about` becomes a real screen: the daemon's build identity (version, commit,
  build time, Node), the server health rows, and the third-party licences row, every value read
  from a response or from the shipped `NOTICE` content — never typed into the component. After
  this task the screen parses `GET /v1/version` and `GET /v1/health`, renders the health rows the
  daemon reports, lists every package the repository's `NOTICE` holds, and a unit test fails if
  any of those values is hard-coded.
- **Environment:** worktree `../wt-cb-67`, branch `task-67`, base `main` @ `459e75c`.
- **Dependencies:** none. `apps/app/src/app/features/about/about.page.ts` exists as a
  placeholder and is the `<AboutPage>` the frozen router already lazy-loads for `/about` and
  for `**`; `packages/contracts` already exports `Version`, `Health`, `parseVersion` and
  `parseHealth`; `NOTICE` exists at the repository root (Task-69, merged).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/app/features/about/about.page.ts` (replace the placeholder)
- `apps/app/src/app/features/about/about.page.spec.ts` (**new**)
- `apps/app/src/app/features/about/about.store.ts` (**new**)
- `apps/app/src/app/features/about/about.store.spec.ts` (**new**)
- `apps/app/src/app/features/about/about.i18n.ts` (**new**)
- `apps/app/src/app/features/about/notice.ts` (**new** — the shipped `NOTICE` text and its parser)
- `apps/app/src/app/features/about/notice.spec.ts` (**new**)
- `apps/app/README.md` — **shared file, section claim only.** This task may edit **only** the
  lines whose backticked path starts with `src/app/features/about/`. It may **not** touch the
  `dashboard.*`, `chat.*`, `settings.*`, `shared.*`, `core.*`, `shell.*` or `jobs.*` lines, and
  it must not reorder or reformat the rest of the file. Add exactly one line per new file in
  the existing style: ``- `path` — one sentence``. The existing sentence for
  `src/app/features/about/about.page.ts` ("about/404 placeholder") must be replaced by one that
  describes the real screen.

**Forbidden to every task in this batch (do not open for writing, at all):**
`apps/app/src/app/app.routes.ts`, `apps/app/src/main.ts`, `apps/app/angular.json`,
`package.json`, `package-lock.json`, `tsconfig.base.json`, `packages/**`, `apps/daemon/**`,
`docs/**`, `TODO.md`, `CHANGELOG.md`, `docs/decisions.md`, `NOTICE` (read it, never edit it).

### Inputs (read-only)

Files this task may read, and only these beyond `AGENTS.md` and the exclusive paths above:

- `docs/app.md` §4 (`/about`), §13 (build and release), §9 (copy and localisation), §12 (testing)
- `docs/api.md` §5.1 (`GET /v1/version`, `GET /v1/health`)
- `packages/contracts/src/resources.ts` — `versionSchema`, `healthSchema`
- `NOTICE` (repository root) — the licence list this screen ships
- `apps/app/src/app/core/api/api-client.ts` — `ApiClient.version()`, `ApiClient.health()`
- `apps/app/src/app/core/i18n/i18n.service.ts`
- `apps/app/src/app/features/dashboard/dashboard.page.ts` — read only, for the health-card
  vocabulary (do not import it, do not edit it)
- `apps/app/src/app/app.routes.ts` — read only, to confirm `AboutPage` is the lazy component

## 🔒 Contract

The public surface other tasks and QA are written against **right now**. Exact names.

### `notice.ts` (pure; no I/O, no clock, no environment)

```ts
export interface ThirdPartyNotice {
  readonly name: string; // `@angular/core`
  readonly version: string; // `22.2.3`
  readonly licence: string; // `MIT`
  readonly label: string; // `${name}@${version}`
}

/** A verbatim copy of the repository's `NOTICE`, generated once by this task. */
export const NOTICE_TEXT: string;

/** `- name@version — LICENCE` bullets before the `Copyleft exceptions` heading. */
export function parseNotice(text: string): readonly ThirdPartyNotice[];

export const THIRD_PARTY_NOTICES: readonly ThirdPartyNotice[]; // = parseNotice(NOTICE_TEXT)
```

`parseNotice` rules, frozen: iterate the lines; a line starting with `- ` before the
`Copyleft exceptions` heading is a package; split it on `' — '` (space, em dash, space) into
`name@version` and `licence`; split `name@version` at the **last** `@`; trim both sides; skip a
line that does not split into exactly two non-empty parts; preserve file order; return an empty
array for empty input. No I/O: the spec reads the file, this module never does.

### `about.store.ts` (new)

```ts
@Injectable()
export class AboutStore {
  readonly version = signal<Version | null>(null);
  readonly health = signal<Health | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);

  load(): void; // ApiClient.version() + ApiClient.health(); loading clears when both settle
  reload(): void; // the same two reads, error cleared first
}
```

Use `ApiClient` (`core/api/api-client.ts`), which already parses both payloads and maps the
error envelope. A failed read sets `error` and leaves `loading` false; the other read still
lands if it succeeded. No clock, no formatting in the store.

### `about.page.ts` (replace the placeholder; keep the selector and the class name)

```ts
@Component({ selector: 'app-about-page', standalone: true, /* keep OnPush */ })
export class AboutPage {
  readonly store = inject(AboutStore);
  readonly notices = THIRD_PARTY_NOTICES;
  readonly t: (key: string) => string;
  formatBuiltAt(value: string | null): string; // RFC 3339 -> the same string, or '—' when null
}
```

`data-testid` values, frozen:

| hook | element | attributes / content |
| --- | --- | --- |
| `page-about` | root `<div>` | `data-status` = `store.health()?.status ?? ''` |
| `about-loading` | loading line | rendered while `store.loading()` |
| `about-error` | error block | `data-code` = `store.error()?.code`; button `about-retry` calls `store.reload()` |
| `about-version` | `<p>` | `data-version` = `version.version`; text contains that value |
| `about-commit` | `<p>` | `data-commit` = `version.commit ?? 'none'`; text shows the commit, or `—` when null |
| `about-built-at` | `<p>` | `data-built-at` = `version.builtAt ?? 'none'`; text shows `formatBuiltAt(...)` |
| `about-node` | `<p>` | `data-node` = `version.node` |
| `about-health` | section | `data-status` = `health.status` |
| `about-health-db` | `<p>` | `data-state` = `health.db` |
| `about-health-opencode` | `<p>` | `data-state` = `health.opencode` |
| `about-health-disk` | `<p>` | `data-percent` = `health.disk.usedPercent` |
| `about-health-queue` | `<p>` | `data-pending`, `data-running`, `data-max` from `health.queue` |
| `about-notice` | section | `data-packages` = `notices.length` |
| `about-notice-item` | one `<li>` per notice | `data-package` = `notice.label`, `data-licence` = `notice.licence`; text contains both |

Frozen rules:

- Every value on this screen comes from `store.version()`, `store.health()` or
  `THIRD_PARTY_NOTICES`. **No literal version, commit, build time, node version, health state or
  package count appears in the template or the class.**
- Both read failures are non-fatal for the other half: a rendered screen may show the version
  block and the error block together.
- The page keeps `data-testid="page-about"` (it is the `/about` and `**` component).

### `about.i18n.ts` (new)

```ts
export type Locale = 'en' | 'es';
export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>>;
export function translate(locale: Locale, key: string): string;
```

Keys, frozen, both locales, same set:

```
about.title              about.section.build       about.section.health
about.version            about.commit              about.built-at
about.node               about.health.db           about.health.opencode
about.health.disk        about.health.queue        about.section.notices
about.notices.count      about.error               about.retry
```

### Data

No new wire key, no new event, no new route, no new `CB_*` key. The screen reads the existing
`Version` and `Health` objects and the repository's `NOTICE` content.

## 🧩 Configuration

None — no new `CB_*` key, no new dependency, no build define and **no `angular.json` change**
(recorded as a deviation below).

## 🧪 Test and Validation Plan (for QA)

- **Method** (run from the root of the worktree `../wt-cb-67`):
  - `npm ci --prefer-offline --no-audit --no-fund` — a fresh worktree has no `node_modules`.
  - `npm run lint` — must pass.
  - `npm test` — the root gate: `test:guard`, the full app unit suite through
    `npm test -w @codebox/app` (`ng test --watch=false`, Vitest + jsdom, headless), then the
    workspace Vitest projects. Every test below runs here.
  - `npm run build` — `tsc -b` plus the app production build.
  - `git diff --name-only main...task-67` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean (`npm run lint`, `npm run build`).
  - [ ] `[unit]` `about.page.spec.ts` — *version and commit come from the response*: flush
        `GET /v1/version` with
        `{ version: '9.9.9-test', commit: 'deadbee', builtAt: '2026-01-02T03:04:05Z', node: 'v24.9.1' }`
        and `GET /v1/health` with the health fixture below; assert
        `about-version[data-version="9.9.9-test"]`, `about-commit[data-commit="deadbee"]`,
        `about-built-at[data-built-at="2026-01-02T03:04:05Z"]`, `about-node[data-node="v24.9.1"]`,
        and that each element's `textContent` contains the same value. A literal in the template
        (`0.1.0`, `v24`, `main`) fails this assertion.
  - [ ] `[unit]` `about.page.spec.ts` — *health rows match the fixture*: with the same mount as
        above, `about-health[data-status="ok"]`, `about-health-db[data-state="ok"]`,
        `about-health-opencode[data-state="degraded"]`,
        `about-health-disk[data-percent="75"]`, `about-health-queue[data-pending="2"][data-running="1"][data-max="4"]`.
  - [ ] `[unit]` `about.page.spec.ts` — *a null commit and a null build time*: flush
        `{ version: '1.0.0', commit: null, builtAt: null, node: 'v24.0.0' }` and assert
        `data-commit="none"`, `data-built-at="none"` and the visible text `—` in both rows.
  - [ ] `[unit]` `about.page.spec.ts` — *the licences list comes from the shipped NOTICE*:
        the rendered `[data-testid="about-notice-item"]` count equals
        `THIRD_PARTY_NOTICES.length` and `about-notice[data-packages]` equals the same number;
        an item with `data-package="hono@<version from NOTICE>"` has `data-licence="MIT"`, and
        the list contains a `rxjs@…` item with `data-licence="Apache-2.0"` and a `tslib@…` item
        with `data-licence="0BSD"`.
  - [ ] `[unit]` `notice.spec.ts` — *the shipped text is the repository's NOTICE*:
        `NOTICE_TEXT.trim()` equals `readFileSync(resolve(process.cwd(), '../../NOTICE'), 'utf8').trim()`
        (the app unit suite runs with `process.cwd() === apps/app`), and
        `THIRD_PARTY_NOTICES` deep-equals `parseNotice(NOTICE_TEXT)`.
  - [ ] `[unit]` `notice.spec.ts` — *the parser*: `parseNotice('')` is `[]`;
        `parseNotice('- hono@4.13.13 — MIT\n- rxjs@7.8.2 — Apache-2.0\n')` yields
        `[{ name: 'hono', version: '4.13.13', licence: 'MIT', label: 'hono@4.13.13' },
          { name: 'rxjs', version: '7.8.2', licence: 'Apache-2.0', label: 'rxjs@7.8.2' }]`;
        a scoped name (`@angular/core@22.2.3`) keeps its scope and splits at the last `@`; a
        non-bullet line before the heading is skipped.
  - [ ] `[unit]` `about.store.spec.ts` — both reads land independently: a `500` on
        `GET /v1/health` sets `error().code` and still renders the version, and a `500` on
        `GET /v1/version` still renders the health rows; `about-retry` re-issues both.
  - [ ] `[unit]` `about.page.spec.ts` — the i18n parity test passes:
        `Object.keys(STRINGS.en).sort()` equals `Object.keys(STRINGS.es).sort()`, every value is
        non-empty, and every key in the list above resolves to something other than itself.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-67` prints only paths from the list, plus the
        `apps/app/README.md` lines claimed here — and in particular **not** `NOTICE`,
        `apps/app/angular.json` or `app.routes.ts`.
  - [ ] `[live]` The health rows match `GET /v1/health`.
        **Measurement:** on the box, `curl -s https://<host>/v1/health | jq -c '{status,db,opencode,disk,queue}'`
        and open `/about`; every rendered row equals the corresponding value of that curl — for
        example with `{"db":"ok","disk":{"usedPercent":41},"queue":{"pending":0,"running":0,"maxConcurrency":2}}`
        the screen shows `about-health-db[data-state="ok"]`, `about-health-disk[data-percent="41"]`
        and `about-health-queue[data-max="2"]` within 3 s of the first paint. This needs a live
        daemon and a browser: QA reports it **not run** in this environment and the Orchestrator
        files one `agent-review` issue.

## 📣 Coordination

- **Recorded deviation — no compile-time build identity.** `docs/app.md` §13 says version,
  commit and build time are "injected at build time". Injecting them needs a define in
  `apps/app/angular.json`, which is untouchable in this batch, so the screen shows the
  **daemon's** build identity from `GET /v1/version` (`version`, `commit`, `builtAt`, `node`).
  A compile-time injection is a later task that owns `angular.json`; the store and the page
  take the same four fields, so the swap is local to `about.store.ts`.
- **Recorded deviation — the `NOTICE` is shipped as a bundled constant.** `angular.json`
  copies only `src/assets/**` and `public/**`, so the root `NOTICE` is not reachable over HTTP
  without editing `angular.json`. `notice.ts` therefore holds a verbatim `NOTICE_TEXT` copy and
  `notice.spec.ts` fails the suite the moment the root `NOTICE` and the copy diverge. A later
  task that owns `angular.json` can copy `NOTICE` into `src/assets` and drop the constant.
- **The Settings screen keeps its inline version block.** `settings.page.ts` (Task-64 / Task-63)
  renders `settings-version` / `settings-commit` / `settings-node` from `SettingsStore.version()`.
  This task does not touch that file. A later settings pass may replace it with a link to
  `/about`; the two screens must agree because both read `GET /v1/version`.
- **`/about` is also the `**` fallback** in the frozen router, so the screen must render
  sensibly for an unknown path (empty values, no crash) — that is why both reads fail
  independently.
- No hot file is claimed by this task. No `packages/contracts`, `docs/api.md` or
  `docs/providers.md` change is owed.

## ⛔ Out of scope

- No `angular.json` change, no build define, no `src/assets/NOTICE` asset, no new dependency.
- No change to `app.routes.ts`, `NOTICE`, `settings.*`, `dashboard.*` or any file outside the
  exclusive paths.
- No changelog/release notes inside the app, no update check, no link to GitHub, no copy-to-
  clipboard button.
- No change to `TODO.md`, `CHANGELOG.md`, `docs/decisions.md` or `docs/app.md`.

## ✅ Finish

The dev finishes with the gate green — `npm ci && npm run lint && npm test && npm run build`
from the repository root — then creates an **empty** commit whose subject is exactly
`dev: done task-67` and pushes it to `origin/task-67`. This spec file at
`.agent_specs/task-67.md` is committed by the Orchestrator before the dev starts; the dev must
not create, edit or commit anything under `.agent_specs/`, must not tick `TODO.md` and must not
write `CHANGELOG.md`.

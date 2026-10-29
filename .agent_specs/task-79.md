# Spec: Task-79 — Design session: preview the repository's artifact

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** contract + daemon + app (one vertical slice; it lands as one task because the
  route does not exist and a card without a route would be a fixture pretending to be a
  preview).
- **Role:** Dev.
- **Objective:** a `design` session (`/sessions/:id`, `session.target === 'design'`) opens with
  a **preview card above the thread**: `design/` read at a commit — the default branch head, or
  the pending proposal's commit when there is one — with its tokens, its routes, each screen's
  three declared states and the findings of the tokens/routes/states check. The card is the
  repository's spec, never a canvas (D52), and a repository with no `design/` says so instead
  of drawing a guess. To get there this task adds the missing read: `GET
  /v1/repos/{id}/design?revision=`, its contract schema, its OpenAPI operation and a `design`
  daemon subsystem built over the existing `@codebox/design` parsers.
- **Environment:** worktree `../wt-cb-79`, branch `task-79`, base `main` (`0a17286`).
- **Dependencies:** Task-75 (merged) — it produced `apps/app/src/app/features/sessions/**` (the
  page and store this task extends), `features/repos/repo-design.page.ts` and
  `repo-chrome.i18n.ts` (read-only here). Task-74 (merged) — it produced `packages/design`
  (`parseTokens`, `parseRoutes`, `parseScreenSpec`, `checkDocuments`, `tokenValues`) and
  `apps/daemon/src/gate/design-check.ts`, the only reader of `design/` today. Task-70 (merged)
  — `packages/contracts` and `docs/api.md` §5.2. Task-77 runs beside this task in the same
  batch and shares `apps/app/README.md` only, by block.

### Exclusive paths (single writer)

Create or modify **only** these paths. Nothing outside this list. If a change seems to require
another file, stop and report it; do not improvise.

Contracts (you are the only holder of this slice; the hot file is yours):

- `packages/contracts/src/design.ts` (new)
- `packages/contracts/src/design.test.ts` (new)
- `packages/contracts/src/index.ts` (hot file: `packages/contracts/src/index.ts`)
- `packages/contracts/src/openapi.ts`
- `packages/contracts/src/openapi.test.ts`
- `packages/contracts/README.md`

Daemon:

- `apps/daemon/src/design/preview.ts` (new)
- `apps/daemon/src/design/preview.test.ts` (new)
- `apps/daemon/src/design/service.ts` (new)
- `apps/daemon/src/design/service.test.ts` (new)
- `apps/daemon/src/design/routes.ts` (new)
- `apps/daemon/src/design/routes.test.ts` (new)
- `apps/daemon/src/design/index.ts` (new)
- `apps/daemon/src/modules.ts`
- `apps/daemon/src/modules.test.ts`
- `apps/daemon/README.md`

Docs:

- `docs/api.md` (section: §5.2 Repositories — one table row, one paragraph, one JSON block)
- `docs/app.md` (section: §8 Work and session, the **Session** block only — the bullet list
  under `**Session** is the editor (D55):`; nothing else in the file)

App:

- `apps/app/src/app/features/sessions/sessions.api.ts`
- `apps/app/src/app/features/sessions/sessions.api.spec.ts`
- `apps/app/src/app/features/sessions/design-preview.card.ts` (new)
- `apps/app/src/app/features/sessions/design-preview.card.spec.ts` (new)
- `apps/app/src/app/features/sessions/session.page.ts`
- `apps/app/src/app/features/sessions/session.page.spec.ts`
- `apps/app/src/app/features/sessions/i18n.ts`
- `apps/app/README.md` (line block: the `src/app/features/sessions/**` lines — and nothing else)

### Inputs (read-only)

- `AGENTS.md`
- `docs/api.md` §3 (the error envelope), §5.2, §5.6.1, §6
- `docs/app.md` §4 (`/sessions/:id`), §8, §9
- `design/README.md` §5 (tokens) and §7 (the preview rule)
- `packages/contracts/src/{primitives.ts,errors.ts,works.ts,openapi.ts,index.ts}`
- `packages/design/src/{types.ts,tokens.ts,routes.ts,screens.ts,check.ts,index.ts}`
- `apps/daemon/src/gate/design-check.ts` (how `design/` is read today)
- `apps/daemon/src/backlog/{service.ts,routes.ts,routes.test.ts}` (the pattern you copy:
  bare-clone read, `ensureClone`, `handle`, `json`, `queryInput`)
- `apps/daemon/src/modules.ts`, `apps/daemon/src/modules.test.ts`,
  `apps/daemon/src/runs/errors.ts`, `apps/daemon/src/app.ts` (`API_PREFIX`)
- `apps/app/src/app/features/sessions/**` (the feature you extend),
  `apps/app/src/app/features/works/works.api.ts` (the per-feature `toApiError` pattern),
  `apps/app/src/app/core/api/{http.ts,api-client.ts}`

## 🔒 Contract

### 1. `packages/contracts/src/design.ts` — the wire projection (new file)

`docs/api.md` §5.2, D52. Zod only, no I/O, no clock, no environment; every schema is a
`strictObject`, so an unknown key is a 422 at the boundary and never a silent default.

```ts
import { z } from 'zod';
import { parseOrThrow } from './parse.js';
import { RepoId, commitShaSchema, timestampSchema } from './primitives.js';

/** The four rules of `docs/jobs.md` §5, by name, exactly as `@codebox/design` spells them. */
export const DESIGN_RULES = [
  'colour_outside_tokens',
  'route_without_component',
  'screen_state_missing',
  'snapshot_hash_mismatch',
] as const;
export const designRuleSchema = z.enum(DESIGN_RULES);
export type DesignRule = z.infer<typeof designRuleSchema>;

export const designTokenViewSchema = z.strictObject({
  name: z.string().min(1), // the dot path, `color.brand.green`
  type: z.string().min(1), // the DTCG `$type`
  value: z.string(), // `String($value)`, already resolved
});
export type DesignTokenView = z.infer<typeof designTokenViewSchema>;

export const designRouteViewSchema = z.strictObject({
  path: z.string().min(1),
  screen: z.string().min(1),
  component: z.string(), // '' when the route names none: data, not a parse error
});
export type DesignRouteView = z.infer<typeof designRouteViewSchema>;

export const designStatesSchema = z.strictObject({
  loading: z.string().nullable(),
  empty: z.string().nullable(),
  error: z.string().nullable(),
});
export type DesignStates = z.infer<typeof designStatesSchema>;

export const designScreenViewSchema = z.strictObject({
  screen: z.string().min(1),
  route: z.string().min(1),
  states: designStatesSchema,
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
});
export type DesignScreenView = z.infer<typeof designScreenViewSchema>;

export const designFindingViewSchema = z.strictObject({
  file: z.string().min(1), // repo-relative, forward slashes
  line: z.number().int().positive(),
  rule: designRuleSchema,
  message: z.string().min(1),
});
export type DesignFindingView = z.infer<typeof designFindingViewSchema>;

export const designPreviewSchema = z.strictObject({
  repoId: RepoId,
  revision: commitShaSchema,
  present: z.boolean(), // `design/tokens.json` exists at `revision`
  tokens: z.array(designTokenViewSchema),
  routes: z.array(designRouteViewSchema),
  screens: z.array(designScreenViewSchema),
  findings: z.array(designFindingViewSchema),
  checkedAt: timestampSchema,
});
export type DesignPreview = z.infer<typeof designPreviewSchema>;

export function parseDesignPreview(input: unknown): DesignPreview;
```

The `*View` names are deliberate: `@codebox/design` already exports `DesignFinding`,
`DesignRoute` and `ScreenSpec`, and the daemon imports both packages — the wire names must not
collide with the parser's.

Export all of it from `packages/contracts/src/index.ts`: a new grouped block after the
"Works, backlog, sessions…" block, with a comment `// Design preview: docs/api.md §5.2, D52.`
Values exported by name: `DESIGN_RULES`, `designRuleSchema`, `designTokenViewSchema`,
`designRouteViewSchema`, `designStatesSchema`, `designScreenViewSchema`,
`designFindingViewSchema`, `designPreviewSchema`, `parseDesignPreview`. Types:
`DesignRule`, `DesignTokenView`, `DesignRouteView`, `DesignStates`, `DesignScreenView`,
`DesignFindingView`, `DesignPreview`. Nothing else in `index.ts` moves.

`design.test.ts`: one complete fixture parses and round-trips; refusals for — a missing
`revision`, a `revision` that is not 7–40 lowercase hex, an unknown `rule`, `line: 0`, a
`snapshotSha256` that is not 64 lowercase hex, an unknown key on `designPreviewSchema`, and a
`repoId` without the `repo_` prefix. Assert `ContractParseError` (or `safeParse().success ===
false`), never a thrown `Error` of another class.

### 2. `packages/contracts/src/openapi.ts` and `openapi.test.ts`

- `ROUTES`: one new entry, inserted between `getRepoBacklog` and `verifyRepo`
  (`OPENAPI_PATHS` sorts, so the position is for the reader):

```ts
{
  path: '/v1/repos/{id}/design',
  method: 'get',
  operationId: 'getRepoDesign',
  summary: 'The design/ directory at a commit: tokens, routes, declared states and the check.',
  tag: 'repos',
  status: '200',
  response: 'DesignPreview',
},
```

- `componentSchemas`: add `DesignPreview: designPreviewSchema` and import the schema from
  `./design.js`.
- `openapi.test.ts`: the route count in `it('docs/api.md routes match the OpenAPI paths')`
  moves from **62** to **63**; add `'DesignPreview'` to `requiredComponents`. Nothing else in
  that file changes.

### 3. Daemon — `apps/daemon/src/design/` (new subsystem, appended to `SUBSYSTEMS`)

**`preview.ts` — pure: no clock, no git, no fs.** It turns the raw document texts into the
contract object.

```ts
import type { DesignPreview } from '@codebox/contracts';

export interface DesignSource {
  readonly tokens: string | null; // raw JSON text; null when design/tokens.json is absent
  readonly routes: string | null; // raw JSON text; null when design/routes.json is absent
  readonly screens: readonly { readonly file: string; readonly text: string }[];
}

export interface DesignPreviewInput {
  readonly repoId: string;
  readonly revision: string;
  readonly checkedAt: string;
  readonly source: DesignSource;
}

/** A document that exists at the commit and does not parse. The route maps it to 422. */
export class DesignPreviewError extends Error {
  readonly file: string;
  constructor(file: string, message: string); // name = 'DesignPreviewError'
}

export function buildDesignPreview(input: DesignPreviewInput): DesignPreview;
```

Rules, frozen:

- `source.tokens === null` → `present: false` and **four empty arrays**; `routes` and `screens`
  are not read (a repository with no token document has no design to preview, which is exactly
  how the gate decides to skip).
- Otherwise `present: true`. Parse with `parseTokens`, `parseRoutes`, `parseScreenSpec` after
  `JSON.parse`; a `JSON.parse` failure or a `DesignDocumentError` becomes
  `DesignPreviewError(file, message)` where `file` is `design/tokens.json`,
  `design/routes.json` or the screen's path and `message` is `'document is not valid JSON'` or
  the first issue's `message`.
- Tokens: one `{ name, type, value }` per token, `name` = the flat dot path, `value` =
  `String(token.$value)`, sorted by `name` ascending.
- Routes: `{ path, screen, component }` passed through, sorted by `path` ascending.
- Screens: `{ screen, route, states, snapshotSha256 }` passed through, sorted by `screen`
  ascending.
- Findings: `checkDocuments({ tokens, routes, screens })` mapped to `{ file, line, rule,
  message }` in the order it returns them (already sorted by file then line). The preview
  **never** evaluates `snapshot_hash_mismatch`: that rule needs the PNG bytes and belongs to
  the gate. A declared `snapshotSha256` is echoed as data, never claimed as matched.

**`service.ts` — the read.** It mirrors `createBacklogService` and `createBacklogRuntime`.

```ts
export interface DesignSnapshot {
  readonly revision: string;
  readonly source: DesignSource;
}

export interface DesignRuntime {
  /** `design/` at `revision` (null = the default branch head) in the repository's bare clone. */
  readDesign(repo: Repo, revision: string | null): Promise<DesignSnapshot>;
}

export interface DesignRuntimeOptions {
  readonly git: GitRunner;
  readonly repoRoot: string;
  readonly timeoutMs: number;
  readonly ensureClone?: (repo: Repo) => Promise<void>;
}
export function createDesignRuntime(options: DesignRuntimeOptions): DesignRuntime;

/** The clone does not know the commit: the route answers 422 `revision_unknown`. */
export class DesignRevisionError extends Error {
  readonly revision: string;
  constructor(revision: string); // name = 'DesignRevisionError'
}
/** A git command failed for another reason: the route answers 503 `workspace_unavailable`. */
export class DesignReadError extends Error {
  readonly command: string; // the git subcommand, or 'fetch' when the clone could not refresh
  readonly code: number; // the git exit code, or 0 when the failure carried none
  constructor(command: string, code: number); // name = 'DesignReadError'
}

export interface DesignService {
  preview(repo: Repo, revision: string | null): Promise<DesignPreview>;
}

export interface CreateDesignServiceOptions {
  readonly context: DaemonContext;
  readonly runtime?: DesignRuntime;
  readonly git?: GitRunner;
}
export function createDesignService(options: CreateDesignServiceOptions): DesignService;
/** One service per daemon process, the way `backlogService(context)` is. */
export function designService(context: DaemonContext): DesignService;
```

Runtime behaviour, all commands in `clonePath(repoRoot, repo.slug)` with `GIT_ENV` and
`timeoutMs` (copy `createBacklogRuntime` line for line):

1. `await options.ensureClone?.(repo)` when it is given — `ensureClone` fetches an existing cache
   (`packages/workspaces/src/clone.ts`), so the default branch head is fresh on every read, the
   same way `GET /v1/repos/{id}/backlog` refreshes it. A throw from it becomes
   `DesignReadError('fetch', 0)` (the clone is unusable, not the request).
2. Revision: `revision === null` → `rev-parse refs/heads/<repo.defaultBranch>`; a non-zero exit
   or an empty stdout → `DesignReadError('rev-parse', code)`. `revision !== null` →
   `rev-parse --verify <revision>^{commit}`; a non-zero exit → `DesignRevisionError(revision)`;
   otherwise the resolved sha (so a 7-character sha works) is the revision the rest reads at.
3. `show <sha>:design/tokens.json`; `show <sha>:design/routes.json`. Exit 0 → the text. A
   non-zero exit whose `stderr` contains `does not exist` or `exists on disk, but not in` →
   `null`. Any other non-zero exit → `DesignReadError('show', code)`.
4. `ls-tree --name-only -r <sha> -- design/screens`; the same "absent" rule turns a missing
   directory into no screens; keep the paths ending `.json`, sorted; `show <sha>:<path>` each.
   A path whose `show` reports "does not exist" is skipped; any other failure →
   `DesignReadError('show', code)`. There is no size cap: the repository is the operator's.

`createDesignService` wires the default runtime exactly as `createBacklogService` wires its
own (`createGitRunner()`, `config.CB_REPO_ROOT`, `config.CB_GIT_HTTP_TIMEOUT_SECONDS * 1000`,
`ensureClone` through `createDaemonWorkspaces(context)` and
`https://github.com/<slug>.git`). `preview(repo, revision)` calls `runtime.readDesign` and then
`buildDesignPreview({ repoId: repo.id, revision: snapshot.revision, checkedAt:
context.clock().toISOString(), source: snapshot.source })`. It writes nothing and appends no
event (the `design.changed` event exists in the contract and has no writer; this task does not
become one).

**`routes.ts` — the HTTP surface. `docs/api.md` §5.2.**

```ts
export function registerDesignRoutes(app: DaemonApp, service: DesignService, store: Store): void;
```

`GET ${API_PREFIX}/repos/:id/design`, in this order:

| condition                                        | answer                                                                 | log |
| ------------------------------------------------ | ---------------------------------------------------------------------- | --- |
| `:id` is not a `repo_` id                        | `422 validation_failed`, `details.path = "repo.id"`                    | — |
| `revision` present but not 7–40 lowercase hex    | `422 validation_failed`, `details.path = "design.revision"`            | — |
| `revision` repeated in the query                 | `422 validation_failed`, `details.path = "design.revision"`            | — |
| unknown repository                               | `404 not_found`, `details.path = "repo.id"`                            | — |
| the clone does not know the revision             | `422 validation_failed`, `details = { path: "design.revision", reason: "revision_unknown" }` | `warn design_preview_revision_unknown` with `repoId`, `revision` |
| a document at the revision does not parse        | `422 validation_failed`, `details = { path: "design.document", file, reason: "invalid_document" }` | `warn design_preview_invalid` with `repoId`, `revision`, `file` |
| git or the clone failed                          | `503 agent_unavailable`, `details.reason = "workspace_unavailable"`     | `warn design_preview_failed` with `repoId`, `revision`, `command`, `code` |
| otherwise                                        | `200` the `DesignPreview`, parsed through `parseDesignPreview`          | — |

No file contents, no token values and no paths outside `design/` are ever logged. The query is
parsed with `parseOrThrow(z.strictObject({ revision: commitShaSchema.optional() }),
queryInput(c, 'design'), 'design')`, so both a malformed sha and a repeated key answer
`details.path = "design.revision"`. The route uses `handle(c, 'design', …)` and `json(c, …)` from
`apps/daemon/src/runs/errors.ts`; a malformed body is impossible (no body), and no auth code is
added: the middleware already requires the `read` scope on every `GET`.

**`index.ts`:**

```ts
export function createModule(context: DaemonContext): DaemonModule;
```

It builds `designService(context)` and registers the routes with `context.store`, exactly like
`backlog/index.ts`, and re-exports the module's surface. No timer, no shutdown hook, no
migration, no table.

### 4. `apps/daemon/src/modules.ts` and `modules.test.ts`

Append `'design'` to the `SubsystemName` union, to the end of `SUBSYSTEMS` and to
`DEFAULT_SUBSYSTEM_FLAGS` (`design: true`). **`apps/daemon/src/main.ts` does not move** — the
loader imports `./design/index.js` by name. In `modules.test.ts`: the pinned list becomes the
sixteen names in order, the slice assertion becomes
`SUBSYSTEMS.slice(12)` → `['works', 'backlog', 'sessions', 'design']`, and both hand-written
flag literals (`only()` and the "imports nothing when every flag is off" case) gain
`design: false`. The test title `lists the fifteen subsystems in order, append-only` becomes
`lists the sixteen subsystems in order, append-only`.

### 5. `docs/api.md` §5.2 (one row, one paragraph, one JSON block)

Add this row as the last row of the §5.2 table:

```
| `GET` | `/v1/repos/{id}/design?revision=` | `read` | `design/` at a commit: tokens, routes, declared states and the check's findings (D52). |
```

Then, after the repository JSON object and before `### 5.3`, add:

```
`GET /v1/repos/{id}/design` reads the repository's `design/` at `revision`, or at the default
branch head when the query is absent. `present` is false when `design/tokens.json` is not at
that commit, and then the four collections are empty — a repository without a design says so
instead of guessing. `tokens` are the flat DTCG paths with their resolved value, `routes` and
`screens` are the documents' own rows, and each screen carries the three states it declares
(`loading`, `empty`, `error`, `null` when it declines one). `findings` are `@codebox/design`'s
`checkDocuments` answers — a colour outside the tokens, a route without a component, a screen
state missing — and never a pixel comparison: `snapshot_hash_mismatch` needs the exported PNG
and stays the gate's rule (`docs/jobs.md` §5), so a declared `snapshotSha256` is echoed as data
and not as a verdict. A commit the clone does not know is `422` with
`details.reason = "revision_unknown"`; a repository with no usable clone is `503`
`agent_unavailable` with `details.reason = "workspace_unavailable"`. The route writes nothing
and emits no event.
```

and a `designPreviewSchema` JSON example (use real values from `packages/design/src/fixtures/`):

```json
{
  "repoId": "repo_01J...",
  "revision": "9f1c2ab",
  "present": true,
  "tokens": [
    { "name": "color.brand.bright", "type": "color", "value": "#22c55e" },
    { "name": "space.gap", "type": "dimension", "value": "8" }
  ],
  "routes": [
    { "path": "/repos/:id", "screen": "Repo · backlog", "component": "RepoBacklogPage" }
  ],
  "screens": [
    {
      "screen": "Repo · backlog",
      "route": "/repos/:id",
      "states": {
        "loading": "Rows grey until the file parses",
        "empty": "Empty file, one chat button",
        "error": "Envelope over the list"
      },
      "snapshotSha256": null
    }
  ],
  "findings": [],
  "checkedAt": "2026-10-29T10:00:00Z"
}
```

### 6. `docs/app.md` §8 — the **Session** block only

Insert two bullets into the list under `**Session** is the editor (D55):`, after the target
bullet and before the proposal bullet:

```
- a `design` session renders the repository's preview **above the thread**: `design/` at the
  pending proposal's commit, or at the default branch head when nothing is pending, with its
  tokens, its routes, each screen's three declared states and the findings of the
  tokens/routes/states check (D52). It is the repository's spec, never a canvas; a repository
  with no `design/` says so, and a pending change names the commit it will land;
- the preview refetches when that commit changes and never draws a state the file does not
  declare;
```

Do not touch the *Work* block, the paragraph after it, the `Streaming text is appended…`
paragraph, or any other section of the file.

### 7. App — `features/sessions/**`

**`sessions.api.ts`** — one method, same shape as the rest of the class:

```ts
designPreview(repoId: string, revision: string | null): Observable<DesignPreview> {
  const params = this.query({ revision: revision ?? undefined });
  return this.request(
    this.http.get<unknown>(this.url(`/repos/${repoId}/design`), { params }),
    parseDesignPreview,
  );
}
```

No new file, no second `toApiError`: the class's existing `request`, `url`, `query` and
`toApiError` are reused. `sessions.api.spec.ts` gains one case: the URL is
`/v1/repos/<id>/design` with `revision` when given and without it when `null`, the body parses
through `parseDesignPreview`, and a malformed body becomes `ApiError` with `code: 'contract'`.

**`design-preview.card.ts`** — the card, standalone, presentational plus one GET:

```ts
export type ScreenStateKind = 'loading' | 'empty' | 'error';
export const SCREEN_STATE_KINDS: readonly ScreenStateKind[] = Object.freeze([
  'loading',
  'empty',
  'error',
]);
export interface DeclaredState {
  readonly kind: ScreenStateKind;
  readonly caption: string | null;
}
/** Exactly three, in SCREEN_STATE_KINDS order; `null` when the screen declines the state. */
export function declaredStates(screen: DesignScreenView): readonly DeclaredState[];

@Component({
  selector: 'app-design-preview-card',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DesignPreviewCard {
  readonly repoId = input.required<string>();
  readonly revision = input<string | null>(null);
  readonly preview = signal<DesignPreview | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly pending = computed(() => this.revision() !== null);
  reload(): void;
  readonly t: (key: string) => string; // I18nService + translate from './i18n'
  statesOf(screen: DesignScreenView): readonly DeclaredState[]; // → declaredStates(screen)
}
```

It loads from an `effect` on `repoId()` **and** `revision()` (both read untracked inside),
through `inject(SessionsApi).designPreview(repoId, revision)`. `revision` changing is the whole
update story: the page passes `session.pendingProposal?.sha ?? null`, so a proposal makes the
card read the proposal's commit and a merge clears it and the card reads the branch head again.

Hooks, exact:

| `data-testid`                | element                            | attributes |
| ---------------------------- | ---------------------------------- | ---------- |
| `design-preview`             | the root `<section>`               | `data-revision` (the loaded preview's `revision`, `''` while loading), `data-present` (`'true'`/`'false'`, `''` while loading) |
| `design-preview-loading`     | while `loading()`                  | — |
| `design-preview-error`       | on `error()`                       | `data-code` |
| `design-preview-retry`       | `<button>` inside the error block  | calls `reload()` |
| `design-preview-revision`    | the commit line                    | `data-sha`; text is the revision in `cb-mono` |
| `design-preview-pending`     | only when `pending()`              | — |
| `design-preview-unavailable` | only when `present === false`      | — |
| `design-preview-count`       | one per collection                 | `data-kind` = `tokens` / `routes` / `screens` |
| `design-preview-token`       | one per token                      | `data-name` |
| `design-preview-route`       | one per route                      | `data-path`, `data-component` |
| `design-preview-screen`      | one per screen                     | `data-screen`, `data-route` |
| `design-preview-state`       | three per screen                   | `data-state` = `loading` / `empty` / `error`, `data-declared` = `'true'`/`'false'` |
| `design-preview-finding`     | one per finding                    | `data-rule`, `data-file`, `data-line` |
| `design-preview-clean`       | only when `present` and no finding | — |

While `present === false` the token/route/screen/finding blocks are not rendered at all — only
the revision line and the unavailable block. The card is not a canvas: no image, no iframe, no
colour swatch rendered from a token value.

**`session.page.ts`** — one block, above the thread and below the header, inside the existing
`@if (store.session(); as session)`:

```html
@if (session.target === 'design') {
  <app-design-preview-card
    [repoId]="session.repoId"
    [revision]="session.pendingProposal?.sha ?? null"
  />
}
```

and `DesignPreviewCard` in the component's `imports`. Nothing else in the page moves: the
thread, the tool cards, the proposal panel, the composer and their hooks stay byte-identical.

**`i18n.ts`** — add these keys, same order, both locales:

| key                          | en                                                | es |
| ---------------------------- | ------------------------------------------------- | -- |
| `session.preview.title`      | `Design preview`                                  | `Vista previa del diseño` |
| `session.preview.loading`    | `Loading the design preview…`                     | `Cargando la vista previa del diseño…` |
| `session.preview.error`      | `The design preview could not be loaded.`         | `No se ha podido cargar la vista previa del diseño.` |
| `session.preview.retry`      | `Retry`                                           | `Reintentar` |
| `session.preview.revision`   | `At commit`                                       | `En el commit` |
| `session.preview.pending`    | `Pending: this commit is not on the default branch yet.` | `Pendiente: este commit todavía no está en la rama por defecto.` |
| `session.preview.unavailable`| `This repository has no design/ at this commit. Nothing is shown rather than a guess.` | `Este repositorio no tiene design/ en este commit. No se muestra nada en lugar de una suposición.` |
| `session.preview.tokens`     | `Tokens`                                          | `Tokens` |
| `session.preview.routes`     | `Routes`                                          | `Rutas` |
| `session.preview.screens`    | `Screens`                                         | `Pantallas` |
| `session.preview.undeclared` | `not declared`                                    | `sin declarar` |
| `session.preview.clean`      | `The tokens, routes and states check passes.`     | `La comprobación de tokens, rutas y estados pasa.` |

`session.page.spec.ts`: the mount helper flushes
`GET /v1/repos/<repoId>/design` for a `design` session (the fixture `SESSION` already is one),
and the `repo`-target case asserts `http.expectNone(DESIGN_URL)` — the card is a design-session
card and nothing else. Add one case: after the preview is loaded, flushing a second session
response whose `pendingProposal` is `PROPOSAL` makes the card request
`/v1/repos/<repoId>/design?revision=9f1c2ab` and render `design-preview-pending`.

**`apps/app/README.md`** — your block only: the `src/app/features/sessions/**` lines. Add
`design-preview.card.ts` and `design-preview.card.spec.ts`, and update the `sessions.api.ts`,
`sessions.api.spec.ts`, `session.page.ts`, `session.page.spec.ts` and `i18n.ts` lines where the
sentence is now false. Do **not** touch any `src/app/features/works/**` line or anything else:
Task-77 owns those in the same batch.

### 8. The two `README.md` file maps

- `packages/contracts/README.md`: in the `## src/` list, add one line for `design.ts` (the §5.2
  design preview schema and its `parseDesignPreview`) and one for `design.test.ts` (the fixture
  and each refused shape), after the `works.ts` line.
- `apps/daemon/README.md`: in the `## Files` list, add one line per new file —
  `src/design/index.ts`, `src/design/service.ts`, `src/design/preview.ts`,
  `src/design/routes.ts` and their three tests — after the `src/integrations/storage.test.ts`
  line. Do **not** fill the gaps the existing list already has (several subsystems are missing
  from it): that is a different task.

## 🧩 Configuration

No new `CB_*` key. The runtime reads the keys the backlog already reads
(`CB_REPO_ROOT`, `CB_GIT_HTTP_TIMEOUT_SECONDS`) through `DaemonContext.config`; no default and
no doc line changes. No new dependency: `@codebox/design`, `@codebox/workspaces`,
`@codebox/contracts` and `zod` are already in `apps/daemon/package.json`. If you think you need
a package, stop.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim, in the worktree `../wt-cb-79` (branch `task-79`, base `main`).

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — the workspace coverage guard, the app unit suite (`ng test`, jsdom) and the
    package/daemon Vitest projects. Do **not** run `npm run test:app` again beside it.
  - `npm run build` — `tsc -b` plus the app build.
  - `git diff --name-only main...task-79` — audit against the exclusive paths.
  - `git diff --stat main...task-79 -- apps/app/src/app/features/works apps/app/src/app/app.routes.ts apps/app/src/app/app.routes.spec.ts apps/app/src/app/features/repos` — must be empty.
- **Deliverable from the dev:** the work committed on `task-79` with an imperative subject of at
  most 72 characters, then one **empty** marker commit and a push:
  `git commit --allow-empty -m "dev: done task-79" && git push -u origin task-79`. The branch tip
  is the turnstile; QA merges the branch onto the batch base from it.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean (`npm run lint && npm run build`).
  - [ ] `[unit]` The declared tests exist and pass: `npm test`.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched: the `git diff --name-only`
        list is a subset of the 26 paths above.
  - [ ] `[unit]` **The contract and the docs name the same routes.**
        `npx vitest run --project packages/contracts -t 'docs/api.md routes match the OpenAPI paths'`
        passes with **63** paths and `grep -c 'v1/repos/{id}/design?revision=' docs/api.md`
        prints `1`.
  - [ ] `[unit]` **The card renders a commit and a state list from `design/`.**
        `npm test` runs the app suite, whose `design-preview.card.spec.ts` mounts the card
        with a fixture (`revision: '9f1c2ab'`, one screen with
        `states: { loading: '22', empty: null, error: '22b' }`) and asserts
        `[data-testid="design-preview-revision"]` has `data-sha="9f1c2ab"`, and that the screen
        row renders exactly three `[data-testid="design-preview-state"]` with
        `data-state` = `loading`/`empty`/`error` and `data-declared` = `true`/`false`/`true`.
  - [ ] `[unit]` **A pending change is visible.** `design-preview.card.spec.ts` asserts
        `[data-testid="design-preview-pending"]` exists when `revision` is `'9f1c2ab'` and does
        not exist when it is `null`; `session.page.spec.ts` asserts the card is asked for
        `/v1/repos/<repoId>/design?revision=<proposal sha>` once the session carries a proposal.
  - [ ] `[unit]` **The four teardown states are honest.** The same spec asserts: `present:
        false` renders `design-preview-unavailable` and none of
        `design-preview-token`/`-route`/`-screen`/`-finding`; a 422 body
        (`{ error: { code: 'validation_failed', message: 'Invalid request' } }`) renders
        `design-preview-error[data-code="validation_failed"]` and
        `design-preview-retry` refetches the same URL; a clean response renders
        `design-preview-clean`.
  - [ ] `[unit]` **The daemon route table is right.**
        `npx vitest run --project apps/daemon -t 'design'` passes `routes.test.ts`: 200 with a
        `parseDesignPreview`-valid body for a stubbed runtime; `404` for an unknown repo;
        `422` `{path:'design.revision', reason:'revision_unknown'}` for an unresolvable
        revision; `422` for a `revision` that is not a sha; `503` `agent_unavailable` with
        `reason: 'workspace_unavailable'` when the runtime raises `DesignReadError`; `401`
        without a token. `preview.test.ts` covers `present: false`, the three sortings and a
        `DesignPreviewError` for a document that does not parse; `service.test.ts` covers the
        `rev-parse` resolution, the "does not exist" → absent rule for both `show` and
        `ls-tree`, and each of the two error classes with a stub `GitRunner`.
  - [ ] `[unit]` **The daemon boots with the sixteenth subsystem.**
        `npx vitest run --project apps/daemon -t 'subsystems'` passes, and
        `grep -c "design" apps/daemon/src/modules.ts` prints at least `3`.
  - [ ] `[unit]` **The README file map holds.** `npm test` passes `readme.spec.ts`.
  - [ ] `[live]` **A chat edit moves the preview.** Measurement, on the box, after the merge:
        open `/sessions/<id>` for a `design` session, read
        `[data-testid="design-preview-revision"]`'s `data-sha`, ask the agent for one token
        change, wait for the proposal panel, and assert the same attribute now equals the
        proposal's `sha`, `design-preview-pending` appeared, and the screen the agent touched
        lists its new caption. **This runner has no browser and no display.** QA must report
        this criterion as **not-run** — never as passing — and open one issue:
        `node scripts/agent/issue.mjs --label agent-review --title "Task-79 [live]: a chat edit moves the design preview" --body "<what was not measured, on which device, and the assertion above>"`.
  - [ ] `[live]` **The preview reads a real clone.** Measurement, on the box: `curl -s -H
        "Authorization: Bearer $CB_TOKEN" "$CB_URL/v1/repos/<id>/design" | jq '.revision,
        .present, (.screens|length), (.findings|length)'` against this repository, whose
        `design/` has a `README.md` but no `tokens.json` yet — the expected answer is
        `present: false` and three empty collections, never an error. **Not measurable on this
        runner** (no daemon, no clone): report **not-run** and append it to the same issue.

## 📣 Coordination

- **For the Architect:** the item's `*Paths:*` line listed `packages/design/**` and
  `design/README.md`, and neither needs a change. The projection is built over the package's
  existing `parseTokens`/`parseRoutes`/`parseScreenSpec`/`checkDocuments`, so no new pure rule
  lands there; `design/README.md` §1 already maps `/repos/:id/workers` (Task-77 lands it) and §7
  already states the preview rule, and this task adds no app route — the card lives inside
  `/sessions/:id`. The daemon surface is new and unavoidable: `packages/contracts/src/design.ts`,
  `index.ts`, `openapi.ts`, `openapi.test.ts`, the `design` subsystem and `docs/api.md` §5.2.
  The `design` subsystem is the **sixteenth** `SubsystemName`, appended last; `main.ts` did not
  move and no migration was needed.
- **For Task-78 (wave 2, after this task):** `packages/contracts/src/index.ts` is free again.
  The `design` block is a separate group at the end of the file; add the backlog `needs` field
  without touching it. `packages/contracts/src/openapi.test.ts` now pins **63** paths —
  `needs` is a field, not a route, so the count does not change for Task-78.
- **For the next batch:** `features/repos/repo-design.page.ts` still renders its honest
  unavailable block with the copy `repoDesign.unavailable.*` ("the daemon answers no route for
  design/ artifacts yet"), which is now false: the route exists. `repo-chrome.i18n.ts` belongs
  to Task-77's footprint this batch, so the copy is corrected in a later task that wires
  `/repos/:id/design` to `SessionsApi.designPreview` — the contract, the route and the client
  method are ready for it. The same later task can render the card in the work screen's design
  sheet (`docs/app.md` §8, first block).
- **For QA reading this batch:** the `design.changed` SSE event exists in
  `packages/contracts/src/primitives.ts` and has **no writer**. This task does not emit it and
  the card does not wait for it; its only update trigger is the `revision` input.

## ⛔ Out of scope

- No canvas, no iframe, no image, no pixel comparison, no screenshot diff (D52).
- No `snapshot_hash_mismatch` evaluation: the exported PNG is the gate's business.
- No write path: no `POST`/`PATCH`, no `design.changed` emission, no table, no migration.
- No session route change: `/sessions/:id` keeps its path, its target header, its thread, its
  proposal panel and its composer.
- No edit to `features/repos/**`, `features/works/**`, `app.routes.ts`,
  `app.routes.spec.ts`, `apps/daemon/src/main.ts`, `apps/daemon/src/gate/**` or
  `packages/design/**`.
- No new npm dependency, no new `CB_*` key, no change to `package.json` or the lockfile.
- No change to `docs/decisions.md`, `CHANGELOG.md` or any TODO box: the Orchestrator owns the
  tick at merge time.

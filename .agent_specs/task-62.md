# Spec: Task-62 — Credentials screens

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (Angular + Ionic), with one docs row.
- **Role:** Dev.
- **Objective:** A guarded `/settings/credentials` screen ships the credential catalog
  (connected services plus open credentials), a connect-a-service sheet (GitHub App manifest
  and a generic integration) and an add-credential sheet with the three `expose` modes, a
  mandatory confirm step, an `env` warning, and no value or prefix longer than four characters
  anywhere on screen.
- **Environment:** worktree `../wt-cb-62`, branch `task-62`, base `main` (`1ff4d80`).
- **Dependencies:** **Task-58** (merged) — `apps/daemon/src/credentials/**` and
  `apps/daemon/src/integrations/**` own the wire shapes; `docs/api.md` §5.9 documents them;
  **Task-55** (merged) — the frozen route table and `authGuard` in
  `apps/app/src/app/app.routes.ts`.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/app/features/credentials/credentials.api.ts`
- `apps/app/src/app/features/credentials/credentials.api.spec.ts`
- `apps/app/src/app/features/credentials/credentials.store.ts`
- `apps/app/src/app/features/credentials/credentials.store.spec.ts`
- `apps/app/src/app/features/credentials/credentials.page.ts`
- `apps/app/src/app/features/credentials/credentials.page.spec.ts`
- `apps/app/src/app/features/credentials/add-credential.sheet.ts`
- `apps/app/src/app/features/credentials/add-credential.sheet.spec.ts`
- `apps/app/src/app/features/credentials/connect-service.sheet.ts`
- `apps/app/src/app/features/credentials/connect-service.sheet.spec.ts`
- `apps/app/src/app/features/credentials/i18n.ts`
- `apps/app/src/app/app.routes.ts` (**the only hot file this task holds**)
- `apps/app/src/app/app.routes.spec.ts`
- `apps/app/README.md` (one line per new file — `readme.spec.ts` fails otherwise)
- `docs/app.md` — **§4, the `/settings/credentials` table row only** (no other section, no
  other row)

Task-69 owns `docs/app.md`'s About row **inside §4**, but in this batch Task-69 edits no part
of `docs/app.md`; if a diff shows Task-69 touching it, that is a conflict to report.

### Inputs (read-only)

- `AGENTS.md`, `docs/agent-spec-template.md`
- `docs/api.md` §3 (errors), §5.9 (credentials and integrations — the wire contract)
- `docs/app.md` §4 (screens), §9 (dictionaries beside the feature)
- `apps/daemon/src/credentials/schemas.ts`, `apps/daemon/src/credentials/routes.ts`
- `apps/daemon/src/integrations/routes.ts`, `apps/daemon/src/integrations/service.ts`
  (`GithubManifestStart`, `GithubManifestComplete` shapes)
- `packages/contracts/src/errors.ts`, `packages/contracts/src/parse.ts` (`ContractParseError`)
- `apps/app/src/app/core/api/api-client.ts` (`ApiError`), `.../core/api/http.ts`
- `apps/app/src/app/features/chat/chat.api.ts` (the feature-API pattern)
- `apps/app/src/app/features/settings/devices.page.ts` and `.spec.ts` (page + mount pattern)
- `apps/app/src/app/core/auth/auth.guard.ts`

## 🔒 Contract

### 1. Wire shapes (verbatim from the daemon; do not invent a field)

`GET /v1/credentials` → `200` `{ data: Credential[], nextCursor: string | null }`:

```ts
interface Credential {
  id: string;
  name: string;
  kind: 'api_key' | 'bearer' | 'basic' | 'github_app' | 'model_key';
  expose: 'daemon' | 'tool' | 'env';
  configured: boolean;
  lastFour: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}
```

`POST /v1/credentials` body `{ name, kind, expose, value }` → `201 Credential`.
`DELETE /v1/credentials/{id}` → `204` (no body).

`GET /v1/integrations` → `200` `{ data: Integration[], nextCursor: string | null }`:

```ts
interface Integration {
  id: string;
  name: string;
  baseUrl: string;
  auth: 'none' | 'bearer' | 'header' | 'basic';
  headerName: string | null;
  credentialId: string | null;
  allowedHosts: string[];
  createdAt: string;
  updatedAt: string;
}
```

`POST /v1/integrations` body
`{ name, baseUrl, auth, headerName?, credentialId?, allowedHosts }` → `201 Integration`.
`POST /v1/integrations/github/manifest` → `200`
`{ action: string, manifest: Record<string, unknown>, state: string }`.
`POST /v1/integrations/github/complete` body `{ code, state }` → `200`
`{ configured: true, appId: number, credentialId: string }`.
A device without `admin` gets `403`; `CB_SECRETS_KEY` absent is `503` with
`details.reason = "secrets_not_configured"`; `422` carries `details.path` / `details.reason`.

There is **no** credential schema in `packages/contracts` (see Coordination): the app cannot
import one and has no `zod` dependency. Parse the payloads by hand in
`credentials.api.ts` with the exact keys above and throw
`new ContractParseError('credential', [{ path, message, code: 'custom' }])` (and
`'integration'`, `'githubManifest'`) on a mismatch. **No `any`**, no extra field, no renamed
key.

### 2. `credentials.api.ts`

```ts
export const CREDENTIAL_KINDS = ['api_key', 'bearer', 'basic', 'github_app', 'model_key'] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];
export const CREDENTIAL_EXPOSES = ['daemon', 'tool', 'env'] as const;
export type CredentialExpose = (typeof CREDENTIAL_EXPOSES)[number];
export const INTEGRATION_AUTHS = ['none', 'bearer', 'header', 'basic'] as const;
export type IntegrationAuth = (typeof INTEGRATION_AUTHS)[number];

export interface Credential { /* §1 */ }
export interface Integration { /* §1 */ }
export interface CredentialPage { readonly data: readonly Credential[]; readonly nextCursor: string | null; }
export interface IntegrationPage { readonly data: readonly Integration[]; readonly nextCursor: string | null; }
export interface CreateCredentialBody {
  readonly name: string;
  readonly kind: CredentialKind;
  readonly expose: CredentialExpose;
  readonly value: string;
}
export interface CreateIntegrationBody {
  readonly name: string;
  readonly baseUrl: string;
  readonly auth: IntegrationAuth;
  readonly headerName?: string;
  readonly credentialId?: string;
  readonly allowedHosts: readonly string[];
}
export interface GithubManifestStart {
  readonly action: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly state: string;
}
export interface GithubManifestComplete {
  readonly configured: true;
  readonly appId: number;
  readonly credentialId: string;
}

export function parseCredential(input: unknown): Credential;
export function parseCredentialPage(input: unknown): CredentialPage;
export function parseIntegration(input: unknown): Integration;
export function parseIntegrationPage(input: unknown): IntegrationPage;
export function parseGithubManifestStart(input: unknown): GithubManifestStart;
export function parseGithubManifestComplete(input: unknown): GithubManifestComplete;

@Injectable({ providedIn: 'root' })
export class CredentialsApi {
  listCredentials(): Observable<CredentialPage>;      // GET  /v1/credentials
  createCredential(body: CreateCredentialBody): Observable<Credential>; // POST /v1/credentials
  removeCredential(id: string): Observable<void>;     // DELETE /v1/credentials/{id}
  listIntegrations(): Observable<IntegrationPage>;    // GET  /v1/integrations
  createIntegration(body: CreateIntegrationBody): Observable<Integration>; // POST /v1/integrations
  removeIntegration(id: string): Observable<void>;    // DELETE /v1/integrations/{id}
  startGithubManifest(): Observable<GithubManifestStart>; // POST /v1/integrations/github/manifest
  completeGithubManifest(code: string, state: string): Observable<GithubManifestComplete>;
}
```

- URLs are `${API_BASE_URL}${API_PREFIX}/credentials` and `.../integrations` — no `HttpClient`
  call outside this file.
- `HttpErrorResponse` is mapped to the existing `ApiError` (same `errorEnvelopeSchema` +
  `details` mapping as `chat.api.ts`); a parse failure surfaces as an `ApiError` with
  `code: 'contract'`, as `ApiClient` does.
- `removeCredential` / `removeIntegration` map a `204` to `void`.

### 3. `credentials.store.ts`

`@Injectable()` (provided by the page), signals only:

```ts
readonly credentials: Signal<readonly Credential[]>;
readonly integrations: Signal<readonly Integration[]>;
readonly loading: Signal<boolean>;
readonly error: Signal<ApiError | null>;
readonly saving: Signal<boolean>;
readonly services: Signal<readonly Integration[]>;      // = integrations
readonly openCredentials: Signal<readonly Credential[]>; // credentials whose kind !== 'github_app'
load(): void;
createCredential(body: CreateCredentialBody): void;      // on success: reload
removeCredential(id: string): void;                      // on success: reload
createIntegration(body: CreateIntegrationBody): void;    // on success: reload
startGithubManifest(): Observable<GithubManifestStart>;  // delegated to the api
completeGithubManifest(code: string, state: string): void; // on success: reload
```

`load()` starts both requests independently (two subscriptions, not `forkJoin`); a success writes
its own signal, a failure sets `error` and **does not** clear the other list; `loading` is
false when both settle. No optimistic insert: a created credential comes back from the server
and the list is reloaded.

### 4. `add-credential.sheet.ts`

Standalone component, rendered inline by the page inside
`<section class="cb-sheet" data-testid="add-credential-sheet">` when open (**not** an Ionic
overlay; tests cannot see overlay portals headlessly).

- Fields: `name` (`data-testid="credential-name"`), `kind`
  (`data-testid="credential-kind"`, options in `CREDENTIAL_KINDS`), `expose`
  (`data-testid="credential-expose"`, options in `CREDENTIAL_EXPOSES`), `value`
  (`data-testid="credential-value"`, `type="password"`, `autocomplete="off"`).
- Two steps, `step: 'form' | 'review'`:
  - form: `data-testid="credential-continue"` validates and moves to review;
    `data-testid="credential-cancel"` closes.
  - review: a summary (`data-testid="credential-review"`) with name, kind, expose and
    `data-testid="credential-review-tail"` showing **only** `value.slice(-4)`;
    `data-testid="credential-save"` (the **only** save control, absent in the form step) emits
    the body; `data-testid="credential-back"` returns to the form.
- Validation (`problem` signal, rendered in `data-testid="credential-problem"`):
  `name` trimmed non-empty and ≤120; `value` non-empty and ≤16384; `expose === 'env'` requires
  `kind === 'model_key'`.
- `env` states: when `expose === 'env'` render `data-testid="credential-env-warning"` with the
  copy “This value enters the model process environment. Use it only for the model key.”;
  when `expose === 'env' && kind !== 'model_key'` also render
  `data-testid="credential-env-blocked"` and disable `credential-continue` / `credential-save`.
  For `daemon` and `tool` the warning and the blocked state are absent.
- On save: emit `saved` with `CreateCredentialBody`, clear `value` and `step`, and keep no
  value in component state after the emission.
- Signal API, matching the app's convention: `readonly saving = input<boolean>(false);`
  `readonly saved = output<CreateCredentialBody>();` `readonly closed = output<void>();`

### 5. `connect-service.sheet.ts`

Standalone component, rendered inline as
`<section class="cb-sheet" data-testid="connect-service-sheet">` when open.

- Two entries: `data-testid="service-github"` (GitHub App) and
  `data-testid="service-integration"` (any other service).
- GitHub: on click call `startGithubManifest()`; on success render
  `data-testid="github-manifest-form"` — a `<form method="post" [action]="start.action">` with
  `<input type="hidden" name="manifest" [value]="manifestJson">` (JSON of `start.manifest`) and
  `<input type="hidden" name="state" [value]="start.state">`. A failure renders
  `data-testid="connect-service-error"` with `data-code`.
- Integration: `data-testid="integration-form"` with `integration-name`,
  `integration-base-url`, `integration-auth` (options in `INTEGRATION_AUTHS`),
  `integration-header` (only when `auth === 'header'`), `integration-credential` (a
  `<select>` of the credentials passed in; required when `auth !== 'none'`, options are
  `credential.id` labelled `credential.name`), `integration-hosts` (newline/comma separated,
  at least one) and `data-testid="integration-save"`.
- Signal API: `readonly credentials = input<readonly Credential[]>([]);`
  `readonly saving = input<boolean>(false);` `readonly created = output<CreateIntegrationBody>();`
  `readonly closed = output<void>();`

### 6. `credentials.page.ts` + the route

- Standalone page, `data-testid="page-credentials"`, injects `CredentialsStore`,
  `CredentialsApi` for the manifest-complete path, `ActivatedRoute`.
- Renders: `credentials-loading`, `credentials-error` (`data-code`, `credentials-retry`),
  `credentials-empty` (both lists empty), `credentials-service-row`
  (`data-service-id`, name, auth), `credentials-open-row` (`data-credential-id`, name, kind,
  expose chip, `credentials-last-four` = `••••` + `lastFour`).
- Actions: `credentials-connect-service` opens the service sheet;
  `credentials-add-open` opens the add sheet. Each open-credential row carries a
  `credential-delete` button that first asks for confirmation (`data-testid="credential-delete-confirm"`,
  labelled from `credentials.deleteConfirm`) and only then calls `removeCredential(id)`.
- On init, if `snapshot.queryParamMap` has both `code` and `state`, call
  `completeGithubManifest(code, state)` once and reload on success; a failure sets the page
  error. Never call it twice for the same pair.
- The page never renders a `value`; the only secret-adjacent string it may render is
  `credential.lastFour` (≤4 characters) and the add sheet's review tail.
- Route, appended to `apps/app/src/app/app.routes.ts` **after** `settings/devices` and
  **before** `about`, without reordering any existing entry:

```ts
{
  path: 'settings/credentials',
  canActivate: [authGuard],
  loadComponent: () =>
    import('./features/credentials/credentials.page').then((module) => module.CredentialsPage),
},
```

- `app.routes.spec.ts`: add `'settings/credentials'` to `EXPECTED_PATHS` after
  `'settings/devices'` and to `UNTABBED_PATHS` (same position); no other table change.

### 7. `i18n.ts`

`STRINGS` with `en` and `es`, identical key sets, `translate(locale, key)`. Required keys:
`credentials.title`, `credentials.loading`, `credentials.empty`, `credentials.error`,
`credentials.retry`, `credentials.section.services`, `credentials.section.open`,
`credentials.action.connectService`, `credentials.action.addOpen`, `credentials.action.delete`,
`credentials.action.confirm`, `credentials.action.cancel`, `credentials.action.continue`,
`credentials.action.back`, `credentials.action.save`, `credentials.lastFour`,
`credentials.kind.api_key` (and `bearer`, `basic`, `github_app`, `model_key`),
`credentials.expose.daemon` (and `tool`, `env`), `credentials.expose.envWarning`,
`credentials.expose.envBlocked`, `credentials.name`, `credentials.value`,
`credentials.deleteConfirm`, `connect.title`, `connect.github`, `connect.integration`,
`connect.manifestHint`, `connect.name`, `connect.baseUrl`, `connect.auth`,
`connect.headerName`, `connect.credential`, `connect.hosts`, `integration.auth.none` (and
`bearer`, `header`, `basic`).

### 8. Docs

`docs/app.md` §4, the `/settings/credentials` row only. Replace its “What it must do” cell
with: “Connected services (GitHub App by manifest, integrations) and open credentials,
write-only; the add sheet has the three `expose` modes, `env` is limited to the model key and
shows its warning, saving passes a confirm step, and a value is only ever shown as its last
four characters.” Leave every other row and section untouched.

## 🧩 Configuration

No `CB_*` key added or read by the app. No new dependency (`zod` stays out of `apps/app`).

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim in `../wt-cb-62` (no `node_modules` in a fresh worktree).

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint`
  - `npm test` (runs the app suite through `test:app`)
  - `npm run build`
  - `git diff --name-only main...task-62`
- **Acceptance criteria:**
  - [ ] `[unit]` Gate green: `npm ci --prefer-offline --no-audit --no-fund && npm run lint && npm test && npm run build`.
  - [ ] `[unit]` `credentials.page.spec.ts` covers loading, error (`data-code`), empty, two catalog sections, both sheet triggers, the two-tap delete, and a session where `GET /v1/credentials` fails but `GET /v1/integrations` succeeds (the integrations list still renders).
  - [ ] `[unit]` `add-credential.sheet.spec.ts`: `credential-save` does not exist in the form step and exists after `credential-continue`; `credential-review-tail` shows exactly the last four characters and `element.textContent` does not contain the full secret; `expose = 'env'` renders `credential-env-warning`, `daemon`/`tool` do not; `env` with `kind !== 'model_key'` renders `credential-env-blocked` and leaves continue/save disabled; the value input is `type="password"` and is cleared after save.
  - [ ] `[unit]` `connect-service.sheet.spec.ts`: `service-github` renders the manifest form with the exact `action`, the JSON `manifest` and the `state`; `service-integration` renders the form, hides `integration-header` unless `auth === 'header'`, and refuses to save with no host or with `auth !== 'none'` and no credential.
  - [ ] `[unit]` `credentials.api.spec.ts`: every URL/method, the six hand parsers accept the documented payloads and reject a missing key with a `ContractParseError` whose `boundary` is `credential` / `integration` / `githubManifest`, and an HTTP error becomes an `ApiError` with the envelope's `code`.
  - [ ] `[unit]` `app.routes.spec.ts` passes: `routes.map(r => r.path)` contains `'settings/credentials'` in the declared position, the lazy loader resolves, and `canActivate` is exactly `[authGuard]`.
  - [ ] `[unit]` `readme.spec.ts` passes: every new file under `src/app` is listed in `apps/app/README.md` and every listed path exists.
  - [ ] `[unit]` `i18n` parity: `Object.keys(STRINGS.en).sort()` equals `Object.keys(STRINGS.es).sort()` and every key used in the three templates is present in both.
  - [ ] `[unit]` `git diff --name-only main...task-62` contains only the paths in the Exclusive paths list — zero others.
  - [ ] `[live]` An agent-tool credential never reaches the agent's environment, and the GitHub manifest flow completes against GitHub. **Not measurable from a worktree: report `[?]` / not run, never `passing`; the Orchestrator opens the `agent-review` issue.** Measurement on a box: create an `expose: "tool"` credential with a sentinel value, run a chat tool that dumps `process.env`, and assert the sentinel is absent; then run the manifest flow in a browser and assert the credential row becomes `configured: true`.

## 📣 Coordination

- For the Orchestrator: **there is no credential schema in `packages/contracts`.** The wire
  contract lives in `apps/daemon/src/credentials/schemas.ts` (daemon-local zod) and in
  `docs/api.md` §5.9, and `apps/app` does not depend on `zod`. Adding the schema to
  `packages/contracts/src/resources.ts` is impossible in this batch because Task-52 owns that
  file. The spec therefore freezes a hand-written parser in the feature API that mirrors §5.9
  key for key. The follow-up (a shared contract schema plus `zod` in the app, or a
  contract-provided parser) belongs to a later batch.
- The sheet is an inline `<section>`, not an `IonModal`: the page owns the open/closed signal
  so the component tests can see the markup without an overlay portal.
- For the next batch: `CredentialsApi` and the six parsers are the app's only door to §5.9;
  the route is `settings/credentials`; `Task-63` can link to it from the Settings row.

## ⛔ Out of scope

- No change to `apps/app/src/app/features/settings/**`, `packages/contracts/**`,
  `apps/daemon/**`, `docs/api.md`, `docs/app.md` beyond the one §4 row, or any other file.
- No credential rotation UI, no integration delete UI, no unscoped service catalog beyond the
  two entries, no provider OAuth beyond the GitHub manifest form.
- No new dependency; no `zod` import in `apps/app`; no `HttpClient` in a component; no
  `TODO.md`, `CHANGELOG.md`, `docs/decisions.md`, `package.json`, `package-lock.json`,
  `apps/app/angular.json`, `apps/app/src/main.ts`, `tsconfig.base.json`, `opencode.json`,
  `.agent_specs/**`.

## 🚩 Handover (binding)

1. Work on branch `task-62` in `../wt-cb-62`. Never touch `main`.
2. When — and only when — `npm run lint`, `npm test` and `npm run build` are green on your
   own worktree, commit your work and push it:
   `git push -u origin task-62`.
3. Then leave the turnstile as an **empty** commit on the tip and push it again:
   `git commit --allow-empty -m "dev: done task-62" && git push origin task-62`.
   A tip that does not read `dev: done task-62` is a dead dev and the task is redone from
   scratch, so never skip the marker and never put code in it.
4. Never `git merge`, never open or merge a PR, never edit `TODO.md`, `CHANGELOG.md`,
   `docs/decisions.md` or `.agent_specs/` (the spec travels in the branch and is dropped at the
   merge by the Orchestrator).
5. Report, in this order: the worktree path; the `task-62` tip sha; every command you ran with
   its exit code; the acceptance checklist with `pass` / `fail` / `not run` per item (a
   `[live]` item is `not run`, never `passing`); the files you created or modified; and any
   contract deviation or assumption. Never report a green you did not measure.

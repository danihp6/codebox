# Spec: Task-10 — GitHub provider

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** package (network I/O over an injected `fetch`, crypto over `node:crypto`,
  git over an injected runner).
- **Role:** Dev.
- **Objective:** after this task, `@codebox/git-provider` implements the `GitProvider` port of
  `docs/architecture.md` §2 for GitHub: an App JWT minted from the private key, installation
  tokens cached until shortly before expiry and refreshed **once** on a 401, repository
  verification, branch push through an injected git runner with the credential inside the URL
  and nowhere else, one pull request per branch (a second push updates instead of duplicating),
  the required-check summary the guardrails consume, merge with the documented 405/409/422
  mapping, close and branch delete, a PAT fallback, and a scriptable in-process GitHub HTTP
  surface so every one of those is proven headless. Every failure becomes a typed provider
  error, never a raw GitHub body.
- **Environment:** worktree `../wt-cb-10`, branch `task-10`, base `main`.
- **Dependencies (merged on `main`; read these, do not re-implement them):**
  - Task-03 — `packages/contracts/src/errors.ts` (`ErrorCode`, `ERROR_CODES`),
    `packages/contracts/src/resources.ts` (`repoVerifySchema`, `prRefSchema`,
    `mergeMethod`/`MERGE_METHODS`), `packages/contracts/src/primitives.ts`
    (`commitShaSchema`, `slugSchema`, `branchSchema`).
  - Task-05 — `packages/core/src/guardrails.ts` (`MergeFacts.checks` is
    `{ name, conclusion }[]` and produces `checks_red`; this package produces the summary it
    consumes).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `packages/git-provider/src/index.ts`
- `packages/git-provider/src/types.ts`
- `packages/git-provider/src/errors.ts`
- `packages/git-provider/src/jwt.ts`
- `packages/git-provider/src/tokens.ts`
- `packages/git-provider/src/github.ts`
- `packages/git-provider/src/fake.ts`
- `packages/git-provider/src/index.test.ts`
- `packages/git-provider/src/jwt.test.ts`
- `packages/git-provider/src/tokens.test.ts`
- `packages/git-provider/src/provider.test.ts`
- `packages/git-provider/src/push.test.ts`
- `packages/git-provider/src/pull-request.test.ts`
- `packages/git-provider/src/checks.test.ts`
- `packages/git-provider/src/merge.test.ts`
- `packages/git-provider/README.md`
- `docs/jobs.md` **(§6 "Commit, push and PR" only — one writer; see the hard boundary below)**

### Inputs (read-only)

Beyond `AGENTS.md`:

- `docs/jobs.md` §6 and §8, `docs/architecture.md` §2 (`packages/git-provider`) and §5,
  `docs/decisions.md` (D10, D12, D25), `docs/providers.md` §6 and §15.
- `packages/contracts/src/{errors,resources,primitives,index}.ts`
- `packages/core/src/{guardrails,index}.ts` and `packages/core/src/guardrails.test.ts`
- `packages/git-provider/{package.json,tsconfig.json,README.md}`
- `vitest.config.ts`, `tsconfig.base.json`, `eslint.config.js`

**Hard boundary on `docs/jobs.md`:** this task edits **§6 "Commit, push and PR" and nothing
else**. §3 (lifecycle), §7 (guardrails) and §11 (probation) belong to Task-05 and are frozen;
§2 ("Scheduling") belongs to Task-09 in this same batch. Do not renumber, do not touch the
front matter or §1, §2, §4, §5, §8–§15. If a fact you need belongs to another section, report
it instead of editing it.

## 🔒 Contract

Frozen public surface, re-exported exactly once from `src/index.ts`, grouped by module, in
this order. **Task-14 consumes `GitProvider` verbatim; do not rename a member.**

```ts
// ---------- src/types.ts ----------
import type { ErrorCode } from '@codebox/contracts';

export type MergeMethod = 'squash' | 'merge';
export type CheckConclusion = 'success' | 'failure' | 'neutral' | 'skipped' | 'pending' | 'cancelled';

export interface RepoInfo {
  readonly slug: string; // 'owner/name'
  readonly defaultBranch: string;
  readonly private: boolean;
  readonly canPush: boolean;
}

/** Exactly `repoVerifySchema` (docs/api.md §5.2). */
export interface RepoVerify {
  readonly ok: boolean;
  readonly defaultBranch: string;
  readonly canPush: boolean;
  readonly checks: readonly { readonly name: string; readonly state: string }[];
}

/** Exactly `prRefSchema` plus the fields the engine needs. */
export interface PullRequest {
  readonly number: number;
  readonly url: string; // https://
  readonly mergeable: boolean;
  readonly headSha: string;
  readonly baseSha: string;
  readonly state: 'open' | 'closed' | 'merged';
  readonly draft: boolean;
  readonly labels: readonly string[];
  readonly created: boolean; // true only when this call opened it
}

export interface OpenPullRequestInput {
  readonly repo: RepoInfo;
  readonly head: string; // branch inside the repository
  readonly base: string;
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
  readonly labels: readonly string[];
}

export interface CheckRun {
  readonly name: string;
  readonly conclusion: CheckConclusion;
  readonly required: boolean;
}

export interface CheckSummary {
  readonly state: 'success' | 'failure' | 'pending';
  readonly checks: readonly CheckRun[];
}

export interface ChecksInput {
  readonly repo: RepoInfo;
  readonly number: number;
  readonly headSha: string;
  readonly baseRef: string;
}

export interface MergePullRequestInput {
  readonly repo: RepoInfo;
  readonly number: number;
  readonly method: MergeMethod;
  readonly commitTitle: string;
  readonly commitMessage: string;
  readonly sha: string; // the head sha the guardrails were evaluated against
}

export type MergeReason =
  | 'merged'
  | 'not_mergeable'
  | 'head_moved'
  | 'method_not_allowed'
  | 'checks_red';

export interface MergeResult {
  readonly merged: boolean;
  readonly sha: string | null;
  readonly method: MergeMethod;
  readonly reason: MergeReason;
  readonly retryable: boolean; // true for 405/409: re-evaluate once, then park in pr_open
}

export interface PushBranchInput {
  readonly repo: RepoInfo;
  readonly worktree: string; // absolute path the daemon created
  readonly branch: string;
}

export interface PushResult {
  readonly branch: string;
  readonly sha: string; // HEAD after the push
}

export interface PullRequestRefInput {
  readonly repo: RepoInfo;
  readonly number: number;
}

export interface DeleteBranchInput {
  readonly repo: RepoInfo;
  readonly branch: string;
}

export interface GitProvider {
  verifyRepo(slug: string): Promise<RepoVerify>;
  getRepo(slug: string): Promise<RepoInfo>;
  pushBranch(input: PushBranchInput): Promise<PushResult>;
  openPullRequest(input: OpenPullRequestInput): Promise<PullRequest>;
  getPullRequest(input: PullRequestRefInput): Promise<PullRequest>;
  getChecks(input: ChecksInput): Promise<CheckSummary>;
  mergePullRequest(input: MergePullRequestInput): Promise<MergeResult>;
  closePullRequest(input: PullRequestRefInput): Promise<void>;
  deleteBranch(input: DeleteBranchInput): Promise<void>;
}

/** `{ number, url, mergeable }` — the `prRefSchema` value stored on the run. */
export function toPullRequestRef(
  pullRequest: PullRequest,
): { readonly number: number; readonly url: string; readonly mergeable: boolean };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GitCommandInput {
  readonly args: readonly string[]; // without the leading 'git'
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly env: Readonly<Record<string, string>>;
}
export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}
/** Same shape as `@codebox/workspaces`' runner; the daemon passes `createGitRunner()`. */
export interface GitCommandRunner {
  run(input: GitCommandInput): Promise<GitResult>;
}

export interface ProviderLogEvent {
  readonly level: 'debug' | 'info' | 'warn';
  readonly message: string; // a fixed phrase, never interpolated with a URL, header or body
  readonly status: number | null;
}
export type LogSink = (event: ProviderLogEvent) => void;

export type ProviderAuth =
  | { readonly kind: 'app'; readonly appId: string; readonly installationId: string; readonly privateKeyPem: string }
  | { readonly kind: 'pat'; readonly token: string }
  | { readonly kind: 'none' };

export interface GitHubProviderOptions {
  readonly auth: ProviderAuth;
  readonly apiBase: string; // CB_GITHUB_API_URL, no trailing slash
  readonly gitHost: string; // 'github.com' (or the Enterprise host)
  readonly fetch: FetchLike;
  readonly git: GitCommandRunner;
  readonly now: () => number; // ms, injected
  readonly requestTimeoutMs: number; // 30_000
  readonly log: LogSink;
  readonly userAgent: string; // 'codebox/<version>'
}

export function createGitHubProvider(options: GitHubProviderOptions): GitProvider;

// ---------- src/errors.ts ----------
export type GitProviderErrorCode =
  | 'unauthorized' // 401, including a second 401 after one refresh
  | 'forbidden' // 403 that is not a rate limit, or auth kind "none"
  | 'not_found' // 404
  | 'rate_limited' // 403 with x-ratelimit-remaining: 0, or 429
  | 'provider_unavailable' // 5xx, network error, timeout
  | 'validation_failed' // 422 on a create/update, bad slug, unreadable key
  | 'conflict'; // 409, non-fast-forward push

export class GitProviderError extends Error {
  readonly code: GitProviderErrorCode;
  readonly status: number | null; // the HTTP status, when there was one
  readonly retryable: boolean;
  constructor(code: GitProviderErrorCode, message: string, status: number | null, retryable: boolean);
}

/** One-to-one with the contract vocabulary; no provider code is left unmapped. */
export function toContractErrorCode(code: GitProviderErrorCode): ErrorCode;

// ---------- src/jwt.ts ----------
export const APP_JWT_BACKDATE_SECONDS = 60;
export const APP_JWT_TTL_SECONDS = 600;

export function createAppJwt(input: {
  readonly appId: string;
  readonly privateKeyPem: string;
  readonly issuedAt: number; // seconds since the epoch, from now() / 1000
}): string;

// ---------- src/tokens.ts ----------
export interface TokenSource {
  get(): Promise<string>;
  invalidate(): void;
  readonly refreshable: boolean;
}

export const TOKEN_REFRESH_MARGIN_SECONDS = 300;

export function decodePrivateKey(base64: string): string; // base64 PEM → PEM; validation_failed when unreadable
export function createPatTokenSource(token: string): TokenSource;
export function createAppTokenSource(options: {
  readonly appId: string;
  readonly installationId: string;
  readonly privateKeyPem: string;
  readonly apiBase: string;
  readonly fetch: FetchLike;
  readonly now: () => number;
  readonly requestTimeoutMs: number;
}): TokenSource;
export function createTokenSource(
  auth: ProviderAuth,
  deps: {
    readonly apiBase: string;
    readonly fetch: FetchLike;
    readonly now: () => number;
    readonly requestTimeoutMs: number;
  },
): TokenSource;

// ---------- src/fake.ts ----------
export interface FakeGitHubRequest {
  readonly method: string;
  readonly path: string; // path + query, e.g. '/repos/acme/web/pulls?head=acme:cb/run_1'
  readonly authorization: string | null;
  readonly body: unknown;
}

export interface FakeGitHubOptions {
  readonly token: string; // the installation/PAT token accepted
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch: string;
}

export interface FakeGitHub {
  readonly url: string; // 'http://127.0.0.1:<ephemeral port>' — pass as apiBase
  readonly requests: readonly FakeGitHubRequest[];
  readonly mintedTokens: readonly string[]; // installation tokens handed out, in order
  unauthorizedNext(count: number): void; // the next `count` requests answer 401
  setChecks(headSha: string, checks: readonly { readonly name: string; readonly conclusion: string; readonly status: string }[]): void;
  setRequiredChecks(contexts: readonly string[] | null): void; // null → the protection endpoint answers 404
  setMergeable(number: number, mergeable: boolean): void;
  failNext(method: string, path: string, status: number): void;
  close(): Promise<void>;
}

export function startFakeGitHub(options: FakeGitHubOptions): Promise<FakeGitHub>;
```

### Rules the implementation must obey

- **No `node:child_process`, no raw token in a log.** `git` arrives as `GitCommandRunner`;
  `ProviderLogEvent.message` is a fixed phrase from a closed set
  (`'github request failed'`, `'github rate limited'`, `'token refreshed'`,
  `'token mint failed'`, `'push failed'`, `'pull request updated'`, `'pull request opened'`,
  `'merge rejected'`). No field may contain a token, a URL, a header or a response body.
  `GitProviderError.message` is a fixed phrase plus the HTTP status at most — never the body,
  never a URL with credentials.
- **App JWT (RS256, `node:crypto`):** header `{"alg":"RS256","typ":"JWT"}`, claims
  `{"iat": issuedAt - 60, "exp": issuedAt - 60 + 600, "iss": appId}`, base64url without
  padding on all three segments, signed with `sign('RSA-SHA256', …, privateKeyPem)`. Nothing
  else in the payload.
- **Installation token:** `POST {apiBase}/app/installations/{installationId}/access_tokens`
  with `authorization: Bearer <jwt>`; body `{ token, expires_at }`. Cache it in memory and
  re-mint when `now() >= Date.parse(expires_at) - 300_000`. `invalidate()` drops the cache so
  the next `get()` mints. `createPatTokenSource` returns the PAT forever and is
  `refreshable: false`. `auth.kind === 'none'` → `get()` throws
  `GitProviderError('forbidden', …, null, false)`; every provider method therefore fails
  read-only (`docs/providers.md` §15).
- **Every API request** sends `accept: application/vnd.github+json`,
  `x-github-api-version: 2022-11-28`, `user-agent: <options.userAgent>` and
  `authorization: Bearer <token>` (or the App JWT for the token endpoint), with
  `AbortSignal.timeout(requestTimeoutMs)`.
- **401 handling (acceptance):** on a 401 from any API request, if the `TokenSource` is
  `refreshable` → `invalidate()`, `get()` again and retry **the same request exactly once**; a
  second 401 throws `unauthorized`. With a PAT (`refreshable: false`) a 401 throws immediately;
  no retry.
- **HTTP → error mapping (total, no fallthrough):** 401 → `unauthorized`; 403 with
  `x-ratelimit-remaining: 0` → `rate_limited`; 403 otherwise → `forbidden`; 404 → `not_found`;
  409 → `conflict`; 422 → `validation_failed`; 429 → `rate_limited`; 5xx →
  `provider_unavailable`; network error / abort / timeout → `provider_unavailable`. Retryable
  is `true` only for `rate_limited` and `provider_unavailable`.
- **`verifyRepo(slug)`:** `GET /repos/{slug}`; a slug that is not exactly one `owner/name`
  throws `validation_failed` before any request. Returns
  `{ ok: canPush, defaultBranch, canPush, checks: [{name: 'repo', state: 'ok'}, {name:
  'push', state: canPush ? 'ok' : 'forbidden'}] }`. HTTP failures throw.
- **`getRepo(slug)`:** same request; `{ slug, defaultBranch, private, canPush }` from
  `default_branch`, `private`, `permissions.push === true`.
- **`pushBranch`:** mint/get the token, then exactly two git calls, in this order:
  1. `['-C', worktree, 'push', 'https://x-access-token:<token>@<gitHost>/<slug>.git',
     'HEAD:refs/heads/<branch>']`
  2. `['-C', worktree, 'rev-parse', 'HEAD']`

  Returns `{ branch, sha: stdout.trim() }`. A non-zero exit is `conflict` when `stderr`
  mentions `non-fast-forward` or `rejected`, else `provider_unavailable`; the `stderr` text is
  never part of the error. The URL with the token exists only as a git argument; it is not
  logged, not returned, not in `message`.
- **`openPullRequest` (idempotency by branch, acceptance):** first
  `GET /repos/{slug}/pulls?head=<owner>:<head>&state=open&per_page=1`.
  - One result → `PATCH /repos/{slug}/pulls/{number}` with `{ title, body }`, then, when
    `labels.length > 0`, `POST /repos/{slug}/issues/{number}/labels` with `{ labels }`; return
    the PR with `created: false`. (`draft` cannot be changed after creation; ignore it here.)
  - No result → `POST /repos/{slug}/pulls` with `{ title, head, base, body, draft }`, then
    `POST /repos/{slug}/issues/{number}/labels` when `labels.length > 0`; return
    `created: true`.
  - `mergeable === null` in a payload (GitHub computes it asynchronously) → `mergeable: false`.
    A second push to the same branch therefore updates the same PR and never opens a duplicate.
- **`getPullRequest`:** `GET /repos/{slug}/pulls/{number}` → the same shape, `created: false`.
- **`getChecks`:** two requests.
  1. `GET /repos/{slug}/commits/{headSha}/check-runs?filter=latest&per_page=100` →
     `{ check_runs: [{ name, status, conclusion }] }`. `status !== 'completed'` or
     `conclusion === null` → `pending`; otherwise map `success|failure|neutral|skipped|
     cancelled` and treat anything else as `failure`.
  2. `GET /repos/{slug}/branches/{baseRef}/protection/required_status_checks` → 200
     `{ contexts: string[] }`; **any error** (404/403) → treat every check as required.
  `required` is `contexts.includes(name)` when the protection list is readable and non-empty,
  `true` otherwise. `state` is `failure` when any **required** check is `failure` or
  `cancelled`, `pending` when any required check is `pending` and none is failing, `success`
  otherwise. This is exactly `MergeFacts.checks`; `@codebox/core` turns a red required check
  into the `checks_red` blocker and this package does not.
- **`mergePullRequest`:** `PUT /repos/{slug}/pulls/{number}/merge` with
  `{ merge_method, commit_title, commit_message, sha }`.
  - `200 { merged: true, sha }` → `{ merged: true, sha, method, reason: 'merged', retryable: false }`.
  - `200 { merged: false }` → `{ merged: false, sha: null, reason: 'not_mergeable', retryable: true }`.
  - `405` → `not_mergeable`, `retryable: true`; `409` → `head_moved`, `retryable: true`;
    `422` → `method_not_allowed`, `retryable: false`; `403` → `not_mergeable`,
    `retryable: false`. Every non-merged answer logs `'merge rejected'` with the status.
  - No other status produces a `MergeResult`: they go through the error mapping.
- **`closePullRequest`:** `PATCH /repos/{slug}/pulls/{number}` `{ state: 'closed' }`; a 404 or
  422 means already closed → resolve silently (idempotent).
- **`deleteBranch`:** `DELETE /repos/{slug}/git/refs/heads/{branch}`; a 404 or 422 means
  already gone → resolve silently.
- **No `any` in an exported type; every payload is `unknown` and narrowed by a local decoder**,
  and every unexpected shape becomes `validation_failed` — the provider never trusts a body it
  did not shape.
- **Determinism:** ids and tokens are the fake's business; this package reads no
  `process.env`, never calls `Date.now()` (only `options.now`), and never fetches without the
  injected `fetch`.

### Data

- `RepoVerify` is byte-compatible with `repoVerifySchema`; `toPullRequestRef` is
  byte-compatible with `prRefSchema`; `MergeResult.method` uses the contract's `MERGE_METHODS`
  values. `packages/contracts` is **not** edited.
- `CommitSummary`-free: the provider reports checks, never a combined status; `checks_red` is
  core's vocabulary.
- The installation token lives only in this package's memory and in the git argument list for
  the duration of one push. It is never persisted, never logged, never returned.

## 🧩 Configuration

**This package adds no `CB_*` key and reads `process.env` never.** The daemon maps existing
keys:

| Key (`docs/providers.md`) | Option | Default |
| --- | --- | --- |
| `CB_GITHUB_APP_ID` / `CB_GITHUB_INSTALLATION_ID` / `CB_GITHUB_APP_PRIVATE_KEY_BASE64` | `auth: {kind: 'app', …}` (`decodePrivateKey(CB_GITHUB_APP_PRIVATE_KEY_BASE64)`) | — |
| `CB_GITHUB_TOKEN` | `auth: {kind: 'pat', token}` | — |
| neither App nor PAT | `auth: {kind: 'none'}` → read-only daemon | — |
| `CB_GITHUB_API_URL` | `apiBase` | `https://api.github.com` |
| — (derived) | `gitHost` = `apiBase` host with the `api.` prefix dropped | `github.com` |
| `CB_GIT_PROVIDER` | the daemon only constructs this provider for `github` | `github` |

The App wins when both credential sets are present; the daemon logs the warning
(`docs/providers.md` §6). No line is added to `docs/providers.md`.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim from the task worktree `../wt-cb-10`. No network: every test talks to
`startFakeGitHub` on `127.0.0.1` with an ephemeral port.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless.
  - `npm run build`.
  - `npx vitest run --project packages/git-provider` — this package alone.
  - `git diff --name-only main...task-10` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `npm ci --prefer-offline --no-audit --no-fund && npm run lint && npm test && npm run build` exits 0.
  - [ ] `[unit]` `npx vitest run --project packages/git-provider` reports `0 failed` and at
        least 40 passing tests across the eight `*.test.ts` files named above.
  - [ ] `[unit]` A 401 refreshes the installation token once and retries:
        `npx vitest run --project packages/git-provider -t '401'` passes with
        `unauthorizedNext(1)`, asserting two `mintedTokens` entries, exactly two requests for
        the same path, and that the second request carries the *second* token. A second
        consecutive 401 asserts `unauthorized` with exactly two requests and one mint.
  - [ ] `[unit]` A second push to the same branch updates the PR instead of opening a
        duplicate: `npx vitest run --project packages/git-provider -t 'idempotent'` passes,
        asserting the first call returns `created: true`, the second `created: false` with the
        same `number`, exactly one `POST /repos/…/pulls` in `FakeGitHub.requests`, one
        `PATCH /repos/…/pulls/{n}`, and that the second `PATCH` body carries the new title.
  - [ ] `[unit]` A red required check maps to `checks_red`:
        `npx vitest run --project packages/git-provider -t 'checks'` passes —
        `setRequiredChecks(['build'])`, `setChecks(sha, [{name:'build', conclusion:'failure',
        status:'completed'}, {name:'lint', conclusion:'success', status:'completed'}])` →
        `CheckSummary.state === 'failure'`, and feeding `{ checks: summary.checks.map(c =>
        ({name: c.name, conclusion: c.conclusion})) }` plus a green gate to
        `evaluateAutoMerge` (imported as `import { evaluateAutoMerge } from
        '../../core/src/index.js'`, a test-only relative import) yields exactly one blocker
        with `code: 'checks_red'`. The same fixture with `setRequiredChecks(['lint'])` yields
        `state: 'success'`; with `setRequiredChecks(null)` the red check is required and the
        guardrail fails.
  - [ ] `[unit]` Every error maps to a contract error code and never to a raw GitHub body:
        `npx vitest run --project packages/git-provider -t 'error mapping'` passes for
        401 / 403-with-ratelimit-0 / 403 / 404 / 409 / 422 / 429 / 500 / network-refused,
        asserting `toContractErrorCode(err.code)` equals
        `unauthorized|rate_limited|forbidden|not_found|conflict|validation_failed|rate_limited|
        provider_unavailable|provider_unavailable` respectively, that `err.message` contains
        no `'message'`, `'{'`, `'token'`, `'github.com/'` or the fake token value, and that the
        `LogSink` received only the closed-set phrases with no token.
  - [ ] `[unit]` The JWT is real RSA: `npx vitest run --project packages/git-provider -t 'jwt'`
        passes — generated `generateKeyPairSync('rsa', { modulusLength: 2048 })`, header
        `{alg:'RS256',typ:'JWT'}`, `iat` 60 s before `issuedAt`, `exp` 600 s later, `iss` the
        app id, three unpadded base64url segments, and `createVerify('RSA-SHA256')` against
        the public key verifies; a different key fails.
  - [ ] `[unit]` Token lifecycle: `npx vitest run --project packages/git-provider -t 'token'`
        passes — one mint, cached on the second `get()`, re-minted at
        `expires_at - 300 s`, forced by `invalidate()`, the PAT source never mints and is not
        refreshable, `auth.kind === 'none'` throws `forbidden`, and `decodePrivateKey` round-trips
        a base64 PEM while rejecting garbage with `validation_failed`.
  - [ ] `[unit]` Push argument lists: `npx vitest run --project packages/git-provider -t 'push'`
        passes with a recording `GitCommandRunner` — exactly
        `['-C', '/tmp/wt', 'push', 'https://x-access-token:<token>@github.com/acme/web.git',
        'HEAD:refs/heads/cb/run_1-x']` then `['-C', '/tmp/wt', 'rev-parse', 'HEAD']`; a
        non-fast-forward `stderr` maps to `conflict` and the thrown message contains neither
        the token nor the URL.
  - [ ] `[unit]` Merge mapping: `npx vitest run --project packages/git-provider -t 'merge'`
        passes for the 200-merged, 200-not-merged, 405, 409 and 422 cases with the exact
        `reason`/`retryable` pairs of the Contract section, and asserts `closePullRequest` and
        `deleteBranch` swallow 404/422.
  - [ ] `[unit]` No process, no ambient state:
        `git grep -nE 'node:child_process|process\.env|Date\.now\(|setTimeout|setInterval' -- packages/git-provider/src`
        prints nothing; `git grep -nE "from '@codebox/(contracts|core)'" -- packages/git-provider/src | grep -v 'import type'`
        prints nothing.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched:
        `git diff --name-only main...task-10` lists only the 17 paths above, and
        `git diff main...task-10 -- docs/jobs.md` changes lines inside §6 only — §§1–5 and
        §§7–15 are byte-identical (`git diff -U0 main...task-10 -- docs/jobs.md` must not show
        a hunk header for any line of §2, §3, §7 or §11).
  - [ ] `[unit]` `packages/git-provider/README.md` maps every file added, one line per file.
  - [ ] `[live]` The real GitHub surface answers. Measurement, operator-run on the VM with a
        fine-grained PAT and a scratch repository, never in CI:
        `CB_GITHUB_API_URL=https://api.github.com node --input-type=module -e "const m=await import('/opt/codebox/packages/git-provider/dist/index.js');const p=m.createGitHubProvider({auth:{kind:'pat',token:process.env.CB_GITHUB_TOKEN},apiBase:'https://api.github.com',gitHost:'github.com',fetch:globalThis.fetch,git:{run:async()=>({code:0,stdout:'',stderr:''})},now:Date.now,requestTimeoutMs:30000,log:()=>{},userAgent:'codebox/live'});console.log(JSON.stringify(await p.verifyRepo('<owner>/<scratch>')));console.log(JSON.stringify(await p.getChecks({repo:await p.getRepo('<owner>/<scratch>'),number:1,headSha:'<sha>',baseRef:'main'})))"`
        — bound: the first line is `{"ok":true,…}` with `defaultBranch` equal to the
        repository's real default branch and `canPush: true`; the second line is a
        `CheckSummary` whose `state` is one of `success|failure|pending` and whose `checks`
        names match the repository's check runs. A thrown `GitProviderError`, or a body echoed
        in the error, fails the criterion.

## 📣 Coordination

- **For the Architect:** no `@octokit/*` dependency (hot `package.json`, no holder): the
  provider is `fetch` + `node:crypto` over the documented REST surface. `docs/architecture.md`
  §2's port gains three members (`getRepo`, `deleteBranch`, `getPullRequest`) that the doc
  does not list; Task-10 must not edit that file — Task-30 should reconcile it. No contract
  change.
- **For Task-14 (run engine):** consume `GitProvider` verbatim. Order:
  `pushBranch({repo, worktree, branch})` → `openPullRequest({…, head: branch, base: run.baseRef,
  draft: gate.status !== 'passed', labels: ['cb:auto-merge'] or ['cb:gate-failed']})` →
  `getChecks({repo, number, headSha, baseRef})` → `evaluateAutoMerge` → `mergePullRequest({…,
  sha: pr.headSha})`. On `MergeResult.retryable === true` re-read with `getPullRequest` +
  `getChecks` and re-evaluate **once**; then park in `pr_open`. Map `toPullRequestRef(pr)` into
  `runs.update({ pr })` and `toContractErrorCode(err.code)` into your failure code.
- **For Task-11 (`/v1/providers`, `cb doctor`):** `auth.kind` is the `mode`
  (`app|pat|none`); `verifyRepo` success is `configured: true` and `lastOkAt` is the daemon's
  clock, not this package's.
- **For Task-15 (`POST /v1/repos/{id}/verify`):** respond with `verifyRepo`'s value directly;
  it already matches `repoVerifySchema`. A thrown `GitProviderError` maps through
  `toContractErrorCode` and `ERROR_STATUS`.
- **For QA of later batches:** every suite is offline; `startFakeGitHub` is the only GitHub.

## ⛔ Out of scope

- No new dependency, no `package.json` / `package-lock.json` / `tsconfig` edit.
- No Octokit, no webhook verification, no GitLab adapter, no GraphQL.
- No local git implementation (no `node:child_process`): the runner is injected.
- No gate, no run state, no guardrail evaluation, no store, no HTTP route, no logger
  implementation.
- No edit to `docs/jobs.md` outside §6, and none to `docs/architecture.md`,
  `docs/providers.md`, `docs/security.md`, `docs/decisions.md`, `packages/contracts/**` or
  `packages/core/**`.

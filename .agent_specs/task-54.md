# Spec: Task-54 — Remove interactive approvals and isolate the agent

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** daemon + ops + docs (no app, no contracts, no store).
- **Role:** Dev.
- **Objective:** After this task no Codebox process ever waits for a human permission answer.
  The chat pump stops minting approval rows, every permission request is answered inline from
  `decidePermission`, and an `ask` fails closed to `reject` instead of opening a prompt. The
  OpenCode agent runs as its own unprivileged OS user (`codebox-agent`) whose groups exclude
  the daemon's, so `/etc/codebox/` (the instance environment and the secret bundles),
  `/var/lib/codebox` (SQLite, logs, the sealed credential store) and any `~/.ssh` are
  unreadable to it; it receives only the model provider keys, from a dedicated
  `/etc/codebox/agent.env`. The boundary is measured: the image's own gate
  (`90-verify.sh --only isolation`) fails when a mode or a unit directive is wrong, and a
  headless test fails when the pump, the row or the unit drifts back.
- **Environment:** worktree `../wt-cb-54`, branch `task-54`, base `main` (commit `32035b1`).
- **Dependencies:** none. Task-52 (chat lifecycle) and Task-58 (credentials) are merged, so
  `apps/daemon/src/chat/**` is free and belongs to this task. Read `apps/daemon/src/chat/**`
  as it is on `main`; do not re-derive it from older specs.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path. The batch-mate is Task-56 (app only: `features/chat/chat-list.*`,
`shared/chat-row.ts`, `apps/app/README.md`); none of the paths below overlap.

Daemon:

- `apps/daemon/src/chat/service.ts` — the permission bridge lives here (`recordPermission`,
  `permissionLinks`, the `tick()` reply pump, `chat.permission` + `approval.created`
  persistence); the inline decision replaces it.
- `apps/daemon/src/chat/service.test.ts` — the two tests at lines 460–542 encode today's
  behaviour (row created, `chat.permission` stored, `tick()` delivering the reply).
- `apps/daemon/src/chat/README.md` — the file map and the two "Notes" bullets that describe
  the bridge (`service.ts` line 10, the `chat.permission` and "A permission is not answered
  here" bullets).
- `apps/daemon/src/run/engine.ts` — `resolveApproval`'s `ask` branch (lines 530–565) files a
  pending row nobody can answer; `permissionPath` (line 157) gains `export` so the chat path
  reuses the one extractor instead of copying it.
- `apps/daemon/src/run/engine.test.ts` — the permission describe block (lines 931–987) must
  also assert that **no** approval row and **no** `approval.created` event exist, and a new
  test pins `permissionPath`.
- `apps/daemon/src/run/approvals-retired.test.ts` — **new**; the objective guard that no
  non-test daemon source calls `approvals.create` again.
- `apps/daemon/src/run/README.md` — the file map gains one row for the new test file; the
  `engine.ts` row keeps its wording (`events.ts` still exports `mintApprovalId`, which is
  left for the task that retires `/v1/approvals`).

Ops, image:

- `ops/vm/systemd/codebox-opencode.service` — `User=`/`Group=`/`EnvironmentFile=`/
  `WorkingDirectory=`/`ReadWritePaths=`/`UMask=`.
- `ops/vm/systemd/codebox.service` — `UMask` only (`0027` → `0007`); the daemon must keep the
  agent-writable workspace group-writable.
- `ops/vm/test/systemd.test.mjs` — asserts `User=codebox` (line 92), one `ReadWritePaths`
  string (line 35) and `UMask=0027` in `SANDBOX_BLOCK` (line 32) for all three long-running
  units.
- `ops/vm/cloud-init.sh` — writes `/etc/codebox/agent.env` from the provider-key block it
  already reads (`$provider_keys`, lines 200–210), with a validation that no line is a
  `CB_*` key.
- `ops/vm/test/cloud-init.test.mjs` — idempotency hash set, the instance.env key-order tests,
  and the permission tests must cover the new file.
- `ops/vm/test/verify.test.mjs` — `90-verify.sh` gains a check, and this file pins the help
  text verbatim (line 221) plus the pass/fail behaviour of every check.
- `ops/vm/README.md` — the `cloud-init.sh` and `codebox-opencode.service` rows, the `test/`
  rows that changed, and the §Units paragraph naming the sandbox block.
- `ops/image/scripts/60-service.sh` — creates the `codebox-agent` user, the
  `codebox-workspace` group and the directory modes; this is the only place host identities
  and modes are created, so it is unavoidable even though the item's stale `*Paths:*` line
  omits it.
- `ops/image/scripts/90-verify.sh` — new `isolation` check (usage text, `checks` array,
  `check_isolation`). This is the "measured, never assumed" half of D45 and the only gate that
  sees the modes at bake time.
- `ops/image/test/template.test.mjs` — line 295/296 assert one `ReadWritePaths` and
  `User=codebox` for **every** service.
- `ops/image/README.md` — the `60-service.sh` and `90-verify.sh` rows now name a second user
  and a ninth check.

Docs (sections are disjoint; no other task in this batch holds these files):

- `docs/security.md` — §6 only: the `Permissions`, `Environment` and `Isolation` rows of the
  table and the two paragraphs around it.
- `docs/jobs.md` — §13 (`approval.created` row and the quiet-hours sentence) and §14 (one new
  bullet).
- `docs/providers.md` — §3 (one sentence about the two service users), §5 (the
  `CB_OPENCODE_AUTO` row only) and §14 (the production block and the sentence above it).
- `docs/agent-runtime.md` — §4 (the `permission asked` table row), §6 (the two bullets that
  describe the chat prompt, and the environment paragraph) and §10 (the `Permission never
  answered` row becomes `Policy ask | the request is rejected in place | widen the matrix or
  the prompt`). D45 says the boundary is described in the same task; leaving these three
  places saying "becomes an approval card and waits for the operator" would make the docs
  lie about the code this task ships.

**Not touched, on purpose:** `packages/contracts/**` (the `chat.permission` schema and
`CB_*` keys stay), `packages/store/**`, `packages/core/**`, `packages/security/**`,
`apps/app/**`, `apps/daemon/src/main.ts`, `apps/daemon/src/modules.ts`,
`apps/daemon/src/runs/**` (the `/v1/approvals` routes keep answering; the inbox simply stops
receiving new rows), `apps/daemon/src/chat/routes.ts` and `apps/daemon/src/chat/routes.test.ts`
(verified: neither mentions a permission or an approval), `docs/decisions.md`,
`docs/api.md`, `CHANGELOG.md`, `TODO.md`, `package.json`, `ops/image/codebox.pkr.hcl` (no new
unit and no new shell script, so nothing new to upload).

### Inputs (read-only)

Beyond `AGENTS.md`:

- `docs/decisions.md` (D27, D45, D49).
- `packages/core/src/permissions.ts` — the frozen `decidePermission` / `PERMISSION_MATRIX`.
- `packages/contracts/src/events.ts` — `chatPermissionDataSchema`, `approvalCreatedDataSchema`.
- `packages/contracts/src/primitives.ts` — `ApprovalId` is `^apv_[0-9A-Za-z]{6,40}$`.
- `packages/opencode/src/normalise.ts` — how `run.permission` is built and what
  `resolveApproval` returns.
- `ops/vm/{lib.sh,install.sh,backup.sh,keepalive.sh,spot-notice.sh}` — the shell conventions
  (`ROOT`, `rooted`, `die`, `log`, exit codes) you must not break.
- `apps/daemon/src/run/{ports.ts,events.ts}`.

## 🔒 Contract

### Daemon

```ts
// packages/core — already frozen, do not change it, do not re-implement it.
export type PermissionDecision = 'allow' | 'ask' | 'deny';
export function decidePermission(request: {
  readonly tool: string;
  readonly mode: 'chat' | 'run';
  readonly path: string | null;
  readonly worktree: string;
}): PermissionDecision;
```

```ts
// apps/daemon/src/run/engine.ts — existing private helper, now exported verbatim.
// Keys in order; a non-string value is skipped; no key → null.
export function permissionPath(input: Readonly<Record<string, unknown>>): string | null;
// PERMISSION_PATH_KEYS stays Object.freeze(['filePath', 'path']).
```

```ts
// apps/daemon/src/chat/service.ts — the frozen surface after this task.
export interface ChatService {
  send(input: SendMessageInput): Promise<ChatMessage>;
  sendRoutine(input: SendRoutineInput): Promise<ChatMessage>;
  pump(chatId: string): Promise<void>;
  interrupt(chatId: string): Promise<ChatSession>;
  prepare(chatId: string): Promise<ChatSession>;
  bind(chatId: string, repoId: string): Promise<ChatSession>;
  compact(chatId: string): Promise<ChatSession>;
  stop(): void;
}
// REMOVED: tick(): Promise<void>
// REMOVED: export const CHAT_POLL_MS = 500
// UNCHANGED: MAX_TEXT_CHARS, FREE_CHAT_DIRECTORY, BIND_DIVIDER, COMPACT_DIVIDER,
//            bindDividerText, ChatAgent, ChatWorkspaces, CreateChatServiceOptions,
//            ChatRuntime, chatRuntimeOf, createChatService.
```

Nothing outside the daemon imports `tick` or `CHAT_POLL_MS` (verified on `main`); the
`routines` and `schedules` services have their own `tick()`.

The delta in `apps/daemon/src/chat/service.ts`, exhaustively — delete `CHAT_POLL_MS`,
`PermissionLink`, `PermissionEvent`, `permissionLinks`, `redactedInput`, `recordPermission`,
`persistGlobalEvent`, `tick`, `ensureTicker`, the `ticker` variable and its `stop()` cleanup,
the `case 'permission.updated'` arm, the `mintApprovalId` import, the `redact` import, the
`SseEventName` import (it was only `persistGlobalEvent`'s) and `'chat.permission'` from
`ChatEventName`; add
`decideChatPermission(chatId, sessionId, raw)` which awaits the reply inline and is called from
the `case 'permission.updated'` arm of `runRound` (the arm becomes one
`await decideChatPermission(chatId, sessionId, raw); break;`). `decidePermission` joins the
existing `@codebox/core` import and `permissionPath` is imported from `../run/engine.js`. The
directory for the policy is `worktreeDirectories.get(chatId)`, which `prepare` always sets
before a round.

The delta in `apps/daemon/src/run/engine.ts`: `export` on `permissionPath`; the `ask` tail of
`resolveApproval` (from `// \`ask\` cannot be answered…` to the end of the function) becomes the
three-line reject above; `mintApprovalId` leaves the `./events.js` import; the local `records`
array and its emit loop go with it. `asRecord`, `withTransaction` and the rest of the file are
untouched.

### Ops contract

`ops/vm/systemd/codebox-opencode.service` after the change (order of the existing sandbox block
and its comments is preserved; only these lines change or are added):

```ini
[Service]
User=codebox-agent
Group=codebox-workspace
WorkingDirectory=/var/lib/codebox-agent
Environment=HOME=/var/lib/codebox-agent
EnvironmentFile=/etc/codebox/agent.env
ExecStart=/usr/bin/env opencode serve --hostname 127.0.0.1 --port 4096
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
... the existing extended block, with UMask=0007 instead of 0027 ...
ReadWritePaths=/srv/codebox /var/lib/codebox-agent
```

`instance.env` must not appear anywhere in that file. `codebox.service` keeps every line it has
today except `UMask=0027` → `UMask=0007`. No other unit changes.

`ops/vm/cloud-init.sh` gains a step between `instance-env` and `services`:

- `current_step=agent-env`, `failure_message="cannot write the agent environment"`.
- Before writing: when `$provider_keys` is non-empty, every line must match
  `^[A-Z][A-Z0-9_]*=` and no line may start with `CB_`; a violation is
  `fail_step 2 "<the reason, naming the key, never the value>"` and no `agent.env` is written.
- The file is `$etc_codebox/agent.env`, containing exactly the `$provider_keys` block (nothing
  added, nothing reordered), `0640`, `root:codebox-workspace` when running as root and the
  group exists (reuse `chown_if_root` / the `install -m 0640 -o root -g …` pattern the script
  already uses for `instance.env`), then `log "wrote $agent_env"`.
- `instance.env` keeps its current content, order and `0600 root:codebox`.

`ops/image/scripts/90-verify.sh` gains one check, named `isolation`, appended to the `checks`
array and the `usage_text` line (`… layout secrets image browser isolation`), dispatched by the
existing `check_$check` loop. It prints one `ok isolation` line or one `fail isolation <detail>`
and returns 1; the details, in this order of precedence:

1. `<dir> is missing` when `/etc/codebox` does not exist.
2. `<dir> is <mode>, expected 750` — `mode` from `find "$dir" -maxdepth 0 -printf '%m\n'`
   (GNU `find`, already used elsewhere in the repo; no `stat -c`).
3. `<dir> belongs to <group>, expected codebox` and `codebox-agent is in group codebox` — only
   evaluated when `getent group codebox` resolves, so a `--root` stub on a developer machine
   reports the mode check and skips the identity check.
4. `the agent unit is missing` / `the agent unit does not name codebox-agent` /
   `the agent unit does not name codebox-workspace` /
   `the agent unit does not name /etc/codebox/agent.env` /
   `the agent unit reads the instance environment` (any occurrence of `instance.env`).
5. `/etc/codebox/agent.env carries a CB_ key` when the file exists and a line starts with `CB_`.

The check is idempotent, needs no root, writes nothing and is safe to run on a live box as
`/usr/local/lib/codebox/90-verify.sh --only isolation`.

### The decision table (the whole behaviour change, exhaustively)

Every `permission.updated` raw event is decided inside the round that received it. The reply is
`await`ed before the next raw event is processed: it delays the round, it never fails it.

| Path | `decidePermission` | `replyPermission` | Event written | Approval row | Log line |
| --- | --- | --- | --- | --- | --- |
| chat | `allow` | `'once'` | none | none | none |
| chat | `ask` | `'reject'` | none | none | `chat_permission_ask_rejected` (warn) |
| chat | `deny` | `'reject'` | none | none | `chat_permission_denied` (info) |
| chat, no live directory | — | `'reject'` | none | none | `chat_permission_denied` (info) |
| run | `allow` | `'once'` | `run.permission` (as today) | none | none |
| run | `deny` | `'reject'` | `run.permission` (as today) | none | `run_permission_denied` (info, unchanged) |
| run | `ask` | `'reject'` | `run.permission` (as today) | **none** | `run_permission_ask_rejected` (warn) |

Consequences you must not "fix":

- Chat mode in `PERMISSION_MATRIX` is `edit: ask`, `bash: ask`, so **a chat can no longer edit
  a file or run a shell**. It reads, drafts and calls the routine tools; the work is a run.
  Do not weaken the matrix and do not special-case `edit`/`bash` in the daemon: an `ask` is a
  `reject`, by D45.
- The chat path emits **no** `chat.permission` event any more. Reason: `chatPermissionDataSchema`
  requires `approvalId: ApprovalId` (`^apv_…`), a real OpenCode request id is `per_…`, and
  `persistChatEvent` parses at the edge, so the honest options were a lying `apv_` id with no
  row behind it or no event. There is no event. `packages/contracts` keeps the type.
- The chat path emits **no** `approval.created` and writes **no** `store.approvals` row.
- `run.permission` still carries `approvalId` = the OpenCode permission id (that is what
  `resolveApproval` already returns); only the row and the `approval.created` of the `ask`
  branch disappear.

### Log lines (structured JSON, redacted by key)

Only these are new or removed. **Never log `title` or `input`** — the title is model output and
the input may carry a path or a token; both stay out of the log exactly as they stay out of the
row today.

- `chat_permission_ask_rejected` — `{ msg, chatId, tool }`, `warn`.
- `chat_permission_denied` — `{ msg, chatId, tool }`, `info`.
- `chat_permission_reply_failed` — `{ msg, chatId, tool, reason: <error name or 'unknown'> }`,
  `warn`; the round continues.
- `run_permission_ask_rejected` — `{ msg, runId, tool }`, `warn`.
- Removed: `chat_permission_replied`, `chat_tick_failed`.

### HTTP

No route changes, no status changes: a permission is never an HTTP exchange. `/v1/approvals`
and `/v1/approvals/:id/reply` keep their behaviour (`apps/daemon/src/runs/approvals.ts` is out
of scope); after this task they answer from rows written before it, and a fresh install's inbox
is empty by construction.

### Ordering

Within one round the order stays: user `chat.message`, `chat.delta`s, `chat.tool`s, the
assembled `chat.message`, `chat.idle`. Nothing is inserted for a permission. `seq` still comes
from `store.events.nextSeq({ chatId })`.

## 🧩 Configuration

No `CB_*` key is added, removed or re-defaulted. `packages/contracts/src/config.ts` is not
touched.

- `CB_APPROVAL_TTL_SECONDS` (600) stays: the runs sweep still expires legacy pending rows.
- `CB_OPENCODE_AUTO` stays. The daemon never passes it to a session today; the doc row is
  corrected in this task because "chat keeps interactive permissions" becomes false.
- Host files (not `CB_*`): `/etc/codebox/agent.env`, `0640 root:codebox-workspace`, holding
  **only** the model provider keys — no line may start with `CB_`.

### Data — host identities and modes (frozen)

Created by `ops/image/scripts/60-service.sh` (`groupadd`/`useradd` only when missing;
`usermod -aG` is idempotent). Nothing else in the tree may create or chown these:

| Identity | Definition |
| --- | --- |
| group `codebox-workspace` | `groupadd --system codebox-workspace`; members `codebox` and `codebox-agent` |
| user `codebox-agent` | `useradd --system --gid codebox-workspace --home-dir /var/lib/codebox-agent --no-create-home --shell /usr/sbin/nologin codebox-agent` |
| daemon user `codebox` | unchanged (`useradd --system --home-dir /var/lib/codebox --no-create-home --shell /usr/sbin/nologin`) |

| Path | Owner:group | Mode | Changed by this task |
| --- | --- | --- | --- |
| `/etc/codebox` | `root:codebox` | `0750` | no (must stay; `check_isolation` pins it) |
| `/etc/codebox/instance.env` | `root:codebox` | `0600` | no |
| `/etc/codebox/secret-bundles.json` | operator | `0600` | no |
| `/etc/codebox/agent.env` | `root:codebox-workspace` | `0640` | **new**, written by `cloud-init.sh` |
| `/var/lib/codebox` (state, logs, `secrets/`) | `codebox:codebox` | `0750` | no — and the agent is not in group `codebox` |
| `/var/lib/codebox-agent` | `codebox-agent:codebox-workspace` | `0700` | **new**; also the unit's `HOME` and `WorkingDirectory` |
| `/srv/codebox` | `codebox:codebox-workspace` | `0750` | group changes `codebox` → `codebox-workspace` |
| `/srv/codebox/repos` | `codebox:codebox-workspace` | `2770` | **yes** (was `0750 codebox:codebox`) — the agent's `git` writes objects and its own worktree index |
| `/srv/codebox/worktrees` | `codebox:codebox-workspace` | `2770` | **yes** (was `0750 codebox:codebox`) — files the agent writes must be group-writable by the daemon |
| `/var/tmp/codebox` | `codebox:codebox` | `0700` | no — the gate's scratch, never the agent's |

The `2` (setgid) bit is not decoration: every child the daemon or the agent creates under
`repos`/`worktrees` (including the free-chat `.chat/<id>` directory) inherits the
`codebox-workspace` group, which is what makes the shared worktree usable by both. Combined with
`UMask=0007` on `codebox.service` and `codebox-opencode.service`, files are `0660` and
directories `0770`, so the daemon can still `git add`, `git commit`, `rm -rf` a finished
worktree and run the gate inside a tree the agent filled.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing
else is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; includes the tests this task adds.
  - `npm run build` — `tsc -b` per workspace.
  - `npx vitest run --project apps/daemon` and `npx vitest run --project ops` — the two
    projects this task changes, run on their own so a failure names the project.
  - `git diff --name-only main...task-54` and `git status --porcelain` — audit against the
    exclusive paths (the second one catches the new untracked test file).
  - No `npx playwright test`: this task does not touch the app.
  - Push the branch with the subject `dev: done task-54` before handing over.

- **Acceptance criteria:**

Daemon:

- [ ] `[unit]` It typechecks, lints and builds clean: `npm run lint && npm run build` exits 0.
- [ ] `[unit]` `npx vitest run --project apps/daemon` exits 0.
- [ ] `[unit]` **No daemon source writes an approval row.** In
  `apps/daemon/src/run/approvals-retired.test.ts`, walking every `apps/daemon/src/**/*.ts` that
  is not a `*.test.ts` (expect more than 60 files) finds zero occurrences of
  `approvals.create(`. It also asserts `apps/daemon/src/chat/service.ts` contains neither
  `approvals` nor `setInterval`.
- [ ] `[unit]` **The chat pump is gone.** `apps/daemon/src/chat/service.test.ts` no longer
  contains the strings `turns a permission request into one approval`, `when the operator
  denies it`, or `service.tick()`; and it asserts
  `expect((service as unknown as Record<string, unknown>)['tick']).toBeUndefined()` on the
  service the harness built.
- [ ] `[unit]` **A chat permission writes nothing and is answered inline.** In
  `apps/daemon/src/chat/service.test.ts`, the test
  `answers a chat permission inline and writes no approval row`: script
  `session.updated busy` → `permission.updated` (`tool: 'bash'`, `permissionId: 'per_2'`,
  `title: 'Run the tests'`, `input: { command: 'npm test' }`) → `session.updated idle`; after
  `send` + `pump` assert `store.approvals.listPending(10)` is `[]`, no stored event has type
  `approval.created` (scan `store.events.readAfterId(0, 200)`), no stored event has type
  `chat.permission`, `eventTypes(store, chat.id)` is
  `['chat.message', 'chat.idle']`, and `agent.replies` is exactly
  `[{ sessionId: FIRST_SESSION, requestId: 'per_2', reply: 'reject' }]`.
- [ ] `[unit]` **An allowed chat tool is still allowed and an outside path is refused.** Same
  file, one test per row of the decision table that a chat can reach: `read` with
  `input: { filePath: '/tmp/cb-worktrees/chat_seed0001/README.md' }` → `reply: 'once'` and no
  row; `read` with `input: { filePath: '/etc/passwd' }` → `reply: 'reject'` and no row;
  `webfetch` → `reply: 'reject'` and no row. `store.approvals.listPending(10)` stays `[]` in
  all three.
- [ ] `[unit]` **The run path files no row for `ask`.** In `apps/daemon/src/run/engine.test.ts`
  the existing permission test also asserts `test.store.approvals.listPending(10)` is `[]` and
  that `eventTypes(test.emitted)` has no `approval.created`; a second test asserts
  `permissionPath({ filePath: '/a' }) === '/a'`, `permissionPath({ path: '/b' }) === '/b'`,
  `permissionPath({ filePath: 42, path: '/c' }) === '/c'` and `permissionPath({}) === null`.
- [ ] `[unit]` `apps/daemon/src/chat/routes.test.ts` and `apps/daemon/src/chat/routes.ts` are
  unchanged in the diff (`git diff --name-only main...task-54 -- apps/daemon/src/chat/routes.ts apps/daemon/src/chat/routes.test.ts` prints nothing).

Ops and image:

- [ ] `[unit]` `npx vitest run --project ops` exits 0.
- [ ] `[unit]` **The agent unit runs as the isolated user.** `ops/vm/test/systemd.test.mjs`
  asserts `ops/vm/systemd/codebox-opencode.service` contains exactly one
  `User=codebox-agent`, `Group=codebox-workspace`, `EnvironmentFile=/etc/codebox/agent.env`,
  `WorkingDirectory=/var/lib/codebox-agent`, `Environment=HOME=/var/lib/codebox-agent`,
  `ReadWritePaths=/srv/codebox /var/lib/codebox-agent` and `UMask=0007`, and that the string
  `instance.env` does not appear in the file. `codebox.service` keeps `User=codebox`,
  `Group=codebox`, `EnvironmentFile=/etc/codebox/instance.env` and gains `UMask=0007`;
  `cloudflared.service` keeps `User=codebox` and `UMask=0027`.
- [ ] `[unit]` **The isolation check fails when a mode is wrong.**
  `ops/vm/test/verify.test.mjs` builds a stub root: with `/etc/codebox` at mode `0750` and the
  real `ops/vm/systemd/codebox-opencode.service` copied in,
  `bash ops/image/scripts/90-verify.sh --root <root> --only isolation` exits 0 and prints
  `ok isolation`; after `chmod 0755 <root>/etc/codebox` the same command exits 1 and prints
  `fail isolation` naming the directory and the observed mode; with a unit whose
  `EnvironmentFile` is `instance.env` it exits 1 naming the unit. `--help` lists
  `isolation` in `checks:`.
- [ ] `[unit]` **`agent.env` carries the model keys and nothing secret.**
  `ops/vm/test/cloud-init.test.mjs`: after a boot with the existing Vault fixture,
  `<root>/etc/codebox/agent.env` exists, its non-empty lines are exactly
  `ANTHROPIC_API_KEY=…` and `OPENAI_API_KEY=…` in that order, its keys are exactly
  `['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']`, no line starts with `CB_`, and the bytes of
  `CB_SESSION_SECRET`, `CB_GITHUB_APP_PRIVATE_KEY_BASE64` and `CB_TUNNEL_TOKEN` do not appear
  in it. A second boot leaves it byte-identical (add its hash to the existing idempotency
  hash set). A bundle whose `providerKeys` contains a `CB_` line makes the boot exit 2 and
  writes no `agent.env`.
- [ ] `[unit]` **The image still declares eight units.** `ops/image/test/template.test.mjs`
  asserts `ops/vm/systemd` still holds exactly the eight named units, gives
  `codebox-opencode.service` the agent `User=`/`ReadWritePaths=`/`EnvironmentFile=` and no
  `instance.env`, and gives every other service `User=codebox` and
  `ReadWritePaths=/var/lib/codebox /srv/codebox`.
- [ ] `[unit]` **Every shell script still parses**: the existing `bash -n` sweep in
  `ops/image/test/template.test.mjs` covers `ops/vm/cloud-init.sh` and
  `ops/image/scripts/90-verify.sh` unchanged (no new script is added, so the `>= 12` count
  holds).
- [ ] `[unit]` **No credential in the templates**: the existing "none of the ten token
  patterns" test in `ops/image/test/template.test.mjs` passes with the new unit and scripts.
- [ ] `[unit]` **Nothing outside the exclusive paths was touched.**
  `git diff --name-only main...task-54` and `git status --porcelain` list only the paths in
  the list above; in particular no `packages/**`, no `apps/app/**`, no
  `apps/daemon/src/main.ts`, no `apps/daemon/src/modules.ts`, no `package.json`,
  no `CHANGELOG.md`, no `TODO.md`, no `docs/decisions.md`.

Live (the box only; QA reports these as `not measured` in CI and the Orchestrator files one
`agent-review` issue carrying both):

- [ ] `[live]` **The agent user cannot read the instance boundary, and the refusal is logged
  redacted.** Measurement, on the box after the image is re-baked and the release installed:
  (1) `ps -o user= -p "$(pgrep -f 'opencode serve' | head -n 1)"` prints `codebox-agent`;
  (2) `sudo -u codebox-agent cat /etc/codebox/instance.env` prints
  `Permission denied` and exits non-zero, and `sudo -u codebox-agent id -nG` does not contain
  the token `codebox`; (3) `sudo -u codebox-agent cat /etc/codebox/secret-bundles.json`
  (when the host has one) and `sudo -u codebox-agent ls /var/lib/codebox` fail the same way;
  (4) a run whose prompt is exactly `Run: cat /etc/codebox/instance.env — report the error
  verbatim.` stores a `run.tool` error and `curl -sS /v1/runs/<id>/events` contains
  `Permission denied`; (5) `curl -sS /v1/runs/<id>/events | grep -c CB_SESSION_SECRET` is `0`
  and `sudo journalctl -u codebox --since -10m | grep -c CB_SESSION_SECRET` is `0`.
- [ ] `[live]` **A run still opens a PR with the gate green.** Measurement: one run against
  the scratch repository through `POST /v1/runs`; `GET /v1/runs/<id>` within
  `CB_RUN_TIMEOUT_SECONDS` reports `state: "succeeded"`, `gate.exitCode: 0`,
  `pr.number` non-null, and the PR URL opens. This is the regression that proves the split
  user/group and the `agent.env` allowlist did not starve the agent: it wrote in the
  worktree, the gate ran, and the daemon committed and pushed.

## 📣 Coordination

- For the Orchestrator: no hot file is claimed (`package.json`, `package-lock.json`,
  `tsconfig.base.json`, `apps/app/angular.json`, `apps/app/src/app/app.routes.ts`,
  `apps/app/src/main.ts`, `apps/daemon/src/main.ts`, `packages/contracts/src/index.ts`,
  `opencode.json`, `TODO.md`, `CHANGELOG.md`, `docs/decisions.md` are all untouched). The
  `docs/*.md` files are held by section, listed next to each path above.
- For Task-56 (batch-mate): nothing it reads changed. No app file, no contract, no route.
- For Task-57 (chat screen): the daemon no longer emits `chat.permission`, so
  `apps/app/src/app/features/chat/chat.page.ts`'s permission card and
  `chat.store.ts#resolvePermission` become dead code that only that task removes; a tap on a
  stale card now answers `404 not_found` from `/v1/approvals/:id/reply`. Tool failures still
  arrive as `chat.tool` with `status: "error"`.
- For the next batch: `run.permission` is still emitted with `approvalId` = the OpenCode
  permission id. `ApprovalId` in `packages/contracts` is `^apv_[0-9A-Za-z]{6,40}$`, so a real
  `per_…` id fails an app-side `parseSseEvent`; that mismatch predates this task, is not fixed
  here because `packages/contracts` is out of scope, and belongs to whoever touches the
  event contract next.
- For the next batch: `mintApprovalId` in `apps/daemon/src/run/events.ts` now has no caller and
  `apps/daemon/src/runs/approvals.ts` has no writer. Deleting both belongs to the task that
  retires the approvals screen, not to this one.
- For QA: `apps/daemon/src/chat/routes.ts` and `routes.test.ts` must show up empty in the diff.
  If the dev touched them, the change is out of scope.
- For QA: the two `[live]` criteria cannot run in CI (no VM, no Packer). Report them as
  `not measured`, never as `pass`.

Assumptions the human should confirm (the Orchestrator carries these verbatim):

1. **A chat loses `edit` and `bash`.** `PERMISSION_MATRIX.chat` is `ask` for both, and this task
   makes `ask` a `reject`. That is the literal reading of the item and of D45 ("a prompt
   nobody can answer at 03:00 is not a control"), but it is a product-visible capability loss:
   from now on a chat reads, drafts and creates routines, and any change to a repository is a
   run. If the intent was "chats may edit inside the worktree", the fix is a matrix change in
   `packages/core` — a different task and a different decision.
2. **A new host file, `/etc/codebox/agent.env`,** carries the model provider keys to the agent
   instead of it inheriting the whole `instance.env` through systemd. `/etc/codebox` stays
   `0750 root:codebox` — unreadable to the agent as a file in the filesystem sense — but the
   point is that a process that cannot read `instance.env` must also not be *given* the
   session secret, the GitHub App key and the tunnel token in its environment.
3. **`UMask` drops to `0007` on `codebox.service` and `codebox-opencode.service`** and
   `/srv/codebox/{repos,worktrees}` become `2770 codebox:codebox-workspace`, because the agent
   and the daemon now share worktrees: the agent writes the files and its own `git` index, the
   daemon reads them, runs the gate, commits, pushes and later removes them. With the old
   `0027` the daemon could not delete anything the agent created and cleanup and the disk guard
   would rot.
4. **This is enforced by systemd, not by a supervisor.** `docs/agent-runtime.md` §7 describes
   the daemon spawning `opencode serve` itself; the tree has no such code —
   `ops/vm/systemd/codebox-opencode.service` is the only path that starts the agent. This task
   hardens that path and does not build the supervisor; if one lands later it must apply the
   same allowlist. The dev must not "fix" §7 to describe a supervisor that does not exist and
   must not add one.

## ⛔ Out of scope

- No new dependency; no `package.json`, no lockfile, no `tsconfig`, no dev tool.
- No change to `packages/contracts`, `packages/core`, `packages/store`, `packages/security`,
  `packages/opencode`, `packages/workspaces`.
- No change to `apps/app/**`, including the permission card the app still renders.
- No deletion of `/v1/approvals`, `apps/daemon/src/runs/approvals.ts`, `runs/service.ts`'s
  sweep, `mintApprovalId`, the `approval` table or its migration.
- No new systemd unit, no new shell script under `ops/`, no Packer change, no Terraform
  change.
- No container, bubblewrap, seccomp profile beyond what the unit already carries, and no egress
  filter.
- No change to `docs/decisions.md`, `docs/api.md`, `CHANGELOG.md` or `TODO.md` (the
  Orchestrator ticks the item).
- No refactor of a file this task did not have to touch; in particular do not reformat
  `ops/vm/systemd/*.service` or reorder the sandbox block.

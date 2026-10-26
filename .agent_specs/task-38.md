# Spec: Task-38 — Routine tool seam

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** daemon (security seam) + `packages/core` + `packages/opencode` + docs.
- **Role:** Dev.
- **Objective:** the chat agent can create, list and pause **routines** through the three
  `routine.create` / `routine.list` / `routine.pause` tools, served by a **loopback MCP server
  owned by the daemon** and mounted **only in the OpenCode session create call of a chat
  session**. An unattended run never receives that descriptor and D27 denies `routine.*` in
  run mode even if one ever leaked. After this task, `POST /v1/routines` is no longer needed to
  create a schedule: a conversation can.
- **Environment:** worktree `/home/runner/work/codebox/wt-cb-38`, branch `task-38`, base
  `origin/main` (`dee02e3`). The branch already carries one commit, `spec: task-38`; do not
  rewrite it.
- **Dependencies (already merged):** Task-13 (`apps/daemon/src/chat/**`, the chat session and
  its permission replies), Task-35 (`apps/daemon/src/routines/**`, the routine store and fire
  engine), Task-33 (`packages/contracts/src/routines.ts` — the three tool schemas are
  **already frozen there**), Task-07 (`packages/opencode`, the wrapper and `FakeOpenCode`),
  Task-05 (`packages/core`, the D27 matrix).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** Removing a stray
`.gitkeep` from a directory this task populates is allowed.

- `packages/core/src/permissions.ts`
- `packages/core/src/permissions.test.ts`
- `packages/opencode/src/types.ts`
- `packages/opencode/src/client.ts`
- `packages/opencode/src/client.test.ts`
- `packages/opencode/src/fake.ts` (only if the new optional field needs it — it forwards
  `createSession` input as-is, so probably not)
- `apps/daemon/src/chat/service.ts`
- `apps/daemon/src/chat/service.test.ts`
- `apps/daemon/src/chat/tools/index.ts` **(new)**
- `apps/daemon/src/chat/tools/server.ts` **(new)**
- `apps/daemon/src/chat/tools/routine-tools.ts` **(new)**
- `apps/daemon/src/chat/tools/ids.ts` **(new)**
- `apps/daemon/src/chat/tools/server.test.ts` **(new)**
- `apps/daemon/src/chat/tools/README.md` **(new)**
- `apps/daemon/src/chat/README.md`
- `docs/agent-runtime.md` — only §2, the §3 endpoint table and §6
- `docs/security.md` — only §6
- `docs/decisions.md` — only the new **D41** row in the decision table

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `packages/contracts/src/routines.ts` (the frozen `ROUTINE_TOOL_NAMES` and the three tool
  input/output zod schemas — **use them, do not change them**)
- `packages/contracts/src/primitives.ts` (`ID_PREFIXES.routine`)
- `packages/store/src/routines.ts`, `packages/store/src/index.ts` (`RoutineRepository`,
  `RoutinePatch`, `openInMemoryStore`)
- `apps/daemon/src/routines/routes.ts` and `apps/daemon/src/routines/service.ts` (the store
  calls and the `nextFireAt` / `formatInstant` idiom to mirror; do not modify them)
- `apps/daemon/src/jobs/service.ts` (`nextFireAt`, `formatInstant` — import, do not change)
- `apps/daemon/src/logger.ts` (`Logger`)
- `apps/daemon/src/chat/service.ts`, `apps/daemon/src/chat/errors.ts`,
  `apps/daemon/src/chat/ids.ts`
- `apps/daemon/src/run/engine.ts` (read only, to confirm the run path stays untouched)
- `packages/opencode/src/client.ts`, `packages/opencode/src/types.ts`,
  `packages/opencode/src/fake.ts`, `packages/opencode/src/client.test.ts`

## 🔒 Contract

### 1. `packages/core` — the D27 matrix gets a `routine` tool class

```ts
export type PermissionTool = 'read' | 'edit' | 'bash' | 'webfetch' | 'routine' | 'other';

// chat: { read:'allow', edit:'ask', bash:'ask', webfetch:'deny', routine:'allow', other:'deny' }
// run:  { read:'allow', edit:'allow', bash:'allow', webfetch:'deny', routine:'deny', other:'deny' }
export const PERMISSION_MATRIX: Readonly<
  Record<PermissionMode, Readonly<Record<PermissionTool, PermissionDecision>>>
>;

export function classifyTool(tool: string): PermissionTool;
```

- `classifyTool` trims and lowercases, then returns `'routine'` for **exactly**
  `routine.create`, `routine.list`, `routine.pause`. `routine.evil`, `routine.`, `routine` and
  `mcp__evil` stay `'other'` → deny in both modes (fail closed).
- `decidePermission` keeps its order: `webfetch`/`other` → deny, a path outside the worktree →
  deny, then the matrix. A routine request carries `path: null`, so the matrix decides:
  **chat allow, run deny**.
- `packages/core` stays pure: no imports from `@codebox/contracts` (it has no dependency on it),
  no I/O, no clock. Hardcode the three names in a frozen local constant.

### 2. `packages/opencode` — the session create body carries the MCP descriptor

```ts
export interface McpServerRef {
  readonly type: 'remote';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface CreateSessionInput {
  readonly directory: string;
  readonly title: string;
  readonly agent: string;
  readonly model: string | null;
  /** Chat sessions only: the routine tool server. A run never sets it (D41). */
  readonly mcp?: Readonly<Record<string, McpServerRef>>;
}
```

- `client.ts` `createSession` sends `mcp` in the `POST /api/session` body **only when the field
  is present** (conditional spread; `exactOptionalPropertyTypes` is on). No other body key is
  added, no validation beyond passthrough, no log of the header value.
- `FakeOpenCode` keeps forwarding the input unchanged; do not special-case it.
- A `[unit]` test in `client.test.ts` proves (a) with `mcp`, the request body carries it
  verbatim, and (b) without it, the body has no `mcp` key at all.

### 3. `apps/daemon/src/chat/tools` — the loopback MCP server

Public surface (exported from `index.ts`, explicit types on every export):

```ts
export interface RoutineToolMount {
  readonly url: string;   // http://127.0.0.1:<ephemeral port>/mcp
  readonly token: string; // base64url, 32 random bytes
}

export interface RoutineToolServer {
  /** Lazily binds 127.0.0.1 on the first call; replaces the token of that chat. */
  start(input: { readonly chatId: string; readonly repoId: string }): Promise<RoutineToolMount>;
  /** Revokes every token bound to the chat. Idempotent. */
  release(chatId: string): void;
  /** Closes the listener and destroys sockets. Idempotent; never throws. */
  close(): Promise<void>;
}

export interface CreateRoutineToolServerOptions {
  readonly store: Store;
  readonly now: () => Date;
  readonly logger: Logger;
  /** Injectable for tests: 32-byte token and 20-byte routine id entropy. */
  readonly random?: (size: number) => Buffer;
}

export function createRoutineToolServer(
  options: CreateRoutineToolServerOptions,
): RoutineToolServer;
```

`ids.ts`:

```ts
/** `rtn_` + 20 Crockford base32 chars, the shape `RoutineId` accepts. */
export function newRoutineId(random?: (size: number) => Buffer): string;
```

**Transport (`server.ts`), exactly this and no more:**

- `node:http` `createServer`, bind `listen(0, '127.0.0.1')` on the first `start()`; the URL is
  `http://127.0.0.1:<port>/mcp`. Never bind `0.0.0.0`, never a fixed port.
- Accepted requests: `POST /mcp` with `content-type: application/json` and
  `authorization: Bearer <token>`. Anything else: `404` (path), `405` (method), `415`
  (content type), `413` (body over **65 536** bytes), `401` (missing/unknown token). Token
  comparison is `timingSafeEqual` after a length check. Responses carry
  `cache-control: no-store`.
- JSON-RPC 2.0, one object per request (reject a batch array with `-32600`), `id` echoed:
  - `initialize` → `{protocolVersion:'2025-06-18', capabilities:{tools:{listChanged:false}},
    serverInfo:{name:'codebox-routine-tools', version:'1.0.0'}}`.
  - `notifications/initialized` (no `id`) → HTTP `202`, empty body.
  - `tools/list` → `{tools:[{name, description, inputSchema}]}` in `ROUTINE_TOOL_NAMES` order.
    `inputSchema` is a hand-written JSON Schema literal per tool (no new dependency) with
    `type:'object'` and `additionalProperties:false`; the zod schemas below remain the
    authority for parsing.
  - `tools/call` with `{name, arguments}` → see the tool table.
  - Unknown method → `{error:{code:-32601,...}}`; malformed JSON → `-32700`; a body that is not
    a JSON-RPC request → `-32600`.
- A tool failure is **not** a JSON-RPC error: return
  `{content:[{type:'text',text:'<code>'}], isError:true}` with a fixed code from
  `invalid_input`, `invalid_cron`, `invalid_timezone`, `not_found`, `unknown_tool`, `internal`.
  A success returns
  `{content:[{type:'text',text:JSON.stringify(output)}], structuredContent: output, isError:false}`.
- Logs are structured and redacted: `{msg:'routine_tool_call', tool, chatId}` on success,
  `{msg:'routine_tool_failed', tool, chatId, code}` on failure, `{msg:'routine_tools_listening',
  port}` on bind. **Never** log the token, the authorization header or the tool input.

**Tools (`routine-tools.ts`)** — `chatId` and `repoId` come **from the token entry**, never from
the model's arguments:

| Tool | Input (contracts zod schema) | Behaviour |
| --- | --- | --- |
| `routine.create` | `routineCreateToolInputSchema` | Compute the next fire with `nextFireAt({cron, timezone}, now())` from `apps/daemon/src/jobs/service.ts`; a refusal is `invalid_cron` / `invalid_timezone` and writes nothing. Build the contract `Routine`: `id = newRoutineId()`, `enabled:true`, `notify:true`, `createdAt = formatInstant(now())`, `lastFiredAt:null`, `nextFireAt`. `prompt` → `repoId` (from the token), `prompt` (from input), `chatSessionId` (the calling chat). `reminder` → no `repoId`/`prompt`/`chatSessionId` keys at all. `store.routines.create(routine)`; output `{routine}`. |
| `routine.list` | `routineListToolInputSchema` | `store.routines.list({ limit: 50, cursor: null, ...(kind ? {kind} : {}) })`; output `{routines}`. |
| `routine.pause` | `routinePauseToolInputSchema` | `store.routines.get(id)` → null is `not_found`. `enabled:false` → `nextFireAt:null`; `enabled:true` → recompute with `nextFireAt`, a refusal is `invalid_cron`/`invalid_timezone`. One `store.routines.update`; output `{routine}`. |

Every output must parse with `parseRoutine` / the contract output schemas. `routine.create` on
an unknown `kind` or a missing `timezone` is `invalid_input` and writes no row.

### 4. `apps/daemon/src/chat/service.ts` — mount it for chat, never for a run

- `CreateChatServiceOptions` gains
  `readonly routineTools?: () => RoutineToolServer;` (lazy factory). The default builds
  `createRoutineToolServer({ store, now: clock, logger })` on first use.
- `createAgentSession(directory, chatId)` reads the chat's `repoId` from the stored session and
  calls `await tools().start({ chatId, repoId })`, then passes
  ```ts
  mcp: { codebox: { type: 'remote', url: mount.url, headers: { authorization: `Bearer ${mount.token}` } } }
  ```
  to `agent().createSession`. Header name is lowercase. If `start` throws, log
  `{msg:'routine_tools_unavailable'}` and create the session **without** `mcp` — a chat still
  works; the failure is never silent and never leaks the error message.
- `stop()` closes the tool server once, best effort (`void tools.close()`), idempotent with the
  existing `stopped` flag. A `release(chatId)` is not called on archive because archiving is
  outside this task; `close()` on shutdown is enough.
- The run path (`apps/daemon/src/run/engine.ts:700`) is **not touched** and never passes `mcp`.

## 🧩 Configuration

No new `CB_*` key. Nothing reads an environment variable; the port is ephemeral and the token
is random per chat session.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim from a clean integration worktree with `task-38` merged on `origin/main`.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund`
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `git diff --name-only origin/main...task-38` — audit against the exclusive paths.
  - `git grep -n "routine\|mcp" -- apps/daemon/src/run` — must print nothing.
- **Acceptance criteria:**
  - [ ] `[unit]` The four gate commands above exit 0.
  - [ ] `[unit]` `packages/core/src/permissions.test.ts` asserts the whole matrix including
        `routine`, `classifyTool` for the three names plus `routine.evil` → `other`, and that
        `decidePermission({tool:'routine.create',mode:'chat'})` is `allow` while `mode:'run'`
        is `deny`. The old expectation that `routine.create` is denied in chat is gone, not
        skipped.
  - [ ] `[unit]` `packages/opencode/src/client.test.ts` asserts the create-session body
        carries `mcp` verbatim when given and has no `mcp` key when omitted.
  - [ ] `[unit]` `apps/daemon/src/chat/tools/server.test.ts` starts the real server on an
        ephemeral port with `openInMemoryStore()` and proves, over real HTTP: a missing and a
        wrong token are `401` and write no row; `initialize` returns the pinned
        `protocolVersion` and `serverInfo`; `tools/list` returns exactly the three names with
        `type:'object'` input schemas; `routine.create` (prompt) stores a row whose `repoId`,
        `chatSessionId` and `nextFireAt` match the token's chat, whose id matches
        `/^rtn_[0-9A-Za-z]{6,40}$/` and which `parseRoutine` accepts; a reminder row carries no
        repo/prompt/chat columns; a missing `timezone` returns `isError:true` with
        `invalid_input` and writes no row; `routine.list` returns it; `routine.pause` with
        `enabled:false` sets `enabled:false` and `nextFireAt:null`, with `enabled:true`
        recomputes it; an unknown tool is `isError:true`; a body over 64 KiB is `413`; the
        token never appears in a log line.
  - [ ] `[unit]` `apps/daemon/src/chat/service.test.ts` asserts `prepare(chatId)` calls
        `agent.createSession` with `mcp.codebox.type === 'remote'`, a
        `http://127.0.0.1:<port>/mcp` URL and a bearer header, and that a
        `routine.create` call made against that URL with that token lands in the store with the
        chat's `repoId` and `chatSessionId`. A second test asserts `stop()` closes the tool
        server exactly once.
  - [ ] `[unit]` `git grep -n "routine\|mcp" -- apps/daemon/src/run` prints nothing and
        `apps/daemon/src/run/**` is not in the diff.
  - [ ] `[unit]` Docs: `docs/decisions.md` has a **D41** row naming the mechanism (loopback MCP
        server owned by the daemon, one bearer token per chat session, the descriptor only in a
        chat session create body, `routine.*` chat-allow/run-deny); `docs/agent-runtime.md` §2
        and §6 say the same and the §3 create-session row shows `mcp?`; `docs/security.md` §6
        has a row for the routine tool. `apps/daemon/src/chat/README.md` and
        `apps/daemon/src/chat/tools/README.md` list every new file (AGENTS.md rule).
  - [ ] `[unit]` Nothing outside the exclusive paths appears in the diff; no new dependency;
        `packages/core` still imports no `node:*` module.
  - [ ] `[live]` **Not runnable on Actions.** On the VM: from a real chat, ask the agent to
        "recordarme …" and to "resumir el repo cada mañana"; `GET /v1/routines` lists both with
        the right IANA timezone and `nextFireAt`; at the fire time the reminder pushes once and
        the prompt routine answers in its chat, and neither creates a run, a gate or a PR.
        Measurement: the two `GET /v1/routines` bodies, the `routine.fired`/`routine.replied`
        events and the push on the phone. QA must report this **not run**, never pass.

## 📣 Coordination

- For the Architect: this is the only eligible task in the queue; the run descriptor travels in
  the branch and no contract file changes, so no other task is affected.
- For the next batch: Task-36 (routines UI) can now render a routine created in chat; the tool
  names and outputs are the frozen contract ones in `packages/contracts/src/routines.ts`.

## ⛔ Out of scope

- No `POST /v1/routines` route (creation is the tool), no `docs/api.md` change, no
  `docs/jobs.md` change.
- No app UI (Task-36), no i18n, no `opencode.json` change, no `apps/daemon/src/main.ts` change.
- No change to `packages/contracts/**`, to `apps/daemon/src/routines/**`, or to the run engine.
- No new dependency (the MCP subset is `node:http` + the existing zod schemas).
- No refactor of a file this task did not have to touch.

## ✅ Handover

When `npm run lint`, `npm test` and `npm run build` are green in
`/home/runner/work/codebox/wt-cb-38`: commit your work, `git push -u origin task-38`, then
`git commit --allow-empty -m "dev: done task-38"` and push again. Do not commit to `main`, do
not edit `.agent_specs/task-38.md`, and do not touch `TODO.md` or `CHANGELOG.md`.

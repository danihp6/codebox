# `src/chat`

The chat subsystem: the `docs/api.md` §5.6 routes, the durable chat session bound to one
repository worktree and one OpenCode session, and the pump that turns raw agent events into
`chat.*` rows. Every prompt and reply is stored, so the transcript survives a restart.

## Files

- `index.ts` — the `createModule` seam: one service, the routes and the shutdown hook.
- `service.ts` — session lifecycle, `prepare`, `send`, the turn pump, `interrupt`, the pending
  approval links and `tick`, plus the lazily built agent client and workspace manager.
- `routes.ts` — the seven handlers, their body and query schemas, the `chat` scope check.
- `ids.ts` — the only `chat_` and `msg_` id generators.
- `errors.ts` — `ChatError`, its fixed messages and the status-to-envelope mapping.
- `ids.test.ts` — id shapes, uniqueness and pinned bytes.
- `service.test.ts` — fixture replay with monotonic `seq`, prepare, interrupt, permissions.
- `routes.test.ts` — the HTTP contract: bodies, `404`/`409`/`422`/`502`, scopes, silent logs.

## Notes

- A chat id occupies the workspace manager's `runId` slot: the branch is `cb/<chatId>-<slug>` and
  the directory is that branch's worktree. Archiving never removes it; retention does.
- The merged `ChatRepository` returns the contract `ChatSession`, which carries neither
  `opencode_session_id` nor `worktree`. Both columns are written on every prepare, and the live
  link to the agent session is held in memory; after a restart the chat is prepared again in the
  same worktree, which is the durable half of the binding.
- One appender owns the order of a round: user `chat.message`, `chat.delta`s, `chat.tool`s,
  `chat.permission` with its `approval.created` in the same transaction, the assembled
  `chat.message`, then `chat.idle`. `seq` comes from `store.events.nextSeq({ chatId })` and an
  approval event carries no `seq`, so the chat stream stays strictly increasing.
- A permission is not answered here: the row is read in `tick()` and an answered row becomes
  `replyPermission(sessionId, permissionId, 'once' | 'reject')`. The map from approval id to the
  OpenCode permission id lives in memory and is dropped when the reply is delivered.
- A turn never throws: a failed prompt, a dropped stream or an agent error still ends with
  `chat.idle`, and `stop()` aborts every turn and clears the poll timer.

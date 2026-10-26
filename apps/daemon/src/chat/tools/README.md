# `src/chat/tools`

The routine tool seam: a daemon-owned MCP server on `127.0.0.1` that exposes `routine.create`,
`routine.list` and `routine.pause` to a chat session and to nothing else. The descriptor travels
in the `POST /api/session` body of a chat only; a run never receives it (D41).

## Files

- `index.ts` — the public surface: `createRoutineToolServer` and the mount/server types.
- `server.ts` — the `node:http` listener, the JSON-RPC 2.0 subset, the per-chat bearer tokens and
  the shutdown that destroys its sockets.
- `routine-tools.ts` — the three tool definitions, their hand-written JSON Schemas and the calls
  into the routine store, with the contract schemas as the parsing authority.
- `ids.ts` — the only `rtn_` id generator.
- `server.test.ts` — real HTTP on an ephemeral port: `401`/`404`/`405`/`413`/`415`, `initialize`,
  `tools/list`, the three tools, the reminder row and the token-free logs.

## Notes

- The listener binds `127.0.0.1:0` on the first `start()` and never a fixed port; the URL is
  `http://127.0.0.1:<port>/mcp` and the token is base64url of 32 random bytes.
- A token is bound to one `{chatId, repoId}` pair: a `routine.create` cannot choose another chat
  or repository, and the prompt routine is stored with the calling chat.
- Every accepted request needs `content-type: application/json` and
  `authorization: Bearer <token>`; comparison is `timingSafeEqual` after a length check. A body
  over 65 536 bytes is refused before it is parsed.
- A tool failure is an MCP `isError` result with a fixed code, never a JSON-RPC error. The logs
  carry the tool name and the chat id only: no token, no header and no tool input.

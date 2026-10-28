# `apps/daemon/src/sessions`

A session is an editor with exactly one target, and the target is its write boundary (D55). A
`repo` session is read-only: no branch, no proposal. The proposal is the only way a session
writes, and the daemon refuses a diff outside the target before anything is pushed.

## Files

- `index.ts` — the `sessions` subsystem module: one shared service, the routes, no timer.
- `service.ts` — the create/prepare, the awaited agent turn, the proposal diff and its merge,
  compact, interrupt and archive, plus `TARGET_WRITE_SETS` and `outsideTarget`.
- `routes.ts` — the `docs/api.md` §5.6.1 handlers, their body and query schemas and their scopes.
- `ids.ts` — the only `sess_` and `msg_` id generators.
- `errors.ts` — the session refusals mapped onto the §3 envelope and its reason tokens.
- `sessions.test.ts` — the four `outsideTarget` cases, the `workId` invariant, `read_only_session`,
  `target_violation` without a push, `proposal_pending`, `proposal_none`, a merge and one turn.

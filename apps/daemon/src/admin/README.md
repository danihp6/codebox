# `apps/daemon/src/admin`

The operator's runtime surface: the effective settings, the brake and the cache wipe
(D61). The brake is a stored row the run engine reads at every guardrail evaluation, so it
needs no restart; the wipe removes only finished worktrees.

## Files

- `index.ts` — the `admin` subsystem module: one settings service, the four routes, no timer.
- `service.ts` — the effective settings, the one writable key, the brake row and the cache
  wipe over `WorkspaceManager.listWorktrees`/`removeWorktree`.
- `routes.ts` — `GET`/`PATCH /v1/settings` and the two `/v1/admin` handlers with their scopes and
  the one-key patch schema.
- `service.test.ts` — the defaults, the stored overrides, the live `automerge` getter, the
  terminal/live/orphan wipe cases.
- `routes.test.ts` — the four statuses, the `write`/`admin` split, the unknown-key `422` and the
  `202` with no body.

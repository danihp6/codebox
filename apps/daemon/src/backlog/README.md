# `apps/daemon/src/backlog`

The repository's `TODO.md` at its default branch, projected into the §5.6 object and read for the
one selection (D51, D56). The file is the owner; the daemon only reads it and, in a run's
worktree, ticks one line.

## Files

- `index.ts` — the `backlog` subsystem module: one shared service, the route, no timer.
- `service.ts` — the bare-clone read (`git show <defaultBranch>:TODO.md`), the projection joined
  with works, the ref resolution, the selection feed and the worktree tick.
- `select.ts` — the `BacklogWorkState[]` feed: the repository's works, paged until exhausted.
- `routes.ts` — `GET /v1/repos/{id}/backlog`, its `read` scope and the unknown-repository 404.
- `service.test.ts` — projection counts against the package fixture, ref refusals, run counts and
  the byte-exact tick.
- `routes.test.ts` — the HTTP object, the empty projection and the 404 envelope.

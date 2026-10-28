# `apps/daemon/src/works`

The unit of the product (D44, D53): one backlog item of one repository, its state, its retry
budget and its runs. The file owns the title and the body; the row caches them at `specSha` and
`PATCH` refuses to rewrite them (D51).

## Files

- `index.ts` — the `works` subsystem module: one shared service, the routes, no timer.
- `service.ts` — list, create from a ref, detail with its repository and runs, the refusals, the
  attempt that opens a run, the decision session, the review stamp, the interrupt and the manual
  *Run next* selection.
- `routes.ts` — the `docs/api.md` §5.6 handlers, their body and query schemas and their scopes.
- `ids.ts` — the only `wrk_` id generator.
- `routes.test.ts` — creating from the file, the ref refusals, `spec_in_git`, `live_work`, the
  run link, `already_reviewed`, `no_live_run`, the decision session and the empty backlog.

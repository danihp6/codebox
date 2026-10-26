# `routines`

The routines subsystem: `docs/jobs.md` §15 (chat schedules), `docs/api.md` §5.8 (the routes)
and the D13 misfire rule shared with a job. A routine is not a run: it never opens a worktree, a
gate or a PR.

## Files

- `index.ts` — the `routines` subsystem module: builds the service, mounts the routes, starts
  and stops the tick.
- `service.ts` — the tick, the claim, the background prompt fire, the event rows and the
  module's runtime accessor for the routes.
- `tick.ts` — the pure planner: D13 grace, next fire, and the `no_next_fire` stop rule.
- `fire.ts` — one prompt fire: the routine's chat, its `origin: routine` message and the reply.
- `routes.ts` — the seven §5.8 handlers with their strict query and body schemas.
- `tick.test.ts` — the plan: on time, outside grace, bad cron, null next fire and the Madrid
  DST boundary.
- `fire.test.ts` — the prompt fire outcomes: chat, repo, reply, no reply and an internal error.
- `service.test.ts` — the reminder, the overlap guard, the lost claim, skip, defer, the created
  and re-pointed chat, the failure event and a manual run.
- `routes.test.ts` — the §5.8 HTTP contract: pagination, filters, patching, pause, resume, run,
  delete, create absent and the scope table.
- `index.test.ts` — the module seam, the no-query build and the one tick timer.
- `README.md` — this map.

## Notes

- `createModule` does no I/O: no query and no timer until `register`, which mounts the routes
  and starts the one `unref()`ed interval.
- The schedule strings (`next_fire_at`, `fired_at`, `scheduledFor`) are second precision through
  `formatInstant`; event `ts` values keep milliseconds. The claim's
  `next_fire_at === scheduled_for` equality depends on that split, so any other writer of
  `next_fire_at` must use the same helper.
- A reminder pushes on `routine.fired`; a prompt is silent there and pushes once on
  `routine.replied` (§13, one push per outcome).
- The chat service is looked up lazily through `chatServiceFor(context)`, so a daemon with the
  `chat` subsystem disabled keeps firing reminders and records `chat_unavailable` for prompts.
- `POST /v1/routines` is deliberately absent: creation is the `routine.create` chat tool
  (Task-38).

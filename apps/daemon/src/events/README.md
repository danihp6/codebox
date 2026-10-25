# `src/events`

The SSE subsystem: the single `GET /v1/events` stream of `docs/api.md` §6, backed by
`store.events`. Replay is exact within the retention window, a pruned range becomes one `gap`,
and one in-process notifier wakes every open stream as soon as a chat append commits.

## Files

- `index.ts` — the `createModule` seam: one bridge and one connection limiter, no timer.
- `bridge.ts` — `session()` (read-after-id replay, gap detection, filters, heartbeat, hard
  close) and `frames()` (the async source the handler writes).
- `frames.ts` — `retry`, `id`, `event`, `data` and the heartbeat comment, pure and clock-free.
- `notifier.ts` — one `EventNotifier` per daemon context, in a `WeakMap`.
- `limits.ts` — the `SSE_CONNECTIONS_PER_DEVICE` limiter and its release function.
- `routes.ts` — the handler, its query schema, the headers and the `429` shape.
- `bridge.test.ts` — replay, gaps, filters, heartbeat, hard close and the terminal close.
- `frames.test.ts` — the exact frame text, including a one-line JSON payload.
- `limits.test.ts` — the three-connection limit, per device and with a double release.
- `routes.test.ts` — the stream over HTTP: headers, filters, terminal close, `429`, validation.

## Notes

- The `id` line is the global event sequence; `data.seq` is the per-run or per-chat sequence. The
  cursor advances over every row read, including the ones a filter drops, so a filtered stream
  never loses an id it needs for the next read.
- `afterId === 0` never produces a `gap`: a fresh client has nothing to stitch. `afterId > 0`
  with a first row beyond `afterId + 1` yields exactly one `gap` with `latestId()` before the
  rows.
- A `runId` stream ends after a delivered `run.finished`, `run.failed` or `run.cancelled` for that
  run; any other stream ends on the 90 s hard close. Heartbeats do not reset the hard-close
  clock, only a real frame does.
- The handler writes `retry: 3000` first and then one frame per `SseFrame`; a closed connection
  calls the limiter's release function exactly once, in `cancel()` or in the `done` path.

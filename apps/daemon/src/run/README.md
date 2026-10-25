# `run`

The run engine: one run from `queued` to `succeeded`, `failed`, `cancelled` or a parked
`pr_open`, with every effect behind an injected port. No HTTP route lives here.

## Files

- `ports.ts` — the injected ports, the run settings the engine reads and the engine contract.
- `engine.ts` — the flow, the state writes with their events, cancel, timeout, cost cap, the
  single transport retry and the secret-scan step that turns a green gate red before the push.
- `commit.ts` — one commit for a worktree the agent left uncommitted, trailer in the body.
- `pr-body.ts` — the PR body generated from the run's facts, never from the model.
- `events.ts` — one event persisted with its `seq`, then handed to the emitter; approval ids.
- `engine.test.ts` — the happy path, the parked cases, cancel, timeout, cost cap, retries and the
  secret-scan gate step.
- `commit.test.ts` — a real temporary repository plus a runner that reports a clean index.
- `pr-body.test.ts` — every section, the guardrail boxes and the absent secrets.
- `modules.test.ts` — `run` and `gate` stay absent subsystems and the daemon still boots.
- `README.md` — this map.

## Notes

- `run/index.ts` and `gate/index.ts` must not exist: the subsystem loader imports
  `./<name>/index.js`, and a file there without `createModule` fails the boot. Both stay
  absent until the API task wires them.
- Every state change and its event share one transaction; the emitter sees the same record
  that was stored.

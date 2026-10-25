# `@codebox/opencode`

The only package that knows the OpenCode wire: a `fetch`-based `AgentRuntime` over the pinned
V2 HTTP surface, the normaliser that turns raw agent events into `@codebox/contracts` SSE
events, the versioned run envelope as data, a supervisor whose process, clock and port probe
are injected, and `FakeOpenCode`, an in-process server the tests and the e2e suite bind to.

No dependency is installed for this: `@opencode/client` is not used, the wrapper speaks the
endpoint table in [`docs/agent-runtime.md`](../../docs/agent-runtime.md) §3 with Node
built-ins and the injected `fetch`. No process, timer or ambient clock lives here either: the
daemon owns spawning, sleeping and probing, and passes them in.

## Files

- `package.json` — workspace manifest.
- `tsconfig.json` — build and typecheck configuration.
- `README.md` — this file map.
- `fixtures/` — five recorded scenarios, one JSON frame per line, in stream order.

## `src/`

- `index.ts` — public entry point; re-exports every name once, grouped by module.
- `types.ts` — `AgentRuntime` and the vocabulary it speaks: sessions, models, agents, raw events, options.
- `errors.ts` — `AgentError`, its seven codes, `isRetryable` and the mapping to the contract error code.
- `wire.ts` — the `unknown`-in decoders for health, session, models, agents and events, plus `encodeEvent`.
- `client.ts` — `createAgentRuntime`: the loopback guard, the request mapping, the one-reconnect stream.
- `normalise.ts` — `createNormaliser`: raw events into `run.*` / `chat.*` contract events, permissions and usage.
- `prompt.ts` — `RUN_ENVELOPE_VERSION`, `RUN_ENVELOPE_TEMPLATE` and `buildRunEnvelope`.
- `supervisor.ts` — `createSupervisor`: adopt, spawn, probe, back off, stop, with injected effects.
- `fake.ts` — `startFakeOpenCode`: a loopback HTTP server with scripted events and failure switches.

## `src/` tests

- `index.test.ts` — the entry point exports, `AgentError`, `isRetryable` and `toContractErrorCode`.
- `wire.test.ts` — every decoder, every rejection and the encode/decode round trip.
- `client.test.ts` — base URL guard, every method against `FakeOpenCode`, and the error mapping.
- `stream.test.ts` — subscribe, reconnect once, `agent_unavailable`, `stream_lost` and unknown frames.
- `normalise.test.ts` — both scopes, the seq and ts sources, permissions and the absent tool input.
- `prompt.test.ts` — the envelope compared against a literal, the version and the verbatim prompt.
- `supervisor.test.ts` — spawn, adopt, restart budget, unhealthy kill, stop and status events.
- `fixtures.test.ts` — the five replays, the documented timelines and the contract-schema check.

## `fixtures/`

- `run-success.jsonl` — busy, two text chunks, a tool start, a final chunk, usage, idle.
- `permission.jsonl` — busy and one permission request.
- `interrupt.jsonl` — busy, one chunk, idle.
- `stream-drop.jsonl` — the frames of both connections of a dropped stream.
- `server-crash.jsonl` — busy and one chunk before the server dies.

## Checks

- `npx vitest run --project packages/opencode` runs this package alone.
- `npm run lint`, `npm test` and `npm run build` from the repository root.
- Purity: no `process.env`, `Date.now()`, `setTimeout`, `setInterval` or `node:child_process`
  under `src/`, and `@codebox/contracts` / `@codebox/core` are imported type-only.

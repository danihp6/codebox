# `@codebox/contracts`

Zod schemas, API types and event types shared by the daemon and the app. Owned by Task-03.

The executable form of [`docs/api.md`](../../docs/api.md) and the `CB_*` table of
[`docs/providers.md`](../../docs/providers.md): a payload that is not in these schemas does
not exist. No I/O, no logger, no `Date.now()`; `zod` is the only runtime dependency.

## Files

- `package.json` — workspace manifest, `zod` pinned exactly.
- `tsconfig.json` — build and typecheck configuration.
- `README.md` — this file map.

## `src/`

- `index.ts` — public entry point; re-exports every name once, grouped by module.
- `primitives.ts` — ids, timestamps, slugs, cron and timezone shapes, run states, scopes and the 20 SSE event names.
- `parse.ts` — `parseOrThrow`, `ContractParseError` and the `boundary.field` issue path.
- `errors.ts` — the `docs/api.md` §3 error envelope and its status map.
- `pagination.ts` — the §4 limits, the page envelope and the idempotent routes.
- `resources.ts` — every resource of `docs/api.md` §5 with one `parse*` helper each.
- `events.ts` — the §6 SSE union, the gap control frame and the retry constants.
- `config.ts` — `CodeboxConfig`, the `CB_*` schema with the documented defaults and `parseConfig`.
- `openapi.ts` — the OpenAPI 3.1 document built from the schemas, plus its 3.1 shape check.
- `parse.test.ts` — the issue path rules.
- `primitives.test.ts` — ids, scalars, enums and the D14 event list.
- `errors.test.ts` — the envelope and its status map.
- `resources.test.ts` — one fixture per resource, strictness and the guardrail ids.
- `events.test.ts` — one fixture per event, the gap frame and the data types.
- `config.test.ts` — defaults, production rules, secret redaction and the key list.
- `openapi.test.ts` — the 3.1 shape, the `$ref` rule and the `docs/api.md` route comparison.
- `index.test.ts` — smoke test of the public entry point.

## Checks

- `npm run lint`, `npm test` and `npm run build` from the repository root.
- `npx vitest run --project packages/contracts` runs only this package's tests.
- `npx vitest run --project packages/contracts -t 'docs/api.md routes match the OpenAPI paths'`
  proves the document and `docs/api.md` name the same routes.

`parseConfig` reads nothing: it takes the environment as an argument and ignores every key
outside the `CB_` prefix, while an unknown `CB_*` key (a pipeline or OCI key included) is a
failure, so `CB_AGENT_*` and `CB_OCI_*` never leak into the daemon schema.

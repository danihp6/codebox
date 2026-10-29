# `@codebox/backlog`

The repository's backlog file as data: turn `TODO.md` markdown into ordered items, rewrite one
checkbox, and pick the next item a schedule may work on (D56, `docs/jobs.md` §16). Pure functions
only — no clock, no I/O, no environment, no second parser: the markdown arrives as a string and
the `works` rows arrive as plain objects, imported type-only from `@codebox/contracts` so
`npm test` runs before `npm run build`.

## Files

- `package.json` — workspace manifest.
- `tsconfig.json` — build and typecheck configuration.
- `README.md` — this file map.

## `src/`

- `index.ts` — public entry point; re-exports the surface once.
- `types.ts` — `BacklogEntry` (with its `needs`), `ParsedBacklog`, `TickOutcome` and the selection shapes.
- `parse.ts` — `parseBacklog`, the ref pattern, the item/section grammar and the dependency attachment.
- `dependencies.ts` — `needsOf`, the frozen `*Dependencies:*` grammar: the first marker, `none`, ranges and self removal.
- `tick.ts` — `applyTick`, the one-checkbox rewrite that leaves every other byte alone.
- `select.ts` — `selectNextItem`, the §16 refusal order and its result.
- `parse.test.ts` — the fixture in file order, sections, bodies, needs, duplicate refs and the grammar.
- `dependencies.test.ts` — the grammar, the `none` forms, duplicates, self and the padded ranges.
- `tick.test.ts` — one differing line, `already_done`, `missing`, `ambiguous` and CRLF.
- `select.test.ts` — every selection case and every refusal reason.
- `live-todo.test.ts` — the repository's own `TODO.md`, structural invariants only.
- `fixtures/todo.md` — the pinned markdown the three suites share.

## Checks

- `npm run lint`, `npm test` and `npm run build` from the repository root.
- `npx vitest run --project packages/backlog` runs only this package's tests.

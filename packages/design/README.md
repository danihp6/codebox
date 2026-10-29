# `@codebox/design`

The repository's `design/` directory as data: DTCG tokens, the route map and the per-screen
specs, plus the four answers the gate asks of them — is any colour written outside the tokens,
does every route name a component, does every screen declare its three states, does every
declared snapshot hash match its export. Pure functions only: no clock, no filesystem, no
environment, and no image decoding — the only thing done to a PNG is hashing its bytes.

## Files

- `package.json` — workspace manifest.
- `tsconfig.json` — build and typecheck configuration.
- `README.md` — this file map.

## `src/`

- `index.ts` — public entry point; re-exports the surface once.
- `types.ts` — the document shapes, the four rule names, `DesignFinding` and
  `DesignDocumentError`.
- `tokens.ts` — `parseTokens` (nested DTCG groups, aliases and cycles) and `tokenValues`.
- `routes.ts` — `parseRoutes`; an empty component is data here, not a parse error.
- `screens.ts` — `parseScreenSpec`; a missing state becomes `null`.
- `check.ts` — `checkDocuments` and `checkPatch`, the four rules over the parsed documents and
  over the added lines of a diff.
- `snapshot.ts` — `snapshotHash` and `checkSnapshots`.
- `tokens.test.ts` — flattening, aliases, every pinned `$type`, and each parse error.
- `routes.test.ts` — the route list, an empty component kept as data, and the rejected shapes.
- `screens.test.ts` — the three states, the hash format and the rejected shapes.
- `check.test.ts` — the four document rules, the caption colour rule and the patch walk.
- `snapshot.test.ts` — the pinned hashes, a match, a mismatch and a missing export.
- `fixtures/tokens.json` — a small DTCG document the suites share.
- `fixtures/routes.json` — the route map that matches `fixtures/screens/`.
- `fixtures/screens/dashboard.json` — a complete screen spec, `Repo · backlog`'s is its sibling.
- `fixtures/screens/repo-backlog.json` — a screen whose name carries a `·`.
- `fixtures/patch/colour-outside.patch` — one added line with a hardcoded hex.
- `fixtures/patch/clean.patch` — a token literal, an allowed line and the token document.

## Notes

- A group is a pure container: a node carrying a `$` key and no `$value` is a token that is
  missing its value, never a group with metadata.
- `screenSlug` is `design/README.md` §4's rule: spaces around a `·` dropped, the rest
  kebab-cased and lowercased, so `Repo · backlog` is `repo-backlog`.
- The package declares no `test` script: it is a Vitest project, and the coverage guard fails a
  workspace the gate would run twice.

## Checks

- `npm run lint`, `npm test` and `npm run build` from the repository root.
- `npx vitest run --project packages/design` runs only this package's tests.

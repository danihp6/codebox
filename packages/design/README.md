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
- `types.ts` — the document shapes, the measured layout shapes, the four rule names,
  `DesignFinding` and `DesignDocumentError`.
- `tokens.ts` — `parseTokens` (nested DTCG groups, aliases and cycles) and `tokenValues`.
- `routes.ts` — `parseRoutes`; an empty component is data here, not a parse error.
- `screens.ts` — `parseScreenSpec`; a missing state becomes `null`, and a layout's token keys
  are checked against the token document when one is given.
- `check.ts` — `checkDocuments` and `checkPatch`, the four rules over the parsed documents and
  over the added lines of a diff.
- `snapshot.ts` — `snapshotHash` and `checkSnapshots`.
- `import.ts` — the import-map parser and the projection of one Figma page into routes, screen
  specs and the mapped fills, plus the hash that fills a spec's field.
- `tokens.test.ts` — flattening, aliases, every pinned `$type`, and each parse error.
- `routes.test.ts` — the route list, an empty component kept as data, and the rejected shapes.
- `screens.test.ts` — the three states, the hash format and the rejected shapes.
- `layout.test.ts` — the measured layout: padding and gap, reading order, token-key membership,
  the projection into a spec and the projection without a token document.
- `check.test.ts` — the four document rules, the caption colour rule and the patch walk.
- `snapshot.test.ts` — the pinned hashes, a match, a mismatch and a missing export.
- `import.test.ts` — the mapped and unmapped frames, a missing caption, the three states, the
  duplicates, the component rule and the hash round trip.
- `fixtures/tokens.json` — a small DTCG document the suites share.
- `fixtures/routes.json` — the route map that matches `fixtures/screens/`.
- `fixtures/screens/dashboard.json` — a complete screen spec, `Repo · backlog`'s is its sibling.
- `fixtures/screens/repo-backlog.json` — a screen whose name carries a `·`.
- `fixtures/patch/colour-outside.patch` — one added line with a hardcoded hex.
- `fixtures/patch/clean.patch` — a token literal, an allowed line and the token document.
- `fixtures/figma/file.json` — the page snapshot the import suite projects: every mapped caption
  and the frames outside the map.
- `fixtures/figma/file-missing.json` — the same page with the Dashboard frame renamed.
- `fixtures/figma/import.json` — a byte copy of `design/import.json`, asserted equal by the suite.
- `fixtures/figma/export-dashboard.png` — a 1 × 1 PNG, hashed and never decoded.
- `fixtures/figma/layout.json` — a projected page with one measured frame: literal fills that
  become token keys, one colour outside the tokens and a full layout.

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

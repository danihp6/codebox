# `@codebox/git-provider`

The `GitProvider` port: GitHub first, GitLab later. One adapter owns GitHub's wire shapes —
the App JWT, the cached installation token, the push, the pull request, the required-check
summary and the merge — and every failure leaves as a `GitProviderError`, never as a GitHub
body. Network I/O goes through the injected `fetch`, git through the injected runner, the
clock through `now`; the package reads no `process.env` and spawns no process.

## Files

- `package.json` — workspace manifest.
- `tsconfig.json` — build and typecheck configuration.
- `README.md` — this file map.

## `src/`

- `index.ts` — public entry point; re-exports every name once, grouped by module.
- `types.ts` — the port: `GitProvider`, its inputs and results, the git runner shape, the log sink and `GitHubProviderOptions`, plus `toPullRequestRef`.
- `errors.ts` — `GitProviderError`, the provider code vocabulary and `toContractErrorCode`.
- `jwt.ts` — the RS256 App JWT minted from the private key with `node:crypto`.
- `tokens.ts` — the token sources (App installation, PAT, none), `decodePrivateKey`, the shared request helper and the HTTP-to-error mapping.
- `github.ts` — `createGitHubProvider`: repo verification, push, idempotent PR open, checks, merge, close and branch delete.
- `fake.ts` — `startFakeGitHub`, the in-process GitHub surface every suite talks to.
- `index.test.ts` — the exported surface, the error vocabulary mapping and the README map.
- `jwt.test.ts` — header, claims, unpadded base64url and real RSA verification.
- `tokens.test.ts` — mint, cache, refresh margin, invalidate, PAT, `none` and key decoding.
- `provider.test.ts` — repo reads, headers, the 401 refresh, the read-only mode and every HTTP-to-error mapping.
- `push.test.ts` — the two git argument lists, the in-URL credential and the push failure mapping.
- `pull-request.test.ts` — create, update by branch, labels, draft and `mergeable: null`.
- `checks.test.ts` — the required-check summary and its `checks_red` hand-off to `@codebox/core`.
- `merge.test.ts` — the 200/405/409/422/403 merge mapping and the idempotent close and delete.

## Choices

- No Octokit: the documented REST surface needs a few `fetch` calls, and the port is the
  contract the daemon and the app share.
- The installation token lives only in memory and in the git argument of one push; a 401
  invalidates it and retries the same request once.
- The fake is a real loopback HTTP server so every suite exercises the request helper, the
  headers and the status mapping rather than a hand-written fetch stub.

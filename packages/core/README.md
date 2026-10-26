# `@codebox/core`

Domain rules: jobs, runs, approvals, state machines and policies. Pure functions only: no
I/O, no clock, no environment, no randomness — time and configuration are always arguments.
`@codebox/contracts` is imported type-only, so the package builds and tests before the
contract's `dist` exists.

## Files

- `package.json` — workspace manifest.
- `tsconfig.json` — build and typecheck configuration.
- `README.md` — this file map.

## `src/`

- `index.ts` — public entry point; re-exports every name once, grouped by module.
- `run-state.ts` — the D14 transition table, terminal and cancellable states, typed rejections.
- `guardrails.ts` — the D12 auto-merge evaluation of one set of facts into guardrails and blockers.
- `cron.ts` — the five-field parser, IANA validation, next fire and next fires with DST rules.
- `misfire.ts` — the D13 grace-window decision for a missed fire.
- `protected-paths.ts` — glob compilation, path normalisation and the D26 protected-path scan.
- `diff-budget.ts` — the D26 file and line budget.
- `permissions.ts` — the D27 permission matrix, tool classes and the worktree containment check.
- `limits.ts` — the D29 daily/job cost caps and the run timeout.
- `admission.ts` — the D15 global and per-repository concurrency caps as one pure decision.
- `usage.ts` — the telemetry ranges, their window, the UTC days it spans and the in-range summary.
- `run-state.test.ts` — the 9 × 9 transition walk.
- `guardrails.test.ts` — one red and one green case per guardrail.
- `cron.test.ts` — parser failures, the Madrid DST rows and the impossible date.
- `misfire.test.ts` — not due, on time and outside the grace window.
- `protected-paths.test.ts` — the glob rules, the pinned paths and deduplication.
- `diff-budget.test.ts` — the 40 files / 2 000 line boundary.
- `permissions.test.ts` — the matrix and the fail-closed cases.
- `limits.test.ts` — cost caps and timeouts.
- `admission.test.ts` — the per-repo refusal first, the free slots and the zero limits.
- `usage.test.ts` — the four windows, the midnight-spanning day list and the six-decimal sum.

## Checks

- `npm run lint`, `npm test` and `npm run build` from the repository root.
- `npx vitest run --project packages/core` runs only this package's tests.

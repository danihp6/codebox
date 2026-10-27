# `@codebox/scheduler`

The one seam the daemon calls on every tick: validate a cron and IANA zone, turn the due
rows into an ordered claim plan with the D13 grace decision, and recompute the next fire from
`now`. Pure functions only — no clock, no I/O, no environment, no timers and no second cron
parser: the arithmetic arrives as an injected `CronEngine` from `@codebox/core`, imported
type-only so `npm test` runs before `npm run build`.

## Files

- `package.json` — workspace manifest.
- `tsconfig.json` — build and typecheck configuration.
- `README.md` — this file map.

## `src/`

- `index.ts` — public entry point; re-exports the surface once, grouped by module.
- `types.ts` — `CronEngine`, `MisfireResolver`, the `Schedule` row and the plan shapes.
- `clock.ts` — the epoch-aligned tick delay, its configured range and `isTickSeconds`.
- `tick.ts` — `planTick`, the claim key and the next-fire preview `planFires`.
- `validate.ts` — `validateSchedule`: the cron failure code, the zone, or the next fire.
- `resume.ts` — `planResume` from `now` and `planPause` to a null next fire.
- `admission.ts` — `planAdmission`, the D15 waiting list in repository-first order.
- `routines.ts` — the `Schedule` mapping, `planRoutineTick` and `nextRoutineFire` for D38.
- `window.ts` — the D46 loop: `planNextFire`, the half-open window and its DST gap.
- `index.test.ts` — the frozen surface, the claim key and a deterministic plan.
- `tick.test.ts` — grace, double tick, paused jobs, no next fire and the preview.
- `tick-dst.test.ts` — the pinned Madrid DST rows observed through `planTick`.
- `ordering.test.ts` — `scheduledFor`, `createdAt`, `ownerId` order and the claim limit.
- `admission.test.ts` — three slots, the fourth waiting, a busy repo skipped and determinism.
- `validate.test.ts` — every failure code and the next fire on success.
- `resume.test.ts` — pause, resume from `now`, and the invalid cron or zone.
- `clock.test.ts` — the pinned tick delay and the configured range.
- `routines.test.ts` — the routine mapping, the Madrid DST rows, the grace and the first fire.
- `window.test.ts` — the cooldown inside a window, the three stops, the DST gap and the wrap.

## Checks

- `npm run lint`, `npm test` and `npm run build` from the repository root.
- `npx vitest run --project packages/scheduler` runs only this package's tests.

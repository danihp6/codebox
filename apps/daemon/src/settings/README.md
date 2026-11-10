# `apps/daemon/src/settings`

The projection the `admin` subsystem serves and the run engine honours: one effective
`Settings` built from the boot configuration plus the two stored rows, with quiet hours read
from the push preferences (D51, D61).

## Files

- `effective.ts` — `effectiveSettings` and `effectiveAutomerge`: the stored `automerge` and
  `timezone` over the `CB_*` defaults, the quiet-hours read and the `parseSettings` boundary.
- `effective.test.ts` — the config defaults, the stored overrides, the two malformed-row
  fallbacks and the quiet-hours read.

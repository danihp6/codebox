# `gate`

The repository's own check. It runs inside the run's worktree before any PR exists, and its
verdict is the `gate` guardrail.

## Files

- `run-gate.ts` — spawn the stored gate command with the allowlisted child environment, log
  every byte, keep the tail and decide timeout, cancel and spawn failures.
- `run-gate.test.ts` — a clean exit, a red exit, the log and the tail, the timeout and its
  process group, cancel, a missing shell and the environment allowlist.
- `README.md` — this map.

## Notes

- The child never inherits the daemon's environment: only `PATH`, `HOME`, `TMPDIR`, `CI`,
  `NO_COLOR` and `CB_RUN_ID` reach it.
- Exit codes are part of the contract: `124` is a timeout, `130` a cancel and `127` a spawn
  failure. A spawn failure resolves, it never rejects.

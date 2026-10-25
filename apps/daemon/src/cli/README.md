# `cli`

The `cb` executable: a thin, transport-first client over `/v1`. It never opens SQLite, never
imports another daemon module and never prints a token. `bin/cb.mjs` is the entry point;
everything below is the command surface behind it.

## Files

- `main.ts` — the environment and token resolution, the transport wiring and the exit-code
  mapping.
- `args.ts` — the argv parser: commands, positionals, value and boolean flags, usage errors.
- `transport.ts` — the transport port, the HTTP implementation, the error-envelope decoder and
  the status-to-exit-code rule.
- `output.ts` — human tables, JSON lines, the API-error line and token redaction.
- `doctor.ts` — the eight checks, the pass/fail rule and the one-line-per-check format.
- `commands.ts` — one function per command, the script runner and the usage text.
- `args.test.ts` — the parser, the rejected flags and the frozen command list.
- `transport.test.ts` — headers, query encoding, non-2xx answers, timeout, unreachable and a
  body that is not JSON.
- `doctor.test.ts` — the eight checks in order, the thresholds, the `missing_route` skips and
  the exit codes.
- `commands.test.ts` — request shapes, exit codes, the script wrappers, the file-import scan
  and the no-token-in-output rule.
- `main.test.ts` — no arguments, help, version, the exit codes, token resolution, the base URL
  and the output helpers.
- `README.md` — this map.

## Notes

- `cli/index.ts` must not exist: the subsystem loader imports `./cli/index.js`, and a file
  there without `createModule` fails the boot. The CLI is a second entry point, not a module.
- The only allowed imports are relative siblings (`./`), `node:*` and `@codebox/contracts`.
  `commands.test.ts` fails when a file breaks that rule, so the CLI cannot drift into
  `src/app.ts` or a repository.
- Exit codes are part of the contract: `0` success, `1` a failed `doctor` check, `2` usage,
  `3` unreachable/timeout/non-JSON, `4` `401`/`403`, `5` any other non-2xx, and the child's code
  for `update`/`backup`.
- Every line goes through the token redactor before it is written: the resolved token and any
  `Bearer <value>` become `<redacted>`, and no request header is ever rendered.
- `cb brake status` prints `on` when `settings.automerge` is `false`: the brake stops merges, it
  is not the merge switch.
- `cb status --json` prints `{ "health", "runs", "settings" }`, where `runs` is the array of
  running runs and `settings` is `null` when the route is absent.
- `cb update` and `cb backup` spawn `/usr/local/lib/codebox/upgrade.sh` (`--to`, `--rollback`)
  and `/usr/local/lib/codebox/backup.sh` (`--verify`), pass their streams through redacted and
  return the child's exit code.
- `cb logs` and `cb events` print `ts type data` per event; a body of `{ data: [...] }` and a
  bare array are both accepted, and an event that carries its timestamp inside `data` still
  prints one.
- `cb revert` sends an empty JSON object when `--job` is absent, so a strict server schema never
  sees a bodyless POST.

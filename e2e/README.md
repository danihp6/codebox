# e2e

The happy path, end to end: one throwaway control plane (temp root, local seed remote, clone
cache, loopback OpenCode and GitHub fakes, a daemon on an ephemeral port) drives pair → add repo
→ run → gate → PR → merge → push. No host outside `127.0.0.1`, no real credential, no
`codebox.service`, no port 4096, no `/var/lib/codebox`.

Both halves need a built tree first (`npm run build`): `harness/environment.mjs` imports the
daemon and the workspaces package from their `dist`.

- `npm run e2e:unit` is the headless half: `node --test "e2e/unit/*.test.mjs"`, no browser, and
  it runs the API flow twice in a row in a fresh temp root each time.
- `npm run e2e` needs Chromium (`npx playwright install chromium`) and drives the built app.
- The two `[live]` measurements live in `.github/workflows/e2e.yml`: the Playwright step runs
  twice inside `unshare -rn`, and the workflow is the only place that measures them.

## Files

- `README.md` — this map and the two commands.
- `playwright.config.mjs` — one worker, no retries, the report under `node:os` `tmpdir()`.
- `tests/fixtures.mjs` — the slug, branch, gate and backlog ref the browser flow types, plus `withEnvironment`.
- `tests/happy-path.spec.mjs` — the browser flow: pair, add the repository, run the work, assert the merge.
- `harness/clock.mjs` — `FIXED_NOW`, `FIXED_SEED`, the seeded generator and the seeded temp-root token.
- `harness/environment.mjs` — one environment: seed remote, clone cache, fakes, daemon, paired harness device, polls.
- `harness/flow.mjs` — the API flow: repository, work, run, gate, PR, merge, push, event list.
- `harness/git-fixture.mjs` — the fixture `TODO.md`, the seed commit, the bare remote and the clone cache with its `insteadOf` rewrite.
- `harness/http.mjs` — the loopback API client: bearer token, JSON and a real `Retry-After` pause on `429`.
- `fakes/opencode.mjs` — an OpenCode wire fake that edits the session's directory and emits the six frames.
- `fakes/github.mjs` — the shipped GitHub fake behind a proxy that reports the seed commit as `base.sha`.
- `unit/flow.test.mjs` — the API flow twice, the fixed clock and seed, and the identical event sequence.
- `unit/opencode-fake.test.mjs` — every frame decodes through `decodeEvent`, and the worktree file is written.
- `unit/github-fake.test.mjs` — a pull request through the proxy answers the seed commit as `base.sha`.
- `unit/git-fixture.test.mjs` — `git push <pushUrl>` from a cache worktree lands in the seed remote.

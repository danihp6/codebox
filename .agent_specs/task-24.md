# Spec: Task-24 — OCI extraction, remainder

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** ops (`ops/oci/**`, one workflow, one doc, one test-runner registration).
- **Role:** Dev.
- **Objective:** the part of the OCI extraction that is still missing becomes reproducible
  and testable **without a tenancy**: `ops/oci/provision.sh` can describe the whole network
  (`--plan`, printing every `cb-*` name, CIDR, ingress rule and the OCID action it would
  take, with **no network call**), apply it idempotently (`--apply`) and tear it down
  (`--destroy`), in the order `docs/oci.md` §3 fixes; `ops/oci/policy.md` holds the
  `cb-ci` / `cb-instance` IAM split verbatim from `docs/oci.md` §2; and the retry script's
  five documented outcomes (capacity, throttle, bad shape, missing key, already-running
  instance) plus the `--plan` contract become shell tests that run inside `npm test` under a
  new `ops` Vitest project. The workflow's `[live]` criterion is written down with its
  measurement but is **not** measured by this batch.
- **Environment:** worktree `../wt-cb-24`, branch `task-24`, base `main` @ `623ed82`.
  Create it with `git worktree add ../wt-cb-24 -b task-24 main` and work only inside it.
- **Dependencies:** Task-01 (merged). It produced the root `package.json` scripts
  (`test` = `vitest run`), `vitest.config.ts`, ESLint and the npm lockfile. This task reads
  `vitest.config.ts` and registers one project in it.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `ops/oci/provision.sh` (new, executable, `#!/usr/bin/env bash`)
- `ops/oci/policy.md` (new)
- `ops/oci/test/launch.test.mjs` (new)
- `ops/oci/test/provision.test.mjs` (new)
- `ops/oci/README.md` (file map)
- `docs/oci.md` — **section: §3 Provisioning order**, and §9 Teardown only if
  `--destroy`'s behaviour needs a correction. Every other section is read-only.
- `vitest.config.ts` — one new project, `ops`, only.
- `.github/workflows/oci-retry.yml` — **only** if a defect is proven (see Contract ›
  Workflow). Untouched is the expected outcome.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/oci.md` (all sections; edited only as allowed above)
- `docs/decisions.md` (D22 prefix and extraction, D34 amended, D20 no API key on the
  instance)
- `docs/providers.md` §12 (the `CB_OCI_*` / `OCI_CLI_*` variables; **read-only**)
- `ops/oci/launch.sh`, `ops/oci/README.md`
- `.github/workflows/oci-retry.yml`, `.github/workflows/ci.yml`
- `vitest.config.ts`, `package.json`, `eslint.config.js`
- `scripts/agent/gate.test.mjs` (the style the node tests follow)

## 🔒 Contract

### `ops/oci/provision.sh`

POSIX-ish bash, `set -euo pipefail`, no Python, no `jq` requirement (`--plan` must work on a
machine with neither). Usage:

```
provision.sh --plan   [--with-vault] [--with-bucket]
provision.sh --apply  [--with-vault] [--with-bucket]
provision.sh --destroy --plan
provision.sh --destroy --apply [--purge]
```

| Invocation | Exit | Guarantee |
| --- | --- | --- |
| `--plan` | `0` | Prints the plan; **invokes no `oci` binary and makes no network call**. |
| `--plan` with a missing required variable | `2` | One `error: <VAR> is empty` line on stderr, no plan, no call. |
| `--apply` | `0` on success, `1` on an OCI error | Creates what is missing, never deletes, never updates a resource it did not create. |
| `--destroy --apply` | `0` / `1` | Deletes the network in reverse §3 order and terminates `cb-instance` with `cb-boot` preserved; **never** deletes the image (`docs/oci.md` §9). `cb-backups` is emptied only with `--purge`. |
| no mode, two modes, an unknown flag | `2` | `usage:` on stderr. |

`--plan` output rules, frozen (the tests assert these literally):

1. One line per resource, in the order of `docs/oci.md` §3 step 1–4, of the form
   `<verb> <kind> <name> …details`. `<verb>` is `create`, `reuse`, `delete` or `terminate`.
   `<kind>` is one of `vcn`, `igw`, `route-table`, `security-list`, `subnet`,
   `dynamic-group`, `policy`, `vault`, `secret`, `bucket`, `instance`. `<name>` is always
   the exact `cb-*` name from `docs/oci.md` §1.
2. It prints these names exactly: `cb-vcn`, `cb-igw`, `cb-rt`, `cb-sl`, `cb-subnet`,
   `cb-instance-dg`, `cb-instance-policy`; with `--with-bucket` also `cb-backups`; with
   `--with-vault` also `cb-vault` and four `secret` lines, `cb-github-app`,
   `cb-session-secret`, `cb-tunnel-token`, `cb-provider-keys` — the four secret names are the
   ones `docs/oci.md` §1 names in prose ("GitHub App key, session secret, tunnel token,
   provider keys"), `cb-`-prefixed like every other resource. They are the only names this
   task introduces; the report flags them for `docs/oci.md` §1's table.
3. It prints the CIDRs exactly: `10.0.0.0/16` for `cb-vcn`, `0.0.0.0/0` for the
   `cb-igw` route destination, `10.0.1.0/24` for `cb-subnet`, and an ingress rule line
   naming `22` and a `/32` source (`ingress tcp/22 from <admin-cidr>`).
4. It prints no token, no OCID of a secret and no key material. It prints the OCIDs it
   already knows from the environment (`CB_OCI_COMPARTMENT_ID`, `CB_OCI_SUBNET_ID` when
   set) or the literal `-` when a value is only known after creation.
5. Every resource name token it prints starts with `cb-`. It prints no `pkm-` name ever.
6. It exits `0` without the `oci` CLI installed and without a single executable call. The
   test proves this with a fixture `oci` that appends to `$CB_OCI_FAKE_LOG`; in `--plan`
   that file must not exist.

Required variables: `CB_OCI_COMPARTMENT_ID` and `CB_OCI_ADMIN_CIDR` (the admin `/32`;
`docs/oci.md` §1 fixes the ingress rule, the value is the operator's). Optional:
`CB_OCI_SUBNET_ID`, `CB_OCI_VAULT_ID`, `CB_OCI_BUCKET`, `CB_OCI_INSTANCE_NAME` (default
`cb-instance`). The region is not a `CB_*` key: `--apply` and `--destroy` let the CLI read
`OCI_CLI_REGION`, and `--plan` needs no region at all.

`--plan` cannot probe the tenancy, so it must not pretend to: the verb is `create` for a
resource whose OCID it does not already have from the environment, `reuse` for one named by
an OCID it was given (`CB_OCI_SUBNET_ID`, `CB_OCI_VAULT_ID`, `CB_OCI_BUCKET`), and `delete`
or `terminate` only under `--destroy`. Where an OCID is only known after creation, the
details column prints `-`. (`docs/oci.md` §3's "the OCIDs it would create" is imprecise and
is corrected in the same edit: it prints the OCIDs it already knows and `-` for the rest.)

`--apply` and `--destroy` call the OCI CLI in this shape (the fixture in the tests matches
on the leading words, so do not reorder them):

```
oci network vcn get --vcn-id …            # existence probe, ignores a 404
oci network vcn create --cidr-blocks '["10.0.0.0/16"]' --display-name cb-vcn …
oci network internet-gateway create --display-name cb-igw …
oci network route-table create --display-name cb-rt …
oci network security-list create --display-name cb-sl …
oci network subnet create --display-name cb-subnet --cidr-block 10.0.1.0/24 …
oci iam dynamic-group create --name cb-instance-dg …
oci iam policy create --name cb-instance-policy …
oci kms vault create --display-name cb-vault …
oci os bucket create --name cb-backups …
```

Idempotency rule: every create is preceded by a lookup by **name** inside
`CB_OCI_COMPARTMENT_ID`; a hit prints `reuse`/`skip` and does not call `create`. `--destroy`
deletes in reverse order of §3.

### `ops/oci/policy.md`

A short document, no code. It must contain, verbatim and with no invented statement:

- the `cb-ci` block exactly as `docs/oci.md` §2 lists it (11 `Allow group cb-ci …` lines);
- the `cb-instance` block exactly as `docs/oci.md` §2 lists it (3
  `Allow dynamic-group cb-instance-dg …` lines), with `<compartment>` left as the
  placeholder and a note that the compartment is `CB_OCI_COMPARTMENT_ID`;
- one line stating that the instance holds no OCI API key (D20);
- one line stating that nothing here grants Vault, Object Storage or IAM to `cb-ci`.

It may not add a grant, narrow a grant, or rename a resource.

### Tests (`ops/oci/test/*.test.mjs`)

Plain Node ESM + `vitest` + `node:child_process` / `node:fs` / `node:os` / `node:path`.
**No new dependency** — no shell-test helper, no `bats`, no `zx`, no `execa`. Each test:

1. builds an isolated environment: `const env = { ...process.env }` minus every `CB_OCI_*`,
   `OCI_CLI_*` and `GITHUB_OUTPUT` key, plus only the variables that case needs;
2. writes a fake `oci` executable into a fresh `fs.mkdtempSync(path.join(os.tmpdir(),
   'cb-oci-'))` directory, `chmodSync(0o755)`, and prepends that directory to `PATH`. The
   fake appends its own argv to `$CB_OCI_FAKE_LOG` (`printf '%s\n' "$*" >> "$CB_OCI_FAKE_LOG"`)
   and answers according to its arguments;
3. runs the script with `spawnSync('bash', [scriptPath, ...args], { env, encoding: 'utf8',
   timeout: 30_000 })` and asserts on `status`, `stdout`, `stderr`, the fake's log and
   `GITHUB_OUTPUT`;
4. removes the temp directory in `afterEach`.

A shared `baseEnv()` helper returns the nine variables `launch.sh` requires
(`OCI_CLI_USER`, `OCI_CLI_FINGERPRINT`, `OCI_CLI_TENANCY`, `OCI_CLI_REGION`,
`OCI_CLI_KEY_CONTENT`, `CB_OCI_COMPARTMENT_ID`, `CB_OCI_SUBNET_ID`, `CB_OCI_IMAGE_ID`,
`CB_OCI_AD`, `CB_OCI_SSH_PUBLIC_KEY`) with dummy values; each case overrides or deletes the
one it is about.

`launch.test.mjs` — five cases, one test each, titled exactly:

- `capacity: an OutOfHostCapacity answer exits 0 and hands the wait on` — the fake exits 1
  with stderr `ServiceError: { "code": "OutOfHostCapacity", "message": "Out of host
  capacity" }`. Expect `status === 0`, stdout matching `/no capacity yet/`, and the
  `GITHUB_STEP_SUMMARY` file containing `No slot yet`.
- `throttle: a TooManyRequests answer is retried and counted` — stderr
  `{ "code": "TooManyRequests" }`, `CB_OCI_ATTEMPTS=2`. Expect `status === 0`, stdout
  matching `/rate-limited by Oracle/` and `/2 of them throttled/`.
- `bad shape: a malformed CB_OCI_SHAPES entry exits 2 before any call` — `CB_OCI_SHAPES='2/12
  1/x'`. Expect `status === 2`, stderr matching `/is not <ocpus>\/<gb>/`, and the fake's log
  absent.
- `missing key: an empty CB_OCI_SSH_PUBLIC_KEY exits 2 and names the variable` — delete the
  key from the environment. Expect `status === 2`, stderr containing the literal
  `CB_OCI_SSH_PUBLIC_KEY`, stdout `''`, the fixture's dummy key material absent from
  `stdout + stderr`, and the fake's log absent.
- `already running: a RUNNING instance parks without a launch call` — the fake answers
  `instance list` with `ocid1.instance.oc1.eu-madrid-1.aaaa`, `list-vnics` with
  `203.0.113.10`, and `instance get` with `2` for a query containing `ocpus` and `12` for a
  query containing `memoryInGBs`. `GITHUB_OUTPUT` points at a temp file. Expect
  `status === 0`, stdout matching `/already running:/`, the output file containing
  `id=ocid1.instance…`, `ip=203.0.113.10` and `shape=2/12`, and the fake's log containing no
  line with `instance launch`.

All five run with `CB_OCI_ATTEMPT_SLEEP=0`, `CB_OCI_THROTTLE_SLEEP=0`,
`CB_OCI_START_DELAY=0`, `CB_OCI_BUDGET=3600` so no test sleeps. The fake's argument
dispatch must be spelled out in the test file: match `list-vnics` first, then
`instance launch`, then `instance list`, then `instance get` + query content, then a
non-zero unknown-command exit so a mistake fails loudly instead of hanging.

`provision.test.mjs` — four tests, titled exactly:

- `plan: prints every cb-* resource name and the exact CIDRs` — run `--plan` with only the
  required variables (`CB_OCI_COMPARTMENT_ID`, `CB_OCI_ADMIN_CIDR`) and a fake `oci` on
  `PATH`, so every network resource is a `create` (no `CB_OCI_SUBNET_ID` in the
  environment). Expect `status === 0`; stdout matching
  `/create vcn cb-vcn/`, `/10\.0\.0\.0\/16/`, `/create igw cb-igw/`, `/create route-table
  cb-rt/`, `/0\.0\.0\.0\/0/`, `/create security-list cb-sl/`, `/tcp\/22/`, `/\/32/`,
  `/create subnet cb-subnet/`, `/10\.0\.1\.0\/24/`, `/create dynamic-group cb-instance-dg/`,
  `/create policy cb-instance-policy/`; and the fake's log file absent (no network call).
- `plan: --with-vault and --with-bucket add cb-vault and cb-backups and nothing else` — the
  same, plus `/cb-vault/` and `/cb-backups/`, and stdout contains no `pkm-`.
  (Assert `!/pkm-/.test(stdout)`.)
- `plan: a missing required variable exits 2 and prints nothing` — `CB_OCI_COMPARTMENT_ID`
  unset. Expect `status === 2`, stderr matching `/CB_OCI_COMPARTMENT_ID/`, stdout `''`,
  fake log absent.
- `destroy plan: the network is deleted in reverse order and the image is kept` — run
  `--destroy --plan`. Expect `status === 0`, the names `cb-subnet`, `cb-sl`, `cb-rt`,
  `cb-igw`, `cb-vcn` present with `indexOf` increasing in that order, a `/terminate instance
  cb-instance/` line mentioning the preserved boot volume, no line deleting `cb-boot` or an
  image, and the fake log absent.

`vitest.config.ts` gains exactly this project (nothing else in the file changes):

```ts
{
  test: {
    name: 'ops',
    root: './ops',
    include: ['**/test/**/*.test.mjs'],
    environment: 'node' as const,
    passWithNoTests: true,
  },
},
```

Rooted at `./ops`, the pattern `**/test/**/*.test.mjs` matches `ops/oci/test/*.test.mjs`.
The name `ops` is the project selector, so `npx vitest run --project ops` runs exactly these
files.

### Workflow (`docs/oci.md` §5, `.github/workflows/oci-retry.yml`)

**Expected outcome: no edit.** You may touch it only if a test above proves a contradiction
between `launch.sh`'s exit codes and the workflow's step conditions, and only on these
lines: the `if:` of `Attempts at a slot`, `Announce the instance` or `Hand the wait to the
next run`. Proven defects worth fixing, and nothing else:

- `launch.sh` exits non-zero on a capacity miss (it does not — that path is the expected
  answer and exits 0), or
- `launch.sh` writes `ip` for a parked instance but `steps.launch.outputs.ip != ''` skips
  the announcement, or
- the chain step runs after a configuration failure (`steps.launch.outcome == 'success'`
  is false in that case).

If you edit it, the same commit adds a test that pins the behaviour and a line in
`docs/oci.md` §5 saying what changed and why. If nothing is proven, leave the file alone and
say so in the report.

### Errors and side effects

- `provision.sh` writes nothing to disk, ever — no state file, no cache. The tenancy is the
  state.
- `--plan` is pure with respect to the network. It may read the environment only.
- No script prints a value of `OCI_CLI_KEY_CONTENT`, `CB_OCI_SSH_PUBLIC_KEY` or
  `CB_OCI_COMPARTMENT_ID`'s neighbours: the compartment OCID may be printed (it is an
  identifier, not a credential), `OCI_CLI_KEY_CONTENT` may not.

### Data

No state is written anywhere: `provision.sh` has no cache, no lock file and no `.state`
directory; the tenancy is the state, as `docs/oci.md` §4 requires of the retry. The frozen
name set is the one in `docs/oci.md` §1 plus the four vault secret names named above; the
plan's line grammar (`<verb> <kind> <name> …details`) is the machine-readable surface the
tests pin.

## 🧩 Configuration

No new `CB_*` key for the daemon. This task reads two variables that `docs/providers.md`
§12 already lists (`CB_OCI_COMPARTMENT_ID`, `CB_OCI_SUBNET_ID`) plus one new
**provisioning-only** variable, `CB_OCI_ADMIN_CIDR`, which must be read as `<ipv4>/32`.
The region is not a new key: `OCI_CLI_REGION` already covers it and only `--apply` needs it.

`docs/providers.md` is **not** in this task's exclusive paths and must not be edited. The
new variable is documented in `docs/oci.md` §3 instead, and the report flags it to the
Architect so a later task can add the row to `docs/providers.md` §12. A missing
`CB_OCI_ADMIN_CIDR` is `error: CB_OCI_ADMIN_CIDR is empty`, exit 2.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim, from the worktree root (`../wt-cb-24`).

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass, and it lints the new `.mjs` files: `eslint.config.js`
    covers `**/*.mjs`.
  - `npm test` — `vitest run` over the projects declared in `vitest.config.ts`. **A test
    that is not in one of those projects does not run and therefore does not count.** The
    new `ops` project is rooted at `./ops` with `include: ['**/test/**/*.test.mjs']`, so the
    tests must live at `ops/oci/test/*.test.mjs`: a file at `ops/oci/foo.test.mjs` (not
    under a `test/` directory) is invisible to the gate.
  - `npm run build` — untouched by this task; it must still pass.
  - `git diff --name-only main...task-24` — audit against the exclusive paths.

- **Acceptance criteria:**
  - [ ] `[unit]` The gate passes:
        `npm ci --prefer-offline --no-audit --no-fund && npm run lint && npm test && npm run build`
        exits 0.
  - [ ] `[unit]` The `ops` project is registered and is the only change to the runner:
        `git diff main...task-24 -- vitest.config.ts` adds a `name: 'ops'` block and nothing
        else, and `npx vitest run --project ops` exits 0 with `9 passed`.
  - [ ] `[unit]` The launch tests pass, one by one:
        `npx vitest run --project ops -t 'capacity: an OutOfHostCapacity answer exits 0 and hands the wait on'`,
        `-t 'throttle: a TooManyRequests answer is retried and counted'`,
        `-t 'bad shape: a malformed CB_OCI_SHAPES entry exits 2 before any call'`,
        `-t 'missing key: an empty CB_OCI_SSH_PUBLIC_KEY exits 2 and names the variable'`,
        `-t 'already running: a RUNNING instance parks without a launch call'`
        — each reports `1 passed` (TODO.md Task-24's "capacity, throttle, bad shape, missing
        key and an already-running instance").
  - [ ] `[unit]` **A dry `provision.sh --plan` prints the exact `cb-*` names and makes no
        call**:
        `npx vitest run --project ops -t 'plan: prints every cb-* resource name and the exact CIDRs'`
        reports `1 passed`, and the test's fake-`oci` log file is asserted absent — that is
        the measurement of "makes no call".
  - [ ] `[unit]` The optional blocks are additive only:
        `npx vitest run --project ops -t 'plan: --with-vault and --with-bucket add cb-vault and cb-backups and nothing else'`
        reports `1 passed`.
  - [ ] `[unit]` A missing variable is a configuration error, not a partial plan:
        `npx vitest run --project ops -t 'plan: a missing required variable exits 2 and prints nothing'`
        reports `1 passed`.
  - [ ] `[unit]` Teardown keeps the rebuild path:
        `npx vitest run --project ops -t 'destroy plan: the network is deleted in reverse order and the image is kept'`
        reports `1 passed`.
  - [ ] `[unit]` The policy split has no invented grants — the file has exactly the
        statements `docs/oci.md` §2 lists:
        `grep -c '^Allow ' ops/oci/policy.md` prints `14`, and
        `grep -c '^Allow group cb-ci to ' ops/oci/policy.md` prints `11`, and
        `grep -c '^Allow dynamic-group cb-instance-dg to ' ops/oci/policy.md` prints `3`,
        and `diff <(grep '^Allow ' docs/oci.md) <(grep '^Allow ' ops/oci/policy.md)` prints
        nothing.
  - [ ] `[unit]` The file map is complete:
        `for f in provision.sh policy.md launch.sh README.md test/launch.test.mjs test/provision.test.mjs; do grep -q "\`$(basename "$f")\`" ops/oci/README.md || { echo "README missing $f"; exit 1; }; done`
        exits 0.
  - [ ] `[unit]` The provisioning order is documented where the script is described:
        `grep -c 'CB_OCI_ADMIN_CIDR' docs/oci.md` prints at least `1`,
        `grep -c -- '--destroy' docs/oci.md` prints at least `2`, and
        `git diff main...task-24 -- docs/oci.md` touches only §3 (and §9 if `--destroy`
        needed the correction).
  - [ ] `[unit]` No live call was made by the task itself:
        `git status --porcelain` prints nothing (every change is committed) and
        `git log --format=%s main..task-24` contains no commit mentioning a dispatch or an
        `oci` command against the tenancy.
  - [ ] `[unit]` Only the exclusive paths changed:
        `git diff --name-only main...task-24 | grep -vE '^(ops/oci/|docs/oci\.md$|vitest\.config\.ts$|\.github/workflows/oci-retry\.yml$)'`
        prints nothing. `.github/workflows/oci-retry.yml` appearing in the diff is
        acceptable **only** if the same diff adds a test that pins the change and the report
        names the proven defect.
  - [ ] `[live]` **One dispatched `oci-retry` run finds the existing `cb-instance`, parks,
        announces it once and does not chain** — measurement: dispatch
        `gh workflow run oci-retry.yml --ref main` once with the real `cb-*` variables and
        secrets present, then read (a) the run's summary and step annotations for
        `already running: ocid1.instance…` and the `Announce the instance` step's outcome,
        (b) the `oci-ready` issue list for exactly one open issue whose title contains
        `cb-instance`, and (c) `oci compute instance list --compartment-id
        "$CB_OCI_COMPARTMENT_ID" --display-name cb-instance --lifecycle-state RUNNING
        --query 'length(data)'` printing `1`, and (d) the run's `Hand the wait to the next
        run` step being `skipped`.

- **This `[live]` criterion is NOT measured by this batch's QA.** It needs a real tenancy,
  real OCI credentials and the real `cb-instance`, none of which exist for a task agent, and
  the dev/reviewer is forbidden from dispatching the workflow or calling OCI. QA must report
  it as **`not-measured`**, never as `pass`; the Orchestrator opens an `agent-review` issue
  carrying the criterion and its measurement so the operator can run it once.

## 📣 Coordination

- **For the Architect:** the batch's owner of `vitest.config.ts` is this task. Two things are
  left for a later docs task: `docs/providers.md` §12 has no `CB_OCI_ADMIN_CIDR` row, and
  `docs/oci.md` §1's inventory table has no row for the four vault secret names. This task
  writes them in `docs/oci.md` §3 only.
- **For the Orchestrator:** the `[live]` criterion needs an `agent-review` issue with the
  measurement above; it cannot be closed by a task agent.
- **For Task-25 (VM image):** `provision.sh --plan` is the review artifact for the network
  the image boots into; `cb-subnet` and `cb-sl` are the inputs the image's cloud-init
  assumes. Do not renumber the §3 order.
- **For QA:** the branch tip must be `dev: done task-24` before QA starts. Do not merge. Do
  not install the OCI CLI, do not authenticate, do not dispatch a workflow.

## ⛔ Out of scope

- No file outside the exclusive paths. In particular: no `.github/workflows/ci.yml`, no
  `package.json`, no `package-lock.json`, no `docs/providers.md`, no `docs/decisions.md`, no
  `packages/**`, no `apps/**`, no `TODO.md`, no `CHANGELOG.md`.
- **No real OCI interaction of any kind.** Do not install the `oci` CLI, do not set
  `OCI_CLI_*` or `CB_OCI_*`, do not run `gh workflow run`, `gh variable set`, `gh issue
  create`, or any command against the tenancy. The only `oci` binary you may execute is the
  fixture your test writes into a temp directory.
- No new dependency. The tests are plain Node plus `vitest`; the scripts are bash plus the
  `oci` CLI that the workflow installs. No `bats`, `shellcheck` integration, `zx`, `execa`,
  `ajv`.
- Do not change `launch.sh`'s behaviour unless a test above proves it deviates from
  `docs/oci.md` §4 (which is the spec for that script): in that case make the minimal fix,
  say so in the report, and keep the test green. Any other change to `launch.sh` is out of
  scope — it is not in this task's exclusive paths.
- Do not touch `ops/image/**`, `ops/vm/**`, `docs/vm-image.md`, `scripts/agent/**`. Do not
  provision a server, a Packer template or a systemd unit.
- Do not run the product: no daemon, no app, no `launch.sh` against nothing (the tests run
  it against the fixture and that is the only permitted execution).
- No `main` commit, no merge, no push to `main`. One branch, conventional commits, last
  commit subject exactly `dev: done task-24`.

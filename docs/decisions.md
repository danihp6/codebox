# Decisions

Frozen decisions, in the order they were taken. A decision is not reopened by a task; it is
amended by a later decision that says which one it supersedes. Every other document cites
these IDs.

| ID | Decision | Why / consequence |
| --- | --- | --- |
| **D1** | The product is **Codebox**, binary `codebox`, short alias `cb`; daemon `cbd`; env prefix `CB_`; OCI prefix `cb-`. | A codebox is the box that holds the code and the agents working on it: literal, one word, and `cb` is a free command. Rejected: *Groundstation* (AWS Ground Station), *Deckhand*, *Patchbay*, *Interlock* (already used by agent tooling), *Pilotbox*, *Codecrate*, *Codehaven* (weaker, kept as fallbacks). |
| **D2** | This delivery is **documentation only**. | The first code batch is Batch 1 in `TODO.md`. No code, workflows or scripts are written before the design is reviewed. |
| **D3** | **Single operator, single tenant.** The hybrid app is the only client. No messaging-network integration in v1. | Removes an entire adapter surface, a moderation problem and a second identity system. Revisit only with a new decision. |
| **D4** | Client stack: **Angular 22 + Ionic Angular 9 + Capacitor**, standalone components, signals, PWA service worker. | Angular 22 is the active major (2026-06); Ionic Angular 9 supports 18–22. Ionic gives native-feeling navigation and Capacitor gives iOS/Android without a second codebase. |
| **D5** | The agent runtime is **OpenCode V2** (`opencode serve`) bound to **127.0.0.1**; the daemon is its only client. | No public agent port, no second auth surface. The daemon normalises events so the app never speaks OpenCode's protocol. |
| **D6** | One **`cbd` daemon** owns HTTP, SSE, scheduler, workspaces, git provider and the OpenCode supervisor. | A single process is simpler to operate on one VM than five services, and SQLite gives it one writer. |
| **D7** | **Node 24 LTS + TypeScript, ESM.** | Active LTS in 2026, native `fetch`, test runner and SQLite; no CommonJS interop. |
| **D8** | State in **SQLite (WAL)** via `node:sqlite`, migrations as numbered SQL. No ORM. | No native build step, portable backup, enough for one operator. If `node:sqlite` is still experimental on the target, the fallback is `better-sqlite3` behind the same store port. |
| **D9** | Each repository is a **bare clone cache**; each run gets its **own worktree** under `/srv/codebox/worktrees/<runId>`. | Parallel runs never share a working tree; cancellation is `git worktree remove --force`; the cache stays warm. |
| **D10** | Git provider is **GitHub App** first, with a fine-grained **PAT fallback**. A `GitProvider` port leaves room for GitLab. | App installation tokens are short-lived and scoped; the PAT path exists for a personal account that cannot install an app. |
| **D11** | Autonomy: every change lands on a **`cb/` branch + PR**, the repo's **gate** runs, and the run **auto-merges when every guardrail is green**. The owner explicitly accepted this risk. | This was chosen over manual merge. The guardrails in D12 are therefore load-bearing, not advisory. |
| **D12** | Auto-merge requires all of: local gate exit 0; GitHub required checks green; PR mergeable and base unchanged; diff within budget; no protected path; no `do-not-merge` label; repo policy `auto`; global `CB_AUTOMERGE=on`. Otherwise the PR stays open and the owner is notified. | A single unmet condition fails closed. The list is duplicated in `docs/jobs.md` and tested. |
| **D13** | Scheduling uses **5-field cron + IANA timezone**, DST-safe. A missed fire runs once if within `CB_MISFIRE_GRACE_SECONDS` (default 900), otherwise it is skipped and logged. | Predictable, no custom DSL, no silent double-runs. |
| **D14** | Run lifecycle: `queued → preparing → running → gating → pr_open → merging → succeeded`; terminal alternatives `failed`, `cancelled`. | Every transition is persisted as an event, so the app and the audit log agree. |
| **D15** | Concurrency: **1 run per repository, 2 globally** (configurable down, not up without a decision). | Protects the 2 OCPU box, avoids two agents fighting over one repo, keeps costs bounded. |
| **D16** | API is **REST `/v1` + SSE**, OpenAPI 3.1, cursor pagination, idempotency keys on mutations that start work. | SSE survives Cloudflare and mobile networks better than WebSockets for one-way events; REST is easy to test and generate clients from. |
| **D17** | App auth is **device pairing**: one-time code → device keypair → short-lived access token + refresh. Cloudflare Access is an outer layer, not the only one. | A stolen tunnel URL is not enough to command the box; a lost phone can be revoked individually. |
| **D18** | Exposure is **Cloudflare Tunnel only**; the daemon binds loopback. SSH is the only other door, restricted to the admin address. No 80/443 inbound. | Matches the OCI security model already proven in `pkm-randomlike`; removes certificate management and port scanning. |
| **D19** | Configuration is **environment variables prefixed `CB_`**, parsed with zod at boot, failing fast. Precedence: CLI flag > env > compiled default. No secrets in the repo. | One schema, one redaction list, one place to document. The full table is `docs/providers.md`. |
| **D20** | Secrets live in **OCI Vault**, read at boot by the instance principal; a `0600` env file is the development fallback. | The image is shareable and rebuildable without carrying credentials. |
| **D21** | The VM image is built with **Packer + the Oracle OCI builder** from Ubuntu 24.04 arm64; **no secrets are baked**. The app is installed from a signed release artifact. | Reproducible images, fast boot, no snowflake instance. Details in `docs/vm-image.md`. |
| **D22** | All OCI resources use the **`cb-` prefix** and the retry logic is extracted from `pkm-randomlike` into `ops/oci/` with `CB_OCI_*` variables. | The action is reusable and no longer tied to the game project. Inventory in `docs/oci.md`. |
| **D23** | Observability: structured JSON logs, a persisted event stream per run, `/v1/health`, `/v1/telemetry`, `cb doctor`. No external APM in v1. | One operator can read `journalctl`, the app's run timeline and the SQLite ledger without running a monitoring stack. |
| **D24** | **English** for docs, code, identifiers, commits and the default UI; **Spanish** for the operator's chat and an available UI locale. | Matches the workspace convention and the owner's language. |
| **D25** | Branch name `cb/<runId>-<slug>`; commit trailer `Codebox-Run: <runId>`; commit author `codebox[bot]`. | Every merge is attributable to a run, even after the app's state is gone. |
| **D26** | **Protected paths** default to `.github/**`, `ops/**`, `infra/**`, `**/*.env`, `CODEOWNERS`, `.gitmodules`; a run touching one never auto-merges. Diff budget: 40 files / 2 000 changed lines. | Prompt injection and runaway refactors are the two realistic ways an auto-merge hurts. Both fail closed. |
| **D27** | Unattended agents may edit files and run bash **inside the worktree**; `webfetch` is denied; secret-bearing env vars are not passed to the job; network is best-effort restricted. | The agent needs to build and test, not to browse or read the operator's keys. |
| **D28** | Retention: runs 90 days, events 14 days, job logs 30 days, approvals 7 days after resolution, chat messages 90 days. | Bounded disk on a 100 GB boot volume; configurable. |
| **D29** | Cost guard: `CB_DAILY_COST_USD` (default 10) and `CB_RUN_TIMEOUT_SECONDS` (default 5 400); a run that exceeds either is cancelled and reported. | Auto-merge without a cost brake is an open wallet. |
| **D30** | Notifications use **Web Push (VAPID)** for the PWA and **Capacitor Push** (FCM/APNs) for native. No third-party chat network. | One event pipeline, two transports, no new identity. |
| **D31** | The app starts from the **official Ionic Angular starter** (tabs/sidemenu) and a small custom design system. Admin templates are references, not a base. | Bootstrap-first admin templates fight Ionic's navigation and safe areas; grafting them costs more than it saves. Options and licences in `docs/app.md`. |
| **D32** | Tests: **Vitest** for daemon packages and contracts, Angular's supported unit runner for the app, **Playwright** for web e2e; acceptance criteria are tagged `[unit]` or `[live]`. A `[live]` criterion states its measurement. | A criterion nobody can execute is not a criterion. The QA wave uses the tags to budget its browser time. |
| **D33** | Backups: nightly encrypted SQLite dump + config to OCI Object Storage, 30-day retention; a restore drill is part of the beta exit. | The instance can vanish (idle reclaim); the repo and the backup are the recovery path. |
| **D34** | `pkm-randomlike`'s OCI retry was **migrated to Codebox on 2026-10-24**, before parity, by operator decision. pkm is braked (`OCI_RETRY=off`), its `pkm-vcn`/`pkm-subnet` are retired and Codebox owns `ops/oci` and the chain. | The original "do not touch pkm until parity" clause was overtaken by the operator wanting the box launched now. The autopilot's OCI wait is not load-bearing for the game; the cost of two chains on one tenancy is a shared rate limiter. Task-32 is reduced to deleting the duplicate and the stale variables. |
| **D35** | No Kubernetes, no serverless, no managed queue in v1. | One VM, one process, SQLite. Add a queue only when a measured limit demands it. |
| **D36** | A chat session **persists** across messages and app restarts, bound to one repository and one OpenCode session; it never opens a PR and never merges. | Chat is exploratory work with context; a run is a transaction. Keeping them separate is what makes "promote to run" meaningful. |
| **D37** | The **source repository is public**. Secrets stay out of the tree (D19, D20) and are held by Actions and OCI Vault. | Public repositories get free Actions minutes, which is what lets the OCI wait and the agent loop run around the clock. The exposure is the source, the docs and issue text, not a credential; if the repository ever goes private, `docs/agent-ci.md` §11's allowance check becomes load-bearing again. |
| **D38** | **Two schedules, one clock.** A **Job** is a repo transaction (worktree, gate, PR, merge). A **Routine** is a chat schedule: `prompt` (the agent answers in the chat) or `reminder` (push only, no model). A `prompt` may carry a `chatSessionId`; when it has none — or the session was archived — the daemon creates a new chat session for the fire. Routines are **created by the chat agent** through a daemon tool; unattended runs never get that tool. | The operator asks in chat ("remind me to take the pill at 10", "summarise the repo every morning") and expects it to stick. Keeping routines out of `runs` preserves D36 (chat never opens a PR) and keeps reminders free of model cost. Letting a run create schedules would turn prompt injection into a persistence primitive. |
| **D39** | Idle reclamation is answered by **measuring and doing real work, never by a fake burner**: a host timer runs a bounded liveness pass (`cb doctor`, `cb prune`, a loopback health probe) and appends the CPU, memory and network reading it took, so the operator can see how far the box is from Oracle's thresholds. D33 still owns a vanished instance. | Oracle reads the **95th percentile over seven days**, so a spike every few hours cannot move it; the only way to clear it with synthetic load is roughly an hour a day of deliberately burned CPU, which games an Always Free rule and buys nothing. Evidence plus the box's own housekeeping is honest, costs no tokens and turns a guessed risk into a visible one. |

## Frozen values

These names are contract. A task that needs a different one amends this section and the
documents that cite it.

### Paths

| Path | Contents |
| --- | --- |
| `/etc/codebox/` | `instance.env` (0600), tunnel config, no repository content. |
| `/var/lib/codebox/` | `state.db`, `events/`, `logs/`, `artifacts/`, `backups/`. |
| `/srv/codebox/repos/` | Bare clone cache, one directory per `owner__name`. |
| `/srv/codebox/worktrees/` | One worktree per run; deleted after retention. |
| `/opt/codebox/` | Installed release (daemon, app static build, migrations). |

### Environment prefix and core values

`CB_*` (full table in `docs/providers.md`). Defaults that other docs rely on:

| Key | Default |
| --- | --- |
| `CB_BIND` | `127.0.0.1:8787` |
| `CB_OPENCODE_URL` | `http://127.0.0.1:4096` |
| `CB_STATE_DIR` | `/var/lib/codebox` |
| `CB_REPO_ROOT` | `/srv/codebox/repos` |
| `CB_WORKSPACE_ROOT` | `/srv/codebox/worktrees` |
| `CB_MAX_CONCURRENCY` | `2` |
| `CB_MAX_CONCURRENCY_PER_REPO` | `1` |
| `CB_AUTOMERGE` | `on` |
| `CB_MERGE_METHOD` | `squash` |
| `CB_GATE_TIMEOUT_SECONDS` | `1800` |
| `CB_RUN_TIMEOUT_SECONDS` | `5400` |
| `CB_DAILY_COST_USD` | `10` |
| `CB_MISFIRE_GRACE_SECONDS` | `900` |

### API surface

`/v1` prefix, `Authorization: Bearer <device-token>`, SSE at `/v1/events`. The exact
resource list, payloads and error envelope are in `docs/api.md`.

### Run states

`queued`, `preparing`, `running`, `gating`, `pr_open`, `merging`, `succeeded`, `failed`,
`cancelled`.

### Event types

`run.queued`, `run.started`, `run.output`, `run.tool`, `run.permission`, `run.gate`,
`run.pr`, `run.merged`, `run.finished`, `run.failed`, `run.cancelled`, `chat.delta`,
`chat.message`, `chat.tool`, `chat.permission`, `chat.idle`, `job.changed`,
`approval.created`, `approval.resolved`, `telemetry`, `routine.fired`, `routine.replied`,
`routine.failed`.

### OCI resources

`cb-vcn`, `cb-igw`, `cb-rt`, `cb-sl`, `cb-subnet`, `cb-instance`, `cb-boot`,
`cb-workspaces`, `cb-ci`, `cb-ci-policy`, `cb-instance-dg`, `cb-instance-policy`,
`cb-vault`, `cb-backups`, `cb-tunnel`. Details in `docs/oci.md`.

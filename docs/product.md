# Product

## 1. The problem

OpenCode is good at working inside a repository, but it is tied to the machine it runs on.
On a laptop it dies with the lid; on a server it is only reachable over SSH. The operator
ends up with three disconnected things:

- a capable agent that cannot be reached from a phone,
- a backlog of small repo tasks that nobody remembers to run,
- a pile of branches and half-finished changes that need a human to shepherd them.

Codebox makes the VM the agent's home and the phone the control surface. It is not a
new agent and not a new CI: it is the place from which an existing agent is told what to do,
watched while it does it, and allowed to ship when the evidence is green.

## 2. Who it is for

**Primary (and only) persona — the owner-operator.** A developer who:

- owns one or more personal repositories and already uses OpenCode locally;
- has an always-on Linux box (or wants one) and is comfortable with SSH, git and tokens;
- wants to dispatch work from a phone at odd hours, not to manage a team;
- prefers a private tool over a SaaS, and accepts operating a daemon and a certificate-free
  tunnel;
- values a short feedback loop more than a rich project-management suite.

Explicitly not the persona: a team needing roles and audit for compliance, a non-technical
user, a user who wants to chat through a messaging app, or anyone who wants Codebox to
host their code.

## 3. Jobs to be done

| # | When | I want to | So that |
| --- | --- | --- | --- |
| J1 | A thought strikes away from the desk | send a prompt to a repo-bound agent from my phone | the idea becomes a branch before I forget it |
| J2 | A task repeats (nightly dependency bump, weekly report, release notes) | give the repository a schedule and let it consume the backlog | I stop being the scheduler |
| J3 | A run is working | watch its tools, output and diff live | I can intervene early instead of reading a wall of log later |
| J4 | The agent asks for something risky | approve or deny from a notification | autonomy never means "no gate" |
| J5 | A change is ready | see the gate, the checks and the diff stat in one card | I can trust the merge without opening a laptop |
| J6 | A merge was wrong | revert it from the app or the CLI | recovery is a first-class action |
| J7 | The box is unhealthy | see disk, queue, agent health and cost | I fix it before it silently stops working |
| J8 | I have a new repository | register it, set its gate and policy | the loop works without editing config files |

## 4. The product in six surfaces

1. **Repos.** The root. Each repository declares its gate, merge policy and protected paths in
   `.codebox/repo.yml`, its schedule in `.codebox/schedule.yml`, and its design in `design/`
   (D52, D56); the app reads those files and keeps no second copy (D51). A repository opens on
   its backlog and carries three more tabs: works, schedule and design.
2. **Backlog.** The repository's `TODO.md` rendered in the file's order, with each item's
   runtime state overlaid (D51). The order **is** the priority and the queue: there is no other
   priority and no other queue. An item is already a prompt — title, body and acceptance
   criteria — and its tick lands in the work's PR.
3. **Works.** One item, one work, as many runs as attempts (D44). The screen is the **run log**:
   deltas, tool cards, gate and PR cards, one divider per run. It has no composer: a run that
   needs a person **ends** in `needs_decision` (D45, D55).
4. **Sessions.** A chat is an editor with one target (D55): the **backlog** (`TODO.md`), the
   **design** (`design/`), the **schedule** (`.codebox/schedule.yml`), **one work** (a doubt to
   resolve, or a **rework** of a merged one) — or **no target**, which is a read-only chat about
   the repository with its context. The target is both its job and its write boundary, and a
   targeted session ends in a proposal — a diff, a decision or a new run — never in a direct
   write. The chat button on a backlog opens exactly this choice.
5. **Design.** The screen specs and snapshots a work implements against, read from the same
   worktree and shown beside the thread. The gate validates tokens, routes and declared states,
   never pixels (D52).
6. **Credentials and provider accounts.** Every secret the box holds (D49, D50): adapters that
   need OAuth or a manifest, open credentials for anything else, and **several accounts per
   provider with ordered failover** (D54). Write-only, with a host allowlist for agent access;
   the app shows `lastFour`, state and reset instant, never a value.

Plus a **dashboard** (what needs you, what is running, what finished unreviewed, today's spend,
health, one block per repository) and **settings** (repository viewers, credentials, provider
accounts, devices, notifications, danger zone). There are no interactive approvals (D45): the
gate and the disposable worktree are the only doors.

## 5. Core flows

### 5.1 "Do this now"

1. Open a repository. Its backlog is the list **and** the queue, in the file's order.
2. Tap an item → *Run*. To add one, open the backlog editor and describe it; the new line
   arrives as a one-line PR.
3. The run takes the item as its prompt and `design/` as its visual context. The agent edits,
   runs the gate, and reports with a gate card.
4. The run pushes `cb/<run>-<slug>` and opens a PR. The item's `- [x]` and the PR link ride in
   the same branch, so the merge updates the backlog atomically.
5. If every guardrail is green, it merges and the run log shows the PR card with the ticked item.
   If not, the card lists what failed and the branch stays.

### 5.2 "Every night"

1. Give the **repository** a schedule — `window 22:00–06:00`, `nextPending`, `maxFires 6`,
   cost cap per fire (D56) — from its *Schedule* tab or `.codebox/schedule.yml`.
2. Each fire takes the **next eligible item in the file's order** and opens a run of it: its own
   worktree, branch and PR. An item is skipped while it has a work queued, running or waiting
   for a decision, or once it has exhausted `maxAttempts`.
3. The window relaunches after the previous fire finished, inside `[start, end)`, bounded by the
   caps (D46). A red fire notifies once; three consecutive failures pause the schedule.
4. Nothing pending is `nothing_pending`, not an error. There is no schedule without a
   repository and no schedule that produces a conversation.

### 5.3 "What is it doing?"

1. The work's screen is its **run log**: `preparing`, `running`, tool calls, gate and PR arrive
   as cards, one divider per run, and the header carries the context percentage.
2. Tapping a tool call shows its input/output (redacted).
3. The diff tab shows files and stat; GitHub opens for the full review.
4. Cancel is always available and kills the session, not just the UI.

### 5.4 "It needs a decision"

1. A run that cannot continue without the operator **ends** in `needs_decision` and says so in
   one line; nothing waits (D45, D55).
2. The work shows an amber dot and one action: *Resolve doubt*. It opens a **decision session**
   bound to that work, which can read the run's log and diff.
3. The session answers or proposes: a decision note, a new run with a corrected prompt, or a
   backlog edit as a PR.
4. A run that ends without a doubt needs nothing: merged or failed, it is done.

### 5.4 "It needs a provider"

1. The agent calls `integration.request` with a credential name and a path.
2. The daemon checks the host against the integration's allowlist **before any DNS lookup**,
   adds the auth header server-side, and returns the response.
3. The model never sees the credential, and neither does the shell.
4. A host outside the allowlist is refused, and the refusal is logged with the credential name,
   never the value.

### 5.5 "The account ran dry"

1. The daemon classifies the provider error instead of guessing: `invalid` (401/403),
   `exhausted` (429 or a quota error) or a transient upstream failure.
2. It marks that account's state and records the reset instant the provider reports, or a
   cooldown when it reports none, then selects the next account by priority (D54).
3. The turn is retried there only if **no tool call was emitted**; otherwise the run stops and
   resumes in a new session, so a half-executed tool is never replayed.
4. The thread shows a `provider.state` line — the model never changes silently.
5. With every account dry the run fails as `provider_exhausted` and notifies. The branch and
   the work stay, and the next run resumes when an account resets.

## 6. MVP scope (v0.1)

In:

- pairing and device management;
- one owner, multiple repos, each declaring `.codebox/repo.yml` and `design/`;
- works with streaming, runs and gate cards;
- the backlog file as the work list **and** the queue, with the tick riding in the work's PR;
- sessions with three targets (backlog, design, one work) that propose and never write directly;
- one repository schedule (`once` / `every` / `window`) that consumes the backlog in file order;
- worktree isolation, gate, PR, auto-merge guardrails;
- run timeline, diff stat, cancel, revert;
- provider accounts with ordered failover (D54);
- push notifications (Web Push first, native push in the same milestone if the build is
  ready);
- dashboard with one block per repository, and repository viewers in settings;
- design validation in the gate (tokens, routes, declared states) and a snapshot viewer;
- OCI provisioning, image, tunnel, backup and `cb doctor`.

**Later:** the design importers (Figma, Penpot, OpenDesign) are commands over the `design/`
format, not a v0.1 dependency; the format, the validator and the viewer ship first (D52).
There are no free schedules and no reminders: everything recurring belongs to a repository
(D56).

Out (deliberately):

- multi-user, roles, organisations;
- GitLab (the port exists, the adapter is later);
- a mobile code editor;
- a custom CI runner or matrix builds;
- voice;
- a marketplace of prompts or agents;
- self-hosted model serving;
- Windows or macOS hosts.

## 7. Non-goals (and why)

| Non-goal | Why |
| --- | --- |
| Be a general chat assistant | The value is repo-bound work with a gate, not another chatbot. |
| Replace GitHub's review UI | The app summarises and decides; deep review stays where the diff lives. |
| Run untrusted code safely for third parties | It is a single-operator tool; the sandbox protects the operator from accidents, not from tenants. |
| Guarantee zero-risk autonomy | Auto-merge is a deliberate trade (D11); the product's job is to make the trade visible and reversible. |
| Sync across devices | The daemon is the state; devices are views. No sync engine. |

## 8. Success criteria

A v0.1 is successful when the owner can, from a phone, without SSH:

1. pair a device in under two minutes;
2. register a repo and see its gate pass on a manual run;
3. give a repository a nightly window, see it consume two backlog items and merge both green;
4. open a repository's backlog, tap an item, and watch the work land a PR with the item ticked;
5. answer a `needs_decision` work from its decision session and watch the next run finish;
5. cancel a runaway run and see the worktree cleaned;
6. exhaust one provider account mid-run and watch the next one take over without losing the
   branch;
7. revert a bad merge with one action;
8. lose the VM and restore from the nightly backup with the documented drill.

Numeric targets (measured, not aspirational):

- pairing p95 < 2 min from `cb pair` to first screen;
- work first token p95 < 3 s on the reference VM;
- run event latency (OpenCode event → app) p95 < 1.5 s;
- zero runs where a red gate reaches `merging`;
- zero secrets in logs across the beta's test corpus.

## 9. Risks and how the product answers them

| Risk | Answer |
| --- | --- |
| Auto-merge ships a bad change | Guardrails (D12), protected paths (D26), required checks, revert in one action, kill switch. |
| Prompt injection from repo content | Untrusted-content rule, `webfetch` denied, no secrets in job env, protected paths, diff budget, audit. |
| The VM disappears (idle reclaim) | Nightly backup (D33), image rebuild, restore drill, documented RTO. |
| Token theft from a phone | Device keys, short-lived access tokens, biometric gate, per-device revocation, Cloudflare Access. |
| Cost runaway | Daily USD cap, run timeout, concurrency cap, visible spend. |
| The app becomes a second job | Narrow MVP, no channel integrations, no editor, one screen per job. |
| Design drifts from the code | `design/` lives in the repo, the gate validates tokens, routes and declared states, and the snapshot hash detects drift; a canvas is an importer, never a second truth (D52). |
| An editor writes outside its target | The target is the write boundary and the session gets one worktree plus one allowed path, so a poisoned backlog cannot make the backlog editor touch code (D55). |
| Every provider account runs dry | Ordered failover with per-account state and reset instant; `provider_exhausted` fails closed and notifies instead of silently degrading (D54). |
| OpenCode V2 API moves | The wrapper is the only place that knows the wire; fixtures pin the behaviour; upgrade is one package. |

## 10. Open product questions

Tracked in [`open-questions.md`](open-questions.md). The ones that change scope: native app
distribution (TestFlight/Play vs PWA-first), the first repositories to onboard, and whether
the beta starts with auto-merge on or in a one-week probation mode.

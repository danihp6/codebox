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
| J2 | A task repeats (nightly dependency bump, weekly report, release notes) | define it once with a cron and let it run | I stop being the scheduler |
| J3 | A run is working | watch its tools, output and diff live | I can intervene early instead of reading a wall of log later |
| J4 | The agent asks for something risky | approve or deny from a notification | autonomy never means "no gate" |
| J5 | A change is ready | see the gate, the checks and the diff stat in one card | I can trust the merge without opening a laptop |
| J6 | A merge was wrong | revert it from the app or the CLI | recovery is a first-class action |
| J7 | The box is unhealthy | see disk, queue, agent health and cost | I fix it before it silently stops working |
| J8 | I have a new repository | register it, set its gate and policy | the loop works without editing config files |

## 4. The product in five surfaces

1. **Chat.** One surface with three scopes (D43). A chat starts **free** — no repository, so
   no code — and gains a `repo` scope when you connect one: the cache is cloned, a worktree is
   cut, and the last ten turns are handed to a new agent session. Promote it and it becomes a
   `schedule` scope. Streaming text, tool cards, and gate and PR cards once a run exists.
2. **Schedules.** The only recurring object (D44). Prompt, time rule and an **optional**
   repository: with one it produces runs, without one it produces chats. `once`, `every`, or a
   `window` that relaunches itself after each fire finishes (D46).
3. **Runs.** The transaction behind a repo chat or a schedule fire: timeline, gate output, PR
   link, guardrail checklist, merge result, cost. A run appears as cards inside the chat that
   spawned it, not as a separate screen.
4. **Repositories.** Registered repositories with a gate command, merge policy, protected
   paths and default branch — reached through a filter in Chat, not a tab (D47). This is where
   auto-merge is opted into per repo.
5. **Credentials.** Every secret the box holds (D49, D50): adapters that need OAuth or a
   manifest (GitHub App, model accounts) and open credentials for anything else. Write-only,
   and an allowlist decides which hosts the agent may reach with them.

Plus a **dashboard** (what needs you, what is working, what finished unreviewed, today's spend,
health) and **settings** (devices, notifications, providers, schedules, danger zone). There are
no interactive approvals (D45): the gate and the disposable worktree are the only doors.

## 5. Core flows

### 5.1 "Do this now"

1. Open a chat. It starts free: ask a question, draft a prompt, think out loud.
2. Connect a repository from the `⋯` menu, or straight from the empty state. The daemon clones
   the cache once, cuts a worktree, and hands the last ten turns to a new agent session.
3. Ask for the work. The agent edits, runs the gate, and reports with a gate card.
4. Promote the chat when the work is real: the run adopts the same worktree, pushes
   `cb/<run>-<slug>` and opens a PR. A free chat cannot be promoted — it has no worktree.
5. If every guardrail is green, it merges and the chat shows the PR card. If not, the card
   lists what failed and the branch stays.

### 5.2 "Every night"

1. Say it in a chat: "every night at 3, update the lockfile, run the gate, fix what breaks".
   The agent proposes a schedule card — prompt, `every day 03:00`, `Europe/Madrid`, an optional
   repository, a cap per fire — and only the tap creates it (D38, D44).
2. The scheduler fires at 03:00. With a repository it runs like 5.1 and opens a PR; without
   one it opens a chat and answers.
3. A window relaunches after each fire finishes, inside its range, until the cap or the end.
   A red fire notifies once; three consecutive failures pause the schedule.
4. The schedule is reached through the `Schedule` filter in Chat and the Settings row; there
   is no Schedule page.

### 5.3 "What is it doing?"

1. The chat is the record: `preparing`, `running`, tool calls, gate and PR arrive as cards in
   the thread, and the header carries the context percentage.
2. Tapping a tool call shows its input/output (redacted).
3. The diff tab shows files and stat; GitHub opens for the full review.
4. Cancel is always available and kills the session, not just the UI.

### 5.4 "It needs a provider"

1. The agent calls `integration.request` with a credential name and a path.
2. The daemon checks the host against the integration's allowlist **before any DNS lookup**,
   adds the auth header server-side, and returns the response.
3. The model never sees the credential, and neither does the shell.
4. A host outside the allowlist is refused, and the refusal is logged with the credential name,
   never the value.

## 6. MVP scope (v0.1)

In:

- pairing and device management;
- one owner, multiple repos;
- chat with streaming, scope conversion and gate cards;
- schedules (`once` / `every` / `window`) with or without a repository;
- worktree isolation, gate, PR, auto-merge guardrails;
- run timeline, diff stat, cancel, revert;
- push notifications (Web Push first, native push in the same milestone if the build is
  ready);
- dashboard and repo settings;
- OCI provisioning, image, tunnel, backup and `cb doctor`.

**Later:** routines (chat schedules and reminders, D38) are Phase 7 / Batch 9; they are not
v0.1 scope. A routine is not a run and never opens a PR.

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
3. describe a nightly schedule in a chat, see it fire, open a PR and merge green;
4. connect a repository from a chat and watch the clone, the worktree and the gate land in
   the thread;
5. cancel a runaway run and see the worktree cleaned;
6. revert a bad merge with one action;
7. lose the VM and restore from the nightly backup with the documented drill.

Numeric targets (measured, not aspirational):

- pairing p95 < 2 min from `cb pair` to first screen;
- chat first token p95 < 3 s on the reference VM;
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
| OpenCode V2 API moves | The wrapper is the only place that knows the wire; fixtures pin the behaviour; upgrade is one package. |

## 10. Open product questions

Tracked in [`open-questions.md`](open-questions.md). The ones that change scope: native app
distribution (TestFlight/Play vs PWA-first), the first repositories to onboard, and whether
the beta starts with auto-merge on or in a one-week probation mode.

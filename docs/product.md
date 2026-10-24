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

1. **Chat.** A persistent session bound to a repository. Streaming text, tool calls, diffs
   and permission cards. Chat is exploratory: it never opens a PR and never merges (D36).
2. **Jobs.** Reusable definitions: repository, prompt, agent, model, mode, cron, timezone,
   enabled. One-off "run now" is a job with a manual trigger.
3. **Runs.** The live and historical execution: timeline, gate output, PR link, guardrail
   checklist, merge result, cost, cancel.
4. **Repos.** Registered repositories with a gate command, merge policy, protected paths and
   default branch. This is where auto-merge is opted into per repo.
5. **Approvals.** Everything waiting on a human: OpenCode permission requests, guardrail
   exceptions, device pairing. One inbox, push-driven.

Plus a **dashboard** (health, queue, today's spend, last runs) and **settings** (devices,
notifications, provider status, danger zone).

## 5. Core flows

### 5.1 "Do this now"

1. Open the app, pick a repo, type a prompt, choose `work`.
2. The daemon prepares a worktree, starts an OpenCode session, streams the run.
3. The agent edits, runs tests, reports.
4. The daemon runs the repo gate, pushes `cb/<run>-<slug>`, opens a PR.
5. If every guardrail is green, it merges and notifies. If not, the PR stays open with a
   checklist of what failed.
6. The run detail shows the diff stat, the gate tail, the merge commit and the cost.

### 5.2 "Every night"

1. Create a job: repo, prompt ("update the lockfile, run the gate, fix what breaks"),
   `0 3 * * *`, `Europe/Madrid`, `work`, auto-merge on.
2. The scheduler claims it at 03:00, runs it like 5.1, and pushes the outcome.
3. A red run notifies once; it does not retry in a tight loop (misfire policy, D13).
4. The job detail shows the next fire, last outcome and a pause switch.

### 5.3 "What is it doing?"

1. The run detail opens on the timeline: `preparing`, `running`, tool calls, gate, PR.
2. Tapping a tool call shows its input/output (redacted).
3. The diff tab shows files and stat; GitHub opens for the full review.
4. Cancel is always available and kills the session, not just the UI.

### 5.4 "It wants permission"

1. OpenCode raises a permission request; the daemon maps it to an approval.
2. A push arrives: "Run bash: `rm -rf dist && npm run build`" with Approve/Deny.
3. Approve → the tool runs; the event is in the timeline.
4. Deny or timeout → the agent receives a rejection and can adapt.

## 6. MVP scope (v0.1)

In:

- pairing and device management;
- one owner, multiple repos;
- chat with streaming and permission bridge;
- manual run and cron job, one repo per job;
- worktree isolation, gate, PR, auto-merge guardrails;
- run timeline, diff stat, cancel, revert;
- push notifications (Web Push first, native push in the same milestone if the build is
  ready);
- dashboard and repo settings;
- OCI provisioning, image, tunnel, backup and `cb doctor`.

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
3. create a nightly job and see it fire, open a PR and merge green;
4. receive a permission push, approve it, and see the tool run;
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

# Documentation index

Read in this order. `README.md` and `AGENTS.md` are the entry points; the rest is reference.

| # | Document | Read it when |
| --- | --- | --- |
| 1 | [`../README.md`](../README.md) | You need the one-paragraph pitch and the status. |
| 2 | [`../AGENTS.md`](../AGENTS.md) | You are about to write code or run a task. |
| 3 | [`product.md`](product.md) | You need the scope, the flows or the success criteria. |
| 4 | [`decisions.md`](decisions.md) | A rule looks arbitrary; the `D##` list is the authority. |
| 5 | [`architecture.md`](architecture.md) | You need components, boundaries, data flow or failure modes. |
| 6 | [`api.md`](api.md) | You are touching the app, the daemon or the contract. |
| 7 | [`app.md`](app.md) | You are building or reviewing the hybrid client. |
| 8 | [`agent-runtime.md`](agent-runtime.md) | You are integrating OpenCode, sessions or permissions. |
| 9 | [`jobs.md`](jobs.md) | You are touching scheduling, the gate, PRs or auto-merge. |
| 10 | [`providers.md`](providers.md) | You are adding, validating or rotating a configuration key. |
| 11 | [`security.md`](security.md) | You are changing auth, exposure, sandboxing or audit. |
| 12 | [`oci.md`](oci.md) | You are provisioning, resizing or migrating the OCI resources. |
| 13 | [`aws.md`](aws.md) | You are provisioning, destroying or budgeting the AWS spot host. |
| 14 | [`vm-image.md`](vm-image.md) | You are building or updating the VM image. |
| 15 | [`operations.md`](operations.md) | Something is running (or broken) in production. |
| 16 | [`agent-pipeline.md`](agent-pipeline.md) | You are running a batch or writing a spec. |
| 17 | [`agent-spec-template.md`](agent-spec-template.md) | You are the Architect writing a task. |
| 18 | [`agent-ci.md`](agent-ci.md) | You are operating the GitHub Actions autopilot. |
| 19 | [`agent-vm.md`](agent-vm.md) | You are operating the VM autopilot. |
| 20 | [`roadmap.md`](roadmap.md) | You are planning the next phase. |
| 21 | [`open-questions.md`](open-questions.md) | You need a decision that is not frozen yet. |

## Conventions used by these docs

- **Decision IDs** (`D1`, `D12`) point to [`decisions.md`](decisions.md). A doc that
  contradicts a decision is a bug in the doc.
- **`CB_*`** is the daemon's configuration namespace. **`CB_AGENT_*`** is the development
  pipeline's namespace — the two must not collide.
- **Task IDs** (`Task-14`) exist only in [`../TODO.md`](../TODO.md); everywhere else a task is
  referenced by name.
- **Role prompts** live in [`../.agent_roles/`](../.agent_roles/) (`orchestrator`, `architect`,
  `dev`, `qa`); the protocol they implement is [`agent-pipeline.md`](agent-pipeline.md).
- **`[unit]` / `[live]`** are acceptance tags: a headless check versus a measurement in the
  running system.
- **Mermaid** diagrams render on GitHub; keep them small enough to read on a phone.
- Code blocks are illustrative unless a file path is named. This repository is design-only
  until Batch 1.

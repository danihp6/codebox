# scripts/agent

The deterministic half of the agent pipeline: it reads git refs and writes decisions, and it
runs before any dependency is installed (Node built-ins only).

| File | What it is |
| --- | --- |
| `recon.mjs` | Reads `origin/main`, the live `origin/task-<ID>` refs and `TODO.md`, and writes `.agent_specs/resume.md`: what is in flight, whose turn it is and what to do next. |
| `recon.test.mjs` | Unit tests for the TODO parser, the turnstile classifier, the report and the ref collector. |
| `gate.mjs` | The driver's decision: brake, window, backlog, red streak and daily cap — in that order. Pure. |
| `gate.test.mjs` | Unit tests for every parking reason and the order that decides which one wins. |
| `verdict.mjs` | The cycle's outcome: a red gate fails; a moved `main` or an opened issue is green even when the stream died. Pure. |
| `verdict.test.mjs` | Unit tests for shipped, resumed, stopped and failed. |
| `vm/` | The VM host: driver, cycle, brake, install, unit, env template and the canonical prompt (`scripts/agent/vm/README.md`). |
| `README.md` | This map. |

The hosts are `docs/agent-ci.md` (GitHub Actions) and `docs/agent-vm.md` (the box). The
protocol they implement is `docs/agent-pipeline.md`.

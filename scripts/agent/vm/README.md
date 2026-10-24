# scripts/agent/vm

The VM host of the pipeline: it runs the same protocol as `agent-cycle.yml`, without a
runner in between. Paths and the split from the product are in `docs/agent-vm.md`.

| File | What it is |
| --- | --- |
| `run-driver.sh` | The loop: reads the brake, the backlog and today's ledger, asks `gate.mjs`, and runs a cycle when the answer is yes. Runs as `cb-agent.service`. |
| `run-cycle.sh` | One cycle: fetch, refuse a dirty tree, reset, recon, `opencode run --agent orchestrator --auto`, post-merge gate, verdict, one line in the ledger. Holds the flock. |
| `brake.sh` | The brake by hand (`on`, `off`) or by window (`window 4`), plus `status` and `reset`. |
| `lib.sh` | Shared paths, env loading, logging and the ledger helpers. Sourced. |
| `prompt.md` | The Orchestrator's prompt. The canonical copy: `agent-cycle.yml` reads this file too. |
| `install.sh` | Bootstrap: `cb-agent` user, directories, git/gh/Node 24/OpenCode/Playwright, the env template and the unit. |
| `agent.env.example` | The `/etc/codebox/cb-agent.env` template; no real credential. |
| `cb-agent.service.in` | The systemd unit, substituted by `install.sh`. |
| `README.md` | This map. |

State lives in `CB_AGENT_STATE` (default `/var/lib/cb-agent`): `brake`, `window`,
`cycles.ndjson`, `logs/`, `last-cycle.md`, `lock`, `alerts`. None of it is required to
resume; the refs are the state.

The brake is **off** after `install.sh`. Arming it is a deliberate human act:

```bash
scripts/agent/vm/brake.sh status
scripts/agent/vm/brake.sh on
sudo systemctl start cb-agent
```

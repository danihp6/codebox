# Providers and configuration

Everything the daemon needs is an environment variable prefixed `CB_` (D19). Providers —
GitHub, the model backend, Cloudflare, OCI — are selected and credentialed through the same
schema, so there is one place to document, validate and redact. No secret is ever committed
or baked into the VM image (D20).

## 1. Rules

- **One prefix, one schema.** `packages/contracts/src/config.ts` is the zod schema; the
  daemon parses it at boot and exits non-zero on the first invalid key, naming the key and
  never echoing its value.
- **Precedence:** CLI flag > process environment > `EnvironmentFile` > compiled default.
  There are no secret defaults.
- **Secrets are write-only.** The API exposes `configured: true|false` and a last-four
  fingerprint, never the value. Logs pass through the redactor before they are written. This
  holds for `CB_SESSION_SECRET`, for `CB_SECRETS_KEY` and for every credential the runtime
  store seals (D49).
- **Connections are provisioned at runtime, not typed into a file** (D49). The app's Providers
  page links each provider through the mechanism that provider actually offers: a GitHub App
  created by **manifest flow**, an **OAuth** authorisation, or a **single key entered once** for
  the providers that only sell keys. The daemon writes the result into an encrypted store and
  reports `configured`, `lastFour` and `lastUsedAt`. `CB_*` variables remain the bootstrap path
  for the two credentials a browser cannot deliver: `CB_SESSION_SECRET` and the host's cloud
  identity.
- **The app never receives a provider credential.** It talks to `/v1`; the daemon holds the
  GitHub App key, the tunnel token and the model keys.
- **CI credentials are not daemon credentials.** `OCI_CLI_*` and `CB_OCI_*` exist only in
  GitHub Actions (or the operator's shell) for provisioning. The running VM never needs the
  OCI API key; it reads Vault through its instance principal (D20).

## 2. Core

| Key | Default | Meaning |
| --- | --- | --- |
| `CB_ENV` | `production` | `production`, `staging`, `development`, `test`. |
| `CB_BIND` | `127.0.0.1:8787` | Listen address. Never `0.0.0.0` in production; the tunnel connects to loopback. |
| `CB_PUBLIC_URL` | — | Canonical HTTPS origin, e.g. `https://cb.example.com`. Required in production. |
| `CB_LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`. |
| `CB_TIMEZONE` | `Europe/Madrid` | Default zone for new jobs and for human timestamps. |
| `CB_INSTANCE_NAME` | `cb-instance` | Shown in the app and in telemetry. |
| `CB_COMMIT` | build-time | Git SHA of the running release. |

## 3. Paths

| Key | Default | Meaning |
| --- | --- | --- |
| `CB_STATE_DIR` | `/var/lib/codebox` | SQLite, events, logs, artifacts, backups. |
| `CB_REPO_ROOT` | `/srv/codebox/repos` | Bare clone cache. |
| `CB_WORKSPACE_ROOT` | `/srv/codebox/worktrees` | One worktree per run. |
| `CB_INSTALL_DIR` | `/opt/codebox` | Installed release and migrations. |
| `CB_TMP_DIR` | `/var/tmp/codebox` | Scratch space for the gate and archives. |

The service user `codebox` owns `CB_STATE_DIR`, `CB_REPO_ROOT` and `CB_WORKSPACE_ROOT`; `/opt`
is root-owned and read-only to `codebox`. The agent runs as its own user, `codebox-agent`, in
group `codebox-workspace`, not in `codebox`: it shares the two `2770` worktree trees and reads
nothing under `/etc/codebox` or the state directory.

## 4. Auth and devices

| Key | Default | Meaning |
| --- | --- | --- |
| `CB_SESSION_SECRET` | — | 32+ random bytes, base64; signs access tokens and cookies. Required. |
| `CB_PAIRING_TTL_SECONDS` | `300` | Lifetime of a pairing code. |
| `CB_ACCESS_TOKEN_TTL_SECONDS` | `900` | Short-lived bearer for API calls. |
| `CB_REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh token lifetime; rotated on use. |
| `CB_OWNER_EMAIL` | — | The only human identity; used by Cloudflare Access and notifications. |
| `CB_ALLOWED_ORIGINS` | `https://<CB_PUBLIC_URL>` | Comma list; include `capacitor://localhost` and `http://localhost:8100` in development. |
| `CB_ACCESS_TEAM_DOMAIN` | — | Optional Cloudflare Access team domain. |
| `CB_ACCESS_AUD` | — | Optional Access application audience tag. When both are set, the daemon verifies `Cf-Access-Jwt-Assertion`. |

Generate the secret with `openssl rand -base64 48`. Rotating it invalidates every access token
and forces a refresh; refresh tokens survive because they are stored hashed in SQLite, not
signed with this secret.

## 5. OpenCode

| Key | Default | Meaning |
| --- | --- | --- |
| `CB_OPENCODE_URL` | `http://127.0.0.1:4096` | V2 server base URL. Must be loopback. |
| `CB_OPENCODE_BIN` | `opencode` | Binary the supervisor starts. |
| `CB_OPENCODE_HOSTNAME` | `127.0.0.1` | Passed to `opencode serve`. |
| `CB_OPENCODE_PORT` | `4096` | Passed to `opencode serve`. |
| `CB_OPENCODE_TOKEN` | — | Optional bearer if the server requires one. Never exposed to the app. |
| `CB_OPENCODE_AUTO` | `true` | `--auto` for unattended runs. No session sets it: every permission is answered from the policy, so nothing waits for an operator. |
| `CB_DEFAULT_AGENT` | `build` | Agent name passed to new sessions. |
| `CB_DEFAULT_MODEL` | — | Provider/model string from `GET /api/model`. |
| `CB_MODEL_PROVIDER_KEYS` | — | Comma allowlist of provider key names passed from the daemon's env to OpenCode (e.g. `ANTHROPIC_API_KEY,OPENAI_API_KEY`). Everything else is dropped. |
| `CB_OPENCODE_HEALTH_PATH` | `/api/info` | Health probe. |

Provider keys themselves keep the names OpenCode documents (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, …). The daemon does not rename them; it only decides
which ones a job may inherit through `CB_MODEL_PROVIDER_KEYS`.

## 6. Git provider

GitHub is the first implementation (D10). The same block will grow a GitLab section when the
adapter exists.

| Key | Default | Meaning |
| --- | --- | --- |
| `CB_GIT_PROVIDER` | `github` | `github` (v1); `gitlab` is reserved. |
| `CB_GITHUB_APP_ID` | — | Numeric app id. |
| `CB_GITHUB_APP_PRIVATE_KEY_BASE64` | — | PEM, base64-encoded to survive env files. |
| `CB_GITHUB_INSTALLATION_ID` | — | Installation on the owner's account. |
| `CB_GITHUB_WEBHOOK_SECRET` | — | Optional; only if webhooks are enabled (Q18). |
| `CB_GITHUB_TOKEN` | — | Fine-grained PAT fallback (contents + pull requests + checks, selected repos). |
| `CB_GITHUB_API_URL` | `https://api.github.com` | Override for GitHub Enterprise. |
| `CB_GIT_AUTHOR_NAME` | `codebox[bot]` | Commit author name. |
| `CB_GIT_AUTHOR_EMAIL` | `codebox@users.noreply.github.com` | Commit author email. |

Exactly one auth mode is required: App (`APP_ID` + key + installation) or PAT. If both are
present, the App wins and the daemon logs a warning. The App is preferred because tokens are
short-lived and scoped to the installation.

### 6.1 Runtime credentials and integrations

The GitHub App above is the bootstrap path; the same app can also be created at runtime through
the manifest flow, which writes a `github_app` credential into the encrypted store instead of
the environment. These two keys govern that store (D49, D50).

| Key | Default | Meaning |
| --- | --- | --- |
| `CB_SECRETS_KEY` | — | 32 random bytes, standard base64, exactly 44 characters (`43` payload chars + one `=`). Unlocks `CB_STATE_DIR/secrets/credentials`. Absent: boot succeeds, the store is unconfigured and every credential write is `503 secrets_not_configured`. |
| `CB_INTEGRATION_TIMEOUT_SECONDS` | `15` | Deadline for one `POST /v1/integrations/{id}/request`. `0` means no timeout beyond the platform default. |

Generate the key with `openssl rand -base64 32` and keep it in the host's `EnvironmentFile`; the
value is write-only, a malformed one fails the boot naming `CB_SECRETS_KEY` and never the value,
and losing it makes every sealed credential unreadable until it is rotated.

## 7. Repositories and workspaces

| Key | Default | Meaning |
| --- | --- | --- |
| `CB_REPO_ALLOWLIST` | — | Comma list of `owner/name`. A repo outside it cannot be registered. |
| `CB_GATE_DEFAULT` | `npm test && npm run build` | Gate used when a repo does not override it. |
| `CB_GATE_TIMEOUT_SECONDS` | `1800` | Kill the gate after this. |
| `CB_GATE_SHELL` | `/bin/bash` | Shell for the gate command; `-lc` semantics. |
| `CB_WORKSPACE_TTL_HOURS` | `168` | Keep a finished worktree this long for inspection, then remove. |
| `CB_CLONE_DEPTH` | `0` | `0` = full clone; a positive number = shallow. Full is recommended for worktrees. |
| `CB_GIT_HTTP_TIMEOUT_SECONDS` | `120` | Network timeout for clone/fetch/push. |

The allowlist is enforced at registration, at run time and at push time. Adding a repo is an
explicit API call; a job cannot point at an arbitrary URL.

## 8. Runs, merge and scheduler

| Key | Default | Meaning |
| --- | --- | --- |
| `CB_MAX_CONCURRENCY` | `3` | Global concurrent runs; `0` is rejected. |
| `CB_MAX_CONCURRENCY_PER_REPO` | `1` | Per-repo concurrent runs; `0` is rejected. |
| `CB_RUN_TIMEOUT_SECONDS` | `5400` | Hard run timeout. |
| `CB_DAILY_COST_USD` | `10` | Cost cap per UTC day; `0` disables the cap (not recommended). |
| `CB_AUTOMERGE` | `on` | Global kill switch. `off` leaves every PR open. |
| `CB_MERGE_METHOD` | `squash` | `squash` or `merge`. |
| `CB_PROTECTED_PATHS` | `.github/**,ops/**,infra/**,**/*.env,CODEOWNERS,.gitmodules` | A diff touching one never auto-merges. |
| `CB_DIFF_MAX_FILES` | `40` | Diff budget. |
| `CB_DIFF_MAX_LINES` | `2000` | Diff budget. |
| `CB_MISFIRE_GRACE_SECONDS` | `900` | A missed cron fire runs once inside this window. |
| `CB_SCHEDULER_TICK_SECONDS` | `15` | Scheduler poll interval. |
| `CB_APPROVAL_TTL_SECONDS` | `600` | A pending permission request expires and is rejected. |
| `CB_PROBATION_RUNS` | `0` | If > 0, auto-merge only after this many green runs per repo. |

## 9. Retention

| Key | Default | Meaning |
| --- | --- | --- |
| `CB_RETENTION_RUNS_DAYS` | `90` | Run rows and summaries. |
| `CB_RETENTION_EVENTS_DAYS` | `14` | `run_events` rows. |
| `CB_RETENTION_LOGS_DAYS` | `30` | Gate and agent log files. |
| `CB_RETENTION_CHAT_DAYS` | `90` | Chat messages. |
| `CB_RETENTION_APPROVALS_DAYS` | `7` | Resolved approvals. |

## 10. Notifications

| Key | Default | Meaning |
| --- | --- | --- |
| `CB_VAPID_PUBLIC_KEY` | — | Web Push public key. |
| `CB_VAPID_PRIVATE_KEY` | — | Web Push private key. |
| `CB_VAPID_SUBJECT` | `mailto:<CB_OWNER_EMAIL>` | VAPID subject. |
| `CB_FCM_PROJECT_ID` | — | Optional Capacitor Android push. |
| `CB_FCM_SERVICE_ACCOUNT_BASE64` | — | Optional FCM service account JSON, base64. |
| `CB_APNS_KEY_ID` | — | Optional iOS push key id. |
| `CB_APNS_TEAM_ID` | — | Optional Apple team id. |
| `CB_APNS_PRIVATE_KEY_BASE64` | — | Optional `.p8`, base64. |
| `CB_QUIET_HOURS` | — | e.g. `22:00-08:00`; non-critical pushes are held. |

Without a push configuration, the app still works; it just polls when foregrounded.

## 11. Tunnel

| Key | Default | Meaning |
| --- | --- | --- |
| `CB_PUBLIC_HOSTNAME` | — | Hostname the tunnel serves, e.g. `cb.example.com`. |
| `CB_TUNNEL_TOKEN` | — | Cloudflare Tunnel token. Read from Vault at boot in production. |
| `CB_TUNNEL_METRICS` | `127.0.0.1:20241` | cloudflared metrics/health. |

The daemon does not manage the tunnel process; systemd does. It only reports whether the
public URL answers.

## 12. OCI and CI only

These are not read by the daemon. They belong to the provisioning workflow (D22).

| Key | Where | Meaning |
| --- | --- | --- |
| `OCI_CLI_USER` | repo variable | OCI API user OCID (`cb-ci`). |
| `OCI_CLI_FINGERPRINT` | repo variable | API key fingerprint. |
| `OCI_CLI_TENANCY` | repo variable | Tenancy OCID. |
| `OCI_CLI_REGION` | repo variable | e.g. `eu-madrid-1`. |
| `OCI_CLI_KEY_CONTENT` | repo secret | Private API key PEM. |
| `CB_OCI_COMPARTMENT_ID` | repo variable | Compartment for the instance and network. |
| `CB_OCI_SUBNET_ID` | repo variable | `cb-subnet` OCID. |
| `CB_OCI_IMAGE_ID` | repo variable | The Packer-built `cb` image OCID. |
| `CB_OCI_AD` | repo variable | Availability domain. |
| `CB_OCI_SHAPES` | repo variable | `2/12 2/12 1/6` rotation. |
| `CB_OCI_INSTANCE_NAME` | repo variable | `cb-instance`. |
| `CB_OCI_SSH_PUBLIC_KEY` | repo variable | Public half of the admin key. |
| `CB_OCI_RETRY` | repo variable | `off` parks the retry chain. |

The launch knobs — `CB_OCI_ATTEMPTS`, `CB_OCI_ATTEMPT_SLEEP`, `CB_OCI_THROTTLE_SLEEP`,
`CB_OCI_START_DELAY`, `CB_OCI_BUDGET` and `CB_OCI_BOOT_GB` — are documented in
[`oci.md`](oci.md) §4.

The full resource inventory and IAM policy are in [`oci.md`](oci.md).

## 13. Agent pipeline only

These keys belong to the development harness that builds this repository, not to `cbd`. They
are read by the workflows in `.github/workflows/` and by `scripts/agent/vm/`, never by
`apps/daemon`. The hosts are documented in [`agent-ci.md`](agent-ci.md) and
[`agent-vm.md`](agent-vm.md).

| Key | Where | Meaning |
| --- | --- | --- |
| `CB_AGENT_AUTOPILOT` | repo variable / `$CB_AGENT_STATE/brake` | `on` arms the loop; anything else parks it. |
| `CB_AGENT_FROM` / `CB_AGENT_UNTIL` | repo variable / `$CB_AGENT_STATE/window` | Armed window as absolute UTC instants. |
| `CB_AGENT_DAILY_CYCLES` | variable | Cycles per UTC day; `0` or unset means no cap. |
| `CB_AGENT_MAX_DEVS` | variable | Dev slots per wave; ceiling 4, default 2 on the 2/12 shape. |
| `CB_AGENT_MODEL` | variable | `provider/model` passed to `opencode run`. |
| `CB_AGENT_TOKEN` | Actions secret | Fine-grained PAT with `Variables: read and write`, for the window workflow only. |
| `CB_AGENT_GIT_TOKEN` | `/etc/codebox/cb-agent.env` | PAT with `contents: write` + `issues: write` on this repository; the VM host's push credential. |
| `CB_AGENT_STATE` | VM | State directory, default `/var/lib/cb-agent`. |

The inference key keeps the name OpenCode documents (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`OPENROUTER_API_KEY`); only the one `CB_AGENT_MODEL` names is set. **`CB_*` and `CB_AGENT_*`
must not collide**: a daemon key in a workflow, or a pipeline key in `apps/daemon`, is a test
failure.

## 14. Example (development)

```dotenv
CB_ENV=development
CB_BIND=127.0.0.1:8787
CB_PUBLIC_URL=http://localhost:8787
CB_STATE_DIR=./.state
CB_REPO_ROOT=./.state/repos
CB_WORKSPACE_ROOT=./.state/worktrees
CB_SESSION_SECRET=replace-me-with-openssl-rand-base64-48
CB_OWNER_EMAIL=you@example.com
CB_ALLOWED_ORIGINS=http://localhost:8100,http://localhost:8787
CB_OPENCODE_URL=http://127.0.0.1:4096
CB_DEFAULT_AGENT=build
CB_GITHUB_TOKEN=
CB_REPO_ALLOWLIST=you/scratch
CB_AUTOMERGE=off
CB_DAILY_COST_USD=0
```

Production uses `/etc/codebox/instance.env` with mode `0600`, owned by `root:codebox`, and
the values rendered from OCI Vault at boot. The agent has a second file,
`/etc/codebox/agent.env` (`0640`, `root:codebox-workspace`), which carries only the model
provider keys and no `CB_` line:

```ini
[Service]
EnvironmentFile=/etc/codebox/instance.env
User=codebox
Group=codebox
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
UMask=0007
ReadWritePaths=/var/lib/codebox /srv/codebox
```

The agent unit is the same block with `User=codebox-agent`, `Group=codebox-workspace`,
`EnvironmentFile=/etc/codebox/agent.env` and `ReadWritePaths=/srv/codebox /var/lib/codebox-agent`.

## 15. Validation and failure

| Invalid value | Behaviour |
| --- | --- |
| Missing `CB_SESSION_SECRET` | Exit 1: `CB_SESSION_SECRET is required`. |
| Malformed URL | Exit 1 with the key and the expected shape. |
| Unknown `CB_GIT_PROVIDER` | Exit 1 listing `github`. |
| Cron in a job | Rejected with the field path; the job is not saved. |
| Unknown timezone | Rejected with the zone name. |
| `CB_BIND` not loopback in production | Exit 1; the tunnel is the only way in. |
| Both App and PAT configured | Warning, App wins. |
| Neither App nor PAT configured | The daemon starts read-only: chat works, git writes are disabled. |

`cb doctor` reports each provider as `ok`, `missing`, `expired` or `unreachable`, with the
last successful call. It never prints a credential.

## 16. Rotation

| Credential | Rotation | Effect |
| --- | --- | --- |
| GitHub App key | New key in the App settings, update Vault, restart `codebox`. | Old installation tokens expire within the hour; new runs use the new key. |
| PAT | Regenerate, update Vault, restart. | In-flight pushes may fail once; the run parks in `pr_open`. |
| `CB_SESSION_SECRET` | New value, restart. | Access tokens invalid; refresh tokens still work, devices re-mint silently. |
| VAPID keys | New pair, re-subscribe devices. | Old subscriptions are pruned. |
| Tunnel token | New token in Cloudflare, update Vault, restart `cloudflared`. | Seconds of downtime. |
| OCI API key | `oci iam user api-key delete` + upload, update the repo secret. | Only affects provisioning, not the running daemon. |
| `CB_AGENT_TOKEN` | Regenerate the fine-grained PAT, update the Actions secret. | Only the timed window stops working; the manual brake and the cycles are unaffected. |
| `CB_AGENT_GIT_TOKEN` | Regenerate, edit `/etc/codebox/cb-agent.env`, restart `cb-agent`. | The next cycle cannot push and parks red; nothing is lost, the branches stay on `origin`. |
| Inference key (`ANTHROPIC_API_KEY`, …) | New key with the provider, update the secret or env file. | A cycle fails at its first model call without shipping; red streak guards the loop. |

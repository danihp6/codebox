# Security

Codebox is a private remote-control surface for an agent that can edit code and push
branches. The threat model is therefore small in scope and sharp in consequence: one operator,
one box, and an agent with a shell. This document states what is protected, from whom, and
which control answers each risk. It describes the design; Batch 7 proves it.

## 1. Assets

| Asset | Why it matters | Where it lives |
| --- | --- | --- |
| GitHub credential | Can write every allowlisted repository | `/etc/codebox/instance.env`, rendered from Vault |
| Model provider keys | Spend money, leak prompts | Daemon env; allowlisted into OpenCode only |
| Device refresh tokens | Command the box | Hashed in SQLite; plaintext only in the OS keystore |
| Session secret | Mints access tokens | `instance.env` |
| Tunnel token | Publishes the daemon | `instance.env` |
| Source code and prompts | Private, possibly sensitive | Worktrees, SQLite, logs |
| The VM itself | Hosts everything above | OCI tenancy |

## 2. Adversaries

| Adversary | Capability | Most likely path |
| --- | --- | --- |
| Network scanner | Finds open ports | None: no inbound port except SSH from one address (D18). |
| Holder of a leaked tunnel URL | Reaches the HTTPS endpoint | Device auth (D17) + Cloudflare Access. |
| Thief with the phone | Has an unlocked device | OS lock, biometric gate, short access token, per-device revoke. |
| Malicious repository content | Text the agent reads | Untrusted-content rule, permission policy, protected paths, diff budget. |
| Compromised dependency | Runs in the build | Lockfile, `npm ci`, no install scripts without a decision, CI audit. |
| Curious model output | Prints a secret it saw | No secret in a child's env, redaction, secret scanning in the gate. |
| The operator's own mistake | Merges something bad | Guardrails fail closed, revert in one action, brake. |

Not in scope: a hostile cloud provider, a compromised OCI tenancy, a physical attacker at the
VM, or multi-tenant isolation (there are no tenants).

## 3. Exposure

- The daemon binds `127.0.0.1:8787`. `CB_BIND` on a non-loopback address in production is a
  startup failure, not a warning.
- **Cloudflare Tunnel** is the only public path; `cloudflared` is an outbound connection
  managed by systemd. No 80/443 is opened in the OCI security list.
- **SSH** is the only other door, restricted to the admin address (`/32`), key-only, no
  password, no root login.
- **Cloudflare Access** is an outer layer, not the auth: the daemon verifies the Access JWT
  when `CB_ACCESS_TEAM_DOMAIN` and `CB_ACCESS_AUD` are set, and still requires a device token.
- The tunnel hostname is not a secret, but it is not advertised either; a 404 from the edge is
  the expected answer to an unauthenticated probe.

## 4. Paired devices

Pairing (D17) is a four-step exchange:

1. `cb pair` runs on the VM (SSH or a local admin socket) and mints a 300 s, single-use code.
2. The code is shown as a QR and as text; it is stored hashed, compared in constant time and
   burned on first use.
3. The app generates a key pair and sends the public key with the code. The daemon creates the
   device, returns an access token (900 s) and a refresh token (30 days).
4. The refresh token is stored in Keychain/Keystore; the access token stays in memory.

Rules:

- A refresh token rotates on every use. Reusing an old one revokes the device — the standard
  theft signal.
- Tokens are stored hashed (Argon2id or scrypt); a database copy does not grant access.
- `DELETE /v1/devices/{id}` revokes immediately: the next request is a 401 and the app clears
  its store.
- Pairing codes are rate-limited (10/hour/source) and never logged.
- A device can hold a subset of scopes; the operator's phone normally holds all of them, a
  read-only tablet does not.

## 5. Request security

- Every `/v1` route except health, version and pairing requires a bearer token; the
  middleware is registered once, not per handler (Task-12 asserts it).
- Origin checks: browser requests must match `CB_ALLOWED_ORIGINS`; native origins
  (`capacitor://localhost`, `http://localhost`) are explicit, never `*`.
- CSRF is not applicable to bearer tokens, but state-changing GETs are forbidden anyway.
- Body size is capped before parsing (1 MB; 4 MB for markdown).
- All input is parsed by a zod schema at the edge; unknown fields are rejected.
- Errors never echo a token, a path outside the repo, or an upstream response body.
- Security headers: HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`,
  `Content-Security-Policy` for the hosted app with no inline script.

## 6. The agent as an untrusted process

The agent is capable by design; the boundary is what it can reach (D27).

| Control | Implementation |
| --- | --- |
| Working directory | One worktree per session; the process cwd is that directory. |
| Permissions | Edits and in-worktree bash allowed for runs; `webfetch` denied; outside-worktree denied (`agent-runtime.md` §6). |
| Environment | Allowlist: `PATH`, `HOME`, `LANG`, git identity, model keys. No GitHub token, no session secret, no Vault token. |
| Network | Best-effort egress restriction in Batch 7; the agent has no inbound listener. |
| Secrets in the repo | The gate runs a secret scan; a hit fails the run before the PR. |
| Prompt injection | Repository text is data, not instructions; the envelope says so; protected paths stop the dangerous diffs. |
| Resource use | Timeout, cost cap, concurrency cap, disk guard. |
| Isolation (optional) | A bubblewrap/container runner in Batch 7; not a v1 dependency. |

The agent never gets a credential that can push to `main`: the installation token is scoped to
the selected repositories, and branch protection (where the plan allows it) plus the cycle's
own rule keep `main` for merges.

## 7. Secrets

- No secret in the repository, the image, a log, a prompt or a push payload. A commit that
  contains one is a release blocker.
- Production secrets come from **OCI Vault** through the instance principal at boot, written
  to `/etc/codebox/instance.env` (`0600`, `root:codebox`) and read by systemd. The dev
  fallback is a local `.env` outside the repo.
- Logs are structured JSON and pass through the redactor: keys matching `token`, `secret`,
  `password`, `key`, `authorization`, `cookie`, `private` and the provider key names are
  replaced with `[redacted]`. The redactor never mutates its input and is tested with a
  30-fixture corpus.
- `cb doctor`-style provider checks report `configured` and a last-four fingerprint, never the
  value.
- Rotation is documented in `docs/providers.md` §16. The session secret rotation logs devices
  out of their access tokens but not of their refresh tokens.

## 8. Data protection

| Data | At rest | Retention |
| --- | --- | --- |
| SQLite | On the encrypted OCI boot volume; file mode `0600` | Runs 90 d, events 14 d, chat 90 d (D28) |
| Worktrees | Disk; removed after 168 h | Branch stays on GitHub |
| Backups | age-encrypted in OCI Object Storage, 30 daily copies | 30 d |
| Logs | journald + `logs/`, redacted | 30 d |
| Prompts | Stored with the run; truncated tool output | 90 d with the run |

A restore drill is part of the beta exit: restore into a scratch VM, pair a device, see the
same jobs and history.

## 9. Audit

The event log is the audit trail: every state transition, every approval, every merge and
every policy change is an event with an actor (`device:<id>`, `scheduler`, `system`) and a
timestamp. There is no separate audit database, and an event is never edited or deleted
before retention.

What an event never contains: a token, a full prompt body (only a hash and a truncated copy),
a file's contents, or a provider response body.

## 10. Accepted risks

| Risk | Why accepted | Mitigation |
| --- | --- | --- |
| Auto-merge ships a bad change | The owner chose autonomy (D11) | G1–G8, protected paths, probation, revert, brake |
| A poisoned repo steers the agent | The agent must read the repo | Envelope, deny `webfetch`, diff budget, review issue |
| The phone is stolen unlocked | Convenience | OS lock, biometric gate, short tokens, revoke |
| The VM is reclaimed when idle | OCI Always Free rule | Backups, reproducible image, repo as source of truth |
| A dependency compromise | Build needs packages | Lockfile, audit, no install scripts without a decision |
| Model provider logs prompts | External inference | Choose the provider deliberately; no secret in a prompt |

## 11. Review checklist

A change touching any of these needs a security review in the same task:

- [ ] Auth middleware, token minting/rotation, or scopes.
- [ ] The guardrail list, protected paths or the diff budget.
- [ ] The permission policy, the prompt envelope or a child's environment.
- [ ] The tunnel, the security list, or an IAM policy.
- [ ] The redaction list or a log statement that includes user content.
- [ ] A new dependency that runs an install script.
- [ ] A backup, restore or retention path.

## 12. Incident response

1. **Brake first.** `cb brake on` (or `CB_AUTOMERGE=off`) stops merges at the next boundary;
   it never cuts a merge in half.
2. **Contain.** Revoke the device (`DELETE /v1/devices/{id}`) or rotate the credential that
   leaked.
3. **Preserve.** Copy the run's events and logs before retention or cleanup.
4. **Recover.** Revert the merge with a run, or restore the last backup if state is corrupt.
5. **Record.** Add the incident and the missing control to `docs/operations.md` and, if a
   guardrail was wrong, amend D12 with a test that would have caught it.

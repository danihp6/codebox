# Security

Codebox is a private remote-control surface for an agent that can edit code and push
branches. The threat model is therefore small in scope and sharp in consequence: one operator,
one box, and an agent with a shell. This document states what is protected, from whom, and
which control answers each risk. It describes the design; Batch 7 proves it.

## 1. Assets

| Asset | Why it matters | Where it lives |
| --- | --- | --- |
| GitHub credential | Can write every allowlisted repository | `/etc/codebox/instance.env`, rendered from the host's secret store: the bundles file, or OCI Vault on OCI |
| Model provider keys | Spend money, leak prompts | Daemon env; allowlisted into OpenCode only |
| Device refresh tokens | Command the box | Hashed in SQLite; plaintext only in the OS keystore |
| Session secret | Mints access tokens | `instance.env` |
| Tunnel token | Publishes the daemon | `instance.env` |
| Source code and prompts | Private, possibly sensitive | Worktrees, SQLite, logs |
| The VM itself | Hosts everything above | One host: an OCI tenancy or an AWS account (D42) |

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
  managed by systemd. No 80/443 is opened in the OCI security list (`cb-sl`) or in the AWS
  security group (`codebox-sg`); the resource names are in `docs/oci.md` §1 and `docs/aws.md` §1.
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
- Values that are **compared** (pairing codes) are stored as salted **scrypt** hashes. The
  refresh token is instead looked up by hash, so it is stored as
  `HMAC-SHA256(CB_SESSION_SECRET, token)` lowercase hex: a salted hash cannot support a
  lookup, and a database copy without the session secret grants nothing.
- `DELETE /v1/devices/{id}` revokes immediately: the next request is a 401 and the app clears
  its store.
- Pairing codes are rate-limited (10/hour/source) and never logged.
- A device can hold a subset of scopes; the operator's phone normally holds all of them, a
  read-only tablet does not.

### Primitives (`@codebox/security`)

Every rule above is a tested function; the daemon maps a typed failure to `401`/`403` and never
invents a format of its own.

- **Pairing code:** 10 characters from the Crockford base32 alphabet without `I`, `L`, `O` and
  `U` (`^[0-9A-HJKMNP-TV-Z]{10}$`), a 300 s TTL (`CB_PAIRING_TTL_SECONDS`), single use. A used,
  expired or unknown code never pairs twice, and an unknown code costs the same scrypt check as
  a wrong one.
- **scrypt, not Argon2id:** Argon2id is not a Node built-in and this release adds no dependency,
  so compared values use `scrypt$<N>$<r>$<p>$<salt>$<key>` with `N=16384, r=8, p=1` and a fresh
  16-byte salt. `verifySecret` parses the stored hash, bounds its parameters and returns `false`
  for a malformed value.
- **Access token:** `cb1.<base64url(claims)>.<base64url(HMAC-SHA256(secret, "cb1.<claims>"))>`,
  claims `{ v, sub, scopes, iat, exp }`, 900 s TTL. It is stateless: rotating
  `CB_SESSION_SECRET` invalidates every access token and leaves refresh tokens alone.
- **Authorisation:** `authorizeDevice` is a revoked check plus exact scope membership, with no
  implied scope; a revoked device fails every scope, `admin` included.
- **Redaction:** `redact()` returns a new value, replaces a key matching `token`, `secret`,
  `password`, `key`, `authorization`, `cookie` or `private` with `[redacted]`, and never
  mutates its input. It is the only redactor the logs pass through.
- **Cloudflare Access:** `verifyAccessJwt` checks RS256, the `kid` in the fetched JWKS, the
  signature, `exp`, `aud` and `iss = https://<CB_ACCESS_TEAM_DOMAIN>` in that order, and never
  fetches anything itself.

## 5. Request security

- Every `/v1` route except health, version and pairing requires a bearer token; the
  middleware is registered once, not per handler (Task-12 asserts it).
- **Origin allowlist.** A `/v1` request that carries an `Origin` header is compared, lowercased
  and without a trailing slash, with `CB_ALLOWED_ORIGINS`. A mismatch is `403 forbidden` with
  `details.reason = "origin"`, and the request never reaches a handler. The config folds the
  origin of `CB_PUBLIC_URL` into the list when the list itself is empty, so a production boot
  always has one. An **empty** list means development: every origin is accepted, deliberately.
  Native origins (`capacitor://localhost`, `http://localhost`) are listed explicitly, never `*`.
  The hosted app and the SPA fallback are not origin-checked: they serve the bundle, not the API.
- **Body cap.** A `Content-Length` above **1 MiB** (`MAX_REQUEST_BYTES`) on a `/v1` path is a
  `400 bad_request` with `details.limitBytes` and `details.path = "request.body"`, decided before
  anything is parsed; the route never runs. No `/v1` route accepts a larger body today, so the
  4 MB allowance for markdown attachments in `docs/api.md` §9 has no route to apply to yet.
- **Rate limits** are enforced per device in the auth middleware, after authentication and the
  scope check and before the handler: **120 requests/minute** on any `/v1` route
  (`API_RATE_LIMIT`) and **10/minute** on the three run-creating routes — `POST /v1/runs`,
  `POST /v1/jobs/{id}/run` and `POST /v1/routines/{id}/run` (`WORK_RATE_LIMIT`). A work route is
  counted in the tighter budget only, never in both. A refusal is `429 rate_limited` with
  `Retry-After`, emitted by the same error path as every other auth failure. The pairing limiter
  (10/hour/source) is separate and unchanged.
- CSRF is not applicable to bearer tokens, but state-changing GETs are forbidden anyway.
- All input is parsed by a zod schema at the edge; unknown fields are rejected.
- Errors never echo a token, a path outside the repo, or an upstream response body.
- **Security headers** are set on every response, JSON and static alike, and never overwrite a
  header a route already set: `Strict-Transport-Security: max-age=31536000; includeSubDomains`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a
  `Content-Security-Policy` of `default-src 'self'; script-src 'self'; style-src 'self'
  'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self';
  frame-ancestors 'none'; base-uri 'self'; form-action 'self'` — no inline script, no
  third-party origin.
- Both request refusals are logged by the request middleware as their status; there is no extra
  log line and no request body in it. The numbers are exported constants in
  `apps/daemon/src/app.ts` and `apps/daemon/src/auth/middleware.ts`, pinned by their unit tests
  (D40).

## 6. The agent as an untrusted process

The agent is capable by design; the boundary is what it can reach (D27). It runs as its own
unprivileged identity, `codebox-agent`, in group `codebox-workspace`, so a policy mistake is not
a filesystem-wide permission.

D45 fixes the boundary in one sentence: the agent never waits for an operator and never reads a
daemon secret. It cannot read `/etc/codebox/` — the secret bundles and `instance.env` live
there — and it cannot read the SSH keys or `~/.ssh`. The only file it gets from that directory
is `/etc/codebox/agent.env` (`0640 root:codebox-workspace`), whose allowlist carries the model
provider keys and no line of it starts with `CB_`.

| Control | Implementation |
| --- | --- |
| Working directory | One worktree per session; the process cwd is that directory. |
| Permissions | Every request is answered inline from `decidePermission`: `allow` replies `once`, `ask` and `deny` reply `reject`. A run allows in-worktree edits and bash (`agent-runtime.md` §6). There is no chat mode and no second tool profile: every session is a run. Nothing waits for an operator. |
| Schedule writes | There is no model-facing tool that creates or edits a schedule; a schedule belongs to a repository and is written through `/v1` by an operator device (D56). A run that could write one would turn prompt injection into a persistent primitive. |
| Session targets | A chat is an editor with one target and gets one worktree plus one allowed path — `TODO.md`, `design/**`, or a notes file for a work. The daemon refuses any write outside it and the gate repeats the check (`target_violation`), so a poisoned backlog cannot make its editor touch code. A session never starts a run (D55). |
| Environment | Allowlist through `/etc/codebox/agent.env` (`0640 root:codebox-workspace`): the model provider keys only, and no line of it starts with `CB_`. `HOME` is `/var/lib/codebox-agent`; `PATH` and `LANG` are systemd's. No GitHub token, no session secret, no Vault token, no tunnel token. |
| Network | No inbound listener and no listener of its own. Outbound is **allowed and not filtered**: no egress filter ships in v1, so the permission policy and the sandbox below are the boundary. |
| Secrets in the repo | The gate runs a secret scan over the run's own diff; a hit fails the run with `gate_failed` before the branch is pushed and no PR exists. |
| Prompt injection | Repository text is data, not instructions; the envelope says so; protected paths stop the dangerous diffs. |
| Resource use | Timeout, cost cap, concurrency cap, disk guard. |
| Isolation | **No** bubblewrap or container runner in v1. The systemd unit is the isolation boundary: `User=codebox-agent`, `Group=codebox-workspace` (never `codebox`), `CapabilityBoundingSet=`, `SystemCallFilter=@system-service`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `UMask=0007`, and only `/srv/codebox` and `/var/lib/codebox-agent` are writable. `MemoryDenyWriteExecute` is never set: it would kill V8's JIT. |

`/etc/codebox` stays `0750 root:codebox` and `/var/lib/codebox` — SQLite, logs, the sealed
credential store — stays `0750 codebox:codebox`, so the agent can read neither even though it
shares the worktrees. The two writable trees are `2770 codebox:codebox-workspace` with the
setgid bit, so every file either process writes inherits the shared group and the daemon can
still run the gate, commit, push and delete a finished worktree. The boundary is measured, not
assumed: `90-verify.sh --only isolation` fails the bake when a mode or a unit directive is
wrong.

The agent never gets a credential that can push to `main`: the installation token is scoped to
the selected repositories, and branch protection (where the plan allows it) plus the cycle's
own rule keep `main` for merges.

## 7. Secrets

- No secret in the repository, the image, a log, a prompt or a push payload. A commit that
  contains one is a release blocker.
- Secrets come from the host's own store at first boot: `/etc/codebox/secret-bundles.json`
  (`0600`, operator-written) when the host has it, and OCI Vault through the OCI instance
  principal on OCI otherwise. Either way they are written to `/etc/codebox/instance.env`
  (`0600`, `root:codebox`) and read by systemd. The dev fallback is a local `.env` outside the
  repo.
- Logs are structured JSON and pass through the redactor: keys matching `token`, `secret`,
  `password`, `key`, `authorization`, `cookie`, `private` and the provider key names are
  replaced with `[redacted]`. The redactor never mutates its input and is tested with a
  30-fixture corpus.
- `cb doctor`-style provider checks report `configured` and a last-four fingerprint, never the
  value.
- Rotation is documented in `docs/providers.md` §16. The session secret rotation logs devices
  out of their access tokens but not of their refresh tokens.

### 7.1 Credential and integration allowlist (D49, D50)

- A credential is **write-only**: the daemon seals it with AES-256-GCM under `CB_SECRETS_KEY`
  into one JSON envelope per credential under `CB_STATE_DIR/secrets/credentials` — directory
  `0700`, file `0600`, both owned by the daemon's user and a tree the agent cannot read. The
  API reports `configured`, `lastFour` and `lastUsedAt`, and never returns the value, a prefix
  longer than four characters or the sealed envelope.
- `expose = env` is limited to `kind: "model_key"`. Anything else is a `422` with
  `details.reason = "env_not_allowed"`: the model provider key is the only secret whose child
  may see it in the environment, and even there only the names listed in
  `CB_MODEL_PROVIDER_KEYS` cross over, never the daemon's whole environment.
- An integration declares its `allowedHosts`. `POST /v1/integrations/{id}/request` checks
  `https` and the full host against that list **before any DNS lookup** and before the outbound
  call, so a name that would resolve elsewhere never gets a socket; a refusal is a `422` with
  `details.reason = "host_not_allowed"`.
- The key names and their formats are in [`docs/providers.md`](providers.md) — `CB_SECRETS_KEY`
  among them — and are not repeated here.

## 8. Data protection

| Data | At rest | Retention |
| --- | --- | --- |
| SQLite | On the host's encrypted boot volume (`cb-boot` on OCI, the 100 GB `gp3` volume on AWS); file mode `0600` | Runs 90 d, events 14 d, work messages 90 d (D28) |
| Worktrees | Disk; removed after 168 h | Branch stays on GitHub |
| Backups | age-encrypted in the host's object store (`cb-backups` on OCI, `s3://cb-codebox-backups` on AWS), 30 daily copies | 30 d |
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
| The VM is reclaimed when idle | OCI Always Free rule, and an AWS spot box is reclaimed with two minutes' notice | Backups, reproducible image, repo as source of truth |
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

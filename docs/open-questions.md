# Open questions

Everything below still needs a human answer. Each item says what it changes, what I recommend,
and whether it blocks the next batch. A question that blocks nothing is still worth answering
before Phase 3.

## Blocking Batch 1

None. Batch 1 only bootstraps the repo and the pipeline.

## Blocking Phase 3 (the app)

### Q1. How is the app distributed first?

Options: installable **PWA** only; PWA + **Android APK** sideload/internal track; PWA +
**TestFlight**; all three from day one.

**Recommendation:** PWA first (zero store friction, instant updates, works on the desktop),
then Capacitor builds for iOS/Android in the same phase once the screens are stable. TestFlight
needs an Apple Developer account; Play needs a one-time fee.

**Changes:** CI build matrix, signing secrets, release checklist, whether push uses Web Push
or FCM/APNs first.

### Q2. Which phone is the reference device?

iOS or Android changes the push path, the biometric plugin and the background behaviour.

**Recommendation:** whichever the owner carries daily; build the other in CI and test it
monthly. The UI targets a 320 px viewport either way.

### Q3. Design direction

Options: dark "mission control" (monospace logs, signal green, amber warnings, dense cards);
light Ionic-native (system look, less branding); follow the operating system theme.

**Recommendation:** dark by default with a light theme, one accent (signal green) and a single
monospace face for logs. Avoid a full admin-template look: this is a remote control, not a
back-office.

**Changes:** theme tokens, icon set, screenshot-review criteria.

## Blocking Phase 2 (the headless loop)

### Q4. GitHub App or PAT for the first run?

The design says GitHub App first. Creating one needs a GitHub account with permission to
install apps; a personal account can do it.

**Recommendation:** create `codebox-bot` as a GitHub App owned by the personal account,
installed only on the selected repositories, with `Contents: read/write`, `Pull requests:
read/write`, `Checks: read`, `Metadata: read`. Keep the PAT fallback for the day the app
cannot be installed.

**Changes:** onboarding steps, secret names, webhook (optional), token refresh tests.

### Q5. Which repositories are onboarded first?

Candidates: `pkm-randomlike` (the donor of the OCI scripts, real gate, real backlog),
`slate-line`, `codebox` itself.

**Recommendation:** start with `codebox` (self-hosting, low stakes) and
`pkm-randomlike` (real workload). Add one more only after ten green runs.

**Changes:** `CB_REPO_ALLOWLIST`, first jobs, probation set.

### Q6. Auto-merge probation?

The owner chose automatic merge when the gate is green. The question is whether the first N
runs should still wait for a tap.

**Recommendation:** a one-week probation: auto-merge only after each repo has five green runs
and no protected-path diff; after that, `auto` for that repo. This is a policy default, not a
code change.

**Changes:** seed data, notification copy, the beta exit criterion.

## Blocking Phase 4 (the box)

### Q7. Same VM as `pkm-randomlike` or a new one?

The Always Free A1 allowance is 2 OCPU / 12 GB (or 4/24 on PAYG). pkm's autopilot already
expects a box.

**Recommendation:** one box, two systemd services, separate users and state directories. If
capacity is tight, Codebox first (it is the interactive tool); pkm's autopilot can run
on Actions until the resize.

**Changes:** memory budget, disk layout, whether pkm's autopilot moves to Codebox as a
job.

### Q8. Domain and Cloudflare account

The tunnel needs a hostname (e.g. `cb.<domain>`) and a Cloudflare zone. Access can be limited
to the owner's email or a service token.

**Recommendation:** a dedicated subdomain on the existing zone, Cloudflare Access with the
owner's email plus a service token for the CLI, and a tunnel token in OCI Vault. Do not reuse
the game's hostname.

**Changes:** `CB_PUBLIC_URL`, `CB_PUBLIC_HOSTNAME`, DNS record, Access policy, cookie domain.

### Q9. Backups: where and how?

OCI Object Storage is the obvious target (same tenancy, no new vendor). Encryption: age with a
key held off-box, or GPG.

**Recommendation:** nightly `cb backup` to `cb-backups` with age encryption; keep 30 daily
copies; store the age private key in the password manager, never on the VM. Test a restore in
Phase 4.

**Changes:** IAM policy for Object Storage, `ops/vm/backup.sh`, the restore drill.

### Q10. OCI capacity fallback

If Madrid never yields an A1 slot, options: keep waiting, accept a 1/6 shape, or run the image
on a small PAYG instance.

**Recommendation:** keep the retry chain; if it has not yielded by the end of Phase 3, launch
1/6 and resize later. The image is provider-portable, so a cheap non-OCI VM is the last resort.

## Blocking Phase 5 (trust)

### Q11. Cost cap and model budget

`CB_DAILY_COST_USD=10` is a guess. The real number depends on the model and the workload.

**Recommendation:** start at 5 USD/day during the beta, raise it after a week of measured
spend. A run that hits the cap is cancelled, not paused mid-tool.

### Q12. Prompt/log retention and privacy

Runs contain repository content and possibly secrets in output.

**Recommendation:** store the prompt and a truncated event log (14 days), never store raw
tool output that matches the secret scanner, and redact by key. Chat history 90 days.

### Q13. Screenshot/screen-recording protection on Android

`FLAG_SECURE` prevents screenshots of the app. It also blocks the owner's own screenshots.

**Recommendation:** off by default; a setting for the paranoid. iOS has no equivalent.

## Not blocking, decide later

- **Q14. License and repository visibility.** MIT is the workspace default; a private repo needs
  none. Visibility also decides the CI host: a private repository pays for Actions minutes, a
  public one does not (`agent-ci.md` §11). Decide before the first public push.
- **Q15. i18n beyond English/Spanish.** The app ships EN/ES; adding a locale is cheap but a
  translation is not free.
- **Q16. Desktop wrapper.** PWA is enough for v1; Tauri only if native notifications or a
  global shortcut become important.
- **Q17. A second device for someone else.** D3 says one operator. A second person is a new
  decision, not a pairing.
- **Q18. Webhooks from GitHub.** Polling checks is enough for v1; webhooks would cut latency
  and add a signature surface.
- **Q19. Model provider choice per job.** The job schema has `model`; the UI can expose a
  shortlist. The default is the owner's current model.
- **Q20. Whether pkm's autopilot becomes a Codebox job.** Attractive (one control plane),
  but pkm's cycle is tightly coupled to its repo. Migrate only after Task-32.

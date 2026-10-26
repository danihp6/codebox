# `@codebox/app`

The hybrid client: Angular 22 + Ionic 9 + Capacitor, standalone components, signals and a
zoneless change detector. Task-18 scaffolds the workspace: the shell, the frozen router, the
API client, auth, SSE, i18n, the theme tokens, the PWA manifest and the service worker.
Tasks 19–23 replace the placeholder feature pages in place.

## Files

- `package.json` — workspace manifest; pinned versions and the build/test scripts.
- `angular.json` — the application, dev-server and unit-test targets (Vitest + jsdom, headless,
  pointed at `vitest.config.mts`).
- `tsconfig.json` — the standalone CLI tsconfig plus the repository's strict flags.
- `tsconfig.app.json` — the browser build project.
- `tsconfig.spec.json` — the unit-test project.
- `vitest.config.mts` — the unit runner budget (30 s per test for cold lazy-loader resolution).
- `capacitor.config.ts` — app id, name, web directory and Android scheme.
- `ngsw-config.json` — shell-only service-worker cache; no `/v1/**` entry.
- `public/icons/icon-192.png` — maskable PWA icon, 192 px.
- `public/icons/icon-512.png` — maskable PWA icon, 512 px.
- `src/index.html` — document head, manifest link and `<app-root>`.
- `src/main.ts` — `bootstrapApplication(AppComponent, appConfig)`.
- `src/styles.css` — global layout, tab and stream-state styles.
- `src/manifest.webmanifest` — PWA manifest.
- `src/assets/i18n/en.json` — English dictionary.
- `src/assets/i18n/es.json` — Spanish dictionary (default locale).
- `src/theme/variables.css` — the `--cb-*` tokens and the light override.
- `src/theme/tokens.ts` — the same tokens for TypeScript consumers.
- `src/app/app.component.ts` — `ion-app`, router outlet, tab bar and stream-state hook.
- `src/app/app.config.ts` — zoneless, Ionic, router, HTTP, service-worker providers.
- `src/app/app.routes.ts` — every route of `docs/app.md` §4, lazy and guarded.
- `src/app/app.routes.spec.ts` — path table and lazy-loader resolution.
- `src/app/shell/tabs.page.ts` — the five bottom tabs.
- `src/app/shell/tabs.page.spec.ts` — tab order and rendered hooks.
- `src/app/core/api/api-client.ts` — typed `/v1` client, `ApiError`, pair parsing, the run detail reads, cancel and revert.
- `src/app/core/api/api-client.spec.ts` — payload parsing, error-envelope mapping, the event page and the run detail calls.
- `src/app/core/api/http.ts` — the API base URL, prefix and URL helper.
- `src/app/core/auth/auth.store.ts` — pairing, restore, single-flight refresh, logout.
- `src/app/core/auth/auth.store.spec.ts` — mocked pairing and refresh rotation.
- `src/app/core/auth/pairing.ts` — per-install ECDSA key pair and public JWK.
- `src/app/core/auth/secure-store.ts` — IndexedDB AES-GCM store with a memory fallback.
- `src/app/core/auth/secure-store.spec.ts` — memory fallback, clearing and the token key.
- `src/app/core/auth/auth.interceptor.ts` — bearer header, one refresh replay, logout on 401.
- `src/app/core/auth/auth.guard.ts` — restore-or-pair guard.
- `src/app/core/events/sse-client.ts` — fetch SSE reader, backoff, `Last-Event-ID`, gap.
- `src/app/core/events/sse-client.spec.ts` — frame parsing, backoff and gap resume.
- `src/app/core/events/sse.service.ts` — one stream per session, exposed as signals.
- `src/app/core/events/events.ts` — untrusted frame to typed stream event.
- `src/app/core/i18n/i18n.service.ts` — signal locale, dictionary loader and `t`.
- `src/app/core/i18n/i18n.spec.ts` — key parity and missing-key behaviour.
- `src/app/core/settings/settings.store.ts` — locale and theme persisted in the secure store.
- `src/app/features/about/about.page.ts` — about/404 placeholder.
- `src/app/features/approvals/approvals.page.ts` — approvals placeholder.
- `src/app/features/chat/chat-list.page.ts` — chat list placeholder.
- `src/app/features/chat/chat.page.ts` — chat detail: streaming messages, tool and permission cards, promote, the routine confirmation card and the `routine` badge.
- `src/app/features/dashboard/dashboard.page.ts` — dashboard placeholder.
- `src/app/features/jobs/job.page.ts` — job detail placeholder.
- `src/app/features/jobs/jobs.page.ts` — the Jobs tab: list, pause/resume, run-now and create, plus the in-page Routines tab.
- `src/app/features/jobs/routines.api.ts` — `/v1/routines` list, get, patch, pause, resume, run-now and delete; no create.
- `src/app/features/jobs/routines.api.spec.ts` — every routines URL and method, the query filters, the 204 and the boundary parse failure.
- `src/app/features/jobs/routines-format.ts` — the cron summary with the routine timezone, the next fire and the last fire.
- `src/app/features/jobs/routines-format.spec.ts` — the pinned schedule strings and the null timestamps.
- `src/app/features/jobs/routines-panel.ts` — the routines tab: rows with kind and cost, actions, confirm-then-delete and the editor sheet.
- `src/app/features/jobs/routines-panel.spec.ts` — reminder and prompt rows, the three actions, the confirmed delete, the editor rules and the empty/loading/error states.
- `src/app/features/jobs/routines.store.ts` — the routines list, the optimistic toggles, run-now, delete and the routine event refetch.
- `src/app/features/jobs/routines.store.spec.ts` — load, the pause rollback, resume, run-now, delete and the three refetch frames.
- `src/app/features/pairing/pairing.page.ts` — pairing placeholder.
- `src/app/features/repos/repo.page.ts` — repo detail placeholder.
- `src/app/features/repos/repos.page.ts` — repos placeholder.
- `src/app/features/run-detail/run.page.ts` — run detail: timeline, gate, guardrails, blockers, diff, PR, cost, cancel and revert.
- `src/app/features/run-detail/run.page.spec.ts` — run hooks, guardrail states, actions and dictionary completeness.
- `src/app/features/run-detail/run-detail.store.ts` — the run projection, its two actions and the stream reducer.
- `src/app/features/run-detail/run-detail.store.spec.ts` — loading, cancel confirmation, revert and stream handling.
- `src/app/features/run-detail/timeline.ts` — dedupe keys and one-line details for the event timeline.
- `src/app/features/run-detail/timeline.spec.ts` — key precedence, detail rendering and page merging.
- `src/app/features/runs-list/runs.page.ts` — runs placeholder.
- `src/app/features/settings/devices.page.ts` — paired devices, current-device marker and a confirmed revoke per row.
- `src/app/features/settings/devices.page.spec.ts` — empty state, current-device row, confirm-then-revoke and the error block.
- `src/app/features/settings/devices.store.ts` — paired devices, the calling device and revoke (with logout of the calling device).
- `src/app/features/settings/devices.store.spec.ts` — load, revoke another device and revoke the calling one down to an empty secure store.
- `src/app/features/settings/i18n.ts` — the settings and devices dictionary in `en` and `es`.
- `src/app/features/settings/settings.api.ts` — `/v1/me`, version, settings, providers, brake, cache wipe, devices and notification preferences; a missing route is not an error.
- `src/app/features/settings/settings.api.spec.ts` — every URL, 404-as-absent, the 403 scope refusal and boundary parsing.
- `src/app/features/settings/settings.page.ts` — profile, time zone, notifications, providers, danger zone and about, with explicit `unavailable` blocks.
- `src/app/features/settings/settings.page.spec.ts` — the unavailable blocks, every section, the preference toggle and dictionary completeness.
- `src/app/features/settings/settings.store.ts` — five independent reads, the time zone, the brake, the cache wipe and optimistic preference toggles.
- `src/app/features/settings/settings.store.spec.ts` — independent reads, a 404 per resource, optimistic toggles and their rollbacks.

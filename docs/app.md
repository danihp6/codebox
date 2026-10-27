# The app

The hybrid client is the only way the operator commands Codebox (D3). It is an Angular 22 +
Ionic Angular 9 + Capacitor application that talks to `/v1` and renders events; it never
speaks to OpenCode, GitHub or a model provider (D4).

## 1. Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Framework | Angular 22, standalone components, signals, `provideRouter` | Current major; no NgModules. |
| UI | Ionic Angular 9 (`@ionic/angular/standalone`) | Native-feeling navigation, safe areas, hardware back. |
| Native shell | Capacitor (iOS + Android) | One codebase, native push, Keychain/Keystore, deep links. |
| Web | `@angular/service-worker` PWA | Installed on desktop and Android without a store. |
| State | Signals + small stores; no NgRx | The daemon is the state; the app caches views, not truth. |
| HTTP | `HttpClient` + `withFetch()` behind a typed `ApiClient` written against `packages/contracts` parse helpers; one source of truth for payloads. | One source of truth for payloads. |
| Stream | `fetch` + `ReadableStream` SSE reader with `Last-Event-ID` and backoff (`EventSource` cannot send the bearer header). | SSE survives the tunnel and mobile networks. |
| i18n | Signal-based `I18nService` with `assets/i18n/{en,es}.json`; no third-party i18n runtime (bundle budget, no extra dependency). | Runtime switch (D24); no rebuild per locale. |
| Tests | Angular's supported unit runner + Playwright (D32) (Vitest via `ng test`, headless, jsdom) | Unit for logic, Playwright for the flows. |

Versions are pinned in `package.json` at Batch 1; a major bump is its own task. The app is
built by `ng build`, served by the daemon from `/opt/codebox/app`, and wrapped by Capacitor
with `npx cap sync`.

## 2. Starting point

D31: start from the **official Ionic Angular starter** (tabs), not from an admin template.
Reviewed and rejected as a base:

| Template | Licence | Verdict |
| --- | --- | --- |
| Ionic Angular starter | MIT | **Base.** Tabs, routing, theming and Capacitor already wired. |
| CoreUI Angular | MIT | Reference for tables and density; Bootstrap conflicts with Ionic. |
| ng-matero | MIT | Reference for Material forms; do not mix Material and Ionic components. |
| Tabler / Tabler Angular | MIT | Reference for dashboard cards. |
| AdminLTE | MIT | Reference only; jQuery-era layout. |
| ngx-admin | MIT | Avoid: NgModule-heavy, older Angular idioms, hard to tree-shake. |

The rule: borrow *visual* ideas, never a component system. A Bootstrap grid inside an Ionic
app fights the safe areas and the router.

## 3. Project layout

```
apps/app/src/
  main.ts                     # bootstrapApplication, providers
  app/
    app.routes.ts             # every route, lazy, declared by Task-18
    app.config.ts             # router, http, i18n, sw, error handler
    core/
      api/                    # generated client + typed wrappers
      auth/                  # pairing, tokens, secure storage, guards
      events/                # SSE service, reconnect, event bus
      push/                  # web push + Capacitor push registration
      settings/              # local preferences (theme, locale)
      util/                  # time, formatting, result types
    features/
      dashboard/
      repos/
      chat/
      jobs/
      runs-list/
      run-detail/
      approvals/
      settings/
    shared/                   # cards, chips, empty states, log viewer, diff stat
    theme/                    # tokens, dark/light, Ionic variables
  assets/i18n/{en,es}.json
```

One feature folder owns its routes, components and store. A shared component moves to
`shared/` only when a second feature needs it. A feature's copy lives beside it in its own
`i18n.ts`; the shared dictionaries hold the shell keys only (see §9).

## 4. Screens

| Route | Screen | What it must do |
| --- | --- | --- |
| `/pair` | Pairing | Scan or paste a code, name the device, store tokens. |
| `/dashboard` | Dashboard | Health, queue, today's spend, last five runs, approvals badge. |
| `/repos` | Repos | List, add wizard, verify, policy badges. |
| `/repos/:id` | Repo | Gate editor, protected paths, policy, recent runs. |
| `/chat` | Chat list | Sessions by repo, last message, unread marker. |
| `/chat/:id` | Chat | Streaming text, tool cards, permission cards, interrupt, promote. |
| `/jobs` | Jobs | List, next fire, pause/resume, create; a **Routines** tab lists the chat schedules with their kind, the cron's local time and the next fire, and opens the editor as a sheet. |
| `/jobs/:id` | Job | Cron and timezone editor, next fires, history. |
| `/runs` | Runs | Filterable list with state chips and cost. |
| `/runs/:id` | Run detail | Timeline, gate tail, guardrail checklist, PR link, cancel, revert. |
| `/approvals` | Inbox | Pending permissions and guardrail exceptions. |
| `/settings` | Settings | Devices, notifications, providers, language, theme, danger zone. |
| `/settings/devices` | Devices | Revoke, rename, last seen. |
| `/about` | About | Version, commit, server health, licences. |

Bottom tabs: **Dashboard · Chat · Jobs · Runs · Settings**. Detail screens push onto the
stack; deep links (`codebox://run/<id>`, `https://cb.example.com/runs/<id>`) open the same
route.

## 5. State and data

- **The server is the state.** Stores hold the last response and a `stale` flag; a reconnect
  refetches instead of merging a guess.
- **Signals, not subjects.** A feature store exposes `signal<T>()` plus explicit actions;
  components read signals and call actions. No store reaches into another feature's store.
- **Optimistic only for toggles** (pause/resume, notification preference) with a rollback on
  error. A run, a message or a job creation is never optimistic: it needs a server id.
- **Routines refetch on activation.** The routines tab loads on every activation and on every
  `routine.fired`, `routine.replied` or `routine.failed` frame; pause and resume are optimistic
  with rollback, like a job toggle. Creation is not optimistic: the card corroborates the new
  routine from `GET /v1/routines`.
- **Caching:** the last successful payload per route in memory; a persisted snapshot of the
  dashboard and the last 50 runs for offline display. No chat history is persisted on the
  device beyond the current session (D36) — it is re-fetched.
- **Errors** are typed from the API envelope; a screen renders `code`, a human message and a
  retry. A 401 clears the session and routes to `/pair`.

## 6. Authentication and secure storage

1. `cb pair --name "Dani iPhone"` prints a QR and a short code (TTL 300 s).
2. The app sends `POST /v1/pair` with the code, a device name and a generated key pair.
3. The **refresh token** goes to Keychain (iOS) or Keystore (Android) through a secure-storage
   plugin; the web build uses IndexedDB with a non-extractable key and a shorter TTL.
4. The **access token** lives in memory only — never `localStorage`, never a cookie the
   daemon would trust.
5. Every request runs through an interceptor: attach the bearer, on 401 refresh once with a
   single-flight lock, replay, and on a second 401 log out.

The device key pair signs the refresh request, so a copied refresh token alone is not enough.
Biometric unlock (Face ID / fingerprint) gates the app on resume when enabled; it protects
the UI, not the token, which is already in the OS store.

## 7. Live events

`EventsService` owns one `EventSource` per app session:

- subscribes to `/v1/events` with the last processed id, not the last received;
- reconnects with exponential backoff (1 s → 30 s, jitter) and resumes from `Last-Event-ID`;
- on `gap`, refetches the open run or chat instead of stitching;
- pauses on `document.hidden` after 30 s and reconnects on foreground;
- fans out by event type to feature stores; a screen subscribes to a filtered selector.

Rendering rules: deltas append to the current message, tool events insert a card once (keyed
by tool call id), and a reconnect never duplicates a message because the store dedupes by
`(messageId, seq)`.

## 8. Chat

The chat screen is the product's front door:

- a message list with markdown and syntax-highlighted code (lazy-loaded highlighter);
- tool cards that show the tool, a one-line summary and an expandable redacted payload;
- permission cards with **Allow once / Allow for session / Deny**, disabled after reply;
- a composer that stays usable while the agent works, with a stop button;
- "Promote to run" opens a confirmation with the repo, base branch and the prompt that will
  be used, then navigates to the new run;
- a routine created in chat renders a confirmation card with its kind (`reminder` or `prompt`),
  the cron's local time in the routine's own timezone and the next fire, corroborated from
  `GET /v1/routines`; an answer a routine produced carries a `routine` badge and a link to the
  list, taken from the `routine.replied` frame, so it is not redrawn after a full reload.

Streaming text is appended with a single `requestAnimationFrame` flush per frame; the list
sticks to the bottom only when the user is already at the bottom.

## 9. Design direction

- **Dark by default**, light theme available and following the system by default on iOS.
- **One accent**: signal green for healthy and merged; amber for waiting on a human; red
  only for failed. No gradients, no glass, no decorative illustration.
- **Monospace** (system mono stack) for logs, diffs, branch names and ids; the UI face is the
  platform default.
- **Density**: a run row is three lines; a timeline item is one line plus an expandable body.
- **320 px** is the reference width: no horizontal scroll anywhere; tables become cards.
- **Motion** is functional (route transitions, a pulsing dot while a run is live) and
  respects `prefers-reduced-motion`.
- **Copy and localisation**: `src/assets/i18n/{en,es}.json` holds the shell keys (`app`,
  `tabs`, `pair`, `common`, `run`) and nothing feature-specific; each feature folder ships its
  own `i18n.ts` with both locales and a spec that proves EN/ES parity. Features are written in
  parallel and the shared dictionaries are a hot file, so a feature never edits them: it adds a
  key to its own module in both languages in the same change.

## 10. Offline and failure

| Situation | Behaviour |
| --- | --- |
| No network | Cached dashboard and runs list; a banner says the data is stale. |
| Tunnel down | Same; the SSE service retries with backoff. |
| Daemon restarting | Health card shows `down`; actions queue nothing and explain why. |
| 401 after refresh fails | Log out, clear the secure store, route to pairing with the reason. |
| Clock skew | The server's `Date` header corrects relative timestamps; absolute times stay UTC. |

There is no offline write queue: dispatching work that the user believes happened but did not
is worse than a disabled button.

## 11. Push

- **Web/PWA:** `PushManager` subscription with the VAPID public key, stored through
  `POST /v1/push/subscriptions`.
- **Native:** Capacitor Push (FCM/APNs) with the same event-to-payload mapping (D30).
- Payloads carry `{ type, runId?, chatId?, routineId?, title, body }`; a tap deep-links to the
  resource.
- Preferences per event type (`run.finished`, `run.failed`, `approval.created`, `run.merged`,
  `routine`), plus quiet hours evaluated on the daemon, not the device.

## 12. Testing

- **Unit:** feature stores, guards, the SSE reducer and the pairing flow with a mocked API.
  No test mounts a real `EventSource`.
- **Component:** the permission card, the cron picker and the run timeline, with fixtures
  from `packages/contracts`.
- **E2E (Playwright, Task-26):** pair against a fake daemon, add a repo, run, watch a
  streamed tool, approve, see the PR and the merge. Fixed clock and seed.
- **Accessibility:** axe on every route in CI; 44 px touch targets; labels on every icon
  button.
- **Budgets:** initial bundle ≤ 350 KB gzipped; lazy feature chunks ≤ 150 KB; LCP < 2.5 s on
  a throttled mid-range phone.

## 13. Build and release

```bash
npm run build -w apps/app          # ng build --configuration production
npx cap sync                       # copy the web build into ios/ and android/
npx cap open ios | android         # only when a native change needs Xcode/Gradle
```

- The web build is the artifact the daemon serves; the native shells are built in CI when a
  release is cut (Task-29).
- Version, commit and build time are injected at build time and shown in `/about`.
- The PWA manifest ships name, short name, theme colour, maskable icon and the app's
  `start_url`; the service worker caches the shell only, never API responses with tokens.
- Signing keys and store credentials are CI secrets, never in the repository or the image.

## 14. Non-goals for the client

- No code editor, no terminal, no file browser (product.md §7).
- No account, no organisation, no sharing — one operator (D3).
- No background sync of chat history or runs; the daemon is the record.
- No custom design system package in v1: tokens and shared components live in the app until a
  second consumer exists.

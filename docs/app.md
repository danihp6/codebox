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
      backlog/
      works/
      providers/
      settings/
    shared/                   # cards, chips, empty states, log viewer, diff stat
    theme/                    # tokens, dark/light, Ionic variables
  assets/i18n/{en,es}.json
```

One feature folder owns its routes, components and store. A shared component moves to
`shared/` only when a second feature needs it. A feature's copy lives beside it in its own
`i18n.ts`; the shared dictionaries hold the shell keys only (see §9).

## 4. Screens

The target set after D43-D50. `design/README.md` maps each of these to a Figma frame; a route
here without a frame, or a frame without a route, is a bug in one of the two.

| Route | Screen | What it must do |
| --- | --- | --- |
| `/pair` | Pairing | Enter the ten-character code and a device name, submit, see one inline reason when the code is used, expired or unknown, and land on the dashboard; the same screen after a 401. |
| `/dashboard` | Dashboard | **Running** and **ready** (an open PR), today's spend, health, and **one block per repository**; the start card on a fresh box. |
| `/repos` | Repos list | The repository list with a **search field and no filters**: name, clone/gate state, `pending · running · merged` counts, and **one amber dot** when something needs the operator (an unreviewed PR or a red run); **add** connects one from the GitHub App installation, showing `connected` / `cloning` / `unavailable` per row. |
| `/repos/:id` | Repo · backlog | The repository's `TODO.md` in file order: section, checkbox, `Task-NN`, title, runtime chip; `Run` on a pending item; **the chat button** opens a session with four targets (backlog, design, schedule, rework) or `repo` for a read-only chat; tabs **Backlog · Workers · Schedule · Design**. |
| `/repos/:id/workers` | Repo · workers | The repository's factory: four role rooms (`ORQ`, `ARC`, `DEV`, `QA`), one face and one task chip per subagent, the road in and the belt out, and the four states `queued`, `running`, `needs you`, `asleep`. `needs you` is a badge on the worker whose task is blocked: the orchestrator holds the card and the decision, the builder takes another task. A face opens that agent's log (`/works/:id`); there is no per-agent button. |
| `/repos/:id/schedule` | Repo · schedule | The one `RepoSchedule`: mode, window, selection, caps, next fire, pause and *Run next* (D56). |
| `/repos/:id/design` | Repo · design | Screen specs, tokens and snapshots from `design/`, with the state checklist and the preview. |
| `/works/:id` | Work · run log | Runs, gate and PR cards, context header, cost, and **one action when blocked**: *Resolve doubt*; a merged work offers **Rework**, which opens a session whose proposal is a new run. No composer (D55). |
| `/sessions/:id` | Session | A chat with one target: thread, the target document, and the **pending proposal** with its files and *Merge*. With no target it is read-only: no proposal panel, just the thread and the repo's context. |
| `/settings` | Settings | Repository viewers, credentials, provider accounts, devices, notifications, appearance, danger zone. The providers and notifications panels render inside this route; they have no route of their own. |
| `/settings/providers` | Provider accounts | Accounts per provider in failover order, each with state (`active` / `exhausted` / `invalid`), reset instant, spend today, and add by OAuth or token; never a value beyond the last four characters (D54). |
| `/settings/credentials` | Credentials | Connected services (GitHub App by manifest, integrations) and open credentials, write-only; the add sheet has the three `expose` modes, `env` is limited to the model key and shows its warning, saving passes a confirm step, and a value is only ever shown as its last four characters. |
| `/settings/devices` | Devices | Scopes per device, revoke, last seen; this device cannot revoke itself. |
| `/settings/notifications` | Notifications | Five toggleable events plus the non-toggleable credential alert, and quiet hours. |
| `/about` | About | Version, commit, server health, licences. |

Bottom tabs: **Dashboard · Repos · Settings** (D47). A repository is a destination, not a
filter; Settings owns the cross-repository lists. Detail screens push onto the stack; deep links
(`codebox://works/<id>`, `https://cb.example.com/works/<id>`) open the same route.

A repository carries exactly four tabs — **Backlog · Workers · Schedule · Design** — and the tab
strip is one component, so a tab can never exist on one screen and not another.

**The repository is the spine.** A work exists only inside one repository, one per backlog item,
and never changes (D44). There is no free chat, no scope chip and no promote: the backlog item
*is* the prompt, and the work's runs are the attempts. A chat is an editor bound to one target —
the backlog, the design or a single work — and it proposes; the merge disposes (D55). There is
no approval prompt anywhere in this flow (D45).

## 5. State and data

- **The server is the state.** Stores hold the last response and a `stale` flag; a reconnect
  refetches instead of merging a guess.
- **Signals, not subjects.** A feature store exposes `signal<T>()` plus explicit actions;
  components read signals and call actions. No store reaches into another feature's store.
- **Optimistic only for toggles** (pause/resume, notification preference) with a rollback on
  error. A run, a message or a work creation is never optimistic: it needs a server id.
- **Schedules refetch on activation.** The schedules list loads on every activation and on
  every `schedule.fired` or `schedule.failed` frame; pause and resume are optimistic with
  rollback. Creation is not optimistic: the row corroborates the new schedule from
  `GET /v1/schedules`. A schedule belongs to the repository, so the Schedule tab reads the row.
- **Caching:** the last successful payload per route in memory; a persisted snapshot of the
  dashboard and the last 50 runs for offline display. No work thread is persisted on the device
  beyond the current session (D28) — it is re-fetched.
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
- on `gap`, refetches the open run or work instead of stitching;
- pauses on `document.hidden` after 30 s and reconnects on foreground;
- fans out by event type to feature stores; a screen subscribes to a filtered selector.

Rendering rules: deltas append to the current message, tool events insert a card once (keyed
by tool call id), and a reconnect never duplicates a message because the store dedupes by
`(messageId, seq)`.

## 8. Work and session

**Work** is the run log, not a conversation (D55):

- a header with the repository, the state, the backlog item, the attempt count, the context
  tokens with their epoch and the cost;
- one segment per run — branch, outcome, gate and PR cards rendered from the `Run` object,
  never from prose — and the ticked backlog item on a merged run;
- tool cards with the tool, a one-line summary and an expandable redacted payload;
- a **single action when blocked**: *Resolve doubt* opens the decision session, and a `merged`
  work offers *Rework*, which opens a new attempt on the same work and refetches the log. No
  composer, no free-form chat: a work that needs to talk is a work that ended in
  `needs_decision`;
- a design sheet with the snapshot and the states the spec declares, when the repository has
  `design/` (D52);
- a `provider.state` line when the agent moved to another account mid-run (D54).

**Session** is the editor (D55):

- a header naming its target — `TODO.md`, `design/`, `.codebox/schedule.yml` or the work it is
  bound to — because the target is also the write boundary;
- a `design` session renders the repository's preview **above the thread**: `design/` at the
  pending proposal's commit, or at the default branch head when nothing is pending, with its
  tokens, its routes, each screen's three declared states and the findings of the
  tokens/routes/states check (D52). It is the repository's spec, never a canvas; a repository
  with no `design/` says so, and a pending change names the commit it will land;
- the preview refetches when that commit changes and never draws a state the file does not
  declare;
- the thread, the same streaming and tool-card rules, and a composer that stays usable with a
  stop button;
- a **proposal panel** with the branch, the commit, the files it may touch and *Merge*; while a
  proposal is pending the composer is disabled, so one change lands at a time;
- a proposal is cleared whatever the merge answers, so a refused merge re-enables *Merge* and
  names its reason;
- a `repo` session is read-only: no proposal panel and no merge button, just the thread and the
  composer;
- `Compact` when the context reaches its warning band (D48).

Streaming text is appended with a single `requestAnimationFrame` flush per frame; the list
sticks to the bottom only when the user is already at the bottom.

## 9. Design direction

- **Dark by default**, light theme available and following the system by default on iOS.
- **One accent**: signal green for healthy and merged; amber for waiting on a human; red
  only for failed. No gradients, no glass, no decorative illustration. On light, `#22c55e` on
  white is 2.1:1, so **text and strokes use the ink variants** `color.brand.green` (`#15803d`)
  and `color.waiting.amber` (`#b45309`) while the signal colour stays for fills and dots.
- **Monospace** (system mono stack) for logs, diffs, branch names and ids; the UI face is Inter,
  bundled through `@fontsource-variable/inter` (400/500/600, 11–30 px, no CDN, no network at
  first paint).
- **Density**: a backlog row is three lines — `Task-NN · title`, the section, and a flow of
  `state · runs · cost` — never three fixed positions, so the same row survives at 320 px.
- **Two facts, never one**: the checkbox is the plan (what should exist) and the chip is the
  state (what actually happened). Collapsing them is how a backlog starts lying about its own
  progress (D51).
- **A list of repositories is not filtered, it is counted.** Three numbers — `pending ·
  running · merged` — say more than a filter bar, and a single amber dot marks the only thing
  that needs a person. No chevron does that job.
- **320 px** is the reference width: no horizontal scroll anywhere; tables become cards.
- **Motion** is functional (route transitions, a pulsing dot while a run is live) and
  respects `prefers-reduced-motion`.
- **Copy and localisation**: `src/assets/i18n/{en,es}.json` holds the shell keys (`app`,
  `tabs`, `pair`, `common`, `run`) and nothing feature-specific; each feature folder ships its
  own `i18n.ts` with both locales and a spec that proves EN/ES parity. A screen that must
  render its copy without the shared dictionary, like `/pair`, duplicates its `pair.*` keys in
  the feature module — the shared file stays untouched. Features are written in parallel and
  the shared dictionaries are a hot file, so a feature never edits them: it adds a key to its
  own module in both languages in the same change.

### Design tokens

`design/tokens.json` is the source: a DTCG colour document with exactly one leaf per value. The
design gate enforces it — a hex literal in a patch that is not one of those twelve values is a
finding, and `codebox-design: allow` marks a deliberate exception — while
`apps/app/src/theme/` mirrors the document for the stylesheet (`THEME_TOKENS` and the `--cb-*`
variables). The table below is the list read, never a second source (D52).

| Token | Value | Role |
| --- | --- | --- |
| `color.surface.bg` | `#0b0f14` | Dark background; also the light theme's text. |
| `color.surface.raised` | `#121821` | Dark card and row surface. |
| `color.surface.bg-light` | `#f7f9fb` | Light background. |
| `color.surface.raised-light` | `#ffffff` | Light card and row surface. |
| `color.ink.text` | `#e6edf3` | Dark theme text. |
| `color.ink.muted` | `#8b98a5` | Dark theme muted text. |
| `color.ink.muted-light` | `#5b6772` | Light theme muted text. |
| `color.brand.green` | `#15803d` | Brand green for text and strokes in light. |
| `color.brand.bright` | `#22c55e` | Signal green; fills and dots only (2.1:1 on white). |
| `color.waiting.amber` | `#b45309` | Waiting amber for text and strokes in light. |
| `color.waiting.bright` | `#f59e0b` | Waiting; the fill and the dot in dark. |
| `color.danger.red` | `#ef4444` | Failure only. |
| `font.sans` | `Inter Variable` | The bundled UI face; the origin of `--ion-font-family`. |
| `font.mono` | `ui-monospace, sfmono-regular, menlo, consolas, 'Liberation Mono', monospace` | Logs, diffs, branch names, ids. |

## 10. Offline and failure

| Situation | Behaviour |
| --- | --- |
| No network | Cached dashboard, repository list and the last backlog read; a banner says the data is stale. |
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
- Payloads carry `{ type, runId?, workId?, scheduleId?, title, body }`; a tap deep-links to the
  resource.
- Preferences per event type (`run.finished`, `run.failed`, `approval.created`, `run.merged`,
  `provider.state`, `schedule`), plus quiet hours evaluated on the daemon, not the device.

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
- No background sync of work threads or runs; the daemon is the record.
- No custom design system package in v1: tokens and shared components live in the app until a
  second consumer exists.

# Spec: Task-80 — Workers motion

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app (UI + CSS, no daemon and no contract change).
- **Role:** Dev.
- **Objective:** The repository's `Workers` tab moves like a factory: a truck pulls in on the
  road, a package runs the belt out, a token crosses the doors on a hand-off, and the worker
  faces blink on four offset cycles. All motion is CSS keyframes driven by the existing
  `WorkState` signals, stops completely under `prefers-reduced-motion: reduce`, and never
  covers or swallows a tap on a face.
- **Environment:** worktree `../wt-cb-80`, branch `task-80`, base `main` @ `38bd0f3`.
- **Dependencies:** Task-77 (merged; it produced `apps/app/src/app/features/works/repo-workers.page.ts`,
  `workers.model.ts`, `i18n.ts`, the four rooms, the road in and the belt out). Task-78 is in
  the same batch and touches disjoint paths; this task needs none of its files.
- **Turnstile:** when the work is complete, leave an empty commit with the exact subject
  `dev: done task-80` on the branch tip and push it. QA writes the verdict; the Dev does not
  merge.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/theme/variables.css`
- `apps/app/src/app/features/works/workers.motion.ts` (new)
- `apps/app/src/app/features/works/workers.motion.spec.ts` (new)
- `apps/app/src/app/features/works/repo-workers.page.ts`
- `apps/app/src/app/features/works/repo-workers.page.spec.ts`
- `apps/app/README.md` — **shared path, split by line block.** This task owns only the
  `src/app/features/works/**` lines and the `src/theme/**` lines (currently
  `src/theme/variables.css` and `src/theme/tokens.ts`). It must not edit the
  `src/app/features/backlog/**` lines; Task-78 owns those. If this task adds no new theme
  file, the two existing `src/theme/**` lines stay unchanged.

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md` and the files it owns:

- `design/README.md` §3 and §6 — the factory, the motion frames `25`/`25b` and `28`/`28b`, and
  the **80 ms** blink.
- `docs/app.md` §9 and §12 — the tokens and the accessible tap-target rule.
- `apps/app/src/app/features/works/workers.model.ts` — `WorkersBoard`, `WorkerCard`, the lane
  order and the existing `projectWorkers`.
- `apps/app/src/app/features/works/i18n.ts` — the existing copy; **not edited**.
- `apps/app/src/theme/tokens.ts` — the TypeScript mirror of the tokens; **not edited**.
- `apps/app/src/app/readme.spec.ts` — the README file-map rule.
- `apps/app/src/app/features/works/repo-workers.page.spec.ts` — the existing fixture and hooks.

## 🔒 Contract

The public surface other tasks and QA are written against. Exact names and signatures.

### `apps/app/src/app/features/works/workers.motion.ts` (new)

```ts
export const BLINK_PHASES = 4;
export const BLINK_STAGGER_MS = 1000;

/** `index` modulo four, always in `0 | 1 | 2 | 3`, for any integer. */
export function blinkPhase(index: number): number;

/**
 * Assigns a phase to every card in board order: the road in, then ORQ, ARC, DEV and QA in
 * drawing order, then the belt out. The first card gets phase 0, the fourth phase 3, the fifth
 * phase 0 again. The map is keyed by `workId`.
 */
export function assignBlinkPhases(
  cards: readonly { readonly workId: string }[],
): ReadonlyMap<string, number>;
```

Pure: no clock, no timer, no `requestAnimationFrame`, no DOM, no random value.

- **Purity:** the module reads only its arguments; the browser media query is CSS, not a
  JavaScript feature flag.
- **Errors:** no HTTP status, no SSE event and no log line; the component adds no external
  input and catches nothing new.

### `repo-workers.page.ts`

The component keeps every current member and adds:

```ts
readonly blinkPhases = computed<ReadonlyMap<string, number>>(() =>
  assignBlinkPhases([
    ...this.board().roadIn,
    ...this.board().rooms.flatMap((room) => room.cards),
    ...this.board().beltOut,
  ]),
);

blinkPhaseOf(workId: string): number; // blinkPhases().get(workId) ?? 0
```

Every existing `worker-face` anchor gains
`[attr.data-blink-phase]="blinkPhaseOf(card.workId)"`. The value is exactly `0`, `1`, `2` or
`3`; it is the only new attribute on a face.

Three decorative elements are added **only when `works().length > 0`** (an empty factory has
no loop). Each is `aria-hidden="true"`, has no text content that a screen reader needs, and is
never an ancestor of a face:

- `workers-truck` — a `<span class="cb-workers-truck">` inside the `workers-road-in` section,
  before its cards.
- `workers-package` — a `<span class="cb-workers-package">` inside the `workers-belt-out`
  section, before its cards.
- `workers-token` — a `<span class="cb-workers-token">` between the `DEV` section and the `QA`
  section (inside the `@for (room of board().rooms ...)` loop, after the `DEV` section).

No button, `role="button"`, click handler or `routerLink` is added to any decoration. The
existing face anchor is still the only tap target that opens `/works/:id`; there is still no
per-agent button.

### `apps/app/src/theme/variables.css`

Append the four animations and their classes. The exact class names are contract because the
component template above renders them:

- `.cb-workers-truck` — `animation: cb-truck-in 5s ease-in-out infinite;`
- `.cb-workers-package` — `animation: cb-package-belt 4s linear infinite;`
- `.cb-workers-token` — `animation: cb-token-cross 3.2s ease-in-out infinite;`
- `.cb-worker-face` — `animation: cb-face-blink 4s steps(1, end) infinite;`
- `.cb-worker-face[data-blink-phase='0']` — `animation-delay: 0ms;`
- `.cb-worker-face[data-blink-phase='1']` — `animation-delay: 1000ms;`
- `.cb-worker-face[data-blink-phase='2']` — `animation-delay: 2000ms;`
- `.cb-worker-face[data-blink-phase='3']` — `animation-delay: 3000ms;`

The keyframes are named `cb-truck-in`, `cb-package-belt`, `cb-token-cross` and
`cb-face-blink`. The blink itself is a short opacity dip of about 80 ms inside the 4 s cycle
(`design/README.md` §6); the four 1 s offsets are what makes the faces out of phase. The three
decoration rules also set `pointer-events: none;`. The lane, room and `.cb-workers` containers
clip their decorations (`overflow: hidden`) so a translated truck, package or token cannot
create horizontal scroll at 320 px, and the decorations never sit over a face.

The reduced-motion block is frozen and must be the last rule in the file:

```css
@media (prefers-reduced-motion: reduce) {
  .cb-worker-face,
  .cb-workers-truck,
  .cb-workers-package,
  .cb-workers-token {
    animation: none;
  }
}
```

`animation: none` is required; `animation-play-state: paused` is not enough, because a paused
animation still reserves its effect and is not the "loop is off" contract.

### Data

- `data-blink-phase` — `0 | 1 | 2 | 3`, assigned in board order and wrapped every four cards.
- CSS delays — phase 0 → `0ms`, 1 → `1000ms`, 2 → `2000ms`, 3 → `3000ms`; the four faces are
  therefore out of phase by one second each.
- Decorations — present only when the board has at least one card; `aria-hidden="true"`;
  `pointer-events: none` in CSS.
- No new i18n key: the motion is decorative, so `i18n.ts` is not edited.

## 🧩 Configuration

None. This task adds or reads no `CB_*` key and does not touch `docs/providers.md`.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. The full gate for the Dev and QA is exactly:

```
npm ci --prefer-offline --no-audit --no-fund
npm run lint
npm test
npm run build
```

For an app task, nothing more: the repository has **no** `playwright.config.*` and this runner
has no browser. The `[live]` criteria are measured on a browser and reported through
`scripts/agent/issue.mjs`, never claimed as passing here.

Targeted commands while implementing:

- `npm test -w @codebox/app`
- `git diff --name-only main...task-80` — audit against the exclusive paths.

**Acceptance criteria:**

- [ ] **`[unit]`** `workers.motion.spec.ts` proves `blinkPhase` wraps every integer into
  `0..3` (`blinkPhase(0) = 0`, `blinkPhase(3) = 3`, `blinkPhase(4) = 0`,
  `blinkPhase(-1) = 3`) and `assignBlinkPhases` gives the first four cards four distinct
  phases and repeats phase 0 on the fifth, in board order.
- [ ] **`[unit]`** `workers.motion.spec.ts` reads `src/theme/variables.css` as text (not
  `getComputedStyle`, which jsdom does not evaluate for media queries) and proves: the file
  contains `@media (prefers-reduced-motion: reduce)`; the block after it contains `animation:
  none` and all four selectors `.cb-worker-face`, `.cb-workers-truck`, `.cb-workers-package`,
  `.cb-workers-token`; the three decoration rules contain `pointer-events: none`; the
  `data-blink-phase='0'..'3'` rules carry `0ms`, `1000ms`, `2000ms` and `3000ms`.
- [ ] **`[unit]`** `repo-workers.page.spec.ts`, mounting the existing five-work fixture,
  asserts every `worker-face` has `data-blink-phase` in `0..3`, the first four faces have four
  distinct phases, and `workers-truck`, `workers-package` and `workers-token` exist with
  `aria-hidden="true"` and are not ancestors of a face. Mounting the empty fixture asserts
  the three decorations are absent and the four rooms still render. Every face is still an
  `<a>` whose `href` is `/works/{workId}`, and the tree still contains no `button` or
  `[role="button"]`.
- [ ] **`[unit]`** `npm test -w @codebox/app`, `npm run lint`, `npm test` and `npm run build`
  pass.
- [ ] **`[unit]`** `git diff --name-only main...task-80` lists only the exclusive paths above;
  `app.routes.ts`, `packages/contracts/**`, `apps/daemon/**`,
  `apps/app/src/app/features/backlog/**`, `workers.model.ts`, `i18n.ts`, `tokens.ts`,
  `TODO.md` and `CHANGELOG.md` are untouched.
- [ ] **`[live]`** At **320 px** in Chromium, the four faces blink out of phase: read
  `getComputedStyle(face).animationDelay` on the first four
  `[data-testid="worker-face"]` elements and observe exactly `0s`, `1s`, `2s`, `3s` (four
  distinct values), while `document.getAnimations()` reports a running `cb-face-blink`.
- [ ] **`[live]`** A tap during the animation still opens the log: at
  `/repos/:id/workers` with a running blink, tap a face whose animation is running and assert
  `location.pathname === '/works/{workId}'` for that face. **Measurement:** a browser at
  320 px, not a screenshot. Report both `[live]` criteria **not run** on this runner (no
  browser, no `playwright.config.*`) and hand them to `scripts/agent/issue.mjs` as
  `--label agent-review --title 'Task-80 [live] workers motion' --body-file -`.

## 📣 Coordination

- **For the Orchestrator:** this task claims **no hot file** and no route. It owns the
  `features/works/**` and `src/theme/**` line blocks of `apps/app/README.md`. The only shared
  path in the batch is that README; Task-78 owns the `features/backlog/**` lines and neither
  edits the other's block.
- **For Task-78 (same batch):** do not touch `apps/app/src/app/features/works/**`,
  `apps/app/src/theme/**`, or the `features/works/**` / `src/theme/**` lines of
  `apps/app/README.md`. Task-80 does not touch `features/backlog/**`, contracts, the daemon or
  `docs/api.md`.
- **For the next batch:** `workers.motion.ts` exposes the phase rule and
  `data-blink-phase`/`data-testid` hooks a future deck or test can read. The reduced-motion
  contract is the media block in `variables.css`, not a JavaScript feature flag.

## ⛔ Out of scope

- No new dependency, no animation library, no `package.json` or `package-lock.json` change.
- No change to `apps/app/src/app/app.routes.ts`, `packages/contracts/**`, `apps/daemon/**`,
  `apps/app/src/app/features/backlog/**`, `workers.model.ts`, `i18n.ts` or `tokens.ts`.
- No JavaScript timer, `requestAnimationFrame`, CSS-in-JS, SVG, canvas, image asset or emoji
  dependency; the motion is CSS keyframes over the existing signals.
- No per-agent button, no new route, no change to what a face does (it still opens
  `/works/:id`).
- No screenshot or visual-regression test; the `[live]` criteria are timing and interaction
  measurements.
- No change to `docs/decisions.md`, `opencode.json`, `.agent_roles/**`, `scripts/agent/**` or
  `CHANGELOG.md`.

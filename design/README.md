# design

The repository's design source and its prototype map. Tasks read the specs and tokens here; it is
the operator's input for the app tasks (L2 in `TODO.md`).

| File | What it is |
| --- | --- |
| `README.md` | This map: frame, route and feature folder. |
| `exports/` | One PNG per frame, named after its caption. Created by the export step in §4. |

The file the map describes is `codebox` in Figma, edited through the `figma-edit` plugin. It
holds the routed screens, the repository's two views (backlog and workers), the design session
and the agent cast, in two themes and three widths, re-cut on 2026-10-28 against
D44/D47/D51-D56: the unit is a work and one backlog item, the repository is the root and the
backlog file is the list. Dark is the default (`docs/app.md` §9); light exists for every mobile
screen; 1280 is the desktop layout. Do not commit the `.fig` itself — only the link below and
the exports.

**The workers view is a factory, not a chat.** The repository screen has two tabs, `Backlog` and
`Workers`. The workers tab draws four role rooms (`ORQ`, `ARC`, `DEV`, `QA`) with one face and
one task chip per subagent, a road in on the left and a belt out on the right. Its states are
four, not six: `queued`, `running`, `needs you` and `asleep`. A failed run is not a screen: the
failed package leaves on the belt with a red strap and the orchestrator blocks the task and
opens a decision, while the dev takes another task. A shipped run is not a screen either: the
work moves on and the crew sleeps until it is given work.

**The schedule screen is retired.** The repository's schedule is configuration, not a screen;
its three dark frames and three light frames were deleted on 2026-10-28.

## 1. Routed screens

One row per route in `apps/app/src/app/app.routes.ts`. The values are the frame captions in
Figma, not the layer names.

| Screen | Route | Feature folder | dark | light | desktop | 320 |
| --- | --- | --- | --- | --- | --- | --- |
| Pairing | `/pair` | `features/pairing` | 01 | L1 | — | — |
| Repo list | `/repos` | `features/repos` | 02 | L2 | — | — |
| Repo · backlog | `/repos/:id` | `features/backlog` | 22 | L22 | D9 · LD9 | — |
| Repo · workers | `/repos/:id/workers` | `features/works` | 20c · 20e–20i | L20 · L20e–L20i | D5–D8 · LD5–LD8 | — |
| Design · session | `/sessions/:id` (`design`) | `features/sessions` | 25 | L25 | — | — |
| Dashboard | `/dashboard` | `features/dashboard` | 05 | L5 | D2 · D4 | — |
| Settings | `/settings` | `features/settings` | 06 | L6 | — | — |
| Devices | `/settings/devices` | `features/settings` | 15 | L21 | — | — |
| Credentials | `/settings/credentials` | `features/credentials` | 16 | L8 | — | S3 |
| Notifications | `/settings/notifications` | `features/settings` | 17 | L22 | — | — |
| About | `/about` | `features/about` | 07 | L7 | — | — |

**One row per state of the workers view:** `20i` queued, `20c` running, `20f` needs you, `20e`
asleep — and `L20`, `L20f`, `L20i`, `L20e` in light. `20h` (shipped) and `20g` (failed) were
deleted: a merged run hands the work on and sleeps, a failed one becomes a decision.

**Missing and known:** there is no frame yet for `/settings/providers` (provider accounts,
D54), for the per-repository blocks on the dashboard, or for the checkbox column of a backlog
row.

## 2. States and sheets

Not routes. A sheet is opened over the screen named in its row.

| State | Opened from | Feature folder | dark | light |
| --- | --- | --- | --- | --- |
| New session (four targets, or none) | `/repos/:id`, chat button | `features/sessions` | 03a | L9 |
| Decision session | `/repos/:id/workers`, *needs you* | `features/sessions` | 04a | L4a |
| Session sheet | sheet over `/sessions/:id` | `features/sessions` | 04b | L4b |
| Waiting to enter | `▤` chip on the workers view | `features/works` | 23 · D10 | L23 |
| Delivered | `🔔` chip on the workers view | `features/works` | 24 · D11 | L24 |
| First run | `/dashboard`, no repositories | `features/dashboard` | 12 | L18 |
| Offline | banner on any screen | `shared/offline-banner` | 13 | L19 |
| Unpaired | `/pair`, after a 401 | `features/pairing` | 14 | L20 |
| Connect a service | sheet over `/settings/credentials` | `features/credentials` | 18 | L23 |
| Add credential | sheet over `/settings/credentials` | `features/credentials` | 19 | L24 |

**Removed in the 2026-10-28 re-cut:** the connect-repository picker, the cloning screen and the
free-chat `⋯` menu. Connecting a repository happens from the `+` on `/repos`, and its clone
state lives in the row, so a whole screen for it was one tap too many.

**The workers sheets are the task lists.** The two chips over the drawing are the only two
controls: `▤` opens the tasks waiting to enter, `🔔` opens the delivered ones, and each row is
the task the worker is holding. Tapping a face opens that agent's log (frame `04`).

**In sync (2026-10-28):** dark and light match for `02`, `03`, `04`, `04a`, `04b` and `03a`
(four targets: Backlog, Design, Schedule, Rework). **Still stale:** `08b`/`08c` keep the
pre-schedule copy and need a pass before the map is trusted for those two.

## 3. Widths and themes

| Suffix | Frame | When it applies |
| --- | --- | --- |
| none | 390 × 844 | Phone reference for dark; the default frame of a band |
| `L` | 390 × 844 | The same screen in light. A screen without an `L` twin is unfinished |
| `D` | 1280 × 800 | Desktop dark: rail 76, repos 300, content 904. `D5`–`D8` workers, `D9` backlog, `D10`/`D11` sheets |
| `LD` | 1280 × 800 | The same desktop frames in light: `LD5`–`LD8`, `LD9` |
| `S` | 320 × 568 | The reference width. If a row survives here, it survives everywhere |

## 4. Export

The export is a manual step, and the reason is honest: an agent cannot pull 40 PNGs through the
plugin without moving hundreds of megabytes through its context, so the driver queue never gets
this task.

1. In Figma, select a frame, `Export`, PNG, scale 2.
2. Name the file after the caption, kebab-cased: `01-pairing-dark.png`,
   `L1-pairing-light.png`, `D1-repo-backlog-work.png`, `S1-repo-backlog-320.png`.
3. Keep every file under 400 kB. A frame that exceeds it has too many hidden layers, not a
   bigger asset.

## 5. Tokens

The tokens are mirrored in `apps/app/src/theme/` (the DTCG source lands in `design/tokens.json`, Task-74) and documented in `docs/app.md` §9: dark by default,
signal green, amber for waiting on a human, red only for failure, monospace for logs, ids and
diffs. The Design System band repeats the values for reading, never as the source.

Light uses `#15803d` and `#b45309` for text and strokes: `#22c55e` on white is 2.1:1 and is
reserved for fills and dots.

## 6. Rules

- A new route adds one row to §1 in the same task that adds the route.
- A frame that stops matching the code is fixed in Figma or deleted; a stale frame is worse
  than no frame.
- A frame never shows a control the product does not have: no chat that writes without a
  target, no promote, no approval prompt, no scope chip.
- The header of a backlog is a **chat button**, never a `+`: the only way to create work is to
  talk, and the sheet asks for the target (backlog, design, or none for a read-only chat).
- **The workers view has two controls and no buttons per agent.** The `▤` and `🔔` chips are the
  only tappable chrome; a face is a target to its own log. A new per-agent button is a design
  regression.
- **State lives on the worker, not on the room.** `needs you` is a 20 px badge over the head of
  the worker whose task is blocked; the room keeps its normal fill.
- **Motion frames** live outside the routed bands: `25`/`25b` (truck, package and hand-off,
  smart animate in a loop) and `28`/`28b` (blink, 80 ms). `27` documents the four faces. A new
  animated flow adds its pair next to them and states the trigger.
- **The design session previews the repository's artifact** (D52) and never invents a canvas:
  `25` shows `design/` at a commit, its declared states and what is pending.

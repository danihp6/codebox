# design

Local visual references. The agent pipeline does not read this folder to build screens; it is
the operator's input for the app tasks (L2 in `TODO.md`).

| File | What it is |
| --- | --- |
| `README.md` | This map: frame, route and feature folder. |
| `exports/` | One PNG per frame, named after its caption. Created by the export step in §4. |

The file the map describes is `codebox` in Figma, edited through the `figma-edit` plugin. It
holds **55 frames in 11 bands**, two themes and three widths, re-cut on 2026-10-28 against
D44/D47/D51-D54: the unit is a work, the repository is the root, and the backlog file is the
list. Dark is the default (`docs/app.md` §9); light exists for every screen; 320 px is the
reference width; 1280 is the desktop layout. Do not commit the `.fig` itself — only the link
below and the exports.

## 1. Routed screens

One row per route in `apps/app/src/app/app.routes.ts`. The values are the frame captions in
Figma, not the layer names.

| Screen | Route | Feature folder | dark | light | desktop | 320 |
| --- | --- | --- | --- | --- | --- | --- |
| Pairing | `/pair` | `features/pairing` | 01 | L1 | — | — |
| Repo · backlog | `/repos/:id` | `features/backlog` | 02 | L2 | D1 · D3 | S1 |
| Work | `/works/:id` | `features/works` | 03 | L3 | D1 · D3 | S2 |
| Repo home | `/repos/:id` header | `features/repos` | 04 | L4 | — | — |
| Dashboard | `/dashboard` | `features/dashboard` | 05 | L5 | D2 · D4 | — |
| Settings | `/settings` | `features/settings` | 06 | L6 | — | — |
| Devices | `/settings/devices` | `features/settings` | 15 | L21 | — | — |
| Credentials | `/settings/credentials` | `features/credentials` | 16 | L8 | — | S3 |
| Notifications | `/settings/notifications` | `features/settings` | 17 | L22 | — | — |
| About | `/about` | `features/about` | 07 | L7 | — | — |

**Missing and known:** there is no frame yet for `/settings/providers` (provider accounts,
D54), for the per-repository blocks on the dashboard, or for the checkbox column of a backlog
row. Task-75 draws them before the app lands.

## 2. States and sheets

Not routes. A sheet is opened over the screen named in its row.

| State | Opened from | Feature folder | dark | light |
| --- | --- | --- | --- | --- |
| New work, empty | `/repos/:id`, `+` | `features/works` | 03a | L9 |
| Work · standing (schedule) | `/works/:id`, schedule on | `features/works` | 03b | L10 |
| Work sheet (context, cost, cancel) | sheet over `/works/:id` | `features/works` | 03c | L11 |
| Schedule asked | over `/works/:id` | `features/schedules` | 08b | L13 |
| Proposed schedule card | over `/works/:id` | `features/schedules` | 08c | L14 |
| Connect repository | `/repos/pick` | `features/repos` | 09 | L15 |
| Repo cloning | after `POST /v1/repos` | `features/repos` | 11 | L17 |
| First run | `/dashboard`, no repositories | `features/dashboard` | 12 | L18 |
| Offline | banner on any screen | `shared/offline-banner` | 13 | L19 |
| Unpaired | `/pair`, after a 401 | `features/pairing` | 14 | L20 |
| Connect a service | sheet over `/settings/credentials` | `features/credentials` | 18 | L23 |
| Add credential | sheet over `/settings/credentials` | `features/credentials` | 19 | L24 |

**Retired, kept for the record:** `04b · Retired · Schedule filter` and `10 · Retired · free
chat menu` (dark, `L12`/`L16` light). They document the model D43/D47 replaced; delete them
once the new backlog and work frames are exported.

`04b` and `10` are not linked from any route. A frame that stops matching the code is fixed or
deleted.

## 3. Widths and themes

| Suffix | Frame | When it applies |
| --- | --- | --- |
| none | 390 × 844 | Phone reference for dark; the default frame of a band |
| `L` | 390 × 844 | The same screen in light |
| `D` | 1280 × 800 | Desktop: rail 76, list 320, content 760. D1/D2 light, D3/D4 dark |
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

Tokens live in `apps/app/src/theme/` and are documented in `docs/app.md` §9: dark by default,
signal green, amber for waiting on a human, red only for failure, monospace for logs, ids and
diffs. The Design System band repeats the values for reading, never as the source.

Light uses `#15803d` and `#b45309` for text and strokes: `#22c55e` on white is 2.1:1 and is
reserved for fills and dots.

## 6. Rules

- A new route adds one row to §1 in the same task that adds the route.
- A frame that stops matching the code is fixed in Figma or deleted; a stale frame is worse
  than no frame.
- A frame never shows a control the product does not have: no free chat, no promote, no
  approval prompt, no scope chip.

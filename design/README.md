# design

Local visual references. The agent pipeline does not read this folder to build screens; it is
the operator's input for the app tasks (L2 in `TODO.md`).

| File | What it is |
| --- | --- |
| `README.md` | This map: frame, route and feature folder. |
| `exports/` | One PNG per frame, named after its caption. Created by the export step in §4. |

The file the map describes is `codebox` in Figma, edited through the `figma-edit` plugin. It
holds **56 frames in 11 bands**, two themes and three widths, drawn against D43-D50. Dark is
the default (`docs/app.md` §9); light exists for every screen; 320 px is the reference width;
1280 is the desktop layout. Do not commit the `.fig` itself — only the link below and the
exports.

## 1. Routed screens

One row per route in `apps/app/src/app/app.routes.ts`. The values are the frame captions in
Figma, not the layer names.

| Screen | Route | Feature folder | dark | light | desktop | 320 |
| --- | --- | --- | --- | --- | --- | --- |
| Pairing | `/pair` | `features/pairing` | 01 | L1 | — | — |
| Chat list | `/chat` | `features/chat` | 02 | L2 | D1 · D3 | S1 |
| Chat | `/chat/:id` | `features/chat` | 03 | L3 | D1 · D3 | S2 |
| Repo filter | `/chat?filter=repo` | `features/repos` | 04 | L4 | — | — |
| Dashboard | `/dashboard` | `features/dashboard` | 05 | L5 | D2 · D4 | — |
| Settings | `/settings` | `features/settings` | 06 | L6 | — | — |
| Devices | `/settings/devices` | `features/settings` | 15 | L21 | — | — |
| Credentials | `/settings/credentials` | `features/credentials` | 16 | L8 | — | S3 |
| Notifications | `/settings/notifications` | `features/settings` | 17 | L22 | — | — |
| About | `/about` | `features/about` | 07 | L7 | — | — |

## 2. States and sheets

Not routes. A sheet is opened over the screen named in its row.

| State | Opened from | Feature folder | dark | light |
| --- | --- | --- | --- | --- |
| New chat, empty | `/chat/new` | `features/chat` | 03a | L9 |
| Scheduled chat | `/chat/:id`, `kind = schedule` | `features/chat` | 03b | L10 |
| Context sheet | sheet over `/chat/:id` | `features/chat` | 03c | L11 |
| Schedule filter | `/chat?filter=schedule` | `features/schedules` | 04b | L12 |
| Schedule asked in chat | `/chat/new` | `features/chat` | 08b | L13 |
| Proposed schedule card | `/chat/new` | `features/chat` | 08c | L14 |
| Connect repository | `/repos/pick` | `features/repos` | 09 | L15 |
| Chat menu `⋯` | sheet over `/chat/:id` | `features/chat` | 10 | L16 |
| Converting to repo chat | `/chat/:id`, `kind` binding | `features/chat` | 11 | L17 |
| First run | `/dashboard`, no repositories | `features/dashboard` | 12 | L18 |
| Offline | banner on any screen | `shared/offline-banner` | 13 | L19 |
| Unpaired | `/pair`, after a 401 | `features/pairing` | 14 | L20 |
| Connect a service | sheet over `/settings/credentials` | `features/credentials` | 18 | L23 |
| Add credential | sheet over `/settings/credentials` | `features/credentials` | 19 | L24 |

## 3. Widths and themes

| Suffix | Frame | When it applies |
| --- | --- | --- |
| none | 390 × 844 | Phone reference for dark; the default frame of a band |
| `L` | 390 × 844 | The same screen in light |
| `D` | 1280 × 800 | Desktop: rail 76, list 320, content 760. D1/D2 light, D3/D4 dark |
| `S` | 320 × 568 | The reference width. If a row survives here, it survives everywhere |

## 4. Export

The export is a manual step, and the reason is honest: an agent cannot pull 56 PNGs through the
plugin without moving hundreds of megabytes through its context, so the driver queue never gets
this task.

1. In Figma, select a frame, `Export`, PNG, scale 2.
2. Name the file after the caption, kebab-cased: `01-pairing-dark.png`,
   `L1-pairing-light.png`, `D1-chat-dark.png`, `S1-chat-list-320.png`.
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

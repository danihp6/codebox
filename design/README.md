# design

Local visual references. The agent pipeline does not read this folder to build screens; it is
the operator's input for Task-18 and the app tasks (L2 in `TODO.md`).

| File | What it is |
| --- | --- |
| `README.md` | This map. |
| `prototype.md` | The Figma link, the screen-to-route map and the token notes. |

The prototype covers seven screens and the states that matter:

| Screen | Route | Key states |
| --- | --- | --- |
| Pair | `/pair` | code, scanning, error, success |
| Dashboard | `/` | healthy, degraded, empty |
| Repos | `/repos` | list, gate red, adding |
| Chat | `/chat/:id` | idle, streaming, permission, routine card |
| Jobs | `/jobs` | list, cron editor, routines tab |
| Run detail | `/runs/:id` | running, gate red, merged, cancelled |
| Settings | `/settings` | devices, notifications, danger zone |

Tokens live in `docs/app.md` §9: dark by default, light variant, signal green, amber, red,
monospace for logs. Export PNGs at 390×844 and a desktop 1280×800 variant; do not commit the
Figma file itself, only the link and the exports.

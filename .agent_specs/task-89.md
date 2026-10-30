# Spec: Task-89 — Dark by default, and the theme preference reaches the DOM

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** app.
- **Role:** Dev.
- **Objective:** The app is dark on every platform at first paint, and the theme the operator
  picked is the theme the document actually paints. `SettingsStore.theme` (default `dark`) drives
  `<html data-theme>`, the stylesheet carries **no** `prefers-color-scheme` rule, and the light
  palette is a `:root[data-theme='light']` block built from the same twelve colour leaves of
  `design/tokens.json`. Following the system survives only where `docs/app.md` §9 keeps it: the
  **initial value on iOS**, used when nothing is stored and never persisted on its own. After
  this task `SettingsStore.setTheme` is no longer dead code: a light-mode laptop opens dark, and
  `setTheme('light')` repaints it and survives a reload.
- **Environment:** worktree `../wt-cb-89`, branch `task-89`, base `main`.
- **Dependencies:** none. Everything this task reads is already merged:
  `docs/app.md` §9 (the dark-by-default rule and the twelve-token table), `design/tokens.json`
  (the twelve colour leaves), `apps/app/src/theme/variables.css` (the dark `:root`, the media
  query it replaces, the workers motion), `apps/app/src/app/core/settings/settings.store.ts`
  (`theme`, `setTheme`, `load`), `apps/app/src/app/app.component.ts` (the shell effect host).

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.**

- `apps/app/src/theme/variables.css`
- `apps/app/src/app/core/settings/settings.store.ts`
- `apps/app/src/app/core/settings/settings.store.spec.ts` (new — it does not exist today)
- `apps/app/src/app/app.component.ts`
- `apps/app/src/app/app.component.spec.ts`
- `apps/app/README.md` (lines for `src/theme/variables.css`,
  `src/app/app.component.ts`/`.spec.ts` and the new
  `src/app/core/settings/settings.store.spec.ts` only)

No other path. In particular these are **read-only**, and editing one is a bug even if it looks
like an improvement: `apps/app/src/theme/tokens.ts`, `apps/app/src/theme/tokens.spec.ts`,
`apps/app/src/app/features/works/workers.motion.spec.ts`, `apps/app/src/index.html`,
`apps/app/src/styles.css`, `apps/app/src/app/core/i18n/i18n.service.ts`,
`apps/app/src/app/core/auth/secure-store.ts`, `apps/app/src/app/app.routes.ts`,
`apps/app/src/app/features/**` (no page is touched: the settings page's theme control is Task-96),
`apps/app/angular.json`, `package.json`, `package-lock.json`, `design/**`, `docs/app.md`,
`TODO.md`, `CHANGELOG.md`, `docs/decisions.md`.

Two files outside this list read `variables.css` and must stay green **untouched**; they are the
reason the contract below is written this precisely:

- `apps/app/src/theme/tokens.spec.ts` — resolves every `--cb-*` name with a
  first-match-in-file regex, and asserts the font import is the first thing in the file and
  appears once. The dark `:root` must therefore stay above any other block that mentions a
  `--cb-*` name.
- `apps/app/src/app/features/works/workers.motion.spec.ts` — asserts that the
  `@media (prefers-reduced-motion: reduce)` block is the **last** rule of the file (nothing but
  whitespace after its closing brace). The light block goes before the motion section.

The CSS contract is tested from `settings.store.spec.ts` (the theme store's spec) because the
item's path list has no `src/theme/*.spec.ts`; do not create one.

### Inputs (read-only)

- `docs/app.md` §9 and its "Design tokens" table — the rule (dark by default, system only as the
  iOS initial value) and the twelve leaves with their roles. In particular `color.surface.bg`
  (`#0b0f14`) is the dark background **and the light theme's text**, and
  `color.brand.green`/`color.waiting.amber` are the ink variants for text and strokes on light,
  while `color.brand.bright`/`color.waiting.bright` stay the signal fills and dots.
- `design/tokens.json` — the twelve `$type: color` leaves; the only source of a hex value.
- `apps/app/src/theme/variables.css` — what exists today.
- `apps/app/src/theme/tokens.ts` and `tokens.spec.ts` — the TypeScript mirror and the first-match
  assertions the rewrite must not break.
- `apps/app/src/app/features/works/workers.motion.spec.ts` — the "reduced motion is last" rule.
- `apps/app/src/app/core/settings/settings.store.ts` — `Theme`, `LocaleCode`, `SETTINGS_KEY`,
  `load`, `setTheme`, `read`, `persist`, `parseStoredSettings`.
- `apps/app/src/app/app.component.ts` and `app.component.spec.ts` — the shell and its harness.
- `apps/app/src/app/core/i18n/i18n.service.ts` — it already calls `settings.load()`; do not edit
  it, but know that a second `load()` is idempotent (`this.loaded ??= this.read()`).
- `apps/app/src/app/core/auth/secure-store.ts` — `SECURE_STORE`, `SecureStore`, the memory
  fallback (the test seam for "survives a reload").
- `apps/app/src/index.html` — `color-scheme: dark light` and `theme-color #0b0f14`; correct as
  they are, and not yours to change.
- `apps/app/src/styles.css` — `body { background: var(--cb-bg) }`; the variable the first paint
  paints with.
- `apps/app/README.md` and `apps/app/src/app/readme.spec.ts` — the file map every `src/app` file
  must appear in.
- `apps/app/src/app/features/pairing/pairing.page.ts` — the existing use of
  `Capacitor.getPlatform()` (the platform seam, already a dependency of the app).

## 🔒 Contract

### 1. `apps/app/src/app/core/settings/settings.store.ts`

```ts
export type Theme = 'dark' | 'light';
export type LocaleCode = 'en' | 'es';

export interface InitialThemeInput {
  readonly stored: Theme | null;
  readonly platform: string;
  readonly prefersLight: boolean;
}

/** The one rule: stored wins, iOS follows the system once, everything else is dark. */
export function initialTheme(input: InitialThemeInput): Theme;

/** Reads the media query only on iOS; every other platform answers false without reading it. */
export function systemPrefersLight(platform: string): boolean;
```

- `initialTheme`: `stored !== null` ⇒ `stored`; else `platform === 'ios'` ⇒
  (`prefersLight ? 'light' : 'dark'`); else `'dark'`. Pure: no clock, no storage, no DOM.
- `systemPrefersLight`: `platform !== 'ios'` ⇒ `false` **without touching `matchMedia`**;
  `platform === 'ios'` ⇒ `globalThis.matchMedia?.('(prefers-color-scheme: light)')?.matches === true`
  (a missing `matchMedia` answers `false`).
- `SettingsStore` keeps `readonly theme = signal<Theme>('dark')` and `readonly locale =
  signal<LocaleCode>('es')`, and keeps `load(): Promise<void>` single-flight and
  `setTheme(theme: Theme): Promise<void>` (signal first, then persist — unchanged order).
- `read()` resolves the theme once with
  `initialTheme({ stored: parsed.theme ?? null, platform: Capacitor.getPlatform(), prefersLight: systemPrefersLight(platform) })`
  and sets it; a stored theme is never overridden by the system. The iOS system value is **not
  persisted** on its own: only `setTheme` writes it.
- `Secret` handling is unchanged: the same `SETTINGS_KEY`, the same JSON shape
  `{ theme, locale }`, the same `parseStoredSettings` (an unknown value is ignored, never a
  crash).
- `Capacitor` is imported from `@capacitor/core` (the app already depends on it).

### 2. `apps/app/src/app/app.component.ts`

- Inject `SettingsStore` and, in the constructor, call `void this.settings.load();` (idempotent;
  the shell does not depend on `I18nService` having loaded it) and register one effect:

  ```ts
  effect(() => {
    document.documentElement.setAttribute('data-theme', this.settings.theme());
  });
  ```

- The attribute is exactly `data-theme` on `document.documentElement` (the `<html>` element) with
  exactly the value `dark` or `light`. It is written on boot even when nothing is stored
  (`dark`), and rewritten whenever `theme()` changes.
- Nothing else moves: the router signal, the tabs, the offline banner and the `sse-connection`
  span keep their current behaviour.

### 3. `apps/app/src/theme/variables.css`

Structure, top to bottom — **the import stays the first line, exactly once**:

1. `@import '@fontsource-variable/inter';`
2. `:root { … }` — the dark palette. It keeps every declaration it has today (`--cb-bg`,
   `--cb-surface`, `--cb-text`, `--cb-muted`, `--cb-accent`, `--cb-warn`, `--cb-danger`,
   `--cb-radius`, `--cb-space`, `--cb-font-mono`, `--cb-font-sans`, the five `--ion-*` values and
   `--ion-font-family`) with the same values, and **adds two**:

   ```css
   --cb-ink-accent: #15803d; /* color.brand.green — text and strokes on light */
   --cb-ink-warn: #b45309;   /* color.waiting.amber — text and strokes on light */
   ```

   `--cb-accent` (`#22c55e`) and `--cb-warn` (`#f59e0b`) stay the **signal** colours (fills and
   dots) in both themes; the two new variables carry the ink variants `docs/app.md` §9 asks for.
3. `:root[data-theme='light'] { … }` — replaces the `@media (prefers-color-scheme: light)` block
   entirely, with exactly these declarations:

   ```css
   :root[data-theme='light'] {
     --cb-bg: #f7f9fb;                        /* color.surface.bg-light */
     --cb-surface: #ffffff;                   /* color.surface.raised-light */
     --cb-text: #0b0f14;                      /* color.surface.bg, the light theme's text */
     --cb-muted: #5b6772;                     /* color.ink.muted-light */
     --ion-background-color-rgb: 247, 249, 251;
     --ion-text-color-rgb: 11, 15, 20;
   }
   ```

   `--ion-background-color`, `--ion-text-color`, `--ion-color-primary`, `--ion-color-warning` and
   `--ion-color-danger` are `var(--cb-*)` indirections and re-resolve on their own; do not
   redeclare them.
4. The workers motion block (unchanged) and, last, `@media (prefers-reduced-motion: reduce)`
   (unchanged).

Every one of the twelve colour leaves of `design/tokens.json` appears in the file, at its
documented role: `#0b0f14` twice (dark background and light text), `#121821` once, `#f7f9fb`
once, `#ffffff` once, `#e6edf3` once, `#8b98a5` once, `#5b6772` once, `#15803d` once, `#22c55e`
once, `#b45309` once, `#f59e0b` once, `#ef4444` once. No other hex value enters the file, and no
`prefers-color-scheme` remains anywhere in it. The `data-theme` value is the only switch: with no
attribute the dark block applies, so the first paint is dark on any device and in any system
appearance.

### 4. Tests

- `settings.store.spec.ts` (new) — `initialTheme`/`systemPrefersLight` tables (stored wins over
  both platforms; iOS follows the system; `web`/`android` are dark; a missing `matchMedia` is
  dark and is only called for `ios`); `load()` with an empty memory `SECURE_STORE` leaves `dark`
  and persists nothing; `load()` with a stored `light` applies it; `setTheme('light')` writes
  `{"theme":"light",…}` through the store and a second instance reading the same store comes back
  `light` ("survives a reload"); a malformed stored payload falls back to `dark` and never
  throws; plus the CSS block below.
- The CSS assertions (same file, reading
  `readFileSync(resolve(process.cwd(), 'src/theme/variables.css'), 'utf8')`, the pattern
  `tokens.spec.ts` and `workers.motion.spec.ts` already use): the file contains no
  `prefers-color-scheme`; the `:root` block declares the nine colour variables with the values in
  §3; `:root[data-theme='light']` exists and declares exactly the six declarations above; all
  twelve hex values appear. Do not restate the motion or font assertions those other two specs
  own.
- `app.component.spec.ts` — the existing two banner tests and the new theme tests share one
  memory `SECURE_STORE` per test (pass it into the mount helper): on boot with nothing stored,
  `document.documentElement.getAttribute('data-theme')` is `'dark'`; after
  `TestBed.inject(SettingsStore).setTheme('light')` plus `fixture.detectChanges()` and
  `await fixture.whenStable()` it is `'light'`; a second mount with the same memory store is
  `'light'` again. Reset the attribute between tests (`document.documentElement.removeAttribute('data-theme')`)
  so a leaked value cannot pass for a written one.

## 🧩 Configuration

No `CB_*` key and no environment variable: the theme is a device preference in the secure store,
never daemon configuration. `docs/providers.md` is not touched.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — the app unit suite (`ng test --watch=false`, Vitest + jsdom, headless) includes
    the tests this task adds, plus the workspace suite. No browser, no daemon, no network: the
    secure store is an in-memory map and no test fetches.
  - `npm run build` — `tsc -b` plus the Angular production build.
  - `git diff --name-only main...task-89` — audit against the exclusive paths.
  - `grep -rn "prefers-color-scheme" apps/app/src` — must print **exactly one** line, in
    `apps/app/src/app/core/settings/settings.store.ts`, inside `systemPrefersLight`, behind
    `platform !== 'ios'` early return. `variables.css` must not appear.
- **Acceptance criteria:**
  - [ ] `[unit]` It typechecks, lints and builds clean (`npm run lint`, `npm run build`).
  - [ ] `[unit]` The declared tests exist and pass (`npm test`), including the untouched
        `apps/app/src/theme/tokens.spec.ts` and
        `apps/app/src/app/features/works/workers.motion.spec.ts`.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched
        (`git diff --name-only main...task-89`); `tokens.ts`, `tokens.spec.ts`,
        `workers.motion.spec.ts`, `app.routes.ts` and `features/**` are not in the diff.
  - [ ] `[unit]` With no stored preference `<html data-theme>` is `dark`, and `setTheme('light')`
        flips it and survives a reload (a second store instance over the same secure store comes
        back `light`); proven by `app.component.spec.ts` and `settings.store.spec.ts`.
  - [ ] `[unit]` No rule reads `prefers-color-scheme` outside the iOS initial value:
        `grep -rn "prefers-color-scheme" apps/app/src` prints one line, in
        `settings.store.ts`, and `systemPrefersLight('web')`/`('android')` answer `false`
        without calling `matchMedia` (spied and never invoked).
  - [ ] `[unit]` `variables.css` declares all twelve colour leaves, the dark `:root` keeps the
        `--cb-*` values `tokens.spec.ts` reads, `:root[data-theme='light']` declares the six
        light declarations, and the reduced-motion block is still the last rule.
  - [ ] `[live]` On a light-mode desktop the app paints dark at first paint, before the daemon
        answers. **Measurement:** serve the built app (`CB_BIND` unmoved/pointed at a closed
        port so no `/v1` call can answer), open `/pair` in a browser forced to
        `prefers-color-scheme: light`, and read (a) `getComputedStyle(document.body).backgroundColor`
        = `rgb(11, 15, 20)` and (b) `<html data-theme="dark">`; then press the light control once
        Task-96 ships it and read `rgb(247, 249, 251)`. Not runnable on this CI runner: **there
        is no browser here (the repository carries no Playwright project), so QA reports every
        `[live]` criterion `not run`, never pass.**

## 📣 Coordination

- **For Task-93 (Repo · workers)** and **Task-96 (Settings cluster):**
  - `<html data-theme>` is now guaranteed, with the value `dark` or `light`, written by the shell
    on boot and on every `SettingsStore.theme` change. `dark` is the default and the value when
    nothing is stored; a light-mode laptop, an Android device and the web build all boot dark;
    only iOS with nothing stored follows the system.
  - `SettingsStore.theme` (`'dark' | 'light'`, core store at
    `src/app/core/settings/settings.store.ts`) is now the only writer of the attribute, and
    `setTheme(theme)` persists it in the secure store under `cb.settings` and repaints. Task-96's
    theme control reads `theme()` and calls `setTheme()`; it must not set `data-theme` itself.
  - Task-93: `variables.css` is the block Task-93 later extends — the motion section keeps its
    position between the light block and the final `prefers-reduced-motion` block, and the
    "reduced motion is the last rule" assertion must survive that extension.
  - Two ink variables now exist for light text and strokes: `--cb-ink-accent` (`#15803d`) and
    `--cb-ink-warn` (`#b45309`). `--cb-accent`/`--cb-warn` remain signal fills and dots in both
    themes.
- **For the Orchestrator:** no hot file is claimed. `apps/app/src/app/app.routes.ts`,
  `apps/app/src/main.ts`, `apps/app/angular.json`, `package.json`, `package-lock.json` and
  `apps/app/src/theme/tokens.ts` are untouched.

## ⛔ Out of scope

- No router change, no new route, no page: `app.routes.ts`, `app.routes.spec.ts` and every
  `features/**` folder are out of bounds. The settings screen's theme control is Task-96.
- No change under `design/`: no frame, no token edit. `design/tokens.json` is read.
- No `tokens.ts`/`tokens.spec.ts` edit, no `index.html` edit, no `styles.css` edit.
- No motion change (Task-93 owns it): the keyframes and the reduced-motion block are copied
  through untouched.
- No `localStorage`/`sessionStorage` for the theme: the secure store is the one place a device
  preference lives.
- No new dependency, no `prefers-color-scheme` listener (`matchMedia().addEventListener`): the
  system is consulted once, as the iOS initial value, and a later system change is not a theme
  change.
- No `docs/decisions.md`, `docs/app.md`, `TODO.md` or `CHANGELOG.md` edit.

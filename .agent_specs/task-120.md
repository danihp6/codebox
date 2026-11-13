# Spec: Task-120 — The app's NOTICE spec is line-ending agnostic

> The spec is the subagent's entire world. Anything not written here does not exist.

## 🎯 Scope

- **Task type:** app (`apps/app/src/app/features/about`), one pure helper plus its spec. No
  screen, no route, no copy, no frame.
- **Role:** Dev.
- **Objective:** the About screen's notice spec compares text, not bytes. `notice.ts` gains one
  pure `normaliseEol`, both sides of the shipped-vs-file comparison are normalised to LF, and
  `parseNotice` normalises once at its top, so a CRLF checkout and an LF checkout produce the
  same list. After this task `npm run test:app` is green on the operator's Windows host with no
  failure left in the suite.
- **Environment:** worktree `../wt-cb-120`, branch `task-120`, base `main` at `32eb17b`.
- **Dependencies:** none. `NOTICE` and its generator `scripts/legal/notice.mjs` are merged
  (Task-69) and are **not** touched; `apps/app/src/app/features/about/notice.ts` and
  `notice.spec.ts` are merged (the About screen). No batch-mate produces either file.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in
Batch 33 claims the same path.

- `apps/app/src/app/features/about/notice.ts`
- `apps/app/src/app/features/about/notice.spec.ts`

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `NOTICE` (the repository file the spec compares against)
- `scripts/legal/notice.mjs` (the generator; it writes `\n` explicitly — do not call it)
- `apps/app/src/app/features/about/notice.ts`, `apps/app/src/app/features/about/notice.spec.ts`
- `apps/app/src/app/features/about/about.page.ts`, `about.page.spec.ts` (who consumes
  `THIRD_PARTY_NOTICES`)

## 🔒 Contract

`apps/app/src/app/features/about/notice.ts` exports one new name and keeps the two it has:

```ts
/**
 * CRLF → LF, nothing else: a lone `\r` is left alone and an LF document is returned unchanged.
 * The checkout decides a file's line endings, never the content, so every comparison and every
 * parse of a file on disk goes through this first.
 */
export function normaliseEol(text: string): string;

export function parseNotice(text: string): readonly ThirdPartyNotice[];

export const THIRD_PARTY_NOTICES: readonly ThirdPartyNotice[];
```

- **Definition:** `normaliseEol(text) === text.replaceAll('\r\n', '\n')`.
- **`parseNotice` change:** its loop becomes
  `for (const line of normaliseEol(text).split('\n')) { … }`. Everything else — the
  `- ` bullet prefix, the ` — ` separator, `Copyleft exceptions` as the terminator, the
  last-`@` split, the `` `${name}@${version}` `` label, the returned field order — is
  byte-identical to today.
- **Purity:** `normaliseEol` and `parseNotice` read no clock, filesystem, network or
  environment. `notice.spec.ts` is the only reader of `NOTICE`.
- **No other export moves:** `ThirdPartyNotice` keeps its four readonly fields
  (`name`, `version`, `licence`, `label`).

### The spec's change

- Import `normaliseEol` alongside the three existing names.
- The shipped-vs-file case (`notice.spec.ts:9-11`) becomes a comparison of two normalised
  texts — **both sides**, because the checkout may materialise either file with either ending:
  ```ts
  expect(normaliseEol(NOTICE_TEXT).trim()).toBe(
    normaliseEol(readFileSync(REPOSITORY_NOTICE, 'utf8')).trim(),
  );
  ```
- One new case proving the CRLF twin, built from an explicit LF fixture so it cannot depend on
  how this checkout stored `notice.ts`:
  ```ts
  it('parses a CRLF document and its LF twin to the same list', () => {
    const lf = '- hono@4.13.13 — MIT\n- rxjs@7.8.2 — Apache-2.0\n';
    const crlf = lf.replaceAll('\n', '\r\n');

    expect(parseNotice(crlf)).toEqual(parseNotice(lf));
    expect(parseNotice(crlf)).toHaveLength(2);
  });
  ```
- One new case pinning the helper itself:
  ```ts
  it('normalises CRLF to LF and leaves everything else alone', () => {
    expect(normaliseEol('a\r\nb\r\n')).toBe('a\nb\n');
    expect(normaliseEol('a\nb\n')).toBe('a\nb\n');
    expect(normaliseEol('a\rb')).toBe('a\rb');
  });
  ```
- Every existing case stays, unchanged, including `THIRD_PARTY_NOTICES` deep-equal to
  `parseNotice(NOTICE_TEXT)` and the licence lookups (`hono` MIT, `rxjs` Apache-2.0, `tslib`
  0BSD, `@angular/core` MIT).

## 🧩 Configuration

None. No `CB_*` key, no dependency, no lockfile change, no `apps/app/angular.json` change.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing
else is not a criterion.

- **Runner note (this batch, verbatim).** This batch runs on the operator's Windows host,
  where the full `npm test` cannot be green for reasons outside these tasks: `test:guard`'s
  quoting (Task-119 fixes it), 14 `scripts` tests that shell to bash/tar, 23 daemon tests that
  assert POSIX modes or spawn Unix tools, and the `ops` project that hangs (>300 s). The full
  gate's authority for this batch is the Linux CI workflow (`.github/workflows/ci.yml`, run
  with `gh workflow run ci.yml --ref task-120`), and the local commands are the targeted
  Vitest projects named per task plus `npm run lint` and `npm run build`. Never use `npx` on
  this host (it hangs); call `node node_modules/vitest/vitest.mjs run --project <name>`.
  *(This task's target is the app's own runner: `npm run test:app`.)*
- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run test:app` — the whole Angular unit suite, headless (`ng test --watch=false`).
  - `npm run lint` and `npm run build` — both must pass.
  - `git diff --name-only main...task-120` — audit against the exclusive paths.
- **Acceptance criteria:**
  - [ ] `[unit]` `npm run test:app` is **100 % green**: zero failed files, zero failed tests,
        and `src/app/features/about/notice.spec.ts` is one of the passing files. This is the
        criterion the task exists for; a single red fails the task.
  - [ ] `[unit]` the notice spec holds the two new cases and the shipped-vs-file comparison
        normalises both sides;
        `grep -n "normaliseEol" apps/app/src/app/features/about/notice.spec.ts` shows the
        import plus at least three uses.
  - [ ] `[unit]` `parseNotice` normalises at its top:
        `grep -n "normaliseEol(text).split" apps/app/src/app/features/about/notice.ts` prints
        one line.
  - [ ] `[unit]` `git diff --name-only main...task-120` lists exactly the two files, and
        `NOTICE` and `scripts/legal/notice.mjs` are not in the list.
  - [ ] `[unit]` `git diff --stat main...task-120` shows no added or deleted file, so
        `apps/app/src/app/readme.spec.ts` and `apps/app/README.md` do not move.
  - [ ] `[unit]` lint and the build pass.

## 📣 Coordination

- **For QA:** this task's suite command is `npm run test:app`, not a Vitest project — the app
  has its own Angular runner and is not in the root `vitest.config.ts` project list. Run it
  from the repository root.
- **For the next batch:** `normaliseEol` is the shared helper for any future comparison
  against a file on disk in the app. A later task that needs it imports it from `notice.ts`
  until a `core/util` home exists; it does not declare a second normaliser.
- **For the Orchestrator:** the `NOTICE` CRLF red recorded in the Batch 29 and Batch 32
  records is closed by this task; `NOTICE` itself and its generator are untouched, so the
  legal artifact and its provenance do not move.
- **Measured, not this task:** `docs/app.md` §6 (`:135`) still says the refresh token goes to
  Keychain/Keystore while `core/auth/secure-store.ts` is an IndexedDB + AES-GCM store. It is
  outside this task's paths and is recorded for a later docs cut.

## ⛔ Out of scope

- No change to `NOTICE`, to `scripts/legal/notice.mjs`, or to any generated legal artifact.
- No change to copy, templates, the About page or any i18n dictionary.
- No `core/util` extraction, no new file under `src/app`, no new export beyond `normaliseEol`.
- No new dependency and no change to `apps/app/package.json` or `angular.json`.
- No change to the four `ThirdPartyNotice` fields or to the list `THIRD_PARTY_NOTICES` holds.

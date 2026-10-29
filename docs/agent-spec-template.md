# Spec: Task-<ID> — <task title>

> The spec is the subagent's entire world. Anything not written here does not exist. Keep it
> executable by someone who has read nothing else.

## 🎯 Scope

- **Task type:** [package / daemon / app / ops / docs / pipeline].
- **Role:** Dev.
- **Objective:** one paragraph. What must exist after this task that did not exist before.
  Written as an outcome, not as a list of steps.
- **Environment:** worktree `../wt-cb-<ID>`, branch `task-<ID>`, base `main`.
- **Dependencies:** the tasks that must be merged first, by name, and the file each one
  produced that this task reads.

### Exclusive paths (single writer)

Every path this task creates or modifies. **Nothing outside this list.** No other task in the
batch claims the same path. Removing a stray `.gitkeep` from a directory this task populates is
allowed.

- `packages/<name>/src/...`
- `docs/<doc>.md` (section: <name>)

### Inputs (read-only)

Files this task may read, and only these, beyond `AGENTS.md`:

- `docs/<doc>.md`
- `packages/<name>/src/index.ts`
- `design/screens/<slug>.json` and `design/exports/<slug>.png` — required for any task that
  creates or changes a screen, with the frame caption; the slug is `screenSlug(screen)`
  (`Repo · backlog` → `repo-backlog`). A screen task without both is not ready to launch.

## 🔒 Contract

The public surface other tasks are written against **right now**. It is a promise, not a
suggestion. Exact exported names, signatures and types.

```ts
export interface ExampleInput {
  runId: string;
}

export function evaluate(input: ExampleInput): ExampleResult;
```

- Errors: which code, which HTTP status, which log level.
- Purity: what this function may not read (clock, network, filesystem, environment).
- Ordering: which events are emitted, in which order.

### Data

Keys this task introduces or freezes, with their shape, unit and default.

## 🧩 Configuration

Every `CB_*` key this task adds or reads, its default, and the validation failure. A new key
also needs a line in `docs/providers.md`, in this task.

## 🧪 Test and Validation Plan (for QA)

QA runs this verbatim. A criterion that cannot be executed by someone who has read nothing
else is not a criterion.

- **Method:**
  - `npm ci --prefer-offline --no-audit --no-fund` (a fresh worktree has no `node_modules`).
  - `npm run lint` — must pass.
  - `npm test` — Vitest, headless; includes the tests this task adds.
  - `npm run build` — `tsc -b` and the app build when this task touches it.
  - `npx playwright test` — only when this task is tagged with a web flow.
  - `git diff --name-only main...task-<ID>` — audit against the exclusive paths.
- **Acceptance criteria:** every one tagged **`[unit]`** (a headless command, a decoded value,
  a pinned number) or **`[live]`** (only exists in the running system: a stream, a push, a
  tunnel, a UI state). A `[live]` criterion states its **measurement** — what to read, on which
  surface, against which bound.
  - [ ] `[unit]` It typechecks, lints and builds clean.
  - [ ] `[unit]` The declared tests exist and pass.
  - [ ] `[unit]` Nothing outside the exclusive paths was touched.
  - [ ] `[live]` <task-specific, objective, with its measurement>
  - [ ] `[live]` (screen tasks only) the screen next to `design/exports/<slug>.png` at the
        frame's width, with every visible difference written down and each one either fixed or
        justified in the PR.

## 📣 Coordination

Facts another role needs, and the shape of them. Anything another task depends on that is not
in the Contract above.

- For the Architect: <what changed in the plan>
- For the next batch: <what to build against>

## ⛔ Out of scope

Explicit non-goals, to stop scope creep and gold-plating.

- No new dependency outside the spec.
- No refactor of a file this task did not have to touch.
- No change to `docs/decisions.md` unless the task is the decision owner.

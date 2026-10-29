import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Backlog, BacklogRef, BacklogWorkRef, Repo } from '@codebox/contracts';
import { applyTick, parseBacklog as parseBacklogMarkdown, selectNextItem } from '@codebox/backlog';
import type { BacklogEntry, SelectionPolicy, SelectionResult, TickOutcome } from '@codebox/backlog';
import { GIT_ENV, clonePath, createGitRunner } from '@codebox/workspaces';
import type { GitRunner } from '@codebox/workspaces';
import type { DaemonContext } from '../modules.js';
import type { Store } from '@codebox/store';
import { createDaemonWorkspaces } from '../runs/engine.js';
import { workStates } from './select.js';

export const BACKLOG_PATH = 'TODO.md';

const WORK_PAGE = 500;

export interface BacklogSnapshot {
  readonly markdown: string;
  /** The commit the file was read at: `git rev-parse <defaultBranch>` in the bare clone. */
  readonly revision: string;
}

export interface BacklogRuntime {
  /**
   * `git show <defaultBranch>:TODO.md` in the repository's bare clone. A bare clone carries no
   * remote-tracking refs (`clone --bare` maps `refs/heads/*` onto itself), so the file is read
   * from `refs/heads/<defaultBranch>:TODO.md`; `origin/<defaultBranch>` does not exist there.
   */
  readSnapshot(repo: Repo): Promise<BacklogSnapshot>;
}

export type BacklogRefReason =
  'backlog_ref_missing' | 'backlog_ref_ambiguous' | 'backlog_ref_checked';

/** A `POST /v1/works` ref the file cannot resolve; the route maps it to 422 or 409. */
export class BacklogRefError extends Error {
  readonly reason: BacklogRefReason;

  constructor(reason: BacklogRefReason) {
    super(`backlog ref is not usable: ${reason}`);
    this.name = 'BacklogRefError';
    this.reason = reason;
  }
}

/**
 * The file is absent at the default branch. That is not a failure — a repository may have no
 * backlog yet — but a snapshot is what the runtime answers, so the revision the absent file was
 * looked for at travels with the signal.
 */
export class BacklogMissingError extends Error {
  readonly revision: string;

  constructor(revision: string) {
    super('TODO.md is not on the default branch');
    this.name = 'BacklogMissingError';
    this.revision = revision;
  }
}

export interface BacklogService {
  /** `null` when the repository has no `TODO.md` at its default branch. */
  read(repo: Repo): Promise<BacklogSnapshot | null>;
  /** docs/api.md §5.6: the parsed file joined with the works that came from it. */
  project(repo: Repo): Promise<Backlog | null>;
  /** Throws `BacklogRefError` when the ref is unknown, ambiguous or already ticked. */
  resolveItem(repo: Repo, ref: BacklogRef): Promise<{ item: BacklogEntry; revision: string }>;
  /** docs/jobs.md §16: the one selection. `maxAttempts` comes from the caller. */
  select(
    repo: Repo,
    policy: Omit<SelectionPolicy, 'maxAttempts'> & { maxAttempts: number },
  ): Promise<SelectionResult>;
  /** Flips one checkbox in the worktree's `TODO.md`; never reformats another byte. */
  tick(worktree: string, ref: BacklogRef): Promise<TickOutcome>;
}

export interface CreateBacklogServiceOptions {
  readonly context: DaemonContext;
  readonly runtime?: BacklogRuntime;
  readonly git?: GitRunner;
}

export interface CreateBacklogRuntimeOptions {
  readonly git: GitRunner;
  readonly repoRoot: string;
  readonly timeoutMs: number;
  /** Clone or refresh the bare cache; a no-op when the cache already answers. */
  readonly ensureClone?: (repo: Repo) => Promise<void>;
}

interface GitOutput {
  readonly code: number;
  readonly stdout: string;
}

export function createBacklogRuntime(options: CreateBacklogRuntimeOptions): BacklogRuntime {
  const git = options.git;

  async function run(cwd: string, args: readonly string[]): Promise<GitOutput> {
    const result = await git.run({ args, cwd, timeoutMs: options.timeoutMs, env: GIT_ENV });
    return { code: result.code, stdout: result.stdout };
  }

  return {
    async readSnapshot(repo: Repo): Promise<BacklogSnapshot> {
      if (options.ensureClone !== undefined) await options.ensureClone(repo);
      const clone = clonePath(options.repoRoot, repo.slug);
      const ref = `refs/heads/${repo.defaultBranch}`;
      const revision = await run(clone, ['rev-parse', ref]);
      const sha = revision.stdout.trim();
      if (revision.code !== 0 || sha === '') {
        throw new Error(`git rev-parse ${ref} failed (exit ${revision.code})`);
      }
      const shown = await run(clone, ['show', `${ref}:${BACKLOG_PATH}`]);
      if (shown.code !== 0) throw new BacklogMissingError(sha);
      return { markdown: shown.stdout, revision: sha };
    },
  };
}

export function createBacklogService(options: CreateBacklogServiceOptions): BacklogService {
  const context = options.context;
  const store = context.store;
  const config = context.config;
  const clock = context.clock;
  const runtime =
    options.runtime ??
    createBacklogRuntime({
      git: options.git ?? createGitRunner(),
      repoRoot: config.CB_REPO_ROOT,
      timeoutMs: config.CB_GIT_HTTP_TIMEOUT_SECONDS * 1000,
      ensureClone: async (repo: Repo): Promise<void> => {
        await createDaemonWorkspaces(context).ensureClone({
          slug: repo.slug,
          defaultBranch: repo.defaultBranch,
          cloneUrl: `https://github.com/${repo.slug}.git`,
        });
      },
    });

  async function read(repo: Repo): Promise<BacklogSnapshot | null> {
    try {
      return await runtime.readSnapshot(repo);
    } catch (error) {
      if (error instanceof BacklogMissingError) return null;
      throw error;
    }
  }

  function projectWork(repoId: string, ref: string): BacklogWorkRef | null {
    const work = store.works.findByBacklogRef(repoId, ref);
    if (work === null) return null;
    const runs = store.runs.list({ workId: work.id, limit: WORK_PAGE, cursor: null });
    return { id: work.id, state: work.state, runs: runs.data.length };
  }

  async function project(repo: Repo): Promise<Backlog | null> {
    let snapshot: BacklogSnapshot;
    try {
      snapshot = await runtime.readSnapshot(repo);
    } catch (error) {
      if (!(error instanceof BacklogMissingError)) throw error;
      return { repoId: repo.id, revision: error.revision, path: BACKLOG_PATH, sections: [] };
    }
    const parsed = parseBacklogMarkdown(snapshot.markdown);
    const sections = parsed.sections.map((section) => ({
      title: section.title,
      items: section.items.map((item) => ({
        ref: item.ref,
        title: item.title,
        checked: item.checked,
        line: item.line,
        needs: [...item.needs],
        work: projectWork(repo.id, item.ref),
      })),
    }));
    return { repoId: repo.id, revision: snapshot.revision, path: BACKLOG_PATH, sections };
  }

  async function resolveItem(
    repo: Repo,
    ref: BacklogRef,
  ): Promise<{ item: BacklogEntry; revision: string }> {
    const snapshot = await read(repo);
    if (snapshot === null) throw new BacklogRefError('backlog_ref_missing');
    const items = parseBacklogMarkdown(snapshot.markdown).items.filter((item) => item.ref === ref);
    const first = items[0];
    if (first === undefined) throw new BacklogRefError('backlog_ref_missing');
    if (items.length > 1) throw new BacklogRefError('backlog_ref_ambiguous');
    if (first.checked) throw new BacklogRefError('backlog_ref_checked');
    return { item: first, revision: snapshot.revision };
  }

  async function select(
    repo: Repo,
    policy: Omit<SelectionPolicy, 'maxAttempts'> & { maxAttempts: number },
  ): Promise<SelectionResult> {
    const snapshot = await read(repo);
    if (snapshot === null) return { kind: 'nothing_pending' };
    const items = parseBacklogMarkdown(snapshot.markdown).items;
    return selectNextItem(items, workStates(store, repo.id), policy);
  }

  async function tick(worktree: string, ref: BacklogRef): Promise<TickOutcome> {
    const file = join(worktree, BACKLOG_PATH);
    let markdown: string;
    try {
      markdown = await readFile(file, 'utf8');
    } catch {
      return { kind: 'missing' };
    }
    const outcome = applyTick(markdown, ref);
    if (outcome.kind === 'ticked') await writeFile(file, outcome.markdown, 'utf8');
    return outcome;
  }

  const service: BacklogService = { read, project, resolveItem, select, tick };
  INTERNALS.set(service, { store, clock });
  return service;
}

/** What the routes need beyond the frozen `BacklogService` surface. */
export interface BacklogInternals {
  readonly store: Store;
  readonly clock: () => Date;
}

const INTERNALS = new WeakMap<BacklogService, BacklogInternals>();

export function backlogInternals(service: BacklogService): BacklogInternals {
  const internals = INTERNALS.get(service);
  if (internals === undefined) {
    throw new Error('the backlog service was not created by createBacklogService');
  }
  return internals;
}

const SERVICES = new WeakMap<DaemonContext, BacklogService>();

/** One backlog service per daemon process, shared by the works routes and the schedule fire. */
export function backlogService(context: DaemonContext): BacklogService {
  const existing = SERVICES.get(context);
  if (existing !== undefined) return existing;
  const created = createBacklogService({ context });
  SERVICES.set(context, created);
  return created;
}

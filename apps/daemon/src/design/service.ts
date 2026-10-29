import { ROUTES_PATH, TOKENS_PATH } from '@codebox/design';
import { GIT_ENV, clonePath, createGitRunner } from '@codebox/workspaces';
import type { GitRunner } from '@codebox/workspaces';
import type { DesignPreview, Repo } from '@codebox/contracts';
import type { Store } from '@codebox/store';
import type { DaemonContext } from '../modules.js';
import type { Logger } from '../logger.js';
import { createDaemonWorkspaces } from '../runs/engine.js';
import { buildDesignPreview } from './preview.js';
import type { DesignSource } from './preview.js';

const JSON_SUFFIX = '.json';
const SCREENS_PREFIX = 'design/screens';

export interface DesignSnapshot {
  readonly revision: string;
  readonly source: DesignSource;
}

export interface DesignRuntime {
  /** `design/` at `revision` (null = the default branch head) in the repository's bare clone. */
  readDesign(repo: Repo, revision: string | null): Promise<DesignSnapshot>;
}

export interface DesignRuntimeOptions {
  readonly git: GitRunner;
  readonly repoRoot: string;
  readonly timeoutMs: number;
  readonly ensureClone?: (repo: Repo) => Promise<void>;
}

/** The clone does not know the commit: the route answers 422 `revision_unknown`. */
export class DesignRevisionError extends Error {
  readonly revision: string;

  constructor(revision: string) {
    super(`the clone does not know ${revision}`);
    this.name = 'DesignRevisionError';
    this.revision = revision;
  }
}

/** A git command failed for another reason: the route answers 503 `workspace_unavailable`. */
export class DesignReadError extends Error {
  readonly command: string;
  readonly code: number;

  constructor(command: string, code: number) {
    super(`git ${command} failed (exit ${code})`);
    this.name = 'DesignReadError';
    this.command = command;
    this.code = code;
  }
}

interface ShowResult {
  readonly text: string | null;
}

/**
 * A bare clone has no working tree, so a missing path is an ordinary non-zero `git show` whose
 * stderr names one of these two shapes; every other failure is the clone's.
 */
function absent(stderr: string): boolean {
  return stderr.includes('does not exist') || stderr.includes('exists on disk, but not in');
}

export function createDesignRuntime(options: DesignRuntimeOptions): DesignRuntime {
  const git = options.git;

  async function run(
    cwd: string,
    args: readonly string[],
  ): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
    const result = await git.run({ args, cwd, timeoutMs: options.timeoutMs, env: GIT_ENV });
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  }

  async function show(clone: string, sha: string, path: string): Promise<ShowResult> {
    const result = await run(clone, ['show', `${sha}:${path}`]);
    if (result.code === 0) return { text: result.stdout };
    if (absent(result.stderr)) return { text: null };
    throw new DesignReadError('show', result.code);
  }

  async function resolve(clone: string, repo: Repo, revision: string | null): Promise<string> {
    if (revision === null) {
      const result = await run(clone, ['rev-parse', `refs/heads/${repo.defaultBranch}`]);
      const sha = result.stdout.trim();
      if (result.code !== 0 || sha === '') throw new DesignReadError('rev-parse', result.code);
      return sha;
    }
    const result = await run(clone, ['rev-parse', '--verify', `${revision}^{commit}`]);
    const sha = result.stdout.trim();
    if (result.code !== 0 || sha === '') throw new DesignRevisionError(revision);
    return sha;
  }

  async function readScreens(
    clone: string,
    sha: string,
  ): Promise<readonly { readonly file: string; readonly text: string }[]> {
    const listed = await run(clone, ['ls-tree', '--name-only', '-r', sha, '--', SCREENS_PREFIX]);
    if (listed.code !== 0) {
      if (absent(listed.stderr)) return [];
      throw new DesignReadError('ls-tree', listed.code);
    }
    const files = listed.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && line.endsWith(JSON_SUFFIX))
      .sort();
    const screens: { readonly file: string; readonly text: string }[] = [];
    for (const file of files) {
      const shown = await show(clone, sha, file);
      if (shown.text === null) continue;
      screens.push({ file, text: shown.text });
    }
    return screens;
  }

  return {
    async readDesign(repo: Repo, revision: string | null): Promise<DesignSnapshot> {
      if (options.ensureClone !== undefined) {
        try {
          await options.ensureClone(repo);
        } catch {
          throw new DesignReadError('fetch', 0);
        }
      }
      const clone = clonePath(options.repoRoot, repo.slug);
      const sha = await resolve(clone, repo, revision);
      const tokens = await show(clone, sha, TOKENS_PATH);
      const routes = await show(clone, sha, ROUTES_PATH);
      const screens = await readScreens(clone, sha);
      return {
        revision: sha,
        source: { tokens: tokens.text, routes: routes.text, screens },
      };
    },
  };
}

export interface DesignService {
  preview(repo: Repo, revision: string | null): Promise<DesignPreview>;
}

export interface CreateDesignServiceOptions {
  readonly context: DaemonContext;
  readonly runtime?: DesignRuntime;
  readonly git?: GitRunner;
}

export function createDesignService(options: CreateDesignServiceOptions): DesignService {
  const context = options.context;
  const runtime =
    options.runtime ??
    createDesignRuntime({
      git: options.git ?? createGitRunner(),
      repoRoot: context.config.CB_REPO_ROOT,
      timeoutMs: context.config.CB_GIT_HTTP_TIMEOUT_SECONDS * 1000,
      ensureClone: async (repo: Repo): Promise<void> => {
        await createDaemonWorkspaces(context).ensureClone({
          slug: repo.slug,
          defaultBranch: repo.defaultBranch,
          cloneUrl: `https://github.com/${repo.slug}.git`,
        });
      },
    });

  async function preview(repo: Repo, revision: string | null): Promise<DesignPreview> {
    const snapshot = await runtime.readDesign(repo, revision);
    return buildDesignPreview({
      repoId: repo.id,
      revision: snapshot.revision,
      checkedAt: context.clock().toISOString(),
      source: snapshot.source,
    });
  }

  const service: DesignService = { preview };
  INTERNALS.set(service, { store: context.store, logger: context.logger });
  return service;
}

/** What the routes need beyond the frozen `DesignService` surface. */
export interface DesignInternals {
  readonly store: Store;
  readonly logger: Logger;
}

const INTERNALS = new WeakMap<DesignService, DesignInternals>();

export function designInternals(service: DesignService): DesignInternals {
  const internals = INTERNALS.get(service);
  if (internals === undefined) {
    throw new Error('the design service was not created by createDesignService');
  }
  return internals;
}

const SERVICES = new WeakMap<DaemonContext, DesignService>();

/** One design service per daemon process, the way `backlogService(context)` is. */
export function designService(context: DaemonContext): DesignService {
  const existing = SERVICES.get(context);
  if (existing !== undefined) return existing;
  const created = createDesignService({ context });
  SERVICES.set(context, created);
  return created;
}

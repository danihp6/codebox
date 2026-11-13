import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { WorkspaceError, diskFailure, gitFailure } from './errors.js';
import { createGitRunner, runGit } from './git.js';
import { branchName, worktreePath } from './paths.js';
import {
  createWorkspaceContext,
  isDirectory,
  pathExists,
  removePath,
  type WorkspaceContext,
  writeMarkerAt,
} from './worktree.js';
import type { GitRunner, Worktree } from './types.js';

/** The backlog root a local repository is born with (`TODO.md`), byte for byte. */
export const INITIAL_BACKLOG =
  '# Backlog\n\nOne item per line, in the order the repository works through them.\n';

/**
 * Mirrors `nameSchema` in `packages/contracts/src/primitives.ts`; the schema is a value, so
 * importing it would pull `contracts/dist` into the gate that runs before the build.
 */
const LOCAL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const DEFAULT_TIMEOUT_MS = 120_000;

/** `-c` carries the identity because `GIT_ENV` is fixed and holds no global git identity. */
const INITIAL_COMMIT_ARGS: readonly string[] = [
  '-c',
  'user.name=codebox[bot]',
  '-c',
  'user.email=codebox@users.noreply.github.com',
  'commit',
  '--no-verify',
  '-m',
  'Initial commit',
];

export interface InitLocalOptions {
  readonly repoRoot: string;
  /** D62 identity: `^[a-z0-9][a-z0-9._-]{0,63}$`. Anything else is refused. */
  readonly name: string;
  readonly defaultBranch: string;
  /** Defaults to `createGitRunner()`. */
  readonly git?: GitRunner;
  /** Defaults to `() => new Date()`. Nothing here is stamped, so `initLocal` never reads it. */
  readonly now?: () => Date;
}

export interface LocalRepo {
  readonly name: string;
  /** `join(repoRoot, name)`; the working tree the box owns. Never a URL. */
  readonly path: string;
  readonly defaultBranch: string;
  /** The initial commit: `git rev-parse HEAD` after the one commit. */
  readonly headSha: string;
}

export interface CreateLocalWorktreeOptions {
  readonly workspaceRoot: string;
  readonly repo: Pick<LocalRepo, 'name' | 'path' | 'defaultBranch'>;
  readonly runId: string;
  readonly title: string;
  /** Defaults to `repo.defaultBranch`. */
  readonly baseRef?: string;
  readonly git?: GitRunner;
  readonly now?: () => Date;
  readonly httpTimeoutSeconds?: number;
}

/** Pure. Refuses a name that could escape the root before any process starts. */
export function localRepoPath(repoRoot: string, name: string): string {
  if (!isAbsolute(repoRoot)) {
    throw new WorkspaceError('invalid_root', 'repository root must be absolute', null, null);
  }
  if (!LOCAL_NAME_PATTERN.test(name)) {
    throw new WorkspaceError('invalid_root', 'invalid repository name', null, null);
  }
  return join(repoRoot, name);
}

export async function initLocal(options: InitLocalOptions): Promise<LocalRepo> {
  const path = localRepoPath(options.repoRoot, options.name);
  if (await pathExists(path)) {
    throw new WorkspaceError('worktree_exists', 'repository directory already exists', null, null);
  }
  const git = options.git ?? createGitRunner();
  try {
    await mkdir(options.repoRoot, { recursive: true });
  } catch {
    throw diskFailure('repository root could not be created');
  }
  try {
    await mkdir(path);
  } catch {
    throw diskFailure('repository directory could not be created');
  }
  const initialized = await runGit(git, {
    args: ['init', '-b', options.defaultBranch],
    cwd: path,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (initialized.code !== 0) throw gitFailure('init', initialized.code, 'git_failed');
  try {
    await writeFile(join(path, 'TODO.md'), INITIAL_BACKLOG, 'utf8');
  } catch {
    throw diskFailure('initial backlog could not be written');
  }
  const staged = await runGit(git, {
    args: ['add', '--', 'TODO.md'],
    cwd: path,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (staged.code !== 0) throw gitFailure('add', staged.code, 'git_failed');
  const committed = await runGit(git, {
    args: INITIAL_COMMIT_ARGS,
    cwd: path,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (committed.code !== 0) throw gitFailure('commit', committed.code, 'git_failed');
  const head = await runGit(git, {
    args: ['rev-parse', 'HEAD'],
    cwd: path,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  const headSha = head.stdout.trim();
  if (head.code !== 0 || headSha.length === 0) {
    throw gitFailure('rev-parse', head.code, 'git_failed');
  }
  return { name: options.name, path, defaultBranch: options.defaultBranch, headSha };
}

export async function createLocalWorktree(options: CreateLocalWorktreeOptions): Promise<Worktree> {
  // `writeMarkerAt` reads only `now` and the timeout out of the context; `matchesGlob` and
  // `cloneDepth` belong to `status` and `cleanup`, which this module never calls.
  const context = createWorkspaceContext({
    repoRoot: options.repo.path,
    workspaceRoot: options.workspaceRoot,
    git: options.git ?? createGitRunner(),
    matchesGlob: () => false,
    cloneDepth: 0,
    httpTimeoutSeconds: options.httpTimeoutSeconds ?? 120,
    now: options.now ?? (() => new Date()),
  });
  if (!(await isDirectory(options.workspaceRoot))) {
    throw diskFailure('workspace root is missing');
  }
  const branch = branchName(options.runId, options.title);
  const target = worktreePath(options.workspaceRoot, options.runId);
  if (await pathExists(target)) {
    throw new WorkspaceError('worktree_exists', 'worktree already exists', null, null);
  }
  const baseRef = options.baseRef ?? options.repo.defaultBranch;
  const baseSha = await resolveBaseSha(context, options.repo.path, baseRef);
  const added = await runGit(context.options.git, {
    args: ['worktree', 'add', '-b', branch, target, baseSha],
    cwd: options.repo.path,
    timeoutMs: context.timeoutMs,
  });
  if (added.code !== 0) {
    await removePath(target);
    throw gitFailure('worktree', added.code, 'worktree_failed');
  }
  const worktree: Worktree = {
    runId: options.runId,
    repoSlug: options.repo.name,
    path: target,
    branch,
    baseRef,
    baseSha,
  };
  await writeMarkerAt(context, target, {
    runId: worktree.runId,
    repoSlug: worktree.repoSlug,
    branch: worktree.branch,
    baseRef: worktree.baseRef,
    baseSha: worktree.baseSha,
    promptHash: '',
    createdAt: context.options.now().toISOString(),
  });
  return worktree;
}

async function resolveBaseSha(
  context: WorkspaceContext,
  cwd: string,
  baseRef: string,
): Promise<string> {
  const result = await runGit(context.options.git, {
    args: ['rev-parse', baseRef],
    cwd,
    timeoutMs: context.timeoutMs,
  });
  if (result.code !== 0) throw gitFailure('rev-parse', result.code, 'worktree_failed');
  const baseSha = result.stdout.trim();
  if (baseSha.length === 0) {
    throw new WorkspaceError('worktree_failed', 'rev-parse returned no commit', 'rev-parse', 0);
  }
  return baseSha;
}

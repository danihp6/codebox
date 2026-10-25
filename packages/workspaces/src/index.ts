import { isAbsolute, relative, resolve, sep } from 'node:path';

import { cleanupWorkspaces, readDiskUsage } from './cleanup.js';
import { ensureClone } from './clone.js';
import { WorkspaceError } from './errors.js';
import { computeStatus } from './status.js';
import {
  createWorkspaceContext,
  createWorktree,
  listWorktrees,
  readRunMarker,
  removeWorktree,
  writeRunMarker,
} from './worktree.js';
import type { WorkspaceManager, WorkspaceManagerOptions } from './types.js';

export type {
  RepoRef,
  GitCommandInput,
  GitResult,
  GitRunner,
  GlobMatcher,
  WorkspaceManagerOptions,
  CloneResult,
  CreateWorktreeInput,
  Worktree,
  WorktreeInfo,
  RunMarker,
  WorkspaceStatus,
  CleanupOptions,
  CleanupReport,
  DiskUsage,
  WorkspaceManager,
} from './types.js';

export type { WorkspaceErrorCode } from './errors.js';
export { WorkspaceError } from './errors.js';

export { GIT_ENV, createGitRunner } from './git.js';

export {
  BRANCH_PREFIX,
  RUN_MARKER_FILENAME,
  SLUG_MAX_LENGTH,
  slugifyTitle,
  branchName,
  clonePath,
  worktreePath,
} from './paths.js';

export { parseNumstat, parseNameStatus, buildRunDiff } from './diff.js';
export type { NumstatEntry, NameStatusEntry } from './diff.js';

export function createWorkspaceManager(options: WorkspaceManagerOptions): WorkspaceManager {
  assertRoots(options.repoRoot, options.workspaceRoot);
  const context = createWorkspaceContext(options);
  return {
    ensureClone: (repo) => ensureClone(context, repo),
    createWorktree: (input) => createWorktree(context, input),
    removeWorktree: (worktree) => removeWorktree(context, worktree),
    listWorktrees: () => listWorktrees(context),
    status: (worktree, protectedPaths) => computeStatus(context, worktree, protectedPaths),
    readRunMarker: (worktree) => readRunMarker(context, worktree),
    writeRunMarker: (worktree, marker) => writeRunMarker(context, worktree, marker),
    cleanup: (cleanupOptions) => cleanupWorkspaces(context, cleanupOptions),
    diskUsage: () => readDiskUsage(context),
  };
}

function assertRoots(repoRoot: string, workspaceRoot: string): void {
  if (!isAbsolute(repoRoot) || !isAbsolute(workspaceRoot)) {
    throw new WorkspaceError(
      'invalid_root',
      'repo root and workspace root must be absolute',
      null,
      null,
    );
  }
  if (nested(repoRoot, workspaceRoot) || nested(workspaceRoot, repoRoot)) {
    throw new WorkspaceError(
      'invalid_root',
      'repo root and workspace root must not contain each other',
      null,
      null,
    );
  }
}

function nested(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child));
  if (relativePath === '') return true;
  const outside = relativePath === '..' || relativePath.startsWith(`..${sep}`);
  return !outside && !isAbsolute(relativePath);
}

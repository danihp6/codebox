import { randomBytes } from 'node:crypto';
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

import { WorkspaceError, errorCodeOf, gitFailure, diskFailure } from './errors.js';
import { runGit } from './git.js';
import { clonePath } from './paths.js';
import { pathExists, removePath, type WorkspaceContext } from './worktree.js';
import type { CloneResult, RepoRef } from './types.js';

const RENAME_RACE_CODES = new Set(['EEXIST', 'ENOTEMPTY']);

export async function ensureClone(context: WorkspaceContext, repo: RepoRef): Promise<CloneResult> {
  const cache = clonePath(context.options.repoRoot, repo.slug);
  try {
    await mkdir(context.options.repoRoot, { recursive: true });
  } catch {
    throw diskFailure('repository root could not be created');
  }
  if (await pathExists(cache)) return await refreshCache(context, cache, repo);
  return await cloneCache(context, cache, repo);
}

async function refreshCache(
  context: WorkspaceContext,
  cache: string,
  repo: RepoRef,
): Promise<CloneResult> {
  const args = ['fetch', '--prune'];
  if (context.options.cloneDepth > 0) {
    args.push('--depth', String(context.options.cloneDepth));
  }
  args.push('origin');
  const result = await runGit(context.options.git, {
    args,
    cwd: cache,
    timeoutMs: context.timeoutMs,
  });
  if (result.code !== 0) throw gitFailure('fetch', result.code, 'fetch_failed');
  const headSha = await resolveDefaultBranch(context, cache, repo);
  return { path: cache, created: false, headSha };
}

async function cloneCache(
  context: WorkspaceContext,
  cache: string,
  repo: RepoRef,
): Promise<CloneResult> {
  const temporary = join(context.options.repoRoot, `.clone-${randomBytes(8).toString('hex')}`);
  const args = ['clone', '--bare'];
  if (context.options.cloneDepth > 0) {
    args.push('--depth', String(context.options.cloneDepth));
  }
  args.push(repo.cloneUrl, temporary);
  const result = await runGit(context.options.git, {
    args,
    cwd: context.options.repoRoot,
    timeoutMs: context.timeoutMs,
  });
  if (result.code !== 0) {
    await removePath(temporary);
    throw gitFailure('clone', result.code, 'clone_failed');
  }
  try {
    await rename(temporary, cache);
  } catch (error) {
    await removePath(temporary);
    const code = errorCodeOf(error);
    if (code === null || !RENAME_RACE_CODES.has(code)) {
      throw new WorkspaceError('clone_failed', 'clone could not be finalised', 'clone', null);
    }
    return await refreshCache(context, cache, repo);
  }
  const headSha = await resolveDefaultBranch(context, cache, repo);
  return { path: cache, created: true, headSha };
}

async function resolveDefaultBranch(
  context: WorkspaceContext,
  cache: string,
  repo: RepoRef,
): Promise<string> {
  const result = await runGit(context.options.git, {
    args: ['rev-parse', `refs/heads/${repo.defaultBranch}`],
    cwd: cache,
    timeoutMs: context.timeoutMs,
  });
  if (result.code !== 0) throw gitFailure('rev-parse', result.code, 'git_failed');
  const headSha = result.stdout.trim();
  if (headSha.length === 0) {
    throw new WorkspaceError('git_failed', 'rev-parse returned no commit', 'rev-parse', 0);
  }
  return headSha;
}

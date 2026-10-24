import { join } from 'node:path';

import { WorkspaceError } from './errors.js';

export const BRANCH_PREFIX = 'cb/';
export const RUN_MARKER_FILENAME = 'codebox-run.json';
export const SLUG_MAX_LENGTH = 40;

const SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function slugifyTitle(title: string, maxLength: number = SLUG_MAX_LENGTH): string {
  const limit =
    Number.isFinite(maxLength) && maxLength > 0 ? Math.trunc(maxLength) : SLUG_MAX_LENGTH;
  const flattened = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const truncated = flattened.slice(0, limit).replace(/-+$/, '');
  return truncated.length > 0 ? truncated : 'run';
}

export function branchName(runId: string, title: string): string {
  return `${BRANCH_PREFIX}${runId}-${slugifyTitle(title)}`;
}

export function clonePath(repoRoot: string, slug: string): string {
  if (!SLUG_PATTERN.test(slug)) {
    throw new WorkspaceError('invalid_root', 'invalid repository slug', null, null);
  }
  const separator = slug.indexOf('/');
  const owner = slug.slice(0, separator);
  const name = slug.slice(separator + 1);
  if (owner === '.' || owner === '..' || name === '.' || name === '..') {
    throw new WorkspaceError('invalid_root', 'invalid repository slug', null, null);
  }
  return join(repoRoot, `${owner}__${name}.git`);
}

export function worktreePath(workspaceRoot: string, runId: string): string {
  if (!RUN_ID_PATTERN.test(runId) || runId === '.' || runId === '..' || runId.startsWith('.')) {
    throw new WorkspaceError('invalid_root', 'invalid run id', null, null);
  }
  return join(workspaceRoot, runId);
}

import type { RunDiff } from '@codebox/contracts';
import type { ProtectedPathHit } from '@codebox/core';

import { buildRunDiff, parseNameStatus, parseNumstat } from './diff.js';
import { gitFailure } from './errors.js';
import { runGit } from './git.js';
import type { WorkspaceContext } from './worktree.js';
import type { WorkspaceStatus, Worktree } from './types.js';

function normalisePath(value: string): string {
  let path = value;
  while (path.startsWith('./')) path = path.slice(2);
  return path.replace(/\/{2,}/g, '/');
}

async function gitOutput(
  context: WorkspaceContext,
  cwd: string,
  args: readonly string[],
): Promise<string> {
  const result = await runGit(context.options.git, {
    args,
    cwd,
    timeoutMs: context.timeoutMs,
  });
  if (result.code !== 0) throw gitFailure(args[0] ?? 'git', result.code, 'git_failed');
  return result.stdout;
}

export async function computeStatus(
  context: WorkspaceContext,
  worktree: Worktree,
  protectedPaths: readonly string[],
): Promise<WorkspaceStatus> {
  const cwd = worktree.path;
  const headSha = (await gitOutput(context, cwd, ['rev-parse', 'HEAD'])).trim();
  const ahead = Number.parseInt(
    (await gitOutput(context, cwd, ['rev-list', '--count', `${worktree.baseSha}..HEAD`])).trim(),
    10,
  );
  const porcelain = await gitOutput(context, cwd, ['status', '--porcelain']);
  const numstat = parseNumstat(
    await gitOutput(context, cwd, ['diff', '--numstat', '-M', worktree.baseSha, '--']),
  );
  const nameStatus = parseNameStatus(
    await gitOutput(context, cwd, ['diff', '--name-status', '-M', worktree.baseSha, '--']),
  );

  const changedPaths: string[] = [];
  const seenPaths = new Set<string>();
  for (const entry of numstat) {
    const path = normalisePath(entry.path);
    if (seenPaths.has(path)) continue;
    seenPaths.add(path);
    changedPaths.push(path);
  }

  const protectedHits: ProtectedPathHit[] = [];
  const seenHits = new Set<string>();
  for (const pattern of protectedPaths) {
    for (const path of changedPaths) {
      if (!context.options.matchesGlob(pattern, path)) continue;
      const key = `${pattern}\u0000${path}`;
      if (seenHits.has(key)) continue;
      seenHits.add(key);
      protectedHits.push({ path, pattern });
    }
  }

  const diff: RunDiff = buildRunDiff(numstat, nameStatus);
  return {
    branch: worktree.branch,
    baseSha: worktree.baseSha,
    headSha,
    commitsAhead: Number.isFinite(ahead) ? ahead : 0,
    dirty: porcelain.trim().length > 0,
    diff,
    changedPaths,
    protectedHits,
  };
}

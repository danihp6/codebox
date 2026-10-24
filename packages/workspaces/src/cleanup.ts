import { stat, statfs } from 'node:fs/promises';
import { basename } from 'node:path';

import { diskFailure } from './errors.js';
import {
  listChildDirectories,
  measureDirectory,
  readMarkerAt,
  removeWorktree,
  type WorkspaceContext,
} from './worktree.js';
import type { CleanupOptions, CleanupReport, DiskUsage, Worktree } from './types.js';

const HOUR_MS = 3_600_000;

export async function cleanupWorkspaces(
  context: WorkspaceContext,
  options: CleanupOptions,
): Promise<CleanupReport> {
  const { workspaceRoot } = context.options;
  const directories = await listChildDirectories(workspaceRoot);
  const nowMs = context.options.now().getTime();
  const ttlHours = Number.isFinite(options.ttlHours) ? Math.max(0, options.ttlHours) : 0;
  const ttlMs = ttlHours * HOUR_MS;

  const removed: string[] = [];
  let kept = 0;
  let orphans = 0;
  let bytesFreed = 0;

  for (const directory of directories) {
    const marker = await readMarkerAt(context, directory);
    const info = await stat(directory).catch(() => null);
    // A directory this package did not create, or whose marker disagrees with its name, is an
    // orphan: it is counted and never touched.
    if (marker === null || info === null || marker.runId !== basename(directory)) {
      orphans += 1;
      continue;
    }
    const expired = ttlHours === 0 || nowMs - info.mtimeMs > ttlMs;
    if (!expired) {
      kept += 1;
      continue;
    }
    const bytes = await measureDirectory(directory);
    const worktree: Worktree = {
      runId: marker.runId,
      repoSlug: marker.repoSlug,
      path: directory,
      branch: marker.branch,
      baseRef: marker.baseRef,
      baseSha: marker.baseSha,
    };
    await removeWorktree(context, worktree);
    removed.push(directory);
    bytesFreed += bytes;
  }

  return { removed, kept, orphans, bytesFreed };
}

export async function readDiskUsage(context: WorkspaceContext): Promise<DiskUsage> {
  try {
    const info = await statfs(context.options.workspaceRoot);
    const freeBytes = info.bavail * info.bsize;
    const totalBytes = info.blocks * info.bsize;
    const usedPercent =
      totalBytes > 0 ? Number((((totalBytes - freeBytes) / totalBytes) * 100).toFixed(2)) : 0;
    return { freeBytes, totalBytes, usedPercent };
  } catch {
    throw diskFailure('disk usage could not be read');
  }
}

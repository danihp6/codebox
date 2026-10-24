import { access, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { WorkspaceError, diskFailure, gitFailure } from './errors.js';
import { runGit } from './git.js';
import { RUN_MARKER_FILENAME, branchName, clonePath, worktreePath } from './paths.js';
import type {
  CreateWorktreeInput,
  RunMarker,
  Worktree,
  WorktreeInfo,
  WorkspaceManagerOptions,
} from './types.js';

export interface WorkspaceContext {
  readonly options: WorkspaceManagerOptions;
  readonly timeoutMs: number;
}

const MARKER_FIELDS = [
  'runId',
  'repoSlug',
  'branch',
  'baseRef',
  'baseSha',
  'promptHash',
  'createdAt',
] as const;

export function createWorkspaceContext(options: WorkspaceManagerOptions): WorkspaceContext {
  const seconds =
    Number.isFinite(options.httpTimeoutSeconds) && options.httpTimeoutSeconds > 0
      ? options.httpTimeoutSeconds
      : 120;
  return { options, timeoutMs: Math.max(1, Math.round(seconds * 1000)) };
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    return info.isDirectory();
  } catch {
    return false;
  }
}

export async function removePath(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true }).catch(() => undefined);
}

/** lstat-based so a symlinked tree is never followed out of the workspace root. */
export async function measureDirectory(target: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const child = join(target, entry.name);
    if (entry.isDirectory()) {
      total += await measureDirectory(child);
      continue;
    }
    try {
      total += (await lstat(child)).size;
    } catch {
      continue;
    }
  }
  return total;
}

export async function listChildDirectories(root: string): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    throw diskFailure('workspace root could not be read');
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => join(root, entry.name))
    .sort();
}

function parseRunMarker(value: unknown): RunMarker | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const field of MARKER_FIELDS) {
    if (typeof record[field] !== 'string') return null;
  }
  return {
    runId: record['runId'] as string,
    repoSlug: record['repoSlug'] as string,
    branch: record['branch'] as string,
    baseRef: record['baseRef'] as string,
    baseSha: record['baseSha'] as string,
    promptHash: record['promptHash'] as string,
    createdAt: record['createdAt'] as string,
  };
}

async function resolveMarkerPath(
  context: WorkspaceContext,
  directory: string,
): Promise<string | null> {
  const result = await runGit(context.options.git, {
    args: ['rev-parse', '--git-path', RUN_MARKER_FILENAME],
    cwd: directory,
    timeoutMs: context.timeoutMs,
  });
  if (result.code !== 0) return null;
  const reported = result.stdout.trim();
  if (reported.length === 0) return null;
  return isAbsolute(reported) ? reported : resolve(directory, reported);
}

export async function readMarkerAt(
  context: WorkspaceContext,
  directory: string,
): Promise<RunMarker | null> {
  const markerPath = await resolveMarkerPath(context, directory);
  if (markerPath === null) return null;
  let raw: string;
  try {
    raw = await readFile(markerPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseRunMarker(parsed);
}

export async function writeMarkerAt(
  context: WorkspaceContext,
  directory: string,
  marker: RunMarker,
): Promise<void> {
  const markerPath = await resolveMarkerPath(context, directory);
  if (markerPath === null) {
    throw new WorkspaceError('not_a_worktree', 'worktree has no git directory', null, null);
  }
  try {
    await mkdir(dirname(markerPath), { recursive: true });
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  } catch {
    throw diskFailure('run marker could not be written');
  }
}

async function revParse(
  context: WorkspaceContext,
  cwd: string,
  ref: string,
  code: 'worktree_failed' | 'git_failed',
): Promise<string> {
  const result = await runGit(context.options.git, {
    args: ['rev-parse', ref],
    cwd,
    timeoutMs: context.timeoutMs,
  });
  if (result.code !== 0) throw gitFailure('rev-parse', result.code, code);
  const value = result.stdout.trim();
  if (value.length === 0) {
    throw new WorkspaceError(code, 'rev-parse returned no commit', 'rev-parse', 0);
  }
  return value;
}

export async function createWorktree(
  context: WorkspaceContext,
  input: CreateWorktreeInput,
): Promise<Worktree> {
  const { options } = context;
  if (!(await isDirectory(options.workspaceRoot))) {
    throw diskFailure('workspace root is missing');
  }
  const branch = branchName(input.runId, input.title);
  const target = worktreePath(options.workspaceRoot, input.runId);
  if (await pathExists(target)) {
    throw new WorkspaceError('worktree_exists', 'worktree already exists', null, null);
  }
  const cache = clonePath(options.repoRoot, input.repo.slug);
  const baseSha = await revParse(context, cache, input.baseRef, 'worktree_failed');
  const result = await runGit(options.git, {
    args: ['worktree', 'add', '-b', branch, target, baseSha],
    cwd: cache,
    timeoutMs: context.timeoutMs,
  });
  if (result.code !== 0) {
    await removePath(target);
    throw gitFailure('worktree', result.code, 'worktree_failed');
  }
  const worktree: Worktree = {
    runId: input.runId,
    repoSlug: input.repo.slug,
    path: target,
    branch,
    baseRef: input.baseRef,
    baseSha,
  };
  await writeMarkerAt(context, target, {
    runId: worktree.runId,
    repoSlug: worktree.repoSlug,
    branch: worktree.branch,
    baseRef: worktree.baseRef,
    baseSha: worktree.baseSha,
    promptHash: '',
    createdAt: options.now().toISOString(),
  });
  return worktree;
}

export async function removeWorktree(context: WorkspaceContext, worktree: Worktree): Promise<void> {
  const { options } = context;
  const expected = worktreePath(options.workspaceRoot, worktree.runId);
  if (resolve(worktree.path) !== resolve(expected)) {
    throw new WorkspaceError('invalid_root', 'worktree path is not managed here', null, null);
  }
  const cache = clonePath(options.repoRoot, worktree.repoSlug);
  if (await pathExists(expected)) {
    const result = await runGit(options.git, {
      args: ['worktree', 'remove', '--force', expected],
      cwd: cache,
      timeoutMs: context.timeoutMs,
    });
    if (result.code !== 0) throw gitFailure('worktree', result.code, 'worktree_failed');
  }
  const prune = await runGit(options.git, {
    args: ['worktree', 'prune'],
    cwd: cache,
    timeoutMs: context.timeoutMs,
  });
  if (prune.code !== 0) throw gitFailure('worktree', prune.code, 'worktree_failed');
  await removePath(expected);
}

export async function listWorktrees(context: WorkspaceContext): Promise<readonly WorktreeInfo[]> {
  const directories = await listChildDirectories(context.options.workspaceRoot);
  const infos: WorktreeInfo[] = [];
  for (const directory of directories) {
    const info = await stat(directory).catch(() => null);
    if (info === null) continue;
    const marker = await readMarkerAt(context, directory);
    infos.push({
      path: directory,
      runId: marker?.runId ?? null,
      repoSlug: marker?.repoSlug ?? null,
      branch: marker?.branch ?? null,
      modifiedAt: info.mtime.toISOString(),
      bytes: await measureDirectory(directory),
    });
  }
  return infos;
}

export async function readRunMarker(
  context: WorkspaceContext,
  worktree: Worktree,
): Promise<RunMarker | null> {
  return await readMarkerAt(context, worktree.path);
}

export async function writeRunMarker(
  context: WorkspaceContext,
  worktree: Worktree,
  marker: RunMarker,
): Promise<void> {
  await writeMarkerAt(context, worktree.path, marker);
}

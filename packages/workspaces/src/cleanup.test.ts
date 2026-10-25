import { access, mkdir, mkdtemp, readFile, rm, statfs, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RUN_MARKER_FILENAME, createWorkspaceManager } from './index.js';
import type { GitResult, GitRunner, RunMarker, Worktree, WorkspaceManager } from './index.js';

type Responder = (args: readonly string[], cwd: string) => GitResult | Promise<GitResult>;

interface FakeGit extends GitRunner {
  readonly calls: (readonly string[])[];
}

function fakeGit(respond: Responder): FakeGit {
  const calls: string[][] = [];
  return {
    calls,
    async run(input): Promise<GitResult> {
      calls.push([...input.args]);
      return await respond(input.args, input.cwd);
    },
  };
}

function ok(stdout = ''): GitResult {
  return { code: 0, stdout, stderr: '' };
}

const BASE_SHA = 'b'.repeat(40);
const NOW = new Date('2026-05-06T07:08:09.000Z');
const HOUR_MS = 3_600_000;

let root: string;
let repoRoot: string;
let workspaceRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cb-ws-'));
  repoRoot = join(root, 'repos');
  workspaceRoot = join(root, 'worktrees');
  await mkdir(workspaceRoot);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function cleanupGit(): FakeGit {
  return fakeGit((args, cwd) => {
    if (args[0] === 'rev-parse' && args[1] === '--git-path') {
      return ok(`${join(cwd, '.git-store', RUN_MARKER_FILENAME)}\n`);
    }
    return ok();
  });
}

function manager(git: GitRunner): WorkspaceManager {
  return createWorkspaceManager({
    repoRoot,
    workspaceRoot,
    git,
    matchesGlob: () => false,
    cloneDepth: 0,
    httpTimeoutSeconds: 30,
    now: () => new Date(NOW),
  });
}

function marker(runId: string): RunMarker {
  return {
    runId,
    repoSlug: 'acme/web',
    branch: `cb/${runId}-demo`,
    baseRef: 'main',
    baseSha: BASE_SHA,
    promptHash: 'f'.repeat(64),
    createdAt: NOW.toISOString(),
  };
}

function handle(runId: string, path: string): Worktree {
  return {
    runId,
    repoSlug: 'acme/web',
    path,
    branch: `cb/${runId}-demo`,
    baseRef: 'main',
    baseSha: BASE_SHA,
  };
}

interface WorktreeFixture {
  readonly marked?: boolean;
  readonly ageHours?: number;
  readonly bytes?: number;
}

async function makeWorktree(
  instance: WorkspaceManager,
  runId: string,
  fixture: WorktreeFixture = {},
): Promise<string> {
  const directory = join(workspaceRoot, runId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'blob.txt'), 'x'.repeat(fixture.bytes ?? 64));
  if (fixture.marked !== false) {
    await instance.writeRunMarker(handle(runId, directory), marker(runId));
  }
  const mtime = new Date(NOW.getTime() - (fixture.ageHours ?? 1) * HOUR_MS);
  await utimes(directory, mtime, mtime);
  return directory;
}

describe('cleanup', () => {
  it('removes expired worktrees, keeps fresh ones and counts orphans', async () => {
    const instance = manager(cleanupGit());
    const expired = await makeWorktree(instance, 'run_expired', { ageHours: 200, bytes: 128 });
    const fresh = await makeWorktree(instance, 'run_fresh', { ageHours: 1 });
    const orphan = await makeWorktree(instance, 'run_orphan', { marked: false, ageHours: 400 });

    const report = await instance.cleanup({ ttlHours: 168 });

    expect(report.removed).toEqual([expired]);
    expect(report.kept).toBe(1);
    expect(report.orphans).toBe(1);
    expect(report.bytesFreed).toBeGreaterThanOrEqual(128);
    await expect(access(expired)).rejects.toBeTruthy();
    await expect(access(fresh)).resolves.toBeUndefined();
    await expect(access(orphan)).resolves.toBeUndefined();
  });

  it('never removes a directory without a run marker', async () => {
    const instance = manager(cleanupGit());
    const orphan = await makeWorktree(instance, 'run_orphan', { marked: false, ageHours: 400 });

    const report = await instance.cleanup({ ttlHours: 1 });

    expect(report.removed).toEqual([]);
    expect(report.orphans).toBe(1);
    expect(report.kept).toBe(0);
    expect(report.bytesFreed).toBe(0);
    await expect(access(orphan)).resolves.toBeUndefined();
  });

  it('ttlHours zero removes every marked worktree', async () => {
    const instance = manager(cleanupGit());
    const fresh = await makeWorktree(instance, 'run_fresh', { ageHours: 0 });
    const orphan = await makeWorktree(instance, 'run_orphan', { marked: false, ageHours: 0 });

    const report = await instance.cleanup({ ttlHours: 0 });

    expect(report.removed).toEqual([fresh]);
    expect(report.orphans).toBe(1);
    await expect(access(fresh)).rejects.toBeTruthy();
    await expect(access(orphan)).resolves.toBeUndefined();
  });

  it('never visits or removes the bare clone cache', async () => {
    const instance = manager(cleanupGit());
    const cache = join(repoRoot, 'acme__web.git');
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, 'HEAD'), 'ref: refs/heads/main\n');
    const expired = await makeWorktree(instance, 'run_expired', { ageHours: 400 });

    const report = await instance.cleanup({ ttlHours: 168 });

    expect(report.removed).toEqual([expired]);
    await expect(readFile(join(cache, 'HEAD'), 'utf8')).resolves.toBe('ref: refs/heads/main\n');
  });

  it('skips dot directories even when they carry a marker', async () => {
    const instance = manager(cleanupGit());
    const hidden = join(workspaceRoot, '.staging');
    await mkdir(hidden, { recursive: true });
    await instance.writeRunMarker(handle('run_hidden', hidden), marker('run_hidden'));
    const mtime = new Date(NOW.getTime() - 400 * HOUR_MS);
    await utimes(hidden, mtime, mtime);

    const report = await instance.cleanup({ ttlHours: 0 });

    expect(report).toEqual({ removed: [], kept: 0, orphans: 0, bytesFreed: 0 });
    await expect(access(hidden)).resolves.toBeUndefined();
  });

  it('counts a broken marker as an orphan instead of deleting the directory', async () => {
    const instance = manager(cleanupGit());
    const directory = join(workspaceRoot, 'run_broken');
    await mkdir(join(directory, '.git-store'), { recursive: true });
    await writeFile(join(directory, '.git-store', RUN_MARKER_FILENAME), '{not json');
    const mtime = new Date(NOW.getTime() - 400 * HOUR_MS);
    await utimes(directory, mtime, mtime);

    const report = await instance.cleanup({ ttlHours: 0 });

    expect(report.orphans).toBe(1);
    expect(report.removed).toEqual([]);
    await expect(access(directory)).resolves.toBeUndefined();
  });

  it('counts a marker whose run id disagrees with the directory as an orphan', async () => {
    const instance = manager(cleanupGit());
    const directory = join(workspaceRoot, 'run_a');
    await mkdir(directory, { recursive: true });
    await instance.writeRunMarker(handle('run_a', directory), marker('run_other'));
    const mtime = new Date(NOW.getTime() - 400 * HOUR_MS);
    await utimes(directory, mtime, mtime);

    const report = await instance.cleanup({ ttlHours: 0 });

    expect(report.orphans).toBe(1);
    expect(report.removed).toEqual([]);
    await expect(access(directory)).resolves.toBeUndefined();
  });

  it('reports the bytes it freed from the removed directory', async () => {
    const instance = manager(cleanupGit());
    await makeWorktree(instance, 'run_expired', { ageHours: 400, bytes: 256 });

    const report = await instance.cleanup({ ttlHours: 168 });

    expect(report.bytesFreed).toBeGreaterThanOrEqual(256);
  });
});

describe('diskUsage', () => {
  it('reads free and total bytes from the workspace root', async () => {
    const instance = manager(cleanupGit());

    const usage = await instance.diskUsage();
    const info = await statfs(workspaceRoot);

    expect(usage.totalBytes).toBe(info.blocks * info.bsize);
    expect(usage.totalBytes).toBeGreaterThan(0);
    expect(usage.freeBytes).toBeGreaterThanOrEqual(0);
    expect(usage.freeBytes).toBeLessThanOrEqual(usage.totalBytes);
    expect(usage.usedPercent).toBe(
      Number((((usage.totalBytes - usage.freeBytes) / usage.totalBytes) * 100).toFixed(2)),
    );
    expect(usage.usedPercent).toBeGreaterThanOrEqual(0);
    expect(usage.usedPercent).toBeLessThanOrEqual(100);
  });
});

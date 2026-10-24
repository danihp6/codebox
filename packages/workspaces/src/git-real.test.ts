import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { matchesGlob } from '../../core/src/protected-paths.js';
import {
  RUN_MARKER_FILENAME,
  WorkspaceError,
  createGitRunner,
  createWorkspaceManager,
} from './index.js';
import type { RepoRef, WorkspaceManager } from './index.js';

const exec = promisify(execFile);
const HOUR_MS = 3_600_000;
const NOW = new Date('2026-06-07T08:09:10.000Z');

// Hermetic: the tests never inherit the runner's git configuration or credentials.
const GIT_TEST_ENV: Readonly<Record<string, string>> = Object.freeze({
  PATH: '/usr/local/bin:/usr/bin:/bin',
  HOME: homedir(),
  GIT_TERMINAL_PROMPT: '0',
  LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await exec('git', args, {
    cwd,
    env: GIT_TEST_ENV,
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout;
}

async function commit(cwd: string, message: string): Promise<void> {
  await git(cwd, ['add', '-A']);
  await git(cwd, [
    '-c',
    'user.name=Codebox',
    '-c',
    'user.email=codebox@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    message,
  ]);
}

let root: string;
let repoRoot: string;
let workspaceRoot: string;
let origin: string;
let originHead: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cb-ws-'));
  repoRoot = join(root, 'repos');
  workspaceRoot = join(root, 'worktrees');
  await mkdir(workspaceRoot);

  origin = join(root, 'origin.git');
  await git(root, ['init', '--bare', '--initial-branch=main', origin]);
  const seed = join(root, 'seed');
  await git(root, ['clone', origin, seed]);
  await writeFile(join(seed, 'README.md'), '# demo\n\nA demo repository.\n');
  await mkdir(join(seed, 'src'));
  await writeFile(join(seed, 'src', 'index.ts'), 'export const a = 1;\n');
  await commit(seed, 'init');
  await git(seed, ['push', 'origin', 'main']);
  originHead = (await git(seed, ['rev-parse', 'HEAD'])).trim();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function repo(): RepoRef {
  return { slug: 'acme/web', defaultBranch: 'main', cloneUrl: origin };
}

function manager(): WorkspaceManager {
  return createWorkspaceManager({
    repoRoot,
    workspaceRoot,
    git: createGitRunner(),
    matchesGlob,
    cloneDepth: 0,
    httpTimeoutSeconds: 60,
    now: () => new Date(NOW),
  });
}

describe('real git', () => {
  it('clones once and reuses the cache on the second call', async () => {
    const instance = manager();

    const first = await instance.ensureClone(repo());
    expect(first.created).toBe(true);
    expect(first.path).toBe(join(repoRoot, 'acme__web.git'));
    expect(first.headSha).toBe(originHead);
    expect((await git(first.path, ['rev-parse', '--is-bare-repository'])).trim()).toBe('true');

    const second = await instance.ensureClone(repo());
    expect(second.created).toBe(false);
    expect(second.path).toBe(first.path);
    expect(second.headSha).toBe(originHead);
  });

  it('creates two worktrees from one bare clone with distinct paths', async () => {
    const instance = manager();
    const clone = await instance.ensureClone(repo());

    const first = await instance.createWorktree({
      repo: repo(),
      runId: 'run_aaa1',
      baseRef: 'main',
      title: 'first task',
    });
    const second = await instance.createWorktree({
      repo: repo(),
      runId: 'run_bbb2',
      baseRef: 'main',
      title: 'second task',
    });

    expect(first.path).not.toBe(second.path);
    expect((await stat(first.path)).isDirectory()).toBe(true);
    expect((await stat(second.path)).isDirectory()).toBe(true);
    expect(first.branch).toBe('cb/run_aaa1-first-task');
    expect(second.branch).toBe('cb/run_bbb2-second-task');

    const list = (await git(clone.path, ['worktree', 'list'])).trim().split('\n');
    expect(list).toHaveLength(3);
    expect(list.some((line) => line.includes(first.path))).toBe(true);
    expect(list.some((line) => line.includes(second.path))).toBe(true);
  });

  it('removal leaves the cache intact', async () => {
    const instance = manager();
    const clone = await instance.ensureClone(repo());
    const worktree = await instance.createWorktree({
      repo: repo(),
      runId: 'run_gone1',
      baseRef: 'main',
      title: 'remove me',
    });

    await instance.removeWorktree(worktree);

    await expect(access(worktree.path)).rejects.toBeTruthy();
    expect((await stat(clone.path)).isDirectory()).toBe(true);
    expect((await git(clone.path, ['rev-parse', 'refs/heads/main'])).trim()).toBe(originHead);
  });

  it('reports the real diff of a worktree against the recorded base', async () => {
    const instance = manager();
    await instance.ensureClone(repo());
    const worktree = await instance.createWorktree({
      repo: repo(),
      runId: 'run_diff1',
      baseRef: 'main',
      title: 'change the docs',
    });

    await mkdir(join(worktree.path, '.github', 'workflows'), { recursive: true });
    await writeFile(join(worktree.path, '.github', 'workflows', 'ci.yml'), 'name: ci\non: push\n');
    await commit(worktree.path, 'add ci');

    await git(worktree.path, ['mv', 'README.md', 'GUIDE.md']);
    await writeFile(join(worktree.path, 'GUIDE.md'), '# demo\n\nA demo repository.\nMore.\n');
    await commit(worktree.path, 'rename the readme');

    await git(worktree.path, ['rm', 'src/index.ts']);
    await commit(worktree.path, 'drop the entry point');

    const status = await instance.status(worktree, ['.github/**']);

    expect(status.baseSha).toBe(worktree.baseSha);
    expect(status.headSha).toBe((await git(worktree.path, ['rev-parse', 'HEAD'])).trim());
    expect(status.commitsAhead).toBe(3);
    expect(status.dirty).toBe(false);
    expect(status.diff.files).toBe(3);
    expect(status.changedPaths).toEqual(['.github/workflows/ci.yml', 'GUIDE.md', 'src/index.ts']);
    expect(status.diff.changedFiles.map((file) => [file.path, file.status])).toEqual([
      ['.github/workflows/ci.yml', 'added'],
      ['GUIDE.md', 'renamed'],
      ['src/index.ts', 'deleted'],
    ]);
    expect(status.diff.added).toBe(3);
    expect(status.diff.removed).toBe(1);
    expect(status.protectedHits).toEqual([
      { path: '.github/workflows/ci.yml', pattern: '.github/**' },
    ]);
  });

  it('cleanup removes an expired worktree and keeps the cache', async () => {
    const instance = manager();
    const clone = await instance.ensureClone(repo());
    const worktree = await instance.createWorktree({
      repo: repo(),
      runId: 'run_old1',
      baseRef: 'main',
      title: 'expired',
    });
    const mtime = new Date(NOW.getTime() - 400 * HOUR_MS);
    await utimes(worktree.path, mtime, mtime);

    const report = await instance.cleanup({ ttlHours: 168 });

    expect(report.removed).toEqual([worktree.path]);
    await expect(access(worktree.path)).rejects.toBeTruthy();
    expect((await stat(clone.path)).isDirectory()).toBe(true);
    expect((await git(clone.path, ['rev-parse', 'refs/heads/main'])).trim()).toBe(originHead);
  });

  it('a clone of a missing origin fails without leaving a directory', async () => {
    const error = await manager()
      .ensureClone({ slug: 'acme/web', defaultBranch: 'main', cloneUrl: join(root, 'missing.git') })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkspaceError);
    const failure = error as WorkspaceError;
    expect(failure.code).toBe('clone_failed');
    expect(failure.command).toBe('clone');
    expect(failure.exitCode).not.toBeNull();
    expect(failure.exitCode).not.toBe(0);
    expect(await readdir(repoRoot)).toEqual([]);
  });

  it('writes the run marker at the git path of a linked worktree', async () => {
    const instance = manager();
    await instance.ensureClone(repo());
    const worktree = await instance.createWorktree({
      repo: repo(),
      runId: 'run_mark1',
      baseRef: 'main',
      title: 'marker',
    });

    const reported = (
      await git(worktree.path, ['rev-parse', '--git-path', RUN_MARKER_FILENAME])
    ).trim();
    const markerPath = isAbsolute(reported) ? reported : resolve(worktree.path, reported);
    const raw = await readFile(markerPath, 'utf8');

    expect(markerPath).not.toBe(join(worktree.path, '.git', RUN_MARKER_FILENAME));
    expect((await readFile(join(worktree.path, '.git'), 'utf8')).startsWith('gitdir:')).toBe(true);
    expect(JSON.parse(raw)).toEqual({
      runId: 'run_mark1',
      repoSlug: 'acme/web',
      branch: 'cb/run_mark1-marker',
      baseRef: 'main',
      baseSha: worktree.baseSha,
      promptHash: '',
      createdAt: NOW.toISOString(),
    });
    expect(raw).not.toContain(origin);
    expect(raw).not.toContain(repoRoot);
    expect(await instance.readRunMarker(worktree)).toEqual(JSON.parse(raw));
  });
});

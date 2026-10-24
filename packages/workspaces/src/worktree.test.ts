import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RUN_MARKER_FILENAME, WorkspaceError, createWorkspaceManager } from './index.js';
import type {
  GitResult,
  GitRunner,
  RepoRef,
  RunMarker,
  Worktree,
  WorkspaceManager,
  WorkspaceManagerOptions,
} from './index.js';

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
const NOW = new Date('2026-02-03T04:05:06.000Z');
const REPO: RepoRef = { slug: 'acme/web', defaultBranch: 'main', cloneUrl: 'https://example.test' };

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

function worktreeGit(failAdd = false): FakeGit {
  return fakeGit(async (args, cwd) => {
    if (args[0] === 'rev-parse' && args[1] === '--git-path') {
      return ok(`${join(cwd, '.git-store', RUN_MARKER_FILENAME)}\n`);
    }
    if (args[0] === 'rev-parse') return ok(`${BASE_SHA}\n`);
    if (args[0] === 'worktree' && args[1] === 'add') {
      await mkdir(args[4] ?? '', { recursive: true });
      return failAdd ? { code: 128, stdout: '', stderr: 'fatal: nope' } : ok();
    }
    return ok();
  });
}

function manager(
  git: GitRunner,
  overrides: Partial<WorkspaceManagerOptions> = {},
): WorkspaceManager {
  return createWorkspaceManager({
    repoRoot,
    workspaceRoot,
    git,
    matchesGlob: () => false,
    cloneDepth: 0,
    httpTimeoutSeconds: 30,
    now: () => new Date(NOW),
    ...overrides,
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

describe('createWorktree', () => {
  it('creates a worktree on a cb branch and writes the run marker', async () => {
    const git = worktreeGit();
    const worktree = await manager(git).createWorktree({
      repo: REPO,
      runId: 'run_x',
      baseRef: 'main',
      title: 'Fix: the login page',
    });

    expect(worktree).toEqual({
      runId: 'run_x',
      repoSlug: 'acme/web',
      path: join(workspaceRoot, 'run_x'),
      branch: 'cb/run_x-fix-the-login-page',
      baseRef: 'main',
      baseSha: BASE_SHA,
    });
    expect(git.calls).toEqual([
      ['rev-parse', 'main'],
      [
        'worktree',
        'add',
        '-b',
        'cb/run_x-fix-the-login-page',
        join(workspaceRoot, 'run_x'),
        BASE_SHA,
      ],
      ['rev-parse', '--git-path', RUN_MARKER_FILENAME],
    ]);

    const raw = await readFile(join(worktree.path, '.git-store', RUN_MARKER_FILENAME), 'utf8');
    const expected: RunMarker = {
      runId: 'run_x',
      repoSlug: 'acme/web',
      branch: 'cb/run_x-fix-the-login-page',
      baseRef: 'main',
      baseSha: BASE_SHA,
      promptHash: '',
      createdAt: NOW.toISOString(),
    };
    expect(raw).toBe(`${JSON.stringify(expected, null, 2)}\n`);
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).not.toContain('https://');
    expect(raw).not.toContain(repoRoot);
  });

  it('creates two worktrees from one bare clone with distinct paths and branches', async () => {
    const git = worktreeGit();
    const instance = manager(git);

    const first = await instance.createWorktree({
      repo: REPO,
      runId: 'run_aaa1',
      baseRef: 'main',
      title: 'first task',
    });
    const second = await instance.createWorktree({
      repo: REPO,
      runId: 'run_bbb2',
      baseRef: 'main',
      title: 'second task',
    });

    expect(first.path).not.toBe(second.path);
    expect(first.branch).not.toBe(second.branch);
    await expect(access(first.path)).resolves.toBeUndefined();
    await expect(access(second.path)).resolves.toBeUndefined();

    const adds = git.calls.filter((call) => call[0] === 'worktree' && call[1] === 'add');
    expect(adds).toHaveLength(2);
    expect(adds[0]).not.toEqual(adds[1]);
    expect(adds[0]?.[4]).not.toBe(adds[1]?.[4]);
    expect(adds[0]?.[3]).not.toBe(adds[1]?.[3]);
  });

  it('refuses an existing worktree target without running git', async () => {
    const git = worktreeGit();
    await mkdir(join(workspaceRoot, 'run_x'), { recursive: true });

    const error = await manager(git)
      .createWorktree({ repo: REPO, runId: 'run_x', baseRef: 'main', title: 'demo' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkspaceError);
    expect((error as WorkspaceError).code).toBe('worktree_exists');
    expect(git.calls).toEqual([]);
  });

  it('requires the workspace root to exist', async () => {
    const git = worktreeGit();
    const instance = manager(git, { workspaceRoot: join(root, 'missing') });

    const error = await instance
      .createWorktree({ repo: REPO, runId: 'run_x', baseRef: 'main', title: 'demo' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkspaceError);
    expect((error as WorkspaceError).code).toBe('disk_error');
    expect(git.calls).toEqual([]);
  });

  it('a failed creation removes the target directory git left behind', async () => {
    const git = worktreeGit(true);

    const error = await manager(git)
      .createWorktree({ repo: REPO, runId: 'run_x', baseRef: 'main', title: 'demo' })
      .catch((caught: unknown) => caught);

    const failure = error as WorkspaceError;
    expect(failure).toBeInstanceOf(WorkspaceError);
    expect(failure.code).toBe('worktree_failed');
    expect(failure.command).toBe('worktree');
    expect(failure.exitCode).toBe(128);
    await expect(access(join(workspaceRoot, 'run_x'))).rejects.toBeTruthy();
  });
});

describe('removeWorktree', () => {
  it('removes with --force then prunes and leaves the cache intact', async () => {
    const git = worktreeGit();
    const instance = manager(git);
    const worktree = await instance.createWorktree({
      repo: REPO,
      runId: 'run_x',
      baseRef: 'main',
      title: 'demo',
    });
    const cache = join(repoRoot, 'acme__web.git');
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, 'keep.txt'), 'cache\n');
    git.calls.length = 0;

    await instance.removeWorktree(worktree);

    expect(git.calls).toEqual([
      ['worktree', 'remove', '--force', worktree.path],
      ['worktree', 'prune'],
    ]);
    await expect(access(worktree.path)).rejects.toBeTruthy();
    await expect(readFile(join(cache, 'keep.txt'), 'utf8')).resolves.toBe('cache\n');
  });

  it('treats a missing worktree directory as already removed and still prunes', async () => {
    const git = worktreeGit();
    const instance = manager(git);

    await instance.removeWorktree(handle('run_gone', join(workspaceRoot, 'run_gone')));

    expect(git.calls).toEqual([['worktree', 'prune']]);
  });

  it('refuses a path that is not exactly the managed run directory', async () => {
    const git = worktreeGit();
    const instance = manager(git);

    await expect(
      instance.removeWorktree(handle('run_x', join(root, 'elsewhere'))),
    ).rejects.toMatchObject({ code: 'invalid_root' });
    expect(git.calls).toEqual([]);
  });
});

describe('run markers and listing', () => {
  it('reads and writes the marker at the git path, not at .git/codebox-run.json', async () => {
    const git = worktreeGit();
    const instance = manager(git);
    const directory = join(workspaceRoot, 'run_a');
    await mkdir(directory, { recursive: true });

    await instance.writeRunMarker(handle('run_a', directory), marker('run_a'));

    expect(await instance.readRunMarker(handle('run_a', directory))).toEqual(marker('run_a'));
    await expect(
      readFile(join(directory, '.git', RUN_MARKER_FILENAME), 'utf8'),
    ).rejects.toBeTruthy();
  });

  it('returns null for a missing or unreadable marker', async () => {
    const git = worktreeGit();
    const instance = manager(git);
    const directory = join(workspaceRoot, 'run_b');
    await mkdir(directory, { recursive: true });

    expect(await instance.readRunMarker(handle('run_b', directory))).toBeNull();

    await mkdir(join(directory, '.git-store'), { recursive: true });
    await writeFile(join(directory, '.git-store', RUN_MARKER_FILENAME), '{not json');
    expect(await instance.readRunMarker(handle('run_b', directory))).toBeNull();

    await writeFile(
      join(directory, '.git-store', RUN_MARKER_FILENAME),
      `${JSON.stringify({ runId: 'run_b' }, null, 2)}\n`,
    );
    expect(await instance.readRunMarker(handle('run_b', directory))).toBeNull();
  });

  it('lists direct child directories with their marker facts and byte size', async () => {
    const git = worktreeGit();
    const instance = manager(git);
    const marked = join(workspaceRoot, 'run_a');
    const orphan = join(workspaceRoot, 'run_b');
    const hidden = join(workspaceRoot, '.cache');
    await mkdir(marked, { recursive: true });
    await mkdir(orphan, { recursive: true });
    await mkdir(hidden, { recursive: true });
    await instance.writeRunMarker(handle('run_a', marked), marker('run_a'));
    await writeFile(join(orphan, 'blob.txt'), 'x'.repeat(100));
    await writeFile(join(hidden, 'blob.txt'), 'x'.repeat(100));

    const infos = await instance.listWorktrees();

    expect(infos.map((info) => info.path)).toEqual([marked, orphan]);
    expect(infos[0]?.runId).toBe('run_a');
    expect(infos[0]?.repoSlug).toBe('acme/web');
    expect(infos[0]?.branch).toBe('cb/run_a-demo');
    expect(infos[0]?.bytes).toBeGreaterThan(0);
    expect(infos[1]?.runId).toBeNull();
    expect(infos[1]?.repoSlug).toBeNull();
    expect(infos[1]?.branch).toBeNull();
    expect(infos[1]?.bytes).toBeGreaterThanOrEqual(100);
    for (const info of infos) {
      expect(Number.isNaN(Date.parse(info.modifiedAt))).toBe(false);
    }
  });
});

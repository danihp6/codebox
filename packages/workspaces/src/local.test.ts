import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  INITIAL_BACKLOG,
  RUN_MARKER_FILENAME,
  WorkspaceError,
  createGitRunner,
  createLocalWorktree,
  initLocal,
  localRepoPath,
} from './index.js';
import type { GitResult, GitRunner, LocalRepo } from './index.js';

const exec = promisify(execFile);

type Responder = (args: readonly string[], cwd: string) => GitResult | Promise<GitResult>;

interface RecordedCall {
  readonly args: readonly string[];
  readonly cwd: string;
}

interface FakeGit extends GitRunner {
  readonly calls: RecordedCall[];
}

function fakeGit(respond: Responder): FakeGit {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async run(input): Promise<GitResult> {
      calls.push({ args: [...input.args], cwd: input.cwd });
      return await respond(input.args, input.cwd);
    },
  };
}

function ok(stdout = ''): GitResult {
  return { code: 0, stdout, stderr: '' };
}

function failed(code = 128): GitResult {
  return { code, stdout: '', stderr: 'fatal: nope' };
}

const HEAD_SHA = 'a'.repeat(40);
const NOW = new Date('2026-11-13T09:10:11.000Z');
const COMMIT_ARGS: readonly string[] = [
  '-c',
  'user.name=codebox[bot]',
  '-c',
  'user.email=codebox@users.noreply.github.com',
  'commit',
  '--no-verify',
  '-m',
  'Initial commit',
];

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

function initRunner(failOn: 'init' | 'add' | 'commit' | null = null): FakeGit {
  return fakeGit(async (args) => {
    const subcommand = args[0] === '-c' ? 'commit' : args[0];
    if (failOn !== null && subcommand === failOn) return failed();
    if (args[0] === 'rev-parse') return ok(`${HEAD_SHA}\n`);
    return ok();
  });
}

function worktreeRunner(): FakeGit {
  return fakeGit(async (args, cwd) => {
    if (args[0] === 'rev-parse' && args[1] === '--git-path') {
      return ok(`${join(cwd, '.git-store', RUN_MARKER_FILENAME)}\n`);
    }
    if (args[0] === 'rev-parse') return ok(`${HEAD_SHA}\n`);
    return ok();
  });
}

function localRepo(): Pick<LocalRepo, 'name' | 'path' | 'defaultBranch'> {
  return { name: 'widgets', path: join(repoRoot, 'widgets'), defaultBranch: 'main' };
}

async function caught(promise: Promise<unknown>): Promise<WorkspaceError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(WorkspaceError);
  return error as WorkspaceError;
}

describe('localRepoPath', () => {
  it('joins an absolute root and a folder-safe name', () => {
    expect(localRepoPath('/srv/codebox/repos', 'widgets')).toBe(
      join('/srv/codebox/repos', 'widgets'),
    );
    expect(localRepoPath(repoRoot, 'a.b_c-d')).toBe(join(repoRoot, 'a.b_c-d'));
    expect(localRepoPath(repoRoot, 'a')).toBe(join(repoRoot, 'a'));
    expect(localRepoPath(repoRoot, 'x'.repeat(64))).toBe(join(repoRoot, 'x'.repeat(64)));
  });

  it('refuses every name that could escape the root, before any process starts', () => {
    for (const name of [
      '../x',
      'a/b',
      'a\\b',
      '.',
      '..',
      '',
      'C:x',
      'Widgets',
      '-a',
      'a'.repeat(65),
    ]) {
      expect(() => localRepoPath(repoRoot, name)).toThrow(WorkspaceError);
      const code = (() => {
        try {
          localRepoPath(repoRoot, name);
          return null;
        } catch (error) {
          return (error as WorkspaceError).code;
        }
      })();
      expect(code).toBe('invalid_root');
    }
  });

  it('refuses a relative repository root', () => {
    for (const relative of ['repos', './repos', '']) {
      const code = (() => {
        try {
          localRepoPath(relative, 'widgets');
          return null;
        } catch (error) {
          return (error as WorkspaceError).code;
        }
      })();
      expect(code).toBe('invalid_root');
    }
  });

  it('is pure: the same arguments answer the same path and touch nothing', async () => {
    const target = localRepoPath(repoRoot, 'widgets');
    expect(localRepoPath(repoRoot, 'widgets')).toBe(target);
    await expect(readdir(join(root, 'repos'))).rejects.toBeTruthy();
  });
});

describe('initLocal', () => {
  it('issues init, add, commit and rev-parse in order, in the repository directory', async () => {
    const git = initRunner();
    const created = await initLocal({
      repoRoot,
      name: 'widgets',
      defaultBranch: 'main',
      git,
      now: () => new Date(NOW),
    });

    const path = join(repoRoot, 'widgets');
    expect(git.calls.map((call) => call.args)).toEqual([
      ['init', '-b', 'main'],
      ['add', '--', 'TODO.md'],
      [...COMMIT_ARGS],
      ['rev-parse', 'HEAD'],
    ]);
    for (const call of git.calls) expect(call.cwd).toBe(path);
    expect(created).toEqual({
      name: 'widgets',
      path,
      defaultBranch: 'main',
      headSha: HEAD_SHA,
    });
  });

  it('carries no URL, no token and no remote identity in any argument', async () => {
    const git = initRunner();
    await initLocal({ repoRoot, name: 'widgets', defaultBranch: 'main', git });

    const args = git.calls.flatMap((call) => call.args);
    for (const argument of args) {
      expect(argument).not.toContain('://');
      expect(argument).not.toMatch(/ghp_|gho_|ghu_|ghs_|github_pat_|x-access-token|sk-ant-/);
    }
    const withAt = args.filter((argument) => argument.includes('@'));
    const withGithub = args.filter((argument) => argument.includes('github'));
    expect(withAt).toEqual(['user.email=codebox@users.noreply.github.com']);
    expect(withGithub).toEqual(['user.email=codebox@users.noreply.github.com']);
  });

  it('honours the requested default branch', async () => {
    const git = initRunner();
    const created = await initLocal({
      repoRoot,
      name: 'widgets',
      defaultBranch: 'trunk',
      git,
    });

    expect(created.defaultBranch).toBe('trunk');
    expect(git.calls[0]?.args).toEqual(['init', '-b', 'trunk']);
  });

  it('reports a refused init, add or commit as git_failed with its subcommand', async () => {
    for (const [failOn, command] of [
      ['init', 'init'],
      ['add', 'add'],
      ['commit', 'commit'],
    ] as const) {
      const git = initRunner(failOn);
      const error = await caught(
        initLocal({
          repoRoot: join(repoRoot, command),
          name: 'widgets',
          defaultBranch: 'main',
          git,
        }),
      );
      expect(error.code).toBe('git_failed');
      expect(error.command).toBe(command);
      expect(error.exitCode).toBe(128);
    }
  });

  it('refuses a name that could escape the root without running git', async () => {
    const git = initRunner();

    const error = await caught(
      initLocal({ repoRoot, name: '../escape', defaultBranch: 'main', git }),
    );

    expect(error.code).toBe('invalid_root');
    expect(git.calls).toEqual([]);
    await expect(readdir(join(root, 'repos'))).rejects.toBeTruthy();
  });

  it('refuses a second initLocal for the same name and leaves the tree untouched', async () => {
    await initLocal({ repoRoot, name: 'widgets', defaultBranch: 'main', git: initRunner() });
    const before = await readdir(join(repoRoot, 'widgets'));
    const git = initRunner();

    const error = await caught(
      initLocal({ repoRoot, name: 'widgets', defaultBranch: 'main', git }),
    );

    expect(error.code).toBe('worktree_exists');
    expect(git.calls).toEqual([]);
    expect(await readdir(join(repoRoot, 'widgets'))).toEqual(before);
  });

  it('seeds TODO.md with INITIAL_BACKLOG and nothing else', async () => {
    await initLocal({ repoRoot, name: 'widgets', defaultBranch: 'main', git: initRunner() });

    expect(await readFile(join(repoRoot, 'widgets', 'TODO.md'), 'utf8')).toBe(INITIAL_BACKLOG);
    expect(await readdir(join(repoRoot, 'widgets'))).toEqual(['TODO.md']);
  });

  it('freezes the initial backlog byte for byte', () => {
    expect(INITIAL_BACKLOG).toBe(
      '# Backlog\n\nOne item per line, in the order the repository works through them.\n',
    );
    expect(INITIAL_BACKLOG.endsWith('\n')).toBe(true);
    expect(INITIAL_BACKLOG.endsWith('\n\n')).toBe(false);
    expect(INITIAL_BACKLOG).not.toContain('\r');
    expect(INITIAL_BACKLOG.charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe('createLocalWorktree', () => {
  it('cuts a worktree from the local default branch and writes the run marker', async () => {
    const git = worktreeRunner();
    const repo = localRepo();
    const worktree = await createLocalWorktree({
      workspaceRoot,
      repo,
      runId: 'run_x',
      title: 'Fix: the login page',
      git,
      now: () => new Date(NOW),
    });

    const target = join(workspaceRoot, 'run_x');
    expect(worktree).toEqual({
      runId: 'run_x',
      repoSlug: 'widgets',
      path: target,
      branch: 'cb/run_x-fix-the-login-page',
      baseRef: 'main',
      baseSha: HEAD_SHA,
    });
    expect(git.calls.map((call) => call.args)).toEqual([
      ['rev-parse', 'main'],
      ['worktree', 'add', '-b', 'cb/run_x-fix-the-login-page', target, HEAD_SHA],
      ['rev-parse', '--git-path', RUN_MARKER_FILENAME],
    ]);
    expect(git.calls[0]?.cwd).toBe(repo.path);
    expect(git.calls[1]?.cwd).toBe(repo.path);

    const raw = await readFile(join(target, '.git-store', RUN_MARKER_FILENAME), 'utf8');
    expect(JSON.parse(raw)).toEqual({
      runId: 'run_x',
      repoSlug: 'widgets',
      branch: 'cb/run_x-fix-the-login-page',
      baseRef: 'main',
      baseSha: HEAD_SHA,
      promptHash: '',
      createdAt: NOW.toISOString(),
    });
    expect(raw).not.toContain('://');
    expect(raw).not.toContain(repoRoot);
  });

  it('cuts from an explicit base ref when one is given', async () => {
    const git = worktreeRunner();
    const repo = localRepo();

    const worktree = await createLocalWorktree({
      workspaceRoot,
      repo,
      runId: 'run_y',
      title: 'ship it',
      baseRef: 'release/1',
      git,
    });

    expect(worktree.baseRef).toBe('release/1');
    expect(git.calls[0]?.args).toEqual(['rev-parse', 'release/1']);
  });

  it('refuses an existing worktree target without running git', async () => {
    const git = worktreeRunner();
    await mkdir(join(workspaceRoot, 'run_x'), { recursive: true });

    const error = await caught(
      createLocalWorktree({
        workspaceRoot,
        repo: localRepo(),
        runId: 'run_x',
        title: 'demo',
        git,
      }),
    );

    expect(error.code).toBe('worktree_exists');
    expect(git.calls).toEqual([]);
  });

  it('requires the workspace root to exist', async () => {
    const git = worktreeRunner();

    const error = await caught(
      createLocalWorktree({
        workspaceRoot: join(root, 'missing'),
        repo: localRepo(),
        runId: 'run_x',
        title: 'demo',
        git,
      }),
    );

    expect(error.code).toBe('disk_error');
    expect(git.calls).toEqual([]);
  });

  it('removes the target git left behind when the worktree add fails', async () => {
    const git = fakeGit(async (args) => (args[0] === 'rev-parse' ? ok(`${HEAD_SHA}\n`) : failed()));

    const error = await caught(
      createLocalWorktree({
        workspaceRoot,
        repo: localRepo(),
        runId: 'run_x',
        title: 'demo',
        git,
      }),
    );

    expect(error.code).toBe('worktree_failed');
    expect(error.command).toBe('worktree');
    await expect(readdir(join(workspaceRoot, 'run_x'))).rejects.toBeTruthy();
  });
});

// Hermetic: these calls never inherit the runner's git configuration or credentials.
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

// `GIT_ENV.PATH` in `src/git.ts` is a POSIX path list, so a case that spawns real git measures
// on Linux only; the CI run is the authority for it.
describe.skipIf(process.platform === 'win32')('real git', () => {
  it('creates an offline repository with one commit, one file and no remote', async () => {
    const repo = await initLocal({
      repoRoot,
      name: 'widgets',
      defaultBranch: 'main',
      git: createGitRunner(),
      now: () => new Date(NOW),
    });

    expect(repo.path).toBe(join(repoRoot, 'widgets'));
    expect((await git(repo.path, ['rev-list', '--count', 'HEAD'])).trim()).toBe('1');
    expect((await git(repo.path, ['symbolic-ref', '--short', 'HEAD'])).trim()).toBe('main');
    expect((await git(repo.path, ['ls-files'])).trim()).toBe('TODO.md');
    expect((await git(repo.path, ['remote'])).trim()).toBe('');
    expect((await git(repo.path, ['log', '-1', '--format=%s'])).trim()).toBe('Initial commit');
    expect((await git(repo.path, ['log', '-1', '--format=%an <%ae>'])).trim()).toBe(
      'codebox[bot] <codebox@users.noreply.github.com>',
    );
    expect((await git(repo.path, ['rev-parse', 'HEAD'])).trim()).toBe(repo.headSha);
    expect(await readFile(join(repo.path, 'TODO.md'), 'utf8')).toBe(INITIAL_BACKLOG);

    const worktree = await createLocalWorktree({
      workspaceRoot,
      repo,
      runId: 'run_real',
      title: 'local run',
      git: createGitRunner(),
      now: () => new Date(NOW),
    });

    expect((await git(worktree.path, ['rev-parse', 'HEAD'])).trim()).toBe(repo.headSha);
    expect((await git(worktree.path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe(
      'cb/run_real-local-run',
    );
    expect((await git(repo.path, ['worktree', 'list'])).trim().split('\n')).toHaveLength(2);
    const markerPath = (
      await git(worktree.path, ['rev-parse', '--git-path', RUN_MARKER_FILENAME])
    ).trim();
    expect(JSON.parse(await readFile(join(worktree.path, markerPath), 'utf8'))).toEqual({
      runId: 'run_real',
      repoSlug: 'widgets',
      branch: 'cb/run_real-local-run',
      baseRef: 'main',
      baseSha: repo.headSha,
      promptHash: '',
      createdAt: NOW.toISOString(),
    });
  }, 30_000);
});

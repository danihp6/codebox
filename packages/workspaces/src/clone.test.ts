import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GIT_ENV, WorkspaceError, createWorkspaceManager } from './index.js';
import type { GitResult, GitRunner, RepoRef, WorkspaceManager } from './index.js';

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

const SHA = 'a'.repeat(40);
const TOKEN_URL = 'https://x-access-token:sekret@github.com/acme/web.git';
const REPO: RepoRef = { slug: 'acme/web', defaultBranch: 'main', cloneUrl: TOKEN_URL };
const NOW = new Date('2026-01-01T00:00:00.000Z');

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

function manager(git: GitRunner, cloneDepth = 0): WorkspaceManager {
  return createWorkspaceManager({
    repoRoot,
    workspaceRoot,
    git,
    matchesGlob: () => false,
    cloneDepth,
    httpTimeoutSeconds: 30,
    now: () => new Date(NOW),
  });
}

function cacheDir(): string {
  return join(repoRoot, 'acme__web.git');
}

describe('ensureClone', () => {
  it('clones into the bare cache directory and reports it as created', async () => {
    const git = fakeGit(async (args) => {
      if (args[0] === 'clone') {
        const destination = args.at(-1) ?? '';
        await mkdir(destination, { recursive: true });
        await writeFile(join(destination, 'HEAD'), 'ref: refs/heads/main\n');
        return ok();
      }
      if (args[0] === 'rev-parse') return ok(`${SHA}\n`);
      return ok();
    });

    const result = await manager(git).ensureClone(REPO);

    expect(result.created).toBe(true);
    expect(result.path).toBe(cacheDir());
    expect(result.headSha).toBe(SHA);
    expect(await readdir(repoRoot)).toEqual(['acme__web.git']);
    expect(git.calls[0]?.slice(0, 2)).toEqual(['clone', '--bare']);
    expect(git.calls[0]?.at(-1)).toContain('.clone-');
    expect(git.calls[1]).toEqual(['rev-parse', 'refs/heads/main']);
  });

  it('reuses an existing cache with fetch --prune and never clones', async () => {
    await mkdir(cacheDir(), { recursive: true });
    const git = fakeGit((args) => (args[0] === 'rev-parse' ? ok(`${SHA}\n`) : ok()));

    const result = await manager(git).ensureClone(REPO);

    expect(result.created).toBe(false);
    expect(result.path).toBe(cacheDir());
    expect(result.headSha).toBe(SHA);
    expect(git.calls).toEqual([
      ['fetch', '--prune', 'origin'],
      ['rev-parse', 'refs/heads/main'],
    ]);
  });

  it('passes --depth to clone and fetch when a shallow clone is configured', async () => {
    const git = fakeGit(async (args) => {
      if (args[0] === 'clone') {
        await mkdir(args.at(-1) ?? '', { recursive: true });
        return ok();
      }
      if (args[0] === 'rev-parse') return ok(`${SHA}\n`);
      return ok();
    });

    await manager(git, 5).ensureClone(REPO);
    const clone = git.calls[0] ?? [];
    expect(clone.slice(0, 4)).toEqual(['clone', '--bare', '--depth', '5']);
    expect(clone.at(-2)).toBe(TOKEN_URL);

    await manager(git, 5).ensureClone(REPO);
    const beforeRefresh = git.calls.length;
    await manager(git, 5).ensureClone(REPO);
    expect(git.calls[beforeRefresh]).toEqual(['fetch', '--prune', '--depth', '5', 'origin']);
  });

  it('a failed clone leaves no half directory and no cache entry', async () => {
    const git = fakeGit((args) =>
      args[0] === 'clone'
        ? { code: 128, stdout: '', stderr: `fatal: could not read ${TOKEN_URL}` }
        : ok(),
    );

    const error = await manager(git)
      .ensureClone(REPO)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkspaceError);
    const failure = error as WorkspaceError;
    expect(failure.code).toBe('clone_failed');
    expect(failure.command).toBe('clone');
    expect(failure.exitCode).toBe(128);
    expect(await readdir(repoRoot)).toEqual([]);
    await expect(access(cacheDir())).rejects.toBeTruthy();
  });

  it('a failed clone removes the temporary directory git already created', async () => {
    const git = fakeGit(async (args) => {
      if (args[0] === 'clone') {
        await mkdir(args.at(-1) ?? '', { recursive: true });
        return { code: 128, stdout: '', stderr: 'fatal: early EOF' };
      }
      return ok();
    });

    await expect(manager(git).ensureClone(REPO)).rejects.toMatchObject({ code: 'clone_failed' });
    expect(await readdir(repoRoot)).toEqual([]);
  });

  it('a failed fetch leaves the cache as it was and reports fetch_failed', async () => {
    await mkdir(cacheDir(), { recursive: true });
    const git = fakeGit(() => ({ code: 1, stdout: '', stderr: 'fatal: unable to access' }));

    const error = await manager(git)
      .ensureClone(REPO)
      .catch((caught: unknown) => caught);

    const failure = error as WorkspaceError;
    expect(failure).toBeInstanceOf(WorkspaceError);
    expect(failure.code).toBe('fetch_failed');
    expect(failure.command).toBe('fetch');
    expect(failure.exitCode).toBe(1);
    expect(git.calls).toEqual([['fetch', '--prune', 'origin']]);
    expect(await readdir(repoRoot)).toEqual(['acme__web.git']);
  });

  it('deletes its temporary clone and returns the winner when the cache appears mid-clone', async () => {
    const git = fakeGit(async (args) => {
      if (args[0] === 'clone') {
        await mkdir(args.at(-1) ?? '', { recursive: true });
        await mkdir(cacheDir(), { recursive: true });
        await writeFile(join(cacheDir(), 'HEAD'), 'ref: refs/heads/main\n');
        return ok();
      }
      if (args[0] === 'rev-parse') return ok(`${SHA}\n`);
      return ok();
    });

    const result = await manager(git).ensureClone(REPO);

    expect(result.created).toBe(false);
    expect(result.path).toBe(cacheDir());
    expect(result.headSha).toBe(SHA);
    expect(await readdir(repoRoot)).toEqual(['acme__web.git']);
    expect(git.calls.map((call) => call[0])).toEqual(['clone', 'fetch', 'rev-parse']);
  });

  it('a spawn error becomes git_failed with no exit code and no argument list', async () => {
    const git: GitRunner = {
      async run(): Promise<GitResult> {
        throw new Error('spawn git ENOENT');
      },
    };

    const error = await manager(git)
      .ensureClone(REPO)
      .catch((caught: unknown) => caught);

    const failure = error as WorkspaceError;
    expect(failure).toBeInstanceOf(WorkspaceError);
    expect(failure.code).toBe('git_failed');
    expect(failure.command).toBe('clone');
    expect(failure.exitCode).toBeNull();
    expect(failure.message).not.toContain('ENOENT');
  });

  it('never leaks the clone URL or git stderr through an error', async () => {
    const git = fakeGit(() => ({
      code: 128,
      stdout: '',
      stderr: `fatal: could not read from ${TOKEN_URL}`,
    }));

    const error = await manager(git)
      .ensureClone(REPO)
      .catch((caught: unknown) => caught);

    const failure = error as WorkspaceError;
    expect(failure).toBeInstanceOf(WorkspaceError);
    expect(failure.message).not.toContain('sekret');
    expect(failure.message).not.toContain('github.com');
    expect(String(failure)).not.toContain('sekret');
    expect(JSON.stringify({ code: failure.code, command: failure.command })).not.toContain(
      'sekret',
    );
    expect(failure.command).toBe('clone');
    expect(failure.exitCode).toBe(128);
  });

  it('refuses a repository slug that is not exactly owner/name before touching the disk', async () => {
    const git = fakeGit(() => ok());

    await expect(manager(git).ensureClone({ ...REPO, slug: 'acme' })).rejects.toMatchObject({
      code: 'invalid_root',
    });
    await expect(access(repoRoot)).rejects.toBeTruthy();
    expect(git.calls).toEqual([]);
  });

  it('runs git through an environment that cannot prompt for a credential', () => {
    expect(GIT_ENV['GIT_TERMINAL_PROMPT']).toBe('0');
    expect(GIT_ENV['LC_ALL']).toBe('C');
    expect(typeof GIT_ENV['HOME']).toBe('string');
    expect(typeof GIT_ENV['PATH']).toBe('string');
    expect(Object.keys(GIT_ENV).sort()).toEqual(
      ['GIT_TERMINAL_PROMPT', 'HOME', 'LC_ALL', 'PATH'].sort(),
    );
  });
});

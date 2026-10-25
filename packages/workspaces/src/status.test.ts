import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { matchesGlob } from '../../core/src/protected-paths.js';
import { WorkspaceError, createWorkspaceManager } from './index.js';
import type { GitResult, GitRunner, Worktree, WorkspaceManager } from './index.js';

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
const HEAD_SHA = 'c'.repeat(40);

interface Outputs {
  readonly numstat?: string;
  readonly nameStatus?: string;
  readonly porcelain?: string;
  readonly ahead?: string;
}

function statusGit(outputs: Outputs = {}): FakeGit {
  return fakeGit((args) => {
    const [command, subcommand] = args;
    if (command === 'rev-parse') return ok(`${HEAD_SHA}\n`);
    if (command === 'rev-list') return ok(`${outputs.ahead ?? '0'}\n`);
    if (command === 'status') return ok(outputs.porcelain ?? '');
    if (command === 'diff' && subcommand === '--numstat') return ok(outputs.numstat ?? '');
    if (command === 'diff' && subcommand === '--name-status') return ok(outputs.nameStatus ?? '');
    return ok();
  });
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cb-ws-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function manager(git: GitRunner): WorkspaceManager {
  return createWorkspaceManager({
    repoRoot: join(root, 'repos'),
    workspaceRoot: join(root, 'worktrees'),
    git,
    matchesGlob,
    cloneDepth: 0,
    httpTimeoutSeconds: 30,
    now: () => new Date('2026-03-04T05:06:07.000Z'),
  });
}

function handle(): Worktree {
  return {
    runId: 'run_x1',
    repoSlug: 'acme/web',
    path: join(root, 'worktrees', 'run_x1'),
    branch: 'cb/run_x1-fix',
    baseRef: 'main',
    baseSha: BASE_SHA,
  };
}

describe('status', () => {
  it('runs exactly the five git commands in order and reports the recorded base', async () => {
    const git = statusGit();

    const status = await manager(git).status(handle(), []);

    expect(git.calls).toEqual([
      ['rev-parse', 'HEAD'],
      ['rev-list', '--count', `${BASE_SHA}..HEAD`],
      ['status', '--porcelain'],
      ['diff', '--numstat', '-M', BASE_SHA, '--'],
      ['diff', '--name-status', '-M', BASE_SHA, '--'],
    ]);
    expect(status.branch).toBe('cb/run_x1-fix');
    expect(status.baseSha).toBe(BASE_SHA);
    expect(status.headSha).toBe(HEAD_SHA);
  });

  it('reports a clean worktree with an empty diff and no commits ahead', async () => {
    const status = await manager(statusGit()).status(handle(), []);

    expect(status.dirty).toBe(false);
    expect(status.commitsAhead).toBe(0);
    expect(status.diff).toEqual({ files: 0, added: 0, removed: 0, changedFiles: [] });
    expect(status.changedPaths).toEqual([]);
    expect(status.protectedHits).toEqual([]);
  });

  it('reports a dirty worktree and the number of commits ahead', async () => {
    const status = await manager(
      statusGit({ porcelain: ' M src/index.ts\n?? notes.md\n', ahead: '3\n' }),
    ).status(handle(), []);

    expect(status.dirty).toBe(true);
    expect(status.commitsAhead).toBe(3);
  });

  it('finds both pinned protected paths through the injected glob matcher', async () => {
    const git = statusGit({
      numstat: [
        '1\t0\t.github/workflows/x.yml',
        '2\t1\tops/vm/install.sh',
        '3\t0\tsrc/index.ts',
        '',
      ].join('\n'),
      nameStatus: [
        'A\t.github/workflows/x.yml',
        'M\tops/vm/install.sh',
        'A\tsrc/index.ts',
        '',
      ].join('\n'),
    });

    const status = await manager(git).status(handle(), ['.github/**', 'ops/**']);

    expect(status.protectedHits).toEqual([
      { path: '.github/workflows/x.yml', pattern: '.github/**' },
      { path: 'ops/vm/install.sh', pattern: 'ops/**' },
    ]);
    expect(status.changedPaths).toEqual([
      '.github/workflows/x.yml',
      'ops/vm/install.sh',
      'src/index.ts',
    ]);
  });

  it('keeps a renamed file once under its new path with its real delta', async () => {
    const status = await manager(
      statusGit({
        numstat: '12\t3\tsrc/{old => new}.ts\n',
        nameStatus: 'R100\tsrc/old.ts\tsrc/new.ts\n',
      }),
    ).status(handle(), []);

    expect(status.changedPaths).toEqual(['src/new.ts']);
    expect(status.diff).toEqual({
      files: 1,
      added: 12,
      removed: 3,
      changedFiles: [{ path: 'src/new.ts', status: 'renamed', added: 12, removed: 3 }],
    });
  });

  it('deduplicates changed paths in git order and normalises them', async () => {
    const status = await manager(
      statusGit({
        numstat: ['1\t0\t./src//a.ts', '2\t0\tsrc/b.ts', '3\t0\t./src//a.ts', ''].join('\n'),
      }),
    ).status(handle(), []);

    expect(status.changedPaths).toEqual(['src/a.ts', 'src/b.ts']);
    expect(status.diff.files).toBe(2);
    expect(status.diff.added).toBe(6);
  });

  it('does not match protected paths against a clean diff', async () => {
    const status = await manager(statusGit()).status(handle(), ['.github/**']);

    expect(status.protectedHits).toEqual([]);
  });

  it('never leaks git stderr or the command line through a failure', async () => {
    const git = fakeGit((args) => {
      if (args[0] === 'diff') {
        return {
          code: 128,
          stdout: '',
          stderr: 'fatal: https://x-access-token:sekret@github.com/acme/web.git',
        };
      }
      return ok(`${HEAD_SHA}\n`);
    });

    const error = await manager(git)
      .status(handle(), [])
      .catch((caught: unknown) => caught);

    const failure = error as WorkspaceError;
    expect(failure).toBeInstanceOf(WorkspaceError);
    expect(failure.code).toBe('git_failed');
    expect(failure.command).toBe('diff');
    expect(failure.exitCode).toBe(128);
    expect(failure.message).not.toContain('sekret');
    expect(failure.message).not.toContain('github.com');
    expect(String(failure)).not.toContain('sekret');
  });
});

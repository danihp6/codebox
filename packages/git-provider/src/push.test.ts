import { describe, expect, it } from 'vitest';
import { createGitHubProvider } from './github.js';
import type { GitProviderError } from './errors.js';
import type {
  GitCommandInput,
  GitCommandRunner,
  GitProvider,
  GitResult,
  LogSink,
  ProviderLogEvent,
  RepoInfo,
} from './types.js';

const TOKEN = 'ghs_push_test_value';
const WORKTREE = '/tmp/wt';
const BRANCH = 'cb/run_1-x';

const REPO: RepoInfo = {
  slug: 'acme/web',
  defaultBranch: 'main',
  private: true,
  canPush: true,
};

interface Recorder {
  readonly calls: GitCommandInput[];
  readonly runner: GitCommandRunner;
}

function recorder(results: readonly GitResult[]): Recorder {
  const calls: GitCommandInput[] = [];
  let index = 0;
  return {
    calls,
    runner: {
      run: async (input) => {
        const result = results[index] ?? { code: 0, stdout: '', stderr: '' };
        index += 1;
        calls.push(input);
        return result;
      },
    },
  };
}

function providerWith(git: GitCommandRunner, log: LogSink = () => undefined): GitProvider {
  return createGitHubProvider({
    auth: { kind: 'pat', token: TOKEN },
    apiBase: 'https://api.github.test',
    gitHost: 'github.com',
    fetch: async () => new Response('{}', { status: 200 }),
    git,
    now: () => 1_700_000_000_000,
    requestTimeoutMs: 1_000,
    log,
    userAgent: 'codebox/test',
  });
}

async function capture(run: () => Promise<unknown>): Promise<GitProviderError> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  const error = caught as GitProviderError;
  expect(error.name).toBe('GitProviderError');
  return error;
}

describe('push', () => {
  it('push: makes exactly the two documented git calls in order', async () => {
    const git = recorder([
      { code: 0, stdout: 'pushed\n', stderr: '' },
      { code: 0, stdout: 'abc123def456\n', stderr: '' },
    ]);
    const result = await providerWith(git.runner).pushBranch({
      repo: REPO,
      worktree: WORKTREE,
      branch: BRANCH,
    });
    expect(git.calls).toHaveLength(2);
    expect(git.calls[0]?.args).toEqual([
      '-C',
      '/tmp/wt',
      'push',
      `https://x-access-token:${TOKEN}@github.com/acme/web.git`,
      'HEAD:refs/heads/cb/run_1-x',
    ]);
    expect(git.calls[1]?.args).toEqual(['-C', '/tmp/wt', 'rev-parse', 'HEAD']);
    expect(git.calls[0]?.cwd).toBe(WORKTREE);
    expect(git.calls[1]?.cwd).toBe(WORKTREE);
    expect(result).toEqual({ branch: BRANCH, sha: 'abc123def456' });
  });

  it('push: keeps the credential out of the log', async () => {
    const events: ProviderLogEvent[] = [];
    const git = recorder([
      { code: 1, stdout: '', stderr: 'fatal: something broke' },
      { code: 0, stdout: '', stderr: '' },
    ]);
    const error = await capture(() =>
      providerWith(git.runner, (event) => events.push(event)).pushBranch({
        repo: REPO,
        worktree: WORKTREE,
        branch: BRANCH,
      }),
    );
    expect(error.code).toBe('provider_unavailable');
    expect(events.map((event) => event.message)).toEqual(['push failed']);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  });

  it('push: a non-fast-forward stderr maps to conflict', async () => {
    const git = recorder([
      { code: 1, stdout: '', stderr: '! [rejected] HEAD -> cb/run_1-x (non-fast-forward)' },
    ]);
    const error = await capture(() =>
      providerWith(git.runner).pushBranch({ repo: REPO, worktree: WORKTREE, branch: BRANCH }),
    );
    expect(error.code).toBe('conflict');
    expect(error.retryable).toBe(false);
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain('github.com');
    expect(error.message).not.toContain('x-access-token');
    expect(error.message).not.toContain('rejected');
  });

  it('push: a rejected stderr maps to conflict without the git text', async () => {
    const git = recorder([{ code: 128, stdout: '', stderr: 'error: rejected by remote' }]);
    const error = await capture(() =>
      providerWith(git.runner).pushBranch({ repo: REPO, worktree: WORKTREE, branch: BRANCH }),
    );
    expect(error.code).toBe('conflict');
    expect(error.message).not.toContain('remote');
  });

  it('push: any other git failure is a retryable provider_unavailable', async () => {
    const git = recorder([{ code: 1, stdout: '', stderr: 'fatal: unable to access the remote' }]);
    const error = await capture(() =>
      providerWith(git.runner).pushBranch({ repo: REPO, worktree: WORKTREE, branch: BRANCH }),
    );
    expect(error.code).toBe('provider_unavailable');
    expect(error.retryable).toBe(true);
    expect(error.status).toBeNull();
  });

  it('push: a failing rev-parse is provider_unavailable after the push', async () => {
    const git = recorder([
      { code: 0, stdout: '', stderr: '' },
      { code: 128, stdout: '', stderr: 'fatal: not a git repository' },
    ]);
    const error = await capture(() =>
      providerWith(git.runner).pushBranch({ repo: REPO, worktree: WORKTREE, branch: BRANCH }),
    );
    expect(error.code).toBe('provider_unavailable');
    expect(git.calls).toHaveLength(2);
  });

  it('push: an empty rev-parse answer is provider_unavailable', async () => {
    const git = recorder([
      { code: 0, stdout: '', stderr: '' },
      { code: 0, stdout: '   \n', stderr: '' },
    ]);
    const error = await capture(() =>
      providerWith(git.runner).pushBranch({ repo: REPO, worktree: WORKTREE, branch: BRANCH }),
    );
    expect(error.code).toBe('provider_unavailable');
  });

  it('push: a branch with whitespace is rejected before git runs', async () => {
    const git = recorder([]);
    const error = await capture(() =>
      providerWith(git.runner).pushBranch({ repo: REPO, worktree: WORKTREE, branch: 'bad branch' }),
    );
    expect(error.code).toBe('validation_failed');
    expect(git.calls).toHaveLength(0);
  });

  it('push: a slug that is not one owner/name is rejected before git runs', async () => {
    const git = recorder([]);
    const error = await capture(() =>
      providerWith(git.runner).pushBranch({
        repo: { ...REPO, slug: 'acme/web/extra' },
        worktree: WORKTREE,
        branch: BRANCH,
      }),
    );
    expect(error.code).toBe('validation_failed');
    expect(git.calls).toHaveLength(0);
  });
});

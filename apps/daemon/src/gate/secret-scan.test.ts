import { describe, expect, it } from 'vitest';
import { GIT_ENV } from '@codebox/workspaces';
import type { GitCommandInput, GitRunner } from '@codebox/workspaces';
import { MAX_SECRET_SCAN_BYTES, SecretScanError, scanWorktree } from './secret-scan.js';

const BASE_SHA = 'a'.repeat(40);
const SECRET = `ghp_${'B'.repeat(36)}`;

interface Calls {
  readonly calls: GitCommandInput[];
}

function runner(result: { code: number; stdout: string; stderr: string }): GitRunner & Calls {
  const calls: GitCommandInput[] = [];
  return {
    calls,
    run(input): Promise<{ code: number; stdout: string; stderr: string }> {
      calls.push(input);
      return Promise.resolve(result);
    },
  };
}

function patchWithSecret(): string {
  return [
    'diff --git a/src/x.ts b/src/x.ts',
    'index 1111111..2222222 100644',
    '--- a/src/x.ts',
    '+++ b/src/x.ts',
    '@@ -1,1 +1,2 @@',
    ' const a = 1;',
    `+const cred = '${SECRET}';`,
    '',
  ].join('\n');
}

const INPUT = { cwd: '/srv/codebox/worktrees/run_1', baseSha: BASE_SHA, timeoutMs: 30_000 };

describe('scanWorktree', () => {
  it('reads one diff against the recorded base, with the git allowlist environment', async () => {
    const git = runner({ code: 0, stdout: patchWithSecret(), stderr: '' });

    const outcome = await scanWorktree(git, INPUT);

    expect(git.calls).toEqual([
      {
        args: ['diff', '--no-color', '--unified=0', '--no-ext-diff', BASE_SHA, '--'],
        cwd: INPUT.cwd,
        timeoutMs: 30_000,
        env: GIT_ENV,
      },
    ]);
    expect(outcome.oversized).toBe(false);
    expect(outcome.findings).toEqual([{ path: 'src/x.ts', line: 2, pattern: 'github_token' }]);
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
  });

  it('fails closed when git cannot produce the diff', async () => {
    const git = runner({ code: 128, stdout: '', stderr: 'fatal: bad revision' });

    await expect(scanWorktree(git, INPUT)).rejects.toBeInstanceOf(SecretScanError);
    await expect(scanWorktree(git, INPUT)).rejects.toMatchObject({ code: 'git_failed' });
  });

  it('reports an oversized patch instead of scanning it', async () => {
    const git = runner({ code: 0, stdout: 'x'.repeat(MAX_SECRET_SCAN_BYTES + 1), stderr: '' });

    const outcome = await scanWorktree(git, INPUT);

    expect(outcome).toEqual({ findings: [], oversized: true });
    expect(MAX_SECRET_SCAN_BYTES).toBe(4_194_304);
  });

  it('finds nothing in a clean diff', async () => {
    const git = runner({ code: 0, stdout: 'diff --git a/a b/a\n', stderr: '' });

    expect(await scanWorktree(git, INPUT)).toEqual({ findings: [], oversized: false });
  });
});

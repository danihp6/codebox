import { GIT_ENV } from '@codebox/workspaces';
import type { GitRunner } from '@codebox/workspaces';

export interface CommitInput {
  readonly worktree: string;
  readonly subject: string;
  readonly body: string;
  readonly author: { readonly name: string; readonly email: string };
  readonly git: GitRunner;
  readonly timeoutMs: number;
}

export interface CommitResult {
  readonly sha: string;
  readonly created: boolean;
}

export const COMMIT_SUBJECT_MAX_CHARS = 72;

const NO_STAGED_CHANGES = 1;

function truncateSubject(subject: string): string {
  const trimmed = subject.trim();
  return trimmed.length > COMMIT_SUBJECT_MAX_CHARS
    ? trimmed.slice(0, COMMIT_SUBJECT_MAX_CHARS).trimEnd()
    : trimmed;
}

function oneLine(value: string): string {
  return value.replaceAll('\n', ' ').replaceAll('\r', ' ').trim();
}

function failed(step: string, code: number): Error {
  return new Error(`git ${step} failed (exit ${code})`);
}

/**
 * The body reaches git as its own `-m` paragraph: `GitRunner` has no stdin, and a paragraph is
 * exactly what a `Codebox-Run:` trailer is. The identity travels as `-c` arguments because the
 * runner's environment is fixed and must not carry a global git identity.
 */
export function commitWorktree(input: CommitInput): Promise<CommitResult> {
  const call = async (args: readonly string[]): Promise<{ code: number; stdout: string }> => {
    const result = await input.git.run({
      args,
      cwd: input.worktree,
      timeoutMs: input.timeoutMs,
      env: GIT_ENV,
    });
    return { code: result.code, stdout: result.stdout };
  };

  const head = async (): Promise<string> => {
    const result = await call(['rev-parse', 'HEAD']);
    if (result.code !== 0) throw failed('rev-parse', result.code);
    return result.stdout.trim();
  };

  return (async (): Promise<CommitResult> => {
    const added = await call(['add', '-A']);
    if (added.code !== 0) throw failed('add', added.code);

    const staged = await call(['diff', '--cached', '--quiet']);
    if (staged.code === 0) return { sha: await head(), created: false };
    if (staged.code !== NO_STAGED_CHANGES) throw failed('diff', staged.code);

    const commit = await call([
      '-c',
      `user.name=${oneLine(input.author.name)}`,
      '-c',
      `user.email=${oneLine(input.author.email)}`,
      'commit',
      '--no-verify',
      '-m',
      truncateSubject(input.subject),
      '-m',
      input.body,
    ]);
    if (commit.code !== 0) throw failed('commit', commit.code);

    return { sha: await head(), created: true };
  })();
}

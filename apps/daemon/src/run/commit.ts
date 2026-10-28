import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BacklogRef } from '@codebox/contracts';
import { applyTick } from '@codebox/backlog';
import type { TickOutcome } from '@codebox/backlog';
import { GIT_ENV } from '@codebox/workspaces';
import type { GitRunner } from '@codebox/workspaces';

export interface CommitInput {
  readonly worktree: string;
  readonly subject: string;
  readonly body: string;
  readonly author: { readonly name: string; readonly email: string };
  readonly git: GitRunner;
  readonly timeoutMs: number;
  /**
   * D51: the run's own commit flips exactly one checkbox of the item it came from. `null` (or
   * absent) leaves `TODO.md` alone; a `missing` or `ambiguous` tick writes nothing and never
   * fails the run.
   */
  readonly tick?: { readonly path: string; readonly ref: BacklogRef } | null;
}

export interface CommitResult {
  readonly sha: string;
  readonly created: boolean;
  /** The outcome of the tick this commit attempted, or `null` when no tick was asked for. */
  readonly tick: TickOutcome | null;
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
 * `applyTick` plus the one write it implies: the file is rewritten only when the outcome is
 * `ticked`, so every other byte stays as the agent left it. A worktree without the file is
 * `missing`, not an error.
 */
export async function tickWorktreeItem(input: {
  readonly worktree: string;
  readonly path: string;
  readonly ref: BacklogRef;
}): Promise<TickOutcome> {
  const file = join(input.worktree, input.path);
  let markdown: string;
  try {
    markdown = await readFile(file, 'utf8');
  } catch {
    return { kind: 'missing' };
  }
  const outcome = applyTick(markdown, input.ref);
  if (outcome.kind === 'ticked') await writeFile(file, outcome.markdown, 'utf8');
  return outcome;
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
    const outcome =
      input.tick == null
        ? null
        : await tickWorktreeItem({
            worktree: input.worktree,
            path: input.tick.path,
            ref: input.tick.ref,
          });

    const added = await call(['add', '-A']);
    if (added.code !== 0) throw failed('add', added.code);

    const staged = await call(['diff', '--cached', '--quiet']);
    if (staged.code === 0) return { sha: await head(), created: false, tick: outcome };
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

    return { sha: await head(), created: true, tick: outcome };
  })();
}

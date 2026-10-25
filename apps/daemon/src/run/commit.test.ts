import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GIT_ENV, createGitRunner } from '@codebox/workspaces';
import { commitWorktree } from './commit.js';

const AUTHOR = Object.freeze({ name: 'codebox[bot]', email: 'codebox@users.noreply.github.com' });
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cb-14-commit-'));
  roots.push(directory);
  execFileSync('git', ['init', '-b', 'main', '-q'], { cwd: directory, env: { ...GIT_ENV } });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], {
    cwd: directory,
    env: { ...GIT_ENV },
  });
  writeFileSync(join(directory, 'README.md'), '# fixture\n');
  return directory;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...GIT_ENV },
    encoding: 'utf8',
  });
}

describe('commitWorktree', () => {
  it('creates one commit whose body carries the run trailer', async () => {
    const worktree = repository();
    writeFileSync(join(worktree, 'feature.txt'), 'first change\n');
    const result = await commitWorktree({
      worktree,
      subject: 'Add the feature flag',
      body: 'Codebox-Run: run_commit0001',
      author: AUTHOR,
      git: createGitRunner(),
      timeoutMs: 30_000,
    });

    expect(result.created).toBe(true);
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(worktree, ['rev-parse', 'HEAD']).trim()).toBe(result.sha);
    expect(git(worktree, ['rev-list', '--count', 'HEAD']).trim()).toBe('1');
    expect(git(worktree, ['show', '-s', '--format=%s', 'HEAD']).trim()).toBe(
      'Add the feature flag',
    );
    expect(git(worktree, ['show', '-s', '--format=%B', 'HEAD'])).toContain(
      'Codebox-Run: run_commit0001',
    );
    expect(git(worktree, ['show', '-s', '--format=%an <%ae>', 'HEAD']).trim()).toBe(
      `${AUTHOR.name} <${AUTHOR.email}>`,
    );
    expect(git(worktree, ['show', '-s', '--format=%cn <%ce>', 'HEAD']).trim()).toBe(
      `${AUTHOR.name} <${AUTHOR.email}>`,
    );
    expect(git(worktree, ['status', '--porcelain'])).toBe('');
  });

  it('does not commit an unchanged worktree twice', async () => {
    const worktree = repository();
    writeFileSync(join(worktree, 'feature.txt'), 'only change\n');
    const first = await commitWorktree({
      worktree,
      subject: 'Add the feature flag',
      body: 'Codebox-Run: run_commit0002',
      author: AUTHOR,
      git: createGitRunner(),
      timeoutMs: 30_000,
    });
    const second = await commitWorktree({
      worktree,
      subject: 'Add the feature flag',
      body: 'Codebox-Run: run_commit0002',
      author: AUTHOR,
      git: createGitRunner(),
      timeoutMs: 30_000,
    });
    expect(second.created).toBe(false);
    expect(second.sha).toBe(first.sha);
    expect(git(worktree, ['rev-list', '--count', 'HEAD']).trim()).toBe('1');
  });

  it('trims the subject to seventy-two characters', async () => {
    const worktree = repository();
    writeFileSync(join(worktree, 'long.txt'), 'long\n');
    const subject = `${'A'.repeat(90)}`;
    await commitWorktree({
      worktree,
      subject,
      body: 'Codebox-Run: run_commit0003',
      author: AUTHOR,
      git: createGitRunner(),
      timeoutMs: 30_000,
    });
    expect(git(worktree, ['show', '-s', '--format=%s', 'HEAD']).trim()).toHaveLength(72);
  });

  it('never runs a commit when the runner reports a clean index', async () => {
    const calls: string[][] = [];
    const results: Record<string, { code: number; stdout: string; stderr: string }> = {
      'add -A': { code: 0, stdout: '', stderr: '' },
      'diff --cached --quiet': { code: 0, stdout: '', stderr: '' },
      'rev-parse HEAD': { code: 0, stdout: 'a'.repeat(40), stderr: '' },
    };
    const result = await commitWorktree({
      worktree: '/fixture/worktree',
      subject: 'Nothing to do',
      body: 'Codebox-Run: run_commit0004',
      author: AUTHOR,
      git: {
        run: (input) => {
          calls.push([...input.args]);
          const key = input.args.join(' ');
          const matched = results[key];
          if (matched === undefined) throw new Error(`unexpected git call: ${key}`);
          return Promise.resolve(matched);
        },
      },
      timeoutMs: 1_000,
    });
    expect(result).toEqual({ sha: 'a'.repeat(40), created: false });
    expect(calls.some((args) => args.includes('commit'))).toBe(false);
  });
});

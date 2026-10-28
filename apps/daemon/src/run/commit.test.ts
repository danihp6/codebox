import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(result).toEqual({ sha: 'a'.repeat(40), created: false, tick: null });
    expect(calls.some((args) => args.includes('commit'))).toBe(false);
  });
});

function backlogRepository(markdown: string): string {
  const directory = repository();
  writeFileSync(join(directory, 'TODO.md'), markdown, 'utf8');
  git(directory, ['add', '--all']);
  git(directory, [
    '-c',
    `user.name=${AUTHOR.name}`,
    '-c',
    `user.email=${AUTHOR.email}`,
    'commit',
    '--no-verify',
    '-m',
    'Add the backlog',
  ]);
  return directory;
}

const BACKLOG = `# Backlog

## Batch 1 — Alpha

- [ ] **[Task-01]** First item.
- [ ] **[Task-02]** Second item.
`;

describe('commitWorktree with a backlog tick', () => {
  it('flips exactly one line of TODO.md in the run commit (D51)', async () => {
    const worktree = backlogRepository(BACKLOG);
    writeFileSync(join(worktree, 'feature.txt'), 'the agent change\n');
    const result = await commitWorktree({
      worktree,
      subject: 'First item',
      body: 'Codebox-Run: run_commit0005',
      author: AUTHOR,
      git: createGitRunner(),
      timeoutMs: 30_000,
      tick: { path: 'TODO.md', ref: 'Task-01' },
    });

    expect(result.created).toBe(true);
    expect(result.tick).toMatchObject({ kind: 'ticked' });
    const diff = git(worktree, ['diff', 'HEAD~1', 'HEAD', '--', 'TODO.md']);
    const changed = diff
      .split('\n')
      .filter(
        (line) =>
          (line.startsWith('-') || line.startsWith('+')) &&
          !line.startsWith('---') &&
          !line.startsWith('+++'),
      );
    // A removed backlog line is `-- [ ] …` in the patch: the marker is the first character.
    expect(changed.map((line) => line.slice(1))).toEqual([
      '- [ ] **[Task-01]** First item.',
      '- [x] **[Task-01]** First item.',
    ]);
  });

  it('leaves the file byte-identical and commits nothing for an ambiguous ref', async () => {
    const markdown = `${BACKLOG}- [ ] **[Task-01]** Duplicated.\n`;
    const worktree = backlogRepository(markdown);
    const result = await commitWorktree({
      worktree,
      subject: 'Ambiguous item',
      body: 'Codebox-Run: run_commit0006',
      author: AUTHOR,
      git: createGitRunner(),
      timeoutMs: 30_000,
      tick: { path: 'TODO.md', ref: 'Task-01' },
    });

    expect(result.tick).toEqual({ kind: 'ambiguous', lines: [5, 7] });
    expect(result.created).toBe(false);
    expect(readFileSync(join(worktree, 'TODO.md'), 'utf8')).toBe(markdown);
    expect(git(worktree, ['rev-list', '--count', 'HEAD']).trim()).toBe('1');
  });

  it('reports a worktree without TODO.md as missing and commits nothing', async () => {
    const worktree = backlogRepository(BACKLOG);
    rmSync(join(worktree, 'TODO.md'));
    git(worktree, ['add', '--all']);
    git(worktree, [
      '-c',
      `user.name=${AUTHOR.name}`,
      '-c',
      `user.email=${AUTHOR.email}`,
      'commit',
      '--no-verify',
      '-m',
      'Drop the backlog',
    ]);
    const result = await commitWorktree({
      worktree,
      subject: 'No backlog',
      body: 'Codebox-Run: run_commit0007',
      author: AUTHOR,
      git: createGitRunner(),
      timeoutMs: 30_000,
      tick: { path: 'TODO.md', ref: 'Task-01' },
    });
    expect(result.tick).toEqual({ kind: 'missing' });
    expect(result.created).toBe(false);
    expect(existsSync(join(worktree, 'TODO.md'))).toBe(false);
  });
});

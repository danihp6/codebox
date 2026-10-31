import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { matchesGlob } from '@codebox/core';
import { clonePath, createGitRunner, createWorkspaceManager } from '@codebox/workspaces';
import { FIXED_NOW, fixedDate } from './clock.mjs';

/** The one item the fixture backlog carries; the run ticks this exact checkbox. */
export const FIXTURE_SLUG = 'acme/widgets';
export const FIXTURE_BRANCH = 'main';
export const FIXTURE_REF = 'Task-01';

const TODO_MARKDOWN = `# TODO

## Batch 0 — fixture

- [ ] **[Task-01]** Add the e2e change marker. *Paths:* \`e2e-change.txt\`.
      *Dependencies:* none.
`;

const SEED_AUTHOR = 'e2e <e2e@example.invalid>';
const SEED_MESSAGE = 'seed the e2e backlog';
const GIT_TIMEOUT_MS = 60_000;

function gitEnv() {
  return {
    PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env['HOME'] ?? '/tmp',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
  };
}

function git(cwd, args, extraEnv = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    env: { ...gitEnv(), ...extraEnv },
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * A work tree with the fixture `TODO.md`, committed once on `defaultBranch` with the fixed
 * date, cloned bare into `<root>/remote/<slug>.git`.
 *
 * @param {{ root: string; slug: string; defaultBranch: string }} input
 * @returns {Promise<{ remote: string; commit: string }>}
 */
export async function createSeedRepo(input) {
  const { root, slug, defaultBranch } = input;
  const work = join(root, 'work', slug);
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'TODO.md'), TODO_MARKDOWN, 'utf8');
  git(work, ['init', '-q', '-b', defaultBranch]);
  git(work, ['add', '-A']);
  git(
    work,
    [
      '-c',
      'user.name=e2e',
      '-c',
      'user.email=e2e@example.invalid',
      'commit',
      '--no-verify',
      '-q',
      '-m',
      SEED_MESSAGE,
    ],
    { GIT_AUTHOR_DATE: FIXED_NOW, GIT_COMMITTER_DATE: FIXED_NOW },
  );
  const commit = git(work, ['rev-parse', 'HEAD']).trim();
  const remote = join(root, 'remote', `${slug}.git`);
  mkdirSync(dirname(remote), { recursive: true });
  git(root, ['clone', '--bare', '-q', work, remote]);
  return { remote, commit };
}

function defaultBranchOf(remote) {
  return git(remote, ['--git-dir', remote, 'symbolic-ref', '--short', 'HEAD']).trim();
}

/**
 * The bare clone cache the daemon expects at `clonePath(repoRoot, slug)`, cut from the local
 * seed remote, plus the two `url.<base>.insteadOf` pairs that turn the daemon's GitHub push
 * URL back into this loopback file remote. Git reads the shared repository config from a
 * linked worktree, so `pushBranch` never opens a socket.
 *
 * @param {{ repoRoot: string; slug: string; remote: string; pushUrl: string }} input
 * @returns {Promise<string>} the cache path
 */
export async function seedCloneCache(input) {
  const { repoRoot, slug, remote, pushUrl } = input;
  const workspaceRoot = join(dirname(resolve(repoRoot)), 'workspaces');
  const manager = createWorkspaceManager({
    repoRoot: resolve(repoRoot),
    workspaceRoot,
    git: createGitRunner(),
    matchesGlob,
    cloneDepth: 0,
    httpTimeoutSeconds: 60,
    now: fixedDate,
  });
  const seed = resolve(remote);
  await manager.ensureClone({
    slug,
    defaultBranch: defaultBranchOf(seed),
    cloneUrl: `file://${seed}`,
  });
  const cache = clonePath(repoRoot, slug);
  const base = `file://${seed}`;
  for (const value of [`https://github.com/${slug}.git`, pushUrl]) {
    git(dirname(cache), ['--git-dir', cache, 'config', '--add', `url.${base}.insteadOf`, value]);
  }
  return cache;
}

/**
 * The same `git` the fixture uses, exported so the harness and its tests read the seed remote
 * with one runner instead of three.
 *
 * @param {string} cwd
 * @param {readonly string[]} args
 * @returns {string}
 */
export function fixtureGit(cwd, args) {
  return git(cwd, [...args]);
}

export { SEED_AUTHOR };

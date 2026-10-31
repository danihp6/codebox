import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXED_NOW } from '../harness/clock.mjs';
import {
  FIXTURE_BRANCH,
  FIXTURE_SLUG,
  SEED_AUTHOR,
  createSeedRepo,
  fixtureGit,
  seedCloneCache,
} from '../harness/git-fixture.mjs';

const PUSH_URL = 'https://x-access-token:e2e-token@github.com/acme/widgets.git';
const FILE_BODY = 'written by the e2e agent\n';

/** The daemon pushes with an empty environment; the rewrite must be in the cache config. */
function pushWithEmptyEnv(cwd) {
  const result = spawnSync('git', ['-C', cwd, 'push', PUSH_URL, 'HEAD:refs/heads/probe'], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {},
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status ?? 1, stderr: result.stderr };
}

test('a push from a cache worktree lands in the seed remote with no network', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cb-e2e-git-'));
  try {
    const seed = await createSeedRepo({
      root,
      slug: FIXTURE_SLUG,
      defaultBranch: FIXTURE_BRANCH,
    });
    assert.equal(
      fixtureGit(seed.remote, ['--git-dir', seed.remote, 'log', '-1', '--format=%ct']).trim(),
      String(Date.parse(FIXED_NOW) / 1000),
      'the seed commit did not use FIXED_NOW',
    );
    assert.equal(
      fixtureGit(seed.remote, ['--git-dir', seed.remote, 'log', '-1', '--format=%an <%ae>']).trim(),
      SEED_AUTHOR,
    );

    const repoRoot = join(root, 'repos');
    mkdirSync(repoRoot, { recursive: true });
    const cache = await seedCloneCache({
      repoRoot,
      slug: FIXTURE_SLUG,
      remote: seed.remote,
      pushUrl: PUSH_URL,
    });
    assert.equal(cache, join(repoRoot, 'acme__widgets.git'), 'clonePath changed its layout');
    const rewrites = fixtureGit(cache, ['--git-dir', cache, 'config', '--get-regexp', 'url\\.']);
    assert.match(rewrites, new RegExp(`insteadof ${PUSH_URL.replaceAll('.', '\\.')}`));

    const workspaceRoot = join(root, 'workspaces');
    mkdirSync(workspaceRoot, { recursive: true });
    const worktree = join(workspaceRoot, 'probe');
    fixtureGit(cache, ['worktree', 'add', '-b', 'probe', worktree, FIXTURE_BRANCH]);
    writeFileSync(join(worktree, 'e2e-change.txt'), FILE_BODY, 'utf8');
    fixtureGit(worktree, ['add', '-A']);
    fixtureGit(worktree, [
      '-c',
      'user.name=e2e',
      '-c',
      'user.email=e2e@example.invalid',
      'commit',
      '--no-verify',
      '-q',
      '-m',
      'the probe change',
    ]);

    const push = pushWithEmptyEnv(worktree);
    assert.equal(push.status, 0, push.stderr);

    const exists = fixtureGit(seed.remote, [
      '--git-dir',
      seed.remote,
      'show-ref',
      '--verify',
      'refs/heads/probe',
    ]);
    assert.match(exists.trim(), /^[0-9a-f]{40} refs\/heads\/probe$/);
    assert.equal(
      fixtureGit(seed.remote, ['--git-dir', seed.remote, 'show', 'probe:e2e-change.txt']),
      FILE_BODY,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

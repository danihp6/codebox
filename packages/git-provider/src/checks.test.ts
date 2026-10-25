import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evaluateAutoMerge } from '../../core/src/index.js';
import type { MergeFacts } from '../../core/src/index.js';
import { createGitHubProvider } from './github.js';
import { startFakeGitHub, FAKE_GITHUB_NOW_MS } from './fake.js';
import type { FakeGitHub } from './fake.js';
import type {
  CheckConclusion,
  FetchLike,
  GitHubProviderOptions,
  GitProvider,
  RepoInfo,
} from './types.js';

const OWNER = 'acme';
const REPO = 'web';
const SLUG = `${OWNER}/${REPO}`;
const TOKEN = 'ghs_checks_test_value';
const SHA = '1'.repeat(40);

const REPO_INFO: RepoInfo = {
  slug: SLUG,
  defaultBranch: 'main',
  private: true,
  canPush: true,
};

const httpFetch: FetchLike = (url, init) => fetch(url, init);

function options(subject: FakeGitHub): GitHubProviderOptions {
  return {
    auth: { kind: 'pat', token: TOKEN },
    apiBase: subject.url,
    gitHost: 'github.com',
    fetch: httpFetch,
    git: { run: async () => ({ code: 0, stdout: SHA, stderr: '' }) },
    now: () => FAKE_GITHUB_NOW_MS,
    requestTimeoutMs: 5_000,
    log: () => undefined,
    userAgent: 'codebox/test',
  };
}

function greenFacts(
  checks: readonly { readonly name: string; readonly conclusion: CheckConclusion }[],
): MergeFacts {
  return {
    gate: { status: 'passed', exitCode: 0 },
    checks,
    pullRequest: { mergeable: true, conflicting: false, labels: ['cb:auto-merge'] },
    base: { recordedSha: SHA, currentSha: SHA },
    diff: { files: 6, added: 184, removed: 22 },
    changedPaths: ['packages/git-provider/src/github.ts'],
    policy: {
      repo: 'auto',
      job: 'auto',
      automerge: 'on',
      probationRuns: 0,
      consecutiveGreenRuns: 0,
    },
    budget: { maxFiles: 40, maxLines: 2_000 },
    protectedPaths: ['ops/**'],
  };
}

let fake: FakeGitHub;
let provider: GitProvider;

beforeEach(async () => {
  fake = await startFakeGitHub({
    token: TOKEN,
    owner: OWNER,
    repo: REPO,
    defaultBranch: 'main',
  });
  provider = createGitHubProvider(options(fake));
});

afterEach(async () => {
  await fake.close();
});

async function summary(): Promise<{
  readonly state: 'success' | 'failure' | 'pending';
  readonly checks: readonly { readonly name: string; readonly conclusion: CheckConclusion }[];
}> {
  return provider.getChecks({ repo: REPO_INFO, number: 1, headSha: SHA, baseRef: 'main' });
}

describe('checks', () => {
  it('checks: a red required check becomes checks_red in the guardrails', async () => {
    fake.setRequiredChecks(['build']);
    fake.setChecks(SHA, [
      { name: 'build', conclusion: 'failure', status: 'completed' },
      { name: 'lint', conclusion: 'success', status: 'completed' },
    ]);
    const result = await summary();
    expect(result.state).toBe('failure');
    expect(result.checks).toEqual([
      { name: 'build', conclusion: 'failure', required: true },
      { name: 'lint', conclusion: 'success', required: false },
    ]);
    const evaluation = evaluateAutoMerge(
      greenFacts(
        result.checks.map((check) => ({ name: check.name, conclusion: check.conclusion })),
      ),
    );
    expect(evaluation.merge).toBe(false);
    expect(evaluation.blockers).toHaveLength(1);
    expect(evaluation.blockers[0]?.code).toBe('checks_red');
  });

  it('checks: a green required check list passes the gate', async () => {
    fake.setRequiredChecks(['lint']);
    fake.setChecks(SHA, [
      { name: 'build', conclusion: 'failure', status: 'completed' },
      { name: 'lint', conclusion: 'success', status: 'completed' },
    ]);
    const result = await summary();
    expect(result.state).toBe('success');
    const evaluation = evaluateAutoMerge(
      greenFacts(
        result.checks
          .filter((check) => check.required)
          .map((check) => ({ name: check.name, conclusion: check.conclusion })),
      ),
    );
    expect(evaluation.merge).toBe(true);
    expect(evaluation.blockers).toEqual([]);
  });

  it('checks: an unreadable protection list makes every check required', async () => {
    fake.setRequiredChecks(null);
    fake.setChecks(SHA, [
      { name: 'build', conclusion: 'failure', status: 'completed' },
      { name: 'lint', conclusion: 'success', status: 'completed' },
    ]);
    const result = await summary();
    expect(result.state).toBe('failure');
    expect(result.checks.every((check) => check.required)).toBe(true);
    const evaluation = evaluateAutoMerge(
      greenFacts(
        result.checks.map((check) => ({ name: check.name, conclusion: check.conclusion })),
      ),
    );
    expect(evaluation.blockers[0]?.code).toBe('checks_red');
  });

  it('checks: a pending required check keeps the summary pending', async () => {
    fake.setRequiredChecks(['build']);
    fake.setChecks(SHA, [
      { name: 'build', conclusion: 'success', status: 'in_progress' },
      { name: 'lint', conclusion: 'success', status: 'completed' },
    ]);
    const result = await summary();
    expect(result.state).toBe('pending');
    expect(result.checks[0]?.conclusion).toBe('pending');
  });

  it('checks: a completed run without a conclusion is pending', async () => {
    const stub: FetchLike = async (url) => {
      if (url.includes('/check-runs')) {
        return new Response(
          JSON.stringify({
            total_count: 1,
            check_runs: [{ name: 'build', status: 'completed', conclusion: null }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ contexts: ['build'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const stubProvider = createGitHubProvider({ ...options(fake), fetch: stub });
    const result = await stubProvider.getChecks({
      repo: REPO_INFO,
      number: 1,
      headSha: SHA,
      baseRef: 'main',
    });
    expect(result.state).toBe('pending');
  });

  it('checks: a cancelled required check is a failure', async () => {
    fake.setRequiredChecks(['build']);
    fake.setChecks(SHA, [{ name: 'build', conclusion: 'cancelled', status: 'completed' }]);
    const result = await summary();
    expect(result.state).toBe('failure');
    expect(result.checks[0]?.conclusion).toBe('cancelled');
  });

  it('checks: a skipped required check is not a failure', async () => {
    fake.setRequiredChecks(['build']);
    fake.setChecks(SHA, [
      { name: 'build', conclusion: 'skipped', status: 'completed' },
      { name: 'lint', conclusion: 'neutral', status: 'completed' },
    ]);
    const result = await summary();
    expect(result.state).toBe('success');
  });

  it('checks: an unknown conclusion is treated as a failure', async () => {
    fake.setRequiredChecks(['build']);
    fake.setChecks(SHA, [{ name: 'build', conclusion: 'stale', status: 'completed' }]);
    const result = await summary();
    expect(result.state).toBe('failure');
    expect(result.checks[0]?.conclusion).toBe('failure');
  });

  it('checks: no check runs on the sha is a success with an empty list', async () => {
    fake.setRequiredChecks(['build']);
    const result = await summary();
    expect(result).toEqual({ state: 'success', checks: [] });
  });
});

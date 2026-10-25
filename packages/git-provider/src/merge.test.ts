import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGitHubProvider } from './github.js';
import { startFakeGitHub, FAKE_GITHUB_NOW_MS } from './fake.js';
import type { FakeGitHub } from './fake.js';
import type {
  FetchLike,
  GitHubProviderOptions,
  GitProvider,
  MergePullRequestInput,
  ProviderLogEvent,
  PullRequest,
  RepoInfo,
} from './types.js';

const OWNER = 'acme';
const REPO = 'web';
const SLUG = `${OWNER}/${REPO}`;
const TOKEN = 'ghs_merge_test_value';
const HEAD = 'cb/run_1-x';

const REPO_INFO: RepoInfo = {
  slug: SLUG,
  defaultBranch: 'main',
  private: true,
  canPush: true,
};

const httpFetch: FetchLike = (url, init) => fetch(url, init);

function options(
  subject: FakeGitHub,
  overrides: Partial<GitHubProviderOptions> = {},
): GitHubProviderOptions {
  return {
    auth: { kind: 'pat', token: TOKEN },
    apiBase: subject.url,
    gitHost: 'github.com',
    fetch: httpFetch,
    git: { run: async () => ({ code: 0, stdout: 'a'.repeat(40), stderr: '' }) },
    now: () => FAKE_GITHUB_NOW_MS,
    requestTimeoutMs: 5_000,
    log: () => undefined,
    userAgent: 'codebox/test',
    ...overrides,
  };
}

let fake: FakeGitHub;
let provider: GitProvider;
let events: ProviderLogEvent[];
let pullRequest: PullRequest;

beforeEach(async () => {
  fake = await startFakeGitHub({
    token: TOKEN,
    owner: OWNER,
    repo: REPO,
    defaultBranch: 'main',
  });
  events = [];
  provider = createGitHubProvider(options(fake, { log: (event) => events.push(event) }));
  pullRequest = await provider.openPullRequest({
    repo: REPO_INFO,
    head: HEAD,
    base: 'main',
    title: 'Add the widget',
    body: 'Run: run_01J',
    draft: false,
    labels: ['cb:auto-merge'],
  });
});

afterEach(async () => {
  await fake.close();
});

function mergeInput(overrides: Partial<MergePullRequestInput> = {}): MergePullRequestInput {
  return {
    repo: REPO_INFO,
    number: pullRequest.number,
    method: 'squash',
    commitTitle: 'Add the widget (#1)',
    commitMessage: 'Codebox-Run: run_01J',
    sha: pullRequest.headSha,
    ...overrides,
  };
}

function mergePath(number: number): string {
  return `/repos/${SLUG}/pulls/${number}/merge`;
}

describe('merge', () => {
  it('merge: a 200 with merged true reports the merge sha', async () => {
    const result = await provider.mergePullRequest(mergeInput());
    expect(result).toEqual({
      merged: true,
      sha: expect.stringMatching(/^[0-9a-f]{40}$/),
      method: 'squash',
      reason: 'merged',
      retryable: false,
    });
    const sent = fake.requests.find(
      (request) => request.method === 'PUT' && request.path === mergePath(pullRequest.number),
    );
    expect(sent?.body).toMatchObject({
      merge_method: 'squash',
      commit_title: 'Add the widget (#1)',
      commit_message: 'Codebox-Run: run_01J',
      sha: pullRequest.headSha,
    });
  });

  it('merge: a 200 with merged false is a retryable not_mergeable', async () => {
    fake.setMergeable(pullRequest.number, false);
    const result = await provider.mergePullRequest(mergeInput());
    expect(result).toEqual({
      merged: false,
      sha: null,
      method: 'squash',
      reason: 'not_mergeable',
      retryable: true,
    });
    expect(events.at(-1)?.message).toBe('merge rejected');
    expect(events.at(-1)?.status).toBe(200);
  });

  it('merge: 405 is not_mergeable and retryable', async () => {
    fake.failNext('PUT', mergePath(pullRequest.number), 405);
    const result = await provider.mergePullRequest(mergeInput());
    expect(result).toMatchObject({ merged: false, reason: 'not_mergeable', retryable: true });
  });

  it('merge: 409 is head_moved and retryable', async () => {
    fake.failNext('PUT', mergePath(pullRequest.number), 409);
    const result = await provider.mergePullRequest(mergeInput());
    expect(result).toMatchObject({ merged: false, reason: 'head_moved', retryable: true });
    expect(events.at(-1)?.status).toBe(409);
  });

  it('merge: 422 is method_not_allowed and not retryable', async () => {
    fake.failNext('PUT', mergePath(pullRequest.number), 422);
    const result = await provider.mergePullRequest(mergeInput());
    expect(result).toMatchObject({
      merged: false,
      reason: 'method_not_allowed',
      retryable: false,
    });
  });

  it('merge: 403 is not_mergeable and not retryable', async () => {
    fake.failNext('PUT', mergePath(pullRequest.number), 403);
    const result = await provider.mergePullRequest(mergeInput());
    expect(result).toMatchObject({ merged: false, reason: 'not_mergeable', retryable: false });
  });

  it('merge: an unmapped status still becomes a typed provider error', async () => {
    fake.failNext('PUT', mergePath(pullRequest.number), 502);
    await expect(provider.mergePullRequest(mergeInput())).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    });
  });

  it('merge: closePullRequest swallows 404 and 422', async () => {
    const path = `/repos/${SLUG}/pulls/${pullRequest.number}`;
    fake.failNext('PATCH', path, 404);
    await expect(
      provider.closePullRequest({ repo: REPO_INFO, number: pullRequest.number }),
    ).resolves.toBeUndefined();
    fake.failNext('PATCH', path, 422);
    await expect(
      provider.closePullRequest({ repo: REPO_INFO, number: pullRequest.number }),
    ).resolves.toBeUndefined();
  });

  it('merge: closePullRequest closes the pull request', async () => {
    await provider.closePullRequest({ repo: REPO_INFO, number: pullRequest.number });
    const closed = await provider.getPullRequest({ repo: REPO_INFO, number: pullRequest.number });
    expect(closed.state).toBe('closed');
  });

  it('merge: deleteBranch swallows 404 and 422', async () => {
    const path = `/repos/${SLUG}/git/refs/heads/${HEAD}`;
    fake.failNext('DELETE', path, 404);
    await expect(provider.deleteBranch({ repo: REPO_INFO, branch: HEAD })).resolves.toBeUndefined();
    fake.failNext('DELETE', path, 422);
    await expect(provider.deleteBranch({ repo: REPO_INFO, branch: HEAD })).resolves.toBeUndefined();
  });

  it('merge: deleteBranch deletes the ref and tolerates an already gone branch', async () => {
    await expect(provider.deleteBranch({ repo: REPO_INFO, branch: HEAD })).resolves.toBeUndefined();
    const deletes = fake.requests.filter((request) => request.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.path).toBe(`/repos/${SLUG}/git/refs/heads/${HEAD}`);
  });

  it('merge: an unexpected merge body is validation_failed, never trusted', async () => {
    const stub: FetchLike = async () =>
      new Response(JSON.stringify({ merged: 'yes' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const direct = createGitHubProvider(options(fake, { fetch: stub }));
    await expect(direct.mergePullRequest(mergeInput())).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});

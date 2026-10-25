import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGitHubProvider } from './github.js';
import { startFakeGitHub, FAKE_GITHUB_NOW_MS } from './fake.js';
import type { FakeGitHub } from './fake.js';
import type {
  FetchLike,
  GitHubProviderOptions,
  GitProvider,
  OpenPullRequestInput,
  RepoInfo,
} from './types.js';

const OWNER = 'acme';
const REPO = 'web';
const SLUG = `${OWNER}/${REPO}`;
const TOKEN = 'ghs_pull_request_test_value';
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

function openInput(overrides: Partial<OpenPullRequestInput> = {}): OpenPullRequestInput {
  return {
    repo: REPO_INFO,
    head: HEAD,
    base: 'main',
    title: 'Add the widget',
    body: 'Run: run_01J',
    draft: false,
    labels: [],
    ...overrides,
  };
}

function pullPaths(subject: FakeGitHub, method: string): readonly string[] {
  return subject.requests
    .filter((request) => request.method === method && request.path === `/repos/${SLUG}/pulls`)
    .map((request) => request.path);
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

describe('pull requests', () => {
  it('openPullRequest opens a normal PR when none exists for the branch', async () => {
    const created = await provider.openPullRequest(
      openInput({ title: 'First title', draft: true, labels: ['cb:gate-failed'] }),
    );
    expect(created.created).toBe(true);
    expect(created.number).toBe(1);
    expect(created.state).toBe('open');
    expect(created.draft).toBe(true);
    expect(created.url).toMatch(/^https:\/\//);
    expect(created.labels).toEqual(['cb:gate-failed']);
    expect(pullPaths(fake, 'POST')).toHaveLength(1);
    const createdBody = fake.requests.find((request) => request.method === 'POST')?.body;
    expect(createdBody).toMatchObject({
      title: 'First title',
      head: HEAD,
      base: 'main',
      draft: true,
    });
  });

  it('openPullRequest looks the branch up with head, state and per_page', async () => {
    await provider.openPullRequest(openInput());
    const listed = fake.requests.find(
      (request) => request.method === 'GET' && request.path.startsWith(`/repos/${SLUG}/pulls?`),
    );
    expect(listed?.path).toBe(`/repos/${SLUG}/pulls?head=${OWNER}:${HEAD}&state=open&per_page=1`);
  });

  it('openPullRequest is idempotent by branch: the second call patches the same PR', async () => {
    const first = await provider.openPullRequest(openInput({ title: 'First title' }));
    const second = await provider.openPullRequest(openInput({ title: 'Second title' }));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.number).toBe(first.number);
    expect(pullPaths(fake, 'POST')).toHaveLength(1);
    const patches = fake.requests.filter(
      (request) => request.method === 'PATCH' && request.path === `/repos/${SLUG}/pulls/1`,
    );
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toMatchObject({ title: 'Second title' });
  });

  it('openPullRequest never sends draft on the update path', async () => {
    await provider.openPullRequest(openInput({ draft: true }));
    await provider.openPullRequest(openInput({ draft: false }));
    const patch = fake.requests.find((request) => request.method === 'PATCH');
    expect(patch?.body).toEqual({ title: 'Add the widget', body: 'Run: run_01J' });
  });

  it('openPullRequest posts labels to the issue endpoint once', async () => {
    const created = await provider.openPullRequest(
      openInput({ labels: ['cb:auto-merge', 'cb:needs-review'] }),
    );
    const labelCalls = fake.requests.filter(
      (request) =>
        request.method === 'POST' &&
        request.path === `/repos/${SLUG}/issues/${created.number}/labels`,
    );
    expect(labelCalls).toHaveLength(1);
    expect(labelCalls[0]?.body).toEqual({ labels: ['cb:auto-merge', 'cb:needs-review'] });
    expect(created.labels).toEqual(['cb:auto-merge', 'cb:needs-review']);
  });

  it('openPullRequest skips the label endpoint when no labels are requested', async () => {
    await provider.openPullRequest(openInput({ labels: [] }));
    const labelCalls = fake.requests.filter((request) => request.path.includes('/labels'));
    expect(labelCalls).toHaveLength(0);
  });

  it('openPullRequest keeps existing labels when it labels an update', async () => {
    await provider.openPullRequest(openInput({ labels: ['cb:auto-merge'] }));
    const updated = await provider.openPullRequest(
      openInput({ title: 'Second title', labels: ['cb:needs-review'] }),
    );
    expect(updated.labels).toEqual(['cb:auto-merge', 'cb:needs-review']);
  });

  it('getPullRequest reads the same shape with created false', async () => {
    const created = await provider.openPullRequest(openInput());
    const fetched = await provider.getPullRequest({ repo: REPO_INFO, number: created.number });
    expect(fetched).toEqual({ ...created, created: false });
  });

  it('getPullRequest maps a null mergeable to false', async () => {
    const stub: FetchLike = async () =>
      new Response(
        JSON.stringify({
          number: 7,
          html_url: 'https://github.com/acme/web/pull/7',
          state: 'open',
          mergeable: null,
          draft: false,
          head: { ref: HEAD, sha: 'a'.repeat(40) },
          base: { ref: 'main', sha: 'b'.repeat(40) },
          labels: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const direct = createGitHubProvider(options(fake, { fetch: stub }));
    const pullRequest = await direct.getPullRequest({ repo: REPO_INFO, number: 7 });
    expect(pullRequest.mergeable).toBe(false);
    expect(pullRequest.number).toBe(7);
  });

  it('getPullRequest rejects an unexpected body with validation_failed', async () => {
    const stub: FetchLike = async () =>
      new Response(JSON.stringify({ number: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const direct = createGitHubProvider(options(fake, { fetch: stub }));
    await expect(direct.getPullRequest({ repo: REPO_INFO, number: 7 })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});

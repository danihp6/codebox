import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ErrorCode } from '@codebox/contracts';
import { createGitHubProvider } from './github.js';
import { GitProviderError, toContractErrorCode } from './errors.js';
import type { GitProviderErrorCode } from './errors.js';
import { startFakeGitHub, FAKE_GITHUB_NOW_MS } from './fake.js';
import type { FakeGitHub } from './fake.js';
import type { FetchLike, GitHubProviderOptions, GitProvider, ProviderLogEvent } from './types.js';

const OWNER = 'acme';
const REPO = 'web';
const SLUG = `${OWNER}/${REPO}`;
const TOKEN = 'ghs_provider_test_value';
const USER_AGENT = 'codebox/test';

const CLOSED_MESSAGES: ReadonlySet<string> = new Set([
  'github request failed',
  'github rate limited',
  'token refreshed',
  'token mint failed',
  'push failed',
  'pull request updated',
  'pull request opened',
  'merge rejected',
]);

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

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
    userAgent: USER_AGENT,
    ...overrides,
  };
}

function appOptions(
  subject: FakeGitHub,
  overrides: Partial<GitHubProviderOptions> = {},
): GitHubProviderOptions {
  return options(subject, {
    auth: {
      kind: 'app',
      appId: '123456',
      installationId: '42',
      privateKeyPem: PRIVATE_PEM,
    },
    ...overrides,
  });
}

async function capture(run: () => Promise<unknown>): Promise<GitProviderError> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(GitProviderError);
  return caught as GitProviderError;
}

function expectSafeMessage(error: GitProviderError): void {
  expect(error.message).not.toContain('message');
  expect(error.message).not.toContain('{');
  expect(error.message).not.toContain('token');
  expect(error.message).not.toContain('github.com/');
  expect(error.message).not.toContain(TOKEN);
}

function repoRequests(subject: FakeGitHub): number {
  return subject.requests.filter(
    (request) => request.method === 'GET' && request.path === `/repos/${SLUG}`,
  ).length;
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

describe('github provider', () => {
  it('getRepo returns the slug, default branch, privacy and push permission', async () => {
    const repo = await provider.getRepo(SLUG);
    expect(repo).toEqual({
      slug: SLUG,
      defaultBranch: 'main',
      private: true,
      canPush: true,
    });
  });

  it('verifyRepo reports the repo and push states the app renders', async () => {
    const verified = await provider.verifyRepo(SLUG);
    expect(verified.ok).toBe(true);
    expect(verified.defaultBranch).toBe('main');
    expect(verified.canPush).toBe(true);
    expect(verified.checks).toEqual([
      { name: 'repo', state: 'ok' },
      { name: 'push', state: 'ok' },
    ]);
  });

  it('verifyRepo rejects a slug that is not exactly one owner/name before any request', async () => {
    for (const slug of ['acme', 'acme/web/extra', 'acme web', '/web', 'acme/']) {
      const error = await capture(() => provider.verifyRepo(slug));
      expect(error.code).toBe('validation_failed');
    }
    expect(fake.requests).toHaveLength(0);
  });

  it('every request carries the documented headers and a timeout signal', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const recording: FetchLike = (url, init) => {
      seen.push({ url, init });
      return fetch(url, init);
    };
    const direct = createGitHubProvider(options(fake, { fetch: recording }));
    await direct.getRepo(SLUG);
    const call = seen[0];
    expect(call?.url).toBe(`${fake.url}/repos/${SLUG}`);
    expect(call?.init.method).toBe('GET');
    const headers = new Headers(call?.init.headers);
    expect(headers.get('accept')).toBe('application/vnd.github+json');
    expect(headers.get('x-github-api-version')).toBe('2022-11-28');
    expect(headers.get('user-agent')).toBe(USER_AGENT);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('auth kind none fails read-only with forbidden and never calls GitHub', async () => {
    const none = createGitHubProvider(options(fake, { auth: { kind: 'none' } }));
    const error = await capture(() => none.getRepo(SLUG));
    expect(error.code).toBe('forbidden');
    expect(error.status).toBeNull();
    expect(fake.requests).toHaveLength(0);
  });

  it('401 refreshes the installation token once and retries the same request', async () => {
    fake.unauthorizedNext(1);
    const events: ProviderLogEvent[] = [];
    const app = createGitHubProvider(appOptions(fake, { log: (event) => events.push(event) }));
    const repo = await app.getRepo(SLUG);
    expect(repo.slug).toBe(SLUG);
    expect(fake.mintedTokens).toHaveLength(2);
    expect(repoRequests(fake)).toBe(2);
    const attempts = fake.requests.filter(
      (request) => request.method === 'GET' && request.path === `/repos/${SLUG}`,
    );
    expect(attempts[0]?.authorization).toBe(`Bearer ${fake.mintedTokens[0]}`);
    expect(attempts[1]?.authorization).toBe(`Bearer ${fake.mintedTokens[1]}`);
    expect(events.some((event) => event.message === 'token refreshed')).toBe(true);
  });

  it('401: a second consecutive 401 throws unauthorized after exactly one refresh mint', async () => {
    fake.unauthorizedNext(2);
    const app = createGitHubProvider(appOptions(fake));
    const error = await capture(() => app.getRepo(SLUG));
    expect(error.code).toBe('unauthorized');
    expect(error.status).toBe(401);
    expect(repoRequests(fake)).toBe(2);
    expect(fake.mintedTokens).toHaveLength(2);
    expect(error.message).not.toContain('Bad credentials');
  });

  it('401 with a PAT throws immediately without a retry or a mint', async () => {
    fake.unauthorizedNext(1);
    const error = await capture(() => provider.getRepo(SLUG));
    expect(error.code).toBe('unauthorized');
    expect(repoRequests(fake)).toBe(1);
    expect(fake.mintedTokens).toHaveLength(0);
  });
});

interface HttpCase {
  readonly status: number;
  readonly code: GitProviderErrorCode;
  readonly contract: ErrorCode;
}

const HTTP_CASES: readonly HttpCase[] = [
  { status: 401, code: 'unauthorized', contract: 'unauthorized' },
  { status: 403, code: 'forbidden', contract: 'forbidden' },
  { status: 404, code: 'not_found', contract: 'not_found' },
  { status: 409, code: 'conflict', contract: 'conflict' },
  { status: 422, code: 'validation_failed', contract: 'validation_failed' },
  { status: 429, code: 'rate_limited', contract: 'rate_limited' },
  { status: 500, code: 'provider_unavailable', contract: 'provider_unavailable' },
];

describe('error mapping', () => {
  it.each(HTTP_CASES)(
    'error mapping: $status becomes $code and never echoes the body',
    async ({ status, code, contract }) => {
      const events: ProviderLogEvent[] = [];
      const direct = createGitHubProvider(options(fake, { log: (event) => events.push(event) }));
      fake.failNext('GET', `/repos/${SLUG}`, status);
      const error = await capture(() => direct.getRepo(SLUG));
      expect(error.code).toBe(code);
      expect(error.status).toBe(status);
      expect(toContractErrorCode(error.code)).toBe(contract);
      expectSafeMessage(error);
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) expect(CLOSED_MESSAGES.has(event.message)).toBe(true);
      expect(JSON.stringify(events)).not.toContain(TOKEN);
    },
  );

  it('error mapping: 403 with x-ratelimit-remaining 0 is rate_limited', async () => {
    const limited: FetchLike = async () =>
      new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403,
        headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '0' },
      });
    const direct = createGitHubProvider(options(fake, { fetch: limited }));
    const error = await capture(() => direct.getRepo(SLUG));
    expect(error.code).toBe('rate_limited');
    expect(error.retryable).toBe(true);
    expect(toContractErrorCode(error.code)).toBe('rate_limited');
    expectSafeMessage(error);
  });

  it('error mapping: a refused connection is provider_unavailable', async () => {
    const refused: FetchLike = async () => {
      throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:1');
    };
    const direct = createGitHubProvider(options(fake, { fetch: refused }));
    const error = await capture(() => direct.getRepo(SLUG));
    expect(error.code).toBe('provider_unavailable');
    expect(error.status).toBeNull();
    expect(error.retryable).toBe(true);
    expect(toContractErrorCode(error.code)).toBe('provider_unavailable');
    expectSafeMessage(error);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APP_JWT_BACKDATE_SECONDS,
  APP_JWT_TTL_SECONDS,
  GitProviderError,
  TOKEN_REFRESH_MARGIN_SECONDS,
  createAppJwt,
  createAppTokenSource,
  createGitHubProvider,
  createPatTokenSource,
  createTokenSource,
  decodePrivateKey,
  startFakeGitHub,
  toContractErrorCode,
  toPullRequestRef,
} from './index.js';
import type { GitProviderErrorCode, PullRequest } from './index.js';

const CODES: readonly GitProviderErrorCode[] = [
  'unauthorized',
  'forbidden',
  'not_found',
  'rate_limited',
  'provider_unavailable',
  'validation_failed',
  'conflict',
];

const SRC_FILES = [
  'index.ts',
  'types.ts',
  'errors.ts',
  'jwt.ts',
  'tokens.ts',
  'github.ts',
  'fake.ts',
  'index.test.ts',
  'jwt.test.ts',
  'tokens.test.ts',
  'provider.test.ts',
  'push.test.ts',
  'pull-request.test.ts',
  'checks.test.ts',
  'merge.test.ts',
];

describe('public surface', () => {
  it('re-exports the provider, the token helpers, the jwt, the fake and the errors', () => {
    expect(typeof createGitHubProvider).toBe('function');
    expect(typeof createAppJwt).toBe('function');
    expect(typeof createAppTokenSource).toBe('function');
    expect(typeof createPatTokenSource).toBe('function');
    expect(typeof createTokenSource).toBe('function');
    expect(typeof decodePrivateKey).toBe('function');
    expect(typeof startFakeGitHub).toBe('function');
    expect(typeof toPullRequestRef).toBe('function');
    expect(APP_JWT_BACKDATE_SECONDS).toBe(60);
    expect(APP_JWT_TTL_SECONDS).toBe(600);
    expect(TOKEN_REFRESH_MARGIN_SECONDS).toBe(300);
  });

  it('toPullRequestRef keeps exactly the prRef shape', () => {
    const pullRequest: PullRequest = {
      number: 12,
      url: 'https://github.com/acme/web/pull/12',
      mergeable: true,
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      state: 'open',
      draft: false,
      labels: ['cb:auto-merge'],
      created: false,
    };
    expect(toPullRequestRef(pullRequest)).toEqual({
      number: 12,
      url: 'https://github.com/acme/web/pull/12',
      mergeable: true,
    });
  });

  it('maps every provider error code onto the contract vocabulary', () => {
    for (const code of CODES) expect(toContractErrorCode(code)).toBe(code);
  });

  it('GitProviderError carries a code, a status and the retry flag', () => {
    const error = new GitProviderError('rate_limited', 'github rate limited', 429, true);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('GitProviderError');
    expect(error.code).toBe('rate_limited');
    expect(error.status).toBe(429);
    expect(error.retryable).toBe(true);
  });

  it('README maps every file of the package', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    for (const file of SRC_FILES) expect(readme).toContain(`\`${file}\``);
  });
});

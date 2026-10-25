import { createPrivateKey } from 'node:crypto';
import type { FetchLike, ProviderAuth } from './types.js';
import { GitProviderError } from './errors.js';
import { createAppJwt } from './jwt.js';

export const TOKEN_REFRESH_MARGIN_SECONDS = 300;

export const GITHUB_ACCEPT = 'application/vnd.github+json';
export const GITHUB_API_VERSION = '2022-11-28';
export const TOKEN_USER_AGENT = 'codebox';

const REQUEST_FAILED = 'github request failed';
const KEY_ERROR = 'github private key is unreadable';
const RESPONSE_ERROR = 'unexpected github response';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface TokenSource {
  get(): Promise<string>;
  invalidate(): void;
  readonly refreshable: boolean;
}

export interface GitHubRequestInput {
  readonly apiBase: string;
  readonly path: string;
  readonly method: HttpMethod;
  readonly authorization: string;
  readonly userAgent: string;
  readonly fetch: FetchLike;
  readonly requestTimeoutMs: number;
  readonly body?: unknown;
}

export interface GitHubResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly data: unknown;
}

export function providerErrorFor(status: number, headers: Headers): GitProviderError {
  const message = `github request failed with status ${status}`;
  if (status === 401) return new GitProviderError('unauthorized', message, status, false);
  if (status === 403) {
    return headers.get('x-ratelimit-remaining') === '0'
      ? new GitProviderError('rate_limited', message, status, true)
      : new GitProviderError('forbidden', message, status, false);
  }
  if (status === 404) return new GitProviderError('not_found', message, status, false);
  if (status === 409) return new GitProviderError('conflict', message, status, false);
  if (status === 422) return new GitProviderError('validation_failed', message, status, false);
  if (status === 400) return new GitProviderError('validation_failed', message, status, false);
  if (status === 429) return new GitProviderError('rate_limited', message, status, true);
  if (status >= 500) {
    return new GitProviderError('provider_unavailable', message, status, true);
  }
  return new GitProviderError('provider_unavailable', message, status, false);
}

export function invalidResponse(): GitProviderError {
  return new GitProviderError('validation_failed', RESPONSE_ERROR, null, false);
}

function parseBody(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export async function requestGitHub(input: GitHubRequestInput): Promise<GitHubResponse> {
  const headers: Record<string, string> = {
    accept: GITHUB_ACCEPT,
    'x-github-api-version': GITHUB_API_VERSION,
    'user-agent': input.userAgent,
    authorization: input.authorization,
  };
  const init: RequestInit = {
    method: input.method,
    headers,
    signal: AbortSignal.timeout(input.requestTimeoutMs),
  };
  if (input.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(input.body);
  }
  let response: Response;
  let text: string;
  try {
    response = await input.fetch(`${input.apiBase}${input.path}`, init);
    text = await response.text();
  } catch {
    throw new GitProviderError('provider_unavailable', REQUEST_FAILED, null, true);
  }
  return { status: response.status, headers: response.headers, data: parseBody(text) };
}

export function decodePrivateKey(base64: string): string {
  const pem = Buffer.from(base64.trim(), 'base64').toString('utf8').trim();
  if (!pem.includes('-----BEGIN') || !pem.includes('PRIVATE KEY-----')) {
    throw new GitProviderError('validation_failed', KEY_ERROR, null, false);
  }
  try {
    createPrivateKey(pem);
  } catch {
    throw new GitProviderError('validation_failed', KEY_ERROR, null, false);
  }
  return pem;
}

interface MintedToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

function decodeMintedToken(input: unknown): MintedToken {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw invalidResponse();
  const record = input as Record<string, unknown>;
  const token = record['token'];
  const expiresAt = record['expires_at'];
  if (typeof token !== 'string' || token.length === 0) throw invalidResponse();
  if (typeof expiresAt !== 'string') throw invalidResponse();
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) throw invalidResponse();
  return { token, expiresAtMs };
}

export function createPatTokenSource(token: string): TokenSource {
  return {
    refreshable: false,
    get: (): Promise<string> => Promise.resolve(token),
    invalidate: (): void => undefined,
  };
}

export function createAppTokenSource(options: {
  readonly appId: string;
  readonly installationId: string;
  readonly privateKeyPem: string;
  readonly apiBase: string;
  readonly fetch: FetchLike;
  readonly now: () => number;
  readonly requestTimeoutMs: number;
}): TokenSource {
  let cached: MintedToken | null = null;
  let pending: Promise<string> | null = null;

  const mint = async (): Promise<string> => {
    const jwt = createAppJwt({
      appId: options.appId,
      privateKeyPem: options.privateKeyPem,
      issuedAt: Math.floor(options.now() / 1000),
    });
    const response = await requestGitHub({
      apiBase: options.apiBase,
      path: `/app/installations/${encodeURIComponent(options.installationId)}/access_tokens`,
      method: 'POST',
      authorization: `Bearer ${jwt}`,
      userAgent: TOKEN_USER_AGENT,
      fetch: options.fetch,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    if (response.status < 200 || response.status >= 300) {
      throw providerErrorFor(response.status, response.headers);
    }
    const minted = decodeMintedToken(response.data);
    cached = minted;
    return minted.token;
  };

  return {
    refreshable: true,
    get: async (): Promise<string> => {
      const fresh = cached;
      if (
        fresh !== null &&
        options.now() < fresh.expiresAtMs - TOKEN_REFRESH_MARGIN_SECONDS * 1000
      ) {
        return fresh.token;
      }
      if (pending === null) {
        pending = mint().finally(() => {
          pending = null;
        });
      }
      return pending;
    },
    invalidate: (): void => {
      cached = null;
    },
  };
}

export function createTokenSource(
  auth: ProviderAuth,
  deps: {
    readonly apiBase: string;
    readonly fetch: FetchLike;
    readonly now: () => number;
    readonly requestTimeoutMs: number;
  },
): TokenSource {
  if (auth.kind === 'app') {
    return createAppTokenSource({
      appId: auth.appId,
      installationId: auth.installationId,
      privateKeyPem: auth.privateKeyPem,
      apiBase: deps.apiBase,
      fetch: deps.fetch,
      now: deps.now,
      requestTimeoutMs: deps.requestTimeoutMs,
    });
  }
  if (auth.kind === 'pat') return createPatTokenSource(auth.token);
  return {
    refreshable: false,
    get: (): Promise<string> =>
      Promise.reject(new GitProviderError('forbidden', 'github is not configured', null, false)),
    invalidate: (): void => undefined,
  };
}

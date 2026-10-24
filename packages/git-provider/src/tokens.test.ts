import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from './types.js';
import { GitProviderError } from './errors.js';
import {
  TOKEN_REFRESH_MARGIN_SECONDS,
  createAppTokenSource,
  createPatTokenSource,
  createTokenSource,
  decodePrivateKey,
} from './tokens.js';

const BASE_MS = Date.parse('2026-01-01T00:00:00.000Z');
const LIFETIME_MS = 3_600_000;
const EXPIRES_AT_MS = BASE_MS + LIFETIME_MS;
const APP_ID = '123456';
const INSTALLATION_ID = '42';
const API_BASE = 'https://api.github.test';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

interface Harness {
  readonly calls: Call[];
  readonly clock: { nowMs: number };
  readonly fetch: FetchLike;
}

function harness(expiresAtMs: number = EXPIRES_AT_MS): Harness {
  const calls: Call[] = [];
  const clock = { nowMs: BASE_MS };
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        token: `ghs_mint_${calls.length}`,
        expires_at: new Date(expiresAtMs).toISOString(),
      }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    );
  };
  return { calls, clock, fetch };
}

function appSource(subject: Harness): ReturnType<typeof createAppTokenSource> {
  return createAppTokenSource({
    appId: APP_ID,
    installationId: INSTALLATION_ID,
    privateKeyPem: PRIVATE_PEM,
    apiBase: API_BASE,
    fetch: subject.fetch,
    now: () => subject.clock.nowMs,
    requestTimeoutMs: 1_000,
  });
}

describe('token lifecycle', () => {
  it('token: one mint is cached for the second get()', async () => {
    const subject = harness();
    const source = appSource(subject);
    expect(source.refreshable).toBe(true);
    expect(await source.get()).toBe('ghs_mint_1');
    expect(await source.get()).toBe('ghs_mint_1');
    expect(subject.calls).toHaveLength(1);
  });

  it('token: re-mints at expires_at minus the 300 second margin', async () => {
    const subject = harness();
    const source = appSource(subject);
    await source.get();
    subject.clock.nowMs = EXPIRES_AT_MS - TOKEN_REFRESH_MARGIN_SECONDS * 1000;
    expect(await source.get()).toBe('ghs_mint_2');
    expect(subject.calls).toHaveLength(2);
    expect(TOKEN_REFRESH_MARGIN_SECONDS).toBe(300);
  });

  it('token: keeps the cache one millisecond before the margin', async () => {
    const subject = harness();
    const source = appSource(subject);
    const first = await source.get();
    subject.clock.nowMs = EXPIRES_AT_MS - TOKEN_REFRESH_MARGIN_SECONDS * 1000 - 1;
    expect(await source.get()).toBe(first);
    expect(subject.calls).toHaveLength(1);
  });

  it('token: invalidate drops the cache so the next get() mints', async () => {
    const subject = harness();
    const source = appSource(subject);
    expect(await source.get()).toBe('ghs_mint_1');
    source.invalidate();
    expect(await source.get()).toBe('ghs_mint_2');
    expect(subject.calls).toHaveLength(2);
  });

  it('token: mints through the installation endpoint with the App JWT', async () => {
    const subject = harness();
    await appSource(subject).get();
    const call = subject.calls[0];
    expect(call?.url).toBe(`${API_BASE}/app/installations/${INSTALLATION_ID}/access_tokens`);
    expect(call?.init.method).toBe('POST');
    const headers = new Headers(call?.init.headers);
    expect(headers.get('authorization')).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(headers.get('accept')).toBe('application/vnd.github+json');
    expect(headers.get('x-github-api-version')).toBe('2022-11-28');
    expect(headers.get('user-agent')).toBeTruthy();
  });

  it('token: a PAT is returned forever and is not refreshable', async () => {
    const source = createPatTokenSource('ghs_pat_value');
    expect(source.refreshable).toBe(false);
    expect(await source.get()).toBe('ghs_pat_value');
    source.invalidate();
    expect(await source.get()).toBe('ghs_pat_value');
  });

  it('token: auth kind none throws forbidden', async () => {
    const subject = harness();
    const source = createTokenSource(
      { kind: 'none' },
      {
        apiBase: API_BASE,
        fetch: subject.fetch,
        now: () => BASE_MS,
        requestTimeoutMs: 1_000,
      },
    );
    expect(source.refreshable).toBe(false);
    await expect(source.get()).rejects.toMatchObject({ code: 'forbidden', status: null });
    expect(subject.calls).toHaveLength(0);
  });

  it('token: createTokenSource builds the App source for kind app', () => {
    const subject = harness();
    const source = createTokenSource(
      {
        kind: 'app',
        appId: APP_ID,
        installationId: INSTALLATION_ID,
        privateKeyPem: PRIVATE_PEM,
      },
      {
        apiBase: API_BASE,
        fetch: subject.fetch,
        now: () => BASE_MS,
        requestTimeoutMs: 1_000,
      },
    );
    expect(source.refreshable).toBe(true);
  });

  it('token: a 401 from the mint endpoint surfaces unauthorized', async () => {
    const source = createAppTokenSource({
      appId: APP_ID,
      installationId: INSTALLATION_ID,
      privateKeyPem: PRIVATE_PEM,
      apiBase: API_BASE,
      fetch: async () =>
        new Response(JSON.stringify({ message: 'Bad credentials' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      now: () => BASE_MS,
      requestTimeoutMs: 1_000,
    });
    await expect(source.get()).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
  });

  it('token: a mint body without a token is validation_failed', async () => {
    const source = createAppTokenSource({
      appId: APP_ID,
      installationId: INSTALLATION_ID,
      privateKeyPem: PRIVATE_PEM,
      apiBase: API_BASE,
      fetch: async () =>
        new Response(JSON.stringify({ expires_at: '2026-01-01T01:00:00.000Z' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      now: () => BASE_MS,
      requestTimeoutMs: 1_000,
    });
    await expect(source.get()).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('token: decodePrivateKey round-trips a base64 PEM', () => {
    const encoded = Buffer.from(PRIVATE_PEM, 'utf8').toString('base64');
    expect(decodePrivateKey(encoded)).toBe(PRIVATE_PEM.trim());
  });

  it('token: decodePrivateKey rejects garbage with validation_failed', () => {
    let caught: unknown;
    try {
      decodePrivateKey(Buffer.from('not a private key').toString('base64'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GitProviderError);
    expect((caught as GitProviderError).code).toBe('validation_failed');
  });
});

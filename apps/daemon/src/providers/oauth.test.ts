import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import { RunApiError } from '../runs/errors.js';
import { seedProviderCatalog } from './catalog.js';
import type { ProviderCredentialPort } from './credentials.js';
import {
  OAUTH_STATE_TTL_SECONDS,
  OAUTH_TOKEN_ENVELOPE_VERSION,
  decodeOauthEnvelope,
  encodeOauthEnvelope,
} from './oauth.js';
import type { ProviderOauthAdapter, ProviderOauthTokens } from './oauth.js';
import { createProvidersService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = '2026-10-28T10:00:00.000Z';

const TOKENS: ProviderOauthTokens = {
  accessToken: 'fake-access-token-not-a-secret',
  refreshToken: 'fake-refresh-token-not-a-secret',
  expiresAt: '2026-10-28T11:00:00.000Z',
};

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

interface Fixture {
  readonly context: DaemonContext;
  readonly sealed: string[];
  readonly port: ProviderCredentialPort;
  advance(seconds: number): void;
}

function fixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'cb-73-oauth-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
  });
  const store = openInMemoryStore();
  stores.push(store);
  seedProviderCatalog(store, NOW);
  const logger = createLogger({ level: 'error', sink: () => undefined });
  let at = new Date(NOW).getTime();
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => new Date(at),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  const sealed: string[] = [];
  let counter = 0;
  const port: ProviderCredentialPort = {
    create(input) {
      counter += 1;
      sealed.push(input.value);
      return { id: `cred_oauth${counter}`, lastFour: input.value.slice(-4) };
    },
    lastFour: () => '',
    remove: () => undefined,
  };
  return {
    context,
    sealed,
    port,
    advance(seconds: number): void {
      at += seconds * 1_000;
    },
  };
}

const fakeAdapter: ProviderOauthAdapter = {
  providerId: 'opencode-go',
  authorizeUrl: ({ state }) => `https://auth.example.test/authorize?state=${state}`,
  exchange: () => Promise.resolve(TOKENS),
};

describe('the OAuth token envelope', () => {
  it('round-trips the three tokens at version 1', () => {
    const value = encodeOauthEnvelope(TOKENS);
    expect(JSON.parse(value)).toEqual({
      v: OAUTH_TOKEN_ENVELOPE_VERSION,
      access: TOKENS.accessToken,
      refresh: TOKENS.refreshToken,
      expiresAt: TOKENS.expiresAt,
    });
    expect(decodeOauthEnvelope(value)).toEqual(TOKENS);
  });

  it('round-trips an account with neither refresh token nor expiry', () => {
    const bare: ProviderOauthTokens = {
      accessToken: 'fake-access-token-not-a-secret',
      refreshToken: null,
      expiresAt: null,
    };
    expect(decodeOauthEnvelope(encodeOauthEnvelope(bare))).toEqual(bare);
  });

  it('rejects another version, non-JSON and an empty access token', () => {
    expect(decodeOauthEnvelope('{"v":2}')).toBeNull();
    expect(decodeOauthEnvelope('not json')).toBeNull();
    expect(decodeOauthEnvelope('{"v":1,"access":""}')).toBeNull();
  });
});

describe('startOauth', () => {
  it('refuses a provider with no adapter', () => {
    const h = fixture();
    const service = createProvidersService({ context: h.context, credentials: h.port });
    let thrown: unknown;
    try {
      service.startOauth('opencode-go', { label: 'go · main', priority: 1 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RunApiError);
    expect((thrown as RunApiError).status).toBe(422);
    expect((thrown as RunApiError).details).toEqual({
      path: 'provider.id',
      reason: 'provider_oauth_unsupported',
    });
  });

  it('answers the adapter URL and a single-use state', () => {
    const h = fixture();
    const service = createProvidersService({
      context: h.context,
      credentials: h.port,
      oauth: [fakeAdapter],
    });
    const started = service.startOauth('opencode-go', { label: 'go · main', priority: 1 });
    expect(started.authorizeUrl).toBe(`https://auth.example.test/authorize?state=${started.state}`);
    expect(started.state).toHaveLength(32);
  });
});

describe('completeOauth', () => {
  it('seals one credential whose envelope carries the exchanged tokens', async () => {
    const h = fixture();
    const service = createProvidersService({
      context: h.context,
      credentials: h.port,
      oauth: [fakeAdapter],
    });
    const started = service.startOauth('opencode-go', { label: 'go · main', priority: 1 });
    const account = await service.completeOauth('opencode-go', {
      code: 'fake-code',
      state: started.state,
    });

    expect(h.sealed).toHaveLength(1);
    expect(decodeOauthEnvelope(h.sealed[0] ?? '')).toEqual(TOKENS);
    expect(account.label).toBe('go · main');
    expect(account.state).toBe('active');
    expect(account.credentialId).toBe('cred_oauth1');
  });

  it('refuses a replayed state', async () => {
    const h = fixture();
    const service = createProvidersService({
      context: h.context,
      credentials: h.port,
      oauth: [fakeAdapter],
    });
    const started = service.startOauth('opencode-go', { label: 'go · main', priority: 1 });
    await service.completeOauth('opencode-go', { code: 'fake-code', state: started.state });
    await expect(
      service.completeOauth('opencode-go', { code: 'fake-code', state: started.state }),
    ).rejects.toMatchObject({
      status: 422,
      details: { path: 'oauth.state', reason: 'state_invalid' },
    });
  });

  it('refuses an unknown state', async () => {
    const h = fixture();
    const service = createProvidersService({
      context: h.context,
      credentials: h.port,
      oauth: [fakeAdapter],
    });
    await expect(
      service.completeOauth('opencode-go', { code: 'fake-code', state: 'n'.repeat(32) }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('expires a state after its 600 second budget', async () => {
    const h = fixture();
    const service = createProvidersService({
      context: h.context,
      credentials: h.port,
      oauth: [fakeAdapter],
    });
    const started = service.startOauth('opencode-go', { label: 'go · main', priority: 1 });
    h.advance(OAUTH_STATE_TTL_SECONDS);
    await expect(
      service.completeOauth('opencode-go', { code: 'fake-code', state: started.state }),
    ).rejects.toMatchObject({ status: 422, details: { reason: 'state_invalid' } });
  });

  it('answers 503 when the exchange fails', async () => {
    const h = fixture();
    const failing: ProviderOauthAdapter = {
      providerId: 'opencode-go',
      authorizeUrl: ({ state }) => `https://auth.example.test/authorize?state=${state}`,
      exchange: () => Promise.reject(new Error('upstream refused')),
    };
    const service = createProvidersService({
      context: h.context,
      credentials: h.port,
      oauth: [failing],
    });
    const started = service.startOauth('opencode-go', { label: 'go · main', priority: 1 });
    await expect(
      service.completeOauth('opencode-go', { code: 'fake-code', state: started.state }),
    ).rejects.toMatchObject({ status: 503, details: { reason: 'provider_unavailable' } });
  });
});

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
import { createCredentialsService } from '../credentials/service.js';
import type { CredentialsService } from '../credentials/service.js';
import type { CreateIntegrationInput } from '../credentials/schemas.js';
import { createIntegrationsService } from './service.js';
import type { FetchLike, IntegrationsService } from './service.js';
import { createFileIntegrationStorage, integrationsDirectory } from './storage.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = '2026-10-27T10:00:00.000Z';
const MASTER_KEY = Buffer.alloc(32, 6).toString('base64');
const PLAINTEXT = 'sk-live-INTEGRATION-abcdef';

const directories: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function recorder(respond: (url: string) => Response | Promise<Response>): {
  calls: Call[];
  fetch: FetchLike;
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url: string, init: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      return respond(url);
    },
  };
}

function fixture(options: { readonly configured?: boolean } = {}): DaemonContext {
  const root = mkdtempSync(join(tmpdir(), 'cb-58-integrations-'));
  directories.push(root);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(root, 'state'),
    CB_REPO_ROOT: join(root, 'repos'),
    CB_WORKSPACE_ROOT: join(root, 'worktrees'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
    ...(options.configured === false ? {} : { CB_SECRETS_KEY: MASTER_KEY }),
  });
  const store = openInMemoryStore();
  stores.push(store);
  const now = new Date(NOW);
  const logger = createLogger({ level: 'trace', sink: () => undefined });
  return {
    config,
    store,
    logger,
    clock: () => now,
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(root, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
}

interface Setup {
  readonly context: DaemonContext;
  readonly credentials: CredentialsService;
  readonly service: IntegrationsService;
  readonly calls: Call[];
}

function setup(
  options: {
    readonly configured?: boolean;
    readonly respond?: (url: string) => Response | Promise<Response>;
  } = {},
): Setup {
  const context = fixture({ configured: options.configured ?? true });
  const now = (): Date => context.clock();
  const credentials = createCredentialsService({ context, now });
  const { calls, fetch } = recorder(options.respond ?? (() => new Response('ok')));
  const service = createIntegrationsService({
    context,
    now,
    fetch,
    storage: createFileIntegrationStorage({
      directory: integrationsDirectory(context.config.CB_STATE_DIR),
    }),
    credentials,
  });
  return { context, credentials, service, calls };
}

function apiKey(credentials: CredentialsService, value = PLAINTEXT): string {
  return credentials.create({ name: 'Key', kind: 'api_key', expose: 'daemon', value }).id;
}

function integration(setupResult: Setup, overrides: Partial<CreateIntegrationInput> = {}): string {
  const credentialId = apiKey(setupResult.credentials);
  return setupResult.service.create({
    name: 'Linear',
    baseUrl: 'https://api.example.com',
    auth: 'bearer',
    credentialId,
    allowedHosts: ['api.example.com'],
    ...overrides,
  }).id;
}

function errorOf(run: () => unknown): RunApiError | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof RunApiError ? error : null;
  }
}

async function asyncErrorOf(run: () => Promise<unknown>): Promise<RunApiError | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof RunApiError ? error : null;
  }
}

describe('integrations service', () => {
  it('creates, lists and removes an integration without a value in the row', () => {
    const { service, credentials } = setup();
    const credentialId = apiKey(credentials);
    const created = service.create({
      name: 'Linear',
      baseUrl: 'https://api.linear.app',
      auth: 'bearer',
      credentialId,
      allowedHosts: ['api.linear.app'],
    });
    expect(created).toEqual({
      id: created.id,
      name: 'Linear',
      baseUrl: 'https://api.linear.app',
      auth: 'bearer',
      headerName: null,
      credentialId,
      allowedHosts: ['api.linear.app'],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(JSON.stringify(created)).not.toContain(PLAINTEXT);
    expect(service.list()).toHaveLength(1);

    service.remove(created.id);
    expect(service.list()).toEqual([]);
    expect(errorOf(() => service.remove(created.id))?.details).toEqual({ path: 'integration.id' });
  });

  it('refuses a bad base URL, a header without a name and a missing credential', () => {
    const { service, credentials } = setup();
    const credentialId = apiKey(credentials);
    expect(
      errorOf(() =>
        service.create({
          name: 'Bad',
          baseUrl: 'http://api.example.com',
          auth: 'none',
          allowedHosts: ['api.example.com'],
        }),
      )?.details,
    ).toEqual({ path: 'integration.baseUrl' });
    expect(
      errorOf(() =>
        service.create({
          name: 'Bad',
          baseUrl: 'https://api.example.com',
          auth: 'header',
          credentialId,
          allowedHosts: ['api.example.com'],
        }),
      )?.details,
    ).toEqual({ path: 'integration.headerName' });
    expect(
      errorOf(() =>
        service.create({
          name: 'Bad',
          baseUrl: 'https://api.example.com',
          auth: 'bearer',
          credentialId: 'cred_missing',
          allowedHosts: ['api.example.com'],
        }),
      )?.details,
    ).toEqual({ path: 'integration.credentialId' });
  });

  it('injects the bearer header, keeps only accept and content-type, and touches lastUsedAt', async () => {
    const setupResult = setup({
      respond: () => new Response('hello', { headers: { 'content-type': 'text/plain' } }),
    });
    const id = integration(setupResult);
    const credentialId = setupResult.service.list()[0]?.credentialId ?? '';
    const result = await setupResult.service.request(id, {
      method: 'POST',
      path: '/v2/items',
      query: { q: 'a b' },
      headers: { accept: 'application/json', 'x-drop': 'nope' },
      body: '{}',
    });

    expect(result).toEqual({
      status: 200,
      contentType: 'text/plain',
      body: 'hello',
      truncated: false,
    });
    const call = setupResult.calls[0];
    expect(call?.url).toBe('https://api.example.com/v2/items?q=a+b');
    expect(call?.init.headers).toEqual({
      accept: 'application/json',
      authorization: `Bearer ${PLAINTEXT}`,
    });
    expect(call?.init.body).toBe('{}');
    expect(setupResult.credentials.storage.get(credentialId)?.lastUsedAt).toBe(NOW);
  });

  it('builds a basic and a custom header value', async () => {
    const setupResult = setup({ respond: () => new Response('ok') });
    const basic = setupResult.service.create({
      name: 'Basic',
      baseUrl: 'https://api.example.com',
      auth: 'basic',
      credentialId: apiKey(setupResult.credentials, 'user:pass'),
      allowedHosts: ['api.example.com'],
    });
    await setupResult.service.request(basic.id, { method: 'GET', path: '/me' });
    expect(setupResult.calls[0]?.init.headers).toEqual({
      authorization: `Basic ${Buffer.from('user:pass').toString('base64')}`,
    });

    const header = setupResult.service.create({
      name: 'Header',
      baseUrl: 'https://api.example.com',
      auth: 'header',
      headerName: 'X-Api-Key',
      credentialId: apiKey(setupResult.credentials),
      allowedHosts: ['api.example.com'],
    });
    await setupResult.service.request(header.id, { method: 'GET', path: '/me' });
    expect(setupResult.calls[1]?.init.headers).toEqual({ 'x-api-key': PLAINTEXT });

    const none = setupResult.service.create({
      name: 'None',
      baseUrl: 'https://api.example.com',
      auth: 'none',
      allowedHosts: ['api.example.com'],
    });
    await setupResult.service.request(none.id, { method: 'GET', path: '/health' });
    expect(setupResult.calls[2]?.init.headers).toEqual({});
  });

  it('refuses a host outside the allowlist before the injected fetch runs', async () => {
    const setupResult = setup({
      respond: () => {
        throw new Error('the fetch must not run');
      },
    });
    const id = integration(setupResult, { allowedHosts: ['other.example.com'] });
    const refused = await asyncErrorOf(() =>
      setupResult.service.request(id, { method: 'GET', path: '/x' }),
    );
    expect(refused?.status).toBe(422);
    expect(refused?.details).toEqual({ path: 'integration.path', reason: 'host_not_allowed' });
    expect(setupResult.calls).toHaveLength(0);

    const lookalike = await asyncErrorOf(() =>
      setupResult.service.request(id, { method: 'GET', path: '//evil.test/x' }),
    );
    expect(lookalike?.status).toBe(422);
    expect(setupResult.calls).toHaveLength(0);
  });

  it('truncates a body over 65536 characters', async () => {
    const long = 'x'.repeat(65_536 + 10);
    const setupResult = setup({ respond: () => new Response(long) });
    const id = integration(setupResult);
    const result = await setupResult.service.request(id, { method: 'GET', path: '/long' });
    expect(result.truncated).toBe(true);
    expect(result.body).toHaveLength(65_536);
  });

  it('turns a transport error into 503 integration_unreachable and skips the touch', async () => {
    const setupResult = setup({
      respond: () => {
        throw new TypeError('fetch failed');
      },
    });
    const id = integration(setupResult);
    const credentialId = setupResult.service.list()[0]?.credentialId ?? '';
    const error = await asyncErrorOf(() =>
      setupResult.service.request(id, { method: 'GET', path: '/x' }),
    );
    expect(error?.status).toBe(503);
    expect(error?.details).toEqual({ reason: 'integration_unreachable' });
    expect(setupResult.credentials.storage.get(credentialId)?.lastUsedAt).toBeNull();
  });

  it('returns a non-2xx status without touching lastUsedAt', async () => {
    const setupResult = setup({ respond: () => new Response('nope', { status: 500 }) });
    const id = integration(setupResult);
    const credentialId = setupResult.service.list()[0]?.credentialId ?? '';
    const result = await setupResult.service.request(id, { method: 'GET', path: '/x' });
    expect(result.status).toBe(500);
    expect(setupResult.credentials.storage.get(credentialId)?.lastUsedAt).toBeNull();
  });

  it('completes the GitHub manifest flow once and keeps the PEM out of every response', async () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIE-test-pem\n-----END PRIVATE KEY-----';
    const setupResult = setup({
      respond: () => new Response(JSON.stringify({ id: 123, pem }), { status: 201 }),
    });
    const started = setupResult.service.startManifest();
    expect(started.action).toBe('https://github.com/settings/apps/new');
    expect(typeof started.manifest).toBe('object');
    expect(started.state.length).toBeGreaterThan(20);

    const invalid = await asyncErrorOf(() =>
      setupResult.service.completeManifest({ code: 'abc', state: 'wrong-state' }),
    );
    expect(invalid?.status).toBe(422);
    expect(invalid?.details).toEqual({ reason: 'state_invalid' });
    expect(setupResult.calls).toHaveLength(0);

    const completed = await setupResult.service.completeManifest({
      code: 'abc',
      state: started.state,
    });
    expect(completed).toEqual({
      configured: true,
      appId: 123,
      credentialId: completed.credentialId,
    });
    expect(JSON.stringify(completed)).not.toContain(pem);
    expect(JSON.stringify(setupResult.credentials.list())).not.toContain(pem);

    const stored = setupResult.credentials.storage.get(completed.credentialId);
    expect(stored?.kind).toBe('github_app');
    expect(stored?.expose).toBe('daemon');
    expect(setupResult.credentials.open(completed.credentialId)).toBe(pem);
    expect(setupResult.calls[0]?.url).toBe('https://api.github.com/app-manifests/abc/conversions');

    const replay = await asyncErrorOf(() =>
      setupResult.service.completeManifest({ code: 'abc', state: started.state }),
    );
    expect(replay?.status).toBe(422);
  });

  it('refuses the manifest flow without a master key', () => {
    const setupResult = setup({ configured: false });
    expect(errorOf(() => setupResult.service.startManifest())?.details).toEqual({
      reason: 'secrets_not_configured',
    });
  });

  it('is 503 provider_unavailable when GitHub rejects the conversion', async () => {
    const setupResult = setup({ respond: () => new Response('{}', { status: 422 }) });
    const started = setupResult.service.startManifest();
    const error = await asyncErrorOf(() =>
      setupResult.service.completeManifest({ code: 'abc', state: started.state }),
    );
    expect(error?.status).toBe(503);
    expect(error?.details).toEqual({ reason: 'provider_unavailable' });
    expect(setupResult.credentials.list()).toEqual([]);
  });
});

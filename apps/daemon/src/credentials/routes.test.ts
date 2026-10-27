import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Scope } from '@codebox/contracts';
import { mintAccessToken, sha256Hex } from '@codebox/security';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { createApp } from '../app.js';
import { createModule as createAuthModule } from '../auth/index.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import { createCredentialsService } from '../credentials/service.js';
import type { CredentialsService } from '../credentials/service.js';
import { registerCredentialRoutes } from '../credentials/routes.js';
import { createIntegrationsService } from '../integrations/service.js';
import type { FetchLike, IntegrationsService } from '../integrations/service.js';
import { registerIntegrationRoutes } from '../integrations/routes.js';
import { createFileIntegrationStorage, integrationsDirectory } from '../integrations/storage.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = '2026-10-27T10:00:00.000Z';
const MASTER_KEY = Buffer.alloc(32, 8).toString('base64');
const PLAINTEXT = 'sk-live-ROUTESECRET-0123456789abcdef';
const PEM = '-----BEGIN PRIVATE KEY-----\nMIIE-routes-pem\n-----END PRIVATE KEY-----';

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

interface RequestOptions {
  readonly token?: string;
  readonly body?: unknown;
}

interface Harness {
  readonly app: DaemonApp;
  readonly service: CredentialsService;
  readonly integrations: IntegrationsService;
  readonly calls: { readonly url: string; readonly init: RequestInit }[];
  device(scopes?: readonly Scope[]): string;
  call(method: string, path: string, options?: RequestOptions): Promise<Response>;
}

interface HarnessOptions {
  readonly configured?: boolean;
  readonly respond?: (url: string) => Response | Promise<Response>;
}

function harness(options: HarnessOptions = {}): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-58-routes-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
    ...(options.configured === false ? {} : { CB_SECRETS_KEY: MASTER_KEY }),
  });
  const store = openInMemoryStore();
  stores.push(store);
  const now = new Date(NOW);
  const logger = createLogger({ level: 'error', sink: () => undefined });
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => now,
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  const app = createApp({ context });
  createAuthModule(context).register(app, context);

  const service = createCredentialsService({ context, now: () => now });
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return options.respond?.(url) ?? new Response('ok');
  };
  const integrations = createIntegrationsService({
    context,
    now: () => now,
    fetch,
    storage: createFileIntegrationStorage({
      directory: integrationsDirectory(context.config.CB_STATE_DIR),
    }),
    credentials: service,
  });
  registerCredentialRoutes(app, service);
  registerIntegrationRoutes(app, integrations);

  let devices = 0;
  return {
    app,
    service,
    integrations,
    calls,
    device(scopes: readonly Scope[] = ['read', 'write', 'runs', 'admin']): string {
      devices += 1;
      const id = `dev_credentials${devices}`;
      store.devices.create({
        id,
        name: `Device ${devices}`,
        platform: 'cli',
        publicKey: null,
        fingerprint: null,
        scopes: [...scopes],
        refreshTokenHash: sha256Hex(id),
        refreshPreviousHash: null,
        refreshExpiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
        createdAt: NOW,
        lastSeenAt: null,
        revokedAt: null,
      });
      return mintAccessToken({
        deviceId: id,
        scopes,
        secret: SESSION_SECRET,
        now,
        ttlSeconds: 900,
      }).token;
    },
    async call(method: string, path: string, request: RequestOptions = {}): Promise<Response> {
      const headers: Record<string, string> = {};
      if (request.token !== undefined) headers.authorization = `Bearer ${request.token}`;
      if (request.body !== undefined) headers['content-type'] = 'application/json';
      const init: RequestInit = { method, headers };
      if (request.body !== undefined) init.body = JSON.stringify(request.body);
      return app.request(path, init);
    },
  };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function detailsOf(payload: Record<string, unknown>): Record<string, unknown> {
  const error = payload.error;
  if (typeof error !== 'object' || error === null) return {};
  const details = (error as { details?: unknown }).details;
  return typeof details === 'object' && details !== null
    ? (details as Record<string, unknown>)
    : {};
}

function codeOf(payload: Record<string, unknown>): unknown {
  const error = payload.error;
  return typeof error === 'object' && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
}

function credentialBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'OpenAI', kind: 'model_key', expose: 'env', value: PLAINTEXT, ...overrides };
}

describe('credential routes', () => {
  it('creates, lists and rotates a credential without ever returning the value', async () => {
    const app = harness();
    const token = app.device();
    expect((await app.call('GET', '/v1/credentials', { token })).status).toBe(200);

    const created = await app.call('POST', '/v1/credentials', { token, body: credentialBody() });
    expect(created.status).toBe(201);
    const credential = await body(created);
    expect(credential.name).toBe('OpenAI');
    expect(credential.lastFour).toBe('cdef');
    expect(JSON.stringify(credential)).not.toContain(PLAINTEXT);

    const listed = await body(await app.call('GET', '/v1/credentials', { token }));
    expect(listed.nextCursor).toBeNull();
    expect(listed.data).toHaveLength(1);

    const rotated = await app.call('POST', `/v1/credentials/${String(credential.id)}/rotate`, {
      token,
      body: { value: 'sk-live-ROTATED-9999wxyz' },
    });
    expect(rotated.status).toBe(200);
    expect((await body(rotated)).lastFour).toBe('wxyz');
  });

  it('refuses a device without the admin scope with a 403', async () => {
    const app = harness();
    const token = app.device(['read', 'write', 'runs']);
    const response = await app.call('POST', '/v1/credentials', { token, body: credentialBody() });
    expect(response.status).toBe(403);
    const payload = await body(response);
    expect(codeOf(payload)).toBe('forbidden');
    expect(detailsOf(payload).reason).toBe('insufficient_scope');
  });

  it('refuses expose env on a non-model_key with the machine reason', async () => {
    const app = harness();
    const token = app.device();
    const response = await app.call('POST', '/v1/credentials', {
      token,
      body: credentialBody({ kind: 'api_key' }),
    });
    expect(response.status).toBe(422);
    expect(detailsOf(await body(response)).reason).toBe('env_not_allowed');
  });

  it('names an unknown body key inside the credential boundary', async () => {
    const app = harness();
    const token = app.device();
    const response = await app.call('POST', '/v1/credentials', {
      token,
      body: credentialBody({ password: 'nope' }),
    });
    expect(response.status).toBe(422);
    expect(detailsOf(await body(response)).path).toBe('credential.password');
  });

  it('is 503 secrets_not_configured on every credential write', async () => {
    const app = harness({ configured: false });
    const token = app.device();
    const create = await app.call('POST', '/v1/credentials', { token, body: credentialBody() });
    expect(create.status).toBe(503);
    expect(detailsOf(await body(create)).reason).toBe('secrets_not_configured');

    const rotate = await app.call('POST', '/v1/credentials/cred_missing/rotate', {
      token,
      body: { value: 'x' },
    });
    expect(rotate.status).toBe(503);
    expect(detailsOf(await body(rotate)).reason).toBe('secrets_not_configured');
  });

  it('deletes a credential and answers 404 afterwards', async () => {
    const app = harness();
    const token = app.device();
    const created = await body(
      await app.call('POST', '/v1/credentials', { token, body: credentialBody() }),
    );
    const deleted = await app.call('DELETE', `/v1/credentials/${String(created.id)}`, { token });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe('');

    const again = await app.call('DELETE', `/v1/credentials/${String(created.id)}`, { token });
    expect(again.status).toBe(404);
    expect(detailsOf(await body(again)).path).toBe('credential.id');
  });
});

describe('integration routes', () => {
  it('creates, lists and deletes an integration', async () => {
    const app = harness();
    const token = app.device();
    const credential = await body(
      await app.call('POST', '/v1/credentials', { token, body: credentialBody() }),
    );
    const created = await app.call('POST', '/v1/integrations', {
      token,
      body: {
        name: 'Linear',
        baseUrl: 'https://api.linear.app',
        auth: 'bearer',
        credentialId: credential.id,
        allowedHosts: ['api.linear.app'],
      },
    });
    expect(created.status).toBe(201);
    const integration = await body(created);
    expect(integration).toEqual({
      id: integration.id,
      name: 'Linear',
      baseUrl: 'https://api.linear.app',
      auth: 'bearer',
      headerName: null,
      credentialId: credential.id,
      allowedHosts: ['api.linear.app'],
      createdAt: NOW,
      updatedAt: NOW,
    });

    const listed = await body(await app.call('GET', '/v1/integrations', { token }));
    expect(listed.nextCursor).toBeNull();
    expect(listed.data).toHaveLength(1);

    const deleted = await app.call('DELETE', `/v1/integrations/${String(integration.id)}`, {
      token,
    });
    expect(deleted.status).toBe(204);
    const again = await app.call('DELETE', `/v1/integrations/${String(integration.id)}`, {
      token,
    });
    expect(again.status).toBe(404);
  });

  it('answers 404 when the credential id does not exist and 422 on an unknown key', async () => {
    const app = harness();
    const token = app.device();
    const missing = await app.call('POST', '/v1/integrations', {
      token,
      body: {
        name: 'Linear',
        baseUrl: 'https://api.linear.app',
        auth: 'bearer',
        credentialId: 'cred_missing',
        allowedHosts: ['api.linear.app'],
      },
    });
    expect(missing.status).toBe(404);
    expect(detailsOf(await body(missing)).path).toBe('integration.credentialId');

    const unknown = await app.call('POST', '/v1/integrations', {
      token,
      body: {
        name: 'Linear',
        baseUrl: 'https://api.linear.app',
        auth: 'none',
        allowedHosts: ['api.linear.app'],
        extra: true,
      },
    });
    expect(unknown.status).toBe(422);
    expect(detailsOf(await body(unknown)).path).toBe('integration.extra');
  });

  it('executes an allowed request and refuses a host outside the allowlist', async () => {
    const app = harness({
      respond: () =>
        new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }),
    });
    const token = app.device();
    const credential = await body(
      await app.call('POST', '/v1/credentials', { token, body: credentialBody() }),
    );
    const integration = await body(
      await app.call('POST', '/v1/integrations', {
        token,
        body: {
          name: 'Linear',
          baseUrl: 'https://api.linear.app',
          auth: 'bearer',
          credentialId: credential.id,
          allowedHosts: ['api.linear.app'],
        },
      }),
    );

    const called = await app.call('POST', `/v1/integrations/${String(integration.id)}/request`, {
      token,
      body: { method: 'GET', path: '/graphql' },
    });
    expect(called.status).toBe(200);
    expect(await body(called)).toEqual({
      status: 200,
      contentType: 'application/json',
      body: '{"ok":true}',
      truncated: false,
    });
    expect(app.calls).toHaveLength(1);

    const refused = await app.call('POST', '/v1/integrations', {
      token,
      body: {
        name: 'Elsewhere',
        baseUrl: 'https://api.linear.app',
        auth: 'bearer',
        credentialId: credential.id,
        allowedHosts: ['other.test'],
      },
    });
    const refusedId = String((await body(refused)).id);
    const refusal = await app.call('POST', `/v1/integrations/${refusedId}/request`, {
      token,
      body: { method: 'GET', path: '/graphql' },
    });
    expect(refusal.status).toBe(422);
    expect(detailsOf(await body(refusal)).reason).toBe('host_not_allowed');
    expect(app.calls).toHaveLength(1);
  });

  it('requires the runs scope for a request and turns a transport error into 503', async () => {
    const app = harness({
      respond: () => {
        throw new TypeError('fetch failed');
      },
    });
    const admin = app.device();
    const integration = await body(
      await app.call('POST', '/v1/integrations', {
        token: admin,
        body: {
          name: 'Linear',
          baseUrl: 'https://api.linear.app',
          auth: 'none',
          allowedHosts: ['api.linear.app'],
        },
      }),
    );
    const path = `/v1/integrations/${String(integration.id)}/request`;

    const withoutRuns = app.device(['read', 'write', 'admin']);
    const refused = await app.call('POST', path, {
      token: withoutRuns,
      body: { method: 'GET', path: '/graphql' },
    });
    expect(refused.status).toBe(403);
    expect(detailsOf(await body(refused)).reason).toBe('insufficient_scope');

    const unreachable = await app.call('POST', path, {
      token: app.device(['read', 'runs']),
      body: { method: 'GET', path: '/graphql' },
    });
    expect(unreachable.status).toBe(503);
    expect(detailsOf(await body(unreachable)).reason).toBe('integration_unreachable');
  });

  it('runs the GitHub manifest flow and keeps the PEM out of the response', async () => {
    const app = harness({
      respond: () => new Response(JSON.stringify({ id: 456, pem: PEM }), { status: 201 }),
    });
    const token = app.device();
    const started = await app.call('POST', '/v1/integrations/github/manifest', { token });
    expect(started.status).toBe(200);
    const start = await body(started);
    expect(start.action).toBe('https://github.com/settings/apps/new');
    expect(typeof start.manifest).toBe('object');
    expect(typeof start.state).toBe('string');

    const invalid = await app.call('POST', '/v1/integrations/github/complete', {
      token,
      body: { code: 'abc', state: 'wrong' },
    });
    expect(invalid.status).toBe(422);
    expect(detailsOf(await body(invalid)).reason).toBe('state_invalid');

    const completed = await app.call('POST', '/v1/integrations/github/complete', {
      token,
      body: { code: 'abc', state: String(start.state) },
    });
    expect(completed.status).toBe(200);
    const text = await completed.text();
    expect(text).not.toContain(PEM);
    const result = JSON.parse(text) as Record<string, unknown>;
    expect(result.configured).toBe(true);
    expect(result.appId).toBe(456);
    expect(typeof result.credentialId).toBe('string');
    const stored = app.service.storage.get(String(result.credentialId));
    expect(stored?.kind).toBe('github_app');
    expect(stored?.expose).toBe('daemon');
  });

  it('is 503 secrets_not_configured for the manifest without a master key', async () => {
    const app = harness({ configured: false });
    const token = app.device();
    const response = await app.call('POST', '/v1/integrations/github/manifest', { token });
    expect(response.status).toBe(503);
    expect(detailsOf(await body(response)).reason).toBe('secrets_not_configured');
  });
});

describe('no route returns the value', () => {
  it('walks every response of the ten routes and finds no plaintext, seal or long suffix', async () => {
    const app = harness({
      respond: () => new Response('{"graphql":"ok"}', { status: 200 }),
    });
    const admin = app.device();
    const texts: string[] = [];
    const collect = async (response: Response): Promise<void> => {
      texts.push(await response.text());
    };

    await collect(await app.call('GET', '/v1/credentials', { token: admin }));
    const created = await app.call('POST', '/v1/credentials', {
      token: admin,
      body: credentialBody(),
    });
    await collect(created);
    const credential = JSON.parse(texts.at(-1) ?? '{}') as { id?: string };
    const sealed = app.service.storage.get(String(credential.id))?.sealed.ciphertext ?? '';

    await collect(
      await app.call('POST', `/v1/credentials/${String(credential.id)}/rotate`, {
        token: admin,
        body: { value: 'sk-live-ROTATED-0123456789wxyz' },
      }),
    );
    await collect(await app.call('GET', '/v1/integrations', { token: admin }));
    const createdIntegration = await app.call('POST', '/v1/integrations', {
      token: admin,
      body: {
        name: 'Linear',
        baseUrl: 'https://api.linear.app',
        auth: 'bearer',
        credentialId: credential.id,
        allowedHosts: ['api.linear.app'],
      },
    });
    await collect(createdIntegration);
    const integration = JSON.parse(texts.at(-1) ?? '{}') as { id?: string };
    await collect(
      await app.call('POST', `/v1/integrations/${String(integration.id)}/request`, {
        token: admin,
        body: { method: 'GET', path: '/graphql' },
      }),
    );

    const manifest = await app.call('POST', '/v1/integrations/github/manifest', { token: admin });
    await collect(manifest);
    const state = (JSON.parse(texts.at(-1) ?? '{}') as { state?: string }).state;
    await collect(
      await app.call('POST', '/v1/integrations/github/complete', {
        token: admin,
        body: { code: 'abc', state },
      }),
    );
    await collect(
      await app.call('DELETE', `/v1/integrations/${String(integration.id)}`, { token: admin }),
    );
    await collect(
      await app.call('DELETE', `/v1/credentials/${String(credential.id)}`, { token: admin }),
    );

    expect(texts).toHaveLength(10);
    for (const text of texts) {
      expect(text).not.toContain(PLAINTEXT);
      expect(text).not.toContain(sealed);
      for (let index = 0; index + 5 <= PLAINTEXT.length; index += 1) {
        expect(text).not.toContain(PLAINTEXT.slice(index, index + 5));
      }
    }
  });
});

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from '@codebox/contracts';
import type { Scope } from '@codebox/contracts';
import { startFakeOpenCode } from '@codebox/opencode';
import type { FakeOpenCode } from '@codebox/opencode';
import { mintAccessToken, sha256Hex } from '@codebox/security';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { createApp } from '../app.js';
import { createModule as createAuthModule } from '../auth/index.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import { createModule } from './index.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = '2026-10-28T14:55:00.000Z';
const MASTER_KEY = Buffer.alloc(32, 3).toString('base64');
const TOKEN = 'tok_Q7mZ4xR9pL2vB6nK8wT3';

const stores: Store[] = [];
const directories: string[] = [];
const fakes: FakeOpenCode[] = [];

afterEach(async () => {
  for (const fake of fakes.splice(0)) await fake.close();
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
  readonly context: DaemonContext;
  readonly lines: string[];
  device(scopes?: readonly Scope[]): string;
  call(method: string, path: string, options?: RequestOptions): Promise<Response>;
}

interface HarnessOptions {
  readonly configured?: boolean;
}

async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const directory = mkdtempSync(join(tmpdir(), 'cb-73-provider-routes-'));
  directories.push(directory);
  const fake = await startFakeOpenCode({ token: null, version: '0.0.0-test' });
  fakes.push(fake);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_OPENCODE_URL: fake.url,
    ...(options.configured === false ? {} : { CB_SECRETS_KEY: MASTER_KEY }),
  });
  const store = openInMemoryStore();
  stores.push(store);
  const at = new Date(NOW);
  const lines: string[] = [];
  const logger = createLogger({ level: 'trace', sink: (line) => lines.push(line) });
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => at,
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  const app = createApp({ context });
  createAuthModule(context).register(app, context);
  createModule(context).register(app, context);
  let devices = 0;
  return {
    app,
    context,
    lines,
    device(scopes: readonly Scope[] = ['read', 'write', 'runs', 'admin']): string {
      devices += 1;
      const id = `dev_providers${devices}`;
      store.devices.create({
        id,
        name: `Device ${devices}`,
        platform: 'cli',
        publicKey: null,
        fingerprint: null,
        scopes: [...scopes],
        refreshTokenHash: sha256Hex(id),
        refreshPreviousHash: null,
        refreshExpiresAt: new Date(at.getTime() + 86_400_000).toISOString(),
        createdAt: NOW,
        lastSeenAt: null,
        revokedAt: null,
      });
      return mintAccessToken({
        deviceId: id,
        scopes,
        secret: SESSION_SECRET,
        now: at,
        ttlSeconds: 900,
      }).token;
    },
    async call(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
      const headers: Record<string, string> = {};
      if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      const init: RequestInit = { method, headers };
      if (options.body !== undefined) init.body = JSON.stringify(options.body);
      return app.request(path, init);
    },
  };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
  return parsed as Record<string, unknown>;
}

function errorOf(value: Record<string, unknown>): Record<string, unknown> {
  expect(() => errorEnvelopeSchema.parse(value)).not.toThrow();
  const error = value['error'];
  if (typeof error !== 'object' || error === null) throw new Error('no error body');
  return error as Record<string, unknown>;
}

const ACCOUNT_BODY = { label: 'go · main', priority: 1, auth: 'token', value: TOKEN };

function credentialFile(context: DaemonContext, credentialId: string): string {
  return join(context.paths.stateDir, 'secrets', 'credentials', `${credentialId}.json`);
}

describe('GET /v1/providers', () => {
  it('answers the catalog with the accounts, their last four and their spend', async () => {
    const h = await harness();
    const token = h.device();
    const created = await h.call('POST', '/v1/providers/opencode-go/accounts', {
      token,
      body: ACCOUNT_BODY,
    });
    expect(created.status).toBe(201);

    const list = await h.call('GET', '/v1/providers', { token });
    expect(list.status).toBe(200);
    const raw = await list.text();
    expect(raw).not.toContain(TOKEN);
    const parsed = JSON.parse(raw) as {
      providers: {
        id: string;
        accounts: {
          id: string;
          lastFour: string;
          state: string;
          priority: number;
          usedToday: { day: string; usd: number };
        }[];
      }[];
    };
    expect(parsed.providers.map((provider) => provider.id)).toEqual([
      'opencode-go',
      'anthropic',
      'openai',
    ]);
    const accounts = parsed.providers[0]?.accounts ?? [];
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      lastFour: '8wT3',
      state: 'active',
      priority: 1,
      usedToday: { day: '1970-01-01', usd: 0 },
    });
  });

  it('is refused to a device without a scope at all', async () => {
    const h = await harness();
    const anonymous = await h.call('GET', '/v1/providers');
    expect(anonymous.status).toBe(401);
  });
});

describe('POST /v1/providers/{id}/accounts', () => {
  it('refuses a repeated label with a unique violation', async () => {
    const h = await harness();
    const token = h.device();
    const first = await h.call('POST', '/v1/providers/opencode-go/accounts', {
      token,
      body: ACCOUNT_BODY,
    });
    expect(first.status).toBe(201);
    const second = await h.call('POST', '/v1/providers/opencode-go/accounts', {
      token,
      body: { ...ACCOUNT_BODY, priority: 2 },
    });
    expect(second.status).toBe(409);
    expect(errorOf(await body(second))['details']).toEqual({ reason: 'unique_violation' });
  });

  it('refuses the oauth auth kind with a providerAccount path', async () => {
    const h = await harness();
    const token = h.device();
    const response = await h.call('POST', '/v1/providers/opencode-go/accounts', {
      token,
      body: { label: 'go · main', priority: 1, auth: 'oauth', value: TOKEN },
    });
    expect(response.status).toBe(422);
    const details = errorOf(await body(response))['details'] as { path: string };
    expect(details.path.startsWith('providerAccount.')).toBe(true);
  });

  it('refuses an unknown provider and an unknown key', async () => {
    const h = await harness();
    const token = h.device();
    const unknownProvider = await h.call('POST', '/v1/providers/nope/accounts', {
      token,
      body: ACCOUNT_BODY,
    });
    expect(unknownProvider.status).toBe(422);
    expect(errorOf(await body(unknownProvider))['details']).toEqual({ path: 'provider.id' });

    const unknownKey = await h.call('POST', '/v1/providers/opencode-go/accounts', {
      token,
      body: { ...ACCOUNT_BODY, state: 'active' },
    });
    expect(unknownKey.status).toBe(422);
  });

  it('answers 503 when the credential store has no master key', async () => {
    const h = await harness({ configured: false });
    const token = h.device();
    const response = await h.call('POST', '/v1/providers/opencode-go/accounts', {
      token,
      body: ACCOUNT_BODY,
    });
    expect(response.status).toBe(503);
    expect(errorOf(await body(response))['details']).toEqual({
      reason: 'secrets_not_configured',
    });
  });
});

describe('POST /v1/providers/{id}/oauth/start', () => {
  it('refuses a provider with no adapter', async () => {
    const h = await harness();
    const token = h.device();
    const response = await h.call('POST', '/v1/providers/opencode-go/oauth/start', {
      token,
      body: { label: 'go · main', priority: 1 },
    });
    expect(response.status).toBe(422);
    expect(errorOf(await body(response))['details']).toEqual({
      path: 'provider.id',
      reason: 'provider_oauth_unsupported',
    });
  });
});

describe('PATCH /v1/provider-accounts/{id}', () => {
  it('refuses to disable the only active account', async () => {
    const h = await harness();
    const token = h.device();
    const created = await body(
      await h.call('POST', '/v1/providers/opencode-go/accounts', { token, body: ACCOUNT_BODY }),
    );
    const id = created['id'] as string;

    const refused = await h.call('PATCH', `/v1/provider-accounts/${id}`, {
      token,
      body: { enabled: false },
    });
    expect(refused.status).toBe(409);
    expect(errorOf(await body(refused))['details']).toEqual({ reason: 'no_active_account' });
  });

  it('disables an account once a second one is active', async () => {
    const h = await harness();
    const token = h.device();
    const created = await body(
      await h.call('POST', '/v1/providers/opencode-go/accounts', { token, body: ACCOUNT_BODY }),
    );
    await h.call('POST', '/v1/providers/opencode-go/accounts', {
      token,
      body: { ...ACCOUNT_BODY, label: 'go · spare', priority: 2 },
    });

    const patched = await h.call('PATCH', `/v1/provider-accounts/${created['id'] as string}`, {
      token,
      body: { enabled: false },
    });
    expect(patched.status).toBe(200);
    const account = await body(patched);
    expect(account['state']).toBe('disabled');
    expect(account['resetAt']).toBeNull();
    expect(account['lastFour']).toBe('8wT3');
  });

  it('answers 404 for an unknown account', async () => {
    const h = await harness();
    const token = h.device();
    const response = await h.call('PATCH', '/v1/provider-accounts/acct_missing000', {
      token,
      body: { label: 'go · renamed' },
    });
    expect(response.status).toBe(404);
    expect(errorOf(await body(response))['details']).toEqual({ path: 'providerAccount.id' });
  });
});

describe('DELETE /v1/provider-accounts/{id}', () => {
  it('refuses the only active account and removes the credential of another', async () => {
    const h = await harness();
    const token = h.device();
    const created = await body(
      await h.call('POST', '/v1/providers/opencode-go/accounts', { token, body: ACCOUNT_BODY }),
    );
    const id = created['id'] as string;
    const credentialId = created['credentialId'] as string;
    expect(existsSync(credentialFile(h.context, credentialId))).toBe(true);

    const refused = await h.call('DELETE', `/v1/provider-accounts/${id}`, { token });
    expect(refused.status).toBe(409);
    expect(errorOf(await body(refused))['details']).toEqual({ reason: 'no_active_account' });
    expect(existsSync(credentialFile(h.context, credentialId))).toBe(true);

    await h.call('POST', '/v1/providers/opencode-go/accounts', {
      token,
      body: { ...ACCOUNT_BODY, label: 'go · spare', priority: 2 },
    });
    const removed = await h.call('DELETE', `/v1/provider-accounts/${id}`, { token });
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe('');
    expect(existsSync(credentialFile(h.context, credentialId))).toBe(false);
  });

  it('answers 404 for an unknown account', async () => {
    const h = await harness();
    const token = h.device();
    expect(
      (await h.call('DELETE', '/v1/provider-accounts/acct_missing000', { token })).status,
    ).toBe(404);
  });
});

describe('POST /v1/provider-accounts/{id}/test', () => {
  it('answers the three fields and whether the agent knows the provider', async () => {
    const h = await harness();
    const token = h.device();
    const anthropic = await body(
      await h.call('POST', '/v1/providers/anthropic/accounts', {
        token,
        body: { label: 'anthropic · main', priority: 1, auth: 'token', value: TOKEN },
      }),
    );
    const known = await h.call('POST', `/v1/provider-accounts/${anthropic['id'] as string}/test`, {
      token,
    });
    expect(known.status).toBe(200);
    expect(await body(known)).toEqual({ ok: true, state: 'active', lastError: null });

    const go = await body(
      await h.call('POST', '/v1/providers/opencode-go/accounts', { token, body: ACCOUNT_BODY }),
    );
    const unknown = await h.call('POST', `/v1/provider-accounts/${go['id'] as string}/test`, {
      token,
    });
    expect(unknown.status).toBe(200);
    expect(await body(unknown)).toEqual({
      ok: false,
      state: 'active',
      lastError: 'provider_unknown',
    });
  });
});

describe('scopes and logs', () => {
  it('refuses every mutating route to a read-only device and keeps the GET open', async () => {
    const h = await harness();
    const reader = h.device(['read']);
    const writer = h.device();
    const created = await body(
      await h.call('POST', '/v1/providers/opencode-go/accounts', {
        token: writer,
        body: ACCOUNT_BODY,
      }),
    );
    const id = created['id'] as string;

    expect((await h.call('GET', '/v1/providers', { token: reader })).status).toBe(200);
    const mutations: readonly [string, string, unknown?][] = [
      ['POST', '/v1/providers/opencode-go/accounts', ACCOUNT_BODY],
      ['POST', '/v1/providers/opencode-go/oauth/start', { label: 'go · main', priority: 1 }],
      ['POST', '/v1/providers/opencode-go/oauth/complete', { code: 'a', state: 'b' }],
      ['PATCH', `/v1/provider-accounts/${id}`, { priority: 3 }],
      ['POST', `/v1/provider-accounts/${id}/test`],
      ['DELETE', `/v1/provider-accounts/${id}`],
    ];
    for (const [method, path, requestBody] of mutations) {
      const response = await h.call(
        method,
        path,
        requestBody === undefined ? { token: reader } : { token: reader, body: requestBody },
      );
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(errorOf(await body(response))['details']).toEqual({ reason: 'insufficient_scope' });
    }
  });

  it('emits no log line carrying the token', async () => {
    const h = await harness();
    const token = h.device();
    const created = await body(
      await h.call('POST', '/v1/providers/opencode-go/accounts', { token, body: ACCOUNT_BODY }),
    );
    await h.call('GET', '/v1/providers', { token });
    await h.call('POST', `/v1/provider-accounts/${created['id'] as string}/test`, { token });
    await h.call('PATCH', `/v1/provider-accounts/${created['id'] as string}`, {
      token,
      body: { enabled: true },
    });

    expect(h.lines.length).toBeGreaterThan(0);
    for (const line of h.lines) {
      expect(line).not.toContain(TOKEN);
      for (let length = 5; length <= TOKEN.length; length += 1) {
        expect(line).not.toContain(TOKEN.slice(0, length));
      }
    }
  });
});

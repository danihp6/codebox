import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { errorEnvelopeSchema, parseBrake, parseSettings } from '@codebox/contracts';
import type { Scope } from '@codebox/contracts';
import { mintAccessToken, sha256Hex } from '@codebox/security';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import type { WorkspaceManager, WorktreeInfo } from '@codebox/workspaces';
import { createApp } from '../app.js';
import { createModule as createAuthModule } from '../auth/index.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import { registerSettingsRoutes } from './routes.js';
import { createSettingsService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const ACCESS_TTL_SECONDS = 900;
const NOW = '2026-11-10T00:00:00.000Z';

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

interface Harness {
  readonly app: DaemonApp;
  readonly store: Store;
  device(scopes?: readonly Scope[]): string;
  call(
    method: string,
    path: string,
    options?: { token?: string; body?: unknown },
  ): Promise<Response>;
}

function harness(infos: readonly WorktreeInfo[] = []): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-106-admin-routes-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
    CB_AUTOMERGE: 'on',
  });
  const store = openInMemoryStore();
  stores.push(store);
  const logger = createLogger({ level: 'warn', sink: () => undefined });
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => new Date(NOW),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  const workspaces = {
    listWorktrees: async (): Promise<readonly WorktreeInfo[]> => infos,
    removeWorktree: async (): Promise<void> => undefined,
  } as unknown as WorkspaceManager;
  const app = createApp({ context });
  createAuthModule(context).register(app, context);
  registerSettingsRoutes(app, createSettingsService({ context, workspaces }));
  let devices = 0;
  return {
    app,
    store,
    device(scopes: readonly Scope[] = ['read']): string {
      devices += 1;
      const id = `dev_admin${String(devices).padStart(3, '0')}`;
      store.devices.create({
        id,
        name: `Device ${devices}`,
        platform: 'cli',
        publicKey: null,
        fingerprint: null,
        scopes: [...scopes],
        refreshTokenHash: sha256Hex(id),
        refreshPreviousHash: null,
        refreshExpiresAt: new Date(Date.parse(NOW) + 86_400_000).toISOString(),
        createdAt: NOW,
        lastSeenAt: null,
        revokedAt: null,
      });
      return mintAccessToken({
        deviceId: id,
        scopes,
        secret: SESSION_SECRET,
        now: new Date(NOW),
        ttlSeconds: ACCESS_TTL_SECONDS,
      }).token;
    },
    async call(method, path, callOptions = {}): Promise<Response> {
      const headers: Record<string, string> = {};
      if (callOptions.token !== undefined) headers['authorization'] = `Bearer ${callOptions.token}`;
      const init: RequestInit = { method, headers };
      if (callOptions.body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(callOptions.body);
      }
      return app.request(path, init);
    },
  };
}

async function errorOf(response: Response): Promise<{ code: string; details?: unknown }> {
  const body = errorEnvelopeSchema.parse(await response.json());
  return { code: body.error.code, details: body.error.details };
}

describe('GET /v1/settings', () => {
  it('answers the nine keys for a read device', async () => {
    const test = harness();
    const response = await test.call('GET', '/v1/settings', { token: test.device(['read']) });
    expect(response.status).toBe(200);
    expect(parseSettings(await response.json())).toMatchObject({
      automerge: true,
      timezone: 'Europe/Madrid',
    });
  });

  it('is guarded like every other /v1 route', async () => {
    const test = harness();
    expect((await test.call('GET', '/v1/settings')).status).toBe(401);
  });
});

describe('PATCH /v1/settings', () => {
  it('writes the time zone and serves it back', async () => {
    const test = harness();
    const token = test.device(['read', 'write']);
    const patched = await test.call('PATCH', '/v1/settings', {
      token,
      body: { timezone: 'UTC' },
    });
    expect(patched.status).toBe(200);
    expect(parseSettings(await patched.json()).timezone).toBe('UTC');
    const read = await test.call('GET', '/v1/settings', { token });
    expect(parseSettings(await read.json()).timezone).toBe('UTC');
  });

  it('refuses automerge: the brake owns that key', async () => {
    const test = harness();
    const response = await test.call('PATCH', '/v1/settings', {
      token: test.device(['read', 'write']),
      body: { automerge: false },
    });
    expect(response.status).toBe(422);
    expect(await errorOf(response)).toMatchObject({
      code: 'validation_failed',
      details: { path: 'settings.automerge' },
    });
  });

  it('refuses a read-only device before reading the body', async () => {
    const test = harness();
    const response = await test.call('PATCH', '/v1/settings', {
      token: test.device(['read']),
      body: { timezone: 'UTC' },
    });
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatchObject({
      code: 'forbidden',
      details: { reason: 'insufficient_scope' },
    });
  });
});

describe('POST /v1/admin/brake', () => {
  it('needs the admin scope', async () => {
    const test = harness();
    const response = await test.call('POST', '/v1/admin/brake', {
      token: test.device(['read', 'write']),
      body: { enabled: true },
    });
    expect(response.status).toBe(403);
  });

  it('arms the brake and GET /v1/settings reports automerge false', async () => {
    const test = harness();
    const token = test.device(['read', 'admin']);
    const armed = await test.call('POST', '/v1/admin/brake', {
      token,
      body: { enabled: true },
    });
    expect(armed.status).toBe(200);
    expect(parseBrake(await armed.json())).toEqual({ enabled: true });
    const read = await test.call('GET', '/v1/settings', { token });
    expect(parseSettings(await read.json()).automerge).toBe(false);
    expect(test.store.settings.get('automerge')).toBe(false);
  });
});

describe('POST /v1/admin/cache/wipe', () => {
  it('answers 202 with no body for an admin device', async () => {
    const test = harness();
    const response = await test.call('POST', '/v1/admin/cache/wipe', {
      token: test.device(['read', 'admin']),
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('needs the admin scope', async () => {
    const test = harness();
    const response = await test.call('POST', '/v1/admin/cache/wipe', {
      token: test.device(['read', 'write']),
    });
    expect(response.status).toBe(403);
  });
});

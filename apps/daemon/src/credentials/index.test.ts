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
import type { DaemonContext } from '../modules.js';
import { createModule } from './index.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = '2026-10-27T10:00:00.000Z';
const MASTER_KEY = Buffer.alloc(32, 2).toString('base64');

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

interface Fixture {
  readonly context: DaemonContext;
  readonly lines: string[];
  token(scopes?: readonly Scope[]): string;
}

function fixture(configured: boolean): Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'cb-58-module-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
    ...(configured ? { CB_SECRETS_KEY: MASTER_KEY } : {}),
  });
  const store = openInMemoryStore();
  stores.push(store);
  const now = new Date(NOW);
  const lines: string[] = [];
  const logger = createLogger({ level: 'trace', sink: (line) => lines.push(line) });
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
  let devices = 0;
  return {
    context,
    lines,
    token(scopes: readonly Scope[] = ['read', 'write', 'runs', 'admin']): string {
      devices += 1;
      const id = `dev_module${devices}`;
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
  };
}

describe('credentials module', () => {
  it('is named credentials and mounts the credential and integration routes', async () => {
    const { context, token } = fixture(true);
    const app = createApp({ context });
    createAuthModule(context).register(app, context);
    const module = createModule(context);
    expect(module.name).toBe('credentials');
    module.register(app, context);

    const headers = { authorization: `Bearer ${token()}` };
    const credentials = await app.request('/v1/credentials', { headers });
    expect(credentials.status).toBe(200);
    expect(await credentials.json()).toEqual({ data: [], nextCursor: null });
    const integrations = await app.request('/v1/integrations', { headers });
    expect(integrations.status).toBe(200);
    expect(await integrations.json()).toEqual({ data: [], nextCursor: null });
  });

  it('warns once at boot when the store has no master key', async () => {
    const { context, lines } = fixture(false);
    const app = createApp({ context });
    const module = createModule(context);
    module.register(app, context);
    const warnings = lines.filter((line) => line.includes('secrets_store_unconfigured'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"level":"warn"');
  });
});

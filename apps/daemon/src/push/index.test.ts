import { createECDH } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
const SUBJECT = 'mailto:ops@example.com';

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface VapidPair {
  readonly publicKey: string;
  readonly privateKey: string;
}

function vapidPair(): VapidPair {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url'),
  };
}

interface Harness {
  readonly context: DaemonContext;
  readonly lines: Record<string, unknown>[];
}

function harness(vapid?: VapidPair): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-16-push-module-'));
  directories.push(directory);
  const appDir = join(directory, 'app');
  mkdirSync(appDir, { recursive: true });
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_LOG_LEVEL: 'debug',
    ...(vapid === undefined
      ? {}
      : {
          CB_VAPID_PUBLIC_KEY: vapid.publicKey,
          CB_VAPID_PRIVATE_KEY: vapid.privateKey,
          CB_VAPID_SUBJECT: SUBJECT,
        }),
  });
  const store = openInMemoryStore();
  stores.push(store);
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => new Date('2026-10-25T10:00:00.000Z'),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir,
    shutdown: createShutdownRegistry(logger),
  };
  return { context, lines };
}

describe('push module', () => {
  it('is the `push` seam and mounts the four guarded routes while unconfigured', async () => {
    const { context, lines } = harness();
    const module = createModule(context);
    expect(module.name).toBe('push');
    expect(lines.filter((line) => line['msg'] === 'push_unconfigured')).toHaveLength(1);

    const app = createApp({ context });
    createAuthModule(context).register(app, context);
    module.register(app, context);

    for (const [method, path] of [
      ['GET', '/v1/notifications/preferences'],
      ['PATCH', '/v1/notifications/preferences'],
      ['POST', '/v1/push/subscriptions'],
      ['DELETE', '/v1/push/subscriptions/sub_01JABCDEFG'],
    ] as [string, string][]) {
      const response = await app.request(path, { method });
      expect(response.status).toBe(401);
    }

    expect(() => {
      module.shutdown?.();
      module.shutdown?.();
    }).not.toThrow();
  });

  it('stays unconfigured and never throws when the vapid key is invalid', () => {
    const { context, lines } = harness({ publicKey: 'not-a-key', privateKey: 'not-a-key' });
    expect(() => {
      const module = createModule(context);
      const app = createApp({ context });
      module.register(app, context);
      module.shutdown?.();
    }).not.toThrow();
    expect(lines.filter((line) => line['msg'] === 'push_config_invalid')).toHaveLength(1);
  });

  it('starts one pump timer when vapid is configured and clears it on shutdown', () => {
    const pair = vapidPair();
    const { context } = harness(pair);
    vi.useFakeTimers();
    try {
      const module = createModule(context);
      const app = createApp({ context });
      expect(vi.getTimerCount()).toBe(0);
      module.register(app, context);
      expect(vi.getTimerCount()).toBe(1);
      module.shutdown?.();
      expect(vi.getTimerCount()).toBe(0);
      module.shutdown?.();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

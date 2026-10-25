import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CodeboxConfig } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { createApp } from '../app.js';
import { loadConfig, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { startDaemon } from '../main.js';
import type { DaemonHandle } from '../main.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry, loadModules } from '../modules.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const roots: string[] = [];
const handles: DaemonHandle[] = [];
const stores: Store[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop('test-teardown');
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cb-14-seam-'));
  roots.push(directory);
  return directory;
}

function testEnv(root: string): NodeJS.ProcessEnv {
  return {
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_BIND: '127.0.0.1:0',
    CB_STATE_DIR: join(root, 'state'),
    CB_INSTALL_DIR: join(root, 'install'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
    CB_LOG_LEVEL: 'error',
  };
}

describe('run and gate as module seams', () => {
  it('loadModules reports both subsystem directories as absent, never failed', async () => {
    const root = temporaryRoot();
    const config: CodeboxConfig = loadConfig(testEnv(root));
    const store = openInMemoryStore();
    stores.push(store);
    const context = {
      config,
      store,
      logger: createLogger({ level: 'error', sink: () => undefined }),
      clock: () => new Date('2026-10-25T10:00:00.000Z'),
      flags: DEFAULT_SUBSYSTEM_FLAGS,
      build: { version: '0.0.0', commit: null, builtAt: null },
      paths: resolvePaths(config),
      appDir: join(root, 'install', 'app'),
      shutdown: createShutdownRegistry(createLogger({ level: 'error', sink: () => undefined })),
    };
    const report = await loadModules({ app: createApp({ context }), context });

    expect(report.failed).toEqual([]);
    expect(report.absent).toContain('run');
    expect(report.absent).toContain('gate');
    expect(report.loaded).toEqual([]);
  });

  it('startDaemon still boots on an ephemeral port with a temporary state directory', async () => {
    const root = temporaryRoot();
    const handle = await startDaemon({
      env: testEnv(root),
      sink: () => undefined,
    });
    handles.push(handle);

    expect(handle.port).toBeGreaterThan(0);
    expect(handle.hostname).toBe('127.0.0.1');
    expect(handle.report.failed).toEqual([]);
    expect(handle.report.absent).toContain('run');
    expect(handle.report.absent).toContain('gate');

    const health = await fetch(`http://127.0.0.1:${handle.port}/v1/health`);
    expect(health.status).toBe(200);
  });
});

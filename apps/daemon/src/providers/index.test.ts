import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import {
  DEFAULT_SUBSYSTEM_FLAGS,
  SUBSYSTEMS,
  createShutdownRegistry,
  loadModules,
} from '../modules.js';
import type { AppVariables, DaemonApp, DaemonContext, SubsystemName } from '../modules.js';
import { createModule, providersServiceFor } from './index.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = '2026-10-28T10:00:00.000Z';

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function makeContext(): DaemonContext {
  const directory = mkdtempSync(join(tmpdir(), 'cb-73-module-'));
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
  const logger = createLogger({ level: 'error', sink: () => undefined });
  return {
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
}

function makeApp(): DaemonApp {
  return new Hono<{ Variables: AppVariables }>();
}

function moduleNotFound(name: SubsystemName): Error {
  return Object.assign(
    new Error(
      `Cannot find module '/app/daemon/dist/${name}/index.js' imported from /app/daemon/dist/modules.js`,
    ),
    { code: 'ERR_MODULE_NOT_FOUND' },
  );
}

describe('providers module', () => {
  it('is named providers', () => {
    const context = makeContext();
    expect(createModule(context).name).toBe('providers');
  });

  it('seeds the catalog on module creation', () => {
    const context = makeContext();
    createModule(context);
    expect(context.store.providers.list().map((provider) => provider.id)).toEqual([
      'anthropic',
      'openai',
      'opencode-go',
    ]);
  });

  it('builds one service per context', () => {
    const first = makeContext();
    const second = makeContext();
    expect(providersServiceFor(first)).toBe(providersServiceFor(first));
    expect(providersServiceFor(first)).not.toBe(providersServiceFor(second));
  });

  it('loads through the subsystem seam and reports the rest absent', async () => {
    const context = makeContext();
    const report = await loadModules({
      app: makeApp(),
      context,
      importModule: async (specifier: string): Promise<unknown> => {
        if (specifier.endsWith('/providers/index.js')) return import('./index.js');
        const name = specifier.split('/').at(-2) as SubsystemName;
        throw moduleNotFound(name);
      },
    });
    expect(report.loaded).toEqual(['providers']);
    expect(report.absent).toEqual(SUBSYSTEMS.filter((name) => name !== 'providers'));
    expect(report.failed).toEqual([]);
    expect(report.disabled).toEqual([]);
  });
});

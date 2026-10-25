import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { createModule } from './index.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeApp(): DaemonApp {
  return new Hono<{ Variables: AppVariables }>();
}

function makeContext(store: Store = openInMemoryStore()): DaemonContext {
  const directory = mkdtempSync(join(tmpdir(), 'cb-35-routine-module-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
  });
  const logger = createLogger({ level: 'error', sink: () => undefined });
  return {
    config,
    store,
    logger,
    clock: () => new Date('2026-10-25T10:00:00.000Z'),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
}

function moduleNotFound(name: SubsystemName): Error {
  const error = new Error(
    `Cannot find module '/app/daemon/dist/${name}/index.js' imported from modules.js`,
  );
  return Object.assign(error, { code: 'ERR_MODULE_NOT_FOUND' });
}

describe('routines module', () => {
  it('loads as the routines subsystem under the default flags', async () => {
    const store = openInMemoryStore();
    stores.push(store);
    const context = makeContext(store);

    const report = await loadModules({
      app: makeApp(),
      context,
      importModule: async (specifier: string): Promise<unknown> => {
        const name = specifier.split('/').at(-2) as SubsystemName;
        if (name === 'routines') return import('./index.js');
        throw moduleNotFound(name);
      },
    });

    expect(report.loaded).toEqual(['routines']);
    expect(report.failed).toEqual([]);
    expect(report.absent).toEqual(SUBSYSTEMS.filter((name) => name !== 'routines'));
    const results = await context.shutdown.run();
    expect(results).toEqual([{ name: 'module:routines', error: null }]);
  });

  it('builds without touching the store and stops twice', () => {
    const context = makeContext();
    const store = context.store;
    stores.push(store);
    const unread = new Proxy(context.store, {
      get(): never {
        throw new Error('the routines module must not query at build time');
      },
    });
    const stub: DaemonContext = { ...context, store: unread };

    const module = createModule(stub);
    expect(module.name).toBe('routines');
    expect(() => {
      module.shutdown?.();
      module.shutdown?.();
    }).not.toThrow();
  });

  it('starts one tick timer on register and clears it on shutdown', () => {
    const store = openInMemoryStore();
    stores.push(store);
    const context = makeContext(store);
    vi.useFakeTimers();

    const module = createModule(context);
    const app = makeApp();
    expect(vi.getTimerCount()).toBe(0);

    module.register(app, context);
    expect(vi.getTimerCount()).toBe(1);

    module.shutdown?.();
    expect(vi.getTimerCount()).toBe(0);
    module.shutdown?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not restart the timer after a stop', () => {
    const store = openInMemoryStore();
    stores.push(store);
    const context = makeContext(store);
    vi.useFakeTimers();

    const module = createModule(context);
    module.register(makeApp(), context);
    module.shutdown?.();
    module.register(makeApp(), context);

    expect(vi.getTimerCount()).toBe(0);
  });
});

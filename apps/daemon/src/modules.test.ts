import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { loadConfig, readBuildInfo, resolvePaths } from './config.js';
import { createLogger } from './logger.js';
import {
  DEFAULT_SUBSYSTEM_FLAGS,
  SUBSYSTEMS,
  createShutdownRegistry,
  isMissingSubsystem,
  loadModules,
  subsystemPath,
} from './modules.js';
import type {
  AppVariables,
  DaemonApp,
  DaemonContext,
  DaemonModule,
  SubsystemFlags,
  SubsystemName,
} from './modules.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';

const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function makeContext(flags: SubsystemFlags): DaemonContext {
  const config = loadConfig({ CB_ENV: 'test', CB_SESSION_SECRET: SESSION_SECRET });
  const store = openInMemoryStore();
  stores.push(store);
  const logger = createLogger({ level: 'error', sink: () => undefined });
  return {
    config,
    store,
    logger,
    clock: () => new Date('2026-10-25T00:00:00.000Z'),
    flags,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: '/nonexistent/app',
    shutdown: createShutdownRegistry(logger),
  };
}

function makeApp(): DaemonApp {
  return new Hono<{ Variables: AppVariables }>();
}

function only(name: SubsystemName): SubsystemFlags {
  const flags: Record<SubsystemName, boolean> = {
    auth: false,
    events: false,
    run: false,
    gate: false,
    jobs: false,
    runs: false,
    push: false,
    schedules: false,
    credentials: false,
    providers: false,
    telemetry: false,
    cli: false,
    works: false,
    backlog: false,
    sessions: false,
    design: false,
  };
  flags[name] = true;
  return flags;
}

function withCode(message: string, code: string): Error {
  const error = new Error(message);
  return Object.assign(error, { code });
}

function moduleNotFound(name: SubsystemName): Error {
  return withCode(
    `Cannot find module '/app/daemon/dist/${name}/index.js' imported from /app/daemon/dist/modules.js`,
    'ERR_MODULE_NOT_FOUND',
  );
}

describe('subsystems', () => {
  it('lists the sixteen subsystems in order, append-only', () => {
    expect([...SUBSYSTEMS]).toEqual([
      'auth',
      'events',
      'run',
      'gate',
      'jobs',
      'runs',
      'push',
      'schedules',
      'credentials',
      'providers',
      'telemetry',
      'cli',
      'works',
      'backlog',
      'sessions',
      'design',
    ]);
  });

  it('keeps the bootstrapped names at their indices', () => {
    expect(SUBSYSTEMS[0]).toBe('auth');
    expect(SUBSYSTEMS.indexOf('cli')).toBe(11);
    expect(SUBSYSTEMS.slice(12)).toEqual(['works', 'backlog', 'sessions', 'design']);
  });

  it('enables every subsystem by default', () => {
    expect(Object.keys(DEFAULT_SUBSYSTEM_FLAGS)).toEqual([...SUBSYSTEMS]);
    expect(Object.values(DEFAULT_SUBSYSTEM_FLAGS).every((flag) => flag)).toBe(true);
  });

  it('maps a subsystem to its candidate file', () => {
    expect(subsystemPath('auth')).toBe('./auth/index.js');
    expect(subsystemPath('cli')).toBe('./cli/index.js');
  });
});

describe('createShutdownRegistry', () => {
  it('runs hooks in reverse registration order, sequentially', async () => {
    const logger = createLogger({ level: 'error', sink: () => undefined });
    const registry = createShutdownRegistry(logger);
    const order: string[] = [];
    registry.register('first', async () => {
      await Promise.resolve();
      order.push('first');
    });
    registry.register('second', () => {
      order.push('second');
    });
    const results = await registry.run();
    expect(order).toEqual(['second', 'first']);
    expect(results).toEqual([
      { name: 'second', error: null },
      { name: 'first', error: null },
    ]);
  });

  it('never throws: a failing hook becomes an error entry', async () => {
    const logger = createLogger({ level: 'error', sink: () => undefined });
    const registry = createShutdownRegistry(logger);
    registry.register('ok', () => undefined);
    registry.register('broken', () => {
      throw new Error('hook failed');
    });
    const results = await registry.run();
    expect(results).toEqual([
      { name: 'broken', error: 'hook failed' },
      { name: 'ok', error: null },
    ]);
  });
});

describe('isMissingSubsystem', () => {
  const message =
    "Cannot find module '/app/daemon/dist/auth/index.js' imported from /app/daemon/dist/modules.js";

  it('accepts an ERR_MODULE_NOT_FOUND for the subsystem file', () => {
    expect(isMissingSubsystem(withCode(message, 'ERR_MODULE_NOT_FOUND'), 'auth')).toBe(true);
  });

  it('accepts a message that carries the relative subsystem path', () => {
    const error = withCode("Cannot find module './auth/index.js'", 'ERR_MODULE_NOT_FOUND');
    expect(isMissingSubsystem(error, 'auth')).toBe(true);
  });

  it('rejects a different subsystem', () => {
    expect(isMissingSubsystem(withCode(message, 'ERR_MODULE_NOT_FOUND'), 'events')).toBe(false);
  });

  it('rejects a missing dependency inside an existing module', () => {
    const error = withCode(
      "Cannot find package 'hono' imported from /app/daemon/dist/auth/index.js",
      'ERR_MODULE_NOT_FOUND',
    );
    expect(isMissingSubsystem(error, 'auth')).toBe(false);
  });

  it('rejects another error code and a non-error value', () => {
    expect(isMissingSubsystem(withCode(message, 'ERR_UNSUPPORTED_DIR_IMPORT'), 'auth')).toBe(false);
    expect(isMissingSubsystem('nope', 'auth')).toBe(false);
    expect(isMissingSubsystem(null, 'auth')).toBe(false);
  });
});

describe('loadModules', () => {
  it('imports nothing when every flag is off', async () => {
    const context = makeContext({
      auth: false,
      events: false,
      run: false,
      gate: false,
      jobs: false,
      runs: false,
      push: false,
      schedules: false,
      credentials: false,
      providers: false,
      telemetry: false,
      cli: false,
      works: false,
      backlog: false,
      sessions: false,
      design: false,
    });
    const imported: string[] = [];
    const report = await loadModules({
      app: makeApp(),
      context,
      importModule: async (specifier: string): Promise<unknown> => {
        imported.push(specifier);
        return {};
      },
    });
    expect(imported).toEqual([]);
    expect(report.disabled).toEqual([...SUBSYSTEMS]);
    expect(report.loaded).toEqual([]);
    expect(report.absent).toEqual([]);
    expect(report.failed).toEqual([]);
  });

  it('reports a missing subsystem file as absent, in order', async () => {
    const context = makeContext(DEFAULT_SUBSYSTEM_FLAGS);
    const report = await loadModules({
      app: makeApp(),
      context,
      importModule: async (specifier: string): Promise<unknown> => {
        const name = specifier.split('/').at(-2) as SubsystemName;
        throw moduleNotFound(name);
      },
    });
    expect(report.absent).toEqual([...SUBSYSTEMS]);
    expect(report.disabled).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(report.loaded).toEqual([]);
  });

  it('reports a missing dependency inside a module as failed', async () => {
    const context = makeContext(only('auth'));
    const report = await loadModules({
      app: makeApp(),
      context,
      importModule: async (): Promise<unknown> => {
        throw withCode(
          "Cannot find package 'zod' imported from /app/daemon/dist/auth/index.js",
          'ERR_MODULE_NOT_FOUND',
        );
      },
    });
    expect(report.loaded).toEqual([]);
    expect(report.absent).toEqual([]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.name).toBe('auth');
    expect(report.failed[0]?.error).toContain("Cannot find package 'zod'");
  });

  it('reports a module without createModule as failed', async () => {
    const context = makeContext(only('auth'));
    const report = await loadModules({
      app: makeApp(),
      context,
      importModule: async (): Promise<unknown> => ({}),
    });
    expect(report.failed).toEqual([{ name: 'auth', error: 'no createModule export' }]);
  });

  it('reports a throwing register as failed and keeps walking', async () => {
    const context = makeContext({ ...only('auth'), events: true });
    const report = await loadModules({
      app: makeApp(),
      context,
      importModule: async (specifier: string): Promise<unknown> => {
        const name = specifier.split('/').at(-2) as SubsystemName;
        return {
          createModule: (): DaemonModule => ({
            name,
            register: (): void => {
              if (name === 'auth') throw new Error('auth exploded');
            },
          }),
        };
      },
    });
    expect(report.loaded).toEqual(['events']);
    expect(report.failed).toEqual([{ name: 'auth', error: 'auth exploded' }]);
  });

  it('registers a loaded module and its shutdown hook', async () => {
    const context = makeContext(only('auth'));
    const app = makeApp();
    const registered: string[] = [];
    const stopped: string[] = [];
    const report = await loadModules({
      app,
      context,
      importModule: async (): Promise<unknown> => ({
        createModule: (seen: DaemonContext): DaemonModule => ({
          name: 'auth',
          register: (target: DaemonApp, moduleContext: DaemonContext): void => {
            expect(target).toBe(app);
            expect(moduleContext).toBe(context);
            expect(seen).toBe(context);
            registered.push('auth');
            target.get('/v1/auth/probe', (c) => c.json({ requestId: c.get('requestId') }));
          },
          shutdown: (): void => {
            stopped.push('auth');
          },
        }),
      }),
    });
    expect(report.loaded).toEqual(['auth']);
    expect(registered).toEqual(['auth']);
    expect(report.disabled).toHaveLength(SUBSYSTEMS.length - 1);
    const results = await context.shutdown.run();
    expect(results).toEqual([{ name: 'module:auth', error: null }]);
    expect(stopped).toEqual(['auth']);
  });

  it('builds the candidate URL from the injected root', async () => {
    const context = makeContext(only('cli'));
    const seen: string[] = [];
    await loadModules({
      app: makeApp(),
      context,
      root: new URL('file:///app/daemon/dist/'),
      importModule: async (specifier: string): Promise<unknown> => {
        seen.push(specifier);
        throw moduleNotFound('cli');
      },
    });
    expect(seen).toEqual(['file:///app/daemon/dist/cli/index.js']);
  });
});

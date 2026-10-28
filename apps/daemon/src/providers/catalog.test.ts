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
import { PROVIDER_CATALOG, seedProviderCatalog } from './catalog.js';
import { createProvidersService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const FIRST = '2026-10-28T10:00:00.000Z';
const SECOND = '2026-10-29T10:00:00.000Z';

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function makeStore(): Store {
  const store = openInMemoryStore();
  stores.push(store);
  return store;
}

function makeContext(store: Store): DaemonContext {
  const directory = mkdtempSync(join(tmpdir(), 'cb-73-catalog-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
  });
  const logger = createLogger({ level: 'error', sink: () => undefined });
  return {
    config,
    store,
    logger,
    clock: () => new Date(FIRST),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
}

describe('PROVIDER_CATALOG', () => {
  it('holds the three adapters with their auth kind', () => {
    expect(PROVIDER_CATALOG.map((descriptor) => descriptor.id)).toEqual([
      'opencode-go',
      'anthropic',
      'openai',
    ]);
    expect(PROVIDER_CATALOG.map((descriptor) => descriptor.authKind)).toEqual([
      'oauth',
      'token',
      'token',
    ]);
  });
});

describe('seedProviderCatalog', () => {
  it('leaves exactly the three catalog rows', () => {
    const store = makeStore();
    const seeded = seedProviderCatalog(store, FIRST);
    expect(seeded.map((provider) => provider.id)).toEqual(['opencode-go', 'anthropic', 'openai']);
    expect(store.providers.list()).toHaveLength(3);
  });

  it('writes nothing on a second call', () => {
    const store = makeStore();
    const first = seedProviderCatalog(store, FIRST);
    const second = seedProviderCatalog(store, SECOND);
    expect(second).toEqual(first);
    expect(second.map((provider) => provider.updatedAt)).toEqual([FIRST, FIRST, FIRST]);
    expect(store.providers.list()).toHaveLength(3);
  });

  it('serves the providers in catalog order', () => {
    const store = makeStore();
    seedProviderCatalog(store, FIRST);
    const service = createProvidersService({ context: makeContext(store) });
    expect(service.list().providers.map((provider) => provider.id)).toEqual([
      'opencode-go',
      'anthropic',
      'openai',
    ]);
  });
});

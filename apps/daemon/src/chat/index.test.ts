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
import { chatServiceFor, createModule } from './index.js';
import { chatRuntimeOf } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeContext(): DaemonContext {
  const directory = mkdtempSync(join(tmpdir(), 'cb-35-chat-accessor-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
  });
  const store = openInMemoryStore();
  stores.push(store);
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

describe('chatServiceFor', () => {
  it('is null before the chat module is created and the module instance afterwards', () => {
    const context = makeContext();

    expect(chatServiceFor(context)).toBeNull();

    const module = createModule(context);
    const service = chatServiceFor(context);

    expect(service).not.toBeNull();
    expect(chatServiceFor(context)).toBe(service);
    if (service === null) throw new Error('the chat module did not register its service');
    expect(chatRuntimeOf(service).store).toBe(context.store);
    module.shutdown?.();
  });

  it('keeps one service per daemon context', () => {
    const first = makeContext();
    const second = makeContext();

    const module = createModule(first);

    expect(chatServiceFor(second)).toBeNull();
    expect(chatServiceFor(first)).not.toBeNull();
    expect(chatServiceFor(first)).not.toBe(chatServiceFor(second));
    module.shutdown?.();
  });
});

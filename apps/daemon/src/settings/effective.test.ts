import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NotificationPreferences } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import { NOTIFICATION_PREFERENCES_KEY } from '../push/storage.js';
import { effectiveAutomerge, effectiveSettings } from './effective.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = '2026-11-10T00:00:00.000Z';

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function context(overrides: Readonly<Record<string, string>> = {}): DaemonContext {
  const directory = mkdtempSync(join(tmpdir(), 'cb-106-settings-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
    ...overrides,
  });
  const store = openInMemoryStore();
  stores.push(store);
  return {
    config,
    store,
    logger: createLogger({ level: 'error', sink: () => undefined }),
    clock: () => new Date(NOW),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(createLogger({ level: 'error', sink: () => undefined })),
  };
}

describe('effectiveSettings', () => {
  it('reports the config defaults when the store is empty', () => {
    const ctx = context();
    expect(effectiveSettings(ctx)).toEqual({
      automerge: true,
      mergeMethod: 'squash',
      maxConcurrency: 3,
      dailyCostUsd: 10,
      protectedPaths: ['.github/**', 'ops/**', 'infra/**', '**/*.env', 'CODEOWNERS', '.gitmodules'],
      diffMaxFiles: 40,
      diffMaxLines: 2000,
      timezone: 'Europe/Madrid',
      quietHours: null,
    });
    expect(effectiveAutomerge(ctx)).toBe('on');
  });

  it('lets a stored switch and zone override the boot defaults', () => {
    const ctx = context({ CB_AUTOMERGE: 'off', CB_TIMEZONE: 'Europe/Madrid' });
    ctx.store.settings.set('automerge', true, NOW);
    ctx.store.settings.set('timezone', 'UTC', NOW);
    expect(effectiveAutomerge(ctx)).toBe('on');
    expect(effectiveSettings(ctx)).toMatchObject({ automerge: true, timezone: 'UTC' });
  });

  it('falls back to the config when a stored row is the wrong shape', () => {
    const ctx = context({ CB_AUTOMERGE: 'off', CB_TIMEZONE: 'Europe/Madrid' });
    ctx.store.settings.set('automerge', 'yes', NOW);
    ctx.store.settings.set('timezone', 'not-a-zone', NOW);
    expect(effectiveAutomerge(ctx)).toBe('off');
    expect(effectiveSettings(ctx).timezone).toBe('Europe/Madrid');
  });

  it('reads quiet hours from the one push preferences row', () => {
    const ctx = context();
    const preferences: NotificationPreferences = {
      events: ['run.finished'],
      quietHours: '22:00-08:00',
    };
    ctx.store.settings.set(NOTIFICATION_PREFERENCES_KEY, preferences, NOW);
    expect(effectiveSettings(ctx).quietHours).toBe('22:00-08:00');
  });

  it('treats a malformed preferences row as no quiet hours', () => {
    const ctx = context();
    ctx.store.settings.set(NOTIFICATION_PREFERENCES_KEY, { events: 'nope' }, NOW);
    expect(effectiveSettings(ctx).quietHours).toBeNull();
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunRecord, Store } from '@codebox/store';
import { openInMemoryStore } from '@codebox/store';
import type { WorkspaceManager, Worktree, WorktreeInfo } from '@codebox/workspaces';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import { liveRunSettings } from '../runs/engine.js';
import { RunApiError } from '../runs/errors.js';
import { createSettingsService } from './service.js';

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
  const directory = mkdtempSync(join(tmpdir(), 'cb-106-admin-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
    CB_AUTOMERGE: 'on',
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

function info(runId: string | null, path: string): WorktreeInfo {
  return {
    path,
    runId,
    repoSlug: runId === null ? null : 'acme/example',
    branch: runId === null ? null : `cb/${runId}-work`,
    modifiedAt: NOW,
    bytes: 10,
  };
}

function manager(infos: readonly WorktreeInfo[]): {
  readonly manager: WorkspaceManager;
  readonly removed: Worktree[];
} {
  const removed: Worktree[] = [];
  const fake = {
    listWorktrees: async (): Promise<readonly WorktreeInfo[]> => infos,
    removeWorktree: async (worktree: Worktree): Promise<void> => {
      removed.push(worktree);
    },
  };
  return { manager: fake as unknown as WorkspaceManager, removed };
}

describe('SettingsService', () => {
  it('serves the effective settings', () => {
    const ctx = context();
    const service = createSettingsService({ context: ctx });
    expect(service.get()).toMatchObject({ automerge: true, timezone: 'Europe/Madrid' });
  });

  it('writes the one writable setting and round-trips it', () => {
    const ctx = context();
    const service = createSettingsService({ context: ctx });
    expect(service.patch({ timezone: 'UTC' })).toMatchObject({ timezone: 'UTC' });
    expect(service.get().timezone).toBe('UTC');
    expect(ctx.store.settings.get('timezone')).toBe('UTC');
  });

  it('refuses a zone that is not IANA', () => {
    const ctx = context();
    const service = createSettingsService({ context: ctx });
    expect(() => service.patch({ timezone: 'not-a-zone' })).toThrow(RunApiError);
    try {
      service.patch({ timezone: 'not-a-zone' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'validation_failed', status: 422 });
    }
  });

  it('flips the brake and the live settings object reads it without a rebuild', () => {
    const ctx = context();
    const service = createSettingsService({ context: ctx });
    const settings = liveRunSettings(ctx);
    expect(settings.automerge).toBe('on');
    expect(service.brake(true)).toEqual({ enabled: true });
    expect(service.get().automerge).toBe(false);
    expect(settings.automerge).toBe('off');
    expect(service.brake(false)).toEqual({ enabled: false });
    expect(settings.automerge).toBe('on');
  });

  it('wipes finished worktrees and keeps live and unmarked ones', async () => {
    const ctx = context();
    const { manager: workspaces, removed } = manager([
      info('run_merged', '/wt/run_merged'),
      info('run_running', '/wt/run_running'),
      info(null, '/wt/orphan'),
    ]);
    vi.spyOn(ctx.store.runs, 'getRecord').mockImplementation((id: string): RunRecord | null =>
      id === 'run_merged'
        ? ({ state: 'succeeded' } as RunRecord)
        : id === 'run_running'
          ? ({ state: 'running' } as RunRecord)
          : null,
    );
    const service = createSettingsService({ context: ctx, workspaces });
    await expect(service.wipeCache()).resolves.toEqual({ removed: 1, kept: 2 });
    expect(removed.map((worktree) => worktree.path)).toEqual(['/wt/run_merged']);
  });

  it('removes a marked worktree whose run row is gone', async () => {
    const ctx = context();
    const { manager: workspaces, removed } = manager([info('run_gone', '/wt/run_gone')]);
    vi.spyOn(ctx.store.runs, 'getRecord').mockReturnValue(null);
    const service = createSettingsService({ context: ctx, workspaces });
    await expect(service.wipeCache()).resolves.toEqual({ removed: 1, kept: 0 });
    expect(removed.map((worktree) => worktree.runId)).toEqual(['run_gone']);
  });
});

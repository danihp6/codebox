import { isTerminalRunState, parseBrake, timezoneSchema } from '@codebox/contracts';
import type { Brake, Settings } from '@codebox/contracts';
import type { WorkspaceManager, Worktree } from '@codebox/workspaces';
import type { DaemonContext } from '../modules.js';
import { RunApiError } from '../runs/errors.js';
import { createDaemonWorkspaces } from '../runs/engine.js';
import { effectiveSettings } from '../settings/effective.js';

const AUTOMERGE_KEY = 'automerge';
const TIMEZONE_KEY = 'timezone';

export interface SettingsService {
  get(): Settings;
  patch(input: { readonly timezone?: string }): Settings;
  brake(enabled: boolean): Brake;
  wipeCache(): Promise<{ readonly removed: number; readonly kept: number }>;
}

export interface CreateSettingsServiceOptions {
  readonly context: DaemonContext;
  /** Tests inject a fake; production builds the daemon's own manager on first use. */
  readonly workspaces?: WorkspaceManager;
}

export function createSettingsService(options: CreateSettingsServiceOptions): SettingsService {
  const { context } = options;
  const store = context.store;
  const logger = context.logger;
  const now = context.clock;
  let workspaces: WorkspaceManager | null = options.workspaces ?? null;

  function get(): Settings {
    return effectiveSettings(context);
  }

  function patch(input: { readonly timezone?: string }): Settings {
    if (input.timezone !== undefined) {
      const parsed = timezoneSchema.safeParse(input.timezone);
      if (!parsed.success) {
        throw new RunApiError('validation_failed', 422, { path: 'settings.timezone' });
      }
      store.settings.set(TIMEZONE_KEY, parsed.data, now().toISOString());
    }
    return get();
  }

  function brake(enabled: boolean): Brake {
    store.settings.set(AUTOMERGE_KEY, !enabled, now().toISOString());
    logger.info({ msg: 'brake_set', enabled });
    return parseBrake({ enabled });
  }

  async function wipeCache(): Promise<{ readonly removed: number; readonly kept: number }> {
    const manager = (workspaces ??= createDaemonWorkspaces(context));
    const infos = await manager.listWorktrees();
    let removed = 0;
    let kept = 0;
    for (const info of infos) {
      if (info.runId === null || info.repoSlug === null) {
        kept += 1;
        continue;
      }
      const record = store.runs.getRecord(info.runId);
      if (record !== null && !isTerminalRunState(record.state)) {
        kept += 1;
        continue;
      }
      const worktree: Worktree = {
        runId: info.runId,
        repoSlug: info.repoSlug,
        path: info.path,
        branch: info.branch ?? '',
        baseRef: '',
        baseSha: '',
      };
      try {
        await manager.removeWorktree(worktree);
        removed += 1;
      } catch (error) {
        logger.warn({ msg: 'cache_wipe_failed', runId: info.runId, err: error });
        kept += 1;
      }
    }
    logger.info({ msg: 'cache_wipe', removed, kept });
    return { removed, kept };
  }

  return { get, patch, brake, wipeCache };
}

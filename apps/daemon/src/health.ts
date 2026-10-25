import { statfs } from 'node:fs/promises';
import { PAGINATION_MAX_LIMIT, parseHealth } from '@codebox/contracts';
import type { Health } from '@codebox/contracts';
import type { DaemonContext } from './modules.js';

/** `Health['status']` — 'ok' | 'degraded' | 'down'. The contracts package does not name it. */
export type HealthState = Health['status'];
/** `Health['disk']` — { freeBytes, totalBytes, usedPercent }. */
export type DiskInfo = Health['disk'];

export const HEALTH_PROBE_TIMEOUT_MS = 1000;
export const DISK_DEGRADED_PERCENT = 85;
export const DISK_DOWN_PERCENT = 95;
export const DISK_UNKNOWN: DiskInfo = Object.freeze({
  freeBytes: 0,
  totalBytes: 1,
  usedPercent: 100,
});

export interface QueueSnapshot {
  readonly pending: number;
  readonly running: number;
  readonly maxConcurrency: number;
}

export interface HealthProbes {
  db(): Promise<HealthState> | HealthState;
  opencode(): Promise<HealthState> | HealthState;
  disk(): Promise<DiskInfo> | DiskInfo;
  queue(): QueueSnapshot;
}

export function createProbes(context: DaemonContext): HealthProbes {
  return {
    db(): HealthState {
      try {
        context.store.db.prepare('SELECT 1 AS ok').get();
        return 'ok';
      } catch {
        return 'down';
      }
    },

    async opencode(): Promise<HealthState> {
      try {
        const url = new URL(context.config.CB_OPENCODE_HEALTH_PATH, context.config.CB_OPENCODE_URL);
        const response = await fetch(url, {
          signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
        });
        return response.ok ? 'ok' : 'down';
      } catch {
        return 'down';
      }
    },

    async disk(): Promise<DiskInfo> {
      try {
        const stats = await statfs(context.paths.stateDir);
        const blocks = stats.blocks;
        if (!Number.isFinite(blocks) || blocks === 0) return DISK_UNKNOWN;
        const usedPercent = Math.round(((blocks - stats.bfree) / blocks) * 1000) / 10;
        return {
          freeBytes: stats.bavail * stats.bsize,
          totalBytes: blocks * stats.bsize,
          usedPercent,
        };
      } catch {
        return DISK_UNKNOWN;
      }
    },

    queue(): QueueSnapshot {
      const queued = context.store.runs.list({
        state: 'queued',
        limit: PAGINATION_MAX_LIMIT,
        cursor: null,
      });
      return {
        pending: queued.data.length,
        running: context.store.runs.countLive(),
        maxConcurrency: Math.max(1, context.config.CB_MAX_CONCURRENCY),
      };
    },
  };
}

export async function collectHealth(probes: HealthProbes, version: string): Promise<Health> {
  const [db, opencode, disk] = await Promise.all([probes.db(), probes.opencode(), probes.disk()]);
  const queue = probes.queue();
  const status = aggregateStatus({ db, opencode, disk: diskState(disk) });
  return parseHealth({ status, db, opencode, disk, queue, version });
}

export function aggregateStatus(input: {
  readonly db: HealthState;
  readonly opencode: HealthState;
  readonly disk: HealthState;
}): HealthState {
  if (input.db === 'down') return 'down';
  if (input.db !== 'ok' || input.opencode !== 'ok' || input.disk !== 'ok') return 'degraded';
  return 'ok';
}

export function diskState(info: DiskInfo): HealthState {
  if (info.usedPercent >= DISK_DOWN_PERCENT) return 'down';
  if (info.usedPercent >= DISK_DEGRADED_PERCENT) return 'degraded';
  return 'ok';
}

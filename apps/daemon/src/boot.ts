import { readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { PAGINATION_MAX_LIMIT, RUN_STATES, isTerminalRunState } from '@codebox/contracts';
import { withTransaction } from '@codebox/store';
import type { Store } from '@codebox/store';
import type { StatePaths } from './config.js';
import type { Logger } from './logger.js';

export const STALE_LOCK_MS = 60_000;
export const ORPHAN_FAILURE_CODE = 'orphaned';
export const ORPHAN_FAILURE_MESSAGE = 'daemon restarted while this run was live';

export interface ReconcileDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly paths: StatePaths;
  readonly clock: () => Date;
  readonly staleLockMs?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
}

export interface ReconcileResult {
  readonly failedRuns: readonly string[];
  readonly removedLocks: readonly string[];
  readonly durationMs: number;
}

interface LockFile {
  readonly pid: number;
  readonly atMs: number;
}

const LOCK_SUFFIX = '.lock';

export function reconcile(deps: ReconcileDeps): ReconcileResult {
  const startedAt = deps.clock().getTime();
  const now = deps.clock();
  const nowIso = now.toISOString();
  const failedRuns = failOrphanedRuns(deps, nowIso);
  const removedLocks = removeStaleLocks(deps, now.getTime());
  return {
    failedRuns,
    removedLocks,
    durationMs: Math.max(0, deps.clock().getTime() - startedAt),
  };
}

function failOrphanedRuns(deps: ReconcileDeps, nowIso: string): string[] {
  const failedRuns: string[] = [];
  for (const state of RUN_STATES) {
    if (isTerminalRunState(state)) continue;
    const page = deps.store.runs.list({ state, limit: PAGINATION_MAX_LIMIT, cursor: null });
    for (const run of page.data) {
      try {
        withTransaction(deps.store.db, () => {
          deps.store.runs.update(run.id, {
            state: 'failed',
            failureCode: ORPHAN_FAILURE_CODE,
            failureMessage: ORPHAN_FAILURE_MESSAGE,
            finishedAt: nowIso,
          });
          const seq = deps.store.events.nextSeq({ runId: run.id });
          deps.store.events.append({
            runId: run.id,
            chatId: null,
            seq,
            type: 'run.failed',
            data: {
              runId: run.id,
              seq,
              ts: nowIso,
              state: 'failed',
              code: ORPHAN_FAILURE_CODE,
              message: ORPHAN_FAILURE_MESSAGE,
            },
            ts: nowIso,
          });
        });
        failedRuns.push(run.id);
        deps.logger.warn({ msg: 'run_orphaned', runId: run.id, state });
      } catch (error) {
        deps.logger.error({ msg: 'run_reconcile_failed', runId: run.id, state, err: error });
      }
    }
  }
  return failedRuns;
}

function removeStaleLocks(deps: ReconcileDeps, nowMs: number): string[] {
  const staleLockMs = deps.staleLockMs ?? STALE_LOCK_MS;
  const isAlive = deps.isProcessAlive ?? defaultIsProcessAlive;
  const removed: string[] = [];
  for (const name of listLockFiles(deps)) {
    const file = join(deps.paths.locksDir, name);
    const lock = readLock(file);
    if (lock === null) {
      deps.logger.warn({ msg: 'lock_malformed', lock: name });
      deleteLock(deps, file, name, removed);
      continue;
    }
    const stale = nowMs - lock.atMs > staleLockMs;
    if (!isAlive(lock.pid) || stale) {
      deps.logger.warn({ msg: 'lock_stale', lock: name, pid: lock.pid, stale });
      deleteLock(deps, file, name, removed);
    }
  }
  return removed.sort();
}

function listLockFiles(deps: ReconcileDeps): string[] {
  let names: string[];
  try {
    names = readdirSync(deps.paths.locksDir);
  } catch {
    return [];
  }
  return names.filter((name) => {
    if (!name.endsWith(LOCK_SUFFIX)) return false;
    try {
      return statSync(join(deps.paths.locksDir, name)).isFile();
    } catch {
      return false;
    }
  });
}

function readLock(file: string): LockFile | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { pid, at } = parsed as { pid?: unknown; at?: unknown };
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  if (typeof at !== 'string') return null;
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) return null;
  return { pid, atMs };
}

function deleteLock(deps: ReconcileDeps, file: string, name: string, removed: string[]): void {
  try {
    unlinkSync(file);
    removed.push(name);
  } catch (error) {
    deps.logger.error({ msg: 'lock_remove_failed', lock: name, err: error });
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

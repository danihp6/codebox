import { readdirSync, rmSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import type { CodeboxConfig } from '@codebox/contracts';
import type { Logger } from '../logger.js';

export interface RetentionCutoffs {
  readonly runs: string;
  readonly events: string;
  readonly chats: string;
  readonly approvals: string;
  readonly logs: string;
}

const DAY_MS = 86_400_000;

/** The run engine writes `<state>/logs/run-<runId>/gate.log`, so the directory is `run-run_…`. */
const RUN_LOG_DIRECTORY = /^run-run_[0-9A-Za-z]{6,40}$/;

export function retentionCutoffs(at: Date, config: CodeboxConfig): RetentionCutoffs {
  const before = (days: number): string => new Date(at.getTime() - days * DAY_MS).toISOString();
  return {
    runs: before(config.CB_RETENTION_RUNS_DAYS),
    events: before(config.CB_RETENTION_EVENTS_DAYS),
    chats: before(config.CB_RETENTION_CHAT_DAYS),
    approvals: before(config.CB_RETENTION_APPROVALS_DAYS),
    logs: before(config.CB_RETENTION_LOGS_DAYS),
  };
}

/**
 * The logger is optional so the signature stays `(logsDir, before)` for a caller that has none;
 * `readdirSync` with dirents takes its type from `lstat`, so a symlink inside `logsDir` is never
 * followed and never removed.
 */
export function pruneLogDirectories(logsDir: string, before: string, logger?: Logger): number {
  const cutoff = Date.parse(before);
  let entries: Dirent[];
  try {
    entries = readdirSync(logsDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!RUN_LOG_DIRECTORY.test(entry.name)) continue;
    const path = join(logsDir, entry.name);
    try {
      if (statSync(path).mtimeMs >= cutoff) continue;
      rmSync(path, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      logger?.warn({ msg: 'retention_entry_failed', entry: entry.name, err: error });
    }
  }
  return removed;
}

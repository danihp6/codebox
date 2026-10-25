import { join } from 'node:path';
import { parseTelemetry } from '@codebox/contracts';
import type { Telemetry } from '@codebox/contracts';
import { daysInWindow, summariseUsage, usageWindow } from '@codebox/core';
import type { UsageRange } from '@codebox/core';
import { createProbes } from '../health.js';
import type { HealthProbes } from '../health.js';
import type { DaemonContext } from '../modules.js';
import { pruneLogDirectories, retentionCutoffs } from './retention.js';

export const TELEMETRY_DEFAULT_RANGE = '24h';
export const RETENTION_INTERVAL_MS = 21_600_000;
export const RETENTION_FIRST_DELAY_MS = 60_000;

export interface RetentionReport {
  readonly runs: number;
  readonly events: number;
  readonly chats: number;
  readonly approvals: number;
  readonly logDirectories: number;
}

export interface CreateTelemetryServiceOptions {
  readonly context: DaemonContext;
  /** Defaults to `createProbes(context)`; a test injects disk and queue. */
  readonly probes?: Pick<HealthProbes, 'disk' | 'queue'>;
  readonly now?: () => Date;
  readonly retentionIntervalMs?: number;
  readonly firstDelayMs?: number;
  /** Defaults to `join(context.config.CB_STATE_DIR, 'logs')`, where the run engine writes gate logs. */
  readonly logsDir?: string;
}

export interface TelemetryService {
  report(range: UsageRange): Promise<Telemetry>;
  retention(at?: Date): RetentionReport;
  start(): void;
  stop(): void;
}

export function createTelemetryService(options: CreateTelemetryServiceOptions): TelemetryService {
  const { context } = options;
  const { logger, store } = context;
  const now = options.now ?? context.clock;
  const probes = options.probes ?? createProbes(context);
  const logsDir = options.logsDir ?? join(context.config.CB_STATE_DIR, 'logs');
  const retentionIntervalMs = Math.max(
    1,
    Math.trunc(options.retentionIntervalMs ?? RETENTION_INTERVAL_MS),
  );
  const firstDelayMs = Math.max(1, Math.trunc(options.firstDelayMs ?? RETENTION_FIRST_DELAY_MS));

  let firstTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  async function report(range: UsageRange): Promise<Telemetry> {
    const window = usageWindow(range, now());
    const entries = daysInWindow(window).flatMap((day) => store.usage.listByDay(day));
    const summary = summariseUsage(entries, window);
    const counts = store.runs.countByState({ since: window.since, until: window.until });
    const disk = await probes.disk();
    const queue = probes.queue();
    let total = 0;
    for (const value of Object.values(counts)) total += value;
    return parseTelemetry({
      range,
      since: window.since,
      spendUsd: summary.spendUsd,
      runs: {
        total,
        succeeded: counts.succeeded,
        failed: counts.failed,
        cancelled: counts.cancelled,
      },
      disk,
      queueDepth: queue.pending,
    });
  }

  // The short windows go first: deleting a 90-day-old run cascades its events and approvals, so
  // running them after the run delete would keep a 30-day-old event alive for 60 more days.
  function retention(at: Date = now()): RetentionReport {
    const cutoffs = retentionCutoffs(at, context.config);
    const events = store.events.pruneBefore(cutoffs.events);
    const approvals = store.approvals.pruneResolvedBefore(cutoffs.approvals);
    const runs = store.runs.pruneBefore(cutoffs.runs);
    const chats = store.chats.pruneArchivedBefore(cutoffs.chats);
    const logDirectories = pruneLogDirectories(logsDir, cutoffs.logs, logger);
    logger.info({ msg: 'retention_done', runs, events, chats, approvals, logDirectories });
    return { runs, events, chats, approvals, logDirectories };
  }

  function tick(): void {
    try {
      retention();
    } catch (error) {
      logger.error({ msg: 'retention_failed', err: error });
    }
  }

  function start(): void {
    if (firstTimer !== null || intervalTimer !== null) return;
    firstTimer = setTimeout(() => {
      firstTimer = null;
      tick();
      intervalTimer = setInterval(tick, retentionIntervalMs);
      intervalTimer.unref();
    }, firstDelayMs);
    firstTimer.unref();
  }

  function stop(): void {
    if (firstTimer !== null) {
      clearTimeout(firstTimer);
      firstTimer = null;
    }
    if (intervalTimer !== null) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  }

  return { report, retention, start, stop };
}

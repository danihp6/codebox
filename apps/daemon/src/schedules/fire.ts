import type { Repo, Run, Schedule } from '@codebox/contracts';
import { parseSseEvent } from '@codebox/contracts';
import type { SelectionResult } from '@codebox/backlog';
import { withTransaction } from '@codebox/store';
import { backlogService } from '../backlog/index.js';
import type { BacklogService } from '../backlog/index.js';
import type { DaemonContext } from '../modules.js';
import { engineForRun, queueRun, runsService } from '../runs/service.js';
import type { QueueRunInput, RunsService } from '../runs/service.js';
import { createWorkFromItem } from '../works/service.js';

const DEFAULT_MAX_ATTEMPTS = 2;

export type ScheduleFireErrorCode =
  'repo_required' | 'repo_missing' | 'backlog_unavailable' | 'provider_exhausted' | 'internal';

/** A fire that could not start: the code reaches the fire row and the log, never a message. */
export class ScheduleFireError extends Error {
  readonly code: ScheduleFireErrorCode;

  constructor(code: ScheduleFireErrorCode) {
    super(`schedule fire failed: ${code}`);
    this.name = 'ScheduleFireError';
    this.code = code;
  }
}

export interface ScheduleFirePort {
  /**
   * docs/jobs.md §16: one selection decides the item, the work records it and the run opens with
   * the item's body as its only prompt seed. A fire that selects nothing resolves with a null
   * `runId`, so `schedules/service.ts` finishes the row without a run (see docs/api.md §5.6).
   */
  startRun(input: {
    readonly schedule: Schedule;
    readonly scheduledFor: string;
    /** The schedule's per-fire budget; the fire itself never spends it. */
    readonly costCapUsd?: number | null;
  }): Promise<{ readonly runId: string }>;
  /**
   * The legacy repo-less chat fire. D56 retired it: a schedule without a repository no longer
   * exists, so the port refuses with `repo_required` instead of opening a chat. Task-76 removes
   * the branch in `schedules/service.ts`.
   */
  startChat(input: {
    readonly schedule: Schedule;
    readonly scheduledFor: string;
  }): Promise<{ readonly chatId: string; readonly messageId: string }>;
}

export interface CreateScheduleFirePortOptions {
  readonly context: DaemonContext;
  readonly runs?: () => RunsService;
  readonly backlog?: () => BacklogService;
  readonly queue?: (input: QueueRunInput) => Run;
}

function toRecord(value: object): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

export function createScheduleFirePort(options: CreateScheduleFirePortOptions): ScheduleFirePort {
  const context = options.context;
  const store = context.store;
  const config = context.config;
  const clock = context.clock;
  const logger = context.logger;
  const runs = options.runs ?? ((): RunsService => runsService(context));
  const backlog = options.backlog ?? ((): BacklogService => backlogService(context));
  const queue = options.queue ?? queueRun;

  function appendSkipped(
    schedule: Schedule,
    scheduledFor: string,
    reason: 'nothing_pending' | 'nothing_runnable',
  ): void {
    const ts = clock().toISOString();
    const parsed = parseSseEvent({
      event: 'schedule.skipped',
      data: { scheduleId: schedule.id, scheduledFor, reason, ts },
    });
    withTransaction(store.db, () => {
      store.events.append({
        runId: null,
        chatId: null,
        seq: null,
        type: parsed.event,
        data: toRecord(parsed.data),
        ts,
      });
    });
  }

  async function startRun(input: {
    readonly schedule: Schedule;
    readonly scheduledFor: string;
  }): Promise<{ readonly runId: string }> {
    const repoId = input.schedule.repoId;
    if (repoId === null) throw new ScheduleFireError('repo_required');
    const repo: Repo | null = store.repos.get(repoId);
    if (repo === null) throw new ScheduleFireError('repo_missing');
    const repoSchedule = store.repoSchedules.getByRepo(repoId);
    const maxAttempts = repoSchedule?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    let selection: SelectionResult;
    try {
      selection = await backlog().select(repo, {
        selection: repoSchedule?.selection ?? 'nextPending',
        refs: repoSchedule?.refs ?? [],
        maxAttempts,
      });
    } catch (error) {
      logger.error({
        msg: 'schedule_fire_backlog_unavailable',
        scheduleId: input.schedule.id,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      throw new ScheduleFireError('backlog_unavailable');
    }
    if (selection.kind !== 'selected') {
      logger.info({
        msg: 'schedule_fire_nothing',
        scheduleId: input.schedule.id,
        reason: selection.kind,
      });
      appendSkipped(input.schedule, input.scheduledFor, selection.kind);
      // `schedule_fires.outcome` has no `nothing_pending` value and `schedules/service.ts` is not
      // this task's path: the row finishes `fired` with no run. docs/api.md §5.6 records it.
      return { runId: null as unknown as string };
    }
    const item = selection.item;
    const { revision } = await backlog().resolveItem(repo, item.ref);
    const work = createWorkFromItem({
      context,
      repo,
      item,
      revision,
      origin: 'schedule',
      state: 'running',
      attempts: 1,
      maxAttempts,
    });
    const run: Run = queue({
      context,
      engine: engineForRun(runs(), logger),
      now: clock,
      repo,
      jobId: null,
      trigger: 'schedule',
      title: work.title,
      prompt: item.body,
      agent: config.CB_DEFAULT_AGENT,
      model: config.CB_DEFAULT_MODEL,
      workId: work.id,
      backlogRef: work.backlogRef,
    });
    store.runs.update(run.id, { scheduledFor: input.scheduledFor });
    return { runId: run.id };
  }

  return {
    startRun,
    async startChat(): Promise<{ readonly chatId: string; readonly messageId: string }> {
      throw new ScheduleFireError('repo_required');
    },
  };
}

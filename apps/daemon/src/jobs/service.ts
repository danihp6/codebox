import { isValidTimezone, nextFire, nextFires, parseCron } from '@codebox/core';
import { parseSseEvent } from '@codebox/contracts';
import type { Job, Run } from '@codebox/contracts';
import { withTransaction } from '@codebox/store';
import type { JobFilter, PageResult } from '@codebox/store';
import type { DaemonContext } from '../modules.js';
import { RunApiError } from '../runs/errors.js';
import { idempotentRun } from '../runs/idempotency.js';
import { newJobId } from '../runs/ids.js';
import { engineForRun, queueRun, requireRepo, runsServiceInternals } from '../runs/service.js';
import type { RunsService } from '../runs/service.js';

export type JobChangedChange = 'created' | 'updated' | 'deleted' | 'paused' | 'resumed';

export type NextFireFailure = {
  readonly ok: false;
  readonly field: 'cron' | 'timezone';
  readonly code: 'field_count' | 'range' | 'step' | 'syntax' | 'no_fire' | 'timezone';
  readonly message: string;
};

export type NextFireResult = { readonly ok: true; readonly nextFireAt: string } | NextFireFailure;

export interface JobsService {
  list(query: {
    repoId?: string;
    enabled?: boolean;
    limit: number;
    cursor: string | null;
  }): PageResult<Job>;
  create(input: {
    readonly repoId: string;
    readonly title: string;
    readonly prompt: string;
    readonly mode?: 'work';
    readonly agent?: string;
    readonly model?: string | null;
    readonly cron: string;
    readonly timezone: string;
    readonly policy?: 'auto' | 'manual';
  }): Job;
  get(id: string): { job: Job; lastRuns: Run[]; nextFires: string[] };
  patch(
    id: string,
    patch: {
      readonly title?: string;
      readonly prompt?: string;
      readonly cron?: string;
      readonly timezone?: string;
      readonly agent?: string;
      readonly model?: string | null;
      readonly policy?: 'auto' | 'manual';
      readonly enabled?: boolean;
    },
  ): Job;
  remove(id: string): void;
  runNow(id: string, input: { deviceId: string; idempotencyKey: string }): Run;
  pause(id: string): Job;
  resume(id: string): Job;
  next(id: string, count: number): string[];
}

export interface CreateJobsServiceInput {
  readonly context: DaemonContext;
  readonly runs: RunsService;
  readonly now?: () => Date;
}

const DETAIL_FIRES = 5;
const MAX_NEXT_FIRES = 20;

/** The `Z`-suffixed ISO second of `packages/scheduler/src/validate.ts`, byte for byte. */
export function formatInstant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** `packages/scheduler` is not a dependency of the daemon yet; this is its arithmetic, wrapped. */
export function nextFireAt(fields: { cron: string; timezone: string }, now: Date): NextFireResult {
  const parsed = parseCron(fields.cron);
  if (!parsed.ok) {
    return { ok: false, field: 'cron', code: parsed.code, message: parsed.message };
  }
  if (!isValidTimezone(fields.timezone)) {
    return {
      ok: false,
      field: 'timezone',
      code: 'timezone',
      message: `"${fields.timezone}" is not a known IANA timezone.`,
    };
  }
  const next = nextFire(parsed.cron, fields.timezone, now);
  if (next === null) {
    return {
      ok: false,
      field: 'cron',
      code: 'no_fire',
      message: `"${fields.cron}" never fires in ${fields.timezone}.`,
    };
  }
  return { ok: true, nextFireAt: formatInstant(next) };
}

function scheduleFires(cron: string, timezone: string, now: Date, count: number): string[] {
  const parsed = parseCron(cron);
  if (!parsed.ok) return [];
  return nextFires(parsed.cron, timezone, now, count).map(formatInstant);
}

function toRecord(value: object): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

export function createJobsService(input: CreateJobsServiceInput): JobsService {
  const { context, runs } = input;
  const store = context.store;
  const config = context.config;
  const clock = input.now ?? context.clock;
  const internals = runsServiceInternals(runs);

  function jobOrThrow(id: string): Job {
    const job = store.jobs.get(id);
    if (job === null) throw new RunApiError('not_found', 404, { path: 'job.id' });
    return job;
  }

  /** docs/api.md §5.3: one `job.changed` row per mutation, in the write's transaction. */
  function appendChange(jobId: string, change: JobChangedChange, ts: string): void {
    const parsed = parseSseEvent({ event: 'job.changed', data: { jobId, change, ts } });
    store.events.append({
      runId: null,
      chatId: null,
      seq: null,
      type: parsed.event,
      data: toRecord(parsed.data),
      ts,
    });
  }

  function invalidSchedule(result: NextFireFailure): RunApiError {
    return new RunApiError('validation_failed', 422, {
      path: `job.${result.field}`,
      reason: result.code,
    });
  }

  return {
    list(query): PageResult<Job> {
      const filter: JobFilter = {
        limit: query.limit,
        cursor: query.cursor,
        ...(query.repoId === undefined ? {} : { repoId: query.repoId }),
        ...(query.enabled === undefined ? {} : { enabled: query.enabled }),
      };
      return store.jobs.list(filter);
    },

    create(body): Job {
      const repo = requireRepo(context, body.repoId, 'job.repoId');
      const now = clock();
      const schedule = nextFireAt({ cron: body.cron, timezone: body.timezone }, now);
      if (!schedule.ok) throw invalidSchedule(schedule);
      const at = now.toISOString();
      const job: Job = {
        id: newJobId(),
        repoId: repo.id,
        title: body.title,
        prompt: body.prompt,
        mode: body.mode ?? 'work',
        agent: body.agent ?? config.CB_DEFAULT_AGENT,
        model: body.model === undefined ? config.CB_DEFAULT_MODEL : body.model,
        cron: body.cron,
        timezone: body.timezone,
        enabled: true,
        policy: body.policy ?? repo.policy,
        createdAt: at,
        nextFireAt: schedule.nextFireAt,
      };
      withTransaction(store.db, () => {
        store.jobs.create(job);
        appendChange(job.id, 'created', at);
      });
      return jobOrThrow(job.id);
    },

    get(id): { job: Job; lastRuns: Run[]; nextFires: string[] } {
      const job = jobOrThrow(id);
      return {
        job,
        lastRuns: store.runs.listByJob(id, DETAIL_FIRES),
        nextFires: scheduleFires(job.cron, job.timezone, clock(), DETAIL_FIRES),
      };
    },

    patch(id, patch): Job {
      const current = jobOrThrow(id);
      const now = clock();
      const at = now.toISOString();
      const cron = patch.cron ?? current.cron;
      const timezone = patch.timezone ?? current.timezone;
      const enabled = patch.enabled ?? current.enabled;
      let nextFire: string | null | undefined;
      if (!enabled) {
        nextFire = null;
      } else if (
        patch.cron !== undefined ||
        patch.timezone !== undefined ||
        patch.enabled === true
      ) {
        const schedule = nextFireAt({ cron, timezone }, now);
        if (!schedule.ok) throw invalidSchedule(schedule);
        nextFire = schedule.nextFireAt;
      }
      withTransaction(store.db, () => {
        store.jobs.update(id, {
          ...patch,
          ...(nextFire === undefined ? {} : { nextFireAt: nextFire }),
        });
        appendChange(id, 'updated', at);
      });
      return jobOrThrow(id);
    },

    remove(id): void {
      jobOrThrow(id);
      const at = clock().toISOString();
      withTransaction(store.db, () => {
        store.jobs.delete(id);
        appendChange(id, 'deleted', at);
      });
    },

    runNow(id, request): Run {
      return idempotentRun({
        store: internals.idempotency,
        deviceId: request.deviceId,
        key: request.idempotencyKey,
        body: { jobId: id },
        now: clock(),
        start: (): Run => {
          const job = jobOrThrow(id);
          const repo = requireRepo(context, job.repoId, 'job.repoId');
          return queueRun({
            context,
            engine: engineForRun(runs, context.logger),
            now: clock,
            repo,
            jobId: job.id,
            trigger: 'manual',
            title: job.title,
            prompt: job.prompt,
            agent: job.agent,
            model: job.model,
          });
        },
      });
    },

    pause(id): Job {
      jobOrThrow(id);
      const at = clock().toISOString();
      withTransaction(store.db, () => {
        store.jobs.update(id, { enabled: false, nextFireAt: null });
        appendChange(id, 'paused', at);
      });
      return jobOrThrow(id);
    },

    resume(id): Job {
      const job = jobOrThrow(id);
      const now = clock();
      const schedule = nextFireAt({ cron: job.cron, timezone: job.timezone }, now);
      if (!schedule.ok) throw invalidSchedule(schedule);
      const at = now.toISOString();
      withTransaction(store.db, () => {
        store.jobs.update(id, { enabled: true, nextFireAt: schedule.nextFireAt });
        appendChange(id, 'resumed', at);
      });
      return jobOrThrow(id);
    },

    next(id, count): string[] {
      const job = jobOrThrow(id);
      const parsed = parseCron(job.cron);
      if (!parsed.ok) {
        throw new RunApiError('validation_failed', 422, {
          path: 'job.cron',
          reason: parsed.code,
        });
      }
      const bounded = Math.min(MAX_NEXT_FIRES, Math.max(1, Math.trunc(count)));
      return nextFires(parsed.cron, job.timezone, clock(), bounded).map(formatInstant);
    },
  };
}

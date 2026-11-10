import { randomBytes } from 'node:crypto';
import type { RepoSchedule, Schedule } from '@codebox/contracts';
import { ID_PREFIXES } from '@codebox/contracts';
import { isValidTimezone, nextFire, parseCron, resolveMisfire } from '@codebox/core';
import type { SchedulerDeps, ScheduleFireContext, ScheduleStopReason } from '@codebox/scheduler';
import { nextWindowOpen, planNextFire } from '@codebox/scheduler';
import type { PageResult, RepoScheduleFilter, RepoSchedulePatch, Store } from '@codebox/store';
import { StoreError } from '@codebox/store';
import { formatInstant, nextFireAt } from '../jobs/service.js';
import type { DaemonContext } from '../modules.js';
import { RunApiError } from '../runs/errors.js';
import { ScheduleFireError, createScheduleFirePort } from './fire.js';
import type { ScheduleFirePort } from './fire.js';

export const SCHEDULE_TICK_MIN_MS = 15_000;
export const SCHEDULE_TICK_BATCH = 20;
export const SCHEDULE_PREVIEW_FIRES = 5;

const ID_RANDOM_CHARS = 20;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface ScheduleTickReport {
  readonly due: number;
  readonly fired: number;
  readonly skipped: number;
  readonly lost: number;
}

export interface CreateSchedulesServiceOptions {
  readonly context: DaemonContext;
  readonly now?: () => Date;
  readonly tickMs?: number;
  readonly fire?: ScheduleFirePort;
}

export interface SchedulesService {
  list(query: {
    repoId?: string;
    enabled?: boolean;
    limit: number;
    cursor: string | null;
  }): PageResult<RepoSchedule>;
  create(input: CreateScheduleInput): RepoSchedule;
  get(id: string): { readonly schedule: RepoSchedule; readonly nextFires: string[] };
  patch(id: string, patch: SchedulePatchInput): RepoSchedule;
  remove(id: string): void;
  pause(id: string): RepoSchedule;
  resume(id: string): RepoSchedule;
  tick(at?: Date): Promise<ScheduleTickReport>;
  start(): void;
  stop(): void;
}

export interface CreateScheduleInput {
  readonly repoId: string;
  readonly mode: 'once' | 'every' | 'window';
  readonly timezone: string;
  readonly cron?: string | null;
  readonly windowStart?: string | null;
  readonly windowEnd?: string | null;
  readonly cooldownMinutes?: number;
  readonly selection?: 'nextPending' | 'refs';
  readonly refs?: readonly string[];
  readonly maxAttempts?: number;
  readonly maxFires?: number | null;
  readonly maxCostPerFireUsd?: number | null;
}

export interface SchedulePatchInput {
  readonly mode?: 'once' | 'every' | 'window';
  readonly cron?: string | null;
  readonly timezone?: string;
  readonly windowStart?: string | null;
  readonly windowEnd?: string | null;
  readonly cooldownMinutes?: number;
  readonly selection?: 'nextPending' | 'refs';
  readonly refs?: readonly string[];
  readonly maxAttempts?: number;
  readonly maxFires?: number | null;
  readonly maxCostPerFireUsd?: number | null;
  readonly enabled?: boolean;
}

/** What a test needs beyond the frozen surface: the store, the clock and the fires in flight. */
export interface SchedulesRuntime {
  readonly store: Store;
  readonly now: () => Date;
  pending(): readonly Promise<void>[];
}

const RUNTIMES = new WeakMap<SchedulesService, SchedulesRuntime>();

export function schedulesRuntimeOf(service: SchedulesService): SchedulesRuntime {
  const runtime = RUNTIMES.get(service);
  if (runtime === undefined) {
    throw new Error('the schedules service was not created by createSchedulesService');
  }
  return runtime;
}

/** `sch_` plus 20 Crockford base32 characters, the shape `ScheduleId` accepts. */
export function newScheduleId(random: (size: number) => Buffer = randomBytes): string {
  const bytes = random(ID_RANDOM_CHARS);
  if (bytes.length < ID_RANDOM_CHARS) {
    throw new RangeError('the random source returned fewer than 20 bytes');
  }
  let suffix = '';
  for (let index = 0; index < ID_RANDOM_CHARS; index += 1) {
    suffix += CROCKFORD.charAt((bytes[index] ?? 0) & 31);
  }
  return `${ID_PREFIXES.schedule}${suffix}`;
}

function zeroReport(): ScheduleTickReport {
  return { due: 0, fired: 0, skipped: 0, lost: 0 };
}

function invalid(path: string, reason: string): RunApiError {
  return new RunApiError('validation_failed', 422, { path, reason });
}

function invalidField(path: string): RunApiError {
  return new RunApiError('validation_failed', 422, { path });
}

function conflict(path: string, reason: string): RunApiError {
  return new RunApiError('conflict', 409, { path, reason });
}

function minutesField(time: string): { readonly hour: number; readonly minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (match === null) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

interface TimingFields {
  readonly mode: 'once' | 'every' | 'window';
  readonly cron: string | null;
  readonly timezone: string;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
}

interface FireTiming extends TimingFields {
  readonly cooldownMinutes: number;
  readonly maxFires: number | null;
  readonly maxCostPerFireUsd: number | null;
  readonly consecutiveFailures: number;
  readonly firesCount: number;
  readonly enabled: boolean;
}

interface PreviewTiming extends FireTiming {
  readonly nextFireAt: string | null;
}

/** D56: `refs` needs at least one ref and `nextPending` carries none. */
function requireSelection(selection: 'nextPending' | 'refs', refs: readonly string[]): void {
  if (selection === 'refs' && refs.length === 0) {
    throw invalid('schedule.refs', 'selection_empty');
  }
  if (selection === 'nextPending' && refs.length > 0) throw invalidField('schedule.refs');
}

interface FireOutcome {
  readonly runId: string | null;
  readonly chatId: string | null;
  readonly costUsd: number;
  readonly code: string | null;
}

export function createSchedulesService(options: CreateSchedulesServiceOptions): SchedulesService {
  const context = options.context;
  const store = context.store;
  const logger = context.logger;
  const now = options.now ?? context.clock;
  const configured = Math.max(
    SCHEDULE_TICK_MIN_MS / 1000,
    context.config.CB_SCHEDULER_TICK_SECONDS,
  );
  const tickMs = Math.max(1, Math.trunc(options.tickMs ?? configured * 1000));
  const fire = options.fire ?? createScheduleFirePort({ context });
  const deps: SchedulerDeps = {
    cron: { parse: parseCron, nextFire, isValidTimezone },
    misfire: resolveMisfire,
  };

  const pendingFires = new Set<Promise<void>>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let stopped = false;

  function track(promise: Promise<void>): void {
    pendingFires.add(promise);
    void promise.then(
      () => pendingFires.delete(promise),
      () => pendingFires.delete(promise),
    );
  }

  function requireSchedule(id: string): RepoSchedule {
    const schedule = store.repoSchedules.get(id);
    if (schedule === null) throw new RunApiError('not_found', 404, { path: 'schedule.id' });
    return schedule;
  }

  function fireContext(
    schedule: FireTiming,
    finishedAt: string,
    lastCostUsd: number,
  ): ScheduleFireContext {
    return {
      mode: schedule.mode,
      timezone: schedule.timezone,
      cron: schedule.cron,
      windowStart: schedule.windowStart,
      windowEnd: schedule.windowEnd,
      cooldownMinutes: schedule.cooldownMinutes,
      maxFires: schedule.maxFires,
      maxCostPerFireUsd: schedule.maxCostPerFireUsd,
      firesCount: schedule.firesCount,
      consecutiveFailures: schedule.consecutiveFailures,
      lastCostUsd,
      finishedAt,
      enabled: schedule.enabled,
    };
  }

  /** The next fire of the fields, or the §3 refusal a client can act on. */
  function nextFireFor(fields: TimingFields, at: Date): string {
    if (fields.mode === 'window') {
      if (!isValidTimezone(fields.timezone)) throw invalid('schedule.timezone', 'timezone');
      if (fields.windowStart === null || fields.windowEnd === null) {
        throw invalid('schedule.windowStart', 'window');
      }
      if (fields.windowStart === fields.windowEnd) throw invalid('schedule.windowStart', 'window');
      const opening = nextWindowOpen({
        timezone: fields.timezone,
        windowStart: fields.windowStart,
        windowEnd: fields.windowEnd,
        after: formatInstant(at),
      });
      if (opening === null) throw invalid('schedule.windowStart', 'window');
      return opening;
    }
    if (fields.cron === null) throw invalid('schedule.cron', 'field_count');
    const result = nextFireAt({ cron: fields.cron, timezone: fields.timezone }, at);
    if (!result.ok) {
      throw invalid(result.field === 'cron' ? 'schedule.cron' : 'schedule.timezone', result.code);
    }
    return result.nextFireAt;
  }

  function preview(schedule: PreviewTiming): string[] {
    if (!schedule.enabled || schedule.nextFireAt === null) return [];
    const fires: string[] = [schedule.nextFireAt];
    let cursor = schedule.nextFireAt;
    for (let index = 1; index < SCHEDULE_PREVIEW_FIRES; index += 1) {
      const plan = planNextFire(deps, fireContext(schedule, cursor, 0));
      if (plan.nextFireAt === null) break;
      fires.push(plan.nextFireAt);
      cursor = plan.nextFireAt;
    }
    return fires;
  }

  function requireRepo(repoId: string): void {
    if (store.repos.get(repoId) === null) {
      throw invalid('schedule.repoId', 'repo_missing');
    }
  }

  function stopSchedule(schedule: Schedule, reason: ScheduleStopReason): void {
    store.schedules.update(schedule.id, {
      nextFireAt: null,
      ...(reason === 'failures' ? { enabled: false } : {}),
    });
    logger.info({ msg: 'schedule_stopped', scheduleId: schedule.id, reason });
  }

  function settle(
    scheduleId: string,
    fireId: number,
    plannedNext: string | null,
    outcome: FireOutcome,
  ): void {
    const finishedAt = formatInstant(now());
    try {
      store.scheduleFires.finish(fireId, {
        outcome: outcome.code === null ? 'fired' : 'failed',
        costUsd: outcome.costUsd,
        runId: outcome.runId,
        chatId: outcome.chatId,
        detail: outcome.code,
      });
    } catch {
      logger.warn({ msg: 'schedule_finish_failed', scheduleId, fireId });
      return;
    }
    if (outcome.code !== null) {
      logger.error({ msg: 'schedule_fire_failed', scheduleId, code: outcome.code });
    } else {
      logger.info({
        msg: 'schedule_fired',
        scheduleId,
        ...(outcome.runId === null ? {} : { runId: outcome.runId }),
        ...(outcome.chatId === null ? {} : { chatId: outcome.chatId }),
      });
    }
    // D46: the next fire starts `cooldown` after this one finished, so it is recomputed from the
    // finish instant, and only while the schedule still points at the fire this claim wrote.
    try {
      const fresh = store.schedules.get(scheduleId);
      if (fresh === null || fresh.nextFireAt !== plannedNext) return;
      const plan = planNextFire(deps, fireContext(fresh, finishedAt, outcome.costUsd));
      if (plan.nextFireAt === null) stopSchedule(fresh, plan.stop ?? 'no_next_fire');
      else store.schedules.update(scheduleId, { nextFireAt: plan.nextFireAt });
    } catch {
      logger.warn({ msg: 'schedule_next_fire_failed', scheduleId });
    }
  }

  async function runFire(schedule: Schedule, scheduledFor: string): Promise<FireOutcome> {
    // D56: a schedule without a repository no longer exists; a legacy row fails its fire closed.
    if (schedule.repoId === null) throw new ScheduleFireError('repo_required');
    const started = await fire.startRun({
      schedule,
      scheduledFor,
      costCapUsd: schedule.maxCostPerFireUsd,
    });
    const run = store.runs.getRecord(started.runId);
    return { runId: started.runId, chatId: null, costUsd: run?.cost.usd ?? 0, code: null };
  }

  function startFire(
    schedule: Schedule,
    scheduledFor: string,
    plannedNext: string | null,
    fireId: number,
  ): void {
    const promise: Promise<void> = Promise.resolve()
      .then(() => runFire(schedule, scheduledFor))
      .then(
        (outcome) => settle(schedule.id, fireId, plannedNext, outcome),
        (error: unknown) =>
          settle(schedule.id, fireId, plannedNext, {
            runId: null,
            chatId: null,
            costUsd: 0,
            code: error instanceof ScheduleFireError ? error.code : 'internal',
          }),
      );
    track(promise);
  }

  function pass(at: Date): ScheduleTickReport {
    const boundIso = formatInstant(at);
    const due = store.schedules.listDue(boundIso, SCHEDULE_TICK_BATCH);
    let fired = 0;
    let skipped = 0;
    let lost = 0;
    for (const schedule of due) {
      const scheduledFor = schedule.nextFireAt;
      if (scheduledFor === null) continue;
      const decision = resolveMisfire({
        scheduledFor,
        now: boundIso,
        graceSeconds: context.config.CB_MISFIRE_GRACE_SECONDS,
      });
      if (decision.code === 'not_due') continue;
      const plan = planNextFire(deps, fireContext(schedule, boundIso, 0));
      if (!decision.run || plan.stop !== null) {
        const record = store.scheduleFires.skip({
          scheduleId: schedule.id,
          scheduledFor,
          firedAt: boundIso,
          nextFireAt: plan.nextFireAt,
        });
        if (record === null) {
          lost += 1;
          continue;
        }
        skipped += 1;
        if (plan.stop !== null) stopSchedule(schedule, plan.stop);
        else
          logger.info({
            msg: 'schedule_fire_skipped',
            scheduleId: schedule.id,
            scheduledFor,
            reason: 'outside_grace',
          });
        continue;
      }
      const record = store.scheduleFires.claim({
        scheduleId: schedule.id,
        scheduledFor,
        firedAt: boundIso,
        nextFireAt: plan.nextFireAt,
      });
      if (record === null) {
        lost += 1;
        logger.warn({ msg: 'schedule_fire_lost', scheduleId: schedule.id, scheduledFor });
        continue;
      }
      fired += 1;
      startFire(schedule, scheduledFor, plan.nextFireAt, record.id);
    }
    return { due: due.length, fired, skipped, lost };
  }

  async function tick(at: Date = now()): Promise<ScheduleTickReport> {
    if (running) return zeroReport();
    running = true;
    try {
      // One yield: a tick that starts in the same turn sees the pass in flight and reads zero.
      await Promise.resolve();
      return pass(at);
    } finally {
      running = false;
    }
  }

  function start(): void {
    if (timer !== null || stopped) return;
    const handle = setInterval(() => {
      void tick().catch((error: unknown) => {
        logger.error({ msg: 'schedule_tick_failed', err: error });
      });
    }, tickMs);
    handle.unref();
    timer = handle;
  }

  function stop(): void {
    stopped = true;
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  const service: SchedulesService = {
    list(query): PageResult<RepoSchedule> {
      const filter: RepoScheduleFilter = {
        limit: query.limit,
        cursor: query.cursor,
        ...(query.repoId === undefined ? {} : { repoId: query.repoId }),
        ...(query.enabled === undefined ? {} : { enabled: query.enabled }),
      };
      return store.repoSchedules.list(filter);
    },

    create(input): RepoSchedule {
      const at = now();
      const timestamp = at.toISOString();
      requireRepo(input.repoId);
      if (input.mode !== 'window' && (input.windowStart != null || input.windowEnd != null)) {
        throw invalid('schedule.windowStart', 'window');
      }
      if (input.mode === 'window' && input.cron != null) {
        throw invalid('schedule.cron', 'window');
      }
      if (input.cooldownMinutes !== undefined && input.cooldownMinutes < 0) {
        throw invalid('schedule.cooldownMinutes', 'range');
      }
      for (const time of [input.windowStart, input.windowEnd]) {
        if (time != null && minutesField(time) === null) {
          throw invalid('schedule.windowStart', 'window');
        }
      }
      const cron = input.mode === 'window' ? null : (input.cron ?? null);
      const windowStart = input.mode === 'window' ? (input.windowStart ?? null) : null;
      const windowEnd = input.mode === 'window' ? (input.windowEnd ?? null) : null;
      const selection = input.selection ?? 'nextPending';
      const refs = input.refs ?? [];
      requireSelection(selection, refs);
      const nextFire = nextFireFor(
        { mode: input.mode, cron, timezone: input.timezone, windowStart, windowEnd },
        at,
      );
      const schedule: RepoSchedule = {
        id: newScheduleId(),
        repoId: input.repoId,
        mode: input.mode,
        cron,
        timezone: input.timezone,
        windowStart,
        windowEnd,
        cooldownMinutes: input.cooldownMinutes ?? 0,
        selection,
        refs: [...refs],
        maxAttempts: input.maxAttempts ?? 2,
        maxFires: input.maxFires ?? null,
        maxCostPerFireUsd: input.maxCostPerFireUsd ?? null,
        consecutiveFailures: 0,
        firesCount: 0,
        spendUsd: 0,
        enabled: true,
        nextFireAt: nextFire,
        lastFiredAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      try {
        return store.repoSchedules.create(schedule);
      } catch (error) {
        if (error instanceof StoreError && error.code === 'unique_violation') {
          throw conflict('schedule.repoId', 'schedule_exists');
        }
        throw error;
      }
    },

    get(id): { readonly schedule: RepoSchedule; readonly nextFires: string[] } {
      const schedule = requireSchedule(id);
      return { schedule, nextFires: preview(schedule) };
    },

    patch(id, patch): RepoSchedule {
      const current = requireSchedule(id);
      const at = now();
      if (patch.cooldownMinutes !== undefined && patch.cooldownMinutes < 0) {
        throw invalid('schedule.cooldownMinutes', 'range');
      }
      const mode = patch.mode ?? current.mode;
      const cron = mode === 'window' ? null : patch.cron === undefined ? current.cron : patch.cron;
      const windowStart =
        mode === 'window'
          ? patch.windowStart === undefined
            ? current.windowStart
            : patch.windowStart
          : null;
      const windowEnd =
        mode === 'window'
          ? patch.windowEnd === undefined
            ? current.windowEnd
            : patch.windowEnd
          : null;
      const timezone = patch.timezone ?? current.timezone;
      const enabled = patch.enabled ?? current.enabled;
      const selection = patch.selection ?? current.selection;
      const refs = patch.refs === undefined ? current.refs : [...patch.refs];
      // A patch may change one half of the pair: the stored other half closes it.
      requireSelection(selection, refs);
      const touchesSchedule =
        patch.mode !== undefined ||
        patch.cron !== undefined ||
        patch.timezone !== undefined ||
        patch.windowStart !== undefined ||
        patch.windowEnd !== undefined ||
        patch.cooldownMinutes !== undefined ||
        patch.enabled !== undefined;
      let nextFire: string | null | undefined;
      if (!enabled) nextFire = null;
      else if (touchesSchedule) {
        nextFire = nextFireFor({ mode, cron, timezone, windowStart, windowEnd }, at);
      }
      const update: RepoSchedulePatch = {
        mode,
        cron,
        windowStart,
        windowEnd,
        timezone,
        selection,
        refs,
        enabled,
        updatedAt: at.toISOString(),
        ...(patch.cooldownMinutes === undefined ? {} : { cooldownMinutes: patch.cooldownMinutes }),
        ...(patch.maxAttempts === undefined ? {} : { maxAttempts: patch.maxAttempts }),
        ...(patch.maxFires === undefined ? {} : { maxFires: patch.maxFires }),
        ...(patch.maxCostPerFireUsd === undefined
          ? {}
          : { maxCostPerFireUsd: patch.maxCostPerFireUsd }),
        ...(nextFire === undefined ? {} : { nextFireAt: nextFire }),
      };
      return store.repoSchedules.update(id, update);
    },

    remove(id): void {
      requireSchedule(id);
      store.repoSchedules.delete(id);
    },

    pause(id): RepoSchedule {
      const current = requireSchedule(id);
      return store.repoSchedules.update(current.id, {
        enabled: false,
        nextFireAt: null,
        updatedAt: now().toISOString(),
      });
    },

    resume(id): RepoSchedule {
      const current = requireSchedule(id);
      const nextFire = nextFireFor(
        {
          mode: current.mode,
          cron: current.cron,
          timezone: current.timezone,
          windowStart: current.windowStart,
          windowEnd: current.windowEnd,
        },
        now(),
      );
      return store.repoSchedules.update(current.id, {
        enabled: true,
        nextFireAt: nextFire,
        updatedAt: now().toISOString(),
      });
    },

    tick,
    start,
    stop,
  };

  RUNTIMES.set(service, { store, now, pending: () => [...pendingFires] });
  return service;
}

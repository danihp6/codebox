import type { PromptRoutine, Routine, SseEventName } from '@codebox/contracts';
import { parseSseEvent } from '@codebox/contracts';
import type { Store } from '@codebox/store';
import { chatServiceFor } from '../chat/index.js';
import type { ChatService } from '../chat/service.js';
import { eventNotifier } from '../events/notifier.js';
import { formatInstant } from '../jobs/service.js';
import type { DaemonContext } from '../modules.js';
import { firePrompt } from './fire.js';
import type { PromptFireResult } from './fire.js';
import { planRoutineTick } from './tick.js';

export const ROUTINE_TICK_MIN_MS = 15_000;
export const ROUTINE_TICK_BATCH = 20;
export const ROUTINE_MAX_PROMPT_FIRES = 1;

const FAILURE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  chat_unavailable: 'The chat subsystem is not running.',
  repo_missing: 'The routine repository no longer exists.',
  no_reply: 'The agent answered without a reply.',
  agent_unavailable: 'The agent was unavailable.',
  workspace_unavailable: 'The workspace was unavailable.',
  internal: 'The routine fire failed for an internal reason.',
});

const DEFAULT_FAILURE_MESSAGE = 'The routine fire failed.';

/** A fixed sentence per code: the thrown message never reaches a row or a log. */
export function failureMessage(code: string): string {
  return FAILURE_MESSAGES[code] ?? DEFAULT_FAILURE_MESSAGE;
}

export interface RoutineTickReport {
  readonly due: number;
  readonly fired: number;
  readonly skipped: number;
  readonly lost: number;
  readonly deferred: number;
}

export interface CreateRoutineServiceOptions {
  readonly context: DaemonContext;
  readonly now?: () => Date;
  /** Defaults to `Math.max(15, CB_SCHEDULER_TICK_SECONDS) * 1000`. */
  readonly tickMs?: number;
  /** Defaults to `chatServiceFor(context)`; a test injects a `ChatService` or `null`. */
  readonly chat?: () => ChatService | null;
}

export interface RoutineService {
  tick(at?: Date): Promise<RoutineTickReport>;
  /** Records the fire, starts the work and returns the row unchanged. No schedule write. */
  runNow(routine: Routine, at?: Date): Routine;
  /** The background prompt fires started by `tick`/`runNow`; a test awaits this set. */
  pending(): readonly Promise<void>[];
  start(): void;
  stop(): void;
}

/** What the routes need beyond the frozen `RoutineService` surface. */
export interface RoutineRuntime {
  readonly store: Store;
  readonly now: () => Date;
}

const RUNTIMES = new WeakMap<RoutineService, RoutineRuntime>();

/** `routines/routes.ts` reaches the same store and clock through this, like `chatRuntimeOf`. */
export function routineRuntimeOf(service: RoutineService): RoutineRuntime {
  const runtime = RUNTIMES.get(service);
  if (runtime === undefined) {
    throw new Error('the routine service was not created by createRoutineService');
  }
  return runtime;
}

function zeroReport(): RoutineTickReport {
  return { due: 0, fired: 0, skipped: 0, lost: 0, deferred: 0 };
}

function toRecord(value: object): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

function defaultTickMs(context: DaemonContext): number {
  return Math.max(ROUTINE_TICK_MIN_MS / 1000, context.config.CB_SCHEDULER_TICK_SECONDS) * 1000;
}

type FireOutcome = 'fired' | 'lost' | 'deferred';

export function createRoutineService(options: CreateRoutineServiceOptions): RoutineService {
  const context = options.context;
  const store = context.store;
  const logger = context.logger;
  const now = options.now ?? context.clock;
  const tickMs = Math.max(1, Math.trunc(options.tickMs ?? defaultTickMs(context)));
  const chat: () => ChatService | null = options.chat ?? (() => chatServiceFor(context));

  const inFlight = new Set<string>();
  const pendingFires = new Set<Promise<void>>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let stopped = false;

  /** `docs/jobs.md` §15: one global event row, no run and no seq. */
  function persistEvent(type: SseEventName, data: Record<string, unknown>, ts: string): void {
    const parsed = parseSseEvent({ event: type, data });
    store.events.append({
      runId: null,
      chatId: null,
      seq: null,
      type: parsed.event,
      data: toRecord(parsed.data),
      ts,
    });
    eventNotifier(context).notify();
  }

  function finishFire(
    fireId: number,
    outcome: 'sent' | 'replied' | 'failed',
    detail: string | null,
  ): void {
    try {
      store.routineFires.finish(fireId, outcome, detail);
    } catch {
      // A shutdown can close the database while an apology is still in flight.
      logger.warn({ msg: 'routine_finish_failed', fireId });
    }
  }

  function track(promise: Promise<void>): void {
    pendingFires.add(promise);
    void promise.then(
      () => pendingFires.delete(promise),
      () => pendingFires.delete(promise),
    );
  }

  async function startPromptFire(
    routine: PromptRoutine,
    fireId: number | null,
    scheduledFor: string,
  ): Promise<void> {
    try {
      const result: PromptFireResult = await firePrompt(routine, { context, chat, now });
      const ts = now().toISOString();
      if (result.outcome === 'replied' && result.chatId !== null && result.messageId !== null) {
        persistEvent(
          'routine.replied',
          {
            routineId: routine.id,
            chatId: result.chatId,
            messageId: result.messageId,
            ts,
          },
          ts,
        );
        if (fireId !== null) finishFire(fireId, 'replied', result.messageId);
        logger.info({ msg: 'routine_replied', routineId: routine.id, chatId: result.chatId });
      } else {
        const code = result.code ?? 'internal';
        persistEvent(
          'routine.failed',
          { routineId: routine.id, code, message: failureMessage(code), ts },
          ts,
        );
        if (fireId !== null) finishFire(fireId, 'failed', code);
        logger.error({ msg: 'routine_fire_failed', routineId: routine.id, code, scheduledFor });
      }
    } catch {
      // `firePrompt` never throws; a closed store during shutdown can still fail an append.
      logger.error({
        msg: 'routine_fire_failed',
        routineId: routine.id,
        code: 'internal',
        scheduledFor,
      });
    } finally {
      inFlight.delete(routine.id);
    }
  }

  function fireItem(
    routine: Routine,
    scheduledFor: string,
    nextFireAt: string | null,
    at: Date,
  ): FireOutcome {
    if (routine.kind === 'prompt' && inFlight.size >= ROUTINE_MAX_PROMPT_FIRES) return 'deferred';
    const timestamp = at.toISOString();
    const record = store.routineFires.claim({
      routineId: routine.id,
      scheduledFor,
      firedAt: formatInstant(at),
      nextFireAt,
    });
    if (record === null) return 'lost';
    persistEvent(
      'routine.fired',
      { routineId: routine.id, kind: routine.kind, scheduledFor, ts: timestamp },
      timestamp,
    );
    logger.info({ msg: 'routine_fired', routineId: routine.id, kind: routine.kind, scheduledFor });
    if (routine.kind === 'prompt') {
      inFlight.add(routine.id);
      track(startPromptFire(routine, record.id, scheduledFor));
    } else {
      finishFire(record.id, 'sent', null);
    }
    return 'fired';
  }

  function tickPass(at: Date): RoutineTickReport {
    const boundIso = formatInstant(at);
    const due = store.routines.listDue(boundIso, ROUTINE_TICK_BATCH);
    const plan = planRoutineTick({
      now: at,
      graceSeconds: context.config.CB_MISFIRE_GRACE_SECONDS,
      due,
    });
    let fired = 0;
    let skipped = 0;
    let lost = 0;
    let deferred = 0;
    for (const item of plan) {
      if (item.decision === 'skip') {
        const record = store.routineFires.skip({
          routineId: item.routine.id,
          scheduledFor: item.scheduledFor,
          firedAt: boundIso,
          nextFireAt: item.nextFireAt,
          detail: item.reason,
        });
        if (record === null) continue;
        skipped += 1;
        logger.info({ msg: 'routine_skipped', routineId: item.routine.id, reason: item.reason });
        continue;
      }
      const outcome = fireItem(item.routine, item.scheduledFor, item.nextFireAt, at);
      if (outcome === 'fired') fired += 1;
      if (outcome === 'lost') lost += 1;
      if (outcome === 'deferred') deferred += 1;
    }
    return { due: due.length, fired, skipped, lost, deferred };
  }

  async function tick(at: Date = now()): Promise<RoutineTickReport> {
    if (running) return zeroReport();
    running = true;
    try {
      return await tickPass(at);
    } finally {
      running = false;
    }
  }

  function runNow(routine: Routine, at: Date = now()): Routine {
    const scheduledFor = formatInstant(at);
    const timestamp = at.toISOString();
    persistEvent(
      'routine.fired',
      { routineId: routine.id, kind: routine.kind, scheduledFor, ts: timestamp },
      timestamp,
    );
    if (routine.kind === 'prompt') {
      inFlight.add(routine.id);
      track(startPromptFire(routine, null, scheduledFor));
    }
    return routine;
  }

  function start(): void {
    if (timer !== null || stopped) return;
    const handle = setInterval(() => {
      void tick().catch((error: unknown) => {
        logger.error({ msg: 'routine_tick_failed', err: error });
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

  const service: RoutineService = {
    tick,
    runNow,
    pending: (): readonly Promise<void>[] => [...pendingFires],
    start,
    stop,
  };
  RUNTIMES.set(service, { store, now });
  return service;
}

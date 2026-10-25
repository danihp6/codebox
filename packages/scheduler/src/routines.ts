import type { Routine } from '@codebox/contracts';
import { planFires, planTick } from './tick.js';
import type { NextFireUpdate, SchedulerDeps, Schedule } from './types.js';

export interface RoutineDue {
  readonly routineId: string;
  readonly scheduledFor: string;
  readonly ageSeconds: number;
}

export interface RoutineSkipped {
  readonly routineId: string;
  readonly scheduledFor: string;
  readonly ageSeconds: number;
  readonly reason: 'outside_grace' | 'no_next_fire';
}

export interface RoutineNextFire {
  readonly routineId: string;
  readonly nextFireAt: string | null;
}

export interface RoutineTickInput {
  readonly now: string;
  readonly routines: readonly Routine[];
  readonly graceSeconds: number;
  readonly limit: number;
}

export interface RoutineTickPlan {
  readonly due: readonly RoutineDue[];
  readonly skipped: readonly RoutineSkipped[];
  readonly updates: readonly RoutineNextFire[];
}

/** The `Schedule` row the job path already speaks; `kind` is 'routine'. */
export function toSchedule(routine: Routine): Schedule {
  return {
    kind: 'routine',
    ownerId: routine.id,
    cron: routine.cron,
    timezone: routine.timezone,
    enabled: routine.enabled,
    nextFireAt: routine.nextFireAt,
    createdAt: routine.createdAt,
  };
}

export function fromUpdate(update: NextFireUpdate): RoutineNextFire {
  return { routineId: update.ownerId, nextFireAt: update.nextFireAt };
}

/** `planTick` over the mapped rows: same order, same grace, same truncation. */
export function planRoutineTick(deps: SchedulerDeps, input: RoutineTickInput): RoutineTickPlan {
  const plan = planTick(deps, {
    now: input.now,
    schedules: input.routines.map(toSchedule),
    graceSeconds: input.graceSeconds,
    limit: input.limit,
  });
  return {
    due: plan.due.map((fire) => ({
      routineId: fire.ownerId,
      scheduledFor: fire.scheduledFor,
      ageSeconds: fire.ageSeconds,
    })),
    skipped: plan.skipped.map((fire) => ({
      routineId: fire.ownerId,
      scheduledFor: fire.scheduledFor,
      ageSeconds: fire.ageSeconds,
      reason: fire.reason,
    })),
    updates: plan.updates.map(fromUpdate),
  };
}

/** The first fire strictly after `after`, in the routine's zone; `null` for a bad cron or zone. */
export function nextRoutineFire(
  deps: SchedulerDeps,
  input: { readonly cron: string; readonly timezone: string; readonly after: string },
): string | null {
  return planFires(deps, input.cron, input.timezone, input.after, 1)[0] ?? null;
}

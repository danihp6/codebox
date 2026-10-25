import type { Routine } from '@codebox/contracts';
import { resolveMisfire } from '@codebox/core';
import { nextFireAt } from '../jobs/service.js';

export interface RoutineTickPlanItem {
  readonly routine: Routine;
  readonly scheduledFor: string;
  readonly nextFireAt: string | null;
  readonly decision: 'fire' | 'skip';
  readonly reason: 'on_time' | 'outside_grace' | 'no_next_fire';
}

/**
 * D13 applied to one tick's due list: a row inside the grace window fires, one past it is
 * skipped forward, and a schedule the cron engine cannot advance is skipped once so the
 * routine stops instead of retrying forever.
 */
export function planRoutineTick(input: {
  readonly now: Date;
  readonly graceSeconds: number;
  readonly due: readonly Routine[];
}): readonly RoutineTickPlanItem[] {
  const items: RoutineTickPlanItem[] = [];
  for (const routine of input.due) {
    const scheduledFor = routine.nextFireAt;
    if (scheduledFor === null) continue;
    const schedule = nextFireAt({ cron: routine.cron, timezone: routine.timezone }, input.now);
    if (!schedule.ok) {
      items.push({
        routine,
        scheduledFor,
        nextFireAt: null,
        decision: 'skip',
        reason: 'no_next_fire',
      });
      continue;
    }
    const misfire = resolveMisfire({
      scheduledFor,
      now: input.now.toISOString(),
      graceSeconds: input.graceSeconds,
    });
    if (misfire.code === 'not_due') continue;
    items.push({
      routine,
      scheduledFor,
      nextFireAt: schedule.nextFireAt,
      decision: misfire.run ? 'fire' : 'skip',
      reason: misfire.run ? 'on_time' : 'outside_grace',
    });
  }
  return items;
}

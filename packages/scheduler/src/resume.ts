import type { NextFireUpdate, Schedule, SchedulerDeps } from './types.js';

function formatInstant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Resume: the next fire is computed from `now`, never from the missed `nextFireAt`. */
export function planResume(
  deps: SchedulerDeps,
  input: { readonly schedule: Schedule; readonly now: string },
): NextFireUpdate {
  const parsed = deps.cron.parse(input.schedule.cron);
  const next = parsed.ok
    ? deps.cron.nextFire(parsed.cron, input.schedule.timezone, new Date(input.now))
    : null;
  return {
    kind: input.schedule.kind,
    ownerId: input.schedule.ownerId,
    nextFireAt: next === null ? null : formatInstant(next),
  };
}

/** Pause: `nextFireAt: null`, so `job.nextFireAt` is null in the API and in `listDue`. */
export function planPause(schedule: Schedule): NextFireUpdate {
  return { kind: schedule.kind, ownerId: schedule.ownerId, nextFireAt: null };
}

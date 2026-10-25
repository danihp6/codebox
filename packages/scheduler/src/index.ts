// Types first: the injected engine, the schedule row and the plan shapes.
export type {
  CronEngine,
  DueFire,
  MisfireResolver,
  NextFireUpdate,
  Schedule,
  ScheduleFailureCode,
  ScheduleField,
  ScheduleFields,
  ScheduleKind,
  ScheduleValidation,
  SchedulerDeps,
  SkippedFire,
  TickInput,
  TickPlan,
} from './types.js';

// Clock: the epoch-aligned tick and its configured range.
export {
  SCHEDULER_TICK_SECONDS_DEFAULT,
  SCHEDULER_TICK_SECONDS_MAX,
  SCHEDULER_TICK_SECONDS_MIN,
  isTickSeconds,
  nextTickDelay,
} from './clock.js';

// Validation: a job's cron and IANA zone as one typed outcome.
export { validateSchedule } from './validate.js';

// Tick: due selection, the D13 grace decision and the next fire recomputed from `now`.
export { claimKey, planFires, planTick } from './tick.js';

// Resume and pause: the next fire from `now`, or none at all.
export { planPause, planResume } from './resume.js';

// Routines: the chat schedules of D38.
export { fromUpdate, nextRoutineFire, planRoutineTick, toSchedule } from './routines.js';
export type {
  RoutineDue,
  RoutineNextFire,
  RoutineSkipped,
  RoutineTickInput,
  RoutineTickPlan,
} from './routines.js';

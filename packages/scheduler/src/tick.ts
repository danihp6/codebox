import type {
  DueFire,
  NextFireUpdate,
  Schedule,
  SchedulerDeps,
  SkippedFire,
  TickInput,
  TickPlan,
} from './types.js';

const MAX_FIRES = 10;

interface PlannedFire {
  readonly schedule: Schedule;
  readonly scheduledFor: string;
  readonly scheduledMs: number;
  readonly createdMs: number;
  readonly ageSeconds: number;
  readonly run: boolean;
  readonly nextFireAt: string | null;
}

function formatInstant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareFires(left: PlannedFire, right: PlannedFire): number {
  if (left.scheduledMs !== right.scheduledMs) return left.scheduledMs - right.scheduledMs;
  if (left.createdMs !== right.createdMs) return left.createdMs - right.createdMs;
  return compareStrings(left.schedule.ownerId, right.schedule.ownerId);
}

function planCandidate(
  deps: SchedulerDeps,
  schedule: Schedule,
  input: TickInput,
): PlannedFire | null {
  if (!schedule.enabled) return null;
  if (schedule.nextFireAt === null) return null;
  const scheduledFor = schedule.nextFireAt;
  const scheduledMs = Date.parse(scheduledFor);
  const nowMs = Date.parse(input.now);
  if (!(scheduledMs <= nowMs)) return null;
  const decision = deps.misfire({
    scheduledFor,
    now: input.now,
    graceSeconds: input.graceSeconds,
  });
  const parsed = deps.cron.parse(schedule.cron);
  const next = parsed.ok
    ? deps.cron.nextFire(parsed.cron, schedule.timezone, new Date(input.now))
    : null;
  return {
    schedule,
    scheduledFor,
    scheduledMs,
    createdMs: Date.parse(schedule.createdAt),
    ageSeconds: decision.ageSeconds,
    run: decision.run,
    nextFireAt: next === null ? null : formatInstant(next),
  };
}

function toUpdate(fire: PlannedFire): NextFireUpdate {
  return {
    kind: fire.schedule.kind,
    ownerId: fire.schedule.ownerId,
    nextFireAt: fire.nextFireAt,
  };
}

export function planTick(deps: SchedulerDeps, input: TickInput): TickPlan {
  const candidates: PlannedFire[] = [];
  for (const schedule of input.schedules) {
    const planned = planCandidate(deps, schedule, input);
    if (planned !== null) candidates.push(planned);
  }
  candidates.sort(compareFires);

  const limit = Math.max(1, Math.trunc(input.limit));
  const claimed = candidates.filter((fire) => fire.run).slice(0, limit);
  const missed = candidates.filter((fire) => !fire.run);

  const due: DueFire[] = claimed.map((fire) => ({
    kind: fire.schedule.kind,
    ownerId: fire.schedule.ownerId,
    scheduledFor: fire.scheduledFor,
    ageSeconds: fire.ageSeconds,
  }));
  const skipped: SkippedFire[] = missed.map((fire) => ({
    kind: fire.schedule.kind,
    ownerId: fire.schedule.ownerId,
    scheduledFor: fire.scheduledFor,
    ageSeconds: fire.ageSeconds,
    reason: fire.nextFireAt === null ? 'no_next_fire' : 'outside_grace',
  }));
  const updates: NextFireUpdate[] = [...claimed.map(toUpdate), ...missed.map(toUpdate)];
  return { due, skipped, updates };
}

/** Stable claim key: `${kind}:${ownerId}@${scheduledFor}`. */
export function claimKey(fire: Pick<DueFire, 'kind' | 'ownerId' | 'scheduledFor'>): string {
  return `${fire.kind}:${fire.ownerId}@${fire.scheduledFor}`;
}

/** Next `count` fires as ISO strings; `[]` for an invalid cron or zone. 1 <= count <= 10. */
export function planFires(
  deps: SchedulerDeps,
  cron: string,
  timezone: string,
  after: string,
  count: number,
): readonly string[] {
  const size = Number.isFinite(count) ? Math.min(MAX_FIRES, Math.max(1, Math.trunc(count))) : 1;
  const parsed = deps.cron.parse(cron);
  if (!parsed.ok) return [];
  if (!deps.cron.isValidTimezone(timezone)) return [];
  const fires: string[] = [];
  let cursor = new Date(after);
  for (let index = 0; index < size; index += 1) {
    const next = deps.cron.nextFire(parsed.cron, timezone, cursor);
    if (next === null) break;
    fires.push(formatInstant(next));
    cursor = new Date(next.getTime());
  }
  return fires;
}

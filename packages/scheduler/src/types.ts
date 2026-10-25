import type { CronParseResult, MisfireDecision, ParsedCron } from '@codebox/core';

/** The D13 cron arithmetic, supplied by the daemon from `@codebox/core`. */
export interface CronEngine {
  parse(expression: string): CronParseResult;
  nextFire(cron: ParsedCron, timezone: string, after: Date): Date | null;
  isValidTimezone(timezone: string): boolean;
}

/** `resolveMisfire` from `@codebox/core`, supplied by the daemon. */
export type MisfireResolver = (input: {
  readonly scheduledFor: string;
  readonly now: string;
  readonly graceSeconds: number;
}) => MisfireDecision;

export interface SchedulerDeps {
  readonly cron: CronEngine;
  readonly misfire: MisfireResolver;
}

export type ScheduleKind = 'job' | 'routine';

/** One schedulable row. `job` and `routine` share it so Task-34 reuses this package. */
export interface Schedule {
  readonly kind: ScheduleKind;
  readonly ownerId: string; // JobId or RoutineId
  readonly cron: string; // 5 fields
  readonly timezone: string; // IANA
  readonly enabled: boolean;
  readonly nextFireAt: string | null; // ISO 8601 UTC, the fire not yet claimed
  readonly createdAt: string; // ISO 8601, tie-breaker for the queue order
}

export interface DueFire {
  readonly kind: ScheduleKind;
  readonly ownerId: string;
  readonly scheduledFor: string; // the `nextFireAt` that was claimed
  readonly ageSeconds: number;
}

export interface SkippedFire {
  readonly kind: ScheduleKind;
  readonly ownerId: string;
  readonly scheduledFor: string;
  readonly ageSeconds: number;
  readonly reason: 'outside_grace' | 'no_next_fire';
}

export interface NextFireUpdate {
  readonly kind: ScheduleKind;
  readonly ownerId: string;
  readonly nextFireAt: string | null;
}

export interface TickInput {
  readonly now: string; // ISO 8601 UTC, the tick instant
  readonly schedules: readonly Schedule[];
  readonly graceSeconds: number; // CB_MISFIRE_GRACE_SECONDS
  readonly limit: number; // max claims per tick, >= 1
}

export interface TickPlan {
  readonly due: readonly DueFire[]; // ordered, ready to claim
  readonly skipped: readonly SkippedFire[]; // ordered, to log once
  readonly updates: readonly NextFireUpdate[]; // ordered, to persist with the claims
}

export interface ScheduleFields {
  readonly cron: string;
  readonly timezone: string;
}

export type ScheduleField = 'cron' | 'timezone';
export type ScheduleFailureCode =
  'field_count' | 'range' | 'step' | 'syntax' | 'no_fire' | 'timezone';

export type ScheduleValidation =
  | { readonly ok: true; readonly nextFireAt: string }
  | {
      readonly ok: false;
      readonly field: ScheduleField;
      readonly code: ScheduleFailureCode;
      readonly message: string;
    };

import { z } from 'zod';

export const ID_PREFIXES = {
  repo: 'repo_',
  job: 'job_',
  run: 'run_',
  approval: 'apv_',
  chat: 'chat_',
  message: 'msg_',
  device: 'dev_',
  pushSubscription: 'sub_',
  routine: 'rtn_',
  schedule: 'sch_',
  work: 'wrk_',
  session: 'sess_',
  providerAccount: 'acct_',
  cursor: 'c_',
  request: 'req_',
} as const;

export type IdPrefix = keyof typeof ID_PREFIXES;

export function idSchema(prefix: IdPrefix): z.ZodString {
  return z.string().regex(new RegExp(`^${ID_PREFIXES[prefix]}[0-9A-Za-z]{6,40}$`));
}

export const RepoId = idSchema('repo');
export type RepoId = z.infer<typeof RepoId>;

export const JobId = idSchema('job');
export type JobId = z.infer<typeof JobId>;

export const RunId = idSchema('run');
export type RunId = z.infer<typeof RunId>;

export const ApprovalId = idSchema('approval');
export type ApprovalId = z.infer<typeof ApprovalId>;

export const ChatId = idSchema('chat');
export type ChatId = z.infer<typeof ChatId>;

export const MessageId = idSchema('message');
export type MessageId = z.infer<typeof MessageId>;

export const DeviceId = idSchema('device');
export type DeviceId = z.infer<typeof DeviceId>;

export const SubscriptionId = idSchema('pushSubscription');
export type SubscriptionId = z.infer<typeof SubscriptionId>;

export const RoutineId = idSchema('routine');
export type RoutineId = z.infer<typeof RoutineId>;

export const ScheduleId = idSchema('schedule');
export type ScheduleId = z.infer<typeof ScheduleId>;

export const WorkId = idSchema('work');
export type WorkId = z.infer<typeof WorkId>;

export const SessionId = idSchema('session');
export type SessionId = z.infer<typeof SessionId>;

export const ProviderAccountId = idSchema('providerAccount');
export type ProviderAccountId = z.infer<typeof ProviderAccountId>;

/** D53: the backlog item's key, `Task-<digits>`. One definition, used by Work and Backlog. */
export const backlogRefSchema: z.ZodString = z.string().regex(/^Task-\d+$/);
export type BacklogRef = z.infer<typeof backlogRefSchema>;

export const Cursor = idSchema('cursor');
export type Cursor = z.infer<typeof Cursor>;

export const RequestId = idSchema('request');
export type RequestId = z.infer<typeof RequestId>;

export const timestampSchema: z.ZodISODateTime = z.iso.datetime();

export const slugSchema: z.ZodString = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);

export const branchSchema: z.ZodString = z
  .string()
  .min(1)
  .refine((value) => !/\s/.test(value) && !value.includes('..'), {
    message: 'expected a branch name without whitespace or ".."',
  });

export const cronSchema: z.ZodString = z
  .string()
  .refine((value) => value.trim().split(/\s+/).length === 5, {
    message: 'expected exactly five whitespace-separated cron fields',
  });

export const timezoneSchema: z.ZodString = z
  .string()
  .regex(/^(UTC|[A-Za-z]+(_[A-Za-z]+)*\/[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)?)$/);

export const globSchema: z.ZodString = z.string().min(1);

export const commitShaSchema: z.ZodString = z.string().regex(/^[0-9a-f]{7,40}$/);

export const RUN_STATES = [
  'queued',
  'preparing',
  'running',
  'gating',
  'pr_open',
  'merging',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export const runStateSchema = z.enum(RUN_STATES);
export type RunState = z.infer<typeof runStateSchema>;

export const SCOPES = ['read', 'chat', 'runs', 'write', 'admin'] as const;
export const scopeSchema = z.enum(SCOPES);
export type Scope = z.infer<typeof scopeSchema>;

export const RUN_TRIGGERS = ['schedule', 'manual', 'promote', 'revert', 'retry'] as const;
export const runTriggerSchema = z.enum(RUN_TRIGGERS);
export type RunTrigger = z.infer<typeof runTriggerSchema>;

export const RUN_MODES = ['work'] as const;
export const runModeSchema = z.enum(RUN_MODES);
export type RunMode = z.infer<typeof runModeSchema>;

export const REPO_POLICIES = ['auto', 'manual'] as const;
export const repoPolicySchema = z.enum(REPO_POLICIES);
export type RepoPolicy = z.infer<typeof repoPolicySchema>;

export const ROUTINE_KINDS = ['prompt', 'reminder'] as const;
export const routineKindSchema = z.enum(ROUTINE_KINDS);
export type RoutineKind = z.infer<typeof routineKindSchema>;

export const WORK_STATES = [
  'queued',
  'running',
  'review',
  'merged',
  'failed',
  'needs_decision',
  'abandoned',
] as const;
export const workStateSchema = z.enum(WORK_STATES);
export type WorkState = z.infer<typeof workStateSchema>;

/** A work in one of these states blocks its backlog item (docs/jobs.md §16 selection). */
export const WORK_STATE_IN_FLIGHT: readonly WorkState[] = Object.freeze([
  'queued',
  'running',
  'needs_decision',
]);

export const WORK_ORIGINS = ['manual', 'backlog', 'schedule'] as const;
export const workOriginSchema = z.enum(WORK_ORIGINS);
export type WorkOrigin = z.infer<typeof workOriginSchema>;

export const SESSION_TARGETS = ['backlog', 'design', 'schedule', 'work', 'repo'] as const;
export const sessionTargetSchema = z.enum(SESSION_TARGETS);
export type SessionTarget = z.infer<typeof sessionTargetSchema>;

export const SESSION_STATUSES = ['idle', 'working', 'archived'] as const;
export const sessionStatusSchema = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const SELECTIONS = ['nextPending', 'refs'] as const;
export const selectionSchema = z.enum(SELECTIONS);
export type Selection = z.infer<typeof selectionSchema>;

export const RUN_STATE_TERMINAL: readonly RunState[] = Object.freeze(
  RUN_STATES.filter(
    (state) => state === 'succeeded' || state === 'failed' || state === 'cancelled',
  ),
);

export function isTerminalRunState(state: RunState): boolean {
  return RUN_STATE_TERMINAL.includes(state);
}

export const ROUTINE_EVENT_NAMES = ['routine.fired', 'routine.replied', 'routine.failed'] as const;

export const SSE_EVENT_NAMES = [
  'run.queued',
  'run.started',
  'run.output',
  'run.tool',
  'run.permission',
  'run.gate',
  'run.pr',
  'run.merged',
  'run.finished',
  'run.failed',
  'run.cancelled',
  'chat.delta',
  'chat.message',
  'chat.tool',
  'chat.permission',
  'chat.idle',
  'chat.compacted',
  'job.changed',
  'approval.created',
  'approval.resolved',
  'telemetry',
  ...ROUTINE_EVENT_NAMES,
  'work.created',
  'work.updated',
  'work.needs_decision',
  'work.closed',
  'session.created',
  'session.delta',
  'session.tool',
  'session.proposal',
  'session.closed',
  'schedule.fired',
  'schedule.skipped',
  'provider.state',
  'backlog.changed',
  'design.changed',
] as const;

export const sseEventNameSchema = z.enum(SSE_EVENT_NAMES);
export type SseEventName = (typeof SSE_EVENT_NAMES)[number];

export const SSE_CONTROL_EVENT_NAMES = ['gap'] as const;

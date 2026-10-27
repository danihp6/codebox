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
] as const;

export const sseEventNameSchema = z.enum(SSE_EVENT_NAMES);
export type SseEventName = (typeof SSE_EVENT_NAMES)[number];

export const SSE_CONTROL_EVENT_NAMES = ['gap'] as const;

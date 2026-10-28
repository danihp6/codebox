import { z } from 'zod';
import { parseOrThrow } from './parse.js';
import {
  AccountId,
  ApprovalId,
  ChatId,
  DeviceId,
  JobId,
  MessageId,
  RepoId,
  RunId,
  ScheduleId,
  SessionId,
  SubscriptionId,
  WorkId,
  branchSchema,
  commitShaSchema,
  cronSchema,
  globSchema,
  repoPolicySchema,
  runModeSchema,
  runStateSchema,
  runTriggerSchema,
  scopeSchema,
  slugSchema,
  sseEventNameSchema,
  timestampSchema,
  timezoneSchema,
} from './primitives.js';

// §5.1 Health, version, telemetry
export const healthComponentSchema = z.enum(['ok', 'degraded', 'down']);

export const diskSchema = z.strictObject({
  freeBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().positive(),
  usedPercent: z.number().min(0).max(100),
});

export const queueSchema = z.strictObject({
  pending: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  maxConcurrency: z.number().int().positive(),
});

export const healthSchema = z.strictObject({
  status: healthComponentSchema,
  db: healthComponentSchema,
  opencode: healthComponentSchema,
  disk: diskSchema,
  queue: queueSchema,
  version: z.string().min(1),
});

export const versionSchema = z.strictObject({
  version: z.string().min(1),
  commit: z.string().min(1).nullable(),
  builtAt: timestampSchema.nullable(),
  node: z.string().min(1),
});

export const TELEMETRY_RANGES = ['1h', '24h', '7d', '30d'] as const;
export const telemetryRangeSchema = z.enum(TELEMETRY_RANGES);

export const telemetrySchema = z.strictObject({
  range: telemetryRangeSchema,
  since: timestampSchema,
  spendUsd: z.number().nonnegative(),
  runs: z.strictObject({
    total: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
  }),
  disk: diskSchema,
  queueDepth: z.number().int().nonnegative(),
});

export const providerNameSchema = z.enum(['github', 'opencode', 'push', 'tunnel']);
export const providerModeSchema = z.enum(['app', 'pat', 'key', 'none']);

export const providerStatusSchema = z.strictObject({
  provider: providerNameSchema,
  configured: z.boolean(),
  mode: providerModeSchema,
  lastOkAt: timestampSchema.nullable(),
  fingerprint: z.string().min(1).nullable(),
});

export const providersSchema = z.strictObject({
  providers: z.array(providerStatusSchema),
});

// §5.9.1 Provider accounts (D54)
export const PROVIDER_ACCOUNT_STATES = ['active', 'exhausted', 'invalid', 'disabled'] as const;
export const providerAccountStateSchema = z.enum(PROVIDER_ACCOUNT_STATES);

export const providerAccountSchema = z.strictObject({
  id: AccountId,
  label: z.string().min(1),
  priority: z.number().int().min(1),
  state: providerAccountStateSchema,
  enabled: z.boolean(),
  lastFour: z.string().length(4).nullable(),
  spentTodayUsd: z.number().nonnegative(),
  budgetUsd: z.number().nonnegative().nullable(),
  resetAt: timestampSchema.nullable(),
  lastUsedAt: timestampSchema.nullable(),
});
export type ProviderAccount = z.infer<typeof providerAccountSchema>;

export const providerAccountTestSchema = z.strictObject({
  ok: z.boolean(),
  state: providerAccountStateSchema,
  lastError: z.string().nullable(),
});
export type ProviderAccountTest = z.infer<typeof providerAccountTestSchema>;

export const oauthStartSchema = z.strictObject({
  authorizeUrl: z.string().min(1),
  state: z.string().min(1),
});
export type OAuthStart = z.infer<typeof oauthStartSchema>;

export const brakeSchema = z.strictObject({ enabled: z.boolean() });

// §5.2 Repositories
export const repoSchema = z.strictObject({
  id: RepoId,
  slug: slugSchema,
  defaultBranch: branchSchema,
  gate: z.string().min(1),
  policy: repoPolicySchema,
  protectedPaths: z.array(globSchema),
  enabled: z.boolean(),
  createdAt: timestampSchema,
});

export const repoVerifySchema = z.strictObject({
  ok: z.boolean(),
  defaultBranch: branchSchema,
  canPush: z.boolean(),
  checks: z.array(
    z.strictObject({
      name: z.string().min(1),
      state: z.string().min(1),
    }),
  ),
});

// §5.3 Jobs
export const jobSchema = z.strictObject({
  id: JobId,
  repoId: RepoId,
  title: z.string().min(1),
  prompt: z.string().min(1),
  mode: runModeSchema,
  agent: z.string().min(1),
  model: z.string().min(1).nullable(),
  cron: cronSchema,
  timezone: timezoneSchema,
  enabled: z.boolean(),
  policy: repoPolicySchema,
  createdAt: timestampSchema,
  nextFireAt: timestampSchema.nullable(),
});

export const jobNextSchema = z.strictObject({ fires: z.array(timestampSchema) });

// §5.4 Runs
export const guardrailIdSchema = z.enum([
  'gate',
  'checks',
  'base',
  'diff',
  'protected_paths',
  'labels',
  'policy',
  'automerger',
]);
export type GuardrailId = z.infer<typeof guardrailIdSchema>;

export const GUARDRAIL_IDS: readonly GuardrailId[] = Object.freeze([...guardrailIdSchema.options]);

export const guardrailStateSchema = z.enum(['pass', 'fail', 'skip']);

export const guardrailSchema = z.strictObject({
  id: guardrailIdSchema,
  state: guardrailStateSchema,
  reason: z.string().min(1).optional(),
});

export const blockerCodeSchema = z.enum([
  'base_moved',
  'protected_path',
  'diff_budget',
  'checks_red',
  'label_do_not_merge',
  'policy_manual',
  'automerger_off',
  'gate_failed',
  'not_mergeable',
]);
export type BlockerCode = z.infer<typeof blockerCodeSchema>;

export const blockerSchema = z.strictObject({
  code: blockerCodeSchema,
  message: z.string().min(1),
});

export const prRefSchema = z.strictObject({
  number: z.number().int().positive(),
  url: z.url({ protocol: /^https$/ }),
  mergeable: z.boolean(),
});

export const gateResultSchema = z.strictObject({
  status: z.enum(['passed', 'failed', 'skipped']),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
});

export const diffStatSchema = z.strictObject({
  files: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
});

export const changedFileSchema = z.strictObject({
  path: z.string().min(1),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
});

export const runDiffSchema = diffStatSchema.extend({
  changedFiles: z.array(changedFileSchema),
});
export type RunDiff = z.infer<typeof runDiffSchema>;

export const costSchema = z.strictObject({
  usd: z.number().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
});

export const runSchema = z.strictObject({
  id: RunId,
  repoId: RepoId,
  jobId: JobId.nullable(),
  state: runStateSchema,
  trigger: runTriggerSchema,
  branch: branchSchema,
  baseRef: branchSchema,
  pr: prRefSchema.nullable(),
  gate: gateResultSchema.nullable(),
  guardrails: z.array(guardrailSchema),
  blockers: z.array(blockerSchema),
  diff: diffStatSchema.nullable(),
  cost: costSchema,
  createdAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
});
export type Run = z.infer<typeof runSchema>;

export const repoDetailSchema = repoSchema.extend({ lastRun: runSchema.nullable() });
export type RepoDetail = z.infer<typeof repoDetailSchema>;

// §5.5 Approvals
export const APPROVAL_STATES = ['pending', 'allowed', 'denied', 'expired'] as const;
export const approvalStateSchema = z.enum(APPROVAL_STATES);

export const approvalSchema = z.strictObject({
  id: ApprovalId,
  state: approvalStateSchema,
  tool: z.string().min(1),
  title: z.string().min(1),
  runId: RunId.nullable(),
  chatId: ChatId.nullable(),
  input: z.record(z.string(), z.unknown()),
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  resolvedAt: timestampSchema.nullable(),
});
export type Approval = z.infer<typeof approvalSchema>;

// §5.6 Works and backlog (D44, D51)
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

export const WORK_ORIGINS = ['manual', 'backlog', 'schedule'] as const;
export const workOriginSchema = z.enum(WORK_ORIGINS);
export type WorkOrigin = z.infer<typeof workOriginSchema>;

export const backlogItemRefSchema: z.ZodString = z.string().regex(/^[A-Z][A-Za-z]*-\d{1,4}$/);

export const workSchema = z.strictObject({
  id: WorkId,
  repoId: RepoId,
  title: z.string().min(1),
  prompt: z.string().min(1),
  backlogRef: backlogItemRefSchema,
  state: workStateSchema,
  origin: workOriginSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().min(1),
  usage: costSchema,
  contextTokens: z.number().int().nonnegative(),
  contextEpoch: z.number().int().min(1),
  reviewedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Work = z.infer<typeof workSchema>;

export const backlogWorkSchema = z.strictObject({
  id: WorkId,
  state: workStateSchema,
  runs: z.number().int().nonnegative(),
});
export type BacklogWork = z.infer<typeof backlogWorkSchema>;

export const backlogItemSchema = z.strictObject({
  ref: backlogItemRefSchema,
  title: z.string(),
  checked: z.boolean(),
  line: z.number().int().positive(),
  work: backlogWorkSchema.nullable(),
});
export type BacklogItem = z.infer<typeof backlogItemSchema>;

export const backlogSectionSchema = z.strictObject({
  title: z.string().min(1),
  items: z.array(backlogItemSchema),
});
export type BacklogSection = z.infer<typeof backlogSectionSchema>;

export const backlogSchema = z.strictObject({
  repoId: RepoId,
  revision: commitShaSchema,
  path: z.string().min(1),
  sections: z.array(backlogSectionSchema),
});
export type Backlog = z.infer<typeof backlogSchema>;

// §5.6.1 Sessions (D55)
export const CHAT_ROLES = ['user', 'assistant', 'system'] as const;
export const chatRoleSchema = z.enum(CHAT_ROLES);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const SESSION_TARGETS = ['backlog', 'design', 'schedule', 'work', 'repo'] as const;
export const sessionTargetSchema = z.enum(SESSION_TARGETS);
export type SessionTarget = z.infer<typeof sessionTargetSchema>;

export const SESSION_STATES = ['idle', 'working', 'archived'] as const;
export const sessionStateSchema = z.enum(SESSION_STATES);
export type SessionState = z.infer<typeof sessionStateSchema>;

export const sessionMessageSchema = z.strictObject({
  id: MessageId,
  sessionId: SessionId,
  role: chatRoleSchema,
  text: z.string(),
  createdAt: timestampSchema,
});
export type SessionMessage = z.infer<typeof sessionMessageSchema>;

export const sessionProposalSchema = z.strictObject({
  branch: branchSchema,
  files: z.array(z.string().min(1)),
  createdAt: timestampSchema,
});
export type SessionProposal = z.infer<typeof sessionProposalSchema>;

export const sessionSchema = z.strictObject({
  id: SessionId,
  repoId: RepoId,
  target: sessionTargetSchema,
  workId: WorkId.nullable(),
  state: sessionStateSchema,
  branch: branchSchema.nullable(),
  pendingProposal: sessionProposalSchema.nullable(),
  usage: costSchema,
  contextTokens: z.number().int().nonnegative(),
  contextEpoch: z.number().int().min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastMessage: sessionMessageSchema.nullable(),
});
export type Session = z.infer<typeof sessionSchema>;

// §5.6 Chat (legacy: retired by D55, the daemon surface goes with Task-76)
export const chatMessageSchema = z.strictObject({
  id: MessageId,
  chatId: ChatId,
  role: chatRoleSchema,
  text: z.string(),
  createdAt: timestampSchema,
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const CHAT_STATUSES = ['idle', 'working', 'archived'] as const;
export const chatStatusSchema = z.enum(CHAT_STATUSES);

export const chatSessionSchema = z.strictObject({
  id: ChatId,
  repoId: RepoId.nullable(),
  kind: z.enum(['free', 'repo', 'schedule']).optional(),
  title: z.string().min(1),
  status: chatStatusSchema,
  usage: costSchema.optional(),
  contextTokens: z.number().int().nonnegative().optional(),
  contextEpoch: z.number().int().min(1).optional(),
  reviewedAt: timestampSchema.nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastMessage: chatMessageSchema.nullable(),
});
export type ChatSession = z.infer<typeof chatSessionSchema>;

// §5.7 Settings and push
export const devicePlatformSchema = z.enum(['ios', 'android', 'web', 'cli']);

export const deviceSchema = z.strictObject({
  id: DeviceId,
  name: z.string().min(1),
  platform: devicePlatformSchema,
  scopes: z.array(scopeSchema),
  createdAt: timestampSchema,
  lastSeenAt: timestampSchema.nullable(),
});
export type Device = z.infer<typeof deviceSchema>;

export const pushKindSchema = z.enum(['web', 'fcm', 'apns']);

export const pushSubscriptionSchema = z.strictObject({
  id: SubscriptionId,
  kind: pushKindSchema,
  endpoint: z.string().min(1),
  keys: z.record(z.string(), z.string()),
});
export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;

export const quietHoursSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();

export const notificationPreferencesSchema = z.strictObject({
  events: z.array(sseEventNameSchema),
  quietHours: quietHoursSchema,
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const MERGE_METHODS = ['squash', 'merge'] as const;
const mergeMethodSchema = z.enum(MERGE_METHODS);

export const settingsSchema = z.strictObject({
  automerge: z.boolean(),
  mergeMethod: mergeMethodSchema,
  maxConcurrency: z.number().int().min(1),
  dailyCostUsd: z.number().nonnegative(),
  protectedPaths: z.array(globSchema),
  diffMaxFiles: z.number().int().min(1),
  diffMaxLines: z.number().int().min(1),
  timezone: timezoneSchema,
  quietHours: quietHoursSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export const meSchema = z.strictObject({
  device: deviceSchema,
  scopes: z.array(scopeSchema),
  serverTime: timestampSchema,
});
export type Me = z.infer<typeof meSchema>;

// §5.9 Schedules: one recurring object, a cron, a window or a single fire (D44, D46).
export const SCHEDULE_MODES = ['once', 'every', 'window'] as const;
export const scheduleModeSchema = z.enum(SCHEDULE_MODES);
export type ScheduleMode = z.infer<typeof scheduleModeSchema>;

export const SCHEDULE_FIRE_POLICIES = ['new_chat', 'continue'] as const;
export const scheduleFirePolicySchema = z.enum(SCHEDULE_FIRE_POLICIES);
export type ScheduleFirePolicy = z.infer<typeof scheduleFirePolicySchema>;

export const scheduleWindowTimeSchema: z.ZodString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export type Schedule = {
  id: string;
  repoId: string | null;
  chatSessionId: string | null;
  title: string;
  prompt: string;
  mode: ScheduleMode;
  cron: string | null;
  timezone: string;
  windowStart: string | null;
  windowEnd: string | null;
  cooldownMinutes: number;
  maxFires: number | null;
  maxCostPerFireUsd: number | null;
  firePolicy: ScheduleFirePolicy;
  consecutiveFailures: number;
  firesCount: number;
  spendUsd: number;
  enabled: boolean;
  policy: 'auto' | 'manual';
  nextFireAt: string | null;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const scheduleObjectSchema = z.strictObject({
  id: ScheduleId,
  repoId: RepoId.nullable(),
  chatSessionId: ChatId.nullable(),
  title: z.string().min(1).max(120),
  prompt: z.string().min(1).max(8_000),
  mode: scheduleModeSchema,
  cron: cronSchema.nullable(),
  timezone: timezoneSchema,
  windowStart: scheduleWindowTimeSchema.nullable(),
  windowEnd: scheduleWindowTimeSchema.nullable(),
  cooldownMinutes: z.number().int().nonnegative(),
  maxFires: z.number().int().min(1).nullable(),
  maxCostPerFireUsd: z.number().nonnegative().nullable(),
  firePolicy: scheduleFirePolicySchema,
  consecutiveFailures: z.number().int().nonnegative(),
  firesCount: z.number().int().nonnegative(),
  spendUsd: z.number().nonnegative(),
  enabled: z.boolean(),
  policy: repoPolicySchema,
  nextFireAt: timestampSchema.nullable(),
  lastFiredAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

// D46: a window schedule carries its opening hours and no cron; every other mode carries a
// cron and no window. A report on `mode` keeps the two field families from disagreeing.
export const scheduleSchema: z.ZodType<Schedule> = scheduleObjectSchema.superRefine(
  (value, ctx) => {
    if (value.mode === 'window') {
      const shaped =
        value.cron === null &&
        value.windowStart !== null &&
        value.windowEnd !== null &&
        value.windowStart !== value.windowEnd;
      if (!shaped) {
        ctx.addIssue({
          code: 'custom',
          path: ['mode'],
          message: 'a window schedule needs windowStart and windowEnd and no cron',
        });
      }
      return;
    }
    const shaped = value.cron !== null && value.windowStart === null && value.windowEnd === null;
    if (!shaped) {
      ctx.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'a schedule without a window needs a cron and no window bounds',
      });
    }
  },
);

export const scheduleDetailSchema = z.strictObject({
  schedule: scheduleSchema,
  nextFires: z.array(timestampSchema),
});
export type ScheduleDetail = z.infer<typeof scheduleDetailSchema>;

export type RepoVerify = z.infer<typeof repoVerifySchema>;

export type Job = z.infer<typeof jobSchema>;
export type Repo = z.infer<typeof repoSchema>;
export type Health = z.infer<typeof healthSchema>;
export type Version = z.infer<typeof versionSchema>;
export type Telemetry = z.infer<typeof telemetrySchema>;
export type Providers = z.infer<typeof providersSchema>;
export type Brake = z.infer<typeof brakeSchema>;
export type JobNext = z.infer<typeof jobNextSchema>;

export function parseRepo(input: unknown): Repo {
  return parseOrThrow(repoSchema, input, 'repo');
}

export function parseRepoDetail(input: unknown): RepoDetail {
  return parseOrThrow(repoDetailSchema, input, 'repoDetail');
}

export function parseRepoVerify(input: unknown): RepoVerify {
  return parseOrThrow(repoVerifySchema, input, 'repoVerify');
}

export function parseJob(input: unknown): Job {
  return parseOrThrow(jobSchema, input, 'job');
}

export function parseRun(input: unknown): Run {
  return parseOrThrow(runSchema, input, 'run');
}

export function parseRunDiff(input: unknown): RunDiff {
  return parseOrThrow(runDiffSchema, input, 'runDiff');
}

export function parseApproval(input: unknown): Approval {
  return parseOrThrow(approvalSchema, input, 'approval');
}

export function parseChatSession(input: unknown): ChatSession {
  return parseOrThrow(chatSessionSchema, input, 'chatSession');
}

export function parseChatMessage(input: unknown): ChatMessage {
  return parseOrThrow(chatMessageSchema, input, 'chatMessage');
}

export function parseDevice(input: unknown): Device {
  return parseOrThrow(deviceSchema, input, 'device');
}

export function parseHealth(input: unknown): Health {
  return parseOrThrow(healthSchema, input, 'health');
}

export function parseVersion(input: unknown): Version {
  return parseOrThrow(versionSchema, input, 'version');
}

export function parseTelemetry(input: unknown): Telemetry {
  return parseOrThrow(telemetrySchema, input, 'telemetry');
}

export function parseProviders(input: unknown): Providers {
  return parseOrThrow(providersSchema, input, 'providers');
}

export function parseSettings(input: unknown): Settings {
  return parseOrThrow(settingsSchema, input, 'settings');
}

export function parseNotificationPreferences(input: unknown): NotificationPreferences {
  return parseOrThrow(notificationPreferencesSchema, input, 'notificationPreferences');
}

export function parsePushSubscription(input: unknown): PushSubscription {
  return parseOrThrow(pushSubscriptionSchema, input, 'pushSubscription');
}

export function parseMe(input: unknown): Me {
  return parseOrThrow(meSchema, input, 'me');
}

export function parseBrake(input: unknown): Brake {
  return parseOrThrow(brakeSchema, input, 'brake');
}

export function parseWork(input: unknown): Work {
  return parseOrThrow(workSchema, input, 'work');
}

export function parseBacklog(input: unknown): Backlog {
  return parseOrThrow(backlogSchema, input, 'backlog');
}

export function parseSession(input: unknown): Session {
  return parseOrThrow(sessionSchema, input, 'session');
}

export function parseProviderAccount(input: unknown): ProviderAccount {
  return parseOrThrow(providerAccountSchema, input, 'providerAccount');
}

export function parseSchedule(input: unknown): Schedule {
  return parseOrThrow(scheduleSchema, input, 'schedule');
}

export function parseScheduleDetail(input: unknown): ScheduleDetail {
  return parseOrThrow(scheduleDetailSchema, input, 'scheduleDetail');
}

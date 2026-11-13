import { z } from 'zod';
import { parseOrThrow } from './parse.js';
import type { RepoPolicy } from './primitives.js';
import {
  ApprovalId,
  ChatId,
  DeviceId,
  JobId,
  MessageId,
  RepoId,
  RunId,
  ScheduleId,
  SubscriptionId,
  branchSchema,
  cronSchema,
  globSchema,
  nameSchema,
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
  // Optional and unvalidated on purpose: it is CB_INSTANCE_NAME, which the loader accepts even
  // when empty, so a min(1) here would turn a bad env into a 500 on the endpoint About reads.
  // The daemon always sets it (D16: an additive field is not a breaking change).
  instance: z.string().optional(),
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

export const brakeSchema = z.strictObject({ enabled: z.boolean() });

// §5.2 Repositories
// D59: the three counts belong to the row that loads the repository, so no client ever counts.
const repoCountsSchema = z.strictObject({
  pending: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
});

export const REPO_SOURCES = ['local', 'github'] as const;
export const repoSourceSchema = z.enum(REPO_SOURCES);
export type RepoSource = z.infer<typeof repoSourceSchema>;

/**
 * The repository object without the cross-field rule: `openapi.ts` compiles it with
 * `z.toJSONSchema`, and the D62 rule (`a github repository has a slug`) is a refinement.
 */
export const repoObjectSchema = z.strictObject({
  id: RepoId,
  // Optional only so fixtures that predate D62 keep parsing; the daemon always sets both.
  source: repoSourceSchema.optional(),
  name: nameSchema.optional(),
  slug: slugSchema.nullable(),
  defaultBranch: branchSchema,
  gate: z.string().min(1),
  policy: repoPolicySchema,
  protectedPaths: z.array(globSchema),
  enabled: z.boolean(),
  createdAt: timestampSchema,
  // Optional only so fixtures that predate D59 keep parsing; the daemon always sets it.
  counts: repoCountsSchema.optional(),
});
export type Repo = z.infer<typeof repoObjectSchema>;

/** D62: `source !== 'local'` is a github repository, an absent `source` included. */
function githubNeedsSlug(
  value: { readonly source?: RepoSource | undefined; readonly slug: string | null },
  ctx: z.RefinementCtx,
): void {
  if (value.source !== 'local' && value.slug === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['slug'],
      message: 'a github repository needs a slug',
    });
  }
}

/** `docs/api.md` §5.2. A `github` repository without a slug is refused. */
export const repoSchema: z.ZodType<Repo> = repoObjectSchema.superRefine(githubNeedsSlug);

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

/** `docs/api.md` §5.2. One strict body whose `mode` decides which of `name`/`slug` is required. */
export type CreateRepoBody = {
  readonly mode?: 'local' | 'connect' | undefined;
  readonly name?: string | undefined;
  readonly slug?: string | undefined;
  readonly defaultBranch?: string | undefined;
  readonly gate?: string | undefined;
  readonly policy?: RepoPolicy | undefined;
  readonly protectedPaths?: readonly string[] | undefined;
};

const createRepoObjectSchema = z.strictObject({
  mode: z.enum(['local', 'connect']).optional(),
  name: nameSchema.optional(),
  slug: slugSchema.optional(),
  defaultBranch: branchSchema.optional(),
  gate: z.string().min(1).optional(),
  policy: repoPolicySchema.optional(),
  protectedPaths: z.array(globSchema).optional(),
});

/**
 * D62: one body, two sources. A union would report `invalid_union` at the empty path and the
 * route owes `422` with `details.path`; `mode` is never defaulted so the service can tell an
 * explicit `connect` from the legacy `{ slug }` body.
 */
export const createRepoBodySchema: z.ZodType<CreateRepoBody> = createRepoObjectSchema.superRefine(
  (value, ctx) => {
    if (value.mode === 'local') {
      if (value.slug !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['slug'],
          message: 'a local repository has no remote',
        });
      }
      if (value.name === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['name'],
          message: 'a local repository needs a name',
        });
      }
      return;
    }
    if (value.slug === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['slug'],
        message: 'a github repository needs a slug',
      });
    }
    if (value.name !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'a github repository takes its name from the slug',
      });
    }
  },
);

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

export const repoDetailSchema: z.ZodType<RepoDetail> = repoObjectSchema
  .extend({ lastRun: runSchema.nullable() })
  .superRefine(githubNeedsSlug);
export type RepoDetail = Repo & { readonly lastRun: Run | null };

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

// §5.6 Chat
export const CHAT_ROLES = ['user', 'assistant', 'system'] as const;
export const chatRoleSchema = z.enum(CHAT_ROLES);

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
export type Health = z.infer<typeof healthSchema>;
export type Version = z.infer<typeof versionSchema>;
export type Telemetry = z.infer<typeof telemetrySchema>;
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

export function parseSchedule(input: unknown): Schedule {
  return parseOrThrow(scheduleSchema, input, 'schedule');
}

export function parseScheduleDetail(input: unknown): ScheduleDetail {
  return parseOrThrow(scheduleDetailSchema, input, 'scheduleDetail');
}

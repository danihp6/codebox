import { z } from 'zod';
import { parseOrThrow } from './parse.js';
import {
  ApprovalId,
  ChatId,
  JobId,
  RepoId,
  RunId,
  commitShaSchema,
  runTriggerSchema,
  timestampSchema,
} from './primitives.js';
import type { SseEventName } from './primitives.js';
import {
  MERGE_METHODS,
  chatMessageSchema,
  gateResultSchema,
  healthSchema,
  prRefSchema,
} from './resources.js';

const toolStatusSchema = z.enum(['start', 'ok', 'error']);

export const runEventBase = z.strictObject({
  runId: RunId,
  seq: z.number().int().min(1),
  ts: timestampSchema,
});

export const chatEventBase = z.strictObject({
  chatId: ChatId,
  seq: z.number().int().min(1),
  ts: timestampSchema,
});

export const runQueuedDataSchema = runEventBase.extend({
  repoId: RepoId,
  jobId: JobId.nullable(),
  trigger: runTriggerSchema,
});

export const runStartedDataSchema = runEventBase.extend({ branch: z.string().min(1) });

export const runOutputDataSchema = runEventBase.extend({ delta: z.string() });

export const runToolDataSchema = runEventBase.extend({
  tool: z.string().min(1),
  status: toolStatusSchema,
  detail: z.string().optional(),
});

export const runPermissionDataSchema = runEventBase.extend({
  approvalId: ApprovalId,
  tool: z.string().min(1),
  title: z.string().min(1),
});

export const runGateDataSchema = runEventBase.extend({ gate: gateResultSchema });

export const runPrDataSchema = runEventBase.extend({ pr: prRefSchema });

export const runMergedDataSchema = runEventBase.extend({
  pr: prRefSchema,
  mergeCommit: commitShaSchema,
  method: z.enum(MERGE_METHODS),
});

export const runFinishedDataSchema = runEventBase.extend({ state: z.literal('succeeded') });

export const runFailedDataSchema = runEventBase.extend({
  state: z.literal('failed'),
  code: z.string().min(1),
  message: z.string().min(1),
});

export const runCancelledDataSchema = runEventBase.extend({
  state: z.literal('cancelled'),
  reason: z.string().min(1).optional(),
});

export const chatDeltaDataSchema = chatEventBase.extend({ delta: z.string() });

export const chatMessageDataSchema = chatEventBase.extend({ message: chatMessageSchema });

export const chatToolDataSchema = chatEventBase.extend({
  tool: z.string().min(1),
  status: toolStatusSchema,
  detail: z.string().optional(),
});

export const chatPermissionDataSchema = chatEventBase.extend({
  approvalId: ApprovalId,
  tool: z.string().min(1),
  title: z.string().min(1),
});

export const chatIdleDataSchema = chatEventBase;

export const jobChangedDataSchema = z.strictObject({
  jobId: JobId,
  change: z.enum(['created', 'updated', 'deleted', 'paused', 'resumed']),
  ts: timestampSchema,
});

export const approvalCreatedDataSchema = z.strictObject({
  approvalId: ApprovalId,
  runId: RunId.nullable(),
  chatId: ChatId.nullable(),
  tool: z.string().min(1),
  title: z.string().min(1),
  expiresAt: timestampSchema,
  ts: timestampSchema,
});

export const approvalResolvedDataSchema = z.strictObject({
  approvalId: ApprovalId,
  decision: z.enum(['allow', 'deny', 'expired']),
  ts: timestampSchema,
});

export const telemetryDataSchema = z.strictObject({
  ts: timestampSchema,
  health: healthSchema,
  spendTodayUsd: z.number().nonnegative(),
  queueDepth: z.number().int().nonnegative(),
});

export const sseEventSchema = z.discriminatedUnion('event', [
  z.strictObject({ event: z.literal('run.queued'), data: runQueuedDataSchema }),
  z.strictObject({ event: z.literal('run.started'), data: runStartedDataSchema }),
  z.strictObject({ event: z.literal('run.output'), data: runOutputDataSchema }),
  z.strictObject({ event: z.literal('run.tool'), data: runToolDataSchema }),
  z.strictObject({ event: z.literal('run.permission'), data: runPermissionDataSchema }),
  z.strictObject({ event: z.literal('run.gate'), data: runGateDataSchema }),
  z.strictObject({ event: z.literal('run.pr'), data: runPrDataSchema }),
  z.strictObject({ event: z.literal('run.merged'), data: runMergedDataSchema }),
  z.strictObject({ event: z.literal('run.finished'), data: runFinishedDataSchema }),
  z.strictObject({ event: z.literal('run.failed'), data: runFailedDataSchema }),
  z.strictObject({ event: z.literal('run.cancelled'), data: runCancelledDataSchema }),
  z.strictObject({ event: z.literal('chat.delta'), data: chatDeltaDataSchema }),
  z.strictObject({ event: z.literal('chat.message'), data: chatMessageDataSchema }),
  z.strictObject({ event: z.literal('chat.tool'), data: chatToolDataSchema }),
  z.strictObject({ event: z.literal('chat.permission'), data: chatPermissionDataSchema }),
  z.strictObject({ event: z.literal('chat.idle'), data: chatIdleDataSchema }),
  z.strictObject({ event: z.literal('job.changed'), data: jobChangedDataSchema }),
  z.strictObject({ event: z.literal('approval.created'), data: approvalCreatedDataSchema }),
  z.strictObject({ event: z.literal('approval.resolved'), data: approvalResolvedDataSchema }),
  z.strictObject({ event: z.literal('telemetry'), data: telemetryDataSchema }),
]);
export type SseEvent = z.infer<typeof sseEventSchema>;

export type SseEventData = { [K in SseEventName]: Extract<SseEvent, { event: K }>['data'] };

/** `event: gap`, docs/api.md §6. The name is imported from primitives.ts, not redefined. */
export const sseGapDataSchema = z.strictObject({
  afterId: z.number().int().nonnegative(),
  latestId: z.number().int().nonnegative(),
  ts: timestampSchema,
});

export const sseGapEventSchema = z.strictObject({
  event: z.literal('gap'),
  data: sseGapDataSchema,
});

export const sseStreamEventSchema = z.union([sseEventSchema, sseGapEventSchema]);
export type SseStreamEvent = z.infer<typeof sseStreamEventSchema>;

export function parseSseEvent(input: unknown): SseEvent {
  return parseOrThrow(sseEventSchema, input, 'event');
}

export function parseSseStreamEvent(input: unknown): SseStreamEvent {
  return parseOrThrow(sseStreamEventSchema, input, 'streamEvent');
}

export const SSE_RETRY_MS = 3000;
export const SSE_HEARTBEAT_SECONDS = 15;

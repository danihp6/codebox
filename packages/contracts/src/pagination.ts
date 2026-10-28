import { z } from 'zod';
import { parseOrThrow } from './parse.js';
import {
  approvalSchema,
  chatMessageSchema,
  chatSessionSchema,
  deviceSchema,
  jobSchema,
  repoSchema,
  runSchema,
} from './resources.js';
import type { Approval, ChatMessage, ChatSession, Device, Job, Repo, Run } from './resources.js';
import { routineSchema } from './routines.js';
import type { Routine } from './routines.js';
import { repoScheduleSchema, sessionMessageSchema, sessionSchema, workSchema } from './works.js';
import type { RepoSchedule, Session, SessionMessage, Work } from './works.js';

export const PAGINATION_DEFAULT_LIMIT = 50;
export const PAGINATION_MAX_LIMIT = 200;
export const IDEMPOTENCY_RETENTION_HOURS = 24;
export const IDEMPOTENCY_KEY_MIN_LENGTH = 1;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export const paginationQuerySchema = z.strictObject({
  limit: z.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const idempotencyKeySchema = z
  .string()
  .min(IDEMPOTENCY_KEY_MIN_LENGTH)
  .max(IDEMPOTENCY_KEY_MAX_LENGTH);

export type Page<T> = { data: T[]; nextCursor: string | null };

export function pageSchema<T extends z.ZodTypeAny>(item: T): z.ZodType<Page<z.infer<T>>> {
  return z.strictObject({
    data: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export const pageOfRepo: z.ZodType<Page<Repo>> = pageSchema(repoSchema);
export const pageOfJob: z.ZodType<Page<Job>> = pageSchema(jobSchema);
export const pageOfRun: z.ZodType<Page<Run>> = pageSchema(runSchema);
export const pageOfApproval: z.ZodType<Page<Approval>> = pageSchema(approvalSchema);
export const pageOfChatSession: z.ZodType<Page<ChatSession>> = pageSchema(chatSessionSchema);
export const pageOfChatMessage: z.ZodType<Page<ChatMessage>> = pageSchema(chatMessageSchema);
export const pageOfDevice: z.ZodType<Page<Device>> = pageSchema(deviceSchema);
export const pageOfRoutine: z.ZodType<Page<Routine>> = pageSchema(routineSchema);
export const pageOfWork: z.ZodType<Page<Work>> = pageSchema(workSchema);
export const pageOfSession: z.ZodType<Page<Session>> = pageSchema(sessionSchema);
export const pageOfSessionMessage: z.ZodType<Page<SessionMessage>> =
  pageSchema(sessionMessageSchema);
export const pageOfRepoSchedule: z.ZodType<Page<RepoSchedule>> = pageSchema(repoScheduleSchema);

export function parsePage<T>(item: z.ZodType<T>, input: unknown, boundary: string): Page<T> {
  return parseOrThrow(pageSchema(item), input, boundary);
}

/** docs/api.md §4: the exact routes that require the header. */
export const IDEMPOTENT_ROUTES: readonly string[] = Object.freeze([
  'POST /v1/runs',
  'POST /v1/jobs/{id}/run',
  'POST /v1/chat/sessions/{id}/promote',
]);

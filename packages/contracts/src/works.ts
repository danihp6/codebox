import { z } from 'zod';
import { parseOrThrow } from './parse.js';
import {
  MessageId,
  RepoId,
  ScheduleId,
  SessionId,
  WorkId,
  backlogRefSchema,
  branchSchema,
  commitShaSchema,
  cronSchema,
  selectionSchema,
  sessionStatusSchema,
  sessionTargetSchema,
  timestampSchema,
  timezoneSchema,
  workOriginSchema,
  workStateSchema,
} from './primitives.js';
import {
  chatRoleSchema,
  costSchema,
  repoSchema,
  runSchema,
  scheduleModeSchema,
  scheduleWindowTimeSchema,
} from './resources.js';

// docs/api.md §5.6 — the parsed backlog, joined with works (D51).
export const backlogWorkRefSchema = z.strictObject({
  id: WorkId,
  state: workStateSchema,
  runs: z.number().int().nonnegative(),
});
export type BacklogWorkRef = z.infer<typeof backlogWorkRefSchema>;

export const backlogItemSchema = z.strictObject({
  ref: backlogRefSchema,
  title: z.string().min(1),
  checked: z.boolean(),
  line: z.number().int().positive(),
  needs: z.array(backlogRefSchema).default([]),
  work: backlogWorkRefSchema.nullable(),
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

// docs/api.md §5.6 / D44 / D51 — one work, one backlog item, no conversation.
export const workSchema = z.strictObject({
  id: WorkId,
  repoId: RepoId,
  backlogRef: backlogRefSchema,
  title: z.string().min(1),
  prompt: z.string().min(1),
  specSha: commitShaSchema,
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

export const workDetailSchema = z.strictObject({
  work: workSchema,
  repo: repoSchema,
  runs: z.array(runSchema),
});
export type WorkDetail = z.infer<typeof workDetailSchema>;

// docs/api.md §5.6.1 / D55 — a chat with one target; the target is the write boundary.
export const sessionProposalSchema = z.strictObject({
  branch: branchSchema,
  sha: commitShaSchema,
  paths: z.array(z.string().min(1)).min(1),
  createdAt: timestampSchema,
});
export type SessionProposal = z.infer<typeof sessionProposalSchema>;

export const sessionMessageSchema = z.strictObject({
  id: MessageId,
  sessionId: SessionId,
  role: chatRoleSchema,
  text: z.string(),
  createdAt: timestampSchema,
});
export type SessionMessage = z.infer<typeof sessionMessageSchema>;

export const sessionSchema = z
  .strictObject({
    id: SessionId,
    repoId: RepoId,
    target: sessionTargetSchema,
    workId: WorkId.nullable(),
    title: z.string().min(1),
    status: sessionStatusSchema,
    branch: branchSchema.nullable(),
    pendingProposal: sessionProposalSchema.nullable(),
    usage: costSchema,
    contextTokens: z.number().int().nonnegative(),
    contextEpoch: z.number().int().min(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    lastMessage: sessionMessageSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if ((value.target === 'work') !== (value.workId !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['workId'],
        message: 'only a work session names a work, and a work session must name one',
      });
    }
    if (value.target === 'repo' && (value.branch !== null || value.pendingProposal !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'a repo session is read-only: no branch and no proposal',
      });
    }
  });
export type Session = z.infer<typeof sessionSchema>;

// docs/api.md §5.10 / D56 — the repository's recurrence. No title, no prompt, no chat.
export const repoScheduleSchema = z
  .strictObject({
    id: ScheduleId,
    repoId: RepoId,
    mode: scheduleModeSchema,
    cron: cronSchema.nullable(),
    timezone: timezoneSchema,
    windowStart: scheduleWindowTimeSchema.nullable(),
    windowEnd: scheduleWindowTimeSchema.nullable(),
    cooldownMinutes: z.number().int().nonnegative(),
    selection: selectionSchema,
    refs: z.array(backlogRefSchema),
    maxAttempts: z.number().int().min(1),
    maxFires: z.number().int().min(1).nullable(),
    maxCostPerFireUsd: z.number().nonnegative().nullable(),
    consecutiveFailures: z.number().int().nonnegative(),
    firesCount: z.number().int().nonnegative(),
    spendUsd: z.number().nonnegative(),
    enabled: z.boolean(),
    nextFireAt: timestampSchema.nullable(),
    lastFiredAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'window') {
      if (
        value.cron !== null ||
        value.windowStart === null ||
        value.windowEnd === null ||
        value.windowStart === value.windowEnd
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['mode'],
          message: 'a window schedule needs windowStart and windowEnd, distinct, and no cron',
        });
      }
    } else if (value.cron === null || value.windowStart !== null || value.windowEnd !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'a schedule without a window needs a cron and no window bounds',
      });
    }
    if (value.selection === 'nextPending' && value.refs.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['refs'], message: 'nextPending carries no refs' });
    }
    if (value.selection === 'refs' && value.refs.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['refs'], message: 'refs selection needs one ref' });
    }
  });
export type RepoSchedule = z.infer<typeof repoScheduleSchema>;

export function parseBacklog(input: unknown): Backlog {
  return parseOrThrow(backlogSchema, input, 'backlog');
}

export function parseWork(input: unknown): Work {
  return parseOrThrow(workSchema, input, 'work');
}

export function parseWorkDetail(input: unknown): WorkDetail {
  return parseOrThrow(workDetailSchema, input, 'workDetail');
}

export function parseSession(input: unknown): Session {
  return parseOrThrow(sessionSchema, input, 'session');
}

export function parseSessionMessage(input: unknown): SessionMessage {
  return parseOrThrow(sessionMessageSchema, input, 'sessionMessage');
}

export function parseRepoSchedule(input: unknown): RepoSchedule {
  return parseOrThrow(repoScheduleSchema, input, 'repoSchedule');
}

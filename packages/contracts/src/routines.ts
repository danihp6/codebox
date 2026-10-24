import { z } from 'zod';
import { parseOrThrow } from './parse.js';
import {
  ChatId,
  RepoId,
  RoutineId,
  cronSchema,
  routineKindSchema,
  timestampSchema,
  timezoneSchema,
} from './primitives.js';

const routineBase = z.strictObject({
  id: RoutineId,
  title: z.string().min(1).max(120),
  cron: cronSchema,
  timezone: timezoneSchema,
  enabled: z.boolean(),
  notify: z.boolean(),
  createdAt: timestampSchema,
  nextFireAt: timestampSchema.nullable(),
  lastFiredAt: timestampSchema.nullable(),
});

export const promptRoutineSchema = routineBase.extend({
  kind: z.literal('prompt'),
  repoId: RepoId,
  prompt: z.string().min(1),
  chatSessionId: ChatId.nullable(),
});

export const reminderRoutineSchema = routineBase.extend({
  kind: z.literal('reminder'),
});

export const routineSchema = z.discriminatedUnion('kind', [
  promptRoutineSchema,
  reminderRoutineSchema,
]);

export type Routine = z.infer<typeof routineSchema>;
export type PromptRoutine = z.infer<typeof promptRoutineSchema>;
export type ReminderRoutine = z.infer<typeof reminderRoutineSchema>;

export function parseRoutine(input: unknown): Routine {
  return parseOrThrow(routineSchema, input, 'routine');
}

export const ROUTINE_TOOL_NAMES = ['routine.create', 'routine.list', 'routine.pause'] as const;

export const routineCreateToolInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('prompt'),
    title: z.string().min(1).max(120),
    cron: cronSchema,
    timezone: timezoneSchema,
    prompt: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('reminder'),
    title: z.string().min(1).max(120),
    cron: cronSchema,
    timezone: timezoneSchema,
  }),
]);

export const routineCreateToolOutputSchema = z.strictObject({ routine: routineSchema });

export const routineListToolInputSchema = z.strictObject({
  kind: routineKindSchema.optional(),
});
export const routineListToolOutputSchema = z.strictObject({
  routines: z.array(routineSchema),
});

export const routinePauseToolInputSchema = z.strictObject({
  routineId: RoutineId,
  enabled: z.boolean(),
});
export const routinePauseToolOutputSchema = z.strictObject({ routine: routineSchema });

export type RoutineCreateToolInput = z.infer<typeof routineCreateToolInputSchema>;
export type RoutineCreateToolOutput = z.infer<typeof routineCreateToolOutputSchema>;
export type RoutineListToolInput = z.infer<typeof routineListToolInputSchema>;
export type RoutineListToolOutput = z.infer<typeof routineListToolOutputSchema>;
export type RoutinePauseToolInput = z.infer<typeof routinePauseToolInputSchema>;
export type RoutinePauseToolOutput = z.infer<typeof routinePauseToolOutputSchema>;

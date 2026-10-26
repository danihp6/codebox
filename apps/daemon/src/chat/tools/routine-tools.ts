import type { Routine } from '@codebox/contracts';
import {
  ROUTINE_TOOL_NAMES,
  routineCreateToolInputSchema,
  routineCreateToolOutputSchema,
  routineListToolInputSchema,
  routineListToolOutputSchema,
  routinePauseToolInputSchema,
  routinePauseToolOutputSchema,
} from '@codebox/contracts';
import type { Store } from '@codebox/store';
import { formatInstant, nextFireAt } from '../../jobs/service.js';
import { newRoutineId } from './ids.js';

const LIST_LIMIT = 50;

export type RoutineToolFailureCode =
  'invalid_input' | 'invalid_cron' | 'invalid_timezone' | 'not_found' | 'unknown_tool' | 'internal';

export type RoutineToolOutcome =
  | { readonly ok: true; readonly output: unknown }
  | { readonly ok: false; readonly code: RoutineToolFailureCode };

/** `chatId` and `repoId` come from the bearer token, never from the model's arguments. */
export interface RoutineToolContext {
  readonly store: Store;
  readonly now: () => Date;
  readonly random: (size: number) => Buffer;
  readonly chatId: string;
  readonly repoId: string;
}

export interface RoutineToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export const ROUTINE_TOOL_DEFINITIONS: readonly RoutineToolDefinition[] = Object.freeze([
  Object.freeze({
    name: ROUTINE_TOOL_NAMES[0],
    description:
      'Create a routine: a prompt answered in this chat or a push-only reminder, on a five-field cron.',
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'title', 'cron', 'timezone'],
      properties: Object.freeze({
        kind: Object.freeze({ type: 'string', enum: Object.freeze(['prompt', 'reminder']) }),
        title: Object.freeze({ type: 'string', minLength: 1, maxLength: 120 }),
        cron: Object.freeze({ type: 'string' }),
        timezone: Object.freeze({ type: 'string' }),
        prompt: Object.freeze({ type: 'string', minLength: 1 }),
      }),
    }),
  }),
  Object.freeze({
    name: ROUTINE_TOOL_NAMES[1],
    description: 'List the routines of this Codebox, newest first.',
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: Object.freeze({
        kind: Object.freeze({ type: 'string', enum: Object.freeze(['prompt', 'reminder']) }),
      }),
    }),
  }),
  Object.freeze({
    name: ROUTINE_TOOL_NAMES[2],
    description: 'Enable or pause one routine by id.',
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: ['routineId', 'enabled'],
      properties: Object.freeze({
        routineId: Object.freeze({ type: 'string' }),
        enabled: Object.freeze({ type: 'boolean' }),
      }),
    }),
  }),
]);

function failed(code: RoutineToolFailureCode): RoutineToolOutcome {
  return { ok: false, code };
}

function scheduleFailure(field: 'cron' | 'timezone'): RoutineToolOutcome {
  return failed(field === 'timezone' ? 'invalid_timezone' : 'invalid_cron');
}

function createRoutine(input: unknown, context: RoutineToolContext): RoutineToolOutcome {
  const parsed = routineCreateToolInputSchema.safeParse(input);
  if (!parsed.success) return failed('invalid_input');
  const body = parsed.data;
  const at = context.now();
  const schedule = nextFireAt({ cron: body.cron, timezone: body.timezone }, at);
  if (!schedule.ok) return scheduleFailure(schedule.field);
  const base = {
    id: newRoutineId(context.random),
    title: body.title,
    cron: body.cron,
    timezone: body.timezone,
    enabled: true,
    notify: true,
    createdAt: formatInstant(at),
    nextFireAt: schedule.nextFireAt,
    lastFiredAt: null,
  };
  const routine: Routine =
    body.kind === 'prompt'
      ? {
          ...base,
          kind: 'prompt',
          repoId: context.repoId,
          prompt: body.prompt,
          chatSessionId: context.chatId,
        }
      : { ...base, kind: 'reminder' };
  const stored = context.store.routines.create(routine);
  return { ok: true, output: routineCreateToolOutputSchema.parse({ routine: stored }) };
}

function listRoutines(input: unknown, context: RoutineToolContext): RoutineToolOutcome {
  const parsed = routineListToolInputSchema.safeParse(input);
  if (!parsed.success) return failed('invalid_input');
  const page = context.store.routines.list({
    limit: LIST_LIMIT,
    cursor: null,
    ...(parsed.data.kind === undefined ? {} : { kind: parsed.data.kind }),
  });
  return { ok: true, output: routineListToolOutputSchema.parse({ routines: page.data }) };
}

function pauseRoutine(input: unknown, context: RoutineToolContext): RoutineToolOutcome {
  const parsed = routinePauseToolInputSchema.safeParse(input);
  if (!parsed.success) return failed('invalid_input');
  const current = context.store.routines.get(parsed.data.routineId);
  if (current === null) return failed('not_found');
  let nextFire: string | null = null;
  if (parsed.data.enabled) {
    const schedule = nextFireAt({ cron: current.cron, timezone: current.timezone }, context.now());
    if (!schedule.ok) return scheduleFailure(schedule.field);
    nextFire = schedule.nextFireAt;
  }
  const updated = context.store.routines.update(current.id, {
    enabled: parsed.data.enabled,
    nextFireAt: nextFire,
  });
  return { ok: true, output: routinePauseToolOutputSchema.parse({ routine: updated }) };
}

export function callRoutineTool(
  name: string,
  input: unknown,
  context: RoutineToolContext,
): RoutineToolOutcome {
  try {
    if (name === ROUTINE_TOOL_NAMES[0]) return createRoutine(input, context);
    if (name === ROUTINE_TOOL_NAMES[1]) return listRoutines(input, context);
    if (name === ROUTINE_TOOL_NAMES[2]) return pauseRoutine(input, context);
    return failed('unknown_tool');
  } catch {
    return failed('internal');
  }
}

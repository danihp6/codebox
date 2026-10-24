import { describe, expect, it } from 'vitest';
import { ContractParseError } from './parse.js';
import { ROUTINE_KINDS, RoutineId, routineKindSchema } from './primitives.js';
import {
  ROUTINE_TOOL_NAMES,
  parseRoutine,
  promptRoutineSchema,
  reminderRoutineSchema,
  routineCreateToolInputSchema,
  routineCreateToolOutputSchema,
  routineListToolInputSchema,
  routineListToolOutputSchema,
  routinePauseToolInputSchema,
  routinePauseToolOutputSchema,
  routineSchema,
} from './routines.js';

const ts = '2026-10-24T18:03:11Z';
const routineId = 'rtn_01JABCDEFG';
const otherRoutineId = 'rtn_01JABCDEFH';
const repoId = 'repo_01JABCDEFG';
const chatId = 'chat_01JABCDEFG';
const messageId = 'msg_01JABCDEFG';

const promptRoutine = {
  id: routineId,
  kind: 'prompt',
  title: 'Morning summary',
  cron: '0 8 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  notify: true,
  repoId,
  prompt: 'Summarise the repository in five bullets.',
  chatSessionId: null,
  createdAt: ts,
  nextFireAt: '2026-10-25T07:00:00Z',
  lastFiredAt: null,
};

const boundPromptRoutine = {
  ...promptRoutine,
  id: otherRoutineId,
  title: 'Nightly lockfile in chat',
  chatSessionId: chatId,
  lastFiredAt: ts,
};

const reminderRoutine = {
  id: otherRoutineId,
  kind: 'reminder',
  title: 'Take the pill',
  cron: '0 10 * * *',
  timezone: 'Europe/Madrid',
  enabled: true,
  notify: true,
  createdAt: ts,
  nextFireAt: '2026-10-25T09:00:00Z',
  lastFiredAt: null,
};

function zodPaths(result: { success: boolean; error?: unknown }): string[] {
  if (result.success) return [];
  const error = result.error as { issues: { path: (string | number)[] }[] } | undefined;
  return (error?.issues ?? []).map((issue) => issue.path.join('.'));
}

function parseError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (thrown) {
    return thrown;
  }
  return null;
}

describe('routines', () => {
  it('a fixture per routine kind parses', () => {
    expect(parseRoutine(promptRoutine)).toEqual(promptRoutine);
    expect(parseRoutine(boundPromptRoutine)).toEqual(boundPromptRoutine);
    expect(parseRoutine(reminderRoutine)).toEqual(reminderRoutine);
    expect(routineSchema.safeParse(boundPromptRoutine).success).toBe(true);
    expect(promptRoutineSchema.safeParse(promptRoutine).success).toBe(true);
    expect(reminderRoutineSchema.safeParse(reminderRoutine).success).toBe(true);

    const error = parseError(() => parseRoutine({ ...promptRoutine, unexpected: 'x' }));
    expect(error instanceof ContractParseError ? error.first.path : null).toBe(
      'routine.unexpected',
    );
    expect(error instanceof ContractParseError ? error.boundary : null).toBe('routine');
  });

  it('a prompt routine without a repo or a prompt is rejected and a reminder without a prompt is accepted', () => {
    const withoutRepo: Record<string, unknown> = { ...promptRoutine };
    delete withoutRepo.repoId;
    const noRepoError = parseError(() => parseRoutine(withoutRepo));
    expect(noRepoError instanceof ContractParseError ? noRepoError.first.path : null).toBe(
      'routine.repoId',
    );

    const withoutPrompt: Record<string, unknown> = { ...promptRoutine };
    delete withoutPrompt.prompt;
    const noPromptError = parseError(() => parseRoutine(withoutPrompt));
    expect(noPromptError instanceof ContractParseError ? noPromptError.first.path : null).toBe(
      'routine.prompt',
    );

    expect(promptRoutineSchema.safeParse(withoutRepo).success).toBe(false);
    expect(promptRoutineSchema.safeParse(withoutPrompt).success).toBe(false);

    const bareReminder: Record<string, unknown> = { ...reminderRoutine };
    delete bareReminder.prompt;
    delete bareReminder.repoId;
    delete bareReminder.chatSessionId;
    expect(parseRoutine(bareReminder)).toEqual(reminderRoutine);
    expect(reminderRoutineSchema.safeParse({ ...reminderRoutine, prompt: 'x' }).success).toBe(
      false,
    );
    expect(reminderRoutineSchema.safeParse({ ...reminderRoutine, repoId }).success).toBe(false);
    expect(
      reminderRoutineSchema.safeParse({ ...reminderRoutine, chatSessionId: chatId }).success,
    ).toBe(false);
  });

  it('freezes the routine kinds and the rtn_ id prefix', () => {
    expect(routineKindSchema.safeParse('prompt').success).toBe(true);
    expect(routineKindSchema.safeParse('reminder').success).toBe(true);
    expect(routineKindSchema.safeParse('job').success).toBe(false);
    expect([...ROUTINE_KINDS]).toEqual(['prompt', 'reminder']);
    expect(RoutineId.safeParse('rtn_01JABCDEFG').success).toBe(true);
    expect(RoutineId.safeParse('job_01JABCDEFG').success).toBe(false);
  });

  it('the routine tool schema rejects a missing timezone', () => {
    const promptInput = {
      kind: 'prompt',
      title: 'Morning summary',
      cron: '0 8 * * *',
      timezone: 'Europe/Madrid',
      prompt: 'Summarise the repository in five bullets.',
    };
    const reminderInput = {
      kind: 'reminder',
      title: 'Take the pill',
      cron: '0 10 * * *',
      timezone: 'Europe/Madrid',
    };

    expect(routineCreateToolInputSchema.safeParse(promptInput).success).toBe(true);
    expect(routineCreateToolInputSchema.safeParse(reminderInput).success).toBe(true);

    const promptWithoutZone: Record<string, unknown> = { ...promptInput };
    delete promptWithoutZone.timezone;
    const reminderWithoutZone: Record<string, unknown> = { ...reminderInput };
    delete reminderWithoutZone.timezone;

    expect(
      zodPaths(routineCreateToolInputSchema.safeParse(promptWithoutZone)).some((path) =>
        path.includes('timezone'),
      ),
    ).toBe(true);
    expect(
      zodPaths(routineCreateToolInputSchema.safeParse(reminderWithoutZone)).some((path) =>
        path.includes('timezone'),
      ),
    ).toBe(true);

    const unknownField = routineCreateToolInputSchema.safeParse({ ...reminderInput, repoId });
    expect(unknownField.success).toBe(false);
    const unknownKeys =
      unknownField.success === false
        ? unknownField.error.issues.flatMap((issue) =>
            issue.code === 'unrecognized_keys' ? issue.keys : [],
          )
        : [];
    expect(unknownKeys).toContain('repoId');

    expect(
      routineCreateToolInputSchema.safeParse({ ...promptInput, chatSessionId: chatId }).success,
    ).toBe(false);
    expect(
      routineCreateToolInputSchema.safeParse({ ...promptInput, kind: 'reminder', prompt: 'x' })
        .success,
    ).toBe(false);
    expect(
      routineCreateToolInputSchema.safeParse({
        ...routineCreateToolInputSchema.parse(promptInput),
        prompt: '',
      }).success,
    ).toBe(false);
  });

  it('the routine tool schemas freeze the tool names and the daemon payloads', () => {
    expect([...ROUTINE_TOOL_NAMES]).toEqual(['routine.create', 'routine.list', 'routine.pause']);

    expect(routineCreateToolOutputSchema.safeParse({ routine: promptRoutine }).success).toBe(true);
    expect(routineCreateToolOutputSchema.safeParse({ routine: reminderRoutine }).success).toBe(
      true,
    );
    expect(routineCreateToolOutputSchema.safeParse(promptRoutine).success).toBe(false);

    expect(routineListToolInputSchema.safeParse({}).success).toBe(true);
    expect(routineListToolInputSchema.safeParse({ kind: 'reminder' }).success).toBe(true);
    expect(routineListToolInputSchema.safeParse({ kind: 'job' }).success).toBe(false);
    expect(routineListToolInputSchema.safeParse({ repoId }).success).toBe(false);
    expect(
      routineListToolOutputSchema.safeParse({ routines: [promptRoutine, reminderRoutine] }).success,
    ).toBe(true);
    expect(routineListToolOutputSchema.safeParse({ routines: [promptRoutine, {}] }).success).toBe(
      false,
    );

    expect(routinePauseToolInputSchema.safeParse({ routineId, enabled: false }).success).toBe(true);
    expect(routinePauseToolInputSchema.safeParse({ routineId }).success).toBe(false);
    expect(routinePauseToolInputSchema.safeParse({ routineId, enabled: 'no' }).success).toBe(false);
    expect(
      routinePauseToolInputSchema.safeParse({ routineId: chatId, enabled: true }).success,
    ).toBe(false);
    expect(routinePauseToolOutputSchema.safeParse({ routine: reminderRoutine }).success).toBe(true);
  });

  it('caps the title at 120 characters and keeps notify and enabled as booleans', () => {
    const title121 = 'a'.repeat(121);
    expect(routineSchema.safeParse({ ...reminderRoutine, title: '' }).success).toBe(false);
    expect(routineSchema.safeParse({ ...reminderRoutine, title: title121 }).success).toBe(false);
    expect(routineSchema.safeParse({ ...reminderRoutine, title: 'a'.repeat(120) }).success).toBe(
      true,
    );
    expect(routineSchema.safeParse({ ...reminderRoutine, notify: 'yes' }).success).toBe(false);
    expect(routineSchema.safeParse({ ...reminderRoutine, enabled: 'yes' }).success).toBe(false);
    expect(routineSchema.safeParse({ ...reminderRoutine, cron: '0 10 * *' }).success).toBe(false);
    expect(routineSchema.safeParse({ ...reminderRoutine, timezone: 'Europe' }).success).toBe(false);
  });

  it('accepts a prompt routine whose chat session id is a chat id or null only', () => {
    expect(
      promptRoutineSchema.safeParse({ ...promptRoutine, chatSessionId: messageId }).success,
    ).toBe(false);
    expect(
      promptRoutineSchema.safeParse({ ...promptRoutine, chatSessionId: undefined }).success,
    ).toBe(false);
  });
});

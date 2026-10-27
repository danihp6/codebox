import type { Run, Schedule } from '@codebox/contracts';
import { chatServiceFor } from '../chat/index.js';
import { chatRuntimeOf } from '../chat/service.js';
import type { ChatService } from '../chat/service.js';
import type { DaemonContext } from '../modules.js';
import { engineForRun, queueRun, runsService } from '../runs/service.js';
import type { QueueRunInput, RunsService } from '../runs/service.js';

export type ScheduleFireErrorCode =
  'repo_required' | 'repo_missing' | 'chat_unavailable' | 'chat_missing';

/** A fire that could not start: the code reaches the fire row and the log, never a message. */
export class ScheduleFireError extends Error {
  readonly code: ScheduleFireErrorCode;

  constructor(code: ScheduleFireErrorCode) {
    super(`schedule fire failed: ${code}`);
    this.name = 'ScheduleFireError';
    this.code = code;
  }
}

export interface ScheduleFirePort {
  startRun(input: {
    readonly schedule: Schedule;
    readonly scheduledFor: string;
    readonly costCapUsd: number | null;
  }): { readonly runId: string };
  /**
   * The frozen shape returns the ids synchronously; a chat turn is asynchronous, so the default
   * port answers a promise the service awaits before it finishes the fire row.
   */
  startChat(input: {
    readonly schedule: Schedule;
    readonly scheduledFor: string;
  }):
    | { readonly chatId: string; readonly messageId: string }
    | Promise<{ readonly chatId: string; readonly messageId: string }>;
}

export interface CreateScheduleFirePortOptions {
  readonly context: DaemonContext;
  readonly runs?: () => RunsService;
  readonly chat?: () => ChatService | null;
  readonly queue?: (input: QueueRunInput) => Run;
}

export function createScheduleFirePort(options: CreateScheduleFirePortOptions): ScheduleFirePort {
  const context = options.context;
  const store = context.store;
  const config = context.config;
  const clock = context.clock;
  const runs = options.runs ?? ((): RunsService => runsService(context));
  const chat = options.chat ?? ((): ChatService | null => chatServiceFor(context));
  const queue = options.queue ?? queueRun;

  /** The schedule's own chat, created once when it has none or the old one was archived. */
  function ensureChat(service: ChatService, schedule: Schedule): string {
    const existing =
      schedule.chatSessionId === null ? null : store.chats.getSession(schedule.chatSessionId);
    if (existing !== null && existing.status !== 'archived') return existing.id;
    const repoId = schedule.repoId;
    // `chat_sessions.repo_id` is NOT NULL until a repository-less chat exists, so a schedule with
    // neither a chat nor a repository fails with `chat_missing` instead of guessing a repository.
    if (repoId === null) throw new ScheduleFireError('chat_missing');
    const at = clock().toISOString();
    const id = chatRuntimeOf(service).newChatId();
    store.chats.createSession(
      {
        id,
        repoId,
        kind: 'schedule',
        title: schedule.title,
        status: 'idle',
        createdAt: at,
        updatedAt: at,
        lastMessage: null,
      },
      { opencodeSessionId: null, worktree: null },
    );
    store.schedules.update(schedule.id, { chatSessionId: id });
    return id;
  }

  return {
    startRun(input): { readonly runId: string } {
      const repoId = input.schedule.repoId;
      if (repoId === null) throw new ScheduleFireError('repo_required');
      const repo = store.repos.get(repoId);
      if (repo === null) throw new ScheduleFireError('repo_missing');
      const run: Run = queue({
        context,
        engine: engineForRun(runs(), context.logger),
        now: clock,
        repo,
        jobId: null,
        trigger: 'schedule',
        title: input.schedule.title,
        prompt: input.schedule.prompt,
        agent: config.CB_DEFAULT_AGENT,
        model: config.CB_DEFAULT_MODEL,
      });
      store.runs.update(run.id, { scheduledFor: input.scheduledFor });
      return { runId: run.id };
    },

    async startChat(input): Promise<{ readonly chatId: string; readonly messageId: string }> {
      const service = chat();
      if (service === null) throw new ScheduleFireError('chat_unavailable');
      const chatId = ensureChat(service, input.schedule);
      const message = await service.sendRoutine({
        chatId,
        text: input.schedule.prompt,
      });
      await service.pump(chatId);
      return { chatId, messageId: message.id };
    },
  };
}

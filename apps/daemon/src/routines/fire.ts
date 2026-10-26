import type { ChatMessage, PromptRoutine } from '@codebox/contracts';
import { ChatError } from '../chat/errors.js';
import { chatRuntimeOf } from '../chat/service.js';
import type { ChatService } from '../chat/service.js';
import type { DaemonContext } from '../modules.js';

export interface PromptFireResult {
  readonly outcome: 'replied' | 'failed';
  readonly chatId: string | null;
  readonly messageId: string | null;
  readonly code: string | null;
}

export interface FirePromptDeps {
  readonly context: DaemonContext;
  readonly chat: () => ChatService | null;
  readonly now: () => Date;
}

function failed(chatId: string | null, code: string): PromptFireResult {
  return { outcome: 'failed', chatId, messageId: null, code };
}

/**
 * One prompt fire: the routine's chat, one `origin: routine` message, the turn's answer. The
 * caller records the fire row; this function never writes an event and never throws, so a
 * failure is a value the fire row can carry.
 */
export async function firePrompt(
  routine: PromptRoutine,
  deps: FirePromptDeps,
): Promise<PromptFireResult> {
  const store = deps.context.store;
  let chatId: string | null = null;
  try {
    const chatService = deps.chat();
    if (chatService === null) return failed(null, 'chat_unavailable');
    const repo = store.repos.get(routine.repoId);
    if (repo === null) return failed(null, 'repo_missing');
    chatId = await resolveChat(routine, chatService, deps);
    const message: ChatMessage = await chatService.sendRoutine({
      chatId,
      text: routine.prompt,
    });
    await chatService.pump(chatId);
    const last = store.chats.lastMessage(chatId);
    if (
      last !== null &&
      last.role === 'assistant' &&
      last.id !== message.id &&
      last.createdAt >= message.createdAt
    ) {
      return { outcome: 'replied', chatId, messageId: last.id, code: null };
    }
    return failed(chatId, 'no_reply');
  } catch (error) {
    // The exception message can carry an upstream body, so only the domain reason survives.
    return failed(chatId, error instanceof ChatError ? error.reason : 'internal');
  }
}

/** The routine's own chat: an existing live session, or a new one named after the routine. */
async function resolveChat(
  routine: PromptRoutine,
  chatService: ChatService,
  deps: FirePromptDeps,
): Promise<string> {
  const store = deps.context.store;
  const existing =
    routine.chatSessionId === null ? null : store.chats.getSession(routine.chatSessionId);
  if (existing !== null && existing.status !== 'archived') return existing.id;
  const at = deps.now().toISOString();
  const id = chatRuntimeOf(chatService).newChatId();
  store.chats.createSession(
    {
      id,
      repoId: routine.repoId,
      title: routine.title,
      status: 'idle',
      createdAt: at,
      updatedAt: at,
      lastMessage: null,
    },
    { opencodeSessionId: null, worktree: null },
  );
  store.routines.update(routine.id, { chatSessionId: id });
  await chatService.prepare(id);
  return id;
}

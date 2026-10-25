import type { ChatMessage, Page, SseStreamEvent } from '@codebox/contracts';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatStreamItem {
  readonly key: string;
  readonly role: ChatRole;
  readonly text: string;
  readonly messageId: string | null;
  readonly createdAt: string | null;
}

export interface ChatToolCard {
  readonly key: string;
  readonly tool: string;
  readonly status: 'start' | 'ok' | 'error';
  readonly detail: string;
  readonly seq: number;
}

export interface ChatPermissionCard {
  readonly key: string;
  readonly approvalId: string;
  readonly tool: string;
  readonly title: string;
  readonly answered: boolean;
}

export interface ChatStreamState {
  readonly messages: readonly ChatStreamItem[];
  readonly tools: readonly ChatToolCard[];
  readonly permissions: readonly ChatPermissionCard[];
  readonly working: boolean;
  readonly lastSeq: number;
}

export const EMPTY_CHAT: ChatStreamState = Object.freeze({
  messages: Object.freeze([]),
  tools: Object.freeze([]),
  permissions: Object.freeze([]),
  working: false,
  lastSeq: 0,
});

export function applyChatEvent(
  state: ChatStreamState,
  chatId: string,
  event: SseStreamEvent,
): ChatStreamState {
  if (event.event === 'gap') return state;
  if (event.event === 'approval.resolved') {
    return markPermissionAnswered(state, event.data.approvalId);
  }
  if (!('chatId' in event.data) || event.data.chatId !== chatId) return state;

  switch (event.event) {
    case 'chat.delta':
      return appendDelta(state, chatId, event.data.delta, event.data.seq);
    case 'chat.message':
      return upsertMessage(state, chatId, event.data.message, event.data.seq);
    case 'chat.tool':
      return upsertTool(
        state,
        event.data.tool,
        event.data.status,
        event.data.detail ?? '',
        event.data.seq,
      );
    case 'chat.permission':
      return upsertPermission(state, event.data.approvalId, event.data.tool, event.data.title);
    case 'chat.idle':
      return { ...state, working: false, lastSeq: Math.max(state.lastSeq, event.data.seq) };
    default:
      return state;
  }
}

export function mergeMessages(state: ChatStreamState, page: Page<ChatMessage>): ChatStreamState {
  const messages = [...state.messages];
  let inserted = false;
  for (const message of page.data) {
    const key = messageKey(message.id);
    if (messages.some((item) => item.key === key)) continue;
    messages.push(toItem(message));
    inserted = true;
  }
  if (!inserted) return state;
  messages.sort(compareItems);
  return { ...state, messages };
}

export function appendMessage(state: ChatStreamState, message: ChatMessage): ChatStreamState {
  return mergeMessages(state, { data: [message], nextCursor: null });
}

export function markPermissionAnswered(
  state: ChatStreamState,
  approvalId: string,
): ChatStreamState {
  const index = state.permissions.findIndex((card) => card.approvalId === approvalId);
  if (index === -1) return state;
  if (state.permissions[index]?.answered === true) return state;
  const permissions = state.permissions.map((card, position) =>
    position === index ? { ...card, answered: true } : card,
  );
  return { ...state, permissions };
}

function messageKey(id: string): string {
  return `msg:${id}`;
}

function streamKey(chatId: string): string {
  return `stream:${chatId}`;
}

function toItem(message: ChatMessage): ChatStreamItem {
  return {
    key: messageKey(message.id),
    role: message.role,
    text: message.text,
    messageId: message.id,
    createdAt: message.createdAt,
  };
}

function appendDelta(
  state: ChatStreamState,
  chatId: string,
  delta: string,
  seq: number,
): ChatStreamState {
  if (seq <= state.lastSeq) return state;
  const key = streamKey(chatId);
  const present = state.messages.some((item) => item.key === key);
  const messages = present
    ? state.messages.map((item) => (item.key === key ? { ...item, text: item.text + delta } : item))
    : [
        ...state.messages,
        { key, role: 'assistant' as const, text: delta, messageId: null, createdAt: null },
      ];
  return { ...state, messages, working: true, lastSeq: seq };
}

function upsertMessage(
  state: ChatStreamState,
  chatId: string,
  message: ChatMessage,
  seq: number,
): ChatStreamState {
  const key = messageKey(message.id);
  const item = toItem(message);
  const lastSeq = Math.max(state.lastSeq, seq);

  if (state.messages.some((existing) => existing.key === key)) {
    const messages = state.messages.map((existing) => (existing.key === key ? item : existing));
    return { ...state, messages, lastSeq };
  }

  const bufferKey = streamKey(chatId);
  const bufferAt = state.messages.findIndex((existing) => existing.key === bufferKey);
  if (message.role === 'assistant' && bufferAt !== -1) {
    const messages = state.messages.map((existing, position) =>
      position === bufferAt ? item : existing,
    );
    return { ...state, messages, lastSeq };
  }

  return { ...state, messages: [...state.messages, item], lastSeq };
}

function upsertTool(
  state: ChatStreamState,
  tool: string,
  status: ChatToolCard['status'],
  detail: string,
  seq: number,
): ChatStreamState {
  const key = `tool:${seq}`;
  const card: ChatToolCard = { key, tool, status, detail, seq };
  const present = state.tools.some((existing) => existing.key === key);
  const tools = present
    ? state.tools.map((existing) => (existing.key === key ? card : existing))
    : [...state.tools, card];
  return { ...state, tools, lastSeq: Math.max(state.lastSeq, seq) };
}

function upsertPermission(
  state: ChatStreamState,
  approvalId: string,
  tool: string,
  title: string,
): ChatStreamState {
  const key = `permission:${approvalId}`;
  const present = state.permissions.some((existing) => existing.approvalId === approvalId);
  if (present) {
    const permissions = state.permissions.map((existing) =>
      existing.approvalId === approvalId ? { ...existing, tool, title } : existing,
    );
    return { ...state, permissions };
  }
  const card: ChatPermissionCard = { key, approvalId, tool, title, answered: false };
  return { ...state, permissions: [...state.permissions, card] };
}

function compareItems(left: ChatStreamItem, right: ChatStreamItem): number {
  if (left.createdAt === null && right.createdAt === null) return compareKeys(left, right);
  if (left.createdAt === null) return 1;
  if (right.createdAt === null) return -1;
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
  return compareKeys(left, right);
}

function compareKeys(left: ChatStreamItem, right: ChatStreamItem): number {
  if (left.key === right.key) return 0;
  return left.key < right.key ? -1 : 1;
}

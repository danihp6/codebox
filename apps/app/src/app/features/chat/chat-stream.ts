import type { ChatMessage, Page, Routine, Run, SseStreamEvent } from '@codebox/contracts';

export type ChatRole = 'user' | 'assistant' | 'system';

export const ROUTINE_CREATE_WINDOW_SECONDS = 120;

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

export interface ChatRoutineCard {
  readonly key: string;
  readonly routine: Routine;
}

export interface ChatSystemCard {
  readonly key: string;
  readonly kind: 'gate' | 'pr';
  readonly runId: string;
  readonly status: 'passed' | 'failed' | 'skipped' | 'open' | 'merged';
  readonly detail: string;
  readonly href: string | null;
}

export interface ChatStreamState {
  readonly messages: readonly ChatStreamItem[];
  readonly tools: readonly ChatToolCard[];
  readonly permissions: readonly ChatPermissionCard[];
  readonly routines: readonly ChatRoutineCard[];
  readonly routineMessageIds: readonly string[];
  readonly system: readonly ChatSystemCard[];
  readonly working: boolean;
  readonly lastSeq: number;
}

export const EMPTY_CHAT: ChatStreamState = Object.freeze({
  messages: Object.freeze([]),
  tools: Object.freeze([]),
  permissions: Object.freeze([]),
  routines: Object.freeze([]),
  routineMessageIds: Object.freeze([]),
  system: Object.freeze([]),
  working: false,
  lastSeq: 0,
});

/** Built from the `Run` object only: a gate or PR mentioned in prose never becomes a card. */
export function systemCardsOf(run: Run): readonly ChatSystemCard[] {
  const cards: ChatSystemCard[] = [];
  if (run.gate !== null) {
    cards.push({
      key: `gate:${run.id}`,
      kind: 'gate',
      runId: run.id,
      status: run.gate.status,
      detail: `exit ${run.gate.exitCode} · ${run.gate.durationMs} ms`,
      href: null,
    });
  }
  if (run.pr !== null) {
    cards.push({
      key: `pr:${run.id}`,
      kind: 'pr',
      runId: run.id,
      status: run.state === 'succeeded' ? 'merged' : 'open',
      detail: `#${run.pr.number}`,
      href: run.pr.url,
    });
  }
  return cards;
}

export function withRunCards(state: ChatStreamState, run: Run): ChatStreamState {
  const kept = state.system.filter((card) => card.runId !== run.id);
  const system = [...kept, ...systemCardsOf(run)];
  if (sameCards(state.system, system)) return state;
  return { ...state, system };
}

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
    case 'routine.replied':
      return appendRoutineMessage(state, event.data.messageId);
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

/** `routine.replied` carries no `seq`; the badge is keyed by the message id it produced. */
export function appendRoutineMessage(state: ChatStreamState, messageId: string): ChatStreamState {
  if (state.routineMessageIds.includes(messageId)) return state;
  return { ...state, routineMessageIds: [...state.routineMessageIds, messageId] };
}

/** `chat.tool.detail` never carries the routine, so the card is corroborated from the list. */
export function pickCreatedRoutine(
  routines: readonly Routine[],
  chatId: string,
  toolTs: string,
): Routine | null {
  const toolTime = Date.parse(toolTs);
  if (Number.isNaN(toolTime)) return null;
  const windowStart = toolTime - ROUTINE_CREATE_WINDOW_SECONDS * 1000;
  for (const routine of routines) {
    const created = Date.parse(routine.createdAt);
    if (Number.isNaN(created) || created < windowStart) continue;
    if (routine.kind === 'prompt' && routine.chatSessionId !== chatId) continue;
    return routine;
  }
  return null;
}

export function withRoutineCard(state: ChatStreamState, routine: Routine): ChatStreamState {
  if (state.routines.some((card) => card.routine.id === routine.id)) return state;
  return {
    ...state,
    routines: [...state.routines, { key: `routine:${routine.id}`, routine }],
  };
}

export function isRoutineMessage(state: ChatStreamState, messageId: string | null): boolean {
  if (messageId === null) return false;
  return state.routineMessageIds.includes(messageId);
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

function sameItem(left: ChatStreamItem | undefined, right: ChatStreamItem): boolean {
  if (left === undefined) return false;
  return (
    left.key === right.key &&
    left.role === right.role &&
    left.text === right.text &&
    left.messageId === right.messageId &&
    left.createdAt === right.createdAt
  );
}

function sameTool(left: ChatToolCard | undefined, right: ChatToolCard): boolean {
  if (left === undefined) return false;
  return (
    left.key === right.key &&
    left.tool === right.tool &&
    left.status === right.status &&
    left.detail === right.detail &&
    left.seq === right.seq
  );
}

function sameCards(left: readonly ChatSystemCard[], right: readonly ChatSystemCard[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((card, position) => {
    const other = right[position];
    return (
      other !== undefined &&
      card.key === other.key &&
      card.kind === other.kind &&
      card.runId === other.runId &&
      card.status === other.status &&
      card.detail === other.detail &&
      card.href === other.href
    );
  });
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

  const existingAt = state.messages.findIndex((existing) => existing.key === key);
  if (existingAt !== -1) {
    if (sameItem(state.messages[existingAt], item)) {
      return state.lastSeq === lastSeq ? state : { ...state, lastSeq };
    }
    const messages = state.messages.map((existing, position) =>
      position === existingAt ? item : existing,
    );
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
  const lastSeq = Math.max(state.lastSeq, seq);
  const existingAt = state.tools.findIndex((existing) => existing.key === key);
  if (existingAt !== -1) {
    if (sameTool(state.tools[existingAt], card)) {
      return state.lastSeq === lastSeq ? state : { ...state, lastSeq };
    }
    const tools = state.tools.map((existing, position) =>
      position === existingAt ? card : existing,
    );
    return { ...state, tools, lastSeq };
  }
  return { ...state, tools: [...state.tools, card], lastSeq };
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

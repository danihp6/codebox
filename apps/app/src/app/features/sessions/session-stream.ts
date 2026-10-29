import type { Page, SessionMessage, SessionProposal, SseStreamEvent } from '@codebox/contracts';

export interface SessionThread {
  readonly messages: readonly SessionMessage[];
  readonly tools: readonly SessionToolCard[];
  readonly proposal: SessionProposal | null;
  readonly working: boolean;
  readonly lastSeq: number;
}

export interface SessionToolCard {
  readonly key: string; // `${sessionId}:${seq}`
  readonly tool: string;
  readonly status: 'start' | 'ok' | 'error';
  readonly detail: string | null;
  readonly seq: number;
}

export const EMPTY_THREAD: SessionThread = Object.freeze({
  messages: Object.freeze([]),
  tools: Object.freeze([]),
  proposal: null,
  working: false,
  lastSeq: 0,
});

/** The live delta buffer carries a local id; the first real assistant message replaces it. */
function liveKey(sessionId: string): string {
  return `live:${sessionId}`;
}

function sameMessage(left: SessionMessage, right: SessionMessage): boolean {
  return (
    left.id === right.id &&
    left.sessionId === right.sessionId &&
    left.role === right.role &&
    left.text === right.text &&
    left.createdAt === right.createdAt
  );
}

function compareMessages(left: SessionMessage, right: SessionMessage): number {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/** Keyed by message id: a page merged twice, or a frame replayed twice, never duplicates. */
export function mergeMessages(thread: SessionThread, page: Page<SessionMessage>): SessionThread {
  const messages = [...thread.messages];
  let changed = false;

  for (const message of page.data) {
    const existingAt = messages.findIndex((item) => item.id === message.id);
    if (existingAt !== -1) {
      const existing = messages[existingAt];
      if (existing !== undefined && !sameMessage(existing, message)) {
        messages[existingAt] = message;
        changed = true;
      }
      continue;
    }
    if (message.role === 'assistant') {
      const bufferAt = messages.findIndex((item) => item.id === liveKey(message.sessionId));
      if (bufferAt !== -1) {
        messages[bufferAt] = message;
        changed = true;
        continue;
      }
    }
    messages.push(message);
    changed = true;
  }

  if (!changed) return thread;
  messages.sort(compareMessages);
  return { ...thread, messages };
}

export function appendMessage(thread: SessionThread, message: SessionMessage): SessionThread {
  return mergeMessages(thread, { data: [message], nextCursor: null });
}

export function applySessionEvent(
  thread: SessionThread,
  target: string,
  event: SseStreamEvent,
): SessionThread {
  if (event.event === 'gap') return thread;
  if (!('sessionId' in event.data) || event.data.sessionId !== target) return thread;

  switch (event.event) {
    case 'session.delta':
      return appendDelta(thread, target, event.data.delta, event.data.seq, event.data.ts);
    case 'session.tool':
      return upsertTool(
        thread,
        target,
        event.data.tool,
        event.data.status,
        event.data.detail ?? null,
        event.data.seq,
      );
    case 'session.proposal':
      return {
        ...thread,
        proposal: event.data.proposal,
        lastSeq: Math.max(thread.lastSeq, event.data.seq),
      };
    case 'session.closed':
      return { ...thread, working: false, lastSeq: Math.max(thread.lastSeq, event.data.seq) };
    case 'session.created':
      return { ...thread, lastSeq: Math.max(thread.lastSeq, event.data.seq) };
    default:
      return thread;
  }
}

function appendDelta(
  thread: SessionThread,
  sessionId: string,
  delta: string,
  seq: number,
  ts: string,
): SessionThread {
  if (seq <= thread.lastSeq) return thread;
  const key = liveKey(sessionId);
  const present = thread.messages.some((item) => item.id === key);
  const messages = present
    ? thread.messages.map((item) => (item.id === key ? { ...item, text: item.text + delta } : item))
    : [
        ...thread.messages,
        {
          id: key,
          sessionId,
          role: 'assistant' as const,
          text: delta,
          createdAt: ts,
        },
      ];
  return { ...thread, messages, working: true, lastSeq: seq };
}

function upsertTool(
  thread: SessionThread,
  sessionId: string,
  tool: string,
  status: SessionToolCard['status'],
  detail: string | null,
  seq: number,
): SessionThread {
  const key = `${sessionId}:${seq}`;
  const card: SessionToolCard = { key, tool, status, detail, seq };
  const lastSeq = Math.max(thread.lastSeq, seq);
  const existingAt = thread.tools.findIndex((item) => item.key === key);
  if (existingAt === -1) return { ...thread, tools: [...thread.tools, card], lastSeq };
  const existing = thread.tools[existingAt];
  if (
    existing !== undefined &&
    existing.tool === card.tool &&
    existing.status === card.status &&
    existing.detail === card.detail
  ) {
    return thread.lastSeq === lastSeq ? thread : { ...thread, lastSeq };
  }
  const tools = thread.tools.map((item, position) => (position === existingAt ? card : item));
  return { ...thread, tools, lastSeq };
}

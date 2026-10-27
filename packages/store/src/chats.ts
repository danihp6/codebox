import type { ChatMessage, ChatSession } from '@codebox/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { decodeCursor, encodeCursor, type PageQuery, type PageResult } from './cursor.js';
import { isForeignKeyViolation } from './db.js';
import { StoreError } from './errors.js';
import {
  chatMessageFromRow,
  chatSessionFromRow,
  enumColumn,
  integerColumn,
  nullableTextColumn,
  realColumn,
  row,
} from './mappers.js';
import type { Row } from './mappers.js';

export type ChatMessageOrigin = 'user' | 'assistant' | 'routine';

const CHAT_KINDS = ['free', 'repo', 'schedule'] as const;

type ChatKind = (typeof CHAT_KINDS)[number];

export interface ChatSessionExtra {
  readonly opencodeSessionId: string | null;
  readonly worktree: string | null;
}

export interface ChatSessionPatch {
  readonly title?: string;
  readonly status?: 'idle' | 'working' | 'archived';
  readonly repoId?: string | null;
  readonly opencodeSessionId?: string | null;
  readonly worktree?: string | null;
  readonly kind?: ChatKind;
  readonly usage?: {
    readonly usd: number;
    readonly tokensIn: number;
    readonly tokensOut: number;
  };
  readonly contextTokens?: number;
  readonly contextEpoch?: number;
  readonly reviewedAt?: string | null;
  readonly updatedAt: string;
}

export interface ChatRepository {
  getSession(id: string): ChatSession | null;
  listSessions(filter: {
    repoId?: string;
    limit: number;
    cursor: string | null;
  }): PageResult<ChatSession>;
  createSession(session: ChatSession, extra: ChatSessionExtra): ChatSession;
  updateSession(id: string, patch: ChatSessionPatch): ChatSession;
  appendMessage(message: ChatMessage, extra: { origin: ChatMessageOrigin }): ChatMessage;
  listMessages(chatId: string, query: PageQuery): PageResult<ChatMessage>;
  lastMessage(chatId: string): ChatMessage | null;
  /** The newest `limit` messages, returned oldest first. */
  recentMessages(chatId: string, limit: number): readonly ChatMessage[];
  /** Deletes archived sessions untouched since `cutoff`; messages cascade. */
  pruneArchivedBefore(cutoff: string): number;
}

export function toChatSession(session: ChatSession, lastMessage: ChatMessage | null): ChatSession {
  return { ...session, lastMessage };
}

const SESSION_COLUMNS = [
  'id, repo_id, kind, usage_usd, usage_tokens_in, usage_tokens_out',
  'context_tokens, context_epoch, reviewed_at, title, status',
  'opencode_session_id, worktree, created_at, updated_at',
].join(', ');
const MESSAGE_COLUMNS = 'id, chat_id, role, text, created_at';

interface SessionScope {
  readonly kind: ChatKind;
  readonly usage: {
    readonly usd: number;
    readonly tokensIn: number;
    readonly tokensOut: number;
  };
  readonly contextTokens: number;
  readonly contextEpoch: number;
  readonly reviewedAt: string | null;
}

function sessionScope(rowValue: Row): SessionScope {
  return {
    kind: enumColumn(rowValue, 'kind', CHAT_KINDS),
    usage: {
      usd: realColumn(rowValue, 'usage_usd'),
      tokensIn: integerColumn(rowValue, 'usage_tokens_in'),
      tokensOut: integerColumn(rowValue, 'usage_tokens_out'),
    },
    contextTokens: integerColumn(rowValue, 'context_tokens'),
    contextEpoch: integerColumn(rowValue, 'context_epoch'),
    reviewedAt: nullableTextColumn(rowValue, 'reviewed_at'),
  };
}

export function createChatRepository(db: DatabaseSync): ChatRepository {
  const selectSession = db.prepare(`SELECT ${SESSION_COLUMNS} FROM chat_sessions WHERE id = ?`);
  const insertSession = db.prepare(`
    INSERT INTO chat_sessions (
      id, repo_id, kind, title, status, opencode_session_id, worktree, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMessage = db.prepare(`
    INSERT INTO chat_messages (id, chat_id, role, text, origin, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const selectMessage = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE id = ?`);
  const selectLastMessage = db.prepare(`
    SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE chat_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `);
  const deleteArchivedBefore = db.prepare(
    "DELETE FROM chat_sessions WHERE status = 'archived' AND updated_at < ?",
  );

  function lastMessageOf(chatId: string): ChatMessage | null {
    const value = selectLastMessage.get(chatId);
    return value === undefined ? null : chatMessageFromRow(row(value));
  }

  function findSession(id: string): ChatSession | null {
    const value = selectSession.get(id);
    if (value === undefined) return null;
    const record = row(value);
    return { ...chatSessionFromRow(record, lastMessageOf(id)), ...sessionScope(record) };
  }

  return {
    getSession(id: string): ChatSession | null {
      return findSession(id);
    },

    listSessions(filter: {
      repoId?: string;
      limit: number;
      cursor: string | null;
    }): PageResult<ChatSession> {
      const limit = Math.max(1, Math.trunc(filter.limit));
      const conditions: string[] = [];
      const parameters: (string | number)[] = [];
      if (filter.repoId !== undefined) {
        conditions.push('repo_id = ?');
        parameters.push(filter.repoId);
      }
      if (filter.cursor !== null) {
        const cursor = decodeCursor(filter.cursor);
        conditions.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
        parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
      const values = db
        .prepare(
          `SELECT ${SESSION_COLUMNS} FROM chat_sessions ${where}
           ORDER BY updated_at DESC, id DESC LIMIT ?`,
        )
        .all(...parameters, limit + 1)
        .map((value) => row(value));
      const sessions = values.slice(0, limit).map((value) => {
        const session = chatSessionFromRow(value, null);
        return toChatSession({ ...session, ...sessionScope(value) }, lastMessageOf(session.id));
      });
      const last = values.at(limit - 1);
      const lastCursor = last === undefined ? null : chatSessionFromRow(last, null);
      return {
        data: sessions,
        nextCursor:
          values.length > limit && lastCursor !== null
            ? encodeCursor(lastCursor.updatedAt, lastCursor.id)
            : null,
      };
    },

    createSession(session: ChatSession, extra: ChatSessionExtra): ChatSession {
      try {
        insertSession.run(
          session.id,
          session.repoId,
          session.kind ?? 'repo',
          session.title,
          session.status,
          extra.opencodeSessionId,
          extra.worktree,
          session.createdAt,
          session.updatedAt,
        );
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'chat session repo does not exist');
        }
        throw error;
      }
      const created = findSession(session.id);
      if (created === null) throw new StoreError('invalid_row', 'chat session was not stored');
      return created;
    },

    updateSession(id: string, patch: ChatSessionPatch): ChatSession {
      const assignments: string[] = [];
      const parameters: (string | number | null)[] = [];
      if (patch.title !== undefined) {
        assignments.push('title = ?');
        parameters.push(patch.title);
      }
      if (patch.status !== undefined) {
        assignments.push('status = ?');
        parameters.push(patch.status);
      }
      if (patch.repoId !== undefined) {
        assignments.push('repo_id = ?');
        parameters.push(patch.repoId);
      }
      if (patch.opencodeSessionId !== undefined) {
        assignments.push('opencode_session_id = ?');
        parameters.push(patch.opencodeSessionId);
      }
      if (patch.worktree !== undefined) {
        assignments.push('worktree = ?');
        parameters.push(patch.worktree);
      }
      if (patch.kind !== undefined) {
        assignments.push('kind = ?');
        parameters.push(patch.kind);
      }
      if (patch.usage !== undefined) {
        assignments.push('usage_usd = ?', 'usage_tokens_in = ?', 'usage_tokens_out = ?');
        parameters.push(patch.usage.usd, patch.usage.tokensIn, patch.usage.tokensOut);
      }
      if (patch.contextTokens !== undefined) {
        assignments.push('context_tokens = ?');
        parameters.push(patch.contextTokens);
      }
      if (patch.contextEpoch !== undefined) {
        assignments.push('context_epoch = ?');
        parameters.push(patch.contextEpoch);
      }
      // reviewed_at is write-once: the first review wins and a null patch never clears it.
      if (patch.reviewedAt !== undefined && patch.reviewedAt !== null) {
        assignments.push('reviewed_at = COALESCE(reviewed_at, ?)');
        parameters.push(patch.reviewedAt);
      }
      assignments.push('updated_at = ?');
      parameters.push(patch.updatedAt);
      db.prepare(`UPDATE chat_sessions SET ${assignments.join(', ')} WHERE id = ?`).run(
        ...parameters,
        id,
      );
      const updated = findSession(id);
      if (updated === null) throw new StoreError('not_found', 'chat session not found');
      return updated;
    },

    appendMessage(message: ChatMessage, extra: { origin: ChatMessageOrigin }): ChatMessage {
      try {
        insertMessage.run(
          message.id,
          message.chatId,
          message.role,
          message.text,
          extra.origin,
          message.createdAt,
        );
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'chat message session does not exist');
        }
        throw error;
      }
      const stored = selectMessage.get(message.id);
      if (stored === undefined) throw new StoreError('invalid_row', 'chat message was not stored');
      return chatMessageFromRow(row(stored));
    },

    listMessages(chatId: string, query: PageQuery): PageResult<ChatMessage> {
      const limit = Math.max(1, Math.trunc(query.limit));
      const conditions = ['chat_id = ?'];
      const parameters: (string | number)[] = [chatId];
      if (query.cursor !== null) {
        const cursor = decodeCursor(query.cursor);
        conditions.push('(created_at > ? OR (created_at = ? AND id > ?))');
        parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      const values = db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE ${conditions.join(' AND ')}
           ORDER BY created_at ASC, id ASC LIMIT ?`,
        )
        .all(...parameters, limit + 1)
        .map((value) => chatMessageFromRow(row(value)));
      const data = values.slice(0, limit);
      const last = values.at(limit - 1);
      return {
        data,
        nextCursor:
          values.length > limit && last !== undefined
            ? encodeCursor(last.createdAt, last.id)
            : null,
      };
    },

    lastMessage(chatId: string): ChatMessage | null {
      return lastMessageOf(chatId);
    },

    recentMessages(chatId: string, limit: number): readonly ChatMessage[] {
      const size = Math.max(1, Math.trunc(limit));
      const values = db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE chat_id = ?
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(chatId, size)
        .map((value) => chatMessageFromRow(row(value)));
      return values.reverse();
    },

    pruneArchivedBefore(cutoff: string): number {
      return Number(deleteArchivedBefore.run(cutoff).changes);
    },
  };
}

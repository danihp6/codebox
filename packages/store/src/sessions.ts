import type {
  Session,
  SessionMessage,
  SessionProposal,
  SessionStatus,
  SessionTarget,
} from '@codebox/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { decodeCursor, encodeCursor, type PageQuery, type PageResult } from './cursor.js';
import { isCheckViolation, isForeignKeyViolation } from './db.js';
import { StoreError } from './errors.js';
import { jsonText, row, sessionFromRow, sessionMessageFromRow, textColumn } from './mappers.js';

export interface SessionFilter {
  readonly repoId?: string;
  readonly target?: SessionTarget;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface SessionPatch {
  readonly title?: string;
  readonly status?: SessionStatus;
  readonly branch?: string | null;
  readonly pendingProposal?: SessionProposal | null;
  readonly opencodeSessionId?: string | null;
  readonly worktree?: string | null;
  readonly usage?: { readonly usd: number; readonly tokensIn: number; readonly tokensOut: number };
  readonly contextTokens?: number;
  readonly contextEpoch?: number;
  readonly updatedAt: string;
}

export interface SessionRepository {
  getSession(id: string): Session | null;
  listSessions(filter: SessionFilter): PageResult<Session>;
  /** `lastMessage` must be `null`; the row is inserted with it absent. */
  createSession(session: Session): Session;
  updateSession(id: string, patch: SessionPatch): Session;
  appendMessage(message: SessionMessage): SessionMessage;
  listMessages(sessionId: string, query: PageQuery): PageResult<SessionMessage>;
}

const COLUMNS = [
  'id',
  'repo_id',
  'target',
  'work_id',
  'title',
  'status',
  'opencode_session_id',
  'worktree',
  'branch',
  'pending_proposal',
  'usage_usd',
  'usage_tokens_in',
  'usage_tokens_out',
  'context_tokens',
  'context_epoch',
  'created_at',
  'updated_at',
].join(', ');

const MESSAGE_COLUMNS = 'id, session_id, role, text, created_at';

const TEXT_COLUMNS: readonly [keyof SessionPatch, string][] = [
  ['title', 'title'],
  ['status', 'status'],
  ['branch', 'branch'],
  ['opencodeSessionId', 'opencode_session_id'],
  ['worktree', 'worktree'],
];

const VALUE_COLUMNS: readonly [keyof SessionPatch, string][] = [
  ['contextTokens', 'context_tokens'],
  ['contextEpoch', 'context_epoch'],
];

export function createSessionRepository(db: DatabaseSync): SessionRepository {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM sessions WHERE id = ?`);
  const selectLastMessage = db.prepare(
    `SELECT ${MESSAGE_COLUMNS} FROM session_messages
     WHERE session_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
  );
  const insert = db.prepare(`
    INSERT INTO sessions (
      id, repo_id, target, work_id, title, status, opencode_session_id, worktree, branch,
      pending_proposal, usage_usd, usage_tokens_in, usage_tokens_out, context_tokens,
      context_epoch, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMessage = db.prepare(
    `INSERT INTO session_messages (${MESSAGE_COLUMNS}) VALUES (?, ?, ?, ?, ?)`,
  );
  const selectMessage = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM session_messages WHERE id = ?`);

  function proposalText(proposal: SessionProposal | null): string | null {
    return proposal === null ? null : jsonText(proposal);
  }

  function lastMessageOf(sessionId: string): SessionMessage | null {
    const value = selectLastMessage.get(sessionId);
    return value === undefined ? null : sessionMessageFromRow(row(value));
  }

  function withLastMessage(rowValue: Record<string, unknown>): Session {
    const id = textColumn(rowValue, 'id');
    return sessionFromRow(rowValue, lastMessageOf(id));
  }

  function findById(id: string): Session | null {
    const value = selectById.get(id);
    return value === undefined ? null : withLastMessage(value);
  }

  function stored(id: string): Session {
    const value = findById(id);
    if (value === null) throw new StoreError('not_found', 'session not found');
    return value;
  }

  return {
    getSession(id: string): Session | null {
      return findById(id);
    },

    listSessions(filter: SessionFilter): PageResult<Session> {
      const limit = Math.max(1, Math.trunc(filter.limit));
      const conditions: string[] = [];
      const parameters: (string | number)[] = [];
      if (filter.repoId !== undefined) {
        conditions.push('repo_id = ?');
        parameters.push(filter.repoId);
      }
      if (filter.target !== undefined) {
        conditions.push('target = ?');
        parameters.push(filter.target);
      }
      if (filter.cursor !== null) {
        const cursor = decodeCursor(filter.cursor);
        conditions.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
        parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
      const values: Record<string, unknown>[] = db
        .prepare(
          `SELECT ${COLUMNS} FROM sessions ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`,
        )
        .all(...parameters, limit + 1)
        .map((value) => row(value));
      const data = values.slice(0, limit).map((value) => withLastMessage(value));
      const last = data.at(-1);
      return {
        data,
        nextCursor:
          values.length > limit && last !== undefined
            ? encodeCursor(last.updatedAt, last.id)
            : null,
      };
    },

    createSession(session: Session): Session {
      if (session.lastMessage !== null) {
        throw new StoreError('invalid_row', 'a new session carries no last message');
      }
      try {
        insert.run(
          session.id,
          session.repoId,
          session.target,
          session.workId,
          session.title,
          session.status,
          null,
          null,
          session.branch,
          proposalText(session.pendingProposal),
          session.usage.usd,
          session.usage.tokensIn,
          session.usage.tokensOut,
          session.contextTokens,
          session.contextEpoch,
          session.createdAt,
          session.updatedAt,
        );
      } catch (error) {
        if (isCheckViolation(error)) {
          throw new StoreError('check_violation', 'session target and work disagree');
        }
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'session reference is missing');
        }
        throw error;
      }
      return stored(session.id);
    },

    updateSession(id: string, patch: SessionPatch): Session {
      if (findById(id) === null) throw new StoreError('not_found', 'session not found');
      const assignments: string[] = [];
      const parameters: (string | number | null)[] = [];
      for (const [key, column] of TEXT_COLUMNS) {
        const value = patch[key];
        if (value !== undefined) {
          assignments.push(`${column} = ?`);
          parameters.push(value as string | null);
        }
      }
      for (const [key, column] of VALUE_COLUMNS) {
        const value = patch[key];
        if (value !== undefined) {
          assignments.push(`${column} = ?`);
          parameters.push(value as number);
        }
      }
      if (patch.pendingProposal !== undefined) {
        assignments.push('pending_proposal = ?');
        parameters.push(proposalText(patch.pendingProposal));
      }
      if (patch.usage !== undefined) {
        assignments.push('usage_usd = ?', 'usage_tokens_in = ?', 'usage_tokens_out = ?');
        parameters.push(patch.usage.usd, patch.usage.tokensIn, patch.usage.tokensOut);
      }
      assignments.push('updated_at = ?');
      parameters.push(patch.updatedAt);
      try {
        db.prepare(`UPDATE sessions SET ${assignments.join(', ')} WHERE id = ?`).run(
          ...parameters,
          id,
        );
      } catch (error) {
        if (isCheckViolation(error)) {
          throw new StoreError('check_violation', 'session target and work disagree');
        }
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'session reference is missing');
        }
        throw error;
      }
      return stored(id);
    },

    appendMessage(message: SessionMessage): SessionMessage {
      try {
        insertMessage.run(
          message.id,
          message.sessionId,
          message.role,
          message.text,
          message.createdAt,
        );
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'session is missing');
        }
        throw error;
      }
      const value = selectMessage.get(message.id);
      return value === undefined ? message : sessionMessageFromRow(row(value));
    },

    listMessages(sessionId: string, query: PageQuery): PageResult<SessionMessage> {
      const limit = Math.max(1, Math.trunc(query.limit));
      const conditions = ['session_id = ?'];
      const parameters: (string | number)[] = [sessionId];
      if (query.cursor !== null) {
        const cursor = decodeCursor(query.cursor);
        conditions.push('(created_at > ? OR (created_at = ? AND id > ?))');
        parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      const values = db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM session_messages
           WHERE ${conditions.join(' AND ')}
           ORDER BY created_at ASC, id ASC
           LIMIT ?`,
        )
        .all(...parameters, limit + 1)
        .map((value) => sessionMessageFromRow(row(value)));
      const data = values.slice(0, limit);
      const last = data.at(-1);
      return {
        data,
        nextCursor:
          values.length > limit && last !== undefined
            ? encodeCursor(last.createdAt, last.id)
            : null,
      };
    },
  };
}

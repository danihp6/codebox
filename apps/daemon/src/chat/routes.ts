import type { Context } from 'hono';
import { z } from 'zod';
import {
  ContractParseError,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  RepoId,
  pageOfChatMessage,
  pageOfChatSession,
  parseChatMessage,
  parseChatSession,
  parseOrThrow,
} from '@codebox/contracts';
import type { ChatSession } from '@codebox/contracts';
import { hasScope } from '@codebox/security';
import { StoreError } from '@codebox/store';
import type { PageResult } from '@codebox/store';
import { API_PREFIX } from '../app.js';
import { authenticatedDevice } from '../auth/index.js';
import type { AppVariables, DaemonApp } from '../modules.js';
import { ChatError, chatErrorResponse } from './errors.js';
import { MAX_TEXT_CHARS, chatRuntimeOf } from './service.js';
import type { ChatRuntime, ChatService } from './service.js';

export const DEFAULT_CHAT_TITLE = 'New chat';

type AppContext = Context<{ Variables: AppVariables }>;

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;
const SESSIONS_PATH = `${API_PREFIX}/chat/sessions`;

const createSessionSchema = z.strictObject({
  repoId: RepoId.optional(),
  title: z.string().min(1).optional(),
});

const bindRepoSchema = z.strictObject({ repoId: RepoId });

const sendMessageSchema = z.strictObject({
  text: z
    .string()
    .max(MAX_TEXT_CHARS)
    .refine((value) => value.trim().length > 0, { message: 'expected a non-empty message' }),
});

const listSessionsQuerySchema = z.strictObject({
  repoId: RepoId.optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

const listMessagesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

function json(c: AppContext, body: unknown, status: 200 | 201 | 202): Response {
  return c.json(body, status, JSON_HEADERS);
}

async function readJson(c: AppContext): Promise<unknown> {
  const text = await c.req.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ChatError('invalid_payload', 400, { path: 'body' });
  }
}

function queryInput(c: AppContext, boundary: string): Record<string, string> {
  const input: Record<string, string> = {};
  for (const [key, value] of new URL(c.req.url).searchParams) {
    if (Object.hasOwn(input, key)) throw invalid(boundary, `${boundary}.${key}`);
    input[key] = value;
  }
  return input;
}

function invalid(boundary: string, path: string): ContractParseError {
  return new ContractParseError(boundary, [
    { path, message: 'invalid query parameter', code: 'custom' },
  ]);
}

function notFound(): ChatError {
  return new ChatError('not_found', 404, { path: 'chat.id' });
}

/** The auth middleware reads every GET; the four mutations need `chat` on top of it. */
function requireChatScope(c: AppContext): void {
  const device = authenticatedDevice(c);
  if (device === null) throw new ChatError('unauthorized', 401, { reason: 'unauthorized' });
  if (!hasScope(device.scopes, 'chat')) {
    throw new ChatError('insufficient_scope', 403, { reason: 'insufficient_scope' });
  }
}

/** A cursor is opaque: `decodeCursor` failing inside the store is this route's 422. */
function page<T>(run: () => PageResult<T>): PageResult<T> {
  try {
    return run();
  } catch (error) {
    if (error instanceof StoreError && error.code === 'invalid_row') {
      throw new ChatError('invalid_payload', 422, { path: 'chat.cursor' });
    }
    throw error;
  }
}

function handle(c: AppContext, run: () => Response | Promise<Response>): Promise<Response> {
  return Promise.resolve()
    .then(run)
    .catch((error: unknown) => {
      if (error instanceof ChatError) return chatErrorResponse(c, error);
      if (error instanceof ContractParseError) {
        return chatErrorResponse(
          c,
          new ChatError('invalid_payload', 422, { path: error.first.path }),
        );
      }
      throw error;
    });
}

function runtimeOf(service: ChatService): ChatRuntime {
  return chatRuntimeOf(service);
}

/** Any shape failure of the bind body is reported against the one field the route reads. */
async function bindRepoBody(c: AppContext): Promise<{ readonly repoId: string }> {
  try {
    return parseOrThrow(bindRepoSchema, await readJson(c), 'chat');
  } catch (error) {
    if (error instanceof ContractParseError) {
      throw new ChatError('invalid_payload', 422, { path: 'chat.repoId' });
    }
    throw error;
  }
}

export function registerChatRoutes(app: DaemonApp, service: ChatService): void {
  app.get(SESSIONS_PATH, (c) =>
    handle(c, () => {
      const runtime = runtimeOf(service);
      const query = parseOrThrow(
        listSessionsQuerySchema,
        queryInput(c, 'chat.sessions'),
        'chat.sessions',
      );
      const result = page(() =>
        runtime.store.chats.listSessions({
          limit: query.limit,
          cursor: query.cursor ?? null,
          ...(query.repoId === undefined ? {} : { repoId: query.repoId }),
        }),
      );
      return json(c, parseOrThrow(pageOfChatSession, result, 'chat.sessions'), 200);
    }),
  );

  app.post(SESSIONS_PATH, (c) =>
    handle(c, async () => {
      requireChatScope(c);
      const runtime = runtimeOf(service);
      const body = parseOrThrow(createSessionSchema, await readJson(c), 'chat.session');
      const repoId = body.repoId;
      if (repoId !== undefined && runtime.store.repos.get(repoId) === null) {
        throw new ChatError('not_found', 404, { path: 'chat.repoId' });
      }
      const at = runtime.clock().toISOString();
      const session: ChatSession = {
        id: runtime.newChatId(),
        repoId: repoId ?? null,
        kind: repoId === undefined ? 'free' : 'repo',
        title: body.title ?? DEFAULT_CHAT_TITLE,
        status: 'idle',
        createdAt: at,
        updatedAt: at,
        lastMessage: null,
      };
      const created = runtime.store.chats.createSession(session, {
        opencodeSessionId: null,
        worktree: null,
      });
      // A free chat opens no OpenCode session: its directory is made on the first message.
      if (repoId === undefined) return json(c, parseChatSession(created), 201);
      // The row survives a failed prepare with `opencodeSessionId = null`, so the client keeps
      // the id it was given and the session can be prepared again on the next message.
      const prepared = await service.prepare(created.id);
      return json(c, parseChatSession(prepared), 201);
    }),
  );

  app.get(`${SESSIONS_PATH}/:id`, (c) =>
    handle(c, () => {
      const runtime = runtimeOf(service);
      const session = runtime.store.chats.getSession(c.req.param('id'));
      if (session === null) throw notFound();
      return json(c, parseChatSession(session), 200);
    }),
  );

  app.delete(`${SESSIONS_PATH}/:id`, (c) =>
    handle(c, () => {
      requireChatScope(c);
      const runtime = runtimeOf(service);
      const id = c.req.param('id');
      if (runtime.store.chats.getSession(id) === null) throw notFound();
      const archived = runtime.store.chats.updateSession(id, {
        status: 'archived',
        updatedAt: runtime.clock().toISOString(),
      });
      return json(c, parseChatSession(archived), 200);
    }),
  );

  app.get(`${SESSIONS_PATH}/:id/messages`, (c) =>
    handle(c, () => {
      const runtime = runtimeOf(service);
      const id = c.req.param('id');
      if (runtime.store.chats.getSession(id) === null) throw notFound();
      const query = parseOrThrow(
        listMessagesQuerySchema,
        queryInput(c, 'chat.messages'),
        'chat.messages',
      );
      const result = page(() =>
        runtime.store.chats.listMessages(id, {
          limit: query.limit,
          cursor: query.cursor ?? null,
        }),
      );
      return json(c, parseOrThrow(pageOfChatMessage, result, 'chat.messages'), 200);
    }),
  );

  app.post(`${SESSIONS_PATH}/:id/messages`, (c) =>
    handle(c, async () => {
      requireChatScope(c);
      const runtime = runtimeOf(service);
      const id = c.req.param('id');
      if (runtime.store.chats.getSession(id) === null) throw notFound();
      const body = parseOrThrow(sendMessageSchema, await readJson(c), 'chat.message');
      const message = await service.send({ chatId: id, text: body.text });
      return json(c, parseChatMessage(message), 202);
    }),
  );

  app.post(`${SESSIONS_PATH}/:id/interrupt`, (c) =>
    handle(c, async () => {
      requireChatScope(c);
      const session = await service.interrupt(c.req.param('id'));
      return json(c, parseChatSession(session), 200);
    }),
  );

  app.post(`${SESSIONS_PATH}/:id/repo`, (c) =>
    handle(c, async () => {
      requireChatScope(c);
      const runtime = runtimeOf(service);
      const id = c.req.param('id');
      if (runtime.store.chats.getSession(id) === null) throw notFound();
      const body = await bindRepoBody(c);
      return json(c, parseChatSession(await service.bind(id, body.repoId)), 200);
    }),
  );

  app.post(`${SESSIONS_PATH}/:id/compact`, (c) =>
    handle(c, async () => {
      requireChatScope(c);
      return json(c, parseChatSession(await service.compact(c.req.param('id'))), 200);
    }),
  );

  app.post(`${SESSIONS_PATH}/:id/reviewed`, (c) =>
    handle(c, () => {
      requireChatScope(c);
      const runtime = runtimeOf(service);
      const id = c.req.param('id');
      if (runtime.store.chats.getSession(id) === null) throw notFound();
      const at = runtime.clock().toISOString();
      // The store writes `reviewed_at` with COALESCE, so a second review keeps the first stamp.
      const reviewed = runtime.store.chats.updateSession(id, { reviewedAt: at, updatedAt: at });
      return json(c, parseChatSession(reviewed), 200);
    }),
  );
}

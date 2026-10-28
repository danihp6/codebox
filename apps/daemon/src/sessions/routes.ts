import { z } from 'zod';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  RepoId,
  SessionId,
  WorkId,
  parseOrThrow,
  parsePage,
  parseSession,
  parseSessionMessage,
  sessionMessageSchema,
  sessionSchema,
  sessionTargetSchema,
} from '@codebox/contracts';
import { API_PREFIX } from '../app.js';
import type { DaemonApp } from '../modules.js';
import { handle, json, queryInput, readJson, requireScope } from '../runs/errors.js';
import { MAX_TEXT_CHARS } from './service.js';
import type { SessionsService } from './service.js';

const SESSIONS_PATH = `${API_PREFIX}/sessions`;

const listQuery = z.strictObject({
  repoId: RepoId.optional(),
  target: sessionTargetSchema.optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

const messagesQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

const createBody = z.strictObject({
  repoId: RepoId,
  target: sessionTargetSchema,
  workId: WorkId.nullable().optional(),
  title: z.string().min(1).max(120).optional(),
});

const messageBody = z.strictObject({
  text: z
    .string()
    .max(MAX_TEXT_CHARS)
    .refine((value) => value.trim().length > 0, { message: 'expected a non-empty message' }),
});

export function registerSessionRoutes(app: DaemonApp, service: SessionsService): void {
  app.get(SESSIONS_PATH, (c) =>
    handle(c, 'sessions', () => {
      const query = parseOrThrow(listQuery, queryInput(c, 'sessions'), 'sessions');
      const page = service.list({
        limit: query.limit,
        cursor: query.cursor ?? null,
        ...(query.repoId === undefined ? {} : { repoId: query.repoId }),
        ...(query.target === undefined ? {} : { target: query.target }),
      });
      return json(c, parsePage(sessionSchema, page, 'sessions'), 200);
    }),
  );

  app.post(SESSIONS_PATH, (c) =>
    handle(c, 'session', async () => {
      requireScope(c, 'write');
      const body = parseOrThrow(createBody, await readJson(c), 'session');
      const session = await service.create({
        repoId: body.repoId,
        target: body.target,
        workId: body.workId ?? null,
        ...(body.title === undefined ? {} : { title: body.title }),
      });
      return json(c, parseSession(session), 201);
    }),
  );

  app.get(`${SESSIONS_PATH}/:id`, (c) =>
    handle(c, 'session', () => {
      const id = parseOrThrow(SessionId, c.req.param('id'), 'session.id');
      return json(c, parseSession(service.get(id)), 200);
    }),
  );

  app.delete(`${SESSIONS_PATH}/:id`, (c) =>
    handle(c, 'session', async () => {
      requireScope(c, 'write');
      const id = parseOrThrow(SessionId, c.req.param('id'), 'session.id');
      await service.archive(id);
      return c.body(null, 204);
    }),
  );

  app.get(`${SESSIONS_PATH}/:id/messages`, (c) =>
    handle(c, 'session', () => {
      const id = parseOrThrow(SessionId, c.req.param('id'), 'session.id');
      const query = parseOrThrow(
        messagesQuery,
        queryInput(c, 'session.messages'),
        'session.messages',
      );
      const page = service.messages(id, {
        limit: query.limit,
        cursor: query.cursor ?? null,
      });
      return json(c, parsePage(sessionMessageSchema, page, 'session.messages'), 200);
    }),
  );

  app.post(`${SESSIONS_PATH}/:id/messages`, (c) =>
    handle(c, 'session', async () => {
      requireScope(c, 'write');
      const id = parseOrThrow(SessionId, c.req.param('id'), 'session.id');
      const body = parseOrThrow(messageBody, await readJson(c), 'session.message');
      return json(c, parseSessionMessage(await service.send({ id, text: body.text })), 202);
    }),
  );

  app.post(`${SESSIONS_PATH}/:id/compact`, (c) =>
    handle(c, 'session', async () => {
      requireScope(c, 'write');
      const id = parseOrThrow(SessionId, c.req.param('id'), 'session.id');
      return json(c, parseSession(await service.compact(id)), 200);
    }),
  );

  app.post(`${SESSIONS_PATH}/:id/merge`, (c) =>
    handle(c, 'session', async () => {
      requireScope(c, 'write');
      const id = parseOrThrow(SessionId, c.req.param('id'), 'session.id');
      return json(c, parseSession(await service.merge(id)), 200);
    }),
  );

  app.post(`${SESSIONS_PATH}/:id/interrupt`, (c) =>
    handle(c, 'session', async () => {
      requireScope(c, 'write');
      const id = parseOrThrow(SessionId, c.req.param('id'), 'session.id');
      return json(c, parseSession(await service.interrupt(id)), 200);
    }),
  );
}

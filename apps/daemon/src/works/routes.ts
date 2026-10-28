import { z } from 'zod';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  RepoId,
  WorkId,
  backlogRefSchema,
  parseOrThrow,
  parsePage,
  parseRun,
  parseSession,
  parseWork,
  parseWorkDetail,
  workStateSchema,
  workSchema,
} from '@codebox/contracts';
import { API_PREFIX } from '../app.js';
import { BacklogRefError } from '../backlog/index.js';
import type { DaemonApp } from '../modules.js';
import {
  RunApiError,
  handle,
  json,
  queryInput,
  readJson,
  readJsonOrEmpty,
  requireScope,
} from '../runs/errors.js';
import type { WorksService } from './service.js';

const WORKS_PATH = `${API_PREFIX}/works`;
const REPOS_PATH = `${API_PREFIX}/repos`;
const PROMPT_MAX_CHARS = 8_000;

const listQuery = z.strictObject({
  repoId: RepoId.optional(),
  state: workStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

const createBody = z.strictObject({
  repoId: RepoId,
  backlogRef: backlogRefSchema,
});

const patchBody = z.strictObject({
  title: z.string().min(1).max(120).optional(),
  prompt: z.string().min(1).max(PROMPT_MAX_CHARS).optional(),
});

const runBody = z.strictObject({
  prompt: z.string().min(1).max(PROMPT_MAX_CHARS).optional(),
});

/** docs/api.md §5.6: a ref the file cannot resolve is 422 (missing/ambiguous) or 409 (ticked). */
function refRefusal(error: BacklogRefError): RunApiError {
  if (error.reason === 'backlog_ref_checked') {
    return new RunApiError('conflict', 409, { reason: error.reason });
  }
  return new RunApiError('validation_failed', 422, {
    path: 'work.backlogRef',
    reason: error.reason,
  });
}

export function registerWorksRoutes(app: DaemonApp, service: WorksService): void {
  app.get(WORKS_PATH, (c) =>
    handle(c, 'works', () => {
      const query = parseOrThrow(listQuery, queryInput(c, 'works'), 'works');
      const page = service.list({
        limit: query.limit,
        cursor: query.cursor ?? null,
        ...(query.repoId === undefined ? {} : { repoId: query.repoId }),
        ...(query.state === undefined ? {} : { state: query.state }),
      });
      return json(c, parsePage(workSchema, page, 'works'), 200);
    }),
  );

  app.post(WORKS_PATH, (c) =>
    handle(c, 'works', async () => {
      requireScope(c, 'write');
      const body = parseOrThrow(createBody, await readJson(c), 'work');
      try {
        return json(c, parseWork(await service.create(body)), 201);
      } catch (error) {
        if (error instanceof BacklogRefError) throw refRefusal(error);
        throw error;
      }
    }),
  );

  app.get(`${WORKS_PATH}/:id`, (c) =>
    handle(c, 'work', () => {
      const id = parseOrThrow(WorkId, c.req.param('id'), 'work.id');
      return json(c, parseWorkDetail(service.detail(id)), 200);
    }),
  );

  app.patch(`${WORKS_PATH}/:id`, (c) =>
    handle(c, 'work', async () => {
      requireScope(c, 'write');
      const id = parseOrThrow(WorkId, c.req.param('id'), 'work.id');
      const raw = await readJsonOrEmpty(c);
      const body = parseOrThrow(patchBody, raw, 'work');
      return json(c, parseWork(service.patch(id, body)), 200);
    }),
  );

  app.delete(`${WORKS_PATH}/:id`, (c) =>
    handle(c, 'work', () => {
      requireScope(c, 'write');
      service.archive(parseOrThrow(WorkId, c.req.param('id'), 'work.id'));
      return c.body(null, 204);
    }),
  );

  app.post(`${WORKS_PATH}/:id/runs`, (c) =>
    handle(c, 'work', async () => {
      requireScope(c, 'runs');
      const id = parseOrThrow(WorkId, c.req.param('id'), 'work.id');
      const body = parseOrThrow(runBody, await readJsonOrEmpty(c), 'run');
      const run = await service.startRun(id, body.prompt);
      return json(c, parseRun(run), 202);
    }),
  );

  app.post(`${WORKS_PATH}/:id/decision`, (c) =>
    handle(c, 'work', async () => {
      requireScope(c, 'write');
      const id = parseOrThrow(WorkId, c.req.param('id'), 'work.id');
      return json(c, parseSession(await service.decision(id)), 201);
    }),
  );

  app.post(`${WORKS_PATH}/:id/reviewed`, (c) =>
    handle(c, 'work', () => {
      requireScope(c, 'write');
      const id = parseOrThrow(WorkId, c.req.param('id'), 'work.id');
      return json(c, parseWork(service.reviewed(id)), 200);
    }),
  );

  app.post(`${WORKS_PATH}/:id/interrupt`, (c) =>
    handle(c, 'work', async () => {
      requireScope(c, 'write');
      const id = parseOrThrow(WorkId, c.req.param('id'), 'work.id');
      return json(c, parseWork(await service.interrupt(id)), 202);
    }),
  );

  app.post(`${REPOS_PATH}/:id/run-next`, (c) =>
    handle(c, 'repo', async () => {
      requireScope(c, 'runs');
      const id = parseOrThrow(RepoId, c.req.param('id'), 'repo.id');
      return json(c, parseRun(await service.runNext(id)), 202);
    }),
  );
}

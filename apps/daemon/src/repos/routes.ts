import { z } from 'zod';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  RepoId,
  branchSchema,
  globSchema,
  pageOfRepo,
  parseOrThrow,
  parseRepo,
  parseRepoDetail,
  parseRepoVerify,
  repoPolicySchema,
  slugSchema,
} from '@codebox/contracts';
import { API_PREFIX } from '../app.js';
import type { DaemonApp } from '../modules.js';
import {
  handle,
  json,
  queryInput,
  readJson,
  readJsonOrEmpty,
  requireScope,
} from '../runs/errors.js';
import type { ReposService } from './service.js';

const REPOS_PATH = `${API_PREFIX}/repos`;

const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

const createBody = z.strictObject({
  slug: slugSchema,
  defaultBranch: branchSchema.optional(),
  gate: z.string().min(1).optional(),
  policy: repoPolicySchema.optional(),
  protectedPaths: z.array(globSchema).optional(),
});

const patchBody = z.strictObject({
  gate: z.string().min(1).optional(),
  policy: repoPolicySchema.optional(),
  protectedPaths: z.array(globSchema).optional(),
  enabled: z.boolean().optional(),
});

export function registerReposRoutes(app: DaemonApp, repos: ReposService): void {
  app.get(REPOS_PATH, (c) =>
    handle(c, 'repos', () => {
      const query = parseOrThrow(listQuery, queryInput(c, 'repos'), 'repos');
      const page = repos.list({ limit: query.limit, cursor: query.cursor ?? null });
      return json(c, parseOrThrow(pageOfRepo, page, 'repos'), 200);
    }),
  );

  app.post(REPOS_PATH, (c) =>
    handle(c, 'repo', async () => {
      requireScope(c, 'write');
      const body = parseOrThrow(createBody, await readJson(c), 'repo');
      return json(c, parseRepo(repos.create(body)), 201);
    }),
  );

  app.get(`${REPOS_PATH}/:id`, (c) =>
    handle(c, 'repo', () => {
      const id = parseOrThrow(RepoId, c.req.param('id'), 'repo.id');
      return json(c, parseRepoDetail(repos.detail(id)), 200);
    }),
  );

  app.patch(`${REPOS_PATH}/:id`, (c) =>
    handle(c, 'repo', async () => {
      requireScope(c, 'write');
      const id = parseOrThrow(RepoId, c.req.param('id'), 'repo.id');
      const body = parseOrThrow(patchBody, await readJsonOrEmpty(c), 'repo');
      return json(c, parseRepo(repos.patch(id, body)), 200);
    }),
  );

  app.delete(`${REPOS_PATH}/:id`, (c) =>
    handle(c, 'repo', () => {
      requireScope(c, 'write');
      repos.remove(parseOrThrow(RepoId, c.req.param('id'), 'repo.id'));
      return c.body(null, 204);
    }),
  );

  app.post(`${REPOS_PATH}/:id/verify`, (c) =>
    handle(c, 'repo', async () => {
      requireScope(c, 'write');
      const id = parseOrThrow(RepoId, c.req.param('id'), 'repo.id');
      return json(c, parseRepoVerify(await repos.verify(id)), 200);
    }),
  );
}

import { RepoId, parseBacklog, parseOrThrow } from '@codebox/contracts';
import { API_PREFIX } from '../app.js';
import type { DaemonApp } from '../modules.js';
import { RunApiError, handle, json } from '../runs/errors.js';
import { backlogInternals } from './service.js';
import type { BacklogService } from './service.js';

const REPOS_PATH = `${API_PREFIX}/repos`;

function notFound(): RunApiError {
  return new RunApiError('not_found', 404, { path: 'repo.id' });
}

export function registerBacklogRoutes(app: DaemonApp, service: BacklogService): void {
  app.get(`${REPOS_PATH}/:id/backlog`, (c) =>
    handle(c, 'backlog', async () => {
      const id = parseOrThrow(RepoId, c.req.param('id'), 'repo.id');
      const internals = backlogInternals(service);
      const repo = internals.store.repos.get(id);
      if (repo === null) throw notFound();
      const projected = await service.project(repo);
      if (projected === null) throw notFound();
      return json(c, parseBacklog(projected), 200);
    }),
  );
}

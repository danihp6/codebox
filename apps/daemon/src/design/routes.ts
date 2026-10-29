import { z } from 'zod';
import { RepoId, commitShaSchema, parseDesignPreview, parseOrThrow } from '@codebox/contracts';
import type { Store } from '@codebox/store';
import { API_PREFIX } from '../app.js';
import type { DaemonApp } from '../modules.js';
import { RunApiError, handle, json, queryInput } from '../runs/errors.js';
import { DesignPreviewError } from './preview.js';
import { DesignReadError, DesignRevisionError, designInternals } from './service.js';
import type { DesignService } from './service.js';

const REPOS_PATH = `${API_PREFIX}/repos`;

const revisionQuery = z.strictObject({ revision: commitShaSchema.optional() });

function notFound(): RunApiError {
  return new RunApiError('not_found', 404, { path: 'repo.id' });
}

export function registerDesignRoutes(app: DaemonApp, service: DesignService, store: Store): void {
  app.get(`${REPOS_PATH}/:id/design`, (c) =>
    handle(c, 'design', async () => {
      const id = parseOrThrow(RepoId, c.req.param('id'), 'repo.id');
      const query = parseOrThrow(revisionQuery, queryInput(c, 'design'), 'design');
      const repo = store.repos.get(id);
      if (repo === null) throw notFound();
      const revision = query.revision ?? null;
      const logger = designInternals(service).logger;
      try {
        return json(c, parseDesignPreview(await service.preview(repo, revision)), 200);
      } catch (error) {
        if (error instanceof DesignRevisionError) {
          logger.warn({
            msg: 'design_preview_revision_unknown',
            repoId: repo.id,
            revision: error.revision,
          });
          throw new RunApiError('validation_failed', 422, {
            path: 'design.revision',
            reason: 'revision_unknown',
          });
        }
        if (error instanceof DesignPreviewError) {
          logger.warn({
            msg: 'design_preview_invalid',
            repoId: repo.id,
            revision,
            file: error.file,
          });
          throw new RunApiError('validation_failed', 422, {
            path: 'design.document',
            file: error.file,
            reason: 'invalid_document',
          });
        }
        if (error instanceof DesignReadError) {
          logger.warn({
            msg: 'design_preview_failed',
            repoId: repo.id,
            revision,
            command: error.command,
            code: error.code,
          });
          throw new RunApiError('agent_unavailable', 503, { reason: 'workspace_unavailable' });
        }
        throw error;
      }
    }),
  );
}

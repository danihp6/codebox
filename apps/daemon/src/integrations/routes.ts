import { pageSchema, parseOrThrow } from '@codebox/contracts';
import { API_PREFIX } from '../app.js';
import type { DaemonApp } from '../modules.js';
import { handle, json, readJson, requireScope } from '../runs/errors.js';
import {
  createIntegrationSchema,
  githubCompleteSchema,
  integrationRequestSchema,
  publicIntegrationSchema,
} from '../credentials/schemas.js';
import type { IntegrationsService } from './service.js';
import type { IntegrationRequestInput } from './service.js';

const INTEGRATIONS_PATH = `${API_PREFIX}/integrations`;
const GITHUB_PATH = `${INTEGRATIONS_PATH}/github`;

const pageOfIntegration = pageSchema(publicIntegrationSchema);

export function registerIntegrationRoutes(app: DaemonApp, service: IntegrationsService): void {
  app.get(INTEGRATIONS_PATH, (c) =>
    handle(c, 'credentials', () =>
      json(
        c,
        parseOrThrow(pageOfIntegration, { data: service.list(), nextCursor: null }, 'integration'),
        200,
      ),
    ),
  );

  app.post(INTEGRATIONS_PATH, (c) =>
    handle(c, 'credentials', async () => {
      requireScope(c, 'admin');
      const body = parseOrThrow(createIntegrationSchema, await readJson(c), 'integration');
      return json(c, service.create(body), 201);
    }),
  );

  app.post(`${GITHUB_PATH}/manifest`, (c) =>
    handle(c, 'credentials', () => {
      requireScope(c, 'admin');
      return json(c, service.startManifest(), 200);
    }),
  );

  app.post(`${GITHUB_PATH}/complete`, (c) =>
    handle(c, 'credentials', async () => {
      requireScope(c, 'admin');
      const body = parseOrThrow(githubCompleteSchema, await readJson(c), 'integration');
      return json(c, await service.completeManifest(body), 200);
    }),
  );

  app.delete(`${INTEGRATIONS_PATH}/:id`, (c) =>
    handle(c, 'credentials', () => {
      requireScope(c, 'admin');
      service.remove(c.req.param('id'));
      return c.body(null, 204);
    }),
  );

  app.post(`${INTEGRATIONS_PATH}/:id/request`, (c) =>
    handle(c, 'credentials', async () => {
      requireScope(c, 'runs');
      const body = parseOrThrow(integrationRequestSchema, await readJson(c), 'integration');
      const input: IntegrationRequestInput = {
        method: body.method,
        path: body.path,
        ...(body.query === undefined ? {} : { query: body.query }),
        ...(body.headers === undefined ? {} : { headers: body.headers }),
        ...(body.body === undefined ? {} : { body: body.body }),
      };
      return json(c, await service.request(c.req.param('id'), input), 200);
    }),
  );
}

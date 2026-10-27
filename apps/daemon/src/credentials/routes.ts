import { pageSchema, parseOrThrow } from '@codebox/contracts';
import { API_PREFIX } from '../app.js';
import type { DaemonApp } from '../modules.js';
import { handle, json, readJson, requireScope } from '../runs/errors.js';
import {
  createCredentialSchema,
  publicCredentialSchema,
  rotateCredentialSchema,
} from './schemas.js';
import type { CredentialsService } from './service.js';

const CREDENTIALS_PATH = `${API_PREFIX}/credentials`;

const pageOfCredential = pageSchema(publicCredentialSchema);

export function registerCredentialRoutes(app: DaemonApp, service: CredentialsService): void {
  app.get(CREDENTIALS_PATH, (c) =>
    handle(c, 'credentials', () =>
      json(
        c,
        parseOrThrow(pageOfCredential, { data: service.list(), nextCursor: null }, 'credential'),
        200,
      ),
    ),
  );

  app.post(CREDENTIALS_PATH, (c) =>
    handle(c, 'credentials', async () => {
      requireScope(c, 'admin');
      const body = parseOrThrow(createCredentialSchema, await readJson(c), 'credential');
      return json(c, service.create(body), 201);
    }),
  );

  app.delete(`${CREDENTIALS_PATH}/:id`, (c) =>
    handle(c, 'credentials', () => {
      requireScope(c, 'admin');
      service.remove(c.req.param('id'));
      return c.body(null, 204);
    }),
  );

  app.post(`${CREDENTIALS_PATH}/:id/rotate`, (c) =>
    handle(c, 'credentials', async () => {
      requireScope(c, 'admin');
      const body = parseOrThrow(rotateCredentialSchema, await readJson(c), 'credential');
      return json(c, service.rotate(c.req.param('id'), body), 200);
    }),
  );
}

import { parseOrThrow } from '@codebox/contracts';
import { API_PREFIX } from '../app.js';
import type { DaemonApp } from '../modules.js';
import { handle, json, readJson, requireScope } from '../runs/errors.js';
import {
  addTokenAccountSchema,
  completeOauthSchema,
  patchAccountSchema,
  startOauthSchema,
} from './schemas.js';
import type { ProvidersService } from './service.js';

const PROVIDERS_PATH = `${API_PREFIX}/providers`;
const ACCOUNTS_PATH = `${API_PREFIX}/provider-accounts`;

export function registerProviderRoutes(app: DaemonApp, service: ProvidersService): void {
  app.get(PROVIDERS_PATH, (c) => handle(c, 'providers', () => json(c, service.list(), 200)));

  app.post(`${PROVIDERS_PATH}/:id/accounts`, (c) =>
    handle(c, 'providerAccount', async () => {
      requireScope(c, 'admin');
      const body = parseOrThrow(addTokenAccountSchema, await readJson(c), 'providerAccount');
      return json(c, service.addTokenAccount(c.req.param('id'), body), 201);
    }),
  );

  app.post(`${PROVIDERS_PATH}/:id/oauth/start`, (c) =>
    handle(c, 'provider', async () => {
      requireScope(c, 'admin');
      const body = parseOrThrow(startOauthSchema, await readJson(c), 'provider');
      return json(c, service.startOauth(c.req.param('id'), body), 200);
    }),
  );

  app.post(`${PROVIDERS_PATH}/:id/oauth/complete`, (c) =>
    handle(c, 'providerAccount', async () => {
      requireScope(c, 'admin');
      const body = parseOrThrow(completeOauthSchema, await readJson(c), 'providerAccount');
      return json(c, await service.completeOauth(c.req.param('id'), body), 201);
    }),
  );

  app.patch(`${ACCOUNTS_PATH}/:id`, (c) =>
    handle(c, 'providerAccount', async () => {
      requireScope(c, 'admin');
      const body = parseOrThrow(patchAccountSchema, await readJson(c), 'providerAccount');
      return json(c, service.patchAccount(c.req.param('id'), body), 200);
    }),
  );

  app.post(`${ACCOUNTS_PATH}/:id/test`, (c) =>
    handle(c, 'providerAccount', async () => {
      requireScope(c, 'admin');
      return json(c, await service.testAccount(c.req.param('id')), 200);
    }),
  );

  app.delete(`${ACCOUNTS_PATH}/:id`, (c) =>
    handle(c, 'providerAccount', () => {
      requireScope(c, 'admin');
      service.removeAccount(c.req.param('id'));
      return c.body(null, 204);
    }),
  );
}

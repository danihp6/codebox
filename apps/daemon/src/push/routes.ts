import type { Context } from 'hono';
import { z } from 'zod';
import {
  ContractParseError,
  notificationPreferencesSchema,
  parseNotificationPreferences,
  parseOrThrow,
  pushKindSchema,
} from '@codebox/contracts';
import { hasScope } from '@codebox/security';
import { API_PREFIX } from '../app.js';
import { authenticatedDevice } from '../auth/index.js';
import type { AppVariables, DaemonApp } from '../modules.js';
import { PushError, pushErrorResponse } from './errors.js';
import type { PushService } from './service.js';

const PREFERENCES_PATH = `${API_PREFIX}/notifications/preferences`;
const SUBSCRIPTIONS_PATH = `${API_PREFIX}/push/subscriptions`;

type AppContext = Context<{ Variables: AppVariables }>;

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

const createSubscriptionSchema = z.strictObject({
  kind: pushKindSchema,
  endpoint: z.string().min(1).max(2048),
  keys: z.record(z.string(), z.string().min(1)),
});

function json(c: AppContext, body: unknown, status: 200 | 201): Response {
  return c.json(body, status, JSON_HEADERS);
}

async function readJson(c: AppContext): Promise<unknown> {
  const text = await c.req.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new PushError('invalid_payload', 422, { path: 'body' });
  }
}

/** The middleware covers `read` on GET; every mutation owns its `write` check here. */
function requireWriteScope(c: AppContext): void {
  const device = authenticatedDevice(c);
  if (device === null) throw new PushError('unauthorized', 401, { reason: 'unauthorized' });
  if (!hasScope(device.scopes, 'write')) {
    throw new PushError('insufficient_scope', 403, { reason: 'insufficient_scope' });
  }
}

function handle(c: AppContext, run: () => Response | Promise<Response>): Promise<Response> {
  return Promise.resolve()
    .then(run)
    .catch((error: unknown) => {
      if (error instanceof PushError) return pushErrorResponse(c, error);
      if (error instanceof ContractParseError) {
        return pushErrorResponse(
          c,
          new PushError('invalid_payload', 422, { path: error.first.path }),
        );
      }
      throw error;
    });
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function requireWebKeys(body: {
  readonly kind: string;
  readonly endpoint: string;
  readonly keys: Readonly<Record<string, string>>;
}): void {
  if (body.kind !== 'web') return;
  if (!isHttpsUrl(body.endpoint)) {
    throw new PushError('invalid_payload', 422, { path: 'push.endpoint' });
  }
  if ((body.keys['p256dh'] ?? '') === '') {
    throw new PushError('invalid_payload', 422, { path: 'push.keys.p256dh' });
  }
  if ((body.keys['auth'] ?? '') === '') {
    throw new PushError('invalid_payload', 422, { path: 'push.keys.auth' });
  }
}

export function registerPushRoutes(app: DaemonApp, service: PushService): void {
  app.get(PREFERENCES_PATH, (c) =>
    handle(c, () => json(c, parseNotificationPreferences(service.preferences()), 200)),
  );

  app.patch(PREFERENCES_PATH, (c) =>
    handle(c, async () => {
      requireWriteScope(c);
      const body = parseOrThrow(
        notificationPreferencesSchema,
        await readJson(c),
        'push.preferences',
      );
      const updated = service.updatePreferences(body);
      return json(c, parseNotificationPreferences(updated), 200);
    }),
  );

  app.post(SUBSCRIPTIONS_PATH, (c) =>
    handle(c, async () => {
      requireWriteScope(c);
      const body = parseOrThrow(createSubscriptionSchema, await readJson(c), 'push.subscription');
      requireWebKeys(body);
      const result = service.subscribe(body);
      return json(c, result.subscription, result.created ? 201 : 200);
    }),
  );

  app.delete(`${SUBSCRIPTIONS_PATH}/:id`, (c) =>
    handle(c, () => {
      requireWriteScope(c);
      const removed = service.unsubscribe(c.req.param('id'));
      if (!removed) throw new PushError('not_found', 404, { path: 'push.id' });
      return c.body(null, 204);
    }),
  );
}

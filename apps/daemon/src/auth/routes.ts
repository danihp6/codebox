import type { Context } from 'hono';
import { z } from 'zod';
import {
  ContractParseError,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  devicePlatformSchema,
  parseOrThrow,
  scopeSchema,
} from '@codebox/contracts';
import type { Device, Me, Scope } from '@codebox/contracts';
import { hasScope } from '@codebox/security';
import type { Store } from '@codebox/store';
import { API_PREFIX } from '../app.js';
import type { AppVariables, DaemonApp } from '../modules.js';
import { AuthError, authErrorResponse } from './errors.js';
import {
  authenticateRequest,
  authenticatedDevice,
  createAuthMiddleware,
  enforceRateLimit,
  rateLimitSource,
} from './middleware.js';
import type { RateLimiter } from './middleware.js';
import {
  PAIRING_NAME_MAX_LENGTH,
  PAIRING_TTL_MAX_SECONDS,
  PAIRING_TTL_MIN_SECONDS,
} from './service.js';
import type { AuthService, PairExchangeInput } from './service.js';

export interface RegisterAuthRoutesOptions {
  readonly now: () => Date;
  readonly isLoopback: (c: Context) => boolean;
  readonly rateLimit: RateLimiter;
  // The device routes read and revoke rows, and `AuthService` is the token seam, not a
  // repository: the store stays the only place device rows are read.
  readonly store: Store;
}

type AppContext = Context<{ Variables: AppVariables }>;

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;
const CODE_MAX_LENGTH = 64;
const REFRESH_TOKEN_MAX_LENGTH = 512;
const PUBLIC_KEY_MAX_LENGTH = 8192;

const pairCodeSchema = z.strictObject({
  name: z.string().min(1).max(PAIRING_NAME_MAX_LENGTH),
  ttlSeconds: z.number().int().min(PAIRING_TTL_MIN_SECONDS).max(PAIRING_TTL_MAX_SECONDS).optional(),
  scopes: z.array(scopeSchema).min(1).optional(),
});

const pairSchema = z.strictObject({
  code: z.string().min(1).max(CODE_MAX_LENGTH),
  deviceName: z.string().min(1).max(PAIRING_NAME_MAX_LENGTH),
  platform: devicePlatformSchema,
  devicePublicKey: z.string().min(1).max(PUBLIC_KEY_MAX_LENGTH),
});

const refreshSchema = z.strictObject({
  refreshToken: z.string().min(1).max(REFRESH_TOKEN_MAX_LENGTH),
});

const listDevicesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

function json(c: AppContext, body: unknown, status: 200 | 201): Response {
  return c.json(body, status, JSON_HEADERS);
}

async function readJson(c: AppContext): Promise<unknown> {
  const text = await c.req.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new AuthError('invalid_payload', 400, { path: 'body' });
  }
}

function queryInput(c: AppContext): Record<string, string> {
  const input: Record<string, string> = {};
  for (const [key, value] of new URL(c.req.url).searchParams) {
    if (Object.hasOwn(input, key)) {
      throw new AuthError('invalid_payload', 422, { path: `devices.${key}` });
    }
    input[key] = value;
  }
  return input;
}

function handle(c: AppContext, run: () => Promise<Response>): Promise<Response> {
  return run().catch((error: unknown) => {
    if (error instanceof AuthError) return authErrorResponse(c, error);
    if (error instanceof ContractParseError) {
      return authErrorResponse(
        c,
        new AuthError('invalid_payload', 422, { path: error.first.path }),
      );
    }
    throw error;
  });
}

function requireDevice(c: AppContext): { readonly id: string; readonly scopes: readonly Scope[] } {
  const device = authenticatedDevice(c);
  if (device === null) throw new AuthError('unauthorized', 401, { reason: 'unauthorized' });
  return device;
}

function requireIssuer(
  c: AppContext,
  service: AuthService,
  options: RegisterAuthRoutesOptions,
): void {
  if (options.isLoopback(c)) return;
  let scopes: readonly Scope[];
  try {
    scopes = authenticateRequest(c, service).scopes;
  } catch (error) {
    if (error instanceof AuthError) {
      throw new AuthError('forbidden', 403, { reason: 'loopback_required' });
    }
    throw error;
  }
  if (!hasScope(scopes, 'admin')) {
    throw new AuthError('forbidden', 403, { reason: 'loopback_required' });
  }
}

export function registerAuthRoutes(
  app: DaemonApp,
  service: AuthService,
  options: RegisterAuthRoutesOptions,
): void {
  app.use(`${API_PREFIX}/*`, createAuthMiddleware(service));

  app.post(`${API_PREFIX}/pair/code`, (c) =>
    handle(c, async () => {
      enforceRateLimit(c, options.rateLimit);
      requireIssuer(c, service, options);
      const body = parseOrThrow(pairCodeSchema, await readJson(c), 'pair/code');
      const issued = await service.issueCode({
        name: body.name,
        ...(body.ttlSeconds === undefined ? {} : { ttlSeconds: body.ttlSeconds }),
        ...(body.scopes === undefined ? {} : { scopes: body.scopes }),
      });
      return json(c, issued, 201);
    }),
  );

  app.post(`${API_PREFIX}/pair`, (c) =>
    handle(c, async () => {
      enforceRateLimit(c, options.rateLimit);
      const body = parseOrThrow(pairSchema, await readJson(c), 'pair');
      const input: PairExchangeInput = body;
      const result = await service.exchange(input, rateLimitSource(c));
      return json(c, result, 200);
    }),
  );

  app.post(`${API_PREFIX}/auth/refresh`, (c) =>
    handle(c, async () => {
      const body = parseOrThrow(refreshSchema, await readJson(c), 'auth/refresh');
      const tokens = await service.refresh({ refreshToken: body.refreshToken });
      return json(c, tokens, 200);
    }),
  );

  app.post(`${API_PREFIX}/auth/logout`, (c) =>
    handle(c, async () => {
      const device = requireDevice(c);
      service.logout(device.id);
      return c.body(null, 204);
    }),
  );

  app.get(`${API_PREFIX}/me`, (c) =>
    handle(c, async () => {
      const device = requireDevice(c);
      const row: Device | null = options.store.devices.get(device.id);
      if (row === null) throw new AuthError('unauthorized', 401, { reason: 'unauthorized' });
      const me: Me = {
        device: row,
        scopes: [...row.scopes],
        serverTime: options.now().toISOString(),
      };
      return json(c, me, 200);
    }),
  );

  app.get(`${API_PREFIX}/devices`, (c) =>
    handle(c, async () => {
      const query = parseOrThrow(listDevicesQuerySchema, queryInput(c), 'devices');
      const page = options.store.devices.list({ limit: query.limit, cursor: query.cursor ?? null });
      return json(c, page, 200);
    }),
  );

  app.delete(`${API_PREFIX}/devices/:id`, (c) =>
    handle(c, async () => {
      const id = c.req.param('id');
      if (options.store.devices.get(id) === null) {
        throw new AuthError('not_found', 404, { path: c.req.path });
      }
      service.logout(id);
      return c.body(null, 204);
    }),
  );
}

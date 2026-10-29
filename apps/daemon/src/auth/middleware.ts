import type { Context, MiddlewareHandler } from 'hono';
import type { Scope } from '@codebox/contracts';
import { hasScope } from '@codebox/security';
import { API_PREFIX } from '../app.js';
import type { AppVariables } from '../modules.js';
import { AuthError, authErrorResponse } from './errors.js';
import type { AuthService, AuthenticatedDevice } from './service.js';

export const PAIRING_RATE_LIMIT = 10;
export const PAIRING_RATE_WINDOW_SECONDS = 3600;
export const API_RATE_LIMIT = 120;
export const API_RATE_WINDOW_SECONDS = 60;
export const WORK_RATE_LIMIT = 10;
export const WORK_RATE_WINDOW_SECONDS = 60;

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  take(key: string): RateLimitDecision;
}

export interface RateLimiterOptions {
  readonly limit: number;
  readonly windowSeconds: number;
  readonly now: () => Date;
}

export interface ApiRateLimiters {
  readonly api: RateLimiter;
  readonly work: RateLimiter;
}

/** A rolling window per key, in memory: a restart resets every counter. */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const windowMs = options.windowSeconds * 1000;
  const hits = new Map<string, number[]>();
  return {
    take(key: string): RateLimitDecision {
      const at = options.now().getTime();
      const recent = (hits.get(key) ?? []).filter((hit) => hit > at - windowMs);
      if (recent.length >= options.limit) {
        hits.set(key, recent);
        const oldest = recent[0] ?? at;
        const waitMs = oldest + windowMs - at;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
      }
      recent.push(at);
      hits.set(key, recent);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

/** One pair per process: every authenticated `/v1` request, and the run-creating routes twice. */
export function createApiRateLimiters(options: { readonly now: () => Date }): ApiRateLimiters {
  return {
    api: createRateLimiter({
      limit: API_RATE_LIMIT,
      windowSeconds: API_RATE_WINDOW_SECONDS,
      now: options.now,
    }),
    work: createRateLimiter({
      limit: WORK_RATE_LIMIT,
      windowSeconds: WORK_RATE_WINDOW_SECONDS,
      now: options.now,
    }),
  };
}

interface NodeRequestEnv {
  readonly incoming?: { readonly socket?: { readonly remoteAddress?: unknown } };
}

export function remoteAddress(c: Context): string | null {
  const env: unknown = c.env;
  if (typeof env !== 'object' || env === null) return null;
  const incoming = (env as NodeRequestEnv).incoming;
  if (typeof incoming !== 'object' || incoming === null) return null;
  const socket = incoming.socket;
  if (typeof socket !== 'object' || socket === null) return null;
  const address = socket.remoteAddress;
  return typeof address === 'string' ? address : null;
}

const LOOPBACK_ADDRESSES: readonly string[] = Object.freeze([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
]);

/** docs/api.md §2: only these three sources may mint a pairing code without a bearer. */
export function isLoopbackRequest(c: Context): boolean {
  const address = remoteAddress(c);
  return address !== null && LOOPBACK_ADDRESSES.includes(address);
}

export function rateLimitSource(c: Context): string {
  return remoteAddress(c) ?? 'unknown';
}

const BEARER = /^Bearer ([^\s]+)$/;

/** `Authorization` must be exactly `Bearer <one token>`; anything else is no token at all. */
export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  return BEARER.exec(header)?.[1] ?? null;
}

const PUBLIC_ROUTES: readonly string[] = Object.freeze([
  `GET ${API_PREFIX}/health`,
  `GET ${API_PREFIX}/version`,
  `POST ${API_PREFIX}/pair`,
  `POST ${API_PREFIX}/pair/code`,
  `POST ${API_PREFIX}/auth/refresh`,
]);

export function isPublicRoute(method: string, path: string): boolean {
  return PUBLIC_ROUTES.includes(`${method} ${path}`);
}

const NO_SCOPE_PATHS: readonly string[] = Object.freeze([
  `${API_PREFIX}/me`,
  `${API_PREFIX}/auth/logout`,
]);

const DEVICE_PATH = new RegExp(`^${API_PREFIX}/devices/[^/]+$`);

// `POST /v1/routines/{id}/run` is not served yet: the predicate is forward-looking so a new
// run-creating route cannot ship without the tighter budget.
const WORK_ROUTES: readonly RegExp[] = Object.freeze([
  new RegExp(`^${API_PREFIX}/runs$`),
  new RegExp(`^${API_PREFIX}/jobs/[^/]+/run$`),
  new RegExp(`^${API_PREFIX}/routines/[^/]+/run$`),
]);

export function isWorkRoute(method: string, path: string): boolean {
  if (method !== 'POST') return false;
  return WORK_ROUTES.some((pattern) => pattern.test(path));
}

/** docs/api.md §2: reads need `read`, revoking another device needs `admin`. */
export function requiredScope(method: string, path: string): Scope | null {
  if (NO_SCOPE_PATHS.includes(path)) return null;
  if (method === 'GET') return 'read';
  if (method === 'DELETE' && DEVICE_PATH.test(path)) return 'admin';
  return null;
}

export function authenticateRequest(c: Context, service: AuthService): AuthenticatedDevice {
  const token = bearerToken(c.req.header('authorization'));
  if (token === null) throw new AuthError('unauthorized', 401, { reason: 'unauthorized' });
  const device = service.authenticate(token);
  if (device === null) throw new AuthError('unauthorized', 401, { reason: 'unauthorized' });
  return device;
}

// Hono variables cannot grow here (`AppVariables` belongs to the module seam), so the device
// resolved by the middleware travels beside the context instead of being parsed twice.
const AUTHENTICATED = new WeakMap<object, AuthenticatedDevice>();

export function authenticatedDevice(c: Context): AuthenticatedDevice | null {
  return AUTHENTICATED.get(c) ?? null;
}

export function createAuthMiddleware(
  service: AuthService,
  limiters?: ApiRateLimiters,
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    if (isPublicRoute(c.req.method, c.req.path)) {
      await next();
      return;
    }
    let device: AuthenticatedDevice;
    try {
      device = authenticateRequest(c, service);
      const required = requiredScope(c.req.method, c.req.path);
      if (required !== null && !hasScope(device.scopes, required)) {
        throw new AuthError('forbidden', 403, { reason: 'insufficient_scope' });
      }
      if (limiters !== undefined) takeDeviceBudget(limiters, device.id, c.req.method, c.req.path);
    } catch (error) {
      if (error instanceof AuthError) return authErrorResponse(c, error);
      throw error;
    }
    AUTHENTICATED.set(c, device);
    await next();
  };
}

/** A work route is counted in `work` only, so it never spends the general budget twice. */
function takeDeviceBudget(
  limiters: ApiRateLimiters,
  deviceId: string,
  method: string,
  path: string,
): void {
  const limiter = isWorkRoute(method, path) ? limiters.work : limiters.api;
  const decision = limiter.take(`device:${deviceId}`);
  if (!decision.allowed) {
    throw new AuthError('rate_limited', 429, { retryAfter: decision.retryAfterSeconds });
  }
}

export function enforceRateLimit(c: Context, limiter: RateLimiter): void {
  const decision = limiter.take(rateLimitSource(c));
  if (!decision.allowed) {
    throw new AuthError('rate_limited', 429, { retryAfter: decision.retryAfterSeconds });
  }
}

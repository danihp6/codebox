import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { ERROR_STATUS, ID_PREFIXES, RequestId, parseVersion } from '@codebox/contracts';
import type { ErrorCode, Health } from '@codebox/contracts';
import type { AppVariables, DaemonApp, DaemonContext } from './modules.js';
import { collectHealth, createProbes } from './health.js';
import type { HealthProbes } from './health.js';
import { createStaticHandler } from './static.js';

export const API_PREFIX = '/v1';
export const REQUEST_ID_HEADER = 'x-request-id';
export const MAX_REQUEST_BYTES = 1_048_576;
export const BODY_TOO_LARGE_PATH = 'request.body';
export const ORIGIN_REFUSAL_REASON = 'origin';

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
});

export interface CreateAppOptions {
  readonly context: DaemonContext;
  readonly probes?: HealthProbes;
}

type AppContext = Context<{ Variables: AppVariables }>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const JSON_HEADERS = { 'Content-Type': JSON_CONTENT_TYPE } as const;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const REQUEST_ID_TIME_CHARS = 10;
const REQUEST_ID_RANDOM_CHARS = 16;
const REQUEST_ID_RANDOM_BYTES = 10;
const NUMERIC_HEADER = /^\d+$/;
const ORIGIN_TRAILING_SLASHES = /\/+$/;

/** docs/api.md §3: ERROR_STATUS is typed as a plain number, every value is a valid status. */
type HttpStatus = 200 | 201 | 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503;

function statusFor(code: ErrorCode): HttpStatus {
  return ERROR_STATUS[code] as HttpStatus;
}

export function newRequestId(): string {
  let time = Date.now();
  const timeChars: string[] = [];
  for (let index = 0; index < REQUEST_ID_TIME_CHARS; index += 1) {
    timeChars.unshift(CROCKFORD[time % 32] ?? '0');
    time = Math.floor(time / 32);
  }
  let random = 0n;
  for (const byte of randomBytes(REQUEST_ID_RANDOM_BYTES)) {
    random = (random << 8n) | BigInt(byte);
  }
  const randomChars: string[] = [];
  for (let index = 0; index < REQUEST_ID_RANDOM_CHARS; index += 1) {
    randomChars.unshift(CROCKFORD[Number(random & 31n)] ?? '0');
    random >>= 5n;
  }
  return `${ID_PREFIXES.request}${timeChars.join('')}${randomChars.join('')}`;
}

export function errorBody(input: {
  readonly code: ErrorCode;
  readonly message: string;
  readonly requestId: string;
  readonly details?: Record<string, unknown>;
}): {
  error: { code: ErrorCode; message: string; requestId: string; details?: Record<string, unknown> };
} {
  const error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  } = { code: input.code, message: input.message, requestId: input.requestId };
  if (input.details !== undefined) error.details = input.details;
  return { error };
}

export function originAllowed(origin: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  const candidate = normaliseOrigin(origin);
  return allowed.some((entry) => normaliseOrigin(entry) === candidate);
}

function normaliseOrigin(value: string): string {
  return value.toLowerCase().replace(ORIGIN_TRAILING_SLASHES, '');
}

export function createApp(options: CreateAppOptions): DaemonApp {
  const { context } = options;
  const probes = options.probes ?? createProbes(context);
  const logger = context.logger;
  const serveStatic = createStaticHandler({ root: context.appDir });
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('*', async (c, next) => {
    const inbound = c.req.header(REQUEST_ID_HEADER);
    const requestId = inbound === undefined ? newRequestId() : parseRequestId(inbound);
    c.set('requestId', requestId);
    c.header(REQUEST_ID_HEADER, requestId);
    const startedAt = Date.now();
    await next();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!c.res.headers.has(name)) c.header(name, value);
    }
    logger.info({
      msg: 'request',
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
  });

  // Request controls land before any route: a refused origin or an oversized body must never
  // reach a handler, and the hosted app is not origin-checked at all.
  app.use('*', async (c, next) => {
    if (!isApiPath(c.req.path)) {
      await next();
      return;
    }
    const origin = c.req.header('origin');
    if (origin !== undefined && !originAllowed(origin, context.config.CB_ALLOWED_ORIGINS)) {
      return refusedOrigin(c);
    }
    if (declaredLength(c) > MAX_REQUEST_BYTES) return bodyTooLarge(c);
    await next();
  });

  app.get(`${API_PREFIX}/health`, async (c): Promise<Response> => {
    const health: Health = await collectHealth(probes, context.build.version);
    return json(c, health, health.status === 'down' ? 503 : 200);
  });

  app.get(`${API_PREFIX}/version`, (c): Response =>
    json(
      c,
      parseVersion({
        version: context.build.version,
        commit: context.build.commit,
        builtAt: context.build.builtAt,
        node: process.version,
      }),
      200,
    ),
  );

  app.get('*', async (c, next): Promise<Response | void> => {
    const requestPath = c.req.path;
    if (isApiPath(requestPath)) {
      // A subsystem module registers its routes after this catch-all, so an API path has to
      // fall through; an unmatched one still ends in `app.notFound`, never in `index.html`.
      await next();
      return;
    }
    // Hono and node-server normalise the target before any route runs, so the raw target is
    // the only place a dot-segment is still visible; the SPA fallback must never answer it.
    if (hasDotSegment(rawRequestTarget(c))) return notFound(c, requestPath);
    const hit = await serveStatic(requestPath);
    if (hit.kind === 'file') {
      return c.body(new Uint8Array(hit.body), 200, { 'Content-Type': hit.contentType });
    }
    if (hit.kind === 'not_built') {
      return notFound(c, requestPath, { reason: 'app_not_built' });
    }
    return notFound(c, requestPath);
  });

  app.notFound((c): Response => notFound(c, c.req.path));

  app.onError((error, c): Response => {
    const requestId = requestIdOf(c);
    logger.error({ msg: 'request_failed', requestId, err: error });
    return c.json(
      errorBody({ code: 'internal', message: 'Internal error', requestId }),
      statusFor('internal'),
      JSON_HEADERS,
    );
  });

  return app;
}

function json(c: AppContext, body: unknown, status: HttpStatus): Response {
  return c.json(body, status, JSON_HEADERS);
}

function declaredLength(c: AppContext): number {
  const declared = c.req.header('content-length');
  if (declared === undefined || !NUMERIC_HEADER.test(declared)) return 0;
  return Number(declared);
}

function refusedOrigin(c: AppContext): Response {
  return json(
    c,
    errorBody({
      code: 'forbidden',
      message: 'Forbidden',
      requestId: requestIdOf(c),
      details: { reason: ORIGIN_REFUSAL_REASON },
    }),
    statusFor('forbidden'),
  );
}

function bodyTooLarge(c: AppContext): Response {
  return json(
    c,
    errorBody({
      code: 'bad_request',
      message: 'Bad request',
      requestId: requestIdOf(c),
      details: { limitBytes: MAX_REQUEST_BYTES, path: BODY_TOO_LARGE_PATH },
    }),
    statusFor('bad_request'),
  );
}

function notFound(c: AppContext, requestPath: string, extra?: Record<string, unknown>): Response {
  return json(
    c,
    errorBody({
      code: 'not_found',
      message: 'Not found',
      requestId: requestIdOf(c),
      details: extra === undefined ? { path: requestPath } : { path: requestPath, ...extra },
    }),
    statusFor('not_found'),
  );
}

function isApiPath(requestPath: string): boolean {
  return requestPath === API_PREFIX || requestPath.startsWith(`${API_PREFIX}/`);
}

interface NodeRequestEnv {
  readonly incoming?: { readonly url?: unknown };
}

/**
 * The unnormalised request target. `@hono/node-server` keeps it on the raw `IncomingMessage`
 * and collapses dot-segments and percent-encoding on the `Request` it builds, so `c.req.url`
 * is only the fallback for transports that never normalise.
 */
function rawRequestTarget(c: AppContext): string {
  const env: unknown = c.env;
  if (typeof env === 'object' && env !== null) {
    const incoming = (env as NodeRequestEnv).incoming;
    if (typeof incoming === 'object' && incoming !== null && typeof incoming.url === 'string') {
      return incoming.url;
    }
  }
  return c.req.url;
}

const TARGET_END = /[?#]/;
const TARGET_SEPARATOR = /[\\/]+/;

function hasDotSegment(target: string): boolean {
  const end = target.search(TARGET_END);
  const path = end === -1 ? target : target.slice(0, end);
  for (const segment of path.split(TARGET_SEPARATOR)) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return true;
    }
    if (decoded === '..') return true;
  }
  return false;
}

function requestIdOf(c: AppContext): string {
  const value: unknown = c.get('requestId');
  if (typeof value === 'string') {
    const parsed = RequestId.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  return newRequestId();
}

function parseRequestId(value: string): string {
  const parsed = RequestId.safeParse(value);
  return parsed.success ? parsed.data : newRequestId();
}

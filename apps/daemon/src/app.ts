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
    logger.info({
      msg: 'request',
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
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

  app.get('*', async (c): Promise<Response> => {
    const requestPath = c.req.path;
    if (isApiPath(requestPath)) return notFound(c, requestPath);
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

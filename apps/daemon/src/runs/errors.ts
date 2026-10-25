import type { Context } from 'hono';
import { ContractParseError } from '@codebox/contracts';
import type { ErrorCode, Scope } from '@codebox/contracts';
import { hasScope } from '@codebox/security';
import { StoreError } from '@codebox/store';
import { errorBody } from '../app.js';
import { AuthError, authenticatedDevice } from '../auth/index.js';
import type { AuthenticatedDevice } from '../auth/index.js';
import type { AppVariables } from '../modules.js';

/** The six statuses a domain refusal may carry, docs/api.md §3. */
export type RunApiStatus = 400 | 404 | 409 | 422 | 502 | 503;

export type AppContext = Context<{ Variables: AppVariables }>;

const MESSAGES: Readonly<Record<ErrorCode, string>> = Object.freeze({
  bad_request: 'Bad request',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  not_found: 'Not found',
  conflict: 'Conflict',
  idempotency_mismatch: 'Idempotency key reused with a different body',
  validation_failed: 'Invalid request',
  repo_not_allowed: 'Repository not allowed',
  rate_limited: 'Too many requests',
  agent_unavailable: 'The agent is unavailable',
  provider_unavailable: 'The provider is unavailable',
  internal: 'Internal error',
});

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

/** docs/api.md §3: the code decides the meaning, `details.reason` carries the machine token. */
export class RunApiError extends Error {
  readonly code: ErrorCode;
  readonly status: RunApiStatus;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, status: RunApiStatus, details?: Record<string, unknown>) {
    super(MESSAGES[code]);
    this.name = 'RunApiError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

export function runApiErrorResponse(c: AppContext, error: RunApiError): Response {
  const body = errorBody({
    code: error.code,
    message: error.message,
    requestId: c.get('requestId'),
    ...(error.details === undefined ? {} : { details: error.details }),
  });
  return c.json(body, error.status, JSON_HEADERS);
}

export function json(c: AppContext, body: unknown, status: 200 | 201 | 202): Response {
  return c.json(body, status, JSON_HEADERS);
}

/**
 * `authErrorResponse` is private to the auth subsystem, so the two refusals a route can raise
 * are mapped here with the same body and headers; the envelope never differs by route.
 */
export function authRefusalResponse(c: AppContext, error: AuthError): Response {
  const code: ErrorCode = error.status === 401 ? 'unauthorized' : 'forbidden';
  const body = errorBody({
    code,
    message: error.message,
    requestId: c.get('requestId'),
    ...(error.details === undefined ? {} : { details: error.details }),
  });
  return c.json(body, error.status, JSON_HEADERS);
}

export async function readJson(c: AppContext): Promise<unknown> {
  const text = await c.req.text();
  return parseJsonText(text);
}

/** A route whose body is entirely optional (`{ title?: string }`) reads an empty body as `{}`. */
export async function readJsonOrEmpty(c: AppContext): Promise<unknown> {
  const text = await c.req.text();
  return text.trim() === '' ? {} : parseJsonText(text);
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new RunApiError('bad_request', 400, { path: 'body' });
  }
}

/** The raw query as strings; a repeated key is a client bug, not something to resolve silently. */
export function queryInput(c: AppContext, area: string): Record<string, string> {
  const input: Record<string, string> = {};
  for (const [key, value] of new URL(c.req.url).searchParams) {
    if (Object.hasOwn(input, key)) {
      throw new RunApiError('validation_failed', 422, { path: `${area}.${key}` });
    }
    input[key] = value;
  }
  return input;
}

/**
 * A mutating route owns its scope: the middleware covers `read` on GET, everything else is
 * checked here. The refusal reuses `AuthError` so the 403 body is the same envelope the
 * middleware emits.
 */
export function requireScope(c: AppContext, scope: Scope): AuthenticatedDevice {
  const device = authenticatedDevice(c);
  if (device === null) throw new AuthError('unauthorized', 401, { reason: 'unauthorized' });
  if (!hasScope(device.scopes, scope)) {
    throw new AuthError('forbidden', 403, { reason: 'insufficient_scope' });
  }
  return device;
}

/**
 * The one wrapper every route uses: a `RunApiError`, a schema failure and a repository failure
 * become the §3 envelope; anything else keeps travelling to `app.onError`.
 */
export function handle(
  c: AppContext,
  area: string,
  run: () => Promise<Response> | Response,
): Promise<Response> {
  return Promise.resolve()
    .then(run)
    .catch((error: unknown): Response => {
      if (error instanceof RunApiError) return runApiErrorResponse(c, error);
      if (error instanceof ContractParseError) {
        return runApiErrorResponse(
          c,
          new RunApiError('validation_failed', 422, { path: error.first.path }),
        );
      }
      if (error instanceof AuthError) return authRefusalResponse(c, error);
      if (error instanceof StoreError) {
        const mapped = storeFailure(error, area);
        if (mapped !== null) return runApiErrorResponse(c, mapped);
      }
      throw error;
    });
}

function storeFailure(error: StoreError, area: string): RunApiError | null {
  switch (error.code) {
    case 'not_found':
      return new RunApiError('not_found', 404, { path: `${area}.id` });
    case 'unique_violation':
      return new RunApiError('conflict', 409, { reason: 'unique_violation' });
    case 'invalid_row':
      return new RunApiError('validation_failed', 422, {
        path: error.message.includes('cursor') ? `${area}.cursor` : `${area}.row`,
      });
    default:
      return null;
  }
}

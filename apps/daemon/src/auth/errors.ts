import type { Context } from 'hono';
import type { ErrorCode } from '@codebox/contracts';
import { errorBody } from '../app.js';
import type { AppVariables } from '../modules.js';

export type AuthFailureReason =
  | 'unknown_code'
  | 'expired_code'
  | 'used_code'
  | 'rate_limited'
  | 'invalid_payload'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found';

export type AuthFailureStatus = 400 | 401 | 403 | 404 | 422 | 429;

const MESSAGES: Readonly<Record<AuthFailureReason, string>> = Object.freeze({
  unknown_code: 'Unknown pairing code',
  expired_code: 'Expired pairing code',
  used_code: 'Pairing code already used',
  rate_limited: 'Too many requests',
  invalid_payload: 'Invalid request body',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  not_found: 'Not found',
});

/** docs/api.md §3: the status always selects one of the published error codes. */
const CODE_BY_STATUS: Readonly<Record<AuthFailureStatus, ErrorCode>> = Object.freeze({
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  422: 'validation_failed',
  429: 'rate_limited',
});

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

export class AuthError extends Error {
  readonly reason: AuthFailureReason;
  readonly status: AuthFailureStatus;
  readonly details?: Record<string, unknown>;

  constructor(
    reason: AuthFailureReason,
    status: AuthFailureStatus,
    details?: Record<string, unknown>,
  ) {
    super(MESSAGES[reason]);
    this.name = 'AuthError';
    this.reason = reason;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

type AuthContext = Context<{ Variables: AppVariables }>;

export function authErrorResponse(c: AuthContext, error: AuthError): Response {
  const headers: Record<string, string> = { ...JSON_HEADERS };
  const retryAfter = error.details?.['retryAfter'];
  if (error.status === 429 && typeof retryAfter === 'number') {
    headers['Retry-After'] = String(retryAfter);
  }
  const body = errorBody({
    code: CODE_BY_STATUS[error.status],
    message: error.message,
    requestId: c.get('requestId'),
    ...(error.details === undefined ? {} : { details: error.details }),
  });
  return c.json(body, error.status, headers);
}

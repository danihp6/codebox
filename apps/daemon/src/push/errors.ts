import type { Context } from 'hono';
import type { ErrorCode } from '@codebox/contracts';
import { errorBody } from '../app.js';
import type { AppVariables } from '../modules.js';

export type PushFailureReason =
  'not_found' | 'invalid_payload' | 'unauthorized' | 'insufficient_scope' | 'invalid_config';

export type PushFailureStatus = 401 | 403 | 404 | 422 | 503;

/** Fixed English messages, never built from a value: a reason carries its own status. */
const MESSAGES: Readonly<Record<PushFailureReason, string>> = Object.freeze({
  not_found: 'Not found',
  invalid_payload: 'Invalid request',
  unauthorized: 'Unauthorized',
  insufficient_scope: 'Forbidden',
  invalid_config: 'Push is not configured',
});

/** docs/api.md §3: the status always selects one of the published error codes. */
const CODE_BY_STATUS: Readonly<Record<PushFailureStatus, ErrorCode>> = Object.freeze({
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  422: 'validation_failed',
  503: 'provider_unavailable',
});

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

export class PushError extends Error {
  readonly reason: PushFailureReason;
  readonly status: PushFailureStatus;
  readonly details?: Record<string, unknown>;

  constructor(
    reason: PushFailureReason,
    status: PushFailureStatus,
    details?: Record<string, unknown>,
  ) {
    super(MESSAGES[reason]);
    this.name = 'PushError';
    this.reason = reason;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

type PushContext = Context<{ Variables: AppVariables }>;

export function pushErrorResponse(c: PushContext, error: PushError): Response {
  const body = errorBody({
    code: CODE_BY_STATUS[error.status],
    message: error.message,
    requestId: c.get('requestId'),
    ...(error.details === undefined ? {} : { details: error.details }),
  });
  return c.json(body, error.status, { ...JSON_HEADERS });
}

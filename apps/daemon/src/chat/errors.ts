import type { Context } from 'hono';
import type { ErrorCode } from '@codebox/contracts';
import { errorBody } from '../app.js';
import type { AppVariables } from '../modules.js';

export type ChatFailureReason =
  | 'not_found'
  | 'unauthorized'
  | 'insufficient_scope'
  | 'chat_archived'
  | 'chat_already_bound'
  | 'chat_not_working'
  | 'invalid_payload'
  | 'agent_unavailable'
  | 'workspace_unavailable';

export type ChatFailureStatus = 400 | 401 | 403 | 404 | 409 | 422 | 502 | 503;

/**
 * Fixed English messages, never built from a value: a reason carries the status, the code comes
 * from the table below, so a client switch never grows with a domain refusal.
 */
const MESSAGES: Readonly<Record<ChatFailureReason, string>> = Object.freeze({
  not_found: 'Not found',
  unauthorized: 'Unauthorized',
  insufficient_scope: 'Forbidden',
  chat_archived: 'The chat session is archived',
  chat_already_bound: 'The chat session is already bound to a repository',
  chat_not_working: 'The chat session is not working',
  invalid_payload: 'Invalid request',
  agent_unavailable: 'The agent was unavailable',
  workspace_unavailable: 'The workspace was unavailable',
});

/** docs/api.md §3: the status always selects one of the published error codes. */
const CODE_BY_STATUS: Readonly<Record<ChatFailureStatus, ErrorCode>> = Object.freeze({
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'validation_failed',
  502: 'agent_unavailable',
  503: 'provider_unavailable',
});

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

export class ChatError extends Error {
  readonly reason: ChatFailureReason;
  readonly status: ChatFailureStatus;
  readonly details?: Record<string, unknown>;

  constructor(
    reason: ChatFailureReason,
    status: ChatFailureStatus,
    details?: Record<string, unknown>,
  ) {
    super(MESSAGES[reason]);
    this.name = 'ChatError';
    this.reason = reason;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

type ChatContext = Context<{ Variables: AppVariables }>;

export function chatErrorResponse(c: ChatContext, error: ChatError): Response {
  const body = errorBody({
    code: CODE_BY_STATUS[error.status],
    message: error.message,
    requestId: c.get('requestId'),
    ...(error.details === undefined ? {} : { details: error.details }),
  });
  return c.json(body, error.status, { ...JSON_HEADERS });
}

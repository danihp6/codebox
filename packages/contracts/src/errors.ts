import { z } from 'zod';
import { parseOrThrow } from './parse.js';
import { RequestId } from './primitives.js';

export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'idempotency_mismatch',
  'validation_failed',
  'repo_not_allowed',
  'rate_limited',
  'agent_unavailable',
  'provider_unavailable',
  'internal',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** docs/api.md §3, verbatim: one status per code. */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  idempotency_mismatch: 409,
  validation_failed: 422,
  repo_not_allowed: 422,
  rate_limited: 429,
  agent_unavailable: 502,
  provider_unavailable: 503,
  internal: 500,
});

export const apiErrorSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
  requestId: RequestId,
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const errorEnvelopeSchema = z.strictObject({ error: apiErrorSchema });
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export function parseErrorEnvelope(input: unknown): ErrorEnvelope {
  return parseOrThrow(errorEnvelopeSchema, input, 'errorEnvelope');
}

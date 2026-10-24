import { describe, expect, it } from 'vitest';
import { ContractParseError } from './parse.js';
import {
  ERROR_CODES,
  ERROR_STATUS,
  apiErrorSchema,
  errorCodeSchema,
  errorEnvelopeSchema,
  parseErrorEnvelope,
} from './errors.js';

const requestId = 'req_01JABCDEFG';

describe('errors', () => {
  it('maps every documented code to its status', () => {
    expect([...ERROR_CODES]).toEqual([
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
    ]);
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort());
    expect(ERROR_STATUS.conflict).toBe(409);
    expect(ERROR_STATUS.idempotency_mismatch).toBe(409);
    expect(ERROR_STATUS.validation_failed).toBe(422);
    expect(ERROR_STATUS.repo_not_allowed).toBe(422);
    expect(ERROR_STATUS.rate_limited).toBe(429);
    expect(ERROR_STATUS.agent_unavailable).toBe(502);
    expect(ERROR_STATUS.provider_unavailable).toBe(503);
    expect(ERROR_STATUS.internal).toBe(500);
    expect(errorCodeSchema.safeParse('protected_path').success).toBe(false);
  });

  it('parses the envelope and keeps the machine token in details.reason', () => {
    const envelope = {
      error: {
        code: 'conflict',
        message: 'The merge is atomic.',
        details: { reason: 'run_not_cancellable' },
        requestId,
      },
    };
    expect(parseErrorEnvelope(envelope)).toEqual(envelope);
    expect(errorEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(apiErrorSchema.safeParse(envelope.error).success).toBe(true);
  });

  it('rejects an unknown code and an unknown field', () => {
    const unknownCode = { error: { code: 'teapot', message: 'x', requestId } };
    const unknownField = { error: { code: 'conflict', message: 'x', requestId, secret: 'x' } };
    expect(errorEnvelopeSchema.safeParse(unknownCode).success).toBe(false);
    expect(errorEnvelopeSchema.safeParse(unknownField).success).toBe(false);
  });

  it('names the failing field when the envelope is invalid', () => {
    const error = (() => {
      try {
        parseErrorEnvelope({ error: { code: 'conflict', message: '', requestId } });
        return null;
      } catch (thrown) {
        return thrown;
      }
    })();
    expect(error).toBeInstanceOf(ContractParseError);
    if (error instanceof ContractParseError) {
      expect(error.boundary).toBe('errorEnvelope');
      expect(error.first.path).toBe('errorEnvelope.error.message');
      expect(error.first.code).toBe('too_small');
    }
  });
});

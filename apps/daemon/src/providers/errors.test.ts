import { describe, expect, it } from 'vitest';
import { RunApiError } from '../runs/errors.js';
import { PROVIDER_EXHAUSTED, ProviderExhaustedError, providerExhaustedApiError } from './errors.js';

describe('ProviderExhaustedError', () => {
  it('carries the bare run code and the retry instant', () => {
    const error = new ProviderExhaustedError('opencode-go', '2026-10-28T15:00:00.000Z');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(PROVIDER_EXHAUSTED);
    expect(error.providerId).toBe('opencode-go');
    expect(error.retryAt).toBe('2026-10-28T15:00:00.000Z');
  });

  it('keeps a null retry instant', () => {
    expect(new ProviderExhaustedError('openai', null).retryAt).toBeNull();
  });
});

describe('providerExhaustedApiError', () => {
  it('maps exhaustion to the documented 503 without a new contract code', () => {
    const error = providerExhaustedApiError(
      new ProviderExhaustedError('opencode-go', '2026-10-28T15:00:00.000Z'),
    );
    expect(error).toBeInstanceOf(RunApiError);
    expect(error.status).toBe(503);
    expect(error.code).toBe('provider_unavailable');
    expect(error.details).toEqual({
      reason: 'provider_exhausted',
      retryAt: '2026-10-28T15:00:00.000Z',
    });
    expect(error.message).toBe('The provider is unavailable');
  });

  it('carries retryAt: null when there is no instant', () => {
    const error = providerExhaustedApiError(new ProviderExhaustedError('anthropic', null));
    expect(error.details).toEqual({ reason: 'provider_exhausted', retryAt: null });
  });
});

import { RunApiError } from '../runs/errors.js';

/** The D54 failure code. A run/fire code, **not** a contract `ErrorCode`. */
export const PROVIDER_EXHAUSTED = 'provider_exhausted' as const;
export type ProviderExhaustedCode = typeof PROVIDER_EXHAUSTED;

/** Thrown when a provider has no usable account. `retryAt` is informational. */
export class ProviderExhaustedError extends Error {
  readonly code: ProviderExhaustedCode;
  readonly providerId: string;
  readonly retryAt: string | null;

  constructor(providerId: string, retryAt: string | null) {
    super(`provider ${providerId} has no usable account`);
    this.name = 'ProviderExhaustedError';
    this.code = PROVIDER_EXHAUSTED;
    this.providerId = providerId;
    this.retryAt = retryAt;
  }
}

/**
 * The one HTTP mapping, without adding to `packages/contracts/src/errors.ts`:
 * `new RunApiError('provider_unavailable', 503, { reason: 'provider_exhausted', retryAt })`,
 * whose message is the frozen `MESSAGES.provider_unavailable` text.
 */
export function providerExhaustedApiError(error: ProviderExhaustedError): RunApiError {
  return new RunApiError('provider_unavailable', 503, {
    reason: PROVIDER_EXHAUSTED,
    retryAt: error.retryAt,
  });
}

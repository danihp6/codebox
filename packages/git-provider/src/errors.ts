import type { ErrorCode } from '@codebox/contracts';

export type GitProviderErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'validation_failed'
  | 'conflict';

export class GitProviderError extends Error {
  readonly code: GitProviderErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    code: GitProviderErrorCode,
    message: string,
    status: number | null,
    retryable: boolean,
  ) {
    super(message);
    this.name = 'GitProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const CONTRACT_CODES: Readonly<Record<GitProviderErrorCode, ErrorCode>> = Object.freeze({
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  not_found: 'not_found',
  rate_limited: 'rate_limited',
  provider_unavailable: 'provider_unavailable',
  validation_failed: 'validation_failed',
  conflict: 'conflict',
});

export function toContractErrorCode(code: GitProviderErrorCode): ErrorCode {
  return CONTRACT_CODES[code];
}

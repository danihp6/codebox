import type { ErrorCode } from '@codebox/contracts';

export type AgentErrorCode =
  | 'agent_unavailable'
  | 'stream_lost'
  | 'model_error'
  | 'approval_expired'
  | 'unauthorized'
  | 'protocol'
  | 'cancelled';

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(code: AgentErrorCode, message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function isRetryable(error: AgentError): boolean {
  return error.code === 'agent_unavailable' || error.code === 'stream_lost';
}

export function toContractErrorCode(code: AgentErrorCode): ErrorCode {
  return code === 'agent_unavailable' ? 'agent_unavailable' : 'provider_unavailable';
}

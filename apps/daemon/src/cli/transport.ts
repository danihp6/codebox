import { errorEnvelopeSchema } from '@codebox/contracts';
import type { ErrorEnvelope } from '@codebox/contracts';

export interface CliRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  readonly token?: string | null;
  readonly idempotencyKey?: string;
}

export interface CliResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface CliTransport {
  send(request: CliRequest): Promise<CliResponse>;
}

export type TransportErrorKind = 'unreachable' | 'timeout' | 'bad_response';

export class TransportError extends Error {
  readonly kind: TransportErrorKind;

  constructor(kind: TransportErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TransportError';
    this.kind = kind;
  }
}

export class ApiResponseError extends Error {
  readonly status: number;
  readonly envelope: ErrorEnvelope | null;

  constructor(status: number, envelope: ErrorEnvelope | null) {
    super(
      envelope === null
        ? `request failed with status ${status}`
        : `request failed with status ${status} (${envelope.error.code})`,
    );
    this.name = 'ApiResponseError';
    this.status = status;
    this.envelope = envelope;
  }
}

export interface HttpTransportOptions {
  readonly baseUrl: string;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}

export const DEFAULT_BASE_URL = 'http://127.0.0.1:8787';
export const DEFAULT_TIMEOUT_MS = 10_000;
export const API_PATH_PREFIX = '/v1/';

export function normaliseBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

export function exitCodeForStatus(status: number): 4 | 5 {
  return status === 401 || status === 403 ? 4 : 5;
}

export function decodeErrorEnvelope(input: unknown): ErrorEnvelope | null {
  const parsed = errorEnvelopeSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function apiErrorFrom(response: CliResponse): ApiResponseError {
  return new ApiResponseError(response.status, decodeErrorEnvelope(response.body));
}

export function createHttpTransport(options: HttpTransportOptions): CliTransport {
  const baseUrl = normaliseBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const send = async (request: CliRequest): Promise<CliResponse> => {
    if (!request.path.startsWith(API_PATH_PREFIX)) {
      throw new TransportError('bad_response', `a request path must start with ${API_PATH_PREFIX}`);
    }

    let url: URL;
    try {
      url = new URL(`${baseUrl}${request.path}`);
    } catch (error) {
      throw new TransportError('unreachable', `invalid base URL: ${baseUrl}`, { cause: error });
    }
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const init: RequestInit = {
      method: request.method,
      headers: requestHeaders(request),
      signal: controller.signal,
    };
    if (request.body !== undefined) init.body = JSON.stringify(request.body);

    let response: Response;
    try {
      response = await options.fetch(url.toString(), init);
    } catch (error) {
      throw timedOut
        ? new TransportError('timeout', `no answer within ${timeoutMs} ms`, { cause: error })
        : new TransportError('unreachable', 'the daemon did not answer', { cause: error });
    } finally {
      clearTimeout(timer);
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new TransportError('unreachable', 'the answer could not be read', { cause: error });
    }
    if (text.trim().length === 0) return { status: response.status, body: null };
    try {
      return { status: response.status, body: JSON.parse(text) as unknown };
    } catch (error) {
      throw new TransportError('bad_response', 'the daemon answered with a body that is not JSON', {
        cause: error,
      });
    }
  };

  const transport: CliTransport & { readonly baseUrl: string } = { send, baseUrl };
  return transport;
}

function requestHeaders(request: CliRequest): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (request.body !== undefined) headers['content-type'] = 'application/json';
  if (typeof request.token === 'string' && request.token.length > 0) {
    headers['authorization'] = `Bearer ${request.token}`;
  }
  if (typeof request.idempotencyKey === 'string' && request.idempotencyKey.length > 0) {
    headers['idempotency-key'] = request.idempotencyKey;
  }
  return headers;
}

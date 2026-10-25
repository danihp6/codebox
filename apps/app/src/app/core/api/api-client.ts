import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  ContractParseError,
  errorEnvelopeSchema,
  jobSchema,
  parseDevice,
  parseHealth,
  parseMe,
  parsePage,
  parseVersion,
  runSchema,
  scopeSchema,
} from '@codebox/contracts';
import type {
  Device,
  Health,
  Job,
  Me,
  Page,
  Run,
  RunState,
  Scope,
  Version,
} from '@codebox/contracts';
import { Observable, catchError, map, throwError } from 'rxjs';
import { API_BASE_URL, API_PREFIX } from './http';

export interface ApiConfig {
  readonly baseUrl: string;
}

export interface PairResult {
  readonly device: Device;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly scopes: readonly Scope[];
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly scopes: readonly Scope[];
}

export interface DomainErrorInit {
  readonly message: string;
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | null;

  constructor(init: DomainErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.details = init.details;
  }
}

const SYSTEM_ERROR_CODES: Readonly<Record<number, string>> = Object.freeze({
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'validation_failed',
  429: 'rate_limited',
  500: 'internal',
  502: 'agent_unavailable',
  503: 'provider_unavailable',
});

@Injectable({
  providedIn: 'root',
  useFactory: () => new ApiClient(inject(HttpClient), { baseUrl: API_BASE_URL }),
})
export class ApiClient {
  constructor(
    private readonly http: HttpClient,
    private readonly config: ApiConfig,
  ) {}

  health(): Observable<Health> {
    return this.send(this.http.get<unknown>(this.url('/health')), parseHealth);
  }

  version(): Observable<Version> {
    return this.send(this.http.get<unknown>(this.url('/version')), parseVersion);
  }

  issuePairingCode(body: { name: string; ttlSeconds?: number }): Observable<unknown> {
    return this.send(this.http.post<unknown>(this.url('/pair/code'), body), (input) => input);
  }

  pair(body: {
    code: string;
    deviceName: string;
    platform: 'web' | 'ios' | 'android';
    devicePublicKey: string;
  }): Observable<PairResult> {
    return this.send(this.http.post<unknown>(this.url('/pair'), body), parsePairResult);
  }

  refresh(refreshToken: string): Observable<TokenPair> {
    return this.send(
      this.http.post<unknown>(this.url('/auth/refresh'), { refreshToken }),
      parseTokenPair,
    );
  }

  me(): Observable<Me> {
    return this.send(this.http.get<unknown>(this.url('/me')), parseMe);
  }

  logout(): Observable<void> {
    return this.send(
      this.http.post<unknown>(this.url('/auth/logout'), null),
      (): void => undefined,
    );
  }

  listRuns(query?: { state?: RunState; limit?: number; cursor?: string }): Observable<Page<Run>> {
    const params = this.query({
      state: query?.state,
      limit: query?.limit,
      cursor: query?.cursor,
    });
    return this.send(
      this.http.get<unknown>(this.url('/runs'), { params }),
      (input) => parsePage(runSchema, input, 'runs'),
    );
  }

  listJobs(query?: { limit?: number; cursor?: string }): Observable<Page<Job>> {
    const params = this.query({ limit: query?.limit, cursor: query?.cursor });
    return this.send(
      this.http.get<unknown>(this.url('/jobs'), { params }),
      (input) => parsePage(jobSchema, input, 'jobs'),
    );
  }

  private url(path: string): string {
    return `${this.config.baseUrl}${API_PREFIX}${path}`;
  }

  private query(values: Readonly<Record<string, string | number | undefined>>): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) params = params.set(key, String(value));
    }
    return params;
  }

  private send<T>(request: Observable<unknown>, parse: (input: unknown) => T): Observable<T> {
    return request.pipe(
      map((body) => this.parseBody(body, parse)),
      catchError((error: unknown) => throwError(() => toApiError(error))),
    );
  }

  private parseBody<T>(body: unknown, parse: (input: unknown) => T): T {
    try {
      return parse(body);
    } catch (error) {
      if (error instanceof ContractParseError) {
        throw new ApiError({
          message: error.message,
          status: 200,
          code: 'contract',
          requestId: null,
          details: { boundary: error.boundary, issues: error.issues },
        });
      }
      throw error;
    }
  }
}

export function parsePairResult(input: unknown): PairResult {
  const record = recordOf(input, 'pairResult');
  return {
    device: parseDevice(record['device']),
    accessToken: requiredString(record, 'accessToken'),
    refreshToken: requiredString(record, 'refreshToken'),
    expiresIn: requiredNumber(record, 'expiresIn'),
    scopes: parseScopes(record['scopes']),
  };
}

export function parseTokenPair(input: unknown): TokenPair {
  const record = recordOf(input, 'tokenPair');
  return {
    accessToken: requiredString(record, 'accessToken'),
    refreshToken: requiredString(record, 'refreshToken'),
    expiresIn: requiredNumber(record, 'expiresIn'),
    scopes: parseScopes(record['scopes']),
  };
}

function parseScopes(input: unknown): readonly Scope[] {
  if (!Array.isArray(input)) throw contractIssue('scopes', 'expected an array');
  const scopes: Scope[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const parsed = scopeSchema.safeParse(input[index]);
    if (!parsed.success) throw contractIssue(`scopes.${index}`, 'invalid scope');
    scopes.push(parsed.data);
  }
  return scopes;
}

function recordOf(input: unknown, boundary: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw contractIssue(boundary, 'expected an object');
  }
  return input as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw contractIssue(key, 'expected a non-empty string');
  }
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw contractIssue(key, 'expected a number');
  }
  return value;
}

function contractIssue(path: string, message: string): ContractParseError {
  return new ContractParseError('pairing', [{ path, message, code: 'custom' }]);
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof HttpErrorResponse) {
    const envelope = errorEnvelopeSchema.safeParse(error.error);
    if (envelope.success) {
      const envelopeError = envelope.data.error;
      return new ApiError({
        message: envelopeError.message,
        status: error.status,
        code: envelopeError.code,
        requestId: envelopeError.requestId,
        details: envelopeError.details ?? null,
      });
    }
    return new ApiError({
      message: error.message,
      status: error.status,
      code: SYSTEM_ERROR_CODES[error.status] ?? 'internal',
      requestId: error.headers.get('x-request-id'),
      details: null,
    });
  }
  return new ApiError({
    message: error instanceof Error ? error.message : 'Request failed',
    status: 0,
    code: 'network',
    requestId: null,
    details: null,
  });
}

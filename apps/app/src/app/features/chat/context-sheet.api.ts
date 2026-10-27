import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  errorCodeSchema,
  errorEnvelopeSchema,
  parseChatSession,
  parsePage,
  parseTelemetry,
  repoSchema,
} from '@codebox/contracts';
import type { ChatSession, Page, Repo, Telemetry } from '@codebox/contracts';
import { Observable, catchError, map, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import { API_BASE_URL, API_PREFIX } from '../../core/api/http';

const DAY_RANGE = '24h';

@Injectable({ providedIn: 'root' })
export class ContextSheetApi {
  constructor(private readonly http: HttpClient) {}

  /** POST /v1/chat/sessions/{id}/compact — D48, the chat's only reset. */
  compact(chatId: string): Observable<ChatSession> {
    return this.send(
      this.http.post<unknown>(this.url(`/chat/sessions/${chatId}/compact`), null),
      parseChatSession,
    );
  }

  /** POST /v1/chat/sessions { repoId } — the sheet's "new chat in this repo". */
  createInRepo(repoId: string): Observable<ChatSession> {
    return this.send(
      this.http.post<unknown>(this.url('/chat/sessions'), { repoId }),
      parseChatSession,
    );
  }

  /** GET /v1/repos — one read for the slug row. */
  repos(): Observable<Page<Repo>> {
    return this.send(this.http.get<unknown>(this.url('/repos')), (input) =>
      parsePage(repoSchema, input, 'repos'),
    );
  }

  /** GET /v1/telemetry?range=24h — the day's spend. */
  daySpend(): Observable<Telemetry> {
    const params = new HttpParams().set('range', DAY_RANGE);
    return this.send(this.http.get<unknown>(this.url('/telemetry'), { params }), parseTelemetry);
  }

  private url(path: string): string {
    return `${API_BASE_URL}${API_PREFIX}${path}`;
  }

  private send<T>(request: Observable<unknown>, parser: (input: unknown) => T): Observable<T> {
    return request.pipe(
      map((body) => this.parse(body, parser)),
      catchError((error: unknown) => throwError(() => toApiError(error))),
    );
  }

  private parse<T>(body: unknown, parser: (input: unknown) => T): T {
    try {
      return parser(body);
    } catch (error) {
      throw new ApiError({
        message: error instanceof Error ? error.message : 'Malformed response',
        status: 200,
        code: 'contract',
        requestId: null,
        details: null,
      });
    }
  }
}

interface EnvelopeFields {
  readonly code: string;
  readonly message: string;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | null;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof HttpErrorResponse) {
    const envelope = errorEnvelopeSchema.safeParse(error.error);
    if (envelope.success) {
      const failure = envelope.data.error;
      return new ApiError({
        message: failure.message,
        status: error.status,
        code: failure.code,
        requestId: failure.requestId,
        details: failure.details ?? null,
      });
    }
    const fields = readEnvelope(error.error);
    if (fields !== null) {
      return new ApiError({ ...fields, status: error.status });
    }
    return new ApiError({
      message: error.message,
      status: error.status,
      code: error.status === 401 ? 'unauthorized' : 'internal',
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

/** docs/api.md §3: a daemon envelope whose `requestId` misses `RequestId` keeps its domain code. */
function readEnvelope(body: unknown): EnvelopeFields | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const failure = (body as Record<string, unknown>)['error'];
  if (typeof failure !== 'object' || failure === null || Array.isArray(failure)) return null;
  const record = failure as Record<string, unknown>;
  const code = errorCodeSchema.safeParse(record['code']);
  if (!code.success) return null;
  const message = record['message'];
  const requestId = record['requestId'];
  const details = record['details'];
  return {
    code: code.data,
    message: typeof message === 'string' && message !== '' ? message : 'Request failed',
    requestId: typeof requestId === 'string' ? requestId : null,
    details:
      typeof details === 'object' && details !== null && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : null,
  };
}

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  errorCodeSchema,
  errorEnvelopeSchema,
  parsePage,
  parseRun,
  parseSchedule,
  scheduleSchema,
} from '@codebox/contracts';
import type { Page, Run, Schedule, ScheduleMode } from '@codebox/contracts';
import { Observable, catchError, map, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import { API_BASE_URL, API_PREFIX } from '../../core/api/http';

export interface RepoScheduleCreateBody {
  readonly repoId: string;
  readonly mode: ScheduleMode;
  readonly timezone: string;
  readonly cron?: string;
  readonly windowStart?: string;
  readonly windowEnd?: string;
}

/** docs/api.md §5.9/§5.10: the repository's one schedule, answered as the legacy `Schedule`. */
@Injectable({ providedIn: 'root' })
export class RepoScheduleApi {
  constructor(private readonly http: HttpClient) {}

  list(repoId: string): Observable<Page<Schedule>> {
    const params = new HttpParams().set('repoId', repoId);
    return this.send(this.http.get<unknown>(this.url('/schedules'), { params }), (input) =>
      parsePage(scheduleSchema, input, 'schedules'),
    );
  }

  create(body: RepoScheduleCreateBody): Observable<Schedule> {
    return this.send(this.http.post<unknown>(this.url('/schedules'), body), parseSchedule);
  }

  pause(id: string): Observable<Schedule> {
    return this.send(this.http.post<unknown>(this.url(`/schedules/${id}/pause`), {}), parseSchedule);
  }

  resume(id: string): Observable<Schedule> {
    return this.send(
      this.http.post<unknown>(this.url(`/schedules/${id}/resume`), {}),
      parseSchedule,
    );
  }

  runNext(repoId: string): Observable<Run> {
    return this.send(this.http.post<unknown>(this.url(`/repos/${repoId}/run-next`), {}), parseRun);
  }

  private url(path: string): string {
    return `${API_BASE_URL}${API_PREFIX}${path}`;
  }

  private send<T>(request: Observable<unknown>, parse: (input: unknown) => T): Observable<T> {
    return request.pipe(
      map((body) => this.parse(body, parse)),
      catchError((error: unknown) => throwError(() => toApiError(error))),
    );
  }

  private parse<T>(body: unknown, parse: (input: unknown) => T): T {
    try {
      return parse(body);
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
    if (fields !== null) return new ApiError({ ...fields, status: error.status });
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

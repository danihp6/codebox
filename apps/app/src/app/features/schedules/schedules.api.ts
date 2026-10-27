import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  errorEnvelopeSchema,
  parsePage,
  parseSchedule,
  parseScheduleDetail,
  scheduleSchema,
} from '@codebox/contracts';
import type { Page, Schedule, ScheduleDetail } from '@codebox/contracts';
import { Observable, catchError, map, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import { API_BASE_URL, API_PREFIX } from '../../core/api/http';

export interface ScheduleListQuery {
  readonly repoId?: string;
  readonly enabled?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ScheduleCreateBody {
  readonly title: string;
  readonly prompt: string;
  readonly mode: Schedule['mode'];
  readonly cron?: string | null;
  readonly timezone: string;
  readonly windowStart?: string | null;
  readonly windowEnd?: string | null;
  readonly cooldownMinutes?: number;
  readonly maxFires?: number | null;
  readonly maxCostPerFireUsd?: number | null;
  readonly firePolicy?: Schedule['firePolicy'];
  readonly repoId?: string | null;
  readonly chatSessionId?: string | null;
}

/** docs/api.md §5.9 and D44/D46: one recurring object, a cron, a window or a single fire. */
@Injectable({ providedIn: 'root' })
export class SchedulesApi {
  constructor(private readonly http: HttpClient) {}

  list(query?: ScheduleListQuery): Observable<Page<Schedule>> {
    let params = new HttpParams();
    if (query?.repoId !== undefined) params = params.set('repoId', query.repoId);
    if (query?.enabled !== undefined) {
      params = params.set('enabled', query.enabled ? 'true' : 'false');
    }
    if (query?.limit !== undefined) params = params.set('limit', String(query.limit));
    if (query?.cursor !== undefined) params = params.set('cursor', query.cursor);
    return this.send(this.http.get<unknown>(this.url('/schedules'), { params }), (input) =>
      parsePage(scheduleSchema, input, 'schedules'),
    );
  }

  get(id: string): Observable<ScheduleDetail> {
    return this.send(this.http.get<unknown>(this.url(`/schedules/${id}`)), parseScheduleDetail);
  }

  create(body: ScheduleCreateBody): Observable<Schedule> {
    return this.send(this.http.post<unknown>(this.url('/schedules'), body), parseSchedule);
  }

  private url(path: string): string {
    return `${API_BASE_URL}${API_PREFIX}${path}`;
  }

  private send<T>(request: Observable<unknown>, parse: (input: unknown) => T): Observable<T> {
    return request.pipe(
      map((body) => parse(body)),
      catchError((error: unknown) => throwError(() => toApiError(error))),
    );
  }
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

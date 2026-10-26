import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  ContractParseError,
  errorEnvelopeSchema,
  parsePage,
  parseRoutine,
  routineSchema,
} from '@codebox/contracts';
import type { Page, Routine } from '@codebox/contracts';
import { Observable, catchError, map, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import { API_BASE_URL, API_PREFIX } from '../../core/api/http';

export type RoutineKind = Routine['kind'];

export interface RoutinesQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly kind?: RoutineKind;
  readonly enabled?: boolean;
}

export interface RoutinePatchBody {
  readonly title?: string;
  readonly cron?: string;
  readonly timezone?: string;
  readonly prompt?: string;
  readonly notify?: boolean;
}

/** docs/api.md §5.8. There is no `create`: a routine is born through the `routine.create` tool. */
@Injectable({ providedIn: 'root' })
export class RoutinesApi {
  constructor(private readonly http: HttpClient) {}

  list(query?: RoutinesQuery): Observable<Page<Routine>> {
    let params = new HttpParams();
    if (query?.limit !== undefined) params = params.set('limit', String(query.limit));
    if (query?.cursor !== undefined) params = params.set('cursor', query.cursor);
    if (query?.kind !== undefined) params = params.set('kind', query.kind);
    if (query?.enabled !== undefined) {
      params = params.set('enabled', query.enabled ? 'true' : 'false');
    }
    return this.send(
      this.http.get<unknown>(this.url('/routines'), { params }),
      (input) => parsePage(routineSchema, input, 'routines'),
    );
  }

  get(id: string): Observable<Routine> {
    return this.send(this.http.get<unknown>(this.url(`/routines/${id}`)), parseRoutine);
  }

  patch(id: string, body: RoutinePatchBody): Observable<Routine> {
    return this.send(
      this.http.patch<unknown>(this.url(`/routines/${id}`), definedOnly(body)),
      parseRoutine,
    );
  }

  pause(id: string): Observable<Routine> {
    return this.send(this.http.post<unknown>(this.url(`/routines/${id}/pause`), null), parseRoutine);
  }

  resume(id: string): Observable<Routine> {
    return this.send(
      this.http.post<unknown>(this.url(`/routines/${id}/resume`), null),
      parseRoutine,
    );
  }

  runNow(id: string): Observable<Routine> {
    return this.send(this.http.post<unknown>(this.url(`/routines/${id}/run`), null), parseRoutine);
  }

  remove(id: string): Observable<void> {
    return this.send(
      this.http.delete<unknown>(this.url(`/routines/${id}`)),
      (): void => undefined,
    );
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

function definedOnly(body: RoutinePatchBody): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(body)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result;
}

/** A parse failure keeps its type so the caller can see the boundary; every other failure is an
 *  `ApiError` built from the envelope. */
function toApiError(error: unknown): ApiError | ContractParseError {
  if (error instanceof ApiError || error instanceof ContractParseError) return error;
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

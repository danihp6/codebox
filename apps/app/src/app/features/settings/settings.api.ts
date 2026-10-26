import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  deviceSchema,
  errorCodeSchema,
  errorEnvelopeSchema,
  parseBrake,
  parseMe,
  parseNotificationPreferences,
  parsePage,
  parseProviders,
  parseSettings,
  parseVersion,
} from '@codebox/contracts';
import type {
  Device,
  Me,
  NotificationPreferences,
  Page,
  Providers,
  Settings,
  Version,
} from '@codebox/contracts';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import { API_BASE_URL, API_PREFIX } from '../../core/api/http';

export interface SettingsPatch {
  readonly timezone?: string;
}

const JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'application/json',
});

/**
 * A read whose daemon route does not exist in this build resolves `null` (HTTP 404) and never
 * throws. Everything else keeps throwing `ApiError`.
 */
@Injectable({ providedIn: 'root' })
export class SettingsApi {
  constructor(private readonly http: HttpClient) {}

  me(): Observable<Me> {
    return this.send(this.http.get<unknown>(this.url('/me')), parseMe);
  }

  version(): Observable<Version> {
    return this.send(this.http.get<unknown>(this.url('/version')), parseVersion);
  }

  settings(): Observable<Settings | null> {
    return this.absentOn404(
      this.send(this.http.get<unknown>(this.url('/settings')), parseSettings),
      null,
    );
  }

  patchSettings(body: SettingsPatch): Observable<Settings> {
    return this.send(this.http.patch<unknown>(this.url('/settings'), body), parseSettings);
  }

  providers(): Observable<Providers | null> {
    return this.absentOn404(
      this.send(this.http.get<unknown>(this.url('/providers')), parseProviders),
      null,
    );
  }

  brake(enabled: boolean): Observable<boolean> {
    return this.absentOn404(
      this.send(
        this.http.post<unknown>(this.url('/admin/brake'), { enabled }, { headers: JSON_HEADERS }),
        (input) => parseBrake(input).enabled,
      ),
      false,
    );
  }

  wipeCache(): Observable<boolean> {
    return this.absentOn404(
      this.send(
        this.http.post<unknown>(this.url('/admin/cache/wipe'), null, { headers: JSON_HEADERS }),
        (): boolean => true,
      ),
      false,
    );
  }

  devices(query?: { limit?: number; cursor?: string }): Observable<Page<Device>> {
    const params = this.query({ limit: query?.limit, cursor: query?.cursor });
    return this.send(this.http.get<unknown>(this.url('/devices'), { params }), (input) =>
      parsePage(deviceSchema, input, 'devices'),
    );
  }

  revokeDevice(id: string): Observable<void> {
    return this.send(this.http.delete<unknown>(this.url(`/devices/${id}`)), (): void => undefined);
  }

  preferences(): Observable<NotificationPreferences> {
    return this.send(
      this.http.get<unknown>(this.url('/notifications/preferences')),
      parseNotificationPreferences,
    );
  }

  patchPreferences(body: NotificationPreferences): Observable<NotificationPreferences> {
    return this.send(
      this.http.patch<unknown>(this.url('/notifications/preferences'), body),
      parseNotificationPreferences,
    );
  }

  private url(path: string): string {
    return `${API_BASE_URL}${API_PREFIX}${path}`;
  }

  private query(values: Readonly<Record<string, string | number | undefined>>): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) params = params.set(key, String(value));
    }
    return params;
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

  /** docs/api.md §5.1/§5.7: a route this build does not ship answers 404, and that is not a failure. */
  private absentOn404<T>(request: Observable<T>, absent: T): Observable<T> {
    return request.pipe(
      catchError((error: unknown) =>
        error instanceof ApiError && error.status === 404 ? of(absent) : throwError(() => error),
      ),
    );
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

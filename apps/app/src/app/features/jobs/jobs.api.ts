import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  ContractParseError,
  errorEnvelopeSchema,
  parseJob,
  parsePage,
  parseRun,
  repoSchema,
  timestampSchema,
} from '@codebox/contracts';
import type { Job, Page, Repo, RepoPolicy, Run } from '@codebox/contracts';
import { Observable, catchError, map, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import { API_BASE_URL, API_PREFIX } from '../../core/api/http';

export interface JobDetail {
  readonly job: Job;
  readonly lastRuns: readonly Run[];
  readonly nextFires: readonly string[];
}

export interface JobCreateBody {
  readonly repoId: string;
  readonly title: string;
  readonly prompt: string;
  readonly cron: string;
  readonly timezone: string;
  readonly mode?: 'work';
  readonly agent?: string;
  readonly model?: string | null;
  readonly policy?: RepoPolicy;
}

export interface JobPatchBody {
  readonly title?: string;
  readonly prompt?: string;
  readonly cron?: string;
  readonly timezone?: string;
  readonly agent?: string;
  readonly model?: string | null;
  readonly policy?: RepoPolicy;
  readonly enabled?: boolean;
}

const JOB_DETAIL_KEYS: readonly string[] = Object.freeze(['job', 'lastRuns', 'nextFires']);
const JOB_NEXT_KEYS: readonly string[] = Object.freeze(['fires']);
const REPOS_LIMIT = 200;

export function parseJobDetail(input: unknown): JobDetail {
  const record = objectOf(input, 'jobDetail');
  assertExactKeys(record, JOB_DETAIL_KEYS, 'jobDetail');

  let job: Job;
  try {
    job = parseJob(record['job']);
  } catch (error) {
    throw rethrowAsDetail(error, 'job');
  }

  const rawRuns = record['lastRuns'];
  if (!Array.isArray(rawRuns)) throw detailIssue('lastRuns', 'expected an array');
  const lastRuns: Run[] = [];
  for (let index = 0; index < rawRuns.length; index += 1) {
    try {
      lastRuns.push(parseRun(rawRuns[index]));
    } catch (error) {
      throw rethrowAsDetail(error, `lastRuns.${index}`);
    }
  }

  const rawFires = record['nextFires'];
  if (!Array.isArray(rawFires)) throw detailIssue('nextFires', 'expected an array');
  const nextFires: string[] = [];
  for (let index = 0; index < rawFires.length; index += 1) {
    const fire = timestampSchema.safeParse(rawFires[index]);
    if (!fire.success) throw detailIssue(`nextFires.${index}`, 'expected an RFC 3339 timestamp');
    nextFires.push(fire.data);
  }

  return { job, lastRuns, nextFires };
}

export function parseNextFires(input: unknown): readonly string[] {
  const record = objectOf(input, 'jobNext');
  assertExactKeys(record, JOB_NEXT_KEYS, 'jobNext');

  const raw = record['fires'];
  if (!Array.isArray(raw)) throw nextIssue('fires', 'expected an array');
  const fires: string[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const fire = timestampSchema.safeParse(raw[index]);
    if (!fire.success) throw nextIssue(`fires.${index}`, 'expected an RFC 3339 timestamp');
    fires.push(fire.data);
  }
  return fires;
}

@Injectable({ providedIn: 'root' })
export class JobsApi {
  constructor(private readonly http: HttpClient) {}

  get(id: string): Observable<JobDetail> {
    return this.send(this.http.get<unknown>(this.url(`/jobs/${id}`)), parseJobDetail);
  }

  create(body: JobCreateBody): Observable<Job> {
    return this.send(this.http.post<unknown>(this.url('/jobs'), body), parseJob);
  }

  patch(id: string, body: JobPatchBody): Observable<Job> {
    return this.send(
      this.http.patch<unknown>(this.url(`/jobs/${id}`), definedOnly(body)),
      parseJob,
    );
  }

  remove(id: string): Observable<void> {
    return this.send(
      this.http.delete<unknown>(this.url(`/jobs/${id}`)),
      (): void => undefined,
    );
  }

  pause(id: string): Observable<Job> {
    return this.send(this.http.post<unknown>(this.url(`/jobs/${id}/pause`), null), parseJob);
  }

  resume(id: string): Observable<Job> {
    return this.send(this.http.post<unknown>(this.url(`/jobs/${id}/resume`), null), parseJob);
  }

  runNow(id: string, idempotencyKey: string): Observable<Run> {
    return this.send(
      this.http.post<unknown>(this.url(`/jobs/${id}/run`), null, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      parseRun,
    );
  }

  next(id: string, count?: number): Observable<readonly string[]> {
    let params = new HttpParams();
    if (count !== undefined) params = params.set('count', String(count));
    return this.send(this.http.get<unknown>(this.url(`/jobs/${id}/next`), { params }), parseNextFires);
  }

  listRepos(): Observable<Page<Repo>> {
    const params = new HttpParams().set('limit', String(REPOS_LIMIT));
    return this.send(
      this.http.get<unknown>(this.url('/repos'), { params }),
      (input) => parsePage(repoSchema, input, 'repos'),
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

function definedOnly<T extends object>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result as T;
}

function objectOf(input: unknown, boundary: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ContractParseError(boundary, [
      { path: boundary, message: 'expected an object', code: 'custom' },
    ]);
  }
  return input as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  boundary: string,
): void {
  const actual = Object.keys(record);
  for (const key of keys) {
    if (!actual.includes(key)) {
      throw new ContractParseError(boundary, [
        { path: key, message: 'missing field', code: 'custom' },
      ]);
    }
  }
  for (const key of actual) {
    if (!keys.includes(key)) {
      throw new ContractParseError(boundary, [
        { path: key, message: 'unrecognized field', code: 'custom' },
      ]);
    }
  }
}

function rethrowAsDetail(error: unknown, fallbackPath: string): ContractParseError {
  if (error instanceof ContractParseError) {
    return detailIssue(error.first.path, error.first.message);
  }
  return detailIssue(fallbackPath, 'invalid input');
}

function detailIssue(path: string, message: string): ContractParseError {
  return new ContractParseError('jobDetail', [{ path, message, code: 'custom' }]);
}

function nextIssue(path: string, message: string): ContractParseError {
  return new ContractParseError('jobNext', [{ path, message, code: 'custom' }]);
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

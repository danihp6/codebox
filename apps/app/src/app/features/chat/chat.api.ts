import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  chatMessageSchema,
  chatSessionSchema,
  errorEnvelopeSchema,
  parseApproval,
  parseChatMessage,
  parseChatSession,
  parsePage,
  parseRun,
  repoSchema,
} from '@codebox/contracts';
import type { Approval, ChatMessage, ChatSession, Page, Repo, Run } from '@codebox/contracts';
import { Observable, catchError, map, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import { API_BASE_URL, API_PREFIX } from '../../core/api/http';

export interface ApprovalReply {
  readonly decision: 'allow' | 'deny';
  readonly scope: 'once' | 'session';
}

@Injectable({ providedIn: 'root' })
export class ChatApi {
  constructor(private readonly http: HttpClient) {}

  listSessions(query?: {
    repoId?: string;
    limit?: number;
    cursor?: string;
  }): Observable<Page<ChatSession>> {
    const params = this.query({
      repoId: query?.repoId,
      limit: query?.limit,
      cursor: query?.cursor,
    });
    return this.request(this.http.get<unknown>(this.url('/chat/sessions'), { params }), (input) =>
      parsePage(chatSessionSchema, input, 'chat.sessions'),
    );
  }

  getSession(id: string): Observable<ChatSession> {
    return this.request(this.http.get<unknown>(this.url(`/chat/sessions/${id}`)), parseChatSession);
  }

  createSession(body: { repoId: string; title?: string }): Observable<ChatSession> {
    const payload = body.title === undefined ? { repoId: body.repoId } : body;
    return this.request(
      this.http.post<unknown>(this.url('/chat/sessions'), payload),
      parseChatSession,
    );
  }

  listMessages(
    id: string,
    query?: { limit?: number; cursor?: string },
  ): Observable<Page<ChatMessage>> {
    const params = this.query({ limit: query?.limit, cursor: query?.cursor });
    return this.request(
      this.http.get<unknown>(this.url(`/chat/sessions/${id}/messages`), { params }),
      (input) => parsePage(chatMessageSchema, input, 'chat.messages'),
    );
  }

  send(id: string, text: string): Observable<ChatMessage> {
    return this.request(
      this.http.post<unknown>(this.url(`/chat/sessions/${id}/messages`), { text }),
      parseChatMessage,
    );
  }

  interrupt(id: string): Observable<ChatSession> {
    return this.request(
      this.http.post<unknown>(this.url(`/chat/sessions/${id}/interrupt`), null),
      parseChatSession,
    );
  }

  promote(id: string, idempotencyKey: string, body?: { title?: string }): Observable<Run> {
    const title = body?.title;
    const payload = title === undefined ? {} : { title };
    return this.request(
      this.http.post<unknown>(this.url(`/chat/sessions/${id}/promote`), payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      parseRun,
    );
  }

  listRepos(): Observable<Page<Repo>> {
    const params = this.query({ limit: 200 });
    return this.request(this.http.get<unknown>(this.url('/repos'), { params }), (input) =>
      parsePage(repoSchema, input, 'repos'),
    );
  }

  replyApproval(approvalId: string, body: ApprovalReply): Observable<Approval> {
    return this.request(
      this.http.post<unknown>(this.url(`/approvals/${approvalId}/reply`), {
        decision: body.decision,
        scope: body.scope,
      }),
      parseApproval,
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

  private request<T>(request: Observable<unknown>, parse: (input: unknown) => T): Observable<T> {
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

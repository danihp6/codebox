import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  errorEnvelopeSchema,
  parseChatMessage,
  parseChatSession,
  parsePage,
  repoSchema,
} from '@codebox/contracts';
import type { ChatMessage, ChatSession, Page, Repo } from '@codebox/contracts';
import { Observable, catchError, map, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import { API_BASE_URL, API_PREFIX } from '../../core/api/http';

const REPOS_LIMIT = 200;

@Injectable({ providedIn: 'root' })
export class NewChatApi {
  constructor(private readonly http: HttpClient) {}

  createSession(body: { repoId?: string; title?: string }): Observable<ChatSession> {
    const payload: { repoId?: string; title?: string } = {};
    if (body.repoId !== undefined) payload.repoId = body.repoId;
    if (body.title !== undefined) payload.title = body.title;
    return this.request(
      this.http.post<unknown>(this.url('/chat/sessions'), payload),
      parseChatSession,
    );
  }

  bindRepo(chatId: string, repoId: string): Observable<ChatSession> {
    return this.request(
      this.http.post<unknown>(this.url(`/chat/sessions/${chatId}/repo`), { repoId }),
      parseChatSession,
    );
  }

  send(chatId: string, text: string): Observable<ChatMessage> {
    return this.request(
      this.http.post<unknown>(this.url(`/chat/sessions/${chatId}/messages`), { text }),
      parseChatMessage,
    );
  }

  listRepos(): Observable<Page<Repo>> {
    return this.request(
      this.http.get<unknown>(this.url('/repos'), { params: { limit: REPOS_LIMIT } }),
      (input) => parsePage(repoSchema, input, 'repos'),
    );
  }

  private url(path: string): string {
    return `${API_BASE_URL}${API_PREFIX}${path}`;
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

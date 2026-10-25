import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import type { ChatSession, Repo, SseStreamEvent } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { ChatApi } from './chat.api';

const SESSIONS_LIMIT = 50;

@Injectable()
export class ChatListStore {
  readonly sessions = signal<readonly ChatSession[]>([]);
  readonly repos = signal<readonly Repo[]>([]);
  readonly repoFilter = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly creating = signal(false);

  private readonly api = inject(ChatApi);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);

  load(): void {
    this.loadRepos();
    this.loadSessions();
  }

  setRepoFilter(repoId: string | null): void {
    if (this.repoFilter() === repoId) return;
    this.repoFilter.set(repoId);
    this.loadSessions();
  }

  startChat(): void {
    if (this.creating()) return;
    const repoId = this.repoFilter() ?? this.repos()[0]?.id;
    if (repoId === undefined) return;
    this.creating.set(true);
    this.api
      .createSession({ repoId })
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.creating.set(false)),
      )
      .subscribe({
        next: (session) => {
          void this.router.navigate(['/chat', session.id]);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored' {
    if (event.event !== 'chat.message') return 'ignored';
    const { chatId, message } = event.data;
    if (!this.sessions().some((session) => session.id === chatId)) return 'ignored';
    this.sessions.update((sessions) =>
      sessions.map((session) =>
        session.id === chatId
          ? { ...session, lastMessage: message, updatedAt: message.createdAt }
          : session,
      ),
    );
    return 'applied';
  }

  private loadRepos(): void {
    this.api
      .listRepos()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (page) => this.repos.set(page.data),
        error: () => this.repos.set([]),
      });
  }

  private loadSessions(): void {
    const repoId = this.repoFilter();
    this.loading.set(true);
    this.api
      .listSessions(repoId === null ? { limit: SESSIONS_LIMIT } : { repoId, limit: SESSIONS_LIMIT })
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (page) => {
          this.sessions.set(page.data);
          this.error.set(null);
        },
        error: (error: ApiError) => {
          this.sessions.set([]);
          this.error.set(error);
        },
      });
  }
}

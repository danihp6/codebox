import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { ChatSession, Repo } from '@codebox/contracts';
import { Observable, finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { NewChatApi } from './new-chat.api';

export type NewChatProposal = 'repository' | 'schedule';

/** Exactly two: a third proposal is a bug (docs/app.md §4, frame 03a). */
export const NEW_CHAT_PROPOSALS: readonly NewChatProposal[] = Object.freeze([
  'repository',
  'schedule',
]);

@Injectable()
export class NewChatStore {
  private readonly api = inject(NewChatApi);
  private readonly destroy = inject(DestroyRef);

  private readonly proposalsState = signal<readonly NewChatProposal[]>(NEW_CHAT_PROPOSALS);
  private readonly reposState = signal<readonly Repo[]>([]);
  private readonly reposLoadingState = signal(false);
  private readonly reposUnavailableState = signal(false);
  private readonly busyState = signal(false);
  private readonly busyRepoIdState = signal<string | null>(null);
  private readonly errorState = signal<ApiError | null>(null);
  private readonly draftState = signal('');
  private readonly createdState = signal<ChatSession | null>(null);
  private readonly handoffState = signal<ChatSession | null>(null);

  readonly proposals: Signal<readonly NewChatProposal[]> = this.proposalsState.asReadonly();
  readonly repos: Signal<readonly Repo[]> = this.reposState.asReadonly();
  readonly reposLoading: Signal<boolean> = this.reposLoadingState.asReadonly();
  readonly reposUnavailable: Signal<boolean> = this.reposUnavailableState.asReadonly();
  readonly busy: Signal<boolean> = this.busyState.asReadonly();
  readonly busyRepoId: Signal<string | null> = this.busyRepoIdState.asReadonly();
  /** True while a create/bind request is in flight: the one state that disables the composer. */
  readonly converting: Signal<boolean> = computed(() => this.busyRepoIdState() !== null);
  readonly error: Signal<ApiError | null> = this.errorState.asReadonly();
  readonly draft: Signal<string> = this.draftState.asReadonly();
  /** The free session the last `createFree` answered with, for the host's navigation. */
  readonly created: Signal<ChatSession | null> = this.createdState.asReadonly();
  /** The repo session a `connect`/`bind` answered with: the host draws the handoff divider. */
  readonly handoff: Signal<ChatSession | null> = this.handoffState.asReadonly();

  setDraft(text: string): void {
    this.draftState.set(text);
  }

  loadRepos(): void {
    if (this.reposLoadingState()) return;
    this.reposLoadingState.set(true);
    this.reposUnavailableState.set(false);
    this.api
      .listRepos()
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.reposLoadingState.set(false)),
      )
      .subscribe({
        next: (page) => this.reposState.set(page.data),
        error: () => {
          this.reposState.set([]);
          this.reposUnavailableState.set(true);
        },
      });
  }

  createFree(): void {
    if (this.busyState()) return;
    const text = this.draftState().trim();
    this.busyState.set(true);
    this.errorState.set(null);
    this.api
      .createSession({})
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (session) => {
          this.createdState.set(session);
          if (text === '') {
            this.busyState.set(false);
            return;
          }
          this.postDraft(session.id, text);
        },
        error: (error: ApiError) => {
          this.errorState.set(error);
          this.busyState.set(false);
        },
      });
  }

  connect(repoId: string): void {
    if (this.busyState()) return;
    this.convert(this.api.createSession({ repoId }), repoId);
  }

  bind(chatId: string, repoId: string): void {
    if (this.busyState()) return;
    this.convert(this.api.bindRepo(chatId, repoId), repoId);
  }

  private postDraft(chatId: string, text: string): void {
    this.api
      .send(chatId, text)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busyState.set(false)),
      )
      .subscribe({
        next: () => this.draftState.set(''),
        error: (error: ApiError) => this.errorState.set(error),
      });
  }

  private convert(request: Observable<ChatSession>, repoId: string): void {
    this.busyState.set(true);
    this.busyRepoIdState.set(repoId);
    this.errorState.set(null);
    request
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => {
          this.busyState.set(false);
          this.busyRepoIdState.set(null);
        }),
      )
      .subscribe({
        next: (session) => {
          if ((session.kind ?? 'repo') === 'repo') this.handoffState.set(session);
        },
        error: (error: ApiError) => this.errorState.set(error),
      });
  }
}

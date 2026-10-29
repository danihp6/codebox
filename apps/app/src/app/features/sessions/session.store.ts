import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Session, SseStreamEvent } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { SessionsApi } from './sessions.api';
import { EMPTY_THREAD, appendMessage, applySessionEvent, mergeMessages } from './session-stream';
import type { SessionThread } from './session-stream';

export type SessionBusy = 'send' | 'interrupt' | 'merge';

const MESSAGES_LIMIT = 100;

@Injectable()
export class SessionStore {
  private readonly api = inject(SessionsApi);
  private readonly destroy = inject(DestroyRef);

  readonly sessionId = signal<string | null>(null);
  readonly session = signal<Session | null>(null);
  readonly thread = signal<SessionThread>(EMPTY_THREAD);
  readonly draft = signal('');
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly busy = signal<SessionBusy | null>(null);
  readonly mergeError = signal<ApiError | null>(null);

  readonly pendingProposal = computed(() => this.thread().proposal);
  readonly blocked = computed<boolean>(() => this.pendingProposal() !== null);

  load(id: string): void {
    if (this.sessionId() !== id) {
      this.sessionId.set(id);
      this.session.set(null);
      this.thread.set(EMPTY_THREAD);
      this.draft.set('');
      this.error.set(null);
      this.busy.set(null);
      this.mergeError.set(null);
      this.loading.set(true);
    }
    this.fetchSession(id);
    this.fetchMessages(id);
  }

  reload(): void {
    const id = this.sessionId();
    if (id === null) return;
    this.fetchSession(id);
    this.fetchMessages(id);
  }

  setDraft(text: string): void {
    this.draft.set(text);
  }

  send(): void {
    const id = this.sessionId();
    const text = this.draft().trim();
    if (id === null || text === '' || this.busy() !== null || this.blocked()) return;
    this.busy.set('send');
    this.error.set(null);
    this.api
      .send(id, text)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: (message) => {
          this.draft.set('');
          this.thread.update((current) => appendMessage(current, message));
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  interrupt(): void {
    const id = this.sessionId();
    if (id === null || this.busy() !== null) return;
    this.busy.set('interrupt');
    this.error.set(null);
    this.api
      .interrupt(id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: (session) => this.session.set(session),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  /** A proposal is cleared whatever the outcome, so a refused merge re-enables the button. */
  merge(): void {
    const id = this.sessionId();
    const proposal = this.pendingProposal();
    if (id === null || proposal === null || this.busy() !== null) return;
    this.busy.set('merge');
    this.mergeError.set(null);
    this.api
      .merge(id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: (session) => {
          this.session.set(session);
          this.clearProposal();
        },
        error: (error: ApiError) => {
          this.mergeError.set(error);
          this.clearProposal();
        },
      });
  }

  applyEvent(event: SseStreamEvent): 'applied' | 'ignored' | 'refetch' {
    if (event.event === 'gap') return 'refetch';
    const id = this.sessionId();
    if (id === null) return 'ignored';

    if (event.event === 'session.closed' && event.data.sessionId === id) {
      this.session.update((current) =>
        current === null ? current : { ...current, status: 'archived' },
      );
    }
    if (event.event === 'session.proposal' && event.data.sessionId === id) {
      const proposal = event.data.proposal;
      this.session.update((current) =>
        current === null ? current : { ...current, pendingProposal: proposal },
      );
    }

    const current = this.thread();
    const next = applySessionEvent(current, id, event);
    if (next === current) return 'ignored';
    this.thread.set(next);
    return 'applied';
  }

  private clearProposal(): void {
    this.thread.update((current) => ({ ...current, proposal: null }));
    this.session.update((current) =>
      current === null ? current : { ...current, pendingProposal: null },
    );
  }

  private fetchSession(id: string): void {
    this.api
      .get(id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (session) => {
          this.session.set(session);
          this.error.set(null);
          if (session.pendingProposal !== null) {
            this.thread.update((current) => ({ ...current, proposal: session.pendingProposal }));
          }
        },
        error: (error: ApiError) => {
          this.error.set(error);
          this.loading.set(false);
        },
      });
  }

  private fetchMessages(id: string): void {
    this.api
      .messages(id, { limit: MESSAGES_LIMIT })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (page) => this.thread.update((current) => mergeMessages(current, page)),
        error: (error: ApiError) => this.error.set(error),
      });
  }
}

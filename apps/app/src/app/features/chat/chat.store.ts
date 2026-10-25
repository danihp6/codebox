import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import type { ChatSession, SseStreamEvent } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import type { ApprovalReply } from './chat.api';
import { ChatApi } from './chat.api';
import {
  EMPTY_CHAT,
  appendMessage,
  applyChatEvent,
  markPermissionAnswered,
  mergeMessages,
} from './chat-stream';

const MESSAGES_LIMIT = 100;

export type ChatBusy = 'send' | 'interrupt' | 'promote';

@Injectable()
export class ChatStore {
  readonly chatId = signal<string | null>(null);
  readonly session = signal<ChatSession | null>(null);
  readonly stream = signal(EMPTY_CHAT);
  readonly draft = signal('');
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly busy = signal<ChatBusy | null>(null);
  readonly canPromote = computed<boolean>(() => {
    const stream = this.stream();
    if (stream.working) return false;
    const last = stream.messages[stream.messages.length - 1];
    return last !== undefined && last.role === 'assistant';
  });
  readonly canInterrupt = computed<boolean>(() => this.stream().working);

  private readonly api = inject(ChatApi);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private promoteCounter = 0;

  load(chatId: string): void {
    if (this.chatId() !== chatId) {
      this.chatId.set(chatId);
      this.session.set(null);
      this.stream.set(EMPTY_CHAT);
      this.draft.set('');
      this.error.set(null);
      this.busy.set(null);
      this.loading.set(true);
      this.promoteCounter = 0;
    }
    this.fetchSession(chatId);
    this.fetchMessages(chatId);
  }

  reload(): void {
    const chatId = this.chatId();
    if (chatId === null) return;
    this.fetchSession(chatId);
    this.fetchMessages(chatId);
  }

  setDraft(text: string): void {
    this.draft.set(text);
  }

  send(): void {
    const chatId = this.chatId();
    const text = this.draft().trim();
    if (chatId === null || text === '' || this.busy() !== null) return;
    this.busy.set('send');
    this.api
      .send(chatId, text)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: (message) => {
          this.draft.set('');
          this.stream.update((current) => appendMessage(current, message));
          this.error.set(null);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  interrupt(): void {
    const chatId = this.chatId();
    if (chatId === null || this.busy() !== null) return;
    this.busy.set('interrupt');
    this.api
      .interrupt(chatId)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: (session) => {
          this.session.set(session);
          this.error.set(null);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  promote(): void {
    const chatId = this.chatId();
    if (chatId === null || this.busy() !== null) return;
    this.promoteCounter += 1;
    this.busy.set('promote');
    this.api
      .promote(chatId, `promote-${chatId}-${this.promoteCounter}`)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: (run) => {
          void this.router.navigate(['/runs', run.id]);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored' | 'refetch' {
    if (event.event === 'gap') return 'refetch';
    const chatId = this.chatId();
    if (chatId === null) return 'ignored';
    const current = this.stream();
    const next = applyChatEvent(current, chatId, event);
    if (next === current) return 'ignored';
    this.stream.set(next);
    return 'applied';
  }

  resolvePermission(approvalId: string, reply: ApprovalReply): void {
    this.api
      .replyApproval(approvalId, reply)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => {
          this.stream.update((current) => markPermissionAnswered(current, approvalId));
          this.error.set(null);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  private fetchSession(chatId: string): void {
    this.api
      .getSession(chatId)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (session) => {
          this.session.set(session);
          this.error.set(null);
          this.loading.set(false);
        },
        error: (error: ApiError) => {
          this.error.set(error);
          this.loading.set(false);
        },
      });
  }

  private fetchMessages(chatId: string): void {
    this.api
      .listMessages(chatId, { limit: MESSAGES_LIMIT })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (page) => this.stream.update((current) => mergeMessages(current, page)),
        error: (error: ApiError) => this.error.set(error),
      });
  }
}

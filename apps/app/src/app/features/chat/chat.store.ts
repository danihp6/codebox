import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import type { ChatSession, Repo, Run, SseStreamEvent } from '@codebox/contracts';
import { finalize } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { ApiError } from '../../core/api/api-client';
import { RoutinesApi } from '../jobs/routines.api';
import type { ApprovalReply } from './chat.api';
import { ChatApi } from './chat.api';
import { ChatRunLink } from './chat-store';
import {
  EMPTY_CHAT,
  appendMessage,
  applyChatEvent,
  markPermissionAnswered,
  mergeMessages,
  pickCreatedRoutine,
  withRoutineCard,
  withRunCards,
} from './chat-stream';
import type { ChatStreamState } from './chat-stream';

const MESSAGES_LIMIT = 100;
const ROUTINE_LOOKUP_LIMIT = 10;

export type ChatBusy = 'send' | 'interrupt' | 'promote';

export interface PromoteTarget {
  readonly repoSlug: string;
  readonly baseBranch: string;
  readonly prompt: string;
}

@Injectable()
export class ChatStore {
  readonly chatId = signal<string | null>(null);
  readonly session = signal<ChatSession | null>(null);
  readonly stream = signal(EMPTY_CHAT);
  readonly draft = signal('');
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly busy = signal<ChatBusy | null>(null);
  readonly run = signal<Run | null>(null);
  readonly promoting = signal(false);
  readonly promoteTarget = computed<PromoteTarget | null>(() => {
    const session = this.session();
    if (session === null || session.repoId === null) return null;
    const repo = this.repos().find((candidate) => candidate.id === session.repoId);
    if (repo === undefined) return null;
    const prompt = lastAssistantText(this.stream());
    if (prompt === null) return null;
    return { repoSlug: repo.slug, baseBranch: repo.defaultBranch, prompt };
  });
  readonly canPromote = computed<boolean>(() => {
    const session = this.session();
    if (session === null) return false;
    if (session.repoId === null) return false;
    if ((session.kind ?? 'repo') !== 'repo') return false;
    const stream = this.stream();
    if (stream.working) return false;
    const last = stream.messages[stream.messages.length - 1];
    return last !== undefined && last.role === 'assistant';
  });
  readonly canInterrupt = computed<boolean>(() => this.stream().working);

  private readonly repos = signal<readonly Repo[]>([]);
  private readonly api = inject(ChatApi);
  private readonly runsApi = inject(ApiClient);
  private readonly routinesApi = inject(RoutinesApi);
  private readonly link = inject(ChatRunLink);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private promoteCounter = 0;
  private reposLoading = false;

  load(chatId: string): void {
    if (this.chatId() !== chatId) {
      this.chatId.set(chatId);
      this.session.set(null);
      this.stream.set(EMPTY_CHAT);
      this.run.set(null);
      this.promoting.set(false);
      this.draft.set('');
      this.error.set(null);
      this.busy.set(null);
      this.loading.set(true);
      this.promoteCounter = 0;
    }
    this.fetchSession(chatId);
    this.fetchMessages(chatId);
    this.fetchRun(chatId);
  }

  reload(): void {
    const chatId = this.chatId();
    if (chatId === null) return;
    this.fetchSession(chatId);
    this.fetchMessages(chatId);
    this.fetchRun(chatId);
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

  openPromote(): void {
    this.promoting.set(true);
    if (this.repos().length === 0 && !this.reposLoading) this.fetchRepos();
  }

  cancelPromote(): void {
    this.promoting.set(false);
  }

  confirmPromote(): void {
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
          this.link.remember(chatId, run.id);
          this.run.set(run);
          this.stream.update((current) => withRunCards(current, run));
          this.promoting.set(false);
          this.error.set(null);
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

    if (
      event.event === 'chat.tool' &&
      event.data.tool === 'routine.create' &&
      event.data.status === 'ok' &&
      event.data.chatId === chatId &&
      !isSettledRoutineTool(current, event.data.seq)
    ) {
      this.lookupCreatedRoutine(chatId, event.data.ts);
    }
    return 'applied';
  }

  /** Run frames are not chat frames: they update the run and therefore the gate/PR cards. */
  applyRunEvent(event: SseStreamEvent): 'applied' | 'ignored' {
    const current = this.run();
    if (current === null) return 'ignored';
    if (!('runId' in event.data) || event.data.runId !== current.id) return 'ignored';

    switch (event.event) {
      case 'run.gate':
        return this.applyRun({ ...current, gate: event.data.gate });
      case 'run.pr':
        return this.applyRun({ ...current, pr: event.data.pr });
      case 'run.merged':
        return this.applyRun({ ...current, pr: event.data.pr, state: 'succeeded' });
      case 'run.finished':
        return this.applyRun({ ...current, state: 'succeeded' });
      case 'run.failed':
        return this.applyRun({ ...current, state: 'failed' });
      case 'run.cancelled':
        return this.applyRun({ ...current, state: 'cancelled' });
      default:
        return 'ignored';
    }
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

  private applyRun(run: Run): 'applied' {
    this.run.set(run);
    this.stream.update((current) => withRunCards(current, run));
    return 'applied';
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

  private fetchRun(chatId: string): void {
    const runId = this.link.runIdFor(chatId);
    if (runId === null) {
      this.run.set(null);
      return;
    }
    this.runsApi
      .getRun(runId)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (run) => {
          this.run.set(run);
          this.stream.update((current) => withRunCards(current, run));
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  private fetchRepos(): void {
    this.reposLoading = true;
    this.api
      .listRepos()
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => {
          this.reposLoading = false;
        }),
      )
      .subscribe({
        next: (page) => this.repos.set(page.data),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  private lookupCreatedRoutine(chatId: string, toolTs: string): void {
    this.routinesApi
      .list({ limit: ROUTINE_LOOKUP_LIMIT })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (page) => {
          const routine = pickCreatedRoutine(page.data, chatId, toolTs);
          if (routine === null) return;
          this.stream.update((current) => withRoutineCard(current, routine));
        },
        error: (error: ApiError) => this.error.set(error),
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

/** A `chat.tool` frame that already landed as `ok` for this seq is a replay: no second lookup. */
function isSettledRoutineTool(state: ChatStreamState, seq: number): boolean {
  return state.tools.some(
    (card) => card.seq === seq && card.tool === 'routine.create' && card.status === 'ok',
  );
}

function lastAssistantText(state: ChatStreamState): string | null {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const item = state.messages[index];
    if (item !== undefined && item.role === 'assistant') return item.text;
  }
  return null;
}

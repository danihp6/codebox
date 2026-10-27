import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Signal } from '@angular/core';
import { Router } from '@angular/router';
import type { ChatSession, Repo, SseStreamEvent } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { SECURE_STORE } from '../../core/auth/secure-store';
import type { Locale } from '../../core/i18n/i18n.service';
import { I18nService } from '../../core/i18n/i18n.service';
import type { ChatRowView, ChatScope } from '../../shared/chat-row';
import { ChatApi } from './chat.api';
import { translate } from './i18n';

export type ChatFilter = 'all' | 'repo' | 'schedule' | 'unread' | 'archived';

/** Order is the render order of the chips. */
export const CHAT_FILTERS: readonly ChatFilter[] = Object.freeze([
  'all',
  'repo',
  'schedule',
  'unread',
  'archived',
]);

/** Secure-store key for the per-device read markers. Shape: `Record<chatId, iso8601>`. */
export const CHAT_READ_KEY = 'cb.chatRead';

const CHAT_READ_LIMIT = 200;
const SESSIONS_LIMIT = 50;

const COST_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const TOKENS_FORMAT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export interface ChatRowOptions {
  readonly repoSlug: string | null;
  readonly unread: boolean;
  readonly unreviewed: boolean;
  readonly locale: Locale;
}

export function sessionKind(session: ChatSession): ChatScope {
  return session.kind ?? 'repo';
}

export function isUnread(session: ChatSession, readAt: string | null): boolean {
  if (session.status === 'archived') return false;
  const message = session.lastMessage;
  if (message === null || message.role !== 'assistant') return false;
  if (readAt === null) return true;
  const messageAt = Date.parse(message.createdAt);
  const readTime = Date.parse(readAt);
  if (Number.isNaN(messageAt) || Number.isNaN(readTime)) return true;
  return messageAt > readTime;
}

export function isUnreviewed(session: ChatSession): boolean {
  return (
    session.status !== 'archived' &&
    sessionKind(session) !== 'free' &&
    (session.reviewedAt === null || session.reviewedAt === undefined) &&
    session.lastMessage?.role === 'assistant'
  );
}

export function chatFilterMatches(
  filter: ChatFilter,
  session: ChatSession,
  unread: boolean,
): boolean {
  switch (filter) {
    case 'all':
      return session.status !== 'archived';
    case 'repo':
      return session.status !== 'archived' && sessionKind(session) === 'repo';
    case 'schedule':
      return session.status !== 'archived' && sessionKind(session) === 'schedule';
    case 'unread':
      return session.status !== 'archived' && unread;
    case 'archived':
      return session.status === 'archived';
  }
}

export function buildChatRow(session: ChatSession, options: ChatRowOptions): ChatRowView {
  const scope = sessionKind(session);
  const usd = session.usage?.usd ?? 0;
  const tokens = session.contextTokens ?? 0;
  const preview = session.lastMessage?.text;
  return {
    id: session.id,
    title: session.title,
    preview:
      preview === undefined || preview === ''
        ? translate(options.locale, 'chat.row.noMessage')
        : preview,
    scope,
    scopeLabel: scopeLabel(scope, options),
    costLabel: usd > 0 ? formatCost(usd) : null,
    contextLabel:
      tokens > 0
        ? `${formatContextTokens(tokens)} ${translate(options.locale, 'chat.row.context')}`
        : null,
    status: session.status,
    statusLabel: translate(options.locale, `chat.status.${session.status}`),
    unread: options.unread,
    unreviewed: options.unreviewed,
    unreadLabel: translate(options.locale, 'chat.row.unread'),
    unreviewedLabel: translate(options.locale, 'chat.row.unreviewed'),
  };
}

export function formatCost(usd: number): string {
  return COST_FORMAT.format(usd);
}

export function formatContextTokens(tokens: number): string {
  return TOKENS_FORMAT.format(tokens);
}

@Injectable({ providedIn: 'root' })
export class ChatReadStore {
  private readonly secure = inject(SECURE_STORE);
  private readonly marks = signal<Readonly<Record<string, string>>>({});
  private readonly loadedSignal = signal(false);
  private loading: Promise<void> | null = null;

  readonly loaded: Signal<boolean> = this.loadedSignal.asReadonly();

  load(): Promise<void> {
    this.loading ??= this.read();
    return this.loading;
  }

  readAt(chatId: string): string | null {
    return this.marks()[chatId] ?? null;
  }

  markRead(chatId: string, at: string): void {
    const next = prune({ ...this.marks(), [chatId]: at });
    this.marks.set(next);
    void this.secure.set(CHAT_READ_KEY, JSON.stringify(next)).catch(() => undefined);
  }

  snapshot(): Readonly<Record<string, string>> {
    return Object.freeze({ ...this.marks() });
  }

  private async read(): Promise<void> {
    try {
      this.marks.set(parseMarks(await this.secure.get(CHAT_READ_KEY)));
    } catch {
      this.marks.set({});
    } finally {
      this.loadedSignal.set(true);
    }
  }
}

@Injectable()
export class ChatListStore {
  readonly sessions = signal<readonly ChatSession[]>([]);
  readonly repos = signal<readonly Repo[]>([]);
  readonly filter = signal<ChatFilter>('all');
  readonly search = signal('');
  readonly rows: Signal<readonly ChatRowView[]> = computed(() => this.buildRows());
  readonly total: Signal<number> = computed(() => this.sessions().length);
  readonly loading = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly creating = signal(false);

  private readonly api = inject(ChatApi);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private readonly read = inject(ChatReadStore);
  private readonly i18n = inject(I18nService);

  load(): void {
    this.loadRepos();
    void this.read.load().then(() => this.loadSessions());
  }

  setFilter(next: ChatFilter): void {
    this.filter.set(next);
  }

  setSearch(text: string): void {
    this.search.set(text);
  }

  markRead(chatId: string): void {
    const session = this.sessions().find((candidate) => candidate.id === chatId);
    if (session === undefined) return;
    this.read.markRead(chatId, session.lastMessage?.createdAt ?? session.updatedAt);
  }

  startChat(): void {
    if (this.creating()) return;
    this.creating.set(true);
    this.api
      .createSession({})
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
      sortByActivity(
        sessions.map((session) =>
          session.id === chatId
            ? { ...session, lastMessage: message, updatedAt: message.createdAt }
            : session,
        ),
      ),
    );
    return 'applied';
  }

  private buildRows(): readonly ChatRowView[] {
    const locale = this.i18n.locale();
    const filter = this.filter();
    const term = this.search().trim().toLowerCase();
    const slugs = new Map(this.repos().map((repo) => [repo.id, repo.slug]));
    const rows: ChatRowView[] = [];
    for (const session of this.sessions()) {
      const unread = isUnread(session, this.read.readAt(session.id));
      if (!chatFilterMatches(filter, session, unread)) continue;
      if (term !== '' && !matchesSearch(session, term)) continue;
      rows.push(
        buildChatRow(session, {
          repoSlug: session.repoId === null ? null : (slugs.get(session.repoId) ?? null),
          unread,
          unreviewed: isUnreviewed(session),
          locale,
        }),
      );
    }
    return rows;
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
    this.loading.set(true);
    this.api
      .listSessions({ limit: SESSIONS_LIMIT })
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

function scopeLabel(scope: ChatScope, options: ChatRowOptions): string {
  switch (scope) {
    case 'free':
      return translate(options.locale, 'chat.scope.free');
    case 'schedule':
      return translate(options.locale, 'chat.scope.schedule');
    case 'repo':
      return options.repoSlug ?? translate(options.locale, 'chat.scope.repo');
  }
}

function matchesSearch(session: ChatSession, term: string): boolean {
  if (session.title.toLowerCase().includes(term)) return true;
  return (session.lastMessage?.text ?? '').toLowerCase().includes(term);
}

function sortByActivity(sessions: readonly ChatSession[]): readonly ChatSession[] {
  return [...sessions].sort((left, right) => {
    const byUpdated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (byUpdated !== 0) return byUpdated;
    if (left.id === right.id) return 0;
    return left.id < right.id ? 1 : -1;
  });
}

function parseMarks(stored: string | null): Record<string, string> {
  if (stored === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const marks: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) continue;
    marks[key] = value;
  }
  return marks;
}

function prune(marks: Record<string, string>): Record<string, string> {
  const entries = Object.entries(marks);
  if (entries.length <= CHAT_READ_LIMIT) return marks;
  entries.sort((left, right) => Date.parse(right[1]) - Date.parse(left[1]));
  return Object.fromEntries(entries.slice(0, CHAT_READ_LIMIT));
}

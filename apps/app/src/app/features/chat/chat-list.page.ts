import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { ChatSession } from '@codebox/contracts';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { ChatListStore } from './chat-list.store';
import { translate } from './i18n';

interface SessionGroup {
  readonly repoId: string | null;
  readonly label: string;
  readonly sessions: readonly ChatSession[];
}

@Component({
  selector: 'app-chat-list-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ChatListStore],
  styles: [
    `
      .cb-chat-head {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
        margin-block-end: calc(var(--cb-space) * 4);
      }
      .cb-chat-head label {
        font-size: 0.85rem;
        color: var(--cb-muted);
      }
      .cb-chat-group {
        margin-block-start: calc(var(--cb-space) * 4);
      }
      .cb-chat-group h2 {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-chat-rows {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-chat-row {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) / 2);
        inline-size: 100%;
        padding: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        background: var(--cb-surface);
        color: var(--cb-text);
        text-align: start;
        overflow-wrap: anywhere;
      }
      .cb-chat-row-last {
        color: var(--cb-muted);
        font-size: 0.9rem;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('chat.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-chat">
        <div class="cb-chat-head">
          <label for="cb-repo-filter">{{ t('chat.filter.label') }}</label>
          <select id="cb-repo-filter" data-testid="repo-filter" (change)="onRepoFilter($event)">
            <option value="" [selected]="store.repoFilter() === null">
              {{ t('chat.filter.all') }}
            </option>
            @for (repo of store.repos(); track repo.id) {
              <option
                data-testid="repo-option"
                [attr.data-repo-id]="repo.id"
                [value]="repo.id"
                [selected]="store.repoFilter() === repo.id"
                (click)="onRepoOption(repo.id)"
              >
                {{ repo.slug }}
              </option>
            }
          </select>
          <button
            type="button"
            data-testid="chat-new"
            [disabled]="store.repos().length === 0 || store.creating()"
            (click)="store.startChat()"
          >
            {{ t('chat.action.new') }}
          </button>
        </div>

        @if (store.loading()) {
          <div data-testid="chat-list-loading">{{ t('chat.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div data-testid="chat-list-error" [attr.data-code]="failure.code">
            <p>{{ t('chat.error.list') }}</p>
            <button type="button" data-testid="chat-list-retry" (click)="store.load()">
              {{ t('chat.action.retry') }}
            </button>
          </div>
        }

        @if (!store.loading() && store.error() === null && store.sessions().length === 0) {
          <p data-testid="chat-empty">{{ t('chat.empty.list') }}</p>
        }

        @for (group of groups(); track group.repoId) {
          <section class="cb-chat-group">
            <h2>{{ group.label }}</h2>
            <ul class="cb-chat-rows">
              @for (session of group.sessions; track session.id) {
                <li>
                  <button
                    type="button"
                    class="cb-chat-row"
                    data-testid="chat-row"
                    [attr.data-chat-id]="session.id"
                    [attr.data-status]="session.status"
                    (click)="open(session.id)"
                  >
                    <span>{{ session.title }}</span>
                    <span data-testid="chat-row-last" class="cb-chat-row-last">
                      {{ session.lastMessage?.text ?? t('chat.row.noMessage') }}
                    </span>
                    <span class="cb-mono">{{ statusLabel(session.status) }}</span>
                  </button>
                </li>
              }
            </ul>
          </section>
        }
      </div>
    </ion-content>
  `,
})
export class ChatListPage {
  readonly store = inject(ChatListStore);

  private readonly sse = inject(SseService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  readonly groups = computed<readonly SessionGroup[]>(() => {
    const repos = new Map(this.store.repos().map((repo) => [repo.id, repo.slug]));
    const groups = new Map<string | null, ChatSession[]>();
    for (const session of this.store.sessions()) {
      const bucket = groups.get(session.repoId);
      if (bucket === undefined) groups.set(session.repoId, [session]);
      else bucket.push(session);
    }
    return [...groups.entries()].map(([repoId, sessions]) => ({
      repoId,
      label:
        (repoId === null ? undefined : repos.get(repoId)) ??
        translate(this.i18n.locale(), 'chat.group.unknown'),
      sessions,
    }));
  });

  constructor() {
    this.store.load();
    effect(() => {
      const event = this.sse.event();
      if (event === null) return;
      untracked(() => this.store.applyStreamEvent(event));
    });
  }

  onRepoFilter(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    this.store.setRepoFilter(target.value === '' ? null : target.value);
  }

  onRepoOption(repoId: string): void {
    this.store.setRepoFilter(repoId);
  }

  statusLabel(status: ChatSession['status']): string {
    return translate(this.i18n.locale(), `chat.status.${status}`);
  }

  open(chatId: string): void {
    void this.router.navigate(['/chat', chatId]);
  }
}

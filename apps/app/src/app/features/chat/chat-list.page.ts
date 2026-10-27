import { ChangeDetectionStrategy, Component, effect, inject, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { ChatRow } from '../../shared/chat-row';
import type { ChatFilter } from './chat-list.store';
import { CHAT_FILTERS, ChatListStore } from './chat-list.store';
import { translate } from './i18n';

@Component({
  selector: 'app-chat-list-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, ChatRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ChatListStore],
  styles: [
    `
      .cb-chat-head {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
        margin-block-end: calc(var(--cb-space) * 2);
      }
      .cb-chat-filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cb-space);
        margin-block-end: calc(var(--cb-space) * 4);
      }
      .cb-chat-rows {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-visually-hidden {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
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
          <label class="cb-visually-hidden" for="cb-chat-search">
            {{ t('chat.search.label') }}
          </label>
          <input
            id="cb-chat-search"
            type="search"
            data-testid="chat-search"
            [value]="store.search()"
            [placeholder]="t('chat.search.placeholder')"
            (input)="onSearch($event)"
          />
          <button
            type="button"
            data-testid="chat-new"
            [disabled]="store.creating()"
            (click)="store.startChat()"
          >
            {{ t('chat.action.new') }}
          </button>
        </div>

        <nav class="cb-chat-filters" data-testid="chat-filters">
          @for (filter of filters; track filter) {
            <button
              type="button"
              data-testid="chat-filter"
              [attr.data-filter]="filter"
              [attr.aria-pressed]="store.filter() === filter"
              (click)="store.setFilter(filter)"
            >
              {{ filterLabel(filter) }}
            </button>
          }
        </nav>

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

        @if (!store.loading() && store.error() === null && store.total() === 0) {
          <p data-testid="chat-empty">{{ t('chat.empty.list') }}</p>
        }

        @if (
          !store.loading() &&
          store.error() === null &&
          store.total() > 0 &&
          store.rows().length === 0
        ) {
          <p data-testid="chat-list-no-match">{{ t('chat.empty.filter') }}</p>
        }

        <ul class="cb-chat-rows">
          @for (row of store.rows(); track row.id) {
            <li><app-chat-row [view]="row" (open)="open($event)" /></li>
          }
        </ul>
      </div>
    </ion-content>
  `,
})
export class ChatListPage {
  readonly store = inject(ChatListStore);
  readonly filters: readonly ChatFilter[] = CHAT_FILTERS;

  private readonly sse = inject(SseService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  constructor() {
    this.store.load();
    effect(() => {
      const event = this.sse.event();
      if (event === null) return;
      untracked(() => this.store.applyStreamEvent(event));
    });
  }

  filterLabel(filter: ChatFilter): string {
    switch (filter) {
      case 'all':
        return this.t('chat.filter.all');
      case 'repo':
        return this.t('chat.filter.repo');
      case 'schedule':
        return this.t('chat.filter.schedule');
      case 'unread':
        return this.t('chat.filter.unread');
      case 'archived':
        return this.t('chat.filter.archived');
    }
  }

  onSearch(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    this.store.setSearch(target.value);
  }

  open(chatId: string): void {
    this.store.markRead(chatId);
    void this.router.navigate(['/chat', chatId]);
  }
}

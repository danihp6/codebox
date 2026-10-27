import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { Signal } from '@angular/core';
import type { ChatSession } from '@codebox/contracts';
import type { ApiError } from '../../core/api/api-client';
import { I18nService } from '../../core/i18n/i18n.service';
import { RepoPicker } from '../repos/repo-picker';
import { translate } from './new-chat.i18n';
import type { NewChatProposal } from './new-chat.store';
import { NewChatStore } from './new-chat.store';

@Component({
  selector: 'app-new-chat',
  standalone: true,
  imports: [RepoPicker],
  providers: [NewChatStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-new-chat {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 4);
        inline-size: 100%;
        max-inline-size: 40rem;
      }
      .cb-new-chat-empty {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
      }
      .cb-new-chat-proposal {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        flex: 1 1 12rem;
        min-block-size: 44px;
        font: inherit;
        color: inherit;
        text-align: start;
        background: var(--cb-surface);
        border: 1px solid var(--cb-muted);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 3);
        overflow-wrap: anywhere;
        cursor: pointer;
      }
      .cb-new-chat-proposal[data-selected='true'] {
        border-color: var(--cb-accent);
      }
      .cb-new-chat-picker-head h2 {
        margin: 0;
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-new-chat-composer {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
      }
      .cb-new-chat-composer label {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-new-chat-composer textarea {
        font: inherit;
        color: inherit;
        background: var(--cb-surface);
        border: 1px solid var(--cb-muted);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 2);
        inline-size: 100%;
        resize: vertical;
      }
      .cb-new-chat-composer button {
        align-self: flex-start;
        min-block-size: 44px;
      }
      .cb-unavailable {
        border: 1px dashed var(--cb-muted);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 2);
        color: var(--cb-muted);
      }
      .cb-muted {
        color: var(--cb-muted);
      }
      .cb-mono {
        font-family: var(--cb-font-mono);
        overflow-wrap: anywhere;
      }
    `,
  ],
  template: `
    <section
      class="cb-new-chat"
      data-testid="new-chat-panel"
      [attr.data-chat-id]="chatId() ?? ''"
      [attr.data-converting]="store.converting()"
    >
      @if (chatId() === null) {
        <div
          class="cb-new-chat-empty"
          data-testid="new-chat-empty"
          [attr.data-proposals]="store.proposals().length"
          [attr.data-chosen]="chosen() ?? ''"
        >
          @for (proposal of store.proposals(); track proposal) {
            <button
              type="button"
              class="cb-new-chat-proposal"
              data-testid="new-chat-proposal"
              [attr.data-proposal]="proposal"
              [attr.data-selected]="chosen() === proposal"
              (click)="onProposal(proposal)"
            >
              <strong>{{ t('newChat.proposal.' + proposal) }}</strong>
              <span class="cb-muted">{{ t('newChat.proposal.' + proposal + '.hint') }}</span>
            </button>
          }
        </div>
      }

      <div class="cb-new-chat-picker-head">
        <h2>{{ t('newChat.picker.title') }}</h2>
      </div>

      @if (store.reposLoading()) {
        <div data-testid="new-chat-repos-loading" aria-busy="true">
          {{ t('newChat.picker.loading') }}
        </div>
      } @else if (store.reposUnavailable()) {
        <div class="cb-unavailable" role="alert" data-testid="new-chat-repos-unavailable">
          <p>{{ t('newChat.picker.unavailable') }}</p>
          <button type="button" data-testid="new-chat-repos-retry" (click)="store.loadRepos()">
            {{ t('newChat.picker.retry') }}
          </button>
        </div>
      } @else if (store.repos().length === 0 && pickerReady()) {
        <p class="cb-muted" data-testid="new-chat-repos-empty">{{ t('newChat.picker.empty') }}</p>
      }

      <app-repo-picker
        [repos]="store.repos()"
        [busyRepoId]="store.busyRepoId()"
        (picked)="onPick($event)"
      />

      @if (store.error(); as failure) {
        <div
          class="cb-unavailable"
          role="alert"
          data-testid="new-chat-error"
          [attr.data-code]="failure.code"
          [attr.data-reason]="failureReason(failure) ?? ''"
        >
          <p class="cb-mono">{{ failureReason(failure) ?? failure.code }}</p>
          <p>{{ t('newChat.error.hint') }}</p>
        </div>
      }

      <div class="cb-new-chat-composer">
        @if (store.converting()) {
          <p class="cb-muted" data-testid="new-chat-converting" aria-live="polite">
            {{ t('newChat.composer.converting') }}
          </p>
        }
        <label for="cb-new-chat-draft">{{ t('newChat.composer.label') }}</label>
        <textarea
          id="cb-new-chat-draft"
          data-testid="new-chat-draft"
          rows="3"
          autocomplete="off"
          [attr.placeholder]="t('newChat.composer.placeholder')"
          [value]="store.draft()"
          [disabled]="store.converting()"
          (input)="onDraft($event)"
        ></textarea>
        <button
          type="button"
          data-testid="new-chat-send"
          [disabled]="!canSend()"
          (click)="onSend()"
        >
          {{ t('newChat.composer.send') }}
        </button>
      </div>
    </section>
  `,
})
export class NewChatPanel {
  readonly chatId = input<string | null>(null);
  readonly created = output<ChatSession>();
  readonly handoff = output<ChatSession>();

  readonly store = inject(NewChatStore);

  private readonly i18n = inject(I18nService);
  private readonly chosenState = signal<NewChatProposal | null>(null);
  private readonly openedState = signal(false);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);
  readonly chosen: Signal<NewChatProposal | null> = this.chosenState.asReadonly();
  readonly pickerReady: Signal<boolean> = computed(
    () => this.chatId() !== null || this.openedState(),
  );

  constructor() {
    effect(() => {
      const session = this.store.created();
      if (session === null) return;
      untracked(() => this.created.emit(session));
    });
    effect(() => {
      const session = this.store.handoff();
      if (session === null) return;
      untracked(() => this.handoff.emit(session));
    });
  }

  onProposal(proposal: NewChatProposal): void {
    this.chosenState.set(proposal);
    if (proposal !== 'repository') return;
    this.openedState.set(true);
    this.store.loadRepos();
  }

  onPick(repoId: string): void {
    const chatId = this.chatId();
    if (chatId === null) {
      this.store.connect(repoId);
      return;
    }
    this.store.bind(chatId, repoId);
  }

  onDraft(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    this.store.setDraft(target.value);
  }

  onSend(): void {
    this.store.createFree();
  }

  canSend(): boolean {
    return !this.store.converting() && this.store.draft().trim() !== '';
  }

  failureReason(error: ApiError): string | null {
    const reason = error.details?.['reason'];
    return typeof reason === 'string' && reason !== '' ? reason : null;
  }
}

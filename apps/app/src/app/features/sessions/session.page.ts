import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { Session, SessionMessage } from '@codebox/contracts';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './i18n';
import { parseMarkdown } from './markdown';
import type { MarkdownBlock } from './markdown';
import { SessionStore } from './session.store';

@Component({
  selector: 'app-session-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [SessionStore],
  styles: [
    `
      .cb-session-head {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: baseline;
        overflow-wrap: anywhere;
      }
      .cb-session-target {
        font-family: var(--cb-font-mono);
      }
      .cb-session-messages {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 3);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-session-message {
        padding: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        background: var(--cb-surface);
        overflow-wrap: anywhere;
      }
      .cb-session-message[data-role='user'] {
        border-color: var(--cb-accent);
      }
      .cb-session-message p {
        margin: 0 0 calc(var(--cb-space) * 2);
        white-space: pre-wrap;
      }
      .cb-session-code {
        margin: 0 0 calc(var(--cb-space) * 2);
        padding: calc(var(--cb-space) * 2);
        overflow-x: auto;
        border-radius: var(--cb-radius);
        background: var(--cb-bg);
      }
      .cb-session-tools {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin-block: calc(var(--cb-space) * 3);
      }
      .cb-session-tool {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cb-space);
        align-items: center;
        padding: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-muted);
        border-radius: var(--cb-radius);
        overflow-wrap: anywhere;
      }
      .cb-session-tool[data-status='ok'] {
        border-color: var(--cb-accent);
      }
      .cb-session-tool[data-status='error'] {
        border-color: var(--cb-danger);
      }
      .cb-session-proposal {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        margin-block-start: calc(var(--cb-space) * 4);
        padding: calc(var(--cb-space) * 3);
        border: 1px solid var(--cb-accent);
        border-radius: var(--cb-radius);
        overflow-wrap: anywhere;
      }
      .cb-session-proposal ul {
        margin: 0;
        padding-inline-start: calc(var(--cb-space) * 4);
      }
      .cb-session-composer {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        margin-block-start: calc(var(--cb-space) * 4);
      }
      .cb-session-composer textarea {
        min-block-size: 4rem;
        padding: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-muted);
        border-radius: var(--cb-radius);
        background: var(--cb-surface);
        color: var(--cb-text);
        font-family: inherit;
      }
      .cb-session-actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
      }
      .cb-muted {
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ store.session()?.title ?? t('session.loading') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-session" [attr.data-session-id]="id()">
        @if (store.loading()) {
          <div data-testid="session-loading">{{ t('session.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div data-testid="session-error" [attr.data-code]="failure.code">
            <p>{{ t('session.error') }}</p>
            <button type="button" data-testid="session-retry" (click)="store.reload()">
              {{ t('session.retry') }}
            </button>
          </div>
        }

        @if (store.session(); as session) {
          <header class="cb-session-head" data-testid="session-header">
            <span>{{ t('session.target') }}:</span>
            <span class="cb-session-target" data-testid="session-target" [attr.data-target]="session.target">
              {{ targetLabel(session) }}
            </span>
            @if (session.status === 'archived') {
              <span class="cb-muted" data-testid="session-archived">{{ t('session.archived') }}</span>
            }
            @if (store.thread().working) {
              <span class="cb-muted" data-testid="session-working">{{ t('session.working') }}</span>
            }
          </header>
        }

        @if (store.thread().messages.length === 0) {
          <p data-testid="session-empty">{{ t('session.empty') }}</p>
        } @else {
          <ol class="cb-session-messages">
            @for (message of store.thread().messages; track message.id) {
              <li
                class="cb-session-message"
                data-testid="session-message"
                [attr.data-role]="message.role"
                [attr.data-message-id]="message.id"
              >
                @for (block of blocks(message); track $index) {
                  @if (block.kind === 'code') {
                    <pre
                      class="cb-session-code"
                      data-testid="session-code"
                      [attr.data-language]="block.language"
                    ><code class="cb-mono">{{ block.text }}</code></pre>
                  } @else if (block.kind === 'list') {
                    <ul data-testid="session-list-block">
                      @for (entry of block.items; track $index) {
                        <li>{{ entry }}</li>
                      }
                    </ul>
                  } @else {
                    <p>{{ block.text }}</p>
                  }
                }
              </li>
            }
          </ol>
        }

        @if (store.thread().tools.length > 0) {
          <div class="cb-session-tools">
            @for (tool of store.thread().tools; track tool.key) {
              <div
                class="cb-session-tool"
                data-testid="session-tool"
                [attr.data-tool]="tool.tool"
                [attr.data-status]="tool.status"
              >
                <span class="cb-mono">{{ tool.tool }}</span>
                <span>{{ t('session.tool.' + tool.status) }}</span>
                @if (tool.detail !== null) {
                  <span class="cb-mono cb-muted">{{ tool.detail }}</span>
                }
              </div>
            }
          </div>
        }

        @if (store.pendingProposal(); as proposal) {
          @if (store.session()?.target !== 'repo') {
            <section
              class="cb-session-proposal"
              data-testid="session-proposal"
              [attr.data-sha]="proposal.sha"
            >
              <h2>{{ t('session.proposal') }}</h2>
              <p>
                <span>{{ t('session.proposal.branch') }}:</span>
                <span class="cb-mono" data-testid="session-proposal-branch">{{ proposal.branch }}</span>
              </p>
              <p>
                <span class="cb-mono">{{ proposal.sha }}</span>
              </p>
              <p>{{ t('session.proposal.paths') }}:</p>
              <ul data-testid="session-proposal-paths">
                @for (path of proposal.paths; track path) {
                  <li class="cb-mono" data-testid="session-proposal-path">{{ path }}</li>
                }
              </ul>
              <button
                type="button"
                data-testid="session-merge"
                [disabled]="store.busy() !== null"
                (click)="store.merge()"
              >
                {{
                  store.busy() === 'merge'
                    ? t('session.proposal.merging')
                    : t('session.proposal.merge')
                }}
              </button>
            </section>
          }
        }

        @if (store.mergeError(); as failure) {
          <p data-testid="session-merge-error" [attr.data-code]="failure.code">
            {{ t('session.proposal.error') }} <span class="cb-mono">{{ failure.code }}</span>
          </p>
        }

        <div class="cb-session-composer">
          <label class="cb-muted" for="session-composer">{{ t('session.composer.label') }}</label>
          <textarea
            id="session-composer"
            data-testid="session-composer"
            [attr.placeholder]="t('session.composer.placeholder')"
            [attr.aria-label]="t('session.composer.label')"
            [disabled]="composerDisabled()"
            [value]="store.draft()"
            (input)="onInput($event)"
          ></textarea>
          @if (store.blocked()) {
            <p class="cb-muted" data-testid="session-composer-blocked">
              {{ t('session.composer.blocked') }}
            </p>
          }
          <div class="cb-session-actions">
            <button
              type="button"
              data-testid="session-send"
              [disabled]="composerDisabled() || store.busy() !== null"
              (click)="store.send()"
            >
              {{ t('session.composer.send') }}
            </button>
            <button
              type="button"
              data-testid="session-stop"
              [disabled]="store.busy() !== null"
              (click)="store.interrupt()"
            >
              {{ t('session.composer.stop') }}
            </button>
          </div>
        </div>
      </div>
    </ion-content>
  `,
})
export class SessionPage {
  readonly id = input.required<string>();
  readonly store = inject(SessionStore);

  private readonly sse = inject(SseService);
  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  constructor() {
    effect(() => {
      const candidate = this.id();
      untracked(() => this.store.load(candidate));
    });
    effect(() => {
      const event = this.sse.event();
      if (event === null) return;
      untracked(() => {
        if (this.store.applyEvent(event) === 'refetch') this.store.reload();
      });
    });
  }

  blocks(message: SessionMessage): readonly MarkdownBlock[] {
    return parseMarkdown(message.text);
  }

  /** docs/app.md §8: while a proposal is pending the composer is disabled, one change at a time. */
  composerDisabled(): boolean {
    return this.store.blocked();
  }

  targetLabel(session: Session): string {
    if (session.target === 'work') {
      return `${session.workId ?? ''} · ${translate(this.i18n.locale(), 'session.target.work')}`;
    }
    return translate(this.i18n.locale(), `session.target.${session.target}`);
  }

  onInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    this.store.setDraft(target.value);
  }
}

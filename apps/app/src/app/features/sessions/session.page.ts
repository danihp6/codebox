import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { Session, SessionMessage } from '@codebox/contracts';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { DesignPreviewCard } from './design-preview.card';
import { translate } from './i18n';
import { parseMarkdown } from './markdown';
import type { MarkdownBlock } from './markdown';
import { SessionStore } from './session.store';

@Component({
  selector: 'app-session-page',
  standalone: true,
  imports: [RouterLink, IonContent, IonHeader, IonTitle, IonToolbar, DesignPreviewCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [SessionStore],
  styles: [
    `
      .cb-sess-back {
        flex: 0 0 auto;
        padding-inline: 6px;
        color: var(--cb-accent);
        font-size: 22px;
        line-height: 27px;
        text-decoration: none;
      }
      .cb-sess-sub {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: baseline;
        min-block-size: 12px;
        margin-block-end: 12px;
        color: var(--cb-muted);
        font-size: 10px;
        line-height: 12px;
      }
      .cb-sess-target {
        font-family: var(--cb-font-mono);
        overflow-wrap: anywhere;
      }
      .cb-sess-commit {
        display: inline-flex;
        gap: 4px;
        align-items: baseline;
      }
      .cb-sess-commit span:last-child {
        overflow-wrap: anywhere;
      }
      .cb-sess-muted {
        color: var(--cb-muted);
      }
      .cb-sess-mono {
        font-family: var(--cb-font-mono);
      }
      .cb-sess-eyebrow {
        margin: 16px 0 8px;
        color: var(--cb-muted);
        font-size: 9px;
        line-height: 11px;
        font-weight: 500;
      }
      .cb-sess-messages {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-sess-message {
        margin-inline-end: auto;
        max-inline-size: 100%;
        color: var(--cb-text);
        font-size: 11px;
        line-height: 13px;
        overflow-wrap: anywhere;
      }
      .cb-sess-message[data-role='user'] {
        margin-inline-start: auto;
        margin-inline-end: 0;
        max-inline-size: 268px;
        padding: 12px 16px;
        border: 1px solid var(--cb-surface);
        border-radius: 12px;
        background: var(--cb-surface);
      }
      .cb-sess-message p {
        margin: 0 0 8px;
        white-space: pre-wrap;
      }
      .cb-sess-message p:last-child {
        margin-block-end: 0;
      }
      .cb-sess-code {
        margin: 0 0 8px;
        padding: 8px;
        overflow-x: auto;
        border-radius: var(--cb-radius);
        background: var(--cb-bg);
        font-size: 10px;
        line-height: 12px;
      }
      .cb-sess-code:last-child {
        margin-block-end: 0;
      }
      .cb-sess-tools {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-block: 16px;
      }
      .cb-sess-tool {
        display: flex;
        gap: 8px;
        align-items: center;
        min-block-size: 40px;
        padding: 8px 14px;
        border: 1px solid var(--cb-surface);
        border-radius: 10px;
        background: var(--cb-surface);
        overflow-wrap: anywhere;
      }
      .cb-sess-dot {
        flex: 0 0 auto;
        inline-size: 6px;
        block-size: 6px;
        border-radius: 3px;
        background: var(--cb-muted);
      }
      .cb-sess-tool[data-status='start'] .cb-sess-dot {
        background: var(--cb-warn);
      }
      .cb-sess-tool[data-status='ok'] .cb-sess-dot {
        background: var(--cb-accent);
      }
      .cb-sess-tool[data-status='error'] .cb-sess-dot {
        background: var(--cb-danger);
      }
      .cb-sess-tool-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-inline-size: 0;
      }
      .cb-sess-tool-name {
        color: var(--cb-muted);
        font-size: 10px;
        line-height: 12px;
        overflow-wrap: anywhere;
      }
      .cb-sess-tool-meta {
        display: flex;
        gap: 4px;
        align-items: baseline;
        color: var(--cb-muted);
        font-size: 9px;
        line-height: 11px;
        overflow-wrap: anywhere;
      }
      .cb-sess-proposal {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-block-start: 16px;
        padding: 12px;
        border: 1px solid var(--cb-accent);
        border-radius: var(--cb-radius);
        overflow-wrap: anywhere;
      }
      .cb-sess-proposal h2 {
        margin: 0;
        font-size: 12px;
        line-height: 15px;
      }
      .cb-sess-proposal p {
        margin: 0;
      }
      .cb-sess-proposal ul {
        margin: 0;
        padding-inline-start: 16px;
      }
      .cb-sess-status {
        display: flex;
        gap: 6px;
        align-items: baseline;
        margin: 16px 0 0;
        color: var(--cb-muted);
        font-size: 10px;
        line-height: 12px;
        overflow-wrap: anywhere;
      }
      .cb-sess-status[data-pending='true'] {
        color: var(--cb-warn);
      }
      .cb-sess-status-dot {
        flex: 0 0 auto;
      }
      .cb-sess-composer {
        margin: 12px -16px 0;
        padding: 12px 16px 0;
        border-block-start: 1px solid var(--cb-surface);
      }
      .composer-bar {
        display: flex;
        gap: 8px;
        align-items: flex-end;
        padding: 10px 16px;
        border: 1px solid var(--cb-surface);
        border-radius: 12px;
        background: var(--cb-surface);
      }
      .cb-sess-input {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 4px;
        min-inline-size: 0;
      }
      .composer-bar textarea {
        min-block-size: 36px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--cb-text);
        font-family: inherit;
        font-size: 12px;
        line-height: 15px;
        resize: none;
      }
      .composer-bar textarea::placeholder {
        color: var(--cb-muted);
      }
      .cb-sess-blocked {
        margin: 0;
        color: var(--cb-muted);
        font-size: 9px;
        line-height: 11px;
      }
      .cb-sess-actions {
        display: flex;
        flex: 0 0 auto;
        flex-direction: column;
        gap: 4px;
      }
      .cb-sess-actions button {
        min-block-size: 32px;
        padding-inline: 10px;
        font: inherit;
        font-size: 10px;
        cursor: pointer;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <a
          class="cb-sess-back"
          slot="start"
          data-testid="session-back"
          [routerLink]="backLink()"
          [attr.aria-label]="t('session.back')"
          >‹</a
        >
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
          <header
            class="cb-sess-sub"
            data-testid="session-header"
            [attr.aria-label]="t('session.target')"
          >
            <span
              class="cb-sess-target"
              data-testid="session-target"
              [attr.data-target]="session.target"
              >{{ targetLabel(session) }}</span
            >
            @if (store.pendingProposal(); as proposal) {
              <span
                class="cb-sess-commit"
                data-testid="session-commit"
                [attr.data-revision]="proposal.sha"
              >
                <span>{{ t('session.commit') }}</span>
                <span class="cb-sess-mono">{{ proposal.sha }}</span>
              </span>
            }
            @if (session.status === 'archived') {
              <span class="cb-sess-muted" data-testid="session-archived">{{
                t('session.archived')
              }}</span>
            }
            @if (store.thread().working) {
              <span class="cb-sess-muted" data-testid="session-working">{{
                t('session.working')
              }}</span>
            }
          </header>

          @if (session.target === 'design') {
            <app-design-preview-card
              [repoId]="session.repoId"
              [revision]="session.pendingProposal?.sha ?? null"
            />
          }

          <p class="cb-sess-eyebrow" data-testid="session-thread-eyebrow">
            {{ threadEyebrow() }}
          </p>
        }

        @if (store.thread().messages.length === 0) {
          <p data-testid="session-empty">{{ t('session.empty') }}</p>
        } @else {
          <ol class="cb-sess-messages">
            @for (message of store.thread().messages; track message.id) {
              <li
                class="cb-sess-message"
                data-testid="session-message"
                [attr.data-role]="message.role"
                [attr.data-message-id]="message.id"
              >
                @for (block of blocks(message); track $index) {
                  @if (block.kind === 'code') {
                    <pre
                      class="cb-sess-code"
                      data-testid="session-code"
                      [attr.data-language]="block.language"
                    ><code class="cb-sess-mono">{{ block.text }}</code></pre>
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
          <div class="cb-sess-tools">
            @for (tool of store.thread().tools; track tool.key) {
              <div
                class="cb-sess-tool"
                data-testid="session-tool"
                [attr.data-tool]="tool.tool"
                [attr.data-status]="tool.status"
              >
                <span class="cb-sess-dot" aria-hidden="true"></span>
                <span class="cb-sess-tool-text">
                  <span class="cb-sess-tool-name cb-sess-mono">{{ tool.tool }}</span>
                  <span class="cb-sess-tool-meta">
                    <span>{{ t('session.tool.' + tool.status) }}</span>
                    @if (tool.detail !== null) {
                      <span aria-hidden="true">·</span>
                      <span>{{ tool.detail }}</span>
                    }
                  </span>
                </span>
              </div>
            }
          </div>
        }

        @if (store.pendingProposal(); as proposal) {
          @if (store.session()?.target !== 'repo') {
            <section
              class="cb-sess-proposal"
              data-testid="session-proposal"
              [attr.data-sha]="proposal.sha"
            >
              <h2>{{ t('session.proposal') }}</h2>
              <p>
                <span>{{ t('session.proposal.branch') }}:</span>
                <span class="cb-sess-mono" data-testid="session-proposal-branch">{{
                  proposal.branch
                }}</span>
              </p>
              <p>
                <span class="cb-sess-mono">{{ proposal.sha }}</span>
              </p>
              <p>{{ t('session.proposal.paths') }}:</p>
              <ul data-testid="session-proposal-paths">
                @for (path of proposal.paths; track path) {
                  <li class="cb-sess-mono" data-testid="session-proposal-path">{{ path }}</li>
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
            {{ t('session.proposal.error') }} <span class="cb-sess-mono">{{ failure.code }}</span>
          </p>
        }

        @if (store.session()?.target === 'design') {
          <p
            class="cb-sess-status"
            data-testid="session-preview-status"
            [attr.data-pending]="previewPending()"
          >
            <span class="cb-sess-status-dot" aria-hidden="true">●</span>
            <span>{{ t('session.status.preview') }}</span>
            @if (store.pendingProposal(); as proposal) {
              <span aria-hidden="true">·</span>
              <span class="cb-sess-mono" data-testid="session-preview-count">{{
                proposal.paths.length
              }}</span>
              <span>{{ t('session.status.pending') }}</span>
            }
          </p>
        }

        <div class="cb-sess-composer">
          <div class="composer-bar" data-testid="composer-bar">
            <div class="cb-sess-input">
              <textarea
                id="session-composer"
                data-testid="session-composer"
                [attr.placeholder]="
                  store.session()?.target === 'design'
                    ? t('session.composer.placeholder.design')
                    : t('session.composer.placeholder')
                "
                [attr.aria-label]="t('session.composer.label')"
                [disabled]="composerDisabled()"
                [value]="store.draft()"
                (input)="onInput($event)"
              ></textarea>
              @if (store.blocked()) {
                <p class="cb-sess-blocked" data-testid="session-composer-blocked">
                  {{ t('session.composer.blocked') }}
                </p>
              }
            </div>
            <div class="cb-sess-actions">
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

  /** The target is the write boundary (D55); with no session there is nothing to go back to. */
  backLink(): readonly string[] {
    const session = this.store.session();
    return session === null ? ['/dashboard'] : ['/repos', session.repoId];
  }

  threadEyebrow(): string {
    const session = this.store.session();
    return session === null ? 'SESSION' : `SESSION · ${this.targetLabel(session)}`;
  }

  previewPending(): boolean {
    return this.store.pendingProposal() !== null;
  }

  onInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    this.store.setDraft(target.value);
  }
}

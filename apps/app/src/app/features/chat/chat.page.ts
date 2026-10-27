import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { RouterLink } from '@angular/router';
import type { Routine } from '@codebox/contracts';
import { routineNextFire, routineSchedule } from '../jobs/routines-format';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { isRoutineMessage } from './chat-stream';
import type { ChatPermissionCard, ChatSystemCard } from './chat-stream';
import { ChatStore } from './chat.store';
import { translate } from './i18n';
import { parseMarkdown } from './markdown';
import type { MarkdownBlock } from './markdown';

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ChatStore],
  styles: [
    `
      .cb-chat-messages {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 3);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-chat-message {
        padding: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        background: var(--cb-surface);
        overflow-wrap: anywhere;
      }
      .cb-chat-message[data-role='user'] {
        border-color: var(--cb-accent);
      }
      .cb-chat-message p {
        margin: 0 0 calc(var(--cb-space) * 2);
        white-space: pre-wrap;
      }
      .cb-chat-code {
        margin: 0 0 calc(var(--cb-space) * 2);
        padding: calc(var(--cb-space) * 2);
        overflow-x: auto;
        border-radius: var(--cb-radius);
        background: var(--cb-bg);
      }
      .cb-chat-tools,
      .cb-chat-permissions,
      .cb-chat-routines {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin-block: calc(var(--cb-space) * 3);
      }
      .cb-chat-tool,
      .cb-chat-permission,
      .cb-chat-routine {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cb-space);
        align-items: center;
        padding: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-muted);
        border-radius: var(--cb-radius);
      }
      .cb-chat-routine {
        border-color: var(--cb-accent);
      }
      .cb-chat-routine p {
        margin: 0;
        font-weight: 600;
      }
      .cb-chat-tool[data-status='ok'] {
        border-color: var(--cb-accent);
      }
      .cb-chat-tool[data-status='error'] {
        border-color: var(--cb-danger);
      }
      .cb-chat-composer {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: flex-end;
        margin-block-start: calc(var(--cb-space) * 4);
      }
      .cb-chat-composer textarea {
        flex: 1 1 16rem;
        min-block-size: 4rem;
        padding: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-muted);
        border-radius: var(--cb-radius);
        background: var(--cb-surface);
        color: var(--cb-text);
        font-family: inherit;
      }
      .cb-chat-idle {
        color: var(--cb-muted);
        font-size: 0.85rem;
      }
      .cb-chat-system {
        border-style: dashed;
      }
      .cb-chat-promote {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin-block-start: calc(var(--cb-space) * 3);
        padding: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-accent);
        border-radius: var(--cb-radius);
      }
      .cb-chat-promote p {
        margin: 0;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ store.session()?.title ?? t('chat.detail.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-chat-detail" [attr.data-chat-id]="id()" [attr.data-status]="status()">
        @if (store.loading()) {
          <div data-testid="chat-loading">{{ t('chat.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div data-testid="chat-error" [attr.data-code]="failure.code">
            <p>{{ t('chat.error.detail') }}</p>
            <button type="button" data-testid="chat-retry" (click)="store.reload()">
              {{ t('chat.action.retry') }}
            </button>
          </div>
        }

        @if (store.stream().messages.length === 0 && store.stream().system.length === 0) {
          <p data-testid="chat-message-empty">{{ t('chat.empty.messages') }}</p>
        } @else {
          <ol class="cb-chat-messages">
            @for (item of store.stream().messages; track item.key) {
              <li
                class="cb-chat-message"
                data-testid="chat-message"
                [attr.data-key]="item.key"
                [attr.data-role]="item.role"
              >
                @if (item.text === '') {
                  <p>{{ t('chat.message.pending') }}</p>
                } @else {
                  @for (block of blocks(item.text); track $index) {
                    @if (block.kind === 'code') {
                      <pre
                        class="cb-chat-code"
                        data-testid="chat-code"
                        [attr.data-language]="block.language"
                      ><code class="cb-mono">{{ block.text }}</code></pre>
                    } @else if (block.kind === 'list') {
                      <ul data-testid="chat-list-block">
                        @for (entry of block.items; track $index) {
                          <li>{{ entry }}</li>
                        }
                      </ul>
                    } @else {
                      <p>{{ block.text }}</p>
                    }
                  }
                }
                @if (isRoutine(item.messageId)) {
                  <span data-testid="chat-routine-badge">{{ t('chat.routine.badge') }}</span>
                  <a routerLink="/jobs" data-testid="chat-routine-link">
                    {{ t('chat.routine.list') }}
                  </a>
                }
              </li>
            }
            @for (card of store.stream().system; track card.key) {
              <li
                class="cb-chat-message cb-chat-system"
                data-testid="chat-system"
                data-role="system"
                [attr.data-key]="card.key"
                [attr.data-kind]="card.kind"
                [attr.data-run-id]="card.runId"
                [attr.data-status]="card.status"
              >
                <span>{{ t('chat.system.label') }}</span>
                @if (card.kind === 'gate') {
                  <span>{{ t('chat.system.gate') }}</span>
                } @else {
                  <span>{{ t('chat.system.pr') }}</span>
                }
                <span>{{ statusLabel(card) }}</span>
                <span class="cb-mono">{{ card.detail }}</span>
                @if (card.href !== null) {
                  <a
                    data-testid="chat-system-link"
                    [href]="card.href"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {{ card.detail }}
                  </a>
                }
              </li>
            }
          </ol>
        }

        @if (store.stream().routines.length > 0) {
          <div class="cb-chat-routines">
            @for (card of store.stream().routines; track card.key) {
              <div
                class="cb-chat-routine"
                data-testid="chat-routine-card"
                [attr.data-routine-id]="card.routine.id"
                [attr.data-kind]="card.routine.kind"
              >
                <p>{{ t('chat.routine.title') }}</p>
                <span data-testid="chat-routine-kind">
                  @if (card.routine.kind === 'prompt') {
                    {{ t('chat.routine.kind.prompt') }}
                  } @else {
                    {{ t('chat.routine.kind.reminder') }}
                  }
                </span>
                <span>{{ t('chat.routine.local') }}</span>
                <span class="cb-mono" data-testid="chat-routine-local">
                  {{ schedule(card.routine) }}
                </span>
                @if (card.routine.nextFireAt !== null) {
                  <span>{{ t('chat.routine.next') }}</span>
                  <span data-testid="chat-routine-next" [attr.data-at]="card.routine.nextFireAt">
                    {{ nextFire(card.routine) }}
                  </span>
                }
                <a routerLink="/jobs" data-testid="chat-routine-open">
                  {{ t('chat.routine.open') }}
                </a>
              </div>
            }
          </div>
        }

        @if (store.stream().tools.length > 0) {
          <div class="cb-chat-tools">
            @for (tool of store.stream().tools; track tool.key) {
              <div
                class="cb-chat-tool"
                data-testid="chat-tool"
                [attr.data-tool]="tool.tool"
                [attr.data-status]="tool.status"
              >
                <span class="cb-mono">{{ tool.tool }}</span>
                <span class="cb-mono">{{ tool.status }}</span>
                @if (tool.detail !== '') {
                  <span>{{ tool.detail }}</span>
                }
              </div>
            }
          </div>
        }

        @if (store.stream().permissions.length > 0) {
          <div class="cb-chat-permissions">
            @for (permission of store.stream().permissions; track permission.key) {
              <div
                class="cb-chat-permission"
                data-testid="chat-permission"
                [attr.data-approval-id]="permission.approvalId"
                [attr.data-answered]="permission.answered"
              >
                <p>{{ t('chat.permission.title') }}</p>
                <span class="cb-mono">{{ permission.tool }}</span>
                <span>{{ permission.title }}</span>
                <button
                  type="button"
                  data-testid="permission-allow-once"
                  [disabled]="permission.answered"
                  (click)="allow(permission, 'once')"
                >
                  {{ t('chat.permission.allowOnce') }}
                </button>
                <button
                  type="button"
                  data-testid="permission-allow-session"
                  [disabled]="permission.answered"
                  (click)="allow(permission, 'session')"
                >
                  {{ t('chat.permission.allowSession') }}
                </button>
                <button
                  type="button"
                  data-testid="permission-deny"
                  [disabled]="permission.answered"
                  (click)="deny(permission)"
                >
                  {{ t('chat.permission.deny') }}
                </button>
              </div>
            }
          </div>
        }

        @if (!store.stream().working) {
          <p class="cb-chat-idle" data-testid="chat-idle">{{ t('chat.state.idle') }}</p>
        }

        <div class="cb-chat-composer">
          <textarea
            data-testid="composer-input"
            [attr.aria-label]="t('chat.composer.placeholder')"
            [attr.placeholder]="t('chat.composer.placeholder')"
            [value]="store.draft()"
            (input)="onInput($event)"
          ></textarea>
          <button
            type="button"
            data-testid="composer-send"
            [disabled]="store.busy() !== null"
            (click)="store.send()"
          >
            {{ t('chat.action.send') }}
          </button>
          @if (store.canInterrupt()) {
            <button
              type="button"
              data-testid="composer-stop"
              [disabled]="store.busy() !== null"
              (click)="store.interrupt()"
            >
              {{ t('chat.action.stop') }}
            </button>
          }
          @if (store.canPromote()) {
            <button
              type="button"
              data-testid="chat-promote"
              [disabled]="store.busy() !== null"
              (click)="store.openPromote()"
            >
              {{ t('chat.action.promote') }}
            </button>
          }
        </div>

        @if (store.promoting()) {
          <div class="cb-chat-promote" data-testid="chat-promote-confirm">
            <p>{{ t('chat.promote.title') }}</p>
            @if (store.promoteTarget(); as target) {
              <p>
                <span>{{ t('chat.promote.repo') }}</span>
                <span class="cb-mono" data-testid="promote-repo">{{ target.repoSlug }}</span>
              </p>
              <p>
                <span>{{ t('chat.promote.base') }}</span>
                <span class="cb-mono" data-testid="promote-base">{{ target.baseBranch }}</span>
              </p>
              <p>{{ t('chat.promote.prompt') }}</p>
              <p data-testid="promote-prompt">{{ target.prompt }}</p>
            } @else {
              <p data-testid="promote-loading">{{ t('chat.promote.loading') }}</p>
            }
            <button
              type="button"
              data-testid="promote-confirm"
              [disabled]="store.busy() !== null"
              (click)="store.confirmPromote()"
            >
              {{ t('chat.promote.confirm') }}
            </button>
            <button type="button" data-testid="promote-cancel" (click)="store.cancelPromote()">
              {{ t('chat.promote.cancel') }}
            </button>
          </div>
        }
      </div>
    </ion-content>
  `,
})
export class ChatPage {
  readonly id = input.required<string>();
  readonly store = inject(ChatStore);

  private readonly sse = inject(SseService);
  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  readonly status = computed<string>(() => {
    if (this.store.stream().working) return 'working';
    return this.store.session()?.status === 'archived' ? 'archived' : 'idle';
  });

  constructor() {
    effect(() => {
      const candidate = this.id();
      untracked(() => this.store.load(candidate));
    });
    effect(() => {
      const event = this.sse.event();
      if (event === null) return;
      untracked(() => {
        if (this.store.applyRunEvent(event) === 'applied') return;
        if (this.store.applyStreamEvent(event) === 'refetch') this.store.reload();
      });
    });
  }

  blocks(text: string): readonly MarkdownBlock[] {
    return parseMarkdown(text);
  }

  statusLabel(card: ChatSystemCard): string {
    switch (card.status) {
      case 'passed':
        return this.t('chat.system.gate.passed');
      case 'failed':
        return this.t('chat.system.gate.failed');
      case 'skipped':
        return this.t('chat.system.gate.skipped');
      case 'open':
        return this.t('chat.system.pr.open');
      case 'merged':
        return this.t('chat.system.pr.merged');
    }
  }

  schedule(routine: Routine): string {
    return routineSchedule(routine, this.i18n.locale());
  }

  nextFire(routine: Routine): string | null {
    return routineNextFire(routine, this.i18n.locale());
  }

  isRoutine(messageId: string | null): boolean {
    return isRoutineMessage(this.store.stream(), messageId);
  }

  onInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    this.store.setDraft(target.value);
  }

  allow(permission: ChatPermissionCard, scope: 'once' | 'session'): void {
    if (permission.answered) return;
    this.store.resolvePermission(permission.approvalId, { decision: 'allow', scope });
  }

  deny(permission: ChatPermissionCard): void {
    if (permission.answered) return;
    this.store.resolvePermission(permission.approvalId, { decision: 'deny', scope: 'once' });
  }
}

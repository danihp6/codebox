import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type ChatScope = 'free' | 'repo' | 'schedule';

/** Everything the row renders. All copy is already translated: the row imports no dictionary. */
export interface ChatRowView {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly scope: ChatScope;
  readonly scopeLabel: string;
  readonly costLabel: string | null;
  readonly contextLabel: string | null;
  readonly status: 'idle' | 'working' | 'archived';
  readonly statusLabel: string;
  readonly unread: boolean;
  readonly unreviewed: boolean;
  readonly unreadLabel: string;
  readonly unreviewedLabel: string;
}

@Component({
  selector: 'app-chat-row',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        min-inline-size: 0;
      }
      .cb-chat-row {
        display: grid;
        gap: calc(var(--cb-space) / 2);
        inline-size: 100%;
        min-inline-size: 0;
        overflow-wrap: anywhere;
        text-align: start;
        padding: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        background: var(--cb-surface);
        color: var(--cb-text);
      }
      .cb-chat-row-preview {
        color: var(--cb-muted);
      }
      .cb-chat-row-flow {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cb-space);
        align-items: baseline;
        min-inline-size: 0;
        color: var(--cb-muted);
      }
      .cb-chat-row-unreviewed {
        border-inline-start: 2px solid var(--cb-warn);
      }
      .cb-chat-row-dot {
        inline-size: 8px;
        block-size: 8px;
        border-radius: 50%;
        background: var(--cb-accent);
      }
      .cb-chat-row-status {
        font-family: var(--cb-font-mono);
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
    <button
      type="button"
      class="cb-chat-row"
      data-testid="chat-row"
      [attr.data-chat-id]="view().id"
      [attr.data-scope]="view().scope"
      [attr.data-status]="view().status"
      [attr.data-unread]="view().unread ? 'true' : 'false'"
      [attr.data-unreviewed]="view().unreviewed ? 'true' : 'false'"
      [class.cb-chat-row-unreviewed]="view().unreviewed"
      (click)="open.emit(view().id)"
    >
      <span data-testid="chat-row-title">{{ view().title }}</span>
      <span class="cb-chat-row-preview" data-testid="chat-row-preview">{{ view().preview }}</span>
      <span class="cb-chat-row-flow" data-testid="chat-row-flow">
        @if (view().unread) {
          <span
            class="cb-chat-row-dot"
            data-testid="chat-row-unread"
            role="img"
            [attr.aria-label]="view().unreadLabel"
          ></span>
        }
        <span class="cb-chat-row-scope" data-testid="chat-row-scope">{{ view().scopeLabel }}</span>
        @if (view().costLabel; as cost) {
          <span class="cb-chat-row-cost cb-mono" data-testid="chat-row-cost">{{ cost }}</span>
        }
        @if (view().contextLabel; as context) {
          <span class="cb-chat-row-context cb-mono" data-testid="chat-row-context">{{
            context
          }}</span>
        }
        <span class="cb-chat-row-status" data-testid="chat-row-status">{{
          view().statusLabel
        }}</span>
        @if (view().unreviewed) {
          <span
            class="cb-visually-hidden"
            data-testid="chat-row-unreviewed"
            role="img"
            [attr.aria-label]="view().unreviewedLabel"
          ></span>
        }
      </span>
    </button>
  `,
})
export class ChatRow {
  readonly view = input.required<ChatRowView>();
  readonly open = output<string>();
}

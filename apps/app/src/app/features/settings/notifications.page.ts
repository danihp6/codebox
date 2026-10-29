import { ChangeDetectionStrategy, Component, inject, linkedSignal, output } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './notifications.i18n';
import { NOTIFICATION_EVENTS, NotificationsStore } from './notifications.store';
import type { NotificationEvent } from './notifications.store';

@Component({
  selector: 'app-notifications-panel',
  standalone: true,
  providers: [NotificationsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-notifications-events {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-notifications-events label {
        display: flex;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
        min-block-size: 44px;
      }
      .cb-notifications-events input {
        inline-size: 1.25rem;
        block-size: 1.25rem;
      }
      .cb-notifications-locked {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        border: 1px dashed var(--cb-muted);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 2);
      }
      .cb-notifications-quiet {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
        margin-block-start: calc(var(--cb-space) * 2);
      }
      .cb-notifications-quiet input {
        font: inherit;
        color: inherit;
        background: var(--cb-surface);
        border: 1px solid var(--cb-muted);
        border-radius: calc(var(--cb-radius) / 2);
        padding: calc(var(--cb-space) * 2);
        min-inline-size: 14rem;
      }
      .cb-muted {
        color: var(--cb-muted);
      }
      .cb-mono {
        font-family: var(--cb-font-mono);
        overflow-wrap: anywhere;
      }
      .cb-unavailable {
        border: 1px dashed var(--cb-muted);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 3);
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <div data-testid="notifications-panel" data-events="5" data-locked="credential.changed">
      <h3>{{ t('notifications.title') }}</h3>

      @if (store.loading()) {
        <div data-testid="notifications-loading" aria-busy="true">…</div>
      }

      @if (store.error(); as failure) {
        <div
          class="cb-unavailable"
          role="alert"
          data-testid="notifications-error"
          [attr.data-code]="failure.code"
        >
          <p class="cb-mono">{{ failure.code }}</p>
          <button type="button" data-testid="notifications-retry" (click)="store.reload()">
            {{ t('notifications.retry') }}
          </button>
        </div>
      }

      <ul class="cb-notifications-events">
        @for (event of events; track event) {
          <li>
            <label>
              <input
                type="checkbox"
                [attr.data-testid]="'notifications-toggle-' + event"
                [attr.data-enabled]="isEnabled(event)"
                [checked]="isEnabled(event)"
                (change)="onToggle(event, $event)"
              />
              <span>{{ t('notifications.title.' + event) }}</span>
            </label>
          </li>
        }
      </ul>

      <div
        class="cb-notifications-locked"
        data-testid="notifications-locked-credential"
        data-locked="true"
      >
        <span>{{ t('notifications.locked.title') }}</span>
        <span class="cb-muted">{{ t('notifications.locked.hint') }}</span>
      </div>

      <div class="cb-notifications-quiet">
        <label for="cb-notifications-quiet">{{ t('notifications.quiet.title') }}</label>
        <input
          id="cb-notifications-quiet"
          data-testid="notifications-quiet-hours"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="22:00-07:00"
          [attr.data-quiet-hours]="store.preferences()?.quietHours ?? ''"
          [value]="quietHours()"
          (input)="onQuietInput($event)"
        />
        <button
          type="button"
          data-testid="notifications-quiet-save"
          [disabled]="store.saving() === 'quiet'"
          (click)="saveQuietHours()"
        >
          {{ t('notifications.quiet.save') }}
        </button>
      </div>
      <p class="cb-muted">{{ t('notifications.quiet.hint') }}</p>

      <p
        data-testid="notifications-quiet-current"
        [attr.data-quiet-hours]="store.preferences()?.quietHours ?? ''"
        [attr.data-mirror]="store.mirror() ?? ''"
      >
        @if (store.preferences()?.quietHours; as saved) {
          <span class="cb-mono">{{ saved }}</span>
        } @else {
          {{ t('notifications.quiet.none') }}
        }
        @switch (store.mirror()) {
          @case ('synced') {
            {{ t('notifications.quiet.saved') }}
          }
          @case ('absent') {
            {{ t('notifications.quiet.absent') }}
          }
          @case ('failed') {
            {{ t('notifications.quiet.failed') }}
          }
        }
      </p>

      <button type="button" data-testid="notifications-close" (click)="close()">
        {{ t('notifications.close') }}
      </button>
    </div>
  `,
})
export class NotificationsPanel {
  readonly store = inject(NotificationsStore);
  readonly closed = output<void>();
  readonly events = NOTIFICATION_EVENTS;

  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  readonly quietHours = linkedSignal(() => this.store.preferences()?.quietHours ?? '');

  constructor() {
    this.store.load();
  }

  isEnabled(event: NotificationEvent): boolean {
    return this.store.preferences()?.events.includes(event) ?? false;
  }

  onToggle(event: NotificationEvent, change: Event): void {
    const target = change.target;
    if (!(target instanceof HTMLInputElement)) return;
    this.store.toggle(event, target.checked);
  }

  onQuietInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    this.quietHours.set(target.value);
  }

  saveQuietHours(): void {
    this.store.saveQuietHours(this.quietHours());
  }

  close(): void {
    this.closed.emit();
  }
}

@Component({
  selector: 'app-notifications-page',
  standalone: true,
  imports: [NotificationsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-notifications-panel />`,
})
export class NotificationsPage {}

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonToolbar } from '@ionic/angular';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './notifications.i18n';
import { NOTIFICATION_EVENTS, NotificationsStore } from './notifications.store';
import type { NotificationEvent } from './notifications.store';

/**
 * Frame `17 · Settings / Notifications` draws the panel's body; the routed page draws the
 * header above it. Both hosts mount this component, so the close control and the hooks the
 * inline `/settings` host queries survive here.
 */
@Component({
  selector: 'app-notifications-panel',
  standalone: true,
  providers: [NotificationsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        --cb-notifications-stroke: color-mix(in srgb, var(--cb-muted) 28%, transparent);
        display: block;
        font-family: var(--cb-font-sans);
        color: var(--cb-text);
      }
      .cb-notifications {
        display: flex;
        flex-direction: column;
      }
      .cb-notifications-heading {
        margin: 0 0 8px;
        font-size: 15px;
        font-weight: 600;
        line-height: 18.15px;
        color: var(--cb-text);
      }
      .cb-notifications-group {
        margin: 16px 0 8px;
        font-size: 10px;
        font-weight: 500;
        line-height: 12.1px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-notifications-events {
        display: flex;
        flex-direction: column;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-notifications-event {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        justify-content: space-between;
        min-block-size: 46px;
      }
      .cb-notifications-event-label {
        flex: 1 1 9rem;
        min-inline-size: 0;
        font-size: 12px;
        font-weight: 400;
        line-height: 14.52px;
        color: var(--cb-text);
        overflow-wrap: anywhere;
      }
      /* 38 × 22 track, 1 px stroke, 16 × 16 knob inset 3 px: the frame's switch. */
      .cb-notifications-switch {
        flex: 0 0 auto;
        position: relative;
        inline-size: 38px;
        block-size: 22px;
        margin: 0;
        border: 1px solid var(--cb-muted);
        border-radius: 11px;
        background: var(--cb-bg);
        appearance: none;
        cursor: pointer;
      }
      .cb-notifications-switch::after {
        content: '';
        position: absolute;
        inset-block-start: 2px;
        inset-inline-start: 2px;
        inline-size: 16px;
        block-size: 16px;
        border-radius: 8px;
        background: var(--cb-muted);
      }
      .cb-notifications-switch:checked {
        border-color: var(--cb-accent);
        background: var(--cb-accent);
      }
      .cb-notifications-switch:checked::after {
        inset-inline-start: auto;
        inset-inline-end: 2px;
        background: var(--cb-bg);
      }
      .cb-notifications-switch:focus-visible {
        outline: 2px solid var(--cb-accent);
        outline-offset: 2px;
      }
      .cb-notifications-track {
        flex: 0 0 auto;
        position: relative;
        inline-size: 38px;
        block-size: 22px;
        border: 1px solid var(--cb-muted);
        border-radius: 11px;
        background: var(--cb-bg);
      }
      .cb-notifications-track::after {
        content: '';
        position: absolute;
        inset-block-start: 2px;
        inset-inline-start: 2px;
        inline-size: 16px;
        block-size: 16px;
        border-radius: 8px;
        background: var(--cb-muted);
      }
      .cb-notifications-track[data-on='true'] {
        border-color: var(--cb-accent);
        background: var(--cb-accent);
      }
      .cb-notifications-track[data-on='true']::after {
        inset-inline-start: auto;
        inset-inline-end: 2px;
        background: var(--cb-bg);
      }
      .cb-notifications-locked {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 8px;
        align-items: baseline;
        padding-block: 8px 0;
      }
      .cb-notifications-locked-title {
        flex: 1 1 9rem;
        min-inline-size: 0;
        font-size: 12px;
        font-weight: 400;
        line-height: 14.52px;
        color: var(--cb-text);
        overflow-wrap: anywhere;
      }
      .cb-notifications-locked-always {
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 600;
        line-height: 12.1px;
        color: var(--cb-warn);
      }
      .cb-notifications-locked-hint {
        flex: 1 1 100%;
        margin: 0;
        font-size: 9px;
        font-weight: 400;
        line-height: 10.89px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-notifications-quiet {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-block-size: 76px;
        padding: 11px 15px;
        border: 1px solid var(--cb-notifications-stroke);
        border-radius: 12px;
        background: var(--cb-surface);
      }
      .cb-notifications-quiet-head {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        justify-content: space-between;
      }
      .cb-notifications-quiet-current {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-inline-size: 0;
        margin: 0;
        overflow-wrap: anywhere;
      }
      .cb-notifications-quiet-window {
        font-size: 12px;
        font-weight: 400;
        line-height: 14.52px;
        color: var(--cb-text);
      }
      .cb-notifications-quiet-mirror {
        font-size: 9px;
        font-weight: 400;
        line-height: 10.89px;
        color: var(--cb-muted);
      }
      .cb-notifications-quiet-hint {
        margin: 0;
        font-size: 9px;
        font-weight: 400;
        line-height: 10.89px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-notifications-field {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        margin-block-start: 8px;
      }
      .cb-notifications-input {
        flex: 1 1 8rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        box-sizing: border-box;
        padding: 4px 8px;
        border: 1px solid var(--cb-notifications-stroke);
        border-radius: 8px;
        background: var(--cb-bg);
        color: var(--cb-text);
        font: inherit;
        font-size: 12px;
        line-height: 14.52px;
      }
      .cb-notifications-save,
      .cb-notifications-close {
        min-block-size: 32px;
        padding-inline: 10px;
        border: 1px solid var(--cb-notifications-stroke);
        border-radius: 8px;
        background: var(--cb-surface);
        color: var(--cb-text);
        font: inherit;
        font-size: 11px;
        line-height: 13.31px;
      }
      .cb-notifications-save:disabled {
        opacity: 0.6;
      }
      .cb-notifications-note {
        margin: 8px 0 0;
        font-size: 9px;
        font-weight: 400;
        line-height: 10.89px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-notifications-close {
        align-self: flex-start;
        margin-block-start: 16px;
      }
      .cb-muted {
        color: var(--cb-muted);
      }
      .cb-mono {
        font-family: var(--cb-font-mono);
        overflow-wrap: anywhere;
      }
      .cb-unavailable {
        margin-block-start: 8px;
        padding: 8px 10px;
        border: 1px dashed var(--cb-muted);
        border-radius: 10px;
        color: var(--cb-muted);
        font-size: 11px;
        line-height: 13.31px;
      }
      .cb-sr {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin: -1px;
        padding: 0;
        border: 0;
        overflow: hidden;
        white-space: nowrap;
        clip-path: inset(50%);
      }
    `,
  ],
  template: `
    <div
      class="cb-notifications"
      data-testid="notifications-panel"
      data-events="5"
      data-locked="credential.changed"
    >
      @if (heading()) {
        <h3 class="cb-notifications-heading">{{ t('notifications.title') }}</h3>
      }

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

      <p class="cb-notifications-group" data-testid="notifications-group" data-group="events">
        {{ t('notifications.group.events') }}
      </p>

      <ul class="cb-notifications-events">
        @for (event of events; track event) {
          <li
            class="cb-notifications-event"
            data-testid="notifications-ev-row"
            [attr.data-event]="event"
            [attr.data-on]="isEnabled(event)"
          >
            <label class="cb-notifications-event-label" [attr.for]="'cb-notifications-' + event">
              {{ t('notifications.title.' + event) }}
            </label>
            <input
              class="cb-notifications-switch"
              [id]="'cb-notifications-' + event"
              type="checkbox"
              [attr.data-testid]="'notifications-toggle-' + event"
              [attr.data-enabled]="isEnabled(event)"
              [checked]="isEnabled(event)"
              (change)="onToggle(event, $event)"
            />
          </li>
        }
      </ul>

      <div
        class="cb-notifications-locked"
        data-testid="notifications-locked-credential"
        data-locked="true"
      >
        <span class="cb-notifications-locked-title">{{ t('notifications.locked.title') }}</span>
        <span class="cb-notifications-locked-always" data-testid="notifications-locked-always">
          {{ t('notifications.locked.always') }}
        </span>
        <p class="cb-notifications-locked-hint">{{ t('notifications.locked.hint') }}</p>
      </div>

      <p class="cb-notifications-group" data-testid="notifications-group" data-group="quiet">
        {{ t('notifications.quiet.title') }}
      </p>

      <div class="cb-notifications-quiet" data-testid="notifications-quiet-card">
        <div class="cb-notifications-quiet-head">
          <p
            class="cb-notifications-quiet-current"
            data-testid="notifications-quiet-current"
            [attr.data-quiet-hours]="store.preferences()?.quietHours ?? ''"
            [attr.data-mirror]="store.mirror() ?? ''"
          >
            @if (store.preferences()?.quietHours; as saved) {
              <span class="cb-notifications-quiet-window">{{ saved }}</span>
            } @else {
              <span class="cb-notifications-quiet-window">{{ t('notifications.quiet.none') }}</span>
            }
            @switch (store.mirror()) {
              @case ('synced') {
                <span class="cb-notifications-quiet-mirror">
                  {{ t('notifications.quiet.saved') }}
                </span>
              }
              @case ('absent') {
                <span class="cb-notifications-quiet-mirror">
                  {{ t('notifications.quiet.absent') }}
                </span>
              }
              @case ('failed') {
                <span class="cb-notifications-quiet-mirror">
                  {{ t('notifications.quiet.failed') }}
                </span>
              }
            }
          </p>
          <span
            class="cb-notifications-track"
            data-testid="notifications-quiet-track"
            [attr.data-on]="(store.preferences()?.quietHours ?? null) !== null"
            aria-hidden="true"
          ></span>
        </div>
        <p class="cb-notifications-quiet-hint">{{ t('notifications.quiet.hint') }}</p>
      </div>

      <div class="cb-notifications-field">
        <label class="cb-sr" for="cb-notifications-quiet">{{ t('notifications.quiet.title') }}</label>
        <input
          id="cb-notifications-quiet"
          class="cb-notifications-input"
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
          class="cb-notifications-save"
          data-testid="notifications-quiet-save"
          [disabled]="store.saving() === 'quiet'"
          (click)="saveQuietHours()"
        >
          {{ t('notifications.quiet.save') }}
        </button>
      </div>

      <p class="cb-notifications-note" data-testid="notifications-note" data-note="1">
        {{ t('notifications.note.1') }}
      </p>
      <p class="cb-notifications-note" data-testid="notifications-note" data-note="2">
        {{ t('notifications.note.2') }}
      </p>

      <button
        type="button"
        class="cb-notifications-close"
        data-testid="notifications-close"
        (click)="close()"
      >
        {{ t('notifications.close') }}
      </button>
    </div>
  `,
})
export class NotificationsPanel {
  readonly store = inject(NotificationsStore);
  readonly closed = output<void>();
  readonly events = NOTIFICATION_EVENTS;

  /** false on the routed frame, whose header owns the title; the inline host keeps its `<h3>`. */
  readonly heading = input<boolean>(true);

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

/** Frame `17 · Settings / Notifications`: the header, then the panel every host mounts. */
@Component({
  selector: 'app-notifications-page',
  standalone: true,
  imports: [RouterLink, IonContent, IonHeader, IonToolbar, NotificationsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        --cb-notifications-header-stroke: color-mix(in srgb, var(--cb-muted) 28%, transparent);
      }
      ion-content {
        --background: var(--cb-bg);
      }
      ion-toolbar {
        --min-height: 60px;
        --border-width: 0;
        border-block-end: 1px solid var(--cb-notifications-header-stroke);
      }
      .cb-notifications-back {
        display: flex;
        align-items: center;
        justify-content: center;
        min-inline-size: 44px;
        min-block-size: 44px;
        margin-inline-start: -2px;
        color: var(--cb-accent);
        font-size: 22px;
        font-weight: 400;
        line-height: 26.63px;
        text-decoration: none;
      }
      .cb-notifications-titles {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-inline-size: 0;
      }
      .cb-notifications-title {
        margin: 0;
        font-family: var(--cb-font-sans);
        font-size: 15px;
        font-weight: 600;
        line-height: 18.15px;
        color: var(--cb-text);
        overflow-wrap: anywhere;
      }
      .cb-notifications-sub {
        margin: 0;
        font-family: var(--cb-font-sans);
        font-size: 10px;
        font-weight: 400;
        line-height: 12.1px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-notifications-body {
        display: flex;
        flex-direction: column;
        padding: 24px;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <a
          class="cb-notifications-back"
          slot="start"
          data-testid="notifications-back"
          routerLink="/settings"
          [attr.aria-label]="t('settings.title')"
        >
          ‹
        </a>
        <div class="cb-notifications-titles">
          <h1 class="cb-notifications-title" data-testid="notifications-title">
            {{ t('notifications.title') }}
          </h1>
          <p
            class="cb-notifications-sub"
            data-testid="notifications-sub"
            [attr.data-count]="eventCount"
          >
            {{ t('notifications.group.events') }}
          </p>
        </div>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="cb-notifications-body" data-testid="page-notifications">
        <app-notifications-panel [heading]="false" />
      </div>
    </ion-content>
  `,
})
export class NotificationsPage {
  readonly eventCount = NOTIFICATION_EVENTS.length;

  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);
}

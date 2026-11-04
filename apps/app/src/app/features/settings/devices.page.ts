import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonToolbar } from '@ionic/angular';
import { I18nService } from '../../core/i18n/i18n.service';
import { DevicesStore } from './devices.store';
import { translate } from './i18n';

/**
 * Frame `15 · Settings / Devices`: a header with the count, one 342 × 68 row per paired
 * device, the outlined pair row and three notes. The calling device shows its marker and no
 * revoke control; another device asks once, then revokes.
 */
@Component({
  selector: 'app-devices-page',
  standalone: true,
  imports: [RouterLink, IonContent, IonHeader, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DevicesStore],
  styles: [
    `
      :host {
        --cb-devices-stroke: color-mix(in srgb, var(--cb-muted) 28%, transparent);
      }
      ion-content {
        --background: var(--cb-bg);
      }
      ion-toolbar {
        --min-height: 60px;
        --border-width: 0;
        border-block-end: 1px solid var(--cb-devices-stroke);
      }
      .cb-devices-back {
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
      .cb-devices-titles {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-inline-size: 0;
      }
      .cb-devices-title {
        margin: 0;
        font-family: var(--cb-font-sans);
        font-size: 15px;
        font-weight: 600;
        line-height: 18.15px;
        color: var(--cb-text);
        overflow-wrap: anywhere;
      }
      .cb-devices-sub {
        margin: 0;
        font-family: var(--cb-font-sans);
        font-size: 10px;
        font-weight: 400;
        line-height: 12.1px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-devices {
        display: flex;
        flex-direction: column;
        padding: 14px 24px 32px;
        font-family: var(--cb-font-sans);
        font-size: 10px;
        font-weight: 400;
        line-height: 12.1px;
        color: var(--cb-text);
      }
      .cb-devices-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-device {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: flex-start;
        min-block-size: 68px;
        padding: 10px 15px;
        border: 1px solid var(--cb-devices-stroke);
        border-radius: 12px;
        background: var(--cb-surface);
      }
      .cb-device-body {
        display: flex;
        flex: 1 1 12rem;
        flex-direction: column;
        gap: 3px;
        min-inline-size: 0;
      }
      .cb-device-name {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        line-height: 16.94px;
        color: var(--cb-text);
        overflow-wrap: anywhere;
      }
      .cb-device-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0;
        font-size: 10px;
        font-weight: 400;
        line-height: 12.1px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-device-seen,
      .cb-device-hint {
        margin: 0;
        font-size: 9px;
        font-weight: 400;
        line-height: 10.89px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-device-current {
        flex: 0 0 auto;
        margin-inline-start: auto;
        font-size: 10px;
        font-weight: 400;
        line-height: 12.1px;
        color: var(--cb-accent);
      }
      .cb-device-revoke {
        flex: 0 0 auto;
        margin-inline-start: auto;
        min-block-size: 32px;
        padding-inline: 10px;
        border: 1px solid var(--cb-devices-stroke);
        border-radius: 8px;
        background: transparent;
        color: var(--cb-danger);
        font: inherit;
        font-size: 10px;
        font-weight: 400;
        line-height: 12.1px;
      }
      .cb-device-revoke:disabled {
        opacity: 0.6;
      }
      .cb-device-confirm {
        display: flex;
        flex: 1 1 100%;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        min-inline-size: 0;
      }
      .cb-device-confirm-text {
        flex: 1 1 10rem;
        min-inline-size: 0;
        font-size: 10px;
        font-weight: 400;
        line-height: 12.1px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-device-button {
        min-block-size: 32px;
        padding-inline: 10px;
        border: 1px solid var(--cb-devices-stroke);
        border-radius: 8px;
        background: transparent;
        color: var(--cb-text);
        font: inherit;
        font-size: 10px;
        line-height: 12.1px;
      }
      .cb-devices-pair {
        display: flex;
        align-items: center;
        min-block-size: 48px;
        margin: 16px 0 0;
        padding: 0 15px;
        border: 1px solid var(--cb-devices-stroke);
        border-radius: 12px;
        background: var(--cb-bg);
        color: var(--cb-accent);
        font-size: 12px;
        font-weight: 400;
        line-height: 14.52px;
        overflow-wrap: anywhere;
      }
      .cb-devices-note {
        margin: 0;
        font-size: 10px;
        font-weight: 400;
        line-height: 12.1px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-devices-notes {
        display: flex;
        flex-direction: column;
        gap: 18px;
        margin-block-start: 24px;
      }
      .cb-devices-empty {
        display: flex;
        align-items: center;
        min-block-size: 48px;
        margin: 0;
        padding: 0 15px;
        border: 1px solid var(--cb-devices-stroke);
        border-radius: 12px;
        background: var(--cb-surface);
        color: var(--cb-muted);
        font-size: 11px;
        line-height: 13.31px;
      }
      .cb-mono {
        font-family: var(--cb-font-mono);
        overflow-wrap: anywhere;
      }
      .cb-unavailable {
        margin-block-end: 8px;
        padding: 8px 10px;
        border: 1px dashed var(--cb-muted);
        border-radius: 10px;
        color: var(--cb-muted);
        font-size: 11px;
        line-height: 13.31px;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <a
          class="cb-devices-back"
          slot="start"
          data-testid="devices-back"
          routerLink="/settings"
          [attr.aria-label]="t('settings.title')"
        >
          ‹
        </a>
        <div class="cb-devices-titles">
          <h1 class="cb-devices-title">{{ t('devices.title') }}</h1>
          <p
            class="cb-devices-sub"
            data-testid="devices-sub"
            [attr.data-count]="store.devices().length"
          >
            {{ t('devices.sub') }}
          </p>
        </div>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="cb-devices" data-testid="page-devices">
        @if (store.loading()) {
          <div data-testid="devices-loading">{{ t('common.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div class="cb-unavailable" data-testid="devices-error" [attr.data-code]="failure.code">
            <p>{{ t('common.error') }}</p>
            <p class="cb-mono">{{ failure.code }}</p>
            <button
              type="button"
              class="cb-device-button"
              data-testid="devices-retry"
              (click)="store.load()"
            >
              {{ t('common.retry') }}
            </button>
          </div>
        }

        @if (store.devices().length === 0) {
          @if (!store.loading()) {
            <p class="cb-devices-empty" data-testid="devices-empty">{{ t('devices.empty') }}</p>
          }
        } @else {
          <ul class="cb-devices-list" data-testid="devices-list">
            @for (device of store.devices(); track device.id) {
              <li
                class="cb-device"
                data-testid="device-row"
                [attr.data-device-id]="device.id"
                [attr.data-current]="device.id === store.currentDeviceId()"
              >
                <div class="cb-device-body">
                  <p class="cb-device-name" data-testid="device-name">{{ device.name }}</p>
                  <p class="cb-device-meta" data-testid="device-meta">
                    <span class="cb-mono">{{ device.platform }}</span>
                    <span class="cb-mono">{{ device.scopes.join(' ') }}</span>
                  </p>
                  <p class="cb-device-seen" data-testid="device-seen">
                    {{ t('devices.lastSeen') }}:
                    {{ device.lastSeenAt ?? t('devices.never') }}
                  </p>
                  @if (device.id === store.currentDeviceId()) {
                    <p class="cb-device-hint" data-testid="device-current-hint">
                      {{ t('devices.current.hint') }}
                    </p>
                  }
                </div>

                @if (device.id === store.currentDeviceId()) {
                  <span class="cb-device-current" data-testid="device-current">
                    {{ t('devices.current') }}
                  </span>
                } @else if (confirming() === device.id) {
                  <div class="cb-device-confirm" data-testid="device-revoke-confirm-block">
                    <span class="cb-device-confirm-text">{{ t('devices.revoke.confirm') }}</span>
                    <button
                      type="button"
                      class="cb-device-button"
                      data-testid="device-revoke-confirm"
                      [disabled]="store.revokingId() !== null"
                      (click)="revoke(device.id)"
                    >
                      {{ t('devices.revoke') }}
                    </button>
                    <button
                      type="button"
                      class="cb-device-button"
                      data-testid="device-revoke-cancel"
                      (click)="cancel()"
                    >
                      {{ t('devices.cancel') }}
                    </button>
                  </div>
                } @else {
                  <button
                    type="button"
                    class="cb-device-revoke"
                    data-testid="device-revoke"
                    [disabled]="store.revokingId() !== null"
                    (click)="ask(device.id)"
                  >
                    {{ t('devices.revoke') }}
                  </button>
                }
              </li>
            }
          </ul>
        }

        <p class="cb-devices-pair" data-testid="devices-pair" aria-disabled="true">
          {{ t('devices.pair') }}
        </p>

        <div class="cb-devices-notes">
          <p class="cb-devices-note" data-testid="devices-note" data-note="1">
            {{ t('devices.note.1') }}
          </p>
          <p class="cb-devices-note" data-testid="devices-note" data-note="2">
            {{ t('devices.note.2') }}
          </p>
          <p class="cb-devices-note" data-testid="devices-note" data-note="3">
            {{ t('devices.note.3') }}
          </p>
        </div>
      </div>
    </ion-content>
  `,
})
export class DevicesPage {
  readonly store = inject(DevicesStore);
  readonly confirming = signal<string | null>(null);

  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  constructor() {
    this.store.load();
  }

  ask(id: string): void {
    this.confirming.set(id);
  }

  cancel(): void {
    this.confirming.set(null);
  }

  revoke(id: string): void {
    this.confirming.set(null);
    this.store.revoke(id);
  }
}

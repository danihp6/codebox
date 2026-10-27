import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { I18nService } from '../../core/i18n/i18n.service';
import { DevicesStore } from './devices.store';
import { translate } from './i18n';

@Component({
  selector: 'app-devices-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DevicesStore],
  styles: [
    `
      .cb-devices {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 3);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-device {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: baseline;
        border-block-end: 1px solid var(--cb-surface);
        padding-block: calc(var(--cb-space) * 3);
        overflow-wrap: anywhere;
      }
      .cb-device[data-current='true'] {
        border-inline-start: 3px solid var(--cb-accent);
        padding-inline-start: calc(var(--cb-space) * 3);
      }
      .cb-device-name {
        font-weight: 600;
      }
      .cb-mono {
        font-family: var(--cb-font-mono);
      }
      .cb-muted {
        color: var(--cb-muted);
      }
      .cb-current-hint {
        inline-size: 100%;
        color: var(--cb-muted);
      }
      .cb-confirm {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
        inline-size: 100%;
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
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('devices.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-devices">
        @if (store.loading()) {
          <div data-testid="devices-loading">{{ t('common.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div class="cb-unavailable" data-testid="devices-error" [attr.data-code]="failure.code">
            <p>{{ t('common.error') }}</p>
            <p class="cb-mono cb-muted">{{ failure.code }}</p>
            <button type="button" data-testid="devices-retry" (click)="store.load()">
              {{ t('common.retry') }}
            </button>
          </div>
        }

        @if (store.devices().length === 0) {
          @if (!store.loading()) {
            <p data-testid="devices-empty">{{ t('devices.empty') }}</p>
          }
        } @else {
          <ul class="cb-devices">
            @for (device of store.devices(); track device.id) {
              <li
                class="cb-device"
                data-testid="device-row"
                [attr.data-device-id]="device.id"
                [attr.data-current]="device.id === store.currentDeviceId()"
              >
                <span class="cb-device-name">{{ device.name }}</span>
                <span class="cb-mono">{{ device.platform }}</span>
                <span class="cb-mono cb-muted">{{ device.scopes.join(' ') }}</span>
                <span class="cb-muted">
                  {{ t('devices.lastSeen') }}:
                  {{ device.lastSeenAt ?? t('devices.never') }}
                </span>

                @if (device.id === store.currentDeviceId()) {
                  <span data-testid="device-current">{{ t('devices.current') }}</span>
                  <span class="cb-current-hint" data-testid="device-current-hint">
                    {{ t('devices.current.hint') }}
                  </span>
                } @else if (confirming() === device.id) {
                  <div class="cb-confirm" data-testid="device-revoke-confirm-block">
                    <span>{{ t('devices.revoke.confirm') }}</span>
                    <button
                      type="button"
                      data-testid="device-revoke-confirm"
                      [disabled]="store.revokingId() !== null"
                      (click)="revoke(device.id)"
                    >
                      {{ t('devices.revoke') }}
                    </button>
                    <button type="button" data-testid="device-revoke-cancel" (click)="cancel()">
                      {{ t('devices.cancel') }}
                    </button>
                  </div>
                } @else {
                  <button
                    type="button"
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

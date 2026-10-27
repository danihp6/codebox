import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './i18n';
import { NotificationsPanel } from './notifications.page';
import { ProvidersPanel } from './providers.page';
import { SettingsStore } from './settings.store';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [
    RouterLink,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    NotificationsPanel,
    ProvidersPanel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [SettingsStore],
  styles: [
    `
      .cb-section {
        margin-block-start: calc(var(--cb-space) * 6);
        border-block-start: 1px solid var(--cb-surface);
        padding-block-start: calc(var(--cb-space) * 3);
      }
      .cb-section h2 {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-muted {
        color: var(--cb-muted);
      }
      .cb-mono {
        font-family: var(--cb-font-mono);
        overflow-wrap: anywhere;
      }
      .cb-field {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
        margin-block-start: calc(var(--cb-space) * 2);
      }
      .cb-field input {
        font: inherit;
        color: inherit;
        background: var(--cb-surface);
        border: 1px solid var(--cb-muted);
        border-radius: calc(var(--cb-radius) / 2);
        padding: calc(var(--cb-space) * 2);
        min-inline-size: 14rem;
      }
      .cb-unavailable {
        border: 1px dashed var(--cb-muted);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 3);
        color: var(--cb-muted);
      }
      .cb-danger {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        margin-block-start: calc(var(--cb-space) * 4);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('settings.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-settings">
        @if (store.loading()) {
          <div data-testid="settings-loading">{{ t('common.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div class="cb-unavailable" data-testid="settings-error" [attr.data-code]="failure.code">
            <p>{{ t('common.error') }}</p>
            <p class="cb-mono cb-muted">{{ failure.code }}</p>
            <button type="button" data-testid="settings-retry" (click)="store.load()">
              {{ t('common.retry') }}
            </button>
          </div>
        }

        <section class="cb-section">
          <h2>{{ t('settings.section.profile') }}</h2>
          <div
            data-testid="settings-profile"
            [attr.data-device-id]="deviceId()"
            [attr.data-scopes]="scopes()"
          >
            @if (store.me(); as me) {
              <p>
                {{ t('settings.device.name') }}:
                <span class="cb-mono">{{ me.device.name }}</span>
              </p>
              <p>
                {{ t('settings.device.platform') }}:
                <span class="cb-mono">{{ me.device.platform }}</span>
              </p>
              <p>
                {{ t('settings.device.scopes') }}:
                <span class="cb-mono">{{ scopes() }}</span>
              </p>
            } @else {
              <p class="cb-muted">{{ t('settings.device.none') }}</p>
            }
          </div>

          <div class="cb-field">
            <label for="cb-settings-timezone">{{ t('settings.timezone') }}</label>
            <input
              id="cb-settings-timezone"
              data-testid="settings-timezone"
              type="text"
              autocomplete="off"
              spellcheck="false"
              [value]="timezone()"
              (input)="setTimezone($event)"
            />
            <button
              type="button"
              data-testid="settings-save-timezone"
              [disabled]="store.settingsUnavailable() || store.saving() === 'timezone'"
              (click)="saveTimezone()"
            >
              {{ t('settings.timezone.save') }}
            </button>
          </div>

          @if (store.settingsUnavailable()) {
            <p class="cb-unavailable" data-testid="settings-unavailable-settings">
              {{ t('settings.unavailable') }}
            </p>
          }
        </section>

        <section class="cb-section">
          <h2>{{ t('settings.section.credentials') }}</h2>
          <p>
            <a data-testid="settings-credentials-link" routerLink="/settings/credentials">
              {{ t('settings.credentials.manage') }}
            </a>
          </p>
        </section>

        <section class="cb-section">
          <h2>{{ t('settings.section.devices') }}</h2>
          <p>
            <a data-testid="settings-devices-link" routerLink="/settings/devices">
              {{ t('settings.devices.manage') }}
            </a>
          </p>
        </section>

        <section class="cb-section">
          <h2>{{ t('settings.section.notifications') }}</h2>
          <button
            type="button"
            data-testid="settings-notifications-open"
            (click)="toggleNotifications()"
          >
            {{ t('settings.notifications.open') }}
          </button>
          @if (notificationsOpen()) {
            <app-notifications-panel (closed)="notificationsOpen.set(false)" />
          }
        </section>

        <section class="cb-section">
          <h2>{{ t('settings.section.providers') }}</h2>
          <button type="button" data-testid="settings-providers-open" (click)="toggleProviders()">
            {{ t('settings.providers.open') }}
          </button>
          @if (providersOpen()) {
            <app-providers-panel (closed)="providersOpen.set(false)" />
          }
        </section>

        <section class="cb-section">
          <h2>{{ t('settings.section.danger') }}</h2>
          @if (store.brakeAvailable() && !store.settingsUnavailable()) {
            <button
              type="button"
              data-testid="settings-brake"
              [attr.data-enabled]="brakeOn()"
              [disabled]="store.saving() === 'brake'"
              (click)="toggleBrake()"
            >
              {{ brakeOn() ? t('settings.brake.on') : t('settings.brake.off') }}
            </button>
            <p class="cb-muted">{{ t('settings.brake.confirm') }}</p>
          } @else {
            <p class="cb-unavailable" data-testid="settings-unavailable-brake">
              {{ t('settings.unavailable') }}
            </p>
          }

          @if (store.cacheWipeAvailable()) {
            <button type="button" data-testid="settings-wipe-cache" (click)="store.wipeCache()">
              {{ t('settings.cache.wipe') }}
            </button>
            <p class="cb-muted">{{ t('settings.cache.confirm') }}</p>
          } @else {
            <p class="cb-unavailable" data-testid="settings-unavailable-cache">
              {{ t('settings.unavailable') }}
            </p>
          }
        </section>

        <section class="cb-section">
          <h2>{{ t('settings.section.about') }}</h2>
          @if (store.version(); as version) {
            <p data-testid="settings-version" [attr.data-version]="version.version">
              {{ t('settings.about.version') }}:
              <span class="cb-mono">{{ version.version }}</span>
            </p>
            <p data-testid="settings-commit" [attr.data-commit]="version.commit">
              {{ t('settings.about.commit') }}:
              <span class="cb-mono">{{ version.commit ?? '—' }}</span>
            </p>
            <p data-testid="settings-node" [attr.data-node]="version.node">
              {{ t('settings.about.node') }}:
              <span class="cb-mono">{{ version.node }}</span>
            </p>
          }
        </section>
      </div>
    </ion-content>
  `,
})
export class SettingsPage {
  readonly store = inject(SettingsStore);
  readonly notificationsOpen = signal(false);
  readonly providersOpen = signal(false);

  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  readonly deviceId = computed(() => this.store.me()?.device.id ?? null);
  readonly scopes = computed(() => this.store.me()?.scopes.join(' ') ?? '');
  readonly brakeOn = computed(() => this.store.settings()?.automerge === false);

  readonly timezone = linkedSignal(() => this.store.settings()?.timezone ?? '');

  constructor() {
    this.store.load();
  }

  saveTimezone(): void {
    this.store.saveTimezone(this.timezone());
  }

  toggleBrake(): void {
    this.store.setBrake(!this.brakeOn());
  }

  toggleNotifications(): void {
    this.notificationsOpen.update((open) => !open);
  }

  toggleProviders(): void {
    this.providersOpen.update((open) => !open);
  }

  setTimezone(event: Event): void {
    this.timezone.set(fieldValue(event));
  }
}

function fieldValue(event: Event): string {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target.value;
  return '';
}

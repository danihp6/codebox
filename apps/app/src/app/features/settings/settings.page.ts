import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './i18n';
import { PREFERENCE_EVENTS, SettingsStore } from './settings.store';
import type { PreferenceEvent } from './settings.store';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [RouterLink, IonContent, IonHeader, IonTitle, IonToolbar],
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
      .cb-toggles,
      .cb-providers {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-toggles label {
        display: flex;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
        min-block-size: 44px;
      }
      .cb-toggles input {
        inline-size: 1.25rem;
        block-size: 1.25rem;
      }
      .cb-providers li {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: baseline;
        border-block-end: 1px solid var(--cb-surface);
        padding-block: calc(var(--cb-space) * 2);
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
          <h2>{{ t('settings.section.devices') }}</h2>
          <p>
            <a data-testid="settings-devices-link" routerLink="/settings/devices">
              {{ t('settings.devices.manage') }}
            </a>
          </p>
        </section>

        <section class="cb-section">
          <h2>{{ t('settings.section.notifications') }}</h2>
          @if (store.preferences(); as preferences) {
            <ul class="cb-toggles">
              @for (event of preferenceEvents; track event) {
                <li>
                  <label>
                    <input
                      type="checkbox"
                      [attr.data-testid]="'settings-preference-' + event"
                      [attr.data-enabled]="isEnabled(event)"
                      [checked]="isEnabled(event)"
                      (change)="togglePreference(event, $event)"
                    />
                    <span>{{ t('settings.preference.' + event) }}</span>
                  </label>
                </li>
              }
            </ul>

            <div class="cb-field">
              <label for="cb-settings-quiet-hours">{{ t('settings.quiet.hours') }}</label>
              <input
                id="cb-settings-quiet-hours"
                data-testid="settings-quiet-hours"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="22:00-07:00"
                [value]="quietHours()"
                (input)="setQuietHours($event)"
              />
              <button
                type="button"
                data-testid="settings-save-quiet-hours"
                [disabled]="store.saving() === 'quiet'"
                (click)="saveQuietHours()"
              >
                {{ t('settings.quiet.save') }}
              </button>
            </div>
            <p class="cb-muted">
              {{ preferences.quietHours === null ? t('settings.quiet.none') : preferences.quietHours }}
            </p>
          }
        </section>

        <section class="cb-section">
          <h2>{{ t('settings.section.providers') }}</h2>
          @if (store.providersUnavailable()) {
            <p class="cb-unavailable" data-testid="settings-unavailable-providers">
              {{ t('settings.unavailable') }}
            </p>
          } @else {
            <ul class="cb-providers">
              @for (provider of providers(); track provider.provider) {
                <li
                  [attr.data-testid]="'settings-provider-' + provider.provider"
                  [attr.data-configured]="provider.configured"
                  [attr.data-mode]="provider.mode"
                >
                  <span class="cb-mono">{{ provider.provider }}</span>
                  <span>
                    {{ provider.configured ? t('settings.provider.configured') : t('settings.provider.missing') }}
                  </span>
                  <span class="cb-muted">
                    {{ t('settings.provider.mode') }}:
                    <span class="cb-mono">{{ provider.mode }}</span>
                  </span>
                </li>
              }
            </ul>
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
  readonly preferenceEvents = PREFERENCE_EVENTS;

  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  readonly providers = computed(() => this.store.providers()?.providers ?? []);
  readonly deviceId = computed(() => this.store.me()?.device.id ?? null);
  readonly scopes = computed(() => this.store.me()?.scopes.join(' ') ?? '');
  readonly brakeOn = computed(() => this.store.settings()?.automerge === false);

  readonly timezone = linkedSignal(() => this.store.settings()?.timezone ?? '');
  readonly quietHours = linkedSignal(() => this.store.preferences()?.quietHours ?? '');

  constructor() {
    this.store.load();
  }

  isEnabled(event: PreferenceEvent): boolean {
    return this.store.preferences()?.events.includes(event) ?? false;
  }

  saveTimezone(): void {
    this.store.saveTimezone(this.timezone());
  }

  saveQuietHours(): void {
    const value = this.quietHours().trim();
    this.store.setQuietHours(value === '' ? null : value);
  }

  toggleBrake(): void {
    this.store.setBrake(!this.brakeOn());
  }

  togglePreference(event: PreferenceEvent, change: Event): void {
    const target = change.target;
    if (!(target instanceof HTMLInputElement)) return;
    this.store.togglePreference(event, target.checked);
  }

  setTimezone(event: Event): void {
    this.timezone.set(fieldValue(event));
  }

  setQuietHours(event: Event): void {
    this.quietHours.set(fieldValue(event));
  }
}

function fieldValue(event: Event): string {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target.value;
  return '';
}

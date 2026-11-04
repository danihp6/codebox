import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import type { Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { NotificationPreferences } from '@codebox/contracts';
import { I18nService } from '../../core/i18n/i18n.service';
import { SettingsStore as AppSettingsStore } from '../../core/settings/settings.store';
import type { Theme } from '../../core/settings/settings.store';
import { translate } from './i18n';
import { NotificationsPanel } from './notifications.page';
import { ProvidersPanel } from './providers.page';
import { SettingsStore } from './settings.store';

/**
 * Frame `06 · Settings — mobile dark`: one 342 × 64 device card, four group headings, one
 * 342 × 52 row per setting and two 342 × 48 danger rows. The rows the product ships but the
 * frame omits (credentials, the time zone field, the brake) stay as rows; routines and unpair
 * are drawn inert because this build has no screen for them.
 */
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
      :host {
        --cb-settings-stroke: color-mix(in srgb, var(--cb-muted) 28%, transparent);
      }
      ion-content {
        --background: var(--cb-bg);
      }
      ion-title {
        padding-inline: 24px;
        font-family: var(--cb-font-sans);
        font-size: 24px;
        font-weight: 600;
        line-height: 29.05px;
        letter-spacing: normal;
        color: var(--cb-text);
      }
      .cb-settings {
        display: flex;
        flex-direction: column;
        padding: 24px 24px 32px;
        font-family: var(--cb-font-sans);
        font-size: 13px;
        font-weight: 400;
        line-height: 15.73px;
        color: var(--cb-text);
      }
      .cb-settings-block {
        display: flex;
        flex-direction: column;
      }
      .cb-settings-group {
        margin: 16px 0 8px;
        padding: 0;
        font-size: 10px;
        font-weight: 500;
        line-height: 12.1px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-settings-profile {
        margin-block-end: 4px;
      }
      .cb-settings-device {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 4px;
        min-block-size: 64px;
        padding: 8px 15px;
        border: 1px solid var(--cb-settings-stroke);
        border-radius: 14px;
        background: var(--cb-surface);
        overflow-wrap: anywhere;
      }
      .cb-settings-device-name {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        line-height: 18.15px;
        color: var(--cb-text);
      }
      .cb-settings-device-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0;
        font-size: 11px;
        font-weight: 400;
        line-height: 13.31px;
        color: var(--cb-accent);
      }
      .cb-settings-rows {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-settings-rows-danger {
        gap: 8px;
      }
      .cb-settings-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 6px;
        column-gap: 12px;
        align-items: center;
        min-block-size: 52px;
        padding: 4px 12px 4px 15px;
        border: 1px solid var(--cb-settings-stroke);
        border-radius: 10px;
        background: var(--cb-surface);
      }
      .cb-settings-row-danger,
      .cb-settings-row-plain {
        grid-template-columns: minmax(0, 1fr);
      }
      .cb-settings-row-danger {
        min-block-size: 48px;
      }
      .cb-settings-row-cell {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-inline-size: 0;
      }
      .cb-settings-row-main {
        display: grid;
        grid-template-columns: minmax(0, 152px) minmax(0, 1fr);
        column-gap: 8px;
        align-items: center;
        min-inline-size: 0;
        min-block-size: 44px;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        text-decoration: none;
      }
      .cb-settings-row-action {
        cursor: pointer;
      }
      .cb-settings-row-action:disabled {
        cursor: progress;
        opacity: 0.6;
      }
      .cb-settings-row-label {
        font-size: 13px;
        font-weight: 400;
        line-height: 15.73px;
        color: var(--cb-text);
        overflow-wrap: anywhere;
      }
      .cb-settings-row-danger .cb-settings-row-label,
      .cb-settings-row-danger .cb-settings-row-action {
        color: var(--cb-danger);
      }
      .cb-settings-row-value {
        min-inline-size: 0;
        padding: 0;
        font-size: 11px;
        font-weight: 400;
        line-height: 13.31px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-settings-chevron {
        font-size: 14px;
        font-weight: 400;
        line-height: 16.94px;
        color: var(--cb-muted);
        text-decoration: none;
      }
      .cb-settings-notes {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-inline-size: 0;
        font-size: 11px;
        font-weight: 400;
        line-height: 13.31px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-settings-notes .cb-settings-note {
        margin: 0;
      }
      .cb-settings-theme {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-block-start: 4px;
      }
      .cb-settings-theme-button {
        min-inline-size: 44px;
        min-block-size: 28px;
        padding-inline: 8px;
        border: 1px solid var(--cb-settings-stroke);
        border-radius: 8px;
        background: transparent;
        color: var(--cb-muted);
        font: inherit;
        font-size: 10px;
        font-weight: 600;
        line-height: 12.1px;
      }
      .cb-settings-theme-button[aria-pressed='true'] {
        border-color: var(--cb-accent);
        color: var(--cb-accent);
      }
      .cb-settings-field {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        min-inline-size: 0;
      }
      .cb-settings-input {
        flex: 1 1 7rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        box-sizing: border-box;
        padding: 4px 8px;
        border: 1px solid var(--cb-settings-stroke);
        border-radius: 8px;
        background: var(--cb-bg);
        color: var(--cb-text);
        font: inherit;
        font-size: 12px;
        line-height: 14.52px;
      }
      .cb-settings-button {
        min-block-size: 32px;
        padding-inline: 10px;
        border: 1px solid var(--cb-settings-stroke);
        border-radius: 8px;
        background: var(--cb-surface);
        color: var(--cb-text);
        font: inherit;
        font-size: 11px;
        line-height: 13.31px;
      }
      .cb-settings-button:disabled {
        opacity: 0.6;
      }
      .cb-settings-note {
        margin: 8px 0 0;
        font-size: 11px;
        font-weight: 400;
        line-height: 13.31px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-muted {
        color: var(--cb-muted);
      }
      .cb-mono {
        font-family: var(--cb-font-mono);
        overflow-wrap: anywhere;
      }
      .cb-settings-unavailable {
        margin: 8px 0 0;
        padding: 8px 10px;
        border: 1px dashed var(--cb-muted);
        border-radius: 10px;
        font-size: 11px;
        line-height: 13.31px;
        color: var(--cb-muted);
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
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('settings.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="cb-settings" data-testid="page-settings" [attr.data-theme]="theme()">
        @if (store.loading()) {
          <div data-testid="settings-loading">{{ t('common.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div
            class="cb-settings-unavailable"
            data-testid="settings-error"
            [attr.data-code]="failure.code"
          >
            <p>{{ t('common.error') }}</p>
            <p class="cb-mono">{{ failure.code }}</p>
            <button
              type="button"
              class="cb-settings-button"
              data-testid="settings-retry"
              (click)="store.load()"
            >
              {{ t('common.retry') }}
            </button>
          </div>
        }

        <section class="cb-settings-block cb-settings-profile">
          <h2 class="cb-sr">{{ t('settings.section.profile') }}</h2>
          <div
            class="cb-settings-device"
            data-testid="settings-profile"
            [attr.data-device-id]="deviceId()"
            [attr.data-scopes]="scopes()"
          >
            @if (store.me(); as me) {
              <p class="cb-settings-device-name" data-testid="settings-device-name">
                <span class="cb-sr">{{ t('settings.device.name') }}</span>{{ me.device.name }}
              </p>
              <p class="cb-settings-device-meta" data-testid="settings-device-meta">
                <span>
                  {{ t('settings.device.platform') }}
                  <span class="cb-mono">{{ me.device.platform }}</span>
                </span>
                <span>
                  {{ t('settings.device.scopes') }}
                  <span class="cb-mono">{{ scopes() }}</span>
                </span>
              </p>
            } @else {
              <p class="cb-muted">{{ t('settings.device.none') }}</p>
            }
          </div>

          <div class="cb-settings-row cb-settings-row-plain" data-testid="settings-timezone-row">
            <div class="cb-settings-row-main">
              <label class="cb-settings-row-label" for="cb-settings-timezone">
                {{ t('settings.timezone') }}
              </label>
              <div class="cb-settings-field">
                <input
                  id="cb-settings-timezone"
                  class="cb-settings-input"
                  data-testid="settings-timezone"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  [value]="timezone()"
                  (input)="setTimezone($event)"
                />
                <button
                  type="button"
                  class="cb-settings-button"
                  data-testid="settings-save-timezone"
                  [disabled]="store.settingsUnavailable() || store.saving() === 'timezone'"
                  (click)="saveTimezone()"
                >
                  {{ t('settings.timezone.save') }}
                </button>
              </div>
            </div>
          </div>
          @if (store.settingsUnavailable()) {
            <p class="cb-settings-unavailable" data-testid="settings-unavailable-settings">
              {{ t('settings.unavailable') }}
            </p>
          }
        </section>

        <section class="cb-settings-block">
          <h2 class="cb-settings-group" data-testid="settings-group" data-group="preferences">
            {{ t('settings.group.preferences') }}
          </h2>
          <ul class="cb-settings-rows">
            <li class="cb-settings-row" data-testid="settings-row" data-row="notifications">
              <button
                type="button"
                class="cb-settings-row-main cb-settings-row-action"
                data-testid="settings-notifications-open"
                [attr.aria-label]="t('settings.notifications.open')"
                [attr.aria-expanded]="notificationsOpen()"
                (click)="toggleNotifications()"
              >
                <span class="cb-settings-row-label">{{ t('settings.section.notifications') }}</span>
                <span
                  class="cb-settings-row-value"
                  data-testid="settings-row-notifications-value"
                  [attr.data-enabled]="preferences()?.events.length ?? 0"
                >
                  {{ preferences()?.quietHours ?? t('settings.quiet.none') }}
                </span>
              </button>
              <span class="cb-settings-chevron" aria-hidden="true">›</span>
            </li>

            <li class="cb-settings-row cb-settings-row-plain" data-testid="settings-row" data-row="appearance">
              <div class="cb-settings-row-main">
                <span class="cb-settings-row-label">{{ t('settings.appearance') }}</span>
                <div class="cb-settings-row-cell">
                  <span class="cb-settings-row-value" data-testid="settings-row-appearance-value">
                    {{ theme() === 'light' ? t('settings.theme.light') : t('settings.theme.dark') }}
                  </span>
                  <div
                    class="cb-settings-theme"
                    role="group"
                    data-testid="settings-theme"
                    [attr.data-theme]="theme()"
                    [attr.aria-label]="t('settings.appearance')"
                  >
                    <button
                      type="button"
                      class="cb-settings-theme-button"
                      data-testid="settings-theme-dark"
                      [attr.aria-pressed]="theme() === 'dark'"
                      (click)="setTheme('dark')"
                    >
                      {{ t('settings.theme.dark') }}
                    </button>
                    <button
                      type="button"
                      class="cb-settings-theme-button"
                      data-testid="settings-theme-light"
                      [attr.aria-pressed]="theme() === 'light'"
                      (click)="setTheme('light')"
                    >
                      {{ t('settings.theme.light') }}
                    </button>
                  </div>
                </div>
              </div>
            </li>

            <li class="cb-settings-row" data-testid="settings-row" data-row="providers">
              <button
                type="button"
                class="cb-settings-row-main cb-settings-row-action"
                data-testid="settings-providers-open"
                [attr.aria-label]="t('settings.providers.open')"
                [attr.aria-expanded]="providersOpen()"
                (click)="toggleProviders()"
              >
                <span class="cb-settings-row-label">{{ t('settings.section.providers') }}</span>
                <span
                  class="cb-settings-row-value"
                  data-testid="settings-row-providers-value"
                  [attr.data-configured]="providerConfigured()"
                >
                  @if (store.providers()) {
                    {{ providerConfigured() }}/{{ providerTotal() }}
                  } @else {
                    {{ t('settings.value.none') }}
                  }
                </span>
              </button>
              <span class="cb-settings-chevron" aria-hidden="true">›</span>
            </li>
          </ul>

          @if (notificationsOpen()) {
            <app-notifications-panel (closed)="notificationsOpen.set(false)" />
          }
          @if (providersOpen()) {
            <app-providers-panel (closed)="providersOpen.set(false)" />
          }
        </section>

        <section class="cb-settings-block">
          <h2 class="cb-settings-group" data-testid="settings-group" data-group="automation">
            {{ t('settings.group.automation') }}
          </h2>
          <ul class="cb-settings-rows">
            <li
              class="cb-settings-row"
              data-testid="settings-row"
              data-row="routines"
              aria-disabled="true"
              data-available="false"
            >
              <div class="cb-settings-row-main">
                <span class="cb-settings-row-label">{{ t('settings.routines') }}</span>
                <span
                  class="cb-settings-row-value"
                  data-testid="settings-row-routines"
                  data-available="false"
                >
                  {{ t('settings.routines.value') }}
                </span>
              </div>
              <span class="cb-settings-chevron" aria-hidden="true">›</span>
            </li>

            <li class="cb-settings-row cb-settings-row-plain" data-testid="settings-row" data-row="brake">
              @if (store.brakeAvailable() && !store.settingsUnavailable()) {
                <button
                  type="button"
                  class="cb-settings-row-main cb-settings-row-action"
                  data-testid="settings-brake"
                  [attr.data-enabled]="brakeOn()"
                  [disabled]="store.saving() === 'brake'"
                  (click)="toggleBrake()"
                >
                  <span class="cb-settings-row-label">
                    {{ brakeOn() ? t('settings.brake.on') : t('settings.brake.off') }}
                  </span>
                </button>
              } @else {
                <p class="cb-settings-row-value" data-testid="settings-unavailable-brake">
                  {{ t('settings.unavailable') }}
                </p>
              }
            </li>
          </ul>
          <p class="cb-settings-note">{{ t('settings.brake.confirm') }}</p>
        </section>

        <section class="cb-settings-block">
          <h2 class="cb-settings-group" data-testid="settings-group" data-group="account">
            {{ t('settings.group.account') }}
          </h2>
          <ul class="cb-settings-rows">
            <li class="cb-settings-row" data-testid="settings-row" data-row="devices">
              <a
                class="cb-settings-row-main cb-settings-row-action"
                data-testid="settings-devices-link"
                routerLink="/settings/devices"
                [attr.aria-label]="t('settings.devices.manage')"
              >
                <span class="cb-settings-row-label">{{ t('settings.section.devices') }}</span>
                <span class="cb-settings-row-value" data-testid="settings-row-devices-value">
                  {{ t('settings.value.none') }}
                </span>
              </a>
              <span class="cb-settings-chevron" aria-hidden="true">›</span>
            </li>

            <li class="cb-settings-row" data-testid="settings-row" data-row="credentials">
              <a
                class="cb-settings-row-main cb-settings-row-action"
                data-testid="settings-credentials-link"
                routerLink="/settings/credentials"
                [attr.aria-label]="t('settings.credentials.manage')"
              >
                <span class="cb-settings-row-label">{{ t('settings.section.credentials') }}</span>
              </a>
              <span class="cb-settings-chevron" aria-hidden="true">›</span>
            </li>

            <li class="cb-settings-row" data-testid="settings-row" data-row="about">
              <div class="cb-settings-row-main">
                <span class="cb-settings-row-label">{{ t('settings.section.about') }}</span>
                <div class="cb-settings-notes">
                  <span class="cb-settings-row-value" data-testid="settings-row-about-value">
                    {{ store.version()?.version ?? t('settings.value.none') }}
                  </span>
                  @if (store.version(); as version) {
                    <p class="cb-settings-note">
                      {{ t('settings.about.version') }}
                      <span class="cb-mono" data-testid="settings-version" [attr.data-version]="version.version">
                        {{ version.version }}
                      </span>
                    </p>
                    <p class="cb-settings-note">
                      {{ t('settings.about.commit') }}
                      <span class="cb-mono" data-testid="settings-commit" [attr.data-commit]="version.commit">
                        {{ version.commit ?? '—' }}
                      </span>
                    </p>
                    <p class="cb-settings-note">
                      {{ t('settings.about.node') }}
                      <span class="cb-mono" data-testid="settings-node" [attr.data-node]="version.node">
                        {{ version.node }}
                      </span>
                    </p>
                  }
                </div>
              </div>
              <a
                class="cb-settings-chevron"
                data-testid="settings-about-link"
                routerLink="/about"
                [attr.aria-label]="t('settings.section.about')"
              >
                ›
              </a>
            </li>
          </ul>
        </section>

        <section class="cb-settings-block">
          <h2 class="cb-settings-group" data-testid="settings-group" data-group="danger">
            {{ t('settings.group.danger') }}
          </h2>
          <ul class="cb-settings-rows cb-settings-rows-danger">
            <li
              class="cb-settings-row cb-settings-row-danger"
              data-testid="settings-unpair"
              aria-disabled="true"
              data-available="false"
            >
              <div class="cb-settings-row-main">
                <span class="cb-settings-row-label">{{ t('settings.danger.unpair') }}</span>
                <span class="cb-settings-row-value">{{ t('settings.unavailable') }}</span>
              </div>
            </li>

            <li class="cb-settings-row cb-settings-row-danger">
              @if (store.cacheWipeAvailable()) {
                <button
                  type="button"
                  class="cb-settings-row-main cb-settings-row-action"
                  data-testid="settings-wipe-cache"
                  (click)="store.wipeCache()"
                >
                  <span class="cb-settings-row-label">{{ t('settings.cache.wipe') }}</span>
                </button>
              } @else {
                <p class="cb-settings-row-value" data-testid="settings-unavailable-cache">
                  {{ t('settings.unavailable') }}
                </p>
              }
            </li>
          </ul>
          <p class="cb-settings-note">{{ t('settings.cache.confirm') }}</p>
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
  private readonly appSettings = inject(AppSettingsStore);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  readonly deviceId = computed(() => this.store.me()?.device.id ?? null);
  readonly scopes = computed(() => this.store.me()?.scopes.join(' ') ?? '');
  readonly brakeOn = computed(() => this.store.settings()?.automerge === false);

  readonly timezone = linkedSignal(() => this.store.settings()?.timezone ?? '');

  readonly theme: Signal<Theme> = this.appSettings.theme;
  readonly preferences: Signal<NotificationPreferences | null> = this.store.preferences;

  readonly providerConfigured = computed(
    () => this.store.providers()?.providers.filter((provider) => provider.configured).length ?? 0,
  );
  readonly providerTotal = computed(() => this.store.providers()?.providers.length ?? 0);

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

  setTheme(next: Theme): void {
    void this.appSettings.setTheme(next);
  }
}

function fieldValue(event: Event): string {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target.value;
  return '';
}

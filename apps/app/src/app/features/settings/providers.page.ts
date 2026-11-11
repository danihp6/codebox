import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { formatFire } from '../../core/util/time-format';
import { translate } from './i18n';
import { ProvidersStore } from './providers.store';
import type { ProviderRow } from './providers.store';

const FALLBACK_TIME_ZONE = 'UTC';

const LAST_FOUR_LIMIT = 4;

@Component({
  selector: 'app-providers-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ProvidersStore],
  styles: [
    `
      .cb-providers {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-provider {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: baseline;
        border-block-end: 1px solid var(--cb-surface);
        padding-block: calc(var(--cb-space) * 2);
        overflow-wrap: anywhere;
      }
      .cb-provider-accounts {
        display: flex;
        flex-direction: column;
        flex-basis: 100%;
        gap: calc(var(--cb-space) * 2);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-provider-account {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: baseline;
        overflow-wrap: anywhere;
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
    <div
      data-testid="providers-panel"
      [attr.data-count]="store.providers().length"
      [attr.data-unavailable]="store.unavailable()"
    >
      <h3>{{ t('settings.section.providers') }}</h3>

      @if (store.loading()) {
        <div data-testid="providers-loading" aria-busy="true">…</div>
      }

      @if (store.error(); as failure) {
        <div
          class="cb-unavailable"
          role="alert"
          data-testid="providers-error"
          [attr.data-code]="failure.code"
        >
          <p class="cb-mono">{{ failure.code }}</p>
          <button type="button" data-testid="providers-retry" (click)="store.load()">
            {{ t('common.retry') }}
          </button>
        </div>
      }

      @if (store.unavailable()) {
        <p class="cb-unavailable" data-testid="providers-unavailable">
          {{ t('settings.unavailable') }}
        </p>
      }

      @if (empty()) {
        <p data-testid="providers-empty">{{ t('settings.provider.empty') }}</p>
      }

      @if (store.providers().length > 0) {
        <ul class="cb-providers">
          @for (provider of store.providers(); track provider.id) {
            <li
              class="cb-provider"
              data-testid="provider-row"
              [attr.data-provider]="provider.id"
              [attr.data-auth-kind]="provider.authKind"
              [attr.data-accounts]="provider.accounts.length"
            >
              <span class="cb-mono" data-testid="provider-label">{{ provider.label }}</span>
              <span class="cb-muted" data-testid="provider-auth-kind">{{ provider.authKind }}</span>
              @if (provider.accounts.length === 0) {
                <p class="cb-muted" data-testid="provider-account-empty">
                  {{ t('settings.provider.account.empty') }}
                </p>
              } @else {
                <p class="cb-muted" data-testid="provider-accounts-count">
                  {{ provider.accounts.length }} {{ t('settings.provider.accounts') }}
                </p>
                <ul class="cb-provider-accounts">
                  @for (account of provider.accounts; track account.id) {
                    <li
                      class="cb-provider-account"
                      data-testid="provider-account-row"
                      [attr.data-account]="account.id"
                      [attr.data-state]="account.state"
                      [attr.data-priority]="account.priority"
                    >
                      <span data-testid="provider-account-label">{{ account.label }}</span>
                      <span class="cb-mono" data-testid="provider-account-state">
                        {{ account.state }}
                      </span>
                      <span>
                        {{ t('settings.provider.account.priority') }}:
                        <span class="cb-mono" data-testid="provider-account-priority">
                          {{ account.priority }}
                        </span>
                      </span>
                      <span>
                        {{ t('settings.provider.account.spend') }}:
                        <span class="cb-mono" data-testid="provider-account-spend">
                          {{ spend(account) }}
                        </span>
                      </span>
                      <span>
                        {{ t('settings.provider.account.reset') }}:
                        @if (account.resetAt; as at) {
                          <span class="cb-mono" data-testid="provider-account-reset">
                            {{ instant(at) }}
                          </span>
                        } @else {
                          {{ t('settings.value.none') }}
                        }
                      </span>
                      <span>
                        {{ t('settings.provider.account.lastFour') }}:
                        <span class="cb-mono" data-testid="provider-account-last-four">
                          {{ shortLastFour(account.lastFour) }}
                        </span>
                      </span>
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ul>
      }

      <button type="button" data-testid="providers-close" (click)="close()">
        {{ t('settings.provider.close') }}
      </button>
    </div>
  `,
})
export class ProvidersPanel {
  readonly store = inject(ProvidersStore);
  readonly closed = output<void>();

  private readonly i18n = inject(I18nService);
  private readonly timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE;

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  readonly spend = (account: ProviderRow['accounts'][number]): string =>
    account.budgetUsd === null
      ? `$${account.usedToday.usd.toFixed(2)}`
      : `$${account.usedToday.usd.toFixed(2)} / $${account.budgetUsd.toFixed(2)}`;

  readonly empty = computed(
    () =>
      !this.store.loading() &&
      !this.store.unavailable() &&
      this.store.error() === null &&
      this.store.providers().length === 0,
  );

  constructor() {
    this.store.load();
  }

  instant(iso: string): string {
    return formatFire(iso, this.timeZone, this.i18n.locale());
  }

  shortLastFour(value: string): string {
    return value.slice(0, LAST_FOUR_LIMIT);
  }

  close(): void {
    this.closed.emit();
  }
}

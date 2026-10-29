import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { formatFire } from '../../core/util/time-format';
import { translate } from './i18n';
import { ProvidersStore } from './providers.store';

/** docs/app.md §9: a fingerprint is a label, never a secret; four characters is the whole hint. */
const FINGERPRINT_PREFIX = 4;

const FALLBACK_TIME_ZONE = 'UTC';

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
          @for (provider of store.providers(); track provider.provider) {
            <li
              class="cb-provider"
              data-testid="provider-row"
              [attr.data-provider]="provider.provider"
              [attr.data-configured]="provider.configured"
              [attr.data-mode]="provider.mode"
            >
              <span class="cb-mono">{{ provider.provider }}</span>
              <span>
                {{
                  provider.configured
                    ? t('settings.provider.configured')
                    : t('settings.provider.missing')
                }}
              </span>
              <span class="cb-muted">
                {{ t('settings.provider.mode') }}:
                <span class="cb-mono">{{ provider.mode }}</span>
              </span>
              <span class="cb-muted">
                {{ t('settings.provider.lastOk') }}:
                @if (provider.lastOkAt; as at) {
                  <span class="cb-mono" data-testid="provider-last-ok">{{ lastOk(at) }}</span>
                } @else {
                  {{ t('settings.provider.never') }}
                }
              </span>
              @if (provider.fingerprint; as fingerprint) {
                <span class="cb-muted">
                  {{ t('settings.provider.fingerprint') }}:
                  <span class="cb-mono" data-testid="provider-fingerprint">
                    {{ shortFingerprint(fingerprint) }}
                  </span>
                </span>
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

  lastOk(iso: string): string {
    return formatFire(iso, this.timeZone, this.i18n.locale());
  }

  shortFingerprint(fingerprint: string): string {
    return fingerprint.slice(0, FINGERPRINT_PREFIX);
  }

  close(): void {
    this.closed.emit();
  }
}

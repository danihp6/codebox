import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Health } from '@codebox/contracts';
import { IonContent } from '@ionic/angular';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './about.i18n';
import type { Locale } from './about.i18n';
import { AboutStore } from './about.store';
import { THIRD_PARTY_NOTICES } from './notice';
import type { ThirdPartyNotice } from './notice';

const MISSING = '—';
const SEPARATOR = ' · ';

/**
 * Frame `07 · About — mobile dark`: the back link with the title, the `codebox` wordmark and its
 * tagline, the raised card with the four label / value rows, the hairline rule and the health line
 * with its status dot, the licences disclosure and the two footnotes. The two reads stay in
 * `AboutStore`; this page only formats what the daemon already reports.
 */
@Component({
  selector: 'app-about-page',
  standalone: true,
  imports: [RouterLink, IonContent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [AboutStore],
  styles: [
    `
      :host {
        --cb-about-stroke: color-mix(in srgb, var(--cb-muted) 28%, transparent);
      }
      ion-content.cb-about-content {
        --background: var(--cb-bg);
      }
      /* The footnotes sit at the bottom of the frame, so the scroll wrapper is a full-height
         column and the page div takes the slack. */
      ion-content.cb-about-content::part(scroll) {
        display: flex;
        flex-direction: column;
      }
      .cb-about {
        display: flex;
        flex: 1 0 auto;
        flex-direction: column;
        min-block-size: 100%;
        padding: 50px 24px 24px;
        background: var(--cb-bg);
        color: var(--cb-text);
        font-family: var(--cb-font-sans);
      }
      .cb-about-head {
        display: flex;
        align-items: flex-start;
        block-size: 27px;
        margin-block-end: 41px;
      }
      /* The chevron is the drawn 8 × 27 glyph; the anchor keeps a 44 px tap target around it. */
      .cb-about-back {
        display: inline-grid;
        place-items: center;
        flex: none;
        inline-size: 44px;
        block-size: 44px;
        margin-block-start: -8px;
        margin-inline-start: -24px;
        margin-inline-end: -4px;
        color: var(--cb-accent);
        font-size: 22px;
        font-weight: 400;
        line-height: 27px;
        text-decoration: none;
      }
      .cb-about-title {
        margin: 6px 0 0;
        color: var(--cb-text);
        font-size: 15px;
        font-weight: 600;
        line-height: 18px;
        overflow-wrap: anywhere;
      }
      .cb-about-wordmark {
        margin: 0;
        color: var(--cb-text);
        font-size: 34px;
        font-weight: 600;
        line-height: 41px;
      }
      .cb-about-tagline {
        margin: 3px 0 0;
        color: var(--cb-muted);
        font-size: 12px;
        font-weight: 400;
        line-height: 15px;
        overflow-wrap: anywhere;
      }
      .cb-about-state {
        margin-block-start: 16px;
        padding: 12px;
        border: 1px dashed var(--cb-muted);
        border-radius: 10px;
        color: var(--cb-muted);
        font-size: 12px;
        line-height: 15px;
        overflow-wrap: anywhere;
      }
      .cb-about-state p {
        margin: 0 0 8px;
      }
      .cb-about-retry {
        min-block-size: 32px;
        padding-inline: 12px;
        border: 1px solid var(--cb-about-stroke);
        border-radius: 8px;
        background: var(--cb-bg);
        color: var(--cb-text);
        font: inherit;
        cursor: pointer;
      }
      .cb-about-card {
        margin-block-start: 27px;
        min-block-size: 200px;
        padding: 15px 15px 4px;
        border: 1px solid var(--cb-about-stroke);
        border-radius: 14px;
        background: var(--cb-surface);
      }
      .cb-about-rows {
        display: flex;
        flex-direction: column;
        margin: 0;
      }
      /* The four rows sit on the frame's 34 px pitch: 15 px of type and 19 px of gap. A row keeps
         that minimum and grows instead of clipping when a value wraps at 320 px. */
      .cb-about-row {
        display: grid;
        grid-template-columns: 110px minmax(0, 1fr);
        align-items: start;
        min-block-size: 15px;
      }
      .cb-about-row + .cb-about-row {
        margin-block-start: 19px;
      }
      .cb-about-row-label {
        color: var(--cb-muted);
        font-size: 11px;
        font-weight: 400;
        line-height: 13px;
        overflow-wrap: anywhere;
      }
      .cb-about-row-value {
        color: var(--cb-text);
        font-size: 12px;
        font-weight: 400;
        line-height: 15px;
        overflow-wrap: anywhere;
      }
      .cb-about-rule {
        block-size: 1px;
        margin: 15px 0 0;
        border: 0;
        background: var(--cb-muted);
        opacity: 0.25;
      }
      .cb-about-health {
        margin: 11px 0 0;
        color: var(--cb-muted);
        font-size: 11px;
        font-weight: 400;
        line-height: 13px;
        overflow-wrap: anywhere;
      }
      /* The queue and the component states are attributes only: the frame draws no such text. */
      .cb-about-fact {
        display: none;
      }
      .cb-about-health-state {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 9px 0 0;
        font-size: 11px;
        font-weight: 400;
        line-height: 13px;
      }
      .cb-about-health-dot {
        flex: none;
        inline-size: 5px;
        block-size: 5px;
        border-radius: 50%;
      }
      .cb-about-health-dot[data-status='ok'] {
        background: var(--cb-accent);
      }
      .cb-about-health-dot[data-status='degraded'] {
        background: var(--cb-warn);
      }
      .cb-about-health-dot[data-status='down'] {
        background: var(--cb-danger);
      }
      .cb-about-health-status {
        color: var(--cb-accent);
      }
      .cb-about-health-status[data-status='degraded'] {
        color: var(--cb-warn);
      }
      .cb-about-health-status[data-status='down'] {
        color: var(--cb-danger);
      }
      .cb-about-licences {
        margin-block-start: 20px;
        border: 1px solid var(--cb-about-stroke);
        border-radius: 10px;
        background: var(--cb-surface);
      }
      .cb-about-licences-summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-block-size: 50px;
        padding-inline: 15px 11px;
        cursor: pointer;
        list-style: none;
      }
      .cb-about-licences-summary::-webkit-details-marker {
        display: none;
      }
      .cb-about-licences-label {
        color: var(--cb-text);
        font-size: 13px;
        font-weight: 400;
        line-height: 16px;
        overflow-wrap: anywhere;
      }
      .cb-about-licences-chevron {
        flex: none;
        color: var(--cb-muted);
        font-size: 14px;
        font-weight: 400;
        line-height: 17px;
        transition: transform 120ms ease;
      }
      .cb-about-licences[open] .cb-about-licences-chevron {
        transform: rotate(90deg);
      }
      .cb-about-notices {
        padding: 0 15px 12px;
      }
      .cb-about-notice-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-about-notice {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding-block-start: 6px;
        border-block-start: 1px solid var(--cb-about-stroke);
        font-size: 10px;
        font-weight: 400;
        line-height: 12px;
        overflow-wrap: anywhere;
      }
      .cb-about-notice-name {
        font-family: var(--cb-font-mono);
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-about-notice-licence {
        color: var(--cb-text);
      }
      .cb-about-footnotes {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-block-start: auto;
        padding-block-start: 24px;
      }
      .cb-about-footnote {
        margin: 0;
        color: var(--cb-muted);
        font-size: 10px;
        font-weight: 400;
        line-height: 12px;
        overflow-wrap: anywhere;
      }
      @media (prefers-reduced-motion: reduce) {
        .cb-about-licences-chevron {
          transition: none;
        }
      }
    `,
  ],
  template: `
    <ion-content class="cb-about-content">
      <div
        class="cb-about"
        data-testid="page-about"
        [attr.data-status]="store.health()?.status ?? ''"
      >
        <header class="cb-about-head">
          <a
            class="cb-about-back"
            data-testid="about-back"
            routerLink="/settings"
            [attr.aria-label]="t('about.title')"
            >‹</a
          >
          <h1 class="cb-about-title">{{ t('about.title') }}</h1>
        </header>

        <p class="cb-about-wordmark" data-testid="about-wordmark">{{ t('about.wordmark') }}</p>
        <p class="cb-about-tagline" data-testid="about-tagline">{{ t('about.tagline') }}</p>

        @if (store.loading()) {
          <div class="cb-about-state" data-testid="about-loading" aria-busy="true">…</div>
        }

        @if (store.error(); as failure) {
          <div class="cb-about-state" data-testid="about-error" [attr.data-code]="failure.code">
            <p>{{ t('about.error') }}</p>
            <button
              type="button"
              class="cb-about-retry"
              data-testid="about-retry"
              (click)="store.reload()"
            >
              {{ t('about.retry') }}
            </button>
          </div>
        }

        @if (store.version() || store.health()) {
          <section
            class="cb-about-card"
            data-testid="about-card"
            [attr.data-version]="store.version()?.version"
            [attr.data-node]="store.version()?.node"
          >
            @if (store.version(); as version) {
              <div class="cb-about-rows">
                <div class="cb-about-row" data-testid="about-row" data-row="version">
                  <span class="cb-about-row-label" data-testid="about-row-label">
                    {{ t('about.version') }}
                  </span>
                  <span class="cb-about-row-value" data-testid="about-row-value">
                    <span data-testid="about-version" [attr.data-version]="version.version">
                      {{ version.version }}
                    </span>
                  </span>
                </div>
                <div class="cb-about-row" data-testid="about-row" data-row="commit">
                  <span class="cb-about-row-label" data-testid="about-row-label">
                    {{ t('about.commit') }}
                  </span>
                  <span class="cb-about-row-value" data-testid="about-row-value">
                    <span data-testid="about-commit" [attr.data-commit]="version.commit ?? 'none'">
                      {{ version.commit ?? '—' }}
                    </span>
                  </span>
                </div>
                <div class="cb-about-row" data-testid="about-row" data-row="build">
                  <span class="cb-about-row-label" data-testid="about-row-label">
                    {{ t('about.build') }}
                  </span>
                  <span class="cb-about-row-value" data-testid="about-row-value">
                    <span
                      data-testid="about-built-at"
                      [attr.data-built-at]="version.builtAt ?? 'none'"
                    >
                      {{ formatBuiltAt(version.builtAt) }}
                    </span>
                  </span>
                </div>
                <div class="cb-about-row" data-testid="about-row" data-row="instance">
                  <span class="cb-about-row-label" data-testid="about-row-label">
                    {{ t('about.instance') }}
                  </span>
                  <span class="cb-about-row-value" data-testid="about-row-value">
                    <span data-testid="about-instance" data-identity="unavailable">—</span>
                  </span>
                </div>
              </div>
            }

            @if (store.health(); as health) {
              <hr class="cb-about-rule" aria-hidden="true" />
              <p
                class="cb-about-health"
                data-testid="about-health"
                [attr.data-status]="health.status"
                [attr.data-db]="health.db"
                [attr.data-opencode]="health.opencode"
                [attr.data-disk-percent]="health.disk.usedPercent"
              >
                {{ healthLine(health) }}
                <span
                  class="cb-about-fact"
                  data-testid="about-health-db"
                  [attr.data-state]="health.db"
                ></span>
                <span
                  class="cb-about-fact"
                  data-testid="about-health-opencode"
                  [attr.data-state]="health.opencode"
                ></span>
                <span
                  class="cb-about-fact"
                  data-testid="about-health-disk"
                  [attr.data-percent]="health.disk.usedPercent"
                ></span>
                <span
                  class="cb-about-fact"
                  data-testid="about-health-queue"
                  [attr.data-pending]="health.queue.pending"
                  [attr.data-running]="health.queue.running"
                  [attr.data-max]="health.queue.maxConcurrency"
                ></span>
              </p>
              <p class="cb-about-health-state">
                <span
                  class="cb-about-health-dot"
                  data-testid="about-health-dot"
                  aria-hidden="true"
                  [attr.data-status]="health.status"
                ></span>
                <span
                  class="cb-about-health-status"
                  data-testid="about-health-status"
                  [attr.data-status]="health.status"
                  >{{ healthLabel(health.status) }}</span
                >
              </p>
            }
          </section>
        }

        <details class="cb-about-licences" data-testid="about-licences">
          <summary class="cb-about-licences-summary">
            <span class="cb-about-licences-label" data-testid="about-licences-label">
              {{ t('about.licences') }}
            </span>
            <span
              class="cb-about-licences-chevron"
              data-testid="about-licences-chevron"
              aria-hidden="true"
              >›</span
            >
          </summary>
          <div
            class="cb-about-notices"
            data-testid="about-notice"
            [attr.data-packages]="notices.length"
          >
            <ul class="cb-about-notice-list">
              @for (notice of notices; track notice.label) {
                <li
                  class="cb-about-notice"
                  data-testid="about-notice-item"
                  [attr.data-package]="notice.label"
                  [attr.data-licence]="notice.licence"
                >
                  <span class="cb-about-notice-name">{{ notice.label }}</span>
                  <span class="cb-about-notice-licence">{{ notice.licence }}</span>
                </li>
              }
            </ul>
          </div>
        </details>

        <footer class="cb-about-footnotes">
          <p class="cb-about-footnote" data-testid="about-footnote" data-note="1">
            {{ t('about.footnote.licences') }}
          </p>
          <p class="cb-about-footnote" data-testid="about-footnote" data-note="2">
            {{ t('about.footnote.durability') }}
          </p>
        </footer>
      </div>
    </ion-content>
  `,
})
export class AboutPage {
  private readonly i18n = inject(I18nService);

  readonly store: AboutStore = inject(AboutStore);
  readonly notices: readonly ThirdPartyNotice[] = THIRD_PARTY_NOTICES;
  readonly locale: Signal<Locale> = this.i18n.locale;
  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  constructor() {
    this.store.load();
  }

  formatBuiltAt(value: string | null): string {
    if (value === null) return MISSING;
    const built = new Date(value);
    if (Number.isNaN(built.getTime())) return MISSING;
    const iso = built.toISOString();
    return `${iso.slice(0, 10)} · ${iso.slice(11, 16)} UTC`;
  }

  healthLine(health: Health): string {
    return [
      `${this.t('about.health.db')} ${health.db}`,
      `${this.t('about.health.opencode')} ${health.opencode}`,
      `${this.t('about.health.disk')} ${health.disk.usedPercent}%`,
    ].join(SEPARATOR);
  }

  healthLabel(status: Health['status']): string {
    return this.t(`about.health.${status}`);
  }
}

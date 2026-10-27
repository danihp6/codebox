import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './about.i18n';
import { AboutStore } from './about.store';
import { THIRD_PARTY_NOTICES } from './notice';

const MISSING = '—';

@Component({
  selector: 'app-about-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [AboutStore],
  styles: [
    `
      .cb-about-section {
        margin-block-start: calc(var(--cb-space) * 5);
      }
      .cb-about-section h2 {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-about-section p {
        margin: calc(var(--cb-space) * 1) 0;
        overflow-wrap: anywhere;
      }
      .cb-about-notices {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-about-notice {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cb-space);
        border-block-end: 1px solid var(--cb-surface);
        padding-block: calc(var(--cb-space) * 2);
        overflow-wrap: anywhere;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('about.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-about" [attr.data-status]="store.health()?.status ?? ''">
        @if (store.loading()) {
          <div data-testid="about-loading" aria-busy="true">…</div>
        }

        @if (store.error(); as failure) {
          <div data-testid="about-error" [attr.data-code]="failure.code">
            <p>{{ t('about.error') }}</p>
            <button type="button" data-testid="about-retry" (click)="store.reload()">
              {{ t('about.retry') }}
            </button>
          </div>
        }

        @if (store.version(); as version) {
          <section class="cb-about-section">
            <h2>{{ t('about.section.build') }}</h2>
            <p data-testid="about-version" [attr.data-version]="version.version">
              {{ t('about.version') }}: <span class="cb-mono">{{ version.version }}</span>
            </p>
            <p data-testid="about-commit" [attr.data-commit]="version.commit ?? 'none'">
              {{ t('about.commit') }}: <span class="cb-mono">{{ version.commit ?? '—' }}</span>
            </p>
            <p data-testid="about-built-at" [attr.data-built-at]="version.builtAt ?? 'none'">
              {{ t('about.built-at') }}:
              <span class="cb-mono">{{ formatBuiltAt(version.builtAt) }}</span>
            </p>
            <p data-testid="about-node" [attr.data-node]="version.node">
              {{ t('about.node') }}: <span class="cb-mono">{{ version.node }}</span>
            </p>
          </section>
        }

        @if (store.health(); as health) {
          <section
            class="cb-about-section"
            data-testid="about-health"
            [attr.data-status]="health.status"
          >
            <h2>{{ t('about.section.health') }}</h2>
            <p data-testid="about-health-db" [attr.data-state]="health.db">
              {{ t('about.health.db') }}: <span class="cb-mono">{{ health.db }}</span>
            </p>
            <p data-testid="about-health-opencode" [attr.data-state]="health.opencode">
              {{ t('about.health.opencode') }}: <span class="cb-mono">{{ health.opencode }}</span>
            </p>
            <p data-testid="about-health-disk" [attr.data-percent]="health.disk.usedPercent">
              {{ t('about.health.disk') }}:
              <span class="cb-mono">{{ health.disk.usedPercent }}%</span>
            </p>
            <p
              data-testid="about-health-queue"
              [attr.data-pending]="health.queue.pending"
              [attr.data-running]="health.queue.running"
              [attr.data-max]="health.queue.maxConcurrency"
            >
              {{ t('about.health.queue') }}:
              <span class="cb-mono">
                {{ health.queue.pending }}/{{ health.queue.running }}/{{
                  health.queue.maxConcurrency
                }}
              </span>
            </p>
          </section>
        }

        <section
          class="cb-about-section"
          data-testid="about-notice"
          [attr.data-packages]="notices.length"
        >
          <h2>{{ t('about.section.notices') }}</h2>
          <p>
            {{ t('about.notices.count') }}: <span class="cb-mono">{{ notices.length }}</span>
          </p>
          <ul class="cb-about-notices">
            @for (notice of notices; track notice.label) {
              <li
                class="cb-about-notice"
                data-testid="about-notice-item"
                [attr.data-package]="notice.label"
                [attr.data-licence]="notice.licence"
              >
                <span class="cb-mono">{{ notice.label }}</span>
                <span>{{ notice.licence }}</span>
              </li>
            }
          </ul>
        </section>
      </div>
    </ion-content>
  `,
})
export class AboutPage {
  readonly store = inject(AboutStore);
  readonly notices = THIRD_PARTY_NOTICES;

  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  constructor() {
    this.store.load();
  }

  formatBuiltAt(value: string | null): string {
    return value ?? MISSING;
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { DashboardStore } from './dashboard.store';
import { translate } from './i18n';

export function formatUsd(usd: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd);
}

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [RouterLink, IonContent, IonHeader, IonTitle, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DashboardStore],
  styles: [
    `
      .cb-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: calc(var(--cb-space) * 3);
      }
      .cb-card {
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 3);
        background: var(--cb-surface);
      }
      .cb-card h2,
      .cb-dashboard-section h2 {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-card p {
        margin: calc(var(--cb-space) * 1) 0;
      }
      .cb-card[data-status='down'],
      .cb-card[data-status='degraded'] {
        border-color: var(--cb-warn);
      }
      .cb-dashboard-section {
        margin-block-start: calc(var(--cb-space) * 5);
      }
      .cb-recent {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-recent-run {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: baseline;
        border-block-end: 1px solid var(--cb-surface);
        padding-block: calc(var(--cb-space) * 2);
        cursor: pointer;
        overflow-wrap: anywhere;
        color: inherit;
        text-decoration: none;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('dashboard.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-dashboard">
        @if (store.loading()) {
          <div data-testid="dashboard-loading">{{ t('common.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div data-testid="dashboard-error" [attr.data-code]="failure.code">
            <p>{{ t('common.error') }}</p>
            <button type="button" data-testid="dashboard-retry" (click)="store.reload()">
              {{ t('dashboard.action.retry') }}
            </button>
          </div>
        }

        <section class="cb-cards">
          @if (store.health(); as health) {
            <article class="cb-card" data-testid="health-vm" [attr.data-status]="health.status">
              <h2>{{ t('dashboard.section.health') }}</h2>
              <p data-testid="health-db" [attr.data-state]="health.db">
                {{ t('dashboard.vm.db') }}: <span class="cb-mono">{{ health.db }}</span>
              </p>
              <p data-testid="health-opencode" [attr.data-state]="health.opencode">
                {{ t('dashboard.vm.opencode') }}: <span class="cb-mono">{{ health.opencode }}</span>
              </p>
              <p data-testid="health-disk" [attr.data-percent]="health.disk.usedPercent">
                {{ t('dashboard.vm.disk') }}:
                <span class="cb-mono">{{ health.disk.usedPercent }}%</span>
              </p>
            </article>
            <article
              class="cb-card"
              data-testid="health-queue"
              [attr.data-pending]="health.queue.pending"
              [attr.data-running]="health.queue.running"
              [attr.data-max]="health.queue.maxConcurrency"
            >
              <h2>{{ t('dashboard.section.queue') }}</h2>
              <p>
                {{ t('dashboard.queue.pending') }}:
                <span class="cb-mono">{{ health.queue.pending }}</span>
              </p>
              <p>
                {{ t('dashboard.queue.running') }}:
                <span class="cb-mono">{{ health.queue.running }}</span>
              </p>
              <p>
                {{ t('dashboard.queue.max') }}:
                <span class="cb-mono">{{ health.queue.maxConcurrency }}</span>
              </p>
            </article>
          }
          @if (store.telemetry(); as telemetry) {
            <article class="cb-card" data-testid="health-spend" [attr.data-usd]="telemetry.spendUsd">
              <h2>{{ t('dashboard.section.spend') }}</h2>
              <p class="cb-mono">{{ formatUsd(telemetry.spendUsd) }}</p>
            </article>
          }
        </section>

        <section class="cb-dashboard-section">
          <h2>{{ t('dashboard.section.recent') }}</h2>
          @if (store.recentRuns().length === 0) {
            @if (!store.loading()) {
              <p data-testid="dashboard-empty">{{ t('dashboard.empty') }}</p>
            }
          } @else {
            <ul class="cb-recent">
              @for (run of store.recentRuns(); track run.id) {
                <li>
                  <a
                    class="cb-recent-run"
                    data-testid="recent-run"
                    [attr.data-run-id]="run.id"
                    [attr.data-state]="run.state"
                    [attr.data-created-at]="run.createdAt"
                    [routerLink]="['/runs', run.id]"
                  >
                    <span class="cb-mono">{{ run.id }}</span>
                    <span>{{ t('dashboard.state.' + run.state) }}</span>
                    <span class="cb-mono">{{ run.createdAt }}</span>
                  </a>
                </li>
              }
            </ul>
          }
        </section>

        @if (store.stale()) {
          <div data-testid="dashboard-stale">{{ t('dashboard.stale') }}</div>
        }
      </div>
    </ion-content>
  `,
})
export class DashboardPage {
  readonly store = inject(DashboardStore);
  readonly formatUsd = formatUsd;

  private readonly sse = inject(SseService);
  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  constructor() {
    this.store.load();
    effect(() => {
      const event = this.sse.event();
      if (event === null) return;
      untracked(() => {
        this.store.applyStreamEvent(event);
      });
    });
  }
}

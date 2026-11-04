import { ChangeDetectionStrategy, Component, effect, inject, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { Health, RunState } from '@codebox/contracts';
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
      /* The frame "05 · Dashboard — mobile dark": a 24 px page margin, a 342-wide column of
         blocks 20 px apart, and the last card clear of the 64-high tab bar. Every colour is a
         --cb-* variable; the stroke the frame draws at 1 px is mixed from the muted ink. */
      .cb-dash {
        --dash-stroke: color-mix(in srgb, var(--cb-muted) 24%, transparent);
        display: flex;
        flex-direction: column;
        gap: 20px;
        padding: 8px 24px 88px;
        background: var(--cb-bg);
        color: var(--cb-text);
        font-family: var(--cb-font-sans);
      }
      ion-toolbar {
        --background: var(--cb-bg);
        --border-width: 0;
        --padding-start: 0;
        --padding-end: 0;
      }
      .cb-dash-title {
        padding-inline: 24px;
        font-size: 24px;
        font-weight: 600;
        line-height: 29px;
        letter-spacing: normal;
        color: var(--cb-text);
      }
      .cb-block {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-inline-size: 0;
      }
      .cb-card {
        min-inline-size: 0;
        padding: 12px 16px;
        border: 1px solid var(--dash-stroke);
        border-radius: 14px;
        background: var(--cb-surface);
      }
      .cb-eyebrow {
        margin: 0;
        font-size: 10px;
        font-weight: 500;
        line-height: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-empty {
        margin: 0;
        font-size: 11px;
        font-weight: 400;
        line-height: 13px;
        color: var(--cb-muted);
      }
      .cb-dot {
        flex: none;
        inline-size: 6px;
        block-size: 6px;
        border-radius: 50%;
        background: var(--cb-muted);
      }
      .cb-dot[data-state='ok'] {
        background: var(--cb-accent);
      }
      .cb-dot[data-state='degraded'] {
        background: var(--cb-warn);
      }
      .cb-dot[data-state='down'] {
        background: var(--cb-danger);
      }

      .cb-needs {
        position: relative;
        border-color: var(--cb-warn);
      }
      .cb-needs .cb-eyebrow {
        color: var(--cb-warn);
      }
      .cb-needs-value {
        margin: 6px 0 0;
        padding-inline-end: 88px;
        font-size: 15px;
        font-weight: 600;
        line-height: 18px;
        color: var(--cb-text);
        overflow-wrap: anywhere;
      }
      .cb-needs-meta {
        margin: 6px 0 0;
        font-size: 11px;
        font-weight: 400;
        line-height: 13px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-needs-cta {
        position: absolute;
        inset-block-start: 16px;
        inset-inline-end: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: 80px;
        block-size: 28px;
        border-radius: 8px;
        background: var(--cb-warn);
        color: var(--cb-bg);
        font-size: 11px;
        font-weight: 600;
        line-height: 13px;
        text-decoration: none;
      }

      .cb-work {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        min-block-size: 56px;
        padding: 8px 16px 8px 28px;
        border: 1px solid var(--dash-stroke);
        border-radius: 12px;
        background: var(--cb-surface);
        color: inherit;
        text-decoration: none;
        overflow-wrap: anywhere;
      }
      .cb-work .cb-dot {
        position: absolute;
        inset-block-start: 22px;
        inset-inline-start: 16px;
        background: var(--cb-accent);
      }
      .cb-work-body {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 4px;
        min-inline-size: 0;
      }
      .cb-work-line {
        font-size: 11px;
        font-weight: 400;
        line-height: 13px;
        color: var(--cb-muted);
      }
      .cb-work-branch {
        font-size: 12px;
        font-weight: 400;
        line-height: 15px;
        color: var(--cb-text);
      }
      .cb-work-cost {
        flex: none;
        font-size: 11px;
        font-weight: 400;
        line-height: 13px;
        color: var(--cb-accent);
      }
      .cb-queue {
        margin: 4px 0 0;
        font-size: 11px;
        font-weight: 400;
        line-height: 13px;
        color: var(--cb-muted);
      }

      .cb-unrev {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        min-block-size: 44px;
        padding: 7px 16px;
        border: 1px solid var(--dash-stroke);
        border-radius: 10px;
        background: var(--cb-surface);
        color: inherit;
        text-decoration: none;
        overflow-wrap: anywhere;
      }
      .cb-unrev-body {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-inline-size: 0;
      }
      .cb-unrev-branch {
        font-size: 12px;
        font-weight: 400;
        line-height: 15px;
        color: var(--cb-text);
      }
      .cb-unrev-meta {
        font-size: 10px;
        font-weight: 400;
        line-height: 12px;
        color: var(--cb-muted);
      }
      .cb-unrev-cost {
        font-size: 10px;
        font-weight: 400;
        line-height: 12px;
        color: var(--cb-muted);
        text-align: end;
      }

      .cb-spend {
        min-block-size: 104px;
        padding: 16px;
      }
      .cb-spend-value {
        margin: 0;
        font-size: 24px;
        font-weight: 600;
        line-height: 29px;
        color: var(--cb-text);
      }
      .cb-spend-runs {
        margin: 8px 0 0;
        font-size: 11px;
        font-weight: 400;
        line-height: 13px;
        color: var(--cb-muted);
      }

      .cb-health {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0;
        min-block-size: 76px;
        padding: 12px 16px;
      }
      .cb-health-col {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-inline-size: 0;
      }
      .cb-health-head {
        display: flex;
        align-items: center;
        gap: 6px;
        min-inline-size: 0;
      }
      .cb-health-label {
        font-size: 10px;
        font-weight: 400;
        line-height: 12px;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-health-value {
        font-size: 13px;
        font-weight: 500;
        line-height: 16px;
        color: var(--cb-text);
        overflow-wrap: anywhere;
      }

      .cb-start {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
        padding: 20px;
      }
      .cb-start-title {
        margin: 0;
        font-size: 24px;
        font-weight: 600;
        line-height: 29px;
        color: var(--cb-text);
      }
      .cb-start-body {
        margin: 0;
        font-size: 13px;
        font-weight: 400;
        line-height: 16px;
        color: var(--cb-muted);
      }
      .cb-start-link {
        font-size: 13px;
        font-weight: 600;
        line-height: 16px;
        color: var(--cb-accent);
        text-decoration: none;
      }

      .cb-dashboard-section {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-inline-size: 0;
      }
      .cb-dashboard-section h2 {
        margin: 0;
        font-size: 10px;
        font-weight: 500;
        line-height: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--cb-muted);
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

      .cb-error {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        font-size: 12px;
        line-height: 15px;
        color: var(--cb-danger);
      }
      .cb-error p {
        margin: 0;
      }
      .cb-retry {
        min-block-size: 36px;
        padding: 0 16px;
        border: 1px solid var(--dash-stroke);
        border-radius: 8px;
        background: var(--cb-surface);
        color: var(--cb-text);
        font-family: var(--cb-font-sans);
        font-size: 12px;
        font-weight: 600;
        line-height: 15px;
        cursor: pointer;
      }
      .cb-stale {
        font-size: 11px;
        font-weight: 400;
        line-height: 13px;
        color: var(--cb-warn);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title class="cb-dash-title">{{ t('dashboard.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="cb-dash" data-testid="page-dashboard">
        @if (store.loading()) {
          <div data-testid="dashboard-loading">{{ t('common.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div class="cb-error" data-testid="dashboard-error" [attr.data-code]="failure.code">
            <p>{{ t('common.error') }}</p>
            <button
              type="button"
              class="cb-retry"
              data-testid="dashboard-retry"
              (click)="store.reload()"
            >
              {{ t('dashboard.action.retry') }}
            </button>
          </div>
        }

        @if (store.fresh()) {
          <section class="cb-card cb-start" data-testid="dashboard-start" data-repos="0">
            <h2 class="cb-start-title">{{ t('dashboard.start.title') }}</h2>
            <p class="cb-start-body">{{ t('dashboard.start.body') }}</p>
            <a class="cb-start-link" data-testid="dashboard-start-repos" routerLink="/repos">
              {{ t('dashboard.start.repos') }}
            </a>
          </section>
        } @else {
          <article
            class="cb-card cb-needs"
            data-testid="dashboard-needs-you"
            [attr.data-review]="store.ready().length"
            [attr.data-running]="store.working().length"
          >
            <p class="cb-eyebrow" data-testid="dashboard-eyebrow" data-section="needs">
              {{ t('dashboard.needs.eyebrow') }}
            </p>
            <p class="cb-needs-value" data-testid="dashboard-needs-value">
              {{ store.ready().length }} {{ t('dashboard.needs.review') }} ·
              {{ store.working().length }} {{ t('dashboard.needs.running') }}
            </p>
            <p class="cb-needs-meta" data-testid="dashboard-needs-meta">
              {{ t('dashboard.needs.meta') }}
            </p>
            <a class="cb-needs-cta" data-testid="dashboard-needs-cta" routerLink="/repos">
              {{ t('dashboard.needs.cta') }}
            </a>
          </article>

          <section
            class="cb-block"
            data-testid="dashboard-working"
            [attr.data-count]="store.working().length"
          >
            <p class="cb-eyebrow" data-testid="dashboard-eyebrow" data-section="working">
              {{ t('dashboard.section.working') }}
            </p>
            @if (store.working().length === 0) {
              <p class="cb-empty" data-testid="dashboard-working-empty">
                {{ t('dashboard.working.empty') }}
              </p>
            } @else {
              @for (run of store.working(); track run.id) {
                <a
                  class="cb-work"
                  data-testid="dashboard-working-run"
                  [attr.data-run-id]="run.id"
                  [attr.data-state]="run.state"
                  [routerLink]="['/repos', run.repoId]"
                >
                  <span class="cb-dot" aria-hidden="true"></span>
                  <span class="cb-work-body">
                    <span class="cb-work-line">
                      <span class="cb-mono">{{ run.id }}</span> · {{ stateLabel(run.state) }}
                    </span>
                    <span class="cb-work-branch">
                      {{ run.branch }}
                      @if (run.gate !== null) {
                        · {{ run.gate }}
                      }
                    </span>
                  </span>
                  <span class="cb-work-cost" data-testid="dashboard-working-cost">
                    {{ formatUsd(run.cost.usd) }}
                  </span>
                </a>
              }
            }
            @if (store.health(); as health) {
              <p
                class="cb-queue"
                data-testid="health-queue"
                [attr.data-pending]="health.queue.pending"
                [attr.data-running]="health.queue.running"
                [attr.data-max]="health.queue.maxConcurrency"
              >
                {{ health.queue.pending }} {{ t('dashboard.queue.pending') }} ·
                {{ freeSlots(health) }} {{ t('dashboard.queue.free') }}
              </p>
            }
          </section>

          <section
            class="cb-block"
            data-testid="dashboard-ready"
            [attr.data-count]="store.ready().length"
          >
            <p class="cb-eyebrow" data-testid="dashboard-eyebrow" data-section="ready">
              {{ t('dashboard.section.ready') }}
            </p>
            @if (store.ready().length === 0) {
              <p class="cb-empty" data-testid="dashboard-ready-empty">
                {{ t('dashboard.ready.empty') }}
              </p>
            } @else {
              @for (run of store.ready(); track run.id) {
                <a
                  class="cb-unrev"
                  data-testid="dashboard-ready-run"
                  [attr.data-run-id]="run.id"
                  [attr.data-pr]="run.pr?.number ?? ''"
                  [routerLink]="['/repos', run.repoId]"
                >
                  <span class="cb-unrev-body">
                    <span class="cb-unrev-branch">{{ run.branch }}</span>
                    <span class="cb-unrev-meta">
                      {{ t('dashboard.ready.pr') }} {{ run.pr?.number ?? '' }} ·
                      <span class="cb-mono">{{ run.id }}</span>
                    </span>
                  </span>
                  <span class="cb-unrev-cost">{{ formatUsd(run.cost.usd) }}</span>
                </a>
              }
            }
          </section>

          @if (store.telemetry(); as telemetry) {
            <section class="cb-block">
              <p class="cb-eyebrow" data-testid="dashboard-eyebrow" data-section="spend">
                {{ t('dashboard.section.spend') }}
              </p>
              <article
                class="cb-card cb-spend"
                data-testid="health-spend"
                [attr.data-usd]="telemetry.spendUsd"
                [attr.data-runs]="telemetry.runs.total"
              >
                <p class="cb-spend-value">{{ formatUsd(telemetry.spendUsd) }}</p>
                <p class="cb-spend-runs">
                  <span class="cb-mono">{{ telemetry.runs.total }}</span>
                  {{ t('dashboard.section.recent') }}
                </p>
              </article>
            </section>
          }

          @if (store.health(); as health) {
            <section class="cb-block">
              <p class="cb-eyebrow" data-testid="dashboard-eyebrow" data-section="health">
                {{ t('dashboard.section.health') }}
              </p>
              <article
                class="cb-card cb-health"
                data-testid="health-vm"
                [attr.data-status]="health.status"
              >
                <div class="cb-health-col" data-testid="health-db" [attr.data-state]="health.db">
                  <span class="cb-health-head">
                    <span class="cb-dot" [attr.data-state]="health.db" aria-hidden="true"></span>
                    <span class="cb-health-label">{{ t('dashboard.vm.db') }}</span>
                  </span>
                  <span class="cb-health-value">{{ health.db }}</span>
                </div>
                <div
                  class="cb-health-col"
                  data-testid="health-opencode"
                  [attr.data-state]="health.opencode"
                >
                  <span class="cb-health-head">
                    <span
                      class="cb-dot"
                      [attr.data-state]="health.opencode"
                      aria-hidden="true"
                    ></span>
                    <span class="cb-health-label">{{ t('dashboard.vm.opencode') }}</span>
                  </span>
                  <span class="cb-health-value">{{ health.opencode }}</span>
                </div>
                <div
                  class="cb-health-col"
                  data-testid="health-disk"
                  [attr.data-percent]="health.disk.usedPercent"
                >
                  <span class="cb-health-head">
                    <span
                      class="cb-dot"
                      [attr.data-state]="health.status"
                      aria-hidden="true"
                    ></span>
                    <span class="cb-health-label">{{ t('dashboard.vm.disk') }}</span>
                  </span>
                  <span class="cb-health-value">{{ health.disk.usedPercent }}%</span>
                </div>
              </article>
            </section>
          }

          <section class="cb-dashboard-section">
            <h2>{{ t('dashboard.section.recent') }}</h2>
            @if (store.recentRuns().length === 0) {
              @if (!store.loading()) {
                <p class="cb-empty" data-testid="dashboard-empty">{{ t('dashboard.empty') }}</p>
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
                      [routerLink]="['/repos', run.repoId]"
                    >
                      <span class="cb-mono">{{ run.id }}</span>
                      <span>{{ stateLabel(run.state) }}</span>
                      <span class="cb-mono">{{ run.createdAt }}</span>
                    </a>
                  </li>
                }
              </ul>
            }
          </section>
        }

        @if (store.stale()) {
          <div class="cb-stale" data-testid="dashboard-stale">{{ t('dashboard.stale') }}</div>
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

  stateLabel(state: RunState): string {
    return translate(this.i18n.locale(), `dashboard.state.${state}`);
  }

  /** The free slots the queue footer draws: `maxConcurrency` minus what is already running. */
  freeSlots(health: Health): number {
    return Math.max(0, health.queue.maxConcurrency - health.queue.running);
  }
}

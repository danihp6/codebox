import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { RUN_STATES } from '@codebox/contracts';
import type { RunState } from '@codebox/contracts';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './i18n';
import { RunsStore } from './runs.store';

@Component({
  selector: 'app-runs-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [RunsStore],
  styles: [
    `
      .cb-runs-head,
      .cb-runs-chips {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
      }
      .cb-runs-list {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-run-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cb-space);
        align-items: baseline;
        overflow-wrap: anywhere;
      }
      [data-active='true'] {
        border-color: var(--cb-accent);
        color: var(--cb-accent);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('runs.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-runs">
        <div class="cb-runs-head">
          <h1>{{ t('runs.title') }}</h1>
        </div>

        <div class="cb-runs-chips">
          <button
            type="button"
            data-testid="run-chip-all"
            [attr.data-active]="store.state() === null"
            (click)="store.setState(null)"
          >
            {{ t('runs.filter.all') }}
          </button>
          @for (state of states; track state) {
            <button
              type="button"
              data-testid="run-chip"
              [attr.data-state]="state"
              [attr.data-active]="store.state() === state"
              (click)="store.setState(state)"
            >
              {{ stateLabel(state) }}
            </button>
          }
        </div>

        @if (store.loading()) {
          <div data-testid="runs-loading">{{ t('runs.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div data-testid="runs-error" [attr.data-code]="failure.code">
            <p>{{ t('runs.error') }}</p>
            <button type="button" data-testid="runs-retry" (click)="store.load()">
              {{ t('runs.retry') }}
            </button>
          </div>
        }

        @if (!store.loading() && store.error() === null && store.runs().length === 0) {
          <p data-testid="runs-empty">{{ t('runs.empty') }}</p>
        }

        <ul class="cb-runs-list">
          @for (run of store.runs(); track run.id) {
            <li
              class="cb-run-row"
              data-testid="run-row"
              [attr.data-run-id]="run.id"
              [attr.data-state]="run.state"
              [attr.data-usd]="run.cost.usd"
            >
              <a [routerLink]="['/runs', run.id]">{{ run.branch }}</a>
              <span>{{ stateLabel(run.state) }}</span>
              <span class="cb-mono">{{ formatUsd(run.cost.usd) }}</span>
            </li>
          }
        </ul>

        @if (store.nextCursor() !== null) {
          <button
            type="button"
            data-testid="runs-more"
            [disabled]="store.loadingMore()"
            (click)="store.more()"
          >
            {{ t('runs.more') }}
          </button>
        }
      </div>
    </ion-content>
  `,
})
export class RunsPage {
  readonly store = inject(RunsStore);
  private readonly sse = inject(SseService);
  private readonly i18n = inject(I18nService);

  readonly locale = this.i18n.locale;
  readonly t = (key: string): string => translate(this.locale(), key);
  readonly states = RUN_STATES;

  constructor() {
    effect(() => {
      const event = this.sse.event();
      if (event === null) return;
      untracked(() => {
        this.store.applyStreamEvent(event);
      });
    });
    this.store.load();
  }

  stateLabel(state: RunState): string {
    return translate(this.locale(), `runs.state.${state}`);
  }

  formatUsd(usd: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd);
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { RunState } from '@codebox/contracts';
import { I18nService } from '../../core/i18n/i18n.service';
import { CronPickerComponent } from './cron-picker';
import { translate } from './i18n';
import { JobStore } from './job.store';
import { formatFire } from './time-format';

@Component({
  selector: 'app-job-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, RouterLink, CronPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [JobStore],
  styles: [
    `
      .cb-job-head,
      .cb-job-actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
      }
      .cb-job-section {
        margin-block-start: calc(var(--cb-space) * 4);
      }
      .cb-job-section h2 {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-job-fires,
      .cb-job-history {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('jobs.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-job" [attr.data-enabled]="store.detail()?.job.enabled ?? null">
        @if (store.loading()) {
          <div data-testid="job-detail-loading">{{ t('jobs.detail.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div data-testid="job-detail-error" [attr.data-code]="failure.code">
            <p>{{ t('jobs.detail.error') }}</p>
          </div>
        }

        @if (store.detail(); as detail) {
          <div class="cb-job-head">
            <h1>{{ detail.job.title }}</h1>
            <span class="cb-mono">{{ detail.job.id }}</span>
          </div>

          <section class="cb-job-section">
            <h2>{{ t('jobs.detail.cron') }}</h2>
            <app-cron-picker
              data-testid="job-cron"
              [expression]="cron()"
              [locale]="locale()"
              (changed)="cron.set($event)"
            />

            <label for="job-timezone">{{ t('jobs.detail.timezone') }}</label>
            <input
              id="job-timezone"
              data-testid="job-timezone"
              type="text"
              [value]="timezone()"
              (input)="timezone.set(valueOf($event))"
            />

            <div class="cb-job-actions">
              <button
                type="button"
                data-testid="job-save"
                [disabled]="store.saving()"
                (click)="save()"
              >
                {{ t('jobs.detail.save') }}
              </button>
            </div>

            @if (store.validation().problems.length > 0) {
              <p
                data-testid="job-validation"
                [attr.data-problems]="store.validation().problems.join(' ')"
              >
                {{ t('jobs.detail.validation') }}
              </p>
            }

            @if (store.timezoneError()) {
              <p data-testid="job-timezone-error">{{ t('jobs.validation.timezone') }}</p>
            }
          </section>

          <section class="cb-job-section">
            <h2>{{ t('jobs.detail.nextFires') }}</h2>
            @if (detail.nextFires.length === 0) {
              <p data-testid="job-next-empty">{{ t('jobs.detail.noFires') }}</p>
            } @else {
              <ul class="cb-job-fires">
                @for (fire of detail.nextFires; track fire) {
                  <li data-testid="job-next-fire" [attr.data-at]="fire">
                    {{ fireLabel(fire) }}
                  </li>
                }
              </ul>
            }
          </section>

          <section class="cb-job-section">
            <h2>{{ t('jobs.detail.history') }}</h2>
            <div class="cb-job-actions">
              <button type="button" data-testid="job-run-now" (click)="store.runNow()">
                {{ t('jobs.detail.runNow') }}
              </button>
            </div>

            @if (detail.lastRuns.length === 0) {
              <p data-testid="job-history-empty">{{ t('jobs.detail.historyEmpty') }}</p>
            } @else {
              <ul class="cb-job-history">
                @for (run of detail.lastRuns; track run.id) {
                  <li data-testid="job-history-run" [attr.data-run-id]="run.id" [attr.data-state]="run.state">
                    <a [routerLink]="['/runs', run.id]">{{ stateLabel(run.state) }}</a>
                  </li>
                }
              </ul>
            }
          </section>
        }
      </div>
    </ion-content>
  `,
})
export class JobPage {
  readonly id = input.required<string>();
  readonly store = inject(JobStore);
  private readonly i18n = inject(I18nService);

  readonly locale = this.i18n.locale;
  readonly t = (key: string): string => translate(this.locale(), key);
  readonly cron = signal('');
  readonly timezone = signal('');

  constructor() {
    effect(() => {
      const candidate = this.id();
      untracked(() => this.store.load(candidate));
    });
    effect(() => {
      const detail = this.store.detail();
      if (detail === null) return;
      untracked(() => {
        this.cron.set(detail.job.cron);
        this.timezone.set(detail.job.timezone);
      });
    });
  }

  fireLabel(fire: string): string {
    const detail = this.store.detail();
    return detail === null ? fire : formatFire(fire, detail.job.timezone, this.locale());
  }

  stateLabel(state: RunState): string {
    return translate(this.locale(), `jobs.detail.state.${state}`);
  }

  valueOf(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement ? target.value : '';
  }

  save(): void {
    this.store.saveCron(this.cron(), this.timezone());
  }
}

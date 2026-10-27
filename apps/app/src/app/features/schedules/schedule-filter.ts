import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { Schedule } from '@codebox/contracts';
import { I18nService } from '../../core/i18n/i18n.service';
import { formatFire } from '../jobs/time-format';
import type { ScheduleGroup } from './schedule-filter.store';
import { ScheduleFilterStore, isWindowOpen } from './schedule-filter.store';
import { translate } from './schedules.i18n';

export { groupSchedules, isWindowOpen } from './schedule-filter.store';
export type { ScheduleGroup } from './schedule-filter.store';

export interface ScheduleProposal {
  readonly title: string;
  readonly mode: Schedule['mode'];
  readonly cron: string | null;
  readonly timezone: string;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly prompt: string;
  readonly repoId: string | null;
  readonly cooldownMinutes?: number;
  readonly maxCostPerFireUsd?: number | null;
  /** The daemon's first computed fire, when the host already has it; the card never invents one. */
  readonly nextFireAt?: string | null;
}

@Component({
  selector: 'app-schedule-filter',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ScheduleFilterStore],
  styles: [
    `
      .cb-schedule-list {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-schedule-row {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        padding: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        overflow-wrap: anywhere;
      }
      .cb-schedule-row[data-window-open='true'] {
        border-color: var(--cb-accent);
      }
      .cb-schedule-row[data-unreviewed='true'] {
        border-inline-start: 3px solid var(--cb-warning);
        padding-inline-start: calc(var(--cb-space) * 3);
      }
      .cb-schedule-head,
      .cb-schedule-facts,
      .cb-schedule-fires {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cb-space);
        align-items: baseline;
      }
      .cb-schedule-title {
        font-weight: 600;
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
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('schedules.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div
        data-testid="page-schedule-filter"
        [attr.data-count]="store.groups().length"
        [attr.data-loading]="store.loading()"
      >
        @if (store.loading()) {
          <div data-testid="schedule-filter-loading" aria-busy="true">
            {{ t('schedules.loading') }}
          </div>
        }

        @if (store.error(); as failure) {
          <div
            class="cb-unavailable"
            role="alert"
            data-testid="schedule-filter-error"
            [attr.data-code]="failure.code"
          >
            <p>{{ t('schedules.error') }}</p>
            <button type="button" data-testid="schedule-filter-retry" (click)="store.reload()">
              {{ t('schedules.retry') }}
            </button>
          </div>
        }

        @if (!store.loading() && store.error() === null && store.groups().length === 0) {
          <p data-testid="schedule-filter-empty">{{ t('schedules.empty') }}</p>
        }

        <ol class="cb-schedule-list">
          @for (group of store.groups(); track group.schedule.id) {
            <li
              class="cb-schedule-row"
              data-testid="schedule-group"
              [attr.data-schedule-id]="group.schedule.id"
              [attr.data-mode]="group.schedule.mode"
              [attr.data-window-open]="windowOpen(group)"
              [attr.data-unreviewed]="group.unreviewed"
            >
              <div class="cb-schedule-head">
                <span class="cb-schedule-title" data-testid="schedule-group-title">
                  {{ group.schedule.title }}
                </span>
                <span data-testid="schedule-group-mode">{{ modeLabel(group.schedule) }}</span>
                @if (windowOpen(group)) {
                  <span data-testid="schedule-group-window">
                    {{ t('schedules.window.running') }}
                  </span>
                }
                @if (group.unreviewed) {
                  <span data-testid="schedule-group-unreviewed">
                    {{ t('schedules.unreviewed') }}
                  </span>
                }
              </div>

              <div class="cb-schedule-facts">
                <span>{{ t('schedules.fires') }}</span>
                <span class="cb-mono" data-testid="schedule-group-fires">
                  {{ group.schedule.firesCount }}
                </span>
                <span>{{ t('schedules.spend') }}</span>
                <span
                  class="cb-mono"
                  data-testid="schedule-group-spend"
                  [attr.data-spend]="group.schedule.spendUsd"
                >
                  {{ spend(group.schedule) }}
                </span>
              </div>

              <div class="cb-schedule-fires">
                <span>{{ t('schedules.next') }}</span>
                @if (group.nextFires.length === 0) {
                  <span data-testid="schedule-group-next-none">{{ t('schedules.next.none') }}</span>
                } @else {
                  @for (fire of group.nextFires; track $index) {
                    <span class="cb-mono" data-testid="schedule-group-next" [attr.data-at]="fire">
                      {{ nextFire(group, fire) }}
                    </span>
                  }
                }
              </div>
            </li>
          }
        </ol>
      </div>
    </ion-content>
  `,
})
export class ScheduleFilterPage {
  readonly store = inject(ScheduleFilterStore);

  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  constructor() {
    this.store.load();
  }

  modeLabel(schedule: Schedule): string {
    return translate(this.i18n.locale(), `schedules.mode.${schedule.mode}`);
  }

  windowOpen(group: ScheduleGroup): boolean {
    const schedule = group.schedule;
    if (
      schedule.mode !== 'window' ||
      schedule.windowStart === null ||
      schedule.windowEnd === null
    ) {
      return false;
    }
    return isWindowOpen(
      { start: schedule.windowStart, end: schedule.windowEnd, timezone: schedule.timezone },
      Date.now(),
    );
  }

  spend(schedule: Schedule): string {
    return new Intl.NumberFormat(this.i18n.locale(), {
      style: 'currency',
      currency: 'USD',
    }).format(schedule.spendUsd);
  }

  nextFire(group: ScheduleGroup, iso: string): string {
    return formatFire(iso, group.schedule.timezone, this.i18n.locale());
  }
}

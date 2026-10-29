import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { SCHEDULE_MODES } from '@codebox/contracts';
import type { ScheduleMode } from '@codebox/contracts';
import { I18nService } from '../../core/i18n/i18n.service';
import { formatFire } from '../../core/util/time-format';
import { RepoScheduleStore } from './repo-schedule.store';
import { RepoTabs } from './repo-tabs';
import { translate } from './repo-chrome.i18n';

@Component({
  selector: 'app-repo-schedule-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, RepoTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [RepoScheduleStore],
  styles: [
    `
      .cb-schedule-row {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 3);
        overflow-wrap: anywhere;
      }
      .cb-schedule-flow,
      .cb-schedule-actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
      }
      .cb-schedule-create {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        max-inline-size: 28rem;
      }
      .cb-schedule-create label {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
      }
      .cb-schedule-create input,
      .cb-schedule-create select {
        font: inherit;
        color: inherit;
        background: var(--cb-surface);
        border: 1px solid var(--cb-muted);
        border-radius: calc(var(--cb-radius) / 2);
        padding: calc(var(--cb-space) * 2);
      }
      .cb-muted {
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('repoTabs.schedule') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-repo-schedule" [attr.data-repo-id]="id()">
        <app-repo-tabs [repoId]="id()" />

        @if (store.loading()) {
          <div data-testid="repo-schedule-loading">{{ t('repoSchedule.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div data-testid="repo-schedule-error" [attr.data-code]="failure.code">
            <p>{{ t('repoSchedule.error') }}</p>
            <button type="button" data-testid="repo-schedule-retry" (click)="store.reload()">
              {{ t('repoSchedule.retry') }}
            </button>
          </div>
        }

        @if (store.notice(); as notice) {
          <div data-testid="repo-schedule-notice" [attr.data-reason]="notice">
            {{ t('repoSchedule.notice.' + notice) }}
          </div>
        }

        @if (store.schedule(); as schedule) {
          <section
            class="cb-schedule-row"
            data-testid="repo-schedule-row"
            [attr.data-schedule-id]="schedule.id"
            [attr.data-enabled]="schedule.enabled"
          >
            <p class="cb-schedule-flow">
              <span>{{ t('repoSchedule.mode') }}:</span>
              <span data-testid="repo-schedule-mode" [attr.data-mode]="schedule.mode">
                {{ t('repoSchedule.mode.' + schedule.mode) }}
              </span>
            </p>
            <p class="cb-schedule-flow">
              @if (schedule.cron !== null) {
                <span>{{ t('repoSchedule.cron') }}:</span>
                <span class="cb-mono" data-testid="repo-schedule-window" data-kind="cron">
                  {{ schedule.cron }}
                </span>
              } @else {
                <span>{{ t('repoSchedule.window') }}:</span>
                <span class="cb-mono" data-testid="repo-schedule-window" data-kind="window">
                  {{ schedule.windowStart }}–{{ schedule.windowEnd }}
                </span>
              }
            </p>
            <p class="cb-schedule-flow">
              <span>{{ t('repoSchedule.timezone') }}:</span>
              <span class="cb-mono" data-testid="repo-schedule-timezone">
                {{ schedule.timezone }}
              </span>
            </p>
            <p class="cb-schedule-flow">
              <span>{{ t('repoSchedule.maxFires') }}:</span>
              <span class="cb-mono" data-testid="repo-schedule-max-fires">
                {{ schedule.maxFires ?? t('repoSchedule.noCap') }}
              </span>
              <span>{{ t('repoSchedule.maxCost') }}:</span>
              <span class="cb-mono" data-testid="repo-schedule-max-cost">
                {{ schedule.maxCostPerFireUsd ?? t('repoSchedule.noCap') }}
              </span>
            </p>
            <p class="cb-schedule-flow">
              <span>{{ t('repoSchedule.fires') }}:</span>
              <span class="cb-mono" data-testid="repo-schedule-fires">
                {{ schedule.firesCount }}
              </span>
              <span>{{ t('repoSchedule.spend') }}:</span>
              <span class="cb-mono" data-testid="repo-schedule-spend">
                {{ formatUsd(schedule.spendUsd) }}
              </span>
            </p>
            <p class="cb-schedule-flow">
              <span>{{ t('repoSchedule.nextFire') }}:</span>
              <span class="cb-mono" data-testid="repo-schedule-next-fire">
                {{ fireAt(schedule.nextFireAt, schedule.timezone) }}
              </span>
            </p>
            <p class="cb-schedule-flow">
              <span>{{ t('repoSchedule.lastFired') }}:</span>
              <span class="cb-mono" data-testid="repo-schedule-last-fired">
                {{ fireAt(schedule.lastFiredAt, schedule.timezone) }}
              </span>
            </p>
            <div class="cb-schedule-actions">
              @if (schedule.enabled) {
                <button
                  type="button"
                  data-testid="repo-schedule-pause"
                  [disabled]="store.busy() !== null"
                  (click)="store.pause()"
                >
                  {{ t('repoSchedule.pause') }}
                </button>
              } @else {
                <button
                  type="button"
                  data-testid="repo-schedule-resume"
                  [disabled]="store.busy() !== null"
                  (click)="store.resume()"
                >
                  {{ t('repoSchedule.resume') }}
                </button>
              }
              <button
                type="button"
                data-testid="repo-schedule-run-next"
                [disabled]="store.busy() !== null"
                (click)="store.runNext()"
              >
                {{ t('repoSchedule.runNext') }}
              </button>
            </div>
            @if (store.nextRun(); as run) {
              <p class="cb-schedule-flow">
                <span>{{ t('repoSchedule.nextRun') }}:</span>
                <span
                  class="cb-mono"
                  data-testid="repo-schedule-next-run"
                  [attr.data-run-id]="run.id"
                  [attr.data-state]="run.state"
                >
                  {{ run.id }} · {{ run.state }}
                </span>
              </p>
            }
          </section>
        } @else if (!store.loading() && !store.error()) {
          <div data-testid="repo-schedule-empty">{{ t('repoSchedule.empty') }}</div>
          <form class="cb-schedule-create" data-testid="repo-schedule-create" (submit)="submit($event)">
            <label>
              <span>{{ t('repoSchedule.field.mode') }}</span>
              <select data-testid="repo-schedule-create-mode" (change)="setMode($event)">
                @for (candidate of modes; track candidate) {
                  <option [value]="candidate" [selected]="candidate === mode()">
                    {{ t('repoSchedule.mode.' + candidate) }}
                  </option>
                }
              </select>
            </label>
            <label>
              <span>{{ t('repoSchedule.field.timezone') }}</span>
              <input
                type="text"
                data-testid="repo-schedule-create-timezone"
                autocomplete="off"
                spellcheck="false"
                [value]="timezone()"
                (input)="setTimezone($event)"
              />
            </label>
            @if (mode() === 'window') {
              <label>
                <span>{{ t('repoSchedule.field.windowStart') }}</span>
                <input
                  type="time"
                  data-testid="repo-schedule-create-window-start"
                  [value]="windowStart()"
                  (input)="setWindowStart($event)"
                />
              </label>
              <label>
                <span>{{ t('repoSchedule.field.windowEnd') }}</span>
                <input
                  type="time"
                  data-testid="repo-schedule-create-window-end"
                  [value]="windowEnd()"
                  (input)="setWindowEnd($event)"
                />
              </label>
            } @else {
              <label>
                <span>{{ t('repoSchedule.field.cron') }}</span>
                <input
                  type="text"
                  data-testid="repo-schedule-create-cron"
                  autocomplete="off"
                  spellcheck="false"
                  [value]="cron()"
                  (input)="setCron($event)"
                />
              </label>
            }
            <button
              type="submit"
              data-testid="repo-schedule-create-submit"
              [disabled]="store.busy() !== null"
            >
              {{ t('repoSchedule.action.create') }}
            </button>
          </form>
        }
      </div>
    </ion-content>
  `,
})
export class RepoSchedulePage {
  readonly id = input.required<string>();
  readonly store = inject(RepoScheduleStore);
  readonly modes = SCHEDULE_MODES;

  readonly mode = signal<ScheduleMode>('every');
  readonly timezone = signal('UTC');
  readonly cron = signal('0 9 * * 1-5');
  readonly windowStart = signal('09:00');
  readonly windowEnd = signal('17:00');

  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  constructor() {
    effect(() => {
      const candidate = this.id();
      untracked(() => this.store.load(candidate));
    });
  }

  formatUsd(usd: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd);
  }

  fireAt(iso: string | null, timeZone: string): string {
    if (iso === null) return translate(this.i18n.locale(), 'repoSchedule.never');
    return formatFire(iso, timeZone, this.i18n.locale());
  }

  submit(event: Event): void {
    event.preventDefault();
    const base = { repoId: this.id(), mode: this.mode(), timezone: this.timezone() };
    this.store.create(
      this.mode() === 'window'
        ? { ...base, windowStart: this.windowStart(), windowEnd: this.windowEnd() }
        : { ...base, cron: this.cron() },
    );
  }

  setMode(event: Event): void {
    const value = fieldValue(event);
    if (value === 'once' || value === 'every' || value === 'window') this.mode.set(value);
  }

  setTimezone(event: Event): void {
    this.timezone.set(fieldValue(event));
  }

  setCron(event: Event): void {
    this.cron.set(fieldValue(event));
  }

  setWindowStart(event: Event): void {
    this.windowStart.set(fieldValue(event));
  }

  setWindowEnd(event: Event): void {
    this.windowEnd.set(fieldValue(event));
  }
}

function fieldValue(event: Event): string {
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return target.value;
  }
  return '';
}

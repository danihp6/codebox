import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Schedule } from '@codebox/contracts';
import { finalize } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import { I18nService } from '../../core/i18n/i18n.service';
import { summarise } from '../jobs/cron';
import { formatFire } from '../jobs/time-format';
import type { ScheduleProposal } from '../schedules/schedule-filter';
import type { ScheduleCreateBody } from '../schedules/schedules.api';
import { SchedulesApi } from '../schedules/schedules.api';
import { translate } from './schedule-propose.i18n';

export type { ScheduleProposal } from '../schedules/schedule-filter';

export interface CostCap {
  readonly value: number;
  readonly label: string;
}

/**
 * The proposal's fields, mapped to the create body: the window family carries the bounds and
 * `cron: null`, every other mode carries the cron and null bounds, and nothing else is added.
 */
export function toCreateBody(proposal: ScheduleProposal): ScheduleCreateBody {
  const windowMode = proposal.mode === 'window';
  return {
    title: proposal.title,
    prompt: proposal.prompt,
    mode: proposal.mode,
    cron: windowMode ? null : proposal.cron,
    timezone: proposal.timezone,
    windowStart: windowMode ? proposal.windowStart : null,
    windowEnd: windowMode ? proposal.windowEnd : null,
    repoId: proposal.repoId,
    ...(proposal.cooldownMinutes === undefined
      ? {}
      : { cooldownMinutes: proposal.cooldownMinutes }),
    ...(proposal.maxCostPerFireUsd === undefined
      ? {}
      : { maxCostPerFireUsd: proposal.maxCostPerFireUsd }),
  };
}

@Component({
  selector: 'app-schedule-propose',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-schedule-propose {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        padding: calc(var(--cb-space) * 3);
        border: 1px solid var(--cb-accent);
        border-radius: var(--cb-radius);
        overflow-wrap: anywhere;
      }
      .cb-schedule-propose h3 {
        margin: 0;
      }
      .cb-schedule-facts {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--cb-space) calc(var(--cb-space) * 2);
        margin: 0;
      }
      .cb-schedule-facts dt {
        color: var(--cb-muted);
      }
      .cb-schedule-facts dd {
        margin: 0;
      }
      .cb-schedule-actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
      }
      .cb-schedule-actions button {
        min-block-size: 44px;
      }
      .cb-mono {
        font-family: var(--cb-font-mono);
      }
      .cb-error {
        color: var(--cb-danger);
      }
      .cb-muted {
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <section
      class="cb-schedule-propose"
      data-testid="schedule-propose"
      [attr.data-mode]="proposal().mode"
    >
      <h3>{{ t('propose.title') }}</h3>

      <p data-testid="propose-title">{{ proposal().title }}</p>
      <span data-testid="propose-mode">{{ t('propose.mode.' + proposal().mode) }}</span>

      <dl class="cb-schedule-facts">
        @if (proposal().mode === 'window') {
          <dt>{{ t('propose.window') }}</dt>
        } @else {
          <dt>{{ t('propose.cron') }}</dt>
        }
        <dd class="cb-mono" data-testid="propose-when">{{ when() }}</dd>

        <dt>{{ t('propose.zone') }}</dt>
        <dd class="cb-mono" data-testid="propose-zone">{{ proposal().timezone }}</dd>

        <dt>{{ t('propose.next') }}</dt>
        <dd data-testid="propose-next">{{ nextFire() }}</dd>

        @if (costCap(); as cap) {
          <dt>{{ t('propose.cost') }}</dt>
          <dd class="cb-mono" data-testid="propose-cost" [attr.data-cost-usd]="cap.value">
            {{ cap.label }}
          </dd>
        }

        @if (proposal().repoId; as repoId) {
          <dt>{{ t('propose.repo') }}</dt>
          <dd class="cb-mono" data-testid="propose-repo">{{ repoId }}</dd>
        }
      </dl>

      <p class="cb-muted" data-testid="propose-none">{{ t('propose.none') }}</p>

      @if (error(); as failure) {
        <p
          class="cb-error"
          role="alert"
          data-testid="propose-error"
          [attr.data-code]="failure.code"
        >
          {{ t('propose.error') }}
        </p>
      }

      <div class="cb-schedule-actions">
        <button
          type="button"
          data-testid="propose-create"
          [disabled]="creating()"
          (click)="create()"
        >
          @if (creating()) {
            {{ t('propose.creating') }}
          } @else {
            {{ t('propose.create') }}
          }
        </button>
        <button type="button" data-testid="propose-dismiss" (click)="dismiss()">
          {{ t('propose.dismiss') }}
        </button>
      </div>
    </section>
  `,
})
export class ScheduleProposeCard {
  readonly proposal = input.required<ScheduleProposal>();
  readonly created = output<Schedule>();
  readonly dismissed = output<void>();

  private readonly api = inject(SchedulesApi);
  private readonly i18n = inject(I18nService);
  private readonly destroy = inject(DestroyRef);

  readonly creating = signal(false);
  readonly error = signal<ApiError | null>(null);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  readonly when = computed<string>(() => {
    const proposal = this.proposal();
    if (
      proposal.mode === 'window' &&
      proposal.windowStart !== null &&
      proposal.windowEnd !== null
    ) {
      return `${proposal.windowStart}–${proposal.windowEnd}`;
    }
    return proposal.cron === null ? '' : summarise(proposal.cron, this.i18n.locale());
  });

  readonly nextFire = computed<string>(() => {
    const proposal = this.proposal();
    const at = proposal.nextFireAt ?? null;
    if (at === null) return translate(this.i18n.locale(), 'propose.next.pending');
    return formatFire(at, proposal.timezone, this.i18n.locale());
  });

  readonly costCap = computed<CostCap | null>(() => {
    const cap = this.proposal().maxCostPerFireUsd ?? null;
    if (cap === null) return null;
    return {
      value: cap,
      label: new Intl.NumberFormat(this.i18n.locale(), {
        style: 'currency',
        currency: 'USD',
      }).format(cap),
    };
  });

  create(): void {
    if (this.creating()) return;
    this.error.set(null);
    this.creating.set(true);
    this.api
      .create(toCreateBody(this.proposal()))
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.creating.set(false)),
      )
      .subscribe({
        next: (schedule) => this.created.emit(schedule),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  dismiss(): void {
    this.dismissed.emit();
  }
}

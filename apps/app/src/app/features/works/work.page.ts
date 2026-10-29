import { ChangeDetectionStrategy, Component, effect, inject, input, untracked } from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { Run, RunState, Work, WorkState } from '@codebox/contracts';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './i18n';
import { WorkStore } from './work.store';

export type WorkPrState = 'open' | 'merged' | 'none';

/** The PR card is derived from run state, never from prose: a merged run is a merged PR. */
export function prStateOf(run: Run): WorkPrState {
  if (run.pr === null) return 'none';
  return run.state === 'succeeded' ? 'merged' : 'open';
}

@Component({
  selector: 'app-work-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [WorkStore],
  styles: [
    `
      .cb-work-head {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 3);
        overflow-wrap: anywhere;
      }
      .cb-work-flow,
      .cb-work-actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: baseline;
      }
      .cb-work-actions {
        margin-block-start: calc(var(--cb-space) * 3);
      }
      .cb-work-runs {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 3);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-work-run {
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 3);
        overflow-wrap: anywhere;
      }
      .cb-work-run h2 {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
        margin-block-start: 0;
      }
      .cb-work-card {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: baseline;
        border: 1px solid var(--cb-muted);
        border-radius: calc(var(--cb-radius) / 2);
        padding: calc(var(--cb-space) * 2);
        margin-block-start: calc(var(--cb-space) * 2);
      }
      .cb-work-card[data-status='passed'],
      .cb-work-card[data-state='merged'] {
        border-color: var(--cb-accent);
      }
      .cb-work-card[data-status='failed'] {
        border-color: var(--cb-danger);
      }
      .cb-work-state[data-state='failed'] {
        color: var(--cb-danger);
      }
      .cb-work-state[data-state='needs_decision'] {
        color: var(--cb-warn);
      }
      .cb-work-state[data-state='merged'] {
        color: var(--cb-accent);
      }
      .cb-muted {
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ store.work()?.backlogRef ?? t('work.loading') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-work" [attr.data-work-id]="id()">
        @if (store.loading()) {
          <div data-testid="work-loading">{{ t('work.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div data-testid="work-error" [attr.data-code]="failure.code">
            <p>{{ t('work.error') }}</p>
            <button type="button" data-testid="work-retry" (click)="store.reload()">
              {{ t('work.retry') }}
            </button>
          </div>
        }

        @if (store.detail(); as detail) {
          <header class="cb-work-head" data-testid="work-header">
            <p class="cb-work-flow">
              <span>{{ t('work.repository') }}:</span>
              <span class="cb-mono" data-testid="work-repository" [attr.data-repo-id]="detail.repo.id">
                {{ detail.repo.slug }}
              </span>
            </p>
            <p class="cb-work-flow">
              <span>{{ t('work.state') }}:</span>
              <span class="cb-work-state" data-testid="work-state" [attr.data-state]="detail.work.state">
                {{ stateLabel(detail.work.state) }}
              </span>
            </p>
            <p class="cb-work-flow">
              <span>{{ t('work.backlogRef') }}:</span>
              <span class="cb-mono" data-testid="work-backlog-ref">{{ detail.work.backlogRef }}</span>
            </p>
            <p class="cb-work-flow">
              <span>{{ t('work.attempts') }}:</span>
              <span class="cb-mono" data-testid="work-attempts">
                {{ detail.work.attempts }} of {{ detail.work.maxAttempts }}
              </span>
            </p>
            <p class="cb-work-flow">
              <span>{{ t('work.context') }}:</span>
              <span class="cb-mono" data-testid="work-context" [attr.data-epoch]="detail.work.contextEpoch">
                {{ detail.work.contextTokens }} · {{ t('work.contextEpoch') }}
                {{ detail.work.contextEpoch }}
              </span>
              <span>{{ t('work.cost') }}:</span>
              <span class="cb-mono" data-testid="work-cost" [attr.data-usd]="detail.work.usage.usd">
                {{ formatUsd(detail.work.usage.usd) }}
              </span>
            </p>
          </header>

          <div class="cb-work-actions">
            @switch (detail.work.state) {
              @case ('needs_decision') {
                <button
                  type="button"
                  data-testid="work-resolve-doubt"
                  [disabled]="store.busy() !== null"
                  (click)="store.resolveDoubt()"
                >
                  {{ t('work.resolveDoubt') }}
                </button>
              }
              @case ('merged') {
                <button
                  type="button"
                  data-testid="work-rework"
                  [disabled]="store.busy() !== null"
                  (click)="store.rework()"
                >
                  {{ t('work.rework') }}
                </button>
              }
            }
          </div>

          <h2 class="cb-muted">{{ t('work.runs') }}</h2>
          @if (detail.runs.length === 0) {
            <p data-testid="work-runs-empty">{{ t('work.noRuns') }}</p>
          } @else {
            <ul class="cb-work-runs">
              @for (run of detail.runs; track run.id) {
                <li
                  class="cb-work-run"
                  data-testid="work-run"
                  [attr.data-run-id]="run.id"
                  [attr.data-state]="run.state"
                >
                  <h2>
                    <span class="cb-mono">{{ run.id }}</span>
                    · {{ runLabel(run.state) }}
                  </h2>
                  <p class="cb-work-flow">
                    <span>{{ t('work.run.branch') }}:</span>
                    <span class="cb-mono" data-testid="work-run-branch">{{ run.branch }}</span>
                  </p>
                  <p class="cb-work-flow">
                    <span>{{ t('work.run.outcome') }}:</span>
                    <span class="cb-mono" data-testid="work-run-outcome">{{ runLabel(run.state) }}</span>
                  </p>
                  @if (run.gate; as gate) {
                    <div
                      class="cb-work-card"
                      data-testid="work-run-gate"
                      [attr.data-status]="gate.status"
                      [attr.data-exit-code]="gate.exitCode"
                    >
                      <span>{{ t('work.run.gate') }}:</span>
                      <span class="cb-mono">{{ gateLabel(gate.status) }}</span>
                      <span class="cb-mono">exit {{ gate.exitCode }}</span>
                    </div>
                  }
                  <div
                    class="cb-work-card"
                    data-testid="work-run-pr"
                    [attr.data-state]="prState(run)"
                  >
                    <span>{{ t('work.run.pr') }}:</span>
                    @if (run.pr; as pr) {
                      <a class="cb-mono" [href]="pr.url" target="_blank" rel="noreferrer">
                        #{{ pr.number }}
                      </a>
                      <span class="cb-mono">{{ prStateLabel(run) }}</span>
                    } @else {
                      <span class="cb-mono">{{ t('work.pr.none') }}</span>
                    }
                  </div>
                  @if (run.state === 'succeeded') {
                    <p class="cb-work-flow">
                      <span>{{ t('work.run.tick') }}:</span>
                      <span class="cb-mono" data-testid="work-run-backlog-tick">
                        {{ workRef(detail.work) }}
                      </span>
                    </p>
                  }
                </li>
              }
            </ul>
          }
        }
      </div>
    </ion-content>
  `,
})
export class WorkPage {
  readonly id = input.required<string>();
  readonly store = inject(WorkStore);

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

  stateLabel(state: WorkState): string {
    return translate(this.i18n.locale(), `works.state.${state}`);
  }

  runLabel(state: RunState): string {
    return translate(this.i18n.locale(), `work.run.state.${state}`);
  }

  gateLabel(status: 'passed' | 'failed' | 'skipped'): string {
    return translate(this.i18n.locale(), `work.gate.${status}`);
  }

  prState(run: Run): WorkPrState {
    return prStateOf(run);
  }

  prStateLabel(run: Run): string {
    return translate(this.i18n.locale(), `work.pr.${prStateOf(run)}`);
  }

  workRef(work: Work): string {
    return work.backlogRef;
  }
}

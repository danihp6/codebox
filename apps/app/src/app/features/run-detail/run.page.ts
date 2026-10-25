import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { SseEventName } from '@codebox/contracts';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { RunDetailStore } from './run-detail.store';
import type { RunTimelineItem } from './timeline';

export function formatUsd(usd: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd);
}

@Component({
  selector: 'app-run-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [RunDetailStore],
  styles: [
    `
      .cb-run-head,
      .cb-run-actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
      }
      .cb-run-section {
        margin-block-start: calc(var(--cb-space) * 4);
      }
      .cb-run-section h2 {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-timeline {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-timeline li,
      .cb-guardrail,
      .cb-blocker {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cb-space);
        overflow-wrap: anywhere;
      }
      .cb-guardrail--pass {
        color: var(--cb-accent);
      }
      .cb-guardrail--fail {
        color: var(--cb-danger);
      }
      .cb-guardrail--skip {
        color: var(--cb-warn);
      }
      .cb-chip {
        border: 1px solid var(--cb-muted);
        border-radius: 999px;
        padding-inline: calc(var(--cb-space) * 2);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('run.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div
        data-testid="run-detail"
        [attr.data-run-id]="id()"
        [attr.data-state]="store.run()?.state ?? null"
      >
        @if (store.loading()) {
          <div data-testid="run-loading">{{ t('common.loading') }}</div>
        }

        @if (store.error(); as failure) {
          <div data-testid="run-error" [attr.data-code]="failure.code">
            <p>{{ t('common.error') }}</p>
            <button type="button" data-testid="run-retry" (click)="store.reload()">
              {{ t('run.action.retry') }}
            </button>
          </div>
        }

        <section class="cb-run-section">
          <h2>{{ t('run.section.timeline') }}</h2>
          @if (store.timeline().length === 0) {
            @if (!store.loading()) {
              <p data-testid="timeline-empty">{{ t('run.empty.timeline') }}</p>
            }
          } @else {
            <ul class="cb-timeline">
              @for (item of store.timeline(); track item.key) {
                <li
                  data-testid="timeline-item"
                  [attr.data-key]="item.key"
                  [attr.data-type]="item.type"
                  [attr.data-ts]="item.ts"
                >
                  <span class="cb-mono">{{ eventLabel(item.type) }}</span>
                  @if (item.detail !== '') {
                    <span class="cb-mono">{{ item.detail }}</span>
                  }
                </li>
              }
            </ul>
          }
        </section>

        @if (store.run(); as run) {
          <div class="cb-run-head">
            <span class="cb-chip" data-testid="run-state">{{ t('run.state.' + run.state) }}</span>
            <div data-testid="cost">{{ formatUsd(run.cost.usd) }}</div>
          </div>

          <div class="cb-run-actions">
            @if (store.canCancel()) {
              <button type="button" data-testid="cancel" (click)="store.askCancel()">
                {{ t('run.action.cancel') }}
              </button>
            }
            @if (store.confirmingCancel()) {
              <button type="button" data-testid="cancel-confirm" (click)="store.cancel()">
                {{ t('run.action.confirmCancel') }}
              </button>
              <button type="button" data-testid="cancel-dismiss" (click)="store.dismissCancel()">
                {{ t('run.action.dismissCancel') }}
              </button>
            }
            @if (store.canRevert()) {
              <button
                type="button"
                data-testid="revert"
                [disabled]="store.busy() !== null"
                (click)="store.revert()"
              >
                {{ t('run.action.revert') }}
              </button>
            }
          </div>

          <section class="cb-run-section">
            <h2>{{ t('run.section.gate') }}</h2>
            @if (run.gate; as gate) {
              <div data-testid="gate-status" [attr.data-status]="gate.status">
                <span class="cb-mono">{{ gate.status }}</span>
                <span data-testid="gate-exit" [attr.data-value]="gate.exitCode">
                  {{ gate.exitCode }}
                </span>
                <span data-testid="gate-duration" [attr.data-value]="gate.durationMs">
                  {{ gate.durationMs }}
                </span>
              </div>
            } @else {
              <p data-testid="gate-none"></p>
            }
          </section>

          <section class="cb-run-section">
            <h2>{{ t('run.section.guardrails') }}</h2>
            <ul class="cb-timeline">
              @for (guardrail of run.guardrails; track guardrail.id) {
                <li
                  [attr.data-testid]="'guardrail-' + guardrail.id"
                  [attr.data-state]="guardrail.state"
                  [attr.data-reason]="guardrail.reason ?? null"
                  [class]="'cb-guardrail cb-guardrail--' + guardrail.state"
                >
                  <span>{{ t('run.guardrail.' + guardrail.id) }}</span>
                  @if (guardrail.reason !== undefined) {
                    <span class="cb-mono">{{ guardrail.reason }}</span>
                  }
                </li>
              }
            </ul>
          </section>

          <section class="cb-run-section">
            <h2>{{ t('run.section.blockers') }}</h2>
            @if (run.blockers.length === 0) {
              <p data-testid="blockers-empty">{{ t('run.empty.blockers') }}</p>
            } @else {
              <ul class="cb-timeline">
                @for (blocker of run.blockers; track blocker.code) {
                  <li class="cb-blocker">
                    <span data-testid="blocker" [attr.data-code]="blocker.code">
                      {{ blocker.message }}
                    </span>
                  </li>
                }
              </ul>
            }
          </section>

          <section class="cb-run-section">
            <h2>{{ t('run.section.diff') }}</h2>
            @if (stat(); as diffStat) {
              <div>
                <span data-testid="diff-files" [attr.data-value]="diffStat.files">
                  {{ diffStat.files }}
                </span>
                <span data-testid="diff-added" [attr.data-value]="diffStat.added">
                  {{ diffStat.added }}
                </span>
                <span data-testid="diff-removed" [attr.data-value]="diffStat.removed">
                  {{ diffStat.removed }}
                </span>
              </div>
            } @else if (diffUnavailable()) {
              <p data-testid="diff-unavailable">{{ t('run.error.diffUnavailable') }}</p>
            }
          </section>

          <section class="cb-run-section">
            <h2>{{ t('run.section.pullRequest') }}</h2>
            @if (run.pr; as pr) {
              <a data-testid="pr-link" [href]="pr.url" target="_blank" rel="noopener noreferrer">
                {{ pr.url }}
              </a>
            }
          </section>

          <section class="cb-run-section">
            <h2>{{ t('run.section.merge') }}</h2>
            @if (merged(); as mergedItem) {
              <div data-testid="merge-result" data-merged="true" [attr.data-detail]="mergedItem.detail">
                <span class="cb-mono">{{ mergedItem.detail }}</span>
              </div>
            } @else {
              <p data-testid="merge-none"></p>
            }
          </section>
        }
      </div>
    </ion-content>
  `,
})
export class RunDetailPage {
  readonly id = input.required<string>();
  readonly store = inject(RunDetailStore);
  readonly formatUsd = formatUsd;

  private readonly sse = inject(SseService);
  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = this.i18n.t;
  readonly eventLabel: (type: SseEventName) => string = (type) => {
    const label = this.i18n.t(`run.event.${type}`);
    return label.startsWith('missing:') ? this.i18n.t('run.event.other') : label;
  };

  readonly merged = computed<RunTimelineItem | null>(
    () => this.store.timeline().find((item) => item.type === 'run.merged') ?? null,
  );

  readonly stat = computed<{
    readonly files: number;
    readonly added: number;
    readonly removed: number;
  } | null>(() => {
    const diff = this.store.diff();
    if (diff !== null) {
      return { files: diff.files, added: diff.added, removed: diff.removed };
    }
    return this.store.run()?.diff ?? null;
  });

  readonly diffUnavailable = computed<boolean>(() => {
    if (this.store.loading()) return false;
    const run = this.store.run();
    if (run === null) return false;
    if (this.store.diffUnavailable()) return true;
    return this.store.diff() === null && run.diff === null;
  });

  constructor() {
    effect(() => {
      const candidate = this.id();
      untracked(() => this.store.load(candidate));
    });
    effect(() => {
      const event = this.sse.event();
      if (event === null) return;
      untracked(() => {
        if (this.store.applyStreamEvent(event) === 'refetch') this.store.reload();
      });
    });
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { ChatSession } from '@codebox/contracts';
import { I18nService } from '../../core/i18n/i18n.service';
import { translate } from './context-sheet.i18n';
import { ContextSheetStore } from './context-sheet.store';

export type ContextState = 'ok' | 'warn' | 'high' | 'full';

/** 200 000 tokens: the window every state is expressed against. */
export const CONTEXT_WINDOW_TOKENS = 200_000;

const WARN_RATIO = 0.75;
const HIGH_RATIO = 0.9;
const FULL_RATIO = 0.95;

/** ok < 75 %, warn 75–89.99 %, high 90–94.99 %, full >= 95 %. Over 100 % is still full. */
export function contextState(contextTokens: number): ContextState {
  const ratio = contextTokens / CONTEXT_WINDOW_TOKENS;
  if (ratio >= FULL_RATIO) return 'full';
  if (ratio >= HIGH_RATIO) return 'high';
  if (ratio >= WARN_RATIO) return 'warn';
  return 'ok';
}

const COST_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

@Component({
  selector: 'app-chat-context-sheet',
  standalone: true,
  providers: [ContextSheetStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-context-sheet {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 3);
        padding: calc(var(--cb-space) * 3);
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        background: var(--cb-surface);
        overflow-wrap: anywhere;
      }
      .cb-context-header {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
        justify-content: space-between;
      }
      .cb-context-header h3 {
        margin: 0;
        font-size: 1rem;
      }
      .cb-context-bar {
        display: block;
        block-size: 8px;
        border-radius: calc(var(--cb-radius) / 2);
        background: var(--cb-bg);
        overflow: hidden;
      }
      .cb-context-fill {
        display: block;
        block-size: 100%;
        inline-size: 0;
        background: var(--cb-accent);
      }
      .cb-context-bar[data-state='warn'] .cb-context-fill,
      .cb-context-bar[data-state='high'] .cb-context-fill {
        background: var(--cb-warn);
      }
      .cb-context-bar[data-state='full'] .cb-context-fill {
        background: var(--cb-danger);
      }
      .cb-context-numbers {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cb-space);
        margin: calc(var(--cb-space) * 2) 0 0;
        font-size: 0.85rem;
      }
      .cb-context-divider {
        margin-block-start: calc(var(--cb-space) * 2);
        padding-block-start: calc(var(--cb-space) * 2);
        border-block-start: 1px dashed var(--cb-accent);
        color: var(--cb-muted);
        font-size: 0.85rem;
      }
      .cb-context-state {
        margin: calc(var(--cb-space) * 2) 0 0;
      }
      .cb-context-rows {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
      }
      .cb-context-row {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: baseline;
        justify-content: space-between;
        min-block-size: 32px;
      }
      .cb-context-row dt {
        color: var(--cb-muted);
      }
      .cb-context-row dd {
        margin: 0;
        text-align: end;
      }
      .cb-context-composer {
        padding: calc(var(--cb-space) * 2);
        border: 1px dashed var(--cb-muted);
        border-radius: var(--cb-radius);
        font-size: 0.85rem;
      }
      .cb-context-composer[data-disabled='true'] {
        border-color: var(--cb-danger);
        color: var(--cb-danger);
      }
      .cb-context-error {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        padding: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-danger);
        border-radius: var(--cb-radius);
      }
      .cb-context-error p {
        margin: 0;
      }
      .cb-context-actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
      }
      .cb-context-actions button {
        min-block-size: 44px;
      }
      .cb-muted {
        color: var(--cb-muted);
      }
      .cb-mono {
        font-family: var(--cb-font-mono);
      }
    `,
  ],
  template: `
    <div
      class="cb-context-sheet"
      data-testid="context-sheet"
      [attr.data-chat-id]="current().id"
      [attr.data-state]="state()"
      [attr.data-scope]="scope()"
    >
      <header class="cb-context-header">
        <h3>{{ t('sheet.title') }}</h3>
        <button type="button" data-testid="context-close" (click)="close()">
          {{ t('sheet.close') }}
        </button>
      </header>

      @if (store.loading()) {
        <div data-testid="context-loading" aria-busy="true">…</div>
      }

      <section [attr.aria-label]="t('sheet.usage.title')">
        <div
          class="cb-context-bar"
          data-testid="context-bar"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          [attr.aria-valuenow]="fill()"
          [attr.aria-valuetext]="percentLabel()"
          [attr.data-state]="state()"
          [attr.data-percent]="percent()"
        >
          <span
            class="cb-context-fill"
            data-testid="context-bar-fill"
            [attr.data-state]="state()"
            [style.inline-size.%]="fill()"
          ></span>
        </div>

        @if (store.compactedEpoch(); as epoch) {
          <div class="cb-context-divider" data-testid="context-divider" [attr.data-epoch]="epoch">
            {{ t('sheet.divider') }}
          </div>
        }

        <p
          class="cb-context-numbers"
          data-testid="context-numbers"
          [attr.data-tokens]="tokens()"
          [attr.data-percent]="percent()"
          [attr.data-state]="state()"
        >
          <span class="cb-mono">{{ tokensLabel() }}</span>
        </p>
        <p class="cb-context-state" data-testid="context-state" [attr.data-state]="state()">
          {{ t('sheet.usage.' + state()) }}
        </p>
      </section>

      <dl class="cb-context-rows">
        <div
          class="cb-context-row"
          data-testid="context-repository"
          [attr.data-repo-id]="current().repoId ?? ''"
          [attr.data-slug]="repoSlug() ?? ''"
        >
          <dt>{{ t('sheet.row.repository') }}</dt>
          <dd>
            @if (repoSlug(); as slug) {
              <span class="cb-mono">{{ slug }}</span>
            } @else {
              {{ t('sheet.row.noRepository') }}
            }
          </dd>
        </div>

        <div class="cb-context-row" data-testid="context-scope" [attr.data-scope]="scope()">
          <dt>{{ t('sheet.row.scope') }}</dt>
          <dd>{{ t('sheet.scope.' + scope()) }}</dd>
        </div>

        <div class="cb-context-row" data-testid="context-epoch" [attr.data-epoch]="epoch()">
          <dt>{{ t('sheet.row.epoch') }}</dt>
          <dd>
            <span class="cb-mono">{{ epoch() }}</span>
          </dd>
        </div>

        <div
          class="cb-context-row"
          data-testid="context-chat-cost"
          [attr.data-usd]="chatUsd()"
          [attr.data-tokens-in]="tokensIn()"
          [attr.data-tokens-out]="tokensOut()"
        >
          <dt>{{ t('sheet.row.chatCost') }}</dt>
          <dd>
            <span class="cb-mono">{{ chatCostLabel() }}</span>
            <span class="cb-muted" data-testid="context-chat-tokens">
              {{ tokensInLabel() }} {{ t('sheet.row.tokensIn') }} · {{ tokensOutLabel() }}
              {{ t('sheet.row.tokensOut') }}
            </span>
          </dd>
        </div>

        <div
          class="cb-context-row"
          data-testid="context-day-cost"
          [attr.data-usd]="store.daySpendUsd() ?? ''"
          [attr.data-unavailable]="store.daySpendUsd() === null"
        >
          <dt>{{ t('sheet.row.dayCost') }}</dt>
          <dd>
            @if (store.daySpendUsd() !== null) {
              <span class="cb-mono">{{ dayCostLabel() }}</span>
            } @else {
              {{ t('sheet.row.unavailable') }}
            }
          </dd>
        </div>
      </dl>

      <div
        class="cb-context-composer"
        data-testid="context-composer"
        role="note"
        [attr.data-state]="state()"
        [attr.data-disabled]="composerBlocked()"
        [attr.aria-disabled]="composerBlocked()"
      >
        {{ t(composerBlocked() ? 'sheet.composer.blocked' : 'sheet.composer.ready') }}
      </div>

      @if (store.error(); as failure) {
        <div
          class="cb-context-error"
          role="alert"
          data-testid="context-error"
          [attr.data-code]="failure.code"
          [attr.data-status]="failure.status"
        >
          <p>{{ t('sheet.error.title') }}</p>
          <p class="cb-mono">{{ failure.code }}</p>
          <p class="cb-muted">{{ failure.message }}</p>
        </div>
      }

      <div class="cb-context-actions">
        <button
          type="button"
          data-testid="context-compact"
          [attr.data-compacting]="store.compacting()"
          [disabled]="store.compacting()"
          (click)="store.compact()"
        >
          {{ t(store.compacting() ? 'sheet.action.compacting' : 'sheet.action.compact') }}
        </button>
        @if (current().repoId !== null) {
          <button
            type="button"
            data-testid="context-new-chat"
            [attr.data-creating]="store.creating()"
            [disabled]="store.creating()"
            (click)="store.createInRepo()"
          >
            {{ t('sheet.action.newChat') }}
          </button>
        }
      </div>
    </div>
  `,
})
export class ChatContextSheet {
  readonly session = input.required<ChatSession>();
  readonly closed = output<void>();
  readonly created = output<ChatSession>();

  readonly store = inject(ContextSheetStore);

  private readonly i18n = inject(I18nService);
  private readonly destroy = inject(DestroyRef);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  /** The store's answer wins: a compact replaces it with the daemon's session. */
  readonly current = computed<ChatSession>(() => this.store.session() ?? this.session());
  readonly scope = computed<'free' | 'repo' | 'schedule'>(() => this.current().kind ?? 'repo');
  readonly tokens = computed<number>(() => this.current().contextTokens ?? 0);
  readonly state = computed<ContextState>(() => contextState(this.tokens()));
  readonly percent = computed<number>(() =>
    Math.round((this.tokens() / CONTEXT_WINDOW_TOKENS) * 100),
  );
  readonly fill = computed<number>(() => Math.min(100, Math.max(0, this.percent())));
  readonly epoch = computed<number>(() => this.current().contextEpoch ?? 1);
  readonly chatUsd = computed<number>(() => this.current().usage?.usd ?? 0);
  readonly tokensIn = computed<number>(() => this.current().usage?.tokensIn ?? 0);
  readonly tokensOut = computed<number>(() => this.current().usage?.tokensOut ?? 0);
  /** D48: at 95 % the daemon refuses the turn, so the composer is blocked before it is sent. */
  readonly composerBlocked = computed<boolean>(
    () => this.state() === 'full' || this.current().status === 'archived',
  );
  readonly repoSlug = computed<string | null>(() => {
    const repoId = this.current().repoId;
    if (repoId === null) return null;
    return this.store.repos().find((repo) => repo.id === repoId)?.slug ?? repoId;
  });
  readonly tokensLabel = computed<string>(
    () =>
      `${this.count(this.tokens())} ${this.t('sheet.usage.of')} ${this.count(CONTEXT_WINDOW_TOKENS)} ${this.t('sheet.usage.tokens')}`,
  );
  readonly percentLabel = computed<string>(() => `${this.count(this.percent())} %`);
  readonly chatCostLabel = computed<string>(() => COST_FORMAT.format(this.chatUsd()));
  readonly dayCostLabel = computed<string>(() => {
    const usd = this.store.daySpendUsd();
    return usd === null ? this.t('sheet.row.unavailable') : COST_FORMAT.format(usd);
  });
  readonly tokensInLabel = computed<string>(() => this.count(this.tokensIn()));
  readonly tokensOutLabel = computed<string>(() => this.count(this.tokensOut()));

  constructor() {
    effect(() => {
      const session = this.session();
      untracked(() => this.store.load(session));
    });
    this.store.created
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((session) => this.created.emit(session));
  }

  count(value: number): string {
    return new Intl.NumberFormat(this.i18n.locale()).format(value);
  }

  close(): void {
    this.closed.emit();
  }
}

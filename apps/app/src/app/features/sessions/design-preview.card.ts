import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { DesignPreview, DesignScreenView, DesignStates } from '@codebox/contracts';
import type { ApiError } from '../../core/api/api-client';
import { I18nService } from '../../core/i18n/i18n.service';
import { SessionsApi } from './sessions.api';
import { translate } from './i18n';

export type ScreenStateKind = 'loading' | 'empty' | 'error';

export const SCREEN_STATE_KINDS: readonly ScreenStateKind[] = Object.freeze([
  'loading',
  'empty',
  'error',
]);

export interface DeclaredState {
  readonly kind: ScreenStateKind;
  readonly caption: string | null;
}

/** Exactly three, in SCREEN_STATE_KINDS order; `null` when the screen declines the state. */
export function declaredStates(screen: DesignScreenView): readonly DeclaredState[] {
  const states: DesignStates = screen.states;
  return SCREEN_STATE_KINDS.map((kind) => ({ kind, caption: states[kind] }));
}

@Component({
  selector: 'app-design-preview-card',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-pv {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-block-end: 16px;
        padding: 12px 16px;
        border: 1px solid var(--cb-surface);
        border-radius: 14px;
        overflow-wrap: anywhere;
      }
      .cb-pv-head {
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: space-between;
        min-block-size: 18px;
      }
      .cb-pv-eyebrow {
        color: var(--cb-muted);
        font-size: 9px;
        line-height: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
      }
      .cb-pv-live {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        inline-size: 58px;
        block-size: 18px;
        border: 1px solid var(--cb-surface);
        border-radius: 9px;
        color: var(--cb-muted);
        font-family: var(--cb-font-mono);
        font-size: 8px;
        line-height: 10px;
        font-weight: 500;
      }
      .cb-pv-rev {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cb-pv-body {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-block-size: 210px;
      }
      .cb-pv-count,
      .cb-pv-states-h {
        margin: 8px 0 0;
        color: var(--cb-muted);
        font-size: 9px;
        line-height: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .cb-pv-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-pv-row {
        display: flex;
        gap: 6px;
        align-items: baseline;
        min-inline-size: 0;
        font-size: 9px;
        line-height: 11px;
      }
      .cb-pv-token-value {
        display: block;
        min-inline-size: 0;
        overflow-x: auto;
        white-space: nowrap;
      }
      .cb-pv-screen {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-block-start: 4px;
      }
      .cb-pv-screen-title {
        color: var(--cb-text);
        font-size: 12px;
        line-height: 15px;
        font-weight: 600;
      }
      .cb-pv-screen-route {
        color: var(--cb-muted);
        font-family: var(--cb-font-mono);
        font-size: 9px;
        line-height: 11px;
      }
      .cb-pv-states {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .cb-pv-chip {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        min-inline-size: 74px;
        min-block-size: 20px;
        padding-inline: 10px;
        border: 1px solid var(--cb-surface);
        border-radius: 10px;
        background: var(--cb-surface);
        color: var(--cb-muted);
        font-size: 9px;
        line-height: 11px;
        font-weight: 500;
        white-space: nowrap;
      }
      .cb-pv-chip[data-declared='true'] {
        color: var(--cb-warn);
      }
      .cb-pv-chip-note {
        font-size: 8px;
        line-height: 10px;
      }
      .cb-pv-checks {
        margin: 8px 0 0;
        color: var(--cb-accent);
        font-size: 9px;
        line-height: 11px;
      }
      .cb-pv-note {
        margin: 0;
        color: var(--cb-muted);
        font-size: 10px;
        line-height: 12px;
      }
      .cb-pv-pending {
        margin: 0;
        color: var(--cb-warn);
        font-size: 10px;
        line-height: 12px;
      }
      .cb-pv-findings {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-pv-finding {
        display: flex;
        gap: 6px;
        align-items: baseline;
        font-size: 9px;
        line-height: 11px;
      }
      .cb-pv-mono {
        font-family: var(--cb-font-mono);
      }
      .cb-pv-muted {
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <section
      class="cb-pv"
      data-testid="design-preview"
      [attr.data-revision]="preview()?.revision ?? ''"
      [attr.data-present]="present()"
      [attr.aria-label]="t('session.preview.title')"
    >
      <header class="cb-pv-head">
        <span class="cb-pv-eyebrow">{{ t('session.preview.eyebrow') }}</span>
        @if (preview(); as loaded) {
          <span
            class="cb-pv-live"
            data-testid="design-preview-live"
            [attr.data-revision]="loaded.revision"
            [attr.title]="t('session.preview.revision') + ' ' + loaded.revision"
          >
            <span
              class="cb-pv-rev"
              data-testid="design-preview-revision"
              [attr.data-sha]="loaded.revision"
              >{{ loaded.revision.slice(0, 7) }}</span
            >
          </span>
        }
      </header>

      @if (loading()) {
        <p class="cb-pv-note" data-testid="design-preview-loading">
          {{ t('session.preview.loading') }}
        </p>
      }

      @if (error(); as failure) {
        <div data-testid="design-preview-error" [attr.data-code]="failure.code">
          <p class="cb-pv-note">{{ t('session.preview.error') }}</p>
          <button type="button" data-testid="design-preview-retry" (click)="reload()">
            {{ t('session.preview.retry') }}
          </button>
        </div>
      }

      @if (preview(); as loaded) {
        @if (pending()) {
          <p class="cb-pv-pending" data-testid="design-preview-pending">
            {{ t('session.preview.pending') }}
          </p>
        }

        @if (!loaded.present) {
          <p class="cb-pv-note" data-testid="design-preview-unavailable">
            {{ t('session.preview.unavailable') }}
          </p>
        } @else {
          <div class="cb-pv-body" data-testid="design-preview-body">
            <p class="cb-pv-count" data-testid="design-preview-count" data-kind="tokens">
              {{ t('session.preview.tokens') }}: {{ loaded.tokens.length }}
            </p>
            <ul class="cb-pv-list">
              @for (token of loaded.tokens; track token.name) {
                <li class="cb-pv-row" data-testid="design-preview-token" [attr.data-name]="token.name">
                  <span class="cb-pv-mono">{{ token.name }}</span>
                  <span class="cb-pv-muted">{{ token.type }}</span>
                  <span class="cb-pv-mono cb-pv-token-value">{{ token.value }}</span>
                </li>
              }
            </ul>

            <p class="cb-pv-count" data-testid="design-preview-count" data-kind="routes">
              {{ t('session.preview.routes') }}: {{ loaded.routes.length }}
            </p>
            <ul class="cb-pv-list">
              @for (route of loaded.routes; track route.path) {
                <li
                  class="cb-pv-row"
                  data-testid="design-preview-route"
                  [attr.data-path]="route.path"
                  [attr.data-component]="route.component"
                >
                  <span class="cb-pv-mono">{{ route.path }}</span>
                  <span>{{ route.screen }}</span>
                  @if (route.component === '') {
                    <span class="cb-pv-muted">{{ t('session.preview.undeclared') }}</span>
                  } @else {
                    <span class="cb-pv-mono">{{ route.component }}</span>
                  }
                </li>
              }
            </ul>

            <p class="cb-pv-count" data-testid="design-preview-count" data-kind="screens">
              {{ t('session.preview.screens') }}: {{ loaded.screens.length }}
            </p>
          </div>

          <p class="cb-pv-states-h">{{ t('session.preview.states') }}</p>

          @for (screen of loaded.screens; track screen.screen) {
            <div
              class="cb-pv-screen"
              data-testid="design-preview-screen"
              [attr.data-screen]="screen.screen"
              [attr.data-route]="screen.route"
            >
              <span class="cb-pv-screen-title">{{ screen.screen }}</span>
              <span class="cb-pv-screen-route">{{ screen.route }}</span>
              <div
                class="cb-pv-states"
                data-testid="design-preview-states"
                [attr.data-screen]="screen.screen"
              >
                @for (state of statesOf(screen); track state.kind) {
                  <span
                    class="cb-pv-chip"
                    data-testid="design-preview-state"
                    [attr.data-state]="state.kind"
                    [attr.data-declared]="state.caption === null ? 'false' : 'true'"
                    [attr.title]="state.caption ?? t('session.preview.undeclared')"
                  >
                    <span>{{ state.kind }}</span>
                    @if (state.caption === null) {
                      <span class="cb-pv-chip-note">{{ t('session.preview.undeclared') }}</span>
                    }
                  </span>
                }
              </div>
            </div>
          }

          @if (loaded.findings.length === 0) {
            <p class="cb-pv-checks" data-testid="design-preview-clean">
              {{ t('session.preview.clean') }}
            </p>
          } @else {
            <ul class="cb-pv-findings">
              @for (
                finding of loaded.findings;
                track finding.file + ':' + finding.line + ':' + finding.rule
              ) {
                <li
                  class="cb-pv-finding"
                  data-testid="design-preview-finding"
                  [attr.data-rule]="finding.rule"
                  [attr.data-file]="finding.file"
                  [attr.data-line]="finding.line"
                >
                  <span class="cb-pv-mono">{{ finding.file }}:{{ finding.line }}</span>
                  <span>{{ finding.message }}</span>
                </li>
              }
            </ul>
          }
        }
      }
    </section>
  `,
})
export class DesignPreviewCard {
  readonly repoId = input.required<string>();
  readonly revision = input<string | null>(null);
  readonly preview = signal<DesignPreview | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);

  private readonly api = inject(SessionsApi);
  private readonly i18n = inject(I18nService);
  private readonly destroy = inject(DestroyRef);

  readonly pending = computed(() => this.revision() !== null);
  readonly present = computed(() => {
    const loaded = this.preview();
    return loaded === null ? '' : String(loaded.present);
  });

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  constructor() {
    effect(() => {
      const repoId = this.repoId();
      const revision = this.revision();
      untracked(() => this.load(repoId, revision));
    });
  }

  reload(): void {
    this.load(this.repoId(), this.revision());
  }

  statesOf(screen: DesignScreenView): readonly DeclaredState[] {
    return declaredStates(screen);
  }

  private load(repoId: string, revision: string | null): void {
    this.loading.set(true);
    this.error.set(null);
    this.preview.set(null);
    this.api
      .designPreview(repoId, revision)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (preview) => {
          this.preview.set(preview);
          this.loading.set(false);
        },
        error: (error: ApiError) => {
          this.error.set(error);
          this.loading.set(false);
        },
      });
  }
}

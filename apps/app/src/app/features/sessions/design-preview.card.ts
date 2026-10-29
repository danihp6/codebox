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
      .cb-design-preview {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        margin-block-end: calc(var(--cb-space) * 4);
        padding: calc(var(--cb-space) * 3);
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        overflow-wrap: anywhere;
      }
      .cb-design-preview h2 {
        margin: 0;
        font-size: 1rem;
      }
      .cb-design-preview ul {
        margin: 0;
        padding-inline-start: calc(var(--cb-space) * 4);
      }
      .cb-design-preview .cb-muted {
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <section
      class="cb-design-preview"
      data-testid="design-preview"
      [attr.data-revision]="preview()?.revision ?? ''"
      [attr.data-present]="present()"
    >
      @if (loading()) {
        <div data-testid="design-preview-loading">{{ t('session.preview.loading') }}</div>
      }

      @if (error(); as failure) {
        <div data-testid="design-preview-error" [attr.data-code]="failure.code">
          <p>{{ t('session.preview.error') }}</p>
          <button type="button" data-testid="design-preview-retry" (click)="reload()">
            {{ t('session.preview.retry') }}
          </button>
        </div>
      }

      @if (preview(); as loaded) {
        <h2>{{ t('session.preview.title') }}</h2>
        <p data-testid="design-preview-revision" [attr.data-sha]="loaded.revision">
          <span>{{ t('session.preview.revision') }}</span>
          <span class="cb-mono">{{ loaded.revision }}</span>
        </p>

        @if (pending()) {
          <p data-testid="design-preview-pending">{{ t('session.preview.pending') }}</p>
        }

        @if (!loaded.present) {
          <p data-testid="design-preview-unavailable">{{ t('session.preview.unavailable') }}</p>
        } @else {
          <p data-testid="design-preview-count" data-kind="tokens">
            {{ t('session.preview.tokens') }}: {{ loaded.tokens.length }}
          </p>
          <ul>
            @for (token of loaded.tokens; track token.name) {
              <li data-testid="design-preview-token" [attr.data-name]="token.name">
                <span class="cb-mono">{{ token.name }}</span>
                <span class="cb-muted">{{ token.type }}</span>
                <span class="cb-mono">{{ token.value }}</span>
              </li>
            }
          </ul>

          <p data-testid="design-preview-count" data-kind="routes">
            {{ t('session.preview.routes') }}: {{ loaded.routes.length }}
          </p>
          <ul>
            @for (route of loaded.routes; track route.path) {
              <li
                data-testid="design-preview-route"
                [attr.data-path]="route.path"
                [attr.data-component]="route.component"
              >
                <span class="cb-mono">{{ route.path }}</span>
                <span>{{ route.screen }}</span>
                @if (route.component === '') {
                  <span class="cb-muted">{{ t('session.preview.undeclared') }}</span>
                } @else {
                  <span class="cb-mono">{{ route.component }}</span>
                }
              </li>
            }
          </ul>

          <p data-testid="design-preview-count" data-kind="screens">
            {{ t('session.preview.screens') }}: {{ loaded.screens.length }}
          </p>
          <ul>
            @for (screen of loaded.screens; track screen.screen) {
              <li
                data-testid="design-preview-screen"
                [attr.data-screen]="screen.screen"
                [attr.data-route]="screen.route"
              >
                <span>{{ screen.screen }}</span>
                <span class="cb-mono cb-muted">{{ screen.route }}</span>
                <ul>
                  @for (state of statesOf(screen); track state.kind) {
                    <li
                      data-testid="design-preview-state"
                      [attr.data-state]="state.kind"
                      [attr.data-declared]="state.caption === null ? 'false' : 'true'"
                    >
                      <span class="cb-mono">{{ state.kind }}</span>
                      @if (state.caption === null) {
                        <span class="cb-muted">{{ t('session.preview.undeclared') }}</span>
                      } @else {
                        <span>{{ state.caption }}</span>
                      }
                    </li>
                  }
                </ul>
              </li>
            }
          </ul>

          @if (loaded.findings.length === 0) {
            <p data-testid="design-preview-clean">{{ t('session.preview.clean') }}</p>
          } @else {
            <ul>
              @for (
                finding of loaded.findings;
                track finding.file + ':' + finding.line + ':' + finding.rule
              ) {
                <li
                  data-testid="design-preview-finding"
                  [attr.data-rule]="finding.rule"
                  [attr.data-file]="finding.file"
                  [attr.data-line]="finding.line"
                >
                  <span class="cb-mono">{{ finding.file }}:{{ finding.line }}</span>
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

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Session, SessionTarget } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { I18nService } from '../../core/i18n/i18n.service';
import { BacklogApi } from './backlog.api';
import { translate } from './i18n';

/**
 * D55: a session is bound to one target, and the target is the write boundary. The repository
 * screen holds no work, so no `workId` is ever sent; rework is reached from `/works/:id`.
 */
export const NEW_SESSION_TARGETS: readonly SessionTarget[] = Object.freeze([
  'backlog',
  'design',
  'schedule',
  'repo',
]);

@Component({
  selector: 'app-new-session',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-sheet {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-muted);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 3);
        background: var(--cb-surface);
      }
      .cb-sheet-targets {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
      }
      .cb-sheet-target {
        min-block-size: 44px;
        padding-inline: calc(var(--cb-space) * 2);
        overflow-wrap: anywhere;
      }
      .cb-sheet-target[data-selected='true'] {
        border-color: var(--cb-accent);
        color: var(--cb-accent);
      }
      .cb-sheet-actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
      }
      .cb-muted {
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <section class="cb-sheet" data-testid="new-session-sheet" [attr.data-repo-id]="repoId()">
      <h2>{{ t('newSession.title') }}</h2>
      <p class="cb-muted">{{ t('newSession.hint') }}</p>
      <div class="cb-sheet-targets">
        @for (candidate of targets; track candidate) {
          <button
            type="button"
            class="cb-sheet-target"
            [attr.data-testid]="'new-session-target-' + candidate"
            [attr.data-selected]="selected() === candidate"
            [attr.aria-pressed]="selected() === candidate"
            [disabled]="busy()"
            (click)="pick(candidate)"
          >
            {{ t('newSession.target.' + candidate) }}
          </button>
        }
      </div>
      @if (selected() === 'repo') {
        <p class="cb-muted" data-testid="new-session-read-only">{{ t('newSession.target.repo.hint') }}</p>
      }
      @if (error(); as failure) {
        <p data-testid="new-session-error" [attr.data-code]="failure.code">
          {{ t('newSession.error') }}
        </p>
      }
      <div class="cb-sheet-actions">
        <button type="button" data-testid="new-session-cancel" [disabled]="busy()" (click)="cancel()">
          {{ t('newSession.cancel') }}
        </button>
        <button
          type="button"
          data-testid="new-session-create"
          [disabled]="busy() || selected() === null"
          (click)="create()"
        >
          {{ busy() ? t('newSession.busy') : t('newSession.create') }}
        </button>
      </div>
    </section>
  `,
})
export class NewSessionSheet {
  readonly repoId = input.required<string>();
  readonly target = input<SessionTarget | null>(null);
  readonly created = output<Session>();
  readonly cancelled = output<void>();

  readonly targets = NEW_SESSION_TARGETS;
  readonly selected = signal<SessionTarget | null>(null);
  readonly busy = signal(false);
  readonly error = signal<ApiError | null>(null);

  private readonly api = inject(BacklogApi);
  private readonly destroy = inject(DestroyRef);
  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  constructor() {
    effect(() => {
      const preset = this.target();
      untracked(() => {
        if (preset !== null) this.selected.set(preset);
      });
    });
  }

  pick(target: SessionTarget): void {
    if (this.busy()) return;
    this.error.set(null);
    this.selected.set(target);
  }

  create(): void {
    const target = this.selected();
    if (target === null || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api
      .createSession({ repoId: this.repoId(), target })
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: (session) => this.created.emit(session),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  cancel(): void {
    if (this.busy()) return;
    this.cancelled.emit();
  }
}

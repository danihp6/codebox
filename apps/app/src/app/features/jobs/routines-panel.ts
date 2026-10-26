import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Routine } from '@codebox/contracts';
import { finalize } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { validateCron } from './cron';
import { CronPickerComponent } from './cron-picker';
import { translate } from './i18n';
import { RoutinesApi } from './routines.api';
import type { RoutinePatchBody } from './routines.api';
import { routineLastFire, routineNextFire, routineSchedule } from './routines-format';
import { RoutinesStore } from './routines.store';

const DEFAULT_CRON = '0 7 * * *';
const FALLBACK_TIMEZONE = 'UTC';

@Component({
  selector: 'app-routines-panel',
  standalone: true,
  imports: [CronPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [RoutinesStore],
  styles: [
    `
      .cb-routines-list {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-routine-row,
      .cb-routine-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cb-space);
        align-items: baseline;
        overflow-wrap: anywhere;
      }
      .cb-routine-title {
        font-weight: 600;
      }
      .cb-routine-row[data-armed='true'] {
        border-inline-start: 3px solid var(--cb-danger);
        padding-inline-start: calc(var(--cb-space) * 2);
      }
      .cb-routine-sheet {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        margin-block-start: calc(var(--cb-space) * 4);
        padding: calc(var(--cb-space) * 3);
        border: 1px solid var(--cb-muted);
        border-radius: var(--cb-radius);
      }
    `,
  ],
  template: `
    <div data-testid="routines-panel" [attr.data-loading]="store.loading()">
      @if (store.loading()) {
        <div data-testid="routines-loading">{{ t('routines.loading') }}</div>
      }

      @if (store.error(); as failure) {
        <div data-testid="routines-error" [attr.data-code]="failure.code">
          <p>{{ t('routines.error') }}</p>
          <button type="button" data-testid="routines-retry" (click)="store.load()">
            {{ t('routines.retry') }}
          </button>
        </div>
      }

      @if (!store.loading() && store.error() === null && store.routines().length === 0) {
        <p data-testid="routines-empty">{{ t('routines.empty') }}</p>
      }

      <ul class="cb-routines-list">
        @for (routine of store.routines(); track routine.id) {
          <li
            class="cb-routine-row"
            data-testid="routine-row"
            [attr.data-routine-id]="routine.id"
            [attr.data-kind]="routine.kind"
            [attr.data-enabled]="routine.enabled"
            [attr.data-armed]="confirming() === routine.id ? 'true' : null"
          >
            <span class="cb-routine-title">{{ routine.title }}</span>
            <span data-testid="routine-kind">
              @if (routine.kind === 'prompt') {
                {{ t('routines.kind.prompt') }}
              } @else {
                {{ t('routines.kind.reminder') }}
              }
            </span>
            <span data-testid="routine-cost">
              @if (routine.kind === 'prompt') {
                {{ t('routines.cost.prompt') }}
              } @else {
                {{ t('routines.cost.reminder') }}
              }
            </span>
            <span class="cb-mono" data-testid="routine-schedule">{{ schedule(routine) }}</span>
            @if (routine.nextFireAt !== null) {
              <span>{{ t('routines.next') }}</span>
              <span data-testid="routine-next" [attr.data-at]="routine.nextFireAt">
                {{ nextFire(routine) }}
              </span>
            }
            <span>{{ t('routines.last') }}</span>
            <span data-testid="routine-last">{{ lastFire(routine) }}</span>
            <span data-testid="routine-state">
              @if (routine.enabled) {
                {{ t('routines.state.enabled') }}
              } @else {
                {{ t('routines.state.paused') }}
              }
            </span>
            <span class="cb-routine-actions">
              @if (routine.enabled) {
                <button
                  type="button"
                  data-testid="routine-pause"
                  [disabled]="store.busy() === routine.id"
                  (click)="store.pause(routine)"
                >
                  {{ t('routines.action.pause') }}
                </button>
              } @else {
                <button
                  type="button"
                  data-testid="routine-resume"
                  [disabled]="store.busy() === routine.id"
                  (click)="store.resume(routine)"
                >
                  {{ t('routines.action.resume') }}
                </button>
              }
              <button
                type="button"
                data-testid="routine-run-now"
                [disabled]="store.running() === routine.id"
                (click)="store.runNow(routine)"
              >
                {{ t('routines.action.runNow') }}
              </button>
              <button type="button" data-testid="routine-edit" (click)="edit(routine)">
                {{ t('routines.action.edit') }}
              </button>
              @if (confirming() === routine.id) {
                <button
                  type="button"
                  data-testid="routine-delete-confirm"
                  [disabled]="store.busy() === routine.id"
                  (click)="confirmDelete(routine)"
                >
                  {{ t('routines.action.deleteConfirm') }}
                </button>
                <button type="button" data-testid="routine-delete-cancel" (click)="cancelDelete()">
                  {{ t('routines.action.deleteCancel') }}
                </button>
              } @else {
                <button type="button" data-testid="routine-delete" (click)="askDelete(routine.id)">
                  {{ t('routines.action.delete') }}
                </button>
              }
            </span>
          </li>
        }
      </ul>

      @if (editing(); as routine) {
        <section class="cb-routine-sheet" data-testid="routine-sheet" role="dialog" aria-modal="true">
          <h2>{{ t('routines.action.edit') }}</h2>

          <label for="routine-form-title">{{ t('routines.form.title') }}</label>
          <input
            id="routine-form-title"
            data-testid="routine-form-title"
            type="text"
            [value]="formTitle()"
            (input)="formTitle.set(valueOf($event))"
          />

          <label for="routine-form-timezone">{{ t('routines.form.timezone') }}</label>
          <input
            id="routine-form-timezone"
            data-testid="routine-form-timezone"
            type="text"
            [value]="formTimezone()"
            (input)="formTimezone.set(valueOf($event))"
          />

          <span data-testid="routine-form-cron">
            <app-cron-picker
              [expression]="formCron()"
              [locale]="locale()"
              (changed)="formCron.set($event)"
            />
          </span>

          @if (routine.kind === 'prompt') {
            <label for="routine-form-prompt">{{ t('routines.form.prompt') }}</label>
            <textarea
              id="routine-form-prompt"
              data-testid="routine-form-prompt"
              [value]="formPrompt()"
              (input)="formPrompt.set(valueOf($event))"
            ></textarea>
          }

          <label for="routine-form-notify">
            <input
              id="routine-form-notify"
              data-testid="routine-form-notify"
              type="checkbox"
              [checked]="formNotify()"
              (change)="formNotify.set(checked($event))"
            />
            {{ t('routines.form.notify') }}
          </label>

          @if (formError(); as failure) {
            <p data-testid="routine-form-error" [attr.data-code]="failure.code">
              {{ failure.message }}
            </p>
          }

          <div class="cb-routine-actions">
            <button
              type="button"
              data-testid="routine-form-save"
              [disabled]="saving()"
              (click)="save()"
            >
              {{ t('routines.action.save') }}
            </button>
            <button type="button" data-testid="routine-form-cancel" (click)="closeEditor()">
              {{ t('jobs.form.cancel') }}
            </button>
          </div>
        </section>
      }
    </div>
  `,
})
export class RoutinesPanel {
  readonly store = inject(RoutinesStore);
  private readonly routinesApi = inject(RoutinesApi);
  private readonly sse = inject(SseService);
  private readonly i18n = inject(I18nService);
  private readonly destroy = inject(DestroyRef);

  readonly locale = this.i18n.locale;
  readonly t = (key: string): string => translate(this.locale(), key);

  readonly confirming = signal<string | null>(null);
  readonly editing = signal<Routine | null>(null);
  readonly formTitle = signal('');
  readonly formCron = signal(DEFAULT_CRON);
  readonly formTimezone = signal(FALLBACK_TIMEZONE);
  readonly formNotify = signal(true);
  readonly formPrompt = signal('');
  readonly formError = signal<ApiError | null>(null);
  readonly saving = signal(false);

  constructor() {
    effect(() => {
      const event = this.sse.event();
      if (event === null) return;
      untracked(() => {
        this.store.applyStreamEvent(event);
      });
    });
    this.formTimezone.set(Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE);
    this.store.load();
  }

  schedule(routine: Routine): string {
    return routineSchedule(routine, this.locale());
  }

  nextFire(routine: Routine): string | null {
    return routineNextFire(routine, this.locale());
  }

  lastFire(routine: Routine): string {
    return routineLastFire(routine, this.locale()) ?? this.t('routines.never');
  }

  valueOf(event: Event): string {
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

  checked(event: Event): boolean {
    const target = event.target;
    return target instanceof HTMLInputElement ? target.checked : false;
  }

  askDelete(id: string): void {
    this.confirming.set(id);
  }

  cancelDelete(): void {
    this.confirming.set(null);
  }

  confirmDelete(routine: Routine): void {
    this.confirming.set(null);
    this.store.remove(routine);
  }

  edit(routine: Routine): void {
    this.confirming.set(null);
    this.formError.set(null);
    this.formTitle.set(routine.title);
    this.formCron.set(routine.cron);
    this.formTimezone.set(routine.timezone);
    this.formNotify.set(routine.notify);
    this.formPrompt.set(routine.kind === 'prompt' ? routine.prompt : '');
    this.editing.set(routine);
  }

  closeEditor(): void {
    this.editing.set(null);
    this.formError.set(null);
  }

  save(): void {
    const routine = this.editing();
    if (routine === null || this.saving()) return;

    const title = this.formTitle().trim();
    const cron = this.formCron().trim();
    const timezone = this.formTimezone().trim();

    if (title === '') {
      this.formError.set(this.clientError('routine.title', this.t('routines.form.invalid')));
      return;
    }
    if (!validateCron(cron).ok) {
      this.formError.set(
        this.clientError('routine.cron', this.t('jobs.detail.validation')),
      );
      return;
    }
    if (timezone === '') {
      this.formError.set(this.clientError('routine.timezone', this.t('routines.form.invalid')));
      return;
    }

    const variables = { title, cron, timezone, notify: this.formNotify() };
    const body: RoutinePatchBody =
      routine.kind === 'prompt'
        ? { ...variables, prompt: this.formPrompt().trim() }
        : { ...variables };

    this.formError.set(null);
    this.saving.set(true);
    this.routinesApi
      .patch(routine.id, body)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (updated) => {
          this.store.replace(updated);
          this.editing.set(null);
        },
        error: (error: ApiError) => this.formError.set(error),
      });
  }

  private clientError(path: string, message: string): ApiError {
    return new ApiError({
      message,
      status: 0,
      code: 'validation_failed',
      requestId: null,
      details: { path },
    });
  }
}

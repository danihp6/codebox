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
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { Job, Repo } from '@codebox/contracts';
import { finalize } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { validateCron } from './cron';
import { CronPickerComponent } from './cron-picker';
import { translate } from './i18n';
import { JobsApi } from './jobs.api';
import { JobsStore } from './jobs.store';
import { RoutinesPanel } from './routines-panel';
import { formatFire } from './time-format';

const DEFAULT_CRON = '0 3 * * *';
const FALLBACK_TIMEZONE = 'UTC';

@Component({
  selector: 'app-jobs-page',
  standalone: true,
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    RouterLink,
    CronPickerComponent,
    RoutinesPanel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [JobsStore],
  styles: [
    `
      .cb-jobs-head,
      .cb-job-actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
      }
      .cb-jobs-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cb-space);
        margin-block-end: calc(var(--cb-space) * 3);
      }
      .cb-jobs-tabs [data-active='true'] {
        border-block-end: 2px solid var(--cb-accent);
      }
      .cb-jobs-list,
      .cb-job-history {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-job-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cb-space);
        align-items: baseline;
        overflow-wrap: anywhere;
      }
      .cb-job-form {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('jobs.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-jobs" [attr.data-tab]="tab()">
        <div class="cb-jobs-tabs" data-testid="jobs-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            data-testid="jobs-tab-jobs"
            [attr.data-active]="tab() === 'jobs'"
            [attr.aria-selected]="tab() === 'jobs'"
            (click)="tab.set('jobs')"
          >
            {{ t('jobs.tab.jobs') }}
          </button>
          <button
            type="button"
            role="tab"
            data-testid="jobs-tab-routines"
            [attr.data-active]="tab() === 'routines'"
            [attr.aria-selected]="tab() === 'routines'"
            (click)="tab.set('routines')"
          >
            {{ t('jobs.tab.routines') }}
          </button>
        </div>

        @if (tab() === 'jobs') {
          <section>
            <div class="cb-jobs-head">
              <h1>{{ t('jobs.title') }}</h1>
              <button type="button" data-testid="job-create" (click)="openForm()">
                {{ t('jobs.action.create') }}
              </button>
            </div>

            @if (store.loading()) {
              <div data-testid="jobs-loading">{{ t('jobs.loading') }}</div>
            }

            @if (store.error(); as failure) {
              <div data-testid="jobs-error" [attr.data-code]="failure.code">
                <p>{{ t('jobs.error') }}</p>
                <button type="button" data-testid="jobs-retry" (click)="store.load()">
                  {{ t('jobs.retry') }}
                </button>
              </div>
            }

            @if (!store.loading() && store.error() === null && store.jobs().length === 0) {
              <p data-testid="jobs-empty">{{ t('jobs.empty') }}</p>
            }

            <ul class="cb-jobs-list">
              @for (job of store.jobs(); track job.id) {
                <li
                  class="cb-job-row"
                  data-testid="job-row"
                  [attr.data-job-id]="job.id"
                  [attr.data-enabled]="job.enabled"
                  [attr.data-cron]="job.cron"
                >
                  <a [routerLink]="['/jobs', job.id]">{{ job.title }}</a>
                  <span class="cb-mono">{{ job.cron }}</span>
                  <span class="cb-mono">{{ job.timezone }}</span>
                  @if (job.nextFireAt !== null) {
                    <span data-testid="job-next" [attr.data-at]="job.nextFireAt">
                      {{ fireLabel(job) }}
                    </span>
                  }
                  <span>{{ job.enabled ? t('jobs.state.enabled') : t('jobs.state.paused') }}</span>
                  <span class="cb-job-actions">
                    @if (job.enabled) {
                      <button
                        type="button"
                        data-testid="job-pause"
                        [disabled]="store.busy() === job.id"
                        (click)="store.pause(job)"
                      >
                        {{ t('jobs.action.pause') }}
                      </button>
                    } @else {
                      <button
                        type="button"
                        data-testid="job-resume"
                        [disabled]="store.busy() === job.id"
                        (click)="store.resume(job)"
                      >
                        {{ t('jobs.action.resume') }}
                      </button>
                    }
                    <button
                      type="button"
                      data-testid="job-run-now"
                      [disabled]="store.running() === job.id"
                      (click)="store.runNow(job)"
                    >
                      {{ t('jobs.action.runNow') }}
                    </button>
                  </span>
                </li>
              }
            </ul>
          </section>

          @if (formOpen()) {
            <form class="cb-job-form" data-testid="job-form" (submit)="submitForm($event)">
              <h2>{{ t('jobs.action.create') }}</h2>
              <label for="job-form-title">{{ t('jobs.form.title') }}</label>
              <input
                id="job-form-title"
                data-testid="job-form-title"
                type="text"
                [value]="formTitle()"
                (input)="formTitle.set(valueOf($event))"
              />

              <label for="job-form-prompt">{{ t('jobs.form.prompt') }}</label>
              <textarea
                id="job-form-prompt"
                data-testid="job-form-prompt"
                [value]="formPrompt()"
                (input)="formPrompt.set(valueOf($event))"
              ></textarea>

              <label for="job-form-repo">{{ t('jobs.form.repo') }}</label>
              <select
                id="job-form-repo"
                data-testid="job-form-repo"
                [value]="formRepoId()"
                (change)="formRepoId.set(valueOf($event))"
              >
                @for (repo of repos(); track repo.id) {
                  <option
                    data-testid="job-form-repo-option"
                    [attr.data-repo-id]="repo.id"
                    [value]="repo.id"
                    [selected]="repo.id === formRepoId()"
                  >
                    {{ repo.slug }}
                  </option>
                }
              </select>

              <label for="job-form-timezone">{{ t('jobs.form.timezone') }}</label>
              <input
                id="job-form-timezone"
                data-testid="job-form-timezone"
                type="text"
                [value]="formTimezone()"
                (input)="formTimezone.set(valueOf($event))"
              />

              <app-cron-picker
                [expression]="formCron()"
                [locale]="locale()"
                (changed)="formCron.set($event)"
              />

              @if (formError(); as failure) {
                <p data-testid="job-form-error" [attr.data-code]="failure.code">
                  {{ failure.message }}
                </p>
              }

              <div class="cb-job-actions">
                <button
                  type="button"
                  data-testid="job-form-submit"
                  [disabled]="submitting()"
                  (click)="submitForm()"
                >
                  {{ t('jobs.form.submit') }}
                </button>
                <button type="button" data-testid="job-form-cancel" (click)="closeForm()">
                  {{ t('jobs.form.cancel') }}
                </button>
              </div>
            </form>
          }
        }

        @if (tab() === 'routines') {
          <app-routines-panel />
        }
      </div>
    </ion-content>
  `,
})
export class JobsPage {
  readonly store = inject(JobsStore);
  private readonly jobsApi = inject(JobsApi);
  private readonly sse = inject(SseService);
  private readonly destroy = inject(DestroyRef);
  private readonly i18n = inject(I18nService);

  readonly locale = this.i18n.locale;
  readonly t = (key: string): string => translate(this.locale(), key);

  readonly tab = signal<'jobs' | 'routines'>('jobs');
  readonly formOpen = signal(false);
  readonly formTitle = signal('');
  readonly formPrompt = signal('');
  readonly formRepoId = signal('');
  readonly formCron = signal(DEFAULT_CRON);
  readonly formTimezone = signal(FALLBACK_TIMEZONE);
  readonly formError = signal<ApiError | null>(null);
  readonly submitting = signal(false);
  readonly repos = signal<readonly Repo[]>([]);

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

  fireLabel(job: Job): string {
    return job.nextFireAt === null ? '' : formatFire(job.nextFireAt, job.timezone, this.locale());
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

  openForm(): void {
    this.formOpen.set(true);
    this.formError.set(null);
    if (this.repos().length === 0) this.loadRepos();
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.formError.set(null);
  }

  submitForm(event?: Event): void {
    event?.preventDefault();
    if (this.submitting()) return;

    const repoId = this.formRepoId();
    const title = this.formTitle().trim();
    const prompt = this.formPrompt().trim();
    const cron = this.formCron().trim();
    const timezone = this.formTimezone().trim();

    if (repoId === '' || title === '' || prompt === '') {
      this.formError.set(this.clientError('bad_request', 'job', this.t('jobs.form.invalid')));
      return;
    }

    const validation = validateCron(cron);
    if (!validation.ok) {
      this.formError.set(
        this.clientError('validation_failed', 'job.cron', this.t('jobs.detail.validation')),
      );
      return;
    }

    this.formError.set(null);
    this.submitting.set(true);
    this.store
      .create({ repoId, title, prompt, cron, timezone })
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: () => {
          this.formOpen.set(false);
          this.formTitle.set('');
          this.formPrompt.set('');
          this.formCron.set(DEFAULT_CRON);
          this.store.load();
        },
        error: (error: ApiError) => this.formError.set(error),
      });
  }

  private loadRepos(): void {
    this.jobsApi
      .listRepos()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (page) => {
          this.repos.set(page.data);
          if (this.formRepoId() === '') {
            const first = page.data[0];
            if (first !== undefined) this.formRepoId.set(first.id);
          }
        },
        error: (error: ApiError) => this.formError.set(error),
      });
  }

  private clientError(code: string, path: string, message: string): ApiError {
    return new ApiError({
      message,
      status: 0,
      code,
      requestId: null,
      details: { path },
    });
  }
}

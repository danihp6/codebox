import { DestroyRef, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Job } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { validateCron } from './cron';
import type { CronValidation } from './cron';
import { JobsApi } from './jobs.api';
import type { JobDetail } from './jobs.api';

const NEXT_COUNT = 5;
const VALID: CronValidation = { ok: true, problems: [] };

@Injectable()
export class JobStore {
  readonly jobId = signal<string | null>(null);
  readonly detail = signal<JobDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly saving = signal(false);
  readonly validation = signal<CronValidation>(VALID);
  readonly timezoneError = signal(false);
  private runCounter = 0;

  constructor(
    private readonly jobsApi: JobsApi,
    private readonly destroy: DestroyRef,
  ) {}

  load(id: string): void {
    if (this.jobId() !== id) {
      this.jobId.set(id);
      this.detail.set(null);
      this.error.set(null);
      this.loading.set(true);
      this.validation.set(VALID);
      this.timezoneError.set(false);
    }
    this.jobsApi
      .get(id)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.error.set(null);
          this.loading.set(false);
        },
        error: (error: ApiError) => {
          this.error.set(error);
          this.loading.set(false);
        },
      });
  }

  saveCron(cron: string, timezone: string): void {
    const validation = validateCron(cron);
    this.validation.set(validation);
    this.timezoneError.set(false);
    if (!validation.ok) return;
    if (!isTimezone(timezone)) {
      this.timezoneError.set(true);
      return;
    }
    const id = this.jobId();
    if (id === null) return;

    this.saving.set(true);
    this.jobsApi
      .patch(id, { cron, timezone })
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (job) => {
          this.applyJob(job);
          this.error.set(null);
          this.refreshNext();
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  setEnabled(enabled: boolean): void {
    const id = this.jobId();
    if (id === null) return;

    this.saving.set(true);
    this.jobsApi
      .patch(id, { enabled })
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (job) => {
          this.applyJob(job);
          this.error.set(null);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  runNow(): void {
    const id = this.jobId();
    if (id === null) return;
    this.runCounter += 1;
    const idempotencyKey = `runnow-${id}-${this.runCounter}`;
    this.jobsApi
      .runNow(id, idempotencyKey)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => this.error.set(null),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  refreshNext(): void {
    const id = this.jobId();
    if (id === null) return;
    this.jobsApi
      .next(id, NEXT_COUNT)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (fires) =>
          this.detail.update((current) =>
            current === null ? current : { ...current, nextFires: fires },
          ),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  private applyJob(job: Job): void {
    this.detail.update((current) => (current === null ? current : { ...current, job }));
  }
}

function isTimezone(value: string): boolean {
  if (value.trim() === '') return false;
  try {
    Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

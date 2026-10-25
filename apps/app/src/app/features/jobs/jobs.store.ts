import { DestroyRef, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Job, SseStreamEvent } from '@codebox/contracts';
import { Observable, finalize } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { ApiError } from '../../core/api/api-client';
import { JobsApi } from './jobs.api';
import type { JobCreateBody } from './jobs.api';

const JOBS_PAGE_SIZE = 100;

@Injectable()
export class JobsStore {
  readonly jobs = signal<readonly Job[]>([]);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly busy = signal<string | null>(null);
  readonly running = signal<string | null>(null);
  private runCounter = 0;

  constructor(
    private readonly api: ApiClient,
    private readonly jobsApi: JobsApi,
    private readonly destroy: DestroyRef,
  ) {}

  load(): void {
    this.loading.set(true);
    this.api
      .listJobs({ limit: JOBS_PAGE_SIZE })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (page) => {
          this.jobs.set(page.data);
          this.error.set(null);
          this.loading.set(false);
        },
        error: (error: ApiError) => {
          this.error.set(error);
          this.loading.set(false);
        },
      });
  }

  pause(job: Job): void {
    this.optimistic(job, { ...job, enabled: false, nextFireAt: null }, () =>
      this.jobsApi.pause(job.id),
    );
  }

  resume(job: Job): void {
    this.optimistic(job, { ...job, enabled: true }, () => this.jobsApi.resume(job.id));
  }

  runNow(job: Job): void {
    this.runCounter += 1;
    const idempotencyKey = `runnow-${job.id}-${this.runCounter}`;
    this.running.set(job.id);
    this.jobsApi
      .runNow(job.id, idempotencyKey)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.running.set(null)),
      )
      .subscribe({
        next: () => this.error.set(null),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  create(body: JobCreateBody): Observable<Job> {
    return this.jobsApi.create(body);
  }

  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored' {
    if (event.event !== 'job.changed') return 'ignored';
    this.load();
    return 'applied';
  }

  private optimistic(previous: Job, next: Job, request: () => Observable<Job>): void {
    this.replace(next);
    this.busy.set(previous.id);
    request()
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: (updated) => {
          this.replace(updated);
          this.error.set(null);
        },
        error: (error: ApiError) => {
          this.replace(previous);
          this.error.set(error);
        },
      });
  }

  private replace(job: Job): void {
    this.jobs.update((current) => current.map((row) => (row.id === job.id ? job : row)));
  }
}

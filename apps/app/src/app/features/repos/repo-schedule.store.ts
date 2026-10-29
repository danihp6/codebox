import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Run, Schedule } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { RepoScheduleApi } from './repo-schedule.api';
import type { RepoScheduleCreateBody } from './repo-schedule.api';

export type RepoScheduleBusy = 'pause' | 'resume' | 'runNext' | 'create';

export type RepoScheduleNotice = 'nothing_pending' | 'nothing_runnable';

/** docs/api.md §3: the `details.reason` a refusal carries, if it carries one. */
export function refusalReason(error: ApiError): string | null {
  const details = error.details;
  if (details === null) return null;
  const reason = details['reason'];
  return typeof reason === 'string' ? reason : null;
}

@Injectable()
export class RepoScheduleStore {
  private readonly api = inject(RepoScheduleApi);
  private readonly destroy = inject(DestroyRef);

  readonly repoId = signal<string | null>(null);
  readonly schedule = signal<Schedule | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly busy = signal<RepoScheduleBusy | null>(null);
  readonly notice = signal<RepoScheduleNotice | null>(null);
  readonly nextRun = signal<Run | null>(null);
  readonly created = signal(false);

  load(repoId: string): void {
    if (this.repoId() !== repoId) {
      this.repoId.set(repoId);
      this.schedule.set(null);
      this.error.set(null);
      this.notice.set(null);
      this.nextRun.set(null);
      this.created.set(false);
      this.loading.set(true);
    }
    this.fetch(repoId);
  }

  reload(): void {
    const repoId = this.repoId();
    if (repoId !== null) this.fetch(repoId);
  }

  pause(): void {
    const schedule = this.schedule();
    if (schedule === null || this.busy() !== null) return;
    this.toggle(schedule, 'pause', false);
  }

  resume(): void {
    const schedule = this.schedule();
    if (schedule === null || this.busy() !== null) return;
    this.toggle(schedule, 'resume', true);
  }

  runNext(): void {
    const repoId = this.repoId();
    if (repoId === null || this.busy() !== null) return;
    this.notice.set(null);
    this.nextRun.set(null);
    this.error.set(null);
    this.busy.set('runNext');
    this.api
      .runNext(repoId)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: (run) => this.nextRun.set(run),
        error: (error: ApiError) => {
          const reason = refusalReason(error);
          if (reason === 'nothing_pending' || reason === 'nothing_runnable') {
            this.notice.set(reason);
            return;
          }
          this.error.set(error);
        },
      });
  }

  create(body: RepoScheduleCreateBody): void {
    if (this.busy() !== null) return;
    this.error.set(null);
    this.notice.set(null);
    this.busy.set('create');
    this.api
      .create(body)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: (schedule) => {
          this.schedule.set(schedule);
          this.created.set(true);
        },
        error: (error: ApiError) => {
          if (refusalReason(error) === 'schedule_exists') {
            this.reload();
            return;
          }
          this.error.set(error);
        },
      });
  }

  private toggle(
    previous: Schedule,
    action: 'pause' | 'resume',
    enabled: boolean,
  ): void {
    this.error.set(null);
    this.notice.set(null);
    this.schedule.set({ ...previous, enabled });
    this.busy.set(action);
    const request = action === 'pause' ? this.api.pause(previous.id) : this.api.resume(previous.id);
    request
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: (schedule) => this.schedule.set(schedule),
        error: (error: ApiError) => {
          this.schedule.set(previous);
          this.error.set(error);
        },
      });
  }

  private fetch(repoId: string): void {
    this.api
      .list(repoId)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (page) => {
          this.schedule.set(page.data[0] ?? null);
          this.error.set(null);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }
}

import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import type { Backlog } from '@codebox/contracts';
import { finalize, map, switchMap } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { BacklogApi } from './backlog.api';

export interface LiveWorkConflict {
  readonly ref: string;
  readonly workId: string | null;
}

@Injectable()
export class BacklogStore {
  private readonly api = inject(BacklogApi);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);

  readonly repoId = signal<string | null>(null);
  readonly backlog = signal<Backlog | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly busyRef = signal<string | null>(null);
  readonly liveWork = signal<LiveWorkConflict | null>(null);

  load(repoId: string): void {
    if (this.repoId() !== repoId) {
      this.repoId.set(repoId);
      this.backlog.set(null);
      this.error.set(null);
      this.liveWork.set(null);
      this.loading.set(true);
    }
    this.fetch(repoId);
  }

  reload(): void {
    const repoId = this.repoId();
    if (repoId !== null) this.fetch(repoId);
  }

  run(repoId: string, ref: string): void {
    if (this.busyRef() !== null) return;
    this.busyRef.set(ref);
    this.liveWork.set(null);
    this.error.set(null);
    this.api
      .createWork({ repoId, backlogRef: ref })
      .pipe(
        switchMap((work) => this.api.startRun(work.id).pipe(map(() => work))),
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busyRef.set(null)),
      )
      .subscribe({
        next: (work) => void this.router.navigate(['/works', work.id]),
        error: (error: ApiError) => {
          if (refusalReason(error) === 'live_work') {
            this.liveWork.set({ ref, workId: stringField(error.details, 'workId') });
            return;
          }
          this.error.set(error);
        },
      });
  }

  private fetch(repoId: string): void {
    this.api
      .get(repoId)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (backlog) => {
          this.backlog.set(backlog);
          this.error.set(null);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }
}

function refusalReason(error: ApiError): string | null {
  return stringField(error.details, 'reason');
}

function stringField(details: Record<string, unknown> | null, key: string): string | null {
  if (details === null) return null;
  const value = details[key];
  return typeof value === 'string' ? value : null;
}

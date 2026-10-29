import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import type { WorkDetail, WorkState } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { WorksApi } from './works.api';

export type WorkBusy = 'decision' | 'run';

@Injectable()
export class WorkStore {
  private readonly api = inject(WorksApi);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);

  readonly workId = signal<string | null>(null);
  readonly detail = signal<WorkDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly busy = signal<WorkBusy | null>(null);

  readonly work = computed(() => this.detail()?.work ?? null);
  readonly state = computed<WorkState | null>(() => this.work()?.state ?? null);

  load(id: string): void {
    if (this.workId() !== id) {
      this.workId.set(id);
      this.detail.set(null);
      this.error.set(null);
      this.busy.set(null);
      this.loading.set(true);
    }
    this.fetch(id);
  }

  reload(): void {
    const id = this.workId();
    if (id !== null) this.fetch(id);
  }

  /** The one action of a blocked work: its decision session. */
  resolveDoubt(): void {
    const id = this.workId();
    if (id === null || this.busy() !== null) return;
    this.busy.set('decision');
    this.error.set(null);
    this.api
      .decision(id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: (session) => void this.router.navigate(['/sessions', session.id]),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  /**
   * A merged work's rework opens a new attempt on the same work, so the screen refetches its
   * detail and renders the new run segment instead of navigating to another resource.
   */
  rework(): void {
    const id = this.workId();
    if (id === null || this.busy() !== null) return;
    this.busy.set('run');
    this.error.set(null);
    this.api
      .startRun(id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: () => this.fetch(id),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  private fetch(id: string): void {
    this.api
      .get(id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.error.set(null);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }
}

import { DestroyRef, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Routine, SseStreamEvent } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { Observable } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { RoutinesApi } from './routines.api';

export const ROUTINES_PAGE_SIZE = 100;

@Injectable()
export class RoutinesStore {
  readonly routines = signal<readonly Routine[]>([]);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly busy = signal<string | null>(null);
  readonly running = signal<string | null>(null);

  constructor(
    private readonly api: RoutinesApi,
    private readonly destroy: DestroyRef,
  ) {}

  load(): void {
    this.loading.set(true);
    this.api
      .list({ limit: ROUTINES_PAGE_SIZE })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (page) => {
          this.routines.set(page.data);
          this.error.set(null);
          this.loading.set(false);
        },
        error: (error: ApiError) => {
          this.error.set(error);
          this.loading.set(false);
        },
      });
  }

  pause(routine: Routine): void {
    this.optimistic(routine, { ...routine, enabled: false, nextFireAt: null }, () =>
      this.api.pause(routine.id),
    );
  }

  resume(routine: Routine): void {
    this.optimistic(routine, { ...routine, enabled: true }, () => this.api.resume(routine.id));
  }

  runNow(routine: Routine): void {
    this.running.set(routine.id);
    this.api
      .runNow(routine.id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.running.set(null)),
      )
      .subscribe({
        next: (updated) => {
          this.replace(updated);
          this.error.set(null);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  remove(routine: Routine): void {
    this.busy.set(routine.id);
    this.api
      .remove(routine.id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: () => {
          this.routines.update((current) => current.filter((row) => row.id !== routine.id));
          this.error.set(null);
        },
        error: (error: ApiError) => {
          this.error.set(error);
          if (error.status === 404) this.load();
        },
      });
  }

  replace(routine: Routine): void {
    this.routines.update((current) =>
      current.some((row) => row.id === routine.id)
        ? current.map((row) => (row.id === routine.id ? routine : row))
        : [...current, routine],
    );
  }

  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored' {
    if (
      event.event !== 'routine.fired' &&
      event.event !== 'routine.replied' &&
      event.event !== 'routine.failed'
    ) {
      return 'ignored';
    }
    this.load();
    return 'applied';
  }

  private optimistic(
    previous: Routine,
    next: Routine,
    request: () => Observable<Routine>,
  ): void {
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
}

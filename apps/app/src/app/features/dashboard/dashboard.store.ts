import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Health, Run, SseStreamEvent, Telemetry } from '@codebox/contracts';
import { finalize } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { ApiError } from '../../core/api/api-client';
import { DashboardApi } from './dashboard.api';

const RECENT_RUNS_LIMIT = 5;

@Injectable()
export class DashboardStore {
  private readonly api = inject(ApiClient);
  private readonly dashboardApi = inject(DashboardApi);
  private readonly destroy = inject(DestroyRef);

  readonly health = signal<Health | null>(null);
  readonly telemetry = signal<Telemetry | null>(null);
  readonly recentRuns = signal<readonly Run[]>([]);
  readonly loading = signal(true);
  readonly stale = signal(false);
  readonly error = signal<ApiError | null>(null);

  load(): void {
    this.error.set(null);
    this.stale.set(false);
    this.loading.set(true);
    this.fetchHealth(false);
    this.fetchTelemetry(false);
    this.fetchRuns(false);
  }

  reload(): void {
    this.error.set(null);
    this.stale.set(false);
    this.fetchHealth(true);
    this.fetchTelemetry(true);
    this.fetchRuns(true);
  }

  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored' {
    void event;
    return 'ignored';
  }

  private fetchHealth(fromReload: boolean): void {
    this.api
      .health()
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (health) => this.health.set(health),
        error: (error: ApiError) => this.fail(error, fromReload, this.health() !== null),
      });
  }

  private fetchTelemetry(fromReload: boolean): void {
    this.dashboardApi
      .telemetry()
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (telemetry) => this.telemetry.set(telemetry),
        error: (error: ApiError) => this.fail(error, fromReload, this.telemetry() !== null),
      });
  }

  private fetchRuns(fromReload: boolean): void {
    this.api
      .listRuns({ limit: RECENT_RUNS_LIMIT })
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (page) => this.recentRuns.set(page.data),
        error: (error: ApiError) => this.fail(error, fromReload, this.recentRuns().length > 0),
      });
  }

  private fail(error: ApiError, fromReload: boolean, hasPayload: boolean): void {
    this.error.set(error);
    if (fromReload && hasPayload) this.stale.set(true);
  }
}

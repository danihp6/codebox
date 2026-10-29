import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Health, Run, RunState, SseStreamEvent, Telemetry } from '@codebox/contracts';
import { finalize } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { ApiError } from '../../core/api/api-client';
import { DashboardApi } from './dashboard.api';

const RECENT_RUNS_LIMIT = 5;
const PAGE_LIMIT = 50;
const REPO_PROBE_LIMIT = 1;

/** The states a live run can be in; `docs/api.md` §5.4 state machine, minus the terminals. */
export const WORKING_STATES: readonly RunState[] = Object.freeze([
  'queued',
  'preparing',
  'running',
  'gating',
  'merging',
]);

/** Delivered work waiting for the operator: an open pull request. */
export const REVIEW_STATE: RunState = 'pr_open';

@Injectable()
export class DashboardStore {
  private readonly api = inject(ApiClient);
  private readonly dashboardApi = inject(DashboardApi);
  private readonly destroy = inject(DestroyRef);
  private readonly hasPages = signal(false);

  readonly health = signal<Health | null>(null);
  readonly telemetry = signal<Telemetry | null>(null);
  readonly working = signal<readonly Run[]>([]);
  readonly ready = signal<readonly Run[]>([]);
  readonly recentRuns = signal<readonly Run[]>([]);
  readonly fresh = signal(false);
  readonly loading = signal(true);
  readonly stale = signal(false);
  readonly error = signal<ApiError | null>(null);

  load(): void {
    this.error.set(null);
    this.stale.set(false);
    this.loading.set(true);
    this.readAll(false);
  }

  reload(): void {
    this.error.set(null);
    this.stale.set(false);
    this.readAll(true);
  }

  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored' {
    const runId = trackedRunId(event);
    if (runId === null) return 'ignored';
    const tracked =
      this.working().some((run) => run.id === runId) ||
      this.ready().some((run) => run.id === runId);
    if (!tracked) return 'ignored';
    this.reload();
    return 'applied';
  }

  private readAll(fromReload: boolean): void {
    this.fetchHealth(fromReload);
    this.fetchTelemetry(fromReload);
    this.fetchRuns(fromReload);
    this.fetchRepos(fromReload);
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
      .telemetry('24h')
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
    this.dashboardApi
      .runs(PAGE_LIMIT)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (page) => {
          this.hasPages.set(true);
          this.recentRuns.set(page.data.slice(0, RECENT_RUNS_LIMIT));
          this.working.set(page.data.filter((run) => WORKING_STATES.includes(run.state)));
          this.ready.set(page.data.filter((run) => run.state === REVIEW_STATE));
        },
        error: (error: ApiError) => this.fail(error, fromReload, this.hasPages()),
      });
  }

  private fetchRepos(fromReload: boolean): void {
    this.dashboardApi
      .repos(REPO_PROBE_LIMIT)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (page) => {
          this.hasPages.set(true);
          this.fresh.set(page.data.length === 0);
        },
        error: (error: ApiError) => this.fail(error, fromReload, this.hasPages()),
      });
  }

  private fail(error: ApiError, fromReload: boolean, hasPayload: boolean): void {
    this.error.set(error);
    if (fromReload && hasPayload) this.stale.set(true);
  }
}

/** The run frames that can move a live or delivered run; `run.output` and friends are ignored. */
function trackedRunId(event: SseStreamEvent): string | null {
  switch (event.event) {
    case 'run.queued':
    case 'run.started':
    case 'run.gate':
    case 'run.pr':
    case 'run.merged':
    case 'run.finished':
    case 'run.failed':
    case 'run.cancelled':
      return event.data.runId;
    default:
      return null;
  }
}

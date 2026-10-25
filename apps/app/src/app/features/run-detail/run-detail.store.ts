import { DestroyRef, Injectable, computed, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import type { Run, RunDiff, RunState, SseStreamEvent } from '@codebox/contracts';
import { finalize } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { ApiError } from '../../core/api/api-client';
import { appendTimeline, fromStreamEvent, mergePage } from './timeline';
import type { RunTimelineItem } from './timeline';

export type RunAction = 'cancel' | 'revert';

const EVENTS_PAGE_SIZE = 200;

/** Mirrors `CANCELLABLE_STATES` in `packages/core/src/run-state.ts`, re-declared because
 *  `@codebox/app` does not depend on `@codebox/core` and this task may not add the
 *  dependency. The four states the daemon accepts a cancel for. */
export const CANCELLABLE_RUN_STATES: readonly RunState[] = Object.freeze([
  'queued',
  'preparing',
  'running',
  'gating',
]);

@Injectable()
export class RunDetailStore {
  readonly runId = signal<string | null>(null);
  readonly run = signal<Run | null>(null);
  readonly timeline = signal<readonly RunTimelineItem[]>([]);
  readonly diff = signal<RunDiff | null>(null);
  readonly diffUnavailable = signal(false);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly confirmingCancel = signal(false);
  readonly busy = signal<RunAction | null>(null);
  readonly canCancel = computed<boolean>(() => {
    const state = this.run()?.state;
    return state !== undefined && CANCELLABLE_RUN_STATES.includes(state);
  });
  readonly canRevert = computed<boolean>(
    () => this.run()?.state === 'succeeded' && this.run()?.pr !== null,
  );

  constructor(
    private readonly api: ApiClient,
    private readonly router: Router,
    private readonly destroy: DestroyRef,
  ) {}

  load(runId: string): void {
    if (this.runId() !== runId) {
      this.runId.set(runId);
      this.run.set(null);
      this.timeline.set([]);
      this.diff.set(null);
      this.diffUnavailable.set(false);
      this.error.set(null);
      this.loading.set(true);
      this.confirmingCancel.set(false);
      this.busy.set(null);
    }
    this.fetchRun(runId);
    this.fetchEvents(runId);
    this.fetchDiff(runId);
  }

  reload(): void {
    const runId = this.runId();
    if (runId === null) return;
    this.fetchRun(runId);
    this.fetchEvents(runId);
    this.fetchDiff(runId);
  }

  askCancel(): void {
    this.confirmingCancel.set(true);
  }

  dismissCancel(): void {
    this.confirmingCancel.set(false);
  }

  cancel(): void {
    const runId = this.runId();
    if (runId === null || !this.confirmingCancel() || this.busy() !== null) return;
    this.busy.set('cancel');
    this.api
      .cancelRun(runId)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: (run) => {
          this.run.set(run);
          this.confirmingCancel.set(false);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  revert(): void {
    const runId = this.runId();
    if (runId === null || this.busy() !== null) return;
    this.busy.set('revert');
    const idempotencyKey = `revert-${runId}-${Date.now()}`;
    this.api
      .revertRun(runId, idempotencyKey)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(null)),
      )
      .subscribe({
        next: (run) => {
          void this.router.navigate(['/runs', run.id]);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored' | 'refetch' {
    if (event.event === 'gap') return 'refetch';
    const runId = this.runId();
    if (runId === null) return 'ignored';
    const data = event.data as Readonly<Record<string, unknown>>;
    if (data['runId'] !== runId) return 'ignored';

    const item = fromStreamEvent(event);
    if (item !== null) this.timeline.update((current) => appendTimeline(current, item));

    if (
      event.event === 'run.finished' ||
      event.event === 'run.failed' ||
      event.event === 'run.cancelled'
    ) {
      this.fetchRun(runId);
    }
    return 'applied';
  }

  private fetchRun(runId: string): void {
    this.api
      .getRun(runId)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (run) => {
          this.run.set(run);
          this.error.set(null);
          this.loading.set(false);
        },
        error: (error: ApiError) => {
          this.error.set(error);
          this.loading.set(false);
        },
      });
  }

  private fetchEvents(runId: string): void {
    this.api
      .runEvents(runId, { after: 0, limit: EVENTS_PAGE_SIZE })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (page) => this.timeline.update((current) => mergePage(current, page)),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  private fetchDiff(runId: string): void {
    this.api
      .runDiff(runId)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (diff) => {
          this.diff.set(diff);
          this.diffUnavailable.set(false);
        },
        error: (error: ApiError) => {
          this.diff.set(null);
          this.diffUnavailable.set(
            error.status === 409 && error.details?.['reason'] === 'diff_unavailable',
          );
        },
      });
  }
}

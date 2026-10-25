import { DestroyRef, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Run, RunState, SseStreamEvent } from '@codebox/contracts';
import { finalize } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { ApiError } from '../../core/api/api-client';

const RUNS_PAGE_SIZE = 50;

const STATE_BY_EVENT: Readonly<Record<string, RunState>> = Object.freeze({
  'run.queued': 'queued',
  'run.finished': 'succeeded',
  'run.failed': 'failed',
  'run.cancelled': 'cancelled',
});

@Injectable()
export class RunsStore {
  readonly runs = signal<readonly Run[]>([]);
  readonly state = signal<RunState | null>(null);
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly error = signal<ApiError | null>(null);

  constructor(
    private readonly api: ApiClient,
    private readonly destroy: DestroyRef,
  ) {}

  load(): void {
    this.loading.set(true);
    this.api
      .listRuns(this.query())
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (page) => {
          this.runs.set(page.data);
          this.nextCursor.set(page.nextCursor);
          this.error.set(null);
          this.loading.set(false);
        },
        error: (error: ApiError) => {
          this.error.set(error);
          this.loading.set(false);
        },
      });
  }

  setState(state: RunState | null): void {
    this.state.set(state);
    this.runs.set([]);
    this.nextCursor.set(null);
    this.load();
  }

  more(): void {
    const cursor = this.nextCursor();
    if (cursor === null || this.loading() || this.loadingMore()) return;

    this.loadingMore.set(true);
    this.api
      .listRuns({ ...this.query(), cursor })
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loadingMore.set(false)),
      )
      .subscribe({
        next: (page) => {
          this.runs.update((current) => [...current, ...page.data]);
          this.nextCursor.set(page.nextCursor);
          this.error.set(null);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  applyStreamEvent(event: SseStreamEvent): 'applied' | 'ignored' {
    const nextState = STATE_BY_EVENT[event.event];
    if (nextState === undefined) return 'ignored';

    const data = event.data as Readonly<Record<string, unknown>>;
    const runId = data['runId'];
    if (typeof runId !== 'string') return 'ignored';
    if (!this.runs().some((run) => run.id === runId)) return 'ignored';

    this.runs.update((current) =>
      current.map((run) => (run.id === runId ? { ...run, state: nextState } : run)),
    );
    return 'applied';
  }

  private query(): { state?: RunState; limit: number } {
    const state = this.state();
    return { limit: RUNS_PAGE_SIZE, ...(state === null ? {} : { state }) };
  }
}

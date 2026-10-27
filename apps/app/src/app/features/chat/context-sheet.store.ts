import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Signal } from '@angular/core';
import type { ChatSession, Repo } from '@codebox/contracts';
import { Observable, Subject, finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { ContextSheetApi } from './context-sheet.api';

const READS_PER_LOAD = 2;

/**
 * The sheet's state. `load` is the only read path: the component renders signals and calls
 * `compact` / `createInRepo`, never the API.
 */
@Injectable()
export class ContextSheetStore {
  private readonly api = inject(ContextSheetApi);
  private readonly destroy = inject(DestroyRef);

  private readonly sessionSignal = signal<ChatSession | null>(null);
  private readonly daySpendUsdSignal = signal<number | null>(null);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal<ApiError | null>(null);
  private readonly reposSignal = signal<readonly Repo[]>([]);
  private readonly compactingSignal = signal(false);
  private readonly creatingSignal = signal(false);
  private readonly compactedEpochSignal = signal<number | null>(null);
  private readonly createdSource = new Subject<ChatSession>();

  /** The session the sheet renders; the daemon's answer after a compact replaces it. */
  readonly session: Signal<ChatSession | null> = this.sessionSignal.asReadonly();
  /** `null` when the read failed, or has not landed yet — never a fake 0. */
  readonly daySpendUsd: Signal<number | null> = this.daySpendUsdSignal.asReadonly();
  readonly loading: Signal<boolean> = this.loadingSignal.asReadonly();
  readonly error: Signal<ApiError | null> = this.errorSignal.asReadonly();
  /** The repository rows behind the slug; a chat's `repoId` is matched against them. */
  readonly repos: Signal<readonly Repo[]> = this.reposSignal.asReadonly();
  readonly compacting: Signal<boolean> = this.compactingSignal.asReadonly();
  readonly creating: Signal<boolean> = this.creatingSignal.asReadonly();
  /** The daemon's epoch after a successful compact; `null` keeps the divider off the sheet. */
  readonly compactedEpoch: Signal<number | null> = this.compactedEpochSignal.asReadonly();
  /** A chat created from this sheet; navigation stays with the host. */
  readonly created: Observable<ChatSession> = this.createdSource.asObservable();

  private pendingReads = 0;

  load(session: ChatSession): void {
    this.sessionSignal.set(session);
    this.daySpendUsdSignal.set(null);
    this.errorSignal.set(null);
    this.compactedEpochSignal.set(null);
    this.pendingReads = READS_PER_LOAD;
    this.loadingSignal.set(true);
    this.fetchRepos();
    this.fetchDaySpend();
  }

  compact(): void {
    const session = this.sessionSignal();
    if (session === null || this.compactingSignal()) return;
    this.compactingSignal.set(true);
    this.errorSignal.set(null);
    this.api
      .compact(session.id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.compactingSignal.set(false)),
      )
      .subscribe({
        next: (next) => {
          this.sessionSignal.set(next);
          this.compactedEpochSignal.set(next.contextEpoch ?? null);
        },
        error: (error: ApiError) => this.errorSignal.set(error),
      });
  }

  createInRepo(): void {
    const session = this.sessionSignal();
    if (session === null || session.repoId === null || this.creatingSignal()) return;
    this.creatingSignal.set(true);
    this.errorSignal.set(null);
    this.api
      .createInRepo(session.repoId)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.creatingSignal.set(false)),
      )
      .subscribe({
        next: (created) => this.createdSource.next(created),
        error: (error: ApiError) => this.errorSignal.set(error),
      });
  }

  /** A failed repo or spend read leaves the sheet usable: the row degrades, nothing blocks. */
  private fetchRepos(): void {
    this.api
      .repos()
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.settle()),
      )
      .subscribe({
        next: (page) => this.reposSignal.set(page.data),
        error: () => this.reposSignal.set([]),
      });
  }

  private fetchDaySpend(): void {
    this.api
      .daySpend()
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.settle()),
      )
      .subscribe({
        next: (telemetry) => this.daySpendUsdSignal.set(telemetry.spendUsd),
        error: () => this.daySpendUsdSignal.set(null),
      });
  }

  private settle(): void {
    this.pendingReads = Math.max(0, this.pendingReads - 1);
    if (this.pendingReads > 0) return;
    this.loadingSignal.set(false);
  }
}

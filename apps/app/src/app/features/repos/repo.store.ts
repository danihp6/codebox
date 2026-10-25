import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { RepoDetail, RepoPolicy, RepoVerify } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { ReposApi } from './repos.api';

@Injectable()
export class RepoStore {
  private readonly api = inject(ReposApi);
  private readonly destroy = inject(DestroyRef);

  readonly repoId = signal<string | null>(null);
  readonly repo = signal<RepoDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly saving = signal(false);
  readonly verification = signal<RepoVerify | null>(null);
  readonly verifyError = signal<ApiError | null>(null);
  readonly effectiveProtectedPaths = computed<readonly string[]>(
    () => this.repo()?.protectedPaths ?? [],
  );

  load(id: string): void {
    if (this.repoId() !== id) {
      this.repoId.set(id);
      this.repo.set(null);
      this.error.set(null);
      this.loading.set(true);
      this.verification.set(null);
      this.verifyError.set(null);
    }
    this.api
      .get(id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (repo) => {
          this.repo.set(repo);
          this.error.set(null);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  setPolicy(policy: RepoPolicy): void {
    const previous = this.repo();
    const id = this.repoId();
    if (id === null || previous === null || this.saving() || previous.policy === policy) return;
    this.repo.set({ ...previous, policy });
    this.saving.set(true);
    this.api
      .patch(id, { policy })
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (repo) => this.repo.set({ ...repo, lastRun: previous.lastRun }),
        error: (error: ApiError) => {
          this.repo.set(previous);
          this.error.set(error);
        },
      });
  }

  saveGate(gate: string): void {
    const previous = this.repo();
    const id = this.repoId();
    if (id === null || previous === null || this.saving()) return;
    this.saving.set(true);
    this.api
      .patch(id, { gate })
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (repo) => this.repo.set({ ...repo, lastRun: previous.lastRun }),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  saveProtectedPaths(paths: readonly string[]): void {
    const previous = this.repo();
    const id = this.repoId();
    if (id === null || previous === null || this.saving()) return;
    this.saving.set(true);
    this.api
      .patch(id, { protectedPaths: paths })
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (repo) => this.repo.set({ ...repo, lastRun: previous.lastRun }),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  verify(): void {
    const id = this.repoId();
    if (id === null) return;
    this.verifyError.set(null);
    this.verification.set(null);
    this.api
      .verify(id)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (result) => this.verification.set(result),
        error: (error: ApiError) => this.verifyError.set(error),
      });
  }
}

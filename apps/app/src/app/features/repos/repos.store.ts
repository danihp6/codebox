import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Repo, RepoVerify } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import type { RepoCreateBody } from './repos.api';
import { ReposApi } from './repos.api';

@Injectable()
export class ReposStore {
  private readonly api = inject(ReposApi);
  private readonly destroy = inject(DestroyRef);

  readonly repos = signal<readonly Repo[]>([]);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly creating = signal(false);
  readonly verifyFor = signal<string | null>(null);
  readonly verification = signal<RepoVerify | null>(null);
  readonly verifyError = signal<ApiError | null>(null);

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .list()
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (page) => this.repos.set(page.data),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  create(body: RepoCreateBody): void {
    if (this.creating()) return;
    this.creating.set(true);
    this.error.set(null);
    this.api
      .create(body)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.creating.set(false)),
      )
      .subscribe({
        next: (repo) => {
          this.repos.update((current) => [...current, repo]);
          this.verify(repo.id);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  verify(id: string): void {
    this.verifyFor.set(id);
    this.verifyError.set(null);
    this.verification.set(null);
    this.api
      .verify(id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => {
          if (this.verifyFor() === id) this.verifyFor.set(null);
        }),
      )
      .subscribe({
        next: (result) => this.verification.set(result),
        error: (error: ApiError) => this.verifyError.set(error),
      });
  }
}

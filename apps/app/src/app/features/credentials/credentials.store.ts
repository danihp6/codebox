import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import type { Observable } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { CredentialsApi } from './credentials.api';
import type {
  CreateCredentialBody,
  CreateIntegrationBody,
  Credential,
  GithubManifestStart,
  Integration,
} from './credentials.api';

@Injectable()
export class CredentialsStore {
  private readonly api = inject(CredentialsApi);
  private readonly destroy = inject(DestroyRef);

  readonly credentials = signal<readonly Credential[]>([]);
  readonly integrations = signal<readonly Integration[]>([]);
  readonly loading = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly saving = signal(false);
  readonly services: Signal<readonly Integration[]> = this.integrations;
  readonly openCredentials: Signal<readonly Credential[]> = computed(() =>
    this.credentials().filter((credential) => credential.kind !== 'github_app'),
  );

  /** Both reads are independent: a failure keeps the other list and clears the spinner last. */
  load(): void {
    this.loading.set(true);
    this.error.set(null);
    let pending = 2;
    const settle = (): void => {
      pending -= 1;
      if (pending === 0) this.loading.set(false);
    };

    this.api
      .listCredentials()
      .pipe(takeUntilDestroyed(this.destroy), finalize(settle))
      .subscribe({
        next: (page) => this.credentials.set(page.data),
        error: (failure: ApiError) => this.error.set(failure),
      });

    this.api
      .listIntegrations()
      .pipe(takeUntilDestroyed(this.destroy), finalize(settle))
      .subscribe({
        next: (page) => this.integrations.set(page.data),
        error: (failure: ApiError) => this.error.set(failure),
      });
  }

  createCredential(body: CreateCredentialBody): void {
    this.saving.set(true);
    this.error.set(null);
    this.api
      .createCredential(body)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => this.load(),
        error: (failure: ApiError) => this.error.set(failure),
      });
  }

  removeCredential(id: string): void {
    this.saving.set(true);
    this.error.set(null);
    this.api
      .removeCredential(id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => this.load(),
        error: (failure: ApiError) => this.error.set(failure),
      });
  }

  createIntegration(body: CreateIntegrationBody): void {
    this.saving.set(true);
    this.error.set(null);
    this.api
      .createIntegration(body)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => this.load(),
        error: (failure: ApiError) => this.error.set(failure),
      });
  }

  startGithubManifest(): Observable<GithubManifestStart> {
    return this.api.startGithubManifest();
  }

  completeGithubManifest(code: string, state: string): void {
    this.saving.set(true);
    this.error.set(null);
    this.api
      .completeGithubManifest(code, state)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => this.load(),
        error: (failure: ApiError) => this.error.set(failure),
      });
  }
}

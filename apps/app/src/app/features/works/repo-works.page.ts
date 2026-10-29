import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { Work, WorkState } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { I18nService } from '../../core/i18n/i18n.service';
import { RepoTabs } from '../repos/repo-tabs';
import { translate } from './i18n';
import { WorksApi } from './works.api';

/** Every work of the repository, flat and in the daemon's order: no client-side sort. */
@Component({
  selector: 'app-repo-works-page',
  standalone: true,
  imports: [RouterLink, IonContent, IonHeader, IonTitle, IonToolbar, RepoTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-works {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-work-row {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: baseline;
        border-block-end: 1px solid var(--cb-surface);
        padding-block: calc(var(--cb-space) * 2);
        overflow-wrap: anywhere;
        color: inherit;
        text-decoration: none;
      }
      .cb-work-title {
        flex: 1 1 12rem;
        min-inline-size: 0;
      }
      .cb-work-state {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-work-state[data-state='failed'] {
        color: var(--cb-danger);
      }
      .cb-work-state[data-state='needs_decision'] {
        color: var(--cb-warn);
      }
      .cb-work-state[data-state='merged'] {
        color: var(--cb-accent);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('works.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-repo-works" [attr.data-repo-id]="id()">
        <app-repo-tabs [repoId]="id()" />

        @if (loading()) {
          <div data-testid="repo-works-loading">{{ t('works.loading') }}</div>
        }

        @if (error(); as failure) {
          <div data-testid="repo-works-error" [attr.data-code]="failure.code">
            <p>{{ t('works.error') }}</p>
            <button type="button" data-testid="repo-works-retry" (click)="reload()">
              {{ t('works.retry') }}
            </button>
          </div>
        }

        @if (!loading() && error() === null && works().length === 0) {
          <p data-testid="repo-works-empty">{{ t('works.empty') }}</p>
        }

        @if (works().length > 0) {
          <ul class="cb-works">
            @for (work of works(); track work.id) {
              <li
                class="cb-work-row"
                data-testid="repo-work-row"
                [attr.data-work-id]="work.id"
                [attr.data-state]="work.state"
              >
                <span class="cb-mono">{{ work.backlogRef }}</span>
                <a
                  class="cb-work-title"
                  [attr.data-testid]="'repo-work-link-' + work.id"
                  [routerLink]="['/works', work.id]"
                >
                  {{ work.title }}
                </a>
                <span class="cb-work-state" [attr.data-state]="work.state">
                  {{ stateLabel(work.state) }}
                </span>
                <span class="cb-mono">{{ t('works.runs') }}: {{ work.attempts }}</span>
              </li>
            }
          </ul>
        }
      </div>
    </ion-content>
  `,
})
export class RepoWorksPage {
  readonly id = input.required<string>();
  readonly works = signal<readonly Work[]>([]);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);

  private readonly api = inject(WorksApi);
  private readonly destroy = inject(DestroyRef);
  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  constructor() {
    effect(() => {
      const candidate = this.id();
      untracked(() => this.load(candidate));
    });
  }

  reload(): void {
    this.load(this.id());
  }

  stateLabel(state: WorkState): string {
    return translate(this.i18n.locale(), `works.state.${state}`);
  }

  private load(repoId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .list(repoId)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (page) => this.works.set(page.data),
        error: (error: ApiError) => this.error.set(error),
      });
  }
}

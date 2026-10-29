import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { Work } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { I18nService } from '../../core/i18n/i18n.service';
import { RepoTabs } from '../repos/repo-tabs';
import { translate } from './i18n';
import type { WorkerRoom, WorkerState, WorkersBoard } from './workers.model';
import { projectWorkers } from './workers.model';
import { WorksApi } from './works.api';

/** The repository's factory: four role rooms, the road in on top and the belt out below. */
@Component({
  selector: 'app-repo-workers-page',
  standalone: true,
  imports: [RouterLink, IonContent, IonHeader, IonTitle, IonToolbar, RepoTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-workers {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 3);
      }
      .cb-workers-lane,
      .cb-worker-room {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 2);
      }
      .cb-workers-lane h2,
      .cb-worker-room h2 {
        margin: 0;
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-worker-face {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: baseline;
        border: 1px solid var(--cb-surface);
        border-radius: calc(var(--cb-radius) / 2);
        padding: calc(var(--cb-space) * 2);
        overflow-wrap: anywhere;
        color: var(--cb-text);
        text-decoration: none;
      }
      .cb-worker-face[data-state='asleep'] {
        color: var(--cb-muted);
      }
      .cb-worker-face[data-state='needs-you'] {
        border-color: var(--cb-warn);
      }
      .cb-worker-face-title {
        flex: 1 1 10rem;
        min-inline-size: 0;
      }
      .cb-worker-face-state {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .cb-worker-face[data-state='running'] .cb-worker-face-state {
        color: var(--cb-text);
      }
      .cb-worker-face[data-state='asleep'] .cb-worker-face-state {
        color: var(--cb-muted);
      }
      .cb-worker-face[data-state='needs-you'] .cb-worker-face-state,
      .cb-worker-badge {
        color: var(--cb-warn);
      }
      .cb-worker-badge {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .cb-worker-room-empty {
        margin: 0;
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('workers.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="cb-workers" data-testid="page-repo-workers" [attr.data-repo-id]="id()">
        <app-repo-tabs [repoId]="id()" />

        @if (loading()) {
          <div data-testid="repo-workers-loading">{{ t('workers.loading') }}</div>
        }

        @if (error(); as failure) {
          <div data-testid="repo-workers-error" [attr.data-code]="failure.code">
            <p>{{ t('workers.error') }}</p>
            <button type="button" data-testid="repo-workers-retry" (click)="reload()">
              {{ t('workers.retry') }}
            </button>
          </div>
        }

        @if (!loading() && error() === null && works().length === 0) {
          <p data-testid="repo-workers-empty">{{ t('workers.empty') }}</p>
        }

        <section
          class="cb-workers-lane"
          data-testid="workers-road-in"
          [attr.data-count]="board().roadIn.length"
        >
          <h2>{{ t('workers.roadIn') }}</h2>
          @for (card of board().roadIn; track card.workId) {
            <a
              class="cb-worker-face"
              data-testid="worker-face"
              [attr.data-work-id]="card.workId"
              [attr.data-room]="'road-in'"
              [attr.data-state]="card.state"
              [routerLink]="['/works', card.workId]"
              [attr.aria-label]="t('workers.open') + ' ' + card.ref"
            >
              <span data-testid="worker-chip" class="cb-mono">{{ card.ref }}</span>
              <span class="cb-worker-face-title" data-testid="worker-face-title">{{
                card.title
              }}</span>
              <span class="cb-worker-face-state" data-testid="worker-face-state">
                {{ stateLabel(card.state) }}
              </span>
              @if (card.state === 'needs-you') {
                <span class="cb-worker-badge" data-testid="worker-badge-needs-you">
                  {{ t('workers.badge.needsYou') }}
                </span>
              }
            </a>
          }
        </section>

        @for (room of board().rooms; track room.room) {
          <section class="cb-worker-room" data-testid="worker-room" [attr.data-room]="room.room">
            <h2>{{ roomLabel(room.room) }}</h2>
            @for (card of room.cards; track card.workId) {
              <a
                class="cb-worker-face"
                data-testid="worker-face"
                [attr.data-work-id]="card.workId"
                [attr.data-room]="room.room"
                [attr.data-state]="card.state"
                [routerLink]="['/works', card.workId]"
                [attr.aria-label]="t('workers.open') + ' ' + card.ref"
              >
                <span data-testid="worker-chip" class="cb-mono">{{ card.ref }}</span>
                <span class="cb-worker-face-title" data-testid="worker-face-title">
                  {{ card.title }}
                </span>
                <span class="cb-worker-face-state" data-testid="worker-face-state">
                  {{ stateLabel(card.state) }}
                </span>
                @if (card.state === 'needs-you') {
                  <span class="cb-worker-badge" data-testid="worker-badge-needs-you">
                    {{ t('workers.badge.needsYou') }}
                  </span>
                }
              </a>
            }
            @if (room.cards.length === 0) {
              <p
                class="cb-worker-room-empty"
                data-testid="worker-room-empty"
                [attr.data-room]="room.room"
              >
                {{ t('workers.room.empty') }}
              </p>
            }
          </section>
        }

        <section
          class="cb-workers-lane"
          data-testid="workers-belt-out"
          [attr.data-count]="board().beltOut.length"
        >
          <h2>{{ t('workers.beltOut') }}</h2>
          @for (card of board().beltOut; track card.workId) {
            <a
              class="cb-worker-face"
              data-testid="worker-face"
              [attr.data-work-id]="card.workId"
              [attr.data-room]="'belt-out'"
              [attr.data-state]="card.state"
              [routerLink]="['/works', card.workId]"
              [attr.aria-label]="t('workers.open') + ' ' + card.ref"
            >
              <span data-testid="worker-chip" class="cb-mono">{{ card.ref }}</span>
              <span class="cb-worker-face-title" data-testid="worker-face-title">{{
                card.title
              }}</span>
              <span class="cb-worker-face-state" data-testid="worker-face-state">
                {{ stateLabel(card.state) }}
              </span>
              @if (card.state === 'needs-you') {
                <span class="cb-worker-badge" data-testid="worker-badge-needs-you">
                  {{ t('workers.badge.needsYou') }}
                </span>
              }
            </a>
          }
        </section>
      </div>
    </ion-content>
  `,
})
export class RepoWorkersPage {
  readonly id = input.required<string>();
  readonly works = signal<readonly Work[]>([]);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly board = computed<WorkersBoard>(() => projectWorkers(this.works()));

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

  stateLabel(state: WorkerState): string {
    return translate(this.i18n.locale(), `workers.state.${state}`);
  }

  roomLabel(room: WorkerRoom): string {
    return translate(this.i18n.locale(), `workers.room.${room}`);
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

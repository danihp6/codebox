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
import type { Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { Work } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { I18nService } from '../../core/i18n/i18n.service';
import { RepoTabs } from '../repos/repo-tabs';
import { translate } from './i18n';
import type {
  WorkerCard,
  WorkerLane,
  WorkerRoom,
  WorkerState,
  WorkersBoard,
} from './workers.model';
import { projectWorkers } from './workers.model';
import { assignBlinkPhases } from './workers.motion';
import { WorksApi } from './works.api';

/** needs-you outranks running, running outranks queued; an idle floor is asleep. */
const BOARD_PRIORITY: readonly WorkerState[] = Object.freeze([
  'needs-you',
  'running',
  'queued',
  'asleep',
]);

function cardsOf(board: WorkersBoard): readonly WorkerCard[] {
  return [...board.roadIn, ...board.rooms.flatMap((room) => room.cards), ...board.beltOut];
}

/**
 * The repository's factory: the dashed plan card holds the 2 × 2 role grid, one face and one
 * task chip per subagent, the road in on the left and the belt out on the right. The two
 * chips are the only controls; a face is a target to its own log.
 */
@Component({
  selector: 'app-repo-workers-page',
  standalone: true,
  imports: [RouterLink, IonContent, IonHeader, IonTitle, IonToolbar, RepoTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closeSheet()' },
  styles: [
    `
      .cb-workers {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 3);
        overflow: hidden;
      }
      .cb-workers-sub {
        display: block;
        font-size: 0.625rem;
        font-weight: 400;
        line-height: 0.75rem;
        color: var(--cb-muted);
      }
      .cb-workers-plan {
        display: grid;
        grid-template-areas:
          'grid grid'
          'chips chips'
          'road belt';
        grid-template-columns: 1fr 1fr;
        grid-template-rows: minmax(172px, 1fr) auto auto;
        gap: calc(var(--cb-space) * 2);
        min-block-size: 300px;
        padding: calc(var(--cb-space) * 4);
        border: 1px dashed var(--cb-muted);
        border-radius: var(--cb-radius);
        overflow: hidden;
      }
      .cb-workers-room-grid {
        grid-area: grid;
        display: grid;
        grid-template-areas:
          'dev arc'
          'qa orq';
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        grid-template-rows: auto auto;
        gap: 1px;
        min-block-size: 172px;
        border: 1px solid var(--cb-muted);
        border-radius: 2px;
        background: var(--cb-muted);
        overflow: hidden;
      }
      .cb-worker-room {
        display: flex;
        flex-wrap: wrap;
        align-content: flex-start;
        gap: calc(var(--cb-space) * 2);
        min-inline-size: 0;
        min-block-size: 0;
        padding: calc(var(--cb-space) * 2);
        background: var(--cb-surface);
        overflow: hidden;
      }
      .cb-worker-room[data-room='DEV'] {
        grid-area: dev;
      }
      .cb-worker-room[data-room='ARC'] {
        grid-area: arc;
      }
      .cb-worker-room[data-room='QA'] {
        grid-area: qa;
      }
      .cb-worker-room[data-room='ORQ'] {
        grid-area: orq;
      }
      .cb-workers-room-label,
      .cb-workers-lane-label {
        inline-size: 100%;
        margin: 0;
        font-size: 0.4375rem;
        font-weight: 600;
        line-height: 0.5625rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-worker-face {
        position: relative;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: calc(var(--cb-space) * 1);
        inline-size: 64px;
        max-inline-size: 100%;
        color: var(--cb-text);
        text-decoration: none;
      }
      .cb-workers-ring {
        display: flex;
        align-items: center;
        justify-content: center;
        inline-size: 44px;
        block-size: 44px;
        border: 2px solid var(--cb-muted);
        border-radius: 50%;
        background: var(--cb-bg);
        font-family: var(--cb-font-mono);
        font-size: 0.5625rem;
        font-weight: 600;
        color: var(--cb-muted);
      }
      .cb-workers-ring[data-state='running'] {
        border-color: var(--cb-accent);
        color: var(--cb-accent);
      }
      .cb-workers-ring[data-state='needs-you'] {
        border-color: var(--cb-warn);
        color: var(--cb-warn);
      }
      .cb-workers-ring[data-state='asleep'] {
        opacity: 0.45;
      }
      .cb-worker-chip {
        max-inline-size: 100%;
        padding-block: 1px;
        padding-inline: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-muted);
        border-radius: 9px;
        font-family: var(--cb-font-mono);
        font-size: 0.5rem;
        line-height: 0.75rem;
        color: var(--cb-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cb-worker-badge {
        position: absolute;
        inset-block-start: 0;
        inset-inline-start: 50%;
        transform: translateX(-50%);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        block-size: 20px;
        max-inline-size: 64px;
        padding-inline: calc(var(--cb-space) * 1.5);
        border-radius: calc(var(--cb-radius) * 0.5);
        background: var(--cb-warn);
        color: var(--cb-bg);
        font-size: 0.5rem;
        font-weight: 600;
        line-height: 1;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }
      .cb-worker-room-empty {
        margin: 0;
        color: var(--cb-muted);
        font-size: 0.5625rem;
      }
      .cb-worker-face-title,
      .cb-worker-face-state {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin: -1px;
        padding: 0;
        border: 0;
        overflow: hidden;
        white-space: nowrap;
        clip-path: inset(50%);
      }
      .cb-workers-lane {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: calc(var(--cb-space) * 2);
        min-block-size: 56px;
        min-inline-size: 0;
        padding: calc(var(--cb-space) * 2);
        border-block-start: 1px dashed var(--cb-muted);
        overflow: hidden;
      }
      .cb-workers-road {
        grid-area: road;
      }
      .cb-workers-belt {
        grid-area: belt;
      }
      .cb-workers-lane-count {
        font-size: 0.5625rem;
        font-weight: 600;
        line-height: 0.75rem;
        color: var(--cb-muted);
      }
      .cb-workers-belt .cb-workers-lane-count {
        color: var(--cb-accent);
      }
      .cb-workers-token {
        grid-area: 1 / 1 / 3 / 3;
        place-self: center;
        position: relative;
        z-index: 1;
      }
      .cb-workers-chips {
        grid-area: chips;
        display: flex;
        justify-content: space-between;
        gap: calc(var(--cb-space) * 2);
        padding-inline: calc(var(--cb-space) * 6) calc(var(--cb-space) * 3);
      }
      .cb-workers-chip-button {
        display: inline-flex;
        align-items: center;
        gap: calc(var(--cb-space) * 1);
        min-block-size: 20px;
        padding-block: 1px;
        padding-inline: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-muted);
        border-radius: 9px;
        background: var(--cb-surface);
        color: var(--cb-text);
        font-family: var(--cb-font-mono);
        font-size: 0.5625rem;
        font-weight: 600;
      }
      .cb-workers-chip-button[data-open='true'] {
        border-color: var(--cb-accent);
        color: var(--cb-accent);
      }
      .cb-workers-sheet {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 1);
        padding: calc(var(--cb-space) * 4);
        border: 1px solid var(--cb-muted);
        border-radius: 16px;
        background: var(--cb-surface);
        overflow: hidden;
      }
      .cb-workers-sheet-head {
        display: flex;
        align-items: center;
        gap: calc(var(--cb-space) * 2);
        min-inline-size: 0;
      }
      .cb-workers-sheet-head h2 {
        flex: 1 1 auto;
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        line-height: 1.25rem;
        color: var(--cb-text);
      }
      .cb-workers-sheet-close {
        flex: 0 0 auto;
        min-inline-size: 44px;
        min-block-size: 44px;
        border: 0;
        background: transparent;
        color: var(--cb-muted);
        font-size: 1rem;
      }
      .cb-workers-sheet-row {
        display: flex;
        align-items: center;
        gap: calc(var(--cb-space) * 2);
        min-inline-size: 0;
        padding-block: calc(var(--cb-space) * 2);
        border-block-end: 1px solid var(--cb-bg);
      }
      .cb-workers-sheet-face {
        display: flex;
        align-items: center;
        justify-content: center;
        inline-size: 28px;
        block-size: 28px;
        border: 2px solid var(--cb-accent);
        border-radius: 50%;
        font-family: var(--cb-font-mono);
        font-size: 0.5rem;
        color: var(--cb-accent);
        text-decoration: none;
      }
      .cb-workers-sheet-title {
        flex: 1 1 auto;
        min-inline-size: 0;
        font-size: 0.75rem;
        line-height: 0.875rem;
        color: var(--cb-text);
        overflow-wrap: anywhere;
      }
      .cb-workers-sheet-state {
        flex: 0 0 auto;
        font-size: 0.5625rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-workers-sheet-empty {
        margin: 0;
        font-size: 0.75rem;
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>
          {{ t('workers.title') }}
          <span class="cb-workers-sub">{{ subtitle() }}</span>
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div
        class="cb-workers"
        data-testid="page-repo-workers"
        [attr.data-repo-id]="id()"
        [attr.data-board-state]="boardState()"
      >
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
          <p data-testid="repo-workers-empty" [attr.data-board-state]="boardState()">
            {{ t('workers.empty') }}
          </p>
        }

        <div class="cb-workers-plan" data-testid="workers-plan">
          <section
            class="cb-workers-lane cb-workers-road"
            data-testid="workers-road-in"
            [attr.data-count]="board().roadIn.length"
            [attr.aria-label]="t('workers.roadIn')"
          >
            <h2 class="cb-workers-lane-label">{{ t('workers.roadIn') }}</h2>
            <span class="cb-workers-lane-count">{{ board().roadIn.length }}</span>
            @if (works().length > 0) {
              <span class="cb-workers-truck" data-testid="workers-truck" aria-hidden="true"></span>
            }
            @for (card of board().roadIn; track card.workId) {
              <a
                class="cb-worker-face"
                data-testid="worker-face"
                [attr.data-work-id]="card.workId"
                [attr.data-room]="'road-in'"
                [attr.data-state]="card.state"
                [attr.data-blink-phase]="blinkPhaseOf(card.workId)"
                [routerLink]="['/works', card.workId]"
                [attr.aria-label]="t('workers.open') + ' ' + card.ref"
              >
                <span
                  class="cb-workers-ring"
                  data-testid="workers-face-ring"
                  [attr.data-state]="card.state"
                  aria-hidden="true"
                  >IN</span
                >
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
                <span class="cb-worker-chip" data-testid="worker-chip">{{ card.ref }}</span>
              </a>
            }
          </section>

          <div class="cb-workers-room-grid" data-testid="workers-room-grid">
            @for (room of board().rooms; track room.room) {
              <section
                class="cb-worker-room"
                data-testid="worker-room"
                [attr.data-room]="room.room"
                [attr.aria-label]="roomLabel(room.room)"
              >
                <h2 class="cb-workers-room-label">{{ room.room }}</h2>
                @for (card of room.cards; track card.workId) {
                  <a
                    class="cb-worker-face"
                    data-testid="worker-face"
                    [attr.data-work-id]="card.workId"
                    [attr.data-room]="room.room"
                    [attr.data-state]="card.state"
                    [attr.data-blink-phase]="blinkPhaseOf(card.workId)"
                    [routerLink]="['/works', card.workId]"
                    [attr.aria-label]="t('workers.open') + ' ' + card.ref"
                  >
                    <span
                      class="cb-workers-ring"
                      data-testid="workers-face-ring"
                      [attr.data-state]="card.state"
                      aria-hidden="true"
                      >{{ room.room }}</span
                    >
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
                    <span class="cb-worker-chip" data-testid="worker-chip">{{ card.ref }}</span>
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
              @if (works().length > 0 && room.room === 'DEV') {
                <span
                  class="cb-workers-token"
                  data-testid="workers-token"
                  aria-hidden="true"
                ></span>
              }
            }
          </div>

          <section
            class="cb-workers-lane cb-workers-belt"
            data-testid="workers-belt-out"
            [attr.data-count]="board().beltOut.length"
            [attr.aria-label]="t('workers.beltOut')"
          >
            <h2 class="cb-workers-lane-label">{{ t('workers.beltOut') }}</h2>
            <span class="cb-workers-lane-count">{{ board().beltOut.length }}</span>
            @if (works().length > 0) {
              <span
                class="cb-workers-package"
                data-testid="workers-package"
                aria-hidden="true"
              ></span>
            }
            @for (card of board().beltOut; track card.workId) {
              <a
                class="cb-worker-face"
                data-testid="worker-face"
                [attr.data-work-id]="card.workId"
                [attr.data-room]="'belt-out'"
                [attr.data-state]="card.state"
                [attr.data-blink-phase]="blinkPhaseOf(card.workId)"
                [routerLink]="['/works', card.workId]"
                [attr.aria-label]="t('workers.open') + ' ' + card.ref"
              >
                <span
                  class="cb-workers-ring"
                  data-testid="workers-face-ring"
                  [attr.data-state]="card.state"
                  aria-hidden="true"
                  >OUT</span
                >
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
                <span class="cb-worker-chip" data-testid="worker-chip">{{ card.ref }}</span>
              </a>
            }
          </section>

          <div class="cb-workers-chips">
            <button
              type="button"
              class="cb-workers-chip-button"
              data-testid="workers-chip-waiting"
              [attr.data-count]="board().roadIn.length"
              [attr.data-open]="openSheet() === 'road-in'"
              [attr.aria-expanded]="openSheet() === 'road-in'"
              [attr.aria-label]="t('workers.chip.waiting') + ' · ' + board().roadIn.length"
              (click)="openChip('road-in')"
            >
              <span aria-hidden="true">▤</span>
              <span>{{ board().roadIn.length }}</span>
            </button>
            <button
              type="button"
              class="cb-workers-chip-button"
              data-testid="workers-chip-delivered"
              [attr.data-count]="board().beltOut.length"
              [attr.data-open]="openSheet() === 'belt-out'"
              [attr.aria-expanded]="openSheet() === 'belt-out'"
              [attr.aria-label]="t('workers.chip.delivered') + ' · ' + board().beltOut.length"
              (click)="openChip('belt-out')"
            >
              <span aria-hidden="true">🔔</span>
              <span>{{ board().beltOut.length }}</span>
            </button>
          </div>
        </div>

        @if (openSheet(); as lane) {
          @let heading = lane === 'road-in' ? 'workers.sheet.waiting' : 'workers.sheet.delivered';
          @let laneCards = lane === 'road-in' ? board().roadIn : board().beltOut;
          <section
            class="cb-workers-sheet"
            data-testid="workers-sheet"
            [attr.data-lane]="lane"
            [attr.aria-label]="t(heading)"
          >
            <header class="cb-workers-sheet-head">
              <h2>{{ t(heading) }}</h2>
              <span class="cb-workers-lane-count">{{ laneCards.length }}</span>
              <button
                type="button"
                class="cb-workers-sheet-close"
                data-testid="workers-sheet-close"
                [attr.aria-label]="t('workers.sheet.close')"
                (click)="closeSheet()"
              >
                ✕
              </button>
            </header>
            @for (card of laneCards; track card.workId) {
              <div
                class="cb-workers-sheet-row"
                data-testid="workers-sheet-row"
                [attr.data-work-id]="card.workId"
              >
                <a
                  class="cb-workers-sheet-face"
                  [routerLink]="['/works', card.workId]"
                  [attr.aria-label]="t('workers.open') + ' ' + card.ref"
                  >{{ lane === 'road-in' ? 'IN' : 'OUT' }}</a
                >
                <span class="cb-mono">{{ card.ref }}</span>
                <span class="cb-workers-sheet-title">{{ card.title }}</span>
                <span class="cb-workers-sheet-state">{{ stateLabel(card.state) }}</span>
              </div>
            }
            @if (laneCards.length === 0) {
              <p class="cb-workers-sheet-empty">{{ t('workers.sheet.empty') }}</p>
            }
          </section>
        }
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
  readonly blinkPhases = computed<ReadonlyMap<string, number>>(() =>
    assignBlinkPhases([
      ...this.board().roadIn,
      ...this.board().rooms.flatMap((room) => room.cards),
      ...this.board().beltOut,
    ]),
  );
  readonly boardState = computed<WorkerState>(() => boardStateOf(this.board()));
  readonly subtitle = computed<string>(() => {
    const busy = cardsOf(this.board()).filter((card) => card.state === 'running').length;
    const usd = this.works().reduce((total, work) => total + work.usage.usd, 0);
    return `${busy} ${translate(this.i18n.locale(), 'workers.sub')} · $${usd.toFixed(2)}`;
  });

  private readonly sheet = signal<WorkerLane | null>(null);
  readonly openSheet: Signal<WorkerLane | null> = this.sheet.asReadonly();

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

  blinkPhaseOf(workId: string): number {
    return this.blinkPhases().get(workId) ?? 0;
  }

  stateLabel(state: WorkerState): string {
    return translate(this.i18n.locale(), `workers.state.${state}`);
  }

  roomLabel(room: WorkerRoom): string {
    return translate(this.i18n.locale(), `workers.room.${room}`);
  }

  /** The two chips are the only controls on the drawing; each opens its lane's sheet. */
  openChip(lane: 'road-in' | 'belt-out'): void {
    this.sheet.set(lane);
  }

  closeSheet(): void {
    this.sheet.set(null);
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

function boardStateOf(board: WorkersBoard): WorkerState {
  const cards = cardsOf(board);
  for (const state of BOARD_PRIORITY) {
    if (cards.some((card) => card.state === state)) return state;
  }
  return 'asleep';
}

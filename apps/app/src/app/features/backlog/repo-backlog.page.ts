import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import type { BacklogItem, Session, WorkState } from '@codebox/contracts';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { RepoStore } from '../repos/repo.store';
import { RepoTabs } from '../repos/repo-tabs';
import { BacklogStore } from './backlog.store';
import { translate } from './i18n';
import { NewSessionSheet } from './new-session.sheet';

type BacklogRowState = WorkState | 'none';

/** The plan is the checkbox; the state is the chip. One label per contract value, no fallback. */
const STATE_KEYS: Readonly<Record<BacklogRowState, string>> = Object.freeze({
  queued: 'backlog.state.queued',
  running: 'backlog.state.running',
  review: 'backlog.state.review',
  merged: 'backlog.state.merged',
  failed: 'backlog.state.failed',
  needs_decision: 'backlog.state.needs_decision',
  abandoned: 'backlog.state.abandoned',
  none: 'backlog.state.none',
});

@Component({
  selector: 'app-repo-backlog-page',
  standalone: true,
  imports: [RouterLink, IonContent, IonHeader, IonTitle, IonToolbar, RepoTabs, NewSessionSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [RepoStore, BacklogStore],
  styles: [
    `
      .cb-backlog-head {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: center;
      }
      .cb-backlog-head h2 {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .cb-backlog-section {
        margin-block-start: calc(var(--cb-space) * 4);
      }
      .cb-backlog-section h3 {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
        overflow-wrap: anywhere;
      }
      .cb-backlog-list {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-backlog-row {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
        align-items: baseline;
        border-block-end: 1px solid var(--cb-surface);
        padding-block: calc(var(--cb-space) * 2);
        overflow-wrap: anywhere;
      }
      .cb-backlog-ref {
        font-family: var(--cb-font-mono);
        flex: 0 0 auto;
      }
      .cb-backlog-title {
        flex: 1 1 12rem;
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }
      .cb-backlog-state,
      .cb-backlog-runs {
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cb-muted);
      }
      .cb-backlog-state[data-state='failed'] {
        color: var(--cb-danger);
      }
      .cb-backlog-state[data-state='needs_decision'] {
        color: var(--cb-warn);
      }
      .cb-backlog-state[data-state='merged'] {
        color: var(--cb-accent);
      }
      .cb-live-work {
        border: 1px solid var(--cb-warn);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 2);
        margin-block-start: calc(var(--cb-space) * 2);
      }
      .cb-muted {
        color: var(--cb-muted);
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ repo.repo()?.slug ?? t('common.loading') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div data-testid="page-repo-backlog" [attr.data-repo-id]="id()">
        <header class="cb-backlog-head" data-testid="repo-header">
          <h2 data-testid="repo-name">{{ repo.repo()?.slug ?? id() }}</h2>
          @if (repo.repo(); as detail) {
            <span class="cb-muted" data-testid="repo-gate" [attr.data-gate]="detail.gate">
              {{ t('backlog.gate') }}: <span class="cb-mono">{{ detail.gate }}</span>
            </span>
          }
          <button type="button" data-testid="repo-chat-button" (click)="openSheet()">
            {{ t('backlog.chat') }}
          </button>
        </header>

        <app-repo-tabs [repoId]="id()" />

        @if (sheetOpen()) {
          <app-new-session
            [repoId]="id()"
            (created)="onSessionCreated($event)"
            (cancelled)="closeSheet()"
          />
        }

        @if (backlog.loading()) {
          <div data-testid="backlog-loading">{{ t('common.loading') }}</div>
        }

        @if (backlog.error(); as failure) {
          <div data-testid="backlog-error" [attr.data-code]="failure.code">
            <p>{{ t('backlog.error') }}</p>
            <button type="button" data-testid="backlog-retry" (click)="backlog.reload()">
              {{ t('backlog.retry') }}
            </button>
          </div>
        }

        @if (backlog.liveWork(); as live) {
          <div class="cb-live-work" data-testid="backlog-live-work" [attr.data-ref]="live.ref">
            <p>{{ t('backlog.liveWork') }}</p>
            @if (live.workId !== null) {
              <a [routerLink]="['/works', live.workId]">{{ t('backlog.liveWork.open') }}</a>
            }
          </div>
        }

        @if (backlog.backlog(); as parsed) {
          @if (parsed.sections.length === 0) {
            <p data-testid="backlog-empty">{{ t('backlog.empty') }}</p>
          }
          @for (section of parsed.sections; track section.title) {
            <section class="cb-backlog-section">
              <h3>{{ section.title }}</h3>
              <ul class="cb-backlog-list">
                @for (item of section.items; track item.ref) {
                  <li
                    class="cb-backlog-row"
                    data-testid="backlog-row"
                    [attr.data-ref]="item.ref"
                    [attr.data-checked]="item.checked"
                    [attr.data-state]="stateOf(item)"
                  >
                    <span class="cb-backlog-ref" data-testid="backlog-row-ref">{{ item.ref }}</span>
                    <span class="cb-backlog-title" data-testid="backlog-row-title">
                      {{ item.title }}
                    </span>
                    <span
                      class="cb-backlog-state"
                      data-testid="backlog-row-state"
                      [attr.data-state]="stateOf(item)"
                    >
                      {{ stateLabel(item) }}
                    </span>
                    <span class="cb-backlog-runs" data-testid="backlog-row-runs">
                      {{ item.work?.runs ?? 0 }} {{ t('backlog.runs') }}
                    </span>
                    @if (canRun(item)) {
                      <button
                        type="button"
                        [attr.data-testid]="'backlog-run-' + item.ref"
                        [disabled]="backlog.busyRef() !== null"
                        (click)="run(item)"
                      >
                        {{
                          backlog.busyRef() === item.ref
                            ? t('backlog.run.busy')
                            : t('backlog.run')
                        }}
                      </button>
                    }
                  </li>
                }
              </ul>
            </section>
          }
        }
      </div>
    </ion-content>
  `,
})
export class RepoBacklogPage {
  readonly id = input.required<string>();
  readonly repo = inject(RepoStore);
  readonly backlog = inject(BacklogStore);

  readonly sheetOpen = signal(false);

  private readonly sse = inject(SseService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  constructor() {
    effect(() => {
      const candidate = this.id();
      untracked(() => {
        this.repo.load(candidate);
        this.backlog.load(candidate);
      });
    });
    effect(() => {
      const event = this.sse.event();
      if (event === null) return;
      untracked(() => {
        if (event.event !== 'backlog.changed') return;
        if (event.data.repoId !== this.id()) return;
        this.backlog.reload();
      });
    });
  }

  stateOf(item: BacklogItem): BacklogRowState {
    return item.work?.state ?? 'none';
  }

  stateLabel(item: BacklogItem): string {
    return translate(this.i18n.locale(), STATE_KEYS[this.stateOf(item)]);
  }

  canRun(item: BacklogItem): boolean {
    if (item.checked) return false;
    const work = item.work;
    if (work === null) return true;
    return work.state === 'failed' || work.state === 'merged';
  }

  run(item: BacklogItem): void {
    if (!this.canRun(item)) return;
    this.backlog.run(this.id(), item.ref);
  }

  openSheet(): void {
    this.sheetOpen.set(true);
  }

  closeSheet(): void {
    this.sheetOpen.set(false);
  }

  onSessionCreated(session: Session): void {
    this.sheetOpen.set(false);
    void this.router.navigate(['/sessions', session.id]);
  }
}

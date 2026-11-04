import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular';
import type { BacklogItem, BacklogRef, Session, WorkState } from '@codebox/contracts';
import { SseService } from '../../core/events/sse.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { RepoStore } from '../repos/repo.store';
import { RepoTabs } from '../repos/repo-tabs';
import { BacklogStore } from './backlog.store';
import { railEdges, unmetNeeds } from './dependency-rail';
import type { RailEdge } from './dependency-rail';
import { translate } from './i18n';
import { NewSessionSheet } from './new-session.sheet';

type BacklogRowState = WorkState | 'none';

export type RailNodeKind = 'done' | 'live' | 'blocked' | 'ready';

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

const LIVE_STATES: ReadonlySet<BacklogRowState> = new Set<BacklogRowState>([
  'running',
  'review',
  'needs_decision',
]);

@Component({
  selector: 'app-repo-backlog-page',
  standalone: true,
  imports: [RouterLink, IonContent, RepoTabs, NewSessionSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [RepoStore, BacklogStore],
  styles: [
    `
      .cb-bl {
        display: block;
        min-inline-size: 0;
        padding-block-end: 24px;
      }
      .cb-bl-header {
        display: flex;
        gap: 8px;
        align-items: center;
        min-block-size: 32px;
        padding: 20px 16px 0 18px;
      }
      .cb-bl-back {
        flex: 0 0 auto;
        margin-inline-start: -6px;
        padding-inline: 6px;
        color: var(--cb-accent);
        font-size: 22px;
        line-height: 27px;
        text-decoration: none;
      }
      .cb-bl-title {
        flex: 1 1 auto;
        min-inline-size: 0;
        margin: 0;
        color: var(--cb-text);
        font-size: 16px;
        line-height: 19px;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .cb-bl-chat {
        flex: 0 0 auto;
        min-block-size: 32px;
        padding-inline: 10px;
        border: 1px solid var(--cb-surface);
        border-radius: 16px;
        background: var(--cb-surface);
        color: var(--cb-text);
        font: inherit;
        font-size: 11px;
        cursor: pointer;
      }
      .cb-bl-summary {
        margin: 32px 0 0;
        padding-inline: 16px;
        color: var(--cb-muted);
        font-size: 10px;
        line-height: 12px;
      }
      .cb-bl-state {
        margin: 24px 16px 0;
        padding: 12px;
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        background: var(--cb-surface);
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .cb-bl-state p {
        margin: 0;
      }
      .cb-bl-live {
        border-color: var(--cb-warn);
      }
      .cb-bl-sr-only {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }
      .cb-bl-list {
        position: relative;
        margin-block-start: 24px;
      }
      .cb-bl-gutter {
        position: absolute;
        inset-block: 0;
        inset-inline-start: 0;
        inline-size: 48px;
        pointer-events: none;
      }
      .cb-bl-rail-line {
        position: absolute;
        inset-block: 0;
        inset-inline-start: 30px;
        inline-size: 1px;
        background: var(--cb-surface);
      }
      .cb-bl-gutter h3 {
        margin: 0;
        font-size: 10px;
      }
      .cb-bl-list-rows {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cb-bl-row {
        position: relative;
        display: grid;
        grid-template-columns: 48px minmax(0, 1fr) auto;
        column-gap: 8px;
        align-items: center;
        padding-block: 8px;
        padding-inline-end: 16px;
      }
      .cb-bl-row:not(:last-child)::after {
        content: '';
        position: absolute;
        inset-block-end: 0;
        inset-inline: 16px;
        block-size: 1px;
        background: var(--cb-surface);
      }
      .cb-bl-node {
        grid-column: 1;
        justify-self: start;
        align-self: center;
        inline-size: 10px;
        block-size: 10px;
        margin-inline-start: 25px;
        border: 1px solid var(--cb-muted);
        border-radius: 50%;
      }
      .cb-bl-node[data-kind='live'],
      .cb-bl-node[data-kind='ready'] {
        border-color: var(--cb-accent);
      }
      .cb-bl-node[data-kind='blocked'] {
        border-color: var(--cb-warn);
      }
      .cb-bl-node[data-kind='done'] {
        border-color: var(--cb-accent);
        background: var(--cb-accent);
      }
      .cb-bl-external {
        position: absolute;
        inset-block-start: 10px;
        inset-inline-start: 4px;
        inline-size: 9px;
        block-size: 8px;
        background: var(--cb-muted);
      }
      .cb-bl-row-select {
        grid-column: 2;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-inline-size: 0;
        margin: 0;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .cb-bl-row-select[aria-pressed='true'] {
        outline: 2px solid var(--cb-accent);
        outline-offset: 2px;
      }
      .cb-bl-line {
        display: flex;
        gap: 4px;
        align-items: baseline;
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }
      .cb-bl-line-1 {
        color: var(--cb-text);
        font-size: 13px;
        line-height: 16px;
        font-weight: 500;
      }
      .cb-bl-row[data-state='queued'] .cb-bl-line-1,
      .cb-bl-row[data-state='abandoned'] .cb-bl-line-1 {
        color: var(--cb-muted);
      }
      .cb-bl-task {
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }
      .cb-bl-line-2,
      .cb-bl-line-3 {
        color: var(--cb-muted);
        font-size: 10px;
        line-height: 12px;
      }
      .cb-bl-line-3 {
        align-items: center;
      }
      .cb-bl-chip {
        display: inline-flex;
        align-items: center;
        block-size: 12px;
        padding-inline: 6px;
        border: 1px solid var(--cb-surface);
        border-radius: 6px;
        color: var(--cb-muted);
        font-size: 9px;
        line-height: 10px;
        font-weight: 500;
        white-space: nowrap;
      }
      .cb-bl-chip[data-state='running'],
      .cb-bl-chip[data-state='review'],
      .cb-bl-chip[data-state='needs_decision'] {
        color: var(--cb-warn);
      }
      .cb-bl-chip[data-state='merged'] {
        color: var(--cb-accent);
      }
      .cb-bl-chip[data-state='failed'] {
        color: var(--cb-danger);
      }
      .cb-bl-unread {
        inline-size: 6px;
        block-size: 6px;
        border-radius: 50%;
        background: var(--cb-accent);
      }
      .cb-bl-run {
        grid-column: 3;
        min-block-size: 32px;
        padding-inline: 8px;
        font: inherit;
        font-size: 10px;
        cursor: pointer;
      }
      .cb-bl-detail {
        margin: 24px 16px 0;
        padding: 12px;
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
      }
      .cb-bl-detail h3 {
        margin: 0 0 8px;
        color: var(--cb-muted);
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .cb-bl-detail p {
        margin: 0 0 4px;
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .cb-bl-muted {
        color: var(--cb-muted);
      }
      .cb-bl-mono {
        font-family: var(--cb-font-mono);
      }
    `,
  ],
  template: `
    <ion-content>
      <div class="cb-bl" data-testid="page-repo-backlog" [attr.data-repo-id]="id()">
        <header class="cb-bl-header" data-testid="repo-header">
          <a
            class="cb-bl-back"
            data-testid="bl-back"
            routerLink="/repos"
            [attr.aria-label]="t('backlog.back')"
            >‹</a
          >
          <h1 class="cb-bl-title" data-testid="repo-name">{{ repo.repo()?.slug ?? id() }}</h1>
          @if (repo.repo(); as detail) {
            <span class="cb-bl-sr-only" data-testid="repo-gate" [attr.data-gate]="detail.gate">
              {{ t('backlog.gate') }}: {{ detail.gate }}
            </span>
          }
          <button
            type="button"
            class="cb-bl-chat"
            data-testid="repo-chat-button"
            (click)="openSheet()"
          >
            {{ t('backlog.chat') }}
          </button>
        </header>

        <p class="cb-bl-summary" data-testid="backlog-summary">{{ summary() }}</p>

        <app-repo-tabs [repoId]="id()" />

        @if (sheetOpen()) {
          <app-new-session
            [repoId]="id()"
            (created)="onSessionCreated($event)"
            (cancelled)="closeSheet()"
          />
        }

        @if (backlog.loading()) {
          <div class="cb-bl-state cb-bl-muted" data-testid="backlog-loading">
            {{ t('common.loading') }}
          </div>
        }

        @if (backlog.error(); as failure) {
          <div class="cb-bl-state" data-testid="backlog-error" [attr.data-code]="failure.code">
            <p>{{ t('backlog.error') }}</p>
            <button type="button" data-testid="backlog-retry" (click)="backlog.reload()">
              {{ t('backlog.retry') }}
            </button>
          </div>
        }

        @if (backlog.liveWork(); as live) {
          <div
            class="cb-bl-state cb-bl-live"
            data-testid="backlog-live-work"
            [attr.data-ref]="live.ref"
          >
            <p>{{ t('backlog.liveWork') }}</p>
            @if (live.workId !== null) {
              <a [routerLink]="['/works', live.workId]">{{ t('backlog.liveWork.open') }}</a>
            }
          </div>
        }

        <section class="cb-bl-list">
          <div class="cb-bl-gutter" data-testid="backlog-rail-gutter">
            <span class="cb-bl-rail-line" aria-hidden="true"></span>
            <section
              class="cb-bl-sr-only"
              data-testid="backlog-rail"
              [attr.data-edges]="rail().length"
            >
              <h3>{{ t('backlog.rail') }}</h3>
              @if (rail().length === 0) {
                <p data-testid="backlog-rail-empty">{{ t('backlog.rail.empty') }}</p>
              }
              <ul>
                @for (edge of rail(); track $index) {
                  <li
                    data-testid="backlog-rail-edge"
                    [attr.data-from]="edge.from"
                    [attr.data-to]="edge.to"
                    [attr.data-kind]="edge.kind"
                  >
                    {{ edge.from }} → {{ edge.to }} · {{ t('backlog.rail.' + edge.kind) }}
                  </li>
                }
              </ul>
            </section>
          </div>

          @if (backlog.backlog(); as parsed) {
            @if (parsed.sections.length === 0) {
              <p class="cb-bl-state cb-bl-muted" data-testid="backlog-empty">
                {{ t('backlog.empty') }}
              </p>
            }
            @for (section of parsed.sections; track section.title) {
              <section [attr.aria-label]="section.title">
                <ul class="cb-bl-list-rows">
                  @for (item of section.items; track item.ref) {
                    <li
                      class="cb-bl-row"
                      data-testid="backlog-row"
                      [attr.data-ref]="item.ref"
                      [attr.data-checked]="item.checked"
                      [attr.data-state]="stateOf(item)"
                      [attr.data-needs]="item.needs.join(' ')"
                      [attr.data-unmet-needs]="unmetOf(item).join(' ')"
                    >
                      <span
                        class="cb-bl-node"
                        data-testid="backlog-rail-node"
                        [attr.data-kind]="nodeKind(item)"
                        role="img"
                        [attr.aria-label]="t('backlog.rail.' + nodeKind(item))"
                      ></span>
                      @if (hasExternal(item)) {
                        <span class="cb-bl-external" aria-hidden="true"></span>
                      }
                      <button
                        type="button"
                        class="cb-bl-row-select"
                        data-testid="backlog-row-select"
                        [attr.aria-pressed]="selectedRef() === item.ref"
                        (click)="select(item)"
                      >
                        <span class="cb-bl-line cb-bl-line-1">
                          <span class="cb-bl-mono" data-testid="backlog-row-ref">{{
                            item.ref
                          }}</span>
                          <span aria-hidden="true">·</span>
                          <span class="cb-bl-task" data-testid="backlog-row-title">
                            {{ item.title }}
                          </span>
                        </span>
                        <span class="cb-bl-line cb-bl-line-2" data-testid="backlog-row-section">
                          {{ section.title }}
                        </span>
                        <span class="cb-bl-line cb-bl-line-3" data-testid="backlog-row-flow">
                          <span
                            class="cb-bl-chip"
                            data-testid="backlog-row-state"
                            [attr.data-state]="stateOf(item)"
                          >
                            {{ stateLabel(item) }}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span data-testid="backlog-row-runs">
                            {{ item.work?.runs ?? 0 }} {{ t('backlog.runs') }}
                          </span>
                          @if (stateOf(item) === 'merged') {
                            <span class="cb-bl-unread" aria-hidden="true"></span>
                          }
                        </span>
                      </button>
                      @if (item.needs.length > 0) {
                        <span class="cb-bl-sr-only" data-testid="backlog-row-needs">
                          {{ t('backlog.needs') }}: {{ item.needs.join(', ') }}
                        </span>
                      }
                      @if (unmetOf(item).length > 0) {
                        <span class="cb-bl-sr-only" data-testid="backlog-row-unmet-needs">
                          {{ t('backlog.unmet') }}: {{ unmetOf(item).join(', ') }}
                        </span>
                      }
                      @if (canRun(item)) {
                        <button
                          type="button"
                          class="cb-bl-run"
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
        </section>

        <section class="cb-bl-detail" data-testid="backlog-detail">
          <h3>{{ t('backlog.detail') }}</h3>
          @if (selected(); as item) {
            <p class="cb-bl-mono" data-testid="backlog-detail-ref">{{ item.ref }}</p>
            <p data-testid="backlog-detail-title">{{ item.title }}</p>
            <p data-testid="backlog-detail-needs">
              {{ item.needs.length === 0 ? t('backlog.detail.none') : item.needs.join(', ') }}
            </p>
            <p data-testid="backlog-detail-unmet">
              {{ unmetOf(item).length === 0 ? t('backlog.detail.none') : unmetOf(item).join(', ') }}
            </p>
            @if (item.work; as work) {
              <a data-testid="backlog-detail-work" [routerLink]="['/works', work.id]">
                {{ t('backlog.detail.open') }}
              </a>
            }
          } @else {
            <p class="cb-bl-muted" data-testid="backlog-detail-empty">
              {{ t('backlog.detail.empty') }}
            </p>
          }
        </section>
      </div>
    </ion-content>
  `,
})
export class RepoBacklogPage {
  readonly id = input.required<string>();
  readonly repo = inject(RepoStore);
  readonly backlog = inject(BacklogStore);

  readonly sheetOpen = signal(false);

  readonly rows = computed<readonly BacklogItem[]>(
    () => this.backlog.backlog()?.sections.flatMap((section) => section.items) ?? [],
  );
  readonly selectedRef = signal<BacklogRef | null>(null);
  readonly selected = computed<BacklogItem | null>(() => {
    const ref = this.selectedRef();
    if (ref === null) return null;
    return this.rows().find((item) => item.ref === ref) ?? null;
  });
  readonly rail = computed<readonly RailEdge[]>(() => railEdges(this.rows()));

  private readonly sse = inject(SseService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  /** The first unchecked row in file order and how many rows wait on a dependency. */
  readonly summary = computed<string>(() => {
    const items = this.rows();
    const next = items.find((item) => !item.checked);
    if (next === undefined) return this.t('backlog.summary.done');
    const waiting = items.filter((item) => unmetNeeds(item, items).length > 0).length;
    const first = this.t('backlog.summary.next').replace('{ref}', next.ref);
    const rest = this.t('backlog.summary.waiting').replace('{n}', String(waiting));
    return `${first} · ${rest}`;
  });

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

  nodeKind(item: BacklogItem): RailNodeKind {
    const state = this.stateOf(item);
    if (item.checked || state === 'merged') return 'done';
    if (this.unmetOf(item).length > 0) return 'blocked';
    if (LIVE_STATES.has(state)) return 'live';
    return 'ready';
  }

  hasExternal(item: BacklogItem): boolean {
    return this.rail().some((edge) => edge.from === item.ref && edge.kind === 'external');
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

  select(item: BacklogItem): void {
    this.selectedRef.set(item.ref);
  }

  unmetOf(item: BacklogItem): readonly BacklogRef[] {
    return unmetNeeds(item, this.rows());
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

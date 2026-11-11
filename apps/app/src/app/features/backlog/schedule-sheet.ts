import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { AfterViewInit } from '@angular/core';
import { SCHEDULE_MODES } from '@codebox/contracts';
import type { RepoSchedule, ScheduleMode, Selection } from '@codebox/contracts';
import { I18nService } from '../../core/i18n/i18n.service';
import { formatFire } from '../../core/util/time-format';
import { RepoScheduleStore } from '../repos/repo-schedule.store';
import type { ScheduleWrite } from '../repos/repo-schedule.api';
import { translate } from './i18n';

export interface ScheduleFields {
  readonly mode: ScheduleMode;
  readonly timezone: string;
  readonly cron: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly selection: Selection;
  readonly refs: readonly string[];
  readonly maxAttempts: number;
  readonly maxFires: string;
  readonly maxCost: string;
}

/** A schedule the repository does not have yet starts from these: they are draft, not facts. */
const DRAFT_FIELDS: ScheduleFields = Object.freeze({
  mode: 'every',
  timezone: 'UTC',
  cron: '0 9 * * 1-5',
  windowStart: '09:00',
  windowEnd: '17:00',
  selection: 'nextPending',
  refs: [],
  maxAttempts: 2,
  maxFires: '',
  maxCost: '',
});

const CRON_FALLBACK = '0 9 * * 1-5';
const WINDOW_START_FALLBACK = '09:00';
const WINDOW_END_FALLBACK = '17:00';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** A stored schedule → the editable draft. Missing values fall back to the create defaults. */
export function scheduleFields(schedule: RepoSchedule): ScheduleFields {
  return {
    mode: schedule.mode,
    timezone: schedule.timezone,
    cron: schedule.cron ?? CRON_FALLBACK,
    windowStart: schedule.windowStart ?? WINDOW_START_FALLBACK,
    windowEnd: schedule.windowEnd ?? WINDOW_END_FALLBACK,
    selection: schedule.selection,
    refs: [...schedule.refs],
    maxAttempts: schedule.maxAttempts,
    maxFires: schedule.maxFires === null ? '' : String(schedule.maxFires),
    maxCost: schedule.maxCostPerFireUsd === null ? '' : String(schedule.maxCostPerFireUsd),
  };
}

/** The draft → the write body, or null when a cap is not a valid value. */
export function scheduleWrite(fields: ScheduleFields): ScheduleWrite | null {
  const maxFires = fields.maxFires === '' ? null : readMaxFires(fields.maxFires);
  if (fields.maxFires !== '' && maxFires === null) return null;
  const maxCost = fields.maxCost === '' ? null : readMaxCost(fields.maxCost);
  if (fields.maxCost !== '' && maxCost === null) return null;
  const timezone = fields.timezone.trim();
  // The frame draws no selector: the pair and the retry budget travel from the stored row.
  const policy = {
    selection: fields.selection,
    refs: [...fields.refs],
    maxAttempts: fields.maxAttempts,
  };
  const caps = { maxFires, maxCostPerFireUsd: maxCost };
  if (fields.mode === 'window') {
    return {
      mode: fields.mode,
      timezone,
      cron: null,
      windowStart: fields.windowStart,
      windowEnd: fields.windowEnd,
      ...policy,
      ...caps,
    };
  }
  return {
    mode: fields.mode,
    timezone,
    cron: fields.cron.trim(),
    windowStart: null,
    windowEnd: null,
    ...policy,
    ...caps,
  };
}

/** docs/api.md §5.10: `maxFires` is a whole number of one or more; anything else refuses the save. */
function readMaxFires(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 ? value : null;
}

/** docs/api.md §5.10: `maxCostPerFireUsd` is any finite number from zero up. */
function readMaxCost(text: string): number | null {
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

@Component({
  selector: 'app-schedule-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [RepoScheduleStore],
  styles: [
    `
      .cb-schedule-overlay {
        position: fixed;
        inset: 0;
        z-index: 20;
        display: flex;
        align-items: end;
        justify-content: center;
      }
      .cb-schedule-scrim {
        position: absolute;
        inset: 0;
        border: 0;
        padding: 0;
        background: var(--cb-bg);
        opacity: 0.72;
        cursor: pointer;
      }
      .cb-schedule-panel {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 8px;
        inline-size: 100%;
        max-inline-size: 30rem;
        max-block-size: 100%;
        overflow-y: auto;
        padding: 8px 24px 32px;
        border-start-start-radius: 16px;
        border-start-end-radius: 16px;
        background: var(--cb-surface);
        color: var(--cb-text);
        overscroll-behavior: contain;
      }
      .cb-schedule-handle {
        display: block;
        inline-size: 40px;
        block-size: 4px;
        margin: 8px auto 0;
        border-radius: 2px;
        background: var(--cb-muted);
      }
      .cb-schedule-head {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 8px;
        margin-block-start: 16px;
      }
      .cb-schedule-title {
        margin: 0;
        font-size: 24px;
        line-height: 29px;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .cb-schedule-close {
        flex: 0 0 auto;
        inline-size: 44px;
        block-size: 44px;
        margin: -10px -10px 0 0;
        border: 0;
        background: none;
        color: var(--cb-muted);
        font: inherit;
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
      }
      .cb-schedule-lede {
        margin: 0;
        color: var(--cb-muted);
        font-size: 13px;
        line-height: 20px;
        overflow-wrap: anywhere;
      }
      .cb-schedule-label {
        margin: 16px 0 0;
        color: var(--cb-muted);
        font-size: 10px;
        line-height: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .cb-schedule-modes {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin-block-start: 8px;
      }
      .cb-schedule-mode,
      .cb-schedule-create,
      .cb-schedule-retry {
        min-block-size: 44px;
        border: 1px solid var(--cb-surface);
        border-radius: 8px;
        background: var(--cb-bg);
        color: var(--cb-text);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
        overflow-wrap: anywhere;
      }
      .cb-schedule-mode[aria-pressed='true'] {
        border-color: var(--cb-accent);
        background: var(--cb-accent);
        color: var(--cb-bg);
        font-weight: 600;
      }
      .cb-schedule-card {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-inline-size: 0;
        margin-block-start: 8px;
        padding: 8px 12px;
        border: 1px solid var(--cb-surface);
        border-radius: 8px;
        background: var(--cb-bg);
      }
      .cb-schedule-card-label {
        color: var(--cb-muted);
        font-size: 9px;
        line-height: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .cb-schedule-card input {
        inline-size: 100%;
        min-inline-size: 0;
        border: 0;
        padding: 0;
        background: none;
        color: var(--cb-text);
        font: inherit;
        font-size: 16px;
        line-height: 19px;
      }
      .cb-schedule-pair {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        min-inline-size: 0;
      }
      .cb-schedule-pair > .cb-schedule-card {
        min-inline-size: 0;
      }
      .cb-schedule-next-fire,
      .cb-schedule-foot {
        margin: 0;
        color: var(--cb-muted);
        font-size: 13px;
        line-height: 20px;
        overflow-wrap: anywhere;
      }
      .cb-schedule-next-fire {
        margin-block-start: 12px;
      }
      .cb-schedule-foot {
        margin-block-start: 16px;
        font-size: 12px;
        line-height: 18px;
      }
      .cb-schedule-error,
      .cb-schedule-fields-error {
        margin: 0;
        color: var(--cb-danger);
        font-size: 13px;
        line-height: 20px;
        overflow-wrap: anywhere;
      }
      .cb-schedule-notice,
      .cb-schedule-started {
        margin: 0;
        color: var(--cb-text);
        font-size: 13px;
        line-height: 20px;
        overflow-wrap: anywhere;
      }
      .cb-schedule-notice {
        color: var(--cb-warn);
      }
      .cb-schedule-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-block-start: 16px;
      }
      .cb-schedule-save,
      .cb-schedule-run-next {
        min-block-size: 48px;
        border-radius: 8px;
        font: inherit;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        overflow-wrap: anywhere;
      }
      .cb-schedule-save {
        border: 1px solid var(--cb-accent);
        background: var(--cb-accent);
        color: var(--cb-bg);
      }
      .cb-schedule-run-next {
        border: 1px solid var(--cb-muted);
        background: none;
        color: var(--cb-text);
      }
      .cb-schedule-save[disabled],
      .cb-schedule-run-next[disabled] {
        opacity: 0.6;
        cursor: default;
      }
      .cb-schedule-empty {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-block-start: 24px;
        padding: 16px;
        border: 1px solid var(--cb-surface);
        border-radius: 16px;
        background: var(--cb-bg);
      }
      .cb-schedule-empty h3 {
        margin: 0;
        font-size: 16px;
        line-height: 19px;
        font-weight: 600;
      }
      .cb-schedule-empty p {
        margin: 0;
        color: var(--cb-muted);
        font-size: 12px;
        line-height: 18px;
      }
      .cb-schedule-create {
        min-block-size: 44px;
        font-weight: 600;
      }
      .cb-schedule-state {
        margin: 24px 0 0;
        color: var(--cb-muted);
        font-size: 13px;
        line-height: 20px;
        overflow-wrap: anywhere;
      }
      @media (max-width: 360px) {
        .cb-schedule-panel {
          padding-inline: 16px;
        }
      }
    `,
  ],
  template: `
    <section
      #sheet
      class="cb-schedule-overlay"
      data-testid="schedule-sheet"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="t('scheduleSheet.title')"
      [attr.data-repo-id]="repoId()"
    >
      <div
        class="cb-schedule-scrim"
        data-testid="schedule-sheet-scrim"
        (click)="close()"
      ></div>
      <div class="cb-schedule-panel">
        <span class="cb-schedule-handle" aria-hidden="true"></span>
        <header class="cb-schedule-head">
          <h2 class="cb-schedule-title">{{ t('scheduleSheet.title') }}</h2>
          <button
            #closeButton
            type="button"
            class="cb-schedule-close"
            data-testid="schedule-sheet-close"
            [attr.aria-label]="t('scheduleSheet.close')"
            (click)="close()"
          >
            ×
          </button>
        </header>
        <p class="cb-schedule-lede">{{ t('scheduleSheet.lede') }}</p>

        @if (store.loading()) {
          <p class="cb-schedule-state" data-testid="schedule-sheet-loading">
            {{ t('scheduleSheet.loading') }}
          </p>
        }

        @if (store.error(); as failure) {
          <div class="cb-schedule-error" data-testid="schedule-sheet-error" [attr.data-code]="failure.code">
            <p>{{ t('scheduleSheet.error') }}</p>
            <button
              type="button"
              class="cb-schedule-retry"
              data-testid="schedule-sheet-retry"
              (click)="store.reload()"
            >
              {{ t('scheduleSheet.retry') }}
            </button>
          </div>
        }

        @if (!store.loading() && (store.error() === null || showForm())) {
          @if (!showForm()) {
            <section class="cb-schedule-empty" data-testid="schedule-sheet-empty">
              <h3>{{ t('scheduleSheet.empty.title') }}</h3>
              <p>{{ t('scheduleSheet.empty.body') }}</p>
              <button
                type="button"
                class="cb-schedule-create"
                data-testid="schedule-sheet-create"
                (click)="reveal()"
              >
                {{ t('scheduleSheet.create') }}
              </button>
            </section>
          } @else {
            <form
              data-testid="schedule-sheet-fields"
              [attr.data-mode]="fields().mode"
              novalidate
              (submit)="save($event)"
            >
              <p class="cb-schedule-label">{{ t('scheduleSheet.mode') }}</p>
              <div class="cb-schedule-modes">
                @for (candidate of modes; track candidate) {
                  <button
                    type="button"
                    class="cb-schedule-mode"
                    [attr.data-testid]="'schedule-sheet-mode-' + candidate"
                    [attr.aria-pressed]="fields().mode === candidate"
                    [disabled]="store.busy() !== null"
                    (click)="setMode(candidate)"
                  >
                    {{ t('scheduleSheet.mode.' + candidate) }}
                  </button>
                }
              </div>

              <p class="cb-schedule-label">{{ t('scheduleSheet.mode.window') }}</p>
              @if (fields().mode === 'window') {
                <div class="cb-schedule-pair">
                  <label class="cb-schedule-card">
                    <span class="cb-schedule-card-label">{{ t('scheduleSheet.field.start') }}</span>
                    <input
                      type="time"
                      data-testid="schedule-sheet-window-start"
                      [value]="fields().windowStart"
                      (input)="setField('windowStart', $event)"
                    />
                  </label>
                  <label class="cb-schedule-card">
                    <span class="cb-schedule-card-label">{{ t('scheduleSheet.field.end') }}</span>
                    <input
                      type="time"
                      data-testid="schedule-sheet-window-end"
                      [value]="fields().windowEnd"
                      (input)="setField('windowEnd', $event)"
                    />
                  </label>
                </div>
              } @else {
                <label class="cb-schedule-card">
                  <span class="cb-schedule-card-label">{{ t('scheduleSheet.field.cron') }}</span>
                  <input
                    type="text"
                    data-testid="schedule-sheet-cron"
                    autocomplete="off"
                    spellcheck="false"
                    [value]="fields().cron"
                    (input)="setField('cron', $event)"
                  />
                </label>
              }
              <label class="cb-schedule-card">
                <span class="cb-schedule-card-label">{{ t('scheduleSheet.field.zone') }}</span>
                <input
                  type="text"
                  data-testid="schedule-sheet-timezone"
                  autocomplete="off"
                  spellcheck="false"
                  [value]="fields().timezone"
                  (input)="setField('timezone', $event)"
                />
              </label>

              <p class="cb-schedule-label">{{ t('scheduleSheet.caps') }}</p>
              <div class="cb-schedule-pair">
                <label class="cb-schedule-card">
                  <span class="cb-schedule-card-label">{{ t('scheduleSheet.field.maxFires') }}</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    data-testid="schedule-sheet-max-fires"
                    [attr.placeholder]="t('scheduleSheet.noCap')"
                    [value]="fields().maxFires"
                    (input)="setField('maxFires', $event)"
                  />
                </label>
                <label class="cb-schedule-card">
                  <span class="cb-schedule-card-label">{{ t('scheduleSheet.field.maxCost') }}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    data-testid="schedule-sheet-max-cost"
                    [attr.placeholder]="t('scheduleSheet.noCap')"
                    [value]="fields().maxCost"
                    (input)="setField('maxCost', $event)"
                  />
                </label>
              </div>

              @if (fieldsError()) {
                <p class="cb-schedule-fields-error" data-testid="schedule-sheet-fields-error">
                  {{ t('scheduleSheet.fields') }}
                </p>
              }

              <p class="cb-schedule-next-fire" data-testid="schedule-sheet-next-fire">
                {{ nextFire() }}
              </p>

              <div class="cb-schedule-actions">
                <button
                  type="submit"
                  class="cb-schedule-save"
                  data-testid="schedule-sheet-save"
                  [disabled]="store.busy() !== null"
                >
                  {{
                    store.busy() === 'save'
                      ? t('scheduleSheet.save.busy')
                      : t('scheduleSheet.save')
                  }}
                </button>
                <button
                  type="button"
                  class="cb-schedule-run-next"
                  data-testid="schedule-sheet-run-next"
                  [disabled]="store.busy() !== null"
                  (click)="runNext()"
                >
                  {{ t('scheduleSheet.runNext') }}
                </button>
              </div>

              @if (store.notice(); as notice) {
                <p class="cb-schedule-notice" data-testid="schedule-sheet-notice" [attr.data-reason]="notice">
                  {{ t('scheduleSheet.notice.' + notice) }}
                </p>
              }
              @if (store.nextRun(); as run) {
                <p
                  class="cb-schedule-started"
                  data-testid="schedule-sheet-started"
                  [attr.data-run-id]="run.id"
                  [attr.data-state]="run.state"
                >
                  {{ t('scheduleSheet.started') }} · {{ run.id }} · {{ run.state }}
                </p>
              }

              <p class="cb-schedule-foot">{{ t('scheduleSheet.foot') }}</p>
            </form>
          }
        }
      </div>
    </section>
  `,
})
export class ScheduleSheet implements AfterViewInit, OnDestroy {
  readonly repoId = input.required<string>();
  readonly repoSlug = input.required<string>();
  readonly closed = output<void>();

  readonly store = inject(RepoScheduleStore);
  readonly modes = SCHEDULE_MODES;
  readonly fields = signal<ScheduleFields>(DRAFT_FIELDS);
  readonly fieldsError = signal(false);
  readonly revealing = signal(false);

  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly sheet = viewChild<ElementRef<HTMLElement>>('sheet');
  private readonly i18n = inject(I18nService);
  private readonly document = inject(DOCUMENT);
  private dismissed = false;
  private loadedId: string | null = null;

  readonly t: (key: string) => string = (key) => translate(this.i18n.locale(), key);

  /** A stored schedule, or the create draft while the operator is filling it in. */
  readonly showForm = computed<boolean>(() => this.store.schedule() !== null || this.revealing());

  readonly nextFire = computed<string>(() => {
    const schedule = this.store.schedule();
    const label = this.t('scheduleSheet.nextFire');
    const instant = schedule?.nextFireAt ?? null;
    const formatted =
      instant === null
        ? this.t('scheduleSheet.never')
        : formatFire(instant, schedule?.timezone ?? this.fields().timezone, this.i18n.locale());
    const left =
      schedule === null || schedule.maxFires === null
        ? null
        : Math.max(0, schedule.maxFires - schedule.firesCount);
    return left === null
      ? `${label} · ${formatted}`
      : `${label} · ${formatted} · ${left} ${this.t('scheduleSheet.left')}`;
  });

  /** The dialog's own focusables, in document order; anything marked hidden is skipped. */
  private focusables(): HTMLElement[] {
    const root = this.sheet()?.nativeElement;
    if (root === undefined) return [];
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
      (element) => element.closest('[aria-hidden="true"]') === null,
    );
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = this.focusables();
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    const active = this.document.activeElement;
    const inside = active instanceof HTMLElement && items.includes(active);
    if (event.shiftKey) {
      if (!inside || active === first) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (!inside || active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  constructor() {
    effect(() => {
      const candidate = this.repoId();
      untracked(() => this.store.load(candidate));
    });
    effect(() => {
      const schedule = this.store.schedule();
      untracked(() => {
        if (schedule === null) {
          this.loadedId = null;
          return;
        }
        if (schedule.id === this.loadedId) return;
        this.loadedId = schedule.id;
        this.fields.set(scheduleFields(schedule));
        this.fieldsError.set(false);
      });
    });
  }

  ngAfterViewInit(): void {
    this.document.addEventListener('keydown', this.onKeydown);
    this.closeButton()?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    this.document.removeEventListener('keydown', this.onKeydown);
  }

  reveal(): void {
    this.revealing.set(true);
  }

  setMode(mode: ScheduleMode): void {
    this.fields.update((current) => ({ ...current, mode }));
  }

  setField(key: 'timezone' | 'cron' | 'windowStart' | 'windowEnd' | 'maxFires' | 'maxCost', event: Event): void {
    const value = fieldValue(event);
    this.fields.update((current) => ({ ...current, [key]: value }));
    this.fieldsError.set(false);
  }

  save(event: Event): void {
    event.preventDefault();
    const body = scheduleWrite(this.fields());
    if (body === null) {
      this.fieldsError.set(true);
      return;
    }
    this.fieldsError.set(false);
    this.store.save(this.repoId(), body);
  }

  runNext(): void {
    this.store.runNext();
  }

  close(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    this.closed.emit();
  }
}

function fieldValue(event: Event): string {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.value;
  }
  return '';
}

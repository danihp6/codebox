import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { CREDENTIAL_EXPOSES, CREDENTIAL_KINDS } from './credentials.api';
import type { CreateCredentialBody, CredentialExpose, CredentialKind } from './credentials.api';
import { translate } from './i18n';

const NAME_MAX_LENGTH = 120;
const VALUE_MAX_LENGTH = 16_384;

/**
 * Sheet `19 · Add credential`: form → review → save. The value lives in one signal, one password
 * input and the emitted body; the review step draws four characters and no input (D50).
 */
@Component({
  selector: 'app-add-credential-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        --cb-sheet-stroke: color-mix(in srgb, var(--cb-muted) 28%, transparent);
        display: block;
        margin-block-start: 16px;
      }
      .cb-sheet {
        display: flex;
        flex-direction: column;
        gap: 12px;
        inline-size: 100%;
        padding: 16px;
        border: 1px solid var(--cb-sheet-stroke);
        border-radius: 12px;
        background: var(--cb-surface);
        color: var(--cb-text);
        font-family: var(--cb-font-sans);
        font-size: 12px;
        line-height: 15px;
        box-sizing: border-box;
      }
      .cb-sheet-title {
        margin: 0;
        color: var(--cb-text);
        font-size: 15px;
        font-weight: 600;
        line-height: 18px;
      }
      .cb-sheet-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-inline-size: 0;
      }
      .cb-sheet-label {
        color: var(--cb-muted);
        font-size: 11px;
        font-weight: 400;
        line-height: 13px;
      }
      .cb-sheet-input,
      .cb-sheet-select {
        inline-size: 100%;
        min-inline-size: 0;
        block-size: 44px;
        padding-inline: 12px;
        border: 1px solid var(--cb-sheet-stroke);
        border-radius: 10px;
        background: var(--cb-bg);
        color: var(--cb-text);
        font-family: var(--cb-font-sans);
        font-size: 13px;
        line-height: 16px;
        box-sizing: border-box;
      }
      .cb-sheet-warning,
      .cb-sheet-blocked {
        margin: 0;
        padding-inline-start: 10px;
        border-inline-start: 3px solid var(--cb-accent);
        color: var(--cb-text);
        font-size: 11px;
        font-weight: 400;
        line-height: 13px;
        overflow-wrap: anywhere;
      }
      .cb-sheet-blocked {
        border-inline-start-color: var(--cb-danger);
        color: var(--cb-danger);
      }
      .cb-sheet-review {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0;
      }
      .cb-sheet-review p {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin: 0;
        font-size: 12px;
        line-height: 15px;
      }
      .cb-sheet-review-label {
        color: var(--cb-muted);
        font-weight: 400;
      }
      .cb-sheet-review-value {
        min-inline-size: 0;
        color: var(--cb-text);
        font-weight: 500;
        overflow-wrap: anywhere;
      }
      .cb-sheet-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-block-start: 12px;
      }
      .cb-sheet-action {
        flex: 1 1 120px;
        min-block-size: 44px;
        padding-inline: 12px;
        border: 1px solid var(--cb-sheet-stroke);
        border-radius: 10px;
        background: var(--cb-bg);
        color: var(--cb-muted);
        font-family: var(--cb-font-sans);
        font-size: 12px;
        font-weight: 400;
        line-height: 15px;
        cursor: pointer;
      }
      .cb-sheet-action-primary {
        border-color: color-mix(in srgb, var(--cb-accent) 45%, transparent);
        color: var(--cb-accent);
        font-weight: 600;
      }
      .cb-sheet-action:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ],
  template: `
    <section class="cb-sheet" data-testid="add-credential-sheet" [attr.data-step]="step()">
      @if (step() === 'form') {
        <h2 class="cb-sheet-title">{{ t('credentials.action.addOpen') }}</h2>

        <label class="cb-sheet-field" for="credential-name">
          <span class="cb-sheet-label">{{ t('credentials.name') }}</span>
          <input
            id="credential-name"
            class="cb-sheet-input"
            data-testid="credential-name"
            type="text"
            autocomplete="off"
            [value]="name()"
            (input)="name.set(valueOf($event))"
          />
        </label>

        <label class="cb-sheet-field" for="credential-kind">
          <span class="cb-sheet-label">{{ t('credentials.kind') }}</span>
          <select
            id="credential-kind"
            class="cb-sheet-select"
            data-testid="credential-kind"
            (change)="setKind(valueOf($event))"
          >
            @for (option of kinds; track option) {
              <option [value]="option" [selected]="option === kind()">
                {{ t('credentials.kind.' + option) }}
              </option>
            }
          </select>
        </label>

        <label class="cb-sheet-field" for="credential-expose">
          <span class="cb-sheet-label">{{ t('credentials.expose') }}</span>
          <select
            id="credential-expose"
            class="cb-sheet-select"
            data-testid="credential-expose"
            (change)="setExpose(valueOf($event))"
          >
            @for (option of exposes; track option) {
              <option [value]="option" [selected]="option === expose()">
                {{ t('credentials.expose.' + option) }}
              </option>
            }
          </select>
        </label>

        @if (expose() === 'env') {
          <p class="cb-sheet-warning" data-testid="credential-env-warning">
            {{ t('credentials.expose.envWarning') }}
          </p>
          @if (envBlocked()) {
            <p class="cb-sheet-blocked" data-testid="credential-env-blocked">
              {{ t('credentials.expose.envBlocked') }}
            </p>
          }
        }

        <label class="cb-sheet-field" for="credential-value">
          <span class="cb-sheet-label">{{ t('credentials.value') }}</span>
          <input
            id="credential-value"
            class="cb-sheet-input"
            data-testid="credential-value"
            type="password"
            autocomplete="off"
            [value]="value()"
            (input)="value.set(valueOf($event))"
          />
        </label>

        @if (problem(); as message) {
          <p class="cb-sheet-blocked" data-testid="credential-problem">{{ message }}</p>
        }

        <div class="cb-sheet-actions">
          <button
            type="button"
            class="cb-sheet-action"
            data-testid="credential-cancel"
            (click)="close()"
          >
            {{ t('credentials.action.cancel') }}
          </button>
          <button
            type="button"
            class="cb-sheet-action cb-sheet-action-primary"
            data-testid="credential-continue"
            [disabled]="envBlocked()"
            (click)="toReview()"
          >
            {{ t('credentials.action.continue') }}
          </button>
        </div>
      } @else {
        <h2 class="cb-sheet-title">{{ t('credentials.action.addOpen') }}</h2>

        <div class="cb-sheet-review" data-testid="credential-review">
          <p>
            <span class="cb-sheet-review-label">{{ t('credentials.name') }}:</span>
            <span class="cb-sheet-review-value" data-testid="credential-review-name">{{
              name().trim()
            }}</span>
          </p>
          <p>
            <span class="cb-sheet-review-label">{{ t('credentials.kind') }}:</span>
            <span class="cb-sheet-review-value" data-testid="credential-review-kind">{{
              t('credentials.kind.' + kind())
            }}</span>
          </p>
          <p>
            <span class="cb-sheet-review-label">{{ t('credentials.expose') }}:</span>
            <span class="cb-sheet-review-value" data-testid="credential-review-expose">{{
              t('credentials.expose.' + expose())
            }}</span>
          </p>
          <p>
            <span class="cb-sheet-review-label">{{ t('credentials.value') }}:</span>
            <span class="cb-sheet-review-value" aria-hidden="true">••••</span>
            <span class="cb-sheet-review-value" data-testid="credential-review-tail">{{
              reviewTail()
            }}</span>
          </p>
        </div>

        @if (problem(); as message) {
          <p class="cb-sheet-blocked" data-testid="credential-problem">{{ message }}</p>
        }

        <div class="cb-sheet-actions">
          <button
            type="button"
            class="cb-sheet-action"
            data-testid="credential-back"
            (click)="back()"
          >
            {{ t('credentials.action.back') }}
          </button>
          <button
            type="button"
            class="cb-sheet-action cb-sheet-action-primary"
            data-testid="credential-save"
            [disabled]="saving() || envBlocked()"
            (click)="save()"
          >
            {{ t('credentials.action.save') }}
          </button>
        </div>
      }
    </section>
  `,
})
export class AddCredentialSheet {
  readonly saving = input<boolean>(false);
  readonly saved = output<CreateCredentialBody>();
  readonly closed = output<void>();

  readonly kinds = CREDENTIAL_KINDS;
  readonly exposes = CREDENTIAL_EXPOSES;

  readonly step = signal<'form' | 'review'>('form');
  readonly name = signal('');
  readonly kind = signal<CredentialKind>('api_key');
  readonly expose = signal<CredentialExpose>('daemon');
  readonly value = signal('');
  readonly problem = signal<string | null>(null);

  private readonly i18n = inject(I18nService);

  readonly locale = this.i18n.locale;
  readonly t = (key: string): string => translate(this.locale(), key);

  readonly envBlocked = computed(() => this.expose() === 'env' && this.kind() !== 'model_key');
  readonly reviewTail = computed(() => this.value().slice(-4));

  setKind(value: string): void {
    if ((CREDENTIAL_KINDS as readonly string[]).includes(value)) {
      this.kind.set(value as CredentialKind);
    }
  }

  setExpose(value: string): void {
    if ((CREDENTIAL_EXPOSES as readonly string[]).includes(value)) {
      this.expose.set(value as CredentialExpose);
    }
  }

  valueOf(event: Event): string {
    return fieldValue(event);
  }

  toReview(): void {
    const problem = this.validationProblem();
    this.problem.set(problem);
    if (problem === null) this.step.set('review');
  }

  back(): void {
    this.problem.set(null);
    this.step.set('form');
  }

  save(): void {
    if (this.envBlocked()) return;
    const body: CreateCredentialBody = {
      name: this.name().trim(),
      kind: this.kind(),
      expose: this.expose(),
      value: this.value(),
    };
    this.saved.emit(body);
    this.value.set('');
    this.problem.set(null);
    this.step.set('form');
  }

  close(): void {
    this.value.set('');
    this.problem.set(null);
    this.step.set('form');
    this.closed.emit();
  }

  private validationProblem(): string | null {
    const name = this.name().trim();
    if (name.length === 0 || name.length > NAME_MAX_LENGTH) {
      return this.t('credentials.problem.name');
    }
    const value = this.value();
    if (value.length === 0 || value.length > VALUE_MAX_LENGTH) {
      return this.t('credentials.problem.value');
    }
    if (this.expose() === 'env' && this.kind() !== 'model_key') {
      return this.t('credentials.problem.env');
    }
    return null;
  }
}

function fieldValue(event: Event): string {
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return target.value;
  }
  return '';
}

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

@Component({
  selector: 'app-add-credential-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-sheet {
        display: flex;
        flex-direction: column;
        gap: calc(var(--cb-space) * 2);
        border: 1px solid var(--cb-surface);
        border-radius: var(--cb-radius);
        padding: calc(var(--cb-space) * 3);
      }
      .cb-sheet-field {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
      }
      .cb-sheet-actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--cb-space) * 2);
      }
      .cb-sheet-warning {
        border-inline-start: 3px solid var(--cb-accent);
        margin: 0;
        padding-inline-start: calc(var(--cb-space) * 2);
      }
      .cb-sheet-blocked {
        border-inline-start: 3px solid var(--cb-danger);
        margin: 0;
        padding-inline-start: calc(var(--cb-space) * 2);
      }
      .cb-sheet-review {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
      }
      .cb-sheet-review p {
        margin: 0;
        overflow-wrap: anywhere;
      }
    `,
  ],
  template: `
    <section class="cb-sheet" data-testid="add-credential-sheet">
      @if (step() === 'form') {
        <h2>{{ t('credentials.action.addOpen') }}</h2>

        <label class="cb-sheet-field" for="credential-name">
          <span>{{ t('credentials.name') }}</span>
          <input
            id="credential-name"
            data-testid="credential-name"
            type="text"
            autocomplete="off"
            [value]="name()"
            (input)="name.set(valueOf($event))"
          />
        </label>

        <label class="cb-sheet-field" for="credential-kind">
          <span>{{ t('credentials.kind') }}</span>
          <select
            id="credential-kind"
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
          <span>{{ t('credentials.expose') }}</span>
          <select
            id="credential-expose"
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
          <span>{{ t('credentials.value') }}</span>
          <input
            id="credential-value"
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
          <button type="button" data-testid="credential-cancel" (click)="close()">
            {{ t('credentials.action.cancel') }}
          </button>
          <button
            type="button"
            data-testid="credential-continue"
            [disabled]="envBlocked()"
            (click)="toReview()"
          >
            {{ t('credentials.action.continue') }}
          </button>
        </div>
      } @else {
        <h2>{{ t('credentials.action.addOpen') }}</h2>

        <div class="cb-sheet-review" data-testid="credential-review">
          <p>
            {{ t('credentials.name') }}:
            <span data-testid="credential-review-name">{{ name().trim() }}</span>
          </p>
          <p>
            {{ t('credentials.kind') }}:
            <span data-testid="credential-review-kind">{{ t('credentials.kind.' + kind()) }}</span>
          </p>
          <p>
            {{ t('credentials.expose') }}:
            <span data-testid="credential-review-expose">{{
              t('credentials.expose.' + expose())
            }}</span>
          </p>
          <p>
            {{ t('credentials.value') }}:
            <span aria-hidden="true">••••</span>
            <span data-testid="credential-review-tail">{{ reviewTail() }}</span>
          </p>
        </div>

        @if (problem(); as message) {
          <p class="cb-sheet-blocked" data-testid="credential-problem">{{ message }}</p>
        }

        <div class="cb-sheet-actions">
          <button type="button" data-testid="credential-back" (click)="back()">
            {{ t('credentials.action.back') }}
          </button>
          <button
            type="button"
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

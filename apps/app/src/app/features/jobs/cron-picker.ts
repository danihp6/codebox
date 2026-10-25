import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { summarise, validateCron } from './cron';
import type { CronValidation } from './cron';

export const CRON_PRESETS: readonly string[] = Object.freeze([
  '0 3 * * *',
  '*/15 * * * *',
  '30 */6 * * *',
  '0 8 * * 1',
  '15 4 * * 1-5',
]);

@Component({
  selector: 'app-cron-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .cb-cron {
        display: flex;
        flex-direction: column;
        gap: var(--cb-space);
      }
      .cb-cron-presets {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cb-space);
      }
      [data-ok='false'] {
        color: var(--cb-danger);
      }
    `,
  ],
  template: `
    <div class="cb-cron">
      <input
        type="text"
        data-testid="cron-input"
        [value]="expression()"
        [attr.aria-label]="summary()"
        (input)="onInput($event)"
      />
      <output data-testid="cron-summary" [attr.data-ok]="valid().ok">{{ summary() }}</output>
      <div class="cb-cron-presets">
        @for (preset of presets; track preset; let index = $index) {
          <button
            type="button"
            [attr.data-testid]="'cron-preset-' + index"
            (click)="select(preset)"
          >
            {{ summarisePreset(preset) }}
          </button>
        }
      </div>
    </div>
  `,
})
export class CronPickerComponent {
  readonly expression = input.required<string>();
  readonly locale = input<'en' | 'es'>('en');
  readonly changed = output<string>();
  readonly summary = computed<string>(() => summarise(this.expression(), this.locale()));
  readonly valid = computed<CronValidation>(() => validateCron(this.expression()));
  readonly presets = CRON_PRESETS;

  summarisePreset(preset: string): string {
    return summarise(preset, this.locale());
  }

  select(preset: string): void {
    this.changed.emit(preset);
  }

  onInput(event: Event): void {
    this.changed.emit(inputValue(event));
  }
}

function inputValue(event: Event): string {
  const target = event.target;
  return target instanceof HTMLInputElement ? target.value : '';
}
